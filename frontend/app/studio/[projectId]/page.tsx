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
  source_title?: string;
  status: string;
  error_msg?: string;
  clips: Clip[];
};

type ExportResult = {
  export_id: string;
  status: string;
  output_urls?: Array<{ clip_id: string; url: string; title: string; duration: number }>;
  kit_publication?: Array<{ clip_id: string; title: string; description: string; hashtags: string[]; url: string }>;
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

function scoreBg(score: number) {
  if (score >= 90) return 'bg-emerald-500';
  if (score >= 70) return 'bg-yellow-500';
  return 'bg-orange-500';
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

const FORMATS = [
  { id: '9:16',  label: '9:16', sublabel: 'TikTok • Reels • Shorts', icon: '📱' },
  { id: '16:9',  label: '16:9', sublabel: 'YouTube',                 icon: '🖥️' },
  { id: '1:1',   label: '1:1',  sublabel: 'Instagram carré',          icon: '⬜' },
];

// ── Composant ClipCard ────────────────────────────────────────────────────────
function ClipCard({
  clip,
  selected,
  onToggle,
  onPreview,
}: {
  clip: Clip;
  selected: boolean;
  onToggle: () => void;
  onPreview: (start: number) => void;
}) {
  const duration = clip.end_s - clip.start_s;
  const hookClass = HOOK_COLORS[clip.hook_type] || 'bg-gray-800 text-gray-400 border-gray-700';

  return (
    <div
      className={`relative flex flex-col sm:flex-row gap-3 p-4 rounded-2xl border transition-all cursor-pointer ${
        selected
          ? 'border-violet-500 bg-violet-950/20 shadow-lg shadow-violet-500/10'
          : 'border-gray-800 bg-gray-900 hover:border-gray-700'
      }`}
      onClick={onToggle}
    >
      {/* Checkbox */}
      <div className={`absolute top-3 right-3 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
        selected ? 'border-violet-500 bg-violet-600' : 'border-gray-600'
      }`}>
        {selected && <span className="text-white text-[10px] font-bold">✓</span>}
      </div>

      {/* Score bar */}
      <div className="flex sm:flex-col items-center sm:items-center gap-2 sm:gap-1 shrink-0">
        <div className="relative w-12 h-12 shrink-0">
          <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15" fill="none" stroke="#374151" strokeWidth="3"/>
            <circle
              cx="18" cy="18" r="15" fill="none"
              stroke={clip.score >= 90 ? '#10b981' : clip.score >= 70 ? '#eab308' : '#f97316'}
              strokeWidth="3"
              strokeDasharray={`${clip.score * 0.942} 94.2`}
              strokeLinecap="round"
            />
          </svg>
          <span className={`absolute inset-0 flex items-center justify-center text-xs font-bold ${scoreColor(clip.score)}`}>
            {clip.score}
          </span>
        </div>
        <span className="text-[10px] text-gray-600 hidden sm:block">score</span>
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

        {/* Hashtags */}
        {clip.hashtags?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {clip.hashtags.slice(0, 4).map((h) => (
              <span key={h} className="text-[10px] text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded-md">{h}</span>
            ))}
          </div>
        )}
      </div>

      {/* Bouton Aperçu */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onPreview(clip.start_s); }}
        className="shrink-0 self-center sm:self-start mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-700 hover:border-violet-500 hover:bg-violet-950/30 text-xs text-gray-400 hover:text-violet-300 transition-all"
      >
        <span>▶</span> Aperçu
      </button>
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
  const [format,        setFormat]        = useState<string>('9:16');
  const [exportState,   setExportState]   = useState<'idle' | 'exporting' | 'done' | 'error'>('idle');
  const [exportResult,  setExportResult]  = useState<ExportResult | null>(null);
  const [copiedIdx,     setCopiedIdx]     = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auth guard
  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [isAuthenticated, authLoading, router]);

  // Charger le projet + polling si en cours
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

  // Sélectionne auto les 5 meilleurs clips au chargement
  useEffect(() => {
    if (project?.status === 'ready' && project.clips?.length > 0 && selectedClips.size === 0) {
      const top5 = [...project.clips]
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((c) => c.id);
      setSelectedClips(new Set(top5));
    }
  }, [project?.status, project?.clips]);

  function toggleClip(id: string) {
    setSelectedClips((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function autoSelectTop() {
    if (!project?.clips) return;
    const top5 = [...project.clips]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((c) => c.id);
    setSelectedClips(new Set(top5));
  }

  function previewAt(start: number) {
    if (!videoRef.current || !project?.source_url) return;
    videoRef.current.currentTime = start;
    videoRef.current.play();
  }

  async function handleExport() {
    if (!project || selectedClips.size === 0) return;
    setExportState('exporting');
    try {
      const res = await createStudioExport(project.id, {
        clip_ids: Array.from(selectedClips),
        format,
      });
      // Polling export
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

  async function copyText(text: string, idx: number) {
    await navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  }

  if (authLoading || (loading && !project)) return (
    <main className="h-screen bg-gray-950 flex flex-col items-center justify-center gap-4">
      <svg className="animate-spin h-8 w-8 text-violet-500" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
      </svg>
      <p className="text-sm text-gray-400">Chargement du projet…</p>
    </main>
  );

  // ── État : analyse en cours ───────────────────────────────────────────────
  if (project?.status === 'analyzing' || project?.status === 'queued') return (
    <main className="h-screen bg-gray-950 flex flex-col items-center justify-center gap-6 text-center px-4">
      <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-3xl">
        🧠
      </div>
      <div>
        <h2 className="text-lg font-bold text-white mb-2">L'IA analyse ta vidéo…</h2>
        <p className="text-sm text-gray-400 max-w-sm">
          Détection des moments forts, scoring viral, génération des titres et hashtags. Cela prend environ 30 à 60 secondes.
        </p>
      </div>
      <div className="w-64 bg-gray-800 rounded-full h-2 overflow-hidden">
        <div className="h-2 rounded-full bg-gradient-to-r from-violet-600 to-pink-400 animate-pulse" style={{ width: '60%' }} />
      </div>
      <p className="text-xs text-gray-600">Mise à jour automatique…</p>
    </main>
  );

  // ── État : erreur ─────────────────────────────────────────────────────────
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

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-6xl mx-auto px-4 py-8">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-6">
          <Link href="/studio" className="hover:text-white transition-colors">✂️ Studio</Link>
          <span>/</span>
          <span className="text-gray-300 truncate max-w-xs">
            {project.source_title || project.source_url}
          </span>
        </div>

        <div className="grid lg:grid-cols-[1fr_340px] gap-8">

          {/* ── COLONNE GAUCHE : Player + clips ──────────────────────────────── */}
          <div className="space-y-6">

            {/* Player */}
            {project.source_url && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <video
                  ref={videoRef}
                  src={project.source_url}
                  controls
                  className="w-full aspect-video bg-black"
                  preload="metadata"
                />
              </div>
            )}

            {/* Header clips + Auto TikTok Mode */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white">
                  {sortedClips.length} moments forts détectés
                </h2>
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

            {/* Liste des clips */}
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
          </div>

          {/* ── COLONNE DROITE : Export panel ─────────────────────────────────── */}
          <div className="lg:sticky lg:top-20 h-fit space-y-4">

            {/* Format */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4">Format d'export</h3>
              <div className="grid grid-cols-3 gap-2">
                {FORMATS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFormat(f.id)}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-all ${
                      format === f.id
                        ? 'border-violet-500 bg-violet-950/30 text-violet-300'
                        : 'border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-300'
                    }`}
                  >
                    <span className="text-lg">{f.icon}</span>
                    <span className="text-xs font-bold">{f.label}</span>
                    <span className="text-[9px] leading-tight opacity-70">{f.sublabel}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Résumé sélection */}
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

            {/* Bouton d'export */}
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
                <p className="text-xs text-gray-500">Découpe FFmpeg + reformatage {format}</p>
              </div>
            )}

            {exportState === 'error' && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-center">
                <p className="text-red-400 text-sm mb-2">❌ Erreur lors du rendu</p>
                <button onClick={() => setExportState('idle')} className="text-xs text-gray-500 hover:text-white underline">
                  Réessayer
                </button>
              </div>
            )}

            {/* Résultat export */}
            {exportState === 'done' && exportResult?.kit_publication && (
              <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-2xl p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 text-lg">✅</span>
                  <p className="text-sm font-bold text-emerald-300">
                    {exportResult.output_urls?.length} clip{(exportResult.output_urls?.length || 0) > 1 ? 's' : ''} prêts !
                  </p>
                </div>

                {exportResult.kit_publication.map((kit, idx) => (
                  <div key={kit.clip_id} className="bg-gray-900 border border-gray-800 rounded-xl p-3 space-y-2">
                    <p className="text-xs font-bold text-white">{kit.title}</p>
                    <p className="text-[10px] text-gray-400 line-clamp-2">{kit.description}</p>
                    <div className="flex flex-wrap gap-1">
                      {kit.hashtags?.slice(0, 4).map((h) => (
                        <span key={h} className="text-[9px] text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded">{h}</span>
                      ))}
                    </div>
                    <div className="flex gap-2 pt-1">
                      {kit.url && (
                        <a
                          href={kit.url}
                          download
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors"
                        >
                          ⬇️ Télécharger
                        </a>
                      )}
                      <button
                        onClick={() => copyText(
                          `${kit.title}\n\n${kit.description}\n\n${kit.hashtags?.join(' ')}`,
                          idx
                        )}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white text-xs transition-colors"
                      >
                        {copiedIdx === idx ? '✅ Copié' : '📋 Copier'}
                      </button>
                    </div>
                  </div>
                ))}

                <button
                  onClick={() => { setExportState('idle'); setExportResult(null); }}
                  className="w-full text-xs text-gray-600 hover:text-gray-400 transition-colors py-1"
                >
                  Exporter d'autres clips
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
