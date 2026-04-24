import { useState, useCallback } from 'react';
import { LiveJobProgress } from './LiveJobProgress';
import { VideoPlayerWithOverlay } from './VideoPlayerWithOverlay';
import { LiveTranscriptionPanel } from './LiveTranscriptionPanel';
import { SubtitleEditor } from './SubtitleEditor';

export function Home() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [isEditing, setIsEditing] = useState(false);

  const reset = () => {
    setJobId(null);
    setStatus(null);
    setIsEditing(false);
  };

  const download = useCallback(async () => {
    if (!jobId) return;
    
    try {
      const response = await fetch(`/api/jobs/${jobId}/download`);
      if (!response.ok) throw new Error(`Erreur ${response.status}: ${response.statusText}`);
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `traduction-${jobId.slice(0, 8)}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Erreur de téléchargement:', error);
      // TODO: Ajouter notification toast ici
      alert('Erreur lors du téléchargement. Veuillez réessayer.');
    }
  }, [jobId]);

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* En-tête */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-100">Studio de Post-Production</h1>
          <p className="text-gray-400 mt-1">Édition live de vidéos avec transcription et traduction</p>
        </div>

        {/* Zone de sélection / reset */}
        {jobId && (
          <div className="mb-4 flex items-center justify-between bg-gray-800 p-3 rounded-lg">
            <div>
              <div className="text-sm text-gray-400">Job ID</div>
              <div className="text-sm font-mono text-cyan-400">{jobId}</div>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={reset}
                className="px-3 py-1 text-sm text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
              >
                Nouvelle Traduction
              </button>
              <button
                onClick={download}
                className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                Télécharger
              </button>
            </div>
          </div>
        )}

        {/* Composant principal */}
        <LiveJobProgress
          jobId={jobId!}
          status={status}
          onReset={reset}
          onDownload={download}
        />
      </div>
    </div>
  );
};