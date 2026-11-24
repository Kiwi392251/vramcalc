import type {
  CompatStatus,
  FaqItem,
  HardwareSpec,
  ModelSpec,
  PageEntry,
  QuantRow,
} from '../types/vram';
import { formatContextLabel } from './physics';

export type HardwareGroup =
  | 'Desktop GPU'
  | 'Multi-GPU & Workstation'
  | 'Unified Memory'
  | 'Laptop GPU';

export interface RecommendedPick {
  role: string;
  accent: string;
  entry: PageEntry;
}

export interface HardwareHub {
  hardware: HardwareSpec;
  group: HardwareGroup;
  entries: PageEntry[];
  smoothEntries: PageEntry[];
  partialEntries: PageEntry[];
  oomEntries: PageEntry[];
  smoothCount: number;
  partialCount: number;
  oomCount: number;
  picks: RecommendedPick[];
}

export interface TopHardwarePick {
  role: string;
  accent: string;
  entry: PageEntry;
}

export interface ModelHub {
  model: ModelSpec;
  entries: PageEntry[];
  smoothEntries: PageEntry[];
  partialEntries: PageEntry[];
  oomEntries: PageEntry[];
  smoothCount: number;
  partialCount: number;
  oomCount: number;
  fastestTps: number;
  q4Row?: QuantRow;
  q8Row?: QuantRow;
  fp16Row?: QuantRow;
  kvPer4k: number;
  topPicks: TopHardwarePick[];
}

export function statusRank(s: CompatStatus): number {
  if (s === 'Smooth') return 0;
  if (s === 'Partial Offload') return 1;
  return 2;
}

export function resolveHardwareGroup(h: HardwareSpec): HardwareGroup {
  if (h.category === 'Laptop GPU' || h.series.includes('Laptop')) {
    return 'Laptop GPU';
  }
  if (
    h.category === 'Multi-GPU' ||
    h.category === 'Workstation' ||
    h.series.includes('Multi-GPU') ||
    h.series.includes('Workstation')
  ) {
    return 'Multi-GPU & Workstation';
  }
  if (h.is_unified || h.category === 'Unified Memory') {
    return 'Unified Memory';
  }
  return 'Desktop GPU';
}

