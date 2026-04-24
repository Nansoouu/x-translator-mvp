"""
core/whisper_hallucination_filter.py — Filtrage des hallucinations Whisper

Whisper (et whisper-large-v3-turbo via Groq) génère parfois des segments
parasites qui n'ont aucun rapport avec l'audio réel :
  - Phrases génériques de fin de vidéo YouTube/TikTok
  - Annotations méta ([Musique], [Applaudissements], ♪)
  - Remerciements d'abonnés, appels à s'abonner
  - Sous-titres "communauté Amara"
  - Répétitions de la dernière phrase en boucle

Ce module est utilisé :
  1. Dans local_processing_tasks.py → après transcription, avant traduction
     (évite de traduire et brûler des hallucinations 19 fois)
  2. Dans scripts/clean_whisper_hallucinations.py → nettoyage rétroactif en DB

Usage :
    from core.whisper_hallucination_filter import filter_srt_segments, filter_transcript_text

    # Pour un SRT brut parsé (liste de dicts {index, timecode, text})
    cleaned, removed = filter_srt_segments(blocks)

    # Pour le texte brut (video_transcript en DB)
    cleaned_text = filter_transcript_text(raw_text)
"""

from __future__ import annotations

import re
from typing import Optional


# ─── Blocklist de phrases hallucinées connues ────────────────────────────────
# Toutes les comparaisons sont faites en lowercase, strip, sans ponctuation de fin.
# Les phrases sont groupées par catégorie pour faciliter la maintenance.

# ── Remerciements  generiques "merci d'avoir regardé" ────────────────────────
_THANKS_PATTERNS: list[str] = [
    # Français
    r"merci d.avoir regard",
    r"merci de regarder",
    r"merci pour votre attention",
    r"merci pour [a-z ]*(?:votre )?(?:regard|vision|visionn)",
    r"merci d.avoir suiv",
    r"n.oubliez pas de vous abonner",
    r"n.oubliez pas de liker",
    r"abonnez[- ]vous",
    r"likez cette vid",
    r"partagez cette vid",
    r"laissez un commentaire",
    # English
    r"thanks? for (?:watching|viewing|tuning in|being here)",
    r"thank you for (?:watching|viewing|tuning in|your (?:attention|support))",
    r"don.t forget to (?:like|subscribe|share|comment)",
    r"please (?:like|subscribe|share|leave a comment)",
    r"hit the (?:like|subscribe) button",
    r"click (?:the |that )?(?:like|subscribe|bell)",
    r"if you (?:enjoyed|liked) (?:this|the) (?:video|content)",
    r"see you (?:next time|in the next|soon)",
    r"until next time",
    r"subscribe to (?:our|my|the) (?:channel|page)",
    r"follow us on",
    r"like and subscribe",
    r"subscribe for more",
    r"smash the (?:like|subscribe)",
    r"ring the bell",
    r"turn on notifications",
    # Russe
    r"спасибо за просмотр",
    r"подписывайтесь",
    r"ставьте лайк",
    r"не забудьте подписатьс",
    r"до следующего",
    # Ukrainien
    r"дякую за перегляд",
    r"підписуйтесь",
    r"ставте лайк",
    # Arabe
    r"شكراً? لمشاهدتكم",
    r"لا تنسوا الاشتراك",
    r"اشتركوا في القناة",
    r"اشترك الآن",
    r"سبحان الله",       # hallucination fréquente sur audio arabe bruité
    # Turc
    r"izlediğiniz için teşekkür",
    r"abone olmayı unutmay",
    r"beğenmeyi unutmay",
    # Espagnol
    r"gracias por ver",
    r"no olvid[eé]s suscribirte",
    r"suscríbete",
    r"dale like",
    # Portugais
    r"obrigad[oa] por (?:assistir|ver)",
    r"não esqueça de se inscrever",
    r"inscreva[- ]se",
    r"curta o vídeo",
    # Allemand
    r"danke fürs? (?:zuschauen|anschauen|sehen)",
    r"abonniert den kanal",
    r"abonniert (?:uns|mich)",
    # Italien
    r"grazie per (?:aver )?guardato",
    r"iscrivetevi",
    r"metti mi piace",
    # Chinois (romanised patterns + char)
    r"感谢(?:观看|收看|您的观看)",
    r"请(?:点赞|订阅|关注)",
    # Japonais
    r"ご視聴ありがとうございます",
    r"チャンネル登録",
    # Coréen
    r"시청해 주셔서 감사합니다",
    r"구독",
]

