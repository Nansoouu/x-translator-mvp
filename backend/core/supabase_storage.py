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
    # Lecture streaming avec httpx pour éviter de charger tout en mémoire
    if isinstance(video_source, _Path):
        size = video_source.stat().st_size
        # Créer un générateur asynchrone pour streamer le fichier par chunks
        async def file_stream():
            chunk_size = 65536  # 64KB chunks
            with open(video_source, "rb") as f:
                while True:
                    chunk = f.read(chunk_size)
                    if not chunk:
                        break
                    yield chunk
        content = file_stream()
    else:
        size = len(video_source)
        # Pour les bytes, on les envoie directement
        content = video_source

    headers = {
        "Authorization": f"Bearer {service_key}",
        "Content-Type":  content_type,
        "x-upsert": "true",
    }
    # Ne pas mettre Content-Length si on stream (httpx le calcule automatiquement)
    # Pour les fichiers, httpx streamera sans Content-Length explicite

    print(f"[storage] ⬆️  Upload → {storage_key} ({size / 1024 / 1024:.1f} MB)")

    # Timeout dynamique : 5 min + 1 min par 100 MB (minimum 5min, max 2h)
    dynamic_timeout = min(7200.0, max(300.0, 300.0 + (size / 1024 / 1024 / 100) * 60))
    print(f"[storage] ⏱️  Timeout upload : {dynamic_timeout:.0f}s")

    try:
        async with httpx.AsyncClient(timeout=dynamic_timeout) as client:
            # Pour le streaming, on utilise .post avec content=content
            # httpx détectera que c'est un async generator et streamera
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
                error_detail = resp.text
                print(f"[storage] ❌ Upload échoué HTTP {resp.status_code}: {error_detail[:300]}")
                # Log supplémentaire pour debugging
                print(f"[storage] Debug: URL={upload_url}, size={size}, bucket={bucket}")
                return None

    except httpx.TimeoutException:
        print(f"[storage] ❌ Timeout upload job_id={job_id} (>{dynamic_timeout:.0f}s)")
        return None
    except httpx.TransportError as e:
        print(f"[storage] ❌ Erreur réseau: {e}")
        return None
    except Exception as e:
        print(f"[storage] ❌ Erreur inattendue: {e}")
        return None
