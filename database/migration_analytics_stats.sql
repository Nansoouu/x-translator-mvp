-- Migration: analytics + stats counters
-- x-translator-mvp
-- À exécuter dans l'éditeur SQL Supabase (public schema)

-- 1. Table analytics_events (CTA clicks, etc.)
CREATE TABLE IF NOT EXISTS analytics_events (
    id          BIGSERIAL PRIMARY KEY,
    event_type  TEXT NOT NULL,
    ip_address  INET,
    user_agent  TEXT,
    referrer    TEXT,
    metadata    JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Index pour les requêtes de stats
CREATE INDEX IF NOT EXISTS idx_analytics_events_type
    ON analytics_events (event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created
    ON analytics_events (created_at DESC);

-- 2. Index pour accélérer les stats jobs
CREATE INDEX IF NOT EXISTS idx_jobs_status_done
    ON jobs (status) WHERE status = 'done';
CREATE INDEX IF NOT EXISTS idx_jobs_created_done
    ON jobs (created_at DESC) WHERE status = 'done';
CREATE INDEX IF NOT EXISTS idx_jobs_user_id_date
    ON jobs (user_id, created_at DESC) WHERE user_id IS NOT NULL AND status = 'done';