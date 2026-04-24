"""
tasks/pipeline_task.py - Tache Celery pipeline video - x-translator-mvp
"""
import asyncio
import uuid
from core.celery_app import celery_app


async def _force_done_status(
    job_id: str,
    storage_url: str,
    storage_key: str,
    source_lang,
    thumbnail_url,
) -> None:
    """
    Force le statut 'done' en DB apres upload reussi.
    Appele depuis un nouveau asyncio.run() si pipeline.py n'a pas pu
    faire l'UPDATE (Event loop is closed dans le premier run).
    """
    from core.db import direct_connect
    try:
        async with direct_connect() as conn:
            await conn.execute(
                """
                UPDATE jobs SET
                    status        = 'done',
                    storage_key   = $2,
                    storage_url   = $3,
                    source_lang   = $4,
                    thumbnail_url = $5,
                    updated_at    = now()
                WHERE id = $1
                  AND status != 'done'
                """,
                uuid.UUID(job_id),
                storage_key,
                storage_url,
                source_lang,
                thumbnail_url,
            )
        print(f"[celery] DB status force -> 'done' pour {job_id[:8]}...")
    except Exception as e:
        print(f"[celery] _force_done_status echoue: {e}")


@celery_app.task(
    name="tasks.pipeline_task.process_video_task",
    bind=True,
    max_retries=2,
    default_retry_delay=300,
    # Vidéos longues (2h+) : download + burn Pillow + upload peuvent dépasser 5h
    # time_limit  → Celery kill hard après N secondes
    # soft_time_limit → SoftTimeLimitExceeded levée proprement
    time_limit=43200,       # 12h max absolu
    soft_time_limit=36000,  # 10h → permet de finir proprement
    queue="video_processing",
)
def process_video_task(self, job_id: str, source_url: str, target_lang: str, user_id: str, 
                       download_only: bool = False, original_filename: str | None = None):
    """Enveloppe Celery pour le pipeline async process_video()."""
    # Reset du pool asyncpg : chaque task Celery cree un nouveau event loop
    # via asyncio.run(), le pool du run precedent serait lie a un loop ferme.
    import core.db as _db
    _db._pool = None

    from core.pipeline import process_video

    try:
        # Si download_only, on adapte le pipeline
        if download_only:
            # Pour le mode download, on peut soit:
            # 1. Appeler une fonction spécifique (si elle existe)
            # 2. Appeler process_video avec target_lang = "none" (comme déjà fait)
            # Le pipeline gère déjà le mode "download" via target_lang="none"
            print(f"[celery] Mode download_only activé pour job {job_id[:8]}...")
        
        result = asyncio.run(process_video(job_id, source_url, target_lang, user_id))

        # Garantie DB : si pipeline.py n'a pas pu faire l'UPDATE final
        # (cas "Event loop is closed" a l'interieur du premier asyncio.run()),
        # on lance un deuxieme asyncio.run() dedie avec un pool frais.
        if result and result.get("storage_url") and not result.get("_db_update_ok"):
            print(f"[celery] DB non mise a jour par le pipeline - forcage...")
            _db._pool = None
            asyncio.run(
                _force_done_status(
                    job_id=job_id,
                    storage_url=result["storage_url"],
                    storage_key=result.get("storage_key", ""),
                    source_lang=result.get("source_lang"),
                    thumbnail_url=result.get("thumbnail_url"),
                )
            )

        return result

    except Exception as exc:
        retry_num = self.request.retries + 1
        print(f"[celery] Task {job_id[:8]}... echouee (essai {retry_num}/{self.max_retries + 1}): {exc}")
        # Remettre le job en 'queued' avant le retry pour que le frontend affiche "en attente"
        if retry_num <= self.max_retries:
            try:
                _db._pool = None
                async def _reset_status():
                    from core.db import direct_connect
                    async with direct_connect() as conn:
                        await conn.execute(
                            "UPDATE jobs SET status='queued', error_msg=$2, updated_at=now() WHERE id=$1",
                            uuid.UUID(job_id),
                            f"Retry {retry_num}/{self.max_retries}: {str(exc)[:200]}",
                        )
                asyncio.run(_reset_status())
            except Exception as db_exc:
                print(f"[celery] Reset status echoue: {db_exc}")
        raise self.retry(exc=exc, countdown=120 * retry_num)
