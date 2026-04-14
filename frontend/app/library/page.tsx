'use client';
import { useEffect, useState } from 'react';
import { listUserJobs } from '@/lib/api';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const STATUS_STYLES: Record<string, string> = {
  done:       'bg-emerald-950 text-emerald-400 border border-emerald-900/50',
  error:      'bg-red-950 text-red-400 border border-red-900/50',
  processing: 'bg-blue-950 text-blue-400 border border-blue-900/50',
  pending:    'bg-zinc-800 text-zinc-400 border border-zinc-700/50',
};
const STATUS_LABELS: Record<string, string> = {
  done: '✅ Terminé', error: '❌ Erreur',
  processing: '⏳ En cours', pending: '🕐 En attente',
};

const LANG_FLAGS: Record<string, string> = {
  fr:'🇫🇷', en:'🇬🇧', es:'🇪🇸', de:'🇩🇪', it:'🇮🇹', pt:'🇧🇷', ar:'🇸🇦', ru:'🇷🇺',
  zh:'🇨🇳', ja:'🇯🇵', ko:'🇰🇷', tr:'🇹🇷', nl:'🇳🇱', pl:'🇵🇱', uk:'🇺🇦', hi:'🇮🇳',
  fa:'🇮🇷', he:'🇮🇱', vi:'🇻🇳', id:'🇮🇩',
};

export default function LibraryPage() {
  const [jobs, setJobs]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listUserJobs().then(j => { setJobs(j); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-zinc-500">
          <svg className="animate-spin h-8 w-8 text-blue-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          <p className="text-sm">Chargement de votre bibliothèque…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen pt-24 pb-16 px-4">
      {/* Glow */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{ background: 'radial-gradient(ellipse 50% 30% at 50% 0%, rgba(59,130,246,0.06), transparent)' }}
      />

      <div className="relative max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Mes vidéos</h1>
            <p className="text-zinc-500 text-sm mt-1">
              {jobs.length
                ? `${jobs.length} vidéo${jobs.length > 1 ? 's' : ''} traduite${jobs.length > 1 ? 's' : ''}`
                : 'Aucune vidéo pour l\'instant'
              }
            </p>
          </div>
          <Link
            href="/"
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition shadow-lg shadow-blue-900/30"
          >
            + Nouvelle vidéo
          </Link>
        </div>

        {jobs.length === 0 ? (
          /* Empty state */
          <div className="card p-16 text-center">
            <div className="text-6xl mb-4">🎬</div>
            <h2 className="text-xl font-semibold mb-2">Vous n'avez pas encore de vidéos</h2>
            <p className="text-zinc-500 text-sm mb-6">Traduisez votre première vidéo X ou YouTube maintenant.</p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-medium px-6 py-3 rounded-xl transition shadow-lg shadow-blue-900/30"
            >
              🚀 Traduire ma première vidéo
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((j: any) => (
              <div
                key={j.id}
                className="card p-4 hover:border-zinc-700 transition-all duration-200 group"
              >
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className="shrink-0 w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center text-xl">
                    {j.source_url?.includes('youtube') || j.source_url?.includes('youtu.be') ? '▶' : '𝕏'}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-zinc-300 truncate font-medium">{j.source_url}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="text-xs bg-zinc-800 px-2 py-0.5 rounded-md">
                        {LANG_FLAGS[j.target_lang] || '🌐'} {j.target_lang?.toUpperCase()}
                      </span>
                      {j.duration_s && (
                        <span className="text-xs text-zinc-600">
                          ⏱ {Math.round(j.duration_s)}s
                        </span>
                      )}
                      {j.created_at && (
                        <span className="text-xs text-zinc-600">
                          {new Date(j.created_at).toLocaleDateString('fr-FR')}
                        </span>
                      )}
                    </div>
                    {j.summary && (
                      <p className="text-xs text-zinc-500 mt-2 line-clamp-2 italic">{j.summary}</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="shrink-0 flex items-center gap-2">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_STYLES[j.status] || STATUS_STYLES.pending}`}>
                      {STATUS_LABELS[j.status] || j.status}
                    </span>
                    {j.status === 'done' && j.storage_url && (
                      <a
                        href={`${API}/jobs/${j.id}/download`}
                        className="bg-zinc-800 hover:bg-emerald-900/60 hover:border-emerald-800 border border-zinc-700 text-zinc-300 hover:text-emerald-400 text-xs px-3 py-1.5 rounded-lg transition"
                      >
                        ⬇️ Télécharger
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-center mt-10">
          <Link href="/" className="text-zinc-600 hover:text-zinc-400 text-sm transition">
            ← Retour à l'accueil
          </Link>
        </p>
      </div>
    </main>
  );
}
