'use client';
import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { listUserJobs, getPublicLibrary, submitJob, createStudioProject } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

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

function getPlatformInfo(sourceUrl?: string) {
  if (!sourceUrl) return { name: 'Vidéo', emoji: '🎬' };
  const u = sourceUrl.toLowerCase();
  if (u.includes('youtube') || u.includes('youtu.be')) return { name: 'YouTube', emoji: '📺' };
  if (u.includes('x.com') || u.includes('twitter')) return { name: 'X', emoji: '𝕏' };
  if (u.includes('tiktok')) return { name: 'TikTok', emoji: '🎵' };
  if (u.includes('instagram')) return { name: 'Instagram', emoji: '📸' };
  return { name: 'Vidéo', emoji: '🎬' };
}

const ACTIVE_STATUSES = new Set([
  'queued', 'downloading', 'transcribing', 'translating', 'burning', 'uploading',
]);

type LangVariant = {
  lang: string;
  job_id: string;
  status: string;
  storage_url?: string;
  created_at?: string;
  download_count?: number;
};
type GroupedVideo = {
  key: string;
  source_url: string;
  thumbnail_url?: string;
  summary?: string;
  source_lang?: string;
  duration_s?: number;
  video_type?: string;
  created_at: string;
  download_count: number;
  variants: LangVariant[];
  best_done_url?: string;
  best_done_job_id?: string;
};

const VARIANT_PRIORITY = ['done', 'uploading', 'burning', 'translating', 'transcribing', 'downloading', 'queued', 'error'];
const isPlayable = (variant: LangVariant) => variant.status === 'done' || !!variant.storage_url;

function deduplicateVariants(variants: LangVariant[]): LangVariant[] {
  const byLang = new Map<string, LangVariant>();
  for (const v of variants) {
    const existing = byLang.get(v.lang);
    if (!existing) { byLang.set(v.lang, v); continue; }
    const p1 = VARIANT_PRIORITY.indexOf(v.status);
    const p2 = VARIANT_PRIORITY.indexOf(existing.status);
    if (p1 !== -1 && (p2 === -1 || p1 < p2)) byLang.set(v.lang, v);
  }
  return Array.from(byLang.values());
}

function groupJobs(jobs: any[]): GroupedVideo[] {
  const map = new Map<string, GroupedVideo>();
  for (const j of jobs) {
    const key = j.source_url || j.id;
    if (!map.has(key)) {
      map.set(key, {
        key, source_url: j.source_url, thumbnail_url: j.thumbnail_url,
        summary: j.summary, source_lang: j.source_lang, duration_s: j.duration_s,
        video_type: j.video_type, created_at: j.created_at,
        download_count: j.download_count || 0, variants: [],
        best_done_url: undefined, best_done_job_id: undefined,
      });
    }
    const g = map.get(key)!;
    g.variants.push({ lang: j.target_lang, job_id: j.id, status: j.status, storage_url: j.storage_url, created_at: j.created_at, download_count: j.download_count || 0 });
    if (!g.summary && j.summary) g.summary = j.summary;
    if (!g.thumbnail_url && j.thumbnail_url) g.thumbnail_url = j.thumbnail_url;
    if (!g.source_lang && j.source_lang) g.source_lang = j.source_lang;
    if (!g.duration_s && j.duration_s) g.duration_s = j.duration_s;
    if (!g.video_type && j.video_type) g.video_type = j.video_type;
    if (j.status === 'done' && j.storage_url && !g.best_done_url) { g.best_done_url = j.storage_url; g.best_done_job_id = j.id; }
    g.download_count += (j.download_count || 0);
  }
  return Array.from(map.values()).map((g) => {
    g.variants = deduplicateVariants(g.variants);
    const doneVariant = g.variants.find((v) => v.status === 'done' && v.storage_url);
    if (doneVariant) { g.best_done_url = doneVariant.storage_url; g.best_done_job_id = doneVariant.job_id; }
    return g;
  });
}

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
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objUrl), 2000);
  } catch { window.open(url, '_blank'); }
}

