#!/usr/bin/env python3
"""Aggregate every wall-replay session into one table + summary.md.

Reads reports/WALL_REPLAY/state/<date>.json (written by gym.py) and the
session notes. No look-ahead, no market data — pure accounting.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / "reports" / "WALL_REPLAY" / "state"
OUT = ROOT / "reports" / "WALL_REPLAY" / "summary.md"


def _max_dd(nets: list[float]) -> float:
    run = peak = dd = 0.0
    for n in nets:
        run += n
        peak = max(peak, run)
        dd = min(dd, run - peak)
    return dd


def main() -> int:
    rows = []
    for p in sorted(STATE.glob("*.json")):
        s = json.loads(p.read_text())
        trades = s.get("trades") or []
        nets = [float(t.get("net") or 0) for t in trades]
        wins = [n for n in nets if n > 0]
        losses = [n for n in nets if n < 0]
        notes = s.get("notes") or []
        missed = [n for n in notes if "MISS" in (n.get("text") or "").upper()]
        rows.append({
            "date": s.get("date") or p.stem,
            "n": len(trades),
            "win": (len(wins) / len(nets) * 100) if nets else 0.0,
            "net": round(sum(nets), 2),
            "avg_win": round(sum(wins) / len(wins), 2) if wins else 0.0,
            "avg_loss": round(sum(losses) / len(losses), 2) if losses else 0.0,
            "dd": round(_max_dd(nets), 2),
            "notes": len(notes),
            "missed": len(missed),
        })

    lines = ["# Wall replay — all sessions", "",
             "| date | trades | win% | net ₹ | avg win | avg loss | max DD | notes | missed |",
             "|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        lines.append(f"| {r['date']} | {r['n']} | {r['win']:.0f}% | {r['net']:+,.0f} | "
                     f"{r['avg_win']:+,.0f} | {r['avg_loss']:+,.0f} | {r['dd']:+,.0f} | "
                     f"{r['notes']} | {r['missed']} |")
    total = sum(r["net"] for r in rows)
    trades = sum(r["n"] for r in rows)
    wins = sum(1 for r in rows for t in json.loads((STATE / f"{r['date']}.json").read_text()).get("trades") or [] if (t.get("net") or 0) > 0)
    lines += ["", f"**Total:** {trades} trades, {wins} wins "
              f"({(wins / trades * 100) if trades else 0:.0f}%), net **₹{total:+,.0f}**."]
    OUT.write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
