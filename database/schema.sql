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

-- ─── Studio ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS studio_projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID,
    source_job_id   UUID REFERENCES jobs(id) ON DELETE SET NULL,
    source_url      TEXT,
    source_title    TEXT,
    status          TEXT NOT NULL DEFAULT 'queued',  -- queued|analyzing|ready|error
    error_msg       TEXT,
    transcript      TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS studio_clips (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES studio_projects(id) ON DELETE CASCADE,
    start_s         FLOAT NOT NULL,
    end_s           FLOAT NOT NULL,
    score           INT NOT NULL DEFAULT 0,
    hook_type       TEXT,   -- question|shock|laugh|fact|story|emotion
    title           TEXT,
    suggested_text  TEXT,
    caption_style   JSONB,
    hashtags        TEXT[],
    description     TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS studio_exports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES studio_projects(id) ON DELETE CASCADE,
    user_id         UUID,
    clip_ids        UUID[],
    format          TEXT NOT NULL DEFAULT '9:16',   -- 9:16|16:9|1:1
    translate_to    TEXT,                            -- langue cible Agent 1 (optionnel)
    status          TEXT NOT NULL DEFAULT 'queued',  -- queued|processing|done|error
    output_urls     JSONB,
    kit_publication JSONB,
    error_msg       TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_studio_projects_user_id   ON studio_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_studio_clips_project_id   ON studio_clips(project_id);
CREATE INDEX IF NOT EXISTS idx_studio_exports_project_id ON studio_exports(project_id);

-- Migrations pour bases existantes
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS download_count INTEGER DEFAULT 0;
ALTER TABLE studio_projects ADD COLUMN IF NOT EXISTS ai_advice TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
