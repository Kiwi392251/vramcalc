"""Deterministic VRAM & token generation speed calculations for vramcalc.me.

Keep these formulas synchronized with site/src/utils/physics.ts,
site/src/components/VramCalculator.astro, and site/src/components/RigSimulator.astro.
"""

from __future__ import annotations

from typing import Literal, TypedDict

from catalog import HardwareSpec, ModelSpec

QuantKey = Literal["Q2_K", "Q3_K_M", "Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0", "FP16"]
KvQuantKey = Literal["FP16", "Q8_0", "Q4_0"]
SplitMode = Literal["layer", "row"]
CompatStatus = Literal["Smooth", "Partial Offload", "OOM"]

QUANT_ORDER: list[QuantKey] = ["Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0", "FP16"]
ALL_QUANT_ORDER: list[QuantKey] = [
    "Q2_K",
    "Q3_K_M",
    "Q4_K_M",
    "Q5_K_M",
    "Q6_K",
    "Q8_0",
    "FP16",
]

QUANT_BPW: dict[QuantKey, float] = {
    "Q2_K": 3.00,
    "Q3_K_M": 3.90,
    "Q4_K_M": 4.85,
    "Q5_K_M": 5.70,
    "Q6_K": 6.60,
    "Q8_0": 8.50,
    "FP16": 16.00,
}

KV_QUANT_BYTES: dict[KvQuantKey, float] = {
    "FP16": 2.0,
    "Q8_0": 1.0,
    "Q4_0": 0.5,
}

EFFICIENCY_CUDA: dict[QuantKey, float] = {
    "Q2_K": 0.75,
    "Q3_K_M": 0.77,
    "Q4_K_M": 0.78,
    "Q5_K_M": 0.79,
    "Q6_K": 0.79,
    "Q8_0": 0.80,
    "FP16": 0.82,
}

EFFICIENCY_METAL: dict[QuantKey, float] = {
    "Q2_K": 0.71,
    "Q3_K_M": 0.73,
    "Q4_K_M": 0.74,
    "Q5_K_M": 0.75,
    "Q6_K": 0.75,
    "Q8_0": 0.76,
    "FP16": 0.78,
}

EFFICIENCY_ROCM: dict[QuantKey, float] = {
    "Q2_K": 0.67,
    "Q3_K_M": 0.69,
    "Q4_K_M": 0.70,
    "Q5_K_M": 0.71,
    "Q6_K": 0.71,
    "Q8_0": 0.72,
    "FP16": 0.74,
}

EFFICIENCY_VULKAN: dict[QuantKey, float] = {
    "Q2_K": 0.63,
    "Q3_K_M": 0.64,
    "Q4_K_M": 0.65,
    "Q5_K_M": 0.66,
    "Q6_K": 0.66,
    "Q8_0": 0.67,
    "FP16": 0.69,
}

EFFICIENCY_CPU: dict[QuantKey, float] = {
    "Q2_K": 0.82,
    "Q3_K_M": 0.84,
    "Q4_K_M": 0.86,
    "Q5_K_M": 0.87,
    "Q6_K": 0.87,
    "Q8_0": 0.88,
    "FP16": 0.85,
}

EFFICIENCY_BY_BACKEND: dict[str, dict[QuantKey, float]] = {
    "CUDA": EFFICIENCY_CUDA,
    "Metal": EFFICIENCY_METAL,
    "ROCm": EFFICIENCY_ROCM,
    "Vulkan": EFFICIENCY_VULKAN,
    "CPU": EFFICIENCY_CPU,
}

MULTI_GPU_EFFICIENCY = 0.92
LAYER_SPLIT_EFF: dict[int, float] = {
    1: 1.0,
    2: 0.92,
    3: 0.89,
    4: 0.86,
    6: 0.83,
    8: 0.80,
}
TP_PCIE_EFF: dict[int, float] = {
    1: 1.0,
    2: 0.80,
    3: 0.74,
    4: 0.68,
    6: 0.60,
    8: 0.55,
}
TP_NVLINK_EFF: dict[int, float] = {
    1: 1.0,
    2: 0.90,
    3: 0.87,
    4: 0.84,
    6: 0.80,
    8: 0.78,
}

