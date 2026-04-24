"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { SubtitleSegment, SubtitleStylePreset, SUBTITLE_STYLES, ViewMode } from './types';
import { useToast } from '@/components/ui/Toast';
import { getTranscriptionSegments, updateSegment, splitSegment, mergeSegments, deleteSegment } from '@/lib/api';
import TimelineView from './TimelineView';

interface SubtitleEditorProps {
  jobId: string;
  currentVideoTime?: number;
  isVideoPlaying?: boolean;
  onSeekVideo?: (time: number) => void;
  initialSegments?: SubtitleSegment[];
}

export function SubtitleEditor({ 
  jobId, 
  currentVideoTime = 0, 
  isVideoPlaying = false, 
  onSeekVideo,
  initialSegments 
}: SubtitleEditorProps) {
  const { showSuccess, showError, showInfo } = useToast();
  const [segments, setSegments] = useState<SubtitleSegment[]>(initialSegments || []);
  const [selectedSegment, setSelectedSegment] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [selectedStyle, setSelectedStyle] = useState<SubtitleStylePreset>('classique');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [duration, setDuration] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [summary, setSummary] = useState<string>('');
  const [isSummaryCopied, setIsSummaryCopied] = useState(false);
  
  // Références pour debounce
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSaveRef = useRef<{type: string; data: any} | null>(null);

  useEffect(() => {
    const loadSegments = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const data = await getTranscriptionSegments(jobId);
        
        if (data && Array.isArray(data)) {
          // Transformer les segments pour correspondre à l'interface frontend
          const transformedSegments = data.map((seg: any) => ({
            id: seg.id || `segment-${Math.random()}`,
            startTime: seg.startTime || seg.start_time || 0,
            endTime: seg.endTime || seg.end_time || 0,
            text: seg.text || seg.original_text || '',
            translation: seg.translation || seg.translated_text || seg.text || '',
            style: seg.style || SUBTITLE_STYLES.classique,
            customOrder: seg.custom_order || seg.customOrder || 0
          }));
          
          // Calculer la durée totale de la vidéo
          if (transformedSegments.length > 0) {
            const maxEndTime = Math.max(...transformedSegments.map(s => s.endTime));
            setDuration(maxEndTime);
          }
          
          // Si aucun segment, ne pas utiliser de données mockées
          if (transformedSegments.length === 0) {
            console.warn('Aucun segment trouvé dans la réponse API');
            showInfo('Les segments de transcription ne sont pas encore disponibles. Veuillez patienter...');
          } else {
            setSegments(transformedSegments);
            showSuccess(`${transformedSegments.length} segments chargés avec succès`, 2000);
          }
        } else {
          console.warn('Format de réponse API inattendu ou segments non disponibles:', data);
          showInfo('Les segments de transcription ne sont pas encore disponibles. Veuillez patienter...');
        }
      } catch (err: any) {
        const errorMsg = err.message || 'Erreur de chargement des segments';
        setError(errorMsg);
        showError(`Impossible de charger les sous-titres: ${errorMsg}`);
        console.error('Erreur de chargement des segments:', err);
      } finally {
        setIsLoading(false);
      }
    };

    const loadJobSummary = async () => {
      try {
        const response = await fetch(`http://localhost:8000/jobs/${jobId}/transcription`, {
          headers: { 'Content-Type': 'application/json' },
        });
        if (response.ok) {
          const data = await response.json();
          if (data.summary) {
            setSummary(data.summary);
          }
        }
      } catch (err) {
        console.warn('Impossible de charger le résumé:', err);
      }
    };
    
    loadSegments();
    loadJobSummary();
  }, [jobId]);

  // Mettre à jour editText quand un segment est sélectionné
  useEffect(() => {
    if (selectedSegment) {
      const segment = segments.find(s => s.id === selectedSegment);
      if (segment) {
        setEditText(segment.translation || '');
        if (segment.style) {
          const matchingStyle = Object.entries(SUBTITLE_STYLES).find(
            ([_, style]) => JSON.stringify(style) === JSON.stringify(segment.style)
          );
          if (matchingStyle) {
            setSelectedStyle(matchingStyle[0] as SubtitleStylePreset);
          }
        }
      }
    }
  }, [selectedSegment, segments]);

  const saveSegment = async (id: string) => {
    try {
      const segment = segments.find(s => s.id === id);
      if (!segment) return;
      
      await updateSegment(jobId, id, editText, segment.startTime, segment.endTime);
      
      setSegments(prev => prev.map(s => 
        s.id === id ? { 
          ...s, 
          translation: editText,
          style: SUBTITLE_STYLES[selectedStyle]
        } : s
      ));
      setSelectedSegment(null);
      showSuccess("Segment enregistré avec succès", 2000);
    } catch (err: any) {
      showError(`Erreur lors de l'enregistrement: ${err.message}`);
    }
  };

  const applyStyleToAll = () => {
    setSegments(prev => prev.map(s => ({
      ...s,
      style: SUBTITLE_STYLES[selectedStyle]
    })));
    showInfo(`Style "${selectedStyle}" appliqué à tous les segments`, 2500);
  };

  const handleSegmentDelete = async (segmentIds: string[]) => {
    // Optimistic update
    const previousSegments = [...segments];
    setSegments(prev => prev.filter(s => !segmentIds.includes(s.id)));
    
    try {
      // Supprimer chaque segment via API
      for (const segmentId of segmentIds) {
        await deleteSegment(jobId, segmentId);
      }
      showSuccess(`${segmentIds.length} segment(s) supprimé(s)`);
    } catch (err: any) {
      // Rollback en cas d'erreur
      setSegments(previousSegments);
      showError(`Erreur de suppression: ${err.message}`);
    }
  };

  const handleSegmentSplit = async (segmentId: string, splitTime: number) => {
    // Récupérer le segment avant modification
    const segment = segments.find(s => s.id === segmentId);
    if (!segment) return;
    
    // Optimistic update - créer les segments temporaires
    const tempSegment1 = {
      id: `temp-split-${segmentId}-1`,
      startTime: segment.startTime,
      endTime: splitTime,
      text: `${segment.text} (part 1)`,
      translation: segment.translation ? `${segment.translation} (part 1)` : '',
      style: segment.style,
      customOrder: 0
    };
    
    const tempSegment2 = {
      id: `temp-split-${segmentId}-2`,
      startTime: splitTime,
      endTime: segment.endTime,
      text: `${segment.text} (part 2)`,
      translation: segment.translation ? `${segment.translation} (part 2)` : '',
      style: segment.style,
      customOrder: 0
    };
    
    // Appliquer optimistic update
    setSegments(prev => {
      const filtered = prev.filter(s => s.id !== segmentId);
      return [...filtered, tempSegment1, tempSegment2].sort((a, b) => a.startTime - b.startTime);
    });
    
    try {
      // Appeler l'API split avec timeout pour simuler le chargement
      const result = await splitSegment(jobId, segmentId, splitTime);
      
      // Remplacer les segments temporaires par les vrais segments
      setSegments(prev => {
        const filtered = prev.filter(s => !s.id.includes(`temp-split-${segmentId}`));
        const newSegments = result.segments.map((seg: any) => ({
          id: seg.id,
          startTime: seg.startTime || 0,
          endTime: seg.endTime || 0,
          text: seg.text || '',
          translation: seg.translation || '',
          style: segment.style,
          customOrder: seg.customOrder || seg.custom_order || 0
        }));
        return [...filtered, ...newSegments].sort((a, b) => a.startTime - b.startTime);
      });
      
      showSuccess(result.message);
    } catch (err: any) {
      // Rollback en cas d'erreur
      setSegments(prev => {
        const filtered = prev.filter(s => !s.id.includes(`temp-split-${segmentId}`));
        return [...filtered, segment].sort((a, b) => a.startTime - b.startTime);
      });
      showError(`Erreur de division: ${err.message}`);
    }
  };

  const handleSegmentMerge = async (segmentIds: string[]) => {
    if (segmentIds.length < 2) return;
    
    // Garder les segments originaux pour rollback
    const segmentsToMerge = segments.filter(s => segmentIds.includes(s.id));
    
    try {
      // Appeler l'API merge
      const result = await mergeSegments(jobId, segmentIds);
      
      // Mettre à jour les segments
      setSegments(prev => {
        const filtered = prev.filter(s => !segmentIds.includes(s.id));
        const segment = result.segment as any;
        const mergedSegment = {
          id: segment.id,
          startTime: segment.startTime || segment.start_time || 0,
          endTime: segment.endTime || segment.end_time || 0,
          text: segment.text || segment.original_text || '',
          translation: segment.translation || segment.translated_text || '',
          style: segmentsToMerge[0]?.style || SUBTITLE_STYLES.classique,
          customOrder: segment.customOrder || segment.custom_order || 0
        };
        return [...filtered, mergedSegment].sort((a, b) => a.startTime - b.startTime);
      });
      
      showSuccess(result.message);
    } catch (err: any) {
      showError(`Erreur de fusion: ${err.message}`);
    }
  };

  const handleSegmentReorder = (newSegments: SubtitleSegment[]) => {
    setSegments(newSegments);
    showSuccess("Ordre des segments mis à jour");
  };

  const getSelectedSegment = () => {
    return segments.find(s => s.id === selectedSegment);
  };
  
  const selectedSegmentData = getSelectedSegment();

  // Fonction de sauvegarde automatique
  const scheduleAutoSave = useCallback((type: string, data: any) => {
    // Annuler le timeout précédent
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    pendingSaveRef.current = { type, data };
    
    // Déclencher la sauvegarde après 2 secondes d'inactivité
    saveTimeoutRef.current = setTimeout(async () => {
      setIsSaving(true);
      try {
        // Implémenter la logique de sauvegarde ici
        // Pour l'instant, on simule juste un délai
        await new Promise(resolve => setTimeout(resolve, 500));
        
        setLastSavedAt(new Date());
        pendingSaveRef.current = null;
        showSuccess("Modifications sauvegardées", 1500);
      } catch (err: any) {
        showError(`Erreur de sauvegarde: ${err.message}`);
      } finally {
        setIsSaving(false);
      }
    }, 2000);
  }, [showSuccess, showError]);

  // Fonction pour forcer la sauvegarde immédiate
  const forceSave = useCallback(async () => {
    if (!pendingSaveRef.current) return;
    
    setIsSaving(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      setLastSavedAt(new Date());
      pendingSaveRef.current = null;
      showSuccess("Sauvegarde forcée effectuée", 1500);
    } catch (err: any) {
      showError(`Erreur de sauvegarde: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  }, [showSuccess, showError]);

  // Effet de nettoyage
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Formater la date de dernière sauvegarde
  const formatLastSaved = () => {
    if (!lastSavedAt) return "Jamais";
    const now = new Date();
    const diffMs = now.getTime() - lastSavedAt.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return "À l'instant";
    if (diffMins < 60) return `Il y a ${diffMins} min`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `Il y a ${diffHours} h`;
    return `Le ${lastSavedAt.toLocaleDateString('fr-FR')}`;
  };

  return (
    <div className="space-y-4">
      {/* Header Ministudio simplifié */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">Éditeur de sous-titres</h2>
            <p className="text-sm text-gray-400">{segments.length} segments • {duration.toFixed(0)}s durée</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            <button className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
              Exporter SRT
            </button>
            <button className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors">
              Export burn-in
            </button>
          </div>
        </div>
      </div>

      {/* Panneau de résumé avec bouton copier */}
      {summary && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
          <div className="flex justify-between items-start gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-emerald-400">📋</span>
                <h3 className="text-sm font-medium text-gray-200">Résumé de la vidéo</h3>
              </div>
              <div className="text-sm text-gray-300 bg-gray-800/50 border border-gray-700 rounded-lg p-3">
                {summary}
              </div>
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(summary);
                setIsSummaryCopied(true);
                showSuccess('Résumé copié dans le presse-papier', 2000);
                setTimeout(() => setIsSummaryCopied(false), 3000);
              }}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isSummaryCopied
                  ? 'bg-emerald-600 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {isSummaryCopied ? '✓ Copié' : '📋 Copier'}
            </button>
          </div>
        </div>
      )}

      {/* Barre de contrôle principale */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-medium text-gray-200 mr-2">Mode d'édition:</h3>
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('list')}
              className={`px-4 py-2 rounded-xl flex items-center gap-2 font-medium transition-all ${viewMode === 'list' ? 'bg-gradient-to-r from-blue-600 to-blue-800 text-white shadow-lg shadow-blue-600/30' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
            >
              <span>📋</span>
              Édition liste
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              className={`px-4 py-2 rounded-xl flex items-center gap-2 font-medium transition-all ${viewMode === 'timeline' ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg shadow-cyan-600/30' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
            >
              <span>🎬</span>
              Timeline avancée
            </button>
          </div>
        </div>
        
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          {/* Indicateur de sauvegarde */}
          <div className="flex items-center gap-2 text-sm bg-gray-900/60 border border-gray-700 rounded-xl px-3 py-2">
            <div className={`w-2 h-2 rounded-full ${isSaving ? 'animate-pulse bg-cyan-400' : pendingSaveRef.current ? 'bg-yellow-500' : 'bg-emerald-500'}`}></div>
            {isSaving ? (
              <div className="flex items-center gap-2 text-cyan-400">
                <span className="hidden sm:inline">Sauvegarde...</span>
                <div className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
              </div>
            ) : (
              <div className="text-gray-300">
                <span className="hidden sm:inline">Dernière sauvegarde:</span> {formatLastSaved()}
              </div>
            )}
            {pendingSaveRef.current && !isSaving && (
              <button
                onClick={forceSave}
                className="px-2 py-1 bg-cyan-600 hover:bg-cyan-500 text-white text-xs rounded-lg transition-colors"
              >
                💾 Sauvegarder
              </button>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <button className="px-3 py-2 bg-gradient-to-r from-emerald-600 to-green-500 text-white rounded-xl hover:from-emerald-500 hover:to-green-400 transition-all font-medium shadow-lg shadow-emerald-500/20 flex items-center gap-2">
              <span>⬇️</span>
              Exporter burn-in
            </button>
            <button className="px-3 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-500 transition-all font-medium">
              Télécharger
            </button>
          </div>
        </div>
      </div>

      {viewMode === 'list' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">Séquences</label>
            <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
              {segments.map(seg => {
                const hasTranslation = seg.translation && seg.translation !== seg.text;
                const displayText = hasTranslation ? seg.translation : seg.text;
                const showOriginalNote = hasTranslation;
                
                return (
                  <div
                    key={seg.id}
                    className={`p-3 rounded border cursor-pointer transition-colors ${
                      selectedSegment === seg.id
                        ? 'border-cyan-500 bg-cyan-500/10'
                        : 'border-gray-700/50 hover:border-gray-600'
                    }`}
                    onClick={() => setSelectedSegment(seg.id)}
                  >
                    <div className="flex flex-col gap-1">
                      <div className={`text-sm font-medium ${
                        hasTranslation ? 'text-white' : 'text-gray-400'
                      }`}>
                        {displayText}
                      </div>
                      {showOriginalNote && (
                        <div className="text-xs text-gray-500 bg-gray-800/50 rounded px-1 py-0.5">
                          Original: {seg.text}
                        </div>
                      )}
                      {!hasTranslation && (
                        <div className="text-xs text-amber-500 bg-amber-500/10 rounded px-1 py-0.5">
                          ⚠️ À traduire
                        </div>
                      )}
                      <div className="text-xs text-gray-500 mt-1">
                        {seg.startTime.toFixed(1)}s - {seg.endTime.toFixed(1)}s
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">Édition</label>
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="w-full h-48 p-3 bg-gray-800 border border-gray-700 rounded text-gray-200 focus:outline-none focus:border-cyan-500 resize-none font-mono text-sm"
              placeholder="Éditez la traduction ici..."
            />
            
            <div className="space-y-2 pt-2">
              <label className="text-sm font-medium text-gray-300">Style des sous-titres</label>
              <select
                value={selectedStyle}
                onChange={(e) => setSelectedStyle(e.target.value as SubtitleStylePreset)}
                className="w-full p-2 bg-gray-800 border border-gray-700 rounded text-gray-200 focus:outline-none focus:border-cyan-500 text-sm"
              >
                <option value="classique">Classique (blanc fond noir)</option>
                <option value="moderne">Moderne (bleu clair fond foncé)</option>
                <option value="minimal">Minimal (texte blanc transparent)</option>
                <option value="accent">Accent (cyan bordure verte)</option>
              </select>
              
              <div className="flex gap-2">
                <button
                  onClick={() => selectedSegment && saveSegment(selectedSegment)}
                  disabled={!selectedSegment}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  aria-label="Enregistrer les modifications sur ce segment"
                >
                  Enregistrer ce segment
                </button>
                <button
                  onClick={applyStyleToAll}
                  className="flex-1 px-4 py-2 bg-cyan-600 text-white rounded hover:bg-cyan-700 transition-colors text-sm"
                  aria-label="Appliquer le style actuel à tous les segments"
                >
                  Appliquer à tous
                </button>
              </div>
              <div className="pt-2">
                <button
                  onClick={() => {
                    setPreviewMode(prev => !prev);
                    if (previewMode) {
                      showInfo("Mode prévisualisation désactivé", 2000);
                    } else {
                      showInfo("Mode prévisualisation activé - les sous-titres s'afficheront sur la vidéo", 2500);
                    }
                  }}
                  className={`w-full px-4 py-2 ${previewMode ? 'bg-purple-700' : 'bg-purple-600'} text-white rounded hover:bg-purple-800 transition-colors text-sm flex items-center justify-center gap-2`}
                  aria-label={previewMode ? "Désactiver la prévisualisation" : "Prévisualiser les sous-titres avec les styles appliqués"}
                >
                  <span>{previewMode ? '👁️‍🗨️' : '👁️'}</span>
                  {previewMode ? 'Quitter la prévisualisation' : 'Prévisualiser les sous-titres'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <TimelineView
          jobId={jobId}
          segments={segments.map(seg => ({
            id: seg.id,
            startTime: seg.startTime,
            endTime: seg.endTime,
            duration: seg.endTime - seg.startTime,
            text: seg.text,
            translation: seg.translation,
            style: seg.style,
            customOrder: seg.customOrder
          }))}
          duration={duration}
          onSegmentDelete={handleSegmentDelete}
          onSegmentSplit={handleSegmentSplit}
          onSegmentMerge={handleSegmentMerge}
          onSegmentReorder={handleSegmentReorder}
        />
      )}
    </div>
  );
}