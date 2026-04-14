"""
api/studio.py — Endpoints Studio IA — x-translator-mvp
Routes :
  POST /studio/projects              → créer un projet (source_url ou job_id)
  GET  /studio/projects              → liste projets de l'user
  GET  /studio/projects/{id}         → status + clips
  POST /studio/projects/{id}/export  → lancer un export
  GET  /studio/exports/{id}          → statut export
"""
from __future__ import annotations

import json
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.auth import get_current_user
from core.db import get_conn

router = APIRouter(prefix="/studio", tags=["studio"])


# ── Schémas Pydantic ───────────────────────────────────────────────────────────

class ProjectCreateRequest(BaseModel):
    source_url:    Optional[str] = None
    source_job_id: Optional[str] = None


class ExportRequest(BaseModel):
    clip_ids:     list[str]
    format:       str = "9:16"      # 9:16 | 16:9 | 1:1
    translate_to: Optional[str] = None  # langue cible Agent 1


# ── Helpers ────────────────────────────────────────────────────────────────────

def _clips_from_rows(rows) -> list[dict]:
    clips = []
    for r in rows:
        d = dict(r)
        if isinstance(d.get("caption_style"), str):
            try:
                d["caption_style"] = json.loads(d["caption_style"])
            except Exception:
                d["caption_style"] = {}
        d["id"]         = str(d["id"])
        d["project_id"] = str(d["project_id"])
        clips.append(d)
    return clips


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/projects")
async def create_project(
    body: ProjectCreateRequest,
    user=Depends(get_current_user),
):
    """Crée un projet Studio et déclenche l'analyse IA."""
    if not body.source_url and not body.source_job_id:
        raise HTTPException(400, "source_url ou source_job_id requis")

    user_id    = uuid.UUID(user["id"])
    project_id = uuid.uuid4()

    source_url    = body.source_url
    source_job_id = None

    async with get_conn() as conn:
        # Résoudre job_id → source_url si nécessaire
        if body.source_job_id:
            source_job_id = uuid.UUID(body.source_job_id)
            job = await conn.fetchrow(
                "SELECT source_url FROM jobs WHERE id=$1 AND user_id=$2",
                source_job_id, user_id,
            )
            if not job:
                raise HTTPException(404, "Job introuvable")
            if not source_url:
                source_url = job["source_url"]

        await conn.execute(
            """
            INSERT INTO studio_projects
                (id, user_id, source_job_id, source_url, status)
            VALUES ($1, $2, $3, $4, 'queued')
            """,
            project_id, user_id, source_job_id, source_url,
        )

    # Déclenche la Celery task
    from tasks.analyze_task import analyze_video_task
    analyze_video_task.apply_async(
        kwargs={"project_id": str(project_id)},
        queue="video_processing",
    )

    return {"project_id": str(project_id), "status": "queued"}


@router.get("/projects")
async def list_projects(user=Depends(get_current_user)):
    """Liste les projets Studio de l'user."""
    async with get_conn() as conn:
        rows = await conn.fetch(
            """
            SELECT id, source_url, source_job_id, source_title,
                   status, error_msg, created_at, updated_at
            FROM studio_projects
            WHERE user_id=$1
            ORDER BY created_at DESC
            LIMIT 50
            """,
            uuid.UUID(user["id"]),
        )
    result = []
    for r in rows:
        d = dict(r)
        d["id"]             = str(d["id"])
        d["source_job_id"]  = str(d["source_job_id"]) if d["source_job_id"] else None
        result.append(d)
    return result


@router.get("/projects/{project_id}")
async def get_project(project_id: str, user=Depends(get_current_user)):
    """Retourne le statut du projet + la liste des clips détectés."""
    try:
        pid = uuid.UUID(project_id)
    except ValueError:
        raise HTTPException(400, "project_id invalide")

    async with get_conn() as conn:
        proj = await conn.fetchrow(
            """
            SELECT id, source_url, source_job_id, source_title,
                   status, error_msg, transcript, created_at
            FROM studio_projects WHERE id=$1 AND user_id=$2
            """,
            pid, uuid.UUID(user["id"]),
        )
        if not proj:
            raise HTTPException(404, "Projet introuvable")

        clips_rows = await conn.fetch(
            """
            SELECT id, project_id, start_s, end_s, score, hook_type,
                   title, suggested_text, caption_style, hashtags, description
            FROM studio_clips
            WHERE project_id=$1
            ORDER BY score DESC, start_s ASC
            """,
            pid,
        )

    d = dict(proj)
    d["id"]             = str(d["id"])
    d["source_job_id"]  = str(d["source_job_id"]) if d["source_job_id"] else None
    d.pop("transcript", None)  # pas besoin côté frontend
    d["clips"] = _clips_from_rows(clips_rows)

    return d


@router.post("/projects/{project_id}/export")
async def create_export(
    project_id: str,
    body: ExportRequest,
    user=Depends(get_current_user),
):
    """Lance le rendu des clips sélectionnés."""
    try:
        pid = uuid.UUID(project_id)
    except ValueError:
        raise HTTPException(400, "project_id invalide")

    if body.format not in ("9:16", "16:9", "1:1"):
        raise HTTPException(400, "format invalide : 9:16 | 16:9 | 1:1")

    if not body.clip_ids:
        raise HTTPException(400, "Sélectionne au moins un clip")

    # Valider les clip_ids
    try:
        clip_uuids = [uuid.UUID(c) for c in body.clip_ids]
    except ValueError:
        raise HTTPException(400, "clip_ids invalides")

    async with get_conn() as conn:
        proj = await conn.fetchrow(
            "SELECT id, status, source_url, source_job_id FROM studio_projects WHERE id=$1 AND user_id=$2",
            pid, uuid.UUID(user["id"]),
        )
        if not proj:
            raise HTTPException(404, "Projet introuvable")
        if proj["status"] != "ready":
            raise HTTPException(400, "Analyse IA pas encore terminée")

        export_id = uuid.uuid4()
        await conn.execute(
            """
            INSERT INTO studio_exports
                (id, project_id, user_id, clip_ids, format, translate_to, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'queued')
            """,
            export_id, pid, uuid.UUID(user["id"]),
            clip_uuids, body.format, body.translate_to,
        )

    # Déclenche la Celery task d'export
    from tasks.export_task import export_clips_task
    export_clips_task.apply_async(
        kwargs={"export_id": str(export_id)},
        queue="video_processing",
    )

    return {"export_id": str(export_id), "status": "queued"}


@router.get("/exports/{export_id}")
async def get_export(export_id: str, user=Depends(get_current_user)):
    """Polling statut export."""
    try:
        eid = uuid.UUID(export_id)
    except ValueError:
        raise HTTPException(400, "export_id invalide")

    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, project_id, status, format, output_urls,
                   kit_publication, error_msg, created_at, updated_at
            FROM studio_exports WHERE id=$1 AND user_id=$2
            """,
            eid, uuid.UUID(user["id"]),
        )
    if not row:
        raise HTTPException(404, "Export introuvable")

    d = dict(row)
    d["id"]         = str(d["id"])
    d["project_id"] = str(d["project_id"])
    # Désérialiser JSONB si string
    for key in ("output_urls", "kit_publication"):
        if isinstance(d.get(key), str):
            try:
                d[key] = json.loads(d[key])
            except Exception:
                pass
    return d
