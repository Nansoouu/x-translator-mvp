'use client';
import { useState, useEffect, useRef } from 'react';
import { submitJob, getJobStatus } from '@/lib/api';

const LANGS: Record<string, { label: string; flag: string }> = {
  fr: { label: 'Français',           flag: '🇫🇷' },
  en: { label: 'English',            flag: '🇬🇧' },
  es: { label: 'Español',            flag: '🇪🇸' },
  de: { label: 'Deutsch',            flag: '🇩🇪' },
  it: { label: 'Italiano',           flag: '🇮🇹' },
  pt: { label: 'Português',          flag: '🇧🇷' },
  nl: { label: 'Nederlands',         flag: '🇳🇱' },
  pl: { label: 'Polski',             flag: '🇵🇱' },
  ru: { label: 'Русский',            flag: '🇷🇺' },
  uk: { label: 'Українська',         flag: '🇺🇦' },
  ar: { label: 'العربية',            flag: '🇸🇦' },
  fa: { label: 'فارسی',              flag: '🇮🇷' },
  he: { label: 'עברית',              flag: '🇮🇱' },
  tr: { label: 'Türkçe',             flag: '🇹🇷' },
  zh: { label: '中文',               flag: '🇨🇳' },
  ja: { label: '日本語',             flag: '🇯🇵' },
  ko: { label: '한국어',             flag: '🇰🇷' },
  hi: { label: 'हिन्दी',             flag: '🇮🇳' },
  vi: { label: 'Tiếng Việt',         flag: '🇻🇳' },
  id: { label: 'Bahasa Indonesia',   flag: '🇮🇩' },
};

const STEPS = [
  { key: 'download',    label: 'Téléchargement', icon: '⬇️' },
  { key: 'transcribe',  label: 'Transcription',  icon: '🎙️' },
  { key: 'translate',   label: 'Traduction',     icon: '🌐' },
  { key: 'render',      label: 'Rendu',          icon: '🎬' },
  { key: 'done',        label: 'Terminé',        icon: '✅' },
];

const FEATURES = [
  { icon: '🎙️', title: 'Groq Whisper',    desc: 'Transcription ultra-rapide et précise' },
  { icon: '🤖', title: 'DeepSeek V3',     desc: 'Traduction naturelle par IA' },
  { icon: '🎬', title: 'Sous-titres brûlés', desc: 'Rendu vidéo professionnel avec FFmpeg' },
  { icon: '🔒', title: 'Watermark discret', desc: 'spottedyou.org incrusté dans la vidéo' },
];

