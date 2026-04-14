"""
core/supabase_storage.py — Upload Supabase Storage — x-translator-mvp
Adapté depuis conflict-map. Bucket : "translated-videos"
"""
from __future__ import annotations

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
    video_bytes: bytes,
    filename: str = "output.mp4",
    content_type: str = "video/mp4",
) -> Optional[dict]:
    """
    Upload un fichier vidéo vers Supabase Storage.
    Returns: { storage_key, storage_url, storage_size_bytes }
    """
    supabase_url, service_key = _get_supabase_config()
    if not supabase_url or not service_key:
        print("[storage] ⚠️  Supabase non configuré — upload skippé")
        return None

    if not video_bytes:
        return None

    now = datetime.now(timezone.utc)
    storage_key = f"videos/{now.year}/{now.month:02d}/{now.day:02d}/{job_id}/{filename}"
    bucket      = settings.SUPABASE_BUCKET
    upload_url  = f"{supabase_url}/storage/v1/object/{bucket}/{storage_key}"
    size        = len(video_bytes)

    headers = {
        "Authorization": f"Bearer {service_key}",
        "Content-Type": content_type,
        "x-upsert": "true",
    }

    print(f"[storage] ⬆️  Upload → {storage_key} ({size / 1024:.1f} KB)")

    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            resp = await client.post(upload_url, content=video_bytes, headers=headers)

            if resp.status_code in (200, 201):
                public_url = f"{supabase_url}/storage/v1/object/public/{bucket}/{storage_key}"
                print(f"[storage] ✅ Upload réussi — {storage_key}")
                return {
                    "storage_key": storage_key,
                    "storage_url": public_url,
                    "storage_size_bytes": size,
                }
            else:
                print(f"[storage] ❌ Upload échoué HTTP {resp.status_code}: {resp.text[:300]}")
                return None

    except httpx.TimeoutException:
        print(f"[storage] ❌ Timeout upload job_id={job_id}")
        return None
    except Exception as e:
        print(f"[storage] ❌ Erreur: {e}")
        return None