# ── Annotations méta / sons ────────────────────────────────────────────────
_META_PATTERNS: list[str] = [
    # Annotations entre crochets (toutes langues)
    r"^\s*\[[\w\s'\-éèêëàâùûüîïôœç,\.!]+\]\s*$",   # [Musique], [Music], [Applaudissements]...
    r"^\s*\[(?:music|musique|musik|musica|música)\]\s*$",
    r"^\s*\[(?:applause|applaudissements|Аплодисменты|тишина|silence|silencio)\]\s*$",
    r"^\s*\[(?:laughter|rires|смех|risas|risos)\]\s*$",
    r"^\s*\[(?:silence|silencio|tişlilik|سكون)\]\s*$",
    r"^\s*\[(?:noise|bruit|шум|ruido|rumore)\]\s*$",
    r"^\s*\[(?:inaudible|inaudible|неслышно)\]\s*$",
    r"^\s*\[(?:muffled|étouffé)\]\s*$",
    r"^\s*\[(?:crosstalk|discussion|conversations?)\]\s*$",
    # Symboles musicaux seuls
    r"^[\s♪♫🎵🎶]+$",
    # Seulement des points de suspension ou tirets
    r"^[\s\.\-–—…]+$",
    # Annotations hors-crochets courantes
    r"^\s*(?:music\s*playing|ambient\s*noise|background\s*music)\s*$",
]

# ── Fournisseurs de sous-titres communautaires ───────────────────────────────
_COMMUNITY_PATTERNS: list[str] = [
    r"amara\.org",
    r"sous[- ]titres? (?:réalisés?|par) (?:la |la communauté|bénévoles?)",
    r"subtitles? by the",
    r"translated by",
    r"sous[- ]titres? (?:fr|en|ar|ru)",
    r"subtitulado por",
    r"traducido por",
    r"untertitel von",
    r"ondertiteling door",
    r"подписи (?:от|сделаны)",
    r"perex\.ru",
]

# ── Hallucinations sur silence / audio vide ──────────────────────────────────
_SILENCE_HALLUCINATIONS: list[str] = [
    # Whisper les génère sur les silences prolongés (très fréquent)
    r"^\s*you\s*$",
    r"^\s*(?:bye[- ]?bye|goodbye|au revoir|ciao|adios|tchau)\s*$",
    r"^\s*(?:uh|um|hmm|hm|eh|ah|oh|mhm|uhm)\s*[.,]?\s*$",
    r"^\s*(?:ok|okay|alright|right|yeah|yep|yes|no)\s*[.,!]?\s*$",
    r"^\s*(?:www\.|http)",   # URLs hallucinées
]

# ── Toutes les regex compilées (performance) ─────────────────────────────────
_ALL_PATTERNS: list[re.Pattern] = [
    re.compile(p, re.IGNORECASE | re.UNICODE)
    for p in _THANKS_PATTERNS + _META_PATTERNS + _COMMUNITY_PATTERNS + _SILENCE_HALLUCINATIONS
]

# ── Seuils ────────────────────────────────────────────────────────────────────
_MIN_WORDS = 2          # segments < 2 mots → hallucination probable
_MAX_REPEAT_RATIO = 0.6  # si un segment représente > 60% des mots totaux → boucle infinie


def _normalize(text: str) -> str:
    """Normalise un texte pour la comparaison (lowercase, trim, supprime ponctuation de fin)."""
    return text.lower().strip().rstrip(".,!?;:")


def _is_hallucination(text: str) -> bool:
    """
    Retourne True si le texte est une hallucination Whisper connue.

    Critères :
    1. Match contre les patterns de la blocklist
    2. Segments trop courts (< 2 mots) sans contenu informatif
    """
    if not text or not text.strip():
        return True

    norm = _normalize(text)

    # Test blocklist complète
    for pattern in _ALL_PATTERNS:
        if pattern.search(norm):
            return True

    # Trop court
    words = norm.split()
    if len(words) < _MIN_WORDS:
        # 1 mot ou moins → suspect, mais pas tous les cas (ex: "Feu !")
        # On tolère si le mot contient des chiffres ou majuscules (lieu, nom propre)
        if len(words) == 1 and not any(c.isdigit() for c in text) and text.islower():
            return True

    return False


