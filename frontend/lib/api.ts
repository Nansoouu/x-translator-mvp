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

export async function getJobStatus(jobId: string) {
  const r = await fetch(`${API}/jobs/${jobId}/status`, { headers: authHeaders() });
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
