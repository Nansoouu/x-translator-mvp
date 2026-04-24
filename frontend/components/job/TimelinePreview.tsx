import { useJobStatus } from '@/hooks/useJobStatus';

export function TimelinePreview({ jobId }: { jobId: string }) {
  const jobStatus = useJobStatus(jobId);

  return (
    <div className="mt-4 space-y-2">
      <div className="text-sm font-medium text-gray-300 mb-2">Timeline Aperçu</div>
      <div className="grid grid-cols-5 gap-1">
        {Array.from({ length: 20 }).map((_, i) => {
          const isProcessed = i < 12;
          return (
            <div
              key={i}
              className={`aspect-square rounded ${isProcessed ? 'bg-cyan-500/30' : 'bg-gray-700/30'} border border-gray-600/50`}
              title={`Segment ${i + 1}`}
            />
          );
        })}
      </div>
      <div className="text-xs text-gray-500 mt-2">
        Traité: {jobStatus.progress || 0}%
      </div>
    </div>
  );
};