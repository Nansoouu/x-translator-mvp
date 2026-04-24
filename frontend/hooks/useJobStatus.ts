import { useState, useEffect, useCallback } from 'react';
import { getJobStatus } from '@/lib/api';

export interface JobStatusState {
  jobId: string;
  processingStage: string;
  progress: number;
  videoUrl?: string;
  transcription?: string;
  translation?: string;
  subtitleFile?: string;
  duration?: number; // Durée totale en secondes
  error?: string;
  loading: boolean;
}

export function useJobStatus(jobId: string, pollingInterval = 2000) {
  const [state, setState] = useState<JobStatusState>({
    jobId,
    processingStage: 'download',
    progress: 0,
    loading: true,
  });

  const fetchStatus = useCallback(async () => {
    try {
      const data = await getJobStatus(jobId);
      setState(prev => ({
        ...prev,
        processingStage: data.status || 'queued',
        progress: data.progress_pct || 0,
        videoUrl: data.storage_url,
        transcription: data.summary,
        translation: data.translation,
        subtitleFile: data.subtitle_file,
        duration: data.duration_s,
        error: data.error_msg,
        loading: false,
      }));
    } catch (error: any) {
      setState(prev => ({ 
        ...prev, 
        loading: false, 
        error: error?.message || "Failed to fetch status" 
      }));
    }
  }, [jobId]);

  useEffect(() => {
    const intervalId = setInterval(fetchStatus, pollingInterval);
    return () => clearInterval(intervalId);
  }, [fetchStatus, pollingInterval]);

  return state;
}