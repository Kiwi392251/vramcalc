import type { HardwareBackend, HardwareSpec, HardwareVendor, SplitMode } from '../types/vram';

export const STANDARD_RAM_OPTIONS: readonly number[] = [
  8, 16, 24, 32, 36, 48, 64, 96, 128, 192, 256, 512,
];

export const GPU_COUNT_OPTIONS: readonly number[] = [1, 2, 3, 4, 6, 8];

export interface UnifiedSocProfile {
  id: string;
  name: string;
  shortName: string;
  vendor: HardwareVendor;
  series: string;
  backend: HardwareBackend;
  memoryType: string;
  skus: HardwareSpec[];
  ramTiers: number[];
  defaultRamGb: number;
  minBwGbps: number;
  maxBwGbps: number;
  bwLabel: string;
  searchBlob: string;
}

const SOC_DISPLAY_META: Record<
  string,
  { name: string; shortName: string; order: number; aliases: string }
> = {
  'apple-m5-max': {
    name: 'Apple M5 Max (Unified Silicon)',
    shortName: 'Apple M5 Max',
    order: 1,
    aliases: 'macbook pro mac studio metal m5 max',
  },
  'apple-m5-pro': {
    name: 'Apple M5 Pro (Unified Silicon)',
    shortName: 'Apple M5 Pro',
    order: 2,
    aliases: 'macbook pro mac mini metal m5 pro',
  },
  'apple-m4-max': {
    name: 'Apple M4 Max (Unified Silicon)',
    shortName: 'Apple M4 Max',
    order: 3,
    aliases: 'macbook pro mac studio metal m4 max',
  },
  'apple-m4-pro': {
    name: 'Apple M4 Pro (Unified Silicon)',
    shortName: 'Apple M4 Pro',
    order: 4,
    aliases: 'macbook pro mac mini metal m4 pro',
  },
  'apple-m4': {
    name: 'Apple M4 (Unified Silicon)',
    shortName: 'Apple M4',
    order: 5,
    aliases: 'macbook air macbook pro mac mini imac metal m4',
  },
  'apple-m3-max': {
    name: 'Apple M3 Max (Unified Silicon)',
    shortName: 'Apple M3 Max',
    order: 6,
    aliases: 'macbook pro metal m3 max',
  },
  'apple-m3-pro': {
    name: 'Apple M3 Pro (Unified Silicon)',
    shortName: 'Apple M3 Pro',
    order: 7,
    aliases: 'macbook pro metal m3 pro',
  },
  'apple-m3': {
    name: 'Apple M3 (Unified Silicon)',
    shortName: 'Apple M3',
    order: 8,
    aliases: 'macbook air macbook pro imac metal m3',
  },
  'apple-m2-ultra': {
    name: 'Apple M2 Ultra (Unified Silicon)',
    shortName: 'Apple M2 Ultra',
    order: 9,
    aliases: 'mac studio mac pro metal m2 ultra',
  },
  'apple-m2-max': {
    name: 'Apple M2 Max (Unified Silicon)',
    shortName: 'Apple M2 Max',
    order: 10,
    aliases: 'macbook pro mac studio metal m2 max',
  },
  'apple-m2-pro': {
    name: 'Apple M2 Pro (Unified Silicon)',
    shortName: 'Apple M2 Pro',
    order: 11,
    aliases: 'macbook pro mac mini metal m2 pro',
  },
  'apple-m2': {
    name: 'Apple M2 (Unified Silicon)',
    shortName: 'Apple M2',
    order: 12,
    aliases: 'macbook air mac mini metal m2',
  },
  'apple-m1-max': {
    name: 'Apple M1 Max (Unified Silicon)',
    shortName: 'Apple M1 Max',
    order: 13,
    aliases: 'macbook pro mac studio metal m1 max',
  },
  'apple-m1-pro': {
    name: 'Apple M1 Pro (Unified Silicon)',
    shortName: 'Apple M1 Pro',
    order: 14,
    aliases: 'macbook pro metal m1 pro',
  },
  'apple-m1': {
    name: 'Apple M1 (Unified Silicon)',
    shortName: 'Apple M1',
    order: 15,
    aliases: 'macbook air macbook pro mac mini imac metal m1',
  },
  'ryzen-ai-max-395': {
    name: 'AMD Ryzen AI Max+ 395 / Strix Halo (Unified)',
    shortName: 'Ryzen AI Max+ 395 (Strix Halo)',
    order: 16,
    aliases: 'amd strix halo framework mini pc rocm unified apu 395',
  },
  'nvidia-dgx-spark-gb10': {
    name: 'NVIDIA DGX Spark GB10 (Unified Grace Blackwell)',
    shortName: 'DGX Spark GB10',
    order: 17,
    aliases: 'nvidia grace blackwell gb10 dgx spark project digits cuda unified',
  },
};

