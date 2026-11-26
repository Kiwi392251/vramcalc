import rawCatalog from '../data/catalog_data.json';
import rawBenchmarks from '../data/benchmarks_verified.json';
import type {
  AltFormatSummary,
  BenchmarkAnchor,
  BenchmarksData,
  CatalogData,
  CompatStatus,
  FaqItem,
  HardwareSpec,
  ModelSpec,
  QuantKey,
  RunEstimate,
  RuntimeFormat,
  SpeedTier,
  VramPageEntry,
} from '../types/vram';
import {
  classifySpeedTier,
  estimateRun,
  formatContextLabel,
  formatTpsRange,
  kvGbPer4k,
  maxFitContextDetails,
} from './physics';
import { aiCapabilitySortScore } from './pricing';

export type HardwareClassGroup =
  | 'Desktop GPU'
  | 'Multi-GPU & Workstation'
  | 'Unified Memory'
  | 'Laptop GPU'
  | 'Edge & SBC';

export interface HubPairRow {
  model: ModelSpec;
  hardware: HardwareSpec;
  result: RunEstimate;
  maxFitCtx: number;
  maxFitVramGb: number;
  maxFitStatus: CompatStatus;
  maxFitTpsLow: number;
  maxFitTpsHigh: number;
  maxFitSpeedTier: SpeedTier;
  altRow: AltFormatSummary;
  recQuant: QuantKey;
  isCurated: boolean;
  href: string;
  slug?: string;
  curatedEntry?: VramPageEntry;
}

export interface HardwareHub {
  hardware: HardwareSpec;
  group: HardwareClassGroup;
  effectiveUsableGb: number;
  rows: HubPairRow[];
  curatedCount: number;
  fitsCount: number;
  tightCount: number;
  partialCount: number;
  oomCount: number;
  picks: Array<{ role: string; accent: string; row: HubPairRow }>;
}

export interface ModelHub {
  model: ModelSpec;
  rows: HubPairRow[];
  curatedCount: number;
  fitsCount: number;
  tightCount: number;
  partialCount: number;
  oomCount: number;
  fastestTps: number;
  fastestTpsText: string;
  fastestRow?: HubPairRow;
  q4Row: RunEstimate;
  q8Row: RunEstimate;
  fp16Row: RunEstimate;
  awqRow: RunEstimate;
  kvPer4k: number;
  topPicks: Array<{ role: string; accent: string; row: HubPairRow }>;
}

const catalogData = rawCatalog as CatalogData;
const benchmarksData = rawBenchmarks as BenchmarksData;

export function getCatalogUpdatedAt(): string {
  return catalogData.updated_at ?? '2026-11-24';
}

export function getEngineVersion(): string {
  return catalogData.engine_version ?? 'v3.3';
}

export function getBenchmarksMethodologyNote(): string {
  return benchmarksData.methodology_note;
}

export interface FreshnessMeta {
  key: 'home.measuredFresh2026' | 'home.measuredFresh2025' | 'home.measuredFreshLegacy';
  label: string;
  badgeClass: string;
}

export function getFreshnessMeta(dateStr: string): FreshnessMeta {
  if (dateStr.startsWith('2026')) {
    return {
      key: 'home.measuredFresh2026',
      label: '2026 run',
      badgeClass:
        'badge-fits inline-block rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold',
    };
  }
  if (dateStr.startsWith('2025')) {
    return {
      key: 'home.measuredFresh2025',
      label: '2025 baseline',
      badgeClass:
        'badge-neutral inline-block rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium',
    };
  }
  return {
    key: 'home.measuredFreshLegacy',
    label: 'Legacy 2024',
    badgeClass:
      'badge-partial inline-block rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold',
  };
}

export interface NearestAnchorView {
  relation: 'Same Hardware' | 'Same Model';
  anchor: BenchmarkAnchor;
  modelName: string;
  hardwareName: string;
  bandwidthGbps: number;
  bwRatioLabel: string;
  pairHref: string;
  freshness: FreshnessMeta;
}

