"""
backend/api/stats.py — Endpoints publics de compteurs et analytics
Toutes les stats sont calculées en temps réel depuis la base de données.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Request

from core.db import get_conn

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/counters")
async def get_public_counters():
    """
    Retourne les compteurs publics calculés depuis la DB :
      - total_videos        → vidéos terminées (done)
      - total_duration_s    → durée cumulée des vidéos terminées
      - unique_languages    → langues cibles distinctes utilisées
      - active_users_today  → users connectés dans les 24h
      - today_videos        → vidéos terminées aujourd'hui
      - trend               → ratio today / yesterday (pour animation)
    """
    async with get_conn() as conn:
        total_videos = await conn.fetchval(
            "SELECT COUNT(*) FROM jobs WHERE status='done'"
        ) or 0

        total_duration = await conn.fetchval(
            "SELECT COALESCE(SUM(duration_s), 0) FROM jobs WHERE status='done'"
        ) or 0.0

        unique_languages = await conn.fetchval(
            "SELECT COUNT(DISTINCT target_lang) FROM jobs WHERE status='done' AND target_lang != 'none'"
        ) or 0

        active_creators_today = await conn.fetchval(
            "SELECT COUNT(DISTINCT user_id) FROM jobs WHERE created_at > NOW() - INTERVAL '24 hours' AND user_id IS NOT NULL"
        ) or 0

        today_videos = await conn.fetchval(
            "SELECT COUNT(*) FROM jobs WHERE status='done' AND created_at > NOW() - INTERVAL '24 hours'"
        ) or 0

        yesterday_videos = await conn.fetchval(
            "SELECT COUNT(*) FROM jobs WHERE status='done' AND created_at > NOW() - INTERVAL '48 hours' AND created_at <= NOW() - INTERVAL '24 hours'"
        ) or 0

    active_users_today = active_creators_today

    trend = 0
    if yesterday_videos > 0:
        trend = round((today_videos - yesterday_videos) / yesterday_videos * 100, 1)

    return {
        "total_videos": total_videos,
        "total_duration_s": round(total_duration, 1),
        "unique_languages": unique_languages,
        "active_users_today": active_users_today,
        "today_videos": today_videos,
        "trend_pct": trend,
    }


@router.post("/cta-click")
async def record_cta_click(request: Request):
    """
    Enregistre un clic sur le CTA "Traduire" de la page d'accueil.
    Nécessite la table analytics_events (créée automatiquement si besoin).
    """
    ip = request.client.host
    async with get_conn() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS analytics_events (
                id          BIGSERIAL PRIMARY KEY,
                event_type  TEXT NOT NULL,
                ip_address  INET,
                created_at  TIMESTAMPTZ DEFAULT now()
            )
        """)
        await conn.execute(
            "INSERT INTO analytics_events (event_type, ip_address) VALUES ($1, $2::inet)",
            "cta_click",
            ip,
        )
    return {"ok": True}


@router.get("/daily-trend")
async def daily_trend():
    """
    Retourne le nombre de vidéos traitées par jour pour les 30 derniers jours.
    Utilisé pour le graphique d'évolution.
    """
    async with get_conn() as conn:
        rows = await conn.fetch("""
            SELECT
                DATE(created_at) AS day,
                COUNT(*)         AS count
            FROM jobs
            WHERE status='done'
              AND created_at > NOW() - INTERVAL '30 days'
            GROUP BY DATE(created_at)
            ORDER BY day ASC
        """)
    return {
        "days": [str(r["day"]) for r in rows],
        "counts": [r["count"] for r in rows],
    }