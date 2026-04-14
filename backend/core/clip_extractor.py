"""
core/clip_extractor.py — Découpe de clips + reformatage 9:16/16:9/1:1 — Studio
"""
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Literal

Format = Literal["9:16", "16:9", "1:1"]


def _ffmpeg_path() -> str:
    candidates = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"]
    for c in candidates:
        try:
            subprocess.run([c, "-version"], capture_output=True, check=True, timeout=5)
            return c
        except Exception:
            continue
    return "ffmpeg"


def extract_clip(
    source: Path,
    out: Path,
    start_s: float,
    end_s: float,
    fmt: Format = "9:16",
) -> bool:
    """
    Extrait un segment [start_s, end_s] et le reformate au format demandé.

    Formats :
      9:16  → 1080x1920 (TikTok / Reels / Shorts) — crop centré + fond noir
      16:9  → 1280x720  (YouTube)
      1:1   → 1080x1080 (Instagram carré)
    """
    ffmpeg = _ffmpeg_path()
    duration = max(0.5, end_s - start_s)

    if fmt == "9:16":
        target_w, target_h = 1080, 1920
    elif fmt == "1:1":
        target_w, target_h = 1080, 1080
    else:  # 16:9
        target_w, target_h = 1280, 720

    # scale + pad pour garder le ratio d'origine avec fond noir
    vf = (
        f"scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
        f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2:black,"
        f"setsar=1"
    )

    cmd = [
        ffmpeg, "-y", "-nostdin",
        "-ss", str(start_s),
        "-i", str(source),
        "-t", str(duration),
        "-vf", vf,
        "-c:v", "libx264", "-crf", "23", "-preset", "fast",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        str(out),
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True, text=True,
            timeout=max(120, int(duration * 10)),
        )
        if result.returncode == 0 and out.exists() and out.stat().st_size > 0:
            print(f"[clip_extractor] ✅ {out.name} [{fmt}] {duration:.1f}s")
            return True
        print(f"[clip_extractor] ❌ code={result.returncode}\n{result.stderr[-300:]}")
        return False
    except Exception as e:
        print(f"[clip_extractor] ❌ {e}")
        return False
