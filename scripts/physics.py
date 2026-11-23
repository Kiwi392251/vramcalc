"""Deterministic VRAM & token generation speed calculations for vramcalc.me.

Keep these formulas synchronized with site/src/utils/physics.ts and
site/src/components/VramCalculator.astro.
"""

from __future__ import annotations

from typing import Literal, TypedDict

from catalog import HardwareSpec, ModelSpec

QuantKey = Literal["Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0", "FP16"]
CompatStatus = Literal["Smooth", "Partial Offload", "OOM"]

QUANT_ORDER: list[QuantKey] = ["Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0", "FP16"]

QUANT_BPW: dict[QuantKey, float] = {
    "Q4_K_M": 4.85,
    "Q5_K_M": 5.70,
    "Q6_K": 6.60,
    "Q8_0": 8.50,
    "FP16": 16.00,
}

EFFICIENCY_CUDA: dict[QuantKey, float] = {
    "Q4_K_M": 0.78,
    "Q5_K_M": 0.79,
    "Q6_K": 0.79,
    "Q8_0": 0.80,
    "FP16": 0.82,
}

EFFICIENCY_METAL: dict[QuantKey, float] = {
    "Q4_K_M": 0.74,
    "Q5_K_M": 0.75,
    "Q6_K": 0.75,
    "Q8_0": 0.76,
    "FP16": 0.78,
}

QUANT_LABELS: dict[QuantKey, str] = {
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


def estimate_run(
    model: ModelSpec,
    hardware: HardwareSpec,
    quant: QuantKey = "Q4_K_M",
    context_tokens: int = 8192,
) -> RunEstimate:
    bpw = QUANT_BPW[quant]
    weights_gb = (model["params_b"] * bpw) / 8.0

    # FP16 KV cache: 2 (K+V) * layers * kv_heads * head_dim * tokens * 2 bytes
    kv_bytes = (
        2
        * model["num_layers"]
        * model["num_kv_heads"]
        * model["head_dim"]
        * context_tokens
        * 2
    )
    kv_cache_gb = kv_bytes / (1024**3)

    # CUDA / Metal workspace, compute graph, and context activation buffer
    overhead_gb = min(2.0, 0.5 + 0.015 * model["params_b"])
    total_vram_gb = weights_gb + kv_cache_gb + overhead_gb

    usable = hardware["usable_vram_gb"]
    mem_for_weights = max(0.0, usable - kv_cache_gb - overhead_gb)
    gpu_fraction = min(1.0, mem_for_weights / weights_gb) if weights_gb > 0 else 1.0
    gpu_layers_fit = (
        model["num_layers"]
        if total_vram_gb <= usable
        else int(model["num_layers"] * gpu_fraction)
    )

    if total_vram_gb <= usable:
        status: CompatStatus = "Smooth"
    elif hardware["is_unified"]:
        if total_vram_gb <= hardware["vram_gb"] * 0.92:
            status = "Partial Offload"
        else:
            status = "OOM"
    else:
        if total_vram_gb <= usable * 2.0 and gpu_fraction >= 0.35:
            status = "Partial Offload"
        else:
            status = "OOM"

    eff = (EFFICIENCY_METAL if hardware["is_unified"] else EFFICIENCY_CUDA)[quant]
    kv_read_gb = kv_cache_gb * 0.5

    if status == "OOM":
        est_tps = 0.0
    elif status == "Smooth":
        est_tps = (hardware["bandwidth_gbps"] * eff) / (weights_gb + kv_read_gb)
    elif hardware["is_unified"]:
        # Unified memory pressure & swap overhead degrades throughput
        est_tps = ((hardware["bandwidth_gbps"] * eff) / (weights_gb + kv_read_gb)) * 0.55
    else:
        t_gpu = (weights_gb * gpu_fraction + kv_read_gb) / (
            hardware["bandwidth_gbps"] * eff
        )
        t_cpu = (weights_gb * (1.0 - gpu_fraction)) / CPU_OFFLOAD_BW_GBPS
        est_tps = 1.0 / (t_gpu + t_cpu) if (t_gpu + t_cpu) > 0 else 0.0

    return {
        "quant": quant,
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
    }


def kv_gb_per_4k(model: ModelSpec) -> float:
    kv_bytes = 2 * model["num_layers"] * model["num_kv_heads"] * model["head_dim"] * 4096 * 2
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
        if quant == "Q4_K_M":
            return f"Fits 100% in {hardware['backend']} memory ({headroom} GB headroom)."
        if quant in ("Q5_K_M", "Q6_K"):
            return f"Sweet spot: higher fidelity with {headroom} GB headroom."
        if quant == "Q8_0":
            return f"Near-BF16 precision; fits cleanly with {headroom} GB left."
        return f"Unquantized FP16; {headroom} GB headroom remaining."

    if est["status"] == "Partial Offload":
        if hardware["is_unified"]:
            return "Exceeds safe macOS wired ceiling; risks swap thrashing under load."
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

    # Prefer highest quality that remains Smooth (Q8_0 -> Q6_K -> Q5_K_M -> Q4_K_M)
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

    if hardware["is_unified"]:
        ollama_env_cmd = (
            f"OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 "
            f"OLLAMA_NUM_CTX={recommended_ctx} ollama run {model['ollama_tag']}"
        )
    else:
        ollama_env_cmd = (
            f"OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 "
            f"OLLAMA_NUM_CTX={recommended_ctx} ollama run {model['ollama_tag']}"
        )

    oom_prefix = (
        "# Warning: Q4_K_M exceeds usable VRAM; use a smaller model or Q2_K/IQ3_XS\n"
        if default_est["status"] == "OOM"
        else ""
    )

    llama_cli = (
        f"{oom_prefix}llama-cli -hf {model['hf_repo']}:Q4_K_M \\\n"
        f"  -ngl {ngl_flag} -c {recommended_ctx} -fa on --cache-type-k q8_0 --cache-type-v q8_0"
    )
    llama_server = (
        f"{oom_prefix}llama-server -hf {model['hf_repo']}:Q4_K_M \\\n"
        f"  -ngl {ngl_flag} -c {recommended_ctx} -fa on --host 127.0.0.1 --port 8080"
    )

    return {
        "ollama_run": ollama_run,
        "ollama_env_cmd": ollama_env_cmd,
        "llama_cli": llama_cli,
        "llama_server": llama_server,
        "recommended_ctx": recommended_ctx,
        "recommended_ngl": ngl_flag if default_est["status"] != "Smooth" else recommended_ngl,
    }
