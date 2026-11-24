import type {
  CompatStatus,
  HardwareSpec,
  KvQuantKey,
  ModelSpec,
  QuantKey,
  RigRunEstimate,
  RigRunOptions,
  RunEstimate,
  SplitMode,
} from '../types/vram';

export const ALL_QUANT_ORDER: QuantKey[] = [
  'Q2_K',
  'Q3_K_M',
  'Q4_K_M',
  'Q5_K_M',
  'Q6_K',
  'Q8_0',
  'FP16',
];

export const QUANT_BPW: Record<QuantKey, number> = {
  Q2_K: 3.0,
  Q3_K_M: 3.9,
  Q4_K_M: 4.85,
  Q5_K_M: 5.7,
  Q6_K: 6.6,
  Q8_0: 8.5,
  FP16: 16.0,
};

export const KV_QUANT_BYTES: Record<KvQuantKey, number> = {
  FP16: 2.0,
  Q8_0: 1.0,
  Q4_0: 0.5,
};

export const EFFICIENCY_CUDA: Record<QuantKey, number> = {
  Q2_K: 0.75,
  Q3_K_M: 0.77,
  Q4_K_M: 0.78,
  Q5_K_M: 0.79,
  Q6_K: 0.79,
  Q8_0: 0.8,
  FP16: 0.82,
};

export const EFFICIENCY_METAL: Record<QuantKey, number> = {
  Q2_K: 0.71,
  Q3_K_M: 0.73,
  Q4_K_M: 0.74,
  Q5_K_M: 0.75,
  Q6_K: 0.75,
  Q8_0: 0.76,
  FP16: 0.78,
};

export const EFFICIENCY_ROCM: Record<QuantKey, number> = {
  Q2_K: 0.67,
  Q3_K_M: 0.69,
  Q4_K_M: 0.7,
  Q5_K_M: 0.71,
  Q6_K: 0.71,
  Q8_0: 0.72,
  FP16: 0.74,
};

export const EFFICIENCY_VULKAN: Record<QuantKey, number> = {
  Q2_K: 0.63,
  Q3_K_M: 0.64,
  Q4_K_M: 0.65,
  Q5_K_M: 0.66,
  Q6_K: 0.66,
  Q8_0: 0.67,
  FP16: 0.69,
};

export const EFFICIENCY_CPU: Record<QuantKey, number> = {
  Q2_K: 0.82,
  Q3_K_M: 0.84,
  Q4_K_M: 0.86,
  Q5_K_M: 0.87,
  Q6_K: 0.87,
  Q8_0: 0.88,
  FP16: 0.85,
};

export const EFFICIENCY_BY_BACKEND: Record<string, Record<QuantKey, number>> = {
  CUDA: EFFICIENCY_CUDA,
  Metal: EFFICIENCY_METAL,
  ROCm: EFFICIENCY_ROCM,
  Vulkan: EFFICIENCY_VULKAN,
  CPU: EFFICIENCY_CPU,
};

export const MULTI_GPU_EFFICIENCY = 0.92;
export const CPU_OFFLOAD_BW_GBPS = 35.0;
export const CONTEXT_CHECKPOINTS = [65536, 49152, 32768, 16384, 8192, 4096];

const LAYER_SPLIT_EFF: Record<number, number> = {
  1: 1.0,
  2: 0.92,
  3: 0.89,
  4: 0.86,
  6: 0.83,
  8: 0.8,
};

const TP_PCIE_EFF: Record<number, number> = {
  1: 1.0,
  2: 0.8,
  3: 0.74,
  4: 0.68,
  6: 0.6,
  8: 0.55,
};

