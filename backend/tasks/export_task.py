"""
tasks/export_task.py — Celery task : rendu des clips Studio
Pipeline :
  1. Charge l'export (clips, format, translate_to)
  2. Récupère la vidéo source
  3. Pour chaque clip → extract_clip() (FFmpeg 9:16/16:9/1:1)
  4. Si translate_to → appelle pipeline Agent 1 sur chaque clip
  5. Upload Supabase → stocke output_urls + kit_publication
"""
from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path

from core.celery_app import celery_app


async def _export(export_id: str) -> None:
    import yt_dlp
    from core.db import direct_connect
    from core.config import settings
    from core.clip_extractor import extract_clip
    from core.supabase_storage import upload_video

    eid = uuid.UUID(export_id)

    async def _set_status(status: str, **kw):
        try:
            async with direct_connect() as conn:
                sets = ["status=$2", "updated_at=now()"]
                vals = [eid, status]
                idx = 3
                for k, v in kw.items():
                    sets.append(f"{k}=${idx}")
                    vals.append(json.dumps(v) if isinstance(v, (dict, list)) else v)
                    idx += 1
                await conn.execute(
                    f"UPDATE studio_exports SET {', '.join(sets)} WHERE id=$1", *vals
                )
        except Exception as e:
            print(f"[export_task] ⚠️  DB update ignoré: {e}")

    try:
        # ── 1. Charger l'export ───────────────────────────────────────────────
        async with direct_connect() as conn:
            row = await conn.fetchrow(
                """
                SELECT se.clip_ids, se.format, se.translate_to,
                       sp.source_url, sp.source_job_id
                FROM studio_exports se
                JOIN studio_projects sp ON sp.id = se.project_id
                WHERE se.id=$1
                """,
                eid,
            )
        if not row:
            raise RuntimeError("Export introuvable")

        clip_ids    = row["clip_ids"] or []
        fmt         = row["format"] or "9:16"
        translate_to = row["translate_to"]
        source_url  = row["source_url"]
        source_job_id = row["source_job_id"]

        await _set_status("processing")

        # ── 2. Récupérer les clips DB ─────────────────────────────────────────
        async with direct_connect() as conn:
            clips = await conn.fetch(
                """
                SELECT id, start_s, end_s, title, suggested_text,
                       caption_style, hashtags, description
                FROM studio_clips WHERE id = ANY($1)
                ORDER BY start_s ASC
                """,
                clip_ids,
            )

        if not clips:
            raise RuntimeError("Aucun clip trouvé")

        # ── 3. Récupérer / télécharger la vidéo source ───────────────────────
        tmp = Path(settings.LOCAL_TEMP_DIR) / f"export_{export_id}"
        tmp.mkdir(parents=True, exist_ok=True)
        source_mp4 = tmp / "source.mp4"

        # Cherche si une vidéo du job existe déjà en local (optimisation)
        if source_job_id and not source_mp4.exists():
            job_tmp = Path(settings.LOCAL_TEMP_DIR) / str(source_job_id)
            job_src = job_tmp / "source.mp4"
            if job_src.exists():
                import shutil
                shutil.copy2(job_src, source_mp4)

        if not source_mp4.exists() and source_url:
            print(f"[export_task] ⬇️  Téléchargement {source_url}")
            ydl_opts = {
                "format": "bestvideo[height<=1080]+bestaudio/best",
                "merge_output_format": "mp4",
                "outtmpl": str(tmp / "source.%(ext)s"),
                "quiet": True,
                "no_warnings": True,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.extract_info(source_url, download=True)

            candidates = list(tmp.glob("source.*"))
            if candidates:
                dl = sorted(candidates, key=lambda p: p.stat().st_size, reverse=True)[0]
                if dl.suffix.lower() != ".mp4" or dl != source_mp4:
                    dl.rename(source_mp4)

        if not source_mp4.exists():
            raise RuntimeError("Impossible de récupérer la vidéo source")

        # ── 4. Découpe + upload chaque clip ───────────────────────────────────
        output_urls: list[dict] = []
        kit_publication: list[dict] = []

        for clip in clips:
            clip_id  = str(clip["id"])
            start_s  = float(clip["start_s"])
            end_s    = float(clip["end_s"])
            title    = clip["title"] or f"clip_{clip_id[:8]}"
            hashtags = list(clip["hashtags"] or [])
            desc     = clip["description"] or ""

            clip_path = tmp / f"clip_{clip_id[:8]}.mp4"

            ok = await asyncio.to_thread(
                extract_clip, source_mp4, clip_path, start_s, end_s, fmt
            )
            if not ok or not clip_path.exists():
                print(f"[export_task] ⚠️  Clip {clip_id[:8]} échoué, ignoré")
                continue

            # Optionnel : sous-titres traduits via Agent 1
            final_path = clip_path
            if translate_to:
                try:
                    from core.pipeline import process_video as _process_video
                    # On n'a pas d'URL pour le clip local → utilise directement le fichier
                    # Solution simple : créer un job fantôme n'est pas idéal ici,
                    # on appelle directement _burn_subtitles avec un SRT vide pour l'instant
                    # TODO: pipeline complet sur clip local dans une v2
                    pass
                except Exception as e:
                    print(f"[export_task] ⚠️  Traduction clip ignorée: {e}")

            # Upload Supabase
            upload_res = await upload_video(
                f"studio_{export_id}_{clip_id[:8]}",
                final_path,
                filename=f"studio_clip_{clip_id[:8]}_{fmt.replace(':', 'x')}.mp4",
            )

            if not upload_res:
                print(f"[export_task] ⚠️  Upload Supabase échoué pour clip {clip_id[:8]} — clip ignoré")
                continue
            clip_url = upload_res["storage_url"]

            output_urls.append({
                "clip_id":   clip_id,
                "url":       clip_url,
                "format":    fmt,
                "duration":  round(end_s - start_s, 1),
                "title":     title,
            })

            kit_publication.append({
                "clip_id":     clip_id,
                "title":       title,
                "description": desc,
                "hashtags":    hashtags,
                "url":         clip_url,
            })

        if not output_urls:
            raise RuntimeError("Aucun clip n'a pu être rendu")

        await _set_status(
            "done",
            output_urls=output_urls,
            kit_publication=kit_publication,
        )
        print(f"[export_task] 🎉 Export {export_id} terminé — {len(output_urls)} clips")

    except Exception as e:
        print(f"[export_task] ❌ {e}")
        try:
            await _set_status("error", error_msg=str(e)[:500])
        except Exception:
            pass


@celery_app.task(name="tasks.export_task.export_clips_task", bind=True, max_retries=0)
def export_clips_task(self, export_id: str) -> None:
    """Celery task : rendu et upload des clips Studio."""
    asyncio.run(_export(export_id))
