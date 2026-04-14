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
      setError(err?.detail || err?.message || 'Identifiants incorrects.');
    } finally { setLoading(false); }
  }

  return (
    <main className="h-screen overflow-y-auto bg-gray-950 text-white flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-base">
              🌍
            </div>
            <span className="text-sm font-bold tracking-tight text-white group-hover:text-blue-300 transition-colors">
              SpottedYou <span className="text-blue-400">Translator</span>
            </span>
          </Link>
        </div>

        <div className="bg-gray-900/60 border border-gray-800 rounded-2xl overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-gray-800">
            {(['login', 'register'] as const).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(null); setSuccess(null); }}
                className={`flex-1 py-3 text-xs font-medium transition-colors ${
                  mode === m
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/40'
                }`}
              >
                {m === 'login' ? 'Connexion' : 'Créer un compte'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 block mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="vous@exemple.com"
                className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40 transition-colors"
              />
            </div>

            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 block mb-2">
                Mot de passe
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                minLength={mode === 'register' ? 8 : undefined}
                className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40 transition-colors"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs px-4 py-3 rounded-xl">
                ⚠️ {error}
              </div>
            )}
            {success && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs px-4 py-3 rounded-xl">
                ✅ {success}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors shadow-lg shadow-blue-500/20"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Chargement…
                </>
              ) : (
                mode === 'login' ? 'Se connecter →' : 'Créer mon compte →'
              )}
            </button>
          </form>
        </div>

        <p className="text-center mt-5">
          <Link href="/" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
            ← Retour à l'accueil
          </Link>
        </p>
      </div>
    </main>
  );
}
