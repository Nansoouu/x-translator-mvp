'use client';
import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { listUserJobs, getPublicLibrary, submitJob } from '@/lib/api';
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
const ALL_LANGS = Object.keys(LANG_FLAGS);

const ACTIVE_STATUSES = new Set([
  'queued', 'downloading', 'transcribing', 'translating', 'burning', 'uploading',
]);

const STATUS_LABELS: Record<string, string> = {
  done:         '✅ Terminé',
  error:        '❌ Erreur',
  burning:      '🎬 Finalisation…',
  uploading:    '✨ Bientôt prêt…',
  translating:  '🌐 Traduction…',
  transcribing: '🎙️ Écoute…',
  downloading:  '⬇️ Récupération…',
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

// ── Types ─────────────────────────────────────────────────────────────────────
type LangVariant = {
  lang: string;
  job_id: string;
  status: string;
  storage_url?: string;
  created_at?: string;
  download_count?: number;
};
type GroupedVideo = {
  key: string;           // source_url ou id (si pas de source_url)
  source_url: string;
  thumbnail_url?: string;
  summary?: string;
  source_lang?: string;
  duration_s?: number;
  video_type?: string;   // 'short' (TikTok/Reels 9:16) ou 'long'
  created_at: string;
  download_count: number;
  variants: LangVariant[];
  best_done_url?: string;
  best_done_job_id?: string;
};

// ── Dédupliquer les variants par langue (garder le meilleur statut) ──────────
const VARIANT_PRIORITY = ['done', 'uploading', 'burning', 'translating', 'transcribing', 'downloading', 'queued', 'error'];

function deduplicateVariants(variants: LangVariant[]): LangVariant[] {
  const byLang = new Map<string, LangVariant>();
  for (const v of variants) {
    const existing = byLang.get(v.lang);
    if (!existing) {
      byLang.set(v.lang, v);
    } else {
      const p1 = VARIANT_PRIORITY.indexOf(v.status);
      const p2 = VARIANT_PRIORITY.indexOf(existing.status);
      // Index plus bas = priorité plus haute (done = 0, error = 7)
      if (p1 !== -1 && (p2 === -1 || p1 < p2)) {
        byLang.set(v.lang, v);
      }
    }
  }
  return Array.from(byLang.values());
}

// ── Grouper les jobs par source_url ──────────────────────────────────────────
function groupJobs(jobs: any[]): GroupedVideo[] {
  const map = new Map<string, GroupedVideo>();
  for (const j of jobs) {
    const key = j.source_url || j.id;
    if (!map.has(key)) {
      map.set(key, {
        key,
        source_url:   j.source_url,
        thumbnail_url: j.thumbnail_url,
        summary:      j.summary,
        source_lang:  j.source_lang,
        duration_s:   j.duration_s,
        video_type:   j.video_type,
        created_at:   j.created_at,
        download_count: j.download_count || 0,
        variants:     [],
        best_done_url: undefined,
        best_done_job_id: undefined,
      });
    }
    const g = map.get(key)!;
    g.variants.push({
      lang:          j.target_lang,
      job_id:        j.id,
      status:        j.status,
      storage_url:   j.storage_url,
      created_at:    j.created_at,
      download_count: j.download_count || 0,
    });
    // Peupler les champs enrichis depuis le job le plus récent
    if (!g.summary && j.summary)         g.summary = j.summary;
    if (!g.thumbnail_url && j.thumbnail_url) g.thumbnail_url = j.thumbnail_url;
    if (!g.source_lang && j.source_lang) g.source_lang = j.source_lang;
    if (!g.duration_s && j.duration_s)   g.duration_s = j.duration_s;
    if (!g.video_type && j.video_type)   g.video_type = j.video_type;
    if (j.status === 'done' && j.storage_url && !g.best_done_url) {
      g.best_done_url    = j.storage_url;
      g.best_done_job_id = j.id;
    }
    g.download_count += (j.download_count || 0);
  }
  // Dédupliquer les variants par langue et recalculer best_done
  return Array.from(map.values()).map((g) => {
    g.variants = deduplicateVariants(g.variants);
    // Recalculer best_done_url à partir des variants dédupliqués
    const doneVariant = g.variants.find((v) => v.status === 'done' && v.storage_url);
    if (doneVariant) {
      g.best_done_url    = doneVariant.storage_url;
      g.best_done_job_id = doneVariant.job_id;
    }
    return g;
  });
}

// ── Date relative ─────────────────────────────────────────────────────────────
function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return 'à l\'instant';
  const m = Math.floor(s / 60);
  if (m < 60)  return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30)  return `il y a ${d} j`;
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

