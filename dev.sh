#!/bin/bash
# ─────────────────────────────────────────────────────────────
# dev.sh — Lance l'environnement complet x-translator-mvp
#   • PostgreSQL (optionnel, port 5433)
#   • Redis      (Docker, port 6379)
#   • Backend    FastAPI  (port 8000)
#   • Worker     Celery   (queue video_processing)
#   • Frontend   Next.js  (port 3000)
# Ctrl+C arrête tous les processus proprement.
# ─────────────────────────────────────────────────────────────

set -e

echo "🚀  x-translator-mvp — Démarrage complet"
echo "═══════════════════════════════════════════════════════"

# ── Environnement virtuel Python ──────────────────────────────────────────────
echo ""
echo "🐍  Configuration de l'environnement Python..."

# Vérifier si le venv existe dans backend/
if [ ! -d "$(dirname "$0")/backend/venv" ]; then
    echo "📦  Création de l'environnement virtuel..."
    cd "$(dirname "$0")/backend"
    python3 -m venv venv
    source venv/bin/activate
    echo "📥  Installation des dépendances Python..."
    pip install -r requirements.txt
    cd "$(dirname "$0")"
    echo "✅  Environnement virtuel créé et dépendances installées"
else
    echo "🔧  Activation de l'environnement virtuel existant..."
    source "$(dirname "$0")/backend/venv/bin/activate"
    echo "✅  Environnement virtuel activé"
fi

# Configurer PYTHONPATH pour les imports
export PYTHONPATH="$(dirname "$0")/backend:$PYTHONPATH"
echo "📁  PYTHONPATH configuré: $(dirname "$0")/backend"

# ── Vérification des outils système ──────────────────────────────────────────
echo ""
echo "🔧  Vérification des outils système..."

# FFmpeg
if command -v ffmpeg &> /dev/null; then
    FFMPEG_VERSION=$(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f3)
    if ffmpeg -version 2>&1 | grep -q "libass"; then
        echo "✅  FFmpeg $FFMPEG_VERSION (avec libass)"
    else
        echo "⚠️   FFmpeg $FFMPEG_VERSION (sans libass → mode Pillow)"
    fi
else
    echo "❌  FFmpeg non installé"
fi

# yt-dlp (vérifier binaire et pip)
YTDLP_OK=false
if command -v yt-dlp &> /dev/null; then
    YTDLP_VERSION=$(yt-dlp --version 2>/dev/null || echo "?")
    echo "✅  yt-dlp $YTDLP_VERSION (binaire)"
    YTDLP_OK=true
else
    # Vérifier via pip dans le venv
    if source "$(dirname "$0")/backend/venv/bin/activate" && python3 -c "import yt_dlp; print(yt_dlp.version.__version__)" 2>/dev/null; then
        YTDLP_VERSION=$(source "$(dirname "$0")/backend/venv/bin/activate" && python3 -c "import yt_dlp; print(yt_dlp.version.__version__)" 2>/dev/null)
        echo "✅  yt-dlp $YTDLP_VERSION (via pip)"
        YTDLP_OK=true
    else
        echo "❌  yt-dlp non trouvé"
    fi
fi

# Redis (Docker)
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^redis$'; then
    echo "✅  Redis (Docker) en cours"
else
    echo "✅  Redis prêt à démarrer"
fi

# PostgreSQL
if pg_isready -h localhost -p 5433 &> /dev/null; then
    echo "✅  PostgreSQL (localhost:5433)"
else
    echo "⚠️   PostgreSQL non démarré (mode mock activé)"
fi

echo ""

# ── PostgreSQL (optionnel) ───────────────────────────────────────────────────
echo ""
echo "🐘  PostgreSQL (port 5433)..."

if pg_isready -h localhost -p 5433 >/dev/null 2>&1; then
    echo "✅  PostgreSQL déjà en cours sur localhost:5433"
    POSTGRES_RUNNING=true
