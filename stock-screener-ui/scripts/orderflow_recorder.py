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
import os
import signal
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


def _install_log_redaction() -> None:
    """Scrub credential-adjacent values from broker/transport error logs."""
    try:
        from api.orderflow_logging import install_error_redaction

        install_error_redaction()
    except Exception:
        pass


#: How long broker/SDK teardown may take before the process exits regardless.
_TEARDOWN_TIMEOUT_SEC = 5.0

#: Exit (non-zero, so a supervisor restarts) after this long with no tick from
#: any symbol while the market is open. A dropped socket or expired session
#: otherwise just looks like a quiet market for the rest of the day.
_STALL_EXIT_SEC = float(os.getenv("ORDERFLOW_RECORDER_STALL_SEC", "300"))


def _safe_stop(recorder) -> None:
    """Stop the recorder without letting a hung SDK teardown escape."""
    try:
        recorder.stop()
    except Exception:
        pass


def main(argv=None) -> int:
    from api.orderflow_recorder import (
        GAP_WARN_SEC,
        OrderFlowRecorder,
        recorder_broker,
        recorder_symbols,
        recorder_token,
    )
    from trading.utils import is_market_open

    parser = argparse.ArgumentParser(description="Headless order-flow recorder")
    parser.add_argument(
        "--symbols",
        help="Comma-separated symbols (overrides ORDERFLOW_RECORDER_SYMBOLS)",
    )
    parser.add_argument(
        "--broker",
        help="Feed broker (overrides ORDERFLOW_RECORDER_BROKER), e.g. fyers_tbt",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Resolve broker/token/symbols, print them and exit (no feed opened)",
    )
    args = parser.parse_args(argv)

    # The broker decides both the token format and the symbol mapping, so it is
    # resolved first and honoured all the way through. Hardcoding Upstox here
    # silently recorded the wrong feed no matter what ORDERFLOW_RECORDER_BROKER
    # said — the journal looked healthy while containing another broker's ticks.
    _install_log_redaction()

    broker = (args.broker or recorder_broker()).strip().lower()
    symbols = (
        [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
        if args.symbols
        else recorder_symbols()
    )
    if not symbols:
        print("No symbols configured (use --symbols or ORDERFLOW_RECORDER_SYMBOLS).")
        return 0

    from api.orderflow_adapters import available_adapters, get_adapter

    adapter_cls = get_adapter(broker)
    if adapter_cls is None:
        print(
            f"Unknown broker '{broker}'. Available: {', '.join(available_adapters())}. Exiting."
        )
        return 1

    # The recorder holds one connection, so the symbol count must fit inside it.
    # Fyers TBT allows 5 symbols/connection; silently recording fewer would look
    # like a clean run with missing symbols.
    limit = getattr(adapter_cls, "max_symbols_per_connection", None)
    if limit and len(symbols) > limit:
        print(
            f"{broker} allows {limit} symbols per connection but {len(symbols)} were "
            f"requested ({','.join(symbols)}). Reduce ORDERFLOW_RECORDER_SYMBOLS. Exiting."
        )
        return 1

    token = recorder_token(broker)
    print(f"Order-flow recorder: broker={broker} symbols={','.join(symbols)}")
    if not token:
        print(f"No {broker} access token available — connect the broker in Settings. Exiting.")
        return 0

    if args.dry_run:
        print(f"Dry run: token resolved for {broker}, market_open={is_market_open()}. Exiting.")
        return 0

    if not is_market_open():
        print("Market is closed — no order flow to record. Exiting.")
        return 0

    recorder = OrderFlowRecorder(symbols, token, broker=broker)
    if not recorder._keys and recorder._adapter is None:
        print("None of the requested symbols resolved for the selected broker. Exiting.")
        return 0

    stop = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    signal.signal(signal.SIGTERM, lambda *_: stop.set())

    recorder.start()
    print(f"Recording {len(symbols)} symbols via {broker}. Press Ctrl+C to stop.")
    stalled = False
    try:
        while not stop.wait(GAP_WARN_SEC):
            if recorder.auth_failed:
                print(f"Stopping: {broker} rejected the session. Re-authenticate, then restart.")
                break
            recorder.check_gaps()
            # Watchdog: a silent feed must not be mistaken for a quiet market.
            if is_market_open() and recorder.staleness() >= _STALL_EXIT_SEC:
                print(
                    f"Stopping: no ticks for {recorder.staleness():.0f}s "
                    f"(>= {_STALL_EXIT_SEC:.0f}s). Restarting usually recovers the feed."
                )
                stalled = True
                break
        if recorder.auth_failed:
            print(f"Stopping: {broker} rejected the session. Re-authenticate, then restart.")
    finally:
        # Flush the journal BEFORE any teardown: a broker SDK disconnect() can
        # block on a dead socket (observed as a process stuck in futex_wait that
        # ignored SIGTERM), which used to leave an orphan holding broker
        # connections on every restart.
        try:
            from api import orderflow_journal

            orderflow_journal.close_all()
        except Exception:
            pass
        teardown = threading.Thread(target=_safe_stop, args=(recorder,), daemon=True)
        teardown.start()
        teardown.join(timeout=_TEARDOWN_TIMEOUT_SEC)
        if teardown.is_alive():
            print(f"Recorder teardown did not finish in {_TEARDOWN_TIMEOUT_SEC:.0f}s; exiting anyway.")
        sys.stdout.flush()
        # Non-zero tells a supervisor this was a failure, not "nothing to do".
        os._exit(2 if stalled else 0)
    print("Recorder stopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
