"""Deterministic LLM VRAM, Context, Offload, and Throughput Physics Engine (v3.2).

Keep constants and formulas strictly synchronized with `site/src/utils/physics.ts`.
All token/s outputs are calibrated formula estimate ranges (~low-high tok/s), never raw measured telemetry.
"""

from __future__ import annotations

import math
from typing import Literal, TypedDict

try:
    from catalog import CpuSpec, HardwareSpec, ModelSpec  # type: ignore
except ImportError:
    from scripts.catalog import CpuSpec, HardwareSpec, ModelSpec  # type: ignore

QuantKey = Literal[
    "Q4_K_M",
    "Q5_K_M",
    "Q6_K",
    "Q8_0",
    "FP16",
    "AWQ_4BIT",
    "FP8",
    "MLX_4BIT",
    "MLX_8BIT",
]
KvQuantKey = Literal["fp16", "q8_0", "q4_0"]
SplitMode = Literal["layer", "tensor"]
RuntimeFormat = Literal["GGUF", "AWQ", "MLX"]
ReserveProfile = Literal["desktop", "clean", "custom"]
CompatStatus = Literal["Fits", "Tight Fit", "Partial Offload", "OOM"]
SpeedTier = Literal["Fast", "Interactive", "Readable", "Slow", "OOM"]

ENGINE_VERSION = "v3.3"

QUANT_SPECS: dict[QuantKey, dict[str, object]] = {
    "Q4_K_M": {"bpw": 4.85, "format": "GGUF", "label": "4.85 bpw · Balanced 4-bit GGUF"},
    "Q5_K_M": {"bpw": 5.65, "format": "GGUF", "label": "5.65 bpw · Higher-accuracy 5-bit GGUF"},
    "Q6_K": {"bpw": 6.56, "format": "GGUF", "label": "6.56 bpw · Near-lossless 6-bit GGUF"},
    "Q8_0": {"bpw": 8.50, "format": "GGUF", "label": "8.50 bpw · 8-bit reference GGUF"},
    "FP16": {"bpw": 16.0, "format": "GGUF", "label": "16.0 bpw · Unquantized FP16"},
    "AWQ_4BIT": {"bpw": 4.75, "format": "AWQ", "label": "4.75 bpw · 4-bit AWQ (vLLM Marlin)"},
    "FP8": {"bpw": 8.20, "format": "AWQ", "label": "8.20 bpw · 8-bit FP8 (vLLM)"},
    "MLX_4BIT": {"bpw": 4.55, "format": "MLX", "label": "4.55 bpw · 4-bit Affine (Apple MLX)"},
    "MLX_8BIT": {"bpw": 8.25, "format": "MLX", "label": "8.25 bpw · 8-bit Affine (Apple MLX)"},
}

FORMAT_QUANTS: dict[RuntimeFormat, list[QuantKey]] = {
    "GGUF": ["Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0", "FP16"],
    "AWQ": ["AWQ_4BIT", "FP8"],
    "MLX": ["MLX_4BIT", "MLX_8BIT"],
}

KV_BITS: dict[KvQuantKey, float] = {
    "fp16": 16.0,
    "q8_0": 8.5,
    "q4_0": 4.5,
}

CONTEXT_LADDER: list[int] = [4096, 8192, 16384, 32768, 40960, 65536, 131072]

# Speed tiers (tokens/sec midpoint)
SPEED_FAST_MIN = 25.0
SPEED_INTERACTIVE_MIN = 12.0
SPEED_READABLE_MIN = 6.0


class RunEstimate(TypedDict):
    quant: QuantKey
    format: RuntimeFormat
    context_tokens: int
    weights_gb: float
    kv_cache_gb: float
    overhead_gb: float
    total_vram_gb: float
    effective_usable_vram_gb: float
    headroom_gb: float
    status: CompatStatus
    speed_tier: SpeedTier
    est_tps: float
    est_tps_low: int
    est_tps_high: int
    gpu_layers_fit: int
    total_layers: int
    gpu_fraction: float
    comm_overhead_pct: float
    comm_warning: bool


