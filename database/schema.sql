-- schema.sql — x-translator-mvp
-- Compatible Supabase (auth.users gérés automatiquement)

CREATE TABLE IF NOT EXISTS jobs (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID,
    source_url     TEXT NOT NULL,
    target_lang    TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'queued',
    error_msg      TEXT,
    storage_key    TEXT,
    storage_url    TEXT,
    source_lang    TEXT,
    summary        TEXT,
    duration_s     FLOAT,
    video_type     TEXT DEFAULT 'short',
    thumbnail_url  TEXT,
    download_count INTEGER DEFAULT 0,
    created_at     TIMESTAMPTZ DEFAULT now(),
    updated_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL UNIQUE,
    stripe_customer_id      TEXT,
    stripe_subscription_id  TEXT,
    plan                    TEXT NOT NULL DEFAULT 'free',
    credits_remaining       INT NOT NULL DEFAULT 3,
    period_end              TIMESTAMPTZ,
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now()
);

-- Migrations pour bases existantes
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS download_count INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
