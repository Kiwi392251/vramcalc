import type { HardwareSpec, ModelSpec } from '../types/vram';

export type PricingKey =
  | 'price.officialMsrp'
  | 'price.officialBto'
  | 'price.enterpriseQuote'
  | 'price.oemSystem'
  | 'price.cloudOnly';

export type PricingTranslator = (
  key: PricingKey,
  vars?: Record<string, string | number>,
) => string;

/**
 * Compute composite AI capability sort key combining Artificial Analysis
 * Intelligence Index (v5.0.2) and LMArena Text Arena Elo.
 * Unscored models gracefully fall back to 0 at the tail of sorted lists.
 */
export function aiCapabilitySortScore(
  m: Pick<ModelSpec, 'aa_index' | 'arena_elo'>,
): number {
  const aa = typeof m.aa_index === 'number' && m.aa_index > 0 ? m.aa_index : 0;
  const elo = typeof m.arena_elo === 'number' && m.arena_elo > 0 ? m.arena_elo : 0;
  if (aa === 0 && elo === 0) return 0;
  return (elo > 0 ? elo : aa > 0 ? 1280 + aa * 5 : 0) + aa * 1.5;
}

export function hasModelBenchmarkScore(
  m: Pick<ModelSpec, 'aa_index' | 'arena_elo'>,
): boolean {
  return (
    (typeof m.aa_index === 'number' && m.aa_index > 0) ||
    (typeof m.arena_elo === 'number' && m.arena_elo > 0)
  );
}

/**
 * Compact inline representation of AA v5.0.2 & Arena Elo for cards/dropdowns.
 */
export function formatModelScoreInline(
  m: Pick<ModelSpec, 'aa_index' | 'arena_elo'>,
): string {
  const parts: string[] = [];
  if (typeof m.aa_index === 'number' && m.aa_index > 0) {
    parts.push(`AA ${m.aa_index}`);
  }
  if (typeof m.arena_elo === 'number' && m.arena_elo > 0) {
    parts.push(`Arena ${m.arena_elo}`);
  }
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export function hasOfficialPrice(
  hw: Pick<HardwareSpec, 'msrp_usd' | 'price_type'>,
): boolean {
  return (
    hw.msrp_usd > 0 &&
    hw.price_type !== 'enterprise_quote' &&
    hw.price_type !== 'oem_system' &&
    hw.price_type !== 'cloud_only'
  );
}

export function officialPriceSortValue(
  hw: Pick<HardwareSpec, 'msrp_usd' | 'price_type'>,
): number {
  return hasOfficialPrice(hw) ? hw.msrp_usd : Number.MAX_SAFE_INTEGER;
}

/**
 * Full localized official manufacturer pricing string.
 * Guarantees "$0 MSRP" is never displayed anywhere in the UI.
 */
export function formatOfficialPrice(
  hw: Pick<HardwareSpec, 'msrp_usd' | 'price_type'>,
  t?: PricingTranslator,
): string {
  const priceType = hw.price_type ?? (hw.msrp_usd > 0 ? 'official_msrp' : 'enterprise_quote');

  if (priceType === 'enterprise_quote') {
    return t ? t('price.enterpriseQuote') : 'Enterprise Quote';
  }
  if (priceType === 'oem_system') {
    return t ? t('price.oemSystem') : 'OEM System Only';
  }
  if (priceType === 'cloud_only') {
    return t ? t('price.cloudOnly') : 'Cloud Instance';
  }

  if (hw.msrp_usd <= 0) {
    return t ? t('price.enterpriseQuote') : 'Enterprise Quote';
  }

  const price = `$${hw.msrp_usd.toLocaleString('en-US')}`;
  if (priceType === 'official_bto') {
    return t ? t('price.officialBto', { price }) : `${price} Apple Official`;
  }
  return t ? t('price.officialMsrp', { price }) : `${price} Official`;
}

/**
 * Compact price cell string for tight tables and combobox sublabels.
 */
export function formatOfficialPriceShort(
  hw: Pick<HardwareSpec, 'msrp_usd' | 'price_type'>,
  t?: PricingTranslator,
): string {
  const priceType = hw.price_type ?? (hw.msrp_usd > 0 ? 'official_msrp' : 'enterprise_quote');

  if (priceType === 'enterprise_quote') {
    return t ? t('price.enterpriseQuote') : 'Enterprise Quote';
  }
  if (priceType === 'oem_system') {
    return t ? t('price.oemSystem') : 'OEM System Only';
  }
  if (priceType === 'cloud_only') {
    return t ? t('price.cloudOnly') : 'Cloud Instance';
  }
  if (hw.msrp_usd <= 0) {
    return t ? t('price.enterpriseQuote') : 'Enterprise Quote';
  }
  return `$${hw.msrp_usd.toLocaleString('en-US')}`;
}

/**
 * Returns localized data-i18n key/args alongside English SSR fallback text so
 * server-rendered manufacturer price labels react immediately to language toggles.
 */
export function officialPriceI18n(
  hw: Pick<HardwareSpec, 'msrp_usd' | 'price_type'>,
  compact = false,
): { key: PricingKey | undefined; args: string | undefined; text: string } {
  const priceType = hw.price_type ?? (hw.msrp_usd > 0 ? 'official_msrp' : 'enterprise_quote');

  if (priceType === 'enterprise_quote') {
    return { key: 'price.enterpriseQuote', args: undefined, text: 'Enterprise Quote' };
  }
  if (priceType === 'oem_system') {
    return { key: 'price.oemSystem', args: undefined, text: 'OEM System Only' };
  }
  if (priceType === 'cloud_only') {
    return { key: 'price.cloudOnly', args: undefined, text: 'Cloud Instance' };
  }
  if (hw.msrp_usd <= 0) {
    return { key: 'price.enterpriseQuote', args: undefined, text: 'Enterprise Quote' };
  }

  const price = `$${hw.msrp_usd.toLocaleString('en-US')}`;
  if (compact) {
    return { key: undefined, args: undefined, text: price };
  }
  if (priceType === 'official_bto') {
    return {
      key: 'price.officialBto',
      args: JSON.stringify({ price }),
      text: `${price} Apple Official`,
    };
  }
  return {
    key: 'price.officialMsrp',
    args: JSON.stringify({ price }),
    text: `${price} Official`,
  };
}
