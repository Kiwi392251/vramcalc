export type QuantKey = 'Q4_K_M' | 'Q5_K_M' | 'Q6_K' | 'Q8_0' | 'FP16';
export type CalculatorQuantKey = 'Q4_K_M' | 'Q8_0' | 'FP16';
export type CompatStatus = 'Smooth' | 'Partial Offload' | 'OOM';
export type HardwareVendor = 'NVIDIA' | 'Apple' | 'AMD';
export type HardwareBackend = 'CUDA' | 'Metal' | 'ROCm';
export type HardwareCategory =
  | 'Desktop GPU'
  | 'Laptop GPU'
  | 'Multi-GPU'
  | 'Workstation'
  | 'Unified Memory';

export interface ModelSpec {
  id: string;
  name: string;
  short_name: string;
  family: string;
  params_b: number;
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
  vram_gb: number;
  usable_vram_gb: number;
  bandwidth_gbps: number;
  memory_type: string;
  is_unified: boolean;
  backend: HardwareBackend;
  msrp_usd: number;
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
