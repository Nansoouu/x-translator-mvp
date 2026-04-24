"""
backend/core/upload_helpers.py - Helpers pour la gestion des fichiers uploadés
"""
import os
import shutil
import tempfile
from pathlib import Path
from typing import Optional
from fastapi import UploadFile


def _save_uploaded_file(file: UploadFile, job_id: str) -> str:
    """
    Sauvegarde un fichier uploadé dans un dossier temporaire.
    Retourne le chemin complet du fichier sauvegardé.
    """
    # Créer un dossier temporaire pour ce job
    workdir = Path(tempfile.gettempdir()) / "x-translator-uploads" / job_id
    workdir.mkdir(parents=True, exist_ok=True)
    
    # Déterminer l'extension du fichier
    original_filename = file.filename or "uploaded_video"
    extension = Path(original_filename).suffix
    if not extension:
        # Deviner l'extension basée sur le type MIME
        mime_to_ext = {
            "video/mp4": ".mp4",
            "video/quicktime": ".mov",
            "video/x-msvideo": ".avi",
            "video/x-matroska": ".mkv",
            "video/webm": ".webm",
            "video/3gpp": ".3gp",
            "video/mpeg": ".mpeg",
        }
        extension = mime_to_ext.get(file.content_type, ".mp4")
    
    # Nom du fichier de sortie
    output_path = workdir / f"source{extension}"
    
    # Sauvegarder le fichier
    with open(output_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    print(f"[upload] Fichier sauvegardé: {output_path} ({output_path.stat().st_size} octets)")
    return str(output_path)


def _is_valid_video_file(file_path: str) -> tuple[bool, str]:
    """
    Vérifie si le fichier est une vidéo valide (vérification basique).
    Retourne (is_valid, error_message)
    """
    try:
        path = Path(file_path)
        if not path.exists():
            return False, "Fichier introuvable"
        
        if path.stat().st_size == 0:
            return False, "Fichier vide"
        
        # Vérification de l'extension
        valid_extensions = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".3gp", ".mpeg", ".mpg"}
        if path.suffix.lower() not in valid_extensions:
            return False, f"Extension non supportée: {path.suffix}"
        
        # Vérification minimale du type de fichier (magic bytes)
        with open(file_path, "rb") as f:
            header = f.read(12)
            # Vérifier quelques signatures de fichiers vidéo
            if header.startswith(b"\x00\x00\x00") and header[4:8] == b"ftyp":
                # MP4, MOV
                pass
            elif header.startswith(b"RIFF"):
                # AVI
                pass
            elif header.startswith(b"\x1a\x45\xdf\xa3"):
                # MKV
                pass
            elif header.startswith(b"\x1a\x45\xdf\xa3"):
                # WebM (similaire à MKV)
                pass
            else:
                # Accepter quand même, laisser FFmpeg gérer la validation
                pass
        
        return True, ""
    
    except Exception as e:
        return False, f"Erreur de validation: {str(e)}"


def _cleanup_uploaded_files(file_path: str) -> None:
    """
    Nettoie les fichiers temporaires uploadés.
    """
    try:
        path = Path(file_path)
        if path.exists():
            # Supprimer le fichier
            path.unlink()
            # Supprimer le dossier parent s'il est vide
            parent = path.parent
            if parent.exists() and not any(parent.iterdir()):
                parent.rmdir()
                # Supprimer le dossier grand-parent s'il est vide
                grandparent = parent.parent
                if grandparent.exists() and not any(grandparent.iterdir()):
                    grandparent.rmdir()
    except Exception as e:
        print(f"[cleanup] Erreur lors du nettoyage: {e}")