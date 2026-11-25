import type { TranslationKey } from '../i18n/types';
import type { CpuSpec, HardwareSpec, ModelSpec } from '../types/vram';
import type { ComboboxOption } from './combobox';
import type { UnifiedSocProfile } from './rigCatalog';

export type TranslatorFn = (key: TranslationKey, vars?: Record<string, string | number>) => string;

const CPU_BRAND_ORDER: Record<string, number> = {
  Apple: 1,
  Intel: 2,
  AMD: 3,
  Qualcomm: 4,
  NVIDIA: 5,
};

const CPU_SERIES_ORDER: Record<string, number> = {
  'Apple Silicon M5': 1,
  'Apple Silicon M4': 2,
  'Apple Silicon M3': 3,
  'Apple Silicon M2': 4,
  'Apple Silicon M1': 5,
  'Ryzen AI Max': 9,
  'Core Ultra 200 (Arrow Lake)': 10,
  'Ryzen 9000 (AM5 Zen 5)': 10,
  'DGX Workstation': 10,
  'Core 14th / 13th Gen (DDR5)': 11,
  'Ryzen 7000 (AM5 Zen 4)': 11,
  'Core 12th–10th Gen (DDR4)': 12,
  'Ryzen 5000 / 3000 (AM4 DDR4)': 12,
  'Core Laptop (Ultra / HX / H)': 13,
  'Ryzen Laptop & AI': 13,
  'Threadripper Workstation': 14,
  'Xeon Workstation & Server': 14,
  'EPYC Server': 15,
  'Snapdragon X (ARM AI PC)': 20,
  'Generic Presets': 90,
};

const HW_BRAND_ORDER: Record<string, number> = {
  NVIDIA: 1,
  Apple: 2,
  AMD: 3,
  Intel: 4,
};

const HW_SERIES_ORDER: Record<string, number> = {
  'RTX 50 Series': 1,
  'RTX 40 Series': 2,
  'RTX 30 Series': 3,
  'RTX 20 Series': 4,
  'GTX 16 Series': 5,
  'GTX 10 Series': 6,
  'RTX 50 Laptop': 7,
  'RTX 40 Laptop': 8,
  'RTX 30 Laptop': 9,
  'RTX Workstation': 10,
  'Data Center & Homelab': 11,
  'Multi-GPU RTX': 12,
  'DGX Workstation': 13,
  'Apple Silicon M5': 1,
  'Apple Silicon M4': 2,
  'Apple Silicon M3': 3,
  'Apple Silicon M2': 4,
  'Apple Silicon M1': 5,
  'Radeon RX 9000': 1,
  'Radeon RX 7000': 2,
  'Radeon RX 6000': 3,
  'Radeon PRO': 4,
  'Ryzen AI Max': 5,
  'Instinct Data Center': 6,
  'Intel Arc Battlemage': 1,
  'Intel Arc Alchemist': 2,
};

export function buildCpuCascaderOptions(params: {
  cpus: CpuSpec[];
  socProfiles?: UnifiedSocProfile[];
  t: TranslatorFn;
  includeUnified?: boolean;
  prefixX86?: boolean;
}): ComboboxOption[] {
  const { cpus, socProfiles = [], t, includeUnified = false, prefixX86 = false } = params;
  const opts: ComboboxOption[] = [];

  if (includeUnified) {
    for (const soc of socProfiles) {
      opts.push({
        value: `soc:${soc.id}`,
        label: soc.name,
        brand: soc.vendor,
        brandOrder: CPU_BRAND_ORDER[soc.vendor] ?? 50,
        series: soc.series,
        seriesOrder: CPU_SERIES_ORDER[soc.series] ?? 50,
        badge: `${soc.backend} Unified`,
        sublabel: `${soc.ramTiers.join(' / ')} GB · ${soc.backend} ${soc.bwLabel}`,
        searchBlob: [
          soc.id,
          soc.name,
          soc.shortName,
          soc.vendor,
          soc.series,
          soc.backend,
          soc.memoryType,
          soc.bwLabel,
          ...soc.ramTiers.map((r) => `${r}gb`),
          soc.searchBlob,
        ]
          .join(' ')
          .toLowerCase(),
      });
    }
  }

  for (const c of cpus) {
    const isGeneric = c.vendor === 'Generic';
    const brand = isGeneric ? t('cb.brandGeneric') : c.vendor;
    const series = c.series || c.tier;
    opts.push({
      value: prefixX86 ? `x86:${c.id}` : c.id,
      label: c.name,
      brand,
      brandOrder: isGeneric ? 90 : (CPU_BRAND_ORDER[c.vendor] ?? 50),
      series,
      seriesOrder: isGeneric ? 90 : (CPU_SERIES_ORDER[series] ?? 50),
      badge: `${c.effective_bw_gbps} GB/s`,
      sublabel: `${c.memory_type} · ${c.channels}-ch · ${c.tier}`,
      searchBlob: [
        c.id,
        c.name,
        c.short_name,
        c.vendor,
        brand,
        series,
        c.tier,
        c.memory_type,
        c.simd,
        `${c.channels}-ch`,
        `${c.effective_bw_gbps}`,
        ...(c.search_aliases ?? []),
      ]
        .join(' ')
        .toLowerCase(),
    });
  }

  return opts;
}

