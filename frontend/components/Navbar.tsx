'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function Navbar() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    setLoggedIn(!!localStorage.getItem('access_token'));
    const handler = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handler);
    return () => window.removeEventListener('scroll', handler);
  }, []);

  function logout() {
    localStorage.removeItem('access_token');
    window.location.href = '/';
  }

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/50 shadow-xl shadow-black/20'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 font-bold text-lg hover:opacity-90 transition">
          <span className="text-2xl">🌍</span>
          <span className="text-white">Spotted<span className="text-blue-400">You</span></span>
          <span className="text-zinc-500 font-normal text-sm hidden sm:inline">Translator</span>
        </Link>

        {/* Nav */}
        <nav className="flex items-center gap-1">
          <Link
            href="/library"
            className="text-zinc-400 hover:text-white text-sm px-3 py-2 rounded-lg hover:bg-zinc-800/60 transition"
          >
            📚 Mes vidéos
          </Link>
          <Link
            href="/billing"
            className="text-zinc-400 hover:text-white text-sm px-3 py-2 rounded-lg hover:bg-zinc-800/60 transition"
          >
            💳 Abonnement
          </Link>
          {loggedIn ? (
            <button
              onClick={logout}
              className="ml-2 text-zinc-400 hover:text-white text-sm px-3 py-2 rounded-lg hover:bg-zinc-800/60 transition"
            >
              Déconnexion
            </button>
          ) : (
            <Link
              href="/login"
              className="ml-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition shadow-lg shadow-blue-900/30"
            >
              Connexion
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
