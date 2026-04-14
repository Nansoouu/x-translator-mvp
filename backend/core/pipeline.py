"""
core/pipeline.py — Pipeline vidéo complet — x-translator-mvp

Pipeline :
  1. yt-dlp → télécharge MP4 dans /tmp/{job_id}/source.mp4
  2. FFmpeg → extrait audio MP3 16kHz mono
  3. Groq API → SRT source + langue détectée
  4. Hallucination filter (regex + LLM) → SRT propre
  5. Résumé LLM (DeepSeek V3) → stocké dans jobs.summary
  6. OpenRouter DeepSeek V3 → translate_srt() → SRT traduit
  7. Décalage timing SRT (+200ms pour éviter l'affichage trop tôt)
  8. SRT → ASS (fond noir + texte blanc + wrapping 42 chars)
  9. FFmpeg burn ASS (pass 1) + overlay watermark (pass 2) → MP4 final
  10. Supabase Storage → upload
  11. UPDATE jobs SET status='done'
"""
from __future__ import annotations

import asyncio
import os
import re
import subprocess
import textwrap
import uuid
from datetime import datetime
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
        return b"subtitles" in r.stdout or b"ass" in r.stdout
    except Exception:
        return False


_LIBASS_OK = _has_libass()


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
    return 1280, 720


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


# ─── Helpers SRT → ASS ────────────────────────────────────────────────────────