export function getNearestReferenceAnchors(
  modelId: string,
  targetHardware: HardwareSpec,
  slugLookup: Map<string, string>,
): NearestAnchorView[] {
  const modelsById = new Map(catalogData.models.map((m) => [m.id, m]));
  const hwById = new Map(catalogData.hardware.map((h) => [h.id, h]));
  const sameHw = getReferenceBenchmarks({ hardwareId: targetHardware.id }).slice(0, 2);
  const sameModel = getReferenceBenchmarks({ modelId }).slice(0, 2);

  const out: NearestAnchorView[] = [];
  const seen = new Set<string>();
  const addAnchor = (relation: 'Same Hardware' | 'Same Model', anc: BenchmarkAnchor) => {
    const key = `${anc.model_id}::${anc.hardware_id}`;
    if (seen.has(key) || (anc.model_id === modelId && anc.hardware_id === targetHardware.id)) {
      return;
    }
    seen.add(key);
    const m = modelsById.get(anc.model_id);
    const h = hwById.get(anc.hardware_id);
    if (!m || !h) return;
    const ratio = targetHardware.bandwidth_gbps / Math.max(1, h.bandwidth_gbps);
    const bwRatioLabel =
      h.id === targetHardware.id
        ? `1.00× same bus (${targetHardware.bandwidth_gbps} GB/s)`
        : `${ratio.toFixed(2)}× BW (${targetHardware.bandwidth_gbps} / ${h.bandwidth_gbps} GB/s)`;
    const slug = slugLookup.get(key);
    out.push({
      relation,
      anchor: anc,
      modelName: m.name,
      hardwareName: h.name,
      bandwidthGbps: h.bandwidth_gbps,
      bwRatioLabel,
      pairHref: slug ? `/can-i-run/${slug}/` : `/gpu/${h.id}/`,
      freshness: getFreshnessMeta(anc.date),
    });
  };

  for (const a of sameHw) addAnchor('Same Hardware', a);
  for (const a of sameModel) addAnchor('Same Model', a);
  return out;
}

export function getReferenceBenchmarks(filters: {
  modelId?: string;
  hardwareId?: string;
}): BenchmarkAnchor[] {
  return benchmarksData.anchors.filter((a) => {
    if (filters.modelId && a.model_id !== filters.modelId) return false;
    if (filters.hardwareId && a.hardware_id !== filters.hardwareId) return false;
    return true;
  });
}

export function statusRank(status: CompatStatus | string): number {
  if (status === 'Fits' || status === 'Smooth') return 0;
  if (status === 'Tight Fit') return 1;
  if (status === 'Partial Offload') return 2;
  return 3;
}

export function classifyCatalogGroup(hw: HardwareSpec): HardwareClassGroup {
  if (hw.category === 'Edge / SBC') return 'Edge & SBC';
  if (hw.category === 'Unified Memory' || hw.is_unified) return 'Unified Memory';
  if (hw.category === 'Laptop GPU') return 'Laptop GPU';
  if (hw.category === 'Multi-GPU' || hw.category === 'Workstation' || hw.category === 'Data Center' || hw.gpu_count > 1) {
    return 'Multi-GPU & Workstation';
  }
  return 'Desktop GPU';
}

export interface HardwareCatalogGroup {
  label: string;
  items: HardwareSpec[];
}

export function groupCatalogHardware(list: HardwareSpec[]): HardwareCatalogGroup[] {
  const groups: HardwareCatalogGroup[] = [
    {
      label: 'Apple Silicon Unified',
      items: list.filter((h) => h.vendor === 'Apple' && h.is_unified),
    },
    {
      label: 'NVIDIA Desktop RTX',
      items: list.filter(
        (h) =>
          h.vendor === 'NVIDIA' &&
          !h.is_unified &&
          h.category === 'Desktop GPU' &&
          !h.series.includes('GTX') &&
          !h.series.includes('RTX 20'),
      ),
    },
    {
      label: 'NVIDIA Classic GTX & RTX 20',
      items: list.filter(
        (h) =>
          h.vendor === 'NVIDIA' &&
          (h.series.includes('GTX') || h.series.includes('RTX 20')),
      ),
    },
    {
      label: 'NVIDIA Multi-GPU & Workstation',
      items: list.filter(
        (h) =>
          h.vendor === 'NVIDIA' &&
          (h.category === 'Multi-GPU' || h.category === 'Workstation' || h.category === 'Data Center'),
      ),
    },
    {
      label: 'NVIDIA Laptop RTX',
      items: list.filter(
        (h) => h.vendor === 'NVIDIA' && h.category === 'Laptop GPU',
      ),
    },
    {
      label: 'AMD Radeon & Ryzen AI',
      items: list.filter((h) => h.vendor === 'AMD'),
    },
    {
      label: 'Intel Arc',
      items: list.filter((h) => h.vendor === 'Intel'),
    },
    {
      label: 'Edge & SBC (Jetson · Pi · Snapdragon)',
      items: list.filter((h) => h.category === 'Edge / SBC'),
    },
  ];
  return groups.filter((g) => g.items.length > 0);
}

