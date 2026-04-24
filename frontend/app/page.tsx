'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { submitJob, uploadVideoFile, getJobStatus, getQueueStats } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { LiveJobProgress } from '@/components/job/LiveJobProgress';
import CountersBar from '@/components/ui/CountersBar';
import UpsellModal from '@/components/ui/UpsellModal';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// ── Langues ───────────────────────────────────────────────────────────────────
const LANGS: Record<string, { label: string; flag: string }> = {
  fr: { label: 'Français',         flag: '🇫🇷' },
  en: { label: 'English',          flag: '🇬🇧' },
  es: { label: 'Español',          flag: '🇪🇸' },
  de: { label: 'Deutsch',          flag: '🇩🇪' },
  it: { label: 'Italiano',         flag: '🇮🇹' },
  pt: { label: 'Português',        flag: '🇧🇷' },
  nl: { label: 'Nederlands',       flag: '🇳🇱' },
  pl: { label: 'Polski',           flag: '🇵🇱' },
  ru: { label: 'Русский',          flag: '🇷🇺' },
  uk: { label: 'Українська',       flag: '🇺🇦' },
  ar: { label: 'العربية',          flag: '🇸🇦' },
  fa: { label: 'فارسی',            flag: '🇮🇷' },
  he: { label: 'עברית',            flag: '🇮🇱' },
  tr: { label: 'Türkçe',           flag: '🇹🇷' },
  zh: { label: '中文',             flag: '🇨🇳' },
  ja: { label: '日本語',           flag: '🇯🇵' },
  ko: { label: '한국어',           flag: '🇰🇷' },
  hi: { label: 'हिन्दी',           flag: '🇮🇳' },
  vi: { label: 'Tiếng Việt',       flag: '🇻🇳' },
  id: { label: 'Bahasa Indonesia', flag: '🇮🇩' },
};
const LANG_CODES = Object.keys(LANGS);

// ── Providers supportés ───────────────────────────────────────────────────────
const PROVIDERS = [
  { name: '𝕏 / Twitter',   icon: '𝕏',  color: 'text-white' },
  { name: 'YouTube',        icon: '▶',  color: 'text-red-400' },
  { name: 'TikTok',         icon: '♪',  color: 'text-pink-400' },
  { name: 'Instagram',      icon: '◈',  color: 'text-purple-400' },
  { name: 'Facebook',       icon: '⬡',  color: 'text-blue-400' },
  { name: 'Vimeo',          icon: '◉',  color: 'text-cyan-400' },
  { name: 'Dailymotion',    icon: '◈',  color: 'text-orange-400' },
  { name: 'Reddit',         icon: '◉',  color: 'text-orange-300' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m === 0) return `${sec}s`;
  return `${m}m ${sec.toString().padStart(2, '0')}s`;
}
function formatMinutes(s: number): string {
  const m = Math.ceil(s / 60);
  if (m <= 1) return '~1 min';
  return `~${m} min`;
}

// ── Animation hero ────────────────────────────────────────────────────────────
const ANIMATED_PROVIDERS = ['𝕏 (Twitter)', 'YouTube', 'TikTok', 'Instagram'];
const ANIMATED_FLAGS      = ['🇫🇷', '🇬🇧', '🇪🇸', '🇩🇪', '🇯🇵', '🇰🇷', '🇸🇦', '🇧🇷'];

