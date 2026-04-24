# 🌍 SpottedYou Translator — x-translator-mvp

> Traduis n'importe quelle vidéo **X (Twitter)** ou **YouTube** en 20 langues avec IA.

---

## 🚀 Démarrage Rapide

```bash
git clone https://github.com/Nansoouu/x-translator-mvp.git
cd x-translator-mvp

# Backend
cp backend/.env.example backend/.env
# Éditer backend/.env avec tes clés API

# Frontend
cp frontend/.env.example frontend/.env.local
# Éditer frontend/.env.local avec tes clés API
```

```bash
# Terminal 1 — Backend API
cd backend
uvicorn main:app --reload

# Terminal 2 — Worker Celery
cd backend
celery -A core.celery_app.celery_app worker --loglevel=info -Q video_processing

# Terminal 3 — Frontend
cd frontend
npm run dev
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────┐
│         FRONTEND (Next.js)           │
│  /  /login  /library  /billing      │
│  /jobs/{id}  /studio  /studio/{id}  │
└──────────────┬──────────────────────┘
               ↕ HTTP REST
┌──────────────┴──────────────────────┐
│       BACKEND API (FastAPI)          │
│  /auth  /jobs  /billing  /studio    │
│  /stats  /subtitle-preview           │
└──────────────┬──────────────────────┘
               ↕ asyncpg
┌──────────────┴──────────────────────┐
│    PostgreSQL (Supabase x_translator)│
└──────────────┬──────────────────────┘
               ↕ Celery (Redis)
┌──────────────┴──────────────────────┐
│       WORKER (Celery)                │
│  pipeline_task → export_task        │
│  analyze_task → recovery_task       │
├─────────────────────────────────────┤
│  yt-dlp → Groq Whisper → OpenRouter │
│  → Hallucination Filter → FFmpeg    │
│  → Supabase Storage                 │
└─────────────────────────────────────┘
```

---

## 🔄 Pipeline

```
URL (X/YouTube)
    ↓ yt-dlp
Vidéo téléchargée
    ↓ Groq Whisper (whisper-large-v3-turbo)
Transcription SRT
    ↓ Hallucination Filter
SRT nettoyé
    ↓ DeepSeek V3 (OpenRouter)
Traduction SRT
    ↓ FFmpeg
Sous-titres brûlés + Watermark
    ↓ Supabase Storage
Vidéo disponible en streaming
```

---

## 🛠️ Stack

| Layer | Technologie |
|-------|-------------|
| Backend API | FastAPI + asyncpg |
| Worker | Celery + Redis (Railway) |
| Transcription | Groq Whisper large-v3-turbo |
| Traduction | OpenRouter DeepSeek V3 |
| Watermark | Pillow + FFmpeg |
| Stockage | Supabase Storage |
| Auth | Supabase Auth |
| Paiement | Stripe |
| Frontend | Next.js 14 App Router + Tailwind |
| Déploiement | Railway |

---

## 🔐 Variables d'Environnement

### Backend `.env`

| Variable | Description |
|----------|-------------|
| `GROQ_API_KEY` | Clé API Groq (transcription) |
| `OPENROUTER_API_KEY` | Clé API OpenRouter (traduction) |
| `DATABASE_URL` | PostgreSQL connection string |
| `DATABASE_URL_POOLER` | URL PgBouncer (transaction mode) |
| `REDIS_URL` | Redis broker URL |
| `SUPABASE_URL` | URL Supabase projet |
| `SUPABASE_SERVICE_KEY` | Service Role Key Supabase |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook secret |
| `JWT_SECRET` | Secret pour tokens JET |

### Frontend `.env.local`

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | URL backend API |
| `NEXT_PUBLIC_SUPABASE_URL` | URL Supabase projet |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key Supabase |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key |

---

## 🗄️ Base de données

Le schema est dans `database/schema.sql`.  
Les migrations incrémentales sont dans `database/migration_*.sql`.

**Migration à appliquer** après avoir créé les tables de base dans Supabase :
```sql
-- Copier-coller le contenu de database/migration_analytics_stats.sql
-- dans l'éditeur SQL Supabase
```

Tables : `jobs`, `subscriptions`, `transcription_segments`, `studio_projects`, `studio_clips`, `studio_exports`, `analytics_events`.

L'authentification est gérée par Supabase Auth (table `auth.users` automatique).

---

## 🚀 Déploiement Railway

### Services

| Service | Démarrage | Port |
|---------|-----------|------|
| Backend API | `uvicorn main:app --host 0.0.0.0 --port $PORT` | 8000 |
| Worker | `celery -A core.celery_app.celery_app worker -Q video_processing` | — |
| Frontend | `npm run build && node .next/standalone/server.js` | 3000 |
| Redis | Railway add-on | 6379 |

### Étapes

1. **Créer un projet Railway** depuis GitHub
2. **Ajouter Redis** : `Railway Dashboard → Add Plugin → Redis`
3. **Déployer 3 services** :
   - Backend API (`backend/Procfile` + `backend/railway.toml`)
   - Worker (même repo, commande Celery)
   - Frontend (`frontend/railway.toml`)
4. **Configurer les variables d'environnement** dans chaque service
5. **Appliquer la migration** dans Supabase SQL Editor
6. **Vérifier** : `GET /health` → `{"ok": true}`

---

## 🧪 Tests

```bash
cd backend
pytest tests/ -v
```

---

##  Licence

MIT License

---

**Dernière mise à jour**: 2026-04-24