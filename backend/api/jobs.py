"""
api/jobs.py — Endpoints jobs (submit, status, download, queue) — x-translator-mvp
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

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
    "queued":       "En attente dans la file…",
    "downloading":  "Téléchargement de la vidéo…",
    "transcribing": "Transcription audio en cours…",
    "translating":  "Traduction des sous-titres…",
    "burning":      "Rendu vidéo final…",
    "uploading":    "Finalisation…",
    "done":         "Terminé !",
    "error":        "Erreur",
}

# Temps moyen estimé par vidéo (secondes) — utilisé pour la file d'attente
AVG_PROCESSING_S = 240  # ~4 min


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


# ── File d'attente (public, pas d'auth) ──────────────────────────────────────

@router.get("/queue-stats")
async def queue_stats():
    """Retourne les stats de la file de traitement (public)."""
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            SELECT
                COUNT(*) FILTER (
                    WHERE status NOT IN ('done', 'error')
                      AND updated_at > now() - interval '5 minutes'
                ) AS active_count,
                COUNT(*) FILTER (
                    WHERE status = 'queued'
                      AND created_at > now() - interval '5 minutes'
                ) AS queued_count
            FROM jobs
            """
        )
    active = int(row["active_count"] or 0)
    queued = int(row["queued_count"] or 0)
    return {
        "active_count":     active,
        "queued_count":     queued,
        "estimated_wait_s": queued * AVG_PROCESSING_S,
    }


@router.get("/public")
async def public_library():
    """Bibliothèque publique — 50 dernières vidéos done (accessible sans auth)."""
    async with get_conn() as conn:
        rows = await conn.fetch(
            """
            SELECT id, source_url, target_lang, summary,
                   source_lang, duration_s, video_type, storage_url,
                   thumbnail_url, download_count, created_at
            FROM jobs
            WHERE status = 'done'
              AND storage_url IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 50
            """
        )
    return [dict(r) for r in rows]


# ── Soumission ────────────────────────────────────────────────────────────────

@router.post("/submit")
async def submit_job(
    body: JobSubmitRequest,
    user=Depends(get_current_user_optional),
):
    """Soumet une nouvelle vidéo à traduire."""
    if body.target_lang not in VALID_LANGS:
        raise HTTPException(
            400,
            f"Langue non supportée: {body.target_lang}. "
            f"Valeurs acceptées: {sorted(VALID_LANGS)}",
        )

    url = body.source_url.strip()
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(400, "URL invalide")

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

        # ── Cache : même URL + même langue déjà traduit par cet user ──────────
        if user_id:
            existing = await conn.fetchrow(
                """
                SELECT id FROM jobs
                WHERE source_url=$1 AND target_lang=$2 AND user_id=$3 AND status='done'
                ORDER BY created_at DESC LIMIT 1
                """,
                url, body.target_lang, uuid.UUID(user_id),
            )
            if existing:
                return {
                    "job_id":         str(existing["id"]),
                    "status":         "done",
                    "cached":         True,
                    "queue_position": 0,
                }

        # ── Position dans la file ──────────────────────────────────────────────
        q_row = await conn.fetchrow(
            """
            SELECT COUNT(*) AS cnt FROM jobs
            WHERE status NOT IN ('done', 'error')
              AND created_at > now() - interval '2 hours'
            """
        )
        queue_position = int(q_row["cnt"] or 0) + 1

        # ── Créer le job ───────────────────────────────────────────────────────
        job_id = str(uuid.uuid4())
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

    # ── Envoyer dans la queue Celery ──────────────────────────────────────────
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

    return {
        "job_id":         job_id,
        "status":         "queued",
        "queue_position": queue_position,
    }


# ── Statut ────────────────────────────────────────────────────────────────────

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
        # Tout utilisateur (même anonyme) peut télécharger la version watermarkée
        can_download = True

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


# ── Téléchargement ────────────────────────────────────────────────────────────

@router.get("/{job_id}/download")
async def download_job(job_id: str):
    """Redirige vers l'URL de téléchargement de la vidéo watermarkée (public)
    et incrémente le compteur de téléchargements."""
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(400, "job_id invalide")

    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT status, storage_url FROM jobs WHERE id=$1",
            jid,
        )

    if not row:
        raise HTTPException(404, "Job introuvable")

    if row["status"] != "done" or not row["storage_url"]:
        raise HTTPException(400, "Vidéo non disponible")

    # Incrémenter le compteur de téléchargements (fire & forget)
    try:
        async with get_conn() as conn:
            await conn.execute(
                "UPDATE jobs SET download_count = download_count + 1, updated_at = now() WHERE id=$1",
                jid,
            )
    except Exception:
        pass  # Ne pas bloquer le téléchargement si la mise à jour échoue

    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=row["storage_url"], status_code=302)


# ── Liste jobs utilisateur ────────────────────────────────────────────────────

@router.get("/")
async def list_user_jobs(user=Depends(get_current_user)):
    """Liste les jobs de l'utilisateur connecté."""
    async with get_conn() as conn:
        rows = await conn.fetch(
            """
            SELECT id, source_url, target_lang, status, summary,
                   source_lang, duration_s, video_type, storage_url,
                   thumbnail_url, download_count, created_at
            FROM jobs
            WHERE user_id=$1
            ORDER BY created_at DESC
            LIMIT 50
            """,
            uuid.UUID(user["id"]),
        )

    return [dict(r) for r in rows]
