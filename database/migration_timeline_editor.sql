-- migration_timeline_editor.sql — Ajout custom_order + index — x-translator-mvp
-- Compatible Supabase (exécuter manuellement ou via script)

-- 1. Ajouter la colonne custom_order si elle n'existe pas
ALTER TABLE transcription_segments ADD COLUMN IF NOT EXISTS custom_order INTEGER;

-- 2. Créer un index composite pour les requêtes rapides (NULLS LAST pour les segments sans ordre)
CREATE INDEX IF NOT EXISTS idx_transcription_segments_job_id_order 
  ON transcription_segments(job_id, custom_order NULLS LAST);

-- 3. Initialiser les custom_order basés sur l'ordre chronologique (start_time)
--    Utiliser un step de 10 pour laisser de la marge aux inserts futurs
UPDATE transcription_segments 
SET custom_order = sub.rn * 10
FROM (
  SELECT 
    id,
    ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY start_time) AS rn
  FROM transcription_segments
) sub
WHERE transcription_segments.id = sub.id;

-- 4. Vérification : compter les segments mis à jour
-- SELECT COUNT(*) as segments_updated FROM transcription_segments WHERE custom_order IS NOT NULL;

-- 5. Pour les futures insertions, on peut définir une valeur par défaut via trigger ou application
--    Ici on s'appuiera sur l'application pour gérer l'ordre.

-- Note : Cette migration est idempotente (ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS)
--        et peut être relancée sans danger.