import StudioContainer from '@/components/studio/StudioContainer';

export function LiveJobProgress({
  jobId,
  status,
  onReset,
  onDownload
}: {
  jobId: string;
  status: any;
  onReset: () => void;
  onDownload?: () => void;
}) {
  return (
    <StudioContainer
      jobId={jobId}
      status={status}
      onReset={onReset}
      onDownload={onDownload}
    />
  );
}