class RigRunEstimate(RunEstimate):
    raw_vram_gb: float
    usable_vram_gb: float
    system_ram_gb: float
    available_ram_gb: float
    spill_ram_gb: float
    fits_vram: bool
    fits_rig: bool
    bottleneck: str
    gpu_count: int
    split_mode: SplitMode
    kv_quant: KvQuantKey
    reserve_profile: ReserveProfile
    os_ram_reserve_gb: float
    effective_bw_gbps: float
    active_params_b: float


class QuantRow(TypedDict):
    quant: QuantKey
    format: RuntimeFormat
    label: str
    bits_per_weight: float
    weights_gb: float
    kv_cache_8k_gb: float
    overhead_gb: float
    total_vram_8k_gb: float
    effective_usable_vram_gb: float
    est_tps: float
    est_tps_low: int
    est_tps_high: int
    status: CompatStatus
    speed_tier: SpeedTier
    gpu_layers_fit: int
    total_layers: int
    recommended: bool
    notes: str


def _r2(val: float) -> float:
    if val == 0.0:
        return 0.0
    mag = math.floor(abs(val) * 100.0 + 0.5) / 100.0
    return -mag if val < 0 else mag


def _r3(val: float) -> float:
    if val == 0.0:
        return 0.0
    mag = math.floor(abs(val) * 1000.0 + 0.5) / 1000.0
    return -mag if val < 0 else mag


def _r1(val: float) -> float:
    if val == 0.0:
        return 0.0
    mag = math.floor(abs(val) * 10.0 + 0.5) / 10.0
    return -mag if val < 0 else mag


def _round_int(val: float) -> int:
    return int(math.floor(abs(val) + 0.5)) * (-1 if val < 0 else 1)


def default_quant_for_format(fmt: RuntimeFormat) -> QuantKey:
    if fmt == "AWQ":
        return "AWQ_4BIT"
    if fmt == "MLX":
        return "MLX_4BIT"
    return "Q4_K_M"


def format_for_quant(quant: QuantKey) -> RuntimeFormat:
    spec = QUANT_SPECS.get(quant)
    if spec:
        return spec["format"]  # type: ignore[return-value]
    return "GGUF"


def normalize_format_and_quant(
    fmt: RuntimeFormat | None = None,
    quant: QuantKey | None = None,
) -> tuple[RuntimeFormat, QuantKey]:
    if fmt is None and quant is None:
        return "GGUF", "Q4_K_M"
    if fmt is None and quant is not None:
        return format_for_quant(quant), quant
    assert fmt is not None
    allowed = FORMAT_QUANTS[fmt]
    if quant is not None and quant in allowed:
        return fmt, quant
    return fmt, default_quant_for_format(fmt)


def os_ram_reserve_gb(system_ram_gb: float) -> float:
    if system_ram_gb <= 16.0:
        return 4.5
    if system_ram_gb <= 32.0:
        return 6.0
    if system_ram_gb <= 64.0:
        return 8.0
    return 10.0


def effective_usable_vram_gb(
    hardware: HardwareSpec,
    gpu_count: int,
    reserve_profile: ReserveProfile = "desktop",
    custom_usable_gb: float | None = None,
) -> tuple[float, float]:
    """Return (raw_vram_gb, usable_vram_gb) before multi-GPU runtime scratchpad."""
    base_cards = max(1, int(hardware.get("gpu_count", 1)))
    single_raw = float(hardware["vram_gb"]) / base_cards
    raw_total = _r2(single_raw * gpu_count)
    if gpu_count <= 0:
        return 0.0, 0.0

    if reserve_profile == "custom" and custom_usable_gb is not None and custom_usable_gb > 0:
        capped = min(raw_total, max(0.5, float(custom_usable_gb)))
        return raw_total, _r2(capped)

    if hardware["is_unified"]:
        if reserve_profile == "clean":
            if raw_total <= 8.0:
                usable = 6.0
            elif raw_total <= 16.0:
                usable = _r2(raw_total - 3.0)
            elif raw_total <= 24.0:
                usable = _r2(raw_total - 4.0)
            elif raw_total <= 36.0:
                usable = _r2(raw_total * 0.84)
            else:
                usable = _r2(raw_total * 0.86)
        else:
            # Realistic Daily Desktop budget (macOS / Windows + browser + IDE)
            if raw_total <= 8.0:
                usable = 4.8
            elif raw_total <= 16.0:
                usable = 10.5
            elif raw_total <= 24.0:
                usable = 16.8
            elif raw_total <= 36.0:
                usable = _r2(raw_total * 0.74)
            elif raw_total <= 64.0:
                usable = _r2(raw_total * 0.76)
            else:
                usable = _r2(raw_total * 0.78)
        return raw_total, _r2(min(raw_total, max(0.5, usable)))

    single_usable_catalog = float(hardware["usable_vram_gb"]) / base_cards
    if reserve_profile == "clean":
        clean_usable = raw_total - min(1.8, raw_total * 0.025)
        usable = max(single_usable_catalog * gpu_count, clean_usable)
        return raw_total, _r2(min(raw_total, usable))

    desktop_usable = single_usable_catalog * gpu_count
    return raw_total, _r2(min(raw_total, max(0.5, desktop_usable)))


