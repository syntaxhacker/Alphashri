#!/usr/bin/env python3
"""
Standalone headless order-flow recorder.

Journals ticks and signals for a symbol list until Ctrl+C. Prints a clear
message and exits 0 when there is nothing to record (no token or market
closed), so it is safe to invoke for smoke checks.

Usage:
  source .venv/bin/activate
  python scripts/orderflow_recorder.py
  python scripts/orderflow_recorder.py --symbols RELIANCE,TCS
"""

import argparse
import logging
import signal
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


def main(argv=None) -> int:
    from api.orderflow_recorder import GAP_WARN_SEC, OrderFlowRecorder, recorder_symbols
    from api.paper.live_stream import _get_upstox_token
    from trading.utils import is_market_open

    parser = argparse.ArgumentParser(description="Headless order-flow recorder")
    parser.add_argument(
        "--symbols",
        help="Comma-separated symbols (overrides ORDERFLOW_RECORDER_SYMBOLS)",
    )
    args = parser.parse_args(argv)

    symbols = (
        [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
        if args.symbols
        else recorder_symbols()
    )
    if not symbols:
        print("No symbols configured (use --symbols or ORDERFLOW_RECORDER_SYMBOLS).")
        return 0

    token = _get_upstox_token()
    if not token:
        print("No Upstox access token available — connect the broker in Settings. Exiting.")
        return 0

    if not is_market_open():
        print("Market is closed — no order flow to record. Exiting.")
        return 0

    recorder = OrderFlowRecorder(symbols, token)
    if not recorder._keys:
        print("None of the requested symbols resolved to instrument keys. Exiting.")
        return 0

    stop = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    signal.signal(signal.SIGTERM, lambda *_: stop.set())

    recorder.start()
    print(f"Recording {len(recorder._keys)} instrument keys. Press Ctrl+C to stop.")
    try:
        while not stop.wait(GAP_WARN_SEC):
            recorder.check_gaps()
    finally:
        recorder.stop()
    print("Recorder stopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
