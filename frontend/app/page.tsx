'use client';
import { useState, useEffect, useRef } from 'react';
import { submitJob, getJobStatus } from '@/lib/api';
import Link from 'next/link';

const LANGS: Record<string, { label: string; flag: string }> = {
  fr: { label: 'Français',          flag: '🇫🇷' },
  en: { label: 'English',           flag: '🇬🇧' },
  es: { label: 'Español',           flag: '🇪🇸' },
  de: { label: 'Deutsch',           flag: '🇩🇪' },
  it: { label: 'Italiano',          flag: '🇮🇹' },
  pt: { label: 'Português',         flag: '🇧🇷' },
  nl: { label: 'Nederlands',        flag: '🇳🇱' },
  pl: { label: 'Polski',            flag: '🇵🇱' },
  ru: { label: 'Русский',           flag: '🇷🇺' },
  uk: { label: 'Українська',        flag: '🇺🇦' },
  ar: { label: 'العربية',           flag: '🇸🇦' },
  fa: { label: 'فارسی',             flag: '🇮🇷' },
  he: { label: 'עברית',             flag: '🇮🇱' },
  tr: { label: 'Türkçe',            flag: '🇹🇷' },
  zh: { label: '中文',              flag: '🇨🇳' },
  ja: { label: '日本語',            flag: '🇯🇵' },
  ko: { label: '한국어',            flag: '🇰🇷' },
  hi: { label: 'हिन्दी',            flag: '🇮🇳' },
  vi: { label: 'Tiếng Việt',        flag: '🇻🇳' },
  id: { label: 'Bahasa Indonesia',  flag: '🇮🇩' },
};

const STEPS = [
  { label: 'Téléchargement', icon: '⬇️' },
  { label: 'Transcription',  icon: '🎙️' },
  { label: 'Traduction',     icon: '🌐' },
  { label: 'Rendu',          icon: '🎬' },
  { label: 'Terminé',        icon: '✅' },
];

const FEATURES = [
  { icon: '🎙️', title: 'Groq Whisper',       desc: 'Transcription audio ultra-rapide' },
  { icon: '🤖', title: 'DeepSeek V3',        desc: 'Traduction naturelle par IA' },
  { icon: '🎬', title: 'Sous-titres brûlés', desc: 'Rendu professionnel FFmpeg' },
  { icon: '🔒', title: 'Watermark',          desc: 'spottedyou.org incrusté' },
];