def kv_cache_gb(
    model: ModelSpec,
    context_tokens: int,
    kv_quant: KvQuantKey = "fp16",
) -> float:
    kv_bits = KV_BITS[kv_quant]
    bytes_per_el = kv_bits / 8.0
    kv_layers = int(model.get("kv_layers") or model["num_layers"])
    total_bytes = (
        2.0
        * kv_layers
        * model["num_kv_heads"]
        * model["head_dim"]
        * bytes_per_el
        * context_tokens
    )
    return _r2(total_bytes / (1024**3))


def kv_gb_per_4k(model: ModelSpec, kv_quant: KvQuantKey = "fp16") -> float:
    return kv_cache_gb(model, 4096, kv_quant=kv_quant)


def classify_speed_tier(est_tps: float, status: CompatStatus) -> SpeedTier:
    if status == "OOM" or est_tps <= 0.0:
        return "OOM"
    if est_tps >= SPEED_FAST_MIN:
        return "Fast"
    if est_tps >= SPEED_INTERACTIVE_MIN:
        return "Interactive"
    if est_tps >= SPEED_READABLE_MIN:
        return "Readable"
    return "Slow"


def speed_rating(tps: float, status: CompatStatus = "Fits") -> str:
    return classify_speed_tier(tps, status)


def format_tps_range(low: int, high: int, est_tps: float = 0.0, status: CompatStatus = "Fits") -> str:
    if status == "OOM" or (est_tps <= 0 and high <= 0):
        return "OOM"
    if low <= 0 and est_tps < 1.0:
        return "<1 tok/s"
    if low == high:
        return f"~{low} tok/s"
    return f"~{low}–{high} tok/s"


def format_context_label(tokens: int) -> str:
    if tokens >= 1024 and tokens % 1024 == 0:
        return f"{tokens // 1024}K"
    if tokens >= 10000 and tokens % 1000 == 0:
        return f"{tokens // 1000}K"
    return str(tokens)


