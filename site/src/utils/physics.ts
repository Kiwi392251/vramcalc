import type {
  CompatStatus,
  HardwareSpec,
  KvQuantKey,
  LatencyBreakdownMs,
  ModelSpec,
  OomReason,
  PcieLinkKey,
  QuantKey,
  ReserveProfile,
  RigRunEstimate,
  RigRunOptions,
  RunEstimate,
  RuntimeFormat,
  SpeedTier,
  SplitMode,
  ThermalProfile,
} from '../types/vram';

/**
 * Deterministic LLM VRAM, Context, Offload, and Throughput Physics Engine (v3.4).
 * Keep constants and formulas strictly synchronized with `scripts/physics.py`.
 * All token/s outputs are calibrated formula estimate ranges (~low–high tok/s), never raw telemetry.
 */

export const ENGINE_VERSION = 'v3.4';

export const PCIE_LINKS: Record<
  PcieLinkKey,
  { bwGbps: number; syncMs: number; label: string }
> = {
  pcie5_x16: { bwGbps: 50.0, syncMs: 0.08, label: 'PCIe 5.0 x16' },
  pcie4_x16: { bwGbps: 25.0, syncMs: 0.11, label: 'PCIe 4.0 x16' },
  pcie4_x8: { bwGbps: 12.5, syncMs: 0.13, label: 'PCIe 4.0 x8' },
  pcie3_x16: { bwGbps: 12.5, syncMs: 0.15, label: 'PCIe 3.0 x16' },
  pcie3_x8: { bwGbps: 6.3, syncMs: 0.18, label: 'PCIe 3.0 x8' },
  pcie3_x4: { bwGbps: 3.2, syncMs: 0.24, label: 'PCIe 3.0 x4' },
};

export const THERMAL_FACTORS: Record<ThermalProfile, number> = {
  desktop: 1.0,
  laptop_sustained: 0.88,
  throttled: 0.78,
};

export const RAM_BW_PRESETS: ReadonlyArray<{ value: string; bwGbps: number | null; label: string }> = [
  { value: 'auto', bwGbps: null, label: 'Auto (CPU default)' },
  { value: '36', bwGbps: 36, label: 'DDR4-3200 2-ch (36 GB/s)' },
  { value: '64', bwGbps: 64, label: 'DDR5-5600 2-ch (64 GB/s)' },
  { value: '76', bwGbps: 76, label: 'DDR5-6400 2-ch (76 GB/s)' },
  { value: '145', bwGbps: 145, label: '4-Ch Workstation (145 GB/s)' },
  { value: '320', bwGbps: 320, label: '8/12-Ch Server (320 GB/s)' },
];

export const QUANT_BPW: Record<QuantKey, number> = {
  Q4_K_M: 4.85,
  Q5_K_M: 5.65,
  Q6_K: 6.56,
  Q8_0: 8.5,
  FP16: 16.0,
  AWQ_4BIT: 4.75,
  FP8: 8.2,
  MLX_4BIT: 4.55,
  MLX_8BIT: 8.25,
};

export const QUANT_LABELS: Record<QuantKey, string> = {
  Q4_K_M: '4.85 bpw · Balanced 4-bit GGUF',
  Q5_K_M: '5.65 bpw · Higher-accuracy 5-bit GGUF',
  Q6_K: '6.56 bpw · Near-lossless 6-bit GGUF',
  Q8_0: '8.50 bpw · 8-bit reference GGUF',
  FP16: '16.0 bpw · Unquantized FP16',
  AWQ_4BIT: '4.75 bpw · 4-bit AWQ (vLLM Marlin)',
  FP8: '8.20 bpw · 8-bit FP8 (vLLM)',
  MLX_4BIT: '4.55 bpw · 4-bit Affine (Apple MLX)',
  MLX_8BIT: '8.25 bpw · 8-bit Affine (Apple MLX)',
};

export const QUANT_SHORT_LABELS: Record<QuantKey, string> = {
  Q4_K_M: 'Q4_K_M',
  Q5_K_M: 'Q5_K_M',
  Q6_K: 'Q6_K',
  Q8_0: 'Q8_0',
  FP16: 'FP16',
  AWQ_4BIT: 'AWQ 4-bit',
  FP8: 'FP8',
  MLX_4BIT: 'MLX 4-bit',
  MLX_8BIT: 'MLX 8-bit',
};

export const FORMAT_QUANTS: Record<RuntimeFormat, QuantKey[]> = {
  GGUF: ['Q4_K_M', 'Q5_K_M', 'Q6_K', 'Q8_0', 'FP16'],
  AWQ: ['AWQ_4BIT', 'FP8'],
  MLX: ['MLX_4BIT', 'MLX_8BIT'],
};

export const KV_BITS: Record<KvQuantKey, number> = {
  fp16: 16.0,
  q8_0: 8.5,
  q4_0: 4.5,
};

export const CONTEXT_LADDER = [4096, 8192, 16384, 32768, 40960, 65536, 131072];

export const SPEED_FAST_MIN = 25.0;
export const SPEED_INTERACTIVE_MIN = 12.0;
export const SPEED_READABLE_MIN = 6.0;

