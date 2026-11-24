"""Export scripts/catalog.py (MODELS, HARDWARE, CPUS) to site/src/data/catalog_data.json."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = ROOT / "scripts"
OUT_PATH = ROOT / "site" / "src" / "data" / "catalog_data.json"

sys.path.insert(0, str(SCRIPTS_DIR))
import catalog  # noqa: E402


def main() -> None:
    model_ids = [m["id"] for m in catalog.MODELS]
    hw_ids = [h["id"] for h in catalog.HARDWARE]
    cpu_ids = [c["id"] for c in catalog.CPUS]

    assert len(model_ids) == len(set(model_ids)), "Duplicate model IDs in catalog.py!"
    assert len(hw_ids) == len(set(hw_ids)), "Duplicate hardware IDs in catalog.py!"
    assert len(cpu_ids) == len(set(cpu_ids)), "Duplicate CPU IDs in catalog.py!"

    payload = {
        "updated_at": catalog.CATALOG_UPDATED_AT,
        "engine_version": catalog.ENGINE_VERSION,
        "models": catalog.MODELS,
        "hardware": catalog.HARDWARE,
        "cpus": catalog.CPUS,
    }
    tmp_path = OUT_PATH.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp_path.replace(OUT_PATH)
    print(
        f"Exported catalog_data.json: {len(catalog.MODELS)} models, {len(catalog.HARDWARE)} hardware, {len(catalog.CPUS)} CPUs -> {OUT_PATH}"
    )


if __name__ == "__main__":
    main()
