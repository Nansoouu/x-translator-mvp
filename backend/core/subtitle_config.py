"""
subtitle_config.py — Configuration centralisée pour les sous-titres
Adaptation automatique aux formats vidéo + gestion opacité fond.
"""

import json
from typing import Optional, TypedDict


class SubtitleStyleDict(TypedDict, total=False):
    """Format attendu pour les styles utilisateur."""
    font_size: int
    font_family: str
    color: str
    background_color: str
    background_opacity: int  # 0-100
    shadow: str
    border: str
    border_radius: str
    alignment: str  # "bottom", "top", "middle"
    margins: dict  # {"left": int, "right": int, "bottom": int, "top": int}


class SubtitleConfig:
    """
    Calcule les paramètres optimaux pour les sous-titres
    en fonction de la résolution vidéo et des préférences utilisateur.
    """
    
    def __init__(self, width: int, height: int, user_style: Optional[SubtitleStyleDict] = None):
        self.width = width
        self.height = height
        self.user_style = user_style or {}
        self.is_vertical = height > width * 1.4
        
        # Valeurs par défaut configurables par env
        import os
        from pathlib import Path
        
        # Charger le fichier .env s'il existe (pour les variables SUBTITLE_*)
        self._load_dotenv_if_needed()
        
        def _clean_env_value(value: str | None, default: str) -> str:
            """Nettoie une valeur d'environnement (enlève commentaires, espaces)."""
            if value is None:
                return default
            # Enlève les commentaires après #
            if '#' in value:
                value = value.split('#')[0]
            # Enlève les espaces
            return value.strip()
        
        def _get_env_int(key: str, default: str) -> int:
            """Récupère un entier depuis l'environnement."""
            raw = os.environ.get(key)
            cleaned = _clean_env_value(raw, default)
            try:
                return int(cleaned)
            except ValueError:
                return int(default)
        
        def _get_env_float(key: str, default: str) -> float:
            """Récupère un float depuis l'environnement."""
            raw = os.environ.get(key)
            cleaned = _clean_env_value(raw, default)
            try:
                return float(cleaned)
            except ValueError:
                return float(default)
        
        self.defaults = {
            "font_density": _get_env_float("SUBTITLE_FONT_DENSITY", "0.045"),  # 4.5%
            "min_font_size": _get_env_int("SUBTITLE_MIN_FONT", "22"),  # Réduit de 24 à 22
            "max_font_size": _get_env_int("SUBTITLE_MAX_FONT", "72"),
            "margin_percent": _get_env_float("SUBTITLE_MARGIN_PERCENT", "0.045"),  # 4.5%
            "bottom_margin_percent": _get_env_float("SUBTITLE_BOTTOM_MARGIN", "0.08"),  # 8%
            "default_opacity": _get_env_int("SUBTITLE_OPACITY", "100"),  # 90%
            "char_width_ratio": _get_env_float("SUBTITLE_CHAR_WIDTH_RATIO", "0.6"),
            "vertical_font_scale": _get_env_float("VERTICAL_FONT_SCALE", "0.055"),  # Réduit de 0.092 à 0.055 (5.5%)
            "horizontal_font_scale": _get_env_float("HORIZONTAL_FONT_SCALE", "0.035"),  # Réduit de 0.055 à 0.035 (3.5%)
        }
    
    def _load_dotenv_if_needed(self) -> None:
        """Charge le fichier .env si python-dotenv est disponible."""
        import os
        from pathlib import Path
        
        # Vérifier si les variables SUBTITLE_* sont déjà définies
        if os.environ.get("SUBTITLE_OPACITY"):
            return  # Déjà chargé
        
        try:
            from dotenv import load_dotenv
            # Chercher le .env dans le dossier backend/
            backend_dir = Path(__file__).parent.parent
            env_path = backend_dir / ".env"
            if env_path.exists():
                load_dotenv(dotenv_path=env_path, override=False)
        except ImportError:
            pass  # dotenv non installé, on continue avec os.environ existant
        except Exception:
            pass  # Ignorer les erreurs silencieusement
    
    def calculate_font_size(self) -> int:
        """
        Calcule la taille de police optimale.
        Si l'utilisateur a spécifié font_size, l'utilise (borné).
        Sinon, calcule automatiquement basé sur résolution.
        """
        # Priorité 1: valeur utilisateur
        if "font_size" in self.user_style:
            return max(
                self.defaults["min_font_size"],
                min(self.user_style["font_size"], self.defaults["max_font_size"])
            )
        
        # Priorité 2: calcul adaptatif
        if self.is_vertical:
            # Vidéo verticale: basée sur la largeur
            base = int(self.width * self.defaults["vertical_font_scale"])
        else:
            # Vidéo horizontale: basée sur la hauteur
            base = int(self.height * self.defaults["horizontal_font_scale"])
        
        # Applique les bornes min/max
        return max(
            self.defaults["min_font_size"],
            min(base, self.defaults["max_font_size"])
        )
    
    def calculate_max_chars_per_line(self) -> int:
        """
        Calcule le nombre maximum de caractères par ligne.
        Basé sur la taille de police et la largeur disponible.
        """
        font_size = self.calculate_font_size()
        char_width = font_size * self.defaults["char_width_ratio"]
        available_width = self.width * 0.85  # 85% de la largeur
        
        # Pour les vidéos verticales, moins de caractères
        if self.is_vertical:
            base_chars = int(available_width / char_width)
            return max(20, min(base_chars, 32))
        else:
            base_chars = int(available_width / char_width)
            return max(25, min(base_chars, 42))
    
    def calculate_margins(self) -> tuple[int, int, int]:
        """
        Retourne (margin_left, margin_right, margin_bottom).
        Si l'utilisateur a spécifié margins, utilise ces valeurs.
        """
        if "margins" in self.user_style and isinstance(self.user_style["margins"], dict):
            margins = self.user_style["margins"]
            return (
                margins.get("left", 60),
                margins.get("right", 60),
                margins.get("bottom", 50)
            )
        
        # Calcul adaptatif
        lr = max(60, int(self.width * self.defaults["margin_percent"]))
        bottom = max(50, int(self.height * self.defaults["bottom_margin_percent"]))
        return lr, lr, bottom
    
    def calculate_background_opacity(self) -> str:
        """
        Convertit l'opacité 0-100% en format hexadécimal ASS.
        Format: &H{HEX}000000 où HEX = 00 (transparent) à FF (opaque)
        """
        opacity = self.user_style.get("background_opacity", self.defaults["default_opacity"])
        # Borne 0-100
        opacity = max(0, min(100, opacity))
        # Convertir en hex (0-255)
        hex_val = int(opacity * 255 / 100)
        
        # FORCE 100% d'opacité pour les traductions si non spécifié explicitement
        if self.defaults.get("default_opacity") == 100 and "background_opacity" not in self.user_style:
            hex_val = 255  # FF = complètement opaque
        
        return f"&H{hex_val:02X}000000"
    
    def calculate_text_color(self) -> str:
        """Retourne la couleur du texte au format ASS (&H00BBGGRR)."""
        color = self.user_style.get("color", "#FFFFFF")
        # Convertir hex CSS en ASS (format BGR)
        if color.startswith("#"):
            # #RRGGBB -> &H00BBGGRR
            r = color[1:3]
            g = color[3:5]
            b = color[5:7]
            return f"&H00{b}{g}{r}"
        return "&H00FFFFFF"  # blanc par défaut
    
    def calculate_outline_color(self) -> str:
        """Couleur du contour (noir OPAQUE pour lisibilité)."""
        # Le contour doit être toujours opaque pour être visible
        # même si le fond a une transparence
        return "&HFF000000"
    
    def get_alignment(self) -> int:
        """Retourne le code d'alignement ASS (1-9)."""
        alignment = self.user_style.get("alignment", "bottom")
        mapping = {
            "bottom": 2,      # bas centré (ASS: 1=gauche, 2=centre, 3=droite)
            "top": 8,         # haut centré  
            "middle": 5,      # milieu centré
            "bottom-left": 1, # bas gauche
            "bottom-right": 3, # bas droite
        }
        return mapping.get(alignment, 2)
    
    def to_ass_style(self, style_name: str = "Default") -> str:
        """
        Génère une ligne de style ASS complète.
        Format: Style: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,
                OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,
                ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,
                Alignment,MarginL,MarginR,MarginV,Encoding
        """
        font_size = self.calculate_font_size()
        margin_l, margin_r, margin_v = self.calculate_margins()
        
        # Police par défaut ou celle de l'utilisateur
        font_family = self.user_style.get("font_family", "Arial")
        
        # Construire la ligne de style
        parts = [
            f"Style: {style_name}",
            font_family,
            str(font_size),
            self.calculate_text_color(),      # PrimaryColour
            "&H000000FF",                     # SecondaryColour (bleu, utilisé pour karaoke)
            self.calculate_outline_color(),   # OutlineColour
            self.calculate_background_opacity(),  # BackColour (fond)
            "0",  # Bold
            "0",  # Italic
            "0",  # Underline
            "0",  # StrikeOut
            "100",  # ScaleX (100%)
            "100",  # ScaleY (100%)
            "0",    # Spacing
            "0",    # Angle
            "3",    # BorderStyle (3=background+outline+shadow)
            "4",    # Outline (épaisseur contour)
            "7",    # Shadow (distance ombre)
            str(self.get_alignment()),  # Alignment
            str(margin_l),
            str(margin_r),
            str(margin_v),
            "1",    # Encoding (0=ANSI, 1=Default, 2=Symbol, 128=Shift-JIS, 134=GB2312, 136=BIG5, 255=OEM)
        ]
        
        return ",".join(parts)


