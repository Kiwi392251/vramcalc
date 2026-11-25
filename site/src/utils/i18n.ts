import { en } from '../i18n/en';
import { es } from '../i18n/es';
import { fr } from '../i18n/fr';
import { ja } from '../i18n/ja';
import { ko } from '../i18n/ko';
import {
  SUPPORTED_LOCALES,
  type LocaleCode,
  type LocaleMeta,
  type TranslationDict,
  type TranslationKey,
} from '../i18n/types';
import { zhCN } from '../i18n/zh-CN';
import { zhTW } from '../i18n/zh-TW';
import type { CompatStatus, SpeedTier } from '../types/vram';

export { SUPPORTED_LOCALES };
export type { LocaleCode, LocaleMeta, TranslationKey };

export const STORAGE_KEY = 'vramcalc_lang';

const DICTS: Record<LocaleCode, TranslationDict> = {
  en,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  ja,
  es,
  fr,
  ko,
};

const VALID_CODES = new Set<string>(SUPPORTED_LOCALES.map((l) => l.code));

export function isValidLocale(code: string | null | undefined): code is LocaleCode {
  return Boolean(code && VALID_CODES.has(code));
}

export function getLocaleMeta(code: LocaleCode): LocaleMeta {
  return SUPPORTED_LOCALES.find((l) => l.code === code) ?? SUPPORTED_LOCALES[0];
}

export function detectDeviceLocale(langs?: readonly string[]): LocaleCode {
  let list: readonly string[] = langs ?? [];
  if (!langs && typeof navigator !== 'undefined') {
    list =
      navigator.languages && navigator.languages.length > 0
        ? navigator.languages
        : navigator.language
          ? [navigator.language]
          : [];
  }

  for (const raw of list) {
    if (!raw) continue;
    const tag = raw.trim().toLowerCase().replace(/_/g, '-');
    if (
      tag === 'zh-tw' ||
      tag === 'zh-hk' ||
      tag === 'zh-mo' ||
      tag.startsWith('zh-hant')
    ) {
      return 'zh-TW';
    }
    if (tag === 'zh' || tag.startsWith('zh-')) return 'zh-CN';
    if (tag === 'ja' || tag.startsWith('ja-')) return 'ja';
    if (tag === 'es' || tag.startsWith('es-')) return 'es';
    if (tag === 'fr' || tag.startsWith('fr-')) return 'fr';
    if (tag === 'ko' || tag.startsWith('ko-')) return 'ko';
    if (tag === 'en' || tag.startsWith('en-')) return 'en';
  }
  return 'en';
}

function getQueryLocale(): LocaleCode | null {
  if (typeof window === 'undefined') return null;
  try {
    const p = new URLSearchParams(window.location.search).get('lang');
    if (isValidLocale(p)) return p;
  } catch {
    // ignore
  }
  return null;
}

function getStoredLocale(): LocaleCode | null {
  if (typeof window === 'undefined') return null;
  try {
    const val = window.localStorage.getItem(STORAGE_KEY);
    if (isValidLocale(val)) return val;
  } catch {
    // ignore storage errors in private contexts
  }
  return null;
}

export function isAutoLocale(): boolean {
  return getQueryLocale() === null && getStoredLocale() === null;
}

export function getLocale(): LocaleCode {
  if (typeof document !== 'undefined') {
    const q = getQueryLocale();
    if (q) return q;
    const stored = getStoredLocale();
    if (stored) return stored;
    const attr = document.documentElement.dataset.locale;
    if (isValidLocale(attr)) return attr;
  }
  return detectDeviceLocale();
}

export function t(
  key: TranslationKey,
  vars?: Record<string, string | number>,
  locale?: LocaleCode,
): string {
  const loc = locale ?? getLocale();
  const dict = DICTS[loc] ?? en;
  let template = dict[key] ?? en[key] ?? key;
  if (vars) {
    template = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (full, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : full,
    );
  }
  return template;
}

