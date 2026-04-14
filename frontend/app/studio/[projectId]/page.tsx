'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { getStudioProject, createStudioExport, getStudioExport } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────
type CaptionStyle = {
  position: string;
  animation: string;
  font_size: string;
  color: string;
  background: string;
};

type Clip = {
  id: string;
  start_s: number;
  end_s: number;
  score: number;
  hook_type: string;
  title: string;
  suggested_text: string;
  caption_style: CaptionStyle;
  hashtags: string[];
  description: string;
};

type Project = {
  id: string;
  source_url: string;
  source_storage_url?: string;   // URL Supabase du job traduit (pour le player)
  source_title?: string;
  status: string;
  error_msg?: string;
  ai_advice?: string;
  clips: Clip[];
};

type OutputClip = {
  clip_id: string;
  url: string;
  title: string;
  duration: number;
};

type KitItem = {
  clip_id: string;
  title: string;
  description: string;
  hashtags: string[];
  url: string;
};

type ExportResult = {
  export_id: string;
  status: string;
  output_urls?: OutputClip[];
  kit_publication?: KitItem[];
};

// ── Helpers ────────────────────────────────────────────────────────────────────
const HOOK_COLORS: Record<string, string> = {
  question: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  shock:    'bg-orange-500/20 text-orange-400 border-orange-500/30',
  laugh:    'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  fact:     'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  story:    'bg-violet-500/20 text-violet-400 border-violet-500/30',
  emotion:  'bg-pink-500/20 text-pink-400 border-pink-500/30',
};
const HOOK_ICONS: Record<string, string> = {
  question: '❓', shock: '😱', laugh: '😂', fact: '💡', story: '📖', emotion: '❤️',
};

