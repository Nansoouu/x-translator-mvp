"""
core/celery_app.py — Instance Celery — x-translator-mvp
"""
from celery import Celery
from celery.schedules import crontab
from core.config import settings

celery_app = Celery(
    "x_translator",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=[
        "tasks.pipeline_task",
        "tasks.analyze_task",
        "tasks.export_task",
        "tasks.recovery_task",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_routes={
        "tasks.pipeline_task.process_video_task":        {"queue": "video_processing"},
        "tasks.analyze_task.analyze_video_task":         {"queue": "video_processing"},
        "tasks.export_task.export_clips_task":           {"queue": "video_processing"},
        "tasks.recovery_task.reset_error_jobs_task":     {"queue": "video_processing"},
    },
    # ── Celery Beat : re-queue les erreurs toutes les 10 minutes ─────────────
    beat_schedule={
        "reset-error-jobs-every-10min": {
            "task":     "tasks.recovery_task.reset_error_jobs_task",
            "schedule": 600.0,   # secondes
        },
    },
)


# ── Signal worker_ready : re-queue au démarrage du worker ────────────────────
from celery.signals import worker_ready

@worker_ready.connect
def on_worker_ready(sender=None, **kwargs):
    """Relance les jobs en erreur dès que le worker est opérationnel."""
    # Uniquement sur le processus principal (évite les doublons fork)
    try:
        celery_app.send_task(
            "tasks.recovery_task.reset_error_jobs_task",
            queue="video_processing",
        )
        print("[celery] 🚀 Worker prêt — task de récupération d'erreurs envoyée")
    except Exception as e:
        print(f"[celery] ⚠️  Impossible d'envoyer la tâche de récupération : {e}")
