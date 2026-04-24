"use client";

import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { SegmentTrackProps, TimelineSegment } from './types';

export default function SegmentTrack({
  segments,
  duration,
  zoomLevel,
  width,
  onSegmentClick,
  onSegmentDrag,
  onSegmentResize,
  onSegmentSplit,
  onSegmentMerge
}: SegmentTrackProps) {
  const [draggingSegmentId, setDraggingSegmentId] = useState<string | null>(null);
  const [resizingSegmentId, setResizingSegmentId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [resizeEdge, setResizeEdge] = useState<'start' | 'end'>('start');
  const containerRef = useRef<HTMLDivElement>(null);

  if (duration <= 0 || width <= 0) {
    return (
      <div className="h-24 bg-gray-800/30 rounded flex items-center justify-center">
        <div className="text-sm text-gray-500">Aucun segment à afficher</div>
      </div>
    );
  }

  const pixelsPerSecond = width / (duration * zoomLevel);

  const calculateSegmentStyle = (segment: TimelineSegment) => {
    const left = (segment.startTime / duration) * width;
    const segmentWidth = (segment.duration / duration) * width;
    
    // Couleurs basées sur la sélection et l'état
    let backgroundColor = 'bg-blue-600';
    let borderColor = 'border-blue-700';
    
    if (segment.isSelected) {
      backgroundColor = 'bg-cyan-600';
      borderColor = 'border-cyan-500';
    } else if (segment.isDragging) {
      backgroundColor = 'bg-purple-600';
      borderColor = 'border-purple-500';
    } else if (segment.isResizing) {
      backgroundColor = 'bg-orange-600';
      borderColor = 'border-orange-500';
    }

    return {
      left: `${left}px`,
      width: `${Math.max(segmentWidth, 4)}px`,
      backgroundColor,
      borderColor
    };
  };

  const handleSegmentMouseDown = (e: React.MouseEvent, segmentId: string) => {
    e.stopPropagation();
    const segment = segments.find(s => s.id === segmentId);
    if (!segment || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const clickX = e.clientX - containerRect.left;
    const segmentLeft = (segment.startTime / duration) * width;
    const segmentRight = segmentLeft + (segment.duration / duration) * width;
    const segmentWidth = segmentRight - segmentLeft;

    // Vérifier si le clic est près des bords pour le resize
    const edgeThreshold = Math.max(8, Math.min(segmentWidth * 0.1, 20)); // Threshold adaptatif
    const nearStart = Math.abs(clickX - segmentLeft) < edgeThreshold;
    const nearEnd = Math.abs(clickX - segmentRight) < edgeThreshold;

    if (nearStart || nearEnd) {
      setResizingSegmentId(segmentId);
      setResizeEdge(nearStart ? 'start' : 'end');
      // Pour le resize, garder l'offset mais s'assurer qu'il est raisonnable
      const edgePosition = nearStart ? segmentLeft : segmentRight;
      setDragOffset(Math.max(-5, Math.min(clickX - edgePosition, 5))); // Limiter l'offset à ±5px
    } else {
      setDraggingSegmentId(segmentId);
      // Pour le drag, s'assurer que l'offset n'est pas trop petit pour éviter les problèmes aux bords
      const minOffset = Math.max(segmentWidth * 0.1, 10); // Au moins 10px ou 10% de la largeur
      const calculatedOffset = clickX - segmentLeft;
      // Si on clique trop près du bord gauche, ajuster l'offset pour être à l'intérieur
      const safeOffset = calculatedOffset < minOffset ? minOffset : 
                        (calculatedOffset > segmentWidth - minOffset ? segmentWidth - minOffset : calculatedOffset);
      setDragOffset(safeOffset);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    let mouseX = e.clientX - containerRect.left - dragOffset;

    // Snap aux bords : détecter si on est proche des bords (0 ou duration)
    const snapThreshold = 10; // 10px de seuil de snap
    const snapToEdge = (position: number): number => {
      const timePos = position / width * duration;
      // Snap au début (0)
      if (position < snapThreshold) {
        return 0;
      }
      // Snap à la fin (duration)
      if (position > width - snapThreshold) {
        return duration;
      }
      return timePos;
    };

    if (draggingSegmentId && onSegmentDrag) {
      const segment = segments.find(s => s.id === draggingSegmentId);
      if (!segment) return;

      // Appliquer le snap pour le drag
      let newStartTime = snapToEdge(mouseX);
      
      // S'assurer que le segment reste dans les limites
      newStartTime = Math.max(0, Math.min(newStartTime, duration - segment.duration));
      const newEndTime = newStartTime + segment.duration;

      // Vérifier si on est à la limite
      const isAtLeftEdge = newStartTime <= 0.1;
      const isAtRightEdge = newEndTime >= duration - 0.1;
      
      // Mettre à jour le style du segment pour indiquer la limite
      const segmentElement = document.querySelector(`[data-segment-id="${draggingSegmentId}"]`);
      if (segmentElement) {
        if (isAtLeftEdge || isAtRightEdge) {
          segmentElement.classList.add('border-red-500', 'border-2');
        } else {
          segmentElement.classList.remove('border-red-500', 'border-2');
        }
      }

      onSegmentDrag({
        segmentId: draggingSegmentId,
        newStartTime,
        newEndTime
      });
    }

    if (resizingSegmentId && onSegmentResize) {
      const segment = segments.find(s => s.id === resizingSegmentId);
      if (!segment) return;

      // Appliquer le snap pour le resize
      let newTime = snapToEdge(mouseX);
      
      // S'assurer que le resize respecte les contraintes
      if (resizeEdge === 'start') {
        // Le début ne peut pas dépasser la fin
        newTime = Math.max(0, Math.min(newTime, segment.endTime - 0.1));
      } else {
        // La fin ne peut pas être avant le début
        newTime = Math.max(segment.startTime + 0.1, Math.min(newTime, duration));
      }

      onSegmentResize({
        segmentId: resizingSegmentId,
        edge: resizeEdge,
        newTime
      });
    }
  };

  const handleMouseUp = () => {
    setDraggingSegmentId(null);
    setResizingSegmentId(null);
  };

  const formatDuration = (duration: number): string => {
    if (duration < 1) return `${(duration * 1000).toFixed(0)}ms`;
    return `${duration.toFixed(1)}s`;
  };

  const getSegmentContent = (segment: TimelineSegment) => {
    const isTooSmall = (segment.duration / duration) * width < 60;
    
    if (isTooSmall) {
      return (
        <div className="text-xs text-center truncate px-1 opacity-80">
          {segment.text.substring(0, 20)}
        </div>
      );
    }

    return (
      <div className="px-3 py-2 space-y-1">
        <div className="text-xs font-medium truncate text-white">
          {segment.text.substring(0, 50)}
        </div>
        {segment.translation && (
          <div className="text-xs truncate text-gray-300 italic">
            {segment.translation.substring(0, 50)}
          </div>
        )}
        <div className="text-[10px] text-gray-400">
          {formatDuration(segment.startTime)} → {formatDuration(segment.endTime)}
        </div>
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className="relative h-32 bg-gray-800/20 rounded border border-gray-700/50 overflow-hidden"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Grille de fond */}
      <div className="absolute inset-0 grid grid-cols-10 grid-rows-2 opacity-20">
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className={`border-r ${i % 5 === 0 ? 'border-gray-600' : 'border-gray-700/30'}`}
          />
        ))}
      </div>

      {/* Affichage des segments */}
      <AnimatePresence>
        {segments.map(segment => {
          const style = calculateSegmentStyle(segment);
          const isTooSmall = (segment.duration / duration) * width < 60;

          return (
            <motion.div
              key={segment.id}
              data-segment-id={segment.id}
              className={`absolute h-20 rounded border ${style.borderColor} cursor-move select-none overflow-hidden transition-all hover:shadow-lg hover:z-10 ${
                isTooSmall ? 'py-1' : ''
              }`}
              style={{
                ...style,
                top: '20%',
                height: '60%',
                zIndex: segment.isSelected || segment.isDragging || segment.isResizing ? 20 : 1
              }}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ 
                opacity: 1, 
                scale: 1,
                left: style.left,
                width: style.width
              }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: "spring", stiffness: 200, damping: 20 }}
              onMouseDown={(e) => handleSegmentMouseDown(e, segment.id)}
              onClick={(e) => {
                e.stopPropagation();
                onSegmentClick?.(segment.id);
              }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {/* Background avec gradient */}
              <div className={`absolute inset-0 ${style.backgroundColor} opacity-90`} />
              <div className="absolute inset-0 bg-gradient-to-r from-transparent to-black/10" />
              
              {/* Contenu du segment */}
              <div className="relative h-full flex items-center">
                {getSegmentContent(segment)}
              </div>

              {/* Handle de resize gauche */}
              <div
                className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-gray-800/50 hover:bg-gray-700/70"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setResizingSegmentId(segment.id);
                  setResizeEdge('start');
                  onSegmentClick?.(segment.id);
                }}
              />

              {/* Handle de resize droit */}
              <div
                className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-gray-800/50 hover:bg-gray-700/70"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setResizingSegmentId(segment.id);
                  setResizeEdge('end');
                  onSegmentClick?.(segment.id);
                }}
              />

              {/* Badge sélection */}
              {segment.isSelected && (
                <div className="absolute -top-2 -right-2 w-6 h-6 bg-cyan-500 rounded-full flex items-center justify-center text-xs shadow-lg">
                  ✓
                </div>
              )}

              {/* Bouton split au milieu (visible au hover) */}
              <motion.button
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white/10 rounded-full flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity backdrop-blur-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onSegmentSplit?.(segment.id, segment.startTime + segment.duration / 2);
                }}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                title="Diviser le segment"
              >
                <span className="text-xs">✂️</span>
              </motion.button>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* Zone de drop pour fusion */}
      {segments.filter(s => s.isSelected).length >= 2 && (
        <motion.div
          className="absolute inset-0 border-2 border-dashed border-cyan-400 bg-cyan-400/5 pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="px-4 py-2 bg-cyan-600 rounded-lg text-sm text-white shadow-lg">
              Relâchez pour fusionner les segments
            </div>
          </div>
        </motion.div>
      )}

      {/* Indicateur de drag */}
      {draggingSegmentId && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-purple-500/50 pointer-events-none">
          <div className="absolute left-1/2 -translate-x-1/2 -top-6 px-2 py-1 bg-purple-500 text-xs text-white rounded shadow-lg">
            Déplacement du segment
          </div>
        </div>
      )}

      {/* Indicateur de resize */}
      {resizingSegmentId && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-orange-500/50 pointer-events-none">
          <div className="absolute left-1/2 -translate-x-1/2 -top-6 px-2 py-1 bg-orange-500 text-xs text-white rounded shadow-lg">
            Redimensionnement {resizeEdge === 'start' ? 'début' : 'fin'}
          </div>
        </div>
      )}

      {/* Zone vide - guide pour placement */}
      <div className="absolute top-0 left-0 right-0 text-center text-xs text-gray-500 p-2 pointer-events-none">
        Glissez-déposez les segments ou redimensionnez-les avec les poignées
      </div>
    </div>
  );
}