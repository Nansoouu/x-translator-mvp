'use client';
import { useEffect, useState } from 'react';
import { listUserJobs, getPublicLibrary } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const STATUS_STYLES: Record<string, string> = {
  done:         'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  error:        'bg-red-500/10 text-red-400 border border-red-500/20',
  burning:      'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  uploading:    'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  translating:  'bg-violet-500/10 text-violet-400 border border-violet-500/20',
  transcribing: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
  downloading:  'bg-orange-500/10 text-orange-400 border border-orange-500/20',
  queued:       'bg-gray-800 text-gray-400 border border-gray-700',
};
const STATUS_LABELS: Record<string, string> = {
  done:         '✅ Terminé',
  error:        '❌ Erreur',
  burning:      '🎬 Rendu…',
  uploading:    '⬆️ Upload…',
  translating:  '🌐 Traduction…',
  transcribing: '🎙️ Transcription…',
  downloading:  '⬇️ Téléchargement…',
  queued:       '🕐 En attente',
};
const LANG_FLAGS: Record<string, string> = {
  fr:'🇫🇷', en:'🇬🇧', es:'🇪🇸', de:'🇩🇪', it:'🇮🇹', pt:'🇧🇷',
  ar:'🇸🇦', ru:'🇷🇺', zh:'🇨🇳', ja:'🇯🇵', ko:'🇰🇷', tr:'🇹🇷',
  nl:'🇳🇱', pl:'🇵🇱', uk:'🇺🇦', hi:'🇮🇳', fa:'🇮🇷', he:'🇮🇱', vi:'🇻🇳', id:'🇮🇩',
};

const ACTIVE_STATUSES = new Set(['queued', 'downloading', 'transcribing', 'translating', 'burning', 'uploading']);