def _detect_repeating_loops(blocks: list[dict]) -> set[int]:
    """
    Détecte les blocs répétés en boucle (même texte consécutif 2+ fois).
    Retourne les indices des blocs à supprimer (garder la 1ère occurrence).

    Cas typique : Whisper répète la dernière phrase 5-6 fois sur les silences de fin.
    """
    to_remove: set[int] = set()
    if len(blocks) < 2:
        return to_remove

    for i in range(1, len(blocks)):
        prev = _normalize(blocks[i - 1]["text"])
        curr = _normalize(blocks[i]["text"])
        if prev and curr and prev == curr:
            to_remove.add(i)

    return to_remove


def _detect_dominant_phrase(blocks: list[dict]) -> set[int]:
    """
    Détecte si une phrase unique représente une proportion anormale du texte total.
    Ex: "Merci d'avoir regardé" répété 8 fois dans un SRT de 10 blocs.

    Retourne les indices des blocs en trop (on garde 0 : tous sont hallucinés).
    """
    if len(blocks) < 3:
        return set()

    from collections import Counter
    normalized = [_normalize(b["text"]) for b in blocks]
    counts = Counter(normalized)
    total = len(normalized)

    to_remove: set[int] = set()
    for phrase, count in counts.items():
        if not phrase:
            continue
        ratio = count / total
        if ratio >= _MAX_REPEAT_RATIO and count >= 3:
            # Cette phrase domine tout le SRT → hallucination en boucle
            # Supprimer TOUTES les occurrences sauf éventuellement la première
            seen = False
            for i, norm in enumerate(normalized):
                if norm == phrase:
                    if seen:
                        to_remove.add(i)
                    else:
                        # La 1ère occurrence est aussi probablement une hallucination
                        # si elle correspond à la blocklist
                        if _is_hallucination(blocks[i]["text"]):
                            to_remove.add(i)
                    seen = True

    return to_remove


# ─── API publique ─────────────────────────────────────────────────────────────

def filter_srt_segments(blocks: list[dict]) -> tuple[list[dict], list[dict]]:
    """
    Filtre les hallucinations Whisper dans une liste de segments SRT.

    Paramètre :
        blocks : liste de dicts {index, timecode, text}
                 (format retourné par _parse_srt() dans local_processing_tasks.py)

    Retourne :
        (kept_blocks, removed_blocks)
        - kept_blocks   : segments conservés (SRT propre)
        - removed_blocks : segments supprimés (pour logging/debug)

    Exemple :
        blocks = [
            {"index": "1", "timecode": "00:00:01,000 --> 00:00:03,000", "text": "Bombardement sur Kherson"},
            {"index": "2", "timecode": "00:00:45,000 --> 00:00:47,000", "text": "Thanks for watching!"},
            {"index": "3", "timecode": "00:00:47,000 --> 00:00:49,000", "text": "[Musique]"},
        ]
        kept, removed = filter_srt_segments(blocks)
        # kept    → [bloc 1]
        # removed → [bloc 2, bloc 3]
    """
    if not blocks:
        return [], []

    # ── Phase 1 : Filtrage unitaire (blocklist) ───────────────────────────────
    to_remove_individual: set[int] = set()
    for i, block in enumerate(blocks):
        if _is_hallucination(block.get("text", "")):
            to_remove_individual.add(i)

    # ── Phase 2 : Répétitions consécutives ────────────────────────────────────
    # Appliquer seulement sur les blocs non déjà filtrés
    surviving = [b for i, b in enumerate(blocks) if i not in to_remove_individual]
    repeat_indices_in_surviving = _detect_repeating_loops(surviving)
    # Remapper vers les indices originaux
    surviving_orig_indices = [i for i in range(len(blocks)) if i not in to_remove_individual]
    for j in repeat_indices_in_surviving:
        to_remove_individual.add(surviving_orig_indices[j])

    # ── Phase 3 : Phrase dominante (hallucination en boucle) ─────────────────
    dominant_indices_in_surviving = _detect_dominant_phrase(
        [b for i, b in enumerate(blocks) if i not in to_remove_individual]
    )
    surviving_orig_indices2 = [i for i in range(len(blocks)) if i not in to_remove_individual]
    for j in dominant_indices_in_surviving:
        to_remove_individual.add(surviving_orig_indices2[j])

    # ── Résultat ──────────────────────────────────────────────────────────────
    kept    = [b for i, b in enumerate(blocks) if i not in to_remove_individual]
    removed = [b for i, b in enumerate(blocks) if i in to_remove_individual]

    # Renuméroter les blocs conservés (SRT valide = index séquentiels)
    for new_idx, block in enumerate(kept, 1):
        block = dict(block)  # ne pas muter l'original
        kept[new_idx - 1] = {**block, "index": str(new_idx)}

    return kept, removed


