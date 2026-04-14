#!/bin/bash
# Démarrage rapide local (dev)
echo "🚀 Démarrage x-translator-mvp..."
cd backend
uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!
celery -A core.celery_app.celery_app worker --loglevel=info -Q video_processing &
WORKER_PID=$!
cd ../frontend
npm run dev &
FRONTEND_PID=$!
echo "Backend PID=$BACKEND_PID | Worker PID=$WORKER_PID | Frontend PID=$FRONTEND_PID"
echo "Backend: http://localhost:8000 | Frontend: http://localhost:3000"
wait