function JobRow({ j, showDownload = true }: { j: any; showDownload?: boolean }) {
  const isActive = ACTIVE_STATUSES.has(j.status);
  return (
    <div className="group bg-gray-900/60 border border-gray-800 rounded-xl p-4 hover:border-gray-700 hover:bg-gray-900/80 transition-all flex items-start gap-4">
      <div className="shrink-0 w-9 h-9 bg-gray-800 rounded-lg flex items-center justify-center text-base border border-gray-700 font-bold text-gray-400">
        {j.source_url?.includes('youtube') || j.source_url?.includes('youtu.be') ? '▶' : '𝕏'}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-200 truncate">{j.source_url}</p>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className="text-[10px] bg-gray-800 border border-gray-700 px-2 py-0.5 rounded">
            {LANG_FLAGS[j.target_lang] || '🌐'} {j.target_lang?.toUpperCase()}
          </span>
          {j.duration_s && <span className="text-[10px] text-gray-600">⏱ {Math.round(j.duration_s)}s</span>}
          {j.created_at && (
            <span className="text-[10px] text-gray-600">
              {new Date(j.created_at).toLocaleDateString('fr-FR')}
            </span>
          )}
        </div>
        {j.summary && (
          <p className="text-[11px] text-gray-500 mt-1.5 line-clamp-2 italic">{j.summary}</p>
        )}
        {/* Mini barre de progression pour les jobs actifs */}
        {isActive && (
          <div className="mt-2 h-1 w-full bg-gray-800 rounded-full overflow-hidden">
            <div className="h-1 bg-blue-600 rounded-full animate-pulse" style={{ width: '60%' }} />
          </div>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-2">
        <span className={`text-[10px] px-2.5 py-1 rounded-full font-medium ${STATUS_STYLES[j.status] || STATUS_STYLES.queued}`}>
          {STATUS_LABELS[j.status] || j.status}
        </span>
        {showDownload && j.status === 'done' && j.storage_url && (
          <a
            href={`${API}/jobs/${j.id}/download`}
            target="_blank"
            rel="noopener noreferrer"
            title="Télécharger la vidéo"
            className="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-emerald-900/40 border border-gray-700 hover:border-emerald-700 text-gray-300 hover:text-emerald-400 transition-all"
          >
            ⬇️
          </a>
        )}
      </div>
    </div>
  );
}

export default function LibraryPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [myJobs, setMyJobs]       = useState<any[]>([]);
  const [publicJobs, setPublicJobs] = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    if (authLoading) return;

    if (isAuthenticated) {
      // Charger mes jobs + biblio publique en parallèle
      Promise.all([listUserJobs(), getPublicLibrary()])
        .then(([mine, pub]) => {
          setMyJobs(mine || []);
          setPublicJobs(pub || []);
        })
        .finally(() => setLoading(false));
    } else {
      // Seulement la bibliothèque publique
      getPublicLibrary()
        .then(pub => setPublicJobs(pub || []))
        .finally(() => setLoading(false));
    }
  }, [isAuthenticated, authLoading]);

  if (loading || authLoading) {
    return (
      <main className="h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-gray-500">
          <svg className="animate-spin h-7 w-7 text-blue-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          <p className="text-xs">Chargement…</p>
        </div>
      </main>
    );
  }

  const activeJobs = myJobs.filter(j => ACTIVE_STATUSES.has(j.status));
  const doneJobs   = myJobs.filter(j => j.status === 'done');
  const errorJobs  = myJobs.filter(j => j.status === 'error');

  return (
    <main className="h-screen overflow-y-auto bg-gray-950 text-white">
      <div className="max-w-5xl mx-auto px-4 py-10 space-y-10">

        {/* ── Section "Mes vidéos" (connectés) ─────────────────────────────── */}
        {isAuthenticated && (
          <div>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h1 className="text-lg font-bold text-white">Mes vidéos</h1>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {myJobs.length > 0
                    ? `${myJobs.length} vidéo${myJobs.length > 1 ? 's' : ''} au total`
                    : 'Aucune vidéo pour l\'instant'
                  }
                </p>
              </div>
              <Link
                href="/"
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                + Nouvelle vidéo
              </Link>
            </div>

            {myJobs.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-gray-800 rounded-2xl">
                <p className="text-3xl mb-3">🎬</p>
                <p className="text-sm font-semibold text-white mb-1">Aucune vidéo traduite</p>
                <p className="text-xs text-gray-500 mb-5">Traduisez votre première vidéo maintenant.</p>
                <Link
                  href="/"
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-colors"
                >
                  Traduire une vidéo
                </Link>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Jobs en cours */}
                {activeJobs.length > 0 && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-blue-400 mb-3 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                      En cours ({activeJobs.length})
                    </p>
                    <div className="space-y-2">
                      {activeJobs.map(j => <JobRow key={j.id} j={j} />)}
                    </div>
                  </div>
                )}

                {/* Jobs terminés */}
                {doneJobs.length > 0 && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">
                      Terminées ({doneJobs.length})
                    </p>
                    <div className="space-y-2">
                      {doneJobs.map(j => <JobRow key={j.id} j={j} />)}
                    </div>
                  </div>
                )}

                {/* Jobs en erreur */}
                {errorJobs.length > 0 && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-red-500 mb-3">
                      Erreurs ({errorJobs.length})
                    </p>
                    <div className="space-y-2">
                      {errorJobs.map(j => <JobRow key={j.id} j={j} />)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Section bibliothèque publique ───────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-bold text-white">
                {isAuthenticated ? 'Bibliothèque publique' : '🎬 Bibliothèque'}
              </h2>
              <p className="text-[11px] text-gray-500 mt-0.5">
                {publicJobs.length > 0
                  ? `${publicJobs.length} vidéo${publicJobs.length > 1 ? 's' : ''} traduites par la communauté`
                  : 'Aucune vidéo publique pour l\'instant'
                }
              </p>
            </div>
            {!isAuthenticated && (
              <Link
                href="/"
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                + Traduire une vidéo
              </Link>
            )}
          </div>

          {publicJobs.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-gray-800 rounded-2xl">
              <p className="text-3xl mb-3">🌐</p>
              <p className="text-sm font-semibold text-white mb-1">Aucune vidéo publique</p>
              <p className="text-xs text-gray-500">Soyez le premier à traduire une vidéo !</p>
            </div>
          ) : (
            <div className="space-y-2">
              {publicJobs.map((j: any) => (
                <JobRow key={j.id} j={j} showDownload={true} />
              ))}
            </div>
          )}
        </div>

        {!isAuthenticated && (
          <div className="bg-blue-600/10 border border-blue-500/20 rounded-2xl p-6 text-center">
            <p className="text-sm font-semibold text-white mb-1">
              Sauvegardez vos traductions
            </p>
            <p className="text-xs text-gray-400 mb-4">
              Créez un compte gratuit pour retrouver toutes vos vidéos traduites ici.
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-colors"
            >
              Créer un compte gratuit →
            </Link>
          </div>
        )}

        <p className="text-center">
          <Link href="/" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
            ← Retour à l'accueil
          </Link>
        </p>
      </div>
    </main>
  );
}
