"""
backend/core/timeline_utils.py — Fonctions utilitaires pour l'éditeur de timeline
Gestion des ordres, génération SRT corrigé, etc. — x-translator-mvp
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Literal, Optional, TypedDict

from core.db import get_conn


# ─── Types ──────────────────────────────────────────────────────────────────

class Segment(TypedDict):
    """Représentation d'un segment de transcription."""
    id: uuid.UUID
    job_id: uuid.UUID
    start_time: float
    end_time: float
    original_text: str
    translated_text: str
    style: dict
    is_edited: bool
    custom_order: Optional[int]


class SrtEntry(TypedDict):
    """Représentation d'une entrée SRT."""
    index: int
    start_time: str  # "00:00:01,200"
    end_time: str    # "00:00:03,400"
    text: str


# ─── Gestion des ordres (custom_order) ──────────────────────────────────────

async def reorder_segments(job_id: uuid.UUID) -> bool:
    """
    Renumérote les custom_order des segments d'un job de 0 à N*10 (step 10).
    
    Utilise une transaction avec SELECT ... FOR UPDATE pour éviter les
    incohérences lors d'opérations concurrentes.
    
    Args:
        job_id: UUID du job
        
    Returns:
        True si réussite, False sinon
    """
    async with get_conn() as conn:
        try:
            async with conn.transaction():
                # Verrouiller les segments de ce job pour éviter les conflits
                segments = await conn.fetch(
                    """
                    SELECT id, custom_order
                    FROM transcription_segments
                    WHERE job_id = $1
                    ORDER BY custom_order NULLS LAST, start_time
                    FOR UPDATE
                    """,
                    job_id,
                )
                
                if not segments:
                    return True  # Aucun segment, rien à faire
                
                # Renumérotation avec step 10
                updates = []
                for i, seg in enumerate(segments):
                    new_order = i * 10
                    if seg["custom_order"] != new_order:
                        updates.append((seg["id"], new_order))
                
                if updates:
                    # Exécuter les updates en batch
                    for seg_id, new_order in updates:
                        await conn.execute(
                            """
                            UPDATE transcription_segments
                            SET custom_order = $1, updated_at = now()
                            WHERE id = $2
                            """,
                            new_order, seg_id,
                        )
                
                print(f"[timeline_utils] ✅ Réordonné {len(updates)} segments pour job {job_id}")
                return True
                
        except Exception as e:
            print(f"[timeline_utils] ❌ Erreur reorder_segments({job_id}): {e}")
            return False


async def get_segments_with_order(job_id: uuid.UUID) -> List[Segment]:
    """
    Récupère les segments d'un job triés par custom_order (NULLS LAST).
    
    Args:
        job_id: UUID du job
        
    Returns:
        Liste de segments triés
    """
    async with get_conn() as conn:
        rows = await conn.fetch(
            """
            SELECT 
                id, job_id, start_time, end_time,
                original_text, translated_text, style,
                is_edited, custom_order
            FROM transcription_segments
            WHERE job_id = $1
            ORDER BY custom_order NULLS LAST, start_time
            """,
            job_id,
        )
        
        return [
            {
                "id": row["id"],
                "job_id": row["job_id"],
                "start_time": float(row["start_time"]),
                "end_time": float(row["end_time"]),
                "original_text": row["original_text"],
                "translated_text": row["translated_text"],
                "style": row["style"] or {},
                "is_edited": bool(row["is_edited"]),
                "custom_order": row["custom_order"],
            }
            for row in rows
        ]


# ─── Génération SRT corrigé ─────────────────────────────────────────────────

