"""
processors.py - Fonctions LLM locales simples
Génération résumé et traduction SRT avec Ollama.
"""
from .client import LocalLLMClient
from .prompts import (
    SUMMARY_SYSTEM_PROMPT,
    TRANSLATE_SRT_SYSTEM_PROMPT,
    TRANSLATE_SRT_USER_PROMPT,
)
from typing import Optional

# Client global simple
llm_client = LocalLLMClient(
    model="qwen3-14b:latest",
    temperature=0.25,
    max_tokens=8192,
)


async def generate_summary(text: str, target_lang: str = "français") -> str:
    """Génère un résumé avec Ollama local - retourne chaîne vide si échec"""
    if not text or len(text.strip()) < 30:
        return ""

    prompt = f"Résume cette transcription vidéo de façon claire et concise :\n\n{text}"
    system = SUMMARY_SYSTEM_PROMPT.format(target_lang=target_lang)

    try:
        summary = await llm_client.generate(prompt, system_prompt=system)
        return summary if summary else ""
    except Exception as e:
        print(f"[LLM Summary] Erreur Ollama : {e}")
        return ""


async def translate_srt(
    srt_content: str,
    source_lang: str,
    target_lang: str,
    context: Optional[dict] = None,  # Gardé pour compatibilité, ignoré pour Ollama
) -> str:
    """Traduit un fichier SRT avec Ollama local - retourne original si échec"""
    if not srt_content or len(srt_content.strip()) < 20 or source_lang == target_lang:
        return srt_content

    system = TRANSLATE_SRT_SYSTEM_PROMPT.format(
        source_lang=source_lang,
        target_lang=target_lang
    )
    user_prompt = TRANSLATE_SRT_USER_PROMPT.format(srt_content=srt_content)

    try:
        translated = await llm_client.generate(user_prompt, system_prompt=system)
        # Validation basique : vérifier que c'est un SRT valide
        if translated and (" --> " in translated or "\n00:" in translated):
            print(f"[LLM Translate] Succès Ollama ({len(translated)} caractères)")
            return translated
        return srt_content
    except Exception as e:
        print(f"[LLM Translate] Erreur Ollama : {e}")
        return srt_content