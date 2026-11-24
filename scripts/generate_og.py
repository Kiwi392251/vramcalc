"""Generate 200 optimized 1200x630 Open Graph PNG preview cards for vramcalc.me."""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "site" / "src" / "data" / "pages_data.json"
OUT_DIR = ROOT / "site" / "public" / "og"
SCRIPTS_DIR = ROOT / "scripts"

sys.path.insert(0, str(SCRIPTS_DIR))
import catalog  # noqa: E402
import physics  # noqa: E402

WIDTH = 1200
HEIGHT = 630


def _load_font(paths_and_indices: list[tuple[str, int]], size: int) -> ImageFont.FreeTypeFont:
    for path_str, idx in paths_and_indices:
        p = Path(path_str)
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size=size, index=idx)
            except Exception:
                continue
    return ImageFont.load_default()


SANS_REG_CANDIDATES = [
    ("/System/Library/Fonts/HelveticaNeue.ttc", 0),
    ("/System/Library/Fonts/Helvetica.ttc", 0),
    ("/System/Library/Fonts/Supplemental/Arial.ttf", 0),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 0),
]
SANS_BOLD_CANDIDATES = [
    ("/System/Library/Fonts/HelveticaNeue.ttc", 1),
    ("/System/Library/Fonts/Helvetica.ttc", 1),
    ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 0),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 0),
]
MONO_BOLD_CANDIDATES = [
    ("/System/Library/Fonts/Menlo.ttc", 1),
    ("/System/Library/Fonts/Supplemental/Courier New Bold.ttf", 0),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 0),
]
MONO_REG_CANDIDATES = [
    ("/System/Library/Fonts/Menlo.ttc", 0),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 0),
]

PALETTES: dict[str, dict[str, tuple[int, int, int]]] = {
    "Fits": {
        "accent": (16, 185, 129),      # #10b981
        "badge_bg": (6, 78, 59),       # #064e3b
        "badge_text": (167, 243, 208), # #a7f3d0
        "kpi_val": (52, 211, 153),     # #34d399
    },
    "Tight Fit": {
        "accent": (249, 115, 22),      # #f97316
        "badge_bg": (67, 20, 7),       # #431407
        "badge_text": (254, 215, 170), # #fed7aa
        "kpi_val": (251, 146, 60),     # #fb923c
    },
    "Partial Offload": {
        "accent": (245, 158, 11),      # #f59e0b
        "badge_bg": (69, 26, 3),       # #451a03
        "badge_text": (253, 230, 138), # #fde68a
        "kpi_val": (251, 191, 36),     # #fbbf24
    },
    "OOM": {
        "accent": (244, 63, 94),       # #f43f5e
        "badge_bg": (76, 5, 25),       # #4c0519
        "badge_text": (254, 205, 211), # #fecdd3
        "kpi_val": (251, 113, 133),    # #fb7185
    },
    "Blue": {
        "accent": (59, 130, 246),      # #3b82f6
        "badge_bg": (23, 37, 84),      # #172554
        "badge_text": (191, 219, 254), # #bfdbfe
        "kpi_val": (96, 165, 250),     # #60a5fa
    },
}


def wrap_lines(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont,
    max_width: int,
    max_lines: int = 2,
) -> list[str]:
    words = text.split()
    lines: list[str] = []
    cur = ""
    for w in words:
        candidate = f"{cur} {w}".strip()
        if draw.textlength(candidate, font=font) <= max_width:
            cur = candidate
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    if len(lines) <= max_lines:
        return lines
    trimmed = lines[:max_lines]
    last = trimmed[-1]
    while len(last) > 4 and draw.textlength(last + "...", font=font) > max_width:
        last = last[:-1].rstrip()
    trimmed[-1] = last + "..."
    return trimmed


def fit_headline(
    draw: ImageDraw.ImageDraw, text: str, max_width: int, sizes: tuple[int, ...] = (46, 40, 35, 31)
) -> tuple[ImageFont.FreeTypeFont, list[str]]:
    for sz in sizes:
        f = _load_font(SANS_BOLD_CANDIDATES, sz)
        words = text.split()
        # Check single/two-line natural wrap without truncation
        lines: list[str] = []
        cur = ""
        for w in words:
            cand = f"{cur} {w}".strip()
            if draw.textlength(cand, font=f) <= max_width:
                cur = cand
            else:
                if cur:
                    lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        if len(lines) <= 2 and all(draw.textlength(ln, font=f) <= max_width for ln in lines):
            return f, lines
    fallback = _load_font(SANS_BOLD_CANDIDATES, sizes[-1])
    return fallback, wrap_lines(draw, text, fallback, max_width, max_lines=2)


