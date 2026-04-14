'use client';
import { useEffect, useState } from 'react';
import { listUserJobs, getPublicLibrary } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// ── Constantes ────────────────────────────────────────────────────────────────
const LANG_FLAGS: Record<string, string> = {
  fr: '🇫🇷', en: '🇬🇧', es: '🇪🇸', de: '🇩🇪', it: '🇮🇹', pt: '🇧🇷',
  ar: '🇸🇦', ru: '🇷🇺', zh: '🇨🇳', ja: '🇯🇵', ko: '🇰🇷', tr: '🇹🇷',
  nl: '🇳🇱', pl: '🇵🇱', uk: '🇺🇦', hi: '🇮🇳', fa: '🇮🇷', he: '🇮🇱',
  vi: '🇻🇳', id: '🇮🇩',
};
const LANG_NAMES: Record<string, string> = {
  fr: 'Français', en: 'English', es: 'Español', de: 'Deutsch',
  it: 'Italiano', pt: 'Português', ar: 'العربية', ru: 'Русский',
  zh: '中文', ja: '日本語', ko: '한국어', tr: 'Türkçe',
  nl: 'Nederlands', pl: 'Polski', uk: 'Українська', hi: 'हिन्दी',
  fa: 'فارسی', he: 'עברית', vi: 'Tiếng Việt', id: 'Bahasa Indonesia',
};

const ACTIVE_STATUSES = new Set([
  'queued', 'downloading', 'transcribing', 'translating', 'burning', 'uploading',
]);

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

const STATUS_COLORS: Record<string, string> = {
  done:         'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  error:        'bg-red-500/20 text-red-400 border-red-500/30',
  burning:      'bg-blue-500/20 text-blue-400 border-blue-500/30',
  uploading:    'bg-blue-500/20 text-blue-400 border-blue-500/30',
  translating:  'bg-violet-500/20 text-violet-400 border-violet-500/30',
  transcribing: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  downloading:  'bg-orange-500/20 text-orange-400 border-orange-500/30',
  queued:       'bg-gray-800 text-gray-400 border-gray-700',
};

// ── Formatage date relative ───────────────────────────────────────────────────
function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'à l\'instant';
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `il y a ${d} j`;
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

// ── Thumbnail placeholder ─────────────────────────────────────────────────────
function ThumbnailPlaceholder({ url }: { url?: string }) {
  const isYT = url?.includes('youtube') || url?.includes('youtu.be');
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
      <span className="text-3xl opacity-30">{isYT ? '▶' : '𝕏'}</span>
    </div>
  );
}

