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
from core.utils import format_duration_human


# ─── Helpers Cookies ──────────────────────────────────────────────────────────

def _is_valid_cookies_file(cookies_path: str) -> bool:
    """
    Valide le fichier cookies.txt.
    Retourne True si le fichier existe, n'est pas vide, 
    a le format Netscape et contient au moins auth_token ou ct0.
    """
    import os
    import time
    
    if not os.path.exists(cookies_path):
        return False
    
    size = os.path.getsize(cookies_path)
    if size == 0:
        print(f"[cookies] ❌ Fichier vide: {size} octets")
        return False
    
    try:
        with open(cookies_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
        
        if not lines:
            print("[cookies] ❌ Fichier sans lignes")
            return False
        
        # Vérifier le format Netscape
        first_line = lines[0].strip()
        if not first_line.startswith("# Netscape HTTP Cookie File"):
            print(f"[cookies] ❌ Format Netscape non détecté: {first_line[:50]}...")
            return False
        
        # Vérifier la présence de cookies essentiels pour X/Twitter
        has_auth_token = any("auth_token" in line for line in lines)
        has_ct0 = any("ct0" in line for line in lines)
        
        # Vérifier l'expiration des cookies
        current_time = int(time.time())
        for line in lines:
            if line.strip().startswith("#") or "\t" not in line:
                continue
            parts = line.strip().split("\t")
            if len(parts) >= 5:
                try:
                    expiry = int(parts[4])
                    if expiry != 0 and expiry < current_time:
                        print(f"[cookies] ⚠️  Cookie expiré: {parts[5] if len(parts) > 5 else 'unknown'}")
                except ValueError:
                    pass
        
        if not has_auth_token and not has_ct0:
            print("[cookies] ⚠️  Aucun cookie X/Twitter (auth_token/ct0) trouvé")
            # On accepte quand même car certains sites n'ont pas besoin de ces cookies
        
        print(f"[cookies] ✅ Fichier valide: {size} octets, {len(lines)} lignes, auth_token={has_auth_token}, ct0={has_ct0}")
        return True
        
    except Exception as e:
        print(f"[cookies] ❌ Erreur validation: {e}")
        return False


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


def _get_ffmpeg_encoding_options() -> list[str]:
    """
    Options video FFmpeg optimisees pour lecture fluide sur web (HTML5 <video>).
    Sweet spot 2026 : keyframe toutes les ~2s a 30 fps.
    """
    return [
        "-c:v", "libx264",
        "-preset", "fast",            # plus rapide que medium, meilleure fluidité
        "-crf", "20",                 # meilleure qualité (23 → 20), réduit les artefacts
        "-g", "60",                   # keyframe toutes les ~2 secondes (30 fps)
        "-keyint_min", "30",          # permet des keyframes plus frequents si besoin
        "-sc_threshold", "0",         # GOP regulier
        "-bf", "2",                   # 2 B-frames (recommande YouTube/FFmpeg)
        "-profile:v", "high",         # high = meilleure qualite (compatible 2026)
        "-level", "4.2",              # safe pour 1080p+
        "-movflags", "+faststart",    # indispensable pour streaming web
        "-muxdelay", "0",
        "-pix_fmt", "yuv420p",
        "-threads", "0",
    ]


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


def _shift_srt_timing(srt_content: str, offset_ms: int) -> str:
    """
    Décale tous les timestamps d'un SRT de `offset_ms` millisecondes.
    Utile pour éviter l'affichage trop tôt des sous-titres (typiquement +200ms).
    """
    if not srt_content.strip() or offset_ms == 0:
        return srt_content
    
    offset_s = offset_ms / 1000.0  # millisecondes → secondes
    blocks = _parse_srt(srt_content)
    
    shifted_blocks = []
    for block in blocks:
        try:
            # Parse "00:00:01,000 --> 00:00:03,500"
            start_str, end_str = block["timecode"].split(" --> ")
            
            # Convertir en secondes
            start_s = _parse_time_to_seconds(start_str)
            end_s = _parse_time_to_seconds(end_str)
            
            # Appliquer le décalage
            start_s += offset_s
            end_s += offset_s
            
            # Assurer des timestamps valides (positifs)
            start_s = max(0.0, start_s)
            end_s = max(0.0, end_s)
            
            # Réassigner le timecode
            block = block.copy()
            block["timecode"] = f"{_to_srt_time(start_s)} --> {_to_srt_time(end_s)}"
            shifted_blocks.append(block)
        except Exception:
            # En cas d'erreur de parsing, garder le bloc original
            shifted_blocks.append(block)
    
    return _write_srt(shifted_blocks)


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


def _adjust_duration_based_on_text(
    start_seconds: float,
    end_seconds: float,
    text_length: int,
    min_chars_per_second: float = 17.0,
    min_duration: float = 1.2,
) -> tuple[float, float]:
    """
    Ajuste la durée d'affichage en fonction de la longueur du texte.
    
    Règle approximative : ~15-20 caractères par seconde (standard sous-titrage).
    Si la durée actuelle est trop courte pour lire le texte, on l'allonge.
    """
    required_duration = max(min_duration, text_length / min_chars_per_second)
    current_duration = end_seconds - start_seconds
    
    if current_duration < required_duration:
        # Ajoute un peu de marge pour le confort de lecture
        end_seconds = start_seconds + required_duration + 0.2
    
    return start_seconds, end_seconds


def _parse_time_to_seconds(ts: str) -> float:
    """Convertit un timestamp SRT (00:00:01,000) en secondes."""
    ts = ts.strip().replace(",", ".")
    h, m, s_ms = ts.split(":")
    s, ms = s_ms.split(".")
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0


def _srt_to_ass(srt_content: str, vid_w: int = 1280, vid_h: int = 720, user_style: dict | None = None) -> str:
    """
    Version améliorée utilisant subtitle_config.py pour une adaptation automatique.
    """
    import os
    import textwrap
    import re
    
    # Importer notre nouvelle configuration
    from core.subtitle_config import SubtitleConfig, load_user_style_from_json
    
    # Convertir user_style si c'est une chaîne JSON
    style_dict = None
    if isinstance(user_style, str):
        style_dict = load_user_style_from_json(user_style)
    elif isinstance(user_style, dict):
        style_dict = user_style
    
    # Créer la configuration adaptative
    config = SubtitleConfig(vid_w, vid_h, style_dict)
    
    # FORCER fond noir opaque à 100% pour les traductions si non spécifié
    if not style_dict or "background_opacity" not in style_dict:
        config.defaults["default_opacity"] = 100
    
    font_size = config.calculate_font_size()
    max_chars_per_line = config.calculate_max_chars_per_line()
    margin_lr, margin_r, margin_v = config.calculate_margins()
    
    print(f"[ass] Video {vid_w}x{vid_h} -> {'VERTICAL' if config.is_vertical else 'HORIZONTAL'} | "
          f"font={font_size}px | max_chars={max_chars_per_line} | margins=({margin_lr},{margin_v})")
    
    # ====================== HEADER ASS ======================
    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {vid_w}\n"
        f"PlayResY: {vid_h}\n"
        "WrapStyle: 0\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"{config.to_ass_style()}\n"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )

    # ====================== SMART WRAP ======================
    def smart_wrap(text: str, max_chars: int) -> str:
        text = text.replace("\n", " ").strip()
        if len(text) <= max_chars * 1.7:
            return textwrap.fill(text, max_chars)
        
        sentences = re.split(r'([.!?])\s+', text)
        lines = []
        current = ""
        for i in range(0, len(sentences), 2):
            part = (sentences[i] + (sentences[i+1] if i+1 < len(sentences) else "")).strip()
            if current and len(current + " " + part) > max_chars:
                lines.append(current)
                current = part
            else:
                current = (current + " " + part).strip()
        if current:
            lines.append(current)
        
        if len(lines) > 2:
            lines = lines[:2]
            lines[1] = lines[1][:max_chars-3] + "…"
        
        return "\n".join(lines)

    # ====================== CONVERSION ======================
    blocks = _parse_srt(srt_content)
    event_lines = []

    for b in blocks:
        try:
            parts = b["timecode"].split(" --> ")
            t_start = _srt_time_to_ass(parts[0])
            t_end = _srt_time_to_ass(parts[1])
            
            raw = b["text"].replace("\n", " ").strip()
            wrapped = smart_wrap(raw, max_chars_per_line)
            ass_text = wrapped.replace("\n", "\\N")
            
            # FORCER FOND NOIR OPAQUE À 100% - Version corrigée
            # Format ASS: {\pos(x,y)\bord0\shad0\c&HFFFFFF&\3c&H000000&\4c&HFF000000&}texte
            # \4c&HFF000000& = couleur de fond noir opaque (FF = 100% opaque)
            # \bord0 = pas de bordure
            # \shad0 = pas d'ombre
            # \c&HFFFFFF& = texte blanc
            # \3c&H000000& = contour noir
            # Ajouter aussi \alpha&HFF& pour forcer l'opacité du texte
            ass_text = f"{{\\bord0\\shad0\\c&HFFFFFF&\\3c&H000000&\\4c&HFF000000&\\alpha&HFF&}}{ass_text}"

            event_lines.append(
                f"Dialogue: 0,{t_start},{t_end},Default,,0,0,0,,{ass_text}"
            )
        except Exception:
            continue

    return header + "\n".join(event_lines) + "\n"

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
    import os

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
    
    # Détection verticale cohérente avec _srt_to_ass
    is_vertical = vid_h > vid_w * 1.4
    
    # Utiliser les mêmes paramètres que subtitle_config.py
    # avec des valeurs plus conservatrices pour éviter le débordement
    if is_vertical:
        # Pour vertical: basé sur la largeur mais avec un facteur plus petit
        # car la largeur est limitée (ex: 720px)
        base_size = int(vid_w * 0.055)  # Réduit de 0.065 à 0.055 (5.5%)
        fontsize = max(28, min(base_size, 40))  # Bornes: 28-40px
    else:
        # Pour horizontal: basé sur la hauteur
        base_size = int(vid_h * 0.035)  # Réduit de 0.045 à 0.035 (3.5%)
        fontsize = max(22, min(base_size, 35))  # Bornes: 22-35px
    
    orientation = "VERTICAL" if is_vertical else "HORIZONTAL"
    print(f"[pillow] Video {vid_w}x{vid_h} -> {orientation} | fontsize={fontsize} (base: {base_size}px)")

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
    pad_h        = 20
    pad_v        = 12
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

        # Calcul de l'opacité depuis SUBTITLE_OPACITY (0-100%) → alpha (0-255)
        opacity_str = os.environ.get("SUBTITLE_OPACITY", "95")
        try:
            opacity = int(opacity_str.split("#")[0].strip())  # Enlève les commentaires
            opacity = max(0, min(100, opacity))
            alpha = int(opacity * 255 / 100)
        except ValueError:
            alpha = 230  # fallback 90% opaque
        
        draw.rectangle([x, y, x + box_w, y + box_h], fill=(0, 0, 0, alpha))

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
    # Scale conditionnel : seulement si vidéo > 1920x1080
    scale_filter = ""
    vid_w, vid_h = _get_video_dims(video_path)
    if vid_w > 1920 or vid_h > 1080:
        scale_filter = ",scale=1280:-2"
        print(f"[pillow] 🔍 Vidéo {vid_w}x{vid_h} > 1920x1080 → scale activé")
    else:
        print(f"[pillow] 🔍 Vidéo {vid_w}x{vid_h} ≤ 1920x1080 → pas de scale")

    if wm_path and wm_path.exists():
        cmd += ["-i", str(wm_path)]
        filter_complex = (
            f"[1:v][2:v]overlay=0:0:format=auto,format=yuv420p[wm];"
            f"[wm][0:v]overlay=0:0:format=auto{scale_filter}[v]"
        )
    else:
        filter_complex = f"[1:v][0:v]overlay=0:0:format=auto{scale_filter}[v]"

    cmd += [
        "-filter_complex", filter_complex,
        "-map", "[v]", "-map", "1:a?",
        * _get_ffmpeg_encoding_options(),
        "-c:a", "copy",  # Copier l'audio original au lieu de re-encoder
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
                # Envoyer les frames par groupes de 1000 pour éviter le buffer overflow
                for i in range(0, total_frames, 1000):
                    chunk_frames = range(i, min(i + 1000, total_frames))
                    for fn in chunk_frames:
                        txt = frame_to_text.get(fn)
                        proc.stdin.write(text_bytes[txt] if txt else TRANSPARENT)  # type: ignore
                    # Vidage régulier du buffer après chaque groupe
                    proc.stdin.flush()
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

        # Timeout dynamique : au moins 5 min, ou 4x la durée de la vidéo + marge
        # Pour les vidéos longues (>2min), le burn peut prendre 3-4x la durée
        multiplier = float(os.environ.get("PILLOW_TIMEOUT_MULTIPLIER", "4.0"))
        base_timeout = int(duration * multiplier)
        # Ajouter une marge fixe de 120s pour les opérations I/O et buffering
        writer_timeout = max(300, base_timeout + 120)
        hum_writer = format_duration_human(writer_timeout)
        hum_duration = format_duration_human(duration)
        print(f"[pillow] ⏳ Writer timeout défini à {hum_writer} (vidéo = {hum_duration}, multiplier={multiplier}x)")

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
    
    FORCÉ EN MODE PILLOW POUR GARANTIR L'OPACITÉ À 100%
    (libass/FFmpeg ignore les codes d'opacité ASS)
    """
    import shutil
    import os
    
    # Copier le SRT dans le même dossier que la vidéo
    srt_local = video_path.parent / srt_path.name
    if srt_local != srt_path:
        shutil.copy2(srt_path, srt_local)

    print("[burn] ⚡ FORCÉ MODE PILLOW pour garantir fond noir opaque à 100%")
    if srt_local != srt_path:
        srt_local.unlink(missing_ok=True)
    
    # FORCER l'opacité à 100% via variable d'environnement
    os.environ["SUBTITLE_OPACITY"] = "100"
    
    return _burn_subtitles_pillow(video_path, srt_path, output_path, wm_path)


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
    from core.watermark import _generate_watermark_png

    # OpenRouter uniquement (plus de LLM local)
    OPENROUTER_AVAILABLE = False
    openrouter_generate_summary = None
    openrouter_translate_srt = None
    openrouter_translate_srt_chunked = None
    
    try:
        from core.openrouter import generate_summary as openrouter_generate_summary
        from core.openrouter import translate_srt as openrouter_translate_srt
        from core.openrouter import translate_srt_chunked as openrouter_translate_srt_chunked
        OPENROUTER_AVAILABLE = True
    except ImportError:
        pass  # OpenRouter non disponible, on continue sans LLM

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
        # Priorité : 1) navigateur (frais)  2) fichier cookies.txt  3) rien
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
            # User-Agent moderne pour éviter les blocages
            "http_headers":         {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"},
        }

        # 1. Cookies depuis navigateur (frais, dev local uniquement)
        browser_used = False
        for browser in ("chrome", "firefox", "safari", "edge"):
            try:
                yt_dlp.cookies.load_cookies_from_browser(browser)
                ydl_opts["cookiesfrombrowser"] = (browser, None, None, None)
                print(f"[pipeline] 🍪 Cookies depuis navigateur : {browser}")
                browser_used = True
                break
            except Exception:
                continue
        
        # 2. Fallback : fichier cookies.txt (prod Railway / env variable YTDLP_COOKIES_FILE)
        if not browser_used:
            cookies_file = os.environ.get(
                "YTDLP_COOKIES_FILE",
                str(Path(__file__).parent.parent / "cookies.txt"),
            )
            if os.path.isfile(cookies_file) and _is_valid_cookies_file(cookies_file):
                ydl_opts["cookiefile"] = cookies_file
                print(f"[pipeline] 🍪 Cookies depuis fichier valide : {cookies_file}")
            else:
                if os.path.isfile(cookies_file):
                    print(f"[pipeline] ⚠️  Fichier cookies.txt invalide ou vide : {cookies_file}")
                else:
                    print("[pipeline] ⚠️  Aucun cookie disponible — téléchargement public uniquement")

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(source_url, download=True)
                thumbnail_url = info.get("thumbnail") if info else None
            if thumbnail_url:
                print(f"[pipeline] 🖼  Thumbnail extrait : {thumbnail_url[:80]}…")
        except yt_dlp.utils.DownloadError as e:
            # Détecter les erreurs spécifiques à X/Twitter
            error_msg = str(e).lower()
            source_lower = source_url.lower()
            
            if "twitter" in source_lower or "x.com" in source_lower:
                if "internal server error" in error_msg:
                    raise RuntimeError(
                        "Échec de téléchargement X (Twitter) : erreur serveur interne. "
                        "L'API GraphQL de X peut être temporairement indisponible. "
                        "Vos cookies peuvent être expirés — veuillez rafraîchir le fichier cookies.txt "
                        "avec une session X authentifiée et réessayer."
                    ) from e
                
                if "429" in error_msg or "too many requests" in error_msg:
                    raise RuntimeError(
                        "Trop de requêtes vers X (Twitter) — limitation de taux. "
                        "Veuillez attendre quelques minutes avant de réessayer."
                    ) from e
                
                if "no video could be found" in error_msg:
                    # Vérifier si le tweet existe via l'API GraphQL
                    # Si le tweet n'existe pas ou n'a pas de vidéo, on ne retry pas
                    # On marque le job comme échoué avec un message clair
                    raise RuntimeError(
                        "Le tweet ne contient pas de vidéo téléchargeable. "
                        "Assurez-vous que le tweet existe et contient bien une vidéo. "
                        "ID du tweet: " + str(e).split(":")[1].split(":")[0].strip()
                    ) from e
                
                if "rate limit" in error_msg or "limit" in error_msg:
                    raise RuntimeError(
                        "Limite de téléchargement X (Twitter) atteinte. "
                        "Les cookies X sont peut-être expirés ou les crédits API insuffisants. "
                        "Veuillez rafraîchir les cookies et réessayer plus tard."
                    ) from e
                
                # Erreur générique pour Twitter
                raise RuntimeError(
                    f"Échec de téléchargement X/Twitter : {error_msg[:150]}"
                ) from e
            
            # Autres sites
            raise RuntimeError(f"Erreur de téléchargement yt-dlp : {error_msg[:200]}") from e
        except Exception as e:
            raise RuntimeError(f"Erreur inattendue lors du téléchargement : {e}") from e

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
                # OpenRouter uniquement
                if OPENROUTER_AVAILABLE and openrouter_generate_summary:
                    summary = await openrouter_generate_summary(transcript_tx, target_lang)
                    if summary:
                        print(f"[pipeline] 📝 Résumé généré via OpenRouter ({len(summary)} caractères)")
                else:
                    print("[pipeline] ⚠️  OpenRouter non disponible — skip résumé")
            except Exception as e:
                print(f"[pipeline] ⚠️  Résumé ignoré : {e}")

        await _set_status("translating", summary=summary, source_lang=source_lang)

        # ── 5. Traduction SRT ─────────────────────────────────────────────────
        if not _no_audio and source_srt.exists() and source_srt.stat().st_size > 0:
            srt_content = source_srt.read_text(encoding="utf-8")
            if source_lang != target_lang:
                # OpenRouter uniquement
                translated_srt_content = None
                
                # Décision : utiliser chunking pour vidéos longues ou SRT volumineux
                use_chunking = False
                srt_char_count = len(srt_content)
                srt_block_count = len(_parse_srt(srt_content))
                
                # Vidéo longue (>5 min) ou SRT > 6000 caractères → chunking
                if video_type == "long" or srt_char_count > 6000:
                    use_chunking = True
                    print(f"[pipeline] 📦 Chunking décidé (video_type={video_type}, {srt_char_count} chars, {srt_block_count} blocs)")
                
                if OPENROUTER_AVAILABLE:
                    try:
                        if use_chunking and openrouter_translate_srt_chunked:
                            translated_srt_content = await openrouter_translate_srt_chunked(
                                srt_content, source_lang, target_lang,
                                context={"src_lang": source_lang},
                                max_chars_per_chunk=6000,
                                max_blocks_per_chunk=50,
                            )
                            print(f"[pipeline] ✅ Traduction SRT chunked via OpenRouter ({len(translated_srt_content)} caractères)")
                        elif openrouter_translate_srt:
                            translated_srt_content = await openrouter_translate_srt(
                                srt_content, source_lang, target_lang,
                                context={"src_lang": source_lang},
                            )
                            print(f"[pipeline] ✅ Traduction SRT via OpenRouter ({len(translated_srt_content)} caractères)")
                    except Exception as e:
                        print(f"[pipeline] ⚠️  Traduction OpenRouter échouée : {e}")
                        translated_srt_content = None
                
                if not translated_srt_content:
                    print("[pipeline] ⚠️  Traduction non disponible — garde SRT original")
                    translated_srt_content = srt_content
            else:
                translated_srt_content = srt_content

            # Supprimer le décalage de 200ms - garder les timestamps originaux
            # offset_ms = int(os.environ.get("SRT_TIMING_OFFSET_MS", "200"))
            # if offset_ms:
            #     translated_srt_content = _shift_srt_timing(translated_srt_content, offset_ms)
            #     print(f"[pipeline] ⏰ Timing SRT décalé de +{offset_ms}ms")

            translated_srt.write_text(translated_srt_content, encoding="utf-8")

            # Sauvegarder les segments traduits dans la base de données
            try:
                from core.db import direct_connect
                import json
                
                # Parser le SRT traduit
                blocks_translated = _parse_srt(translated_srt_content)
                # Parser le SRT original pour le texte original
                blocks_original = _parse_srt(srt_content)
                
                # Synchroniser les blocs (même nombre, même timing)
                if len(blocks_translated) == len(blocks_original):
                    async with direct_connect() as conn:
                        for i, (orig, trans) in enumerate(zip(blocks_original, blocks_translated)):
                            # Extraire les timestamps et les convertir en secondes
                            timecode = orig["timecode"]
                            start_str, end_str = timecode.split(" --> ")
                            
                            def parse_time_to_sec(timestr: str) -> float:
                                h, m, s_ms = timestr.strip().split(":")
                                s, ms = s_ms.split(",")
                                return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0
                            
                            start_sec = parse_time_to_sec(start_str)
                            end_sec = parse_time_to_sec(end_str)
                            
                            # Convertir le style en string JSON pour asyncpg
                            style_json = json.dumps({
                                "color": "#ffffff", 
                                "fontSize": 24, 
                                "fontFamily": "Arial, sans-serif"
                            })
                            
                            # Insérer dans la base de données
                            await conn.execute(
                                """
                                INSERT INTO transcription_segments 
                                (job_id, start_time, end_time, original_text, translated_text, style)
                                VALUES ($1, $2, $3, $4, $5, $6::jsonb)
                                ON CONFLICT DO NOTHING
                                """,
                                jid,
                                start_sec,
                                end_sec,
                                orig["text"].strip(),
                                trans["text"].strip(),
                                style_json
                            )
                    
                    print(f"[pipeline] 💾 {len(blocks_translated)} segments sauvegardés dans la base de données")
                else:
                    print(f"[pipeline] ⚠️  Nombre de blocs différent (original: {len(blocks_original)}, traduit: {len(blocks_translated)}) - skip sauvegarde")
            except Exception as e:
                print(f"[pipeline] ⚠️  Échec sauvegarde segments: {e}")
                # Ne pas bloquer le pipeline si la sauvegarde échoue

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
                    "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p,scale=1280:-2[out]",  # ← scale intégré ici
                    "-map", "[out]", "-map", "0:a:0?",
                    * _get_ffmpeg_encoding_options(),
                    "-c:a", "aac",
                    "-b:a", "128k",
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
            storage_url = str(final_mp4)  # chemin absolu sans scheme file://
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