// ── Téléchargement forcé (blob) ───────────────────────────────────────────────
async function forceDownload(jobId: string) {
  const url = `${API}/jobs/${jobId}/download`;
  try {
    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    const resp = await fetch(url, { headers, redirect: 'follow' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const blob = await resp.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = `spottedyou-video-${jobId.slice(0, 8)}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objUrl), 2000);
  } catch {
    window.open(url, '_blank');
  }
}

// ── Modal lecteur vidéo ───────────────────────────────────────────────────────
function VideoModal({ storageUrl, onClose }: { storageUrl: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl bg-gray-950 rounded-2xl overflow-hidden border border-gray-700 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <video
          src={storageUrl}
          controls
          autoPlay
          className="w-full aspect-video bg-black"
        />
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-gray-900/80 border border-gray-700 hover:border-gray-500 flex items-center justify-center text-gray-400 hover:text-white transition-all"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// ── Modal "Ajouter une langue" ────────────────────────────────────────────────
function AddLangModal({
  g,
  onClose,
  onAdd,
  isAuthenticated,
}: {
  g: GroupedVideo;
  onClose: () => void;
  onAdd: (sourceUrl: string, lang: string) => void;
  isAuthenticated: boolean;
}) {
  const existingLangs = new Set(g.variants.map((v) => v.lang));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-white mb-1">Ajouter une traduction</h3>
        <p className="text-[11px] text-gray-500 mb-4 truncate">{g.source_url}</p>

        {!isAuthenticated && (
          <div className="mb-4 bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-[11px] text-blue-300">
            💡 <Link href="/login" className="underline hover:text-blue-200">Connectez-vous</Link> pour ajouter des traductions et les retrouver dans votre bibliothèque.
          </div>
        )}

        <div className="grid grid-cols-4 gap-2 max-h-56 overflow-y-auto pr-1">
          {ALL_LANGS.map((lang) => {
            const exists  = existingLangs.has(lang);
            const flag    = LANG_FLAGS[lang] ?? '🌐';
            const name    = LANG_NAMES[lang] ?? lang;
            return (
              <button
                key={lang}
                onClick={() => !exists && onAdd(g.source_url, lang)}
                disabled={exists}
                title={name}
                className={`
                  flex flex-col items-center gap-0.5 p-2 rounded-xl border text-center transition-all
                  ${exists
                    ? 'border-emerald-700/40 bg-emerald-950/30 opacity-60 cursor-not-allowed'
                    : 'border-gray-700 bg-gray-800 hover:border-blue-500 hover:bg-blue-500/10 cursor-pointer'}
                `}
              >
                <span className="text-xl leading-none">{flag}</span>
                <span className="text-[9px] text-gray-400 leading-none">{lang.toUpperCase()}</span>
                {exists && <span className="text-[8px] text-emerald-500 leading-none">✓</span>}
              </button>
            );
          })}
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full text-xs text-gray-600 hover:text-gray-400 transition-colors py-1"
        >
          Fermer
        </button>
      </div>
    </div>
  );
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

// ── Carte vidéo groupée ───────────────────────────────────────────────────────
function VideoCard({
  g,
  showDownload,
  onPlay,
  onAddLang,
}: {
  g: GroupedVideo;
  showDownload?: boolean;
  onPlay: (url: string) => void;
  onAddLang: (g: GroupedVideo) => void;
}) {
  const hasAnyDone  = g.variants.some((v) => v.status === 'done');
  const hasActive   = g.variants.some((v) => ACTIVE_STATUSES.has(v.status));
  const hasError    = g.variants.every((v) => v.status === 'error');
  const doneVariants   = g.variants.filter((v) => v.status === 'done');
  const activeVariants = g.variants.filter((v) => ACTIVE_STATUSES.has(v.status));

  return (
    <div className={`
      group relative flex flex-col bg-gray-900 border rounded-2xl overflow-hidden
      transition-all duration-200 hover:shadow-xl hover:shadow-black/40
      ${hasActive  ? 'border-blue-800/50'
      : hasError   ? 'border-red-900/40'
      :               'border-gray-800 hover:border-gray-700'}
    `}>
      {/* Thumbnail — aspect 9:16 pour TikTok/Reels, 16:9 sinon */}
      <div className={`relative ${g.video_type === 'short' ? 'aspect-[9/16]' : 'aspect-video'} bg-gray-900 overflow-hidden`}>
        {g.thumbnail_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={g.thumbnail_url}
            alt={g.summary || 'Vidéo traduite'}
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <ThumbnailPlaceholder url={g.source_url} />
        )}

        {/* Overlay gradient bas */}
        <div className="absolute inset-0 bg-gradient-to-t from-gray-950/80 via-transparent to-transparent" />

        {/* Badge durée — bas droite */}
        {g.duration_s && (
          <div className="absolute bottom-2 right-2 bg-gray-950/80 backdrop-blur-sm border border-white/10 rounded-md px-1.5 py-0.5">
            <span className="text-[10px] text-gray-300">
              {Math.floor(g.duration_s / 60)}:{String(Math.round(g.duration_s % 60)).padStart(2, '0')}
            </span>
          </div>
        )}

        {/* Overlay spinner pour jobs actifs */}
        {hasActive && (
          <div className="absolute inset-0 bg-gray-950/60 backdrop-blur-[1px] flex flex-col items-center justify-center gap-2">
            <svg className="animate-spin h-8 w-8 text-blue-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            <span className="text-[11px] font-medium text-blue-300">
              {activeVariants.length > 1
                ? `${activeVariants.length} traductions en cours…`
                : STATUS_LABELS[activeVariants[0]?.status] || 'En cours…'}
            </span>
          </div>
        )}

        {/* Hover play overlay sur les vidéos terminées */}
        {hasAnyDone && g.best_done_url && (
          <button
            type="button"
            onClick={() => onPlay(g.best_done_url!)}
            className="absolute inset-0 bg-gray-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
          >
            <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center">
              <span className="text-white text-lg ml-0.5">▶</span>
            </div>
          </button>
        )}
      </div>

      {/* Corps de la carte */}
      <div className="flex flex-col flex-1 p-3 gap-2">
        {/* Résumé */}
        {g.summary ? (
          <p className="text-xs text-gray-200 line-clamp-2 leading-relaxed">{g.summary}</p>
        ) : (
          <p className="text-[11px] text-gray-500 truncate font-mono">{g.source_url}</p>
        )}

        {/* Langue source */}
        {g.source_lang && (
          <div className="flex items-center gap-1 text-[10px] text-gray-600">
            <span className="text-base leading-none">{LANG_FLAGS[g.source_lang] ?? '🌐'}</span>
            <span>Vidéo originale en {LANG_NAMES[g.source_lang] ?? g.source_lang}</span>
          </div>
        )}

        {/* Langues disponibles */}
        <div className="flex flex-wrap items-center gap-1">
          {g.variants.map((v) => {
            const flag = LANG_FLAGS[v.lang] ?? '🌐';
            const name = LANG_NAMES[v.lang] ?? v.lang;
            const isDone   = v.status === 'done';
            const isActive = ACTIVE_STATUSES.has(v.status);
            return (
              <button
                key={v.lang}
                title={`${name} — ${isDone ? 'Terminé' : STATUS_LABELS[v.status] ?? v.status}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isDone && v.storage_url) onPlay(v.storage_url);
                }}
                className={`
                  flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-medium transition-all
                  ${isDone   ? 'border-emerald-700/50 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-950/60 cursor-pointer'
                  : isActive ? 'border-blue-700/50 bg-blue-950/30 text-blue-300 cursor-wait'
                  :            'border-red-900/40 bg-red-950/20 text-red-400 cursor-default'}
                `}
              >
                <span className="text-sm leading-none">{flag}</span>
                <span>{v.lang.toUpperCase()}</span>
                {isActive && (
                  <svg className="animate-spin w-2 h-2 ml-0.5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                )}
              </button>
            );
          })}

          {/* Bouton + Ajouter une langue */}
          <button
            onClick={(e) => { e.stopPropagation(); onAddLang(g); }}
            title="Ajouter une traduction"
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border border-dashed border-gray-700 text-gray-600 hover:border-blue-600 hover:text-blue-400 text-[10px] transition-all"
          >
            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span>+</span>
          </button>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between mt-auto pt-1 border-t border-gray-800">
          <div className="flex items-center gap-2.5 text-[10px] text-gray-600">
            {g.created_at && <span>{relativeTime(g.created_at)}</span>}
            {g.download_count > 0 && (
              <span className="flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {g.download_count}
              </span>
            )}
          </div>

          {/* Bouton DL (force blob download) */}
          {showDownload && g.best_done_job_id && (
            <button
              onClick={(e) => { e.stopPropagation(); forceDownload(g.best_done_job_id!); }}
              title="Télécharger"
              className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-emerald-950/60 border border-gray-700 hover:border-emerald-700 text-gray-300 hover:text-emerald-400 transition-all"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              DL
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Section grille ────────────────────────────────────────────────────────────
function VideoGrid({
  groups,
  showDownload = true,
  onPlay,
  onAddLang,
}: {
  groups: GroupedVideo[];
  showDownload?: boolean;
  onPlay: (url: string) => void;
  onAddLang: (g: GroupedVideo) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {groups.map((g) => (
        <VideoCard
          key={g.key}
          g={g}
          showDownload={showDownload}
          onPlay={onPlay}
          onAddLang={onAddLang}
        />
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
  const t = useTranslations('LibraryPage');
  const tC = useTranslations('Common');
  const [myJobs,     setMyJobs]     = useState<any[]>([]);
  const [publicJobs, setPublicJobs] = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);

  // Modal état
  const [playerUrl,    setPlayerUrl]    = useState<string | null>(null);
  const [addLangVideo, setAddLangVideo] = useState<GroupedVideo | null>(null);
  const [addLangMsg,   setAddLangMsg]   = useState<string | null>(null);

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

  const handleAddLang = useCallback(async (sourceUrl: string, lang: string) => {
    setAddLangVideo(null);
    setAddLangMsg(`⏳ Traduction ${LANG_NAMES[lang] ?? lang} lancée…`);
    try {
      await submitJob(sourceUrl, lang);
      setAddLangMsg(`✅ Traduction ${LANG_NAMES[lang] ?? lang} ajoutée à la file !`);
      // Rafraîchir les jobs
      if (isAuthenticated) {
        listUserJobs().then((mine) => setMyJobs(mine || []));
      }
    } catch (e: any) {
      setAddLangMsg(`❌ ${e?.detail?.message || e?.message || 'Erreur'}`);
    }
    setTimeout(() => setAddLangMsg(null), 4000);
  }, [isAuthenticated]);

  if (loading || authLoading) return <LoadingScreen />;

  const allMyGroups    = groupJobs(myJobs);
  const activeGroups   = allMyGroups.filter((g) => g.variants.some((v) => ACTIVE_STATUSES.has(v.status)));
  const doneGroups     = allMyGroups.filter((g) => g.variants.some((v) => v.status === 'done'));
  const errorGroups    = allMyGroups.filter((g) => g.variants.every((v) => v.status === 'error'));
  const publicGroups   = groupJobs(publicJobs);

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      {/* Modal vidéo */}
      {playerUrl && (
        <VideoModal storageUrl={playerUrl} onClose={() => setPlayerUrl(null)} />
      )}

      {/* Modal ajouter langue */}
      {addLangVideo && (
        <AddLangModal
          g={addLangVideo}
          onClose={() => setAddLangVideo(null)}
          onAdd={handleAddLang}
          isAuthenticated={isAuthenticated}
        />
      )}

      {/* Toast message */}
      {addLangMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl bg-gray-900 border border-gray-700 text-sm text-white shadow-2xl">
          {addLangMsg}
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 py-10 space-y-12">

        {/* ── Mes vidéos (connectés) ──────────────────────────────────────── */}
        {isAuthenticated && (
          <section>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-xl font-bold text-white tracking-tight">{t('myVideosTitle')}</h1>
                <p className="text-xs text-gray-500 mt-0.5">
                  {allMyGroups.length > 0
                    ? t('myVideosCount', { count: allMyGroups.length, s: allMyGroups.length > 1 ? 's' : '' })
                    : t('myVideosEmpty')}
                </p>
              </div>
              <Link
                href="/"
                className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                {t('newVideoButton')}
              </Link>
            </div>

            {allMyGroups.length === 0 ? (
              <div className="text-center py-16 border border-dashed border-gray-800 rounded-2xl">
                <p className="text-4xl mb-4">🎬</p>
                <p className="text-sm font-semibold text-white mb-1">{t('noVideosTitle')}</p>
                <p className="text-xs text-gray-500 mb-6">{t('noVideosDesc')}</p>
                <Link href="/" className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-colors">
                  {t('translateButton')}
                </Link>
              </div>
            ) : (
              <div className="space-y-8">
                {activeGroups.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                      <p className="text-[11px] font-bold uppercase tracking-widest text-blue-400">
                        {t('inProgress', { count: activeGroups.length })}
                      </p>
                    </div>
                    <VideoGrid groups={activeGroups} onPlay={setPlayerUrl} onAddLang={setAddLangVideo} />
                  </div>
                )}
                {doneGroups.length > 0 && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-4">
                      {t('done', { count: doneGroups.length })}
                    </p>
                    <VideoGrid groups={doneGroups} onPlay={setPlayerUrl} onAddLang={setAddLangVideo} />
                  </div>
                )}
                {errorGroups.length > 0 && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-red-500 mb-4">
                      {t('errors', { count: errorGroups.length })}
                    </p>
                    <VideoGrid groups={errorGroups} showDownload={false} onPlay={setPlayerUrl} onAddLang={setAddLangVideo} />
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
                {publicGroups.length > 0
                  ? `${publicGroups.length} vidéo${publicGroups.length > 1 ? 's' : ''} traduites par la communauté`
                  : 'Aucune vidéo publique pour l\'instant'}
              </p>
            </div>
            {!isAuthenticated && (
              <Link href="/" className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition-colors">
                Traduire
              </Link>
            )}
          </div>

          {publicGroups.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-gray-800 rounded-2xl">
              <p className="text-4xl mb-4">🌐</p>
              <p className="text-sm font-semibold text-white mb-1">Aucune vidéo publique</p>
              <p className="text-xs text-gray-500">Soyez le premier à traduire une vidéo !</p>
            </div>
          ) : (
            <VideoGrid groups={publicGroups} onPlay={setPlayerUrl} onAddLang={setAddLangVideo} />
          )}
        </section>

        {/* ── CTA inscription (visiteurs) ─────────────────────────────────── */}
        {!isAuthenticated && (
          <section className="bg-gradient-to-br from-blue-900/20 to-violet-900/20 border border-blue-500/20 rounded-2xl p-8 text-center">
            <p className="text-base font-bold text-white mb-2">Sauvegardez vos traductions</p>
            <p className="text-sm text-gray-400 mb-6 max-w-sm mx-auto">
              Créez un compte gratuit pour retrouver toutes vos vidéos traduites ici et accéder à votre historique.
            </p>
            <Link href="/login" className="inline-flex items-center gap-2 px-7 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-colors">
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