def estimate_rig_run(
    model: ModelSpec,
    hardware: HardwareSpec | None,
    gpu_count: int | None = None,
    cpu: CpuSpec | None = None,
    system_ram_gb: float = 64.0,
    quant: QuantKey | None = "Q4_K_M",
    format: RuntimeFormat | None = None,
    context_tokens: int = 8192,
    kv_quant: KvQuantKey = "fp16",
    split_mode: SplitMode = "layer",
    reserve_profile: ReserveProfile = "desktop",
    custom_usable_gb: float | None = None,
    flash_attention: bool = True,
) -> RigRunEstimate:
    fmt, norm_quant = normalize_format_and_quant(format, quant)
    bpw = float(QUANT_SPECS[norm_quant]["bpw"])  # type: ignore[arg-type]

    # Weights in decimal GB / binary GiB approximation aligned with GGUF/safetensors file sizes
    weights_gb = _r2(model["params_b"] * bpw / 8.0)
    active_params_b = float(model.get("active_params_b") or model["params_b"])
    active_weights_gb = _r2(weights_gb * (active_params_b / model["params_b"]))

    kv_gb = kv_cache_gb(model, context_tokens, kv_quant=kv_quant)

    eff_gpu_count = 0 if hardware is None else (int(gpu_count) if gpu_count is not None else int(hardware["gpu_count"]))
    eff_gpu_count = max(0, min(8, eff_gpu_count))

    if fmt == "AWQ":
        base_overhead = 0.95 + 0.032 * weights_gb
    elif fmt == "MLX":
        base_overhead = 0.45 + 0.015 * weights_gb
    else:
        base_overhead = 0.45 + 0.012 * weights_gb
        if flash_attention and context_tokens >= 32768:
            base_overhead += 0.12

    multi_gpu_ctx_gb = 0.55 * max(0, eff_gpu_count - 1)
    overhead_gb = _r2(base_overhead + multi_gpu_ctx_gb)
    total_vram_gb = _r2(weights_gb + kv_gb + overhead_gb)

    total_layers = int(model["num_layers"])
    sys_ram = float(system_ram_gb)
    os_reserve = os_ram_reserve_gb(sys_ram)
    available_ram_gb = _r2(max(1.0, sys_ram - os_reserve))

    # Pure CPU fallback (0 GPUs selected in Rig Simulator)
    if hardware is None or eff_gpu_count == 0:
        cpu_bw = float(cpu["effective_bw_gbps"]) if cpu is not None else 55.0
        fits_rig = total_vram_gb <= available_ram_gb
        status: CompatStatus = "Partial Offload" if fits_rig else "OOM"
        if not fits_rig:
            raw_tps = 0.0
        else:
            raw_tps = (cpu_bw * 0.58) / max(0.35, active_weights_gb + kv_gb * 0.4)

        est_tps, tps_low, tps_high = _compute_tps_bounds(raw_tps, status)
        return {
            "quant": norm_quant,
            "format": fmt,
            "context_tokens": context_tokens,
            "weights_gb": weights_gb,
            "kv_cache_gb": kv_gb,
            "overhead_gb": overhead_gb,
            "total_vram_gb": total_vram_gb,
            "effective_usable_vram_gb": 0.0,
            "headroom_gb": _r2(available_ram_gb - total_vram_gb),
            "status": status,
            "speed_tier": classify_speed_tier(est_tps, status),
            "est_tps": est_tps,
            "est_tps_low": tps_low,
            "est_tps_high": tps_high,
            "gpu_layers_fit": 0,
            "total_layers": total_layers,
            "gpu_fraction": 0.0,
            "comm_overhead_pct": 0.0,
            "comm_warning": False,
            "raw_vram_gb": 0.0,
            "usable_vram_gb": 0.0,
            "system_ram_gb": sys_ram,
            "available_ram_gb": available_ram_gb,
            "spill_ram_gb": _r2(total_vram_gb),
            "fits_vram": False,
            "fits_rig": fits_rig,
            "bottleneck": "System RAM" if fits_rig else "Insufficient Memory",
            "gpu_count": 0,
            "split_mode": split_mode,
            "kv_quant": kv_quant,
            "reserve_profile": reserve_profile,
            "os_ram_reserve_gb": os_reserve,
            "effective_bw_gbps": cpu_bw,
            "active_params_b": active_params_b,
        }

    # Unified memory on Mac / Strix Halo treats the single chip pool as unified (no 2x count)
    if hardware["is_unified"]:
        eff_gpu_count = 1
        multi_gpu_ctx_gb = 0.0
        overhead_gb = _r2(base_overhead)
        total_vram_gb = _r2(weights_gb + kv_gb + overhead_gb)

    raw_vram_gb, usable_vram = effective_usable_vram_gb(
        hardware, eff_gpu_count, reserve_profile=reserve_profile, custom_usable_gb=custom_usable_gb
    )

    headroom_gb = _r2(usable_vram - total_vram_gb)
    tight_threshold = max(1.0, usable_vram * 0.05)
    fits_vram = total_vram_gb <= usable_vram

    if fits_vram:
        gpu_layers_fit = total_layers
        gpu_fraction = 1.0
        spill_ram_gb = 0.0
        fits_rig = True
        status = "Tight Fit" if headroom_gb < tight_threshold else "Fits"
    else:
        per_layer_weight_gb = weights_gb / total_layers
        usable_for_weights = max(0.0, usable_vram - overhead_gb - kv_gb)
        gpu_layers_fit = max(0, min(total_layers - 1, math.floor(usable_for_weights / max(0.02, per_layer_weight_gb))))
        gpu_fraction = _r3(gpu_layers_fit / total_layers)
        spill_ram_gb = _r2(max(0.0, total_vram_gb - usable_vram))

        if hardware["is_unified"]:
            # Unified memory Macs/APUs cannot offload "to host RAM" — it IS host RAM.
            fits_rig = False
            status = "OOM"
        else:
            fits_rig = gpu_fraction >= 0.15 and spill_ram_gb <= available_ram_gb
            status = "Partial Offload" if fits_rig else "OOM"

    # Throughput / Bandwidth calculation (Physics v3.3 calibrated model)
    single_bw = float(hardware["bandwidth_gbps"])
    backend = hardware["backend"]
    hid = hardware["id"]
    has_nvlink = bool(hardware.get("has_nvlink", False))
    kv_layers = int(model.get("kv_layers") or total_layers)
    is_moe = active_params_b < model["params_b"] * 0.9
    is_hybrid = kv_layers < total_layers
    is_legacy_gpu = any(tag in hid for tag in ("t4", "p40", "gtx-10", "rtx-20", "v100"))

    if fmt == "AWQ":
        backend_eff = 0.48 if is_legacy_gpu else 0.69
    elif fmt == "MLX":
        size_bonus = 0.08 if weights_gb >= 25.0 else (0.03 if weights_gb >= 12.0 else 0.0)
        backend_eff = (0.78 + size_bonus) if hardware["is_unified"] else 0.72
    elif backend == "CUDA":
        backend_eff = 0.58 if is_legacy_gpu else 0.75
    elif backend == "Metal":
        size_bonus = 0.05 if weights_gb >= 25.0 else 0.0
        backend_eff = 0.78 + size_bonus
    elif backend == "ROCm":
        backend_eff = 0.70
    elif backend == "Vulkan":
        backend_eff = 0.62
    else:
        backend_eff = 0.60

    if is_moe:
        backend_eff *= 0.65 if backend == "CUDA" else 0.71

    if fmt == "AWQ":
        layer_ms = 0.080 if is_legacy_gpu else 0.040
    elif fmt == "MLX":
        layer_ms = 0.030
    else:
        layer_ms = 0.022
    if is_moe:
        layer_ms += 0.072 if backend == "CUDA" else 0.055

    if is_hybrid:
        deltanet_layers = total_layers - kv_layers
        hybrid_ms = deltanet_layers * (0.145 if fmt == "MLX" else 0.002)
    else:
        hybrid_ms = 0.0

    comm_latency_sec = 0.0
    comm_overhead_pct = 0.0
    comm_warning = False

    if eff_gpu_count == 1 or hardware["is_unified"]:
        effective_bw = single_bw
    elif split_mode == "tensor":
        # Tensor Parallel aggregates memory bandwidth across GPUs, but suffers 2 * num_layers All-Reduce ops/tok
        bw_scaling = 1.0 + (eff_gpu_count - 1) * (0.90 if has_nvlink else 0.82)
        effective_bw = single_bw * bw_scaling
        per_op_ms = 0.014 if has_nvlink else 0.165
        comm_latency_sec = (2.0 * total_layers * per_op_ms * (1.0 + 0.15 * max(0, eff_gpu_count - 2))) / 1000.0
        comm_warning = not has_nvlink
    else:
        # Layer Split: sequential pipeline across PCIe stages, avoids All-Reduce syncs
        pipeline_factor = 0.985 if has_nvlink else max(0.84, 1.0 - 0.045 * (eff_gpu_count - 1))
        effective_bw = single_bw * pipeline_factor

    cpu_bw = float(cpu["effective_bw_gbps"]) if cpu is not None else 55.0
    active_kv_gb = kv_gb * 0.85
    ctx_k = context_tokens / 1024.0
    attn_ms = (0.00018 * kv_layers * (ctx_k ** 1.35)) if context_tokens >= 8192 else 0.0
    overhead_sec = (total_layers * layer_ms + hybrid_ms + attn_ms) / 1000.0

    if status == "OOM":
        raw_tps = 0.0
        bottleneck = "Insufficient Memory"
    else:
        gpu_time = (active_weights_gb * gpu_fraction + active_kv_gb * gpu_fraction) / max(
            1.0, effective_bw * backend_eff
        )
        cpu_time = (
            (active_weights_gb * (1.0 - gpu_fraction) + active_kv_gb * (1.0 - gpu_fraction))
            / max(1.0, cpu_bw * 0.60)
            if gpu_fraction < 1.0
            else 0.0
        )
        total_tok_sec = gpu_time + cpu_time + comm_latency_sec + overhead_sec
        raw_tps = 1.0 / max(0.002, total_tok_sec)

        if comm_latency_sec > 0 and total_tok_sec > 0:
            comm_overhead_pct = _r1((comm_latency_sec / total_tok_sec) * 100.0)

        if gpu_fraction < 1.0:
            bottleneck = "PCIe / System RAM"
        elif comm_warning and comm_overhead_pct >= 20.0:
            bottleneck = "PCIe All-Reduce"
        else:
            bottleneck = "VRAM"

    est_tps, tps_low, tps_high = _compute_tps_bounds(raw_tps, status)

    return {
        "quant": norm_quant,
        "format": fmt,
        "context_tokens": context_tokens,
        "weights_gb": weights_gb,
        "kv_cache_gb": kv_gb,
        "overhead_gb": overhead_gb,
        "total_vram_gb": total_vram_gb,
        "effective_usable_vram_gb": usable_vram,
        "headroom_gb": headroom_gb,
        "status": status,
        "speed_tier": classify_speed_tier(est_tps, status),
        "est_tps": est_tps,
        "est_tps_low": tps_low,
        "est_tps_high": tps_high,
        "gpu_layers_fit": gpu_layers_fit,
        "total_layers": total_layers,
        "gpu_fraction": gpu_fraction,
        "comm_overhead_pct": comm_overhead_pct,
        "comm_warning": comm_warning,
        "raw_vram_gb": raw_vram_gb,
        "usable_vram_gb": usable_vram,
        "system_ram_gb": sys_ram,
        "available_ram_gb": available_ram_gb,
        "spill_ram_gb": spill_ram_gb,
        "fits_vram": fits_vram,
        "fits_rig": fits_rig,
        "bottleneck": bottleneck,
        "gpu_count": eff_gpu_count,
        "split_mode": split_mode,
        "kv_quant": kv_quant,
        "reserve_profile": reserve_profile,
        "os_ram_reserve_gb": os_reserve,
        "effective_bw_gbps": _r1(effective_bw),
        "active_params_b": active_params_b,
    }


