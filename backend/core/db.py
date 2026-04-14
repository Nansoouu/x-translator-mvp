"""
core/db.py — Pool asyncpg + connexion directe — x-translator-mvp
"""
from __future__ import annotations

import asyncpg
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from core.config import settings

_pool: asyncpg.Pool | None = None


async def init_pool() -> None:
    global _pool
    if _pool is not None:
        return
    # En prod Supabase : utiliser DATABASE_URL_POOLER (PgBouncer transaction mode)
    url = settings.DATABASE_URL_POOLER or settings.DATABASE_URL
    _pool = await asyncpg.create_pool(
        url,
        min_size=2,
        max_size=10,
        command_timeout=60,
        statement_cache_size=0,  # requis pour PgBouncer (Supabase) en mode transaction
    )
    print(f"[db] ✅ Pool asyncpg initialisé ({url[:40]}…)")


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


@asynccontextmanager
async def get_conn() -> AsyncGenerator[asyncpg.Connection, None]:
    global _pool
    if _pool is None:
        await init_pool()
    async with _pool.acquire() as conn:
        yield conn


@asynccontextmanager
async def direct_connect() -> AsyncGenerator[asyncpg.Connection, None]:
    """
    Connexion directe asyncpg (sans pool).
    Utilisée dans les tâches Celery pour éviter les conflits de boucle
    d'événements entre asyncio.run() et le pool singleton.
    """
    url = settings.DATABASE_URL_POOLER or settings.DATABASE_URL
    conn = await asyncpg.connect(url, statement_cache_size=0, command_timeout=60)
    try:
        yield conn
    finally:
        await conn.close()
