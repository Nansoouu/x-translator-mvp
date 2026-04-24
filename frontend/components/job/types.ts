export interface ProcessingStage {
  id: 'download' | 'transcribe' | 'translate' | 'render' | 'done';
  label: string;
  icon: string;
}

export interface JobStatus {
  jobId: string;
  processingStage: string;
  progress: number;
  videoUrl?: string;
  transcription?: string;
  translation?: string;
  subtitleFile?: string;
  error?: string;
}

export interface SubtitleSegment {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  translation?: string;
  style?: SubtitleStyle;
  customOrder?: number;
}

export interface SubtitleStyle {
  fontFamily: string;
  fontSize: number;
  color: string;
  backgroundColor: string;
  shadow: string;
  border?: string;
  borderRadius?: string;
}

export type SubtitleStylePreset = 'classique' | 'moderne' | 'minimal' | 'accent';

export const SUBTITLE_STYLES: Record<SubtitleStylePreset, SubtitleStyle> = {
  classique: {
    fontFamily: 'Arial, sans-serif',
    fontSize: 24,
    color: '#ffffff',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    shadow: '0 2px 4px rgba(0, 0, 0, 0.5)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '4px',
  },
  moderne: {
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: 20,
    color: '#e0e7ff',
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    shadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
    border: 'none',
    borderRadius: '8px',
  },
  minimal: {
    fontFamily: 'Helvetica, Arial, sans-serif',
    fontSize: 18,
    color: '#f8fafc',
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    shadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
    border: 'none',
    borderRadius: '0',
  },
  accent: {
    fontFamily: 'Montserrat, sans-serif',
    fontSize: 22,
    color: '#22d3ee',
    backgroundColor: 'rgba(6, 78, 59, 0.9)',
    shadow: '0 4px 8px rgba(34, 211, 238, 0.3)',
    border: '2px solid rgba(34, 211, 238, 0.5)',
    borderRadius: '12px',
  },
};

export interface TranscriptionResponse {
  segments: SubtitleSegment[];
  sourceLanguage: string;
  targetLanguage: string;
  duration: number;
}

export interface TranslationResponse {
  translatedSegments: SubtitleSegment[];
  sourceLanguage: string;
  targetLanguage: string;
}

export interface VideoMetadata {
  duration: number;
  size: number;
  format: string;
  resolution: string;
}

// ─── Timeline Editor Types ──────────────────────────────────────────────────

export type ViewMode = 'list' | 'timeline';

export interface TimelineSegment {
  id: string;
  startTime: number;
  endTime: number;
  duration: number;
  text: string;
  translation?: string;
  style?: SubtitleStyle;
  customOrder?: number;
  isSelected?: boolean;
  isDragging?: boolean;
  isResizing?: boolean;
}

export interface TimelineState {
  mode: ViewMode;
  duration: number;
  zoomLevel: number;
  currentTime: number;
  isPlaying: boolean;
  selectedSegmentIds: string[];
  hoveredSegmentId: string | null;
  splitPosition: number | null;
  mergeCandidates: string[];
}

export interface SplitParams {
  segmentId: string;
  splitTime: number;
  leftText: string;
  rightText: string;
}

export interface MergeParams {
  segmentId1: string;
  segmentId2: string;
  mergedText: string;
}

export interface DragSegmentEvent {
  segmentId: string;
  newStartTime: number;
  newEndTime: number;
}

export interface ResizeSegmentEvent {
  segmentId: string;
  edge: 'start' | 'end';
  newTime: number;
}

export interface TimelineRulerProps {
  duration: number;
  currentTime: number;
  zoomLevel: number;
  width: number;
  onSeek?: (time: number) => void;
}

export interface SegmentTrackProps {
  segments: TimelineSegment[];
  duration: number;
  zoomLevel: number;
  width: number;
  onSegmentClick?: (segmentId: string) => void;
  onSegmentDrag?: (event: DragSegmentEvent) => void;
  onSegmentResize?: (event: ResizeSegmentEvent) => void;
  onSegmentSplit?: (segmentId: string, splitTime: number) => void;
  onSegmentMerge?: (segmentId1: string, segmentId2: string) => void;
}

export interface TimelineControlsProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  selectedSegments: TimelineSegment[];
  onPlayPause?: () => void;
  onSeek?: (time: number) => void;
  onSplit?: (segmentId: string) => void;
  onMerge?: (segmentIds: string[]) => void;
  onDelete?: (segmentIds: string[]) => void;
  onExport?: () => void;
  onModeToggle?: (mode: ViewMode) => void;
}