def _compute_tps_bounds(raw_tps: float, status: CompatStatus) -> tuple[float, int, int]:
    if status == "OOM" or raw_tps <= 0.0:
        return 0.0, 0, 0

    spread = 0.17 if status == "Fits" else (0.20 if status == "Tight Fit" else 0.25)
    if raw_tps < 1.0:
        return _r1(raw_tps), 0, 1

    est_tps = float(_round_int(raw_tps))
    tps_low = max(1, math.floor(raw_tps * (1.0 - spread)))
    tps_high = max(
        tps_low + (1 if raw_tps >= 3.0 else 0),
        math.ceil(raw_tps * (1.0 + spread)),
    )
    return est_tps, tps_low, tps_high


def estimate_run(
    model: ModelSpec,
    hardware: HardwareSpec,
    quant: QuantKey = "Q4_K_M",
    context_tokens: int = 8192,
    reserve_profile: ReserveProfile = "desktop",
    kv_quant: KvQuantKey = "fp16",
    format: RuntimeFormat | None = None,
) -> RunEstimate:
    rig = estimate_rig_run(
        model=model,
        hardware=hardware,
        gpu_count=hardware["gpu_count"],
        system_ram_gb=64.0,
        quant=quant,
        format=format,
        context_tokens=context_tokens,
        kv_quant=kv_quant,
        split_mode="layer",
        reserve_profile=reserve_profile,
    )
    return {
        "quant": rig["quant"],
        "format": rig["format"],
        "context_tokens": rig["context_tokens"],
        "weights_gb": rig["weights_gb"],
        "kv_cache_gb": rig["kv_cache_gb"],
        "overhead_gb": rig["overhead_gb"],
        "total_vram_gb": rig["total_vram_gb"],
        "effective_usable_vram_gb": rig["effective_usable_vram_gb"],
        "headroom_gb": rig["headroom_gb"],
        "status": rig["status"],
        "speed_tier": rig["speed_tier"],
        "est_tps": rig["est_tps"],
        "est_tps_low": rig["est_tps_low"],
        "est_tps_high": rig["est_tps_high"],
        "gpu_layers_fit": rig["gpu_layers_fit"],
        "total_layers": rig["total_layers"],
        "gpu_fraction": rig["gpu_fraction"],
        "comm_overhead_pct": rig["comm_overhead_pct"],
        "comm_warning": rig["comm_warning"],
    }


