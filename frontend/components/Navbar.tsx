'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function Navbar() {
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    setLoggedIn(!!localStorage.getItem('access_token'));
  }, []);

  function logout() {
    localStorage.removeItem('access_token');
    window.location.href = '/';
  }

  return (
    <nav className="sticky top-0 z-50 border-b border-gray-800 bg-gray-950/90 backdrop-blur-md">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-7 h-7 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-sm">
            🌍
          </div>
          <span className="text-sm font-bold tracking-tight text-white group-hover:text-blue-300 transition-colors">
            SpottedYou <span className="text-blue-400">Translator</span>
          </span>
        </Link>

        {/* Nav links */}
        <div className="flex items-center gap-2">
          <Link
            href="/library"
            className="text-xs text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-800 hidden sm:block"
          >
            Mes vidéos
          </Link>
          <Link
            href="/billing"
            className="text-xs text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-800 hidden sm:block"
          >
            Abonnement
          </Link>
          {loggedIn ? (
            <button
              onClick={logout}
              className="text-xs text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-800"
            >
              Déconnexion
            </button>
          ) : (
            <Link
              href="/login"
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
            >
              Connexion →
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
