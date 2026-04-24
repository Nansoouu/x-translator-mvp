'use client';
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

export default function LoginPage() {
  const t = useTranslations('LoginPage');
  const [mode, setMode]         = useState<'login' | 'register'>('login');
  const [email, setEmail]       = useState('');
  const [emailConfirm, setEmailConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [success, setSuccess]   = useState<string | null>(null);

  const { login, register, loading, error: authError } = useAuth();
  const router = useRouter();

  const error = localError || authError;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setSuccess(null);
    try {
      if (mode === 'login') {
        await login(email, password);
        window.location.href = '/';
      } else {
        if (email !== emailConfirm) {
          throw new Error(t('emailMismatch'));
        }
        if (password !== passwordConfirm) {
          throw new Error(t('passwordMismatch'));
        }
        if (!emailConfirm || !passwordConfirm) {
          throw new Error(t('confirmRequired'));
        }
        const res = await register(email, password);
        if (res?.access_token) {
          window.location.href = '/';
        } else {
          setSuccess(t('registerSuccess'));
        }
      }
    } catch (err: any) {
      setLocalError(err?.message || t('genericError'));
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
              </svg>
            </div>
            <span className="text-sm font-bold tracking-tight text-white group-hover:text-blue-300 transition-colors">
              SpottedYou <span className="text-blue-400">Translator</span>
            </span>
          </Link>
          <p className="text-xs text-gray-600 mt-2">
            {mode === 'login' ? t('subtitle') : t('registerSubtitle')}
          </p>
        </div>

        <div className="bg-gray-900/60 border border-gray-800 rounded-2xl overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-gray-800">
            {(['login', 'register'] as const).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setLocalError(null); setSuccess(null); }}
                className={`flex-1 py-3 text-xs font-medium transition-colors ${
                  mode === m
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/40'
                }`}
              >
                {m === 'login' ? t('switchToLogin') : t('switchToRegister')}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 block mb-2">
                {t('emailLabel')}
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder={t('emailPlaceholder')}
                className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40 transition-colors"
              />
            </div>

            {mode === 'register' && (
              <div>
                <label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 block mb-2">
                  {t('confirmEmailLabel')}
                </label>
                <input
                  type="email"
                  value={emailConfirm}
                  onChange={e => setEmailConfirm(e.target.value)}
                  required
                  placeholder={t('emailPlaceholder')}
                  autoComplete="off"
                  onPaste={(e) => e.preventDefault()}
                  className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40 transition-colors"
                />
              </div>
            )}

            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 block mb-2">
                {t('passwordLabel')}
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder={t('passwordPlaceholder')}
                minLength={mode === 'register' ? 8 : undefined}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40 transition-colors"
              />
              {mode === 'register' && (
                <p className="text-[10px] text-gray-600 mt-1">{t('passwordHint')}</p>
              )}
            </div>

            {mode === 'register' && (
              <div>
                <label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 block mb-2">
                  {t('confirmPasswordLabel')}
                </label>
                <input
                  type="password"
                  value={passwordConfirm}
                  onChange={e => setPasswordConfirm(e.target.value)}
                  required
                  placeholder={t('passwordPlaceholder')}
                  autoComplete="new-password"
                  onPaste={(e) => e.preventDefault()}
                  className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40 transition-colors"
                />
              </div>
            )}

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
                  {mode === 'login' ? t('loggingIn') : t('registering')}
                </>
              ) : (
                mode === 'login' ? t('loginButton') : t('registerButton')
              )}
            </button>

            {mode === 'register' && (
              <p className="text-[10px] text-gray-600 text-center leading-relaxed">
                {t('terms')}
              </p>
            )}
          </form>
        </div>

        <p className="text-center mt-5">
          {mode === 'login' ? (
            <>
              <span className="text-xs text-gray-600">{t('noAccount')} </span>
              <button onClick={() => { setMode('register'); setLocalError(null); setSuccess(null); }} className="text-xs text-blue-500 hover:text-blue-400 underline transition-colors">{t('registerLink')}</button>
            </>
          ) : (
            <>
              <span className="text-xs text-gray-600">{t('alreadyAccount')} </span>
              <button onClick={() => { setMode('login'); setLocalError(null); setSuccess(null); }} className="text-xs text-blue-500 hover:text-blue-400 underline transition-colors">{t('loginLink')}</button>
            </>
          )}
        </p>
      </div>
    </main>
  );
}