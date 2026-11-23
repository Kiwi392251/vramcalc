#!/usr/bin/env python3
"""pSEO data generation pipeline for vramcalc.me.

Supports:
- Standard OpenAI SDK (AsyncOpenAI) with custom BASE_URL, API_KEY, MODEL_NAME
- Resumable checkpointing into site/src/data/pages_data.json (atomic writes)
- Async concurrency control + RPM token pacing + exponential backoff retries
- Deterministic physics calculations merged with LLM-authored technical insights
- Built-in `--seed-samples` mode to emit 5 verified starter entries immediately
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
DEFAULT_OUTPUT_PATH = REPO_ROOT / "site" / "src" / "data" / "pages_data.json"

sys.path.insert(0, str(SCRIPT_DIR))

from catalog import (  # noqa: E402
    HARDWARE,
    HARDWARE_BY_ID,
    MODELS,
    MODELS_BY_ID,
    HardwareSpec,
    ModelSpec,
    make_slug,
)
from physics import (  # noqa: E402
    build_commands,
    build_quant_table,
    estimate_run,
    kv_gb_per_4k,
    max_smooth_context,
)


def load_env_files() -> None:
    """Load .env files via python-dotenv if installed, otherwise lightweight parser."""
    env_candidates = [SCRIPT_DIR / ".env", REPO_ROOT / ".env"]
    try:
        from dotenv import load_dotenv  # type: ignore

        for candidate in env_candidates:
            if candidate.exists():
                load_dotenv(candidate, override=False)
        return
    except ImportError:
        pass

    for candidate in env_candidates:
        if not candidate.exists():
            continue
        for raw_line in candidate.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


class AsyncRateLimiter:
    """Smooth minimum-interval RPM pacer across async workers."""

    def __init__(self, rpm: float) -> None:
        self.rpm = max(1.0, rpm)
        self.min_interval = 60.0 / self.rpm
        self._lock = asyncio.Lock()
        self._next_ready = 0.0

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            if now < self._next_ready:
                wait_for = self._next_ready - now
                self._next_ready += self.min_interval
            else:
                wait_for = 0.0
                self._next_ready = now + self.min_interval
        if wait_for > 0:
            await asyncio.sleep(wait_for)


def compute_related_slugs(
    model: ModelSpec, hardware: HardwareSpec, candidate_slugs: set[str] | None = None
) -> list[str]:
    """Build deterministic related slugs prioritizing same model / same hardware."""
    slugs: list[str] = []
    for hw in HARDWARE:
        if hw["id"] != hardware["id"]:
            s = make_slug(model["id"], hw["id"])
            if candidate_slugs is None or s in candidate_slugs:
                slugs.append(s)
        if len(slugs) >= 3:
            break

    for m in MODELS:
        if m["id"] != model["id"]:
            s = make_slug(m["id"], hardware["id"])
            if (candidate_slugs is None or s in candidate_slugs) and s not in slugs:
                slugs.append(s)
        if len(slugs) >= 6:
            break

    return slugs[:6]


SEED_EDITORIAL: dict[str, dict[str, Any]] = {
    "deepseek-r1-32b-on-rtx-4090-24gb": {
        "verdict_summary": (
            "DeepSeek-R1-Distill-Qwen-32B at Q4_K_M (19.88 GB weights) fits inside the RTX 4090's "
            "23.5 GB usable GDDR6X budget at 8K context (22.88 GB total), hitting ~37.6 tok/s with zero CPU spill."
        ),
        "context_analysis": {
            "bottleneck_summary": (
                "At Q4_K_M with 8K FP16 context, weights (19.88 GB), KV cache (2.00 GB), and the 0.99 GB CUDA "
                "workspace buffer consume 22.88 GB, leaving just 0.62 GB of headroom before hitting 23.5 GB. "
                "Because DeepSeek-R1 32B's 64 layers consume 1.00 GB per 4K tokens in FP16 KV cache, pushing "
                "context to 16K (4.00 GB KV) immediately overflows 24 GB VRAM unless KV cache quantization is enabled."
            ),
            "key_points": [
                "FP16 KV cache grows at 1.00 GB per 4K tokens (2.00 GB at 8K, 4.00 GB at 16K, 8.00 GB at 32K).",
                "Max Smooth context with default FP16 KV cache is 8,192 tokens; 12K+ spills layers onto system RAM over PCIe.",
                "Enabling --cache-type-k q8_0 --cache-type-v q8_0 cuts KV cache VRAM in half (~0.50 GB per 4K), stretching Q4_K_M cleanly to 16K–24K.",
                "DeepSeek-R1 emits verbose <think> chains before answering, so monitor context length on multi-file prompts.",
            ],
            "optimization_tips": [
                "Pass -fa on --cache-type-k q8_0 --cache-type-v q8_0 in llama.cpp to unlock 16K+ context inside 24 GB VRAM.",
                "Close browser hardware acceleration or desktop GPU monitors if free VRAM dips below 23.0 GB on Windows/Linux.",
                "Stick to Q4_K_M; Q5_K_M (23.37 GB weights alone) overflows 24 GB immediately and drops speed below 6 tok/s.",
            ],
        },
        "faq": [
            {
                "question": "Can an RTX 4090 24GB run DeepSeek-R1 32B without spilling to system RAM?",
                "answer": (
                    "Yes, in Q4_K_M quantization (19.88 GB weights). At 8K context with FP16 KV cache, total VRAM "
                    "usage is 22.88 GB out of 23.5 GB usable GDDR6X, keeping all 64 transformer layers on GPU at ~37.6 tok/s."
                ),
            },
            {
                "question": "What happens if I try Q5_K_M or Q6_K of DeepSeek-R1 32B on the RTX 4090?",
                "answer": (
                    "Q5_K_M weights alone require 23.37 GB (26.36 GB total at 8K), forcing ~10 layers onto system RAM "
                    "over PCIe and cutting throughput down to ~5–6 tok/s."
                ),
            },
            {
                "question": "How can I reach 16K+ context on RTX 4090 for long DeepSeek-R1 thinking blocks?",
                "answer": (
                    "Set OLLAMA_FLASH_ATTENTION=1 and OLLAMA_KV_CACHE_TYPE=q8_0 (or -fa on --cache-type-k q8_0 "
                    "--cache-type-v q8_0 in llama.cpp). Cutting KV memory in half keeps 16K context inside 23.5 GB."
                ),
            },
            {
                "question": "Is RTX 4090 faster than an Apple M4 Pro 48GB for DeepSeek-R1 32B?",
                "answer": (
                    "Yes for decode speed: the RTX 4090's 1,008 GB/s GDDR6X bus achieves ~37.6 tok/s in Q4_K_M, "
                    "nearly 4x faster than M4 Pro (273 GB/s, ~9.7 tok/s), though M4 Pro can hold 64K context smoothly."
                ),
            },
        ],
    },
    "deepseek-r1-32b-on-apple-m4-pro-48gb": {
        "verdict_summary": (
            "Apple M4 Pro with 48GB unified memory smoothly runs DeepSeek-R1-Distill-Qwen-32B up to Q6_K "
            "at 8K context, delivering ~9.7 tok/s at Q4_K_M and scaling cleanly all the way to 64K context."
        ),
        "context_analysis": {
            "bottleneck_summary": (
                "Unlike 24 GB discrete GPUs, the 48 GB M4 Pro (37.4 GB macOS Metal wired budget by default) "
                "has plenty of headroom at Q4_K_M: 19.88 GB weights plus 0.99 GB runtime buffer leave 16.53 GB "
                "for KV cache—enough for a full 64K FP16 context (16.00 GB KV) without overflowing. The real "
                "limiter is the 273 GB/s unified memory bandwidth, capping speed around ~9.7 tok/s at Q4_K_M."
            ),
            "key_points": [
                "DeepSeek-R1 32B Q4_K_M reaches 64K context (16.00 GB FP16 KV cache) at 36.87 GB total, inside the 37.4 GB wired ceiling.",
                "Q6_K (27.06 GB weights, 30.05 GB total at 8K) runs smoothly at ~7.3 tok/s with room up to 32K context using Q8_0 KV.",
                "Q8_0 (34.85 GB weights, 37.84 GB total at 8K) slightly exceeds the default 37.4 GB wired limit, risking swap pressure (~3.2 tok/s).",
                "Prompt prefill on 32K+ codebases takes longer than NVIDIA Tensor Cores, though Metal Flash Attention helps.",
            ],
            "optimization_tips": [
                "Choose Q6_K for coding/math fidelity (~7.3 tok/s) or Q4_K_M for ~9.7 tok/s reading speed and 64K context.",
                "Enable OLLAMA_FLASH_ATTENTION=1 and OLLAMA_KV_CACHE_TYPE=q8_0 to halve the 1.00 GB per 4K KV growth.",
                "Raise sysctl iogpu.wired_limit_mb=40960 only when experimenting with Q8_0 at 8K–16K context.",
            ],
        },
        "faq": [
            {
                "question": "How fast does DeepSeek-R1 32B run on a MacBook Pro M4 Pro 48GB?",
                "answer": (
                    "At Q4_K_M with 8K context, expect roughly 9.7 tokens/sec driven by the M4 Pro's 273 GB/s "
                    "LPDDR5X memory bandwidth—comfortable reading speed even during long reasoning chains."
                ),
            },
            {
                "question": "Should I run Q4_K_M, Q6_K, or Q8_0 on M4 Pro 48GB?",
                "answer": (
                    "Pick Q4_K_M when speed and 32K–64K context matter most (~9.7 tok/s), or Q6_K (~7.3 tok/s) "
                    "for higher precision at 8K–16K. Avoid Q8_0 unless you raise macOS's default wired GPU limit."
                ),
            },
            {
                "question": "Can M4 Pro 48GB handle 64K context on DeepSeek-R1 32B?",
                "answer": (
                    "Yes. At Q4_K_M, a full 64K FP16 KV cache adds 16.00 GB for a 36.87 GB total footprint, "
                    "fitting just under macOS's default 37.4 GB wired GPU ceiling."
                ),
            },
            {
                "question": "Why does macOS reserve ~10.6 GB out of 48 GB unified memory?",
                "answer": (
                    "By default macOS caps GPU wired allocations around 75–78% of system RAM so macOS windowing, "
                    "IDEs, and background apps do not starve or trigger kernel panics."
                ),
            },
        ],
    },
    "qwen2.5-coder-32b-on-rtx-5090-32gb": {
        "verdict_summary": (
            "The RTX 5090 (32GB GDDR7, 1,792 GB/s) is an unmatched single-GPU workstation for Qwen2.5-Coder-32B, "
            "running Q4_K_M at ~66.9 tok/s (32K smooth context) or fitting Q6_K entirely in VRAM at ~50.5 tok/s."
        ),
        "context_analysis": {
            "bottleneck_summary": (
                "With 31.5 GB of usable GDDR7 VRAM and a 1,792 GB/s memory bus, Qwen2.5-Coder-32B runs effortlessly "
                "at Q4_K_M (19.88 GB weights), leaving 10.63 GB for KV cache—enough for 32K native FP16 context "
                "(28.87 GB total). Pushing to 64K FP16 context (16.00 GB KV) reaches 36.87 GB and requires Q8_0 KV quantization."
            ),
            "key_points": [
                "Q4_K_M + 32K FP16 KV cache totals 28.87 GB, keeping 100% of layers and context on GDDR7.",
                "Q6_K (27.06 GB weights, 30.05 GB total at 8K) fits smoothly in 32 GB VRAM and streams at ~50.5 tok/s.",
                "1,792 GB/s bandwidth eliminates the memory-wall bottleneck typical of 32B dense coding models.",
                "Q8_0 (34.85 GB weights, 37.84 GB total at 8K) exceeds 32 GB VRAM and spills 11 layers onto PCIe (~5.0 tok/s).",
            ],
            "optimization_tips": [
                "Run Q6_K at 8K–12K for peak coding accuracy (~50.5 tok/s), or Q4_K_M for 32K–64K multi-file diffs.",
                "Enable -fa on --cache-type-k q8_0 --cache-type-v q8_0 to fit a full 64K context at Q4_K_M inside 31.5 GB.",
                "Expose llama-server on localhost:8080 as a fast local OpenAI-compatible backend for Cursor, Cline, or Continue.",
            ],
        },
        "faq": [
            {
                "question": "Can the RTX 5090 32GB run Qwen2.5-Coder-32B in Q8_0?",
                "answer": (
                    "Not without CPU spill. Q8_0 requires 37.84 GB at 8K context, forcing ~11 of 64 layers onto "
                    "system RAM (~5.0 tok/s). Use Q6_K (30.05 GB total) for near-lossless quality fully inside 32 GB GDDR7."
                ),
            },
            {
                "question": "How many tokens per second does Qwen2.5-Coder-32B get on an RTX 5090?",
                "answer": (
                    "Driven by 1,792 GB/s GDDR7 bandwidth, Q4_K_M hits ~66.9 tok/s at 8K context, while Q6_K still "
                    "streams at ~50.5 tok/s—faster than most cloud API responses."
                ),
            },
            {
                "question": "Can I run a 64K context window for multi-file coding on RTX 5090?",
                "answer": (
                    "At native FP16 KV cache, 32K context fits cleanly (28.87 GB total). To reach 64K on Q4_K_M without "
                    "PCIe spill, enable Flash Attention with Q8_0 KV cache quantization (~8 GB KV instead of 16 GB)."
                ),
            },
            {
                "question": "Should developers pick Q4_K_M or Q6_K on RTX 5090 for coding agents?",
                "answer": (
                    "Use Q6_K for architectural reasoning and complex edits under 12K context, and switch to Q4_K_M "
                    "when feeding 32K–64K multi-file diffs or needing ~67 tok/s autocomplete."
                ),
            },
        ],
    },
    "qwen2.5-coder-32b-on-rtx-4060-ti-16gb": {
        "verdict_summary": (
            "Partial Offload only: Qwen2.5-Coder-32B Q4_K_M needs 22.88 GB at 8K context, exceeding the "
            "RTX 4060 Ti's 15.5 GB usable VRAM and forcing ~24 of 64 layers over PCIe (~3.7 tok/s)."
        ),
        "context_analysis": {
            "bottleneck_summary": (
                "The RTX 4060 Ti 16GB sits below the ~20 GB threshold required for 32B Q4_K_M weights. "
                "With 15.5 GB usable VRAM and 2.99 GB consumed by 8K KV cache + CUDA runtime buffers, only "
                "12.51 GB remains for weights (~40 of 64 layers). The remaining 24 layers execute on CPU "
                "and system DDR4/DDR5 RAM, turning the ~35 GB/s host memory bus into the dominant bottleneck."
            ),
            "key_points": [
                "Each 4K of FP16 context consumes 1.00 GB of precious VRAM, directly evicting ~3.2 GPU layers.",
                "Every layer offloaded to system RAM incurs ~8x lower bandwidth (35 GB/s CPU vs 288 GB/s GDDR6).",
                "Q6_K (30.05 GB) drops GPU residency below 50% (~2.1 tok/s), while Q8_0 hits practical OOM.",
                "Make sure your desktop PC has at least 32 GB of dual-channel DDR4/DDR5 RAM before attempting Partial Offload.",
            ],
            "optimization_tips": [
                "Cap context at 4K–8K and enable Q8_0 KV cache (`--cache-type-k q8_0 --cache-type-v q8_0`) so 43+ layers stay on GPU.",
                "Pin `-ngl 40` explicitly in llama.cpp and pass `-t <physical_cores>` (not hyperthreads) for optimal CPU layer speed.",
                "For interactive IDE coding on RTX 4060 Ti 16GB, Qwen2.5-Coder-14B (Q6_K or Q5_K_M) fits 100% in VRAM at 15–20 tok/s.",
            ],
        },
        "faq": [
            {
                "question": "Can an RTX 4060 Ti 16GB run Qwen2.5-Coder-32B at all?",
                "answer": (
                    "Yes, via Partial Offload in Q4_K_M (~40/64 layers on GPU and ~24 layers in system RAM). "
                    "Expect ~3.7 tok/s at 8K context if your host PC has at least 32 GB of dual-channel RAM."
                ),
            },
            {
                "question": "Why is Qwen2.5-Coder-32B slow on the RTX 4060 Ti 16GB?",
                "answer": (
                    "Because ~7.37 GB of weights must be streamed from system RAM across the CPU memory controller "
                    "(~35 GB/s) on every single generated token, overshadowing the 288 GB/s GPU memory."
                ),
            },
            {
                "question": "How many GPU layers (-ngl) should I set for Qwen2.5-Coder-32B on 16GB VRAM?",
                "answer": (
                    "Start with -ngl 40 at 8K context (or -ngl 43 at 4K context with Q8_0 KV cache). If CUDA reports "
                    "an out-of-memory allocation error, step -ngl down by 2 layers until stable."
                ),
            },
            {
                "question": "Is Qwen2.5-Coder-14B better than 32B on an RTX 4060 Ti 16GB?",
                "answer": (
                    "For daily interactive coding, yes: Qwen2.5-Coder-14B Q6_K fits completely in 16 GB VRAM "
                    "with zero CPU offload, generating tokens 4x faster while supporting 16K–32K context."
                ),
            },
        ],
    },
    "llama-3.3-70b-on-rtx-3060-12gb": {
        "verdict_summary": (
            "Out of Memory (OOM): Llama-3.3-70B Q4_K_M needs 46.86 GB at 8K context—over 4x the RTX 3060's "
            "11.5 GB usable VRAM. Only ~13 of 80 layers (17.4%) fit on GPU, making inference impractical."
        ),
        "context_analysis": {
            "bottleneck_summary": (
                "Llama-3.3-70B packs 70.6B parameters across 80 layers, totaling 42.80 GB in Q4_K_M weights alone. "
                "Adding 8K FP16 KV cache (2.50 GB) and runtime overhead (1.56 GB) pushes the total to 46.86 GB. "
                "Subtracting KV cache and runtime buffers leaves just 7.44 GB on an RTX 3060 12GB—barely enough "
                "for 13 of 80 layers (17.4%), forcing over 35 GB of weights onto slow host RAM."
            ),
            "key_points": [
                "Over 35.3 GB of weights must reside in system RAM (requiring 64 GB host RAM to avoid OS disk swap).",
                "CPU-bound execution on 67 offloaded layers drops generation below ~1.5 tok/s even on fast DDR5 systems.",
                "Each 4K of FP16 context consumes 1.25 GB of VRAM, quickly eating the RTX 3060's remaining capacity.",
                "Even extreme 2-bit quants (IQ2_XXS, ~20 GB) still exceed 12 GB VRAM by a wide margin.",
            ],
            "optimization_tips": [
                "Switch to Llama-3.1-8B-Instruct (Q8_0) or DeepSeek-R1-Distill-Qwen-14B (Q4_K_M), which fit inside 12 GB VRAM.",
                "If you must test 70B locally with an RTX 3060, ensure 64 GB system RAM and try IQ2_XS with -ngl 22 for batch runs.",
                "For smooth 70B inference, step up to dual RTX 3090 (48 GB total VRAM) or an Apple Mac Studio with 64 GB+ RAM.",
            ],
        },
        "faq": [
            {
                "question": "Can an RTX 3060 12GB run Llama-3.3-70B?",
                "answer": (
                    "Practically no (OOM for GPU residency). Q4_K_M requires 46.86 GB at 8K context, so only ~17.4% "
                    "(13/80 layers) fits on the RTX 3060, forcing almost all inference onto your CPU and system RAM."
                ),
            },
            {
                "question": "How much system RAM would I need to CPU-offload Llama-3.3-70B alongside an RTX 3060?",
                "answer": (
                    "You need at least 64 GB of dual-channel DDR4/DDR5 system RAM just to hold the remaining 35+ GB of "
                    "weights plus OS overhead without crashing or thrashing an NVMe pagefile."
                ),
            },
            {
                "question": "What is the largest Llama or Qwen model that runs smoothly on an RTX 3060 12GB?",
                "answer": (
                    "14B-class models (like DeepSeek-R1-Distill-Qwen-14B or Qwen2.5-Coder-14B) at Q4_K_M (~10.7 GB "
                    "total at 4K–8K context) fit 100% in 12 GB VRAM and run smoothly around 23–26 tok/s."
                ),
            },
            {
                "question": "What hardware is needed to run Llama-3.3-70B smoothly at 8K+ context?",
                "answer": (
                    "You need over 47 GB of usable GPU/unified memory—for example an Apple M1/M2/M3/M4 Max 64GB, "
                    "or dual 24 GB NVIDIA GPUs (2x RTX 3090 or 2x RTX 4090)."
                ),
            },
        ],
    },
}


def build_deterministic_entry(
    model: ModelSpec,
    hardware: HardwareSpec,
    editorial: dict[str, Any],
    candidate_slugs: set[str] | None = None,
) -> dict[str, Any]:
    slug = make_slug(model["id"], hardware["id"])
    default_est = estimate_run(model, hardware, quant="Q4_K_M", context_tokens=8192)
    quant_table = build_quant_table(model, hardware, context_tokens=8192)
    commands = build_commands(model, hardware, default_est)
    kv_4k = kv_gb_per_4k(model)
    max_ctx = max_smooth_context(model, hardware, "Q4_K_M")

    title = (
        f"Can I Run {model['short_name']} on {hardware['short_name']}? "
        "VRAM & Speed Calculator"
    )
    meta_description = (
        f"{default_est['status']}: {model['name']} Q4_K_M needs {default_est['total_vram_gb']} GB "
        f"at 8K context on {hardware['name']} ({hardware['usable_vram_gb']} GB usable, "
        f"~{default_est['est_tps']} tok/s). Interactive VRAM calculator & CLI commands."
    )

    return {
        "slug": slug,
        "title": title,
        "meta_description": meta_description,
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "model": model,
        "hardware": hardware,
        "default_quant": "Q4_K_M",
        "default_context": 8192,
        "default_result": default_est,
        "verdict_summary": editorial["verdict_summary"],
        "quant_table": quant_table,
        "commands": commands,
        "context_analysis": {
            "kv_gb_per_4k": kv_4k,
            "max_smooth_context_q4": max_ctx,
            "bottleneck_summary": editorial["context_analysis"]["bottleneck_summary"],
            "key_points": editorial["context_analysis"]["key_points"],
            "optimization_tips": editorial["context_analysis"]["optimization_tips"],
        },
        "faq": editorial["faq"],
        "related_slugs": compute_related_slugs(model, hardware, candidate_slugs),
    }


def _extract_json_object(raw_text: str) -> dict[str, Any]:
    text = raw_text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end > start:
            return json.loads(text[start : end + 1])
        raise


def _validate_editorial(payload: dict[str, Any]) -> dict[str, Any]:
    verdict = str(payload.get("verdict_summary", "")).strip()
    ca = payload.get("context_analysis", {})
    faq = payload.get("faq", [])
    if not verdict or not isinstance(ca, dict) or not isinstance(faq, list):
        raise ValueError("Missing required keys in LLM editorial payload")

    bottleneck = str(ca.get("bottleneck_summary", "")).strip()
    key_points = [str(x).strip() for x in ca.get("key_points", []) if str(x).strip()]
    tips = [str(x).strip() for x in ca.get("optimization_tips", []) if str(x).strip()]
    clean_faq = []
    for item in faq:
        if isinstance(item, dict):
            q = str(item.get("question", "")).strip()
            a = str(item.get("answer", "")).strip()
            if q and a:
                clean_faq.append({"question": q, "answer": a})

    if not bottleneck or len(key_points) < 2 or len(tips) < 2 or len(clean_faq) < 3:
        raise ValueError("Insufficient detail in LLM editorial payload")

    return {
        "verdict_summary": verdict,
        "context_analysis": {
            "bottleneck_summary": bottleneck,
            "key_points": key_points[:5],
            "optimization_tips": tips[:4],
        },
        "faq": clean_faq[:5],
    }


def build_llm_prompt(model: ModelSpec, hardware: HardwareSpec) -> str:
    est_q4_8k = estimate_run(model, hardware, "Q4_K_M", 8192)
    est_q4_32k = estimate_run(model, hardware, "Q4_K_M", 32768)
    est_q8_8k = estimate_run(model, hardware, "Q8_0", 8192)
    kv_4k = kv_gb_per_4k(model)
    max_ctx = max_smooth_context(model, hardware, "Q4_K_M")

    facts = {
        "model": {
            "name": model["name"],
            "params_b": model["params_b"],
            "num_layers": model["num_layers"],
            "num_kv_heads": model["num_kv_heads"],
            "head_dim": model["head_dim"],
            "use_cases": model["use_cases"],
        },
        "hardware": {
            "name": hardware["name"],
            "backend": hardware["backend"],
            "vram_gb": hardware["vram_gb"],
            "usable_vram_gb": hardware["usable_vram_gb"],
            "bandwidth_gbps": hardware["bandwidth_gbps"],
            "memory_type": hardware["memory_type"],
            "is_unified": hardware["is_unified"],
        },
        "computed_metrics": {
            "kv_gb_per_4k_fp16": kv_4k,
            "max_smooth_context_q4_k_m": max_ctx,
            "q4_k_m_8k": est_q4_8k,
            "q4_k_m_32k": est_q4_32k,
            "q8_0_8k": est_q8_8k,
        },
    }

    return (
        "Write concise, technically accurate English engineering analysis for a local LLM "
        "hardware compatibility benchmark page. You MUST ONLY cite the exact numbers provided "
        "in the JSON facts below (do not invent other memory sizes or speeds).\n\n"
        f"FACTS:\n{json.dumps(facts, indent=2)}\n\n"
        "Return strictly a valid JSON object with this exact schema:\n"
        "{\n"
        '  "verdict_summary": "1-2 crisp sentences summarizing status, VRAM usage vs budget, and tok/s",\n'
        '  "context_analysis": {\n'
        '    "bottleneck_summary": "2-3 sentences analyzing whether capacity, PCIe offload, KV cache growth, or memory bandwidth is the bottleneck",\n'
        '    "key_points": ["3-4 concise technical bullet points referencing exact GB/tok-s numbers"],\n'
        '    "optimization_tips": ["3 concrete CLI/runtime optimization tips tailored to this exact GPU/Mac & model"]\n'
        "  },\n"
        '  "faq": [\n'
        '    {"question": "Specific user question", "answer": "Direct 2-3 sentence technical answer"},\n'
        '    {"question": "...", "answer": "..."},\n'
        '    {"question": "...", "answer": "..."},\n'
        '    {"question": "...", "answer": "..."}\n'
        "  ]\n"
        "}"
    )


def save_pages_atomic(output_path: Path, entries_by_slug: dict[str, dict[str, Any]]) -> None:
    """Atomically persist pages_data.json in deterministic catalog order."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    ordered_slugs = [make_slug(m["id"], h["id"]) for m in MODELS for h in HARDWARE]
    ordered_set = set(ordered_slugs)
    ordered = [entries_by_slug[s] for s in ordered_slugs if s in entries_by_slug]
    extras = [v for k, v in sorted(entries_by_slug.items()) if k not in ordered_set]
    payload = ordered + extras

    tmp_path = output_path.with_suffix(".json.tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_path, output_path)


def load_existing_pages(output_path: Path) -> dict[str, dict[str, Any]]:
    if not output_path.exists():
        return {}
    raw = output_path.read_text(encoding="utf-8").strip()
    if not raw:
        return {}
    data = json.loads(raw)
    if not isinstance(data, list):
        raise ValueError(f"Expected JSON array in {output_path}")
    return {item["slug"]: item for item in data if isinstance(item, dict) and "slug" in item}


async def generate_with_openai(
    pairs: list[tuple[ModelSpec, HardwareSpec]],
    output_path: Path,
    entries_by_slug: dict[str, dict[str, Any]],
    base_url: str,
    api_key: str,
    model_name: str,
    concurrency: int,
    rpm: float,
    max_retries: int,
) -> tuple[int, int]:
    try:
        from openai import (  # type: ignore
            APIConnectionError,
            APIStatusError,
            APITimeoutError,
            AsyncOpenAI,
            RateLimitError,
        )
    except ImportError as exc:
        raise RuntimeError(
            "Missing `openai` package. Install dependencies via `pip install -r scripts/requirements.txt`."
        ) from exc

    client = AsyncOpenAI(base_url=base_url, api_key=api_key, timeout=60.0)
    semaphore = asyncio.Semaphore(max(1, concurrency))
    rate_limiter = AsyncRateLimiter(rpm=rpm)
    file_lock = asyncio.Lock()

    succeeded = 0
    failed = 0
    total = len(pairs)

    use_json_mode = True

    async def process_pair(idx: int, model: ModelSpec, hardware: HardwareSpec) -> None:
        nonlocal succeeded, failed, use_json_mode
        slug = make_slug(model["id"], hardware["id"])
        prompt = build_llm_prompt(model, hardware)

        async with semaphore:
            last_err: Exception | None = None
            for attempt in range(max_retries + 1):
                try:
                    await rate_limiter.acquire()
                    create_kwargs: dict[str, Any] = {
                        "model": model_name,
                        "temperature": 0.25,
                        "messages": [
                            {
                                "role": "system",
                                "content": (
                                    "You are a senior local-LLM inference engineer writing concise, "
                                    "data-grounded technical documentation. Always reply with valid JSON."
                                ),
                            },
                            {"role": "user", "content": prompt},
                        ],
                    }
                    if use_json_mode:
                        create_kwargs["response_format"] = {"type": "json_object"}
                    response = await client.chat.completions.create(**create_kwargs)
                    content = response.choices[0].message.content or ""
                    editorial = _validate_editorial(_extract_json_object(content))

                    async with file_lock:
                        all_known = set(entries_by_slug.keys()) | {slug}
                        entries_by_slug[slug] = build_deterministic_entry(
                            model, hardware, editorial, candidate_slugs=all_known
                        )
                        save_pages_atomic(output_path, entries_by_slug)
                        succeeded += 1
                        print(f"[{idx}/{total}] OK  {slug} (saved; total={len(entries_by_slug)})")
                    return
                except (
                    RateLimitError,
                    APITimeoutError,
                    APIConnectionError,
                    APIStatusError,
                    json.JSONDecodeError,
                    ValueError,
                ) as err:
                    if (
                        isinstance(err, APIStatusError)
                        and err.status_code == 400
                        and use_json_mode
                        and "response_format" in str(err).lower()
                    ):
                        use_json_mode = False
                        last_err = err
                        continue
                    if isinstance(err, APIStatusError) and err.status_code < 500 and err.status_code != 429:
                        last_err = err
                        break
                    last_err = err
                    if attempt < max_retries:
                        backoff = min(32.0, (2.0**attempt) + random.uniform(0.1, 0.9))
                        print(
                            f"[{idx}/{total}] RETRY {slug} (attempt {attempt + 1}/{max_retries}) "
                            f"after {backoff:.1f}s: {err}"
                        )
                        await asyncio.sleep(backoff)

            async with file_lock:
                failed += 1
            print(f"[{idx}/{total}] FAIL {slug}: {last_err}", file=sys.stderr)

    try:
        tasks = [
            asyncio.create_task(process_pair(i + 1, m, h))
            for i, (m, h) in enumerate(pairs)
        ]
        await asyncio.gather(*tasks)
    finally:
        await client.close()

    return succeeded, failed


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate Model x Hardware pSEO pages_data.json for vramcalc.me"
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_PATH,
        help="Output JSON file path (default: site/src/data/pages_data.json)",
    )
    parser.add_argument("--base-url", default=None, help="OpenAI-compatible BASE_URL")
    parser.add_argument("--api-key", default=None, help="API key (or set API_KEY / OPENAI_API_KEY)")
    parser.add_argument("--model", dest="model_name", default=None, help="LLM model name")
    parser.add_argument("--models", nargs="+", default=None, help="Filter catalog model IDs")
    parser.add_argument("--hardware", nargs="+", default=None, help="Filter catalog hardware IDs")
    parser.add_argument("--limit", type=int, default=0, help="Max new items to generate this run (0 = all)")
    parser.add_argument("--concurrency", type=int, default=None, help="Max concurrent requests")
    parser.add_argument("--rpm", type=float, default=None, help="Requests-per-minute rate limit")
    parser.add_argument("--max-retries", type=int, default=4, help="Retries per failed item")
    parser.add_argument("--overwrite", action="store_true", help="Regenerate slugs already in output JSON")
    parser.add_argument("--dry-run", action="store_true", help="Print pending pairs without calling API")
    parser.add_argument(
        "--seed-samples",
        action="store_true",
        help="Populate the 5 curated starter entries into pages_data.json without calling an API",
    )
    parser.add_argument(
        "--list-catalog",
        action="store_true",
        help="Print all built-in model IDs, hardware IDs, and total combinations",
    )
    return parser.parse_args()


