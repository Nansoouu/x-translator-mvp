'use client';
import { useState } from 'react';
import { login, register } from '@/lib/api';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [mode, setMode]         = useState<'login' | 'register'>('login');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = mode === 'login'
        ? await login(email, password)
        : await register(email, password);
      if (res.access_token) {
        localStorage.setItem('access_token', res.access_token);
        router.push('/');
      } else {
        setError('Compte créé — vérifiez votre email.');
      }
    } catch (err: any) {
      setError(err?.detail || err?.message || 'Erreur');
    } finally { setLoading(false); }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-xl p-8">
        <h1 className="text-2xl font-bold mb-6 text-center">
          {mode === 'login' ? 'Connexion' : 'Créer un compte'}
        </h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
            placeholder="Email" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500" />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
            placeholder="Mot de passe" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500" />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 font-semibold py-3 rounded-lg">
            {loading ? '…' : mode === 'login' ? 'Se connecter' : "S'inscrire"}
          </button>
        </form>
        <p className="text-center text-zinc-400 text-sm mt-4">
          {mode === 'login' ? "Pas de compte ? " : "Déjà inscrit ? "}
          <button onClick={() => setMode(mode === 'login' ? 'register' : 'login')} className="text-blue-400 hover:underline">
            {mode === 'login' ? "S'inscrire" : 'Se connecter'}
          </button>
        </p>
        <p className="text-center mt-4"><a href="/" className="text-zinc-500 text-sm hover:text-white">← Retour</a></p>
      </div>
    </main>
  );
}
