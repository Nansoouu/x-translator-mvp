#!/usr/bin/env python3
"""
scripts/translate_messages.py — Auto-traduction i18n via OpenRouter DeepSeek V3
Usage :
  cd x-translator-mvp
  OPENROUTER_API_KEY=sk-or-... python scripts/translate_messages.py

Lit frontend/messages/fr.json (source de vérité),
traduit dans 19 langues et écrit les fichiers {locale}.json.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import httpx

# ── Config ────────────────────────────────────────────────────────────────────
API_KEY      = os.environ.get("OPENROUTER_API_KEY", "")
MODEL        = "deepseek/deepseek-chat-v3-0324:free"
MESSAGES_DIR = Path(__file__).parent.parent / "frontend" / "messages"
SOURCE_LANG  = "fr"
SOURCE_FILE  = MESSAGES_DIR / "fr.json"

TARGET_LOCALES: list[tuple[str, str]] = [
    ("en", "English"),
    ("es", "Spanish"),
    ("de", "German"),
    ("it", "Italian"),
    ("pt", "Brazilian Portuguese"),
    ("ar", "Arabic"),
    ("ru", "Russian"),
    ("zh", "Simplified Chinese"),
    ("ja", "Japanese"),
    ("ko", "Korean"),
    ("tr", "Turkish"),
    ("nl", "Dutch"),
    ("pl", "Polish"),
    ("uk", "Ukrainian"),
    ("hi", "Hindi"),
    ("fa", "Persian (Farsi)"),
    ("he", "Hebrew"),
    ("vi", "Vietnamese"),
    ("id", "Indonesian"),
]

SYSTEM_PROMPT = """\
You are a professional software localization expert.
You translate JSON i18n message files accurately and naturally.

Rules:
- Translate ONLY the string VALUES, never the JSON keys.
- Preserve ALL placeholders exactly as-is: {count}, {n}, {plural}, {label}, {active}, {minutes}, etc.
- Preserve emojis, punctuation (→, …, •), and formatting exactly.
- Do NOT add or remove keys.
- Output ONLY valid JSON — no markdown, no explanation, no code fences.
"""


def flatten(obj: Any, prefix: str = "") -> dict[str, str]:
    """Aplatit un objet JSON imbriqué en clés pointées."""
    result: dict[str, str] = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            full_key = f"{prefix}.{k}" if prefix else k
            result.update(flatten(v, full_key))
    elif isinstance(obj, str):
        result[prefix] = obj
    return result


def unflatten(flat: dict[str, str]) -> Any:
    """Reconstruit l'objet imbriqué depuis les clés pointées."""
    result: dict = {}
    for key, value in flat.items():
        parts = key.split(".")
        d = result
        for part in parts[:-1]:
            d = d.setdefault(part, {})
        d[parts[-1]] = value
    return result


def translate_chunk(
    client: httpx.Client,
    chunk: dict[str, str],
    target_lang_name: str,
    source_lang: str = "French",
    retries: int = 3,
) -> dict[str, str]:
    """Envoie un batch de clés/valeurs à traduire via l'API OpenRouter."""
    source_json = json.dumps(chunk, ensure_ascii=False, indent=2)
    user_prompt = (
        f"Translate the following JSON values from {source_lang} to {target_lang_name}.\n"
        f"Output ONLY the translated JSON with the same keys:\n\n{source_json}"
    )

    for attempt in range(retries):
        try:
            resp = client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization":  f"Bearer {API_KEY}",
                    "Content-Type":   "application/json",
                    "HTTP-Referer":   "https://spottedyou.org",
                    "X-Title":        "SpottedYou Translator i18n",
                },
                json={
                    "model":    MODEL,
                    "messages": [
                        {"role": "system",  "content": SYSTEM_PROMPT},
                        {"role": "user",    "content": user_prompt},
                    ],
                    "temperature": 0.1,
                    "max_tokens":  4096,
                },
                timeout=60.0,
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"].strip()

            # Nettoyer les éventuels blocs markdown (```json ... ```)
            if content.startswith("```"):
                lines   = content.split("\n")
                content = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])

            translated: dict[str, str] = json.loads(content)

            # Vérifier que toutes les clés source sont présentes dans la traduction
            missing = set(chunk.keys()) - set(translated.keys())
            if missing:
                print(f"    ⚠️  Clés manquantes ({len(missing)}) — on garde l'original pour celles-ci")
                for k in missing:
                    translated[k] = chunk[k]

            return translated

        except json.JSONDecodeError as e:
            print(f"    ❌ JSON invalide (tentative {attempt+1}/{retries}): {e}")
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
        except httpx.HTTPStatusError as e:
            print(f"    ❌ HTTP {e.response.status_code}: {e.response.text[:200]}")
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
        except Exception as e:
            print(f"    ❌ Erreur inattendue (tentative {attempt+1}/{retries}): {e}")
            if attempt < retries - 1:
                time.sleep(2 ** attempt)

    # Fallback : retourner les valeurs source non traduites
    print(f"    ⚠️  Toutes les tentatives ont échoué — fallback sur source")
    return chunk


def translate_locale(
    client: httpx.Client,
    source_flat: dict[str, str],
    locale_code: str,
    locale_name: str,
    chunk_size: int = 40,
) -> dict[str, str]:
    """Traduit toutes les clés en plusieurs batches."""
    keys       = list(source_flat.keys())
    translated = {}
    chunks     = [dict(list(source_flat.items())[i:i+chunk_size])
                  for i in range(0, len(keys), chunk_size)]

    for idx, chunk in enumerate(chunks, 1):
        print(f"  Batch {idx}/{len(chunks)} ({len(chunk)} clés)…", end=" ", flush=True)
        result = translate_chunk(client, chunk, locale_name)
        translated.update(result)
        print("✅")
        if idx < len(chunks):
            time.sleep(0.5)  # Respecter le rate limit

    return translated


def main() -> None:
    if not API_KEY:
        print("❌ OPENROUTER_API_KEY manquant. Définissez la variable d'environnement.")
        sys.exit(1)

    if not SOURCE_FILE.exists():
        print(f"❌ Source introuvable : {SOURCE_FILE}")
        sys.exit(1)

    MESSAGES_DIR.mkdir(parents=True, exist_ok=True)

    print(f"📖 Lecture de {SOURCE_FILE.name}…")
    source_obj  = json.loads(SOURCE_FILE.read_text(encoding="utf-8"))
    source_flat = flatten(source_obj)
    print(f"   {len(source_flat)} clés à traduire\n")

    total = len(TARGET_LOCALES)

    with httpx.Client() as client:
        for i, (locale_code, locale_name) in enumerate(TARGET_LOCALES, 1):
            out_file = MESSAGES_DIR / f"{locale_code}.json"
            print(f"[{i:02d}/{total}] {locale_name} ({locale_code})…")

            translated_flat   = translate_locale(client, source_flat, locale_code, locale_name)
            translated_nested = unflatten(translated_flat)

            out_file.write_text(
                json.dumps(translated_nested, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print(f"  ✅ Écrit → {out_file.relative_to(MESSAGES_DIR.parent.parent)}\n")

    print(f"🎉 Traduction terminée — {total} langues générées dans {MESSAGES_DIR}")


if __name__ == "__main__":
    main()
