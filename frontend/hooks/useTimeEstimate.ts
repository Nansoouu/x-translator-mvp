import { useMemo } from 'react';

export interface TimeEstimateData {
  estimatedTotalSeconds?: number;
  estimatedBurnSeconds?: number;
  durationSeconds?: number;
  status?: string;
}

export interface TimeEstimateResult {
  // Temps estimés formatés
  totalEstimate: string;
  burnEstimate: string;
  // Pourcentage d'avancement basé sur le temps
  progressPercentage: number;
  // Temps restant estimé
  timeRemaining: string;
  // Détails techniques pour debug
  raw: {
    totalSeconds?: number;
    burnSeconds?: number;
    durationSeconds?: number;
  };
}

/**
 * Calcule les estimations de temps de traitement basées sur les données du job.
 * 
 * @param data Données du job avec estimations
 * @returns Estimations formatées pour l'affichage
 */
export function useTimeEstimate(data: TimeEstimateData): TimeEstimateResult {
  const result = useMemo((): TimeEstimateResult => {
    const { estimatedTotalSeconds, estimatedBurnSeconds, durationSeconds, status } = data;
    
    // Fonction de formatage des secondes en format lisible
    const formatSeconds = (seconds: number): string => {
      if (seconds < 60) {
        return `${Math.round(seconds)}s`;
      }
      
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = Math.round(seconds % 60);
      
      if (minutes < 60) {
        if (remainingSeconds === 0) {
          return `${minutes}m`;
        }
        return `${minutes}m${remainingSeconds}s`;
      }
      
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      
      if (remainingMinutes === 0) {
        return `${hours}h`;
      }
      return `${hours}h${remainingMinutes}m`;
    };

    // Formatage des estimations
    const totalEstimate = estimatedTotalSeconds 
      ? formatSeconds(estimatedTotalSeconds)
      : "calcul...";
    
    const burnEstimate = estimatedBurnSeconds
      ? formatSeconds(estimatedBurnSeconds)
      : "calcul...";

    // Calcul du pourcentage d'avancement basé sur le statut et les temps estimés
    let progressPercentage = 0;
    let timeRemaining = "calcul...";

    if (estimatedTotalSeconds && status) {
      // Mapping des statuts aux pourcentages approximatifs
      const statusProgressMap: Record<string, number> = {
        'queued': 5,
        'downloading': 15,
        'transcribing': 35,
        'translating': 60,
        'burning': 80,
        'uploading': 92,
        'done': 100,
        'error': 0,
      };

      const statusPercent = statusProgressMap[status] || 0;
      
      // Si on a le temps d'incrustation, on peut affiner l'estimation pendant le burn
      if (status === 'burning' && estimatedBurnSeconds && durationSeconds) {
        // Le burn est plus long, donc on ajuste la progression
        const burnProgress = 80; // Début du burn
        const uploadProgress = 92; // Fin du burn + upload
        const totalBurnProgressRange = uploadProgress - burnProgress;
        
        // Estimer où on en est dans le burn (basé sur la durée de la vidéo)
        // On suppose un burn linéaire avec la vidéo
        progressPercentage = burnProgress + (statusPercent - 80) * (totalBurnProgressRange / 20);
      } else {
        progressPercentage = statusPercent;
      }

      // Calcul du temps restant estimé
      if (progressPercentage > 0 && progressPercentage < 100) {
        const elapsedSeconds = estimatedTotalSeconds * (progressPercentage / 100);
        const remainingSeconds = estimatedTotalSeconds - elapsedSeconds;
        timeRemaining = formatSeconds(Math.max(0, remainingSeconds));
      } else if (progressPercentage === 100) {
        timeRemaining = "terminé";
      }
    }

    return {
      totalEstimate,
      burnEstimate,
      progressPercentage: Math.round(progressPercentage),
      timeRemaining,
      raw: {
        totalSeconds: estimatedTotalSeconds,
        burnSeconds: estimatedBurnSeconds,
        durationSeconds: durationSeconds,
      },
    };
  }, [data]);

  return result;
}

/**
 * Hook helper pour formater les secondes en format lisible
 * @param seconds Nombre de secondes
 * @returns Chaîne formatée
 */
export function useFormatSeconds(seconds?: number): string {
  return useMemo(() => {
    if (seconds === undefined || seconds === null) {
      return "calcul...";
    }
    
    if (seconds < 60) {
      return `${Math.round(seconds)}s`;
    }
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    
    if (minutes < 60) {
      if (remainingSeconds === 0) {
        return `${minutes}m`;
      }
      return `${minutes}m${remainingSeconds}s`;
    }
    
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    
    if (remainingMinutes === 0) {
      return `${hours}h`;
    }
    return `${hours}h${remainingMinutes}m`;
  }, [seconds]);
}