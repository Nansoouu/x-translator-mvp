"""
core/watermark.py — Filigrane vidéo — x-translator-mvp
Watermark : pattern diagonal semi-transparent + badge fixe haut-droite
Texte : "free translating by spottedyou.org for BRICSNewsFR"
Dépendances : Pillow
"""
from __future__ import annotations

import io
import math
import os
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

_FONT_PATHS_REGULAR = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/Library/Fonts/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
]


def _get_font_path(bold: bool = True) -> Optional[str]:
    paths = _FONT_PATHS if bold else _FONT_PATHS_REGULAR
    for fp in paths:
        if os.path.isfile(fp):
            return fp
    # fallback : essayer l'autre liste
    fallback = _FONT_PATHS_REGULAR if bold else _FONT_PATHS
    for fp in fallback:
        if os.path.isfile(fp):
            return fp
    return None


def _generate_watermark_png(
    width: int,
    height: int,
    text: Optional[str] = None,
    opacity: int = 210,
) -> Optional[bytes]:
    """
    Génère un PNG RGBA transparent (width × height) avec deux couches de watermark :
      1. Pattern diagonal répété semi-transparent sur toute la vidéo (~15% opacité)
         → impossible de couper un coin pour supprimer le filigrane
      2. Badge fixe haut-droite (~80% opacité) → lisible et bien visible

    Texte : settings.WATERMARK_TEXT ("free translating by spottedyou.org for BRICSNewsFR")
    """
    if text is None:
        text = settings.WATERMARK_TEXT

    try:
        from PIL import Image, ImageDraw, ImageFont

        # ── Police grande (pattern diagonal) ──────────────────────────────────
        diag_font_size = max(14, min(22, width // 55))
        font_path      = _get_font_path(bold=False)
        try:
            diag_font = (
                ImageFont.truetype(font_path, diag_font_size)
                if font_path
                else ImageFont.load_default()
            )
        except Exception:
            diag_font = ImageFont.load_default()

        # ── Police petite (badge haut-droite) ─────────────────────────────────
        badge_font_size = max(11, min(14, width // 90))
        badge_fp        = _get_font_path(bold=True)
        try:
            badge_font = (
                ImageFont.truetype(badge_fp, badge_font_size)
                if badge_fp
                else ImageFont.load_default()
            )
        except Exception:
            badge_font = ImageFont.load_default()

        overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        draw    = ImageDraw.Draw(overlay)

        # ─────────────────────────────────────────────────────────────────────
        # COUCHE 1 : Pattern diagonal répété
        # Méthode : générer un "tile" avec le texte incliné, puis le répliquer
        # ─────────────────────────────────────────────────────────────────────
        DIAG_OPACITY = 200   # ~62% — bien visible sur toutes les vidéos
        ANGLE        = -30  # degrés, sens horaire → monte vers la droite

        # Mesurer le texte
        try:
            bbox   = draw.textbbox((0, 0), text, font=diag_font)
            txt_w  = bbox[2] - bbox[0]
            txt_h  = bbox[3] - bbox[1]
        except AttributeError:
            txt_w, txt_h = draw.textsize(text, font=diag_font)

        # Générer un tile légèrement plus grand que le texte
        pad_h    = int(txt_w * 0.8)   # espacement horizontal entre répétitions
        pad_v    = int(txt_h * 3.5)   # espacement vertical
        tile_w   = txt_w + pad_h
        tile_h   = txt_h + pad_v

        tile = Image.new("RGBA", (tile_w, tile_h), (0, 0, 0, 0))
        tile_draw = ImageDraw.Draw(tile)
        tile_draw.text(
            (pad_h // 2, pad_v // 2),
            text,
            font=diag_font,
            fill=(255, 255, 255, DIAG_OPACITY),
        )

        # Rotation
        tile_rot = tile.rotate(ANGLE, expand=True, resample=Image.BICUBIC)
        rot_w, rot_h = tile_rot.size

        # Tiling sur tout le canvas
        for y in range(-rot_h, height + rot_h, max(rot_h, 1)):
            for x in range(-rot_w, width + rot_w, max(rot_w, 1)):
                overlay.paste(tile_rot, (x, y), tile_rot)

        # ─────────────────────────────────────────────────────────────────────
        # COUCHE 2 : Badge fixe haut-droite
        # ─────────────────────────────────────────────────────────────────────
        draw2 = ImageDraw.Draw(overlay)

        try:
            bbox2   = draw2.textbbox((0, 0), text, font=badge_font)
            text_w  = bbox2[2] - bbox2[0]
            text_h  = bbox2[3] - bbox2[1]
        except AttributeError:
            text_w, text_h = draw2.textsize(text, font=badge_font)

        padding = 5
        margin  = 8

        x = width - text_w - padding * 2 - margin
        y = margin

        # Badge arrière-plan noir semi-transparent
        draw2.rectangle(
            [x - padding, y - padding, x + text_w + padding, y + text_h + padding],
            fill=(0, 0, 0, 185),
        )
        # Texte blanc opaque
        draw2.text((x, y), text, font=badge_font, fill=(255, 255, 255, opacity))

        buf = io.BytesIO()
        overlay.save(buf, format="PNG")
        return buf.getvalue()

    except Exception as e:
        print(f"[watermark] ⚠️  _generate_watermark_png erreur : {e}")
        return None


def add_watermark_video(
    video_bytes: bytes,
    text: Optional[str] = None,
    opacity: int = 210,
    timeout: int = 180,
) -> Optional[bytes]:
    """
    Ajoute un filigrane (pattern diagonal + badge haut-droite) sur une vidéo MP4.
    Pipeline : ffprobe dims → Pillow PNG → FFmpeg overlay → MP4
    """
    import subprocess
    import tempfile

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
                    parts        = probe.stdout.decode().strip().split(",")
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
                "-filter_complex",
                "[1:v]format=yuva420p[wm];[0:v][wm]overlay=0:0:shortest=1,format=yuv420p[out]",
                "-map", "[out]",
                "-map", "0:a:0?",
                "-c:v", "libx264", "-crf", "18", "-preset", "fast",
                "-c:a", "copy", "-movflags", "+faststart",
                out_path,
            ]
            proc = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=timeout)

            if proc.returncode == 0 and os.path.exists(out_path):
                size = os.path.getsize(out_path)
                if size > 10000:
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
