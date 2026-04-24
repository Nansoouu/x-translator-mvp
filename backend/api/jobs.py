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
from core.utils import estimate_processing_time
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
    mode: str = "translate"  # "download" ou "translate"
    original_filename: Optional[str] = None


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
    estimated_total_seconds: Optional[float] = None
    estimated_burn_seconds: Optional[float] = None


class UpdateSegmentRequest(BaseModel):
    translation: str
    start_time: float
    end_time: float


# ── File d'attente (public, pas d'auth) ──────────────────────────────────────

@router.post("/estimate-duration")
async def estimate_duration(body: EstimateUrlRequest, request: Request):
    """
    Estime la durée d'une vidéo à partir de son URL (sans téléchargement complet).
    Retourne aussi les infos de quota pour l'upsell intelligent.
    """
    import yt_dlp
    from core.ip_limiter import check_ip_quota, is_local_ip, is_production

    try:
        with yt_dlp.YoutubeDL({"quiet": True, "extract_flat": True}) as ydl:
            info = ydl.extract_info(body.source_url, download=False)
            duration_s = info.get("duration") or 0
    except Exception as e:
        print(f"[estimate-duration] ❌ {e}")
        return {"duration_s": 0, "error": str(e)[:100]}

    result = {"duration_s": duration_s}

    # ── Quota IP (non connectés, prod uniquement) ──
    client_ip = request.client.host
    ip_quota = await check_ip_quota(client_ip)
    result["ip_quota"] = ip_quota

    return result


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
    # Résoudre TOUTES les URLs en URLs de streaming proxy
    def _resolve_url(row_dict: dict) -> dict:
        url = row_dict.get("storage_url")
        job_id = str(row_dict["id"])
        if url:
            # Utiliser /jobs/{id}/stream (sans /api/) pour éviter la boucle de rewrite
            # Next.js rewrite: /api/jobs/* → /jobs/* (backend)
            row_dict["storage_url"] = f"/jobs/{job_id}/stream"
        return row_dict

    return [_resolve_url(dict(r)) for r in rows]


# ── Éditeur Timeline ───────────────────────────────────────────────────────────


class ReorderRequest(BaseModel):
    """Requête pour réorganiser l'ordre des segments."""
    segment_id: str
    new_order: int


class ExportClipsRequest(BaseModel):
    """Requête pour exporter des clips."""
    segment_ids: list[str]
    format: str = "16:9"
    concat: bool = True


class EstimateUrlRequest(BaseModel):
    """Requête pour estimer la durée d'une vidéo."""
    source_url: str


class SplitSegmentRequest(BaseModel):
    """Requête pour diviser un segment."""
    split_time: float


class MergeSegmentsRequest(BaseModel):
    """Requête pour fusionner des segments."""
    segment_ids: list[str]


@router.delete("/{job_id}/segments/{segment_id}")
async def delete_segment(
    job_id: str,
    segment_id: str,
    user=Depends(get_current_user_optional),
):
    """
    Supprime un segment de transcription.
    - Hard delete du segment (suppression DB)
    - Mise à jour des custom_order des segments restants
    - Retourne 204 No Content
    """
    try:
        jid = uuid.UUID(job_id)
        seg_id = uuid.UUID(segment_id)
    except ValueError:
        raise HTTPException(400, "ID invalide")

    async with get_conn() as conn:
        # Vérifier l'existence et appartenance
        seg = await conn.fetchrow(
            """
            SELECT id FROM transcription_segments 
            WHERE id=$1 AND job_id=$2
            """,
            seg_id, jid,
        )
        if not seg:
            raise HTTPException(404, "Segment introuvable pour ce job")
        
        # Supprimer le segment
        await conn.execute(
            """
            DELETE FROM transcription_segments 
            WHERE id=$1
            """,
            seg_id,
        )
        
        # Réorganiser les ordres restants
        await conn.execute(
            """
            UPDATE transcription_segments
            SET custom_order = sub.new_order
            FROM (
                SELECT id, ROW_NUMBER() OVER (ORDER BY custom_order NULLS LAST, start_time) * 10 as new_order
                FROM transcription_segments
                WHERE job_id=$1
            ) sub
            WHERE transcription_segments.id = sub.id
            AND transcription_segments.job_id = $1
            """,
            jid,
        )
    
    return {"status": "ok", "message": "Segment supprimé", "segment_id": segment_id}