function buildPairLookup(allEntries: VramPageEntry[]): Map<string, VramPageEntry> {
  const map = new Map<string, VramPageEntry>();
  for (const e of allEntries) {
    map.set(`${e.model.id}::${e.hardware.id}`, e);
  }
  return map;
}

function computeAltRow(model: ModelSpec, hardware: HardwareSpec): AltFormatSummary {
  const isMac = hardware.is_unified && hardware.vendor === 'Apple';
  const quant: QuantKey = isMac ? 'MLX_4BIT' : 'AWQ_4BIT';
  const format: RuntimeFormat = isMac ? 'MLX' : 'AWQ';
  const altEst = estimateRun(model, hardware, quant, 8192, 'desktop', 'fp16', format);
  return {
    format,
    quant,
    total_vram_gb: altEst.total_vram_gb,
    status: altEst.status,
    est_tps_low: altEst.est_tps_low ?? 0,
    est_tps_high: altEst.est_tps_high ?? 0,
    speed_tier: altEst.speed_tier ?? classifySpeedTier(altEst.est_tps, altEst.status),
  };
}

function makeHubRow(
  model: ModelSpec,
  hardware: HardwareSpec,
  pairMap: Map<string, VramPageEntry>,
): HubPairRow {
  const curated = pairMap.get(`${model.id}::${hardware.id}`);
  if (curated) {
    const recRow = curated.quant_table.find((q) => q.recommended);
    const fallbackMaxFit =
      curated.max_fit_tps_low !== undefined &&
      curated.max_fit_tps_high !== undefined &&
      curated.max_fit_speed_tier !== undefined
        ? null
        : maxFitContextDetails(curated.model, curated.hardware, curated.default_quant, 'desktop');

    return {
      model: curated.model,
      hardware: curated.hardware,
      result: curated.default_result,
      maxFitCtx: curated.max_fit_context ?? curated.context_analysis.max_smooth_context_q4,
      maxFitVramGb: curated.max_fit_total_vram_gb ?? curated.default_result.total_vram_gb,
      maxFitStatus: curated.max_fit_status ?? curated.default_result.status,
      maxFitTpsLow: curated.max_fit_tps_low ?? fallbackMaxFit?.estTpsLow ?? 0,
      maxFitTpsHigh: curated.max_fit_tps_high ?? fallbackMaxFit?.estTpsHigh ?? 0,
      maxFitSpeedTier: curated.max_fit_speed_tier ?? fallbackMaxFit?.speedTier ?? 'OOM',
      altRow: curated.alt_format_summary ?? computeAltRow(curated.model, curated.hardware),
      recQuant: recRow?.quant ?? curated.default_quant,
      isCurated: true,
      href: `/can-i-run/${curated.slug}/`,
      slug: curated.slug,
      curatedEntry: curated,
    };
  }

  const result = estimateRun(model, hardware, 'Q4_K_M', 8192, 'desktop');
  const maxFit = maxFitContextDetails(model, hardware, 'Q4_K_M', 'desktop');
  return {
    model,
    hardware,
    result,
    maxFitCtx: maxFit.contextTokens,
    maxFitVramGb: maxFit.totalVramGb,
    maxFitStatus: maxFit.status,
    maxFitTpsLow: maxFit.estTpsLow,
    maxFitTpsHigh: maxFit.estTpsHigh,
    maxFitSpeedTier: maxFit.speedTier,
    altRow: computeAltRow(model, hardware),
    recQuant: 'Q4_K_M',
    isCurated: false,
    href: `/calculator/?model=${encodeURIComponent(model.id)}&hw=${encodeURIComponent(hardware.id)}`,
  };
}

