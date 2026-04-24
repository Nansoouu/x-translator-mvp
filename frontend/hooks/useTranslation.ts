import { useState, useEffect, useCallback } from 'react';
import { getTranscription, getTranslation } from '@/lib/api';

export interface TranslationState {
  jobId: string;
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  loading: boolean;
  error?: string;
}

export function useTranslation(jobId: string, sourceLang: string, targetLang: string, enabled = true) {
  const [state, setState] = useState<TranslationState>({
    jobId,
    sourceText: '',
    translatedText: '',
    sourceLang,
    targetLang,
    loading: true,
  });

  const fetchTranslation = useCallback(async () => {
    try {
      const [source, translation] = await Promise.all([
        getTranscription(jobId),
        getTranslation(jobId, sourceLang, targetLang),
      ]);
      setState(prev => ({
        ...prev,
        sourceText: source,
        translatedText: translation,
        loading: false,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setState(prev => ({ ...prev, loading: false, error: errorMessage }));
    }
  }, [jobId, sourceLang, targetLang]);

  useEffect(() => {
    if (enabled) {
      fetchTranslation();
    }
  }, [fetchTranslation, enabled]);

  return state;
}