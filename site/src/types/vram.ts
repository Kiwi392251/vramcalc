export type QuantKey =
  | 'Q2_K'
  | 'Q3_K_M'
  | 'Q4_K_M'
  | 'Q5_K_M'
  | 'Q6_K'
  | 'Q8_0'
  | 'FP16';
export type CalculatorQuantKey = QuantKey;
export type KvQuantKey = 'FP16' | 'Q8_0' | 'Q4_0';
export type SplitMode = 'layer' | 'row';
export type CompatStatus = 'Smooth' | 'Partial Offload' | 'OOM';
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
  num_kv_heads: number;
  head_dim: number;
  max_context: number;
  ollama_tag: string;
  hf_repo: string;
  gguf_file_q4: string;
  release_year: number;
  use_cases: string[];
}

export interface HardwareSpec {
  id: string;
  name: string;
  short_name: string;
  vendor: HardwareVendor;
  series: string;
  category?: HardwareCategory;
  gpu_count?: number;
  has_nvlink?: boolean;
  vram_gb: number;
  usable_vram_gb: number;
  bandwidth_gbps: number;
  memory_type: string;
  is_unified: boolean;
  backend: HardwareBackend;
  msrp_usd: number;
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
  models: ModelSpec[];
  hardware: HardwareSpec[];
  cpus: CpuSpec[];
}

export interface RunEstimate {
  quant: QuantKey;
  context_tokens: number;
  weights_gb: number;
  kv_cache_gb: number;
  overhead_gb: number;
  total_vram_gb: number;
  status: CompatStatus;
  est_tps: number;
  gpu_layers_fit: number;
  total_layers: number;
  gpu_fraction: number;
}

export interface RigRunOptions {
  quant?: QuantKey;
  contextTokens?: number;
  kvQuant?: KvQuantKey;
  gpuCount?: number;
  splitMode?: SplitMode;
  cpuBwGbps?: number;
  systemRamGb?: number | null;
}

export interface RigRunEstimate extends RunEstimate {
  kv_quant: KvQuantKey;
  gpu_count: number;
  split_mode: SplitMode;
  usable_vram_gb: number;
  total_phys_vram_gb: number;
  offload_ram_gb: number;
  usable_ram_gb: number;
  is_cpu_only: boolean;
  oom_reason: string;
}

export interface QuantRow {
  quant: QuantKey;
  label: string;
  bits_per_weight: number;
  weights_gb: number;
  kv_cache_8k_gb: number;
  overhead_gb: number;
  total_vram_8k_gb: number;
  est_tps: number;
  status: CompatStatus;
  gpu_layers_fit: number;
  total_layers: number;
  recommended: boolean;
  notes: string;
}

export interface LaunchCommands {
  ollama_run: string;
  ollama_env_cmd: string;
  llama_cli: string;
  llama_server: string;
  recommended_ctx: number;
  recommended_ngl: number;
}

export interface ContextAnalysis {
  kv_gb_per_4k: number;
  max_smooth_context_q4: number;
  bottleneck_summary: string;
  key_points: string[];
  optimization_tips: string[];
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface PageEntry {
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
  commands: LaunchCommands;
  context_analysis: ContextAnalysis;
  faq: FaqItem[];
  related_slugs: string[];
}
