"""
core/ip_limiter.py — Limitation par adresse IP pour les utilisateurs non connectés.
Active uniquement en production (APP_ENV=production).
Ignore les IP locales (127.0.0.1, ::1, 192.168.*, 10.*).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from core.config import settings
from core.db import get_conn


def is_production() -> bool:
    return settings.APP_ENV == "production"


def is_local_ip(ip: str) -> bool:
    """Retourne True si l'IP est locale (dev)."""
    return ip in ("127.0.0.1", "::1", "localhost") or ip.startswith(
        ("192.168.", "10.", "172.16.", "172.17.", "172.18.", "172.19.",
         "172.20.", "172.21.", "172.22.", "172.23.", "172.24.", "172.25.",
         "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31.")
    )


async def check_ip_quota(ip: str) -> dict:
    """
    Vérifie le quota IP pour les non-connectés.
    Retourne :
      - allowed: bool
      - used_s: secondes utilisées aujourd'hui
      - limit_s: limite en secondes (120 = 2 min)
    """
    if not is_production() or is_local_ip(ip):
        # Dev : pas de limite
        return {"allowed": True, "used_s": 0, "limit_s": 999999}

    limit_s = 120  # 2 minutes par IP par jour

    async with get_conn() as conn:
        # S'assurer que la table existe
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS ip_usage (
                id          BIGSERIAL PRIMARY KEY,
                ip_address  INET NOT NULL,
                used_s      FLOAT DEFAULT 0,
                date        DATE DEFAULT CURRENT_DATE,
                created_at  TIMESTAMPTZ DEFAULT now(),
                UNIQUE(ip_address, date)
            )
        """)

        row = await conn.fetchrow(
            """
            SELECT used_s FROM ip_usage
            WHERE ip_address = $1::inet AND date = CURRENT_DATE
            """,
            ip,
        )
        used_s = float(row["used_s"]) if row else 0.0

    return {
        "allowed": used_s < limit_s,
        "used_s": round(used_s, 1),
        "limit_s": limit_s,
    }


async def record_ip_usage(ip: str, duration_s: float) -> None:
    """Ajoute `duration_s` au compteur IP du jour."""
    if not is_production() or is_local_ip(ip):
        return

    async with get_conn() as conn:
        await conn.execute("""
            INSERT INTO ip_usage (ip_address, used_s, date)
            VALUES ($1::inet, $2, CURRENT_DATE)
            ON CONFLICT (ip_address, date)
            DO UPDATE SET used_s = ip_usage.used_s + EXCLUDED.used_s
            """,
            ip, duration_s,
        )