def fit_single_line(
    draw: ImageDraw.ImageDraw,
    text: str,
    candidates: list[tuple[str, int]],
    max_width: int,
    sizes: tuple[int, ...],
) -> tuple[ImageFont.FreeTypeFont, str]:
    for sz in sizes:
        f = _load_font(candidates, sz)
        if draw.textlength(text, font=f) <= max_width:
            return f, text
    f = _load_font(candidates, sizes[-1])
    t = text
    while len(t) > 4 and draw.textlength(t + "...", font=f) > max_width:
        t = t[:-1].rstrip()
    return f, (t + "..." if t != text else text)


def render_og_card(
    out_path: Path,
    palette_key: str,
    badge_label: str,
    headline: str,
    subtitle: str,
    kpis: list[tuple[str, str, str, bool]],  # (label, value, sub, highlight_accent)
    url_path: str,
) -> None:
    pal = PALETTES[palette_key]
    img = Image.new("RGB", (WIDTH, HEIGHT), (11, 17, 32))
    draw = ImageDraw.Draw(img)

    # Subtle background technical grid
    for gx in range(40, WIDTH, 48):
        draw.line([(gx, 0), (gx, HEIGHT)], fill=(17, 27, 48), width=1)
    for gy in range(40, HEIGHT, 48):
        draw.line([(0, gy), (WIDTH, gy)], fill=(17, 27, 48), width=1)

    # Outer main card
    draw.rounded_rectangle(
        [(40, 38), (WIDTH - 40, HEIGHT - 38)],
        radius=24,
        fill=(17, 28, 51),
        outline=(30, 41, 59),
        width=2,
    )

    # Inset status/brand accent stripe
    draw.rounded_rectangle(
        [(70, 72), (79, HEIGHT - 72)],
        radius=4,
        fill=pal["accent"],
    )

    content_x = 104
    content_right = WIDTH - 72
    max_text_w = content_right - content_x

    # Header: Logo mark + VRAMCalc.me on left, Status pill on right
    draw.rounded_rectangle(
        [(content_x, 74), (content_x + 40, 114)],
        radius=9,
        fill=(2, 6, 23),
        outline=(51, 65, 85),
        width=2,
    )
    draw.rounded_rectangle([(content_x + 9, 83), (content_x + 31, 88)], radius=2, fill=(255, 255, 255))
    draw.rounded_rectangle([(content_x + 9, 92), (content_x + 25, 97)], radius=2, fill=(59, 130, 246))
    draw.rounded_rectangle([(content_x + 9, 101), (content_x + 19, 106)], radius=2, fill=(16, 185, 129))

    f_logo = _load_font(SANS_BOLD_CANDIDATES, 28)
    logo_x = content_x + 54
    draw.text((logo_x, 78), "VRAMCalc", font=f_logo, fill=(255, 255, 255))
    me_x = logo_x + draw.textlength("VRAMCalc", font=f_logo)
    draw.text((me_x, 78), ".me", font=f_logo, fill=(59, 130, 246))

    # Status pill
    f_badge = _load_font(MONO_BOLD_CANDIDATES, 18)
    badge_tw = draw.textlength(badge_label, font=f_badge)
    pill_pad_x = 22
    pill_w = int(badge_tw + pill_pad_x * 2 + 18)
    pill_x0 = content_right - pill_w
    pill_y0 = 74
    pill_y1 = 114
    draw.rounded_rectangle(
        [(pill_x0, pill_y0), (content_right, pill_y1)],
        radius=20,
        fill=pal["badge_bg"],
        outline=pal["accent"],
        width=2,
    )
    draw.ellipse(
        [(pill_x0 + 16, pill_y0 + 15), (pill_x0 + 26, pill_y0 + 25)],
        fill=pal["accent"],
    )
    draw.text((pill_x0 + 34, pill_y0 + 9), badge_label, font=f_badge, fill=pal["badge_text"])

    # Headline (auto-fitted 1-2 lines)
    f_head, head_lines = fit_headline(draw, headline, max_text_w)
    head_y = 144 if len(head_lines) == 2 else 158
    line_step = f_head.size + 10
    for idx, line in enumerate(head_lines):
        draw.text((content_x, head_y + idx * line_step), line, font=f_head, fill=(255, 255, 255))

    # Subtitle
    sub_y = head_y + len(head_lines) * line_step + 14
    f_sub, sub_text = fit_single_line(draw, subtitle, SANS_REG_CANDIDATES, max_text_w, (23, 20, 18))
    draw.text((content_x, sub_y), sub_text, font=f_sub, fill=(148, 163, 184))

    # 3 KPI Tiles
    tile_y0 = 342
    tile_y1 = 486
    tile_gap = 20
    tile_w = (max_text_w - tile_gap * 2) // 3
    f_kpi_lbl = _load_font(MONO_BOLD_CANDIDATES, 15)

    for idx, (lbl, val, sub, highlight) in enumerate(kpis[:3]):
        tx0 = content_x + idx * (tile_w + tile_gap)
        tx1 = tx0 + tile_w
        draw.rounded_rectangle(
            [(tx0, tile_y0), (tx1, tile_y1)],
            radius=16,
            fill=(11, 18, 36),
            outline=(51, 65, 85),
            width=2,
        )
        draw.text((tx0 + 20, tile_y0 + 20), lbl.upper(), font=f_kpi_lbl, fill=(148, 163, 184))

        f_val, val_fit = fit_single_line(
            draw, val, MONO_BOLD_CANDIDATES, tile_w - 40, (32, 28, 24, 20)
        )
        val_color = pal["kpi_val"] if highlight else (255, 255, 255)
        draw.text((tx0 + 20, tile_y0 + 52), val_fit, font=f_val, fill=val_color)

        f_ksub, sub_fit = fit_single_line(
            draw, sub, SANS_REG_CANDIDATES, tile_w - 40, (17, 15, 13)
        )
        draw.text((tx0 + 20, tile_y0 + 104), sub_fit, font=f_ksub, fill=(148, 163, 184))

    # Footer bar
    draw.line([(content_x, 514), (content_right, 514)], fill=(30, 41, 59), width=1)
    f_url, url_fit = fit_single_line(draw, url_path, MONO_REG_CANDIDATES, 640, (17, 15))
    draw.text((content_x, 530), url_fit, font=f_url, fill=(148, 163, 184))

    tagline = f"Formula Estimates (±20%) · Updated {catalog.CATALOG_UPDATED_AT}"
    f_tag = _load_font(SANS_BOLD_CANDIDATES, 17)
    tag_w = draw.textlength(tagline, font=f_tag)
    draw.text((content_right - tag_w, 530), tagline, font=f_tag, fill=(96, 165, 250))

    quantized = img.convert("P", palette=Image.Palette.ADAPTIVE, colors=64)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    quantized.save(out_path, format="PNG", optimize=True)


