"""
backend/api/jobs_upload_endpoint.py - Endpoint pour upload de fichiers vidéo
"""
from __future__ import annotations

import os
import uuid
from typing import Optional
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from core.db import get_conn
from core.config import settings
from core.upload_helpers import _save_uploaded_file, _is_valid_video_file, _cleanup_uploaded_files
from api.auth import get_current_user_optional, get_current_user

router = APIRouter(prefix="/jobs", tags=["jobs"])

# Taille maximale 1 Go = 1_000_000_000 octets
MAX_FILE_SIZE = 1_000_000_000

# Types MIME acceptés
ACCEPTED_VIDEO_TYPES = [
    "video/mp4",
    "video/quicktime",   # MOV
    "video/x-msvideo",   # AVI
    "video/x-matroska",  # MKV
    "video/webm",
    "video/3gpp",
    "video/mpeg",
]


class UploadJobResponse(BaseModel):
    job_id: str
    status: str
    queue_position: int
    mode: str
    download_only: bool
    original_filename: str


def validate_video_file(file: UploadFile) -> tuple[bool, str]:
    """
    Valide le fichier vidéo (type, taille).
    Retourne (is_valid, error_message)
    """
    # Vérifier le type MIME
    if file.content_type not in ACCEPTED_VIDEO_TYPES:
        return False, f"Type de fichier non supporté: {file.content_type}"
    
    # Vérifier la taille
    try:
        file.file.seek(0, 2)  # Aller à la fin
        size = file.file.tell()
        file.file.seek(0)     # Retourner au début
        
        if size > MAX_FILE_SIZE:
            return False, f"Taille maximale dépassée: {size} > {MAX_FILE_SIZE}"
        
        if size == 0:
            return False, "Fichier vide"
    
    except Exception as e:
        return False, f"Erreur lors de la validation: {str(e)}"
    
    return True, ""


@router.post("/upload", response_model=UploadJobResponse)
async def upload_video_file(
    file: UploadFile = File(...),
    mode: str = Form("download"),
    target_lang: str = Form("fr"),
    user=Depends(get_current_user_optional),
):
    """
    Upload un fichier vidéo pour traitement (téléchargement seulement ou traduction).
    """
    # Validation du mode
    if mode not in ("download", "translate"):
        raise HTTPException(400, "Mode invalide. Doit être 'download' ou 'translate'")
    
    # Validation de la langue si mode translate
    if mode == "translate":
        from core.openrouter import SUBTITLE_LANG_NAMES
        VALID_LANGS = set(SUBTITLE_LANG_NAMES.keys())
        if target_lang not in VALID_LANGS:
            raise HTTPException(
                400,
                f"Langue non supportée: {target_lang}. "
                f"Valeurs acceptées: {sorted(VALID_LANGS)}",
            )
    
    # Validation du fichier
    is_valid, error_msg = validate_video_file(file)
    if not is_valid:
        raise HTTPException(400, error_msg)
    
    user_id = user["id"] if user else None
    
    async with get_conn() as conn:
        # ── Vérification quota si user connecté ───────────────────────────────
        if user_id:
            sub = await conn.fetchrow(
                "SELECT plan, credits_remaining FROM subscriptions WHERE user_id=$1",
                uuid.UUID(user_id),
            )
            if sub:
                if sub["plan"] == "free" and sub["credits_remaining"] <= 0:
                    raise HTTPException(
                        402,
                        detail={
                            "error": "quota_exceeded",
                            "message": "Quota gratuit épuisé. Abonnez-vous pour continuer.",
                            "upgrade_url": "/billing",
                        },
                    )
        
        # ── Position dans la file ──────────────────────────────────────────────
        q_row = await conn.fetchrow(
            """
            SELECT COUNT(*) AS cnt FROM jobs
            WHERE status NOT IN ('done', 'error')
              AND created_at > now() - interval '2 hours'
            """
        )
        queue_position = int(q_row["cnt"] or 0) + 1
        
        # ── Créer le job pour upload ───────────────────────────────────────────
        job_id = str(uuid.uuid4())
        download_only = mode == "download"
        source_url = f"file://{file.filename}"  # URL spéciale pour fichiers uploadés
        
        await conn.execute(
            """
            INSERT INTO jobs (id, user_id, source_url, target_lang, status, 
                             download_only, mode, original_filename)
            VALUES ($1, $2, $3, $4, 'queued', $5, $6, $7)
            """,
            uuid.UUID(job_id),
            uuid.UUID(user_id) if user_id else None,
            source_url,
            target_lang if mode == "translate" else "none",
            download_only,
            mode,
            file.filename,
        )
        
        # ── Décrémenter crédits si user free ──────────────────────────────────
        if user_id:
            await conn.execute(
                """
                UPDATE subscriptions
                SET credits_remaining = GREATEST(0, credits_remaining - 1),
                    updated_at = now()
                WHERE user_id=$1 AND plan='free'
                """,
                uuid.UUID(user_id),
            )
    
    # ── Sauvegarder le fichier temporairement dans /tmp ────────────────────────
    try:
        tmp_file_path = _save_uploaded_file(file, job_id)
        print(f"[upload] Fichier sauvegardé temporairement: {tmp_file_path}")
    except Exception as e:
        raise HTTPException(500, f"Erreur lors de la sauvegarde du fichier: {str(e)}")
    
    # ── Envoyer dans la queue Celery ──────────────────────────────────────────
    from tasks.pipeline_task import process_video_task
    process_video_task.apply_async(
        kwargs={
            "job_id":           job_id,
            "source_url":       f"file://{tmp_file_path}",  # Utiliser le chemin local
            "target_lang":      target_lang if mode == "translate" else "none",
            "user_id":          user_id or "anonymous",
            "download_only":    download_only,
            "original_filename": file.filename,
            "is_file_upload":   True,
        },
        queue="video_processing",
    )
    
    return UploadJobResponse(
        job_id=job_id,
        status="queued",
        queue_position=queue_position,
        mode=mode,
        download_only=download_only,
        original_filename=file.filename,
    )