function round2(n: number): number {
  const s = n < 0 ? -1 : 1;
  return (s * Math.round(Math.abs(n) * 100)) / 100;
}

function round3(n: number): number {
  const s = n < 0 ? -1 : 1;
  return (s * Math.round(Math.abs(n) * 1000)) / 1000;
}

function round1(n: number): number {
  const s = n < 0 ? -1 : 1;
  return (s * Math.round(Math.abs(n) * 10)) / 10;
}

export function defaultQuantForFormat(fmt: RuntimeFormat): QuantKey {
  if (fmt === 'AWQ') return 'AWQ_4BIT';
  if (fmt === 'MLX') return 'MLX_4BIT';
  return 'Q4_K_M';
}

export function formatForQuant(quant: QuantKey): RuntimeFormat {
  if (quant === 'AWQ_4BIT' || quant === 'FP8') return 'AWQ';
  if (quant === 'MLX_4BIT' || quant === 'MLX_8BIT') return 'MLX';
  return 'GGUF';
}

export function normalizeFormatAndQuant(
  fmt?: RuntimeFormat | null,
  quant?: QuantKey | null,
): [RuntimeFormat, QuantKey] {
  if (!fmt && !quant) return ['GGUF', 'Q4_K_M'];
  if (!fmt && quant) return [formatForQuant(quant), quant];
  const resolvedFmt = fmt as RuntimeFormat;
  const allowed = FORMAT_QUANTS[resolvedFmt];
  if (quant && allowed.includes(quant)) {
    return [resolvedFmt, quant];
  }
  return [resolvedFmt, defaultQuantForFormat(resolvedFmt)];
}

export function osRamReserveGb(systemRamGb: number): number {
  if (systemRamGb <= 16) return 4.5;
  if (systemRamGb <= 32) return 6.0;
  if (systemRamGb <= 64) return 8.0;
  return 10.0;
}

export function effectiveUsableVramGb(
  hardware: HardwareSpec,
  gpuCount: number,
  reserveProfile: ReserveProfile = 'desktop',
  customUsableGb?: number | null,
): [number, number] {
  const baseCards = Math.max(1, Math.trunc(hardware.gpu_count || 1));
  const singleRaw = hardware.vram_gb / baseCards;
  const rawTotal = round2(singleRaw * gpuCount);
  if (gpuCount <= 0) return [0, 0];

  if (reserveProfile === 'custom' && customUsableGb !== undefined && customUsableGb !== null && customUsableGb > 0) {
    const capped = Math.min(rawTotal, Math.max(0.5, customUsableGb));
    return [rawTotal, round2(capped)];
  }

  if (hardware.is_unified) {
    let usable: number;
    if (reserveProfile === 'clean') {
      if (rawTotal <= 8) usable = 6.0;
      else if (rawTotal <= 16) usable = round2(rawTotal - 3.0);
      else if (rawTotal <= 24) usable = round2(rawTotal - 4.0);
      else if (rawTotal <= 36) usable = round2(rawTotal * 0.84);
      else usable = round2(rawTotal * 0.86);
    } else {
      if (rawTotal <= 8) usable = 4.8;
      else if (rawTotal <= 16) usable = 10.5;
      else if (rawTotal <= 24) usable = 16.8;
      else if (rawTotal <= 36) usable = round2(rawTotal * 0.74);
      else if (rawTotal <= 64) usable = round2(rawTotal * 0.76);
      else usable = round2(rawTotal * 0.78);
    }
    return [rawTotal, round2(Math.min(rawTotal, Math.max(0.5, usable)))];
  }

  const singleUsableCatalog = hardware.usable_vram_gb / baseCards;
  if (reserveProfile === 'clean') {
    const cleanUsable = rawTotal - Math.min(1.8, rawTotal * 0.025);
    const usable = Math.max(singleUsableCatalog * gpuCount, cleanUsable);
    return [rawTotal, round2(Math.min(rawTotal, usable))];
  }

  const desktopUsable = singleUsableCatalog * gpuCount;
  return [rawTotal, round2(Math.min(rawTotal, Math.max(0.5, desktopUsable)))];
}

export function kvCacheGb(
  model: ModelSpec,
  contextTokens: number,
  kvQuant: KvQuantKey = 'fp16',
): number {
  const kvBits = KV_BITS[kvQuant] ?? 16.0;
  const bytesPerEl = kvBits / 8.0;
  const kvLayers = model.kv_layers ?? model.num_layers;
  const totalBytes =
    2.0 *
    kvLayers *
    model.num_kv_heads *
    model.head_dim *
    bytesPerEl *
    contextTokens;
  return round2(totalBytes / (1024 ** 3));
}

export function kvGbPer4k(model: ModelSpec, kvQuant: KvQuantKey = 'fp16'): number {
  return kvCacheGb(model, 4096, kvQuant);
}

export function classifySpeedTier(estTps: number, status: CompatStatus): SpeedTier {
  if (status === 'OOM' || estTps <= 0) return 'OOM';
  if (estTps >= SPEED_FAST_MIN) return 'Fast';
  if (estTps >= SPEED_INTERACTIVE_MIN) return 'Interactive';
  if (estTps >= SPEED_READABLE_MIN) return 'Readable';
  return 'Slow';
}

