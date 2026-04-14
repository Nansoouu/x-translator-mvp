#!/usr/bin/env python3
"""
scripts/translate_messages.py — Auto-traduction i18n via Google Translate (gratuit)
Usage :
  cd x-translator-mvp
  python scripts/translate_messages.py

Lit frontend/messages/fr.json (source de vérité),
traduit dans 19 langues avec deep-translator (GoogleTranslator, aucune clé requise).

Installation : pip install deep-translator
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path
from typing import Any

# ── Config ────────────────────────────────────────────────────────────────────
MESSAGES_DIR = Path(__file__).parent.parent / "frontend" / "messages"
SOURCE_FILE  = MESSAGES_DIR / "fr.json"

# Correspondance locale interne → code Google Translate
# Note : Google utilise "iw" pour l'hébreu, "zh-CN" pour le chinois simplifié
TARGET_LOCALES: list[tuple[str, str, str]] = [
    # (locale_fichier, code_google, nom_lisible)
    ("en",  "en",    "English"),
    ("es",  "es",    "Spanish"),
    ("de",  "de",    "German"),
    ("it",  "it",    "Italian"),
    ("pt",  "pt",    "Brazilian Portuguese"),
    ("ar",  "ar",    "Arabic"),
    ("ru",  "ru",    "Russian"),
    ("zh",  "zh-CN", "Chinese (Simplified)"),
    ("ja",  "ja",    "Japanese"),
    ("ko",  "ko",    "Korean"),
    ("tr",  "tr",    "Turkish"),
    ("nl",  "nl",    "Dutch"),
    ("pl",  "pl",    "Polish"),
    ("uk",  "uk",    "Ukrainian"),
    ("hi",  "hi",    "Hindi"),
    ("fa",  "fa",    "Persian (Farsi)"),
    ("he",  "iw",    "Hebrew"),
    ("vi",  "vi",    "Vietnamese"),
    ("id",  "id",    "Indonesian"),
]

# Regex pour détecter les placeholders next-intl : {count}, {n}, {plural}, etc.
_PLACEHOLDER_RE = re.compile(r"\{[a-zA-Z_][a-zA-Z0-9_]*\}")


# ── Utilitaires JSON imbriqué ──────────────────────────────────────────────────

def flatten(obj: Any, prefix: str = "") -> dict[str, str]:
    result: dict[str, str] = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            full_key = f"{prefix}.{k}" if prefix else k
            result.update(flatten(v, full_key))
    elif isinstance(obj, str):
        result[prefix] = obj
    return result


def unflatten(flat: dict[str, str]) -> Any:
    result: dict = {}
    for key, value in flat.items():
        parts = key.split(".")
        d = result
        for part in parts[:-1]:
            d = d.setdefault(part, {})
        d[parts[-1]] = value
    return result


# ── Protection des placeholders ───────────────────────────────────────────────

def protect_placeholders(text: str) -> tuple[str, dict[str, str]]:
    """
    Remplace {count}, {n}, etc. par des tokens NON-traduisibles (ex: PLHD0, PLHD1…)
    afin que Google Translate ne les modifie pas.
    Retourne le texte protégé + le mapping token → placeholder original.
    """
    mapping: dict[str, str] = {}
    protected = text

    for i, match in enumerate(_PLACEHOLDER_RE.finditer(text)):
        token = f"PLHD{i}"
        mapping[token] = match.group(0)

    # On fait la substitution après avoir récupéré tous les matches
    for token, original in mapping.items():
        protected = protected.replace(original, token, 1)

    return protected, mapping


def restore_placeholders(text: str, mapping: dict[str, str]) -> str:
    """Restaure les placeholders originaux depuis les tokens."""
    for token, original in mapping.items():
        text = text.replace(token, original)
    return text


# ── Traduction d'une valeur unique ────────────────────────────────────────────

def translate_value(
    translator,           # GoogleTranslator instance
    value: str,
    retries: int = 3,
    delay: float = 0.15,
) -> str:
    """Traduit une seule chaîne en protégeant les placeholders."""
    if not value.strip():
        return value

    # Pas la peine de traduire les emojis seuls ou les valeurs très courtes
    protected, mapping = protect_placeholders(value)

    for attempt in range(retries):
        try:
            result = translator.translate(protected)
            if result:
                restored = restore_placeholders(result, mapping)
                return restored
            return value
        except Exception as e:
            if attempt < retries - 1:
                wait = 2 ** attempt
                print(f"\n    ⚠️  Erreur tentative {attempt+1}/{retries}: {e} — attente {wait}s", end="")
                time.sleep(wait)
            else:
                print(f"\n    ❌ Échec après {retries} tentatives: {e} — fallback source", end="")
                return value

    return value


# ── Traduction d'une locale complète ─────────────────────────────────────────

def translate_locale(
    source_flat: dict[str, str],
    google_code: str,
    delay: float = 0.1,
) -> dict[str, str]:
    """Traduit toutes les clés avec GoogleTranslator."""
    from deep_translator import GoogleTranslator

    translator = GoogleTranslator(source="fr", target=google_code)
    translated: dict[str, str] = {}
    total = len(source_flat)

    for i, (key, value) in enumerate(source_flat.items(), 1):
        # Indicateur de progression compact
        if i % 10 == 0 or i == total:
            print(f"\r  Clé {i:3d}/{total}…", end="", flush=True)

        translated[key] = translate_value(translator, value)
        time.sleep(delay)  # Respecter le rate limit Google

    return translated


# ── Point d'entrée ────────────────────────────────────────────────────────────

def main() -> None:
    try:
        from deep_translator import GoogleTranslator  # noqa: F401
    except ImportError:
        print("❌ deep-translator non installé. Lancez : pip install deep-translator")
        sys.exit(1)

    if not SOURCE_FILE.exists():
        print(f"❌ Source introuvable : {SOURCE_FILE}")
        sys.exit(1)

    MESSAGES_DIR.mkdir(parents=True, exist_ok=True)

    print(f"📖 Lecture de {SOURCE_FILE.name}…")
    source_obj  = json.loads(SOURCE_FILE.read_text(encoding="utf-8"))
    source_flat = flatten(source_obj)
    total_keys  = len(source_flat)
    print(f"   {total_keys} clés à traduire")
    print(f"   Moteur : Google Translate (deep-translator, gratuit, sans clé API)\n")

    total_locales = len(TARGET_LOCALES)
    success_count = 0

    for i, (locale_code, google_code, locale_name) in enumerate(TARGET_LOCALES, 1):
        out_file = MESSAGES_DIR / f"{locale_code}.json"
        print(f"[{i:02d}/{total_locales}] {locale_name} ({locale_code} / google={google_code})…")

        try:
            translated_flat   = translate_locale(source_flat, google_code, delay=0.1)
            translated_nested = unflatten(translated_flat)

            out_file.write_text(
                json.dumps(translated_nested, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            success_count += 1
            print(f"\r  ✅ Écrit → frontend/messages/{locale_code}.json ({total_keys} clés)\n")

        except Exception as e:
            print(f"\r  ❌ Erreur pour {locale_name}: {e}\n")

        # Pause entre langues pour éviter le throttling Google
        if i < total_locales:
            time.sleep(0.5)

    print(f"🎉 Terminé — {success_count}/{total_locales} langues générées dans {MESSAGES_DIR}")


if __name__ == "__main__":
    main()
