"""
core/watermark.py — Filigrane vidéo + photo — x-translator-mvp
Copié depuis conflict-map/backend/core/watermark.py
Watermark par défaut : "spottedyou.org"

Dépendances : Pillow, ffmpeg, ffprobe
"""
from __future__ import annotations

import io
import os
import subprocess
import tempfile
from typing import Optional

from core.config import settings

# ── Polices système (ordre de priorité) ──────────────────────────────────────
_FONT_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/ubuntu/Ubuntu-Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
]


def _get_font_path() -> Optional[str]:
    for fp in _FONT_PATHS:
        if os.path.isfile(fp):
            return fp
    return None


def _build_tile(
    text: str,
    font_size: int,
    opacity: int,
) -> "PIL.Image.Image":
    from PIL import Image, ImageDraw, ImageFont

    FILL_COLOR   = (255, 255, 255, opacity)
    STROKE_COLOR = (0, 0, 0, max(0, opacity - 25))
    TILE_W, TILE_H = 500, 110

    font_path = _get_font_path()
    try:
        font = ImageFont.truetype(font_path, font_size) if font_path else ImageFont.load_default()
    except Exception:
        font = ImageFont.load_default()

    tile = Image.new("RGBA", (TILE_W, TILE_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tile)

    try:
        bbox   = draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
    except AttributeError:
        text_w, text_h = draw.textsize(text, font=font)

    tx = (TILE_W - text_w) // 2
    ty = (TILE_H - text_h) // 2

    try:
        draw.text((tx, ty), text, font=font, fill=FILL_COLOR, stroke_width=1, stroke_fill=STROKE_COLOR)
    except TypeError:
        draw.text((tx + 1, ty + 1), text, font=font, fill=STROKE_COLOR)
        draw.text((tx, ty), text, font=font, fill=FILL_COLOR)

    return tile


def _generate_watermark_png(
    width: int,
    height: int,
    text: Optional[str] = None,
    opacity: int = 185,
) -> Optional[bytes]:
    """Génère un PNG RGBA transparent aux dimensions (width × height) avec la grille watermark."""
    if text is None:
        text = settings.WATERMARK_TEXT

    try:
        from PIL import Image

        font_size = max(18, min(24, width // 50))
        tile      = _build_tile(text, font_size, opacity)

        overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        TILE_W, TILE_H = tile.size

        row = 0
        for ty_pos in range(0, height + TILE_H, TILE_H):
            x_offset = (TILE_W // 2) if (row % 2 == 1) else 0
            for tx_pos in range(-TILE_W + x_offset, width + TILE_W, TILE_W):
                overlay.paste(tile, (tx_pos, ty_pos), tile)
            row += 1

        buf = io.BytesIO()
        overlay.save(buf, format="PNG")
        return buf.getvalue()
    except Exception as e:
        print(f"[watermark] ⚠️  _generate_watermark_png erreur : {e}")
        return None


def add_watermark_video(
    video_bytes: bytes,
    text: Optional[str] = None,
    opacity: int = 185,
    timeout: int = 180,
) -> Optional[bytes]:
    """
    Ajoute un filigrane en grille sur une vidéo MP4 via Pillow + FFmpeg.
    Pipeline : ffprobe dims → Pillow PNG → FFmpeg overlay → MP4
    """
    if text is None:
        text = settings.WATERMARK_TEXT

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            in_path  = os.path.join(tmpdir, "input.mp4")
            wm_path  = os.path.join(tmpdir, "watermark.png")
            out_path = os.path.join(tmpdir, "output.mp4")

            with open(in_path, "wb") as f:
                f.write(video_bytes)

            # Étape 1 : dimensions via ffprobe
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-select_streams", "v:0",
                 "-show_entries", "stream=width,height", "-of", "csv=p=0", in_path],
                capture_output=True, timeout=30,
            )
            vid_w, vid_h = 1920, 1080
            if probe.returncode == 0 and probe.stdout:
                try:
                    parts    = probe.stdout.decode().strip().split(",")
                    vid_w, vid_h = int(parts[0]), int(parts[1])
                except Exception:
                    pass

            # Étape 2 : PNG watermark via Pillow
            png_bytes = _generate_watermark_png(vid_w, vid_h, text, opacity)
            if not png_bytes:
                print("[watermark] ⚠️  PNG generation failed")
                return None

            with open(wm_path, "wb") as f:
                f.write(png_bytes)

            # Étape 3 : FFmpeg overlay
            cmd = [
                "ffmpeg", "-y", "-nostdin",
                "-i", in_path, "-i", wm_path,
                "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p",
                "-map", "0:a:0?",
                "-c:v", "libx264", "-crf", "18", "-preset", "fast",
                "-c:a", "copy", "-movflags", "+faststart",
                out_path,
            ]
            proc = subprocess.run(cmd, capture_output=True, timeout=timeout)

            if proc.returncode == 0 and os.path.exists(out_path):
                size = os.path.getsize(out_path)
                if size > 0:
                    with open(out_path, "rb") as f:
                        result = f.read()
                    print(f"[watermark] ✅ Vidéo watermarkée — {len(video_bytes)//1024}KB → {len(result)//1024}KB")
                    return result

            stderr = proc.stderr.decode("utf-8", errors="replace")[-500:] if proc.stderr else ""
            print(f"[watermark] ❌ FFmpeg failed (code={proc.returncode}): {stderr}")
            return None

    except subprocess.TimeoutExpired:
        print(f"[watermark] ⏱️  Timeout ({timeout}s)")
        return None
    except FileNotFoundError:
        print("[watermark] ⚠️  ffmpeg introuvable dans le PATH")
        return None
    except Exception as e:
        print(f"[watermark] ❌ Erreur : {e}")
        return None
