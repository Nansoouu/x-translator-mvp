'use client';
import { useState, useEffect, useRef } from 'react';
import { submitJob, getJobStatus, getQueueStats } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import Link from 'next/link';

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

// ── Étapes de traitement ──────────────────────────────────────────────────────
const STEPS = [
  { label: 'Récupération', icon: '⬇️',  statuses: ['downloading'] },
  { label: 'Écoute',       icon: '🎙️', statuses: ['transcribing'] },
  { label: 'Traduction',   icon: '🌐',  statuses: ['translating'] },
  { label: 'Rendu',        icon: '🎬',  statuses: ['burning', 'uploading'] },
  { label: 'Terminé',      icon: '✅',  statuses: ['done'] },
];

// ── Providers supportés (yt-dlp) ──────────────────────────────────────────────
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

// ── Bénéfices ─────────────────────────────────────────────────────────────────
const BENEFITS = [
  { icon: '✨', title: 'Comprenez tout',          desc: 'Regardez n\'importe quelle vidéo dans votre langue, sans chercher de traduction.' },
  { icon: '⚡', title: 'En quelques minutes',     desc: 'Collez un lien, choisissez votre langue. Votre vidéo traduite est prête rapidement.' },
  { icon: '🌍', title: 'Partagez à votre audience', desc: 'Diffusez des contenus internationaux à votre communauté dans leur langue.' },
  { icon: '🔒', title: '100% privé',              desc: 'Vos vidéos sont stockées de façon sécurisée et accessibles uniquement par vous.' },
];

// ── Roadmap V2 ────────────────────────────────────────────────────────────────
const ROADMAP = [
  { icon: '📤', title: 'Export automatique',     desc: 'Partagez directement vers Instagram, Telegram, votre boîte mail ou votre chaîne YouTube.' },
  { icon: '✂️', title: 'Éditeur d\'extraits',    desc: 'Sélectionnez les meilleurs moments de la vidéo avant de lancer la traduction.' },
  { icon: '🎙️', title: 'Doublage IA',           desc: 'Générez une voix traduite synchronized avec la vidéo originale.' },
  { icon: '📊', title: 'Analytics de contenu',   desc: 'Mesurez l\'engagement de vos vidéos traduites par langue et région.' },
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
  if (m <= 1) return 'environ 1 min';
  return `environ ${m} min`;
}

// ── Animation hero ────────────────────────────────────────────────────────────
const ANIMATED_PROVIDERS = ['𝕏 (Twitter)', 'YouTube', 'TikTok', 'Instagram'];
const ANIMATED_FLAGS      = ['🇫🇷', '🇬🇧', '🇪🇸', '🇩🇪', '🇯🇵', '🇰🇷', '🇸🇦', '🇧🇷'];

