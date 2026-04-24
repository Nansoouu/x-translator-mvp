'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { VideoPlayerWithOverlay } from '../job/VideoPlayerWithOverlay';
import { LiveTranscriptionPanel } from '../job/LiveTranscriptionPanel';
import { SubtitleEditor } from '../job/SubtitleEditor';
import { SubtitleSegment } from '../job/types';
import { Download, RotateCcw, Eye, Edit3, Save, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';

interface StudioContainerProps {
  jobId: string;
  status: any;
  onReset: () => void;
  onDownload?: () => void;
}

type EditedSegmentType = {
  id: string;
  translation: string;
  startTime: number;
  endTime: number;
};

export default function StudioContainer({
  jobId,
  status,
  onReset,
  onDownload,
}: StudioContainerProps) {
  const { isAuthenticated, token } = useAuth();
  const { showSuccess, showError } = useToast();
  
  // Variables dérivées du statut
  const isDone = status?.status === 'done';
  const isRendering = ['burning', 'uploading'].includes(status?.status || '');
  const videoSrc = status?.storage_url;
  const thumbnail = status?.thumbnail_url;
  
  const [activeTab, setActiveTab] = useState<'preview' | 'editor'>(isDone ? 'editor' : 'preview');
  const [segments, setSegments] = useState<SubtitleSegment[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<SubtitleSegment | null>(null);
  const [editedSegment, setEditedSegment] = useState<EditedSegmentType | null>(null);
  const [saving, setSaving] = useState(false);
  const [currentVideoTime, setCurrentVideoTime] = useState(0);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleTimeUpdate = (time: number) => setCurrentVideoTime(time);
  const handlePlayStateChange = (playing: boolean) => setIsVideoPlaying(playing);
  const handleSeekTo = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentVideoTime(time);
    }
  };

  // Récupération réelle des segments traduits
  useEffect(() => {
    if (!isDone || !jobId) return;

    const fetchSegments = async () => {
      try {
        const headers: HeadersInit = {
          'Content-Type': 'application/json',
        };
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }

        const response = await fetch(`/api/jobs/${jobId}/translate`, {
          headers,
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const data = await response.json();
        if (data.segments && Array.isArray(data.segments)) {
          setSegments(data.segments);
        }
      } catch (err) {
        console.error('Erreur récupération segments:', err);
      }
    };

    fetchSegments();
  }, [isDone, jobId, token]);

  // Mettre à jour editedSegment quand selectedSegment change
  useEffect(() => {
    if (selectedSegment) {
      setEditedSegment({
        id: selectedSegment.id,
        translation: selectedSegment.translation || selectedSegment.text,
        startTime: selectedSegment.startTime,
        endTime: selectedSegment.endTime,
      });
    } else {
      setEditedSegment(null);
    }
  }, [selectedSegment]);

  // Fonction de sauvegarde d'un segment
  const handleSaveSegment = async () => {
    if (!editedSegment || !selectedSegment) return;
    
    setSaving(true);
    try {
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      
      // Note: L'endpoint backend doit être créé
      const response = await fetch(
        `/api/jobs/${jobId}/segments/${editedSegment.id}`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            translation: editedSegment.translation,
            start_time: editedSegment.startTime,
            end_time: editedSegment.endTime,
          }),
        }
      );
      
      if (!response.ok) {
        throw new Error(`Erreur sauvegarde: HTTP ${response.status}`);
      }
      
      // Mettre à jour les segments locaux
      setSegments(prev => prev.map(seg => 
        seg.id === editedSegment.id ? { 
          ...seg, 
          translation: editedSegment.translation,
          startTime: editedSegment.startTime,
          endTime: editedSegment.endTime 
        } : seg
      ));
      
      showSuccess('Segment enregistré avec succès');
    } catch (err) {
      console.error('Erreur sauvegarde segment:', err);
      showError('Erreur lors de l\'enregistrement du segment');
    } finally {
      setSaving(false);
    }
  };

  // Fonction pour mettre à jour un champ édité
  const handleFieldChange = (field: keyof EditedSegmentType, value: string | number) => {
    if (!editedSegment) return;
    setEditedSegment(prev => prev ? { ...prev, [field]: value } : null);
  };

  // Durée formatée
  const formattedDuration = useMemo(() => {
    if (!status?.duration_s) return '—';
    const min = Math.floor(status.duration_s / 60);
    const sec = Math.floor(status.duration_s % 60);
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }, [status?.duration_s]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-4xl font-bold text-white tracking-tight">Studio de traduction</h1>
          <p className="text-gray-400 mt-1">
            {isDone ? 'Vidéo terminée • Sous-titres synchronisés' : 'Traitement en cours...'}
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onReset}
            className="flex items-center gap-2 px-5 py-3 bg-gray-800 hover:bg-gray-700 rounded-2xl transition-colors"
          >
            <RotateCcw className="w-5 h-5" />
            Nouvelle vidéo
          </button>

          {isDone && onDownload && (
            <button
              onClick={onDownload}
              className="flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-2xl font-semibold transition-colors"
            >
              <Download className="w-5 h-5" />
              Télécharger la vidéo
            </button>
          )}
        </div>
      </div>

      {/* VIDÉO PLEINE LARGEUR */}
      <div className="w-full">
        <VideoPlayerWithOverlay
          jobId={jobId}
          src={videoSrc}
          thumbnail={thumbnail}
          previewSegments={segments}
          isRendering={isRendering}
          isDone={isDone}
          onTimeUpdate={handleTimeUpdate}
          onPlayStateChange={handlePlayStateChange}
        />
      </div>

      {/* ONGLETS STUDIO PRO - 100% LARGEUR */}
      <div className="flex border-b border-gray-800">
        <button
          onClick={() => setActiveTab('preview')}
          className={`flex-1 px-8 py-4 font-medium flex items-center justify-center gap-3 border-b-2 transition-all ${
            activeTab === 'preview'
              ? 'border-blue-500 text-white bg-gradient-to-r from-blue-900/30 to-blue-800/20'
              : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-900/30'
          }`}
        >
          <Eye className="w-5 h-5" />
          <span className="text-lg">Prévisualisation</span>
          <span className="text-xs bg-gray-800 px-2 py-1 rounded-full">Vidéo + Transcription</span>
        </button>
        <button
          onClick={() => setActiveTab('editor')}
          className={`flex-1 px-8 py-4 font-medium flex items-center justify-center gap-3 border-b-2 transition-all ${
            activeTab === 'editor'
              ? 'border-cyan-500 text-white bg-gradient-to-r from-cyan-900/30 to-blue-800/20'
              : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-900/30'
          }`}
        >
          <Edit3 className="w-5 h-5" />
          <span className="text-lg">Studio d'édition</span>
          <span className="text-xs bg-gray-800 px-2 py-1 rounded-full">Timeline + Outils</span>
        </button>
      </div>

      {/* CONTENU SELON ONGLET */}
      <div className="space-y-12">
        {activeTab === 'preview' ? (
          // MODE PRÉVISUALISATION
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
            {/* Transcription live à droite */}
            <div className="lg:col-span-1">
              <LiveTranscriptionPanel jobId={jobId} />
            </div>
            {/* Timeline basique au centre */}
            <div className="lg:col-span-2">
              {isDone && segments.length > 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-3xl p-8">
                  <div className="flex items-center justify-between mb-8">
                    <h3 className="text-xl font-semibold">Timeline des sous-titres</h3>
                    <span className="text-sm text-gray-500">{segments.length} segments</span>
                  </div>
                  <div className="relative h-40 bg-gray-950 border border-gray-800 rounded-2xl p-6 overflow-hidden">
                    {/* Timeline basique - réutiliser la timeline existante */}
                    <div className="relative h-full">
                      {/* Barre de temps */}
                      <div className="absolute top-4 left-8 right-8 h-px bg-gray-700" />
                      
                      {segments.map((seg, index) => {
                        const total = status?.duration_s || 120;
                        const left = (seg.startTime / total) * 100;
                        const width = ((seg.endTime - seg.startTime) / total) * 100;
                        const isActive = currentVideoTime >= seg.startTime && currentVideoTime <= seg.endTime;
                        
                        return (
                          <div
                            key={seg.id || index}
                            className={`absolute top-1/2 -translate-y-1/2 h-12 border rounded-xl cursor-pointer flex items-center px-4 transition-all ${
                              isActive 
                                ? 'bg-gradient-to-r from-blue-700 to-cyan-600 ring-2 ring-white/40' 
                                : 'bg-gradient-to-r from-blue-600/70 to-cyan-500/70 hover:brightness-110'
                            }`}
                            style={{ left: `${left}%`, width: `${width}%` }}
                            onClick={() => {
                              handleSeekTo(seg.startTime);
                              setSelectedSegment(seg);
                            }}
                          >
                            <div className="text-sm text-white truncate font-medium">
                              {seg.translation || seg.text}
                            </div>
                          </div>
                        );
                      })}
                      
                      {/* Curseur temps dynamique */}
                      <motion.div 
                        className="absolute top-0 bottom-0 w-1 bg-red-500 pointer-events-none"
                        style={{ 
                          left: `${(currentVideoTime / (status?.duration_s || 120)) * 100}%` 
                        }}
                        transition={{ type: "spring", damping: 25, stiffness: 200 }}
                      >
                        <div className="absolute -top-2 -left-2 w-4 h-4 bg-red-500 rounded-full ring-2 ring-red-500/30" />
                      </motion.div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          // MODE STUDIO D'ÉDITION - 100% LARGEUR AVEC PLUS D'ESPACE
          <div className="space-y-10">
            {/* Éditeur de timeline pleine largeur */}
            {isDone && (
              <div className="bg-gray-900 border border-gray-800 rounded-3xl p-8">
                <SubtitleEditor 
                  jobId={jobId}
                  currentVideoTime={currentVideoTime}
                  isVideoPlaying={isVideoPlaying}
                  onSeekVideo={handleSeekTo}
                  initialSegments={segments}
                />
              </div>
            )}
            
            {/* Transcription live en bas - DESIGN HORIZONTAL */}
            <div className="bg-gray-900 border border-gray-800 rounded-3xl p-8">
              <div className="mb-6">
                <h3 className="text-xl font-semibold">Transcription & Traduction</h3>
                <p className="text-sm text-gray-400 mt-1">Texte original et traductions synchronisées</p>
              </div>
              <LiveTranscriptionPanel jobId={jobId} />
            </div>
          </div>
        )}
      </div>

      {/* TIMELINE BASIQUE */}
      {isDone && segments.length > 0 && (
        <div className="mt-12">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-semibold">Timeline des sous-titres</h3>
            <span className="text-sm text-gray-500">{segments.length} segments</span>
          </div>

          <div className="relative h-40 bg-gray-950 border border-gray-800 rounded-3xl p-6 overflow-hidden">
            <div className="relative h-full">
              {/* Barre de temps */}
              <div className="absolute top-2 left-6 right-6 h-px bg-gray-700" />

              {segments.map((seg, index) => {
                const total = status?.duration_s || 120;
                const left = (seg.startTime / total) * 100;
                const width = ((seg.endTime - seg.startTime) / total) * 100;

                const isActive = currentVideoTime >= seg.startTime && currentVideoTime <= seg.endTime;
                return (
                  <div
                    key={seg.id || index}
                    className={`absolute top-1/2 -translate-y-1/2 h-14 border rounded-xl cursor-pointer flex items-center px-4 transition-all ${
                      isActive 
                        ? 'bg-gradient-to-r from-blue-700 to-cyan-600 ring-2 ring-white/40' 
                        : 'bg-gradient-to-r from-blue-600/70 to-cyan-500/70 hover:brightness-110'
                    }`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    onClick={() => {
                      handleSeekTo(seg.startTime);
                      setSelectedSegment(seg);
                    }}
                  >
                    <div className="text-xs text-white truncate font-medium">
                      {seg.translation || seg.text}
                    </div>
                  </div>
                );
              })}

              {/* Curseur temps dynamique */}
              <motion.div 
                className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none"
                style={{ 
                  left: `${(currentVideoTime / (status?.duration_s || 120)) * 100}%` 
                }}
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
              >
                <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-red-500 rounded-full ring-2 ring-red-500/30" />
              </motion.div>
            </div>
          </div>

          {/* Édition rapide du segment sélectionné */}
          {selectedSegment && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 p-6 bg-gray-900 border border-gray-700 rounded-3xl"
            >
              <div className="flex justify-between items-center mb-4">
                <h4 className="font-semibold">Segment sélectionné</h4>
                <button onClick={() => setSelectedSegment(null)} className="text-gray-400 hover:text-white">
                  Fermer
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-500">Traduction</label>
                  <textarea
                    className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-xl p-4 text-sm"
                    value={editedSegment?.translation || ''}
                    onChange={(e) => handleFieldChange('translation', e.target.value)}
                    rows={3}
                    disabled={saving}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-500">Début (s)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={editedSegment?.startTime || 0}
                      onChange={(e) => handleFieldChange('startTime', parseFloat(e.target.value) || 0)}
                      className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-xl p-3"
                      disabled={saving}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Fin (s)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={editedSegment?.endTime || 0}
                      onChange={(e) => handleFieldChange('endTime', parseFloat(e.target.value) || 0)}
                      className="w-full mt-1 bg-gray-800 border border-gray-700 rounded-xl p-3"
                      disabled={saving}
                    />
                  </div>
                </div>

                <button
                  onClick={handleSaveSegment}
                  disabled={saving || !editedSegment}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-2xl font-medium transition-colors"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Enregistrement...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Sauvegarder les modifications
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}