export function buildHardwareHubs(allEntries: PageEntry[]): HardwareHub[] {
  const hwSpecMap = new Map<string, HardwareSpec>();
  const hwEntriesMap = new Map<string, PageEntry[]>();

  for (const entry of allEntries) {
    const hwId = entry.hardware.id;
    const prev = hwSpecMap.get(hwId);
    const merged: HardwareSpec = prev ? { ...prev, ...entry.hardware } : { ...entry.hardware };
    if (prev?.category && !merged.category) {
      merged.category = prev.category;
    }
    if (prev?.gpu_count !== undefined && merged.gpu_count === undefined) {
      merged.gpu_count = prev.gpu_count;
    }
    hwSpecMap.set(hwId, merged);

    const list = hwEntriesMap.get(hwId);
    if (list) {
      list.push(entry);
    } else {
      hwEntriesMap.set(hwId, [entry]);
    }
  }

  const hubs: HardwareHub[] = [];

  for (const [hwId, rawList] of hwEntriesMap.entries()) {
    const hardware = hwSpecMap.get(hwId)!;
    const entries = [...rawList].sort((a, b) => {
      const sr = statusRank(a.default_result.status) - statusRank(b.default_result.status);
      if (sr !== 0) return sr;
      if (b.model.params_b !== a.model.params_b) return b.model.params_b - a.model.params_b;
      if (b.default_result.est_tps !== a.default_result.est_tps) {
        return b.default_result.est_tps - a.default_result.est_tps;
      }
      return a.model.name.localeCompare(b.model.name);
    });

    const smoothEntries = entries.filter((e) => e.default_result.status === 'Smooth');
    const partialEntries = entries.filter((e) => e.default_result.status === 'Partial Offload');
    const oomEntries = entries.filter((e) => e.default_result.status === 'OOM');

    const picks: RecommendedPick[] = [];
    const pickedSlugs = new Set<string>();

    if (smoothEntries.length > 0) {
      const flagshipPick = [...smoothEntries].sort((a, b) => {
        if (b.model.params_b !== a.model.params_b) return b.model.params_b - a.model.params_b;
        return b.default_result.est_tps - a.default_result.est_tps;
      })[0];
      if (flagshipPick) {
        pickedSlugs.add(flagshipPick.slug);
        picks.push({
          role: 'Flagship Quality Pick',
          accent: 'border-emerald-200 bg-emerald-50 text-emerald-800',
          entry: flagshipPick,
        });
      }

      const fastestPick = [...smoothEntries].sort(
        (a, b) => b.default_result.est_tps - a.default_result.est_tps
      )[0];
      if (fastestPick && !pickedSlugs.has(fastestPick.slug)) {
        pickedSlugs.add(fastestPick.slug);
        picks.push({
          role: 'Fastest Interactive Pick',
          accent: 'border-blue-200 bg-blue-50 text-blue-800',
          entry: fastestPick,
        });
      }

      const codingPick = [...smoothEntries]
        .filter((e) => e.model.family === 'Qwen2.5-Coder')
        .sort((a, b) => {
          if (b.model.params_b !== a.model.params_b) return b.model.params_b - a.model.params_b;
          return b.default_result.est_tps - a.default_result.est_tps;
        })[0];
      if (codingPick && !pickedSlugs.has(codingPick.slug)) {
        pickedSlugs.add(codingPick.slug);
        picks.push({
          role: 'Best Coding Pick',
          accent: 'border-indigo-200 bg-indigo-50 text-indigo-800',
          entry: codingPick,
        });
      }
    } else if (entries.length > 0) {
      const viablePick =
        partialEntries.length > 0
          ? [...partialEntries].sort((a, b) => b.default_result.est_tps - a.default_result.est_tps)[0]
          : [...entries].sort((a, b) => a.model.params_b - b.model.params_b)[0];
      if (viablePick) {
        pickedSlugs.add(viablePick.slug);
        picks.push({
          role: 'Closest Viable Run',
          accent: 'border-amber-200 bg-amber-50 text-amber-800',
          entry: viablePick,
        });
      }
    }

    hubs.push({
      hardware,
      group: resolveHardwareGroup(hardware),
      entries,
      smoothEntries,
      partialEntries,
      oomEntries,
      smoothCount: smoothEntries.length,
      partialCount: partialEntries.length,
      oomCount: oomEntries.length,
      picks,
    });
  }

  return hubs.sort((a, b) => {
    if (b.hardware.usable_vram_gb !== a.hardware.usable_vram_gb) {
      return b.hardware.usable_vram_gb - a.hardware.usable_vram_gb;
    }
    if (b.hardware.bandwidth_gbps !== a.hardware.bandwidth_gbps) {
      return b.hardware.bandwidth_gbps - a.hardware.bandwidth_gbps;
    }
    return a.hardware.name.localeCompare(b.hardware.name);
  });
}

