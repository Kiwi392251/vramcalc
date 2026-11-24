#!/usr/bin/env python3
"""Synchronize pages_data.json to Physics v3.0 across 141 existing + 24 new guides (165 total).

Also refreshes model/hardware metadata from catalog.py, recomputes quant_table / commands /
max_fit_context_details, eliminates any stale 'Smooth' or single-decimal fake-precision copy,
and guarantees Tight Fit / Slow / PCIe Multi-GPU honesty across prose and FAQs.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))

import catalog  # noqa: E402
import physics  # noqa: E402

PAGES_JSON_PATH = REPO_ROOT / "site" / "src" / "data" / "pages_data.json"

NEW_GUIDE_PAIRS: list[tuple[str, str]] = [
    # Apple M4 16GB base + modern models
    ("qwen3-8b", "apple-m4-16gb"),
    ("qwen3-14b", "apple-m4-16gb"),
    ("gemma-3-12b", "apple-m4-16gb"),
    ("llama-3.1-8b", "apple-m4-16gb"),
    # Apple M4 Pro 48GB + mid/large modern models
    ("qwen3-32b", "apple-m4-pro-48gb"),
    ("gemma-3-27b", "apple-m4-pro-48gb"),
    ("qwen3-30b-a3b", "apple-m4-pro-48gb"),
    # Apple M4 Max 128GB + flagship Qwen3/Gemma3
    ("qwen3-32b", "apple-m4-max-128gb"),
    ("gemma-3-27b", "apple-m4-max-128gb"),
    # Cloud & Enterprise NVIDIA GPUs (A10, A10G, L4, T4)
    ("gemma-3-27b", "nvidia-a10-24gb"),
    ("qwen3-32b", "nvidia-a10-24gb"),
    ("qwen3-14b", "nvidia-a10-24gb"),
    ("qwen3-30b-a3b", "nvidia-a10-24gb"),
    ("gemma-3-27b", "nvidia-a10g-24gb"),
    ("qwen3-32b", "nvidia-a10g-24gb"),
    ("llama-3.1-8b", "nvidia-t4-16gb"),
    ("qwen3-8b", "nvidia-t4-16gb"),
    ("qwen3-14b", "nvidia-t4-16gb"),
    ("gemma-3-27b", "nvidia-l4-24gb"),
    ("qwen3-14b", "nvidia-l4-24gb"),
    # Flagship RTX Desktop GPUs with Qwen3 & Gemma 3
    ("gemma-3-27b", "rtx-4090-24gb"),
    ("qwen3-32b", "rtx-4090-24gb"),
    ("qwen3-32b", "rtx-5090-32gb"),
    ("gemma-3-27b", "rtx-5090-32gb"),
    # Qwen3.8-27B (Hybrid DeltaNet + GQA) pairings (+8 -> 173 guides)
    ("qwen3.8-27b", "nvidia-a10-24gb"),
    ("qwen3.8-27b", "nvidia-a10g-24gb"),
    ("qwen3.8-27b", "nvidia-l4-24gb"),
    ("qwen3.8-27b", "rtx-4090-24gb"),
    ("qwen3.8-27b", "rtx-5090-32gb"),
    ("qwen3.8-27b", "apple-m4-16gb"),
    ("qwen3.8-27b", "apple-m4-pro-48gb"),
    ("qwen3.8-27b", "apple-m4-max-128gb"),
]


def _fmt_ctx(tokens: int) -> str:
    return physics.format_context_label(tokens) if tokens > 0 else "0K"


def _alt_format_summary(m: catalog.ModelSpec, h: catalog.HardwareSpec, usable: float) -> str:
    awq = physics.estimate_run(m, h, quant="AWQ_4BIT", context_tokens=8192, format="AWQ")
    mlx = physics.estimate_run(m, h, quant="MLX_4BIT", context_tokens=8192, format="MLX")
    if h["is_unified"] and h["vendor"] == "Apple":
        mlx_tps = physics.format_tps_range(mlx["est_tps_low"], mlx["est_tps_high"], mlx["est_tps"], mlx["status"])
        return (
            f"Under Apple MLX 4-bit (mlx-lm), {m['short_name']} uses {mlx['total_vram_gb']:.2f} GB "
            f"of your {usable:.1f} GB realistic Desktop unified pool ({mlx['status']}; {mlx_tps})."
        )
    awq_tps = physics.format_tps_range(awq["est_tps_low"], awq["est_tps_high"], awq["est_tps"], awq["status"])
    return (
        f"Under vLLM AWQ 4-bit, {m['short_name']} requires {awq['total_vram_gb']:.2f} GB at 8K context "
        f"(vs {usable:.1f} GB usable — {awq['status']}, est. {awq_tps})."
    )


def generate_entry_copy(
    m: catalog.ModelSpec,
    h: catalog.HardwareSpec,
    res: physics.RunEstimate,
    max_fit_ctx: int,
    max_fit_vram: float,
    max_fit_status: physics.CompatStatus,
    kv_4k: float,
    quant_table: list[physics.QuantRow],
) -> dict[str, object]:
    st = res["status"]
    tier = res["speed_tier"]
    usable = res["effective_usable_vram_gb"]
    headroom = res["headroom_gb"]
    tps_range = physics.format_tps_range(res["est_tps_low"], res["est_tps_high"], res["est_tps"], st)
    total_gb = res["total_vram_gb"]
    weights_gb = res["weights_gb"]
    kv_8k = res["kv_cache_gb"]
    max_ctx_str = _fmt_ctx(max_fit_ctx)
    alt_summary = _alt_format_summary(m, h, usable)

    is_mac = h["is_unified"] and h["vendor"] == "Apple"
    is_dc = h["category"] == "Data Center"
    is_multi = h["gpu_count"] > 1

    # 1. Title & Meta Description (formula-honest, range-based, status-exact)
    title = f"Can {h['short_name']} Run {m['short_name']}? VRAM, Speed & CLI Guide"
    if st == "Fits":
        meta_desc = (
            f"Fits ({tier}): {m['name']} Q4_K_M uses {total_gb:.2f} GB at 8K context on {h['name']} "
            f"({usable:.1f} GB usable, {headroom:.1f} GB headroom, est. {tps_range}). Includes GGUF, AWQ, MLX & CLI."
        )
    elif st == "Tight Fit":
        meta_desc = (
            f"Tight Fit ({tier}): {m['name']} Q4_K_M reaches {total_gb:.2f} GB vs {usable:.1f} GB usable on {h['name']} "
            f"(only {headroom:.2f} GB free, est. {tps_range}). Reduce KV precision or context to prevent offload."
        )
    elif st == "Partial Offload":
        meta_desc = (
            f"Partial Offload ({tier}): {m['name']} Q4_K_M needs {total_gb:.2f} GB on {h['name']} ({usable:.1f} GB usable). "
            f"{res['gpu_layers_fit']}/{res['total_layers']} layers stay in VRAM (~{tps_range} host-RAM limited)."
        )
    else:
        meta_desc = (
            f"OOM on {h['short_name']}: {m['name']} Q4_K_M requires {total_gb:.2f} GB at 8K context vs {usable:.1f} GB usable. "
            f"See offload thresholds, AWQ/GGUF sizes, and recommended GPUs."
        )

    # 2. Verdict Summary (honest distinction between VRAM fit and Speed Tier)
    if st == "Fits":
        tier_caveat = (
            f"Decode stays {tier.lower()} at an estimated {tps_range}, so generating multi-thousand-token chains requires patience."
            if tier == "Slow"
            else f"Formula throughput sits in the {tier} band (est. {tps_range}) driven by {h['bandwidth_gbps']:g} GB/s memory bandwidth."
        )
        verdict_summary = (
            f"{h['name']} fits {m['name']} cleanly at Q4_K_M with {headroom:.2f} GB headroom at 8K context "
            f"({total_gb:.2f} / {usable:.1f} GB usable; max {max_ctx_str} context @ {max_fit_vram:.2f} GB). {tier_caveat}"
        )
    elif st == "Tight Fit":
        verdict_summary = (
            f"{h['name']} barely clears {m['name']} Q4_K_M at 8K context ({total_gb:.2f} / {usable:.1f} GB usable), leaving just "
            f"{headroom:.2f} GB before spilling. Enable q8_0 KV cache or stay under {max_ctx_str} to avoid silent CPU/RAM offload; "
            f"estimated speed is {tps_range} ({tier})."
        )
    elif st == "Partial Offload":
        verdict_summary = (
            f"{m['name']} Q4_K_M ({total_gb:.2f} GB @ 8K) overflows {h['name']}'s {usable:.1f} GB usable budget, placing "
            f"{res['gpu_layers_fit']} of {res['total_layers']} layers on GPU and spilling the rest over PCIe to system RAM "
            f"(formula estimate: {tps_range}, {tier})."
        )
    else:
        verdict_summary = (
            f"{m['name']} Q4_K_M ({total_gb:.2f} GB @ 8K) exceeds {h['name']}'s {usable:.1f} GB usable memory. "
            f"{'Unified memory Macs cannot stably spill large weights once wired limits saturate.' if h['is_unified'] else 'At least 64 GB host RAM or a higher-VRAM multi-GPU rig is required to avoid severe swapping.'}"
        )

    # 3. Context & Bottleneck Analysis
    multi_note = ""
    if is_multi and not h.get("has_nvlink", False):
        tp_est = physics.estimate_rig_run(m, h, gpu_count=h["gpu_count"], quant="Q4_K_M", context_tokens=8192, split_mode="tensor")
        multi_note = (
            f" Because {h['short_name']} links cards over PCIe without NVLink, Tensor Parallelism adds ~{tp_est['comm_overhead_pct']:.0f}% "
            f"All-Reduce synchronization overhead per token across {m['num_layers']} layers—prefer Layer Split (-sm layer) for single-stream speed."
        )
    elif is_mac:
        multi_note = (
            f" Desktop macOS reserve assumes ~{h['vram_gb'] - usable:.1f} GB stays wired for WindowServer, browsers, and IDEs; "
            f"switching to the Clean OS reserve profile recovers extra GB when closing heavy desktop apps."
        )

    bottleneck_summary = (
        f"{m['short_name']} Q4_K_M weights occupy {weights_gb:.2f} GB plus {res['overhead_gb']:.2f} GB runtime scratchpad, "
        f"and FP16 KV cache grows by +{kv_4k:.2f} GB per 4K tokens ({kv_8k:.2f} GB @ 8K). "
        f"With {usable:.1f} GB usable budget on {h['short_name']}, max resident context reaches {max_ctx_str} "
        f"({max_fit_vram:.2f} GB total, {max_fit_status}).{multi_note}"
    )

    q8_row = next((r for r in quant_table if r["quant"] == "Q8_0"), quant_table[0])
    key_points = [
        f"Q4_K_M @ 8K requires {total_gb:.2f} GB total ({weights_gb:.2f} GB weights + {kv_8k:.2f} GB FP16 KV + {res['overhead_gb']:.2f} GB runtime buffer).",
        f"Max fit context on Q4_K_M reaches {max_ctx_str} ({max_fit_vram:.2f} GB total footprint, status: {max_fit_status})." if max_fit_ctx > 0 else "Even at 4K context, Q4_K_M exceeds usable device memory without host-RAM offloading or heavier quantization.",
        f"Higher precision Q8_0 requires {q8_row['total_vram_8k_gb']:.2f} GB @ 8K ({q8_row['status']}, est. {physics.format_tps_range(q8_row['est_tps_low'], q8_row['est_tps_high'], q8_row['est_tps'], q8_row['status'])}).",
        alt_summary,
    ]

    optimization_tips = [
        "Set FlashAttention (-fa on) and 8-bit KV cache (-ctk q8_0 -ctv q8_0) to nearly halve KV memory growth per 4K tokens.",
        (
            "Keep split mode on Layer Split (-sm layer) rather than Tensor Parallel on PCIe multi-GPU rigs to avoid 2x per-layer All-Reduce stalls."
            if is_multi and not h.get("has_nvlink", False)
            else (
                "Prefer mlx-lm 4-bit weights on Apple Silicon for native Metal kernel throughput, or toggle Clean OS reserve before running larger quants."
                if is_mac
                else (
                    "Deploy with vLLM AWQ 4-bit Marlin kernels in headless Linux containers to maximize cloud VRAM headroom and concurrency."
                    if is_dc
                    else "Use the Desktop vs Clean OS reserve selector above to verify safe headroom if your display or IDE shares GPU memory."
                )
            )
        ),
        (
            "Tight margin (<5% usable): trim context to 4K or enable Q8_0 KV cache before loading large system prompts."
            if st == "Tight Fit"
            else "Remember all tok/s numbers are formula estimate ranges (~±15–25%); check Community Reference Anchors where available."
        ),
    ]

    faq = [
        {
            "question": f"Does {m['short_name']} fit cleanly in {h['short_name']} VRAM?",
            "answer": (
                f"{m['name']} at Q4_K_M (8K context) needs {total_gb:.2f} GB vs {usable:.1f} GB usable on {h['name']}. "
                f"Status is {st}"
                + (
                    f" with {headroom:.2f} GB spare headroom (max {max_ctx_str} @ {max_fit_vram:.2f} GB)."
                    if st in ("Fits", "Tight Fit")
                    else f" ({res['gpu_layers_fit']}/{res['total_layers']} layers fit on GPU)."
                )
            ),
        },
        {
            "question": f"What token generation speed can I expect for {m['short_name']} on {h['short_name']}?",
            "answer": (
                f"Our bandwidth physics formula estimates {tps_range} ({tier}) for batch=1 decoding"
                + (" — note that PCIe host-RAM transfers govern offloaded layers." if st == "Partial Offload" else " at 8K context.")
                + " Treat this as a ±15–20% planning range rather than a universal benchmark."
            ),
        },
        {
            "question": f"Can I run {m['short_name']} with AWQ (vLLM) or Apple MLX instead of GGUF?",
            "answer": alt_summary,
        },
        {
            "question": f"How much context window fits safely without swapping on {h['short_name']}?",
            "answer": (
                f"With FP16 KV cache growing at +{kv_4k:.2f} GB per 4K tokens, Q4_K_M clears up to {max_ctx_str} "
                f"({max_fit_vram:.2f} GB total footprint)."
                if max_fit_ctx > 0
                else f"At {total_gb:.2f} GB @ 8K, Q4_K_M already exceeds {usable:.1f} GB usable memory; reduce layers on GPU, quantize KV to Q8_0, or use a smaller parameter class."
            ),
        },
    ]

    return {
        "title": title,
        "meta_description": meta_desc,
        "verdict_summary": verdict_summary,
        "context_analysis": {
            "kv_gb_per_4k": kv_4k,
            "max_smooth_context_q4": max_fit_ctx,
            "bottleneck_summary": bottleneck_summary,
            "key_points": key_points,
            "optimization_tips": optimization_tips,
        },
        "faq": faq,
    }


def _needs_copy_refresh(existing_entry: dict, new_status: str, new_tier: str) -> bool:
    """Detect if preserved copy has stale v2 claims ('Smooth', decimal tok/s, Tight Fit/Slow contradiction)."""
    blob = " ".join(
        [
            str(existing_entry.get("meta_description", "")),
            str(existing_entry.get("verdict_summary", "")),
            str(existing_entry.get("context_analysis", {}).get("bottleneck_summary", "")),
            " ".join(f["answer"] for f in existing_entry.get("faq", [])),
        ]
    )
    if "Smooth" in blob or "smooth" in blob:
        return True
    if new_status == "Tight Fit" or new_tier == "Slow":
        return True
    # Old decimal speed estimates (e.g. "37.6 tok/s", "9.7 tok/s", "4.0 t/s")
    import re

    if re.search(r"\b\d+\.\d+\s*(tok/s|tokens/sec|t/s)\b", blob):
        return True
    return False


def main() -> None:
    models_by_id = {m["id"]: m for m in catalog.MODELS}
    hw_by_id = {h["id"]: h for h in catalog.HARDWARE}

    existing_pages: list[dict] = json.loads(PAGES_JSON_PATH.read_text(encoding="utf-8"))
    by_slug: dict[str, dict] = {e["slug"]: e for e in existing_pages}

    refreshed_copy_count = 0
    for e in existing_pages:
        mid = e["model"]["id"]
        hid = e["hardware"]["id"]
        m = models_by_id[mid]
        h = hw_by_id[hid]
        dq: physics.QuantKey = e.get("default_quant", "Q4_K_M")
        dc: int = int(e.get("default_context", 8192))

        res = physics.estimate_run(m, h, quant=dq, context_tokens=dc, reserve_profile="desktop")
        q_table = physics.build_quant_table(m, h, default_quant=dq, reserve_profile="desktop")
        cmds = physics.build_commands(m, h, res)
        max_ctx, max_vram, max_st = physics.max_fit_context_details(m, h, quant=dq, reserve_profile="desktop")
        kv_4k = physics.kv_gb_per_4k(m)

        old_status = e.get("default_result", {}).get("status")
        e["updated_at"] = catalog.CATALOG_UPDATED_AT
        e["model"] = m
        e["hardware"] = h
        e["default_result"] = res
        e["quant_table"] = q_table
        e["commands"] = cmds
        e["max_fit_context"] = max_ctx
        e["max_fit_total_vram_gb"] = max_vram
        e["max_fit_status"] = max_st

        if old_status != res["status"] or _needs_copy_refresh(e, res["status"], res["speed_tier"]):
            fresh = generate_entry_copy(m, h, res, max_ctx, max_vram, max_st, kv_4k, q_table)
            e.update(fresh)
            refreshed_copy_count += 1
        else:
            e["context_analysis"]["kv_gb_per_4k"] = kv_4k
            e["context_analysis"]["max_smooth_context_q4"] = max_ctx

    added_count = 0
    for mid, hid in NEW_GUIDE_PAIRS:
        slug = f"{mid}-on-{hid}"
        if slug in by_slug:
            continue
        m = models_by_id[mid]
        h = hw_by_id[hid]
        dq = "Q4_K_M"
        dc = 8192
        res = physics.estimate_run(m, h, quant=dq, context_tokens=dc, reserve_profile="desktop")
        q_table = physics.build_quant_table(m, h, default_quant=dq, reserve_profile="desktop")
        cmds = physics.build_commands(m, h, res)
        max_ctx, max_vram, max_st = physics.max_fit_context_details(m, h, quant=dq, reserve_profile="desktop")
        kv_4k = physics.kv_gb_per_4k(m)

        copy_fields = generate_entry_copy(m, h, res, max_ctx, max_vram, max_st, kv_4k, q_table)
        new_entry = {
            "slug": slug,
            "title": copy_fields["title"],
            "meta_description": copy_fields["meta_description"],
            "updated_at": catalog.CATALOG_UPDATED_AT,
            "model": m,
            "hardware": h,
            "default_quant": dq,
            "default_context": dc,
            "default_result": res,
            "verdict_summary": copy_fields["verdict_summary"],
            "quant_table": q_table,
            "commands": cmds,
            "context_analysis": copy_fields["context_analysis"],
            "max_fit_context": max_ctx,
            "max_fit_total_vram_gb": max_vram,
            "max_fit_status": max_st,
            "faq": copy_fields["faq"],
            "related_slugs": [],
        }
        existing_pages.append(new_entry)
        by_slug[slug] = new_entry
        added_count += 1

    # Recompute related_slugs across all 165 entries
    by_hw: dict[str, list[dict]] = {}
    by_mod: dict[str, list[dict]] = {}
    for e in existing_pages:
        by_hw.setdefault(e["hardware"]["id"], []).append(e)
        by_mod.setdefault(e["model"]["id"], []).append(e)

    for e in existing_pages:
        slug = e["slug"]
        mid = e["model"]["id"]
        hid = e["hardware"]["id"]
        hw_vram = e["hardware"]["usable_vram_gb"]
        same_hw = sorted(
            [x for x in by_hw[hid] if x["slug"] != slug],
            key=lambda x: (-x["model"]["release_year"], abs(x["model"]["params_b"] - e["model"]["params_b"])),
        )
        same_mod = sorted(
            [x for x in by_mod[mid] if x["slug"] != slug],
            key=lambda x: (abs(x["hardware"]["usable_vram_gb"] - hw_vram), -x["default_result"]["est_tps"]),
        )
        picks: list[str] = []
        for cand in same_hw[:3] + same_mod[:3]:
            if cand["slug"] not in picks:
                picks.append(cand["slug"])
        for cand in same_mod + same_hw:
            if len(picks) >= 6:
                break
            if cand["slug"] not in picks:
                picks.append(cand["slug"])
        e["related_slugs"] = picks[:6]

    PAGES_JSON_PATH.write_text(json.dumps(existing_pages, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    statuses: dict[str, int] = {}
    tiers: dict[str, int] = {}
    for e in existing_pages:
        statuses[e["default_result"]["status"]] = statuses.get(e["default_result"]["status"], 0) + 1
        tiers[e["default_result"]["speed_tier"]] = tiers.get(e["default_result"]["speed_tier"], 0) + 1
    print(f"Synced pages_data.json: {len(existing_pages)} entries (+{added_count} added, {refreshed_copy_count} prose refreshed)")
    print("Statuses:", statuses)
    print("Speed tiers:", tiers)


if __name__ == "__main__":
    main()