def max_fit_context_full(
    model: ModelSpec,
    hardware: HardwareSpec,
    quant: QuantKey = "Q4_K_M",
    reserve_profile: ReserveProfile = "desktop",
    kv_quant: KvQuantKey = "fp16",
) -> dict[str, object]:
    """Return full max fit context metrics including speed range AT max fit context."""
    tiers = [t for t in CONTEXT_LADDER if t <= model["max_context"]]
    best_ctx = 0
    best_vram = 0.0
    best_status: CompatStatus = "OOM"
    best_low = 0
    best_high = 0
    best_tier: SpeedTier = "OOM"
    for ctx in tiers:
        res = estimate_run(
            model,
            hardware,
            quant=quant,
            context_tokens=ctx,
            reserve_profile=reserve_profile,
            kv_quant=kv_quant,
        )
        if res["status"] in ("Fits", "Tight Fit"):
            best_ctx = ctx
            best_vram = res["total_vram_gb"]
            best_status = res["status"]
            best_low = res["est_tps_low"]
            best_high = res["est_tps_high"]
            best_tier = res["speed_tier"]
        else:
            break
    return {
        "context_tokens": best_ctx,
        "total_vram_gb": best_vram,
        "status": best_status,
        "est_tps_low": best_low,
        "est_tps_high": best_high,
        "speed_tier": best_tier,
    }