export function buildModelHubs(allEntries: PageEntry[]): ModelHub[] {
  const modelMap = new Map<string, ModelSpec>();
  const modelEntriesMap = new Map<string, PageEntry[]>();

  for (const entry of allEntries) {
    const mId = entry.model.id;
    if (!modelMap.has(mId)) {
      modelMap.set(mId, entry.model);
    }
    const list = modelEntriesMap.get(mId);
    if (list) {
      list.push(entry);
    } else {
      modelEntriesMap.set(mId, [entry]);
    }
  }

  const hubs: ModelHub[] = [];

  for (const [mId, rawList] of modelEntriesMap.entries()) {
    const model = modelMap.get(mId)!;
    // Mandatory Sort: Smooth first -> est_tps descending -> usable_vram_gb desc -> bandwidth desc -> name
    const entries = [...rawList].sort((a, b) => {
      const sr = statusRank(a.default_result.status) - statusRank(b.default_result.status);
      if (sr !== 0) return sr;
      if (b.default_result.est_tps !== a.default_result.est_tps) {
        return b.default_result.est_tps - a.default_result.est_tps;
      }
      if (b.hardware.usable_vram_gb !== a.hardware.usable_vram_gb) {
        return b.hardware.usable_vram_gb - a.hardware.usable_vram_gb;
      }
      if (b.hardware.bandwidth_gbps !== a.hardware.bandwidth_gbps) {
        return b.hardware.bandwidth_gbps - a.hardware.bandwidth_gbps;
      }
      return a.hardware.name.localeCompare(b.hardware.name);
    });

    const smoothEntries = entries.filter((e) => e.default_result.status === 'Smooth');
    const partialEntries = entries.filter((e) => e.default_result.status === 'Partial Offload');
    const oomEntries = entries.filter((e) => e.default_result.status === 'OOM');

    const fastestTps = Math.max(...entries.map((e) => e.default_result.est_tps), 1);
    const refEntry = entries[0];
    const q4Row = refEntry?.quant_table.find((r) => r.quant === 'Q4_K_M');
    const q8Row = refEntry?.quant_table.find((r) => r.quant === 'Q8_0');
    const fp16Row = refEntry?.quant_table.find((r) => r.quant === 'FP16');
    const kvPer4k = refEntry?.context_analysis.kv_gb_per_4k ?? 0;

    const topPicks: TopHardwarePick[] = [];
    const pickedSlugs = new Set<string>();

    if (smoothEntries.length > 0) {
      const fastestHw = smoothEntries[0];
      if (fastestHw) {
        pickedSlugs.add(fastestHw.slug);
        topPicks.push({
          role: 'Fastest Smooth Hardware',
          accent: 'border-emerald-200 bg-emerald-50 text-emerald-800',
          entry: fastestHw,
        });
      }

      const bestValueHw = [...smoothEntries].sort((a, b) => {
        if (a.hardware.msrp_usd !== b.hardware.msrp_usd) {
          return a.hardware.msrp_usd - b.hardware.msrp_usd;
        }
        return b.default_result.est_tps - a.default_result.est_tps;
      })[0];
      if (bestValueHw && !pickedSlugs.has(bestValueHw.slug)) {
        pickedSlugs.add(bestValueHw.slug);
        topPicks.push({
          role: 'Best Value Smooth Pick',
          accent: 'border-blue-200 bg-blue-50 text-blue-800',
          entry: bestValueHw,
        });
      }

      const bestUnifiedHw = smoothEntries.find((e) => e.hardware.is_unified);
      if (bestUnifiedHw && !pickedSlugs.has(bestUnifiedHw.slug)) {
        pickedSlugs.add(bestUnifiedHw.slug);
        topPicks.push({
          role: 'Best Unified Memory Pick',
          accent: 'border-indigo-200 bg-indigo-50 text-indigo-800',
          entry: bestUnifiedHw,
        });
      }
    } else if (entries.length > 0) {
      const closestHw = entries[0];
      pickedSlugs.add(closestHw.slug);
      topPicks.push({
        role: 'Closest Viable Hardware',
        accent: 'border-amber-200 bg-amber-50 text-amber-800',
        entry: closestHw,
      });
    }

    hubs.push({
      model,
      entries,
      smoothEntries,
      partialEntries,
      oomEntries,
      smoothCount: smoothEntries.length,
      partialCount: partialEntries.length,
      oomCount: oomEntries.length,
      fastestTps,
      q4Row,
      q8Row,
      fp16Row,
      kvPer4k,
      topPicks,
    });
  }

  return hubs.sort(
    (a, b) => a.model.params_b - b.model.params_b || a.model.name.localeCompare(b.model.name)
  );
}