export function buildHardwareHubs(allEntries: VramPageEntry[]): HardwareHub[] {
  const pairMap = buildPairLookup(allEntries);
  const hubs: HardwareHub[] = [];

  for (const hardware of catalogData.hardware) {
    const rows = catalogData.models.map((m) => makeHubRow(m, hardware, pairMap));
    rows.sort(
      (a, b) =>
        statusRank(a.result.status) - statusRank(b.result.status) ||
        b.result.est_tps - a.result.est_tps ||
        b.model.params_b - a.model.params_b,
    );

    const effectiveUsableGb = rows[0]?.result.effective_usable_vram_gb ?? hardware.usable_vram_gb;
    const fitsRows = rows.filter((r) => r.result.status === 'Fits');
    const tightRows = rows.filter((r) => r.result.status === 'Tight Fit');
    const partialRows = rows.filter((r) => r.result.status === 'Partial Offload');
    const oomRows = rows.filter((r) => r.result.status === 'OOM');

    const residentRows = [...fitsRows, ...tightRows];
    const picks: Array<{ role: string; accent: string; row: HubPairRow }> = [];
    const seenSlugs = new Set<string>();

    const coding =
      residentRows
        .filter((r) => r.model.id.includes('coder') || r.model.family === 'Qwen3')
        .sort((a, b) => b.model.params_b - a.model.params_b || b.result.est_tps - a.result.est_tps)[0] ??
      residentRows[0];

    const reasoning =
      residentRows
        .filter((r) =>
          [
            'DeepSeek-V4',
            'DeepSeek-V3',
            'DeepSeek-R1',
            'Qwen3.8',
            'Qwen3.6',
            'Qwen3.5',
            'Gemma 4',
            'Gemma 3',
            'GPT-OSS',
            'GLM',
          ].includes(r.model.family),
        )
        .sort(
          (a, b) =>
            aiCapabilitySortScore(b.model) - aiCapabilitySortScore(a.model) ||
            b.model.params_b - a.model.params_b ||
            b.result.est_tps - a.result.est_tps,
        )[0];

    const fastest = [...residentRows].sort((a, b) => b.result.est_tps - a.result.est_tps)[0];

    const addPick = (role: string, accent: string, row?: HubPairRow) => {
      if (!row || seenSlugs.has(row.model.id) || picks.length >= 3) return;
      seenSlugs.add(row.model.id);
      picks.push({ role, accent, row });
    };

    addPick('Best Coding & Agent Fit', 'badge-accent', coding);
    addPick('Top Reasoning / Writing Fit', 'badge-neutral', reasoning);
    addPick('Highest Formula Speed', 'badge-fits', fastest);

    for (const r of rows) {
      if (picks.length >= 3) break;
      addPick('Benchmarked Pair', 'badge-neutral', r);
    }

    hubs.push({
      hardware,
      group: classifyCatalogGroup(hardware),
      effectiveUsableGb,
      rows,
      curatedCount: rows.filter((r) => r.isCurated).length,
      fitsCount: fitsRows.length,
      tightCount: tightRows.length,
      partialCount: partialRows.length,
      oomCount: oomRows.length,
      picks,
    });
  }

  return hubs.sort(
    (a, b) =>
      b.effectiveUsableGb - a.effectiveUsableGb ||
      b.hardware.bandwidth_gbps - a.hardware.bandwidth_gbps ||
      a.hardware.name.localeCompare(b.hardware.name),
  );
}

