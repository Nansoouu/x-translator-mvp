"use client";

import { motion } from 'framer-motion';
import type { TimelineControlsProps, TimelineSegment } from './types';

export default function TimelineControls({
  isPlaying,
  currentTime,
  duration,
  selectedSegments,
  onPlayPause,
  onSeek,
  onSplit,
  onMerge,
  onDelete,
  onExport,
  onModeToggle
}: TimelineControlsProps) {
  const hasSelection = selectedSegments.length > 0;
  const canSplit = selectedSegments.length === 1;
  const canMerge = selectedSegments.length >= 2;

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  };

  const getSelectionStats = () => {
    if (!hasSelection) return null;
    
    const totalDuration = selectedSegments.reduce((sum, seg) => sum + seg.duration, 0);
    const avgDuration = totalDuration / selectedSegments.length;
    
    return {
      count: selectedSegments.length,
      totalDuration: totalDuration.toFixed(1),
      avgDuration: avgDuration.toFixed(1)
    };
  };

  const selectionStats = getSelectionStats();

  return (
    <div className="space-y-4">
      {/* Contrôles playback */}
      <div className="flex items-center justify-between bg-gray-800/50 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <motion.button
            onClick={onPlayPause}
            className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center hover:bg-blue-700 transition-colors shadow-lg"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            title={isPlaying ? "Pause" : "Play"}
          >
            <span className="text-xl">
              {isPlaying ? '⏸️' : '▶️'}
            </span>
          </motion.button>

          <div className="space-y-1">
            <div className="text-sm text-gray-400">Temps actuel</div>
            <div className="text-lg font-mono font-bold text-white">
              {formatTime(currentTime)}
            </div>
          </div>

          <div className="text-gray-500">/</div>

          <div className="space-y-1">
            <div className="text-sm text-gray-400">Durée totale</div>
            <div className="text-lg font-mono text-gray-300">
              {formatTime(duration)}
            </div>
          </div>
        </div>

        {/* Timeline slider */}
        <div className="flex-1 max-w-xl mx-6">
          <input
            type="range"
            min="0"
            max={duration}
            step="0.1"
            value={currentTime}
            onChange={(e) => onSeek?.(parseFloat(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:hover:bg-cyan-400"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>0:00</span>
            <span>{formatTime(duration / 2)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onModeToggle?.('list')}
            className="px-4 py-2 bg-gray-800 text-gray-300 rounded hover:bg-gray-700 transition-colors text-sm flex items-center gap-2"
            title="Basculer vers la vue liste"
          >
            📋 Liste
          </button>
        </div>
      </div>

      {/* Contrôles d'édition */}
      <div className="flex flex-wrap items-center gap-3 bg-gray-800/30 rounded-lg p-4">
        {/* Statistiques de sélection */}
        {selectionStats && (
          <motion.div
            className="px-3 py-2 bg-cyan-900/30 rounded border border-cyan-700/50"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <div className="text-sm text-cyan-300">
              {selectionStats.count} segment(s) sélectionné(s)
            </div>
            <div className="text-xs text-cyan-400">
              Durée totale: {selectionStats.totalDuration}s • Moyenne: {selectionStats.avgDuration}s
            </div>
          </motion.div>
        )}

        {/* Bouton Split */}
        <motion.button
          onClick={() => canSplit && onSplit?.(selectedSegments[0].id)}
          disabled={!canSplit}
          className={`px-4 py-2 rounded flex items-center gap-2 transition-all ${canSplit ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-gray-700/50 text-gray-500 cursor-not-allowed'}`}
          whileHover={canSplit ? { scale: 1.05 } : {}}
          whileTap={canSplit ? { scale: 0.95 } : {}}
          title={canSplit ? "Diviser le segment sélectionné (✂️)" : "Sélectionnez un segment pour le diviser"}
        >
          <span>✂️</span>
          <span className="text-sm font-medium">Diviser</span>
        </motion.button>

        {/* Bouton Merge */}
        <motion.button
          onClick={() => canMerge && onMerge?.(selectedSegments.map(s => s.id))}
          disabled={!canMerge}
          className={`px-4 py-2 rounded flex items-center gap-2 transition-all ${canMerge ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-gray-700/50 text-gray-500 cursor-not-allowed'}`}
          whileHover={canMerge ? { scale: 1.05 } : {}}
          whileTap={canMerge ? { scale: 0.95 } : {}}
          title={canMerge ? "Fusionner les segments sélectionnés (🧲)" : "Sélectionnez au moins 2 segments pour fusionner"}
        >
          <span>🧲</span>
          <span className="text-sm font-medium">Fusionner</span>
        </motion.button>

        {/* Bouton Delete */}
        <motion.button
          onClick={() => hasSelection && onDelete?.(selectedSegments.map(s => s.id))}
          disabled={!hasSelection}
          className={`px-4 py-2 rounded flex items-center gap-2 transition-all ${hasSelection ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-gray-700/50 text-gray-500 cursor-not-allowed'}`}
          whileHover={hasSelection ? { scale: 1.05 } : {}}
          whileTap={hasSelection ? { scale: 0.95 } : {}}
          title={hasSelection ? "Supprimer les segments sélectionnés (🗑️)" : "Sélectionnez des segments pour supprimer"}
        >
          <span>🗑️</span>
          <span className="text-sm font-medium">Supprimer</span>
        </motion.button>

        <div className="flex-1"></div>

        {/* Bouton Export */}
        <motion.button
          onClick={() => onExport?.()}
          className="px-4 py-2 bg-cyan-600 text-white rounded hover:bg-cyan-700 transition-colors text-sm flex items-center gap-2"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          title="Exporter la timeline (📤)"
        >
          <span>📤</span>
          <span className="font-medium">Exporter</span>
        </motion.button>
      </div>

      {/* Raccourcis clavier */}
      <div className="flex items-center justify-center gap-6 text-xs text-gray-500 bg-gray-900/30 rounded p-3">
        <div className="flex items-center gap-1">
          <kbd className="px-2 py-1 bg-gray-800 rounded border border-gray-700">Space</kbd>
          <span>Play/Pause</span>
        </div>
        <div className="flex items-center gap-1">
          <kbd className="px-2 py-1 bg-gray-800 rounded border border-gray-700">S</kbd>
          <span>Split</span>
        </div>
        <div className="flex items-center gap-1">
          <kbd className="px-2 py-1 bg-gray-800 rounded border border-gray-700">M</kbd>
          <span>Merge</span>
        </div>
        <div className="flex items-center gap-1">
          <kbd className="px-2 py-1 bg-gray-800 rounded border border-gray-700">Del</kbd>
          <span>Delete</span>
        </div>
        <div className="flex items-center gap-1">
          <kbd className="px-2 py-1 bg-gray-800 rounded border border-gray-700">Shift</kbd>
          <span>+ Click: Sélection multiple</span>
        </div>
      </div>
    </div>
  );
}