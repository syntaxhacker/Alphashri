#!/usr/bin/env python3
"""Record Fyers option-chain snapshots until a stop time (default: today 15:35 IST).

Usage:
    PYTHONPATH=. source .venv/bin/activate
    python scripts/record_expiry_chain.py [--date YYYY-MM-DD] [--stop HH:MM] [--interval SEC]

Saves raw chain payloads to experiments/data/expiry_snapshots/<DATE>/chain_HHMMSS.json
so the full expiry-day tape (LTP/OI/volume per strike) can be replayed later.
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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=datetime.now(IST).strftime("%Y-%m-%d"))
    ap.add_argument("--stop", default="15:35")
    ap.add_argument("--interval", type=int, default=60)
    ap.add_argument("--strikecount", type=int, default=50)
    ap.add_argument("--underlying", default="NSE:NIFTY50-INDEX")
    args = ap.parse_args()

    from api.orderflow_recorder import recorder_token
    from fyers_apiv3.fyersModel import FyersModel

    combined = recorder_token("fyers_tbt")
    app_id, _, token = combined.partition(":")
    if not token:
        raise SystemExit("no fyers token")
    client = FyersModel(client_id=app_id, token=token)

    outdir = REPO_ROOT / "experiments" / "data" / "expiry_snapshots" / args.date
    outdir.mkdir(parents=True, exist_ok=True)

    stop_h, stop_m = (int(x) for x in args.stop.split(":"))
    n = 0
    while True:
        now = datetime.now(IST)
        if (now.hour, now.minute) >= (stop_h, stop_m):
            print(f"[{now:%H:%M:%S}] stop time reached, done ({n} snapshots)")
            break
        try:
            resp = client.optionchain(
                data={"symbol": args.underlying, "strikecount": args.strikecount}
            )
            stamp = now.strftime("%H%M%S")
            payload = {"as_of": now.isoformat(), "response": resp}
            (outdir / f"chain_{stamp}.json").write_text(json.dumps(payload))
            n += 1
            nlegs = len((resp.get("data") or {}).get("optionsChain", []))
            print(f"[{now:%H:%M:%S}] snapshot {n} ({nlegs} legs)", flush=True)
        except Exception as exc:  # noqa: BLE001 — keep recording through blips
            print(f"[{datetime.now(IST):%H:%M:%S}] error: {exc!r}"[:200], flush=True)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
