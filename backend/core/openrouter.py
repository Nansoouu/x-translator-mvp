"""
core/openrouter.py — Client OpenRouter (DeepSeek V3) — x-translator-mvp
Extrait depuis conflict-map : uniquement la partie traduction SRT + résumé.
OSINT / géocodage / citations supprimés.
"""

import json
import re
import httpx
from typing import Any

from core.config import settings

# ── Modèles ───────────────────────────────────────────────
PRIMARY_MODEL  = "deepseek/deepseek-chat-v3-0324"
FALLBACK_MODEL = "mistralai/mistral-large"

OPENROUTER_URL     = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_TIMEOUT = 90.0

# ── Noms de langues pour le prompt (clés = ISO 639-1) ─────
SUBTITLE_LANG_NAMES: dict[str, str] = {
    "ar": "Arabic (Modern Standard Arabic, clear and natural)",
    "ru": "Russian",
    "fr": "French",
    "en": "English",
    "es": "Spanish",
    "de": "German",
    "zh": "Simplified Chinese",
    "pt": "Portuguese (European)",
    "tr": "Turkish",
    "uk": "Ukrainian",
    "fa": "Persian (Farsi, نوشته‌ی فارسی)",
    "he": "Hebrew (עברית)",
    "pl": "Polish",
    "it": "Italian",
    "nl": "Dutch",
    "ja": "Japanese (日本語, natural broadcast tone)",
    "ko": "Korean (한국어, natural broadcast tone)",
    "vi": "Vietnamese",
    "id": "Indonesian (Bahasa Indonesia)",
    "hi": "Hindi (हिन्दी, Devanagari script)",
    "ha": "Hausa",
}

# Langues à expansion forte (RTL/CJK) → max_tokens augmenté
_EXPANSION_LANGS = {"ar", "fa", "he", "zh", "ja", "ko", "hi"}

PROMPT_SUBTITLE_TRANSLATE = (
    "You are a professional subtitle translator.\n"
    "You receive a COMPLETE SRT subtitle file. Translate ALL text lines to {target_lang}.\n\n"
    "{context_block}"
    "STRICT rules:\n"
    "- Keep EVERY index number (lines like '1', '2', …) EXACTLY as-is.\n"
    "- Keep EVERY timestamp (lines like '00:00:01,000 --> 00:00:03,500') EXACTLY as-is.\n"
    "- Translate ONLY the text lines (lines that follow a timestamp).\n"
    "- Keep subtitles SHORT and screen-readable (≤ 42 characters per line preferred).\n"
    "- Do NOT translate proper nouns: people's names, operation names, organization names, country names.\n"
    "- Use natural, idiomatic {target_lang} — never literal word-for-word translation.\n"
    "- The output MUST have the SAME number of SRT blocks as the input.\n"
    "- MULTILINGUAL SOURCE: detect the actual language of EACH segment independently.\n"
    "  Translate EVERY segment to {target_lang} regardless of its source language.\n"
    "- Return ONLY the full translated SRT file content — no markdown, no commentary, no backticks."
)

PROMPT_SUMMARY = (
    "You are a professional video summarizer. "
    "Given the following video transcript, write a concise summary in {target_lang} in 2-3 sentences. "
    "Focus on the key information. Return ONLY the summary text, no markdown."
)


def _clean_json(raw: str) -> str:
    raw = raw.strip()
    # Enlever les balises markdown code
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    # Sanitize les valeurs JSON invalides (NaN, Infinity) → null
    raw = re.sub(r"\bNaN\b",       "null", raw)
    raw = re.sub(r"\bInfinity\b",  "null", raw)
    raw = re.sub(r"-\bInfinity\b", "null", raw)
    return raw.strip()


def _repair_truncated_json(raw: str) -> str:
    try:
        json.loads(raw)
        return raw
    except json.JSONDecodeError:
        open_braces   = raw.count("{") - raw.count("}")
        open_brackets = raw.count("[") - raw.count("]")
        if open_brackets > 0:
            raw += "]" * open_brackets
        if open_braces > 0:
            raw += "}" * open_braces
        return raw


def _count_srt_blocks(srt_text: str) -> int:
    if not srt_text:
        return 0
    return sum(1 for block in srt_text.strip().split("\n\n") if block.strip())