def filter_transcript_text(text: str) -> str:
    """
    Nettoie le texte brut d'une transcription (video_transcript en DB).

    Différent de filter_srt_segments : on travaille sur le texte continu,
    pas sur des segments horodatés. On supprime les phrases individuelles
    qui correspondent à la blocklist.

    Paramètre :
        text : transcription brute (toutes les phrases concaténées)

    Retourne :
        Texte nettoyé (phrases hallucinées supprimées)
    """
    if not text or not text.strip():
        return text

    # Découper en phrases (sur . ! ? et \n)
    sentences = re.split(r"(?<=[.!?])\s+|\n", text)

    kept: list[str] = []
    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
        if not _is_hallucination(sentence):
            kept.append(sentence)

    return " ".join(kept)


def filter_srt_text(srt_content: str) -> tuple[str, list[str]]:
    """
    Version haut-niveau qui prend le contenu brut d'un fichier SRT (string)
    et retourne (srt_nettoyé, liste_phrases_supprimées).

    Utilisé par le script de nettoyage rétroactif qui travaille sur des strings.
    """
    # Import local pour éviter la dépendance circulaire
    # (local_processing_tasks._parse_srt est identique à cette implémentation)
    def _parse_srt(content: str) -> list[dict]:
        blocks = []
        for raw_block in content.strip().split("\n\n"):
            lines = raw_block.strip().splitlines()
            if len(lines) < 3:
                continue
            blocks.append({
                "index":    lines[0].strip(),
                "timecode": lines[1].strip(),
                "text":     "\n".join(lines[2:]).strip(),
            })
        return blocks

    def _write_srt(blocks: list[dict]) -> str:
        parts = []
        for b in blocks:
            parts.append(f"{b['index']}\n{b['timecode']}\n{b['text']}\n")
        return "\n".join(parts)

    blocks = _parse_srt(srt_content)
    if not blocks:
        return srt_content, []

    kept, removed = filter_srt_segments(blocks)
    removed_texts = [r["text"] for r in removed]

    return _write_srt(kept), removed_texts


# ─────────────────────────────────────────────────────────────────────────────
# Validation LLM (DeepSeek V3 via OpenRouter) — 1 seul appel par vidéo
# ─────────────────────────────────────────────────────────────────────────────

_SYSTEM_PROMPT_VALIDATE = """\
You are a transcript quality filter for any spoken‑audio video content.
Your job: identify subtitle segments that are NOT real spoken audio content.

Noise includes (non‑exhaustive):
- Community subtitle credits ("Sous‑titrage bénévole par X", "Subtitles by the community")
- YouTube/TikTok generic endings ("Thanks for watching", "Subscribe", "Like and share")
- Streaming service watermarks, Amara.org credits
- Meta annotations ([Music], [Applause], ♪…) that are not actual speech
- Any line that is clearly meta‑information about the video rather than speech

Real content includes:
- Actual spoken words: speech, dialogue, narration, commentary
- Educational/tutorial explanations, lectures, presentations
- News anchor narration, interviews, discussions
- Any spoken language that conveys meaningful information

Return ONLY valid JSON — no markdown, no backticks, no explanation:
{
  "is_valid_transcript": true,
  "noise_phrases": ["exact phrase 1", "exact phrase 2"]
}

Rules:
- "is_valid_transcript": false ONLY if the ENTIRE transcript is noise (no real speech at all).
- "noise_phrases": list of EXACT phrases (copy verbatim) that should be removed. Empty list [] if none.
- Be conservative: when in doubt, KEEP the phrase (set is_valid_transcript=true, don't add to noise_phrases).
- Never remove content that could be relevant spoken language, regardless of topic.
""".strip()


