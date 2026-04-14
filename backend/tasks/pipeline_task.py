"""
tasks/pipeline_task.py — Tâche Celery pipeline vidéo — x-translator-mvp
"""
import asyncio
from core.celery_app import celery_app


@celery_app.task(
    name="tasks.pipeline_task.process_video_task",
    bind=True,
    max_retries=1,
    default_retry_delay=60,
    time_limit=3600,
    soft_time_limit=3500,
    queue="video_processing",
)
def process_video_task(self, job_id: str, source_url: str, target_lang: str, user_id: str):
    """Enveloppe Celery pour le pipeline async process_video()."""
    # Reset du pool asyncpg : chaque task Celery crée un nouveau event loop
    # via asyncio.run(), le pool du run précédent serait lié à un loop fermé.
    import core.db as _db
    _db._pool = None

    from core.pipeline import process_video

    try:
        result = asyncio.run(process_video(job_id, source_url, target_lang, user_id))
        return result
    except Exception as exc:
        print(f"[celery] ❌ Task {job_id[:8]}… échouée: {exc}")
        raise self.retry(exc=exc)