def load_user_style_from_json(style_json: Optional[str]) -> Optional[SubtitleStyleDict]:
    """Charge le style utilisateur depuis une chaîne JSON."""
    if not style_json:
        return None
    
    try:
        data = json.loads(style_json)
        # Normalise les clés
        result: SubtitleStyleDict = {}
        
        # Mapper depuis l'ancien format
        if "fontSize" in data:
            result["font_size"] = data["fontSize"]
        if "fontFamily" in data:
            result["font_family"] = data["fontFamily"]
        if "color" in data:
            result["color"] = data["color"]
        if "backgroundColor" in data:
            result["background_color"] = data["backgroundColor"]
        # Opacité peut être déduite de backgroundColor rgba
        if "background_opacity" not in result and "backgroundColor" in data:
            bg = data["backgroundColor"]
            if bg.startswith("rgba("):
                # Extraire l'opacité de rgba(r,g,b,a)
                parts = bg.split(",")
                if len(parts) == 4:
                    opacity = float(parts[3].strip(") ")) * 100
                    result["background_opacity"] = int(opacity)
        
        # Direct mapping
        if "shadow" in data:
            result["shadow"] = data["shadow"]
        if "border" in data:
            result["border"] = data["border"]
        if "borderRadius" in data:
            result["border_radius"] = data["borderRadius"]
        
        return result if result else None
        
    except Exception:
        return None


# Fonction utilitaire pour créer une config depuis une vidéo
def create_config_for_video(video_path: str, user_style: Optional[SubtitleStyleDict] = None) -> SubtitleConfig:
    """
    Crée une config pour une vidéo donnée.
    Utilise ffprobe pour détecter les dimensions.
    """
    import subprocess
    from pathlib import Path
    
    def get_video_dims(video: Path) -> tuple[int, int]:
        """Utilise ffprobe pour obtenir width/height."""
        try:
            ffprobe = "ffprobe"
            r = subprocess.run(
                [ffprobe, "-v", "error", "-select_streams", "v:0",
                 "-show_entries", "stream=width,height", "-of", "csv=p=0", str(video)],
                capture_output=True, timeout=15,
            )
            if r.returncode == 0 and r.stdout:
                parts = r.stdout.decode().strip().split(",")
                return int(parts[0]), int(parts[1])
        except Exception:
            pass
        return 1280, 720  # valeurs par défaut
    
    video = Path(video_path)
    if not video.exists():
        raise FileNotFoundError(f"Vidéo non trouvée: {video_path}")
    
    width, height = get_video_dims(video)
    return SubtitleConfig(width, height, user_style)