function scoreColor(score: number) {
  if (score >= 90) return 'text-emerald-400';
  if (score >= 70) return 'text-yellow-400';
  return 'text-orange-400';
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

const FORMATS = [
  { id: '9:16',  label: '9:16', sublabel: 'TikTok • Reels',  icon: '📱' },
  { id: '16:9',  label: '16:9', sublabel: 'YouTube',          icon: '🖥️' },
  { id: '1:1',   label: '1:1',  sublabel: 'Insta carré',      icon: '⬜' },
];

// ── Composant ClipCard (sélection) ────────────────────────────────────────────
function ClipCard({
  clip, selected, onToggle, onPreview,
}: {
  clip: Clip; selected: boolean;
  onToggle: () => void; onPreview: (start: number) => void;
}) {
  const duration = clip.end_s - clip.start_s;
  const hookClass = HOOK_COLORS[clip.hook_type] || 'bg-gray-800 text-gray-400 border-gray-700';
  return (
    <div
      className={`relative flex flex-col sm:flex-row gap-3 p-4 rounded-2xl border transition-all cursor-pointer ${
        selected ? 'border-violet-500 bg-violet-950/20 shadow-lg shadow-violet-500/10'
                 : 'border-gray-800 bg-gray-900 hover:border-gray-700'}`}
      onClick={onToggle}
    >
      {/* Checkbox */}
      <div className={`absolute top-3 right-3 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
        selected ? 'border-violet-500 bg-violet-600' : 'border-gray-600'}`}>
        {selected && <span className="text-white text-[10px] font-bold">✓</span>}
      </div>

      {/* Score circulaire */}
      <div className="flex sm:flex-col items-center gap-2 shrink-0">
        <div className="relative w-12 h-12">
          <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15" fill="none" stroke="#374151" strokeWidth="3"/>
            <circle cx="18" cy="18" r="15" fill="none"
              stroke={clip.score >= 90 ? '#10b981' : clip.score >= 70 ? '#eab308' : '#f97316'}
              strokeWidth="3"
              strokeDasharray={`${clip.score * 0.942} 94.2`}
              strokeLinecap="round"/>
          </svg>
          <span className={`absolute inset-0 flex items-center justify-center text-xs font-bold ${scoreColor(clip.score)}`}>
            {clip.score}
          </span>
        </div>
      </div>

      {/* Contenu */}
      <div className="flex-1 min-w-0 pr-6">
        <div className="flex flex-wrap items-center gap-2 mb-1.5">
          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${hookClass}`}>
            {HOOK_ICONS[clip.hook_type]} {clip.hook_type}
          </span>
          <span className="text-[10px] text-gray-500">
            {formatTime(clip.start_s)} → {formatTime(clip.end_s)} ({duration.toFixed(0)}s)
          </span>
        </div>
        <p className="text-sm font-semibold text-white mb-1 line-clamp-1">{clip.title}</p>
        <p className="text-xs text-gray-400 mb-2 line-clamp-2">{clip.suggested_text}</p>
        {clip.hashtags?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {clip.hashtags.slice(0, 4).map((h) => (
              <span key={h} className="text-[10px] text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded-md">{h}</span>
            ))}
          </div>
        )}
      </div>

      {/* Aperçu */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onPreview(clip.start_s); }}
        className="shrink-0 self-center flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-700 hover:border-violet-500 hover:bg-violet-950/30 text-xs text-gray-400 hover:text-violet-300 transition-all"
      >
        ▶ Aperçu
      </button>
    </div>
  );
}

// ── Composant ResultCard (après export) ───────────────────────────────────────
function ResultCard({
  kit, onPlay, onCopy, copied,
}: {
  kit: KitItem; onPlay: (url: string) => void;
  onCopy: () => void; copied: boolean;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 hover:border-violet-700/50 rounded-2xl p-4 transition-all group">
      <div className="flex items-start gap-3">
        {/* Thumbnail / Play */}
        <button
          type="button"
          onClick={() => onPlay(kit.url)}
          className="shrink-0 w-16 h-16 rounded-xl bg-violet-950/50 border border-violet-800/40 flex items-center justify-center text-violet-400 hover:bg-violet-600 hover:text-white transition-all group-hover:scale-105"
        >
          <span className="text-xl">▶</span>
        </button>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white mb-1 line-clamp-1">{kit.title}</p>
          <p className="text-xs text-gray-400 line-clamp-2 mb-2">{kit.description}</p>
          <div className="flex flex-wrap gap-1">
            {kit.hashtags?.slice(0, 4).map((h) => (
              <span key={h} className="text-[9px] text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded">{h}</span>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2 shrink-0">
          <a
            href={kit.url}
            download
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs transition-colors"
            title="Télécharger"
          >
            ⬇
          </a>
          <button
            onClick={onCopy}
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white text-xs transition-colors"
            title="Copier texte"
          >
            {copied ? '✅' : '📋'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page éditeur ──────────────────────────────────────────────────────────────
export default function StudioEditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router        = useRouter();
  const { isAuthenticated, loading: authLoading } = useAuth();

  const [project,       setProject]       = useState<Project | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [selectedClips, setSelectedClips] = useState<Set<string>>(new Set());
  const [format,        setFormat]        = useState('9:16');
  const [exportState,   setExportState]   = useState<'idle' | 'exporting' | 'done' | 'error'>('idle');
  const [exportResult,  setExportResult]  = useState<ExportResult | null>(null);
  const [copiedIdx,     setCopiedIdx]     = useState<number | null>(null);
  const [playerUrl,     setPlayerUrl]     = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [isAuthenticated, authLoading, router]);

  const fetchProject = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await getStudioProject(projectId);
      setProject(data);
      if (data.status === 'ready' || data.status === 'error') {
        clearInterval(pollRef.current!);
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchProject();
    pollRef.current = setInterval(fetchProject, 3000);
    return () => clearInterval(pollRef.current!);
  }, [isAuthenticated, fetchProject]);

  // Quand le projet est prêt : initialiser le player + auto-sélection top 5
  useEffect(() => {
    if (project?.status === 'ready') {
      // Player sur la vidéo traduite Supabase si dispo, sinon source_url
      const vid = project.source_storage_url || project.source_url || null;
      setPlayerUrl(vid);

      if (project.clips?.length > 0 && selectedClips.size === 0) {
        const top5 = [...project.clips]
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((c) => c.id);
        setSelectedClips(new Set(top5));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.status, project?.source_storage_url]);

  function toggleClip(id: string) {
    setSelectedClips((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function autoSelectTop() {
    if (!project?.clips) return;
    const top5 = [...project.clips].sort((a, b) => b.score - a.score).slice(0, 5).map((c) => c.id);
    setSelectedClips(new Set(top5));
  }

  function previewAt(start: number) {
    if (!videoRef.current) return;
    videoRef.current.currentTime = start;
    videoRef.current.play().catch(() => {});
  }

  function playClip(url: string) {
    setPlayerUrl(url);
    // Un tick pour que le DOM mette à jour src, puis play
    setTimeout(() => {
      videoRef.current?.play().catch(() => {});
    }, 100);
  }

  async function handleExport() {
    if (!project || selectedClips.size === 0) return;
    setExportState('exporting');
    try {
      const res = await createStudioExport(project.id, {
        clip_ids: Array.from(selectedClips),
        format,
      });
      const poll = setInterval(async () => {
        try {
          const exp = await getStudioExport(res.export_id);
          if (exp.status === 'done') {
            clearInterval(poll);
            setExportResult(exp);
            setExportState('done');
          } else if (exp.status === 'error') {
            clearInterval(poll);
            setExportState('error');
          }
        } catch {
          clearInterval(poll);
          setExportState('error');
        }
      }, 4000);
    } catch {
      setExportState('error');
    }
  }

  async function copyKit(kit: KitItem, idx: number) {
    const text = `${kit.title}\n\n${kit.description}\n\n${kit.hashtags?.join(' ')}`;
    await navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  }

  // ── States de chargement ───────────────────────────────────────────────────
  if (authLoading || (loading && !project)) return (
    <main className="h-screen bg-gray-950 flex flex-col items-center justify-center gap-4">
      <svg className="animate-spin h-8 w-8 text-violet-500" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
      </svg>
      <p className="text-sm text-gray-400">Chargement du projet…</p>
    </main>
  );

  if (project?.status === 'analyzing' || project?.status === 'queued') return (
    <main className="h-screen bg-gray-950 flex flex-col items-center justify-center gap-6 text-center px-4">
      <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-3xl">🧠</div>
      <div>
        <h2 className="text-lg font-bold text-white mb-2">L'IA analyse ta vidéo…</h2>
        <p className="text-sm text-gray-400 max-w-sm">Détection des moments forts, scoring viral, génération des titres et hashtags. ~30-60s</p>
      </div>
      <div className="w-64 bg-gray-800 rounded-full h-2 overflow-hidden">
        <div className="h-2 rounded-full bg-gradient-to-r from-violet-600 to-pink-400 animate-pulse" style={{ width: '60%' }}/>
      </div>
    </main>
  );

  if (project?.status === 'error') return (
    <main className="h-screen bg-gray-950 flex flex-col items-center justify-center gap-4 text-center px-4">
      <div className="text-4xl">❌</div>
      <h2 className="text-lg font-bold text-white">Erreur d'analyse</h2>
      <p className="text-sm text-gray-400">{project.error_msg || 'Une erreur est survenue'}</p>
      <Link href="/studio" className="text-xs text-blue-400 underline">← Retour au Studio</Link>
    </main>
  );

  if (!project) return null;

  const sortedClips = [...(project.clips || [])].sort((a, b) => b.score - a.score);
  const totalDuration = Array.from(selectedClips)
    .map((id) => project.clips.find((c) => c.id === id))
    .filter(Boolean)
    .reduce((acc, c) => acc + (c!.end_s - c!.start_s), 0);

  // ── Phase résultats ────────────────────────────────────────────────────────
  const showResults = exportState === 'done' && exportResult?.kit_publication;

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-6xl mx-auto px-4 py-8">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-6">
          <Link href="/studio" className="hover:text-white transition-colors">✂️ Studio</Link>
          <span>/</span>
          <span className="text-gray-300 truncate max-w-xs">{project.source_title || project.source_url}</span>
        </div>

        <div className="grid lg:grid-cols-[1fr_340px] gap-8">

          {/* ── COLONNE GAUCHE ─────────────────────────────────────────────── */}
          <div className="space-y-5">

            {/* Player */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              {playerUrl ? (
                <video
                  ref={videoRef}
                  key={playerUrl}
                  src={playerUrl}
                  controls
                  className="w-full aspect-video bg-black"
                  preload="metadata"
                />
              ) : (
                <div className="aspect-video bg-gray-900 flex items-center justify-center text-gray-600 text-sm">
                  <div className="text-center">
                    <p className="text-2xl mb-2">🎬</p>
                    <p>Vidéo source non disponible pour la prévisualisation</p>
                    <p className="text-xs text-gray-700 mt-1">Utilise "Aperçu" sur un clip pour naviguer</p>
                  </div>
                </div>
              )}
            </div>

            {/* ── VUE SÉLECTION (avant export) ── */}
            {!showResults && (
              <>
                {/* Bloc conseil IA */}
                {project.ai_advice && (
                  <div className="bg-violet-950/20 border border-violet-500/20 rounded-2xl p-4 flex gap-3">
                    <span className="text-2xl shrink-0">🤖</span>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-violet-400 mb-1">Conseil IA</p>
                      <p className="text-sm text-gray-300 leading-relaxed">{project.ai_advice}</p>
                    </div>
                  </div>
                )}

                {/* Header clips */}
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-bold text-white">{sortedClips.length} moments forts détectés</h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {selectedClips.size} sélectionné{selectedClips.size > 1 ? 's' : ''} • {totalDuration.toFixed(0)}s total
                    </p>
                  </div>
                  <button
                    onClick={autoSelectTop}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 text-white text-xs font-bold transition-all shadow-lg shadow-violet-500/20"
                  >
                    ⚡ Auto TikTok Mode
                  </button>
                </div>

                {/* Liste clips */}
                <div className="space-y-3">
                  {sortedClips.map((clip) => (
                    <ClipCard
                      key={clip.id}
                      clip={clip}
                      selected={selectedClips.has(clip.id)}
                      onToggle={() => toggleClip(clip.id)}
                      onPreview={previewAt}
                    />
                  ))}
                </div>
              </>
            )}

            {/* ── VUE RÉSULTATS (après export) ── */}
            {showResults && (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">✅</span>
                    <div>
                      <h2 className="text-base font-bold text-white">
                        {exportResult!.kit_publication!.length} clip{exportResult!.kit_publication!.length > 1 ? 's' : ''} prêts !
                      </h2>
                      <p className="text-xs text-gray-500">Clique sur ▶ pour prévisualiser dans le lecteur</p>
                    </div>
                  </div>
                  <button
                    onClick={() => { setExportState('idle'); setExportResult(null); }}
                    className="text-xs text-gray-500 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    ← Retour aux clips
                  </button>
                </div>

                <div className="space-y-3">
                  {exportResult!.kit_publication!.map((kit, idx) => (
                    <ResultCard
                      key={kit.clip_id}
                      kit={kit}
                      onPlay={playClip}
                      onCopy={() => copyKit(kit, idx)}
                      copied={copiedIdx === idx}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ── COLONNE DROITE : Export panel ─────────────────────────────── */}
          <div className="lg:sticky lg:top-20 h-fit space-y-4">

            {/* Format */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4">Format d'export</h3>
              <div className="grid grid-cols-3 gap-2">
                {FORMATS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFormat(f.id)}
                    disabled={exportState !== 'idle'}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-all disabled:opacity-40 ${
                      format === f.id
                        ? 'border-violet-500 bg-violet-950/30 text-violet-300'
                        : 'border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-300'}`}
                  >
                    <span className="text-lg">{f.icon}</span>
                    <span className="text-xs font-bold">{f.label}</span>
                    <span className="text-[9px] leading-tight opacity-70">{f.sublabel}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Récap */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Récapitulatif</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Clips sélectionnés</span>
                  <span className="text-white font-semibold">{selectedClips.size}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Durée totale</span>
                  <span className="text-white font-semibold">{totalDuration.toFixed(0)}s</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Format</span>
                  <span className="text-white font-semibold">{format}</span>
                </div>
              </div>
            </div>

            {/* CTA Export */}
            {exportState === 'idle' && (
              <button
                onClick={handleExport}
                disabled={selectedClips.size === 0}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm transition-all shadow-lg shadow-violet-500/20"
              >
                🚀 Générer {selectedClips.size} clip{selectedClips.size > 1 ? 's' : ''}
              </button>
            )}

            {exportState === 'exporting' && (
              <div className="w-full flex flex-col items-center gap-3 px-6 py-5 rounded-2xl bg-violet-950/30 border border-violet-500/30">
                <svg className="animate-spin h-6 w-6 text-violet-400" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                <p className="text-sm font-semibold text-violet-300">Rendu des clips en cours…</p>
                <p className="text-xs text-gray-500">Découpe FFmpeg + upload Supabase</p>
              </div>
            )}

            {exportState === 'error' && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-center space-y-2">
                <p className="text-red-400 text-sm">❌ Erreur lors du rendu</p>
                <p className="text-xs text-gray-600">Vérifie que Supabase est configuré</p>
                <button onClick={() => setExportState('idle')} className="text-xs text-gray-500 hover:text-white underline">
                  Réessayer
                </button>
              </div>
            )}

            {exportState === 'done' && (
              <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-2xl p-4 text-center">
                <p className="text-emerald-400 text-sm font-bold mb-1">
                  ✅ {exportResult?.output_urls?.length} clip{(exportResult?.output_urls?.length || 0) > 1 ? 's' : ''} générés
                </p>
                <p className="text-xs text-gray-500">Voir les résultats dans la colonne gauche</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
