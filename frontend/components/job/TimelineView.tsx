"use client";

import { useState, useEffect } from 'react';
import type { TimelineSegment, ViewMode } from './types';
import TimelineRuler from './TimelineRuler';
import SegmentTrack from './SegmentTrack';
import TimelineControls from './TimelineControls';
import { motion } from 'framer-motion';

interface TimelineViewProps {
  jobId: string;
  segments: TimelineSegment[];
  duration: number;
  currentVideoTime?: number;
  onSeekVideo?: (time: number) => void;
  onSegmentDelete?: (segmentIds: string[]) => void;
  onSegmentSplit?: (segmentId: string, splitTime: number) => void;
  onSegmentMerge?: (segmentIds: string[]) => void;
  onSegmentReorder?: (segments: TimelineSegment[]) => void;
}

export default function TimelineView({
  jobId,
  segments,
  duration,
  currentVideoTime = 0,
  onSeekVideo,
  onSegmentDelete,
  onSegmentSplit,
  onSegmentMerge,
  onSegmentReorder
}: TimelineViewProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>([]);
  const [hoveredSegmentId, setHoveredSegmentId] = useState<string | null>(null);
  const [splitPosition, setSplitPosition] = useState<number | null>(null);
  const [width, setWidth] = useState(800);
  
  const selectedSegments = segments.filter(s => selectedSegmentIds.includes(s.id));

  // Synchroniser avec le temps de la vidéo externe
  useEffect(() => {
    if (currentVideoTime !== undefined && currentVideoTime !== null) {
      setCurrentTime(currentVideoTime);
    }
  }, [currentVideoTime]);

  // Animation du temps (playhead interne)
  useEffect(() => {
    if (!isPlaying || duration === 0) return;

    const interval = setInterval(() => {
      setCurrentTime(prev => {
        const next = prev + 0.1;
        return next >= duration ? 0 : next;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [isPlaying, duration]);

  // Configuration du resize
  useEffect(() => {
    const handleResize = () => {
      const container = document.getElementById('timeline-container');
      if (container) {
        setWidth(container.clientWidth - 80); // 80px pour les contrôles
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handlePlayPause = () => {
    setIsPlaying(prev => !prev);
  };

  const handleSeek = (time: number) => {
    setCurrentTime(Math.max(0, Math.min(time, duration)));
    setIsPlaying(false);
    // Appeler onSeekVideo si défini pour synchroniser la vidéo
    if (onSeekVideo) {
      onSeekVideo(time);
    }
  };

  const handleSegmentClick = (segmentId: string) => {
    setSelectedSegmentIds(prev => {
      if (prev.includes(segmentId)) {
        return prev.filter(id => id !== segmentId);
      } else {
        return [...prev, segmentId];
      }
    });
  };

  const handleSegmentSplit = (segmentId: string) => {
    const segment = segments.find(s => s.id === segmentId);
    if (!segment) return;
    
    const splitTime = segment.startTime + (segment.duration / 2);
    setSplitPosition(splitTime);
    
    // Animation de split
    setTimeout(() => {
      onSegmentSplit?.(segmentId, splitTime);
      setSplitPosition(null);
    }, 300);
  };

  const handleSegmentMerge = () => {
    if (selectedSegmentIds.length >= 2) {
      onSegmentMerge?.(selectedSegmentIds);
    }
  };

  const handleSegmentDelete = () => {
    if (selectedSegmentIds.length > 0) {
      onSegmentDelete?.(selectedSegmentIds);
      setSelectedSegmentIds([]);
    }
  };

  const handleZoomIn = () => {
    setZoomLevel(prev => Math.min(prev * 1.25, 8));
  };

  const handleZoomOut = () => {
    setZoomLevel(prev => Math.max(prev / 1.25, 0.25));
  };

  const handleSegmentDrag = (event: { segmentId: string; newStartTime: number; newEndTime: number }) => {
    console.log('Drag segment:', event);
    // Mettre à jour l'ordre des segments
  };

  const handleSegmentResize = (event: { segmentId: string; edge: 'start' | 'end'; newTime: number }) => {
    console.log('Resize segment:', event);
    // Mettre à jour la durée du segment
  };

  return (
    <motion.div
      id="timeline-container"
      className="relative bg-gray-900 border border-gray-800 rounded-3xl p-6 w-full"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header simplifié */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold">Timeline Studio</h2>
          <p className="text-sm text-gray-400 mt-1">
            {segments.length} segments • {duration.toFixed(1)}s • Mode timeline
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
            <span className="text-gray-300">Prêt</span>
          </div>
          <button 
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors text-sm"
            onClick={() => setZoomLevel(1)}
          >
            Zoom 100%
          </button>
        </div>
      </div>

      {/* Règle timeline pleine largeur */}
      <div className="w-full overflow-x-auto mb-2">
        <TimelineRuler
          duration={duration}
          currentTime={currentTime}
          zoomLevel={zoomLevel}
          width={width}
          onSeek={handleSeek}
        />
      </div>

      {/* Piste segments pleine largeur */}
      <div className="w-full overflow-x-auto mb-6">
        <SegmentTrack
          segments={segments}
          duration={duration}
          zoomLevel={zoomLevel}
          width={width}
          onSegmentClick={handleSegmentClick}
          onSegmentDrag={handleSegmentDrag}
          onSegmentResize={handleSegmentResize}
          onSegmentSplit={handleSegmentSplit}
          onSegmentMerge={handleSegmentMerge}
        />
      </div>

      {/* Contrôles principaux horizontaux */}
      <div className="mt-8 pt-6 border-t border-gray-800">
        <TimelineControls
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          selectedSegments={selectedSegments}
          onPlayPause={handlePlayPause}
          onSeek={handleSeek}
          onSplit={() => selectedSegmentIds.length === 1 && handleSegmentSplit(selectedSegmentIds[0])}
          onMerge={handleSegmentMerge}
          onDelete={handleSegmentDelete}
          onExport={() => console.log('Export')}
          onModeToggle={(mode) => console.log('Switch to', mode)}
        />
      </div>

      {/* Indicateur de split */}
      {splitPosition !== null && (
        <motion.div
          className="absolute top-0 bottom-0 w-1 bg-cyan-500 z-50 pointer-events-none"
          initial={{ x: (splitPosition / duration) * width }}
          animate={{
            scaleY: [1, 1.2, 1],
            opacity: [1, 0.8, 1]
          }}
          transition={{ duration: 0.3 }}
          style={{ left: `${(splitPosition / duration) * width}px` }}
        >
          <div className="absolute -top-2 -left-2 w-5 h-5 bg-cyan-500 rounded-full flex items-center justify-center">
            <span className="text-xs">✂️</span>
          </div>
        </motion.div>
      )}

      {/* Playhead */}
      <div
        className="absolute top-0 bottom-20 w-1 bg-red-500 z-40 pointer-events-none"
        style={{ left: `${(currentTime / duration) * width}px` }}
      >
        <div className="absolute -top-2 -left-2 w-5 h-5 bg-red-500 rounded-full shadow-lg"></div>
      </div>
    </motion.div>
  );
}