QUANT_LABELS: dict[QuantKey, str] = {
    "Q2_K": "3.00 bpw · Ultra-compressed 2-bit",
    "Q3_K_M": "3.90 bpw · Compact 3-bit",
    "Q4_K_M": "4.85 bpw · Balanced 4-bit",
    "Q5_K_M": "5.70 bpw · Higher-precision 5-bit",
    "Q6_K": "6.60 bpw · Near-lossless 6-bit",
    "Q8_0": "8.50 bpw · 8-bit integer",
    "FP16": "16.0 bpw · Full half-precision",
}

CPU_OFFLOAD_BW_GBPS = 35.0
CONTEXT_CHECKPOINTS = [65536, 49152, 32768, 16384, 8192, 4096]


class RunEstimate(TypedDict):
    quant: QuantKey
    context_tokens: int
    weights_gb: float
    kv_cache_gb: float
    overhead_gb: float
    total_vram_gb: float
    status: CompatStatus
    est_tps: float
    gpu_layers_fit: int
    total_layers: int
    gpu_fraction: float


class RigRunEstimate(RunEstimate):
    kv_quant: KvQuantKey
    gpu_count: int
    split_mode: SplitMode
    usable_vram_gb: float
    total_phys_vram_gb: float
    offload_ram_gb: float
    usable_ram_gb: float
    is_cpu_only: bool
    oom_reason: str


class QuantRow(TypedDict):
    quant: QuantKey
    label: str
    bits_per_weight: float
    weights_gb: float
    kv_cache_8k_gb: float
    overhead_gb: float
    total_vram_8k_gb: float
    est_tps: float
    status: CompatStatus
    gpu_layers_fit: int
    total_layers: int
    recommended: bool
    notes: str


class LaunchCommands(TypedDict):
    ollama_run: str
    ollama_env_cmd: str
    llama_cli: str
    llama_server: str
    recommended_ctx: int
    recommended_ngl: int


def os_ram_reserve_gb(system_ram_gb: float) -> float:
    if system_ram_gb <= 16.0:
        return 4.0
    if system_ram_gb <= 32.0:
        return 6.0
    return 8.0


def _split_scale_factor(gpu_count: int, split_mode: SplitMode, has_nvlink: bool) -> float:
    if gpu_count <= 1:
        return 1.0
    if split_mode == "row":
        table = TP_NVLINK_EFF if has_nvlink else TP_PCIE_EFF
        eff = table.get(gpu_count, 0.52)
        return eff * gpu_count
    return LAYER_SPLIT_EFF.get(gpu_count, 0.80)


