#!/usr/bin/env python3
"""Recompute `walls` for the converted historical tape from the stored chain.

The chain and spot are unchanged; only the wall ranking is rebuilt with the
live recorder's rule (top-3 OI per side inside +/-300 pts, no side filter).
Cheaper than re-reading 4 GB of CSVs.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "wall_replay"))
from hist_convert import walls_of  # noqa: E402

HIST = ROOT / "experiments" / "data" / "nifty_hist"


def main() -> None:
    files = sorted(p for p in HIST.glob("*.jsonl") if not p.stem.startswith("_"))
    for p in files:
        rows = [json.loads(line) for line in p.read_text().splitlines() if line.strip()]
        for r in rows:
            ch = {int(k): v for k, v in r["chain"].items()}
            r["walls"] = walls_of(ch, float(r["spot"]))
        p.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    print(f"rewrote walls for {len(files)} sessions")


if __name__ == "__main__":
    main()
