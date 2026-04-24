const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

function authHeaders(): HeadersInit {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function submitJob(sourceUrl: string, targetLang: string) {
  const r = await fetch(`${API}/jobs/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ source_url: sourceUrl, target_lang: targetLang }),
  });
  if (!r.ok) throw await r.json();
  return r.json();
}

export async function uploadVideoFile(
  file: File,
  mode: 'download' | 'translate',
  targetLang: string = 'fr'
) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('mode', mode);
  formData.append('target_lang', targetLang);
  
  const r = await fetch(`${API}/jobs/upload`, {
    method: 'POST',
    headers: { ...authHeaders() },
    body: formData,
  });
  if (!r.ok) throw await r.json();
  return r.json();
}

export async function getJobStatus(jobId: string) {
  const r = await fetch(`${API}/jobs/${jobId}/status`, { headers: authHeaders() });
  if (!r.ok) throw await r.json();
  return r.json();
}

export async function getTranscriptionSegments(jobId: string) {
  const r = await fetch(`${API}/jobs/${jobId}/transcription`, { headers: authHeaders() });
  if (!r.ok) throw await r.json();
  const data = await r.json();
  // Retourner les segments complets
  return data.segments || [];
}

export async function getTranscription(jobId: string): Promise<string> {
  const r = await fetch(`${API}/jobs/${jobId}/transcription`, { headers: authHeaders() });
  if (!r.ok) throw await r.json();
  const data = await r.json();
  // Concaténer tous les textes des segments
  const segments = data.segments || [];
  return segments.map((seg: any) => seg.text || "").join(" ");
}

export async function getTranslation(jobId: string, sourceLang: string, targetLang: string) {
  const r = await fetch(`${API}/jobs/${jobId}/translate?source=${sourceLang}&target=${targetLang}`, {
    headers: authHeaders(),
  });
  if (!r.ok) throw await r.json();
  const data = await r.json();
  // Extraire la traduction de tous les segments
  // L'API peut retourner un tableau directement ou un objet avec champ 'segments'
  let segments = [];
  if (Array.isArray(data)) {
    segments = data;
  } else if (data.segments && Array.isArray(data.segments)) {
    segments = data.segments;
  }
  if (segments.length > 0) {
    return segments.map((seg: any) => seg.translation || "").join(" ");
  }
  return "";
}

export async function getTranslatedSegments(jobId: string) {
  const r = await fetch(`${API}/jobs/${jobId}/translate`, {
    headers: authHeaders(),
  });
  if (!r.ok) throw await r.json();
  const data = await r.json();
  // Retourner les segments complets
  return data.segments || [];
}

export async function updateSegment(jobId: string, segmentId: string, translation: string, startTime: number, endTime: number) {
  const r = await fetch(`${API}/jobs/${jobId}/segments/${segmentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ translation, start_time: startTime, end_time: endTime }),
  });
  if (!r.ok) throw await r.json();
  return r.json();
}

export async function listUserJobs() {
  const r = await fetch(`${API}/jobs/`, { headers: authHeaders() });
  if (!r.ok) return [];
  return r.json();
}

export async function login(email: string, password: string) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw await r.json();
  return r.json();
}

export async function register(email: string, password: string) {
  const r = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw await r.json();
  return r.json();
}

export async function getPublicLibrary() {
  const r = await fetch(`${API}/jobs/public`);
  if (!r.ok) return [];
  return r.json();
}

export async function getQueueStats() {
  const r = await fetch(`${API}/jobs/queue-stats`);
  if (!r.ok) return { active_count: 0, queued_count: 0, estimated_wait_s: 0 };
  return r.json();
}

export async function getBillingStatus() {
  const r = await fetch(`${API}/billing/status`, { headers: authHeaders() });
  if (!r.ok) return null;
  return r.json();
}

