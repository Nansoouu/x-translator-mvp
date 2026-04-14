"""
tasks/recovery_task.py — Récupération automatique des jobs en erreur
Déclenchement :
  1. Au démarrage du worker (signal worker_ready)
  2. Périodiquement via Celery Beat (toutes les 10 minutes)

Logique :
  - Jobs pipeline (table jobs) : status='error' → requeue si retry_count < 3
  - Projets Studio (table studio_projects) : status='error' → requeue si retry_count < 3
  - Incrémente retry_count à chaque relance pour éviter les boucles infinies
"""
from __future__ import annotations

import asyncio
import uuid

from core.celery_app import celery_app


# ── Colonnes retry_count — créées par schema.sql (migration) ─────────────────
# ALTER TABLE jobs              ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0;
# ALTER TABLE studio_projects   ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0;
MAX_RETRIES = 3


async def _reset_errors() -> dict:
    from core.db import direct_connect

    stats = {"jobs_requeued": 0, "studio_requeued": 0}

    async with direct_connect() as conn:
        # ── 1. Jobs de traduction en erreur (max MAX_RETRIES) ─────────────────
        error_jobs = await conn.fetch(
            """
            SELECT id, target_lang, COALESCE(retry_count, 0) AS retry_count
            FROM jobs
            WHERE status = 'error'
              AND COALESCE(retry_count, 0) < $1
            ORDER BY created_at ASC
            LIMIT 50
            """,
            MAX_RETRIES,
        )

        for row in error_jobs:
            job_id    = str(row["id"])
            new_count = row["retry_count"] + 1
            await conn.execute(
                "UPDATE jobs SET status='queued', error_msg=NULL, retry_count=$1, updated_at=now() WHERE id=$2",
                new_count, row["id"],
            )
            # Re-dispatch la tâche Celery
            from tasks.pipeline_task import process_video_task
            process_video_task.apply_async(
                kwargs={"job_id": job_id},
                queue="video_processing",
            )
            print(f"[recovery] 🔄 Job {job_id[:8]} remis en file (essai {new_count}/{MAX_RETRIES})")
            stats["jobs_requeued"] += 1

        # ── 2. Projets Studio en erreur ───────────────────────────────────────
        error_projects = await conn.fetch(
            """
            SELECT id, COALESCE(retry_count, 0) AS retry_count
            FROM studio_projects
            WHERE status = 'error'
              AND COALESCE(retry_count, 0) < $1
            ORDER BY created_at ASC
            LIMIT 20
            """,
            MAX_RETRIES,
        )

        for row in error_projects:
            project_id = str(row["id"])
            new_count  = row["retry_count"] + 1
            await conn.execute(
                "UPDATE studio_projects SET status='queued', error_msg=NULL, retry_count=$1, updated_at=now() WHERE id=$2",
                new_count, row["id"],
            )
            from tasks.analyze_task import analyze_video_task
            analyze_video_task.apply_async(
                kwargs={"project_id": project_id},
                queue="video_processing",
            )
            print(f"[recovery] 🔄 Studio {project_id[:8]} remis en file (essai {new_count}/{MAX_RETRIES})")
            stats["studio_requeued"] += 1

    total = stats["jobs_requeued"] + stats["studio_requeued"]
    if total:
        print(f"[recovery] ✅ {total} tâche(s) remise(s) en file — jobs={stats['jobs_requeued']} studio={stats['studio_requeued']}")
    else:
        print("[recovery] ✅ Aucune tâche en erreur à re-queuer")

    return stats


@celery_app.task(name="tasks.recovery_task.reset_error_jobs_task", bind=True, max_retries=0)
def reset_error_jobs_task(self) -> dict:
    """Celery Beat task + signal startup : re-queue les erreurs récupérables."""
    return asyncio.run(_reset_errors())