// ── Carte vidéo ───────────────────────────────────────────────────────────────
function VideoCard({ j, showDownload = true }: { j: any; showDownload?: boolean }) {
  const isActive  = ACTIVE_STATUSES.has(j.status);
  const isDone    = j.status === 'done';
  const isError   = j.status === 'error';
  const flag      = LANG_FLAGS[j.target_lang] || '🌐';
  const langName  = LANG_NAMES[j.target_lang] || j.target_lang?.toUpperCase();
  const statusCls = STATUS_COLORS[j.status] || STATUS_COLORS.queued;
  const dlUrl     = `${API}/jobs/${j.id}/download`;

  return (
    <div className={`
      group relative flex flex-col bg-gray-900 border rounded-2xl overflow-hidden
      transition-all duration-200 hover:shadow-xl hover:shadow-black/40
      ${isActive ? 'border-blue-800/50' : isError ? 'border-red-900/40' : 'border-gray-800 hover:border-gray-700'}
    `}>
      {/* Thumbnail */}
      <div className="relative aspect-video bg-gray-900 overflow-hidden">
        {j.thumbnail_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={j.thumbnail_url}
            alt={j.summary || 'Vidéo traduite'}
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <ThumbnailPlaceholder url={j.source_url} />
        )}

        {/* Overlay gradient bas */}
        <div className="absolute inset-0 bg-gradient-to-t from-gray-950/80 via-transparent to-transparent" />

        {/* Badge langue — bas gauche */}
        <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-gray-950/80 backdrop-blur-sm border border-white/10 rounded-lg px-2 py-1">
          <span className="text-sm leading-none">{flag}</span>
          <span className="text-[10px] font-semibold text-gray-200 leading-none">{langName}</span>
        </div>

        {/* Badge durée — bas droite */}
        {j.duration_s && (
          <div className="absolute bottom-2 right-2 bg-gray-950/80 backdrop-blur-sm border border-white/10 rounded-md px-1.5 py-0.5">
            <span className="text-[10px] text-gray-300">
              {Math.floor(j.duration_s / 60)}:{String(Math.round(j.duration_s % 60)).padStart(2, '0')}
            </span>
          </div>
        )}

        {/* Overlay spinner pour jobs actifs */}
        {isActive && (
          <div className="absolute inset-0 bg-gray-950/60 backdrop-blur-[1px] flex flex-col items-center justify-center gap-2">
            <svg className="animate-spin h-8 w-8 text-blue-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            <span className="text-[11px] font-medium text-blue-300">
              {STATUS_LABELS[j.status] || j.status}
            </span>
            {/* Barre de progression */}
            <div className="w-24 h-1 bg-gray-800 rounded-full overflow-hidden mt-1">
              <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{ width: '60%' }} />
            </div>
          </div>
        )}

        {/* Hover play overlay sur les vidéos terminées */}
        {isDone && (
          <div className="absolute inset-0 bg-gray-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center">
              <span className="text-white text-lg ml-0.5">▶</span>
            </div>
          </div>
        )}
      </div>

      {/* Corps de la carte */}
      <div className="flex flex-col flex-1 p-3 gap-2">
        {/* Résumé ou URL */}
        {j.summary ? (
          <p className="text-xs text-gray-200 line-clamp-2 leading-relaxed">{j.summary}</p>
        ) : (
          <p className="text-[11px] text-gray-500 truncate font-mono">{j.source_url}</p>
        )}

        {/* Footer : date + stats + actions */}
        <div className="flex items-center justify-between mt-auto pt-1 border-t border-gray-800">
          <div className="flex items-center gap-2.5 text-[10px] text-gray-600">
            {j.created_at && <span>{relativeTime(j.created_at)}</span>}
            {j.download_count > 0 && (
              <span className="flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {j.download_count}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {/* Status badge (sauf done, géré par le hover) */}
            {!isDone && (
              <span className={`text-[9px] px-2 py-0.5 rounded-full border font-semibold ${statusCls}`}>
                {STATUS_LABELS[j.status] || j.status}
              </span>
            )}

            {/* Bouton téléchargement */}
            {showDownload && isDone && j.storage_url && (
              <a
                href={dlUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Télécharger la vidéo traduite"
                className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-emerald-950/60 border border-gray-700 hover:border-emerald-700 text-gray-300 hover:text-emerald-400 transition-all"
                onClick={(e) => e.stopPropagation()}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                DL
              </a>
            )}

            {/* Bouton erreur */}
            {isError && (
              <span title={j.error_msg || 'Erreur inconnue'} className="text-[10px] text-red-500 cursor-help">
                ⚠️
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Section grille ────────────────────────────────────────────────────────────
function VideoGrid({ jobs, showDownload = true }: { jobs: any[]; showDownload?: boolean }) {
  if (jobs.length === 0) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {jobs.map((j) => (
        <VideoCard key={j.id} j={j} showDownload={showDownload} />
      ))}
    </div>
  );
}

// ── Spinner de chargement ─────────────────────────────────────────────────────
function LoadingScreen() {
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

// ── Page principale ───────────────────────────────────────────────────────────
export default function LibraryPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [myJobs, setMyJobs]         = useState<any[]>([]);
  const [publicJobs, setPublicJobs] = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (isAuthenticated) {
      Promise.all([listUserJobs(), getPublicLibrary()])
        .then(([mine, pub]) => {
          setMyJobs(mine || []);
          setPublicJobs(pub || []);
        })
        .finally(() => setLoading(false));
    } else {
      getPublicLibrary()
        .then((pub) => setPublicJobs(pub || []))
        .finally(() => setLoading(false));
    }
  }, [isAuthenticated, authLoading]);

  if (loading || authLoading) return <LoadingScreen />;

  const activeJobs = myJobs.filter((j) => ACTIVE_STATUSES.has(j.status));
  const doneJobs   = myJobs.filter((j) => j.status === 'done');
  const errorJobs  = myJobs.filter((j) => j.status === 'error');

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-6xl mx-auto px-4 py-10 space-y-12">

        {/* ── Mes vidéos (connectés) ──────────────────────────────────────── */}
        {isAuthenticated && (
          <section>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-xl font-bold text-white tracking-tight">Mes vidéos</h1>
                <p className="text-xs text-gray-500 mt-0.5">
                  {myJobs.length > 0
                    ? `${myJobs.length} vidéo${myJobs.length > 1 ? 's' : ''} au total`
                    : 'Aucune vidéo pour l\'instant'}
                </p>
              </div>
              <Link
                href="/"
                className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Nouvelle vidéo
              </Link>
            </div>

            {myJobs.length === 0 ? (
              <div className="text-center py-16 border border-dashed border-gray-800 rounded-2xl">
                <p className="text-4xl mb-4">🎬</p>
                <p className="text-sm font-semibold text-white mb-1">Aucune vidéo traduite</p>
                <p className="text-xs text-gray-500 mb-6">Traduisez votre première vidéo en quelques clics.</p>
                <Link
                  href="/"
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-colors"
                >
                  Traduire une vidéo →
                </Link>
              </div>
            ) : (
              <div className="space-y-8">
                {/* Jobs en cours */}
                {activeJobs.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                      <p className="text-[11px] font-bold uppercase tracking-widest text-blue-400">
                        En cours ({activeJobs.length})
                      </p>
                    </div>
                    <VideoGrid jobs={activeJobs} />
                  </div>
                )}

                {/* Jobs terminés */}
                {doneJobs.length > 0 && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-4">
                      Terminées ({doneJobs.length})
                    </p>
                    <VideoGrid jobs={doneJobs} />
                  </div>
                )}

                {/* Jobs en erreur */}
                {errorJobs.length > 0 && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-red-500 mb-4">
                      Erreurs ({errorJobs.length})
                    </p>
                    <VideoGrid jobs={errorJobs} showDownload={false} />
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* ── Bibliothèque publique ────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">
                {isAuthenticated ? 'Bibliothèque publique' : '🎬 Bibliothèque'}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {publicJobs.length > 0
                  ? `${publicJobs.length} vidéo${publicJobs.length > 1 ? 's' : ''} traduites par la communauté`
                  : 'Aucune vidéo publique pour l\'instant'}
              </p>
            </div>
            {!isAuthenticated && (
              <Link
                href="/"
                className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Traduire
              </Link>
            )}
          </div>

          {publicJobs.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-gray-800 rounded-2xl">
              <p className="text-4xl mb-4">🌐</p>
              <p className="text-sm font-semibold text-white mb-1">Aucune vidéo publique</p>
              <p className="text-xs text-gray-500">Soyez le premier à traduire une vidéo !</p>
            </div>
          ) : (
            <VideoGrid jobs={publicJobs} showDownload={true} />
          )}
        </section>

        {/* ── CTA inscription (visiteurs) ─────────────────────────────────── */}
        {!isAuthenticated && (
          <section className="bg-gradient-to-br from-blue-900/20 to-violet-900/20 border border-blue-500/20 rounded-2xl p-8 text-center">
            <p className="text-base font-bold text-white mb-2">
              Sauvegardez vos traductions
            </p>
            <p className="text-sm text-gray-400 mb-6 max-w-sm mx-auto">
              Créez un compte gratuit pour retrouver toutes vos vidéos traduites ici et accéder à votre historique.
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-7 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-colors"
            >
              Créer un compte gratuit →
            </Link>
          </section>
        )}

        <p className="text-center pb-4">
          <Link href="/" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
            ← Retour à l'accueil
          </Link>
        </p>
      </div>
    </main>
  );
}
