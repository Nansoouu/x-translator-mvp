"""
backend/core/clip_concat.py — Concaténation de clips vidéo avec FFmpeg filter_complex
Normalisation des codecs/résolutions pour compatibilité — x-translator-mvp
"""
from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path
from typing import List, Optional


def _ffmpeg_path() -> str:
    """Retourne le chemin de ffmpeg."""
    candidates = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"]
    for c in candidates:
        try:
            subprocess.run([c, "-version"], capture_output=True, check=True, timeout=5)
            return c
        except Exception:
            continue
    return "ffmpeg"


def normalize_video(input_path: Path, output_path: Path) -> bool:
    """
    Normalise une vidéo pour la concaténation :
      - Résolution : 1280x720 (16:9)
      - Codec : H.264, yuv420p
      - FPS : 30
      - Audio : AAC, 128k
    
    Args:
        input_path: Chemin du fichier source
        output_path: Chemin du fichier de sortie
        
    Returns:
        True si réussite, False sinon
    """
    ffmpeg = _ffmpeg_path()
    
    cmd = [
        ffmpeg, "-y", "-nostdin",
        "-i", str(input_path),
        "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,"
               "pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,"
               "format=yuv420p",
        "-r", "30",
        "-c:v", "libx264", "-crf", "23", "-preset", "fast",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        str(output_path),
    ]
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True, text=True,
            timeout=300,  # 5 minutes max
        )
        if result.returncode == 0 and output_path.exists() and output_path.stat().st_size > 0:
            print(f"[clip_concat] ✅ Normalisé {input_path.name} → {output_path.name}")
            return True
        print(f"[clip_concat] ❌ Normalisation échouée: {result.stderr[-300:]}")
        return False
    except Exception as e:
        print(f"[clip_concat] ❌ Erreur normalisation: {e}")
        return False


def concat_clips(
    clip_paths: List[Path],
    output_path: Path,
    normalize: bool = True,
) -> bool:
    """
    Concatène plusieurs clips vidéo en utilisant FFmpeg filter_complex.
    
    Si normalize=True, normalise chaque clip avant concaténation.
    Sinon, tente une concaténation directe (risque d'erreurs si codecs différents).
    
    Args:
        clip_paths: Liste des chemins des clips à concaténer
        output_path: Chemin du fichier de sortie
        normalize: Normaliser les clips avant concaténation
        
    Returns:
        True si réussite, False sinon
    """
    if not clip_paths:
        print("[clip_concat] ❌ Aucun clip à concaténer")
        return False
    
    if len(clip_paths) == 1:
        # Un seul clip : juste copier
        try:
            import shutil
            shutil.copy2(clip_paths[0], output_path)
            print(f"[clip_concat] ✅ Copié unique clip → {output_path.name}")
            return True
        except Exception as e:
            print(f"[clip_concat] ❌ Erreur copie: {e}")
            return False
    
    ffmpeg = _ffmpeg_path()
    
    if normalize:
        # Normaliser tous les clips d'abord
        with tempfile.TemporaryDirectory() as tmpdir:
            normalized_paths = []
            
            for i, clip_path in enumerate(clip_paths):
                if not clip_path.exists():
                    print(f"[clip_concat] ❌ Clip introuvable: {clip_path}")
                    return False
                
                normalized = Path(tmpdir) / f"norm_{i}.mp4"
                if not normalize_video(clip_path, normalized):
                    print(f"[clip_concat] ❌ Échec normalisation: {clip_path.name}")
                    return False
                normalized_paths.append(normalized)
            
            # Créer un fichier list.txt pour concat demuxer
            list_file = Path(tmpdir) / "list.txt"
            list_content = "\n".join([f"file '{p.absolute()}'" for p in normalized_paths])
            list_file.write_text(list_content, encoding="utf-8")
            
            # Concaténer avec concat demuxer (plus simple après normalisation)
            cmd = [
                ffmpeg, "-y", "-nostdin",
                "-f", "concat", "-safe", "0",
                "-i", str(list_file),
                "-c", "copy",  # Copy streams car déjà normalisés
                "-movflags", "+faststart",
                str(output_path),
            ]
    else:
        # Concaténation directe avec filter_complex (risqué)
        # Format: [0:v][0:a][1:v][1:a]... concat=n=N:v=1:a=1 [v][a]
        inputs = []
        filter_parts = []
        
        for i in range(len(clip_paths)):
            inputs.extend(["-i", str(clip_paths[i])])
            filter_parts.extend([f"[{i}:v]", f"[{i}:a]"])
        
        filter_complex = "".join(filter_parts) + \
                        f"concat=n={len(clip_paths)}:v=1:a=1 [v] [a]"
        
        cmd = [
            ffmpeg, "-y", "-nostdin",
            *inputs,
            "-filter_complex", filter_complex,
            "-map", "[v]",
            "-map", "[a]",
            "-c:v", "libx264", "-crf", "23", "-preset", "fast",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            str(output_path),
        ]
    
    try:
        print(f"[clip_concat] 🔧 Concaténation de {len(clip_paths)} clips...")
        result = subprocess.run(
            cmd,
            capture_output=True, text=True,
            timeout=max(600, len(clip_paths) * 60),  # 10 min + 1 min par clip
        )
        
        if result.returncode == 0 and output_path.exists() and output_path.stat().st_size > 0:
            duration = output_path.stat().st_size / (1024 * 1024)  # MB
            print(f"[clip_concat] ✅ Concaténation réussie: {output_path.name} ({duration:.1f} MB)")
            return True
        
        print(f"[clip_concat] ❌ Concaténation échouée:")
        print(f"  Code: {result.returncode}")
        if result.stderr:
            print(f"  Erreur: {result.stderr[-500:]}")
        return False
        
    except subprocess.TimeoutExpired:
        print(f"[clip_concat] ❌ Timeout concaténation ({len(clip_paths)} clips)")
        return False
    except Exception as e:
        print(f"[clip_concat] ❌ Erreur concaténation: {e}")
        return False


def estimate_concat_duration(clip_paths: List[Path]) -> Optional[float]:
    """
    Estime la durée totale de la concaténation.
    
    Args:
        clip_paths: Liste des chemins des clips
        
    Returns:
        Durée estimée en secondes, ou None si erreur
    """
    total = 0.0
    ffprobe = _ffmpeg_path().replace("ffmpeg", "ffprobe")
    
    for clip in clip_paths:
        if not clip.exists():
            print(f"[clip_concat] ⚠️  Clip introuvable pour estimation: {clip}")
            continue
        
        cmd = [
            ffprobe,
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(clip),
        ]
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                duration = float(result.stdout.strip())
                total += duration
            else:
                print(f"[clip_concat] ⚠️  Impossible d'estimer durée {clip.name}")
        except Exception:
            print(f"[clip_concat] ⚠️  Erreur estimation durée {clip.name}")
    
    return total if total > 0 else None