def max_fit_context_details(
    model: ModelSpec,
    hardware: HardwareSpec,
    quant: QuantKey = "Q4_K_M",
    reserve_profile: ReserveProfile = "desktop",
    kv_quant: KvQuantKey = "fp16",
) -> tuple[int, float, CompatStatus]:
    """Return (max_ctx_tokens, total_vram_gb_at_max_ctx, status_at_max_ctx)."""
    full = max_fit_context_full(
        model, hardware, quant=quant, reserve_profile=reserve_profile, kv_quant=kv_quant
    )
    return (
        int(full["context_tokens"]),  # type: ignore[arg-type]
        float(full["total_vram_gb"]),  # type: ignore[arg-type]
        full["status"],  # type: ignore[return-value]
    )


def max_smooth_context(
    model: ModelSpec,
    hardware: HardwareSpec,
    quant: QuantKey = "Q4_K_M",
    reserve_profile: ReserveProfile = "desktop",
    kv_quant: KvQuantKey = "fp16",
) -> int:
    ctx, _, _ = max_fit_context_details(
        model, hardware, quant=quant, reserve_profile=reserve_profile, kv_quant=kv_quant
    )
    return ctx


def build_quant_table(
    model: ModelSpec,
    hardware: HardwareSpec,
    default_quant: QuantKey = "Q4_K_M",
    reserve_profile: ReserveProfile = "desktop",
) -> list[QuantRow]:
    quants: list[QuantKey] = ["Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0", "FP16", "AWQ_4BIT"]
    if hardware["is_unified"] and hardware["vendor"] == "Apple":
        quants.append("MLX_4BIT")

    rows: list[QuantRow] = []
    for q in quants:
        fmt = format_for_quant(q)
        res = estimate_run(
            model,
            hardware,
            quant=q,
            context_tokens=8192,
            reserve_profile=reserve_profile,
            format=fmt,
        )
        usable = res["effective_usable_vram_gb"]
        headroom = res["headroom_gb"]
        if res["status"] == "Fits":
            notes = f"Fits 100% in {hardware['backend']} memory ({headroom:.1f} GB headroom)."
        elif res["status"] == "Tight Fit":
            notes = f"Tight margin ({headroom:.2f} GB free) — driver/KV growth may spill to CPU/RAM."
        elif res["status"] == "Partial Offload":
            notes = f"{res['gpu_layers_fit']}/{res['total_layers']} layers on GPU; remainder offloaded to system RAM."
        else:
            notes = f"Needs {res['total_vram_gb']:.1f} GB vs {usable:.1f} GB usable pool."

        rows.append(
            {
                "quant": q,
                "format": fmt,
                "label": str(QUANT_SPECS[q]["label"]),
                "bits_per_weight": float(QUANT_SPECS[q]["bpw"]),  # type: ignore[arg-type]
                "weights_gb": res["weights_gb"],
                "kv_cache_8k_gb": res["kv_cache_gb"],
                "overhead_gb": res["overhead_gb"],
                "total_vram_8k_gb": res["total_vram_gb"],
                "effective_usable_vram_gb": usable,
                "est_tps": res["est_tps"],
                "est_tps_low": res["est_tps_low"],
                "est_tps_high": res["est_tps_high"],
                "status": res["status"],
                "speed_tier": res["speed_tier"],
                "gpu_layers_fit": res["gpu_layers_fit"],
                "total_layers": res["total_layers"],
                "recommended": q == default_quant and res["status"] in ("Fits", "Tight Fit"),
                "notes": notes,
            }
        )
    return rows