export function extractUnifiedSocProfiles(hardware: HardwareSpec[]): UnifiedSocProfile[] {
  const byFamily = new Map<string, HardwareSpec[]>();
  for (const h of hardware) {
    if (!h.is_unified) continue;
    const famId = h.id.replace(/-\d+gb$/, '');
    const list = byFamily.get(famId);
    if (list) list.push(h);
    else byFamily.set(famId, [h]);
  }

  const profiles: UnifiedSocProfile[] = [];
  for (const [famId, rawSkus] of byFamily.entries()) {
    const skus = [...rawSkus].sort((a, b) => a.vram_gb - b.vram_gb);
    const first = skus[0];
    const meta = SOC_DISPLAY_META[famId];
    const ramTiers = skus.map((s) => Math.round(s.vram_gb));
    const bws = skus.map((s) => s.bandwidth_gbps);
    const minBwGbps = Math.min(...bws);
    const maxBwGbps = Math.max(...bws);
    const bwLabel =
      minBwGbps === maxBwGbps
        ? `${minBwGbps} GB/s`
        : `${minBwGbps}–${maxBwGbps} GB/s`;

    let defaultRamGb = ramTiers[0];
    if (/^apple-m[1-4]$/.test(famId) && ramTiers.includes(16)) {
      defaultRamGb = 16;
    } else if (famId.includes('-max') && ramTiers.includes(64)) {
      defaultRamGb = 64;
    }

    const baseName =
      meta?.name ?? `${first.name.replace(/\s*\(\d+GB[^)]*\)/i, '')} (Unified)`;
    const shortName =
      meta?.shortName ?? first.short_name.replace(/\s*\d+GB$/i, '');

    const searchTokens = [
      famId,
      baseName,
      shortName,
      first.vendor,
      first.series,
      first.backend,
      first.memory_type,
      meta?.aliases ?? '',
      ...skus.flatMap((s) => [s.id, s.name, `${Math.round(s.vram_gb)}gb`, `${Math.round(s.vram_gb)}g`]),
    ];

    profiles.push({
      id: famId,
      name: baseName,
      shortName,
      vendor: first.vendor,
      series: first.series,
      backend: first.backend,
      memoryType: first.memory_type,
      skus,
      ramTiers,
      defaultRamGb,
      minBwGbps,
      maxBwGbps,
      bwLabel,
      searchBlob: searchTokens.join(' ').toLowerCase(),
    });
  }

  profiles.sort((a, b) => {
    const oa = SOC_DISPLAY_META[a.id]?.order ?? 999;
    const ob = SOC_DISPLAY_META[b.id]?.order ?? 999;
    if (oa !== ob) return oa - ob;
    return a.name.localeCompare(b.name);
  });

  return profiles;
}

export function resolveUnifiedHardware(
  soc: UnifiedSocProfile,
  ramGb: number,
): { hw: HardwareSpec; isExactCatalogSku: boolean } {
  const targetGb = Math.max(4, Math.round(ramGb));
  const exact = soc.skus.find((s) => Math.round(s.vram_gb) === targetGb);
  if (exact) {
    return { hw: exact, isExactCatalogSku: true };
  }

  // Pick closest lower-or-matching SKU bandwidth tier (handles M3/M4/M5 Max core binning at <=36GB)
  let bw = targetGb <= 36 ? soc.minBwGbps : soc.maxBwGbps;
  const closest = [...soc.skus].sort(
    (a, b) => Math.abs(a.vram_gb - targetGb) - Math.abs(b.vram_gb - targetGb),
  )[0];
  if (closest && Math.abs(closest.vram_gb - targetGb) <= 8) {
    bw = closest.bandwidth_gbps;
  }

  let usableFraction = targetGb <= 36 ? 0.75 : 0.78;
  if (soc.id === 'nvidia-dgx-spark-gb10') {
    usableFraction = 0.875;
  } else if (soc.id === 'ryzen-ai-max-395') {
    usableFraction = 0.75;
  }
  const usable = Math.max(2, Math.round(targetGb * usableFraction * 10) / 10);

  return {
    hw: {
      id: `${soc.id}-${targetGb}gb`,
      name: `${soc.shortName} (${targetGb}GB Unified)`,
      short_name: `${soc.shortName} ${targetGb}GB`,
      vendor: soc.vendor,
      series: soc.series,
      category: 'Unified Memory',
      gpu_count: 1,
      vram_gb: targetGb,
      usable_vram_gb: usable,
      bandwidth_gbps: bw,
      memory_type: soc.memoryType,
      is_unified: true,
      backend: soc.backend,
      msrp_usd: closest?.msrp_usd ?? 0,
    },
    isExactCatalogSku: false,
  };
}

