"""
core/pipeline.py — Pipeline vidéo complet — x-translator-mvp

Pipeline :
  1. yt-dlp → télécharge MP4 dans /tmp/{job_id}/source.mp4
  2. FFmpeg → extrait audio MP3 16kHz mono
  3. Groq Whisper API → SRT source + langue détectée
  4. Hallucination filter (regex + LLM) → SRT propre
  5. Résumé LLM (DeepSeek V3) → stocké dans jobs.summary
  6. OpenRouter DeepSeek V3 → translate_srt() → SRT traduit
  7. FFmpeg burn sous-titres (libass/drawtext/pillow)
  8. add_watermark_video() → MP4 final watermarqué
  9. Supabase Storage → upload
  10. UPDATE jobs SET status='done'
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import uuid
from pathlib import Path
from typing import Optional

from core.config import settings


# ─── Helpers FFmpeg ───────────────────────────────────────────────────────────

def _ffmpeg_path() -> str:
    candidates = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"]
    for c in candidates:
        try:
            subprocess.run([c, "-version"], capture_output=True, check=True, timeout=5)
            return c
        except Exception:
            continue
    return "ffmpeg"


def _has_libass() -> bool:
    try:
        r = subprocess.run([_ffmpeg_path(), "-filters"], capture_output=True, timeout=10)
        return b"subtitles" in r.stdout
    except Exception:
        return False


def _has_drawtext() -> bool:
    try:
        r = subprocess.run([_ffmpeg_path(), "-filters"], capture_output=True, timeout=10)
        return b"drawtext" in r.stdout
    except Exception:
        return False


_LIBASS_OK    = _has_libass()
_DRAWTEXT_OK  = _has_drawtext()


def _get_video_dims(video: Path) -> tuple[int, int]:
    ffprobe = _ffmpeg_path().replace("ffmpeg", "ffprobe")
    try:
        r = subprocess.run(
            [ffprobe, "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-of", "csv=p=0", str(video)],
            capture_output=True, timeout=15,
        )
        if r.returncode == 0 and r.stdout:
            parts = r.stdout.decode().strip().split(",")
            return int(parts[0]), int(parts[1])
    except Exception:
        pass
    return 1920, 1080


def _get_video_duration(video: Path) -> float:
    ffprobe = _ffmpeg_path().replace("ffmpeg", "ffprobe")
    try:
        r = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(video)],
            capture_output=True, timeout=15,
        )
        if r.returncode == 0 and r.stdout.strip():
            return float(r.stdout.decode().strip())
    except Exception:
        pass
    return 60.0


def _to_srt_time(seconds: float) -> str:
    h   = int(seconds // 3600)
    m   = int((seconds % 3600) // 60)
    s   = int(seconds % 60)
    ms  = int((seconds - int(seconds)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _parse_srt(content: str) -> list[dict]:
    blocks = []
    for raw_block in content.strip().split("\n\n"):
        lines = raw_block.strip().splitlines()
        if len(lines) < 3:
            continue
        blocks.append({
            "index":    lines[0].strip(),
            "timecode": lines[1].strip(),
            "text":     "\n".join(lines[2:]).strip(),
        })
    return blocks


def _write_srt(blocks: list[dict]) -> str:
    parts = []
    for b in blocks:
        parts.append(f"{b['index']}\n{b['timecode']}\n{b['text']}\n")
    return "\n".join(parts)


# ─── Transcription Groq ───────────────────────────────────────────────────────

def _transcribe_via_groq(
    video_path: Path,
    srt_out: Path,
    txt_out: Path,
    api_key: str,
) -> dict | None:
    """Transcription via Groq Whisper cloud (whisper-large-v3-turbo)."""
    import httpx as _httpx

    ffmpeg     = _ffmpeg_path()
    audio_path = video_path.parent / f"{video_path.stem}_audio.mp3"

    try:
        r = subprocess.run(
            [ffmpeg, "-y", "-i", str(video_path),
             "-vn", "-ar", "16000", "-ac", "1", "-b:a", "64k", str(audio_path)],
            capture_output=True, timeout=120,
        )
        if r.returncode != 0 or not audio_path.exists():
            print(f"[groq] ❌ Extraction audio échouée (code {r.returncode})")
            return None

        audio_size_mb = audio_path.stat().st_size / 1024 / 1024
        print(f"[groq] 🎵 Audio extrait : {audio_size_mb:.2f} MB")

        if audio_size_mb > 24:
            print(f"[groq] ⚠️  Audio > 24 MB — skip Groq")
            return None

        with open(audio_path, "rb") as f:
            audio_bytes = f.read()

        with _httpx.Client(timeout=120.0) as client:
            resp = client.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {api_key}"},
                files={"file": (audio_path.name, audio_bytes, "audio/mpeg")},
                data={
                    "model": "whisper-large-v3-turbo",
                    "response_format": "verbose_json",
                    "timestamp_granularities[]": "segment",
                },
            )

        if resp.status_code != 200:
            print(f"[groq] ❌ HTTP {resp.status_code}: {resp.text[:300]}")
            return None

        data      = resp.json()
        segments  = data.get("segments", [])
        full_text = data.get("text", "").strip()
        language  = data.get("language", "en")

        if not segments and not full_text:
            return None

        if not segments:
            srt_out.write_text(f"1\n00:00:00,000 --> 00:00:05,000\n{full_text}\n", encoding="utf-8")
            txt_out.write_text(full_text, encoding="utf-8")
            return {"text": full_text, "language": language}

        srt_lines, text_parts = [], []
        for i, seg in enumerate(segments, 1):
            start = float(seg.get("start", 0))
            end   = float(seg.get("end", start + 2))
            text  = seg.get("text", "").strip()
            if not text:
                continue
            text_parts.append(text)
            srt_lines.append(f"{i}\n{_to_srt_time(start)} --> {_to_srt_time(end)}\n{text}\n")

        full_text = " ".join(text_parts)
        srt_out.write_text("\n".join(srt_lines), encoding="utf-8")
        txt_out.write_text(full_text, encoding="utf-8")

        print(f"[groq] ✅ {len(srt_lines)} segments — langue={language}")
        return {"text": full_text, "language": language}

    except Exception as e:
        print(f"[groq] ❌ Erreur : {e}")
        return None
    finally:
        audio_path.unlink(missing_ok=True)


# ─── Burn sous-titres ─────────────────────────────────────────────────────────

def _burn_subtitles(
    video_path:  Path,
    srt_path:    Path,
    output_path: Path,
    wm_path:     Optional[Path] = None,
) -> bool:
    """
    Incrustation sous-titres + watermark optionnel.
    Mode A : libass (subtitles filter) — qualité max
    Mode B : pillow (frame-by-frame) — fallback universel
    """
    ffmpeg = _ffmpeg_path()

    if _LIBASS_OK:
        # Mode A : libass
        srt_esc  = str(srt_path).replace("\\", "/").replace(":", "\\:")
        vf_chain = f"subtitles='{srt_esc}':force_style='FontSize=20,PrimaryColour=&H00FFFFFF&,OutlineColour=&H000000&,Outline=1'"
        if wm_path:
            cmd = [
                ffmpeg, "-y", "-nostdin",
                "-i", str(video_path), "-i", str(wm_path),
                "-filter_complex",
                f"[0:v]{vf_chain}[subbed];[subbed][1:v]overlay=0:0:format=auto,format=yuv420p[out]",
                "-map", "[out]", "-map", "0:a:0?",
                "-c:v", "libx264", "-crf", "18", "-preset", "fast",
                "-c:a", "copy", "-movflags", "+faststart",
                str(output_path),
            ]
        else:
            cmd = [
                ffmpeg, "-y", "-nostdin", "-i", str(video_path),
                "-vf", vf_chain,
                "-c:v", "libx264", "-crf", "18", "-preset", "fast",
                "-c:a", "copy", "-movflags", "+faststart",
                str(output_path),
            ]
        proc = subprocess.run(cmd, capture_output=True, timeout=600)
        if proc.returncode == 0 and output_path.exists() and output_path.stat().st_size > 0:
            return True
        print(f"[burn/libass] ⚠️  FFmpeg code={proc.returncode} — fallback Pillow")

    # Mode B : Pillow frame-by-frame (fallback universel)
    return _burn_subtitles_pillow(video_path, srt_path, output_path, wm_path)


def _burn_subtitles_pillow(
    video_path:  Path,
    srt_path:    Path,
    output_path: Path,
    wm_path:     Optional[Path] = None,
) -> bool:
    """Incrustation sous-titres via Pillow (frame-by-frame). Lent mais universel."""
    ffmpeg = _ffmpeg_path()
    try:
        from PIL import Image, ImageDraw, ImageFont, ImageFilter

        srt_content = srt_path.read_text(encoding="utf-8")
        blocks      = _parse_srt(srt_content)
        vid_w, vid_h = _get_video_dims(video_path)

        def _srt_time_to_sec(ts: str) -> float:
            ts = ts.strip().replace(",", ".")
            parts = ts.split(":")
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])

        # Extraire frames via ffmpeg pipe
        fps_cmd = subprocess.run(
            [ffmpeg.replace("ffmpeg", "ffprobe"), "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=r_frame_rate",
             "-of", "default=noprint_wrappers=1:nokey=1", str(video_path)],
            capture_output=True, timeout=15,
        )
        fps = 25.0
        if fps_cmd.returncode == 0:
            try:
                frac = fps_cmd.stdout.decode().strip()
                if "/" in frac:
                    n, d = frac.split("/")
                    fps = float(n) / float(d)
                else:
                    fps = float(frac)
            except Exception:
                pass

        wm_img = None
        if wm_path and wm_path.exists():
            wm_img = Image.open(wm_path).convert("RGBA")

        font_path = None
        for fp in [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/Library/Fonts/Arial Bold.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
        ]:
            if os.path.isfile(fp):
                font_path = fp
                break
        try:
            font = ImageFont.truetype(font_path, 22) if font_path else ImageFont.load_default()
        except Exception:
            font = ImageFont.load_default()

        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            frames_dir = Path(tmpdir) / "frames"
            frames_dir.mkdir()

            # Extract frames
            extract_proc = subprocess.run(
                [ffmpeg, "-y", "-i", str(video_path),
                 "-vf", f"scale={vid_w}:{vid_h}",
                 f"{frames_dir}/%08d.png"],
                capture_output=True, timeout=600,
            )
            if extract_proc.returncode != 0:
                print("[burn/pillow] ❌ Extraction frames échouée")
                return False

            frame_files = sorted(frames_dir.glob("*.png"))
            for i, frame_file in enumerate(frame_files):
                t = i / fps
                # Trouver le bloc SRT actif
                active_text = None
                for block in blocks:
                    try:
                        parts    = block["timecode"].split(" --> ")
                        t_start  = _srt_time_to_sec(parts[0])
                        t_end    = _srt_time_to_sec(parts[1])
                        if t_start <= t <= t_end:
                            active_text = block["text"]
                            break
                    except Exception:
                        continue

                frame = Image.open(frame_file).convert("RGBA")

                if wm_img:
                    frame = Image.alpha_composite(frame, wm_img.resize(frame.size, Image.LANCZOS))

                if active_text:
                    draw = ImageDraw.Draw(frame)
                    lines = active_text.split("\n")
                    for li, line in enumerate(reversed(lines)):
                        try:
                            bbox   = draw.textbbox((0, 0), line, font=font)
                            text_w = bbox[2] - bbox[0]
                            text_h = bbox[3] - bbox[1]
                        except AttributeError:
                            text_w, text_h = draw.textsize(line, font=font)
                        x = (vid_w - text_w) // 2
                        y = vid_h - 60 - li * (text_h + 6)
                        draw.text((x + 1, y + 1), line, font=font, fill=(0, 0, 0, 230))
                        draw.text((x, y), line, font=font, fill=(255, 255, 255, 255))

                frame.convert("RGB").save(frame_file, format="PNG")

            # Réassembler en vidéo
            cmd = [
                ffmpeg, "-y", "-framerate", str(fps),
                "-i", f"{frames_dir}/%08d.png",
                "-i", str(video_path),
                "-map", "0:v", "-map", "1:a:0?",
                "-c:v", "libx264", "-crf", "18", "-preset", "fast",
                "-c:a", "copy", "-movflags", "+faststart",
                "-pix_fmt", "yuv420p",
                str(output_path),
            ]
            proc = subprocess.run(cmd, capture_output=True, timeout=600)
            if proc.returncode == 0 and output_path.exists() and output_path.stat().st_size > 0:
                print(f"[burn/pillow] ✅ OK — {output_path.stat().st_size // 1024} KB")
                return True
            print(f"[burn/pillow] ❌ code={proc.returncode}")
            return False

    except Exception as e:
        print(f"[burn/pillow] ❌ Erreur : {e}")
        return False


# ─── Pipeline principal ───────────────────────────────────────────────────────

async def process_video(
    job_id: str,
    source_url: str,
    target_lang: str,
    user_id: str,
) -> dict:
    """
    Pipeline complet : download → transcribe → filter → summarize → translate → burn → watermark → upload
    Met à jour la DB à chaque étape.
    """
    from core.db import get_conn, init_pool
    from core.openrouter import translate_srt, generate_summary
    from core.watermark import add_watermark_video, _generate_watermark_png
    from core.supabase_storage import upload_video
    from core.whisper_hallucination_filter import (
        filter_srt_segments,
        filter_srt_with_llm,
        filter_transcript_text,
    )

    await init_pool()

    tmp_base = Path(settings.LOCAL_TEMP_DIR)
    tmp_base.mkdir(parents=True, exist_ok=True)
    workdir = tmp_base / job_id
    workdir.mkdir(exist_ok=True)

    source_mp4     = workdir / "source.mp4"
    source_srt     = workdir / "source.srt"
    transcript_txt = workdir / "transcript.txt"
    translated_srt = workdir / "translated.srt"
    burned_mp4     = workdir / "burned.mp4"
    final_mp4      = workdir / "final.mp4"

    async def _set_status(status: str, **kwargs):
        try:
            async with get_conn() as conn:
                sets = ["status=$2", "updated_at=now()"]
                vals = [uuid.UUID(job_id), status]
                idx  = 3
                for k, v in kwargs.items():
                    sets.append(f"{k}=${idx}")
                    vals.append(v)
                    idx += 1
                await conn.execute(
                    f"UPDATE jobs SET {', '.join(sets)} WHERE id=$1",
                    *vals,
                )
        except Exception as e:
            print(f"[pipeline] ⚠️  DB status update ignoré: {e}")

    try:
        # ── 1. Vérifier durée pré-download via yt-dlp (rapide) ─────────────────
        await _set_status("downloading")
        print(f"[pipeline] ⬇️  Téléchargement {source_url}")

        import yt_dlp
        ydl_opts = {
            "format":   "best[height<=720][ext=mp4]/best[height<=720]/best",
            "outtmpl":  str(workdir / "source.%(ext)s"),
            "quiet":    True,
            "no_warnings": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([source_url])

        # Trouver le fichier téléchargé
        candidates = list(workdir.glob("source.*"))
        if not candidates:
            raise RuntimeError("yt-dlp n'a produit aucun fichier")

        dl_file = candidates[0]
        if dl_file.suffix.lower() != ".mp4":
            # Convertir en MP4 si nécessaire
            mp4_file = workdir / "source.mp4"
            ffmpeg   = _ffmpeg_path()
            subprocess.run(
                [ffmpeg, "-y", "-i", str(dl_file), "-c", "copy", str(mp4_file)],
                capture_output=True, timeout=120,
            )
            if mp4_file.exists() and mp4_file.stat().st_size > 0:
                dl_file.unlink(missing_ok=True)
                dl_file = mp4_file
            else:
                dl_file = dl_file.rename(source_mp4)
        else:
            if dl_file != source_mp4:
                dl_file.rename(source_mp4)

        # ── Vérifier durée ────────────────────────────────────────────────────
        duration = _get_video_duration(source_mp4)
        video_type = "short" if duration <= settings.VIDEO_SHORT_MAX_SECONDS else "long"

        if duration > settings.VIDEO_MAX_SECONDS:
            raise RuntimeError(f"Vidéo trop longue ({duration:.0f}s > {settings.VIDEO_MAX_SECONDS}s max)")

        await _set_status("transcribing", duration_s=round(duration, 1), video_type=video_type)
        print(f"[pipeline] ⏱  Durée: {duration:.1f}s — type: {video_type}")

        # ── 2. Transcription Groq ─────────────────────────────────────────────
        groq_key = settings.GROQ_API_KEY
        whisper_result = None
        if groq_key:
            whisper_result = await asyncio.to_thread(
                _transcribe_via_groq, source_mp4, source_srt, transcript_txt, groq_key
            )

        if not whisper_result:
            raise RuntimeError("Transcription échouée (Groq indisponible)")

        source_lang   = whisper_result.get("language", "en")
        transcript_tx = whisper_result.get("text", "")
        print(f"[pipeline] 🎤 Transcription OK — langue={source_lang} ({len(transcript_tx)} chars)")

        # ── 3. Hallucination filter ───────────────────────────────────────────
        _no_audio = False
        if source_srt.exists() and source_srt.stat().st_size > 0:
            srt_raw     = source_srt.read_text(encoding="utf-8")
            blocks      = _parse_srt(srt_raw)

            # Phase regex
            cleaned_blocks, removed_regex = filter_srt_segments(blocks)
            if removed_regex:
                print(f"[pipeline] 🧹 {len(removed_regex)} hallucination(s) regex supprimée(s)")
                source_srt.write_text(_write_srt(cleaned_blocks), encoding="utf-8")

            # Phase LLM
            if cleaned_blocks:
                kept_llm, removed_llm, is_valid = await filter_srt_with_llm(cleaned_blocks, transcript_tx)
                if not is_valid:
                    _no_audio = True
                    print("[pipeline] 🔇 LLM : aucun contenu audio valide")
                elif removed_llm:
                    source_srt.write_text(_write_srt(kept_llm), encoding="utf-8")
                    transcript_tx = " ".join(b["text"] for b in kept_llm if b.get("text"))
            else:
                _no_audio = True
        else:
            _no_audio = True

        # ── 4. Résumé LLM ─────────────────────────────────────────────────────
        summary = None
        if transcript_tx and not _no_audio:
            try:
                summary = await generate_summary(transcript_tx, target_lang=target_lang)
                print(f"[pipeline] 📝 Résumé généré ({len(summary or '')} chars)")
            except Exception as e:
                print(f"[pipeline] ⚠️  Résumé ignoré: {e}")

        await _set_status("translating", summary=summary, source_lang=source_lang)

        # ── 5. Traduction SRT ─────────────────────────────────────────────────
        translated_srt_content = None
        if not _no_audio and source_srt.exists() and source_srt.stat().st_size > 0:
            srt_content = source_srt.read_text(encoding="utf-8")
            if source_lang != target_lang:
                translated_srt_content = await translate_srt(
                    srt_content, source_lang, target_lang,
                    context={"src_lang": source_lang},
                )
                if translated_srt_content:
                    translated_srt.write_text(translated_srt_content, encoding="utf-8")
                else:
                    # Fallback : utiliser SRT source
                    translated_srt_content = srt_content
                    translated_srt.write_text(srt_content, encoding="utf-8")
            else:
                translated_srt_content = srt_content
                translated_srt.write_text(srt_content, encoding="utf-8")

        # ── 6. Watermark PNG (généré une fois) ────────────────────────────────
        wm_path: Optional[Path] = None
        try:
            vid_w, vid_h = _get_video_dims(source_mp4)
            wm_bytes     = await asyncio.to_thread(_generate_watermark_png, vid_w, vid_h)
            if wm_bytes:
                wm_path = workdir / "watermark.png"
                wm_path.write_bytes(wm_bytes)
        except Exception as e:
            print(f"[pipeline] ⚠️  Watermark PNG ignoré: {e}")

        # ── 7. Burn sous-titres ───────────────────────────────────────────────
        await _set_status("burning")

        if translated_srt.exists() and translated_srt.stat().st_size > 0:
            burn_ok = await asyncio.to_thread(
                _burn_subtitles, source_mp4, translated_srt, burned_mp4, wm_path
            )
        else:
            # Pas de sous-titres → watermark seul sur vidéo originale
            burn_ok = False
            if wm_path:
                wm_bytes_final = wm_path.read_bytes()
                result_bytes   = await asyncio.to_thread(
                    add_watermark_video, source_mp4.read_bytes()
                )
                if result_bytes:
                    burned_mp4.write_bytes(result_bytes)
                    burn_ok = True
            if not burn_ok:
                # Copier la source sans modification
                import shutil
                shutil.copy2(source_mp4, burned_mp4)
                burn_ok = True

        if not burn_ok or not burned_mp4.exists():
            raise RuntimeError("Burn sous-titres échoué")

        # final_mp4 = burned_mp4 (le watermark est déjà intégré via _burn_subtitles)
        import shutil
        shutil.copy2(burned_mp4, final_mp4)

        # ── 8. Upload Supabase Storage ────────────────────────────────────────
        await _set_status("uploading")
        upload_result = await upload_video(
            job_id, final_mp4.read_bytes(), filename="output.mp4"
        )

        if not upload_result:
            # Fallback : pas de Supabase configuré → URL locale (dev)
            storage_key = f"local/{job_id}/output.mp4"
            storage_url = f"file://{final_mp4}"
        else:
            storage_key = upload_result["storage_key"]
            storage_url = upload_result["storage_url"]

        # ── 9. Finalisation DB ────────────────────────────────────────────────
        async with get_conn() as conn:
            await conn.execute(
                """
                UPDATE jobs SET
                    status='done',
                    storage_key=$2,
                    storage_url=$3,
                    source_lang=$4,
                    updated_at=now()
                WHERE id=$1
                """,
                uuid.UUID(job_id), storage_key, storage_url, source_lang,
            )

        print(f"[pipeline] ✅ Job {job_id[:8]}… terminé — {storage_key}")
        return {
            "job_id":     job_id,
            "status":     "done",
            "storage_url": storage_url,
            "source_lang": source_lang,
            "duration_s":  round(duration, 1),
            "video_type":  video_type,
            "summary":     summary,
        }

    except Exception as exc:
        print(f"[pipeline] ❌ Job {job_id[:8]}… échoué: {exc}")
        try:
            async with get_conn() as conn:
                await conn.execute(
                    "UPDATE jobs SET status='error', error_msg=$2, updated_at=now() WHERE id=$1",
                    uuid.UUID(job_id), str(exc),
                )
        except Exception:
            pass
        raise

    finally:
        # Nettoyage /tmp
        if os.environ.get("DEBUG_KEEP_TEMP", "false").lower() != "true":
            import shutil
            shutil.rmtree(workdir, ignore_errors=True)