export function speedRating(tps: number, status: CompatStatus = 'Fits'): SpeedTier {
  return classifySpeedTier(tps, status);
}

export function formatTpsRange(
  low?: number,
  high?: number,
  estTps = 0,
  status: CompatStatus = 'Fits',
): string {
  if (status === 'OOM' || (estTps <= 0 && (high ?? 0) <= 0)) return 'OOM';
  const resolvedLow = low ?? Math.max(1, Math.floor(estTps * 0.85));
  const resolvedHigh = high ?? Math.max(resolvedLow, Math.ceil(estTps * 1.15));
  if (resolvedLow <= 0 && estTps < 1.0) return '<1 tok/s';
  if (resolvedLow === resolvedHigh) return `~${resolvedLow} tok/s`;
  return `~${resolvedLow}\u2013${resolvedHigh} tok/s`;
}

export function formatContextLabel(tokens: number): string {
  if (tokens >= 1024 && tokens % 1024 === 0) return `${tokens / 1024}K`;
  if (tokens >= 10000 && tokens % 1000 === 0) return `${tokens / 1000}K`;
  return String(tokens);
}

function spreadPctForStatus(status: CompatStatus): number {
  if (status === 'OOM') return 0;
  if (status === 'Fits') return 17;
  if (status === 'Tight Fit') return 20;
  return 35;
}

function computeTpsBounds(rawTps: number, status: CompatStatus): [number, number, number] {
  if (status === 'OOM' || rawTps <= 0) return [0, 0, 0];
  const spread = spreadPctForStatus(status) / 100.0;
  if (rawTps < 1.0) {
    return [round1(rawTps), 0, 1];
  }
  const estTps = Math.round(rawTps);
  const tpsLow = Math.max(1, Math.floor(rawTps * (1.0 - spread)));
  const tpsHigh = Math.max(
    tpsLow + (rawTps >= 3.0 ? 1 : 0),
    Math.ceil(rawTps * (1.0 + spread)),
  );
  return [estTps, tpsLow, tpsHigh];
}

