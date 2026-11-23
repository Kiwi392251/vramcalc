# VRAMCalc.me — Local AI VRAM & Speed Estimator

Static pSEO web application for **https://vramcalc.me** built with **Astro**, **Tailwind CSS v4 (`@tailwindcss/vite`)**, **@astrojs/sitemap**, and a resumable OpenAI-compatible Python pSEO data pipeline.

## Project Structure

```text
├── .github/workflows/deploy.yml   # CI build check & optional Cloudflare Pages Wrangler deploy
├── .gitignore
├── scripts/
│   ├── .env.example               # BASE_URL / API_KEY / MODEL_NAME template
│   ├── requirements.txt           # openai + python-dotenv
│   ├── catalog.py                 # 12 open-weight models x 32 Apple/NVIDIA hardware specs
│   ├── physics.py                 # Deterministic VRAM, KV cache, offload & tok/s math
│   ├── generate.py                # Async, rate-limited, resumable OpenAI SDK pSEO generator
│   └── run_and_push.sh            # One-click GCP Debian 13 run + commit + git push helper
└── site/
    ├── astro.config.mjs           # site: 'https://vramcalc.me', sitemap + @tailwindcss/vite
    ├── src/data/pages_data.json   # Generated benchmark dataset (starts with 5 curated entries)
    ├── src/pages/index.astro      # Filterable compatibility matrix homepage
    └── src/pages/can-i-run/[slug].astro  # Interactive VRAM calculator + static SEO breakdown
```

## 1. Local Frontend Preview & Build

```bash
cd site
npm install
npm run dev      # http://localhost:4321
npm run build    # outputs static site + sitemap-index.xml into site/dist/
```

## 2. GCP Debian 13 (Trixie) Data Pipeline Setup

Debian 13 enforces PEP 668 externally-managed Python environments, so create a dedicated `.venv` inside `scripts/`:

```bash
sudo apt-get update && sudo apt-get install -y python3-venv git
python3 -m venv scripts/.venv
source scripts/.venv/bin/activate
pip install -r scripts/requirements.txt

cp scripts/.env.example scripts/.env
# Edit scripts/.env with your BASE_URL, API_KEY, and MODEL_NAME
```

### Generate Data (Resumable & Rate-Limited)

```bash
# Inspect built-in models, GPUs/Macs, and total combinations (12 x 32 = 384)
python3 scripts/generate.py --list-catalog

# Preview pending pairs without API calls
python3 scripts/generate.py --dry-run --limit 20

# Run a batch (auto-skips already completed slugs in pages_data.json)
python3 scripts/generate.py --limit 50 --concurrency 5 --rpm 30
```

### One-Click Generate & Auto-Push to Trigger Cloudflare Pages

Make sure Git SSH/PAT push access is configured on the GCP instance, then run:

```bash
./scripts/run_and_push.sh --limit 50 --concurrency 5 --rpm 30
```

Or schedule hourly batches via `crontab -e`:

```cron
0 * * * * /path/to/repo/scripts/run_and_push.sh --limit 40 --concurrency 4 --rpm 25 >> /tmp/vramcalc-cron.log 2>&1
```

## 3. Cloudflare Pages Deployment

- **Option A (Cloudflare Pages Git Integration — Recommended):**
  - Connect your GitHub repository in Cloudflare Pages.
  - **Root directory:** `site`
  - **Build command:** `npm run build`
  - **Build output directory:** `dist`
  - Add custom domain `vramcalc.me`. Every push from `run_and_push.sh` rebuilds and deploys automatically.
- **Option B (GitHub Actions Direct Wrangler Deploy):**
  - Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to GitHub repository secrets (and optionally `CLOUDFLARE_PROJECT_NAME` variable, default `vramcalc`). `.github/workflows/deploy.yml` runs `npm run build` on every push to `main` and deploys `site/dist` when secrets are present.