def build_commands(
    model: ModelSpec,
    hardware: HardwareSpec,
    est: RunEstimate,
    gpu_count: int | None = None,
    split_mode: SplitMode = "layer",
    kv_quant: KvQuantKey = "fp16",
) -> dict[str, object]:
    eff_gpu_count = gpu_count if gpu_count is not None else int(hardware["gpu_count"])
    max_ctx, _, _ = max_fit_context_details(model, hardware, quant="Q4_K_M", kv_quant=kv_quant)
    rec_ctx = min(32768, max_ctx) if max_ctx > 0 else 8192
    if est["status"] in ("Fits", "Tight Fit"):
        rec_ngl = 99
    else:
        rec_ngl = est["gpu_layers_fit"]

    fa_flag = "-fa on" if hardware["backend"] in ("CUDA", "Metal") else "-fa off"
    kv_flags = f" --cache-type-k {kv_quant} --cache-type-v {kv_quant}" if kv_quant != "fp16" else " --cache-type-k q8_0 --cache-type-v q8_0"
    split_flag = " -sm row" if eff_gpu_count > 1 and split_mode == "tensor" else ""
    hf_spec = f"{model['hf_repo']}:{est['quant'] if est['format'] == 'GGUF' else 'Q4_K_M'}"

    llama_cli = (
        f"llama-cli -hf {hf_spec} \\\n"
        f"  -ngl {rec_ngl} -c {rec_ctx} {fa_flag}{kv_flags}{split_flag}"
    )
    llama_server = (
        f"llama-server -hf {hf_spec} \\\n"
        f"  -ngl {rec_ngl} -c {rec_ctx} {fa_flag}{split_flag} --host 127.0.0.1 --port 8080"
    )
    ollama_env_cmd = (
        f"OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 "
        f"OLLAMA_NUM_CTX={rec_ctx} ollama run {model['ollama_tag']}"
    )

    awq_repo = model.get("awq_repo") or f"{model['hf_repo'].replace('-GGUF', '-AWQ')}"
    tp_flag = f" --tensor-parallel-size {eff_gpu_count}" if eff_gpu_count > 1 else ""
    vllm_quant = "--quantization fp8" if est["quant"] == "FP8" else "--quantization awq"
    vllm_serve = f"vllm serve {awq_repo} {vllm_quant} --max-model-len {rec_ctx}{tp_flag}"

    mlx_repo = model.get("mlx_repo") or f"mlx-community/{model['name']}-4bit"
    mlx_lm = f"mlx_lm.generate --model {mlx_repo} --max-tokens 1024 --prompt \"Explain KV cache sizing\""

    return {
        "ollama_run": f"ollama run {model['ollama_tag']}",
        "ollama_env_cmd": ollama_env_cmd,
        "llama_cli": llama_cli,
        "llama_server": llama_server,
        "vllm_serve": vllm_serve,
        "mlx_lm": mlx_lm,
        "recommended_ctx": rec_ctx,
        "recommended_ngl": rec_ngl,
    }
