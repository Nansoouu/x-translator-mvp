'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/components/I18nProvider';
import { useTranslations } from 'next-intl';

export default function Navbar() {
  const { isAuthenticated, user, logout, loading } = useAuth();
  const { locale, setLocale, localeFlags, localeNames, locales } = useI18n();
  const [mounted, setMounted]       = useState(false);
  const [langOpen, setLangOpen]     = useState(false);
  const langRef                     = useRef<HTMLDivElement>(null);

  // useTranslations est safe car I18nProvider injecte toujours fr.json par défaut
  const t = useTranslations('Navbar');

  useEffect(() => { setMounted(true); }, []);

  // Fermer le dropdown si click dehors
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangOpen(false);
      }
    }
    if (langOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [langOpen]);

  function handleLogout() {
    logout();
    window.location.href = '/';
  }

  const currentFlag = localeFlags[locale] ?? '🌐';

  return (
    <nav className="sticky top-0 z-50 border-b border-gray-800 bg-gray-950/90 backdrop-blur-md">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-7 h-7 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
            <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
            </svg>
          </div>
          <span className="text-sm font-bold tracking-tight text-white group-hover:text-blue-300 transition-colors">
            {t('brand')} <span className="text-blue-400">{t('brandHighlight')}</span>
          </span>
        </Link>

        {/* Nav links */}
        <div className="flex items-center gap-1">
          <Link
            href="/library"
            className="text-xs text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-800 hidden sm:block"
          >
            {t('myVideos')}
          </Link>
          <Link
            href="/studio"
            className="text-xs text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-800 hidden sm:block flex items-center gap-1.5"
          >
            ✂️ Studio
          </Link>
          <Link
            href="/billing"
            className="text-xs text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-800 hidden sm:block"
          >
            {t('billing')}
          </Link>

          {/* ── Sélecteur de langue ─────────────────────────────────────── */}
          {mounted && (
            <div ref={langRef} className="relative">
              <button
                onClick={() => setLangOpen((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors px-2.5 py-1.5 rounded-lg hover:bg-gray-800 border border-transparent hover:border-gray-700"
                title="Changer de langue"
              >
                <span className="text-base leading-none">{currentFlag}</span>
                <span className="hidden sm:block font-medium">{locale.toUpperCase()}</span>
                <svg className={`w-3 h-3 transition-transform ${langOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Dropdown */}
              {langOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-52 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl shadow-black/50 overflow-hidden z-50">
                  <div className="max-h-72 overflow-y-auto py-1 scrollbar-thin">
                    {(locales as unknown as string[]).map((loc) => {
                      const flag    = localeFlags[loc as keyof typeof localeFlags] ?? '🌐';
                      const name    = localeNames[loc as keyof typeof localeNames] ?? loc;
                      const isActive = loc === locale;
                      return (
                        <button
                          key={loc}
                          onClick={() => { setLocale(loc as typeof locale); setLangOpen(false); }}
                          className={`
                            w-full flex items-center gap-3 px-3 py-2 text-left text-xs transition-colors
                            ${isActive
                              ? 'bg-blue-600/20 text-blue-300 font-semibold'
                              : 'text-gray-300 hover:bg-gray-800 hover:text-white'}
                          `}
                        >
                          <span className="text-base w-5 text-center leading-none">{flag}</span>
                          <span className="flex-1">{name}</span>
                          {isActive && (
                            <svg className="w-3 h-3 text-blue-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Auth ───────────────────────────────────────────────────── */}
          {mounted && !loading && (
            isAuthenticated ? (
              <div className="flex items-center gap-2">
                {user?.email && (
                  <span className="text-[10px] text-gray-600 hidden sm:block truncate max-w-[120px]">
                    {user.email}
                  </span>
                )}
                <button
                  onClick={handleLogout}
                  className="text-xs text-gray-400 hover:text-red-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-500/5"
                >
                  {t('logout')}
                </button>
              </div>
            ) : (
              <Link
                href="/login"
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                {t('login')}
              </Link>
            )
          )}
        </div>
      </div>
    </nav>
  );
}