@router.post("/{job_id}/segments/{segment_id}/split")
async def split_segment(
    job_id: str,
    segment_id: str,
    body: SplitSegmentRequest,
    user=Depends(get_current_user_optional),
):
    """
    Divise un segment de transcription en deux.
    - Crée deux nouveaux segments avec les textes originaux
    - Met à jour les custom_order des segments
    - Retourne les deux nouveaux segments
    """
    try:
        jid = uuid.UUID(job_id)
        seg_id = uuid.UUID(segment_id)
    except ValueError:
        raise HTTPException(400, "ID invalide")
    
    # Valider le split_time
    if body.split_time <= 0:
        raise HTTPException(400, "split_time doit être > 0")
    
    async with get_conn() as conn:
        # Récupérer le segment à diviser
        seg = await conn.fetchrow(
            """
            SELECT id, start_time, end_time, original_text, translated_text, style, custom_order
            FROM transcription_segments 
            WHERE id=$1 AND job_id=$2
            """,
            seg_id, jid,
        )
        if not seg:
            raise HTTPException(404, "Segment introuvable pour ce job")
        
        # Vérifier que le split_time est dans l'intervalle du segment
        if body.split_time <= seg["start_time"] or body.split_time >= seg["end_time"]:
            raise HTTPException(400, "split_time doit être entre start_time et end_time du segment")
        
        # Calculer les nouveaux custom_order
        from core.timeline_utils import get_next_order_position
        next_order = await get_next_order_position(jid)
        
        # Créer deux nouveaux segments
        new_segment1_id = uuid.uuid4()
        new_segment2_id = uuid.uuid4()
        
        # Segment 1 (première partie)
        await conn.execute(
            """
            INSERT INTO transcription_segments 
            (id, job_id, start_time, end_time, original_text, translated_text, style, custom_order)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
            new_segment1_id, jid, seg["start_time"], body.split_time,
            seg["original_text"], seg["translated_text"], seg["style"], next_order
        )
        
        # Segment 2 (deuxième partie)
        await conn.execute(
            """
            INSERT INTO transcription_segments 
            (id, job_id, start_time, end_time, original_text, translated_text, style, custom_order)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
            new_segment2_id, jid, body.split_time, seg["end_time"],
            seg["original_text"], seg["translated_text"], seg["style"], next_order + 10
        )
        
        # Supprimer le segment original
        await conn.execute(
            "DELETE FROM transcription_segments WHERE id=$1",
            seg_id
        )
        
        # Réorganiser les ordres
        from core.timeline_utils import reorder_segments
        await reorder_segments(jid)
        
        # Récupérer les nouveaux segments
        new_segments = await conn.fetch(
            """
            SELECT id, start_time, end_time, original_text, translated_text, style
            FROM transcription_segments
            WHERE id IN ($1, $2)
            ORDER BY start_time
            """,
            new_segment1_id, new_segment2_id
        )
    
    return {
        "segments": [
            {
                "id": str(s["id"]),
                "startTime": float(s["start_time"]),
                "endTime": float(s["end_time"]),
                "text": s["original_text"] or "",
                "translation": s["translated_text"] or "",
                "style": s["style"] or {},
            }
            for s in new_segments
        ],
        "message": "Segment divisé en deux avec succès"
    }


