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
    """
    Vérifie si le filtre 'ass' est réellement disponible dans ce build FFmpeg.
    IMPORTANT : on cherche 'ass' comme NOM EXACT de filtre (mot entier),
    pas comme sous-chaîne — évite les faux positifs sur 'passthrough', 'bass', etc.
    La sortie de `ffmpeg -filters` ressemble à :
      " T.. ass              V->V  ..."
    """
    import re
    try:
        r = subprocess.run([_ffmpeg_path(), "-filters"], capture_output=True, timeout=10)
        # Mot exact : "ass" précédé d'un espace ou début de ligne, suivi d'un espace
        return bool(re.search(rb'(?:^|\s)ass\s', r.stdout, re.MULTILINE))
    except Exception:
        return False


def _has_drawtext() -> bool:
    try:
        r = subprocess.run([_ffmpeg_path(), "-filters"], capture_output=True, timeout=10)
        return b"drawtext" in r.stdout
    except Exception:
        return False


def _init_ffmpeg_caps() -> tuple[bool, bool]:
    _l = _has_libass()
    _d = _has_drawtext()
    if _l:
        print("[ffmpeg/caps] Burn mode : Mode A libass")
    elif _d:
        print("[ffmpeg/caps] Burn mode : Mode B drawtext")
    else:
        print("[ffmpeg/caps] Burn mode : Mode C Pillow (rawvideo pipe)")
    return _l, _d


_LIBASS_OK, _DRAWTEXT_OK = _init_ffmpeg_caps()


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

# Durée max d'un chunk en secondes (10 min = 600s ≈ 3-5 MB @16kbps)
_GROQ_CHUNK_DURATION = 600


