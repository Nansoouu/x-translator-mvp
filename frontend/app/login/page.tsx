'use client';
import { useState } from 'react';
import { login, register } from '@/lib/api';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const [mode, setMode]         = useState<'login' | 'register'>('login');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState<string | null>(null);
  const [success, setSuccess]   = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const res = mode === 'login'
        ? await login(email, password)
        : await register(email, password);
      if (res.access_token) {
        localStorage.setItem('access_token', res.access_token);
        router.push('/');
      } else {
        setSuccess('Compte créé ! Vérifiez votre email pour confirmer.');
      }
    } catch (err: any) {
      setError(err?.detail || err?.message || 'Erreur. Vérifiez vos identifiants.');
    } finally { setLoading(false); }
  }

  return (
    <main className="min-h-screen bg-grid flex flex-col items-center justify-center px-4 py-20">
      {/* Glow */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{ background: 'radial-gradient(ellipse 50% 50% at 50% 30%, rgba(59,130,246,0.08), transparent)' }}
      />

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-xl font-bold">
            <span className="text-3xl">🌍</span>
            <span>Spotted<span className="text-blue-400">You</span> Translator</span>
          </Link>
        </div>

        <div className="card p-8 shadow-2xl shadow-black/60">
          {/* Tabs */}
          <div className="flex bg-zinc-800/60 rounded-xl p-1 mb-7">
            {(['login', 'register'] as const).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(null); setSuccess(null); }}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition ${
                  mode === m
                    ? 'bg-zinc-700 text-white shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {m === 'login' ? 'Connexion' : 'Créer un compte'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1.5 block">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="vous@exemple.com"
                className="input-base"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1.5 block">
                Mot de passe
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder={mode === 'register' ? '8 caractères minimum' : '••••••••'}
                minLength={mode === 'register' ? 8 : undefined}
                className="input-base"
              />
            </div>

            {error && (
              <div className="flex gap-2 items-start bg-red-950/50 border border-red-900/50 text-red-400 text-sm p-3 rounded-xl">
                <span className="shrink-0 mt-0.5">⚠️</span><p>{error}</p>
              </div>
            )}
            {success && (
              <div className="flex gap-2 items-start bg-emerald-950/50 border border-emerald-900/50 text-emerald-400 text-sm p-3 rounded-xl">
                <span className="shrink-0 mt-0.5">✅</span><p>{success}</p>
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary text-base py-3.5 mt-2">
              {loading
                ? <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    Chargement…
                  </span>
                : mode === 'login' ? 'Se connecter →' : "Créer mon compte →"
              }
            </button>
          </form>

          {mode === 'login' && (
            <p className="text-center text-zinc-500 text-xs mt-5">
              En continuant, vous acceptez nos{' '}
              <span className="text-zinc-400">conditions d'utilisation</span>.
            </p>
          )}
        </div>

        <p className="text-center mt-5">
          <Link href="/" className="text-zinc-600 hover:text-zinc-400 text-sm transition">
            ← Retour à l'accueil
          </Link>
        </p>
      </div>
    </main>
  );
}
