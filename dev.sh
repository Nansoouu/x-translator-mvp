#!/bin/bash
# ─────────────────────────────────────────────────────────────
# dev.sh — Lance l'environnement complet x-translator-mvp
#   • Redis   (Docker)
#   • Backend FastAPI  (port 8000)
#   • Worker  Celery   (queue video_processing)
#   • Frontend Next.js (port 3000)
# Ctrl+C arrête tous les processus proprement.
# ─────────────────────────────────────────────────────────────

set -e

echo "🚀  Démarrage de Redis..."
if docker ps -a --format '{{.Names}}' | grep -q '^redis$'; then
  docker start redis
else
  docker run -d -p 6379:6379 --name redis redis:7-alpine
fi
echo "✅  Redis opérationnel sur redis://localhost:6379"

# Arrête tous les processus fils au Ctrl+C
trap 'echo ""; echo "🛑  Arrêt de tous les services..."; kill 0' EXIT

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
echo "  Backend  → http://localhost:8000"
echo "  Frontend → http://localhost:3000"
echo "  API docs → http://localhost:8000/docs"
echo "═══════════════════════════════════════════════════════"
echo "  Appuyez sur Ctrl+C pour tout arrêter."
echo ""

wait