export function buildHardwareFaq(hub: HardwareHub): FaqItem[] {
  const { hardware, entries, smoothEntries, partialEntries, smoothCount, partialCount, oomCount } =
    hub;

  const flagship = smoothEntries[0] ?? partialEntries[0] ?? entries[0];
  const fastest =
    smoothEntries.length > 0
      ? [...smoothEntries].sort((a, b) => b.default_result.est_tps - a.default_result.est_tps)[0]
      : entries[0];

  const flagshipRecQuant =
    flagship?.quant_table.find((r) => r.recommended)?.quant ?? 'Q4_K_M';

  const q1Answer =
    smoothCount > 0 && flagship
      ? `In our benchmarks, the largest Smooth model on ${hardware.name} is ${flagship.model.name} (${flagship.model.params_b}B), fitting 100% inside ${hardware.usable_vram_gb} GB usable ${hardware.backend} memory at ${flagship.default_result.total_vram_gb.toFixed(2)} GB (8K Q4_K_M) and ~${flagship.default_result.est_tps.toFixed(1)} tok/s (recommended quant: ${flagshipRecQuant}).`
      : flagship
        ? `Among tested models on ${hardware.name}, none fit 100% Smooth at 8K Q4_K_M; the closest viable run is ${flagship.model.name} (${flagship.default_result.status} at ${flagship.default_result.total_vram_gb.toFixed(2)} GB vs ${hardware.usable_vram_gb} GB usable).`
        : `${hardware.name} provides ${hardware.usable_vram_gb} GB usable ${hardware.backend} memory.`;

  const q2Answer = `Out of ${entries.length} open-weight models benchmarked on ${hardware.short_name} at Q4_K_M @ 8K, ${smoothCount} run Smooth (all layers in ${hardware.backend} memory), ${partialCount} require Partial Offload across PCIe/RAM, and ${oomCount} hit OOM.`;

  const fastestMaxCtx =
    fastest && fastest.context_analysis.max_smooth_context_q4 > 0
      ? formatContextLabel(fastest.context_analysis.max_smooth_context_q4)
      : '4K–8K';

  const q3Answer = fastest
    ? fastest.default_result.status === 'OOM'
      ? `At Q4_K_M @ 8K, ${fastest.model.name} exceeds ${hardware.usable_vram_gb} GB usable memory (OOM); use a smaller quantization or smaller parameter model on ${hardware.short_name}.`
      : `${fastest.model.name} (${fastest.model.params_b}B) delivers the highest tested throughput on ${hardware.short_name} at ~${fastest.default_result.est_tps.toFixed(1)} tok/s using ${fastest.default_result.total_vram_gb.toFixed(2)} GB (${fastest.default_result.status}), scaling smoothly up to ${fastestMaxCtx} context in Q4_K_M.`
    : `${hardware.short_name} scales decode throughput proportionally to its ${hardware.bandwidth_gbps} GB/s memory bus.`;

  const gpuCount = hardware.gpu_count ?? 1;
  const topologyDetail =
    gpuCount > 1
      ? `Across ${gpuCount}x GPUs (` +
        `split with --split-mode layer and ~0.92x multi-GPU scaling efficiency), usable CUDA capacity totals ${hardware.usable_vram_gb} GB out of ${hardware.vram_gb} GB physical VRAM.`
      : hardware.is_unified
        ? hardware.vendor === 'Apple'
          ? `Of ${hardware.vram_gb} GB total unified memory, macOS reserves an OS/compositor buffer, leaving ${hardware.usable_vram_gb} GB as the safe Metal wired limit before swap pressure.`
          : `Of ${hardware.vram_gb} GB total unified RAM, ${hardware.usable_vram_gb} GB is safely addressable by the ${hardware.backend} GPU runtime while reserving host memory for the OS.`
        : `Out of ${hardware.vram_gb} GB physical ${hardware.memory_type}, ~${(hardware.vram_gb - hardware.usable_vram_gb).toFixed(1)} GB is reserved for driver buffers and display compositing, leaving ${hardware.usable_vram_gb} GB usable VRAM.`;

  const q4Answer = `${hardware.name} exposes ${hardware.usable_vram_gb} GB usable / ${hardware.vram_gb} GB physical memory on a ${hardware.bandwidth_gbps} GB/s ${hardware.memory_type} bus (${hardware.backend}). ${topologyDetail}`;

  return [
    {
      question: `What is the largest LLM that ${hardware.name} can run smoothly?`,
      answer: q1Answer,
    },
    {
      question: `How many tested models run Smooth on ${hardware.short_name}?`,
      answer: q2Answer,
    },
    {
      question: `Which benchmarked model runs fastest on ${hardware.short_name}?`,
      answer: q3Answer,
    },
    {
      question: `How much usable VRAM and memory bandwidth does ${hardware.name} have for LLMs?`,
      answer: q4Answer,
    },
  ];
}