else
    echo "⚠️   PostgreSQL non détecté sur localhost:5433"
    echo ""
    read -p "Voulez-vous démarrer PostgreSQL via Docker ? (o/N) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Oo]$ ]]; then
        echo "🐳  Démarrage de PostgreSQL via Docker..."
        if docker ps -a --format '{{.Names}}' | grep -q '^postgres-x-translator$'; then
            docker start postgres-x-translator
        else
            docker run -d \
                -p 5433:5432 \
                --name postgres-x-translator \
                -e POSTGRES_DB=x_translator \
                -e POSTGRES_USER=translator \
                -e POSTGRES_PASSWORD=translator \
                postgres:15-alpine
            echo "⏳  Attente du démarrage de PostgreSQL (10s)..."
            sleep 10
        fi
        POSTGRES_RUNNING=true
        echo "✅  PostgreSQL opérationnel sur postgresql://translator:translator@localhost:5433/x_translator"
    else
        echo "⚠️   PostgreSQL non démarré. L'API utilisera des données mockées."
        POSTGRES_RUNNING=false
    fi
fi

# ── Initialisation de la base de données (si PostgreSQL est démarré) ────────
if [ "$POSTGRES_RUNNING" = true ]; then
    echo ""
    echo "🗃️   Vérification de la base de données..."
    if psql -h localhost -p 5433 -U translator -d x_translator -c "\dt" >/dev/null 2>&1; then
        echo "✅  Base de données x_translator existe déjà"
    else
        echo "📦  Création de la base de données x_translator..."
        createdb -h localhost -p 5433 -U translator x_translator 2>/dev/null || true
        
        echo "📄  Application du schéma SQL..."
        if psql -h localhost -p 5433 -U translator -d x_translator -f database/schema.sql >/dev/null 2>&1; then
            echo "✅  Schéma appliqué avec succès"
        else
            echo "⚠️   Échec de l'application du schéma (peut être déjà appliqué)"
        fi
    fi
fi

# ── Redis ────────────────────────────────────────────────────────────────────
echo ""
echo "🔴  Démarrage de Redis..."
if docker ps -a --format '{{.Names}}' | grep -q '^redis$'; then
    docker start redis
else
    docker run -d -p 6379:6379 --name redis redis:7-alpine
fi
echo "✅  Redis opérationnel sur redis://localhost:6379"

# Arrête tous les processus fils au Ctrl+C
trap 'echo ""; echo "🛑  Arrêt de tous les services..."; kill 0' EXIT

# ── Nettoyage des processus existants et cache ───────────────────────────────
echo ""
echo "🧹  Nettoyage des processus et cache..."

# 1. Backend FastAPI (port 8000)
echo "🔧  Vérification du port 8000 (backend)..."
if lsof -ti:8000 >/dev/null 2>&1; then
    echo "⚠️   Port 8000 occupé - Arrêt des processus FastAPI..."
    lsof -ti:8000 | xargs kill -9 2>/dev/null || true
    sleep 2
    echo "✅  Processus backend arrêtés"
fi

# 2. Frontend Next.js (port 3000)
echo "🌐  Vérification du port 3000 (frontend)..."
if lsof -ti:3000 >/dev/null 2>&1; then
    echo "⚠️   Port 3000 occupé - Arrêt des processus Next.js..."
    lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    sleep 2
    echo "✅  Processus frontend arrêtés"
fi

# 3. Nettoyage du cache Next.js (uniquement cache, pas le build)
echo "🗑️   Nettoyage du cache Next.js..."
if [ -d "$(dirname "$0")/frontend/.next/cache" ]; then
    rm -rf "$(dirname "$0")/frontend/.next/cache"
    echo "✅  Cache Next.js nettoyé"
else
    echo "ℹ️   Aucun cache Next.js à nettoyer"
fi

# ── Démarrage des services ───────────────────────────────────────────────────
echo ""
echo "🔧  Démarrage du backend FastAPI (port 8000)..."
(cd "$(dirname "$0")/backend" && uvicorn main:app --reload --port 8000) &

echo "⚙️   Démarrage du worker Celery..."
(cd "$(dirname "$0")/backend" && celery -A core.celery_app.celery_app worker \
    --loglevel=info -Q video_processing --concurrency=2) &

echo "🌐  Démarrage du frontend Next.js (port 3000)..."
(cd "$(dirname "$0")/frontend" && npm run dev) &

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  PostgreSQL → localhost:5433/x_translator"
echo "  Redis      → localhost:6379"
echo "  Backend    → http://localhost:8000"
echo "  Frontend   → http://localhost:3000"
echo "  API docs   → http://localhost:8000/docs"
echo "═══════════════════════════════════════════════════════"
if [ "$POSTGRES_RUNNING" = false ]; then
    echo "⚠️   PostgreSQL non démarré — API en mode mock"
fi
echo "  Appuyez sur Ctrl+C pour tout arrêter."
echo ""

wait