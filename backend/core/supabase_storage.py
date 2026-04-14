"""
core/supabase_storage.py — Upload Supabase Storage — x-translator-mvp
Adapté depuis conflict-map. Bucket : "translated-videos"
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Optional
import httpx

from core.config import settings


def _get_supabase_config() -> tuple[str, str] | tuple[None, None]:
    url = settings.SUPABASE_URL
    key = settings.SUPABASE_SERVICE_KEY
    if url and key:
        return url.rstrip("/"), key
    return None, None


def is_supabase_enabled() -> bool:
    url, key = _get_supabase_config()
    return bool(url and key)


async def upload_video(
    job_id: str,
    video_source: "bytes | Path",
    filename: str = "output.mp4",
    content_type: str = "video/mp4",
) -> Optional[dict]:
    """
    Upload un fichier vidéo vers Supabase Storage.
    Accepte soit des bytes (petits fichiers) soit un Path (streaming, vidéos 2h+).
    Returns: { storage_key, storage_url, storage_size_bytes }
    """
    from pathlib import Path as _Path

    supabase_url, service_key = _get_supabase_config()
    if not supabase_url or not service_key:
        print("[storage] ⚠️  Supabase non configuré — upload skippé")
        return None

    if not video_source:
        return None

    now = datetime.now(timezone.utc)
    storage_key = f"videos/{now.year}/{now.month:02d}/{now.day:02d}/{job_id}/{filename}"
    bucket      = settings.SUPABASE_BUCKET
    upload_url  = f"{supabase_url}/storage/v1/object/{bucket}/{storage_key}"

    # ── Déterminer taille + contenu ───────────────────────────────────────────
    # Note : httpx.AsyncClient exige bytes ou async iterable.
    # On lit le fichier en bytes via un thread pour ne pas bloquer l'event loop.
    if isinstance(video_source, _Path):
        size    = video_source.stat().st_size
        content = await asyncio.to_thread(video_source.read_bytes)
    else:
        size    = len(video_source)
        content = video_source

    headers = {
        "Authorization": f"Bearer {service_key}",
        "Content-Type":  content_type,
        "Content-Length": str(size),
        "x-upsert": "true",
    }

    print(f"[storage] ⬆️  Upload → {storage_key} ({size / 1024 / 1024:.1f} MB)")

    # Timeout dynamique : 5 min + 1 min par 100 MB (minimum 5min, max 2h)
    dynamic_timeout = min(7200.0, max(300.0, 300.0 + (size / 1024 / 1024 / 100) * 60))
    print(f"[storage] ⏱  Timeout upload : {dynamic_timeout:.0f}s")

    try:
        async with httpx.AsyncClient(timeout=dynamic_timeout) as client:
            resp = await client.post(upload_url, content=content, headers=headers)

            if resp.status_code in (200, 201):
                public_url = f"{supabase_url}/storage/v1/object/public/{bucket}/{storage_key}"
                print(f"[storage] ✅ Upload réussi — {storage_key} ({size / 1024 / 1024:.1f} MB)")
                return {
                    "storage_key": storage_key,
                    "storage_url": public_url,
                    "storage_size_bytes": size,
                }
            else:
                print(f"[storage] ❌ Upload échoué HTTP {resp.status_code}: {resp.text[:300]}")
                return None

    except httpx.TimeoutException:
        print(f"[storage] ❌ Timeout upload job_id={job_id} (>{dynamic_timeout:.0f}s)")
        return None
    except Exception as e:
        print(f"[storage] ❌ Erreur: {e}")
        return None
