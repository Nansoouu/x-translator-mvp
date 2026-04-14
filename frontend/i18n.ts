/**
 * i18n.ts — Configuration next-intl (sans routing URL)
 * Approche client-side uniquement : locale dans localStorage
 */

export const locales = [
  'fr', 'en', 'es', 'de', 'it', 'pt', 'ar', 'ru', 'zh',
  'ja', 'ko', 'tr', 'nl', 'pl', 'uk', 'hi', 'fa', 'he', 'vi', 'id',
] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'fr';

export const localeNames: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
  es: 'Español',
  de: 'Deutsch',
  it: 'Italiano',
  pt: 'Português',
  ar: 'العربية',
  ru: 'Русский',
  zh: '中文',
  ja: '日本語',
  ko: '한국어',
  tr: 'Türkçe',
  nl: 'Nederlands',
  pl: 'Polski',
  uk: 'Українська',
  hi: 'हिन्दी',
  fa: 'فارسی',
  he: 'עברית',
  vi: 'Tiếng Việt',
  id: 'Bahasa Indonesia',
};

export const localeFlags: Record<Locale, string> = {
  fr: '🇫🇷', en: '🇬🇧', es: '🇪🇸', de: '🇩🇪', it: '🇮🇹',
  pt: '🇧🇷', ar: '🇸🇦', ru: '🇷🇺', zh: '🇨🇳', ja: '🇯🇵',
  ko: '🇰🇷', tr: '🇹🇷', nl: '🇳🇱', pl: '🇵🇱', uk: '🇺🇦',
  hi: '🇮🇳', fa: '🇮🇷', he: '🇮🇱', vi: '🇻🇳', id: '🇮🇩',
};

/** Retourne la locale stockée dans localStorage (côté client) */
export function getStoredLocale(): Locale {
  if (typeof window === 'undefined') return defaultLocale;
  const stored = localStorage.getItem('locale') as Locale | null;
  if (stored && (locales as readonly string[]).includes(stored)) return stored;
  // Détecter depuis le navigateur
  const browserLang = navigator.language.split('-')[0] as Locale;
  return (locales as readonly string[]).includes(browserLang) ? browserLang : defaultLocale;
}

/** Sauvegarde la locale dans localStorage */
export function setStoredLocale(locale: Locale): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('locale', locale);
  }
}