export function estimateRigRun(opts: RigRunOptions): RigRunEstimate {
  const {
    model,
    hardware,
    cpu = null,
    systemRamGb = 64.0,
    ramBwOverrideGbps = null,
    pcieLink = 'pcie4_x16',
    gpuLayersOverride = null,
    kvOffloadToCpu = false,
    thermalProfile = 'desktop',
    kvQuant = 'fp16',
    splitMode = 'layer',
    reserveProfile = 'desktop',
    customUsableGb = null,
    flashAttention = true,
  } = opts;
  const contextTokens = opts.contextTokens ?? 8192;

  const [fmt, normQuant] = normalizeFormatAndQuant(opts.format ?? null, opts.quant ?? 'Q4_K_M');
  const bpw = QUANT_BPW[normQuant];

  const weightsGb = round2((model.params_b * bpw) / 8.0);
  const activeParamsB = model.active_params_b ?? model.params_b;
  const activeWeightsGb = round2(weightsGb * (activeParamsB / model.params_b));
  const kvGb = kvCacheGb(model, contextTokens, kvQuant);

  let effGpuCount =
    hardware === null
      ? 0
      : opts.gpuCount !== undefined
        ? Math.trunc(opts.gpuCount)
        : Math.trunc(hardware.gpu_count);
  effGpuCount = Math.max(0, Math.min(8, effGpuCount));

  let baseOverhead: number;
  if (fmt === 'AWQ') {
    baseOverhead = 0.95 + 0.032 * weightsGb;
  } else if (fmt === 'MLX') {
    baseOverhead = 0.45 + 0.015 * weightsGb;
  } else {
    baseOverhead = 0.45 + 0.012 * weightsGb;
    if (flashAttention && contextTokens >= 32768) {
      baseOverhead += 0.12;
    }
  }

  let multiGpuCtxGb = 0.55 * Math.max(0, effGpuCount - 1);
  let overheadGb = round2(baseOverhead + multiGpuCtxGb);
  let totalVramGb = round2(weightsGb + kvGb + overheadGb);

  const totalLayers = model.num_layers;
  const kvLayers = model.kv_layers ?? totalLayers;
  const isMoe = activeParamsB < model.params_b * 0.9;
  const isHybrid = kvLayers < totalLayers;
  const osReserve = osRamReserveGb(systemRamGb);
  const availableRamGb = round2(Math.max(1.0, systemRamGb - osReserve));
  const ramBw =
    ramBwOverrideGbps !== null && ramBwOverrideGbps !== undefined && ramBwOverrideGbps > 0
      ? ramBwOverrideGbps
      : cpu
        ? cpu.effective_bw_gbps
        : 55.0;
  const pcieSpec = PCIE_LINKS[pcieLink] ?? PCIE_LINKS.pcie4_x16;
  const thermalFactor = THERMAL_FACTORS[thermalProfile] ?? 1.0;
  const cpuEff = isMoe ? 0.5 : 0.62;
  const cpuEffBw = Math.max(1.0, ramBw * cpuEff * thermalFactor);

  if (hardware === null || effGpuCount === 0) {
    const gpuWeightsGb = 0.0;
    const gpuKvGb = 0.0;
    const gpuVramUsedGb = 0.0;
    const cpuWeightsGb = weightsGb;
    const cpuKvGb = kvGb;
    const cpuOverheadGb = round2(0.35 + 0.01 * cpuWeightsGb);
    const ramUsedGb = round2(cpuWeightsGb + cpuKvGb + cpuOverheadGb);
    const fitsRig = ramUsedGb <= availableRamGb;
    const status: CompatStatus = fitsRig ? 'Partial Offload' : 'OOM';
    const oomReason: OomReason | undefined = fitsRig ? undefined : 'ram';

    let layerMs = fmt === 'AWQ' ? 0.04 : fmt === 'MLX' ? 0.03 : 0.022;
    if (isMoe) layerMs += 0.055;
    const hybridMs = isHybrid ? (totalLayers - kvLayers) * (fmt === 'MLX' ? 0.145 : 0.002) : 0.0;
    const ctxK = contextTokens / 1024.0;
    const attnMs = contextTokens >= 8192 ? 0.00018 * kvLayers * Math.pow(ctxK, 1.35) : 0.0;

    const cpuWeightsMs = (activeWeightsGb / cpuEffBw) * 1000.0;
    const kvReadMs = ((cpuKvGb * 0.85) / cpuEffBw) * 1000.0;
    const fixedOverheadMs = (totalLayers * layerMs + hybridMs + attnMs) / thermalFactor;
    const totalMs = cpuWeightsMs + kvReadMs + fixedOverheadMs;
    const rawTps = fitsRig ? 1000.0 / Math.max(2.0, totalMs) : 0.0;
    const latencyMs: LatencyBreakdownMs = {
      gpu_weights_ms: 0.0,
      cpu_weights_ms: round2(cpuWeightsMs),
      kv_read_ms: round2(kvReadMs),
      pcie_transfer_ms: 0.0,
      fixed_overhead_ms: round2(fixedOverheadMs),
      total_ms: round2(totalMs),
    };
    const [estTps, tpsLow, tpsHigh] = computeTpsBounds(rawTps, status);
    return {
      quant: normQuant,
      format: fmt,
      context_tokens: contextTokens,
      weights_gb: weightsGb,
      kv_cache_gb: kvGb,
      overhead_gb: overheadGb,
      total_vram_gb: totalVramGb,
      effective_usable_vram_gb: 0,
      headroom_gb: round2(availableRamGb - ramUsedGb),
      status,
      speed_tier: classifySpeedTier(estTps, status),
      est_tps: estTps,
      est_tps_low: tpsLow,
      est_tps_high: tpsHigh,
      gpu_layers_fit: 0,
      total_layers: totalLayers,
      gpu_fraction: 0,
      comm_overhead_pct: 0,
      comm_warning: false,
      raw_vram_gb: 0,
      usable_vram_gb: 0,
      system_ram_gb: systemRamGb,
      available_ram_gb: availableRamGb,
      spill_ram_gb: ramUsedGb,
      gpu_weights_gb: gpuWeightsGb,
      gpu_kv_gb: gpuKvGb,
      gpu_vram_used_gb: gpuVramUsedGb,
      cpu_weights_gb: cpuWeightsGb,
      cpu_kv_gb: cpuKvGb,
      cpu_overhead_gb: cpuOverheadGb,
      ram_used_gb: ramUsedGb,
      ngl_mode: 'auto',
      kv_offload_to_cpu: fmt === 'GGUF' && Boolean(kvOffloadToCpu),
      pcie_link: pcieLink,
      thermal_profile: thermalProfile,
      thermal_factor: thermalFactor,
      effective_ram_bw_gbps: round1(ramBw),
      spread_pct: spreadPctForStatus(status),
      oom_reason: oomReason,
      latency_ms: latencyMs,
      fits_vram: false,
      fits_rig: fitsRig,
      bottleneck: fitsRig ? 'System RAM' : 'Insufficient Memory',
      gpu_count: 0,
      split_mode: splitMode,
      kv_quant: kvQuant,
      reserve_profile: reserveProfile,
      os_ram_reserve_gb: osReserve,
      effective_bw_gbps: round1(ramBw),
      active_params_b: activeParamsB,
    };
  }

  if (hardware.is_unified) {
    effGpuCount = 1;
    multiGpuCtxGb = 0;
    overheadGb = round2(baseOverhead);
    totalVramGb = round2(weightsGb + kvGb + overheadGb);
  }

  const [rawVramGb, usableVram] = effectiveUsableVramGb(
    hardware,
    effGpuCount,
    reserveProfile,
    customUsableGb,
  );
  const tightThreshold = Math.max(1.0, usableVram * 0.05);
  const supportsCpuOffload = fmt === 'GGUF' && !hardware.is_unified;
  const effKvOffload = supportsCpuOffload && Boolean(kvOffloadToCpu);
  const nglMode: 'auto' | 'manual' =
    supportsCpuOffload && gpuLayersOverride !== null && gpuLayersOverride !== undefined
      ? 'manual'
      : 'auto';

  let gpuLayersFit: number;
  let gpuFraction: number;
  let gpuWeightsGb: number;
  let gpuKvGb: number;
  let gpuVramUsedGb: number;
  let cpuWeightsGb: number;
  let cpuKvGb: number;
  let cpuOverheadGb: number;
  let ramUsedGb: number;
  let spillRamGb: number;
  let fitsVram: boolean;
  let fitsRig: boolean;
  let status: CompatStatus;
  let oomReason: OomReason | undefined;

  if (!supportsCpuOffload) {
    fitsVram = totalVramGb <= usableVram;
    if (fitsVram) {
      gpuLayersFit = totalLayers;
      gpuFraction = 1.0;
      gpuWeightsGb = weightsGb;
      gpuKvGb = kvGb;
      gpuVramUsedGb = totalVramGb;
      cpuWeightsGb = 0.0;
      cpuKvGb = 0.0;
      cpuOverheadGb = 0.0;
      ramUsedGb = 0.0;
      spillRamGb = 0.0;
      fitsRig = true;
      status = usableVram - totalVramGb < tightThreshold ? 'Tight Fit' : 'Fits';
    } else {
      const perLayerTotal = weightsGb / totalLayers + kvGb / totalLayers;
      const usableForModel = Math.max(0.0, usableVram - overheadGb);
      gpuLayersFit = Math.max(
        0,
        Math.min(totalLayers - 1, Math.floor(usableForModel / Math.max(0.02, perLayerTotal))),
      );
      gpuFraction = round3(gpuLayersFit / totalLayers);
      gpuWeightsGb = round2(weightsGb * gpuFraction);
      gpuKvGb = gpuLayersFit === 0 ? 0.0 : round2(kvGb * gpuFraction);
      gpuVramUsedGb = gpuLayersFit === 0 ? 0.0 : round2(gpuWeightsGb + gpuKvGb + overheadGb);
      cpuWeightsGb = round2(Math.max(0.0, weightsGb - gpuWeightsGb));
      cpuKvGb = round2(Math.max(0.0, kvGb - gpuKvGb));
      cpuOverheadGb = 0.0;
      ramUsedGb = 0.0;
      spillRamGb = round2(Math.max(0.0, totalVramGb - usableVram));
      fitsRig = false;
      status = 'OOM';
      oomReason = hardware.is_unified ? 'vram' : 'unsupported_offload';
    }
  } else {
    const perLayerW = weightsGb / totalLayers;
    const perLayerKv = effKvOffload ? 0.0 : kvGb / totalLayers;
    if (nglMode === 'manual') {
      gpuLayersFit = Math.max(0, Math.min(totalLayers, Math.trunc(gpuLayersOverride as number)));
    } else if (!effKvOffload && totalVramGb <= usableVram) {
      gpuLayersFit = totalLayers;
    } else {
      const usableForLayers = Math.max(0.0, usableVram - overheadGb);
      gpuLayersFit = Math.max(
        0,
        Math.min(totalLayers, Math.floor(usableForLayers / Math.max(0.02, perLayerW + perLayerKv))),
      );
    }

    gpuFraction = round3(gpuLayersFit / totalLayers);
    gpuWeightsGb = gpuLayersFit === totalLayers ? weightsGb : round2(weightsGb * gpuFraction);
    gpuKvGb =
      gpuLayersFit === 0 || effKvOffload
        ? 0.0
        : gpuLayersFit === totalLayers
          ? kvGb
          : round2(kvGb * gpuFraction);
    gpuVramUsedGb =
      gpuLayersFit === 0 ? 0.0 : round2(gpuWeightsGb + gpuKvGb + overheadGb);

    const cpuLayers = totalLayers - gpuLayersFit;
    cpuWeightsGb = round2(Math.max(0.0, weightsGb - gpuWeightsGb));
    cpuKvGb = round2(Math.max(0.0, kvGb - gpuKvGb));
    cpuOverheadGb = cpuLayers > 0 || effKvOffload ? round2(0.35 + 0.01 * cpuWeightsGb) : 0.0;
    ramUsedGb = round2(cpuWeightsGb + cpuKvGb + cpuOverheadGb);
    spillRamGb = ramUsedGb;

    fitsVram = gpuVramUsedGb <= usableVram;
    const fitsRam = ramUsedGb <= availableRamGb;

    if (fitsVram && gpuLayersFit === totalLayers && !effKvOffload) {
      fitsRig = true;
      status = usableVram - gpuVramUsedGb < tightThreshold ? 'Tight Fit' : 'Fits';
    } else if (fitsVram && fitsRam) {
      fitsRig = true;
      status = 'Partial Offload';
    } else {
      fitsRig = false;
      status = 'OOM';
      oomReason = !fitsVram && !fitsRam ? 'both' : !fitsVram ? 'vram' : 'ram';
    }
  }

  const headroomGb = round2(usableVram - (supportsCpuOffload ? gpuVramUsedGb : totalVramGb));
  const singleBw = hardware.bandwidth_gbps;
  const hasNvlink = Boolean(hardware.has_nvlink);
  const isLegacyGpu =
    !hardware.id.includes('ada') &&
    ['t4', 'p40', 'p100', 'gtx-10', 'gtx-16', 'rtx-20', 'titan-rtx', 'v100'].some((tag) =>
      hardware.id.includes(tag),
    );

  let backendEff: number;
  if (fmt === 'AWQ') {
    backendEff = isLegacyGpu ? 0.48 : 0.69;
  } else if (fmt === 'MLX') {
    const sizeBonus = weightsGb >= 25.0 ? 0.08 : weightsGb >= 12.0 ? 0.03 : 0.0;
    backendEff = hardware.is_unified ? 0.78 + sizeBonus : 0.72;
  } else if (hardware.backend === 'CUDA') {
    backendEff = isLegacyGpu ? 0.58 : 0.75;
  } else if (hardware.backend === 'Metal') {
    const sizeBonus = weightsGb >= 25.0 ? 0.05 : 0.0;
    backendEff = 0.78 + sizeBonus;
  } else if (hardware.backend === 'ROCm') {
    backendEff = 0.70;
  } else if (hardware.backend === 'Vulkan') {
    backendEff = 0.62;
  } else {
    backendEff = 0.60;
  }

  if (isMoe) {
    backendEff *= hardware.backend === 'CUDA' ? 0.65 : 0.71;
  }

  let layerMs = fmt === 'AWQ' ? (isLegacyGpu ? 0.080 : 0.040) : fmt === 'MLX' ? 0.030 : 0.022;
  if (isMoe) {
    layerMs += hardware.backend === 'CUDA' ? 0.072 : 0.055;
  }
  const hybridMs = isHybrid ? (totalLayers - kvLayers) * (fmt === 'MLX' ? 0.145 : 0.002) : 0.0;

  let effectiveBw: number;
  let commLatencySec = 0.0;
  let commOverheadPct = 0.0;
  let commWarning = false;

  if (effGpuCount === 1 || hardware.is_unified) {
    effectiveBw = singleBw;
  } else if (splitMode === 'tensor') {
    const bwScaling = 1.0 + (effGpuCount - 1) * (hasNvlink ? 0.9 : 0.82);
    effectiveBw = singleBw * bwScaling;
    const perOpMs = hasNvlink ? 0.014 : 0.165;
    commLatencySec =
      (2.0 * totalLayers * perOpMs * (1.0 + 0.15 * Math.max(0, effGpuCount - 2))) / 1000.0;
    commWarning = !hasNvlink;
  } else {
    const pipelineFactor = hasNvlink
      ? 0.985
      : Math.max(0.84, 1.0 - 0.045 * (effGpuCount - 1));
    effectiveBw = singleBw * pipelineFactor;
  }

  const ctxK = contextTokens / 1024.0;
  const attnMs = contextTokens >= 8192 ? 0.00018 * kvLayers * Math.pow(ctxK, 1.35) : 0.0;

  const gpuEffBw = Math.max(1.0, effectiveBw * backendEff * thermalFactor);
  const gpuWeightsMs = ((activeWeightsGb * gpuFraction) / gpuEffBw) * 1000.0;
  const cpuWeightsMs =
    gpuFraction < 1.0 ? ((activeWeightsGb * (1.0 - gpuFraction)) / cpuEffBw) * 1000.0 : 0.0;
  const kvReadMs =
    (((gpuKvGb * 0.85) / gpuEffBw) + ((cpuKvGb * 0.85) / cpuEffBw)) * 1000.0;

  const cpuLayers = Math.max(0, totalLayers - gpuLayersFit);
  const hasOffloadTraffic =
    supportsCpuOffload &&
    ((gpuLayersFit > 0 && gpuLayersFit < totalLayers) || (effKvOffload && gpuLayersFit > 0));
  const tpCommMs = commLatencySec * gpuFraction * 1000.0;
  let offloadPcieMs = 0.0;
  if (hasOffloadTraffic) {
    const estHiddenDim = Math.max(
      2048,
      Math.min(
        8192,
        Math.round(Math.sqrt((activeParamsB * 1e9) / (12.0 * Math.max(1, totalLayers)))),
      ),
    );
    const hiddenTransferGb = (2.0 * estHiddenDim * 2.0) / (1024 ** 3);
    offloadPcieMs =
      (hiddenTransferGb / pcieSpec.bwGbps) * 1000.0 +
      2.0 * pcieSpec.syncMs +
      0.035 * cpuLayers +
      (effKvOffload ? 0.04 * gpuLayersFit : 0.0);
  }
  const pcieTransferMs = tpCommMs + offloadPcieMs;
  const fixedOverheadMs = (totalLayers * layerMs + hybridMs + attnMs) / thermalFactor;
  const totalMs = gpuWeightsMs + cpuWeightsMs + kvReadMs + pcieTransferMs + fixedOverheadMs;

  let rawTps: number;
  let bottleneck: RigRunEstimate['bottleneck'];

  if (status === 'OOM') {
    rawTps = 0.0;
    bottleneck = 'Insufficient Memory';
  } else {
    rawTps = 1000.0 / Math.max(2.0, totalMs);

    if (pcieTransferMs > 0 && totalMs > 0) {
      commOverheadPct = round1((pcieTransferMs / totalMs) * 100.0);
    }

    if (gpuLayersFit === 0) {
      bottleneck = 'System RAM';
    } else if (gpuFraction < 1.0 || effKvOffload) {
      bottleneck = 'PCIe / System RAM';
    } else if (commWarning && commOverheadPct >= 20.0) {
      bottleneck = 'PCIe All-Reduce';
    } else {
      bottleneck = 'VRAM';
    }
  }

  const latencyMs: LatencyBreakdownMs = {
    gpu_weights_ms: round2(gpuWeightsMs),
    cpu_weights_ms: round2(cpuWeightsMs),
    kv_read_ms: round2(kvReadMs),
    pcie_transfer_ms: round2(pcieTransferMs),
    fixed_overhead_ms: round2(fixedOverheadMs),
    total_ms: round2(totalMs),
  };

  const [estTps, tpsLow, tpsHigh] = computeTpsBounds(rawTps, status);

  return {
    quant: normQuant,
    format: fmt,
    context_tokens: contextTokens,
    weights_gb: weightsGb,
    kv_cache_gb: kvGb,
    overhead_gb: overheadGb,
    total_vram_gb: totalVramGb,
    effective_usable_vram_gb: usableVram,
    headroom_gb: headroomGb,
    status,
    speed_tier: classifySpeedTier(estTps, status),
    est_tps: estTps,
    est_tps_low: tpsLow,
    est_tps_high: tpsHigh,
    gpu_layers_fit: gpuLayersFit,
    total_layers: totalLayers,
    gpu_fraction: gpuFraction,
    comm_overhead_pct: commOverheadPct,
    comm_warning: commWarning,
    raw_vram_gb: rawVramGb,
    usable_vram_gb: usableVram,
    system_ram_gb: systemRamGb,
    available_ram_gb: availableRamGb,
    spill_ram_gb: spillRamGb,
    gpu_weights_gb: gpuWeightsGb,
    gpu_kv_gb: gpuKvGb,
    gpu_vram_used_gb: gpuVramUsedGb,
    cpu_weights_gb: cpuWeightsGb,
    cpu_kv_gb: cpuKvGb,
    cpu_overhead_gb: cpuOverheadGb,
    ram_used_gb: ramUsedGb,
    ngl_mode: nglMode,
    kv_offload_to_cpu: effKvOffload,
    pcie_link: pcieLink,
    thermal_profile: thermalProfile,
    thermal_factor: thermalFactor,
    effective_ram_bw_gbps: round1(ramBw),
    spread_pct: spreadPctForStatus(status),
    oom_reason: oomReason,
    latency_ms: latencyMs,
    fits_vram: fitsVram,
    fits_rig: fitsRig,
    bottleneck,
    gpu_count: effGpuCount,
    split_mode: splitMode,
    kv_quant: kvQuant,
    reserve_profile: reserveProfile,
    os_ram_reserve_gb: osReserve,
    effective_bw_gbps: round1(effectiveBw),
    active_params_b: activeParamsB,
  };
}

