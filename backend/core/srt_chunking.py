"""
srt_chunking.py — Découpage intelligent des SRT pour traduction LLM
"""

import re
from typing import List, Dict, Tuple


def parse_srt_to_blocks(srt_content: str) -> List[Dict[str, str]]:
    """
    Parse un contenu SRT en une liste de blocs.
    
    Chaque bloc : {
        "index": "1",
        "timecode": "00:00:01,000 --> 00:00:03,000",
        "text": "Bonjour tout le monde",
    }
    """
    blocks = []
    for raw_block in srt_content.strip().split("\n\n"):
        lines = raw_block.strip().splitlines()
        if len(lines) < 3:
            continue
        blocks.append({
            "index": lines[0].strip(),
            "timecode": lines[1].strip(),
            "text": "\n".join(lines[2:]).strip(),
        })
    return blocks


def blocks_to_srt(blocks: List[Dict[str, str]]) -> str:
    """Reconstitue un SRT à partir de blocs."""
    parts = []
    for i, block in enumerate(blocks):
        # On réindexe séquentiellement à partir de 1
        parts.append(f"{i + 1}\n{block['timecode']}\n{block['text']}\n")
    return "\n".join(parts)


def group_blocks_into_chunks(
    blocks: List[Dict[str, str]],
    max_chars: int = 6000,
    max_blocks: int = 50,
) -> List[List[Dict[str, str]]]:
    """
    Groupe les blocs SRT en chunks respectant les limites de taille.
    
    Stratégie :
    - Ne jamais couper un bloc (garder l'intégralité).
    - Cumuler les caractères jusqu'à dépasser max_chars OU max_blocks.
    - Ne pas mélanger les blocs distants (garder l'ordre).
    """
    if not blocks:
        return []
    
    chunks = []
    current_chunk = []
    current_chars = 0
    
    for block in blocks:
        block_text = block.get("text", "")
        block_len = len(block_text)
        
        # Si ajouter ce bloc dépasse les limites ET que le chunk n'est pas vide
        if (current_chars + block_len > max_chars or len(current_chunk) >= max_blocks) and current_chunk:
            chunks.append(current_chunk)
            current_chunk = []
            current_chars = 0
        
        current_chunk.append(block)
        current_chars += block_len
    
    # Ajouter le dernier chunk
    if current_chunk:
        chunks.append(current_chunk)
    
    return chunks


def chunk_srt_content(
    srt_content: str,
    max_chars: int = 6000,
    max_blocks: int = 50,
) -> Tuple[List[str], List[List[Dict[str, str]]]]:
    """
    Découpe un SRT en plusieurs chunks.
    
    Retourne :
        - liste des SRT chunkés (chaque chunk est un SRT complet)
        - liste des blocs par chunk (pour debug)
    """
    blocks = parse_srt_to_blocks(srt_content)
    chunked_blocks = group_blocks_into_chunks(blocks, max_chars, max_blocks)
    
    srt_chunks = []
    for chunk in chunked_blocks:
        srt_chunks.append(blocks_to_srt(chunk))
    
    return srt_chunks, chunked_blocks


def merge_srt_chunks(chunks: List[str]) -> str:
    """
    Fusionne plusieurs SRT chunkés en un seul SRT final.
    
    Les index sont réordonnés séquentiellement.
    """
    all_blocks = []
    for chunk in chunks:
        all_blocks.extend(parse_srt_to_blocks(chunk))
    return blocks_to_srt(all_blocks)


# ── Détection de coupure naturelle (phrase) ───────────────────────────────

def _ends_with_punctuation(text: str) -> bool:
    """Vérifie si le texte se termine par une ponctuation de phrase."""
    return bool(re.search(r"[.!?]\s*$", text.strip()))


def find_natural_break(blocks: List[Dict[str, str]], max_lookahead: int = 3) -> int:
    """
    Trouve un point de coupure naturel dans une liste de blocs.
    
    Recherche la première fin de phrase dans les `max_lookahead` blocs suivants.
    Retourne l'indice du bloc (exclusif) à couper, ou -1 si pas trouvé.
    """
    for i in range(min(max_lookahead, len(blocks))):
        if _ends_with_punctuation(blocks[i]["text"]):
            return i + 1
    return -1