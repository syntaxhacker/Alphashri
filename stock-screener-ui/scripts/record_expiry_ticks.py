#!/usr/bin/env python3
"""Record live option ticks (normalized SymbolUpdate + 5-level depth) to JSONL.

Usage:
    PYTHONPATH=. python scripts/record_expiry_ticks.py [--stop HH:MM] [--strikes 22450-22950]

Writes experiments/data/expiry_snapshots/<DATE>/ticks_<SYMBOL>.jsonl, one JSON
object per tick: {"ts": <receipt epoch ms>, "tick": {...normalized...}}.
Stops at --stop IST (default 15:35). Works for any Fyers symbols; defaults to
today's NIFTY weekly expiry ATM band.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

IST = ZoneInfo("Asia/Kolkata")


def chain_symbols(client, underlying: str, lo: int, hi: int) -> list[str]:
    """Option symbols for the nearest expiry within [lo, hi], straight from
    the live chain — never guess the weekly symbol format."""
    resp = client.optionchain(data={"symbol": underlying, "strikecount": 50})
    rows = (resp.get("data") or {}).get("optionsChain") or []
    out = []
    for r in rows:
        try:
            k = float(r.get("strike_price", 0))
        except (TypeError, ValueError):
            continue
        if k <= 0 or not (lo <= k <= hi):
            continue
        sym = r.get("symbol")
        if sym and sym not in out:
            out.append(sym)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stop", default="15:35")
    ap.add_argument("--strikes", default="22450-22950")
    args = ap.parse_args()

    from api.orderflow_adapters.fyers import FyersAdapter
    from api.orderflow_recorder import recorder_token
    from fyers_apiv3.fyersModel import FyersModel

    lo, hi = (int(x) for x in args.strikes.split("-"))

    combined = recorder_token("fyers_tbt")
    app_id, _, token = combined.partition(":")
    rest = FyersModel(client_id=app_id, token=token)
    symbols = chain_symbols(rest, "NSE:NIFTY50-INDEX", lo, hi)
    if not symbols:
        raise SystemExit("no symbols in chain band")
    print(f"[tick] {len(symbols)} symbols: {symbols[0]} .. {symbols[-1]}", flush=True)

    outdir = REPO_ROOT / "experiments" / "data" / "expiry_snapshots" / datetime.now(IST).strftime("%Y-%m-%d")
    outdir.mkdir(parents=True, exist_ok=True)
    handles = {s: (outdir / f"ticks_{s.replace(':', '_')}.jsonl").open("a") for s in symbols}
    counts = dict.fromkeys(symbols, 0)

    stop_h, stop_m = (int(x) for x in args.stop.split(":"))

    def on_tick(symbol: str, tick: dict) -> None:
        h = handles.get(str(symbol))
        if h is None:
            return
        h.write(json.dumps({"ts": int(time.time() * 1000), "tick": tick}) + "\n")
        counts[str(symbol)] = counts.get(str(symbol), 0) + 1

    adapter = FyersAdapter(access_token=recorder_token("fyers_tbt"))
    adapter.connect(symbols, on_tick=on_tick,
                    on_error=lambda e: print(f"[tick] feed error: {str(e)[:150]}", flush=True))
    print(f"[tick] recording {len(symbols)} symbols until {args.stop} IST", flush=True)
    try:
        while True:
            now = datetime.now(IST)
            if (now.hour, now.minute) >= (stop_h, stop_m):
                break
            time.sleep(5)
    finally:
        try:
            adapter.disconnect()
        except Exception:  # noqa: BLE001
            pass
        for h in handles.values():
            try:
                h.close()
            except Exception:  # noqa: BLE001
                pass
    total = sum(counts.values())
    top = sorted(counts.items(), key=lambda kv: -kv[1])[:5]
    print(f"[tick] done: {total} ticks. top: {[(s.split('NIFTY26O06')[-1], c) for s, c in top]}", flush=True)


if __name__ == "__main__":
    main()