export function buildModelFaq(hub: ModelHub): FaqItem[] {
  const {
    model,
    entries,
    smoothEntries,
    partialEntries,
    smoothCount,
    partialCount,
    oomCount,
    q4Row,
    q8Row,
    fp16Row,
    kvPer4k,
  } = hub;

  const q4Text = q4Row
    ? `${q4Row.total_vram_8k_gb.toFixed(2)} GB (${q4Row.weights_gb.toFixed(2)} GB weights + ${q4Row.kv_cache_8k_gb.toFixed(2)} GB KV + ${q4Row.overhead_gb.toFixed(2)} GB runtime overhead)`
    : 'varies by hardware overhead';
  const q8Text = q8Row ? `${q8Row.total_vram_8k_gb.toFixed(2)} GB` : 'higher VRAM';
  const fp16Text = fp16Row ? `${fp16Row.total_vram_8k_gb.toFixed(2)} GB` : 'unquantized 16-bit';

  const q1Answer = `At 8K context with FP16 KV cache, ${model.name} (${model.params_b}B, ${model.num_layers} layers) requires ${q4Text} in Q4_K_M, ${q8Text} in Q8_0, and ${fp16Text} in full FP16.`;

  const fastest = smoothEntries[0] ?? entries[0];
  const q2Answer =
    smoothCount > 0 && fastest
      ? `The fastest benchmarked platform for ${model.short_name} is ${fastest.hardware.name}, sustaining ~${fastest.default_result.est_tps.toFixed(1)} tok/s in Q4_K_M @ 8K with all ${model.num_layers}/${model.num_layers} layers on-device (${fastest.hardware.usable_vram_gb} GB usable memory at ${fastest.hardware.bandwidth_gbps} GB/s).`
      : fastest
        ? `Across ${entries.length} tested devices, ${fastest.hardware.name} leads at ~${fastest.default_result.est_tps.toFixed(1)} tok/s (${fastest.default_result.status}, ${fastest.default_result.gpu_layers_fit}/${model.num_layers} GPU layers).`
        : `${model.short_name} scales directly with hardware memory bandwidth when weights fit in VRAM.`;

  const bestValue =
    smoothEntries.length > 0
      ? [...smoothEntries].sort((a, b) => {
          if (a.hardware.msrp_usd !== b.hardware.msrp_usd) {
            return a.hardware.msrp_usd - b.hardware.msrp_usd;
          }
          return b.default_result.est_tps - a.default_result.est_tps;
        })[0]
      : partialEntries[0] ?? entries[0];

  const q3Answer =
    smoothCount > 0 && bestValue
      ? `Of the ${entries.length} benchmarked platforms (${smoothCount} Smooth, ${partialCount} Partial Offload, ${oomCount} OOM), the lowest-cost Smooth option is ${bestValue.hardware.name} ($${bestValue.hardware.msrp_usd.toLocaleString()} reference MSRP, ${bestValue.hardware.usable_vram_gb} GB usable memory) at ~${bestValue.default_result.est_tps.toFixed(1)} tok/s in Q4_K_M.`
      : bestValue
        ? `None of the tested GPUs fit ${model.short_name} Q4_K_M completely at 8K without offloading; ${bestValue.hardware.name} provides the closest Partial Offload configuration.`
        : `Choose hardware with usable memory above ${q4Row ? q4Row.total_vram_8k_gb.toFixed(1) : 'the Q4_K_M footprint'} GB to avoid PCIe offloading.`;

  const q4Answer = `With ${model.num_layers} layers, ${model.num_kv_heads} GQA KV heads, and head_dim=${model.head_dim}, each additional 4K of context adds +${kvPer4k.toFixed(2)} GB in default FP16 KV cache (up to ${formatContextLabel(model.max_context)} max context). Enabling Flash Attention and q8_0 KV cache roughly halves KV growth per 4K tokens.`;

  return [
    {
      question: `How much VRAM does ${model.name} require at Q4_K_M, Q8_0, and FP16?`,
      answer: q1Answer,
    },
    {
      question: `What is the fastest GPU or Mac to run ${model.short_name}?`,
      answer: q2Answer,
    },
    {
      question: `What is the most affordable hardware that runs ${model.short_name} smoothly?`,
      answer: q3Answer,
    },
    {
      question: `How much VRAM does ${model.short_name} KV cache consume as context grows?`,
      answer: q4Answer,
    },
  ];
}
