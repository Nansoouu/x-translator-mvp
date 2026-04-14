"""
core/celery_app.py — Instance Celery — x-translator-mvp
"""
from celery import Celery
from core.config import settings

celery_app = Celery(
    "x_translator",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=[
        "tasks.pipeline_task",
        "tasks.analyze_task",
        "tasks.export_task",
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
        "tasks.pipeline_task.process_video_task":    {"queue": "video_processing"},
        "tasks.analyze_task.analyze_video_task":     {"queue": "video_processing"},
        "tasks.export_task.export_clips_task":       {"queue": "video_processing"},
    },
)