// ── Page principale ───────────────────────────────────────────────────────────
export default function Home() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const t  = useTranslations('HomePage');
  const tN = useTranslations('Navbar');

  const [url,          setUrl]          = useState('');
  const [jobId,        setJobId]        = useState<string | null>(null);
  const [status,       setStatus]       = useState<any>(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [playerModal,  setPlayerModal]  = useState<string | null>(null);

  const [sourceType,   setSourceType]   = useState<'url' | 'file'>('url');
  const [mode,         setMode]         = useState<'download' | 'translate'>('translate');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);

  const [selectedLangs, setSelectedLangs] = useState<string[]>([]);
  const [upsellLang,    setUpsellLang]    = useState(false);
  const [multiDone,     setMultiDone]     = useState(false);

  // ── CTA expansif + upsell ────────────────────────────────────────────────
  const [ctaExpanded, setCtaExpanded] = useState(false);
  const [ctaClicks,   setCtaClicks]   = useState(0);
  const [upsellOpen,  setUpsellOpen]  = useState(false);
  const [upsellDuration, setUpsellDuration] = useState(0);

  // File d'attente
  const [queue, setQueue] = useState<{ active_count: number; queued_count: number; estimated_wait_s: number } | null>(null);

  // Timer
  const [elapsed, setElapsed]     = useState(0);
  const startedAtRef              = useRef<number>(0);
  const pollRef                   = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef                  = useRef<ReturnType<typeof setInterval> | null>(null);
  const queuePollRef              = useRef<ReturnType<typeof setInterval> | null>(null);

  // Animation hero
  const [providerIdx, setProviderIdx] = useState(0);
  const [flagIdx,     setFlagIdx]     = useState(0);
  const [visible,     setVisible]     = useState(true);

  // Tableaux traduits
  const STEPS = [
    { label: t('stepDownload'),   icon: '⬇️',  statuses: ['downloading'] },
    { label: t('stepTranscribe'), icon: '🎙️', statuses: ['transcribing'] },
    { label: t('stepTranslate'),  icon: '🌐',  statuses: ['translating'] },
    { label: t('stepRender'),     icon: '🎬',  statuses: ['burning', 'uploading'] },
    { label: t('stepDone'),       icon: '✅',  statuses: ['done'] },
  ];

  const BENEFITS = [
    { icon: '✨', title: t('benefit1Title'), desc: t('benefit1Desc') },
    { icon: '⚡', title: t('benefit2Title'), desc: t('benefit2Desc') },
    { icon: '🌍', title: t('benefit3Title'), desc: t('benefit3Desc') },
    { icon: '🔒', title: t('benefit4Title'), desc: t('benefit4Desc') },
  ];

  const ROADMAP = [
    { icon: '📤', title: t('roadmap1Title'), desc: t('roadmap1Desc') },
    { icon: '✂️', title: t('roadmap2Title'), desc: t('roadmap2Desc') },
    { icon: '🎙️', title: t('roadmap3Title'), desc: t('roadmap3Desc') },
    { icon: '📊', title: t('roadmap4Title'), desc: t('roadmap4Desc') },
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setProviderIdx((i) => (i + 1) % ANIMATED_PROVIDERS.length);
        setFlagIdx((i) => (i + 1) % ANIMATED_FLAGS.length);
        setVisible(true);
      }, 250);
    }, 2200);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    getQueueStats().then(setQueue).catch(() => {});
    queuePollRef.current = setInterval(() => {
      getQueueStats().then(setQueue).catch(() => {});
    }, 15_000);
    return () => clearInterval(queuePollRef.current!);
  }, []);

  useEffect(() => {
    if (!jobId || status?.status === 'done' || status?.status === 'error') {
      clearInterval(timerRef.current!);
      return;
    }
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timerRef.current!);
  }, [jobId, status?.status]);

  useEffect(() => {
    if (!jobId) return;
    pollRef.current = setInterval(async () => {
      try {
        const s = await getJobStatus(jobId);
        setStatus(s);
        if (s.status === 'done' || s.status === 'error') {
          clearInterval(pollRef.current!);
          clearInterval(timerRef.current!);
          getQueueStats().then(setQueue).catch(() => {});
        }
      } catch {}
    }, 3000);
    return () => clearInterval(pollRef.current!);
  }, [jobId]);

  function toggleLang(code: string) {
    if (selectedLangs.includes(code)) {
      setSelectedLangs((prev) => prev.filter((l) => l !== code));
      setUpsellLang(false);
    } else {
      if (!isAuthenticated) {
        setSelectedLangs([code]);
        setUpsellLang(false);
      } else {
        setSelectedLangs((prev) => [...prev, code]);
        setUpsellLang(false);
      }
    }
  }

  function validateFile(file: File): { valid: boolean; message?: string } {
    const maxSize = 1_000_000_000;
    const allowedTypes = [
      'video/mp4', 'video/quicktime', 'video/x-msvideo',
      'video/x-matroska', 'video/webm', 'video/3gpp', 'video/mpeg',
    ];
    if (file.size > maxSize) return { valid: false, message: 'Fichier trop volumineux (max 1 Go)' };
    if (!allowedTypes.includes(file.type)) return { valid: false, message: 'Format vidéo non supporté' };
    return { valid: true };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    setElapsed(0);
    setLoading(true);
    setMultiDone(false);

    try {
      // ── Estimation durée + Upsell pour visiteurs non connectés ──
      if (sourceType === 'url' && !isAuthenticated) {
        try {
          const estResp = await fetch(`${API}/jobs/estimate-duration`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_url: url }),
          });
          const estData = await estResp.json();
          const durS = estData.duration_s || 0;
          if (durS > 120) {
            // Plus de 2 min → modale upsell
            setUpsellDuration(durS / 60);
            setUpsellOpen(true);
            setLoading(false);
            return;
          }
        } catch {
          // Si l'estimation échoue, on laisse passer (mode dégradé)
        }
      }

      if (sourceType === 'file') {
        if (!selectedFile) throw new Error('Veuillez sélectionner un fichier');
        const validation = validateFile(selectedFile);
        if (!validation.valid) throw new Error(validation.message);
        const targetLang = mode === 'translate' && selectedLangs.length === 1 ? selectedLangs[0] : 'fr';
        const res = await uploadVideoFile(selectedFile, mode, targetLang);
        startedAtRef.current = Date.now();
        setJobId(res.job_id);
        if (res.status === 'done') {
          const s = await getJobStatus(res.job_id);
          setStatus(s);
        }
      } else {
        if (selectedLangs.length === 1) {
          const res = await submitJob(url, selectedLangs[0]);
          startedAtRef.current = Date.now();
          setJobId(res.job_id);
          if (res.status === 'done') {
            const s = await getJobStatus(res.job_id);
            setStatus(s);
          }
        } else {
          await Promise.all(selectedLangs.map((lang) => submitJob(url, lang)));
          setMultiDone(true);
          setTimeout(() => { window.location.href = '/library'; }, 2000);
        }
      }
    } catch (err: any) {
      const detail = err?.detail;
      if (typeof detail === 'object' && detail?.error === 'quota_exceeded') {
        setError('quota_exceeded');
      } else {
        setError(detail?.message || err?.message || t('genericError'));
      }
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    clearInterval(pollRef.current!);
    clearInterval(timerRef.current!);
    setJobId(null);
    setStatus(null);
    setUrl('');
    setError(null);
    setElapsed(0);
    setMultiDone(false);
  }

  const estimatedTotalS = status?.duration_s ? Math.max(90, status.duration_s * 1.5 + 60) : 240;
  const remaining       = Math.max(0, estimatedTotalS - elapsed);
  const plural          = (n: number) => n > 1 ? 's' : '';

  async function handleDownload() {
    if (!jobId) return;
    const dlUrl = `${API}/jobs/${jobId}/download`;
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const resp = await fetch(dlUrl, { headers, redirect: 'follow' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const blob = await resp.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `spottedyou-${jobId.slice(0, 8)}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objUrl), 2000);
    } catch {
      window.open(dlUrl, '_blank');
    }
  }

  return (
    <main className="h-screen overflow-y-auto bg-gray-950 text-white">

      <UpsellModal
        isOpen={upsellOpen}
        onClose={() => setUpsellOpen(false)}
        isAuthenticated={!!isAuthenticated}
        videoDurationMinutes={upsellDuration}
      />

      {/* Modale vidéo */}
      {playerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm" onClick={() => setPlayerModal(null)}>
          <div className="relative w-full max-w-4xl bg-gray-950 rounded-2xl overflow-hidden border border-gray-700 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <video src={playerModal} controls autoPlay className="w-full aspect-video bg-black" />
            <div className="flex items-center justify-between p-4 border-t border-gray-800">
              <button onClick={handleDownload} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {t('downloadButton')}
              </button>
              {jobId && status?.status === 'done' && (
                <button onClick={() => router.push(`/jobs/${jobId}`)} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-700 hover:bg-violet-600 text-white font-semibold text-sm transition-colors">
                  ✂️ Éditer
                </button>
              )}
              <button onClick={() => setPlayerModal(null)} className="w-8 h-8 rounded-full bg-gray-800 border border-gray-700 hover:border-gray-500 flex items-center justify-center text-gray-400 hover:text-white transition-all">✕</button>
            </div>
          </div>
        </div>
      )}

      {/* ── HERO ── */}
      <section className="relative overflow-hidden border-b border-gray-800">
        <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
        <div className="relative max-w-5xl mx-auto px-4 py-16 sm:py-24 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-medium mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            {t('heroBadge')}
          </div>

          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight leading-tight mb-6">
            <span className="text-white">From </span>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400 transition-opacity duration-200" style={{ opacity: visible ? 1 : 0 }}>
              {ANIMATED_PROVIDERS[providerIdx]}
            </span>
            <br />
            <span className="text-white">to </span>
            <span className="transition-opacity duration-200" style={{ opacity: visible ? 1 : 0, fontSize: '1.1em' }}>
              {ANIMATED_FLAGS[flagIdx]}
            </span>
            <span className="text-white"> in </span>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">minutes</span>
          </h1>

          <p className="text-sm sm:text-base text-gray-400 max-w-lg mx-auto mb-8 leading-relaxed">
            Your video translated, subtitled and ready to share, effortlessly.
          </p>

          {/* CTA */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => {
                setCtaExpanded(prev => !prev);
                setCtaClicks(prev => prev + 1);
                fetch(`${API}/stats/cta-click`, { method: 'POST' }).catch(() => {});
              }}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-7 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-colors shadow-lg shadow-blue-500/20"
            >
              {t('ctaTranslate')}
              <motion.span animate={{ rotate: ctaExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>↓</motion.span>
            </button>
            <Link href="/login" className="w-full sm:w-auto flex items-center justify-center gap-2 px-7 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 font-semibold text-sm transition-colors border border-gray-700">
              {t('ctaRegister')}
            </Link>
          </div>

          {/* Compteurs live */}
          <div className="mt-12 mb-6"><CountersBar /></div>

          {/* Section expansible (formulaire) */}
          <motion.div initial={false} animate={{ height: ctaExpanded ? 'auto' : 0, opacity: ctaExpanded ? 1 : 0 }} transition={{ duration: 0.3, ease: 'easeInOut' }} className="overflow-hidden border-t border-gray-800">
            <div className="pt-8">
              <form onSubmit={handleSubmit} className="max-w-lg mx-auto space-y-5">
                {/* Source */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Source vidéo</label>
                  </div>
                  <div className="flex gap-2 mb-4">
                    <button type="button" onClick={() => setSourceType('url')} className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-colors ${sourceType === 'url' ? 'border-blue-500 bg-blue-500/15 text-blue-300' : 'border-gray-800 bg-gray-900 text-gray-400 hover:border-gray-600'}`}>
                      🌐 Lien URL
                    </button>
                    <button type="button" onClick={() => setSourceType('file')} className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-colors ${sourceType === 'file' ? 'border-blue-500 bg-blue-500/15 text-blue-300' : 'border-gray-800 bg-gray-900 text-gray-400 hover:border-gray-600'}`}>
                      📁 Fichier local
                    </button>
                  </div>
                </div>

                {/* Mode */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Que voulez-vous faire ?</label>
                  </div>
                  <div className="flex gap-2 mb-4">
                    <button type="button" onClick={() => setMode('download')} className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-colors ${mode === 'download' ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300' : 'border-gray-800 bg-gray-900 text-gray-400 hover:border-gray-600'}`}>
                      ⬇️ Télécharger seulement
                    </button>
                    <button type="button" onClick={() => setMode('translate')} className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-colors ${mode === 'translate' ? 'border-blue-500 bg-blue-500/15 text-blue-300' : 'border-gray-800 bg-gray-900 text-gray-400 hover:border-gray-600'}`}>
                      🌐 Traduire
                    </button>
                  </div>
                </div>

                {/* URL ou fichier */}
                {sourceType === 'url' ? (
                  <div>
                    <label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 block mb-2">{t('urlLabel')}</label>
                    <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('urlPlaceholder')} required className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40 transition-colors" />
                  </div>
                ) : (
                  <div>
                    <label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 block mb-2">Fichier vidéo (max 1 Go)</label>
                    <div className="border-2 border-dashed border-gray-800 rounded-xl p-6 text-center hover:border-gray-700 transition-colors">
                      {selectedFile ? (
                        <div className="space-y-3">
                          <div className="flex items-center justify-center gap-3">
                            <span className="text-2xl">📁</span>
                            <div className="text-left">
                              <p className="text-sm font-medium text-white truncate max-w-xs">{selectedFile.name}</p>
                              <p className="text-xs text-gray-500">{(selectedFile.size / (1024 * 1024)).toFixed(2)} Mo</p>
                            </div>
                          </div>
                          <button type="button" onClick={() => setSelectedFile(null)} className="text-xs text-gray-500 hover:text-gray-300 underline">Changer de fichier</button>
                        </div>
                      ) : (
                        <div>
                          <div className="text-4xl mb-3">📁</div>
                          <p className="text-sm text-gray-400 mb-2">Glissez-déposez ou cliquez pour sélectionner</p>
                          <p className="text-xs text-gray-600 mb-4">MP4, MOV, AVI, MKV, WebM (max 1 Go)</p>
                          <input type="file" id="video-upload-expanded" accept="video/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) setSelectedFile(f); }} className="hidden" />
                          <label htmlFor="video-upload-expanded" className="inline-block px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm font-medium text-gray-300 cursor-pointer transition-colors">Parcourir...</label>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Langues */}
                {mode === 'translate' && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[11px] font-bold uppercase tracking-widest text-gray-500">
                        {t('langLabel', { s: plural(selectedLangs.length) })}
                        <span className="ml-2 font-normal normal-case text-gray-600">{t('langSelected', { count: selectedLangs.length, s: plural(selectedLangs.length) })}</span>
                      </label>
                      {!isAuthenticated && (
                        <span className="text-[10px] text-gray-600">
                          <Link href="/login" className="text-blue-500 hover:text-blue-400 underline">{t('loginForMulti')}</Link>
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-5 gap-1.5">
                      {LANG_CODES.map((code) => {
                        const { label, flag } = LANGS[code];
                        const isSelected = selectedLangs.includes(code);
                        return (
                          <button key={code} type="button" title={label} onClick={() => toggleLang(code)}
                            className={`relative flex flex-col items-center gap-0.5 py-2 px-1 rounded-xl border text-center transition-all ${isSelected ? 'border-blue-500 bg-blue-500/15 shadow-sm shadow-blue-500/20' : 'border-gray-800 bg-gray-900 hover:border-gray-600 hover:bg-gray-800'}`}>
                            <span className="text-xl leading-none">{flag}</span>
                            <span className={`text-[9px] leading-none font-medium ${isSelected ? 'text-blue-300' : 'text-gray-500'}`}>{code.toUpperCase()}</span>
                            {isSelected && <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-blue-600 border border-gray-950 flex items-center justify-center text-[8px] text-white font-bold">✓</span>}
                          </button>
                        );
                      })}
                    </div>
                    {upsellLang && (
                      <div className="mt-3 bg-gradient-to-r from-blue-900/30 to-violet-900/30 border border-blue-500/20 rounded-xl p-3 text-xs">
                        <p className="font-semibold text-white mb-1">{t('upsellTitle')}</p>
                        <p className="text-gray-400 mb-2">{t('upsellDesc')}</p>
                        <div className="flex gap-2">
                          <Link href="/login" className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors">{t('upsellCta')}</Link>
                          <button type="button" onClick={() => setUpsellLang(false)} className="px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors">{t('upsellClose')}</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Erreurs */}
                {error === 'quota_exceeded' && (
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                    <p className="text-xs font-bold text-amber-300 mb-1">{t('quotaTitle')}</p>
                    <p className="text-[11px] text-amber-400/80 mb-3">{t('quotaDesc')}</p>
                    <Link href="/billing" className="inline-flex text-xs font-semibold px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition-colors">{t('quotaCta')}</Link>
                  </div>
                )}
                {error && error !== 'quota_exceeded' && (
                  <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs px-4 py-3 rounded-xl">⚠️ {error}</div>
                )}

                <button type="submit" disabled={loading || (mode === 'translate' && selectedLangs.length === 0)}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors shadow-lg shadow-blue-500/20">
                  {loading ? (
                    <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>{t('submitting')}</>
                  ) : mode === 'translate' && selectedLangs.length === 0 ? t('chooseLang') : selectedLangs.length > 1 ? t('submitMulti', { count: selectedLangs.length }) : t('submitButton')}
                </button>
                {selectedLangs.length > 1 && (
                  <p className="text-[11px] text-center text-gray-600">{t('multiJobsInfo', { count: selectedLangs.length })}</p>
                )}
              </form>
            </div>
          </motion.div>

          {/* Providers */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <span className="text-[11px] text-gray-600 uppercase tracking-widest">{t('compatibleWith')}</span>
            {PROVIDERS.map((p) => (
              <span key={p.name} className={`text-xs font-semibold ${p.color} opacity-70`}>{p.name}</span>
            ))}
            <span className="text-[11px] text-gray-600">{t('andMore')}</span>
          </div>
        </div>
      </section>

      {/* ── FILE D'ATTENTE / MULTI-DONE / LIVEPROGRESS ── */}
      {ctaExpanded && (
        <section className="border-b border-gray-800">
          <div className="max-w-5xl mx-auto px-4 py-10">
            {!jobId && queue && queue.active_count > 0 && (
              <div className="max-w-lg mx-auto mb-6 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 flex items-start gap-3">
                <span className="text-lg leading-none mt-0.5">⏳</span>
                <div>
                  <p className="text-xs font-semibold text-amber-300">{t('queueBanner', { active: queue.active_count, s: plural(queue.active_count) })}</p>
                  {queue.estimated_wait_s > 0 && <p className="text-[11px] text-amber-400/70 mt-0.5">{t('queueWait', { time: formatMinutes(queue.estimated_wait_s) })}</p>}
                </div>
              </div>
            )}
            {multiDone && (
              <div className="max-w-lg mx-auto text-center py-10">
                <div className="text-4xl mb-4">🚀</div>
                <p className="text-base font-bold text-white mb-2">{t('multiDoneTitle', { count: selectedLangs.length })}</p>
                <p className="text-sm text-gray-400 mb-4">{t('multiDoneDesc')}</p>
                <Link href="/library" className="text-blue-400 text-xs underline">{t('goNow')}</Link>
              </div>
            )}
            {jobId && (
              <div className="max-w-7xl mx-auto">
                <LiveJobProgress jobId={jobId} status={status} onReset={reset} onDownload={handleDownload} />
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── BÉNÉFICES ── */}
      {!jobId && !multiDone && (
        <section className="border-b border-gray-800">
          <div className="max-w-5xl mx-auto px-4 py-12">
            <div className="text-center mb-8">
              <h2 className="text-lg font-bold text-white mb-1">{t('whyTitle')}</h2>
              <p className="text-sm text-gray-500">{t('whySubtitle')}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {BENEFITS.map((b) => (
                <div key={b.title} className="bg-gray-900/60 border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition-colors">
                  <div className="text-3xl mb-3">{b.icon}</div>
                  <p className="text-sm font-semibold text-white mb-1.5">{b.title}</p>
                  <p className="text-xs text-gray-500 leading-relaxed">{b.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── PROVIDERS ── */}
      {!jobId && !multiDone && (
        <section className="border-b border-gray-800">
          <div className="max-w-5xl mx-auto px-4 py-10">
            <div className="text-center mb-6">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-1">{t('platformsTitle')}</p>
              <p className="text-xs text-gray-600">{t('platformsSubtitle')}</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl mx-auto">
              {PROVIDERS.map((p) => (
                <div key={p.name} className="bg-gray-900 border border-gray-800 rounded-xl p-3 flex items-center gap-2.5 hover:border-gray-700 transition-colors">
                  <span className={`text-xl font-bold leading-none ${p.color}`}>{p.icon}</span>
                  <span className="text-xs font-semibold text-gray-300">{p.name}</span>
                </div>
              ))}
            </div>
            <p className="text-center text-[11px] text-gray-600 mt-4">{t('platformsExtra')}</p>
          </div>
        </section>
      )}

      {/* ── ÉQUIPE + ROADMAP ── */}
      {!jobId && !multiDone && (
        <section className="border-b border-gray-800">
          <div className="max-w-5xl mx-auto px-4 py-14">
            <div className="grid md:grid-cols-2 gap-10 items-start">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 text-xs font-medium mb-6">{t('teamBadge')}</div>
                <h2 className="text-xl font-bold text-white mb-4">{t('teamTitle')}</h2>
                <p className="text-sm text-gray-400 leading-relaxed mb-4">{t('teamDesc1')}</p>
                <p className="text-sm text-gray-400 leading-relaxed mb-4">{t('teamDesc2')}</p>
                <p className="text-sm text-gray-400 leading-relaxed">{t('teamDesc3')}</p>
              </div>
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium mb-6">{t('roadmapBadge')}</div>
                <h2 className="text-xl font-bold text-white mb-4">{t('roadmapTitle')}</h2>
                <div className="space-y-3">
                  {ROADMAP.map((r) => (
                    <div key={r.title} className="flex items-start gap-3 bg-gray-900/60 border border-gray-800 rounded-xl p-3.5 hover:border-gray-700 transition-colors">
                      <span className="text-2xl leading-none mt-0.5">{r.icon}</span>
                      <div>
                        <p className="text-xs font-semibold text-white mb-0.5">{r.title}</p>
                        <p className="text-[11px] text-gray-500 leading-relaxed">{r.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── LANGUES ── */}
      {!jobId && !multiDone && (
        <section className="border-b border-gray-800">
          <div className="max-w-5xl mx-auto px-4 py-10 text-center">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-4">{t('langsTitle', { count: Object.keys(LANGS).length })}</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {Object.entries(LANGS).map(([k, v]) => (
                <span key={k} className="text-2xl" title={v.label}>{v.flag}</span>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── FOOTER ── */}
      <footer className="py-8">
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-gray-600">{t('footerCopyright')}</p>
          <div className="flex items-center gap-5">
            <Link href="/library" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">{tN('myVideos')}</Link>
            <Link href="/billing" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">{tN('billing')}</Link>
            <Link href="/login" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">{tN('login')}</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}