async def call_openrouter(
    system_prompt: str,
    user_content: str,
    model: str = PRIMARY_MODEL,
    timeout: float = OPENROUTER_TIMEOUT,
    temperature: float = 0.1,
    max_tokens: int = 1024,
) -> dict | list | None:
    """Appelle OpenRouter et retourne le JSON parsé."""
    api_key = getattr(settings, "OPENROUTER_API_KEY", None)
    if not api_key:
        return None

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://spottedyou.org",
        "X-Title": "SpottedYou Translator",
    }
    payload = {
        "model": model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_content},
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(OPENROUTER_URL, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
            raw_content = data["choices"][0]["message"]["content"]
            cleaned  = _clean_json(raw_content)
            repaired = _repair_truncated_json(cleaned)
            return json.loads(repaired)
    except Exception as e:
        print(f"[openrouter] ❌ {e}")
        return None


async def call_openrouter_text(
    system_prompt: str,
    user_content: str,
    model: str = PRIMARY_MODEL,
    timeout: float = OPENROUTER_TIMEOUT,
    temperature: float = 0.1,
    max_tokens: int = 512,
) -> str | None:
    """Retourne du texte brut (pas de JSON parse)."""
    api_key = getattr(settings, "OPENROUTER_API_KEY", None)
    if not api_key:
        return None

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://spottedyou.org",
        "X-Title": "SpottedYou Translator",
    }
    payload = {
        "model": model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_content},
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(OPENROUTER_URL, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            return content.strip() if content else None
    except Exception as e:
        print(f"[openrouter/text] ❌ {e}")
        return None


async def _call_translate_srt_raw(
    srt_content: str,
    target_name: str,
    src_lang: str,
    tgt_lang: str,
    context_block: str,
    model: str,
    api_key: str,
    max_tokens: int,
) -> str | None:
    """Appel HTTP unique pour la traduction SRT."""
    system_prompt = PROMPT_SUBTITLE_TRANSLATE.format(
        target_lang=target_name,
        context_block=context_block,
    )
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://spottedyou.org",
        "X-Title": "SpottedYou Translator",
    }
    payload = {
        "model": model,
        "temperature": 0.05,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": srt_content},
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(OPENROUTER_URL, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"].strip()
            content = re.sub(r"^```(?:srt)?\s*", "", content)
            content = re.sub(r"\s*```$", "", content)
            return content.strip()
    except Exception as e:
        print(f"[openrouter/srt] ❌ {src_lang}→{tgt_lang}: {e}")
        return None


async def translate_srt(
    srt_content: str,
    src_lang: str,
    tgt_lang: str,
    model: str = PRIMARY_MODEL,
    context: dict | None = None,
) -> str | None:
    """
    Traduit un fichier SRT COMPLET en un seul appel DeepSeek V3.
    Avec post-validation du nombre de blocs + retry si nécessaire.
    """
    api_key = getattr(settings, "OPENROUTER_API_KEY", None)
    if not api_key:
        return None

    # Même langue → retour immédiat
    if src_lang == tgt_lang:
        return srt_content

    target_name = SUBTITLE_LANG_NAMES.get(tgt_lang, tgt_lang)

    context_block = ""
    if context:
        parts = []
        if context.get("title"):
            parts.append(f"Video title: {context['title']}")
        if context.get("src_lang"):
            src_name = SUBTITLE_LANG_NAMES.get(src_lang, src_lang)
            parts.append(f"Source language: {src_name} ({src_lang})")
        if parts:
            context_block = "Context:\n" + "\n".join(f"  - {p}" for p in parts) + "\n\n"

    if tgt_lang in _EXPANSION_LANGS:
        max_tokens = max(4096, min(8192, len(srt_content)))
    else:
        max_tokens = max(2048, min(8192, len(srt_content) // 2))

    src_block_count = _count_srt_blocks(srt_content)

    content = await _call_translate_srt_raw(
        srt_content, target_name, src_lang, tgt_lang,
        context_block, model, api_key, max_tokens,
    )

    if not content:
        return None

    # Post-validation : cohérence du nombre de blocs
    tgt_block_count = _count_srt_blocks(content)
    block_ratio = tgt_block_count / max(1, src_block_count)

    if block_ratio < 0.8:
        print(
            f"[openrouter/srt] ⚠️  {src_lang}→{tgt_lang} : "
            f"{tgt_block_count}/{src_block_count} blocs ({block_ratio:.0%}) — retry"
        )
        retry_context = (context_block +
            "CRITICAL: The output MUST contain EXACTLY the same number of numbered "
            "blocks as the input. Do NOT merge, skip or add any block.\n\n"
        )
        content2 = await _call_translate_srt_raw(
            srt_content, target_name, src_lang, tgt_lang,
            retry_context, model, api_key, max_tokens,
        )
        if content2 and _count_srt_blocks(content2) >= tgt_block_count:
            content = content2

    print(
        f"[openrouter/srt] ✅ {src_lang}→{tgt_lang} "
        f"({_count_srt_blocks(content)}/{src_block_count} blocs, {len(content)} chars)"
    )
    return content


async def generate_summary(
    transcript: str,
    target_lang: str = "fr",
) -> str | None:
    """
    Génère un résumé de la transcription en 2-3 phrases dans la langue cible.
    """
    if not transcript or len(transcript.strip()) < 50:
        return None

    lang_name = SUBTITLE_LANG_NAMES.get(target_lang, target_lang)
    system_prompt = PROMPT_SUMMARY.format(target_lang=lang_name)

    return await call_openrouter_text(
        system_prompt=system_prompt,
        user_content=transcript[:3000],  # max 3000 chars pour garder l'appel rapide
        temperature=0.3,
        max_tokens=300,
    )