@router.post("/{job_id}/segments/merge")
async def merge_segments(
    job_id: str,
    body: MergeSegmentsRequest,
    user=Depends(get_current_user_optional),
):
    """
    Fusionne plusieurs segments en un seul.
    - Combine les textes et ajuste les timecodes
    - Met à jour les custom_order
    - Retourne le nouveau segment fusionné
    """
    try:
        jid = uuid.UUID(job_id)
        seg_ids = [uuid.UUID(sid) for sid in body.segment_ids]
    except ValueError:
        raise HTTPException(400, "ID invalide")
    
    if len(seg_ids) < 2:
        raise HTTPException(400, "Au moins 2 segments sont requis pour la fusion")
    
    async with get_conn() as conn:
        # Récupérer les segments à fusionner
        segments = await conn.fetch(
            """
            SELECT id, start_time, end_time, original_text, translated_text, style, custom_order
            FROM transcription_segments 
            WHERE id = ANY($1) AND job_id=$2
            ORDER BY start_time
            """,
            seg_ids, jid
        )
        
        if len(segments) != len(seg_ids):
            raise HTTPException(404, "Un ou plusieurs segments introuvables")
        
        # Vérifier que les segments sont consécutifs
        for i in range(len(segments) - 1):
            if segments[i]["end_time"] != segments[i + 1]["start_time"]:
                raise HTTPException(400, "Les segments doivent être consécutifs pour la fusion")
        
        # Calculer le nouveau segment fusionné
        start_time = segments[0]["start_time"]
        end_time = segments[-1]["end_time"]
        
        # Combiner les textes
        original_text = " ".join([s["original_text"] for s in segments if s["original_text"]])
        translated_text = " ".join([s["translated_text"] for s in segments if s["translated_text"]])
        
        # Utiliser le style du premier segment
        style = segments[0]["style"]
        
        # Récupérer le prochain ordre disponible
        from core.timeline_utils import get_next_order_position
        next_order = await get_next_order_position(jid)
        
        # Créer le nouveau segment fusionné
        merged_segment_id = uuid.uuid4()
        
        await conn.execute(
            """
            INSERT INTO transcription_segments 
            (id, job_id, start_time, end_time, original_text, translated_text, style, custom_order)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
            merged_segment_id, jid, start_time, end_time,
            original_text, translated_text, style, next_order
        )
        
        # Supprimer les anciens segments
        await conn.execute(
            "DELETE FROM transcription_segments WHERE id = ANY($1)",
            seg_ids
        )
        
        # Réorganiser les ordres
        from core.timeline_utils import reorder_segments
        await reorder_segments(jid)
        
        # Récupérer le segment fusionné
        merged_segment = await conn.fetchrow(
            """
            SELECT id, start_time, end_time, original_text, translated_text, style
            FROM transcription_segments
            WHERE id=$1
            """,
            merged_segment_id
        )
    
    return {
        "segment": {
            "id": str(merged_segment["id"]),
            "startTime": float(merged_segment["start_time"]),
            "endTime": float(merged_segment["end_time"]),
            "text": merged_segment["original_text"] or "",
            "translation": merged_segment["translated_text"] or "",
            "style": merged_segment["style"] or {},
        },
        "message": f"{len(segments)} segments fusionnés avec succès"
    }


@router.get("/{job_id}/transcription/srt")
async def get_original_srt(
    job_id: str,
    user=Depends(get_current_user_optional),
):
    """
    Récupère le SRT original capté par Whisper.
    - Stocké dans /tmp/{job_id}/source.srt ou backup
    - Retourne texte brut avec Content-Type: text/plain
    """
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(400, "job_id invalide")
    
    from core.timeline_utils import get_original_srt_content
    srt_content = await get_original_srt_content(jid)
    
    if not srt_content:
        raise HTTPException(404, "SRT original introuvable")
    
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(
        content=srt_content,
        media_type="text/plain",
        headers={"Content-Disposition": f"attachment; filename=original_{job_id}.srt"},
    )


@router.post("/{job_id}/transcription/regenerate")
async def regenerate_video(
    job_id: str,
    user=Depends(get_current_user_optional),
):
    """
    Génère une nouvelle vidéo basée sur les segments actuels.
    - Génère SRT corrigé
    - Crée ASS via _srt_to_ass
    - Lance tâche Celery pour regénérer vidéo
    - Retourne ID de l'export
    """
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(400, "job_id invalide")
    
    # Récupérer les segments avec ordre
    from core.timeline_utils import get_segments_with_order, generate_corrected_srt
    segments = await get_segments_with_order(jid)
    
    if not segments:
        raise HTTPException(400, "Aucun segment disponible pour ce job")
    
    # Générer SRT corrigé
    corrected_srt = generate_corrected_srt(segments, mode="readable")
    
    # Créer un nouvel export_id
    export_id = str(uuid.uuid4())
    
    # Sauvegarder le SRT corrigé temporairement
    import tempfile
    from pathlib import Path
    tmp_dir = Path(tempfile.gettempdir()) / "x-translator-regenerate"
    tmp_dir.mkdir(exist_ok=True)
    srt_path = tmp_dir / f"{export_id}.srt"
    srt_path.write_text(corrected_srt, encoding="utf-8")
    
    # Convertir SRT → ASS (utiliser pipeline existant)
    from core.pipeline import _srt_to_ass
    ass_content = _srt_to_ass(corrected_srt, target_lang="fr")  # TODO: récupérer la langue du job
    
    # Sauvegarder ASS
    ass_path = tmp_dir / f"{export_id}.ass"
    ass_path.write_text(ass_content, encoding="utf-8")
    
    # Lancer la tâche de regénération (TODO: créer la tâche)
    # from tasks.export_task import regenerate_video_task
    # task = regenerate_video_task.delay(str(jid), str(ass_path))
    
    return {
        "export_id": export_id,
        "status": "queued",
        "message": "La regénération est en cours",
    }


@router.post("/{job_id}/export-clips")
async def export_clips(
    job_id: str,
    body: ExportClipsRequest,
    user=Depends(get_current_user_optional),
):
    """
    Exporte des clips vidéo basés sur les segments sélectionnés.
    - Récupère la vidéo source depuis le job
    - Pour chaque segment : extract_clip() via FFmpeg (supporte 16:9, 9:16, 1:1)
    - Si concat=true : concatène tous les clips en une seule vidéo
    - Upload vers Supabase Storage
    - Retourne les URLs de téléchargement
    """
    import asyncio
    from pathlib import Path
    from core.config import settings
    from core.clip_extractor import extract_clip
    from core.clip_concat import concat_clips, estimate_concat_duration
    from core.supabase_storage import upload_video

    try:
        jid = uuid.UUID(job_id)
        seg_ids = [uuid.UUID(sid) for sid in body.segment_ids]
    except ValueError:
        raise HTTPException(400, "ID invalide")
    
    if not seg_ids:
        raise HTTPException(400, "Aucun segment sélectionné")
    
    # Récupérer les segments et les infos du job
    async with get_conn() as conn:
        job_row = await conn.fetchrow(
            "SELECT source_url, storage_url, status FROM jobs WHERE id=$1",
            jid,
        )
        if not job_row:
            raise HTTPException(404, "Job introuvable")
        if job_row["status"] != "done":
            raise HTTPException(400, "Le job n'est pas encore terminé")
        
        segments = await conn.fetch(
            """
            SELECT id, start_time, end_time
            FROM transcription_segments
            WHERE job_id=$1 AND id = ANY($2)
            ORDER BY start_time
            """,
            jid, seg_ids,
        )
    
    if not segments:
        raise HTTPException(404, "Aucun segment trouvé")
    
    # Récupérer la vidéo source
    tmp = Path(settings.LOCAL_TEMP_DIR) / f"export_{job_id}"
    tmp.mkdir(parents=True, exist_ok=True)
    source_mp4 = tmp / "source.mp4"
    
    # Chercher la vidéo locale d'abord
    job_tmp = Path(settings.LOCAL_TEMP_DIR) / str(job_id)
    job_src = job_tmp / "source.mp4"
    if job_src.exists():
        import shutil
        shutil.copy2(job_src, source_mp4)
    
    # Fallback : télécharger depuis Supabase
    if not source_mp4.exists() and job_row["storage_url"]:
        import urllib.request
        try:
            urllib.request.urlretrieve(job_row["storage_url"], source_mp4)
        except Exception as e:
            print(f"[export-clips] ⚠️ Échec téléchargement Supabase: {e}")
    
    if not source_mp4.exists():
        raise HTTPException(500, "Vidéo source indisponible")
    
    # Découper chaque clip
    output_urls = []
    clip_paths = []
    
    for seg in segments:
        clip_id   = str(seg["id"])[:8]
        start_s   = float(seg["start_time"])
        end_s     = float(seg["end_time"])
        clip_path = tmp / f"clip_{clip_id}.mp4"
        
        # Utiliser le format demandé
        ok = await asyncio.to_thread(
            extract_clip, source_mp4, clip_path, start_s, end_s, body.format,
        )
        if ok and clip_path.exists():
            clip_paths.append(clip_path)
            output_urls.append({
                "segment_id": str(seg["id"]),
                "start_s":    start_s,
                "end_s":      end_s,
                "duration":   round(end_s - start_s, 1),
                "url":        None,  # Sera rempli après upload
            })
    
    if not clip_paths:
        raise HTTPException(500, "Aucun clip n'a pu être extrait")
    
    # Upload individuel de chaque clip
    result_urls = []
    for clip_path, clip_info in zip(clip_paths, output_urls):
        upload_res = await upload_video(
            f"export_{job_id}_{clip_info['segment_id'][:8]}",
            clip_path,
            filename=f"clip_{clip_info['segment_id'][:8]}_{body.format.replace(':', 'x')}.mp4",
        )
        if upload_res:
            clip_info["url"] = upload_res["storage_url"]
            result_urls.append(clip_info)
    
    # Concaténation optionnelle
    concat_url = None
    if body.concat and len(clip_paths) > 1:
        concat_path = tmp / "concat.mp4"
        ok = await asyncio.to_thread(concat_clips, clip_paths, concat_path, normalize=True)
        if ok and concat_path.exists():
            upload_res = await upload_video(
                f"export_{job_id}_concat",
                concat_path,
                filename=f"concat_{body.format.replace(':', 'x')}.mp4",
            )
            if upload_res:
                concat_url = upload_res["storage_url"]
    
    # Nettoyage
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)
    
    return {
        "status":         "done",
        "clips":          result_urls,
        "concat_url":     concat_url,
        "format":         body.format,
        "clip_count":     len(result_urls),
        "total_duration": sum(c["duration"] for c in result_urls),
    }


@router.put("/{job_id}/segments/{segment_id}/reorder")
async def reorder_segment(
    job_id: str,
    segment_id: str,
    body: ReorderRequest,
    user=Depends(get_current_user_optional),
):
    """
    Met à jour l'ordre personnalisé d'un segment.
    - Met à jour custom_order
    - Validation : ordres uniques par job
    """
    try:
        jid = uuid.UUID(job_id)
        seg_id = uuid.UUID(segment_id)
    except ValueError:
        raise HTTPException(400, "ID invalide")
    
    # Valider que new_order est positif
    if body.new_order < 0:
        raise HTTPException(400, "custom_order doit être >= 0")
    
    async with get_conn() as conn:
        # Vérifier unicité (sauf pour ce segment)
        duplicate = await conn.fetchrow(
            """
            SELECT id FROM transcription_segments
            WHERE job_id=$1 AND custom_order=$2 AND id!=$3
            """,
            jid, body.new_order, seg_id,
        )
        if duplicate:
            raise HTTPException(400, "custom_order déjà utilisé par un autre segment")
        
        # Vérifier l'existence du segment
        seg = await conn.fetchrow(
            """
            SELECT id FROM transcription_segments 
            WHERE id=$1 AND job_id=$2
            """,
            seg_id, jid,
        )
        if not seg:
            raise HTTPException(404, "Segment introuvable pour ce job")
        
        # Mettre à jour l'ordre
        await conn.execute(
            """
            UPDATE transcription_segments
            SET custom_order=$1
            WHERE id=$2
            """,
            body.new_order, seg_id,
        )
    
    return {
        "segment_id": segment_id,
        "new_order": body.new_order,
        "message": "Ordre mis à jour",
    }


# ── Segments traduits ─────────────────────────────────────────────────────────

@router.get("/{job_id}/translate")
async def get_translated_segments(
    job_id: uuid.UUID,
    source: str = None,
    target: str = None,
    user=Depends(get_current_user_optional),
):
    """
    Retourne les segments de sous-titres traduits pour un job.
    """
    # Convertir job_id en UUID
    try:
        jid = uuid.UUID(str(job_id))
    except ValueError:
        raise HTTPException(400, "job_id invalide")
    
    async with get_conn() as conn:
        # Vérifier que le job existe et que l'utilisateur y a accès
        if user:
            # Utilisateur authentifié : vérifier qu'il est propriétaire
            row = await conn.fetchrow(
                """
                SELECT id FROM jobs 
                WHERE id=$1 AND (user_id=$2 OR user_id IS NULL)
                """,
                jid,
                uuid.UUID(user["id"]) if user else None,
            )
        else:
            # Utilisateur non authentifié : vérifier que le job est public (pas de user_id)
            row = await conn.fetchrow(
                "SELECT id FROM jobs WHERE id=$1 AND user_id IS NULL",
                jid,
            )
        
        if not row:
            raise HTTPException(404, "Job introuvable ou accès non autorisé")
        
        # Récupérer les segments traduits
        segments = await conn.fetch(
            """
            SELECT 
                id,
                start_time,
                end_time,
                original_text,
                translated_text,
                style
            FROM transcription_segments
            WHERE job_id=$1
            ORDER BY start_time ASC
            """,
            jid,
        )
    
    # Convertir au format attendu par le frontend
    result = []
    for seg in segments:
        result.append({
            "id": str(seg["id"]),
            "startTime": float(seg["start_time"]),
            "endTime": float(seg["end_time"]),
            "text": seg["original_text"] or "",
            "translation": seg["translated_text"] or "",
            "style": seg["style"] or {},
        })
    
    return {"segments": result}


@router.put("/{job_id}/segments/{segment_id}")
async def update_segment(
    job_id: str,
    segment_id: str,
    body: UpdateSegmentRequest,
    user=Depends(get_current_user_optional),
):
    """Met à jour un segment de transcription/traduction."""
    try:
        jid = uuid.UUID(job_id)
        seg_id = uuid.UUID(segment_id)
    except ValueError:
        raise HTTPException(400, "ID invalide")

    async with get_conn() as conn:
        # Vérifier que le segment appartient au job
        seg = await conn.fetchrow(
            """
            SELECT id FROM transcription_segments 
            WHERE id=$1 AND job_id=$2
            """,
            seg_id, jid,
        )
        if not seg:
            raise HTTPException(404, "Segment introuvable pour ce job")

        # Mettre à jour
        await conn.execute(
            """
            UPDATE transcription_segments 
            SET translated_text=$1, 
                start_time=$2, 
                end_time=$3,
                is_edited=True
            WHERE id=$4
            """,
            body.translation,
            body.start_time,
            body.end_time,
            seg_id,
        )

        # Récupérer le segment mis à jour
        updated = await conn.fetchrow(
            """
            SELECT id, start_time, end_time, original_text, translated_text, is_edited
            FROM transcription_segments WHERE id=$1
            """,
            seg_id,
        )

    return {
        "id": str(updated["id"]),
        "startTime": updated["start_time"],
        "endTime": updated["end_time"],
        "text": updated["original_text"],
        "translation": updated["translated_text"],
        "isEdited": updated["is_edited"],
    }


# ── Transcription/Segments ─────────────────────────────────────────────────────

@router.get("/{job_id}/transcription")
async def get_job_transcription(
    job_id: str,
    user=Depends(get_current_user_optional),
):
    """Retourne les segments de transcription/traduction pour un job."""
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(400, "job_id invalide")

    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            SELECT status, summary, source_lang, target_lang
            FROM jobs WHERE id=$1
            """,
            jid,
        )

    if not row:
        raise HTTPException(404, "Job introuvable")

    # Récupérer les segments depuis la base de données
    async with get_conn() as conn:
        segments_rows = await conn.fetch(
            """
            SELECT id, start_time as "startTime", end_time as "endTime",
                   original_text as text, translated_text as translation,
                   style, is_edited as isEdited
            FROM transcription_segments 
            WHERE job_id=$1 
            ORDER BY start_time
            """,
            jid,
        )

    # Transformer les résultats en format attendu par le frontend
    segments = []
    for seg in segments_rows:
        segments.append({
            "id": str(seg["id"]),
            "startTime": seg["startTime"],
            "endTime": seg["endTime"],
            "text": seg["text"],
            "translation": seg["translation"],
            "style": seg["style"] or {
                "fontFamily": "Arial, sans-serif",
                "fontSize": 24,
                "color": "#ffffff",
                "backgroundColor": "rgba(0, 0, 0, 0.8)",
                "shadow": "0 2px 4px rgba(0, 0, 0, 0.5)",
                "border": "1px solid rgba(255, 255, 255, 0.2)",
                "borderRadius": "4px"
            }
        })

    return {
        "job_id": job_id,
        "status": row["status"],
        "source_lang": row["source_lang"] or "en",
        "target_lang": row["target_lang"] or "fr",
        "summary": row["summary"],
        "segments": segments,
        "duration": 120,  # Durée simulée
    }