const TP_NVLINK_EFF: Record<number, number> = {
  1: 1.0,
  2: 0.9,
  3: 0.87,
  4: 0.84,
  6: 0.8,
  8: 0.78,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function osRamReserveGb(systemRamGb: number): number {
  if (systemRamGb <= 16) return 4.0;
  if (systemRamGb <= 32) return 6.0;
  return 8.0;
}

function splitScaleFactor(
  gpuCount: number,
  splitMode: SplitMode,
  hasNvlink: boolean,
): number {
  if (gpuCount <= 1) return 1.0;
  if (splitMode === 'row') {
    const table = hasNvlink ? TP_NVLINK_EFF : TP_PCIE_EFF;
    const eff = table[gpuCount] ?? 0.52;
    return eff * gpuCount;
  }
  return LAYER_SPLIT_EFF[gpuCount] ?? 0.8;
}

/**
 * Exact mirror of scripts/physics.py estimate_rig_run() for Multi-GPU (1x-8x),
 * 7-tier quantization, FP16/Q8_0/Q4_0 KV cache, MoE active params, and CPU+RAM offload.
 */
export function estimateRigRun(
  model: ModelSpec,
  hardware: HardwareSpec | null,
  options: RigRunOptions = {},
): RigRunEstimate {
  const quant: QuantKey = options.quant ?? 'Q4_K_M';
  const contextTokens = options.contextTokens ?? 8192;
  const kvQuant: KvQuantKey = options.kvQuant ?? 'FP16';
  const reqGpuCount = options.gpuCount ?? (hardware ? hardware.gpu_count ?? 1 : 0);
  const splitMode: SplitMode = options.splitMode ?? 'layer';
  const cpuBwGbps = options.cpuBwGbps ?? CPU_OFFLOAD_BW_GBPS;
  const systemRamGb = options.systemRamGb ?? null;

  const bpw = QUANT_BPW[quant];
  const paramsB = model.params_b;
  const weightsGb = (paramsB * bpw) / 8.0;
  const activeParamsB = model.active_params_b ?? paramsB;
  const activeRatio = paramsB > 0 ? Math.min(1.0, activeParamsB / paramsB) : 1.0;
  const activeWeightsGb = weightsGb * activeRatio;

  const kvBytesPerElem = KV_QUANT_BYTES[kvQuant];
  const kvBytes =
    2 *
    model.num_layers *
    model.num_kv_heads *
    model.head_dim *
    contextTokens *
    kvBytesPerElem;
  const kvCacheGb = kvBytes / 1024 ** 3;
  const kvReadGb = kvCacheGb * 0.5;

  const overheadGb = Math.min(2.0, 0.5 + 0.015 * paramsB);
  const totalVramGb = weightsGb + kvCacheGb + overheadGb;

  const isCpuOnly = hardware === null || reqGpuCount <= 0;

  if (isCpuOnly) {
    const sysRam = systemRamGb !== null ? systemRamGb : 32.0;
    const usableRam = Math.max(0.0, sysRam - osRamReserveGb(sysRam));
    let status: CompatStatus;
    let oomReason = '';
    if (totalVramGb <= usableRam) {
      status = 'Smooth';
    } else if (totalVramGb <= sysRam * 0.94) {
      status = 'Partial Offload';
      oomReason = 'Exceeds usable OS-reserved RAM; risks SSD swap thrashing.';
    } else {
      status = 'OOM';
      oomReason = 'Exceeds total physical System RAM.';
    }

    const cpuEff = EFFICIENCY_CPU[quant];
    const effectiveCpuBw = cpuBwGbps * cpuEff;
    const readGb = activeWeightsGb + kvReadGb;
    let estTps = 0.0;
    if (status !== 'OOM' && readGb > 0) {
      estTps =
        status === 'Smooth'
          ? effectiveCpuBw / readGb
          : (effectiveCpuBw / readGb) * 0.35;
    }

    return {
      quant,
      kv_quant: kvQuant,
      context_tokens: contextTokens,
      weights_gb: round2(weightsGb),
      kv_cache_gb: round2(kvCacheGb),
      overhead_gb: round2(overheadGb),
      total_vram_gb: round2(totalVramGb),
      status,
      est_tps: round1(estTps),
      gpu_layers_fit: 0,
      total_layers: model.num_layers,
      gpu_fraction: 0.0,
      gpu_count: 0,
      split_mode: splitMode,
      usable_vram_gb: 0.0,
      total_phys_vram_gb: 0.0,
      offload_ram_gb: round2(totalVramGb),
      usable_ram_gb: round2(usableRam),
      is_cpu_only: true,
      oom_reason: oomReason,
    };
  }

  const baseGpuCount = hardware.gpu_count || 1;
  const effGpuCount = hardware.is_unified ? 1 : Math.max(1, reqGpuCount);
  const scaleVram = effGpuCount / baseGpuCount;

  const usable = hardware.usable_vram_gb * scaleVram;
  const physVram = hardware.vram_gb * scaleVram;

  const memForWeights = Math.max(0.0, usable - kvCacheGb - overheadGb);
  const gpuFraction =
    weightsGb > 0 ? Math.min(1.0, memForWeights / weightsGb) : 1.0;
  const gpuLayersFit =
    totalVramGb <= usable
      ? model.num_layers
      : Math.floor(model.num_layers * gpuFraction);
  const offloadRamGb =
    totalVramGb <= usable ? 0.0 : Math.max(0.0, totalVramGb - usable);
  const usableRam =
    systemRamGb !== null
      ? Math.max(0.0, systemRamGb - osRamReserveGb(systemRamGb))
      : 9999.0;

  let status: CompatStatus;
  let oomReason = '';
  if (totalVramGb <= usable) {
    status = 'Smooth';
  } else if (hardware.is_unified) {
    if (totalVramGb <= physVram * 0.92) {
      status = 'Partial Offload';
      oomReason = 'Exceeds safe unified wired ceiling; risks OS memory pressure.';
    } else {
      status = 'OOM';
      oomReason = 'Exceeds usable unified memory capacity.';
    }
  } else if (systemRamGb !== null) {
    if (gpuLayersFit < 1) {
      status = 'OOM';
      oomReason = 'KV cache & overhead alone exceed GPU VRAM.';
    } else if (offloadRamGb > usableRam) {
      status = 'OOM';
      oomReason = 'Spill weights exceed available System RAM.';
    } else {
      status = 'Partial Offload';
      oomReason = 'Remaining layers spill to System RAM over PCIe.';
    }
  } else {
    if (totalVramGb <= usable * 2.0 && gpuFraction >= 0.35) {
      status = 'Partial Offload';
      oomReason = 'Remaining layers spill to System RAM over PCIe.';
    } else {
      status = 'OOM';
      oomReason = 'Exceeds GPU VRAM practical offload threshold.';
    }
  }

  const eff = (EFFICIENCY_BY_BACKEND[hardware.backend] ?? EFFICIENCY_CUDA)[quant];
  const multiFactor = splitScaleFactor(
    effGpuCount,
    splitMode,
    Boolean(hardware.has_nvlink),
  );
  const effectiveBw = hardware.bandwidth_gbps * eff * multiFactor;

  let estTps = 0.0;
  if (status === 'OOM') {
    estTps = 0.0;
  } else if (status === 'Smooth') {
    estTps = effectiveBw / (activeWeightsGb + kvReadGb);
  } else if (hardware.is_unified) {
    estTps = (effectiveBw / (activeWeightsGb + kvReadGb)) * 0.55;
  } else {
    const tGpu = (activeWeightsGb * gpuFraction + kvReadGb) / effectiveBw;
    const cpuBw = Math.max(1.0, cpuBwGbps);
    const tCpu = (activeWeightsGb * (1.0 - gpuFraction)) / cpuBw;
    estTps = tGpu + tCpu > 0 ? 1.0 / (tGpu + tCpu) : 0.0;
  }

  return {
    quant,
    kv_quant: kvQuant,
    context_tokens: contextTokens,
    weights_gb: round2(weightsGb),
    kv_cache_gb: round2(kvCacheGb),
    overhead_gb: round2(overheadGb),
    total_vram_gb: round2(totalVramGb),
    status,
    est_tps: round1(estTps),
    gpu_layers_fit: gpuLayersFit,
    total_layers: model.num_layers,
    gpu_fraction: round3(gpuFraction),
    gpu_count: effGpuCount,
    split_mode: splitMode,
    usable_vram_gb: round2(usable),
    total_phys_vram_gb: round2(physVram),
    offload_ram_gb: round2(offloadRamGb),
    usable_ram_gb: systemRamGb !== null ? round2(usableRam) : 0.0,
    is_cpu_only: false,
    oom_reason: oomReason,
  };
}

export function estimateRun(
  model: ModelSpec,
  hardware: HardwareSpec,
  quant: QuantKey = 'Q4_K_M',
  contextTokens = 8192,
): RunEstimate {
  const rig = estimateRigRun(model, hardware, {
    quant,
    contextTokens,
    kvQuant: 'FP16',
    gpuCount: hardware.gpu_count ?? 1,
    splitMode: 'layer',
    cpuBwGbps: CPU_OFFLOAD_BW_GBPS,
    systemRamGb: null,
  });
  return {
    quant: rig.quant,
    context_tokens: rig.context_tokens,
    weights_gb: rig.weights_gb,
    kv_cache_gb: rig.kv_cache_gb,
    overhead_gb: rig.overhead_gb,
    total_vram_gb: rig.total_vram_gb,
    status: rig.status,
    est_tps: rig.est_tps,
    gpu_layers_fit: rig.gpu_layers_fit,
    total_layers: rig.total_layers,
    gpu_fraction: rig.gpu_fraction,
  };
}

export function maxSmoothContext(
  model: ModelSpec,
  hardware: HardwareSpec,
  quant: QuantKey = 'Q4_K_M',
): number {
  for (const ctx of CONTEXT_CHECKPOINTS) {
    const est = estimateRun(model, hardware, quant, ctx);
    if (est.status === 'Smooth' && ctx <= model.max_context) {
      return ctx;
    }
  }
  return 0;
}

export function formatContextLabel(tokens: number): string {
  if (tokens >= 1024) {
    return `${Math.round(tokens / 1024)}K`;
  }
  return String(tokens);
}

export function speedRating(
  tps: number,
  status: CompatStatus,
  opts?: { isUnified?: boolean; isCpuOnly?: boolean },
): string {
  if (status === 'OOM' || tps <= 0) return 'Impractical (OOM)';
  if (tps >= 50) return 'Blazing (>50 tok/s)';
  if (tps >= 20) return 'Fast Interactive';
  if (tps >= 8) return 'Readable Speed';
  if (opts?.isCpuOnly) return 'Slow (CPU / RAM Bound)';
  if (status === 'Smooth') return 'Slow (Bandwidth-Limited)';
  if (opts?.isUnified) return 'Slow (Unified Swap Pressure)';
  return 'Slow (PCIe / CPU Offload)';
}