export async function createCheckout(plan: string) {
  const r = await fetch(`${API}/billing/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ plan }),
  });
  if (!r.ok) throw await r.json();
  return r.json();
}

export async function getVideoStreamUrl(jobId: string): Promise<string> {
  // L'URL de streaming est retournée par getJobStatus
  // Cette fonction est une helper pour construire l'URL correcte
  return `${API}/jobs/${jobId}/stream`;
}

// ── Timeline Editor ───────────────────────────────────────────────────────────

export async function deleteSegment(jobId: string, segmentId: string): Promise<void> {
  const r = await fetch(`${API}/jobs/${jobId}/segments/${segmentId}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  if (!r.ok) throw await r.json();
  // DELETE réussi : 204 No Content
}

export async function getOriginalSrt(jobId: string): Promise<string> {
  const r = await fetch(`${API}/jobs/${jobId}/transcription/srt`, {
    headers: authHeaders(),
  });
  if (!r.ok) throw await r.json();
  return await r.text();
}

export async function regenerateVideo(jobId: string): Promise<{ export_id: string; status: string }> {
  const r = await fetch(`${API}/jobs/${jobId}/transcription/regenerate`, {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  if (!r.ok) throw await r.json();
  return await r.json();
}

export async function exportClips(
  jobId: string,
  segmentIds: string[],
  options: { format?: string; concat?: boolean } = {}
): Promise<{
  status: string;
  clips: Array<{ segment_id: string; start_s: number; end_s: number; duration: number; url: string | null }>;
  concat_url: string | null;
  format: string;
  clip_count: number;
  total_duration: number;
}> {
  const r = await fetch(`${API}/jobs/${jobId}/export-clips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      segment_ids: segmentIds,
      format: options.format || "16:9",
      concat: options.concat ?? true,
    }),
  });
  if (!r.ok) throw await r.json();
  return await r.json();
}

export async function reorderSegments(
  jobId: string,
  segmentOrders: Array<{ segmentId: string; newOrder: number }>
): Promise<void> {
  // Pour chaque segment, envoyer une requête PUT
  const promises = segmentOrders.map(({ segmentId, newOrder }) =>
    fetch(`${API}/jobs/${jobId}/segments/${segmentId}/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ segment_id: segmentId, new_order: newOrder }),
    })
  );
  
  const results = await Promise.all(promises);
  for (const r of results) {
    if (!r.ok) {
      const error = await r.json();
      throw new Error(`Reordering failed: ${error.message || r.statusText}`);
    }
  }
}

export async function splitSegment(
  jobId: string,
  segmentId: string,
  splitTime: number
): Promise<{ segments: Array<{ id: string; startTime: number; endTime: number; text: string; translation: string; style: object }>; message: string }> {
  const r = await fetch(`${API}/jobs/${jobId}/segments/${segmentId}/split`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ split_time: splitTime }),
  });
  if (!r.ok) {
    const error = await r.json();
    throw new Error(`Split failed: ${error.detail || error.message || r.statusText}`);
  }
  return await r.json();
}

export async function mergeSegments(
  jobId: string,
  segmentIds: string[]
): Promise<{ segment: { id: string; startTime: number; endTime: number; text: string; translation: string; style: object }; message: string }> {
  const r = await fetch(`${API}/jobs/${jobId}/segments/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ segment_ids: segmentIds }),
  });
  if (!r.ok) {
    const error = await r.json();
    throw new Error(`Merge failed: ${error.detail || error.message || r.statusText}`);
  }
  return await r.json();
}

// ── Studio ────────────────────────────────────────────────────────────────────

export async function createStudioProject(params: { source_url?: string; source_job_id?: string }) {
  const r = await fetch(`${API}/studio/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(params),
  });
  if (!r.ok) throw await r.json();
  return r.json();
}

export async function listStudioProjects() {
  const r = await fetch(`${API}/studio/projects`, { headers: authHeaders() });
  if (!r.ok) return [];
  return r.json();
}

export async function getStudioProject(projectId: string) {
  const r = await fetch(`${API}/studio/projects/${projectId}`, { headers: authHeaders() });
  if (!r.ok) throw await r.json();
  return r.json();
}

export async function createStudioExport(projectId: string, params: {
  clip_ids: string[];
  format: string;
  translate_to?: string;
}) {
  const r = await fetch(`${API}/studio/projects/${projectId}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(params),
  });
  if (!r.ok) throw await r.json();
  return r.json();
}

export async function getStudioExport(exportId: string) {
  const r = await fetch(`${API}/studio/exports/${exportId}`, { headers: authHeaders() });
  if (!r.ok) throw await r.json();
  return r.json();
}