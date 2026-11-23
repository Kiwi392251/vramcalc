import type {
  CompatStatus,
  HardwareSpec,
  ModelSpec,
  QuantKey,
  RunEstimate,
} from '../types/vram';

export const QUANT_BPW: Record<QuantKey, number> = {
  Q4_K_M: 4.85,
  Q5_K_M: 5.7,
  Q6_K: 6.6,
  Q8_0: 8.5,
  FP16: 16.0,
};

export const EFFICIENCY_CUDA: Record<QuantKey, number> = {
  Q4_K_M: 0.78,
  Q5_K_M: 0.79,
  Q6_K: 0.79,
  Q8_0: 0.8,
  FP16: 0.82,
};

export const EFFICIENCY_METAL: Record<QuantKey, number> = {
  Q4_K_M: 0.74,
  Q5_K_M: 0.75,
  Q6_K: 0.75,
  Q8_0: 0.76,
  FP16: 0.78,
};

export const CPU_OFFLOAD_BW_GBPS = 35.0;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Exact mirror of scripts/physics.py estimate_run() so SSR, client interactive
 * calculator, and offline pSEO pipeline produce identical VRAM & tok/s math.
 */
export function estimateRun(
  model: ModelSpec,
  hardware: HardwareSpec,
  quant: QuantKey = 'Q4_K_M',
  contextTokens = 8192,
): RunEstimate {
  const bpw = QUANT_BPW[quant];
  const weightsGb = (model.params_b * bpw) / 8.0;

  const kvBytes =
    2 *
    model.num_layers *
    model.num_kv_heads *
    model.head_dim *
    contextTokens *
    2;
  const kvCacheGb = kvBytes / 1024 ** 3;

  const overheadGb = Math.min(2.0, 0.5 + 0.015 * model.params_b);
  const totalVramGb = weightsGb + kvCacheGb + overheadGb;

  const usable = hardware.usable_vram_gb;
  const memForWeights = Math.max(0.0, usable - kvCacheGb - overheadGb);
  const gpuFraction =
    weightsGb > 0 ? Math.min(1.0, memForWeights / weightsGb) : 1.0;
  const gpuLayersFit =
    totalVramGb <= usable
      ? model.num_layers
      : Math.floor(model.num_layers * gpuFraction);

  let status: CompatStatus;
  if (totalVramGb <= usable) {
    status = 'Smooth';
  } else if (hardware.is_unified) {
    status = totalVramGb <= hardware.vram_gb * 0.92 ? 'Partial Offload' : 'OOM';
  } else {
    status =
      totalVramGb <= usable * 2.0 && gpuFraction >= 0.35
        ? 'Partial Offload'
        : 'OOM';
  }

  const eff = (hardware.is_unified ? EFFICIENCY_METAL : EFFICIENCY_CUDA)[quant];
  const kvReadGb = kvCacheGb * 0.5;

  let estTps = 0.0;
  if (status === 'OOM') {
    estTps = 0.0;
  } else if (status === 'Smooth') {
    estTps = (hardware.bandwidth_gbps * eff) / (weightsGb + kvReadGb);
  } else if (hardware.is_unified) {
    estTps =
      ((hardware.bandwidth_gbps * eff) / (weightsGb + kvReadGb)) * 0.55;
  } else {
    const tGpu =
      (weightsGb * gpuFraction + kvReadGb) / (hardware.bandwidth_gbps * eff);
    const tCpu = (weightsGb * (1.0 - gpuFraction)) / CPU_OFFLOAD_BW_GBPS;
    estTps = tGpu + tCpu > 0 ? 1.0 / (tGpu + tCpu) : 0.0;
  }

  return {
    quant,
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
  };
}

export function formatContextLabel(tokens: number): string {
  if (tokens >= 1024) {
    return `${Math.round(tokens / 1024)}K`;
  }
  return String(tokens);
}

export function speedRating(tps: number, status: CompatStatus): string {
  if (status === 'OOM' || tps <= 0) return 'Impractical (OOM)';
  if (tps >= 50) return 'Blazing (>50 tok/s)';
  if (tps >= 20) return 'Fast Interactive';
  if (tps >= 8) return 'Readable Speed';
  return 'Slow (PCIe / RAM Bound)';
}