def _srt_time_to_ass(ts: str) -> str:
    """Convertit un timestamp SRT (00:00:01,000) en format ASS (0:00:01.00)."""
    ts    = ts.strip().replace(",", ".")
    parts = ts.split(":")
    h     = int(parts[0])
    m     = int(parts[1])
    rest  = parts[2].split(".")
    s     = int(rest[0])
    ms    = int(rest[1]) if len(rest) > 1 else 0
    cs    = ms // 10  # centisecondes
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _srt_to_ass(srt_content: str, vid_w: int = 1280, vid_h: int = 720) -> str:
    """
    Convertit SRT → ASS (Advanced SubStation Alpha).
    Style : fond noir semi-transparent (BorderStyle=3) + texte blanc + wrapping 42 chars/ligne.
    """
    MAX_CHARS = 42
    font_size = max(18, min(26, vid_h // 32))
    margin_v  = max(20, vid_h // 28)

    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {vid_w}\n"
        f"PlayResY: {vid_h}\n"
        "WrapStyle: 0\n"
        "\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
        "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,Arial,{font_size},"
        "&H00FFFFFF,"   # PrimaryColour  : blanc opaque
        "&H000000FF,"   # SecondaryColour
        "&H00000000,"   # OutlineColour  : noir
        "&HA0000000,"   # BackColour     : noir 62 % opaque
        "0,0,0,0,"      # Bold, Italic, Underline, StrikeOut
        "100,100,0,0,"  # ScaleX, ScaleY, Spacing, Angle
        "3,"            # BorderStyle=3 → boîte opaque derrière le texte
        "1,0,"          # Outline, Shadow
        "2,"            # Alignment=2   → bas-centre
        f"20,20,{margin_v},1\n"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )

    blocks      = _parse_srt(srt_content)
    event_lines = []
    for b in blocks:
        try:
            parts    = b["timecode"].split(" --> ")
            t_start  = _srt_time_to_ass(parts[0])
            t_end    = _srt_time_to_ass(parts[1])
            raw      = b["text"].replace("\n", " ").strip()
            wrapped  = textwrap.fill(raw, MAX_CHARS)
            ass_text = wrapped.replace("\n", "\\N")
            event_lines.append(
                f"Dialogue: 0,{t_start},{t_end},Default,,0,0,0,,{ass_text}"
            )
        except Exception:
            continue

    return header + "\n".join(event_lines) + "\n"


def _shift_srt_timing(srt_content: str, offset_ms: int = 200) -> str:
    """Décale tous les timestamps SRT de +offset_ms ms."""
    def time_to_ms(ts: str) -> int:
        h, m, s_ms = ts.strip().split(":")
        s, ms = s_ms.split(",")
        return int(h) * 3_600_000 + int(m) * 60_000 + int(s) * 1_000 + int(ms)

    def ms_to_time(total: int) -> str:
        total = max(0, total)
        h  = total // 3_600_000; total %= 3_600_000
        m  = total // 60_000;    total %= 60_000
        s  = total // 1_000;     ms = total % 1_000
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    def shift_match(match: re.Match) -> str:
        return (
            f"{ms_to_time(time_to_ms(match.group(1)) + offset_ms)} --> "
            f"{ms_to_time(time_to_ms(match.group(2)) + offset_ms)}"
        )

    return re.sub(
        r"(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})",
        shift_match,
        srt_content,
    )


# ─── Transcription Groq ───────────────────────────────────────────────────────

def _transcribe_via_groq(
    video_path: Path,
    srt_out: Path,
    txt_out: Path,
    api_key: str,
) -> dict | None:
    """Transcription via Groq cloud API."""
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


# ─── Burn sous-titres — 2 passes ─────────────────────────────────────────────

def _burn_subtitles(
    video_path:  Path,
    srt_path:    Path,
    output_path: Path,
    wm_path:     Optional[Path] = None,
) -> bool:
    """
    Incrustation sous-titres + watermark — stratégie 2 passes :
      Passe 1 : ASS (ou SRT fallback) via -vf → fichier intermédiaire
      Passe 2 : overlay watermark sur le résultat via -filter_complex

    Avantages :
    - Évite les conflits de parsing filter_complex avec les chemins entre guillemets simples.
    - Modes de fallback progressifs : ASS → SRT → watermark seul → copie directe.
    """
    import shutil

    ffmpeg     = _ffmpeg_path()
    inter_path = output_path.parent / "inter_subs.mp4"

    # ── Helper : exécuter une commande FFmpeg ──────────────────────────────
    def _run(cmd: list[str], label: str, out: Path) -> bool:
        try:
            proc = subprocess.run(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                timeout=600,
            )
            if proc.returncode == 0 and out.exists() and out.stat().st_size > 0:
                print(f"[burn/{label}] ✅ OK — {out.stat().st_size // 1024} KB")
                return True
            err = (proc.stderr or b"").decode("utf-8", errors="replace")[-400:]
            print(f"[burn/{label}] ⚠️  FFmpeg code={proc.returncode}: {err}")
            out.unlink(missing_ok=True)
        except subprocess.TimeoutExpired:
            print(f"[burn/{label}] ❌ Timeout (600 s)")
            out.unlink(missing_ok=True)
        except Exception as e:
            print(f"[burn/{label}] ❌ Exception : {e}")
            out.unlink(missing_ok=True)
        return False

    # ── Générer le fichier ASS ─────────────────────────────────────────────
    ass_path: Optional[Path] = None
    try:
        srt_content  = srt_path.read_text(encoding="utf-8")
        vid_w, vid_h = _get_video_dims(video_path)
        ass_content  = _srt_to_ass(srt_content, vid_w, vid_h)
        ass_path     = srt_path.parent / "translated.ass"
        ass_path.write_text(ass_content, encoding="utf-8")
        print(f"[burn] ✍️  ASS généré ({len(ass_content)} chars, {vid_w}×{vid_h})")
    except Exception as e:
        print(f"[burn] ⚠️  Conversion ASS échouée : {e}")

    # ── Passe 1 : incruster les sous-titres via -vf  ──────────────────────
    # NOTE : on utilise -vf (NOT filter_complex) pour éviter les problèmes
    # de parsing des chemins entre guillemets simples dans filter_complex.
    subs_ok   = False
    base_in   = video_path  # la source pour la passe 2 est modifiable

    if ass_path and ass_path.exists() and _LIBASS_OK:
        # Le chemin ASS ne doit pas contenir de ':' ni de caractères spéciaux.
        # Les UUIDs ne contiennent que des [a-z0-9-] → safe sans quotes.
        ass_str = str(ass_path).replace("\\", "/")
        cmd = [
            ffmpeg, "-y", "-nostdin", "-i", str(video_path),
            "-vf", f"ass={ass_str}",
            "-pix_fmt", "yuv420p",
            "-c:v", "libx264", "-crf", "18", "-preset", "fast",
            "-c:a", "copy", "-movflags", "+faststart",
            str(inter_path),
        ]
        subs_ok = _run(cmd, "ass-vf", inter_path)
        if not subs_ok:
            print("[burn] ⚠️  Mode ASS échoué → fallback SRT")

    if not subs_ok and _LIBASS_OK:
        srt_str   = str(srt_path).replace("\\", "/")
        style_str = (
            "BorderStyle=3,BackColour=&H80000000,"
            "PrimaryColour=&H00FFFFFF,FontSize=20,"
            "Outline=0,MarginV=25,Fontname=Arial"
        )
        cmd = [
            ffmpeg, "-y", "-nostdin", "-i", str(video_path),
            "-vf", f"subtitles={srt_str}:force_style='{style_str}'",
            "-pix_fmt", "yuv420p",
            "-c:v", "libx264", "-crf", "18", "-preset", "fast",
            "-c:a", "copy", "-movflags", "+faststart",
            str(inter_path),
        ]
        subs_ok = _run(cmd, "srt-vf", inter_path)
        if not subs_ok:
            print("[burn] ⚠️  Mode SRT échoué → sous-titres abandonnés")

    # Si AUCUN mode de sous-titres n'a fonctionné → passe 2 sur la source originale
    if subs_ok:
        base_in = inter_path
    else:
        base_in = video_path

    # ── Passe 2 : overlay watermark ───────────────────────────────────────
    if wm_path and wm_path.exists():
        cmd = [
            ffmpeg, "-y", "-nostdin",
            "-i", str(base_in), "-i", str(wm_path),
            "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[out]",
            "-map", "[out]", "-map", "0:a:0?",
            "-c:v", "libx264", "-crf", "18", "-preset", "fast",
            "-c:a", "copy", "-movflags", "+faststart",
            str(output_path),
        ]
        ok = _run(cmd, "wm-overlay", output_path)
        inter_path.unlink(missing_ok=True)
        if ok:
            return True
        print("[burn] ⚠️  Overlay watermark échoué → copie base_in")

    # ── Cas sans watermark ou si overlay échoué ────────────────────────────
    if subs_ok:
        # On a les sous-titres mais pas le watermark → on essaie quand même le watermark
        # en utilisant le fichier intermédiaire comme source
        if wm_path and wm_path.exists():
            wm_cmd = [
                ffmpeg, "-y", "-nostdin",
                "-i", str(inter_path), "-i", str(wm_path),
                "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[out]",
                "-map", "[out]", "-map", "0:a:0?",
                "-c:v", "libx264", "-crf", "18", "-preset", "fast",
                "-c:a", "copy", "-movflags", "+faststart",
                str(output_path),
            ]
            wm_ok = _run(wm_cmd, "wm-fallback", output_path)
            inter_path.unlink(missing_ok=True)
            if wm_ok:
                return True
            print("[burn] ⚠️  Watermark fallback échoué → déplacement intermédiaire")
        shutil.move(str(inter_path), str(output_path))
        return output_path.exists() and output_path.stat().st_size > 0

    # ── Dernier recours : source + watermark obligatoire ──────────────────
    if wm_path and wm_path.exists():
        print("[burn] ⚠️  Tentative watermark seul sur la source originale")
        wm_cmd = [
            ffmpeg, "-y", "-nostdin",
            "-i", str(video_path), "-i", str(wm_path),
            "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[out]",
            "-map", "[out]", "-map", "0:a:0?",
            "-c:v", "libx264", "-crf", "18", "-preset", "fast",
            "-c:a", "copy", "-movflags", "+faststart",
            str(output_path),
        ]
        wm_ok = _run(wm_cmd, "wm-source-only", output_path)
        if wm_ok:
            return True

    # ── Dernier recours absolu : copie directe (ne devrait jamais arriver) ──
    print("[burn] ❌  Aucun rendu possible — copie directe (SANS watermark)")
    shutil.copy2(video_path, output_path)
    return output_path.exists() and output_path.stat().st_size > 0


# ─── Pipeline principal ───────────────────────────────────────────────────────

async def process_video(
    job_id: str,
    source_url: str,
    target_lang: str,
    user_id: str,
) -> dict:
    """
    Pipeline complet : download → transcribe → filter → summarize → translate → burn → upload
    Utilise direct_connect() (connexion asyncpg directe, sans pool) pour éviter
    les conflits de boucle d'événements dans les workers Celery.
    """
    from core.db import direct_connect
    from core.openrouter import translate_srt, generate_summary
    from core.watermark import _generate_watermark_png
    from core.supabase_storage import upload_video
    from core.whisper_hallucination_filter import (
        filter_srt_segments,
        filter_srt_with_llm,
    )

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

    jid = uuid.UUID(job_id)

    async def _set_status(status: str, **kwargs) -> None:
        """Met à jour le statut du job — utilise une connexion directe."""
        try:
            async with direct_connect() as conn:
                sets = ["status=$2", "updated_at=now()"]
                vals: list = [jid, status]
                idx = 3
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

    thumbnail_url: Optional[str] = None  # initialisé avant le try pour le finally

    try:
        # ── 1. Téléchargement ─────────────────────────────────────────────────
        await _set_status("downloading")
        print(f"[pipeline] ⬇️  Téléchargement {source_url}")

        import yt_dlp
        ydl_opts = {
            "format":      "best[height<=720][ext=mp4]/best[height<=720]/best",
            "outtmpl":     str(workdir / "source.%(ext)s"),
            "quiet":       True,
            "no_warnings": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(source_url, download=True)
            thumbnail_url = info.get("thumbnail") if info else None
        if thumbnail_url:
            print(f"[pipeline] 🖼  Thumbnail extrait : {thumbnail_url[:80]}…")

        candidates = list(workdir.glob("source.*"))
        if not candidates:
            raise RuntimeError("yt-dlp n'a produit aucun fichier")

        dl_file = sorted(candidates, key=lambda p: p.stat().st_size, reverse=True)[0]
        if dl_file.suffix.lower() != ".mp4":
            mp4_file = workdir / "source.mp4"
            subprocess.run(
                [_ffmpeg_path(), "-y", "-i", str(dl_file), "-c", "copy", str(mp4_file)],
                capture_output=True, timeout=120,
            )
            if mp4_file.exists() and mp4_file.stat().st_size > 0:
                dl_file.unlink(missing_ok=True)
            else:
                dl_file.rename(source_mp4)
        else:
            if dl_file != source_mp4:
                dl_file.rename(source_mp4)

        # ── Vérifier durée ─────────────────────────────────────────────────
        duration   = _get_video_duration(source_mp4)
        video_type = "short" if duration <= settings.VIDEO_SHORT_MAX_SECONDS else "long"

        if duration > settings.VIDEO_MAX_SECONDS:
            raise RuntimeError(
                f"Vidéo trop longue ({duration:.0f}s > {settings.VIDEO_MAX_SECONDS}s max)"
            )

        await _set_status("transcribing", duration_s=round(duration, 1), video_type=video_type)
        print(f"[pipeline] ⏱  Durée: {duration:.1f}s — type: {video_type}")

        # ── 2. Transcription ──────────────────────────────────────────────────
        groq_key       = settings.GROQ_API_KEY
        whisper_result = None
        if groq_key:
            whisper_result = await asyncio.to_thread(
                _transcribe_via_groq, source_mp4, source_srt, transcript_txt, groq_key
            )

        if not whisper_result:
            raise RuntimeError("Transcription audio échouée")

        source_lang   = whisper_result.get("language", "en")
        transcript_tx = whisper_result.get("text", "")
        print(f"[pipeline] 🎤 Transcription OK — langue={source_lang} ({len(transcript_tx)} chars)")

        # ── 3. Filtre hallucinations ──────────────────────────────────────────
        _no_audio = False
        if source_srt.exists() and source_srt.stat().st_size > 0:
            srt_raw = source_srt.read_text(encoding="utf-8")
            blocks  = _parse_srt(srt_raw)

            cleaned_blocks, removed_regex = filter_srt_segments(blocks)
            if removed_regex:
                print(f"[pipeline] 🧹 {len(removed_regex)} hallucination(s) regex supprimée(s)")
                source_srt.write_text(_write_srt(cleaned_blocks), encoding="utf-8")

            if cleaned_blocks:
                kept_llm, removed_llm, is_valid = await filter_srt_with_llm(
                    cleaned_blocks, transcript_tx
                )
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

        # ── 4. Résumé ─────────────────────────────────────────────────────────
        summary = None
        if transcript_tx and not _no_audio:
            try:
                summary = await generate_summary(transcript_tx, target_lang=target_lang)
                print(f"[pipeline] 📝 Résumé généré ({len(summary or '')} chars)")
            except Exception as e:
                print(f"[pipeline] ⚠️  Résumé ignoré: {e}")

        await _set_status("translating", summary=summary, source_lang=source_lang)

        # ── 5. Traduction SRT ─────────────────────────────────────────────────
        if not _no_audio and source_srt.exists() and source_srt.stat().st_size > 0:
            srt_content = source_srt.read_text(encoding="utf-8")
            if source_lang != target_lang:
                translated_srt_content = await translate_srt(
                    srt_content, source_lang, target_lang,
                    context={"src_lang": source_lang},
                )
                if not translated_srt_content:
                    translated_srt_content = srt_content
            else:
                translated_srt_content = srt_content

            offset_ms = int(os.environ.get("SRT_TIMING_OFFSET_MS", "200"))
            if offset_ms:
                translated_srt_content = _shift_srt_timing(translated_srt_content, offset_ms)
                print(f"[pipeline] ⏰ Timing SRT décalé de +{offset_ms}ms")

            translated_srt.write_text(translated_srt_content, encoding="utf-8")

        # ── 6. Watermark PNG ──────────────────────────────────────────────────
        wm_path: Optional[Path] = None
        try:
            vid_w, vid_h = _get_video_dims(source_mp4)
            wm_bytes     = await asyncio.to_thread(_generate_watermark_png, vid_w, vid_h)
            if wm_bytes:
                wm_path = workdir / "watermark.png"
                wm_path.write_bytes(wm_bytes)
                print(f"[pipeline] 🖼  Watermark PNG généré ({vid_w}×{vid_h})")
        except Exception as e:
            print(f"[pipeline] ⚠️  Watermark PNG ignoré: {e}")

        # ── 7. Burn sous-titres (2 passes) ────────────────────────────────────
        await _set_status("burning")
        print("[pipeline] 🎬 Burn sous-titres + watermark en cours…")

        if translated_srt.exists() and translated_srt.stat().st_size > 0:
            burn_ok = await asyncio.to_thread(
                _burn_subtitles, source_mp4, translated_srt, burned_mp4, wm_path
            )
        else:
            burn_ok = False
            if wm_path and wm_path.exists():
                cmd = [
                    _ffmpeg_path(), "-y", "-nostdin",
                    "-i", str(source_mp4), "-i", str(wm_path),
                    "-filter_complex",
                    "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[out]",
                    "-map", "[out]", "-map", "0:a:0?",
                    "-c:v", "libx264", "-crf", "18", "-preset", "fast",
                    "-c:a", "copy", "-movflags", "+faststart",
                    str(burned_mp4),
                ]
                proc = subprocess.run(
                    cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=600
                )
                burn_ok = (
                    proc.returncode == 0
                    and burned_mp4.exists()
                    and burned_mp4.stat().st_size > 0
                )
            if not burn_ok:
                import shutil
                shutil.copy2(source_mp4, burned_mp4)
                burn_ok = True

        if not burn_ok or not burned_mp4.exists():
            raise RuntimeError("Burn sous-titres échoué")

        print(f"[pipeline] ✅ Burn OK — {burned_mp4.stat().st_size // 1024} KB")

        import shutil
        shutil.copy2(burned_mp4, final_mp4)

        # ── 8. Upload Supabase Storage ────────────────────────────────────────
        await _set_status("uploading")
        ts              = datetime.now().strftime("%Y%m%d_%H%M%S")
        upload_filename = f"translated_{ts}.mp4"
        print(f"[pipeline] ⬆️  Upload → {upload_filename}")

        upload_result = await upload_video(
            job_id, final_mp4.read_bytes(), filename=upload_filename
        )

        if not upload_result:
            storage_key = f"local/{job_id}/{upload_filename}"
            storage_url = f"file://{final_mp4}"
        else:
            storage_key = upload_result["storage_key"]
            storage_url = upload_result["storage_url"]

        # ── 9. Finalisation DB — connexion directe ────────────────────────────
        # On wrappe dans un try/except : si l'event loop Celery est corrompu,
        # l'UPDATE échoue mais la tâche ne doit PAS être marquée en erreur.
        # pipeline_task.py fera un 2ème asyncio.run() pour forcer l'UPDATE.
        _db_update_ok = False
        try:
            async with direct_connect() as conn:
                await conn.execute(
                    """
                    UPDATE jobs SET
                        status        = 'done',
                        storage_key   = $2,
                        storage_url   = $3,
                        source_lang   = $4,
                        thumbnail_url = $5,
                        updated_at    = now()
                    WHERE id = $1
                    """,
                    jid, storage_key, storage_url, source_lang, thumbnail_url,
                )
            _db_update_ok = True
        except Exception as _db_exc:
            print(f"[pipeline] ⚠️  DB final update ignoré (sera réessayé par la task): {_db_exc}")

        if _db_update_ok:
            print(f"[pipeline] ✅ Job {job_id[:8]}… terminé — {storage_key}")
        return {
            "job_id":        job_id,
            "status":        "done",
            "storage_url":   storage_url,
            "storage_key":   storage_key,
            "source_lang":   source_lang,
            "thumbnail_url": thumbnail_url,
            "duration_s":    round(duration, 1),
            "video_type":    video_type,
            "summary":       summary,
            "_db_update_ok": _db_update_ok,
        }

    except Exception as exc:
        print(f"[pipeline] ❌ Job {job_id[:8]}… échoué: {exc}")
        try:
            async with direct_connect() as conn:
                await conn.execute(
                    "UPDATE jobs SET status='error', error_msg=$2, updated_at=now() WHERE id=$1",
                    jid, str(exc)[:500],
                )
        except Exception:
            pass
        raise

    finally:
        if os.environ.get("DEBUG_KEEP_TEMP", "false").lower() != "true":
            import shutil
            shutil.rmtree(workdir, ignore_errors=True)
