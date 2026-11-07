#!/usr/bin/env python3
"""Scan Indian stocks with the repo's chart-pattern engine.

Uses `chart_patterns.engine.detect_patterns` (19 patterns, PatternHit with
breakout / target / stop / RR). Daily bars, 1 year. Reports patterns detected
in the last 5 sessions ("this week").

Run:
    .venv/bin/python scripts/stock_pattern_scan.py
"""

from __future__ import annotations

import glob
import sys
from pathlib import Path

import pandas as pd
import yfinance as yf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from chart_patterns.engine import detect_patterns  # noqa: E402

LAST_N = 5


def universe() -> list[str]:
    return sorted(Path(p).stem.replace("b15m_2025_", "")
                  for p in glob.glob(str(ROOT / "experiments" / "data" / "b15m_2025_*.pkl")))


def main():
    syms = universe()
    tickers = [s + ".NS" for s in syms]
    raw = yf.download(tickers, period="1y", interval="1d", group_by="ticker",
                      auto_adjust=False, progress=False, threads=True)
    rows = []
    for s, t in zip(syms, tickers):
        try:
            df = raw[t].dropna()
        except Exception:
            continue
        if len(df) < 60:
            continue
        try:
            hits = detect_patterns(df, "1D", s)
        except Exception as e:
            print(f"  {s}: {e}", file=sys.stderr)
            continue
        for h in hits:
            if h.bars_ago > LAST_N:
                continue
            if h.direction not in ("bullish", "bearish") and h.pattern_id != "consolidation":
                continue
            if h.status not in ("confirmed", "forming"):
                continue
            rows.append({
                "symbol": s, "pattern": h.pattern_name, "dir": h.direction,
                "status": h.status, "quality": h.quality,
                "conf": round(h.confidence, 2), "bars_ago": h.bars_ago,
                "breakout": round(h.breakout_level, 1), "target": round(h.target, 1),
                "stop": round(h.stop, 1), "rr": round(h.rr, 1),
                "vol": "Y" if h.volume_confirmed else "n",
                "last": round(float(df["Close"].iloc[-1]), 1),
                "dist_%": round((float(df["Close"].iloc[-1]) / h.breakout_level - 1) * 100, 1),
                "base_days": h.base_days, "range_%": round(h.range_pct, 1),
                "range_pos": round(h.range_pos, 2),
                "end": h.end_date,
            })
    if not rows:
        print("No patterns detected in the last 5 sessions.")
        return
    out = pd.DataFrame(rows)
    out["srank"] = out["status"].map({"confirmed": 0, "forming": 1})
    out = out.sort_values(["srank", "conf", "rr"], ascending=[True, False, False]).drop(columns="srank")
    print(out.to_string(index=False))
    outdir = ROOT / "reports" / "STOCK_MOMENTUM"
    outdir.mkdir(parents=True, exist_ok=True)
    day = str(out["end"].max())
    full = outdir / f"pattern_scan_{day}.csv"
    syms = outdir / f"pattern_symbols_{day}.csv"
    out.to_csv(full, index=False)
    out[["symbol"]].drop_duplicates().sort_values("symbol").to_csv(syms, index=False)
    print(f"\nwrote {full}")
    print(f"wrote {syms}")


if __name__ == "__main__":
    main()