// ── Modal vidéo repensée ─────────────────────────────────────────────────────
function EnhancedVideoModal({ group, initialLang, onClose }: {
  group: GroupedVideo;
  initialLang?: string;
  onClose: () => void;
}) {
  const t = useTranslations('LibraryPage');
  const firstPlayable = group.variants.find(isPlayable);
  const [currentLang, setCurrentLang] = useState<string>(initialLang ?? firstPlayable?.lang ?? group.variants[0]?.lang ?? '');
  const currentVariant = group.variants.find((v) => v.lang === currentLang && isPlayable(v)) ?? firstPlayable;
  const currentUrl = currentVariant?.storage_url
    ? currentVariant.storage_url.startsWith('http') ? currentVariant.storage_url : `/api${currentVariant.storage_url}`
    : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const doneVariants = group.variants.filter(isPlayable);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-3xl bg-gray-950 rounded-2xl overflow-hidden border border-gray-700 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header minimal */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="text-lg">{getPlatformInfo(group.source_url).emoji}</span>
            {getPlatformInfo(group.source_url).name}
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-500 flex items-center justify-center text-gray-400 hover:text-white transition-all text-xs">✕</button>
        </div>

        {/* Lecteur vidéo */}
        <div className="bg-black aspect-video">
          {currentUrl ? (
            <video key={currentUrl} src={currentUrl} controls autoPlay playsInline preload="auto" className="w-full h-full" />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm">{t('videoNotAvailable')}</div>
          )}
        </div>

        {/* Infos sous la vidéo */}
        <div className="px-5 py-3 space-y-3">
          {/* Description en bas */}
          {group.summary && (
            <div className="text-xs text-gray-400 leading-relaxed bg-gray-900/50 rounded-xl p-3 border border-gray-800">
              <span className="text-[10px] uppercase tracking-widest text-gray-600 font-bold block mb-1">{t('summaryLabel')}</span>
              {group.summary}
            </div>
          )}

          {/* Langue source + plateforme + durée */}
          <div className="flex flex-wrap items-center gap-2.5 text-[10px] text-gray-500">
            {group.source_lang && (
              <span className="flex items-center gap-1">
                <span className="text-sm leading-none">{LANG_FLAGS[group.source_lang] ?? '🌐'}</span>
                {t('originalLang', { lang: LANG_NAMES[group.source_lang] ?? group.source_lang })}
              </span>
            )}
            <span>·</span>
            <span>{getPlatformInfo(group.source_url).emoji} {getPlatformInfo(group.source_url).name}</span>
            {group.duration_s && (
              <>
                <span>·</span>
                <span>{Math.floor(group.duration_s / 60)}:{String(Math.round(group.duration_s % 60)).padStart(2, '0')}</span>
              </>
            )}
          </div>

          {/* Sélecteur de langues */}
          {group.variants.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-gray-600 font-bold mb-2">{t('languagesAvailable')}</p>
              <div className="flex flex-wrap gap-1.5">
                {group.variants.map((v) => {
                  const isDone = isPlayable(v);
                  const isActive = ACTIVE_STATUSES.has(v.status);
                  const isSelected = v.lang === currentLang;
                  return (
                    <button
                      key={v.lang}
                      onClick={() => isDone && setCurrentLang(v.lang)}
                      disabled={!isDone}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] transition-all ${
                        isSelected && isDone
                          ? 'border-blue-500 bg-blue-500/15 text-blue-300'
                          : isDone ? 'border-gray-700 hover:border-gray-500 hover:bg-gray-800 text-gray-300 cursor-pointer'
                          : isActive ? 'border-blue-800/50 bg-blue-950/30 text-blue-400 opacity-70 cursor-wait'
                          : 'border-gray-800 opacity-40 cursor-not-allowed text-gray-500'
                      }`}>
                      <span className="text-base leading-none">{LANG_FLAGS[v.lang] ?? '🌐'}</span>
                      <span>{LANG_NAMES[v.lang] ?? v.lang.toUpperCase()}</span>
                      {isActive && <svg className="animate-spin w-2.5 h-2.5 shrink-0" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>}
                      {!isDone && !isActive && <span className="text-[9px] text-gray-600">({t('errorBadge').toLowerCase()})</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer — téléchargement */}
        {currentUrl && currentVariant && (
          <div className="px-5 py-3 border-t border-gray-800 flex items-center justify-between">
            <span className="text-[10px] text-gray-600">{t('versionsAvailable', { n: doneVariants.length, s: doneVariants.length > 1 ? 's' : '' })}</span>
            <button onClick={() => { if (currentVariant.job_id) forceDownload(currentVariant.job_id); }}
              className="flex items-center gap-2 px-5 py-2 bg-emerald-700 hover:bg-emerald-600 rounded-xl text-sm font-medium text-white transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {t('downloadThisVersion')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Modal "Ajouter une langue" ────────────────────────────────────────────────
function AddLangModal({ g, onClose, onAdd, isAuthenticated }: {
  g: GroupedVideo;
  onClose: () => void;
  onAdd: (sourceUrl: string, lang: string) => void;
  isAuthenticated: boolean;
}) {
  const t = useTranslations('LibraryPage');
  const existingLangs = new Set(g.variants.map((v) => v.lang));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-sm bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-white mb-1">{t('addTranslation')}</h3>
        <p className="text-[11px] text-gray-500 mb-4 truncate">{g.source_url}</p>
        {!isAuthenticated && (
          <div className="mb-4 bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-[11px] text-blue-300">
            💡 <Link href="/login" className="underline hover:text-blue-200">{t('addLangCta')}</Link>
          </div>
        )}
        <div className="grid grid-cols-4 gap-2 max-h-56 overflow-y-auto pr-1">
          {ALL_LANGS.map((lang) => {
            const exists = existingLangs.has(lang);
            const disabled = !isAuthenticated || exists;
            return (
              <button key={lang} onClick={() => !disabled && onAdd(g.source_url, lang)} disabled={disabled}
                title={LANG_NAMES[lang] ?? lang}
                className={`flex flex-col items-center gap-0.5 p-2 rounded-xl border text-center transition-all ${disabled ? 'border-gray-700/40 bg-gray-800/30 opacity-50 cursor-not-allowed' : 'border-gray-700 bg-gray-800 hover:border-blue-500 hover:bg-blue-500/10 cursor-pointer'}`}>
                <span className="text-xl leading-none">{LANG_FLAGS[lang] ?? '🌐'}</span>
                <span className="text-[9px] text-gray-400 leading-none">{lang.toUpperCase()}</span>
                {exists && <span className="text-[8px] text-emerald-500 leading-none">✓</span>}
                {!isAuthenticated && !exists && <span className="text-[8px] text-amber-500 leading-none">🔒</span>}
              </button>
            );
          })}
        </div>
        <button onClick={onClose} className="mt-4 w-full text-xs text-gray-600 hover:text-gray-400 transition-colors py-1">{t('close')}</button>
      </div>
    </div>
  );
}

// ── Carte vidéo compacte ──────────────────────────────────────────────────────
function VideoCard({ g, showDownload, onPlay, onAddLang, onOpenInStudio, isAuthenticated = false }: {
  g: GroupedVideo;
  showDownload?: boolean;
  onPlay: (group: GroupedVideo, lang?: string) => void;
  onAddLang: (g: GroupedVideo) => void;
  onOpenInStudio?: (g: GroupedVideo) => void;
  isAuthenticated?: boolean;
}) {
  const t = useTranslations('LibraryPage');
  const hasAnyDone = g.variants.some(isPlayable);
  const hasActive = g.variants.some((v) => ACTIVE_STATUSES.has(v.status));
  const hasError = g.variants.every((v) => v.status === 'error');
  const doneVariants = g.variants.filter(isPlayable);
  const activeVariants = g.variants.filter((v) => ACTIVE_STATUSES.has(v.status));

  return (
    <div className={`group relative flex flex-col bg-gray-900 border rounded-xl overflow-hidden transition-all duration-200 hover:shadow-lg hover:shadow-black/30 ${
      hasActive ? 'border-blue-800/50' : hasError ? 'border-red-900/40' : 'border-gray-800 hover:border-gray-700'
    }`}>
      {/* Thumbnail — plus petit */}
      <div className={`relative ${g.video_type === 'short' ? 'aspect-[3/4]' : 'aspect-video'} bg-gray-900 overflow-hidden`}>
        {g.thumbnail_url ? (
          <img src={g.thumbnail_url} alt={g.summary || 'Vidéo'} className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
            <span className="text-2xl opacity-25">{g.source_url?.includes('youtube') || g.source_url?.includes('youtu.be') ? '▶' : '𝕏'}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-gray-950/70 via-transparent to-transparent" />
        {g.duration_s && (
          <div className="absolute bottom-1.5 right-1.5 bg-gray-950/80 backdrop-blur-sm border border-white/10 rounded px-1 py-0.5">
            <span className="text-[9px] text-gray-300">{Math.floor(g.duration_s / 60)}:{String(Math.round(g.duration_s % 60)).padStart(2, '0')}</span>
          </div>
        )}
        {hasActive && (
          <div className="absolute inset-0 bg-gray-950/60 backdrop-blur-[1px] flex flex-col items-center justify-center gap-1">
            <svg className="animate-spin h-6 w-6 text-blue-400" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
            <span className="text-[10px] font-medium text-blue-300">{activeVariants.length > 1 ? t('multiActiveLabel', { count: activeVariants.length }) : t('activeBadge')}</span>
          </div>
        )}
        {hasAnyDone && (
          <button type="button" onClick={() => onPlay(g)}
            className="absolute inset-0 bg-gray-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <div className="w-10 h-10 rounded-full bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center">
              <span className="text-white text-base ml-0.5">▶</span>
            </div>
          </button>
        )}
      </div>

      {/* Corps compact */}
      <div className="flex flex-col flex-1 p-2.5 gap-1.5">
        {g.summary && (
          <p className="text-[11px] text-gray-300 leading-relaxed line-clamp-1">{g.summary}</p>
        )}

        {/* Langues dispo */}
        <div className="flex flex-wrap items-center gap-1">
          {g.variants.map((v) => {
            const isDone = isPlayable(v);
            const isActive = ACTIVE_STATUSES.has(v.status);
            return (
              <button key={v.lang} title={(LANG_NAMES[v.lang] ?? v.lang) + (isDone ? ` — ${t('doneBadge')}` : isActive ? ` — ${t('activeBadge')}` : ` — ${t('errorBadge')}`)}
                onClick={(e) => { e.stopPropagation(); if (isDone) onPlay(g, v.lang); }}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9px] font-medium transition-all ${
                  isDone ? 'border-emerald-700/50 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-950/60 cursor-pointer'
                  : isActive ? 'border-blue-700/50 bg-blue-950/30 text-blue-300 cursor-wait'
                  : 'border-red-900/40 bg-red-950/20 text-red-400 cursor-default'
                }`}>
                <span className="text-sm leading-none">{LANG_FLAGS[v.lang] ?? '🌐'}</span>
                <span>{v.lang.toUpperCase()}</span>
                {isActive && <svg className="animate-spin w-2 h-2 ml-0.5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>}
              </button>
            );
          })}
          <button onClick={(e) => { e.stopPropagation(); onAddLang(g); }}
            title={isAuthenticated ? t('addTranslation') : t('loginToAdd')}
            className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border text-[9px] transition-all ${
              isAuthenticated ? 'border-dashed border-gray-700 text-gray-600 hover:border-blue-600 hover:text-blue-400'
              : 'border-dashed border-amber-600/70 text-amber-400 hover:border-amber-500 hover:text-amber-300'
            }`}>
            <svg className="w-2 h-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
            <span>+</span>
            {!isAuthenticated && <span className="text-[8px] ml-0.5">{t('loginToAdd')}</span>}
          </button>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between mt-auto pt-1 border-t border-gray-800">
          <div className="flex items-center gap-2 text-[9px] text-gray-600">
            {g.created_at && <span>{relativeTime(g.created_at)}</span>}
            {g.download_count > 0 && (
              <span className="flex items-center gap-1">
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                {g.download_count}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {onOpenInStudio && hasAnyDone && (
              <button onClick={(e) => { e.stopPropagation(); onOpenInStudio(g); }} title="Studio"
                className="text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-violet-950/50 hover:bg-violet-950/80 border border-violet-800/50 hover:border-violet-600 text-violet-400 hover:text-violet-300 transition-all">✂️</button>
            )}
            {showDownload && hasAnyDone && (
              <button onClick={(e) => { e.stopPropagation(); onPlay(g); }} title="Voir & Télécharger"
                className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-gray-800 hover:bg-emerald-950/60 border border-gray-700 hover:border-emerald-700 text-gray-300 hover:text-emerald-400 transition-all">
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                DL
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Grille compacte ──────────────────────────────────────────────────────────
function VideoGrid({ groups, showDownload = true, onPlay, onAddLang, onOpenInStudio, isAuthenticated = false }: {
  groups: GroupedVideo[];
  showDownload?: boolean;
  onPlay: (group: GroupedVideo, lang?: string) => void;
  onAddLang: (g: GroupedVideo) => void;
  onOpenInStudio?: (g: GroupedVideo) => void;
  isAuthenticated?: boolean;
}) {
  if (groups.length === 0) return null;
  return (
    // 2 colonnes sur mobile, 2 cols sm, 3 md, 4 lg, 5 xl, 6 2xl — gap serré
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5">
      {groups.map((g) => (
        <VideoCard key={g.key} g={g} showDownload={showDownload} onPlay={onPlay} onAddLang={onAddLang} onOpenInStudio={onOpenInStudio} isAuthenticated={isAuthenticated} />
      ))}
    </div>
  );
}

// ── relativeTime i18n ──────────────────────────────────────────────────────────
function relativeTime(dateStr: string): string {
  // On ne peut utiliser le hook useTranslations ici (pas dans une fonction)
  // Donc on utilise la locale du navigateur
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const s = Math.floor(diff / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (s < 60) return "<1 min";
    if (m < 60) return `${m} min`;
    if (h < 24) return `${h} h`;
    if (d < 30) return `${d} j`;
    // fallback date courte locale
    return new Date(dateStr).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

// ── Page principale ───────────────────────────────────────────────────────────
export default function LibraryPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const t = useTranslations('LibraryPage');
  const [myJobs, setMyJobs] = useState<any[]>([]);
  const [publicJobs, setPublicJobs] = useState<any[]>([]);
  const [publicLoading, setPublicLoading] = useState(true);
  const [myLoading, setMyLoading] = useState(false);
  const [modalGroup, setModalGroup] = useState<GroupedVideo | null>(null);
  const [initialLang, setInitialLang] = useState<string | undefined>(undefined);
  const [addLangVideo, setAddLangVideo] = useState<GroupedVideo | null>(null);
  const [addLangMsg, setAddLangMsg] = useState<string | null>(null);

  const handlePlay = useCallback((group: GroupedVideo, lang?: string) => { setInitialLang(lang); setModalGroup(group); }, []);
  const handleCloseModal = useCallback(() => { setModalGroup(null); setInitialLang(undefined); }, []);

  useEffect(() => {
    getPublicLibrary().then((pub) => setPublicJobs(pub || [])).finally(() => setPublicLoading(false));
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (isAuthenticated) { setMyLoading(true); listUserJobs().then((mine) => setMyJobs(mine || [])).finally(() => setMyLoading(false)); }
  }, [isAuthenticated, authLoading]);

  const handleOpenInStudio = useCallback(async (g: GroupedVideo) => {
    const jobId = g.best_done_job_id ?? g.variants.find((v) => v.status === 'done')?.job_id;
    if (!jobId) return;
    setAddLangMsg('✂️ ' + 'Ouverture du Studio…');
    try { const res = await createStudioProject({ source_job_id: jobId }); router.push(`/studio/${res.project_id}`); }
    catch (e: any) { setAddLangMsg(`❌ ${e?.detail || e?.message || 'Erreur Studio'}`); setTimeout(() => setAddLangMsg(null), 4000); }
  }, [router]);

  const handleAddLang = useCallback(async (sourceUrl: string, lang: string) => {
    setAddLangVideo(null);
    setAddLangMsg(`⏳ ${t('addLangLaunching', { lang: LANG_NAMES[lang] ?? lang })}`);
    try {
      await submitJob(sourceUrl, lang);
      setAddLangMsg(`✅ ${t('addLangSuccess', { lang: LANG_NAMES[lang] ?? lang })}`);
      if (isAuthenticated) listUserJobs().then((mine) => setMyJobs(mine || []));
    } catch (e: any) { setAddLangMsg(`❌ ${e?.detail?.message || e?.message || 'Erreur'}`); }
    setTimeout(() => setAddLangMsg(null), 4000);
  }, [isAuthenticated, t]);

  if (publicLoading) return <Loading />;

  const allMyGroups = groupJobs(myJobs);
  const activeGroups = allMyGroups.filter((g) => g.variants.some((v) => ACTIVE_STATUSES.has(v.status)));
  const doneGroups = allMyGroups.filter((g) => g.variants.some((v) => v.status === 'done'));
  const errorGroups = allMyGroups.filter((g) => g.variants.every((v) => v.status === 'error'));
  const publicGroups = groupJobs(publicJobs);

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      {modalGroup && <EnhancedVideoModal group={modalGroup} initialLang={initialLang} onClose={handleCloseModal} />}
      {addLangVideo && <AddLangModal g={addLangVideo} onClose={() => setAddLangVideo(null)} onAdd={handleAddLang} isAuthenticated={isAuthenticated} />}
      {addLangMsg && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl bg-gray-900 border border-gray-700 text-sm text-white shadow-2xl">{addLangMsg}</div>}

      <div className="max-w-7xl mx-auto px-3 py-8 space-y-10">

        {/* ── Mes vidéos ── */}
        {isAuthenticated && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h1 className="text-lg font-bold text-white tracking-tight">{t('myVideosTitle')}</h1>
                <p className="text-[11px] text-gray-500 mt-0.5">{allMyGroups.length > 0 ? t('myVideosCount', { count: allMyGroups.length, s: allMyGroups.length > 1 ? 's' : '' }) : t('myVideosEmpty')}</p>
              </div>
              <Link href="/" className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                {t('newVideoButton')}
              </Link>
            </div>
            {allMyGroups.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-gray-800 rounded-xl">
                <p className="text-3xl mb-3">🎬</p>
                <p className="text-sm font-semibold text-white mb-1">{t('noVideosTitle')}</p>
                <p className="text-xs text-gray-500 mb-4">{t('noVideosDesc')}</p>
                <Link href="/" className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-colors">{t('translateButton')}</Link>
              </div>
            ) : (
              <div className="space-y-6">
                {activeGroups.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-blue-400 mb-3 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                      {t('inProgress', { count: activeGroups.length })}
                    </p>
                    <VideoGrid groups={activeGroups} onPlay={handlePlay} onAddLang={setAddLangVideo} isAuthenticated={isAuthenticated} />
                  </div>
                )}
                {doneGroups.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-3">{t('done', { count: doneGroups.length })}</p>
                    <VideoGrid groups={doneGroups} onPlay={handlePlay} onAddLang={setAddLangVideo} onOpenInStudio={handleOpenInStudio} isAuthenticated={isAuthenticated} />
                  </div>
                )}
                {errorGroups.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-red-500 mb-3">{t('errors', { count: errorGroups.length })}</p>
                    <VideoGrid groups={errorGroups} showDownload={false} onPlay={handlePlay} onAddLang={setAddLangVideo} isAuthenticated={isAuthenticated} />
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* ── Bibliothèque publique ── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">{isAuthenticated ? t('publicLibraryTitle') : t('libraryTitle')}</h2>
              <p className="text-[11px] text-gray-500 mt-0.5">{publicGroups.length > 0 ? t('communityVideos', { count: publicGroups.length, s: publicGroups.length > 1 ? 's' : '' }) : t('noPublicVideos')}</p>
            </div>
            {!isAuthenticated && (
              <Link href="/" className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors">{t('translateLink')}</Link>
            )}
          </div>
          {publicGroups.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-gray-800 rounded-xl">
              <p className="text-3xl mb-3">🌐</p>
              <p className="text-sm font-semibold text-white mb-1">{t('publicLibraryEmpty')}</p>
              <p className="text-xs text-gray-500">{t('beFirst')}</p>
            </div>
          ) : (
            <VideoGrid groups={publicGroups} onPlay={handlePlay} onAddLang={setAddLangVideo} isAuthenticated={isAuthenticated} />
          )}
        </section>

        {/* ── CTA inscription ── */}
        {!isAuthenticated && (
          <section className="bg-gradient-to-br from-blue-900/20 to-violet-900/20 border border-blue-500/20 rounded-xl p-6 text-center">
            <p className="text-sm font-bold text-white mb-2">{t('saveTitle')}</p>
            <p className="text-xs text-gray-400 mb-4 max-w-sm mx-auto">{t('saveDesc')}</p>
            <Link href="/login" className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-colors">{t('createAccount')}</Link>
          </section>
        )}

        <p className="text-center pb-4">
          <Link href="/" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">{t('backHome')}</Link>
        </p>
      </div>
    </main>
  );
}

function Loading() {
  return (
    <main className="h-screen bg-gray-950 text-white flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-gray-500">
        <svg className="animate-spin h-6 w-6 text-blue-500" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
        <p className="text-xs">Chargement…</p>
      </div>
    </main>
  );
}