export default function Home() {
  const [url, setUrl]       = useState('');
  const [lang, setLang]     = useState('fr');
  const [jobId, setJobId]   = useState<string | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    setLoading(true);
    try {
      const res = await submitJob(url, lang);
      setJobId(res.job_id);
    } catch (err: any) {
      setError(err?.message || err?.detail || 'Erreur lors de la soumission. Vérifiez le lien.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!jobId) return;
    pollRef.current = setInterval(async () => {
      try {
        const s = await getJobStatus(jobId);
        setStatus(s);
        if (s.status === 'done' || s.status === 'error') clearInterval(pollRef.current!);
      } catch {}
    }, 3000);
    return () => clearInterval(pollRef.current!);
  }, [jobId]);

  const pct = status?.progress_pct || 0;
  const activeStep = Math.floor(pct / 25);

  const isXUrl = url.includes('x.com') || url.includes('twitter.com');
  const isYtUrl = url.includes('youtube.com') || url.includes('youtu.be');

  function reset() { setJobId(null); setStatus(null); setUrl(''); setError(null); }

  return (
    <main className="min-h-screen bg-grid">
      {/* ─── HERO ─── */}
      <section className="pt-32 pb-16 px-4 text-center relative">
        {/* Glow */}
        <div
          className="pointer-events-none absolute inset-0 overflow-hidden"
          style={{ background: 'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(59,130,246,0.12), transparent)' }}
        />

        <div className="relative max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs px-3 py-1.5 rounded-full mb-6">
            <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
            Transcription · Traduction · Sous-titres par IA
          </div>

          <h1 className="text-5xl sm:text-6xl font-extrabold leading-tight mb-4">
            Traduisez vos vidéos<br />
            <span className="gradient-text">X &amp; YouTube</span>
          </h1>

          <p className="text-zinc-400 text-lg sm:text-xl mb-2 max-w-xl mx-auto">
            Sous-titres brûlés en <strong className="text-white">21 langues</strong> — Groq Whisper + DeepSeek V3
          </p>
        </div>
      </section>

      {/* ─── FORM / RESULT ─── */}
      <section className="px-4 pb-24">
        <div className="max-w-xl mx-auto">

          {/* ── Formulaire (si pas de job en cours) ── */}
          {!jobId && (
            <form onSubmit={handleSubmit} className="card p-6 space-y-4 shadow-2xl shadow-black/50">
              {/* URL input */}
              <div>
                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 block">
                  Lien X (Twitter) ou YouTube
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-lg pointer-events-none">
                    {isXUrl ? '𝕏' : isYtUrl ? '▶' : '🔗'}
                  </span>
                  <input
                    type="url"
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    placeholder="https://x.com/... ou https://youtube.com/..."
                    required
                    className="input-base pl-10"
                  />
                </div>
              </div>

              {/* Langue */}
              <div>
                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 block">
                  Langue cible
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
                    {LANGS[lang]?.flag}
                  </span>
                  <select
                    value={lang}
                    onChange={e => setLang(e.target.value)}
                    className="input-base pl-10 appearance-none cursor-pointer"
                  >
                    {Object.entries(LANGS).map(([k, v]) => (
                      <option key={k} value={k} className="bg-zinc-900">
                        {v.flag} {v.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 bg-red-950/50 border border-red-900/50 text-red-400 text-sm p-3 rounded-xl">
                  <span className="mt-0.5 shrink-0">⚠️</span>
                  <p>{error}</p>
                </div>
              )}

              <button type="submit" disabled={loading} className="btn-primary text-base py-3.5">
                {loading
                  ? <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                      Envoi en cours…
                    </span>
                  : '🚀 Traduire la vidéo'
                }
              </button>
            </form>
          )}

          {/* ── Progression ── */}
          {jobId && (
            <div className="card p-6 shadow-2xl shadow-black/50 space-y-6">
              {/* Steps */}
              <div className="flex items-center justify-between">
                {STEPS.map((s, i) => {
                  const done    = i < activeStep || status?.status === 'done';
                  const current = i === activeStep && status?.status !== 'done' && status?.status !== 'error';
                  return (
                    <div key={s.key} className="flex flex-col items-center gap-1 flex-1">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm border-2 transition-all duration-500 ${
                        done    ? 'bg-blue-600 border-blue-600 text-white' :
                        current ? 'border-blue-500 bg-blue-500/20 text-blue-400 animate-pulse' :
                                  'border-zinc-700 text-zinc-600'
                      }`}>
                        {done ? '✓' : s.icon}
                      </div>
                      <span className={`text-xs text-center leading-tight hidden sm:block ${
                        done || current ? 'text-white' : 'text-zinc-600'
                      }`}>{s.label}</span>
                    </div>
                  );
                })}
              </div>

              {/* Progress bar */}
              <div>
                <div className="flex justify-between text-xs text-zinc-500 mb-1.5">
                  <span>{status?.status_label || 'En attente du worker…'}</span>
                  <span>{pct}%</span>
                </div>
                <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-2 rounded-full transition-all duration-700 bg-gradient-to-r from-blue-600 to-blue-400"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>

              {/* ── Résultat final ── */}
              {status?.status === 'done' && status?.storage_url && (
                <div className="space-y-4">
                  {/* Résumé */}
                  {status.summary && (
                    <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-4">
                      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">📝 Résumé IA</p>
                      <p className="text-sm text-zinc-300 leading-relaxed">{status.summary}</p>
                    </div>
                  )}

                  {/* Lecteur */}
                  <div className="relative rounded-xl overflow-hidden bg-black ring-1 ring-zinc-800 shadow-2xl">
                    <video
                      src={status.storage_url}
                      controls
                      className="w-full aspect-video"
                      preload="metadata"
                    />
                    <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm text-white text-xs px-2.5 py-1 rounded-md font-medium pointer-events-none">
                      spottedyou.org
                    </div>
                  </div>

                  {/* CTA download */}
                  {status.can_download ? (
                    <a
                      href={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/jobs/${jobId}/download`}
                      className="flex items-center justify-center gap-2 w-full bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-semibold py-3.5 rounded-xl transition-all shadow-lg shadow-emerald-900/30"
                    >
                      ⬇️ Télécharger la vidéo
                    </a>
                  ) : (
                    <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-4 text-center">
                      <p className="text-zinc-400 text-sm mb-3">
                        🔒 Connectez-vous pour télécharger sans watermark
                      </p>
                      <a
                        href="/login"
                        className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-6 py-2.5 rounded-lg transition"
                      >
                        Se connecter →
                      </a>
                    </div>
                  )}

                  <button
                    onClick={reset}
                    className="btn-outline text-sm py-2.5"
                  >
                    ↩ Traduire une autre vidéo
                  </button>
                </div>
              )}

              {/* Erreur */}
              {status?.status === 'error' && (
                <div className="bg-red-950/40 border border-red-900/50 rounded-xl p-4 text-center space-y-3">
                  <p className="text-red-400">❌ {status.error_msg || 'Une erreur est survenue'}</p>
                  <button onClick={reset} className="text-zinc-400 hover:text-white text-sm underline">
                    Réessayer
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Features ── */}
          {!jobId && (
            <div className="mt-8 grid grid-cols-2 gap-3">
              {FEATURES.map(f => (
                <div key={f.title} className="bg-zinc-900/40 border border-zinc-800/50 rounded-xl p-4">
                  <div className="text-2xl mb-2">{f.icon}</div>
                  <p className="text-sm font-semibold text-white">{f.title}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{f.desc}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
