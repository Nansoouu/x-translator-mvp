'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { createStudioProject, listUserJobs, listStudioProjects } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────
type Job = {
  id: string;
  source_url: string;
  target_lang: string;
  status: string;
  summary?: string;
  thumbnail_url?: string;
  duration_s?: number;
  created_at: string;
};

type Project = {
  id: string;
  source_url: string;
  source_title?: string;
  status: string;
  created_at: string;
};

const HOOK_ICONS: Record<string, string> = {
  question: '❓', shock: '😱', laugh: '😂', fact: '💡', story: '📖', emotion: '❤️',
};

const STATUS_COLORS: Record<string, string> = {
  ready:     'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  analyzing: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  queued:    'bg-gray-800 text-gray-400 border-gray-700',
  error:     'bg-red-500/20 text-red-400 border-red-500/30',
};

const STATUS_LABELS: Record<string, string> = {
  ready:     '✅ Prêt',
  analyzing: '🧠 Analyse…',
  queued:    '🕐 En file',
  error:     '❌ Erreur',
};

// ── Page principale ───────────────────────────────────────────────────────────
export default function StudioPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();

  const [tab, setTab]           = useState<'library' | 'url'>('library');
  const [url, setUrl]           = useState('');
  const [jobs, setJobs]         = useState<Job[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading]   = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Redirection si non connecté
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, authLoading, router]);

  // Charger jobs et projets existants
  useEffect(() => {
    if (!isAuthenticated) return;
    setLoading(true);
    Promise.all([listUserJobs(), listStudioProjects()])
      .then(([j, p]) => {
        setJobs((j || []).filter((job: Job) => job.status === 'done'));
        setProjects(p || []);
      })
      .finally(() => setLoading(false));
  }, [isAuthenticated]);

  async function handleFromLibrary(jobId: string) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await createStudioProject({ source_job_id: jobId });
      router.push(`/studio/${res.project_id}`);
    } catch (e: any) {
      setError(e?.detail || e?.message || 'Erreur lors de la création du projet');
      setSubmitting(false);
    }
  }

  async function handleFromUrl(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await createStudioProject({ source_url: url.trim() });
      router.push(`/studio/${res.project_id}`);
    } catch (e: any) {
      setError(e?.detail || e?.message || 'Erreur lors de la création du projet');
      setSubmitting(false);
    }
  }

  if (authLoading) return (
    <main className="h-screen bg-gray-950 flex items-center justify-center">
      <svg className="animate-spin h-7 w-7 text-blue-500" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
      </svg>
    </main>
  );

  // Grouper les jobs par source_url (déduplication légère)
  const uniqueJobs = jobs.filter((j, i, arr) =>
    arr.findIndex((x) => x.source_url === j.source_url) === i
  );

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-5xl mx-auto px-4 py-10">

        {/* Header */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 text-xs font-medium mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            Studio IA v1 — Beta
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2">
            ✂️ Studio <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-pink-400">TikTok</span>
          </h1>
          <p className="text-sm text-gray-400 max-w-lg">
            Sélectionne une vidéo, l'IA détecte automatiquement les meilleurs moments viraux et les prépare pour TikTok, Reels et Shorts.
          </p>
        </div>

        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/20 text-red-400 text-sm px-4 py-3 rounded-xl">
            ⚠️ {error}
          </div>
        )}

        {submitting && (
          <div className="mb-6 bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm px-4 py-3 rounded-xl flex items-center gap-3">
            <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            Création du projet… Redirection en cours
          </div>
        )}

        {/* ── ÉTAPE 1 — CHOISIR UNE SOURCE ─────────────────────────────────── */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center text-white text-xs font-bold shrink-0">1</div>
            <h2 className="text-base font-bold text-white">Choisir une vidéo</h2>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setTab('library')}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-3 rounded-xl border text-sm font-semibold transition-all ${
                tab === 'library'
                  ? 'bg-violet-600 border-violet-600 text-white shadow-lg shadow-violet-500/20'
                  : 'border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600 hover:text-white'
              }`}
            >
              📁 Ma bibliothèque
              {uniqueJobs.length > 0 && (
                <span className="bg-white/20 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {uniqueJobs.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setTab('url')}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-3 rounded-xl border text-sm font-semibold transition-all ${
                tab === 'url'
                  ? 'bg-violet-600 border-violet-600 text-white shadow-lg shadow-violet-500/20'
                  : 'border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600 hover:text-white'
              }`}
            >
              ⬆️ Importer une URL
            </button>
          </div>

          {/* Contenu onglet bibliothèque */}
          {tab === 'library' && (
            <div>
              {loading ? (
                <div className="text-center py-10 text-gray-500 text-sm">Chargement…</div>
              ) : uniqueJobs.length === 0 ? (
                <div className="text-center py-10 border border-dashed border-gray-800 rounded-2xl">
                  <p className="text-3xl mb-3">🎬</p>
                  <p className="text-sm text-gray-400 mb-4">Aucune vidéo traduite dans ta bibliothèque</p>
                  <Link href="/" className="text-xs text-blue-400 underline">
                    Traduire une vidéo d'abord →
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {uniqueJobs.map((job) => (
                    <button
                      key={job.id}
                      onClick={() => !submitting && handleFromLibrary(job.id)}
                      disabled={submitting}
                      className="group relative flex flex-col bg-gray-900 border border-gray-800 hover:border-violet-500 rounded-2xl overflow-hidden transition-all hover:shadow-xl hover:shadow-violet-500/10 text-left disabled:opacity-50"
                    >
                      {/* Thumbnail */}
                      <div className="aspect-video relative bg-gray-800 overflow-hidden">
                        {job.thumbnail_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={job.thumbnail_url}
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-2xl opacity-20">▶</div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-gray-950/80 to-transparent" />
                        {/* Hover overlay */}
                        <div className="absolute inset-0 bg-violet-600/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <div className="bg-violet-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg">
                            ✂️ Analyser
                          </div>
                        </div>
                        {job.duration_s && (
                          <div className="absolute bottom-1.5 right-1.5 bg-gray-950/80 text-[10px] text-gray-300 px-1.5 py-0.5 rounded">
                            {Math.floor(job.duration_s / 60)}:{String(Math.round(job.duration_s % 60)).padStart(2, '0')}
                          </div>
                        )}
                      </div>
                      <div className="p-2.5">
                        {job.summary ? (
                          <p className="text-[11px] text-gray-300 line-clamp-2 leading-relaxed">{job.summary}</p>
                        ) : (
                          <p className="text-[10px] text-gray-600 truncate font-mono">{job.source_url}</p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Contenu onglet URL */}
          {tab === 'url' && (
            <form onSubmit={handleFromUrl} className="max-w-lg space-y-4">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 block mb-2">
                  URL YouTube, TikTok, Instagram…
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  required
                  className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/40 transition-colors"
                />
              </div>
              <button
                type="submit"
                disabled={submitting || !url.trim()}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white font-semibold text-sm transition-colors"
              >
                {submitting ? (
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                ) : '✂️'}
                Analyser cette vidéo
              </button>
            </form>
          )}
        </section>

        {/* ── PROJETS EXISTANTS ─────────────────────────────────────────────── */}
        {projects.length > 0 && (
          <section>
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-4">
              Projets Studio récents
            </h2>
            <div className="space-y-2">
              {projects.map((p) => (
                <Link
                  key={p.id}
                  href={`/studio/${p.id}`}
                  className="flex items-center justify-between px-4 py-3 bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl transition-all group"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">
                      {p.source_title || p.source_url}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 ml-4 shrink-0">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${STATUS_COLORS[p.status] || STATUS_COLORS.queued}`}>
                      {STATUS_LABELS[p.status] || p.status}
                    </span>
                    <svg className="w-4 h-4 text-gray-600 group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
