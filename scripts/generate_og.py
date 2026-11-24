"""Generate 150 optimized 1200x630 Open Graph PNG preview cards for vramcalc.me."""

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
    "Smooth": {
        "accent": (16, 185, 129),      # #10b981
        "badge_bg": (6, 78, 59),       # #064e3b
        "badge_text": (167, 243, 208), # #a7f3d0
        "kpi_val": (52, 211, 153),     # #34d399
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

    tagline = "Interactive VRAM & Tokens/s Estimator"
    f_tag = _load_font(SANS_BOLD_CANDIDATES, 17)
    tag_w = draw.textlength(tagline, font=f_tag)
    draw.text((content_right - tag_w, 530), tagline, font=f_tag, fill=(96, 165, 250))

    quantized = img.convert("P", palette=Image.Palette.ADAPTIVE, colors=64)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    quantized.save(out_path, format="PNG", optimize=True)


def status_rank(s: str) -> int:
    if s == "Smooth":
        return 0
    if s == "Partial Offload":
        return 1
    return 2


def fmt_ctx(tokens: int) -> str:
    return f"{round(tokens / 1024)}K" if tokens >= 1024 else str(tokens)


def main() -> None:
    entries = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    by_hw: dict[str, list[dict]] = defaultdict(list)
    by_mod: dict[str, list[dict]] = defaultdict(list)

    for e in entries:
        by_hw[e["hardware"]["id"]].append(e)
        by_mod[e["model"]["id"]].append(e)

    # Clear old generated PNGs cleanly before writing
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for stale in OUT_DIR.glob("*.png"):
        stale.unlink()

    generated = 0
    smooth_total = sum(1 for e in entries if e["default_result"]["status"] == "Smooth")

    # 1. Homepage OG card
    render_og_card(
        OUT_DIR / "home.png",
        palette_key="Blue",
        badge_label="COMPATIBILITY MATRIX",
        headline="Local AI LLM VRAM & Speed Calculator",
        subtitle="Exact Q4_K_M / Q8_0 / FP16 footprints, KV-cache limits & tok/s across NVIDIA, Apple & AMD",
        kpis=[
            ("Benchmarks", f"{len(entries)} Pairings", f"{smooth_total} Smooth GPU runs", True),
            ("Hardware Hubs", f"{len(by_hw)} GPUs & Macs", "RTX 50/40/30 · M1-M5 · Strix Halo", False),
            ("Model Hubs", f"{len(by_mod)} Open LLMs", "DeepSeek-R1 · Qwen2.5 · Llama 3.3", False),
        ],
        url_path="vramcalc.me/",
    )
    generated += 1

    # 2. /gpu/ Directory OG card
    max_usable = max(e["hardware"]["usable_vram_gb"] for e in entries)
    render_og_card(
        OUT_DIR / "gpu-index.png",
        palette_key="Blue",
        badge_label="HARDWARE DIRECTORY",
        headline=f"All {len(by_hw)} Local AI GPUs & Unified Macs",
        subtitle="Filter NVIDIA RTX, Dual-GPU, Apple Silicon & AMD Radeon/Ryzen AI by usable VRAM & bandwidth",
        kpis=[
            ("GPU & Mac Hubs", f"{len(by_hw)} Devices", "CUDA · Metal · ROCm", True),
            ("Usable Ceiling", f"Up to {max_usable:g} GB", "Unified & Multi-GPU rigs", False),
            ("Total Benchmarks", f"{len(entries)} Pairings", "Interactive calculators", False),
        ],
        url_path="vramcalc.me/gpu/",
    )
    generated += 1

    # 3. /model/ Directory OG card
    min_p = min(e["model"]["params_b"] for e in entries)
    max_p = max(e["model"]["params_b"] for e in entries)
    families = len({e["model"]["family"] for e in entries})
    render_og_card(
        OUT_DIR / "model-index.png",
        palette_key="Blue",
        badge_label="MODEL DIRECTORY",
        headline=f"All {len(by_mod)} Open-Weight LLM VRAM Hubs",
        subtitle="Compare Q4_K_M / Q8_0 / FP16 requirements and ranked GPUs from DeepSeek-R1 to Llama 3.3 70B",
        kpis=[
            ("Indexed Models", f"{len(by_mod)} LLMs", f"Across {families} model families", True),
            ("Parameter Range", f"{min_p:g}B – {max_p:g}B", "1.5B edge up to 72B flagship", False),
            ("GPU Leaderboards", f"{len(entries)} Runs", "Ranked Smooth-first by tok/s", False),
        ],
        url_path="vramcalc.me/model/",
    )
    generated += 1

    # 4. 29 Hardware Hub OG cards
    for hid, lst in sorted(by_hw.items()):
        # Merge optional hardware fields cleanly
        hw = dict(lst[0]["hardware"])
        for item in lst[1:]:
            for k, v in item["hardware"].items():
                if v is not None:
                    hw[k] = v
        smooth = [x for x in lst if x["default_result"]["status"] == "Smooth"]
        smooth.sort(key=lambda x: (-x["model"]["params_b"], -x["default_result"]["est_tps"]))
        top_label = (
            f"{smooth[0]['model']['short_name']} ({smooth[0]['default_result']['est_tps']:.1f} t/s)"
            if smooth
            else f"{len(lst)} tested models"
        )
        render_og_card(
            OUT_DIR / f"gpu-{hid}.png",
            palette_key="Blue",
            badge_label="GPU HUB",
            headline=f"Best Local AI Models for {hw['name']}",
            subtitle=f"{hw['vendor']} · {hw['backend']} · {hw['memory_type']} · ${hw['msrp_usd']:,} MSRP",
            kpis=[
                ("Usable VRAM", f"{hw['usable_vram_gb']} GB", f"of {hw['vram_gb']} GB physical", False),
                ("Bandwidth", f"{hw['bandwidth_gbps']:g} GB/s", f"{hw['backend']} runtime", False),
                ("Smooth Models", f"{len(smooth)} / {len(lst)} Fit", top_label, True),
            ],
            url_path=f"vramcalc.me/gpu/{hid}/",
        )
        generated += 1

    # 5. 12 Model Hub OG cards
    for mid, lst in sorted(by_mod.items()):
        sorted_runs = sorted(
            lst,
            key=lambda x: (
                status_rank(x["default_result"]["status"]),
                -x["default_result"]["est_tps"],
                -x["hardware"]["usable_vram_gb"],
            ),
        )
        m = sorted_runs[0]["model"]
        q4_gb = sorted_runs[0]["default_result"]["total_vram_gb"]
        kv_4k = sorted_runs[0]["context_analysis"]["kv_gb_per_4k"]
        smooth = [x for x in sorted_runs if x["default_result"]["status"] == "Smooth"]
        fastest = smooth[0] if smooth else sorted_runs[0]
        fast_val = (
            f"{fastest['default_result']['est_tps']:.1f} tok/s"
            if fastest["default_result"]["status"] != "OOM"
            else "Offload Req."
        )
        render_og_card(
            OUT_DIR / f"model-{mid}.png",
            palette_key="Blue",
            badge_label="MODEL HUB",
            headline=f"Best GPUs & Macs for {m['name']}",
            subtitle=f"{m['params_b']}B Params · {m['architecture']} · {m['num_layers']} Layers · {fmt_ctx(m['max_context'])} Max",
            kpis=[
                ("Q4_K_M @ 8K", f"{q4_gb:.2f} GB", f"+{kv_4k:.2f} GB KV / 4K", False),
                ("Smooth GPUs", f"{len(smooth)} / {len(lst)} Fit", "Full on-device residency", len(smooth) > 0),
                ("Fastest GPU", fastest["hardware"]["short_name"], fast_val, True),
            ],
            url_path=f"vramcalc.me/model/{mid}/",
        )
        generated += 1

    # 6. 106 Detail page OG cards
    for e in entries:
        m = e["model"]
        h = e["hardware"]
        r = e["default_result"]
        st = r["status"]
        max_ctx = e["context_analysis"]["max_smooth_context_q4"]
        max_ctx_str = f"Max {fmt_ctx(max_ctx)} Q4" if max_ctx > 0 else "Needs Offload/Q2"
        speed_val = f"{r['est_tps']:.1f} tok/s" if st != "OOM" else "OOM (0 tok/s)"
        speed_sub = (
            "Full GPU bandwidth"
            if st == "Smooth"
            else "PCIe / RAM bottleneck"
            if st == "Partial Offload"
            else "Exceeds capacity"
        )
        render_og_card(
            OUT_DIR / f"run-{e['slug']}.png",
            palette_key=st,
            badge_label=st.upper(),
            headline=f"{m['short_name']} on {h['name']}",
            subtitle=f"{m['params_b']}B ({m['num_layers']}L) · {h['backend']} {h['bandwidth_gbps']:g} GB/s · {h['usable_vram_gb']} GB Usable",
            kpis=[
                ("VRAM (Q4 @ 8K)", f"{r['total_vram_gb']:.2f} GB", f"vs {h['usable_vram_gb']} GB usable", False),
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
