"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/useAuth';
import { getJobStatus, getTranscriptionSegments, exportClips } from '@/lib/api';
import { SubtitleEditor } from '@/components/job/SubtitleEditor';
import type { TimelineSegment } from '@/components/job/types';

// ── Formatages ─────────────────────────────────────────────────────────────────
function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

const FORMATS = [
  { id: '16:9',  label: '16:9', sublabelKey: 'formatYoutube',     icon: '🖥️' },
  { id: '9:16',  label: '9:16',  sublabelKey: 'formatTikTok',     icon: '📱' },
  { id: '1:1',   label: '1:1',   sublabelKey: 'formatInsta',      icon: '⬜' },
];

export default function JobEditorPage() {
  const t = useTranslations('JobEditor');
  const { jobId } = useParams<{ jobId: string }>();
  const router    = useRouter();
  const { isAuthenticated, loading: authLoading } = useAuth();

  // ── États ──────────────────────────────────────────────────────────────────
  const [segments,    setSegments]    = useState<TimelineSegment[]>([]);
  const [duration,    setDuration]    = useState(0);
  const [videoUrl,    setVideoUrl]    = useState<string | null>(null);
  const [jobStatus,   setJobStatus]   = useState<string | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);

  // Export
  const [exportFormat,  setExportFormat]  = useState('16:9');
  const [exportConcat,  setExportConcat]  = useState(true);
  const [exportState,   setExportState]   = useState<'idle' | 'exporting' | 'done' | 'error'>('idle');
  const [exportResult,  setExportResult]  = useState<any>(null);

  // Sync vidéo
  const [currentTime, setCurrentTime] = useState(0);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // ── Auth guard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [isAuthenticated, authLoading, router]);

  // ── Charger les données ────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!jobId) return;
    try {
      const statusData = await getJobStatus(jobId);
      setJobStatus(statusData.status);

      if (statusData.storage_url) {
        const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
        setVideoUrl(`${base}${statusData.storage_url}`);
        setDuration(statusData.duration_s || 0);
      }

      setLoading(false);
    } catch (err: any) {
      setError(err?.message || 'Erreur de chargement');
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchData();
  }, [isAuthenticated, fetchData]);

  // ── Synchronisation vidéo → SubtitleEditor (via refs) ────────────────────
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleSeekVideo = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
  };

  // ── Export (utilise les segments mis à jour par SubtitleEditor) ────────────
  const handleExport = async () => {
    if (!jobId || segments.length === 0) return;
    const segIds = segments.map(s => s.id);
    setExportState('exporting');
    try {
      const result = await exportClips(jobId, segIds, {
        format: exportFormat,
        concat: exportConcat,
      });
      setExportResult(result);
      setExportState('done');
      const pluralS = result.clip_count > 1 ? 's' : '';
      showToast(t('toastClipExported', { count: result.clip_count, s: pluralS }));
    } catch (err) {
      setExportState('error');
      showToast(t('toastExportError'));
    }
  };

  // ── Téléchargement ─────────────────────────────────────────────────────────
  const handleDownload = async (url: string, filename: string) => {
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(url, '_blank');
    }
  };

  // ── Toast simple ──────────────────────────────────────────────────────────
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // ── Raccourcis clavier ─────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === ' ' && videoRef.current) {
        e.preventDefault();
        if (videoRef.current.paused) {
          videoRef.current.play();
        } else {
          videoRef.current.pause();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (authLoading || loading) {
    return (
      <main className="h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-violet-500 mx-auto mb-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          <p className="text-sm text-gray-400">{t('loading')}</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-red-400">❌ {error}</p>
          <Link href="/" className="text-blue-400 underline text-sm">{t('errorBackHome')}</Link>
        </div>
      </main>
    );
  }

  if (!jobId) return null;

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-xl bg-gray-900 border border-gray-700 shadow-2xl text-sm animate-fade-in">
          {toast}
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Link href="/" className="hover:text-white transition-colors">{t('breadcrumbHome')}</Link>
          <span>/</span>
          <span className="text-gray-300">{t('breadcrumbEditor', { id: jobId.slice(0, 8) })}</span>
          <span className="ml-auto">
            <Link href="/library" className="text-blue-400 hover:text-blue-300 underline">{t('breadcrumbLibrary')}</Link>
          </span>
        </div>

        {/* ── 1. LECTEUR VIDÉO ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          {videoUrl ? (
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              className="w-full aspect-video bg-black"
              preload="metadata"
              onTimeUpdate={handleTimeUpdate}
              onPlay={() => setIsVideoPlaying(true)}
              onPause={() => setIsVideoPlaying(false)}
            />
          ) : (
            <div className="aspect-video bg-gray-900 flex items-center justify-center text-gray-600 text-sm">
              <div className="text-center">
                <p className="text-2xl mb-2">🎬</p>
                <p>{t('videoNotAvailable')}</p>
              </div>
            </div>
          )}
        </div>

        {/* ── 2. STUDIO D'ÉDITION (SubtitleEditor avec timeline intégrée) ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="px-5 pt-5 pb-2 border-b border-gray-800">
            <h2 className="text-lg font-bold text-white">{t('studioTitle')}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{t('studioDesc')}</p>
          </div>
          <div className="p-1">
            <SubtitleEditor
              jobId={jobId}
              currentVideoTime={currentTime}
              isVideoPlaying={isVideoPlaying}
              onSeekVideo={handleSeekVideo}
              initialSegments={duration > 0 ? segments : undefined}
            />
          </div>
        </div>

        {/* ── 3. PANEL EXPORT ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-white">{t('exportTitle')}</h3>

          {/* Format */}
          <div className="flex gap-2">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                onClick={() => setExportFormat(f.id)}
                disabled={exportState === 'exporting'}
                className={`flex flex-col items-center gap-1 p-3 rounded-xl border text-center transition-all disabled:opacity-40 ${
                  exportFormat === f.id
                    ? 'border-violet-500 bg-violet-950/30 text-violet-300'
                    : 'border-gray-700 text-gray-500 hover:border-gray-600'
                }`}
              >
                <span className="text-lg">{f.icon}</span>
                <span className="text-xs font-bold">{f.label}</span>
                <span className="text-[9px] opacity-70">{t(f.sublabelKey)}</span>
              </button>
            ))}
          </div>

          {/* Concat toggle */}
          <label className="flex items-center gap-2 text-sm text-gray-400">
            <input
              type="checkbox"
              checked={exportConcat}
              onChange={(e) => setExportConcat(e.target.checked)}
              disabled={exportState === 'exporting'}
              className="rounded"
            />
            {t('exportConcatLabel')}
          </label>

          {/* Bouton export */}
          {exportState === 'idle' && (
            <button
              onClick={handleExport}
              disabled={segments.length === 0}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm transition-all"
            >
              {t('exportButton', { count: segments.length, s: segments.length > 1 ? 's' : '' })}
            </button>
          )}

          {exportState === 'exporting' && (
            <div className="flex items-center justify-center gap-3 py-3 text-violet-300">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              <span className="text-sm font-semibold">{t('exportProgress')}</span>
            </div>
          )}

          {exportState === 'error' && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-center">
              <p className="text-red-400 text-sm mb-2">{t('exportError')}</p>
              <button onClick={() => setExportState('idle')} className="text-xs text-gray-500 hover:text-white underline">
                {t('exportRetry')}
              </button>
            </div>
          )}

          {exportState === 'done' && exportResult && (
            <div className="space-y-3">
              <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-xl p-3 text-center">
                <p className="text-emerald-400 text-sm font-bold mb-1">
                  {t('exportDone', { count: exportResult.clip_count, s: exportResult.clip_count > 1 ? 's' : '' })}
                </p>
                {exportResult.concat_url && (
                  <p className="text-xs text-gray-500">{t('exportConcatAvailable')}</p>
                )}
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto">
                {exportResult.clips?.map((clip: any, idx: number) => (
                  <div key={clip.segment_id || idx} className="flex items-center justify-between bg-gray-800/50 rounded-xl p-3">
                    <div>
                      <p className="text-xs font-medium text-white">
                        {t('clipLabel', { n: idx + 1 })} • {formatTime(clip.start_s)} → {formatTime(clip.end_s)}
                      </p>
                      <p className="text-xs text-gray-500">{clip.duration?.toFixed(1)}s</p>
                    </div>
                    {clip.url && (
                      <button
                        onClick={() => handleDownload(clip.url, `clip_${idx + 1}.mp4`)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs transition-colors"
                      >
                        {t('clipDownload')}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {exportResult.concat_url && (
                <button
                  onClick={() => handleDownload(exportResult.concat_url, 'concat.mp4')}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-cyan-700 hover:bg-cyan-600 text-white text-sm font-semibold transition-colors"
                >
                  {t('concatDownload')}
                </button>
              )}

              <button
                onClick={() => { setExportState('idle'); setExportResult(null); }}
                className="w-full text-xs text-gray-500 hover:text-white underline py-2"
              >
                {t('backToEditor')}
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}