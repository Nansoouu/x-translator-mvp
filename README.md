# 🌍 SpottedYou Translator — x-translator-mvp

Traduis n'importe quelle vidéo **X (Twitter)** ou **YouTube** en 21 langues.

## Pipeline

```
URL (X/YouTube) → yt-dlp download → Groq Whisper transcription
→ Hallucination filter → Résumé LLM → DeepSeek V3 traduction SRT
→ FFmpeg burn sous-titres + watermark → Supabase Storage → Visionnage
```

## Stack

| Layer | Techno |
|---|---|
| Backend API | FastAPI + asyncpg |
| Worker | Celery + Redis |
| Transcription | Groq Whisper large-v3-turbo |
| Traduction | OpenRouter DeepSeek V3 |
| Watermark | Pillow + FFmpeg |
| Stockage | Supabase Storage |
| Auth | Supabase Auth |
| Paiement | Stripe |
| Frontend | Next.js 14 App Router + Tailwind |
| Déploiement | Railway |

## Structure

```
x-translator-mvp/
├── backend/
│   ├── core/           ← config, db, pipeline, openrouter, watermark...
│   ├── api/            ← FastAPI routes (auth, jobs, billing)
│   ├── tasks/          ← Celery pipeline_task
│   └── main.py
├── frontend/
│   ├── app/            ← Next.js pages (/, /login, /library, /billing)
│   └── lib/api.ts      ← client API
└── database/
    └── schema.sql
```

## Démarrage local

### 1. Backend
```bash
cd backend
cp .env.example .env
# Remplir les clés dans .env
pip install -r requirements.txt
uvicorn main:app --reload
```

### 2. Worker Celery
```bash
cd backend
celery -A core.celery_app.celery_app worker --loglevel=info -Q video_processing
```

### 3. Frontend
```bash
cd frontend
cp .env.example .env.local
# Remplir NEXT_PUBLIC_API_URL etc.
npm install
npm run dev
```

### 4. Base de données
```bash
psql -U translator -d x_translator -f database/schema.sql
```

## Variables d'environnement requises

### Backend `.env`
- `GROQ_API_KEY` — transcription Whisper
- `OPENROUTER_API_KEY` — traduction DeepSeek V3
- `DATABASE_URL` — PostgreSQL
- `REDIS_URL` — Celery broker
- `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` — stockage vidéos
- `STRIPE_SECRET_KEY` etc. — paiement (optionnel pour le MVP)

### Frontend `.env.local`
- `NEXT_PUBLIC_API_URL` — URL du backend
- `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Déploiement Railway

3 services à créer :
1. **Backend API** — `backend/` → `uvicorn main:app --host 0.0.0.0 --port $PORT`
2. **Worker** — `backend/` → `celery -A core.celery_app.celery_app worker -Q video_processing`
3. **Frontend** — `frontend/` → `npm run build && node .next/standalone/server.js`

+ 1 service **Redis** (Railway addon)

## Flux utilisateur

1. L'utilisateur colle un lien X ou YouTube sur la page d'accueil
2. Choisit sa langue cible
3. La vidéo est téléchargée, transcrite, traduite, rendue avec sous-titres brûlés + watermark
4. L'utilisateur voit un résumé et peut visionner la vidéo (avec watermark spottedyou.org)
5. Les utilisateurs connectés peuvent télécharger la vidéo

## Réutilisation depuis conflict-map

| Fichier source | Adapté en |
|---|---|
| `core/openrouter.py` | `core/openrouter.py` (traduction SRT + résumé) |
| `core/watermark.py` | `core/watermark.py` (watermark spottedyou.org) |
| `core/whisper_hallucination_filter.py` | copie directe |
| `core/supabase_storage.py` | adapté bucket translated-videos |
| `core/db.py` | copie directe asyncpg pool |
| `backend/tasks/local_processing_tasks.py` | extrait dans `core/pipeline.py` |