def estimate_rig_run(
    model: ModelSpec,
    hardware: HardwareSpec | None,
    *,
    quant: QuantKey = "Q4_K_M",
    context_tokens: int = 8192,
    kv_quant: KvQuantKey = "FP16",
    gpu_count: int = 1,
    split_mode: SplitMode = "layer",
    cpu_bw_gbps: float = CPU_OFFLOAD_BW_GBPS,
    system_ram_gb: float | None = None,
) -> RigRunEstimate:
    bpw = QUANT_BPW[quant]
    params_b = model["params_b"]
    weights_gb = (params_b * bpw) / 8.0
    active_params_b = model.get("active_params_b") or params_b
    active_ratio = min(1.0, active_params_b / params_b) if params_b > 0 else 1.0
    active_weights_gb = weights_gb * active_ratio

    kv_bytes_per_elem = KV_QUANT_BYTES[kv_quant]
    kv_bytes = (
        2
        * model["num_layers"]
        * model["num_kv_heads"]
        * model["head_dim"]
        * context_tokens
        * kv_bytes_per_elem
    )
    kv_cache_gb = kv_bytes / (1024**3)
    kv_read_gb = kv_cache_gb * 0.5

    overhead_gb = min(2.0, 0.5 + 0.015 * params_b)
    total_vram_gb = weights_gb + kv_cache_gb + overhead_gb

    is_cpu_only = hardware is None or gpu_count <= 0

    if is_cpu_only:
        sys_ram = system_ram_gb if system_ram_gb is not None else 32.0
        usable_ram = max(0.0, sys_ram - os_ram_reserve_gb(sys_ram))
        offload_ram_gb = total_vram_gb
        if total_vram_gb <= usable_ram:
            status: CompatStatus = "Smooth"
            oom_reason = ""
        elif total_vram_gb <= sys_ram * 0.94:
            status = "Partial Offload"
            oom_reason = "Exceeds usable OS-reserved RAM; risks SSD swap thrashing."
        else:
            status = "OOM"
            oom_reason = "Exceeds total physical System RAM."

        cpu_eff = EFFICIENCY_CPU[quant]
        effective_cpu_bw = cpu_bw_gbps * cpu_eff
        read_gb = active_weights_gb + kv_read_gb
        if status == "OOM" or read_gb <= 0:
            est_tps = 0.0
        elif status == "Smooth":
            est_tps = effective_cpu_bw / read_gb
        else:
            est_tps = (effective_cpu_bw / read_gb) * 0.35

        return {
            "quant": quant,
            "kv_quant": kv_quant,
            "context_tokens": context_tokens,
            "weights_gb": round(weights_gb, 2),
            "kv_cache_gb": round(kv_cache_gb, 2),
            "overhead_gb": round(overhead_gb, 2),
            "total_vram_gb": round(total_vram_gb, 2),
            "status": status,
            "est_tps": round(est_tps, 1),
            "gpu_layers_fit": 0,
            "total_layers": model["num_layers"],
            "gpu_fraction": 0.0,
            "gpu_count": 0,
            "split_mode": split_mode,
            "usable_vram_gb": 0.0,
            "total_phys_vram_gb": 0.0,
            "offload_ram_gb": round(offload_ram_gb, 2),
            "usable_ram_gb": round(usable_ram, 2),
            "is_cpu_only": True,
            "oom_reason": oom_reason,
        }

    assert hardware is not None
    base_gpu_count = hardware.get("gpu_count", 1) or 1
    eff_gpu_count = 1 if hardware["is_unified"] else max(1, gpu_count)
    scale_vram = eff_gpu_count / base_gpu_count

    usable = hardware["usable_vram_gb"] * scale_vram
    phys_vram = hardware["vram_gb"] * scale_vram

    mem_for_weights = max(0.0, usable - kv_cache_gb - overhead_gb)
    gpu_fraction = min(1.0, mem_for_weights / weights_gb) if weights_gb > 0 else 1.0
    gpu_layers_fit = (
        model["num_layers"]
        if total_vram_gb <= usable
        else int(model["num_layers"] * gpu_fraction)
    )
    offload_ram_gb = 0.0 if total_vram_gb <= usable else max(0.0, total_vram_gb - usable)
    usable_ram = (
        max(0.0, system_ram_gb - os_ram_reserve_gb(system_ram_gb))
        if system_ram_gb is not None
        else 9999.0
    )

    oom_reason = ""
    if total_vram_gb <= usable:
        status = "Smooth"
    elif hardware["is_unified"]:
        if total_vram_gb <= phys_vram * 0.92:
            status = "Partial Offload"
            oom_reason = "Exceeds safe unified wired ceiling; risks OS memory pressure."
        else:
            status = "OOM"
            oom_reason = "Exceeds usable unified memory capacity."
    elif system_ram_gb is not None:
        if gpu_layers_fit < 1:
            status = "OOM"
            oom_reason = "KV cache & overhead alone exceed GPU VRAM."
        elif offload_ram_gb > usable_ram:
            status = "OOM"
            oom_reason = "Spill weights exceed available System RAM."
        else:
            status = "Partial Offload"
            oom_reason = "Remaining layers spill to System RAM over PCIe."
    else:
        if total_vram_gb <= usable * 2.0 and gpu_fraction >= 0.35:
            status = "Partial Offload"
            oom_reason = "Remaining layers spill to System RAM over PCIe."
        else:
            status = "OOM"
            oom_reason = "Exceeds GPU VRAM practical offload threshold."

    eff = EFFICIENCY_BY_BACKEND.get(hardware["backend"], EFFICIENCY_CUDA)[quant]
    multi_factor = _split_scale_factor(
        eff_gpu_count, split_mode, bool(hardware.get("has_nvlink", False))
    )
    effective_bw = hardware["bandwidth_gbps"] * eff * multi_factor

    if status == "OOM":
        est_tps = 0.0
    elif status == "Smooth":
        est_tps = effective_bw / (active_weights_gb + kv_read_gb)
    elif hardware["is_unified"]:
        est_tps = (effective_bw / (active_weights_gb + kv_read_gb)) * 0.55
    else:
        t_gpu = (active_weights_gb * gpu_fraction + kv_read_gb) / effective_bw
        cpu_bw = max(1.0, cpu_bw_gbps)
        t_cpu = (active_weights_gb * (1.0 - gpu_fraction)) / cpu_bw
        est_tps = 1.0 / (t_gpu + t_cpu) if (t_gpu + t_cpu) > 0 else 0.0

    return {
        "quant": quant,
        "kv_quant": kv_quant,
        "context_tokens": context_tokens,
        "weights_gb": round(weights_gb, 2),
        "kv_cache_gb": round(kv_cache_gb, 2),
        "overhead_gb": round(overhead_gb, 2),
        "total_vram_gb": round(total_vram_gb, 2),
        "status": status,
        "est_tps": round(est_tps, 1),
        "gpu_layers_fit": gpu_layers_fit,
        "total_layers": model["num_layers"],
        "gpu_fraction": round(gpu_fraction, 3),
        "gpu_count": eff_gpu_count,
        "split_mode": split_mode,
        "usable_vram_gb": round(usable, 2),
        "total_phys_vram_gb": round(phys_vram, 2),
        "offload_ram_gb": round(offload_ram_gb, 2),
        "usable_ram_gb": round(usable_ram, 2) if system_ram_gb is not None else 0.0,
        "is_cpu_only": False,
        "oom_reason": oom_reason,
    }


