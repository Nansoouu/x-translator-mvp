"""
api/jobs.py — Endpoints jobs (submit, status, download) — x-translator-mvp
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, HttpUrl

from core.db import get_conn
from core.config import settings
from core.openrouter import SUBTITLE_LANG_NAMES
from api.auth import get_current_user_optional, get_current_user

router = APIRouter(prefix="/jobs", tags=["jobs"])

VALID_LANGS = set(SUBTITLE_LANG_NAMES.keys())

STATUS_PROGRESS = {
    "queued":       5,
    "downloading":  15,
    "transcribing": 35,
    "translating":  60,
    "burning":      80,
    "uploading":    92,
    "done":         100,
    "error":        0,
}

STATUS_LABEL = {
    "queued":       "En attente…",
    "downloading":  "Téléchargement de la vidéo…",
    "transcribing": "Transcription audio (Whisper)…",
    "translating":  "Traduction des sous-titres…",
    "burning":      "Rendu vidéo final…",
    "uploading":    "Finalisation…",
    "done":         "Terminé !",
    "error":        "Erreur",
}


class JobSubmitRequest(BaseModel):
    source_url: str
    target_lang: str


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress_pct: int
    status_label: str
    error_msg: Optional[str] = None
    storage_url: Optional[str] = None
    summary: Optional[str] = None
    source_lang: Optional[str] = None
    target_lang: Optional[str] = None
    duration_s: Optional[float] = None
    video_type: Optional[str] = None
    can_download: bool = False
    is_public: bool = True


@router.post("/submit")
async def submit_job(
    body: JobSubmitRequest,
    user=Depends(get_current_user_optional),
):
    """Soumet une nouvelle vidéo à traduire."""
    # Validation langue
    if body.target_lang not in VALID_LANGS:
        raise HTTPException(400, f"Langue non supportée: {body.target_lang}. "
                                 f"Valeurs acceptées: {sorted(VALID_LANGS)}")

    # Validation URL basique
    url = body.source_url.strip()
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(400, "URL invalide")

    user_id = user["id"] if user else None

    # Vérification quota si utilisateur connecté
    if user_id:
        async with get_conn() as conn:
            sub = await conn.fetchrow(
                "SELECT plan, credits_remaining FROM subscriptions WHERE user_id=$1",
                uuid.UUID(user_id),
            )
            if sub:
                plan    = sub["plan"]
                credits = sub["credits_remaining"]
                if plan == "free" and credits <= 0:
                    raise HTTPException(
                        402,
                        detail={
                            "error": "quota_exceeded",
                            "message": "Quota gratuit épuisé. Abonnez-vous pour continuer.",
                            "upgrade_url": "/billing",
                        },
                    )

    # Créer le job en DB
    job_id = str(uuid.uuid4())
    async with get_conn() as conn:
        await conn.execute(
            """
            INSERT INTO jobs (id, user_id, source_url, target_lang, status)
            VALUES ($1, $2, $3, $4, 'queued')
            """,
            uuid.UUID(job_id),
            uuid.UUID(user_id) if user_id else None,
            url,
            body.target_lang,
        )

        # Décrémenter crédits si user free
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

    # Envoyer dans la queue Celery
    from tasks.pipeline_task import process_video_task
    process_video_task.apply_async(
        kwargs={
            "job_id":      job_id,
            "source_url":  url,
            "target_lang": body.target_lang,
            "user_id":     user_id or "anonymous",
        },
        queue="video_processing",
    )

    return {"job_id": job_id, "status": "queued"}


@router.get("/{job_id}/status", response_model=JobStatusResponse)
async def get_job_status(
    job_id: str,
    user=Depends(get_current_user_optional),
):
    """Retourne le statut d'un job (polling toutes les 3s depuis le frontend)."""
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(400, "job_id invalide")

    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, user_id, status, error_msg, storage_url,
                   summary, source_lang, target_lang, duration_s, video_type
            FROM jobs WHERE id=$1
            """,
            jid,
        )

    if not row:
        raise HTTPException(404, "Job introuvable")

    can_download = False
    if row["status"] == "done" and row["storage_url"]:
        if user:
            uid = user["id"]
            # Vérifier abonnement pour téléchargement sans watermark
            async with get_conn() as conn:
                sub = await conn.fetchrow(
                    "SELECT plan FROM subscriptions WHERE user_id=$1",
                    uuid.UUID(uid),
                )
            can_download = bool(sub)  # tout user connecté peut télécharger (avec watermark)
        else:
            can_download = False  # anonyme = lecture seule

    return JobStatusResponse(
        job_id=str(row["id"]),
        status=row["status"],
        progress_pct=STATUS_PROGRESS.get(row["status"], 0),
        status_label=STATUS_LABEL.get(row["status"], row["status"]),
        error_msg=row["error_msg"],
        storage_url=row["storage_url"],
        summary=row["summary"],
        source_lang=row["source_lang"],
        target_lang=row["target_lang"],
        duration_s=row["duration_s"],
        video_type=row["video_type"],
        can_download=can_download,
        is_public=True,
    )


@router.get("/{job_id}/download")
async def download_job(
    job_id: str,
    user=Depends(get_current_user),
):
    """Retourne l'URL de téléchargement (utilisateurs connectés uniquement)."""
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(400, "job_id invalide")

    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT user_id, status, storage_url FROM jobs WHERE id=$1",
            jid,
        )

    if not row:
        raise HTTPException(404, "Job introuvable")

    if row["status"] != "done" or not row["storage_url"]:
        raise HTTPException(400, "Vidéo non disponible")

    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=row["storage_url"], status_code=302)


@router.get("/")
async def list_user_jobs(user=Depends(get_current_user)):
    """Liste les jobs de l'utilisateur connecté."""
    async with get_conn() as conn:
        rows = await conn.fetch(
            """
            SELECT id, source_url, target_lang, status, summary,
                   source_lang, duration_s, video_type, storage_url,
                   created_at
            FROM jobs
            WHERE user_id=$1
            ORDER BY created_at DESC
            LIMIT 50
            """,
            uuid.UUID(user["id"]),
        )

    return [dict(r) for r in rows]
