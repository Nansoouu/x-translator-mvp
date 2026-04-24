import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SubtitleSegment } from './types';
import { Play, Pause, Volume2 } from 'lucide-react';
import { useCurrentTime, useIsPlaying, useTimelineActions } from '@/store/timeline-store';

interface Props {
  jobId: string;
  src?: string;
  thumbnail?: string;
  previewSegments?: SubtitleSegment[];
  isRendering?: boolean;
  isDone?: boolean;
  onTimeUpdate?: (currentTime: number) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
}

export const VideoPlayerWithOverlay: React.FC<Props> = ({
  jobId,
  src,
  thumbnail,
  previewSegments = [],
  isRendering = false,
  isDone = false,
  onTimeUpdate,
  onPlayStateChange,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const storeCurrentTime = useCurrentTime();
  const storeIsPlaying = useIsPlaying();
  const { setCurrentTime, setIsPlaying } = useTimelineActions();
  const [duration, setDuration] = useState(0);

  const activeSubtitles = useMemo(() => {
    if (isRendering || !previewSegments.length) return [];
    return previewSegments.filter(
      (seg) => storeCurrentTime >= (seg.startTime || 0) && storeCurrentTime <= (seg.endTime || 0)
    );
  }, [storeCurrentTime, previewSegments, isRendering]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      const time = video.currentTime;
      setCurrentTime(time);
      onTimeUpdate?.(time);
    };
    const handleLoaded = () => setDuration(video.duration || 0);
    const handlePlay = () => {
      setIsPlaying(true);
      onPlayStateChange?.(true);
    };
    const handlePause = () => {
      setIsPlaying(false);
      onPlayStateChange?.(false);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoaded);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, [onTimeUpdate, onPlayStateChange]);

  const videoSrc = src || `/api/jobs/${jobId}/stream`;

  return (
    <div className="relative w-full aspect-video bg-black rounded-3xl overflow-hidden shadow-2xl">
      <video
        ref={videoRef}
        src={videoSrc}
        poster={thumbnail}
        className="w-full h-full object-contain"
        controls={isDone}
        playsInline
        onClick={() => videoRef.current?.[storeIsPlaying ? 'pause' : 'play']()}
      />

      {/* Sous-titres overlay - Style TikTok/CapCut */}
      <AnimatePresence>
        {!isRendering &&
          activeSubtitles.map((seg) => (
            <motion.div
              key={seg.id}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 15 }}
              className="absolute left-1/2 -translate-x-1/2 bottom-14 px-8 py-3.5 
                         bg-black/90 backdrop-blur-2xl border border-white/10 
                         rounded-2xl text-white text-center text-[17px] leading-tight 
                         font-medium max-w-[86%] shadow-2xl"
              style={{ textShadow: '0 2px 10px rgba(0,0,0,0.95)' }}
            >
              {seg.translation || seg.text}
            </motion.div>
          ))}
      </AnimatePresence>

      {/* Overlay pendant le rendu */}
      {isRendering && (
        <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center z-20">
          <div className="text-6xl mb-6 animate-pulse">🎬</div>
          <p className="text-xl font-semibold">Rendu des sous-titres en cours...</p>
          <p className="text-gray-400 mt-2">Patientez quelques secondes</p>
        </div>
      )}
    </div>
  );
};
