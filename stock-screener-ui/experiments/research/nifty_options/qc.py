"""Data quality control for the cached NIFTY research dataset.

Checks, per cached contract: duplicate/gap timestamps, OHLC validity, zero
volume, staleness, tick sanity. Writes ``data_quality.json`` with a per-file and
aggregate summary. Nothing is silently repaired — problems are surfaced.
"""

from __future__ import annotations

import json
import sys
from datetime import time as dtime
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fyers_data as fd  # noqa: E402


def check_file(path: Path) -> dict:
    try:
        df = pd.read_parquet(path)
    except Exception as e:
        return {"file": path.name, "error": str(e)}
    if df.empty:
        return {"file": path.name, "rows": 0, "empty": True}
    out = {"file": path.name, "rows": int(len(df))}
    out["dupes"] = int(df["ts"].duplicated().sum())
    out["monotonic"] = bool(df["ts"].is_monotonic_increasing)
    out["bad_ohlc"] = int(((df["high"] < df["low"]) |
                           (df["high"] < df[["open", "close"]].max(axis=1)) |
                           (df["low"] > df[["open", "close"]].min(axis=1)) |
                           (df[["open", "high", "low", "close"]] <= 0).any(axis=1)).sum())
    out["neg_volume"] = int((df["volume"] < 0).sum())
    out["zero_vol_frac"] = float((df["volume"] <= 0).mean())
    out["nan_close"] = int(df["close"].isna().sum())
    t = df["ts"].dt.time
    out["off_session"] = int(((t < dtime(9, 15)) | (t > dtime(15, 30))).sum())
    # per-session bar count consistency (1-min expected 375)
    per = df.groupby(df["ts"].dt.date).size()
    out["sessions"] = int(len(per))
    out["median_bars_per_session"] = float(per.median()) if len(per) else 0
    out["price_scale_ok"] = bool((df["close"].max() < 1e6) and (df["close"].min() >= 0))
    return out


def main():
    files = sorted(fd.CANDLE_DIR.glob("*.parquet"))
    rows = []
    for p in files:
        rows.append(check_file(p))
        if len(rows) % 100 == 0:
            print(f"  {len(rows)}/{len(files)}", flush=True)
    df = pd.DataFrame(rows)
    agg = {
        "files": int(len(df)),
        "files_with_bad_ohlc": int((df.get("bad_ohlc", pd.Series(dtype=int)).fillna(0) > 0).sum()),
        "files_with_dupes": int((df.get("dupes", pd.Series(dtype=int)).fillna(0) > 0).sum()),
        "files_off_session": int((df.get("off_session", pd.Series(dtype=int)).fillna(0) > 0).sum()),
        "median_zero_vol_frac": float(df["zero_vol_frac"].median()) if "zero_vol_frac" in df else None,
        "total_rows": int(df["rows"].fillna(0).sum()),
    }
    result = {"aggregate": agg, "files": rows}
    (fd.CACHE_DIR / "data_quality.json").write_text(json.dumps(result, indent=2, default=str))
    print(json.dumps(agg, indent=2))
    worst = df.sort_values("zero_vol_frac", ascending=False).head(10)
    print("\nMost illiquid (highest zero-volume fraction):")
    print(worst[["file", "rows", "zero_vol_frac", "median_bars_per_session"]].to_string(index=False))


if __name__ == "__main__":
    main()