export function getDiscreteSingleGpus(hardware: HardwareSpec[]): HardwareSpec[] {
  return hardware.filter((h) => !h.is_unified && (h.gpu_count ?? 1) === 1);
}

export function isMultiGpuCapable(hw: HardwareSpec | null): boolean {
  return Boolean(hw && !hw.is_unified && hw.category !== 'Laptop GPU');
}

export function parseRamGb(raw: string): number | null {
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned) return null;
  const m = /^(\d{1,4})(?:\s*gb?|\s*g)?$/i.exec(cleaned);
  if (!m) return null;
  const val = Number(m[1]);
  if (!Number.isFinite(val) || val < 4 || val > 2048) return null;
  return Math.round(val);
}

export function resolveCuratedGuideSlug(
  modelId: string,
  hw: HardwareSpec | null,
  gpuCount: number,
  isExactCatalogSku: boolean,
  curatedSlugMap: Map<string, string>,
): string | undefined {
  if (!hw) return undefined;
  if (hw.is_unified) {
    return isExactCatalogSku ? curatedSlugMap.get(`${modelId}::${hw.id}`) : undefined;
  }
  if (gpuCount === 1) {
    return curatedSlugMap.get(`${modelId}::${hw.id}`);
  }
  if (gpuCount === 2) {
    if (hw.id === 'rtx-3090-24gb') {
      return curatedSlugMap.get(`${modelId}::dual-rtx-3090-48gb`);
    }
    if (hw.id === 'rtx-4090-24gb') {
      return curatedSlugMap.get(`${modelId}::dual-rtx-4090-48gb`);
    }
  }
  return undefined;
}

export interface SimulatorLinkParams {
  modelId?: string;
  hw: HardwareSpec | null;
  isExactCatalogSku?: boolean;
  gpuCount: number;
  splitMode: SplitMode;
  cpuId: string;
  ramGb: number;
}

export function buildSimulatorUrl(params: SimulatorLinkParams): string {
  const q = new URLSearchParams();
  const { modelId, hw, isExactCatalogSku = true, gpuCount, splitMode, cpuId, ramGb } = params;

  if (!hw || gpuCount <= 0) {
    q.set('mode', 'cpu');
    if (cpuId) q.set('cpu', cpuId);
    if (ramGb > 0) q.set('ram', String(ramGb));
  } else if (hw.is_unified) {
    if (isExactCatalogSku) {
      q.set('mode', 'gpu');
      q.set('hw', hw.id);
      q.set('ram', String(Math.round(hw.vram_gb)));
    } else {
      q.set('mode', 'custom');
      q.set('vram', String(hw.usable_vram_gb));
      q.set('bw', String(hw.bandwidth_gbps));
      q.set('backend', hw.backend);
      q.set('unified', '1');
      q.set('ram', String(Math.round(hw.vram_gb)));
    }
  } else {
    q.set('mode', 'gpu');
    q.set('hw', hw.id);
    if (gpuCount > 1) q.set('gpus', String(gpuCount));
    if (gpuCount > 1 && splitMode !== 'layer') q.set('split', splitMode);
    if (cpuId) q.set('cpu', cpuId);
    if (ramGb > 0) q.set('ram', String(ramGb));
  }

  if (modelId && modelId !== 'all') {
    q.set('model', modelId);
  }
  return `/calculator/?${q.toString()}`;
}
