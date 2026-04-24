#!/usr/bin/env python3
"""
scripts/migrate_timeline_editor.py — Migration DB pour l'éditeur de timeline
Ajoute custom_order + index + backup SRT originaux — x-translator-mvp
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from datetime import datetime

# Ajouter le backend au path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from core.db import get_conn
from core.config import settings


async def backup_original_srts() -> int:
    """Backup les SRT originaux de Whisper dans storage/srt_backups/
    
    Pour chaque job avec segments, tente de récupérer le SRT original
    depuis le dossier temporaire /tmp/{job_id}/source.srt si existant.
    """
    backup_dir = Path("storage/srt_backups")
    backup_dir.mkdir(parents=True, exist_ok=True)
    
    async with get_conn() as conn:
        # Récupérer tous les job_ids qui ont des segments
        rows = await conn.fetch(
            "SELECT DISTINCT job_id FROM transcription_segments"
        )
    
    backed_up = 0
    for row in rows:
        job_id = str(row["job_id"])
        source_srt = Path(f"/tmp/{job_id}/source.srt")
        
        if source_srt.exists():
            backup_path = backup_dir / f"{job_id}.srt"
            try:
                content = source_srt.read_text(encoding="utf-8")
                backup_path.write_text(content, encoding="utf-8")
                print(f"✅  Backup SRT pour {job_id[:8]}...")
                backed_up += 1
            except Exception as e:
                print(f"⚠️   Erreur backup {job_id[:8]}: {e}")
        else:
            # Chercher dans d'autres emplacements possibles
            alt_paths = [
                Path(f"tmp/{job_id}/source.srt"),
                Path(f"/tmp/whisper_{job_id}/source.srt"),
                Path(f"storage/tmp/{job_id}/source.srt"),
            ]
            for alt in alt_paths:
                if alt.exists():
                    try:
                        content = alt.read_text(encoding="utf-8")
                        (backup_dir / f"{job_id}.srt").write_text(content, encoding="utf-8")
                        print(f"✅  Backup SRT (alternatif) pour {job_id[:8]}...")
                        backed_up += 1
                        break
                    except Exception as e:
                        print(f"⚠️   Erreur backup alt {job_id[:8]}: {e}")
    
    return backed_up


async def run_migration() -> bool:
    """Exécute la migration SQL pour ajouter custom_order + index."""
    migration_file = Path("database/migration_timeline_editor.sql")
    
    if not migration_file.exists():
        print(f"❌  Fichier de migration introuvable: {migration_file}")
        return False
    
    sql_content = migration_file.read_text(encoding="utf-8")
    
    async with get_conn() as conn:
        try:
            print("🔧  Exécution de la migration SQL...")
            
            # Séparer les instructions SQL (simplifié)
            statements = [
                stmt.strip() 
                for stmt in sql_content.split(";") 
                if stmt.strip() and not stmt.strip().startswith("--")
            ]
            
            for i, stmt in enumerate(statements, 1):
                if stmt:
                    try:
                        await conn.execute(stmt)
                        print(f"   [{i}/{len(statements)}] {stmt[:60]}...")
                    except Exception as e:
                        # Gérer les erreurs "IF NOT EXISTS" qui peuvent être normales
                        if "already exists" in str(e).lower() or "duplicate" in str(e).lower():
                            print(f"   [{i}/{len(statements)}] ✅ (déjà appliqué) {stmt[:50]}...")
                        else:
                            print(f"   [{i}/{len(statements)}] ❌ Erreur: {e}")
                            return False
            
            # Vérification
            result = await conn.fetchrow(
                "SELECT COUNT(*) as total, COUNT(custom_order) as with_order "
                "FROM transcription_segments"
            )
            total = result["total"] or 0
            with_order = result["with_order"] or 0
            
            print(f"📊  Résultat migration:")
            print(f"    • Segments totaux: {total}")
            print(f"    • Segments avec custom_order: {with_order}")
            print(f"    • Ratio: {with_order}/{total} = {with_order/max(total,1)*100:.1f}%")
            
            return True
            
        except Exception as e:
            print(f"❌  Erreur pendant la migration: {e}")
            return False


async def verify_migration() -> bool:
    """Vérifie que la migration a été correctement appliquée."""
    async with get_conn() as conn:
        try:
            # Vérifier que la colonne existe
            col_check = await conn.fetchrow("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'transcription_segments' 
                  AND column_name = 'custom_order'
            """)
            
            if not col_check:
                print("❌  Colonne custom_order non trouvée")
                return False
            
            # Vérifier que l'index existe
            idx_check = await conn.fetchrow("""
                SELECT indexname 
                FROM pg_indexes 
                WHERE tablename = 'transcription_segments' 
                  AND indexname = 'idx_transcription_segments_job_id_order'
            """)
            
            if not idx_check:
                print("⚠️   Index idx_transcription_segments_job_id_order non trouvé")
                # Pas fatal, mais warning
            
            # Vérifier l'intégrité des ordres
            order_check = await conn.fetchrow("""
                SELECT 
                    COUNT(*) as total,
                    COUNT(DISTINCT (job_id, custom_order)) as unique_orders,
                    MIN(custom_order) as min_order,
                    MAX(custom_order) as max_order,
                    AVG(custom_order) as avg_order
                FROM transcription_segments 
                WHERE custom_order IS NOT NULL
            """)
            
            print("✅  Vérification migration:")
            print(f"    • Colonne custom_order: ✓")
            print(f"    • Index: {'✓' if idx_check else '⚠️'}")
            if order_check and order_check["total"] > 0:
                print(f"    • Ordres uniques: {order_check['unique_orders']}/{order_check['total']}")
                print(f"    • Plage ordres: {order_check['min_order']} → {order_check['max_order']}")
                print(f"    • Ordre moyen: {order_check['avg_order']:.1f}")
            
            return True
            
        except Exception as e:
            print(f"❌  Erreur vérification: {e}")
            return False


async def main():
    """Workflow complet de migration."""
    print("=" * 60)
    print("🔧  MIGRATION ÉDITEUR TIMELINE — x-translator-mvp")
    print("=" * 60)
    
    # 1. Backup SRT originaux
    print("\n📦  Étape 1 : Backup SRT originaux...")
    backed_up = await backup_original_srts()
    print(f"    {backed_up} SRT sauvegardés dans storage/srt_backups/")
    
    # 2. Exécuter migration SQL
    print("\n🗃️  Étape 2 : Migration base de données...")
    if not await run_migration():
        print("❌  Migration échouée")
        sys.exit(1)
    
    # 3. Vérifier la migration
    print("\n🔍  Étape 3 : Vérification...")
    if not await verify_migration():
        print("⚠️   Vérification avec avertissements")
    else:
        print("✅  Migration vérifiée avec succès")
    
    print("\n" + "=" * 60)
    print("✅  MIGRATION TERMINÉE")
    print("=" * 60)
    
    # Afficher les étapes suivantes
    print("\n📋  Prochaines étapes :")
    print("    1. Vérifier que backend/api/jobs.py a les nouveaux endpoints")
    print("    2. Ajouter backend/core/timeline_utils.py")
    print("    3. Étendre frontend/lib/api.ts avec les nouvelles fonctions")
    print("    4. Créer les composants frontend/components/timeline/")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n⚠️  Migration interrompue par l'utilisateur")
        sys.exit(130)
    except Exception as e:
        print(f"\n❌  Erreur inattendue: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)