export function buildModelHubs(allEntries: VramPageEntry[]): ModelHub[] {
  const pairMap = buildPairLookup(allEntries);
  const hubs: ModelHub[] = [];

  for (const model of catalogData.models) {
    const rows = catalogData.hardware.map((hw) => makeHubRow(model, hw, pairMap));
    rows.sort(
      (a, b) =>
        statusRank(a.result.status) - statusRank(b.result.status) ||
        b.result.est_tps - a.result.est_tps ||
        (b.result.effective_usable_vram_gb ?? b.hardware.usable_vram_gb) -
          (a.result.effective_usable_vram_gb ?? a.hardware.usable_vram_gb),
    );

    const fitsRows = rows.filter((r) => r.result.status === 'Fits');
    const tightRows = rows.filter((r) => r.result.status === 'Tight Fit');
    const partialRows = rows.filter((r) => r.result.status === 'Partial Offload');
    const oomRows = rows.filter((r) => r.result.status === 'OOM');

    const fastestRow = [...fitsRows, ...tightRows, ...partialRows].sort(
      (a, b) => b.result.est_tps - a.result.est_tps,
    )[0];
    const fastestTps = fastestRow?.result.est_tps ?? 0;
    const fastestTpsText = fastestRow
      ? formatTpsRange(
          fastestRow.result.est_tps_low,
          fastestRow.result.est_tps_high,
          fastestRow.result.est_tps,
          fastestRow.result.status,
        )
      : 'OOM';

    const refHw = catalogData.hardware.find((h) => h.id === 'rtx-4090-24gb') ?? catalogData.hardware[0];
    const q4Row = estimateRun(model, refHw, 'Q4_K_M', 8192, 'desktop');
    const q8Row = estimateRun(model, refHw, 'Q8_0', 8192, 'desktop');
    const fp16Row = estimateRun(model, refHw, 'FP16', 8192, 'desktop');
    const awqRow = estimateRun(model, refHw, 'AWQ_4BIT', 8192, 'desktop', 'fp16', 'AWQ');
    const kvPer4k = kvGbPer4k(model);

    const residentRows = [...fitsRows, ...tightRows];
    const topPicks: Array<{ role: string; accent: string; row: HubPairRow }> = [];
    const seenHw = new Set<string>();
    const addPick = (role: string, accent: string, row?: HubPairRow) => {
      if (!row || seenHw.has(row.hardware.id) || topPicks.length >= 3) return;
      seenHw.add(row.hardware.id);
      topPicks.push({ role, accent, row });
    };

    const bestValue =
      residentRows
        .filter((r) => !r.hardware.is_unified && r.hardware.msrp_usd > 0)
        .sort(
          (a, b) =>
            statusRank(a.result.status) - statusRank(b.result.status) ||
            a.hardware.msrp_usd - b.hardware.msrp_usd ||
            b.result.est_tps - a.result.est_tps,
        )[0] ?? residentRows[0];

    const bestSpeed = [...residentRows].sort((a, b) => b.result.est_tps - a.result.est_tps)[0];
    const bestMac = residentRows.filter((r) => r.hardware.vendor === 'Apple')[0];

    addPick('Best Value Resident GPU', 'badge-fits', bestValue);
    addPick('Fastest Formula Speed', 'badge-accent', bestSpeed);
    addPick('Best Unified Mac / Studio', 'badge-neutral', bestMac);

    for (const r of rows) {
      if (topPicks.length >= 3) break;
      addPick('Evaluated Hardware', 'badge-neutral', r);
    }

    hubs.push({
      model,
      rows,
      curatedCount: rows.filter((r) => r.isCurated).length,
      fitsCount: fitsRows.length,
      tightCount: tightRows.length,
      partialCount: partialRows.length,
      oomCount: oomRows.length,
      fastestTps,
      fastestTpsText,
      fastestRow,
      q4Row,
      q8Row,
      fp16Row,
      awqRow,
      kvPer4k,
      topPicks,
    });
  }

  return hubs.sort((a, b) => a.model.params_b - b.model.params_b || a.model.name.localeCompare(b.model.name));
}

export function buildHardwareFaq(hub: HardwareHub): FaqItem[] {
  const hw = hub.hardware;
  const usable = hub.effectiveUsableGb;
  const resident = hub.rows.filter((r) => r.result.status === 'Fits' || r.result.status === 'Tight Fit');
  const fitsOnly = hub.rows.filter((r) => r.result.status === 'Fits');
  const largestFit = [...resident].sort((a, b) => b.model.params_b - a.model.params_b)[0];
  const largestName = largestFit ? `${largestFit.model.name} (${largestFit.result.status})` : '4B–7B models';
  const desktopDiff = hw.vram_gb - usable;

  return [
    {
      question: `What is the largest LLM ${hw.name} can run without spilling to host RAM?`,
      answer: `${hw.name} exposes ${usable.toFixed(1)} GB of usable ${hw.backend} memory under Daily Desktop reserve (of ${hw.vram_gb} GB physical). Across ${hub.rows.length} evaluated LLMs, ${fitsOnly.length} clear with >5% headroom and ${hub.tightCount} sit in Tight Fit (<5% free), topped by ${largestName} at Q4_K_M @ 8K context.`,
    },
    {
      question: `How fast does ${hw.short_name} generate tokens in local LLM inference?`,
      answer: `With ${hw.bandwidth_gbps} GB/s memory bandwidth, decode speed stays memory-bandwidth-bound. Expect interactive (~12–24+ tok/s) or fast (~25+ tok/s) ranges on models sized comfortably within ${usable.toFixed(1)} GB, dropping to Readable/Slow tiers on heavier 27B–70B models or host-RAM offload.`,
    },
    {
      question: `Why does ${hw.short_name} show ${usable.toFixed(1)} GB usable out of ${hw.vram_gb} GB physical?`,
      answer: hw.is_unified
        ? `In Daily Desktop mode, macOS/Windows leaves ~${desktopDiff.toFixed(1)} GB un-wired for OS compositing, browsers, and background apps so GPU allocations don't trigger swap thrashing. Closing heavy apps unlocks more room under the Clean OS reserve profile in our simulator.`
        : `Driver kernels, display buffers (${desktopDiff.toFixed(1)} GB), and compute scratchpads sit inside GPU VRAM alongside weights and KV cache. Multi-GPU rigs add +0.55 GB CUDA context overhead per extra card.`,
    },
  ];
}