export function tStatus(status: CompatStatus | string, locale?: LocaleCode): string {
  if (status === 'Fits' || status === 'Smooth') return t('status.fits', undefined, locale);
  if (status === 'Tight Fit') return t('status.tightFit', undefined, locale);
  if (status === 'Partial Offload') return t('status.partialOffload', undefined, locale);
  if (status === 'OOM') return t('status.oom', undefined, locale);
  return status;
}

export function tSpeedTier(
  tier: SpeedTier | string,
  short = false,
  locale?: LocaleCode,
): string {
  if (tier === 'Fast') return t(short ? 'tier.fastShort' : 'tier.fast', undefined, locale);
  if (tier === 'Interactive') return t(short ? 'tier.interactiveShort' : 'tier.interactive', undefined, locale);
  if (tier === 'Readable') return t(short ? 'tier.readableShort' : 'tier.readable', undefined, locale);
  if (tier === 'Slow') return t(short ? 'tier.slowShort' : 'tier.slow', undefined, locale);
  if (tier === 'OOM') return t(short ? 'tier.oomShort' : 'tier.oom', undefined, locale);
  return tier;
}

export function translateSpeedRating(
  tps: number,
  status: CompatStatus | string,
  opts?: { isUnified?: boolean; isCpuOnly?: boolean },
  locale?: LocaleCode,
): string {
  if (status === 'OOM' || tps <= 0) return t('speed.oom', undefined, locale);
  if (tps >= 25.0) return t('speed.blazing', undefined, locale);
  if (tps >= 12.0) return t('speed.fast', undefined, locale);
  if (tps >= 6.0) return t('speed.usable', undefined, locale);
  if (opts?.isCpuOnly) return t('speed.slowCpu', undefined, locale);
  if (status === 'Partial Offload') return t('speed.slowOffload', undefined, locale);
  return t('speed.slowBw', undefined, locale);
}

export function applyTranslations(
  root: ParentNode = document,
  locale: LocaleCode = getLocale(),
): void {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n') as TranslationKey | null;
    if (!key) return;
    if (el.getAttribute('data-i18n-keep-en') === 'true') {
      if (!el.hasAttribute('data-en-text')) {
        el.setAttribute('data-en-text', el.textContent || '');
      }
      if (locale === 'en') {
        el.textContent = el.getAttribute('data-en-text') || '';
        return;
      }
    }
    const rawArgs = el.getAttribute('data-i18n-args');
    let args: Record<string, string | number> | undefined;
    if (rawArgs) {
      try {
        args = JSON.parse(rawArgs) as Record<string, string | number>;
      } catch {
        args = undefined;
      }
    }
    el.textContent = t(key, args, locale);
  });

  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder') as TranslationKey | null;
    if (!key) return;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.placeholder = t(key, undefined, locale);
    }
  });

  root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria') as TranslationKey | null;
    if (!key) return;
    el.setAttribute('aria-label', t(key, undefined, locale));
  });

  root.querySelectorAll('[data-i18n-status]').forEach((el) => {
    const status = el.getAttribute('data-i18n-status') || '';
    if (!status) return;
    el.textContent = tStatus(status, locale);
  });

  root.querySelectorAll('[data-i18n-tier]').forEach((el) => {
    const tier = el.getAttribute('data-i18n-tier') || '';
    if (!tier) return;
    const short = el.getAttribute('data-i18n-tier-short') === 'true';
    el.textContent = tSpeedTier(tier, short, locale);
  });
}

function stripOrSyncUrlLang(code: LocaleCode | null) {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has('lang')) {
      if (code) url.searchParams.set('lang', code);
      else url.searchParams.delete('lang');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  } catch {
    // ignore
  }
}

function commitLocaleChange(locale: LocaleCode) {
  const meta = getLocaleMeta(locale);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = meta.htmlLang;
    document.documentElement.dataset.locale = locale;
    applyTranslations(document, locale);
  }
  updateSwitcherUi(locale);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('vramcalc:localechange', { detail: { locale } }));
  }
}

export function setLocale(code: LocaleCode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // ignore
  }
  stripOrSyncUrlLang(code);
  commitLocaleChange(code);
}

