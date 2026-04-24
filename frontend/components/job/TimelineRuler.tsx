"use client";

import { motion } from 'framer-motion';
import type { TimelineRulerProps } from './types';

export default function TimelineRuler({
  duration,
  currentTime,
  zoomLevel,
  width,
  onSeek
}: TimelineRulerProps) {
  if (duration <= 0 || width <= 0) {
    return (
      <div className="h-8 bg-gray-800/50 rounded flex items-center justify-center">
        <div className="text-xs text-gray-500">Chargement de la timeline...</div>
      </div>
    );
  }

  const visibleWidth = Math.min(duration * zoomLevel, duration);
  const pixelsPerSecond = width / visibleWidth;
  const majorInterval = visibleWidth > 120 ? 30 : visibleWidth > 60 ? 10 : visibleWidth > 30 ? 5 : 1;
  const minorInterval = majorInterval / 5;

  const renderMark = (time: number, isMajor: boolean) => {
    const x = (time / duration) * width;
    const height = isMajor ? 12 : 6;
    const label = formatTime(time);

    return (
      <div
        key={time}
        className="absolute top-0 flex flex-col items-center cursor-pointer"
        style={{ left: `${x}px` }}
        onClick={() => onSeek?.(time)}
      >
        <div
          className={`w-px ${isMajor ? 'bg-gray-400' : 'bg-gray-600'}`}
          style={{ height: `${height}px` }}
        />
        {isMajor && (
          <div className="text-[10px] text-gray-400 mt-1 select-none">
            {label}
          </div>
        )}
      </div>
    );
  };

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  // Générer les marques
  const marks = [];
  const startTime = Math.floor(currentTime / majorInterval) * majorInterval - majorInterval * 2;
  const endTime = startTime + (width / pixelsPerSecond) + majorInterval * 4;
  
  for (let time = startTime; time <= endTime; time += minorInterval) {
    if (time >= 0 && time <= duration) {
      const isMajor = Math.abs(time % majorInterval) < 0.001;
      marks.push({ time, isMajor });
    }
  }

  // Position du playhead
  const playheadX = (currentTime / duration) * width;

  return (
    <div className="relative h-16 bg-gray-800/30 rounded border border-gray-700 overflow-hidden">
      {/* Ligne de temps */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gray-600" />
      
      {/* Marques de temps */}
      {marks.map(({ time, isMajor }) => renderMark(time, isMajor))}
      
      {/* Zone de temps actuel */}
      <motion.div
        className="absolute top-0 h-full w-1 bg-red-500 z-10 shadow-lg"
        initial={{ x: playheadX }}
        animate={{ x: playheadX }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
      >
        <div className="absolute -top-2 -left-1.5 w-4 h-4 bg-red-500 rounded-full" />
      </motion.div>
      
      {/* Indicateur de temps actuel */}
      <div
        className="absolute top-5 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-gray-300 z-20"
        style={{ left: `${Math.min(playheadX + 10, width - 60)}px` }}
      >
        {formatTime(currentTime)}
      </div>
      
      {/* Zone de sélection */}
      <div
        className="absolute top-0 bottom-0 bg-blue-500/10 border-l border-r border-blue-500/30 pointer-events-none"
        style={{
          left: `${Math.max(0, playheadX - 15)}px`,
          width: '30px'
        }}
      />
      
      {/* Ligne hover */}
      <div
        className="absolute top-0 h-full w-px bg-cyan-400/50 pointer-events-none hidden group-hover:block"
        id="timeline-hover-line"
      />
    </div>
  );
}