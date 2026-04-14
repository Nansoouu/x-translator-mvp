'use client';
import { useEffect, useState } from 'react';
import { listUserJobs } from '@/lib/api';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function LibraryPage() {
  const [jobs, setJobs]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listUserJobs().then(j => { setJobs(j); setLoading(false); });
  }, []);

  if (loading) return <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center"><p>Chargement…</p></main>;

  return (
    <main className="min-h-screen bg-zinc-950 text-white py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">📚 Mes vidéos</h1>
          <a href="/" className="text-blue-400 hover:underline text-sm">+ Nouvelle vidéo</a>
        </div>
        {jobs.length === 0 ? (
          <div className="text-center text-zinc-400 py-16">
            <p className="text-5xl mb-4">🎬</p>
            <p>Aucune vidéo traduite pour l'instant.</p>
            <a href="/" className="mt-4 inline-block text-blue-400 hover:underline">Traduire ma première vidéo</a>
          </div>
        ) : (
          <div className="grid gap-4">
            {jobs.map((j: any) => (
              <div key={j.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex justify-between items-center">
                <div>
                  <p className="text-sm text-zinc-400 truncate max-w-xs">{j.source_url}</p>
                  <p className="text-xs text-zinc-500 mt-1">{j.target_lang} · {j.status} · {j.duration_s ? `${Math.round(j.duration_s)}s` : ''}</p>
                  {j.summary && <p className="text-xs text-zinc-400 mt-1 italic line-clamp-2">{j.summary}</p>}
                </div>
                <div className="flex gap-2 ml-4">
                  {j.status === 'done' && j.storage_url && (
                    <a href={`${API}/jobs/${j.id}/download`}
                       className="bg-green-600 hover:bg-green-700 text-white text-sm px-3 py-1.5 rounded-lg">
                      ⬇️ Télécharger
                    </a>
                  )}
                  <span className={`text-xs px-2 py-1 rounded-full ${j.status === 'done' ? 'bg-green-900 text-green-300' : j.status === 'error' ? 'bg-red-900 text-red-300' : 'bg-yellow-900 text-yellow-300'}`}>
                    {j.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-center mt-8"><a href="/" className="text-zinc-500 text-sm hover:text-white">← Retour</a></p>
      </div>
    </main>
  );
}