export function buildHardwareCascaderOptions(params: {
  hardware: HardwareSpec[];
  t: TranslatorFn;
  prefixUnified?: boolean;
  includeCpuOnly?: boolean;
  includeMultiGpu?: boolean;
}): ComboboxOption[] {
  const { hardware, t, prefixUnified = false, includeCpuOnly = false, includeMultiGpu = false } = params;
  const opts: ComboboxOption[] = [];

  if (includeCpuOnly) {
    const noGpuBrand = t('cb.brandNoGpu');
    const noGpuSeries = t('cb.seriesNoGpu');
    opts.push({
      value: 'none',
      label: t('home.noneCpuOnly'),
      brand: noGpuBrand,
      brandOrder: 90,
      series: noGpuSeries,
      seriesOrder: 90,
      badge: 'CPU-Only',
      sublabel: t('home.noneCpuOnlySub'),
      searchBlob: `none no gpu cpu only integrated ram system memory 无显卡 核显 仅cpu ${noGpuBrand} ${noGpuSeries}`.toLowerCase(),
    });
  }

  const pool = includeMultiGpu
    ? hardware
    : hardware.filter((h) => h.is_unified || ((h.gpu_count || 1) === 1 && h.category !== 'Multi-GPU'));

  for (const h of pool) {
    const value = prefixUnified && h.is_unified ? `uni:${h.id}` : h.id;
    opts.push({
      value,
      label: h.name,
      brand: h.vendor,
      brandOrder: HW_BRAND_ORDER[h.vendor] ?? 50,
      series: h.series,
      seriesOrder: HW_SERIES_ORDER[h.series] ?? 50,
      badge: `${h.vram_gb} GB`,
      sublabel: h.is_unified
        ? t('home.unifiedChipNote', { ram: h.vram_gb, backend: h.backend })
        : `${h.vram_gb} GB ${h.memory_type} · ${h.bandwidth_gbps} GB/s · ${h.backend}`,
      searchBlob: [
        h.id,
        h.name,
        h.short_name,
        h.vendor,
        h.series,
        h.category,
        h.memory_type,
        h.backend,
        `${h.vram_gb}gb`,
        `${h.vram_gb}g`,
        `${h.bandwidth_gbps}gb/s`,
        h.is_unified ? 'unified mac silicon' : '',
      ]
        .join(' ')
        .toLowerCase(),
    });
  }

  return opts;
}

function resolveModelBrand(family: string): { brand: string; brandOrder: number; seriesOrder: number } {
  if (family.startsWith('Qwen')) {
    const seriesOrder =
      family === 'Qwen3.8'
        ? 1
        : family === 'Qwen3'
          ? 2
          : family === 'Qwen2.5-Coder'
            ? 3
            : family === 'Qwen2.5'
              ? 4
              : 10;
    return { brand: 'Qwen (Alibaba)', brandOrder: 1, seriesOrder };
  }
  if (family === 'DeepSeek-R1') {
    return { brand: 'DeepSeek', brandOrder: 2, seriesOrder: 1 };
  }
  if (family === 'Gemma 3') {
    return { brand: 'Google Gemma', brandOrder: 3, seriesOrder: 1 };
  }
  if (family.startsWith('Llama-')) {
    const seriesOrder =
      family === 'Llama-3.3' ? 1 : family === 'Llama-3.2' ? 2 : family === 'Llama-3.1' ? 3 : 10;
    return { brand: 'Meta Llama', brandOrder: 4, seriesOrder };
  }
  if (family === 'Mistral') {
    return { brand: 'Mistral', brandOrder: 5, seriesOrder: 1 };
  }
  if (family === 'Phi-4') {
    return { brand: 'Microsoft Phi', brandOrder: 6, seriesOrder: 1 };
  }
  return { brand: family, brandOrder: 50, seriesOrder: 50 };
}

export function buildModelCascaderOptions(params: {
  models: ModelSpec[];
  t: TranslatorFn;
  includeAllOption?: boolean;
}): ComboboxOption[] {
  const { models, t, includeAllOption = false } = params;
  const opts: ComboboxOption[] = [];

  if (includeAllOption) {
    const allLabel = t('cb.allModelsOption', { count: models.length });
    opts.push({
      value: 'all',
      label: allLabel,
      brand: t('status.all'),
      brandOrder: 0,
      series: allLabel,
      seriesOrder: 0,
      badge: `${models.length} LLMs`,
      sublabel: 'Qwen3.8 · Qwen3 · DeepSeek-R1 · Gemma 3 · Llama-3.3',
      searchBlob: `all models every llm 全部模型 所有模型 ${allLabel}`.toLowerCase(),
    });
  }

  const sorted = [...models].sort((a, b) => a.params_b - b.params_b);
  for (const m of sorted) {
    const { brand, brandOrder, seriesOrder } = resolveModelBrand(m.family);
    const moeBadge = m.active_params_b ? `${m.params_b}B MoE` : `${m.params_b}B`;
    const sublabel = m.active_params_b
      ? `${m.active_params_b}B active · ${m.architecture}`
      : `${m.architecture} · ${m.num_layers}L`;

    opts.push({
      value: m.id,
      label: m.name,
      brand,
      brandOrder,
      series: m.family,
      seriesOrder,
      badge: moeBadge,
      sublabel,
      searchBlob: [
        m.id,
        m.name,
        m.short_name,
        m.family,
        brand,
        m.architecture,
        m.ollama_tag,
        `${m.params_b}b`,
        m.active_params_b ? `${m.active_params_b}b moe` : 'dense',
        'uncensored abliterated heretic',
      ]
        .join(' ')
        .toLowerCase(),
    });
  }

  return opts;
}
