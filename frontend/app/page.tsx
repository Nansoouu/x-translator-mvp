'use client';
import { useState, useEffect, useRef } from 'react';
import { submitJob, getJobStatus } from '@/lib/api';

const LANGS: Record<string, string> = {
  fr: 'Français', en: 'English', ar: 'العربية', es: 'Español',
  de: 'Deutsch', ru: 'Русский', zh: '中文', pt: 'Português',
  tr: 'Türkçe', uk: 'Українська', it: 'Italiano', nl: 'Nederlands',
  pl: 'Polski', ja: '日本語', ko: '한국어', hi: 'हिन्दी',
  fa: 'فارسی', he: 'עברית', vi: 'Tiếng Việt', id: 'Bahasa Indonesia',
};

const STEPS = ['Téléchargement', 'Transcription', 'Traduction', 'Rendu', 'Terminé'];

export default function Home() {
  const [url, setUrl] = useState('');
  const [lang, setLang] = useState('fr');
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      setError(err?.message || err?.detail || 'Erreur lors de la soumission');
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
        if (s.status === 'done' || s.status === 'error') {
          clearInterval(pollRef.current!);
        }
      } catch {}
    }, 3000);
    return () => clearInterval(pollRef.current!);
  }, [jobId]);

  const activeStep = status ? Math.floor((status.progress_pct || 0) / 25) : -1;

  return (
    <main className="min-h-screen bg-zinc-950 text-white flex flex-col items-center py-16 px-4">
      {/* Hero */}
      <div className="text-center mb-12">
        <div className="text-4xl mb-2">🌍</div>
        <h1 className="text-4xl font-bold mb-2">SpottedYou <span className="text-blue-400">Translator</span></h1>
        <p className="text-zinc-400 text-lg">Traduisez n'importe quelle vidéo X ou YouTube en 21 langues</p>
      </div>

      {/* Formulaire */}
      <form onSubmit={handleSubmit} className="w-full max-w-2xl space-y-4">
        <div className="flex flex-col gap-2">
          <label className="text-sm text-zinc-400">Lien X (Twitter) ou YouTube</label>
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://x.com/user/status/..."
            required
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm text-zinc-400">Langue cible</label>
          <select
            value={lang}
            onChange={e => setLang(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500"
          >
            {Object.entries(LANGS).map(([k, v]) => (
              <option key={k} value={k}>{v} ({k})</option>
            ))}
          </select>
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={loading || !!jobId}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition"
        >
          {loading ? 'Envoi…' : '🚀 Traduire la vidéo'}
        </button>
      </form>

      {/* Progression */}
      {jobId && (
        <div className="w-full max-w-2xl mt-10 bg-zinc-900 rounded-xl p-6 border border-zinc-800">
          <div className="flex justify-between text-xs text-zinc-500 mb-2">
            {STEPS.map((s, i) => (
              <span key={s} className={i <= activeStep ? 'text-blue-400 font-semibold' : ''}>{s}</span>
            ))}
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-2 mb-4">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-700"
              style={{ width: `${status?.progress_pct || 0}%` }}
            />
          </div>
          <p className="text-sm text-zinc-300 text-center">{status?.status_label || 'En attente…'}</p>

          {/* Vidéo finale */}
          {status?.status === 'done' && status?.storage_url && (
            <div className="mt-6">
              {status.summary && (
                <div className="mb-4 bg-zinc-800 rounded-lg p-4 text-sm text-zinc-300">
                  <p className="text-xs text-zinc-500 mb-1 font-semibold uppercase tracking-wide">Résumé</p>
                  <p>{status.summary}</p>
                </div>
              )}

              {/* Lecteur vidéo avec watermark */}
              <div className="relative rounded-lg overflow-hidden bg-black">
                <video
                  src={status.storage_url}
                  controls
                  className="w-full aspect-video"
                  preload="metadata"
                />
                {/* Watermark overlay CSS (en plus du watermark vidéo) */}
                <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded pointer-events-none">
                  spottedyou.org
                </div>
              </div>

              {/* Bouton télécharger (connecté uniquement) */}
              {status.can_download ? (
                <a
                  href={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/jobs/${jobId}/download`}
                  className="mt-3 flex items-center justify-center gap-2 w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-lg transition"
                >
                  ⬇️ Télécharger la vidéo
                </a>
              ) : (
                <div className="mt-3 text-center">
                  <p className="text-zinc-400 text-sm mb-2">
                    🔒 <a href="/login" className="text-blue-400 hover:underline">Connectez-vous</a> pour télécharger
                  </p>
                </div>
              )}

              <button
                onClick={() => { setJobId(null); setStatus(null); setUrl(''); }}
                className="mt-2 w-full text-zinc-400 hover:text-white text-sm py-2"
              >
                ↩ Traduire une autre vidéo
              </button>
            </div>
          )}

          {status?.status === 'error' && (
            <div className="mt-4 text-red-400 text-sm text-center">
              ❌ {status.error_msg || 'Une erreur est survenue'}
              <button onClick={() => { setJobId(null); setStatus(null); }} className="block mt-2 text-zinc-400 hover:text-white">
                Réessayer
              </button>
            </div>
          )}
        </div>
      )}

      {/* Nav */}
      <div className="mt-12 flex gap-6 text-sm text-zinc-500">
        <a href="/login" className="hover:text-white">Connexion</a>
        <a href="/library" className="hover:text-white">Mes vidéos</a>
        <a href="/billing" className="hover:text-white">Abonnement</a>
      </div>
    </main>
  );
}
