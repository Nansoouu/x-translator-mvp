"use client";

import { useState, useCallback, useEffect } from "react";

// ── Auth JWT — backend FastAPI / Supabase ────────────────────────────────────
// Token stocké dans localStorage (clé: access_token)

const LS_TOKEN_KEY = "access_token";
const LS_USER_KEY  = "xt_user";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface AuthUser {
  id: string;
  email: string;
}

function saveToStorage(token: string, user: AuthUser) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS_TOKEN_KEY, token);
  localStorage.setItem(LS_USER_KEY, JSON.stringify(user));
  // Notifie les autres instances du hook dans le même onglet
  window.dispatchEvent(new Event("storage"));
}

function loadFromStorage(): { user: AuthUser | null; token: string | null } {
  if (typeof window === "undefined") return { user: null, token: null };
  try {
    const token = localStorage.getItem(LS_TOKEN_KEY);
    const raw   = localStorage.getItem(LS_USER_KEY);
    if (token) {
      return { user: raw ? (JSON.parse(raw) as AuthUser) : null, token };
    }
  } catch { /* ignore */ }
  return { user: null, token: null };
}

function clearStorage() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(LS_TOKEN_KEY);
  localStorage.removeItem(LS_USER_KEY);
  window.dispatchEvent(new Event("storage"));
}

export function useAuth() {
  const [user,    setUser]    = useState<AuthUser | null>(null);
  const [token,   setToken]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  // ── Hydratation initiale ──────────────────────────────────────────────────
  useEffect(() => {
    const stored = loadFromStorage();
    if (stored.token) {
      setToken(stored.token);
      if (stored.user) setUser(stored.user);
      // Validation silencieuse du token
      fetch(`${API}/auth/me`, {
        headers: { Authorization: `Bearer ${stored.token}` },
      })
        .then(r => r.ok ? r.json() : null)
        .then(u => {
          if (u) {
            const usr = { id: u.id, email: u.email };
            setUser(usr);
            saveToStorage(stored.token!, usr);
          } else {
            clearStorage();
            setUser(null);
            setToken(null);
          }
        })
        .catch(() => { /* keep cached user si réseau indisponible */ })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  // ── Listener storage — synchronise tous les composants du même onglet ─────
  useEffect(() => {
    function handleStorageChange() {
      const stored = loadFromStorage();
      if (stored.token && stored.user) {
        setToken(stored.token);
        setUser(stored.user);
      } else if (!stored.token) {
        setToken(null);
        setUser(null);
      }
    }
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  // ── Login ─────────────────────────────────────────────────────────────────
  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!r.ok) {
        const e = await r.json();
        throw new Error(e.detail || "Identifiants incorrects");
      }
      const data = await r.json();
      if (data.access_token) {
        const u: AuthUser = { id: data.user?.id ?? "", email };
        saveToStorage(data.access_token, u);
        setToken(data.access_token);
        setUser(u);
      }
      return data;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erreur inconnue";
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Register ──────────────────────────────────────────────────────────────
  const register = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!r.ok) {
        const e = await r.json();
        throw new Error(e.detail || "Erreur lors de l'inscription");
      }
      const data = await r.json();
      if (data.access_token) {
        const u: AuthUser = { id: data.user?.id ?? "", email };
        saveToStorage(data.access_token, u);
        setToken(data.access_token);
        setUser(u);
      }
      return data;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erreur inconnue";
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    clearStorage();
    setUser(null);
    setToken(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    user,
    token,
    loading,
    error,
    isAuthenticated: !!token,
    login,
    register,
    logout,
    clearError,
  };
}
