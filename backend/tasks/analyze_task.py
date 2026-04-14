"""
tasks/analyze_task.py — Celery task : analyse IA des moments forts — Studio
Pipeline :
  1. Récupère la vidéo source (depuis job existant ou télécharge l'URL)
  2. Réutilise la transcription si disponible, sinon re-transcrit via Groq
  3. Appelle DeepSeek V3 → JSON clips avec score, style, hashtags
  4. Stocke les clips en DB + met à jour le statut du projet
"""
from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path

from core.celery_app import celery_app


STUDIO_ANALYSIS_PROMPT = """Tu es un expert TikTok/Reels/Shorts 2026 spécialisé dans la création de contenu viral.
Analyse cette transcription vidéo et identifie entre 5 et 8 moments forts viraux.

Pour chaque moment, retourne un JSON strict (UNIQUEMENT le JSON, sans texte autour) :
{
  "clips": [
    {
      "start_s": float,
      "end_s": float,
      "score": int (0-100, potentiel viral),
      "hook_type": "question | shock | laugh | fact | story | emotion",
      "title": "titre ultra-court max 8 mots",
      "suggested_text": "texte exact à afficher sur la vidéo, max 2 lignes courtes",
      "caption_style": {
        "position": "bottom-center | top-center | lower-third",
        "animation": "pop-in | slide-up | typewriter | none",
        "font_size": "big | huge | medium",
        "color": "#FFFFFF | #FFFF00 | #FF69B4 | #00FFFF",
        "background": "semi-transparent-black | none"
      },
      "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
      "description": "description courte pour caption réseaux sociaux (max 120 chars)"
    }
  ]
}

Règles TikTok 2026 :
- Clips de 15 à 60 secondes idéalement (format Short/Reel optimal)
- Les 3 premières secondes = hook fort obligatoire
- Maximum 2 lignes de texte à la fois, lisible sur mobile
- Priorise : moments émotionnels, surprises, chiffres choc, questions directes, révélations
- Score 90-100 = viral garanti, 70-89 = très bon, 50-69 = correct
- Retourne UNIQUEMENT le JSON valide"""


async def _analyze(project_id: str) -> None:
    import yt_dlp
    from core.db import direct_connect
    from core.config import settings
    from core.openrouter import call_openrouter

    jid = uuid.UUID(project_id)

    async def _set_status(status: str, **kw):
        try:
            async with direct_connect() as conn:
                sets = ["status=$2", "updated_at=now()"]
                vals = [jid, status]
                idx = 3
                for k, v in kw.items():
                    sets.append(f"{k}=${idx}")
                    vals.append(v)
                    idx += 1
                await conn.execute(
                    f"UPDATE studio_projects SET {', '.join(sets)} WHERE id=$1", *vals
                )
        except Exception as e:
            print(f"[analyze_task] ⚠️  DB status update ignoré: {e}")

    try:
        # ── 1. Charger le projet ──────────────────────────────────────────────
        async with direct_connect() as conn:
            row = await conn.fetchrow(
                "SELECT source_url, source_job_id, transcript FROM studio_projects WHERE id=$1",
                jid,
            )
        if not row:
            raise RuntimeError("Projet introuvable")

        source_url    = row["source_url"]
        source_job_id = row["source_job_id"]
        transcript    = row["transcript"]

        await _set_status("analyzing")

        # ── 2. Récupérer / réutiliser la transcription ───────────────────────
        if not transcript and source_job_id:
            async with direct_connect() as conn:
                job_row = await conn.fetchrow(
                    "SELECT summary, source_url FROM jobs WHERE id=$1", source_job_id
                )
            if job_row:
                transcript = job_row["summary"] or ""
                if not source_url:
                    source_url = job_row["source_url"]

        if not transcript and source_url:
            # Télécharge + transcrit si pas encore disponible
            tmp = Path(settings.LOCAL_TEMP_DIR) / f"studio_{project_id}"
            tmp.mkdir(parents=True, exist_ok=True)
            source_mp4 = tmp / "source.mp4"

            ydl_opts = {
                "format": "bestvideo[height<=720]+bestaudio/best",
                "merge_output_format": "mp4",
                "outtmpl": str(tmp / "source.%(ext)s"),
                "quiet": True,
                "no_warnings": True,
                "format_sort": ["res:720", "ext:mp4:m4a"],
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(source_url, download=True)
                title = info.get("title", "") if info else ""

            candidates = list(tmp.glob("source.*"))
            if candidates:
                dl = sorted(candidates, key=lambda p: p.stat().st_size, reverse=True)[0]
                if dl != source_mp4:
                    dl.rename(source_mp4)

            if source_mp4.exists():
                from core.pipeline import _transcribe_via_groq
                srt_out = tmp / "source.srt"
                txt_out = tmp / "transcript.txt"
                result = await asyncio.to_thread(
                    _transcribe_via_groq, source_mp4, srt_out, txt_out, settings.GROQ_API_KEY or ""
                )
                if result:
                    transcript = result.get("text", "") or ""
                    if title:
                        await _set_status("analyzing", source_title=title)

        if not transcript:
            raise RuntimeError("Transcription indisponible pour ce projet")

        # Sauvegarde transcript en DB
        await _set_status("analyzing", transcript=transcript[:10000])

        # ── 3. Analyse IA — DeepSeek V3 ───────────────────────────────────────
        print(f"[analyze_task] 🧠 Analyse DeepSeek ({len(transcript)} chars)…")
        result = await call_openrouter(
            system_prompt=STUDIO_ANALYSIS_PROMPT,
            user_content=f"Transcription :\n{transcript[:6000]}",
            temperature=0.4,
            max_tokens=4096,
        )

        if not result or "clips" not in result:
            raise RuntimeError("L'IA n'a pas retourné de clips valides")

        clips = result["clips"]
        if not clips:
            raise RuntimeError("Aucun moment fort détecté")

        print(f"[analyze_task] ✅ {len(clips)} clips détectés")

        # ── 4. Sauvegarde clips en DB ─────────────────────────────────────────
        async with direct_connect() as conn:
            for clip in clips:
                caption_style = clip.get("caption_style") or {}
                hashtags = clip.get("hashtags") or []
                await conn.execute(
                    """
                    INSERT INTO studio_clips
                        (project_id, start_s, end_s, score, hook_type,
                         title, suggested_text, caption_style, hashtags, description)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                    """,
                    jid,
                    float(clip.get("start_s", 0)),
                    float(clip.get("end_s", 0)),
                    int(clip.get("score", 50)),
                    clip.get("hook_type", ""),
                    clip.get("title", ""),
                    clip.get("suggested_text", ""),
                    json.dumps(caption_style),
                    hashtags,
                    clip.get("description", ""),
                )

        await _set_status("ready")
        print(f"[analyze_task] 🎉 Projet {project_id} prêt")

    except Exception as e:
        print(f"[analyze_task] ❌ {e}")
        try:
            await _set_status("error", error_msg=str(e)[:500])
        except Exception:
            pass


@celery_app.task(name="tasks.analyze_task.analyze_video_task", bind=True, max_retries=1)
def analyze_video_task(self, project_id: str) -> None:
    """Celery task : analyse IA d'un projet Studio."""
    try:
        asyncio.run(_analyze(project_id))
    except Exception as exc:
        print(f"[analyze_task] ❌ Exception fatale: {exc}")
        raise self.retry(exc=exc, countdown=10) if self.request.retries < 1 else exc
