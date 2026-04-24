import { useTranslation } from '@/hooks/useTranslation';
import { useTimer } from '@/hooks/useTimer';
import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useTapeEffect } from '@/hooks/useFramerAnimation';

export function LiveTranscriptionPanel({ jobId, isTranslating }: { jobId: string; isTranslating?: boolean }) {
  const { sourceText, translatedText, loading, error } = useTranslation(jobId, 'fr', 'en');
  const { timeRemaining, startTimer, stopTimer } = useTimer();
  
  // Effet "tape" pour l'affichage progressif
  const sourceTape = useTapeEffect(sourceText || '', { speed: 30 });
  const translationTape = useTapeEffect(translatedText || '', { speed: 40, delay: 500 });

  useEffect(() => {
    if (isTranslating) {
      startTimer();
    } else {
      stopTimer();
    }
  }, [isTranslating, startTimer, stopTimer]);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-4 bg-gray-700 rounded animate-pulse w-3/4" />
        <div className="h-4 bg-gray-700 rounded animate-pulse w-1/2" />
        <div className="h-4 bg-gray-700 rounded animate-pulse w-5/6" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red-400 text-sm">
        Erreur de transcription : {error}
      </div>
    );
  }

  if (isTranslating) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm text-gray-400">
          <span>Traduction en cours...</span>
          <span>{timeRemaining}</span>
        </div>
        <div className="space-y-2">
          <div className="h-3 bg-gray-700 rounded animate-pulse" />
          <div className="h-3 bg-gray-700 rounded animate-pulse w-5/6" />
          <div className="h-3 bg-gray-700 rounded animate-pulse w-4/6" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-gray-300">Transcription originale</div>
      <motion.div 
        className="text-gray-300 text-sm leading-relaxed min-h-[60px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        {sourceTape.isAnimating ? (
          <div>
            <span className="text-gray-200">{sourceTape.displayText}</span>
            <motion.span
              animate={{ opacity: [1, 0] }}
              transition={{ repeat: Infinity, duration: 0.5 }}
              className="ml-1 inline-block w-2 h-4 bg-cyan-400"
            />
          </div>
        ) : (
          sourceText || "Aucune transcription disponible"
        )}
      </motion.div>

      <div className="border-t border-gray-700/50 pt-3">
        <div className="text-sm font-medium text-cyan-400">Traduction</div>
        <motion.div 
          className="text-gray-300 text-sm leading-relaxed mt-1 min-h-[60px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.2 }}
        >
          {translationTape.isAnimating ? (
            <div>
              <span className="text-gray-200">{translationTape.displayText}</span>
              <motion.span
                animate={{ opacity: [1, 0] }}
                transition={{ repeat: Infinity, duration: 0.5 }}
                className="ml-1 inline-block w-2 h-4 bg-blue-400"
              />
            </div>
          ) : (
            translatedText || "Aucune traduction disponible"
          )}
        </motion.div>
      </div>
    </div>
  );
}