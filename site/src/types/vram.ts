export type QuantKey =
  | 'Q4_K_M'
  | 'Q5_K_M'
  | 'Q6_K'
  | 'Q8_0'
  | 'FP16'
  | 'AWQ_4BIT'
  | 'FP8'
  | 'MLX_4BIT'
  | 'MLX_8BIT';

export type RuntimeFormat = 'GGUF' | 'AWQ' | 'MLX';
export type KvQuantKey = 'fp16' | 'q8_0' | 'q4_0';
export type SplitMode = 'layer' | 'tensor';
export type ReserveProfile = 'desktop' | 'clean' | 'custom';

export type CompatStatus = 'Fits' | 'Tight Fit' | 'Partial Offload' | 'OOM';
export type SpeedTier = 'Fast' | 'Interactive' | 'Readable' | 'Slow' | 'OOM';

export type HardwareVendor = 'NVIDIA' | 'Apple' | 'AMD' | 'Intel';
export type HardwareBackend = 'CUDA' | 'Metal' | 'ROCm' | 'Vulkan' | 'CPU';
export type HardwareCategory =
  | 'Desktop GPU'
  | 'Laptop GPU'
  | 'Multi-GPU'
  | 'Workstation'
  | 'Unified Memory'
  | 'Data Center';

export type CpuTier =
  | 'Consumer DDR4'
  | 'Consumer DDR5'
  | 'Laptop LPDDR5X'
  | 'Workstation HEDT'
  | 'Server EPYC / Xeon';

export interface ModelSpec {
  id: string;
  name: string;
  short_name: string;
  family: string;
  params_b: number;
  active_params_b?: number;
  architecture: string;
  num_layers: number;
  kv_layers?: number;
  num_kv_heads: number;
  head_dim: number;
  max_context: number;
  ollama_tag: string;
  hf_repo: string;
  gguf_file_q4: string;
  awq_repo?: string;
  mlx_repo?: string;
  release_year: number;
  use_cases: string[];
}

export interface HardwareSpec {
  id: string;
  name: string;
  short_name: string;
  vendor: HardwareVendor;
  series: string;
  category: HardwareCategory;
  gpu_count: number;
  vram_gb: number;
  usable_vram_gb: number;
  bandwidth_gbps: number;
  memory_type: string;
  is_unified: boolean;
  backend: HardwareBackend;
  msrp_usd: number;
  has_nvlink?: boolean;
}

export interface CpuSpec {
  id: string;
  name: string;
  short_name: string;
  vendor: string;
  memory_type: string;
  channels: number;
  effective_bw_gbps: number;
  recommended_threads: number;
  simd: string;
  tier: CpuTier;
  search_aliases?: string[];
}

export interface CatalogData {
  updated_at?: string;
  engine_version?: string;
  models: ModelSpec[];
  hardware: HardwareSpec[];
  cpus: CpuSpec[];
}

export interface RunEstimate {
  quant: QuantKey;
  format?: RuntimeFormat;
  context_tokens: number;
  weights_gb: number;
  kv_cache_gb: number;
  overhead_gb: number;
  total_vram_gb: number;
  effective_usable_vram_gb?: number;
  headroom_gb?: number;
  status: CompatStatus;
  speed_tier?: SpeedTier;
  est_tps: number;
  est_tps_low?: number;
  est_tps_high?: number;
  gpu_layers_fit: number;
  total_layers: number;
  gpu_fraction: number;
  comm_overhead_pct?: number;
  comm_warning?: boolean;
}

export interface QuantRow {
  quant: QuantKey;
  format?: RuntimeFormat;
  label: string;
  bits_per_weight: number;
  weights_gb: number;
  kv_cache_8k_gb: number;
  overhead_gb: number;
  total_vram_8k_gb: number;
  effective_usable_vram_gb?: number;
  est_tps: number;
  est_tps_low?: number;
  est_tps_high?: number;
  status: CompatStatus;
  speed_tier?: SpeedTier;
  gpu_layers_fit: number;
  total_layers: number;
  recommended: boolean;
  notes: string;
}

export interface CommandsBlock {
  ollama_run: string;
  ollama_env_cmd: string;
  llama_cli: string;
  llama_server: string;
  vllm_serve?: string;
  mlx_lm?: string;
  recommended_ctx: number;
  recommended_ngl: number;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface BenchmarkAnchor {
  hardware_id: string;
  model_id: string;
  format: RuntimeFormat;
  quant: QuantKey;
  context_tokens: number;
  gen_tps_low: number;
  gen_tps_high: number;
  backend: string;
  source_label: string;
  source_url: string;
  notes: string;
}

export interface BenchmarksData {
  updated_at: string;
  methodology_note: string;
  anchors: BenchmarkAnchor[];
}

export interface ContextAnalysis {
  kv_gb_per_4k: number;
  max_smooth_context_q4: number;
  bottleneck_summary: string;
  key_points: string[];
  optimization_tips: string[];
}

export interface VramPageEntry {
  slug: string;
  title: string;
  meta_description: string;
  updated_at: string;
  model: ModelSpec;
  hardware: HardwareSpec;
  default_quant: QuantKey;
  default_context: number;
  default_result: RunEstimate;
  verdict_summary: string;
  quant_table: QuantRow[];
  commands: CommandsBlock;
  context_analysis: ContextAnalysis;
  max_fit_context?: number;
  max_fit_total_vram_gb?: number;
  max_fit_status?: CompatStatus;
  faq: FaqItem[];
  related_slugs: string[];
}

export type PageEntry = VramPageEntry;

export interface RigRunOptions {
  model: ModelSpec;
  hardware: HardwareSpec | null;
  gpuCount?: number;
  cpu?: CpuSpec | null;
  systemRamGb?: number;
  quant?: QuantKey;
  format?: RuntimeFormat;
  contextTokens?: number;
  kvQuant?: KvQuantKey;
  splitMode?: SplitMode;
  reserveProfile?: ReserveProfile;
  customUsableGb?: number | null;
  flashAttention?: boolean;
}

export interface RigRunEstimate extends RunEstimate {
  raw_vram_gb: number;
  usable_vram_gb: number;
  system_ram_gb: number;
  available_ram_gb: number;
  spill_ram_gb: number;
  fits_vram: boolean;
  fits_rig: boolean;
  bottleneck: 'VRAM' | 'PCIe / System RAM' | 'System RAM' | 'Insufficient Memory' | 'PCIe All-Reduce';
  gpu_count: number;
  split_mode: SplitMode;
  kv_quant: KvQuantKey;
  reserve_profile: ReserveProfile;
  os_ram_reserve_gb: number;
  effective_bw_gbps: number;
  active_params_b: number;
}
