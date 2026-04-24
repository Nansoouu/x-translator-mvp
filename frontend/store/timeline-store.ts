import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { TimelineSegment, TimelineState, ViewMode, DragSegmentEvent, ResizeSegmentEvent } from '@/components/job/types';

// Types pour le store
interface TimelineStoreState {
  // État principal
  segments: TimelineSegment[];
  currentTime: number;
  isPlaying: boolean;
  selectedSegmentIds: string[];
  zoomLevel: number;
  hoveredSegmentId: string | null;
  splitPosition: number | null;
  mergeCandidates: string[];
  mode: ViewMode;
  duration: number;
  
  // Historique pour undo/redo
  history: TimelineState[];
  historyIndex: number;
  
  // Actions
  setSegments: (segments: TimelineSegment[]) => void;
  setCurrentTime: (time: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setSelectedSegmentIds: (ids: string[]) => void;
  setZoomLevel: (level: number) => void;
  setHoveredSegmentId: (id: string | null) => void;
  setSplitPosition: (position: number | null) => void;
  setMergeCandidates: (candidates: string[]) => void;
  setMode: (mode: ViewMode) => void;
  setDuration: (duration: number) => void;
  
  // Actions sur les segments
  updateSegment: (id: string, updates: Partial<TimelineSegment>) => void;
  splitSegment: (segmentId: string, splitTime: number) => void;
  mergeSegments: (segmentIds: string[]) => void;
  deleteSegments: (segmentIds: string[]) => void;
  
  // Drag & Resize (optimistic updates)
  dragSegment: (event: DragSegmentEvent) => void;
  resizeSegment: (event: ResizeSegmentEvent) => void;
  
  // Historique
  saveStateToHistory: () => void;
  undo: () => void;
  redo: () => void;
  
  // Utilitaires
  clearSelection: () => void;
  toggleSegmentSelection: (segmentId: string) => void;
  selectAllSegments: () => void;
}

// Fonction utilitaire pour throttler
const createThrottledUpdate = () => {
  let lastUpdate = 0;
  const throttleMs = 16; // ~60fps
  
  return (callback: () => void) => {
    const now = Date.now();
    if (now - lastUpdate >= throttleMs) {
      lastUpdate = now;
      callback();
    }
  };
};

export const useTimelineStore = create<TimelineStoreState>()(
  devtools(
    (set, get) => ({
      // État initial
      segments: [],
      currentTime: 0,
      isPlaying: false,
      selectedSegmentIds: [],
      zoomLevel: 1,
      hoveredSegmentId: null,
      splitPosition: null,
      mergeCandidates: [],
      mode: 'timeline',
      duration: 0,
      history: [],
      historyIndex: -1,
      
      // Setters simples
      setSegments: (segments) => set({ segments }),
      setIsPlaying: (isPlaying) => set({ isPlaying }),
      setSelectedSegmentIds: (selectedSegmentIds) => set({ selectedSegmentIds }),
      setZoomLevel: (zoomLevel) => set({ zoomLevel }),
      setHoveredSegmentId: (hoveredSegmentId) => set({ hoveredSegmentId }),
      setSplitPosition: (splitPosition) => set({ splitPosition }),
      setMergeCandidates: (mergeCandidates) => set({ mergeCandidates }),
      setMode: (mode) => set({ mode }),
      setDuration: (duration) => set({ duration }),
      
      // CurrentTime avec throttling
      setCurrentTime: (currentTime) => {
        const throttledUpdate = createThrottledUpdate();
        throttledUpdate(() => {
          set({ currentTime });
        });
      },
      
      // Mettre à jour un segment
      updateSegment: (id, updates) =>
        set((state) => ({
          segments: state.segments.map((segment) =>
            segment.id === id ? { ...segment, ...updates } : segment
          ),
        })),
      
      // Diviser un segment
      splitSegment: (segmentId, splitTime) => {
        const state = get();
        const segment = state.segments.find((s) => s.id === segmentId);
        if (!segment || splitTime <= segment.startTime || splitTime >= segment.endTime) return;
        
        // Logique de division (simplifiée - sera remplacée par split-merge.ts)
        const leftSegment: TimelineSegment = {
          id: `${segmentId}-left`,
          startTime: segment.startTime,
          endTime: splitTime,
          duration: splitTime - segment.startTime,
          text: segment.text.substring(0, Math.floor(segment.text.length / 2)),
          translation: segment.translation?.substring(0, Math.floor(segment.translation?.length || 0 / 2)),
          style: segment.style,
          customOrder: segment.customOrder,
          isSelected: false,
        };
        
        const rightSegment: TimelineSegment = {
          id: `${segmentId}-right`,
          startTime: splitTime,
          endTime: segment.endTime,
          duration: segment.endTime - splitTime,
          text: segment.text.substring(Math.floor(segment.text.length / 2)),
          translation: segment.translation?.substring(Math.floor(segment.translation?.length || 0 / 2)),
          style: segment.style,
          customOrder: (segment.customOrder || 0) + 1,
          isSelected: false,
        };
        
        set((state) => ({
          segments: [
            ...state.segments.filter((s) => s.id !== segmentId),
            leftSegment,
            rightSegment,
          ].sort((a, b) => a.startTime - b.startTime),
          selectedSegmentIds: [],
        }));
        
        get().saveStateToHistory();
      },
      
      // Fusionner des segments
      mergeSegments: (segmentIds) => {
        const state = get();
        const segmentsToMerge = state.segments.filter((s) => segmentIds.includes(s.id));
        if (segmentsToMerge.length < 2) return;
        
        // Trier par temps de début
        segmentsToMerge.sort((a, b) => a.startTime - b.startTime);
        
        const mergedSegment: TimelineSegment = {
          id: `merged-${Date.now()}`,
          startTime: segmentsToMerge[0].startTime,
          endTime: segmentsToMerge[segmentsToMerge.length - 1].endTime,
          duration: segmentsToMerge[segmentsToMerge.length - 1].endTime - segmentsToMerge[0].startTime,
          text: segmentsToMerge.map((s) => s.text).join(' '),
          translation: segmentsToMerge.map((s) => s.translation || s.text).join(' '),
          style: segmentsToMerge[0].style,
          customOrder: segmentsToMerge[0].customOrder,
          isSelected: false,
        };
        
        set((state) => ({
          segments: [
            ...state.segments.filter((s) => !segmentIds.includes(s.id)),
            mergedSegment,
          ].sort((a, b) => a.startTime - b.startTime),
          selectedSegmentIds: [],
        }));
        
        get().saveStateToHistory();
      },
      
      // Supprimer des segments
      deleteSegments: (segmentIds) => {
        set((state) => ({
          segments: state.segments.filter((s) => !segmentIds.includes(s.id)),
          selectedSegmentIds: state.selectedSegmentIds.filter((id) => !segmentIds.includes(id)),
        }));
        
        get().saveStateToHistory();
      },
      
      // Drag & Resize (optimistic updates)
      dragSegment: (event) => {
        set((state) => ({
          segments: state.segments.map((segment) =>
            segment.id === event.segmentId
              ? {
                  ...segment,
                  startTime: event.newStartTime,
                  endTime: event.newEndTime,
                  duration: event.newEndTime - event.newStartTime,
                  isDragging: false,
                }
              : segment
          ),
        }));
      },
      
      resizeSegment: (event) => {
        set((state) => ({
          segments: state.segments.map((segment) =>
            segment.id === event.segmentId
              ? {
                  ...segment,
                  [event.edge === 'start' ? 'startTime' : 'endTime']: event.newTime,
                  duration:
                    event.edge === 'start'
                      ? segment.endTime - event.newTime
                      : event.newTime - segment.startTime,
                  isResizing: false,
                }
              : segment
          ),
        }));
      },
      
      // Historique
      saveStateToHistory: () => {
        const state = get();
        const currentState: TimelineState = {
          mode: state.mode,
          duration: state.duration,
          zoomLevel: state.zoomLevel,
          currentTime: state.currentTime,
          isPlaying: state.isPlaying,
          selectedSegmentIds: [...state.selectedSegmentIds],
          hoveredSegmentId: state.hoveredSegmentId,
          splitPosition: state.splitPosition,
          mergeCandidates: [...state.mergeCandidates],
        };
        
        set((state) => {
          const newHistory = [...state.history.slice(0, state.historyIndex + 1), currentState];
          // Limiter l'historique à 20 états
          if (newHistory.length > 20) {
            newHistory.shift();
          }
          
          return {
            history: newHistory,
            historyIndex: newHistory.length - 1,
          };
        });
      },
      
      undo: () => {
        const state = get();
        if (state.historyIndex <= 0) return;
        
        const previousState = state.history[state.historyIndex - 1];
        set({
          mode: previousState.mode,
          zoomLevel: previousState.zoomLevel,
          currentTime: previousState.currentTime,
          isPlaying: previousState.isPlaying,
          selectedSegmentIds: previousState.selectedSegmentIds,
          hoveredSegmentId: previousState.hoveredSegmentId,
          splitPosition: previousState.splitPosition,
          mergeCandidates: previousState.mergeCandidates,
          historyIndex: state.historyIndex - 1,
        });
      },
      
      redo: () => {
        const state = get();
        if (state.historyIndex >= state.history.length - 1) return;
        
        const nextState = state.history[state.historyIndex + 1];
        set({
          mode: nextState.mode,
          zoomLevel: nextState.zoomLevel,
          currentTime: nextState.currentTime,
          isPlaying: nextState.isPlaying,
          selectedSegmentIds: nextState.selectedSegmentIds,
          hoveredSegmentId: nextState.hoveredSegmentId,
          splitPosition: nextState.splitPosition,
          mergeCandidates: nextState.mergeCandidates,
          historyIndex: state.historyIndex + 1,
        });
      },
      
      // Utilitaires
      clearSelection: () => set({ selectedSegmentIds: [] }),
      
      toggleSegmentSelection: (segmentId) =>
        set((state) => {
          const isSelected = state.selectedSegmentIds.includes(segmentId);
          return {
            selectedSegmentIds: isSelected
              ? state.selectedSegmentIds.filter((id) => id !== segmentId)
              : [...state.selectedSegmentIds, segmentId],
          };
        }),
      
      selectAllSegments: () =>
        set((state) => ({
          selectedSegmentIds: state.segments.map((segment) => segment.id),
        })),
    }),
    { name: 'TimelineStore' }
  )
);

// Hooks atomiques pour éviter les re-renders inutiles
export const useSegments = () => useTimelineStore((state) => state.segments);
export const useCurrentTime = () => useTimelineStore((state) => state.currentTime);
export const useIsPlaying = () => useTimelineStore((state) => state.isPlaying);
export const useSelectedSegmentIds = () => useTimelineStore((state) => state.selectedSegmentIds);
export const useZoomLevel = () => useTimelineStore((state) => state.zoomLevel);
export const useMode = () => useTimelineStore((state) => state.mode);
export const useDuration = () => useTimelineStore((state) => state.duration);
export const useHoveredSegmentId = () => useTimelineStore((state) => state.hoveredSegmentId);

// Hooks pour les actions
export const useTimelineActions = () => {
  const {
    setSegments,
    setCurrentTime,
    setIsPlaying,
    setSelectedSegmentIds,
    setZoomLevel,
    setMode,
    setDuration,
    updateSegment,
    splitSegment,
    mergeSegments,
    deleteSegments,
    dragSegment,
    resizeSegment,
    undo,
    redo,
    clearSelection,
    toggleSegmentSelection,
    selectAllSegments,
  } = useTimelineStore();
  
  return {
    setSegments,
    setCurrentTime,
    setIsPlaying,
    setSelectedSegmentIds,
    setZoomLevel,
    setMode,
    setDuration,
    updateSegment,
    splitSegment,
    mergeSegments,
    deleteSegments,
    dragSegment,
    resizeSegment,
    undo,
    redo,
    clearSelection,
    toggleSegmentSelection,
    selectAllSegments,
  };
};

// Hook pour les segments sélectionnés (dérivé)
export const useSelectedSegments = () => {
  const segments = useSegments();
  const selectedIds = useSelectedSegmentIds();
  return segments.filter((segment) => selectedIds.includes(segment.id));
};

// Hook pour le segment actif basé sur le currentTime
export const useActiveSegment = () => {
  const segments = useSegments();
  const currentTime = useCurrentTime();
  
  return segments.find(
    (segment) => currentTime >= segment.startTime && currentTime <= segment.endTime
  );
};