def status_rank(s: str) -> int:
    return {"Fits": 0, "Tight Fit": 1, "Partial Offload": 2, "OOM": 3}.get(s, 3)


def fmt_ctx(tokens: int) -> str:
    return f"{round(tokens / 1024)}K" if tokens >= 1024 else str(tokens)


def main() -> None:
    entries = json.loads(DATA_PATH.read_text(encoding="utf-8"))

    # Clear old generated PNGs cleanly before writing
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for stale in OUT_DIR.glob("*.png"):
        stale.unlink()

    generated = 0
    fits_total = sum(1 for e in entries if e["default_result"]["status"] in ("Fits", "Tight Fit"))

    # 1. Homepage OG card
    render_og_card(
        OUT_DIR / "home.png",
        palette_key="Blue",
        badge_label="COMPATIBILITY MATRIX",
        headline="Local AI LLM VRAM & Speed Calculator",
        subtitle="GGUF, AWQ & MLX Formats · Multi-GPU PCIe/NVLink & Reserve Profiles",
        kpis=[
            ("Full Guides", f"{len(entries)} Pairings", f"{fits_total} Fits / Tight Fit", True),
            ("Catalog GPUs", f"{len(catalog.HARDWARE)} Hubs", "T4 · L4 · A10 · RTX · M4", False),
            ("Open LLMs", f"{len(catalog.MODELS)} Models", "Qwen3 · Gemma 3 · DeepSeek", False),
        ],
        url_path="vramcalc.me/",
    )
    generated += 1

    # 1b. /calculator/ Rig Simulator OG card
    render_og_card(
        OUT_DIR / "calculator.png",
        palette_key="Blue",
        badge_label="CUSTOM RIG SIMULATOR",
        headline="Multi-GPU, AWQ/MLX & CPU/RAM LLM Simulator",
        subtitle="1x–8x Layer/Tensor Splits, GGUF/AWQ/MLX, Desktop vs Clean Reserve & PCIe Sync",
        kpis=[
            ("Accelerators", f"{len(catalog.HARDWARE)} GPUs (1x-8x)", "NVIDIA · Apple · AMD · Intel", True),
            ("Formats", "GGUF · AWQ · MLX", "llama.cpp · vLLM · mlx-lm", False),
            ("CPU & Memory", f"{len(catalog.CPUS)} CPU Profiles", "16–512 GB DDR4 / DDR5 / EPYC", False),
        ],
        url_path="vramcalc.me/calculator/",
    )
    generated += 1

    # 2. /gpu/ Directory OG card
    max_usable = max(h["usable_vram_gb"] for h in catalog.HARDWARE)
    render_og_card(
        OUT_DIR / "gpu-index.png",
        palette_key="Blue",
        badge_label="HARDWARE DIRECTORY",
        headline=f"All {len(catalog.HARDWARE)} Local AI GPUs & Macs",
        subtitle="Consumer RTX, Data Center T4/L4/A10/H200, Apple Silicon & Dual-GPU Hosts",
        kpis=[
            ("Hardware Hubs", f"{len(catalog.HARDWARE)} Devices", "CUDA · Metal · ROCm", True),
            ("Usable Ceiling", f"Up to {max_usable:g} GB", "Unified & Multi-GPU rigs", False),
            ("Updated", catalog.CATALOG_UPDATED_AT, f"Physics {catalog.ENGINE_VERSION}", False),
        ],
        url_path="vramcalc.me/gpu/",
    )
    generated += 1

    # 3. /model/ Directory OG card
    min_p = min(m["params_b"] for m in catalog.MODELS)
    max_p = max(m["params_b"] for m in catalog.MODELS)
    families = len({m["family"] for m in catalog.MODELS})
    render_og_card(
        OUT_DIR / "model-index.png",
        palette_key="Blue",
        badge_label="MODEL DIRECTORY",
        headline=f"All {len(catalog.MODELS)} Open LLMs Ranked by GPU Fit",
        subtitle="Qwen3, Gemma 3, DeepSeek-R1, Qwen2.5-Coder, Llama-3.3, Mistral & Phi-4",
        kpis=[
            ("Open LLMs", f"{len(catalog.MODELS)} Models", f"{families} model families", True),
            ("Parameter Range", f"{min_p:g}B – {max_p:g}B", "1.5B edge up to 72B flagship", False),
            ("GPU Hubs Matrix", f"{len(catalog.HARDWARE)} GPUs Each", "Honest Fits & Speed Tiers", False),
        ],
        url_path="vramcalc.me/model/",
    )
    generated += 1

    # 4. All 103 Hardware Hub OG cards
    for hw in catalog.HARDWARE:
        hid = hw["id"]
        runs = [(m, physics.estimate_run(m, hw, quant="Q4_K_M", context_tokens=8192)) for m in catalog.MODELS]
        usable = runs[0][1]["effective_usable_vram_gb"]
        fit_runs = [pair for pair in runs if pair[1]["status"] in ("Fits", "Tight Fit")]
        fit_runs.sort(key=lambda x: (-x[0]["params_b"], -x[1]["est_tps"]))
        if fit_runs:
            bm, br = fit_runs[0]
            top_label = f"{bm['short_name']} ({physics.format_tps_range(br['est_tps_low'], br['est_tps_high'], br['est_tps'], br['status'])})"
        else:
            top_label = f"{len(catalog.MODELS)} models evaluated"

        render_og_card(
            OUT_DIR / f"gpu-{hid}.png",
            palette_key="Blue",
            badge_label="GPU HUB",
            headline=f"Best Local AI Models for {hw['name']}",
            subtitle=f"{hw['vendor']} · {hw['backend']} · {hw['memory_type']} · ${hw['msrp_usd']:,} MSRP",
            kpis=[
                ("Usable Pool", f"{usable:.1f} GB", f"of {hw['vram_gb']:g} GB physical", False),
                ("Bandwidth", f"{hw['bandwidth_gbps']:g} GB/s", f"{hw['backend']} runtime", False),
                ("Fits / Tight Fit", f"{len(fit_runs)} / {len(catalog.MODELS)} Fit", top_label, True),
            ],
            url_path=f"vramcalc.me/gpu/{hid}/",
        )
        generated += 1

    # 5. All 22 Model Hub OG cards
    for m in catalog.MODELS:
        mid = m["id"]
        runs = [(hw, physics.estimate_run(m, hw, quant="Q4_K_M", context_tokens=8192)) for hw in catalog.HARDWARE]
        runs.sort(
            key=lambda x: (
                status_rank(x[1]["status"]),
                -x[1]["est_tps"],
                -x[1]["effective_usable_vram_gb"],
            )
        )
        q4_gb = runs[0][1]["total_vram_gb"]
        kv_4k = physics.kv_gb_per_4k(m)
        fit_runs = [x for x in runs if x[1]["status"] in ("Fits", "Tight Fit")]
        fastest_hw, fastest_res = fit_runs[0] if fit_runs else runs[0]
        fast_val = physics.format_tps_range(
            fastest_res["est_tps_low"], fastest_res["est_tps_high"], fastest_res["est_tps"], fastest_res["status"]
        )
        render_og_card(
            OUT_DIR / f"model-{mid}.png",
            palette_key="Blue",
            badge_label="MODEL HUB",
            headline=f"Best GPUs & Macs for {m['name']}",
            subtitle=f"{m['params_b']}B Params · {m['architecture']} · {m['num_layers']} Layers · {fmt_ctx(m['max_context'])} Max",
            kpis=[
                ("Q4_K_M @ 8K", f"{q4_gb:.2f} GB", f"+{kv_4k:.2f} GB KV / 4K", False),
                ("Fits / Tight Fit", f"{len(fit_runs)} / {len(catalog.HARDWARE)} GPUs", "Full on-device residency", len(fit_runs) > 0),
                ("Fastest GPU", fastest_hw["short_name"], fast_val, True),
            ],
            url_path=f"vramcalc.me/model/{mid}/",
        )
        generated += 1

    # 6. All 165 Detail page OG cards
    for e in entries:
        m = e["model"]
        h = e["hardware"]
        r = e["default_result"]
        st = r["status"]
        tier = r.get("speed_tier", physics.classify_speed_tier(r["est_tps"], st))
        usable = r.get("effective_usable_vram_gb", h["usable_vram_gb"])
        max_ctx = e.get("max_fit_context", e["context_analysis"]["max_smooth_context_q4"])
        max_ctx_vram = e.get("max_fit_total_vram_gb", 0.0)
        max_ctx_str = f"Max {fmt_ctx(max_ctx)} ({max_ctx_vram:.1f} GB)" if max_ctx > 0 else "Offload / Q8 KV req."
        speed_val = physics.format_tps_range(r.get("est_tps_low", int(r["est_tps"])), r.get("est_tps_high", int(r["est_tps"])), r["est_tps"], st)
        speed_sub = f"{tier} · Formula est." if st != "OOM" else "Exceeds capacity"
        render_og_card(
            OUT_DIR / f"run-{e['slug']}.png",
            palette_key=st,
            badge_label=st.upper(),
            headline=f"{m['short_name']} on {h['name']}",
            subtitle=f"{m['params_b']}B ({m['num_layers']}L) · {h['backend']} {h['bandwidth_gbps']:g} GB/s · {usable:.1f} GB Usable",
            kpis=[
                ("VRAM (Q4 @ 8K)", f"{r['total_vram_gb']:.2f} GB", f"vs {usable:.1f} GB usable", False),
                ("Est. Speed", speed_val, speed_sub, True),
                ("GPU Layers", f"{r['gpu_layers_fit']}/{r['total_layers']}", max_ctx_str, False),
            ],
            url_path=f"vramcalc.me/can-i-run/{e['slug']}/",
        )
        generated += 1

    total_kb = sum(p.stat().st_size for p in OUT_DIR.glob("*.png")) / 1024
    print(f"Generated {generated} OG PNG cards in {OUT_DIR} ({total_kb:.1f} KB total, avg {total_kb/generated:.1f} KB)")


if __name__ == "__main__":
    main()