export function estimateRun(
  model: ModelSpec,
  hardware: HardwareSpec,
  quant: QuantKey = 'Q4_K_M',
  contextTokens = 8192,
  reserveProfile: ReserveProfile = 'desktop',
  kvQuant: KvQuantKey = 'fp16',
  format?: RuntimeFormat,
  customUsableGb?: number | null,
): RunEstimate {
  const rig = estimateRigRun({
    model,
    hardware,
    gpuCount: hardware.gpu_count,
    systemRamGb: 64.0,
    quant,
    format,
    contextTokens,
    kvQuant,
    splitMode: 'layer',
    reserveProfile,
    customUsableGb,
  });

  return {
    quant: rig.quant,
    format: rig.format,
    context_tokens: rig.context_tokens,
    weights_gb: rig.weights_gb,
    kv_cache_gb: rig.kv_cache_gb,
    overhead_gb: rig.overhead_gb,
    total_vram_gb: rig.total_vram_gb,
    effective_usable_vram_gb: rig.effective_usable_vram_gb,
    headroom_gb: rig.headroom_gb,
    status: rig.status,
    speed_tier: rig.speed_tier,
    est_tps: rig.est_tps,
    est_tps_low: rig.est_tps_low,
    est_tps_high: rig.est_tps_high,
    gpu_layers_fit: rig.gpu_layers_fit,
    total_layers: rig.total_layers,
    gpu_fraction: rig.gpu_fraction,
    comm_overhead_pct: rig.comm_overhead_pct,
    comm_warning: rig.comm_warning,
  };
}