def main() -> int:
    load_env_files()
    args = parse_args()

    if args.list_catalog:
        print(f"Models ({len(MODELS)}):")
        for m in MODELS:
            print(f"  - {m['id']:20s} | {m['name']} ({m['params_b']}B)")
        print(f"\nHardware ({len(HARDWARE)}):")
        for h in HARDWARE:
            print(
                f"  - {h['id']:24s} | {h['name']} ({h['usable_vram_gb']} GB usable, {h['bandwidth_gbps']} GB/s)"
            )
        print(f"\nTotal combinations: {len(MODELS) * len(HARDWARE)}")
        return 0

    output_path: Path = args.output.resolve()
    entries_by_slug = load_existing_pages(output_path)

    if args.seed_samples:
        sample_specs = [
            ("deepseek-r1-32b", "rtx-4090-24gb"),
            ("deepseek-r1-32b", "apple-m4-pro-48gb"),
            ("qwen2.5-coder-32b", "rtx-5090-32gb"),
            ("qwen2.5-coder-32b", "rtx-4060-ti-16gb"),
            ("llama-3.3-70b", "rtx-3060-12gb"),
        ]
        sample_slugs = {make_slug(m_id, h_id) for m_id, h_id in sample_specs}
        known_slugs = set(entries_by_slug.keys()) | sample_slugs
        added = 0
        skipped = 0
        for m_id, h_id in sample_specs:
            slug = make_slug(m_id, h_id)
            if slug in entries_by_slug and not args.overwrite:
                skipped += 1
                continue
            model = MODELS_BY_ID[m_id]
            hardware = HARDWARE_BY_ID[h_id]
            entries_by_slug[slug] = build_deterministic_entry(
                model, hardware, SEED_EDITORIAL[slug], candidate_slugs=known_slugs
            )
            added += 1

        if added > 0:
            save_pages_atomic(output_path, entries_by_slug)
        print(
            f"[seed-samples] added={added}, skipped={skipped}, total={len(entries_by_slug)} -> {output_path}"
        )
        return 0

    selected_models = MODELS
    if args.models:
        unknown = [m for m in args.models if m not in MODELS_BY_ID]
        if unknown:
            print(f"Error: unknown model IDs: {', '.join(unknown)}", file=sys.stderr)
            return 2
        selected_models = [MODELS_BY_ID[m] for m in args.models]

    selected_hardware = HARDWARE
    if args.hardware:
        unknown = [h for h in args.hardware if h not in HARDWARE_BY_ID]
        if unknown:
            print(f"Error: unknown hardware IDs: {', '.join(unknown)}", file=sys.stderr)
            return 2
        selected_hardware = [HARDWARE_BY_ID[h] for h in args.hardware]

    all_pairs = [(m, h) for m in selected_models for h in selected_hardware]
    pending_pairs = [
        (m, h)
        for m, h in all_pairs
        if args.overwrite or make_slug(m["id"], h["id"]) not in entries_by_slug
    ]

    if args.limit and args.limit > 0:
        pending_pairs = pending_pairs[: args.limit]

    print(
        f"Catalog pairs: {len(all_pairs)} | Existing: {len(entries_by_slug)} | Pending this run: {len(pending_pairs)}"
    )

    if not pending_pairs:
        print("Nothing to generate; all selected combinations already exist.")
        return 0

    if args.dry_run:
        for m, h in pending_pairs[:20]:
            print(f"  [dry-run] {make_slug(m['id'], h['id'])}")
        if len(pending_pairs) > 20:
            print(f"  ... and {len(pending_pairs) - 20} more")
        return 0

    base_url = (
        args.base_url
        or os.getenv("BASE_URL")
        or os.getenv("OPENAI_BASE_URL")
        or "https://api.openai.com/v1"
    )
    api_key = args.api_key or os.getenv("API_KEY") or os.getenv("OPENAI_API_KEY") or ""
    model_name = (
        args.model_name
        or os.getenv("MODEL_NAME")
        or os.getenv("OPENAI_MODEL")
        or "gpt-4o-mini"
    )
    concurrency = args.concurrency or int(os.getenv("CONCURRENCY", "5"))
    rpm = args.rpm or float(os.getenv("RPM", "30"))

    if not api_key:
        print(
            "Error: API_KEY (or OPENAI_API_KEY / --api-key) is required for generation.\n"
            "Tip: copy scripts/.env.example to scripts/.env, or run with --seed-samples for local sample data.",
            file=sys.stderr,
        )
        return 1

    print(
        f"Starting generation via {base_url} (model={model_name}, concurrency={concurrency}, rpm={rpm})..."
    )
    succeeded, failed = asyncio.run(
        generate_with_openai(
            pairs=pending_pairs,
            output_path=output_path,
            entries_by_slug=entries_by_slug,
            base_url=base_url,
            api_key=api_key,
            model_name=model_name,
            concurrency=concurrency,
            rpm=rpm,
            max_retries=args.max_retries,
        )
    )
    print(f"Finished: succeeded={succeeded}, failed={failed}, total_pages={len(entries_by_slug)}")
    return 1 if failed > 0 and succeeded == 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