export function resetToAutoLocale(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  stripOrSyncUrlLang(null);
  commitLocaleChange(detectDeviceLocale());
}

export function onLocaleChange(cb: (locale: LocaleCode) => void): () => void {
  const handler = (ev: Event) => {
    const custom = ev as CustomEvent<{ locale?: LocaleCode }>;
    cb(custom.detail?.locale ?? getLocale());
  };
  window.addEventListener('vramcalc:localechange', handler);
  return () => window.removeEventListener('vramcalc:localechange', handler);
}

function renderSwitcherMenu(activeLocale: LocaleCode) {
  const menuEl = document.getElementById('lang-switcher-menu');
  if (!menuEl) return;
  const autoActive = isAutoLocale();

  const itemsHtml = SUPPORTED_LOCALES.map((loc) => {
    const isSelected = !autoActive && loc.code === activeLocale;
    const cls = isSelected
      ? 'bg-blue-50 text-blue-700 font-semibold'
      : 'text-slate-700 hover:bg-slate-50 font-medium';
    const check = isSelected
      ? '<svg class="h-3.5 w-3.5 text-blue-600 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" /></svg>'
      : '';
    return `<button type="button" role="menuitemradio" aria-checked="${isSelected ? 'true' : 'false'}" data-lang-choice="${loc.code}" class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors cursor-pointer ${cls}">
      <span class="truncate">${loc.nativeName}</span>
      <span class="flex items-center gap-1.5 shrink-0">
        <span class="font-mono text-[10px] text-slate-400">${loc.short}</span>
        ${check}
      </span>
    </button>`;
  }).join('');

  const autoCls = autoActive
    ? 'bg-slate-100 text-slate-900 font-semibold'
    : 'text-slate-600 hover:bg-slate-50 font-medium';
  const autoCheck = autoActive
    ? '<svg class="h-3.5 w-3.5 text-blue-600 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" /></svg>'
    : '';

  menuEl.innerHTML = `${itemsHtml}
    <div class="my-1 border-t border-slate-100"></div>
    <button type="button" role="menuitemradio" aria-checked="${autoActive ? 'true' : 'false'}" data-lang-auto class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors cursor-pointer ${autoCls}">
      <span class="truncate">${t('lang.autoDevice', undefined, activeLocale)}</span>
      ${autoCheck}
    </button>`;
}

function updateSwitcherUi(locale: LocaleCode) {
  const labelEl = document.getElementById('lang-switcher-label');
  const btnEl = document.getElementById('lang-switcher-btn');
  const meta = getLocaleMeta(locale);
  if (labelEl) {
    labelEl.textContent = meta.short;
  }
  if (btnEl) {
    btnEl.setAttribute('aria-label', `${t('lang.switcherAria', undefined, locale)}: ${meta.nativeName}`);
  }
  renderSwitcherMenu(locale);
}

function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      document.body.removeChild(ta);
      resolve();
    } catch (err) {
      document.body.removeChild(ta);
      reject(err);
    }
  });
}