# ── Soumission ────────────────────────────────────────────────────────────────

@router.post("/submit")
async def submit_job(
    body: JobSubmitRequest,
    user=Depends(get_current_user_optional),
):
    """Soumet une nouvelle vidéo à traduire ou télécharger."""
    
    # Validation du mode
    if body.mode not in ("download", "translate"):
        raise HTTPException(400, "Mode invalide. Doit être 'download' ou 'translate'")
    
    # Validation de la langue si mode translate
    if body.mode == "translate":
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

        # ── Cache : URL + langue déjà traduite (public ou pour cet user) ──────
        if body.mode == "translate":
            existing = None
            if user_id:
                # D'abord ses propres jobs
                existing = await conn.fetchrow(
                    """
                    SELECT id FROM jobs
                    WHERE source_url=$1 AND target_lang=$2 AND user_id=$3 AND status='done'
                    ORDER BY created_at DESC LIMIT 1
                    """,
                    url, body.target_lang, uuid.UUID(user_id),
                )
            if not existing:
                # Fallback : jobs publics (aucun user_id) ou anonymes
                existing = await conn.fetchrow(
                    """
                    SELECT id FROM jobs
                    WHERE source_url=$1 AND target_lang=$2 AND user_id IS NULL AND status='done'
                    ORDER BY created_at DESC LIMIT 1
                    """,
                    url, body.target_lang,
                )
            if existing:
                return {
                    "job_id":         str(existing["id"]),
                    "status":         "done",
                    "cached":         True,
                    "queue_position": 0,
                }

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

        # ── Créer le job avec les nouvelles colonnes ───────────────────────────
        job_id = str(uuid.uuid4())
        download_only = body.mode == "download"
        
        await conn.execute(
            """
            INSERT INTO jobs (id, user_id, source_url, target_lang, status, 
                             download_only, mode, original_filename)
            VALUES ($1, $2, $3, $4, 'queued', $5, $6, $7)
            """,
            uuid.UUID(job_id),
            uuid.UUID(user_id) if user_id else None,
            url,
            body.target_lang if body.mode == "translate" else "none",
            download_only,
            body.mode,
            body.original_filename,
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
            "job_id":           job_id,
            "source_url":       url,
            "target_lang":      body.target_lang if body.mode == "translate" else "none",
            "user_id":          user_id or "anonymous",
            "download_only":    body.mode == "download",
            "original_filename": body.original_filename,
        },
        queue="video_processing",
    )

    return {
        "job_id":         job_id,
        "status":         "queued",
        "queue_position": queue_position,
        "mode":           body.mode,
        "download_only":  body.mode == "download",
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

    # Résoudre l'URL pour le frontend : utiliser /jobs/{id}/stream (sans /api/)
    # Next.js rewrite: /api/jobs/* → /jobs/* (backend)
    storage_url = row["storage_url"]
    if storage_url:
        # Retourner l'URL du endpoint streaming proxy (même pour les URLs distantes)
        storage_url = f"/jobs/{job_id}/stream"
    
    # Calculer les estimations de temps si la durée est disponible
    estimated_total_seconds = None
    estimated_burn_seconds = None
    duration_s = row["duration_s"]
    
    if duration_s is not None and row["status"] in ["transcribing", "translating", "burning", "uploading"]:
        try:
            from core.utils import estimate_processing_time
            estimates = estimate_processing_time(duration_s)
            estimated_total_seconds = estimates["estimated_total_seconds"]
            estimated_burn_seconds = estimates["estimated_burn_seconds"]
        except Exception:
            # En cas d'erreur, garder les valeurs None (pas d'estimation)
            pass

    return JobStatusResponse(
        job_id=str(row["id"]),
        status=row["status"],
        progress_pct=STATUS_PROGRESS.get(row["status"], 0),
        status_label=STATUS_LABEL.get(row["status"], row["status"]),
        error_msg=row["error_msg"],
        storage_url=storage_url,
        summary=row["summary"],
        source_lang=row["source_lang"],
        target_lang=row["target_lang"],
        duration_s=duration_s,
        video_type=row["video_type"],
        can_download=can_download,
        is_public=True,
        estimated_total_seconds=estimated_total_seconds,
        estimated_burn_seconds=estimated_burn_seconds,
    )


# ── Téléchargement ────────────────────────────────────────────────────────────

@router.get("/{job_id}/download")
async def download_job(job_id: str):
    """Télécharge la vidéo watermarkée en streaming (force le téléchargement)
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

    storage_url: str = row["storage_url"]

    # Incrémenter le compteur de téléchargements (fire & forget)
    try:
        async with get_conn() as conn:
            await conn.execute(
                "UPDATE jobs SET download_count = download_count + 1, updated_at = now() WHERE id=$1",
                jid,
            )
    except Exception:
        pass  # Ne pas bloquer le téléchargement si la mise à jour échoue

    filename = f"spottedyou-video-{str(job_id)[:8]}.mp4"
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Cache-Control": "no-cache",
    }

    # Cas 1 : URL distante (Supabase)
    if storage_url.startswith("http://") or storage_url.startswith("https://"):
        import httpx
        from fastapi.responses import StreamingResponse

        try:
            async def stream_video():
                async with httpx.AsyncClient(timeout=600.0, follow_redirects=True) as client:  # 10 min — vidéos lourdes (2h+)
                    async with client.stream("GET", storage_url) as resp:
                        resp.raise_for_status()
                        async for chunk in resp.aiter_bytes(chunk_size=65536):
                            yield chunk

            return StreamingResponse(
                stream_video(),
                media_type="video/mp4",
                headers=headers,
            )
        except Exception:
            # Fallback : redirection directe si le streaming échoue
            from fastapi.responses import RedirectResponse
            return RedirectResponse(url=storage_url, status_code=302)
    
    # Cas 2 : fichier local
    else:
        import os
        from fastapi.responses import FileResponse
        if not os.path.exists(storage_url):
            raise HTTPException(404, "Fichier vidéo introuvable")
        return FileResponse(
            path=storage_url,
            media_type="video/mp4",
            filename=filename,
            headers=headers,
        )


# ── Streaming vidéo locale (pour lecture frontend) ─────────────────────────────

@router.get("/{job_id}/stream")
async def stream_job(job_id: str):
    """Redirige vers l'URL Supabase pour la lecture vidéo.
    Supabase gère nativement les range requests et les CORS."""
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

    storage_url: str = row["storage_url"]

    # Cas 1 : URL distante (Supabase) → redirection simple vers l'URL Supabase
    if storage_url.startswith("http://") or storage_url.startswith("https://"):
        # Redirection directe, Supabase gère déjà les CORS et range requests
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=storage_url, status_code=302)

    # Cas 2 : fichier local (pour le dev)
    else:
        import os
        from fastapi.responses import FileResponse
        if not os.path.exists(storage_url):
            raise HTTPException(404, "Fichier vidéo introuvable")
        
        return FileResponse(
            path=storage_url,
            media_type="video/mp4",
            headers={
                "Cache-Control": "no-cache",
                "Accept-Ranges": "bytes",
            },
        )


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

    # Résoudre TOUTES les URLs en URLs de streaming proxy
    def _resolve_url(row_dict: dict) -> dict:
        url = row_dict.get("storage_url")
        job_id = str(row_dict["id"])
        if url:
            # Utiliser /jobs/{id}/stream (sans /api/) pour éviter la boucle de rewrite
            # Next.js rewrite: /api/jobs/* → /jobs/* (backend)
            row_dict["storage_url"] = f"/jobs/{job_id}/stream"
        return row_dict

    return [_resolve_url(dict(r)) for r in rows]
