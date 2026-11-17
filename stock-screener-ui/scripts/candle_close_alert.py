#!/usr/bin/env python3
"""Desktop alerts one minute before 1H and 4H candle closes for GOLD, NQ and OIL."""

import argparse
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from candle_alert.clock import close_epoch, in_alert_window
from candle_alert.config import (
    DEFAULT_INTERVAL_SECONDS,
    DEFAULT_QUOTE_TTL_SECONDS,
    TIMEFRAMES,
    UTC,
    tf_label,
)
from candle_alert.notifier import notification_title, notify
from candle_alert.quotes import QuoteFetchError, cached_quotes
from candle_alert.render import build_rows, render_list, render_notification_body

_PREVIEW_TIMEFRAMES = {"1H": 60, "4H": 240}


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preview", choices=sorted(_PREVIEW_TIMEFRAMES),
                        help="print a notification preview for one timeframe and exit")
    parser.add_argument("--once", action="store_true",
                        help="print the candle board once and exit")
    parser.add_argument("--interval", type=float, default=DEFAULT_INTERVAL_SECONDS,
                        help="loop poll interval in seconds (default: %(default)s)")
    parser.add_argument("--quote-ttl", type=float, default=DEFAULT_QUOTE_TTL_SECONDS,
                        help="quote cache lifetime in seconds (default: %(default)s)")
    parser.add_argument("--no-notify", action="store_true",
                        help="log alerts without calling notify-send")
    return parser.parse_args(argv)


def tick(now, quotes, fired, emit=True):
    """Fire every due alert once; returns the list of (timeframe, body) pairs."""
    rows = build_rows(quotes, now)
    fired_alerts = []
    for tf in TIMEFRAMES:
        if not in_alert_window(tf, now):
            continue
        key = (tf, close_epoch(tf, now))
        if key in fired:
            continue
        fired.add(key)
        body = render_notification_body(
            [row for row in rows if row["tf_label"] == tf_label(tf)]
        )
        if emit:
            notify(notification_title(tf_label(tf)), body)
        fired_alerts.append((tf_label(tf), body))
    return fired_alerts


def main(argv=None):
    args = parse_args(argv)
    try:
        quotes = cached_quotes(args.quote_ttl, now=datetime.now(UTC).timestamp())
    except QuoteFetchError as exc:
        print(f"quote fetch failed: {exc}", file=sys.stderr)
        return 1

    now = datetime.now(UTC)
    print(render_list(build_rows(quotes, now), now), end="", flush=True)

    if args.once:
        return 0

    if args.preview:
        tf = _PREVIEW_TIMEFRAMES[args.preview]
        rows = build_rows(quotes, now)
        print(render_notification_body(
            [row for row in rows if row["tf_label"] == tf_label(tf)]
        ), end="", flush=True)
        return 0

    fired = set()
    while True:
        now = datetime.now(UTC)
        try:
            quotes = cached_quotes(args.quote_ttl, now=now.timestamp())
        except QuoteFetchError as exc:
            print(f"quote fetch failed: {exc}", file=sys.stderr)
            time.sleep(args.interval)
            continue
        tick(now, quotes, fired)
        time.sleep(args.interval)


if __name__ == "__main__":
    sys.exit(main())