export function buildModelFaq(hub: ModelHub): FaqItem[] {
  const m = hub.model;
  const resident = hub.rows.filter((r) => r.result.status === 'Fits' || r.result.status === 'Tight Fit');
  const minFit = [...resident].sort(
    (a, b) =>
      (a.result.effective_usable_vram_gb ?? a.hardware.usable_vram_gb) -
      (b.result.effective_usable_vram_gb ?? b.hardware.usable_vram_gb),
  )[0];
  const fastest = resident[0];

  const minFitUsable = minFit ? minFit.result.effective_usable_vram_gb ?? minFit.hardware.usable_vram_gb : 0;
  const minGpuAnswer = minFit
    ? `An accelerator with at least ${minFitUsable.toFixed(1)} GB usable memory (${minFit.hardware.name}) holds ${m.short_name} completely in VRAM at Q4_K_M @ 8K (${hub.q4Row.total_vram_gb.toFixed(2)} GB total, status: ${minFit.result.status}).`
    : `${m.short_name} requires ${hub.q4Row.total_vram_gb.toFixed(2)} GB at Q4_K_M @ 8K; use multi-GPU splits or high-memory Mac Studio / H100/H200 nodes.`;

  const fastestText = fastest
    ? formatTpsRange(
        fastest.result.est_tps_low,
        fastest.result.est_tps_high,
        fastest.result.est_tps,
        fastest.result.status,
      )
    : 'Offload';

  return [
    {
      question: `How much VRAM does ${m.name} require?`,
      answer: `At 8K context with FP16 KV cache, ${m.name} (${m.params_b}B) requires ${hub.q4Row.total_vram_gb.toFixed(2)} GB at Q4_K_M (GGUF), ${hub.awqRow.total_vram_gb.toFixed(2)} GB at 4-bit AWQ (vLLM), ${hub.q8Row.total_vram_gb.toFixed(2)} GB at Q8_0, and ${hub.fp16Row.total_vram_gb.toFixed(1)} GB at FP16. KV cache scales by +${hub.kvPer4k.toFixed(2)} GB per 4K context tokens.`,
    },
    {
      question: `What GPU or Mac fits ${m.short_name} cleanly without offload?`,
      answer: `${minGpuAnswer} Across our ${hub.rows.length}-GPU matrix, ${hub.fitsCount} GPUs fit comfortably and ${hub.tightCount} qualify as Tight Fit (<5% headroom).`,
    },
    {
      question: `Which GPU achieves the highest decode speed on ${m.short_name}?`,
      answer: fastest
        ? `On ${fastest.hardware.name} (${fastest.hardware.bandwidth_gbps} GB/s), formula decode rate reaches ${fastestText} (${fastest.result.speed_tier}) at 8K context. Dual-GPU Layer Split scales memory capacity safely, while Tensor Parallel on PCIe incurs All-Reduce latency.`
        : `Higher memory-bandwidth cards reduce per-token decode time cleanly once all ${m.num_layers} layers fit in VRAM.`,
    },
    {
      question: `Can I use these ${m.short_name} numbers for uncensored, abliterated, or Heretic versions?`,
      answer: `Yes — uncensored / abliterated / Heretic weights preserve identical layer counts and GQA KV geometry as ${m.name}. Use the exact same ${hub.q4Row.total_vram_gb.toFixed(2)} GB (Q4_K_M GGUF) or ${hub.awqRow.total_vram_gb.toFixed(2)} GB (4-bit AWQ) memory budget and speed estimates above, with ~±3–5% headroom for imatrix quant builds.`,
    },
  ];
}
