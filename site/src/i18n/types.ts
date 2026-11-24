import type { en } from './en';

export type LocaleCode = 'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'es' | 'fr' | 'ko';
export type TranslationKey = keyof typeof en;
export type TranslationDict = Record<TranslationKey, string>;

export interface LocaleMeta {
  code: LocaleCode;
  short: string;
  nativeName: string;
  htmlLang: string;
}

export const SUPPORTED_LOCALES: readonly LocaleMeta[] = [
  { code: 'en', short: 'EN', nativeName: 'English', htmlLang: 'en' },
  { code: 'zh-CN', short: '简中', nativeName: '简体中文', htmlLang: 'zh-CN' },
  { code: 'zh-TW', short: '繁中', nativeName: '繁體中文', htmlLang: 'zh-TW' },
  { code: 'ja', short: '日本語', nativeName: '日本語', htmlLang: 'ja' },
  { code: 'es', short: 'ES', nativeName: 'Español', htmlLang: 'es' },
  { code: 'fr', short: 'FR', nativeName: 'Français', htmlLang: 'fr' },
  { code: 'ko', short: '한국어', nativeName: '한국어', htmlLang: 'ko' },
] as const;