let clipboardInitialized = false;
function initClipboardCopy() {
  if (clipboardInitialized) return;
  const hasCopy =
    document.querySelector('[data-copy-target]') || document.querySelector('[data-copy-url]');
  if (!hasCopy) return;
  clipboardInitialized = true;

  const toastEl = document.getElementById('copy-toast');
  const toastTextEl = document.getElementById('copy-toast-text');
  let toastTimer: number | undefined;
  const resetTimers = new WeakMap<Element, number>();

  function showToast(label?: string) {
    if (!toastEl || !toastTextEl) return;
    toastTextEl.textContent = label
      ? t('common.copiedItemToast', { label })
      : t('common.copiedToast');
    toastEl.classList.remove('opacity-0', 'translate-y-2', 'pointer-events-none');
    toastEl.classList.add('opacity-100', 'translate-y-0');
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toastEl.classList.add('opacity-0', 'translate-y-2', 'pointer-events-none');
      toastEl.classList.remove('opacity-100', 'translate-y-0');
    }, 1800);
  }

  function flashButton(btn: HTMLElement, targetEl: HTMLElement | null, label?: string) {
    const copyIcon = btn.querySelector('[data-copy-icon="copy"]');
    const checkIcon = btn.querySelector('[data-copy-icon="check"]');
    const textSpan = btn.querySelector('[data-copy-text]') as HTMLElement | null;
    const prevTimer = resetTimers.get(btn);
    if (prevTimer) window.clearTimeout(prevTimer);

    const i18nKey = (textSpan?.getAttribute('data-i18n') || btn.getAttribute('data-i18n')) as TranslationKey | null;
    const origText = (textSpan ? textSpan.textContent : btn.textContent) || t('common.copy');

    if (copyIcon) copyIcon.classList.add('hidden');
    if (checkIcon) checkIcon.classList.remove('hidden');
    if (textSpan) textSpan.textContent = t('common.copied');
    else btn.textContent = t('common.copied');
    btn.classList.add('border-emerald-500/60', 'text-emerald-400');
    if (targetEl) targetEl.classList.add('ring-2', 'ring-emerald-400/70');

    showToast(label);

    const timer = window.setTimeout(() => {
      if (copyIcon) copyIcon.classList.remove('hidden');
      if (checkIcon) checkIcon.classList.add('hidden');
      const restored = i18nKey ? t(i18nKey) : origText;
      if (textSpan) textSpan.textContent = restored;
      else btn.textContent = restored;
      btn.classList.remove('border-emerald-500/60', 'text-emerald-400');
      if (targetEl) targetEl.classList.remove('ring-2', 'ring-emerald-400/70');
    }, 1800);
    resetTimers.set(btn, timer);
  }

  document.querySelectorAll('[data-copy-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const b = btn as HTMLElement;
      const targetId = b.getAttribute('data-copy-target');
      const label = b.getAttribute('data-copy-label') || undefined;
      const el = targetId ? document.getElementById(targetId) : null;
      if (!el) return;
      const text = (el.textContent || '').trim();
      copyTextToClipboard(text).then(() => flashButton(b, el, label));
    });
  });

  document.querySelectorAll('[data-copy-url]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const b = btn as HTMLElement;
      const url = b.getAttribute('data-copy-url') || window.location.href;
      const label = b.getAttribute('data-copy-label') || undefined;
      copyTextToClipboard(url).then(() => flashButton(b, null, label));
    });
  });
}

let globalI18nInitialized = false;
export function initGlobalI18n(): void {
  const loc = getLocale();
  const meta = getLocaleMeta(loc);
  document.documentElement.lang = meta.htmlLang;
  document.documentElement.dataset.locale = loc;
  applyTranslations(document, loc);
  updateSwitcherUi(loc);
  initClipboardCopy();

  if (globalI18nInitialized) return;
  globalI18nInitialized = true;

  const wrap = document.getElementById('lang-switcher');
  const btn = document.getElementById('lang-switcher-btn');
  const menu = document.getElementById('lang-switcher-menu');

  if (wrap && btn && menu) {
    const closeMenu = () => {
      menu.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
    };

    const toggleMenu = () => {
      const willOpen = menu.classList.contains('hidden');
      menu.classList.toggle('hidden', !willOpen);
      btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    };

    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleMenu();
    });

    menu.addEventListener('click', (ev) => {
      const choiceBtn = (ev.target as HTMLElement).closest('[data-lang-choice]') as HTMLElement | null;
      if (choiceBtn) {
        const code = choiceBtn.getAttribute('data-lang-choice');
        if (isValidLocale(code)) {
          setLocale(code);
        }
        closeMenu();
        return;
      }
      const autoBtn = (ev.target as HTMLElement).closest('[data-lang-auto]');
      if (autoBtn) {
        resetToAutoLocale();
        closeMenu();
      }
    });

    document.addEventListener('pointerdown', (ev) => {
      if (!wrap.contains(ev.target as Node)) {
        closeMenu();
      }
    });

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        closeMenu();
      }
    });
  }
}