def estimate_run(
    model: ModelSpec,
    hardware: HardwareSpec,
    quant: QuantKey = "Q4_K_M",
    context_tokens: int = 8192,
) -> RunEstimate:
    rig = estimate_rig_run(
        model,
        hardware,
        quant=quant,
        context_tokens=context_tokens,
        kv_quant="FP16",
        gpu_count=hardware.get("gpu_count", 1) or 1,
        split_mode="layer",
        cpu_bw_gbps=CPU_OFFLOAD_BW_GBPS,
        system_ram_gb=None,
    )
    return {
        "quant": rig["quant"],
        "context_tokens": rig["context_tokens"],
        "weights_gb": rig["weights_gb"],
        "kv_cache_gb": rig["kv_cache_gb"],
        "overhead_gb": rig["overhead_gb"],
        "total_vram_gb": rig["total_vram_gb"],
        "status": rig["status"],
        "est_tps": rig["est_tps"],
        "gpu_layers_fit": rig["gpu_layers_fit"],
        "total_layers": rig["total_layers"],
        "gpu_fraction": rig["gpu_fraction"],
    }


def kv_gb_per_4k(model: ModelSpec, kv_quant: KvQuantKey = "FP16") -> float:
    kv_bytes = (
        2
        * model["num_layers"]
        * model["num_kv_heads"]
        * model["head_dim"]
        * 4096
        * KV_QUANT_BYTES[kv_quant]
    )
    return round(kv_bytes / (1024**3), 2)


def max_smooth_context(
    model: ModelSpec, hardware: HardwareSpec, quant: QuantKey = "Q4_K_M"
) -> int:
    for ctx in CONTEXT_CHECKPOINTS:
        est = estimate_run(model, hardware, quant=quant, context_tokens=ctx)
        if est["status"] == "Smooth" and ctx <= model["max_context"]:
            return ctx
    return 0


def _quant_note(quant: QuantKey, est: RunEstimate, hardware: HardwareSpec) -> str:
    if est["status"] == "Smooth":
        headroom = round(hardware["usable_vram_gb"] - est["total_vram_gb"], 1)
        if quant in ("Q2_K", "Q3_K_M", "Q4_K_M"):
            return f"Fits 100% in {hardware['backend']} memory ({headroom} GB headroom)."
        if quant in ("Q5_K_M", "Q6_K"):
            return f"Sweet spot: higher fidelity with {headroom} GB headroom."
        if quant == "Q8_0":
            return f"Near-BF16 precision; fits cleanly with {headroom} GB left."
        return f"Unquantized FP16; {headroom} GB headroom remaining."

    if est["status"] == "Partial Offload":
        if hardware["is_unified"]:
            if hardware["vendor"] == "Apple":
                return "Exceeds safe macOS wired ceiling; risks swap thrashing under load."
            return "Exceeds safe unified GPU memory ceiling; risks OS memory pressure and swap."
        return (
            f"Fits {est['gpu_layers_fit']}/{est['total_layers']} layers on GPU; "
            "remaining layers spill to system RAM over PCIe."
        )

    return (
        f"Requires {est['total_vram_gb']} GB vs {hardware['usable_vram_gb']} GB "
        f"usable {hardware['backend']} memory; too large to run practically."
    )


