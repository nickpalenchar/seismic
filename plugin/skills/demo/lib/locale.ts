



export const LANGUAGES = ['en'] as const;
export type Language = (typeof LANGUAGES)[number];


export const FALLBACK_LANGUAGE: Language = 'en';

/** The language a locale names (`de_DE.UTF-8`, `en-GB`, `de`), if Seismic speaks it. */
export function languageOf(locale: string | null | undefined): Language | undefined {
  const code = locale?.trim().toLowerCase().split(/[-_.@]/)[0];
  return LANGUAGES.find((l) => l === code);
}


export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English' };
