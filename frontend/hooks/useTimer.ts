import { useState, useEffect, useCallback, useMemo } from 'react';

export interface TimerState {
  timeRemaining: string;
  startTimer: () => void;
  stopTimer: () => void;
  isRunning: boolean;
  estimatedTimeRemaining: string;
}

export interface TimerProps {
  duration?: number; // Durée totale en secondes
  progress?: number; // Progression en pourcentage (0-100)
}

export function useTimer(props?: TimerProps): TimerState {
  const { duration = 0, progress = 0 } = props || {};
  const [isRunning, setIsRunning] = useState(false);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [intervalId, setIntervalId] = useState<NodeJS.Timeout | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);

  const formatTime = (seconds: number): string => {
    if (seconds <= 0) return '00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hrs > 0) {
      return `${String(hrs)}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Temps écoulé formaté
  const timeRemaining = useMemo(() => formatTime(elapsedTime), [elapsedTime]);
  
  // Calcul du temps estimé restant basé sur la durée totale et la progression
  const calculateEstimatedTimeRemaining = useCallback(() => {
    if (!duration || duration <= 0) return '--:--';
    
    // Si on a une durée totale et une progression, on peut estimer le temps restant
    // Temps total estimé = durée * (100 / progress) si progress > 0
    // Temps restant = temps total estimé - temps écoulé
    if (progress > 0 && progress < 100) {
      const estimatedTotalTime = (duration * 100) / progress;
      const timeRemainingSeconds = Math.max(0, estimatedTotalTime - elapsedTime);
      return formatTime(timeRemainingSeconds);
    }
    
    // Sinon, on utilise la durée restante simple
    const timeRemainingSeconds = Math.max(0, duration - elapsedTime);
    return formatTime(timeRemainingSeconds);
  }, [duration, progress, elapsedTime]);

  // Temps estimé restant
  const estimatedTimeRemaining = useMemo(
    () => calculateEstimatedTimeRemaining(),
    [calculateEstimatedTimeRemaining]
  );

  const startTimer = useCallback(() => {
    if (isRunning && intervalId) return; // Éviter de démarrer plusieurs fois
    
    setIsRunning(true);
    setStartTime(Date.now());
    setElapsedTime(0);
    const id = setInterval(() => {
      setElapsedTime(prev => prev + 1);
    }, 1000);
    setIntervalId(id);
  }, [isRunning, intervalId]);

  const stopTimer = useCallback(() => {
    setIsRunning(false);
    if (intervalId) {
      clearInterval(intervalId);
      setIntervalId(null);
    }
  }, [intervalId]);

  useEffect(() => {
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [intervalId]);

  return { 
    timeRemaining, 
    startTimer, 
    stopTimer, 
    isRunning,
    estimatedTimeRemaining 
  };
}