export function maxFitContextDetails(
  model: ModelSpec,
  hardware: HardwareSpec,
  quant: QuantKey = 'Q4_K_M',
  reserveProfile: ReserveProfile = 'desktop',
  kvQuant: KvQuantKey = 'fp16',
  customUsableGb?: number | null,
): {
  contextTokens: number;
  totalVramGb: number;
  status: CompatStatus;
  estTpsLow: number;
  estTpsHigh: number;
  speedTier: SpeedTier;
} {
  const tiers = CONTEXT_LADDER.filter((t) => t <= model.max_context);
  let bestCtx = 0;
  let bestVram = 0;
  let bestStatus: CompatStatus = 'OOM';
  let bestLow = 0;
  let bestHigh = 0;
  let bestTier: SpeedTier = 'OOM';
  for (const ctx of tiers) {
    const res = estimateRun(model, hardware, quant, ctx, reserveProfile, kvQuant, undefined, customUsableGb);
    if (res.status === 'Fits' || res.status === 'Tight Fit') {
      bestCtx = ctx;
      bestVram = res.total_vram_gb;
      bestStatus = res.status;
      bestLow = res.est_tps_low ?? 0;
      bestHigh = res.est_tps_high ?? 0;
      bestTier = res.speed_tier ?? classifySpeedTier(res.est_tps, res.status);
    } else {
      break;
    }
  }
  return {
    contextTokens: bestCtx,
    totalVramGb: bestVram,
    status: bestStatus,
    estTpsLow: bestLow,
    estTpsHigh: bestHigh,
    speedTier: bestTier,
  };
}

