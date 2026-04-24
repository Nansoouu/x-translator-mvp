-- migration_add_download_mode.sql - Ajout des colonnes pour le mode téléchargement seulement
-- Pour exécuter : psql -d votre_db -f database/migration_add_download_mode.sql

BEGIN;

-- Ajouter colonne download_only
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS download_only BOOLEAN DEFAULT FALSE;

-- Ajouter colonne mode
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'translate' CHECK (mode IN ('download', 'translate'));

-- Ajouter colonne pour stocker le nom du fichier original (upload)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS original_filename TEXT;

-- Mise à jour des valeurs existantes
UPDATE jobs SET mode = 'translate' WHERE mode IS NULL;

-- Index pour les jobs en mode download
CREATE INDEX IF NOT EXISTS idx_jobs_download_only ON jobs(download_only) WHERE download_only = TRUE;
CREATE INDEX IF NOT EXISTS idx_jobs_mode ON jobs(mode);

COMMIT;

-- Vérification
SELECT 
    column_name,
    data_type,
    column_default
FROM information_schema.columns 
WHERE table_name = 'jobs' 
AND column_name IN ('download_only', 'mode', 'original_filename')
ORDER BY column_name;