async def filter_srt_with_llm(
    blocks: list[dict],
    transcript_text: str,
) -> tuple[list[dict], list[dict], bool]:
    """
    Validation LLM (DeepSeek V3) du SRT après le filtrage regex.

    Envoie le texte brut concaténé au LLM en 1 seul appel (~1-2s).
    Le LLM identifie les phrases parasites non capturées par la blocklist regex.

    Paramètres :
        blocks          : segments SRT après le filtrage regex
        transcript_text : texte brut concaténé (pour le contexte LLM)

    Retourne :
        (kept_blocks, removed_blocks, is_valid)
        - kept_blocks    : segments conservés après filtrage LLM
        - removed_blocks : segments supprimés par le LLM
        - is_valid       : False si le LLM considère le transcrit entièrement du bruit

    Non-bloquant : en cas d'erreur LLM, retourne (blocks, [], True) → le pipeline continue.
    """
    if not blocks:
        return blocks, [], True

    # ── Préparer le texte à analyser (concaténé, max 8000 chars pour couvrir plus de contenu) ──
    all_texts = "\n".join(b["text"] for b in blocks if b.get("text"))
    if not all_texts.strip():
        return blocks, [], True

    # Tronquer à 8000 chars pour les vidéos longues (tutoriels, discours)
    text_for_llm = all_texts[:8000]

    try:
        from core.openrouter import call_openrouter

        result = await call_openrouter(
            system_prompt=_SYSTEM_PROMPT_VALIDATE,
            user_content=text_for_llm,
            temperature=0.0,
        )

        if not isinstance(result, dict):
            print(f"[hallucination_filter/llm] ⚠️  Réponse inattendue (non-dict) — skip LLM filter")
            return blocks, [], True

        is_valid = result.get("is_valid_transcript", True)
        noise_phrases: list[str] = result.get("noise_phrases", [])

        if not is_valid:
            # Le LLM considère que tout est du bruit → mais on garde tout avec un warning
            print(f"[hallucination_filter/llm] ⚠️  LLM : transcrit considéré comme bruit, on garde tout (fallback pour vidéos longues)")
            return blocks, [], True

        if not noise_phrases:
            # Rien à filtrer
            return blocks, [], True

        # ── Filtrer les blocs qui contiennent une phrase bruit ────────────────
        noise_normalized = [n.lower().strip() for n in noise_phrases if n and n.strip()]
        kept: list[dict] = []
        removed: list[dict] = []

        for block in blocks:
            block_text_norm = block.get("text", "").lower().strip()
            is_noise = any(
                noise in block_text_norm or block_text_norm in noise
                for noise in noise_normalized
            )
            if is_noise:
                removed.append(block)
            else:
                kept.append(block)

        # Renuméroter les blocs conservés
        for new_idx, block in enumerate(kept, 1):
            kept[new_idx - 1] = {**block, "index": str(new_idx)}

        if removed:
            print(
                f"[hallucination_filter/llm] 🗑️  {len(removed)} segment(s) supprimé(s) par LLM :"
            )
            for b in removed[:5]:
                print(f"  [{b.get('timecode', '?')}] \"{b['text'][:80]}\"")
            if len(removed) > 5:
                print(f"  ... et {len(removed) - 5} autre(s)")

        return kept, removed, True

    except Exception as e:
        print(f"[hallucination_filter/llm] ⚠️  Erreur LLM (non-bloquant) : {e}")
        return blocks, [], True


def log_filtered(tweet_id: str, removed: list[dict]) -> None:
    """
    Log les segments supprimés pour debug/monitoring.
    N'affiche rien si rien n'a été supprimé.
    """
    if not removed:
        return
    print(
        f"[hallucination_filter] 🗑️  {len(removed)} segment(s) supprimé(s) pour tweet_id={tweet_id} :"
    )
    for block in removed[:5]:  # max 5 exemples dans les logs
        text_preview = block["text"][:80].replace("\n", " ")
        print(f"  [{block.get('timecode', '?')}] \"{text_preview}\"")
    if len(removed) > 5:
        print(f"  ... et {len(removed) - 5} autre(s)")