// ── Page principale ───────────────────────────────────────────────────────────
export default function Home() {
  const { isAuthenticated } = useAuth();

  const [url,     setUrl]     = useState('');
  const [jobId,   setJobId]   = useState<string | null>(null);
  const [status,  setStatus]  = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // Multi-sélection de langues
  const [selectedLangs, setSelectedLangs] = useState<string[]>(['en']);
  const [upsellLang,    setUpsellLang]    = useState(false);
  const [multiDone,     setMultiDone]     = useState(false); // soumission multi terminée

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

  useEffect(() => {
    const t = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setProviderIdx((i) => (i + 1) % ANIMATED_PROVIDERS.length);
        setFlagIdx((i) => (i + 1) % ANIMATED_FLAGS.length);
        setVisible(true);
      }, 250);
    }, 2200);
    return () => clearInterval(t);
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

  // ── Toggle langue ────────────────────────────────────────────────────────────
  function toggleLang(code: string) {
    if (selectedLangs.includes(code)) {
      // Ne pas désélectionner la dernière langue
      if (selectedLangs.length > 1) {
        setSelectedLangs((prev) => prev.filter((l) => l !== code));
        setUpsellLang(false);
      }
    } else {
      if (!isAuthenticated && selectedLangs.length >= 1) {
        setUpsellLang(true);
        return;
      }
      setSelectedLangs((prev) => [...prev, code]);
      setUpsellLang(false);
    }
  }

  // ── Submit ───────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    setElapsed(0);
    setLoading(true);
    setMultiDone(false);

    try {
      if (selectedLangs.length === 1) {
        // Mode simple — suivi en temps réel sur la même page
        const res = await submitJob(url, selectedLangs[0]);
        startedAtRef.current = Date.now();
        setJobId(res.job_id);
        if (res.status === 'done') {
          const s = await getJobStatus(res.job_id);
          setStatus(s);
        }
      } else {
        // Mode multi — soumettre N jobs et rediriger vers la bibliothèque
        await Promise.all(selectedLangs.map((lang) => submitJob(url, lang)));
        setMultiDone(true);
        setTimeout(() => { window.location.href = '/library'; }, 2000);
      }
    } catch (err: any) {
      const detail = err?.detail;
      if (typeof detail === 'object' && detail?.error === 'quota_exceeded') {
        setError('quota_exceeded');
      } else {
        setError(detail?.message || err?.message || 'Erreur. Vérifiez le lien et réessayez.');
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

  const pct = status?.progress_pct || 0;
  const activeStep = (() => {
    if (!status) return -1;
    const st = status.status;
    if (st === 'done') return 5;
    for (let i = 0; i < STEPS.length; i++) {
      if (STEPS[i].statuses.includes(st)) return i;
    }
    return 0;
  })();
  const estimatedTotalS = status?.duration_s ? Math.max(90, status.duration_s * 1.5 + 60) : 240;
  const remaining       = Math.max(0, estimatedTotalS - elapsed);

  return (
    <main className="h-screen overflow-y-auto bg-gray-950 text-white">

      {/* ── HERO ── */}
      <section className="relative overflow-hidden border-b border-gray-800">
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
        <div className="relative max-w-5xl mx-auto px-4 py-16 sm:py-24 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-medium mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            21 langues · 8 plateformes · Sous-titres inclus
          </div>

          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight leading-tight mb-6">
            <span className="text-white">From </span>
            <span
              className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400 transition-opacity duration-200"
              style={{ opacity: visible ? 1 : 0 }}
            >
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
            Votre vidéo traduite, sous-titrée et prête à partager <strong className="text-white">sans effort</strong>.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="#translate"
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-7 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-colors shadow-lg shadow-blue-500/20"
            >
              🚀 Traduire une vidéo
            </a>
            <Link
              href="/login"
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-7 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 font-semibold text-sm transition-colors border border-gray-700"
            >
              Créer un compte gratuit
            </Link>
          </div>

          {/* Providers bar */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <span className="text-[11px] text-gray-600 uppercase tracking-widest">Compatible avec</span>
            {PROVIDERS.map((p) => (
              <span key={p.name} className={`text-xs font-semibold ${p.color} opacity-70`}>
                {p.name}
              </span>
            ))}
            <span className="text-[11px] text-gray-600">+ hundreds more</span>
          </div>
        </div>
      </section>

      {/* ── FORMULAIRE / RÉSULTAT ── */}
      <section id="translate" className="border-b border-gray-800">
        <div className="max-w-5xl mx-auto px-4 py-10">

          {/* Bannière file d'attente */}
          {!jobId && queue && queue.active_count > 0 && (
            <div className="max-w-lg mx-auto mb-6 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 flex items-start gap-3">
              <span className="text-lg leading-none mt-0.5">⏳</span>
              <div>
                <p className="text-xs font-semibold text-amber-300">
                  {queue.active_count} vidéo{queue.active_count > 1 ? 's' : ''} en cours de traitement
                </p>
                {queue.estimated_wait_s > 0 && (
                  <p className="text-[11px] text-amber-400/70 mt-0.5">
                    Délai estimé : {formatMinutes(queue.estimated_wait_s)} · La file avance automatiquement
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Multi-langue soumis → redirection */}
          {multiDone && (
            <div className="max-w-lg mx-auto text-center py-10">
              <div className="text-4xl mb-4">🚀</div>
              <p className="text-base font-bold text-white mb-2">
                {selectedLangs.length} traductions lancées !
              </p>
              <p className="text-sm text-gray-400 mb-4">Redirection vers votre bibliothèque…</p>
              <Link href="/library" className="text-blue-400 text-xs underline">Aller maintenant →</Link>
            </div>
          )}

          {!jobId && !multiDone && (
            <form onSubmit={handleSubmit} className="max-w-lg mx-auto space-y-5">

              {/* URL */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 block mb-2">
                  Lien vidéo (X, YouTube, TikTok, Instagram, Vimeo…)
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://x.com/… https://tiktok.com/… https://youtube.com/…"
                  required
                  className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40 transition-colors"
                />
              </div>

              {/* Sélecteur de langues — grille de drapeaux */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-gray-500">
                    Langue{selectedLangs.length > 1 ? 's' : ''} cible{selectedLangs.length > 1 ? 's' : ''}
                    <span className="ml-2 font-normal normal-case text-gray-600">
                      ({selectedLangs.length} sélectionnée{selectedLangs.length > 1 ? 's' : ''})
                    </span>
                  </label>
                  {!isAuthenticated && (
                    <span className="text-[10px] text-gray-600">
                      <Link href="/login" className="text-blue-500 hover:text-blue-400 underline">Connectez-vous</Link> pour multi-langues
                    </span>
                  )}
                </div>

                {/* Grille */}
                <div className="grid grid-cols-5 gap-1.5">
                  {LANG_CODES.map((code) => {
                    const { label, flag } = LANGS[code];
                    const isSelected = selectedLangs.includes(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        title={label}
                        onClick={() => toggleLang(code)}
                        className={`
                          relative flex flex-col items-center gap-0.5 py-2 px-1 rounded-xl border text-center transition-all
                          ${isSelected
                            ? 'border-blue-500 bg-blue-500/15 shadow-sm shadow-blue-500/20'
                            : 'border-gray-800 bg-gray-900 hover:border-gray-600 hover:bg-gray-800'}
                        `}
                      >
                        <span className="text-xl leading-none">{flag}</span>
                        <span className={`text-[9px] leading-none font-medium ${isSelected ? 'text-blue-300' : 'text-gray-500'}`}>
                          {code.toUpperCase()}
                        </span>
                        {isSelected && (
                          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-blue-600 border border-gray-950 flex items-center justify-center text-[8px] text-white font-bold">
                            ✓
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Upsell multi-langue */}
                {upsellLang && (
                  <div className="mt-3 bg-gradient-to-r from-blue-900/30 to-violet-900/30 border border-blue-500/20 rounded-xl p-3 text-xs">
                    <p className="font-semibold text-white mb-1">✨ Traduction multi-langues</p>
                    <p className="text-gray-400 mb-2">
                      Sélectionnez jusqu'à 21 langues en une seule soumission. Disponible avec un compte gratuit.
                    </p>
                    <div className="flex gap-2">
                      <Link href="/login" className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors">
                        Créer un compte →
                      </Link>
                      <button
                        type="button"
                        onClick={() => setUpsellLang(false)}
                        className="px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition-colors"
                      >
                        Fermer
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Erreur quota */}
              {error === 'quota_exceeded' && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                  <p className="text-xs font-bold text-amber-300 mb-1">Quota gratuit épuisé</p>
                  <p className="text-[11px] text-amber-400/80 mb-3">
                    Vos 3 vidéos gratuites ont été utilisées. Passez à l'offre Pro pour continuer.
                  </p>
                  <Link href="/billing" className="inline-flex text-xs font-semibold px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition-colors">
                    Voir les offres →
                  </Link>
                </div>
              )}

              {error && error !== 'quota_exceeded' && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs px-4 py-3 rounded-xl">
                  ⚠️ {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors shadow-lg shadow-blue-500/20"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    Envoi en cours…
                  </>
                ) : selectedLangs.length > 1
                    ? `🚀 Traduire en ${selectedLangs.length} langues`
                    : '🚀 Traduire la vidéo'}
              </button>

              {selectedLangs.length > 1 && (
                <p className="text-[11px] text-center text-gray-600">
                  {selectedLangs.length} jobs seront lancés simultanément → retrouvez-les dans{' '}
                  <Link href="/library" className="text-blue-500 underline">votre bibliothèque</Link>
                </p>
              )}
            </form>
          )}

          {/* ── CARD DE PROGRESSION (1 seule langue) ── */}
          {jobId && (
            <div className="max-w-lg mx-auto">
              <div className="bg-gray-900/60 border border-gray-800 rounded-2xl overflow-hidden">
                <div className="px-6 pt-6 pb-4 border-b border-gray-800">
                  <div className="flex items-center justify-between gap-1 mb-4">
                    {STEPS.map((s, i) => {
                      const done    = status?.status === 'done' || i < activeStep;
                      const current = i === activeStep && status?.status !== 'done' && status?.status !== 'error';
                      return (
                        <div key={s.label} className="flex flex-col items-center gap-1.5 flex-1">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs border-2 transition-all ${
                            done    ? 'bg-blue-600 border-blue-600 text-white'
                            : current ? 'border-blue-500 bg-blue-500/20 text-blue-400 animate-pulse'
                            :           'border-gray-700 text-gray-600'
                          }`}>
                            {done ? '✓' : s.icon}
                          </div>
                          <span className={`text-[9px] text-center hidden sm:block ${done || current ? 'text-gray-300' : 'text-gray-700'}`}>
                            {s.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="h-1.5 rounded-full transition-all duration-700 bg-gradient-to-r from-blue-600 to-cyan-400"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1.5">
                    <p className="text-[11px] text-gray-500">{status?.status_label || 'Traitement en cours…'}</p>
                    <p className="text-[11px] text-gray-600 tabular-nums">{pct}%</p>
                  </div>

                  {status?.status && status.status !== 'done' && status.status !== 'error' && (
                    <div className="mt-2 flex items-center justify-between text-[10px] text-gray-600">
                      <span>⏱ En cours depuis {formatSeconds(elapsed)}</span>
                      {elapsed < estimatedTotalS && (
                        <span className="text-gray-700">≈ {formatMinutes(remaining)} restantes</span>
                      )}
                    </div>
                  )}
                </div>

                {status?.status === 'done' && status?.storage_url && (
                  <div className="p-5 space-y-4">
                    {status.summary && (
                      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Résumé</p>
                        <p className="text-xs text-gray-300 leading-relaxed">{status.summary}</p>
                      </div>
                    )}
                    <div className="relative rounded-xl overflow-hidden bg-black border border-gray-800">
                      <video
                        src={status.storage_url}
                        controls
                        controlsList="nodownload noremoteplayback"
                        disablePictureInPicture
                        onContextMenu={(e) => e.preventDefault()}
                        className="w-full aspect-video"
                        preload="metadata"
                      />
                    </div>
                    <a
                      href={`${API}/jobs/${jobId}/download`}
                      download={`spottedyou-${jobId.slice(0, 8)}.mp4`}
                      className="flex items-center justify-center gap-2 w-full px-5 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors"
                    >
                      ⬇️ Télécharger la vidéo traduite
                    </a>
                    <button
                      onClick={reset}
                      className="w-full px-5 py-2.5 rounded-xl border border-gray-800 bg-gray-900 hover:bg-gray-800 text-gray-400 hover:text-white text-xs font-medium transition-all"
                    >
                      ↩ Traduire une autre vidéo
                    </button>
                  </div>
                )}

                {status?.status === 'error' && (
                  <div className="p-5">
                    <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-center space-y-3">
                      <p className="text-red-400 text-sm">❌ {status.error_msg || 'Une erreur est survenue'}</p>
                      <button onClick={reset} className="text-xs text-gray-500 hover:text-white underline">Réessayer</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── BÉNÉFICES ── */}
      {!jobId && !multiDone && (
        <section className="border-b border-gray-800">
          <div className="max-w-5xl mx-auto px-4 py-12">
            <div className="text-center mb-8">
              <h2 className="text-lg font-bold text-white mb-1">Pourquoi SpottedYou Translator ?</h2>
              <p className="text-sm text-gray-500">La barrière de la langue, c'est terminé.</p>
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

      {/* ── PROVIDERS SUPPORTÉS ── */}
      {!jobId && !multiDone && (
        <section className="border-b border-gray-800">
          <div className="max-w-5xl mx-auto px-4 py-10">
            <div className="text-center mb-6">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-1">Plateformes compatibles</p>
              <p className="text-xs text-gray-600">Copiez-collez n'importe quel lien vidéo public</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl mx-auto">
              {PROVIDERS.map((p) => (
                <div key={p.name} className="bg-gray-900 border border-gray-800 rounded-xl p-3 flex items-center gap-2.5 hover:border-gray-700 transition-colors">
                  <span className={`text-xl font-bold leading-none ${p.color}`}>{p.icon}</span>
                  <span className="text-xs font-semibold text-gray-300">{p.name}</span>
                </div>
              ))}
            </div>
            <p className="text-center text-[11px] text-gray-600 mt-4">
              + Dailymotion, Twitch clips, Reddit, et des centaines d'autres
            </p>
          </div>
        </section>
      )}

      {/* ── SECTION ÉQUIPE + ROADMAP V2 ── */}
      {!jobId && !multiDone && (
        <section className="border-b border-gray-800">
          <div className="max-w-5xl mx-auto px-4 py-14">
            <div className="grid md:grid-cols-2 gap-10 items-start">

              {/* Notre équipe */}
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 text-xs font-medium mb-6">
                  👋 Qui sommes-nous ?
                </div>
                <h2 className="text-xl font-bold text-white mb-4">Une petite équipe, une grande ambition</h2>
                <p className="text-sm text-gray-400 leading-relaxed mb-4">
                  SpottedYou Translator est né d'une conviction simple : <strong className="text-white">les meilleures technologies</strong> doivent être accessibles à tous, pas seulement aux grandes équipes avec de gros budgets.
                </p>
                <p className="text-sm text-gray-400 leading-relaxed mb-4">
                  Nous sommes une toute petite équipe passionnée qui a assemblé les outils les plus avancés du moment pour vous offrir une expérience magique — sans que vous ayez besoin de comprendre ce qui se passe sous le capot.
                </p>
                <p className="text-sm text-gray-400 leading-relaxed">
                  Chaque vidéo traduite est un pont entre des cultures. Merci d'en faire partie. 🌍
                </p>
              </div>

              {/* Roadmap V2 */}
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium mb-6">
                  🗺️ Ce qui arrive dans la V2
                </div>
                <h2 className="text-xl font-bold text-white mb-4">La suite du voyage</h2>
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

      {/* ── LANGUES DISPO ── */}
      {!jobId && !multiDone && (
        <section className="border-b border-gray-800">
          <div className="max-w-5xl mx-auto px-4 py-10 text-center">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-4">
              {Object.keys(LANGS).length} langues disponibles
            </p>
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
          <p className="text-xs text-gray-600">© 2026 SpottedYou Translator · Built with ❤️</p>
          <div className="flex items-center gap-5">
            <Link href="/library" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">Mes vidéos</Link>
            <Link href="/billing" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">Abonnement</Link>
            <Link href="/login"   className="text-xs text-gray-600 hover:text-gray-400 transition-colors">Connexion</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
