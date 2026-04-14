'use client';
/**
 * I18nProvider.tsx — Fournisseur d'internationalisation client
 * Lit la locale dans localStorage, charge les messages JSON dynamiquement,
 * puis wrap l'app avec NextIntlClientProvider.
 * Pas de routing URL (/fr/…) — locale purement côté client.
 */
import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import {
  locales, defaultLocale,
  type Locale,
  localeNames, localeFlags,
  getStoredLocale, setStoredLocale,
} from '@/i18n';
import frMessages from '@/messages/fr.json';

// ── Context pour changer la langue depuis n'importe quel composant ────────────
interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  localeNames: typeof localeNames;
  localeFlags: typeof localeFlags;
  locales: typeof locales;
}

const I18nContext = createContext<I18nContextValue>({
  locale:      defaultLocale,
  setLocale:   () => {},
  localeNames,
  localeFlags,
  locales,
});

export function useI18n() {
  return useContext(I18nContext);
}

// ── Chargeur de messages ──────────────────────────────────────────────────────
async function loadMessages(locale: Locale): Promise<Record<string, unknown>> {
  try {
    const mod = await import(`@/messages/${locale}.json`);
    return mod.default ?? mod;
  } catch {
    // Fallback sur le français
    try {
      const mod = await import('@/messages/fr.json');
      return mod.default ?? mod;
    } catch {
      return {};
    }
  }
}

// ── Provider principal ────────────────────────────────────────────────────────
export default function I18nProvider({ children }: { children: ReactNode }) {
  // Initialiser avec fr.json statiquement → pas de flash au premier rendu
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);
  const [messages, setMessages]  = useState<Record<string, unknown>>(
    frMessages as unknown as Record<string, unknown>
  );

  // Initialisation : lire la locale depuis localStorage / navigateur
  useEffect(() => {
    const detectedLocale = getStoredLocale();
    if (detectedLocale === defaultLocale) return; // fr.json déjà chargé
    setLocaleState(detectedLocale);
    loadMessages(detectedLocale).then(setMessages);
  }, []);

  // Changer de langue
  const setLocale = useCallback((newLocale: Locale) => {
    setStoredLocale(newLocale);
    setLocaleState(newLocale);
    loadMessages(newLocale).then(setMessages);
  }, []);

  return (
    <I18nContext.Provider value={{ locale, setLocale, localeNames, localeFlags, locales }}>
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Paris">
        {children}
      </NextIntlClientProvider>
    </I18nContext.Provider>
  );
}
