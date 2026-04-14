'use client';
import { useEffect, useState } from 'react';
import { listUserJobs } from '@/lib/api';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const STATUS_STYLES: Record<string, string> = {
  done:       'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  error:      'bg-red-500/10 text-red-400 border border-red-500/20',
  processing: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  pending:    'bg-gray-800 text-gray-400 border border-gray-700',
};
const STATUS_LABELS: Record<string, string> = {
  done: '✅ Terminé', error: '❌ Erreur',
  processing: '⏳ En cours', pending: '🕐 En attente',
};
const LANG_FLAGS: Record<string, string> = {
  fr:'🇫🇷', en:'🇬🇧', es:'🇪🇸', de:'🇩🇪', it:'🇮🇹', pt:'🇧🇷',
  ar:'🇸🇦', ru:'🇷🇺', zh:'🇨🇳', ja:'🇯🇵', ko:'🇰🇷', tr:'🇹🇷',
  nl:'🇳🇱', pl:'🇵🇱', uk:'🇺🇦', hi:'🇮🇳', fa:'🇮🇷', he:'🇮🇱', vi:'🇻🇳', id:'🇮🇩',
};

export default function LibraryPage() {
  const [jobs, setJobs]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listUserJobs().then(j => { setJobs(j); setLoading(false); });
  }, []);

  if (loading) {
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

  return (
    <main className="h-screen overflow-y-auto bg-gray-950 text-white">
      <div className="max-w-5xl mx-auto px-4 py-10">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-lg font-bold text-white">Mes vidéos</h1>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {jobs.length
                ? `${jobs.length} vidéo${jobs.length > 1 ? 's' : ''} traduite${jobs.length > 1 ? 's' : ''}`
                : 'Aucune vidéo pour l\'instant'
              }
            </p>
          </div>
          <Link
            href="/"
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            + Nouvelle vidéo
          </Link>
        </div>

        {/* Empty state */}
        {jobs.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-gray-800 rounded-2xl">
            <p className="text-4xl mb-3">🎬</p>
            <p className="text-sm font-semibold text-white mb-1">Aucune vidéo traduite</p>
            <p className="text-xs text-gray-500 mb-5">Traduisez votre première vidéo X ou YouTube maintenant.</p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-colors shadow-lg shadow-blue-500/20"
            >
              🚀 Traduire ma première vidéo
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {jobs.map((j: any) => (
              <div
                key={j.id}
                className="group bg-gray-900/60 border border-gray-800 rounded-xl p-4 hover:border-gray-700 hover:bg-gray-900/80 transition-all flex items-start gap-4"
              >
                {/* Icône source */}
                <div className="shrink-0 w-9 h-9 bg-gray-800 rounded-lg flex items-center justify-center text-base border border-gray-700">
                  {j.source_url?.includes('youtube') || j.source_url?.includes('youtu.be') ? '▶' : '𝕏'}
                </div>

                {/* Contenu */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-200 truncate">{j.source_url}</p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className="text-[10px] bg-gray-800 border border-gray-700 px-2 py-0.5 rounded">
                      {LANG_FLAGS[j.target_lang] || '🌐'} {j.target_lang?.toUpperCase()}
                    </span>
                    {j.duration_s && (
                      <span className="text-[10px] text-gray-600">⏱ {Math.round(j.duration_s)}s</span>
                    )}
                    {j.created_at && (
                      <span className="text-[10px] text-gray-600">
                        {new Date(j.created_at).toLocaleDateString('fr-FR')}
                      </span>
                    )}
                  </div>
                  {j.summary && (
                    <p className="text-[11px] text-gray-500 mt-1.5 line-clamp-2 italic">{j.summary}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="shrink-0 flex items-center gap-2">
                  <span className={`text-[10px] px-2.5 py-1 rounded-full font-medium ${STATUS_STYLES[j.status] || STATUS_STYLES.pending}`}>
                    {STATUS_LABELS[j.status] || j.status}
                  </span>
                  {j.status === 'done' && j.storage_url && (
                    <a
                      href={`${API}/jobs/${j.id}/download`}
                      className="text-[10px] font-medium px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-emerald-900/40 border border-gray-700 hover:border-emerald-700 text-gray-300 hover:text-emerald-400 transition-all"
                    >
                      ⬇️ DL
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-center mt-10">
          <Link href="/" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
            ← Retour à l'accueil
          </Link>
        </p>
      </div>
    </main>
  );
}