def _time_to_srt(timestamp: float) -> str:
    """Convertit un timestamp en secondes en format SRT HH:MM:SS,mmm."""
    hours = int(timestamp // 3600)
    minutes = int((timestamp % 3600) // 60)
    seconds = int(timestamp % 60)
    milliseconds = int((timestamp - int(timestamp)) * 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{milliseconds:03d}"


def generate_corrected_srt(
    segments: List[Segment],
    mode: Literal["strict", "readable"] = "readable"
) -> str:
    """
    Génère un SRT corrigé à partir des segments (après édition/suppression).
    
    Modes:
        - strict: Garde la chronologie originale, même avec chevauchements
        - readable: Ajuste les durées (min 1.2s, max 5s) + pause entre segments
    
    Args:
        segments: Liste de segments (doivent être triés par custom_order/start_time)
        mode: Mode de génération
        
    Returns:
        Contenu SRT formaté
    """
    if not segments:
        return ""
    
    result = []
    
    if mode == "strict":
        # Mode strict: garde les timecodes originaux
        for i, seg in enumerate(segments, 1):
            start_str = _time_to_srt(seg["start_time"])
            end_str = _time_to_srt(seg["end_time"])
            text = seg["translated_text"] or seg["original_text"]
            
            result.append(f"{i}\n{start_str} --> {end_str}\n{text}\n")
    
    else:  # mode == "readable"
        # Mode readable: ajuste les durées pour lisibilité
        current_time = 0.0
        
        for i, seg in enumerate(segments, 1):
            # Durée originale
            orig_duration = seg["end_time"] - seg["start_time"]
            
            # Ajuster durée: min 1.2s, max 5s
            adjusted_duration = max(1.2, min(5.0, orig_duration))
            
            # Pause de 0.3s entre segments (sauf premier)
            if i > 1:
                current_time += 0.3
            
            start_str = _time_to_srt(current_time)
            end_str = _time_to_srt(current_time + adjusted_duration)
            text = seg["translated_text"] or seg["original_text"]
            
            result.append(f"{i}\n{start_str} --> {end_str}\n{text}\n")
            
            # Avancer le temps courant
            current_time += adjusted_duration
    
    return "\n".join(result)


# ─── Récupération SRT original ──────────────────────────────────────────────

def find_original_srt(job_id: uuid.UUID) -> Optional[Path]:
    """
    Cherche le SRT original capté par Whisper.
    
    Recherche dans:
        1. /tmp/{job_id}/source.srt
        2. storage/srt_backups/{job_id}.srt
        3. storage/tmp/{job_id}/source.srt
        
    Args:
        job_id: UUID du job
        
    Returns:
        Path du fichier SRT si trouvé, sinon None
    """
    job_str = str(job_id)
    possible_paths = [
        Path(f"/tmp/{job_str}/source.srt"),
        Path(f"storage/srt_backups/{job_str}.srt"),
        Path(f"storage/tmp/{job_str}/source.srt"),
        Path(f"tmp/{job_str}/source.srt"),
    ]
    
    for path in possible_paths:
        if path.exists():
            return path
    
    return None


async def get_original_srt_content(job_id: uuid.UUID) -> Optional[str]:
    """
    Récupère le contenu du SRT original.
    
    Args:
        job_id: UUID du job
        
    Returns:
        Contenu SRT ou None si non trouvé
    """
    srt_path = find_original_srt(job_id)
    if not srt_path:
        return None
    
    try:
        return srt_path.read_text(encoding="utf-8")
    except Exception as e:
        print(f"[timeline_utils] ❌ Erreur lecture SRT {job_id}: {e}")
        return None


# ─── Validation et helpers ──────────────────────────────────────────────────

def validate_segment_order(segments: List[Segment]) -> bool:
    """
    Valide que les custom_order sont uniques par job.
    
    Args:
        segments: Liste de segments
        
    Returns:
        True si valide, False sinon
    """
    if not segments:
        return True
    
    orders = [s["custom_order"] for s in segments if s["custom_order"] is not None]
    unique_orders = set(orders)
    
    # Vérifier unicité
    if len(orders) != len(unique_orders):
        return False
    
    # Vérifier qu'il n'y a pas de trous trop grands (optionnel)
    if orders:
        sorted_orders = sorted(orders)
        for i in range(1, len(sorted_orders)):
            if sorted_orders[i] - sorted_orders[i-1] > 100:  # trou suspect
                print(f"[timeline_utils] ⚠️  Trou dans les ordres: {sorted_orders[i-1]} → {sorted_orders[i]}")
    
    return True


async def get_next_order_position(job_id: uuid.UUID) -> int:
    """
    Calcule la prochaine position d'ordre disponible.
    
    Args:
        job_id: UUID du job
        
    Returns:
        Prochain custom_order disponible (multiple de 10)
    """
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            SELECT MAX(custom_order) as max_order
            FROM transcription_segments
            WHERE job_id = $1
            """,
            job_id,
        )
        
        max_order = row["max_order"] if row and row["max_order"] is not None else -10
        return max_order + 10