#!/usr/bin/env bash
set -euo pipefail

# One-click data generation + Git push helper for GCP Debian 13 (Trixie)
# Usage:
#   ./scripts/run_and_push.sh --limit 50 --concurrency 5 --rpm 30
#   ./scripts/run_and_push.sh --models deepseek-r1-32b qwen2.5-coder-32b --limit 20

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_REL="site/src/data/pages_data.json"
DATA_FILE="$REPO_ROOT/$DATA_REL"
LOCK_FILE="/tmp/vramcalc-generate.lock"

cd "$REPO_ROOT"

# Prevent overlapping cron runs when flock is available
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "[run_and_push] Another generation run is already in progress. Exiting."
    exit 0
  fi
fi

# Pull latest remote changes if an upstream tracking branch exists
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if git rev-parse --abbrev-ref --symbolic-full-name "@{u}" >/dev/null 2>&1; then
    echo "[run_and_push] Syncing with remote..."
    git pull --rebase --autostash
  fi
fi

# Activate virtual environment (PEP 668 compliant on Debian 13)
if [ -f "$SCRIPT_DIR/.venv/bin/activate" ]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.venv/bin/activate"
elif [ -f "$REPO_ROOT/.venv/bin/activate" ]; then
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.venv/bin/activate"
fi

echo "[run_and_push] Running generate.py $*"
python3 "$SCRIPT_DIR/generate.py" "$@"

# Validate output JSON and count total generated pages
TOTAL_PAGES="$(python3 -c '
import json, sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)
assert isinstance(data, list) and len(data) > 0, "pages_data.json must be a non-empty JSON array"
print(len(data))
' "$DATA_FILE")"

echo "[run_and_push] Validated $DATA_REL ($TOTAL_PAGES total pages)."

# Commit & push only if pages_data.json was created or modified
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[run_and_push] Not a git repository; skipping commit and push."
  exit 0
fi

UNTRACKED="$(git ls-files --others --exclude-standard -- "$DATA_REL")"
if git diff --quiet -- "$DATA_REL" && [ -z "$UNTRACKED" ]; then
  echo "[run_and_push] No changes detected in $DATA_REL. Nothing to commit."
  exit 0
fi

git add -- "$DATA_REL"
git commit -m "data: update pages_data.json ($TOTAL_PAGES total pages)"

if git remote get-url origin >/dev/null 2>&1; then
  CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  echo "[run_and_push] Pushing branch $CURRENT_BRANCH to origin..."
  git push origin "$CURRENT_BRANCH"
  echo "[run_and_push] Push complete. GitHub Actions / Cloudflare Pages build triggered."
else
  echo "[run_and_push] Commit created locally; no 'origin' remote configured to push."
fi
