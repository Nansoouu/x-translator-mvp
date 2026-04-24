"""
api/subtitle_preview.py — Endpoint de prévisualisation des sous-titres
Permet de voir la taille/opacité avant génération.
"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.subtitle_config import SubtitleConfig, load_user_style_from_json

router = APIRouter(prefix="/subtitle-preview", tags=["subtitle"])


class SubtitlePreviewRequest(BaseModel):
    """Paramètres pour la prévisualisation."""
    width: int = 1280
    height: int = 720
    style: Optional[dict] = None  # style utilisateur au format dict
    style_json: Optional[str] = None  # style utilisateur au format JSON string
    sample_text: str = "Ceci est un exemple de sous-titre pour tester la taille et l'opacité."


class SubtitlePreviewResponse(BaseModel):
    """Réponse de prévisualisation."""
    font_size: int
    max_chars_per_line: int
    margins: dict
    background_opacity: int  # 0-100%
    background_color_hex: str  # format ASS
    text_color_hex: str  # format ASS
    is_vertical: bool
    ass_style_line: str
    sample_wrapped: str  # texte exemple avec wrapping
    estimated_lines: int


@router.post("/")
async def preview_subtitle(request: SubtitlePreviewRequest) -> SubtitlePreviewResponse:
    """
    Calcule les paramètres de sous-titres pour une résolution donnée
    et retourne un aperçu des résultats.
    """
    # Convertir le style au format dict
    user_style = None
    if request.style_json:
        user_style = load_user_style_from_json(request.style_json)
    elif request.style:
        user_style = request.style
    
    # Créer la configuration
    config = SubtitleConfig(request.width, request.height, user_style)
    
    # Calculer les valeurs
    font_size = config.calculate_font_size()
    max_chars = config.calculate_max_chars_per_line()
    margin_l, margin_r, margin_v = config.calculate_margins()
    
    # Calculer l'opacité du fond
    opacity_str = config.calculate_background_opacity()
    # Convertir &H{HEX}000000 en pourcentage
    try:
        opacity_hex = opacity_str[2:4]  # partie hex
        opacity_int = int(opacity_hex, 16)
        opacity_percent = int(opacity_int * 100 / 255)
    except Exception:
        opacity_percent = 90
    
    # Wrapper le texte exemple
    def smart_wrap(text: str, max_chars_per_line: int) -> str:
        import textwrap
        # Simple wrapping pour l'aperçu
        return textwrap.fill(text, max_chars_per_line)
    
    wrapped_text = smart_wrap(request.sample_text, max_chars)
    line_count = len(wrapped_text.split('\n'))
    
    return SubtitlePreviewResponse(
        font_size=font_size,
        max_chars_per_line=max_chars,
        margins={"left": margin_l, "right": margin_r, "bottom": margin_v},
        background_opacity=opacity_percent,
        background_color_hex=opacity_str,
        text_color_hex=config.calculate_text_color(),
        is_vertical=config.is_vertical,
        ass_style_line=config.to_ass_style(),
        sample_wrapped=wrapped_text,
        estimated_lines=line_count,
    )


@router.post("/generate-sample-ass")
async def generate_sample_ass(request: SubtitlePreviewRequest) -> dict:
    """
    Génère un fichier ASS complet avec un exemple de sous-titre.
    Utile pour tester le rendu FFmpeg.
    """
    from core.pipeline import _srt_to_ass
    
    # Créer un SRT exemple avec un seul segment
    sample_srt = """1
00:00:01,000 --> 00:00:05,000
{text}
""".format(text=request.sample_text)
    
    # Convertir le style
    user_style = None
    if request.style_json:
        user_style = load_user_style_from_json(request.style_json)
    elif request.style:
        user_style = request.style
    
    # Générer l'ASS
    ass_content = _srt_to_ass(
        sample_srt,
        vid_w=request.width,
        vid_h=request.height,
        user_style=user_style,
    )
    
    return {
        "ass_content": ass_content,
        "width": request.width,
        "height": request.height,
        "sample_text": request.sample_text,
    }


# Endpoint pour récupérer le style actuel d'un job
@router.get("/job/{job_id}/style")
async def get_job_subtitle_style(job_id: str) -> dict:
    """
    Récupère le style des sous-titres pour un job donné.
    Utilise le style du premier segment dans transcription_segments.
    """
    from core.db import get_conn
    import uuid
    
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(400, "job_id invalide")
    
    async with get_conn() as conn:
        segment = await conn.fetchrow(
            """
            SELECT style FROM transcription_segments 
            WHERE job_id=$1 AND style IS NOT NULL 
            LIMIT 1
            """,
            jid,
        )
    
    if not segment or not segment["style"]:
        # Retourner un style par défaut
        return {
            "font_size": 24,
            "font_family": "Arial",
            "color": "#FFFFFF",
            "background_opacity": 90,
            "alignment": "bottom",
        }
    
    style_data = segment["style"]
    if isinstance(style_data, str):
        try:
            style_data = json.loads(style_data)
        except Exception:
            style_data = {}
    
    return style_data


@router.post("/job/{job_id}/update-style")
async def update_job_subtitle_style(job_id: str, style: dict) -> dict:
    """
    Met à jour le style des sous-titres pour tous les segments d'un job.
    """
    from core.db import get_conn
    import uuid
    
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(400, "job_id invalide")
    
    # Valider le style
    if not isinstance(style, dict):
        raise HTTPException(400, "style doit être un dictionnaire")
    
    # Sauvegarder en JSON
    style_json = json.dumps(style)
    
    async with get_conn() as conn:
        updated = await conn.execute(
            """
            UPDATE transcription_segments 
            SET style=$1::jsonb
            WHERE job_id=$2
            """,
            style_json,
            jid,
        )
    
    return {
        "job_id": job_id,
        "updated": True,
        "style": style,
    }