def _transcribe_via_groq(
    video_path: Path,
    srt_out: Path,
    txt_out: Path,
    api_key: str,
) -> dict | None:
    """
    Transcription via Groq API.

    Gestion avancée :
    - api_key peut être une liste séparée par virgule → rotation automatique
    - Si audio ≤ 24 MB  → 1 seul appel (chemin rapide, aucun changement)
    - Si audio > 24 MB  → découpage en chunks 10min + checkpoint JSON + rotation de clés
    - Sur HTTP 429      → sleep 65s puis essaie la clé suivante (round-robin)
    - Checkpoint        → si chunk_{i}.json existe, il est relu (reprise sans ré-appel API)
    """
    import httpx as _httpx
    import json  as _json
    import time  as _time

    ffmpeg     = _ffmpeg_path()
    audio_path = video_path.parent / f"{video_path.stem}_audio.mp3"

    # ── Rotation de clés (rétrocompatible : 1 seule clé = comportement original) ──
    api_keys = [k.strip() for k in api_key.split(",") if k.strip()] if api_key else []
    if not api_keys:
        print("[groq] ❌ Aucune clé API Groq configurée")
        return None

    def _call_groq_once(audio_bytes: bytes, filename: str, key: str):
        """Appel HTTP unique → retourne dict | 'rate_limit' | None."""
        try:
            with _httpx.Client(timeout=300.0) as client:
                resp = client.post(
                    "https://api.groq.com/openai/v1/audio/transcriptions",
                    headers={"Authorization": f"Bearer {key}"},
                    files={"file": (filename, audio_bytes, "audio/mpeg")},
                    data={
                        "model": "whisper-large-v3-turbo",
                        "response_format": "verbose_json",
                        "timestamp_granularities[]": "segment",
                    },
                )
            if resp.status_code == 429:
                return "rate_limit"
            if resp.status_code != 200:
                print(f"[groq] ❌ HTTP {resp.status_code}: {resp.text[:300]}")
                return None
            return resp.json()
        except Exception as e:
            print(f"[groq] ❌ Exception API: {e}")
            return None

    def _call_groq_with_retry(audio_bytes: bytes, filename: str, chunk_idx: int = 0):
        """Essaie toutes les clés, attend 65s sur 429, max 2 rounds."""
        n = len(api_keys)
        for attempt in range(n * 2):
            key = api_keys[(chunk_idx + attempt) % n]
            key_tag = f"clé {(chunk_idx + attempt) % n + 1}/{n}"
            result = _call_groq_once(audio_bytes, filename, key)
            if result == "rate_limit":
                print(f"[groq] ⏳ 429 rate limit ({key_tag}) — attente 65s…")
                _time.sleep(65)
                continue
            if result is not None:
                return result, (chunk_idx + attempt) % n  # data + index clé utilisée
        print(f"[groq] ❌ Toutes les clés épuisées pour {filename}")
        return None, 0

    try:
        # ── 1. Extraction audio ──────────────────────────────────────────────
        r = subprocess.run(
            [ffmpeg, "-y", "-i", str(video_path),
             "-vn", "-ar", "16000", "-ac", "1", "-b:a", "16k", str(audio_path)],
            capture_output=True, timeout=7200,
        )
        if r.returncode != 0 or not audio_path.exists():
            print(f"[groq] ❌ Extraction audio échouée (code {r.returncode})")
            return None

        audio_size_mb = audio_path.stat().st_size / 1024 / 1024
        print(f"[groq] 🎵 Audio extrait : {audio_size_mb:.2f} MB")

        # ── 2a. Chemin rapide : audio ≤ 24 MB → 1 seul appel ────────────────
        if audio_size_mb <= 24:
            with open(audio_path, "rb") as f:
                audio_bytes = f.read()

            data, _ = _call_groq_with_retry(audio_bytes, audio_path.name, chunk_idx=0)
            if not data:
                return None

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
                end   = float(seg.get("end",   start + 2))
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

        # ── 2b. Audio > 24 MB → chunking + checkpoint ────────────────────────
        ffprobe = ffmpeg.replace("ffmpeg", "ffprobe")
        r2 = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(audio_path)],
            capture_output=True, timeout=30,
        )
        try:
            total_s = float(r2.stdout.decode().strip())
        except Exception:
            total_s = 7200.0

        n_chunks = max(1, -(-int(total_s) // _GROQ_CHUNK_DURATION))  # ceil division
        print(f"[groq] 🔪 Audio {audio_size_mb:.1f} MB / {total_s:.0f}s → {n_chunks} chunk(s) ×{_GROQ_CHUNK_DURATION//60}min")
        print(f"[groq] 🔑 {len(api_keys)} clé(s) disponible(s) en rotation")

        all_segs: list[tuple[float, float, str]] = []
        language = "en"
        last_key_idx = 0

        for ci in range(n_chunks):
            offset_s        = ci * _GROQ_CHUNK_DURATION
            chunk_json_path = video_path.parent / f"chunk_{ci}.json"

            # ── Checkpoint : déjà transcrit ? ──────────────────────────────
            if chunk_json_path.exists():
                try:
                    saved = _json.loads(chunk_json_path.read_text(encoding="utf-8"))
                    loaded = [(d["s"], d["e"], d["t"]) for d in saved if d.get("t")]
                    if loaded:
                        all_segs.extend(loaded)
                        print(f"[groq] ♻️  Chunk {ci+1}/{n_chunks} — checkpoint ({len(loaded)} segs)")
                        continue
                except Exception:
                    pass  # JSON corrompu → on retranscrit

            # ── Découper le chunk ──────────────────────────────────────────
            chunk_mp3 = video_path.parent / f"chunk_{ci}.mp3"
            rc = subprocess.run(
                [ffmpeg, "-y", "-ss", str(offset_s), "-t", str(_GROQ_CHUNK_DURATION),
                 "-i", str(audio_path),
                 "-ac", "1", "-ar", "16000", "-b:a", "16k", str(chunk_mp3)],
                capture_output=True, timeout=300,
            )
            if rc.returncode != 0 or not chunk_mp3.exists():
                print(f"[groq] ⚠️  Chunk {ci+1}/{n_chunks} découpage échoué, skip")
                continue

            chunk_mb = chunk_mp3.stat().st_size / 1024 / 1024
            print(f"[groq] 📤 Chunk {ci+1}/{n_chunks} ({chunk_mb:.1f} MB, offset={offset_s:.0f}s)…")

            with open(chunk_mp3, "rb") as f:
                chunk_bytes = f.read()
            chunk_mp3.unlink(missing_ok=True)

            data, last_key_idx = _call_groq_with_retry(chunk_bytes, f"chunk_{ci}.mp3", chunk_idx=last_key_idx)
            if not data:
                print(f"[groq] ⚠️  Chunk {ci+1} transcription échouée, skip")
                continue

            language = data.get("language", language)
            chunk_segs: list[tuple[float, float, str]] = []
            for seg in (data.get("segments") or []):
                s = float(seg.get("start", 0)) + offset_s
                e = float(seg.get("end",   s + 2)) + offset_s
                t = seg.get("text", "").strip()
                if t:
                    chunk_segs.append((s, e, t))

            all_segs.extend(chunk_segs)

            # Sauvegarde checkpoint JSON
            if chunk_segs:
                chunk_json_path.write_text(
                    _json.dumps([{"s": s, "e": e, "t": t} for s, e, t in chunk_segs],
                                ensure_ascii=False),
                    encoding="utf-8",
                )
            print(f"[groq] ✅ Chunk {ci+1}/{n_chunks} : {len(chunk_segs)} segments")

        if not all_segs:
            return None

        # ── Fusion finale ────────────────────────────────────────────────────
        srt_lines, text_parts = [], []
        for idx, (s, e, t) in enumerate(all_segs, 1):
            srt_lines.append(f"{idx}\n{_to_srt_time(s)} --> {_to_srt_time(e)}\n{t}\n")
            text_parts.append(t)

        full_text = " ".join(text_parts)
        srt_out.write_text("\n".join(srt_lines), encoding="utf-8")
        txt_out.write_text(full_text, encoding="utf-8")

        # Nettoyage checkpoints
        for ci in range(n_chunks):
            (video_path.parent / f"chunk_{ci}.json").unlink(missing_ok=True)

        print(f"[groq] ✅ Fusion : {len(srt_lines)} segments — langue={language}")
        return {"text": full_text, "language": language}

    except Exception as e:
        print(f"[groq] ❌ Erreur : {e}")
        return None
    finally:
        audio_path.unlink(missing_ok=True)


# ─── FPS helper ───────────────────────────────────────────────────────────────

def _get_video_fps(video: Path) -> float:
    ffprobe = _ffmpeg_path().replace("ffmpeg", "ffprobe")
    try:
        r = subprocess.run(
            [ffprobe, "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=r_frame_rate",
             "-of", "default=noprint_wrappers=1:nokey=1", str(video)],
            capture_output=True, timeout=15,
        )
        if r.returncode == 0 and r.stdout:
            frac = r.stdout.decode().strip()
            if "/" in frac:
                num, den = frac.split("/")
                return float(num) / float(den)
            return float(frac)
    except Exception:
        pass
    return 25.0


# ─── Mode C : Pillow rawvideo pipe ───────────────────────────────────────────

def _burn_subtitles_pillow(
    video_path: Path,
    srt_path: Path,
    output_path: Path,
    wm_path: Optional[Path] = None,
) -> bool:
    """
    Incrustation sous-titres via Pillow + rawvideo pipe vers ffmpeg.
    Fonctionne avec N'IMPORTE QUEL ffmpeg (pas de libass requis).
    """
    try:
        from PIL import Image, ImageDraw, ImageFont  # type: ignore
    except ImportError:
        print("[pillow] ❌ Pillow non installé — pip install Pillow")
        import shutil
        shutil.copy2(video_path, output_path)
        return output_path.exists()

    import threading

    ffmpeg      = _ffmpeg_path()
    vid_w, vid_h = _get_video_dims(video_path)
    fps          = _get_video_fps(video_path)
    duration     = _get_video_duration(video_path)
    total_frames = int(fps * duration) + 5

    blocks = _parse_srt(srt_path.read_text(encoding="utf-8"))
    frame_to_text: dict[int, str] = {}
    for block in blocks:
        parts = block["timecode"].split(" --> ")
        if len(parts) != 2:
            continue
        def _ts(ts: str) -> float:
            ts = ts.strip().replace(",", ".")
            h, m, s = ts.split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
        start_f = int(_ts(parts[0]) * fps)
        end_f   = int(_ts(parts[1]) * fps)
        text = block["text"].replace("\n", " ").strip()
        if text:
            for f in range(start_f, min(end_f, total_frames)):
                frame_to_text[f] = text

    if not frame_to_text:
        import shutil
        shutil.copy2(video_path, output_path)
        return output_path.exists()

    # Police Unicode (macOS + Linux / Railway Debian/Ubuntu)
    font_candidates = [
        # macOS
        "/System/Library/Fonts/Supplemental/Arial Unicode MS.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        # Linux (Debian/Ubuntu — paquets fonts-liberation, fonts-dejavu, fonts-noto)
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        # Chemins alternatifs Linux
        "/usr/share/fonts/noto/NotoSans-Regular.ttf",
        "/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf",
        "/usr/share/fonts/truetype/msttcorefonts/Arial.ttf",
    ]
    font_file = next((p for p in font_candidates if os.path.isfile(p)), None)
    if font_file:
        print(f"[pillow] 🔤 Police Unicode : {font_file}")
    else:
        print("[pillow] ⚠️  Aucune police TTF trouvée — fallback bitmap 8px (accents limités)")
    fontsize = max(24, int(vid_h * 0.05))

    def _load_font(fs: int):
        if font_file:
            try:
                return ImageFont.truetype(font_file, fs)
            except Exception:
                pass
        try:
            return ImageFont.load_default(size=fs)
        except TypeError:
            return ImageFont.load_default()

    font         = _load_font(fontsize)
    pad_h        = 16
    pad_v        = 10
    margin_bot   = int(vid_h * 0.05)
    max_w        = int(vid_w * 0.80)
    TRANSPARENT  = bytes(vid_w * vid_h * 4)
    text_bytes: dict[str, bytes] = {}

    _mimg  = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    _mdraw = ImageDraw.Draw(_mimg)

    unique_texts = set(frame_to_text.values())
    for text in unique_texts:
        # Wrap simple par caractère
        import textwrap as _tw
        wrapped_lines = _tw.wrap(text, width=max(20, int(max_w / (fontsize * 0.55))))
        if not wrapped_lines:
            wrapped_lines = [text]

        img  = Image.new("RGBA", (vid_w, vid_h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)

        line_sizes = [draw.textbbox((0, 0), l, font=font) for l in wrapped_lines]
        line_widths  = [b[2] - b[0] for b in line_sizes]
        line_heights = [b[3] - b[1] for b in line_sizes]
        line_gap     = max(4, int(fontsize * 0.12))
        total_h      = sum(line_heights) + line_gap * (len(wrapped_lines) - 1)
        box_w        = min(max(line_widths) + pad_h * 2, vid_w - 10)
        box_h        = total_h + pad_v * 2
        x            = (vid_w - box_w) // 2
        y            = vid_h - box_h - margin_bot

        draw.rectangle([x, y, x + box_w, y + box_h], fill=(0, 0, 0, 230))

        cur_y = y + pad_v
        for line, lw, lh in zip(wrapped_lines, line_widths, line_heights):
            tx = x + (box_w - lw) // 2
            draw.text((tx, cur_y), line, fill=(255, 255, 255, 255), font=font)
            cur_y += lh + line_gap

        text_bytes[text] = img.tobytes()

    print(f"[pillow] 🖼️  {len(unique_texts)} sous-titres, {total_frames} frames @ {fps:.1f}fps ({vid_w}x{vid_h})")

    cmd = [
        ffmpeg, "-y",
        "-f", "rawvideo", "-vcodec", "rawvideo",
        "-s", f"{vid_w}x{vid_h}", "-pix_fmt", "rgba", "-r", str(fps),
        "-i", "pipe:0",
        "-i", str(video_path),
    ]
    if wm_path and wm_path.exists():
        cmd += ["-i", str(wm_path)]
        filter_complex = (
            "[1:v][2:v]overlay=0:0:format=auto,format=yuv420p[wm];"
            "[wm][0:v]overlay=0:0:format=auto[v]"
        )
    else:
        filter_complex = "[1:v][0:v]overlay=0:0:format=auto[v]"

    cmd += [
        "-filter_complex", filter_complex,
        "-map", "[v]", "-map", "1:a?",
        "-c:v", "libx264", "-crf", "23", "-preset", "ultrafast", "-threads", "0",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        str(output_path),
    ]

    try:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE,
                                cwd=str(video_path.parent))
        stderr_buf: list[bytes] = []

        def _drain():
            try:
                while True:
                    chunk = proc.stderr.read1(4096)  # type: ignore
                    if not chunk:
                        break
                    stderr_buf.append(chunk)
            except Exception:
                pass

        def _write_stdin():
            try:
                for fn in range(total_frames):
                    txt = frame_to_text.get(fn)
                    proc.stdin.write(text_bytes[txt] if txt else TRANSPARENT)  # type: ignore
            except (BrokenPipeError, OSError):
                pass
            finally:
                try:
                    proc.stdin.close()  # type: ignore
                except Exception:
                    pass

        t_drain  = threading.Thread(target=_drain,       daemon=True)
        t_writer = threading.Thread(target=_write_stdin, daemon=True)
        t_drain.start()
        t_writer.start()

        # Timeout dynamique : au moins 5 min, ou 2x la durée de la vidéo
        multiplier = float(os.environ.get("PILLOW_TIMEOUT_MULTIPLIER", "2.0"))
        writer_timeout = max(300, int(duration * multiplier))
        print(f"[pillow] ⏳ Writer timeout défini à {writer_timeout}s (vidéo = {duration:.1f}s)")

        t_writer.join(timeout=writer_timeout)
        if t_writer.is_alive():
            proc.kill()
            print(f"[pillow] ⏱️  Timeout stdin après {writer_timeout}s → process killed")
            return False
        t_drain.join(timeout=30)
        proc.wait(timeout=max(120, int(duration * 1.5)))

        if proc.returncode == 0 and output_path.exists() and output_path.stat().st_size > 0:
            mode = "pillow+WM" if (wm_path and wm_path.exists()) else "pillow"
            print(f"[pillow] ✅ {output_path.name} [{mode}] ({output_path.stat().st_size // 1024} KB)")
            return True

        err = b"".join(stderr_buf).decode("utf-8", errors="replace")
        print(f"[pillow] ❌ returncode={proc.returncode}\n{err[-400:]}")
        return False

    except Exception as e:
        print(f"[pillow] ❌ Erreur : {e}")
        return False


# ─── Burn sous-titres — 1 passe (conf-map approach) ─────────────────────────

def _burn_subtitles(
    video_path:  Path,
    srt_path:    Path,
    output_path: Path,
    wm_path:     Optional[Path] = None,
) -> bool:
    """
    Incrustation sous-titres + watermark.

    Stratégie auto-détectée (même logique que conflict-map) :
      Mode A — libass disponible :
        → copie SRT/ASS dans video.parent, utilise ass=filename=X.ass (relatif)
          + cwd=video.parent → évite tous les problèmes de parsing de chemin
      Mode B — drawtext disponible mais pas libass :
        → watermark seul (SRT abandonné, sous-titres trop complexes sans libass)
      Mode C — ni l'un ni l'autre → Pillow rawvideo pipe (toujours fonctionnel)
    """
    import shutil
    ffmpeg = _ffmpeg_path()

    # Copier le SRT dans le même dossier que la vidéo (OBLIGATOIRE pour libass)
    srt_local = video_path.parent / srt_path.name
    if srt_local != srt_path:
        shutil.copy2(srt_path, srt_local)

    libass_ok   = _LIBASS_OK
    drawtext_ok = _DRAWTEXT_OK

    # ── Mode C direct si aucun filtre texte dispo ──────────────────────────
    if not libass_ok and not drawtext_ok:
        print("[burn] ℹ️  libass absent, drawtext absent → Pillow rawvideo pipe")
        if srt_local != srt_path:
            srt_local.unlink(missing_ok=True)
        return _burn_subtitles_pillow(video_path, srt_path, output_path, wm_path)

    mode_tag = "?"
    cmd: list[str]

    if libass_ok:
        # ── Mode A : ASS natif — chemin relatif + cwd ─────────────────────
        vid_w, vid_h = _get_video_dims(video_path)
        ass_content  = _srt_to_ass(srt_path.read_text(encoding="utf-8"), vid_w, vid_h)
        ass_local    = video_path.parent / (srt_path.stem + ".ass")
        ass_local.write_text(ass_content, encoding="utf-8")

        if srt_local != srt_path:
            srt_local.unlink(missing_ok=True)   # ASS prend le relais, SRT nettoyé

        print(f"[burn] ✍️  ASS ({len(ass_content)} chars, {vid_w}×{vid_h}) → {ass_local.name}")

        if wm_path and wm_path.exists():
            filter_complex = (
                f"[0:v]ass=filename={ass_local.name}[s];"
                f"[s][1:v]overlay=0:0:format=auto,format=yuv420p[v]"
            )
            cmd = [
                ffmpeg, "-y", "-nostdin",
                "-i", str(video_path), "-i", str(wm_path),
                "-filter_complex", filter_complex,
                "-map", "[v]", "-map", "0:a?",
                "-c:v", "libx264", "-crf", "18", "-preset", "fast",
                "-c:a", "copy", "-movflags", "+faststart",
                str(output_path),
            ]
        else:
            cmd = [
                ffmpeg, "-y", "-nostdin", "-i", str(video_path),
                "-vf", f"ass=filename={ass_local.name},format=yuv420p",
                "-c:v", "libx264", "-crf", "18", "-preset", "fast",
                "-c:a", "copy", "-movflags", "+faststart",
                str(output_path),
            ]
        mode_tag = "ass+WM" if (wm_path and wm_path.exists()) else "ass"

    else:
        # ── Mode B : drawtext dispo mais pas libass → watermark seul ────────
        print("[burn] ℹ️  libass absent, drawtext OK → watermark seul (sous-titres abandonnés)")
        if srt_local != srt_path:
            srt_local.unlink(missing_ok=True)

        if wm_path and wm_path.exists():
            cmd = [
                ffmpeg, "-y", "-nostdin",
                "-i", str(video_path), "-i", str(wm_path),
                "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]",
                "-map", "[v]", "-map", "0:a?",
                "-c:v", "libx264", "-crf", "18", "-preset", "fast",
                "-c:a", "copy", "-movflags", "+faststart",
                str(output_path),
            ]
            mode_tag = "wm-only"
        else:
            shutil.copy2(video_path, output_path)
            return output_path.exists() and output_path.stat().st_size > 0

    # ── Exécution FFmpeg ───────────────────────────────────────────────────
    _vid_dur = _get_video_duration(video_path)
    _timeout = max(120, int(_vid_dur * 8))
    print(f"[burn] ⏱  Timeout dynamique : {_timeout}s")

    try:
        result = subprocess.run(
            cmd,
            capture_output=True, text=True,
            timeout=_timeout,
            cwd=str(video_path.parent),   # ← clé : résolution des chemins relatifs
        )

        # Nettoyage fichiers locaux
        if libass_ok:
            ass_local.unlink(missing_ok=True)

        if result.returncode == 0 and output_path.exists() and output_path.stat().st_size > 0:
            print(f"[burn] ✅ {output_path.name} [{mode_tag}] ({output_path.stat().st_size // 1024} KB)")
            return True

        print(f"[burn] ❌ FFmpeg code={result.returncode}")
        if result.stderr:
            print(f"[burn] stderr: {result.stderr[-600:]}")

        # Fallback Pillow si libass a échoué (RTL, codec exotique, etc.)
        if libass_ok:
            print("[burn] ⚠️  Mode A échoué → fallback Pillow rawvideo pipe")
            return _burn_subtitles_pillow(video_path, srt_path, output_path, wm_path)
        return False

    except subprocess.TimeoutExpired:
        print(f"[burn] ⏱️  Timeout (>{_timeout}s) → fallback Pillow")
        if libass_ok:
            return _burn_subtitles_pillow(video_path, srt_path, output_path, wm_path)
        return False
    except FileNotFoundError:
        print("[burn] ❌ ffmpeg introuvable")
        return False
    except Exception as e:
        print(f"[burn] ❌ Exception : {e}")
        if libass_ok:
            return _burn_subtitles_pillow(video_path, srt_path, output_path, wm_path)
        return False


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

        # ── Options cookies anti-bot YouTube ──────────────────────────────────
        # Priorité : 1) fichier cookies.txt  2) navigateur (dev local)  3) rien
        ydl_opts: dict = {
            # Format ultra-permissif : couvre Shorts, vidéos normales, MP4/WebM
            "format":               "bestvideo+bestaudio/best",
            "merge_output_format":  "mp4",
            "outtmpl":              str(workdir / "source.%(ext)s"),
            "quiet":                True,
            "no_warnings":          True,
            # Limiter la résolution max sans refuser la vidéo si non dispo
            "format_sort":          ["res:720", "ext:mp4:m4a"],
            # Télécharge le script de résolution du n-challenge YouTube depuis GitHub
            # (requis depuis yt-dlp 2026.03+ avec Deno comme runtime JS par défaut)
            "remote_components":    "ejs:github",
        }

        # 1. Fichier cookies.txt (prod Railway / env variable YTDLP_COOKIES_FILE)
        cookies_file = os.environ.get(
            "YTDLP_COOKIES_FILE",
            str(Path(__file__).parent.parent / "cookies.txt"),
        )
        if os.path.isfile(cookies_file):
            ydl_opts["cookiefile"] = cookies_file
            print(f"[pipeline] 🍪 Cookies depuis fichier : {cookies_file}")
        else:
            # 2. Cookies depuis navigateur (dev local uniquement)
            for browser in ("chrome", "firefox", "safari", "edge"):
                try:
                    yt_dlp.cookies.load_cookies_from_browser(browser)
                    ydl_opts["cookiesfrombrowser"] = (browser, None, None, None)
                    print(f"[pipeline] 🍪 Cookies depuis navigateur : {browser}")
                    break
                except Exception:
                    continue

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

        # Passe le Path directement → streaming par chunks, pas de chargement RAM
        upload_result = await upload_video(
            job_id, final_mp4, filename=upload_filename
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
