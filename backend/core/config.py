"""
core/config.py — Configuration Pydantic — x-translator-mvp
"""
from pydantic_settings import BaseSettings
from typing import List, Optional
import sys


class Settings(BaseSettings):
    APP_ENV: str = "development"
    APP_SECRET_KEY: str = "dev-secret-change-me"
    APP_CORS_ORIGINS: str = "http://localhost:3000"

    # ── Base de données ────────────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql://translator:translator@localhost:5433/x_translator"
    DATABASE_URL_POOLER: Optional[str] = None  # Supabase PgBouncer — runtime prod

    # ── Supabase Storage ──────────────────────────────────────────────────────
    SUPABASE_URL: Optional[str] = None
    SUPABASE_SERVICE_KEY: Optional[str] = None
    SUPABASE_BUCKET: str = "translated-videos"

    # ── LLM OpenRouter (DeepSeek V3) ──────────────────────────────────────────
    OPENROUTER_API_KEY: Optional[str] = None

    # ── Groq (Whisper transcription) ──────────────────────────────────────────
    GROQ_API_KEY: Optional[str] = None

    # ── Stripe ────────────────────────────────────────────────────────────────
    STRIPE_SECRET_KEY: Optional[str] = None
    STRIPE_PUBLISHABLE_KEY: Optional[str] = None
    STRIPE_WEBHOOK_SECRET: Optional[str] = None
    STRIPE_PRICE_MONTHLY: Optional[str] = None    # price_xxx abonnement 10€/mois
    STRIPE_PRICE_CREDITS_10: Optional[str] = None  # price_xxx pack 10 vidéos 5€

    # ── Redis (Celery) ────────────────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"

    # ── Watermark ─────────────────────────────────────────────────────────────
    WATERMARK_TEXT: str = "Translate free by Spottedyou.org"

    # ── Limites vidéo ─────────────────────────────────────────────────────────
    VIDEO_SHORT_MAX_SECONDS: int = 300    # 5 min → "short"
    VIDEO_MAX_SECONDS: int = 10800        # 3h max → refus absolu (override via env VIDEO_MAX_SECONDS)

    # ── Worker ────────────────────────────────────────────────────────────────
    LOCAL_TEMP_DIR: str = "/tmp/x-translator-processing"

    @property
    def cors_origins(self) -> List[str]:
        return [o.strip() for o in self.APP_CORS_ORIGINS.split(",")]

    @property
    def llm_enabled(self) -> bool:
        return bool(self.OPENROUTER_API_KEY)

    @property
    def groq_enabled(self) -> bool:
        return bool(self.GROQ_API_KEY)

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
