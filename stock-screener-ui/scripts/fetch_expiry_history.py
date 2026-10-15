#!/usr/bin/env python3
"""Post-close pull: 5-second candles (+OI) for every recorded expiry symbol.

Usage:
    PYTHONPATH=. python scripts/fetch_expiry_history.py [--date YYYY-MM-DD]

Reads experiments/data/expiry_snapshots/<DATE>/ticks_*.jsonl to discover symbols,
pulls resolution=5S history with oi_flag=1, and writes one Parquet/PKL bundle:
experiments/data/expiry_snapshots/<DATE>/candles_5s.pkl  {symbol: DataFrame}
plus the underlying NIFTY index 5S candles under key "UNDERLYING".
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

IST = ZoneInfo("Asia/Kolkata")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=datetime.now(IST).strftime("%Y-%m-%d"))
    ap.add_argument("--underlying", default="NSE:NIFTY50-INDEX")
    args = ap.parse_args()

    import time

    import pandas as pd
    from api.orderflow_recorder import recorder_token
    from fyers_apiv3.fyersModel import FyersModel

    combined = recorder_token("fyers_tbt")
    app_id, _, token = combined.partition(":")
    client = FyersModel(client_id=app_id, token=token)

    day = datetime.strptime(args.date, "%Y-%m-%d").date()
    prev_day = (day - timedelta(days=1)).isoformat()
    outdir = REPO_ROOT / "experiments" / "data" / "expiry_snapshots" / args.date
    tick_files = sorted(outdir.glob("ticks_*.jsonl"))
    symbols = [f.stem[len("ticks_") :].replace("_", ":", 1) for f in tick_files]
    symbols.append(args.underlying)
    print(f"[hist] {len(symbols)} symbols", flush=True)

    bundle: dict[str, pd.DataFrame] = {}
    for i, sym in enumerate(symbols):
        try:
            resp = client.history(
                data={
                    "symbol": sym,
                    "resolution": "5S",
                    "date_format": "1",
                    "range_from": prev_day,
                    "range_to": args.date,
                    "cont_flag": "1",
                    "oi_flag": "1",
                }
            )
            candles = resp.get("candles") or []
            cols = ["ts", "o", "h", "l", "c", "v", "oi"][: len(candles[0])] if candles else []
            df = pd.DataFrame(candles, columns=cols) if candles else pd.DataFrame()
            key = "UNDERLYING" if sym == args.underlying else sym
            bundle[key] = df
            print(f"[hist] {i+1}/{len(symbols)} {sym}: {len(df)} candles", flush=True)
        except Exception as exc:  # noqa: BLE001 — one bad symbol must not kill the batch
            print(f"[hist] {sym} FAILED: {str(exc)[:150]}", flush=True)
        time.sleep(0.3)

    out = outdir / "candles_5s.pkl"
    pd.to_pickle(bundle, out)
    total = sum(len(df) for df in bundle.values())
    print(f"[hist] wrote {out} ({len(bundle)} symbols, {total} candles)", flush=True)


if __name__ == "__main__":
    main()