def build_quant_table(
    model: ModelSpec, hardware: HardwareSpec, context_tokens: int = 8192
) -> list[QuantRow]:
    estimates = {
        q: estimate_run(model, hardware, quant=q, context_tokens=context_tokens)
        for q in QUANT_ORDER
    }

    recommended_quant: QuantKey = "Q4_K_M"
    for candidate in ("Q8_0", "Q6_K", "Q5_K_M", "Q4_K_M"):
        if estimates[candidate]["status"] == "Smooth":
            recommended_quant = candidate
            break

    rows: list[QuantRow] = []
    for q in QUANT_ORDER:
        est = estimates[q]
        rows.append(
            {
                "quant": q,
                "label": QUANT_LABELS[q],
                "bits_per_weight": QUANT_BPW[q],
                "weights_gb": est["weights_gb"],
                "kv_cache_8k_gb": est["kv_cache_gb"],
                "overhead_gb": est["overhead_gb"],
                "total_vram_8k_gb": est["total_vram_gb"],
                "est_tps": est["est_tps"],
                "status": est["status"],
                "gpu_layers_fit": est["gpu_layers_fit"],
                "total_layers": est["total_layers"],
                "recommended": q == recommended_quant,
                "notes": _quant_note(q, est, hardware),
            }
        )
    return rows


def build_commands(
    model: ModelSpec, hardware: HardwareSpec, default_est: RunEstimate
) -> LaunchCommands:
    max_ctx = max_smooth_context(model, hardware, "Q4_K_M")
    recommended_ctx = max(8192, min(max_ctx, 32768)) if max_ctx >= 8192 else 4096

    if default_est["status"] == "Smooth":
        recommended_ngl = 99
    else:
        recommended_ngl = max(1, default_est["gpu_layers_fit"])

    ctx_est = estimate_run(model, hardware, quant="Q4_K_M", context_tokens=recommended_ctx)
    if default_est["status"] == "Smooth" and ctx_est["status"] == "Smooth":
        ngl_flag = 99
    else:
        ngl_flag = max(1, ctx_est["gpu_layers_fit"])

    ollama_run = f"ollama run {model['ollama_tag']}"

    ollama_env_cmd = (
        f"OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 "
        f"OLLAMA_NUM_CTX={recommended_ctx} ollama run {model['ollama_tag']}"
    )

    oom_prefix = (
        "# Warning: Q4_K_M exceeds usable VRAM; use a smaller model or Q2_K/IQ3_XS\n"
        if default_est["status"] == "OOM"
        else ""
    )

    split_flag = " --split-mode layer" if hardware.get("gpu_count", 1) > 1 else ""

    llama_cli = (
        f"{oom_prefix}llama-cli -hf {model['hf_repo']}:Q4_K_M \\\n"
        f"  -ngl {ngl_flag} -c {recommended_ctx} -fa on{split_flag} --cache-type-k q8_0 --cache-type-v q8_0"
    )
    llama_server = (
        f"{oom_prefix}llama-server -hf {model['hf_repo']}:Q4_K_M \\\n"
        f"  -ngl {ngl_flag} -c {recommended_ctx} -fa on{split_flag} --host 127.0.0.1 --port 8080"
    )

    return {
        "ollama_run": ollama_run,
        "ollama_env_cmd": ollama_env_cmd,
        "llama_cli": llama_cli,
        "llama_server": llama_server,
        "recommended_ctx": recommended_ctx,
        "recommended_ngl": ngl_flag if default_est["status"] != "Smooth" else recommended_ngl,
    }