export function maxSmoothContext(
  model: ModelSpec,
  hardware: HardwareSpec,
  quant: QuantKey = 'Q4_K_M',
  reserveProfile: ReserveProfile = 'desktop',
  kvQuant: KvQuantKey = 'fp16',
): number {
  return maxFitContextDetails(model, hardware, quant, reserveProfile, kvQuant).contextTokens;
}

export function buildRuntimeCommand(params: {
  model: ModelSpec;
  hardware: HardwareSpec | null;
  format: RuntimeFormat;
  quant: QuantKey;
  contextTokens: number;
  kvQuant: KvQuantKey;
  gpuCount: number;
  splitMode: SplitMode;
  gpuLayersFit: number;
  fitsVram: boolean;
  nglMode?: 'auto' | 'manual';
  kvOffloadToCpu?: boolean;
  totalLayers?: number;
  recommendedThreads?: number;
}): { primaryLabel: string; command: string; secondaryCommand?: string } {
  const {
    model,
    hardware,
    format,
    quant,
    contextTokens,
    kvQuant,
    gpuCount,
    splitMode,
    gpuLayersFit,
    fitsVram,
    nglMode = 'auto',
    kvOffloadToCpu = false,
    totalLayers = model.num_layers,
    recommendedThreads = 8,
  } = params;

  if (format === 'AWQ') {
    const awqRepo = model.awq_repo || model.hf_repo.replace('-GGUF', '-AWQ');
    const tpFlag = gpuCount > 1 ? ` --tensor-parallel-size ${gpuCount}` : '';
    const quantFlag = quant === 'FP8' ? '--quantization fp8' : '--quantization awq';
    const kvFlag = kvQuant === 'q8_0' ? ' --kv-cache-dtype fp8' : '';
    return {
      primaryLabel: quant === 'FP8' ? 'vLLM FP8' : 'vLLM AWQ',
      command: `vllm serve ${awqRepo} ${quantFlag} --max-model-len ${contextTokens}${tpFlag}${kvFlag}`,
    };
  }

  if (format === 'MLX') {
    const mlxRepo = model.mlx_repo || `mlx-community/${model.name}-4bit`;
    return {
      primaryLabel: 'mlx_lm (Apple Silicon)',
      command: `mlx_lm.generate --model ${mlxRepo} --max-tokens 1024 --prompt "Explain KV cache sizing"`,
    };
  }

  const fullAuto = nglMode !== 'manual' && fitsVram && gpuLayersFit >= totalLayers && !kvOffloadToCpu;
  const ngl = gpuCount === 0 || hardware === null ? 0 : fullAuto ? 99 : gpuLayersFit;
  const faFlag = hardware && (hardware.backend === 'CUDA' || hardware.backend === 'Metal') ? '-fa on' : '-fa off';
  const kvFlag = kvQuant !== 'fp16' ? ` --cache-type-k ${kvQuant} --cache-type-v ${kvQuant}` : '';
  const nkvoFlag = kvOffloadToCpu ? ' -nkvo' : '';
  const threadFlag = gpuCount === 0 || hardware === null || gpuLayersFit < totalLayers || kvOffloadToCpu ? ` -t ${recommendedThreads}` : '';
  const splitFlag = gpuCount > 1 && splitMode === 'tensor' ? ' -sm row' : '';
  return {
    primaryLabel: 'llama.cpp CLI',
    command: `llama-cli -hf ${model.hf_repo}:${quant} -ngl ${ngl} -c ${contextTokens} ${faFlag}${kvFlag}${nkvoFlag}${threadFlag}${splitFlag}`,
    secondaryCommand: `OLLAMA_NUM_CTX=${contextTokens} ollama run ${model.ollama_tag}`,
  };
}
