import type {
  CompatStatus,
  HardwareSpec,
  KvQuantKey,
  ModelSpec,
  QuantKey,
  ReserveProfile,
  RigRunEstimate,
  RigRunOptions,
  RunEstimate,
  RuntimeFormat,
  SpeedTier,
  SplitMode,
} from '../types/vram';

/**
 * Deterministic LLM VRAM, Context, Offload, and Throughput Physics Engine (v3.1).
 * Keep constants and formulas strictly synchronized with `scripts/physics.py`.
 * All token/s outputs are honest formula estimate ranges (~low–high tok/s), never raw telemetry.
 */

export const ENGINE_VERSION = 'v3.1';

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

function computeTpsBounds(rawTps: number, status: CompatStatus): [number, number, number] {
  if (status === 'OOM' || rawTps <= 0) return [0, 0, 0];
  const spread = status === 'Fits' ? 0.15 : status === 'Tight Fit' ? 0.2 : 0.25;
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
  const osReserve = osRamReserveGb(systemRamGb);
  const availableRamGb = round2(Math.max(1.0, systemRamGb - osReserve));

  if (hardware === null || effGpuCount === 0) {
    const cpuBw = cpu ? cpu.effective_bw_gbps : 55.0;
    const fitsRig = totalVramGb <= availableRamGb;
    const status: CompatStatus = fitsRig ? 'Partial Offload' : 'OOM';
    const rawTps = fitsRig
      ? (cpuBw * 0.58) / Math.max(0.35, activeWeightsGb + kvGb * 0.4)
      : 0.0;
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
      headroom_gb: round2(availableRamGb - totalVramGb),
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
      spill_ram_gb: round2(totalVramGb),
      fits_vram: false,
      fits_rig: fitsRig,
      bottleneck: fitsRig ? 'System RAM' : 'Insufficient Memory',
      gpu_count: 0,
      split_mode: splitMode,
      kv_quant: kvQuant,
      reserve_profile: reserveProfile,
      os_ram_reserve_gb: osReserve,
      effective_bw_gbps: cpuBw,
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
  const headroomGb = round2(usableVram - totalVramGb);
  const tightThreshold = Math.max(1.0, usableVram * 0.05);
  const fitsVram = totalVramGb <= usableVram;

  let gpuLayersFit: number;
  let gpuFraction: number;
  let spillRamGb: number;
  let fitsRig: boolean;
  let status: CompatStatus;

  if (fitsVram) {
    gpuLayersFit = totalLayers;
    gpuFraction = 1.0;
    spillRamGb = 0.0;
    fitsRig = true;
    status = headroomGb < tightThreshold ? 'Tight Fit' : 'Fits';
  } else {
    const perLayerWeightGb = weightsGb / totalLayers;
    const usableForWeights = Math.max(0.0, usableVram - overheadGb - kvGb);
    gpuLayersFit = Math.max(
      0,
      Math.min(totalLayers - 1, Math.floor(usableForWeights / Math.max(0.02, perLayerWeightGb))),
    );
    gpuFraction = round3(gpuLayersFit / totalLayers);
    spillRamGb = round2(Math.max(0.0, totalVramGb - usableVram));

    if (hardware.is_unified) {
      fitsRig = false;
      status = 'OOM';
    } else {
      fitsRig = gpuFraction >= 0.15 && spillRamGb <= availableRamGb;
      status = fitsRig ? 'Partial Offload' : 'OOM';
    }
  }

  const singleBw = hardware.bandwidth_gbps;
  const hasNvlink = Boolean(hardware.has_nvlink);

  let backendEff: number;
  if (fmt === 'AWQ') {
    backendEff = hardware.id.includes('t4') ? 0.58 : 0.68;
  } else if (fmt === 'MLX') {
    backendEff = hardware.is_unified ? 0.76 : 0.72;
  } else if (hardware.backend === 'CUDA') {
    backendEff = hardware.id.includes('t4') ? 0.62 : 0.72;
  } else if (hardware.backend === 'Metal') {
    backendEff = 0.72;
  } else if (hardware.backend === 'ROCm') {
    backendEff = 0.68;
  } else if (hardware.backend === 'Vulkan') {
    backendEff = 0.62;
  } else {
    backendEff = 0.58;
  }

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

  const cpuBw = cpu ? cpu.effective_bw_gbps : 55.0;
  const activeKvGb = kvGb * 0.35;

  let rawTps: number;
  let bottleneck: RigRunEstimate['bottleneck'];

  if (status === 'OOM') {
    rawTps = 0.0;
    bottleneck = 'Insufficient Memory';
  } else {
    const gpuTime =
      (activeWeightsGb * gpuFraction + activeKvGb * gpuFraction) /
      Math.max(1.0, effectiveBw * backendEff);
    const cpuTime =
      gpuFraction < 1.0
        ? (activeWeightsGb * (1.0 - gpuFraction) + activeKvGb * (1.0 - gpuFraction)) /
          Math.max(1.0, cpuBw * 0.6)
        : 0.0;
    const totalTokSec = gpuTime + cpuTime + commLatencySec;
    rawTps = 1.0 / Math.max(0.002, totalTokSec);

    if (commLatencySec > 0 && totalTokSec > 0) {
      commOverheadPct = round1((commLatencySec / totalTokSec) * 100.0);
    }

    if (gpuFraction < 1.0) {
      bottleneck = 'PCIe / System RAM';
    } else if (commWarning && commOverheadPct >= 20.0) {
      bottleneck = 'PCIe All-Reduce';
    } else {
      bottleneck = 'VRAM';
    }
  }

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
): { contextTokens: number; totalVramGb: number; status: CompatStatus } {
  const tiers = CONTEXT_LADDER.filter((t) => t <= model.max_context);
  let bestCtx = 0;
  let bestVram = 0;
  let bestStatus: CompatStatus = 'OOM';
  for (const ctx of tiers) {
    const res = estimateRun(model, hardware, quant, ctx, reserveProfile, kvQuant);
    if (res.status === 'Fits' || res.status === 'Tight Fit') {
      bestCtx = ctx;
      bestVram = res.total_vram_gb;
      bestStatus = res.status;
    } else {
      break;
    }
  }
  return { contextTokens: bestCtx, totalVramGb: bestVram, status: bestStatus };
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

  const ngl = fitsVram ? 99 : gpuLayersFit;
  const faFlag = hardware && (hardware.backend === 'CUDA' || hardware.backend === 'Metal') ? '-fa on' : '-fa off';
  const kvFlag = kvQuant !== 'fp16' ? ` --cache-type-k ${kvQuant} --cache-type-v ${kvQuant}` : '';
  const splitFlag = gpuCount > 1 && splitMode === 'tensor' ? ' -sm row' : '';
  return {
    primaryLabel: 'llama.cpp CLI',
    command: `llama-cli -hf ${model.hf_repo}:${quant} -ngl ${ngl} -c ${contextTokens} ${faFlag}${kvFlag}${splitFlag}`,
    secondaryCommand: `OLLAMA_NUM_CTX=${contextTokens} ollama run ${model.ollama_tag}`,
  };
}