export default function Home() {
  const [url, setUrl]         = useState('');
  const [lang, setLang]       = useState('fr');
  const [jobId, setJobId]     = useState<string | null>(null);
  const [status, setStatus]   = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
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

  function reset() { setJobId(null); setStatus(null); setUrl(''); setError(null); }

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
        <div className="relative max-w-5xl mx-auto px-4 py-14 sm:py-20 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-medium mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            Transcription · Traduction · Sous-titres par IA
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white mb-4 leading-tight">
            Traduisez vos vidéos<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">
              X &amp; YouTube
            </span>
          </h1>
          <p className="text-sm sm:text-base text-gray-400 max-w-xl mx-auto mb-0 leading-relaxed">
            Sous-titres brûlés en <strong className="text-white">21 langues</strong> — Groq Whisper + DeepSeek V3
          </p>
        </div>
      </section>

      {/* ── FORMULAIRE / RÉSULTAT ── */}
      <section className="border-b border-gray-800">
        <div className="max-w-5xl mx-auto px-4 py-10">

          {/* Formulaire */}
          {!jobId && (
            <form onSubmit={handleSubmit} className="max-w-lg mx-auto space-y-4">
              {/* URL */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 block mb-2">
                  Lien X (Twitter) ou YouTube
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="https://x.com/... ou https://youtube.com/..."
                  required
                  className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40 transition-colors"
                />
              </div>

              {/* Langue */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 block mb-2">
                  Langue cible
                </label>
                <select
                  value={lang}
                  onChange={e => setLang(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40 transition-colors cursor-pointer"
                >
                  {Object.entries(LANGS).map(([k, v]) => (
                    <option key={k} value={k} className="bg-gray-900">
                      {v.flag} {v.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Erreur */}
              {error && (
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
                ) : (
                  '🚀 Traduire la vidéo'
                )}
              </button>
            </form>
          )}

          {/* Progression */}
          {jobId && (
            <div className="max-w-lg mx-auto">
              <div className="bg-gray-900/60 border border-gray-800 rounded-2xl overflow-hidden">
                {/* Steps */}
                <div className="px-6 pt-6 pb-4 border-b border-gray-800">
                  <div className="flex items-center justify-between gap-1 mb-4">
                    {STEPS.map((s, i) => {
                      const done    = (status?.status === 'done') || i < activeStep;
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
                          <span className={`text-[9px] text-center leading-tight hidden sm:block ${
                            done || current ? 'text-gray-300' : 'text-gray-700'
                          }`}>{s.label}</span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Barre */}
                  <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="h-1.5 rounded-full transition-all duration-700 bg-gradient-to-r from-blue-600 to-cyan-400"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1.5">
                    <p className="text-[11px] text-gray-500">{status?.status_label || 'En attente du worker…'}</p>
                    <p className="text-[11px] text-gray-600 tabular-nums">{pct}%</p>
                  </div>
                </div>

                {/* Résultat done */}
                {status?.status === 'done' && status?.storage_url && (
                  <div className="p-5 space-y-4">
                    {/* Résumé IA */}
                    {status.summary && (
                      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">📝 Résumé IA</p>
                        <p className="text-xs text-gray-300 leading-relaxed">{status.summary}</p>
                      </div>
                    )}

                    {/* Lecteur vidéo */}
                    <div className="relative rounded-xl overflow-hidden bg-black border border-gray-800">
                      <video
                        src={status.storage_url}
                        controls
                        className="w-full aspect-video"
                        preload="metadata"
                      />
                      <div className="absolute top-2 right-2 bg-black/70 text-white text-[10px] px-2 py-0.5 rounded font-medium pointer-events-none">
                        spottedyou.org
                      </div>
                    </div>

                    {/* Télécharger */}
                    {status.can_download ? (
                      <a
                        href={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/jobs/${jobId}/download`}
                        className="flex items-center justify-center gap-2 w-full px-5 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors"
                      >
                        ⬇️ Télécharger la vidéo
                      </a>
                    ) : (
                      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 text-center">
                        <p className="text-xs text-gray-400 mb-3">🔒 Connectez-vous pour télécharger</p>
                        <Link
                          href="/login"
                          className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
                        >
                          Se connecter →
                        </Link>
                      </div>
                    )}

                    <button
                      onClick={reset}
                      className="w-full px-5 py-2.5 rounded-xl border border-gray-800 bg-gray-900 hover:bg-gray-800 text-gray-400 hover:text-white text-xs font-medium transition-all"
                    >
                      ↩ Traduire une autre vidéo
                    </button>
                  </div>
                )}

                {/* Erreur */}
                {status?.status === 'error' && (
                  <div className="p-5">
                    <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-center space-y-3">
                      <p className="text-red-400 text-sm">❌ {status.error_msg || 'Une erreur est survenue'}</p>
                      <button onClick={reset} className="text-xs text-gray-500 hover:text-white transition-colors underline">
                        Réessayer
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── FEATURES ── */}
      {!jobId && (
        <section className="border-b border-gray-800">
          <div className="max-w-5xl mx-auto px-4 py-10">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-5">Comment ça marche</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {FEATURES.map(f => (
                <div key={f.title} className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
                  <div className="text-2xl mb-3">{f.icon}</div>
                  <p className="text-xs font-semibold text-white mb-1">{f.title}</p>
                  <p className="text-[11px] text-gray-500">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── FOOTER ── */}
      <footer className="py-8">
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-gray-600">© 2026 SpottedYou Translator</p>
          <div className="flex items-center gap-5">
            <Link href="/library"  className="text-xs text-gray-600 hover:text-gray-400 transition-colors">Mes vidéos</Link>
            <Link href="/billing"  className="text-xs text-gray-600 hover:text-gray-400 transition-colors">Abonnement</Link>
            <Link href="/login"    className="text-xs text-gray-600 hover:text-gray-400 transition-colors">Connexion</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
