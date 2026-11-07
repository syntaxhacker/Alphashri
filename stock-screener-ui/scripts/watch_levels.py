#!/usr/bin/env python3
"""Block in the background until NIFTY spot crosses a level, then exit.

Why: while the tape chops, the main agent should not burn tokens polling every
10 s. Start this as a background process; it watches the **Upstox WebSocket**
(ltpc, NSE_INDEX|Nifty 50) and exits the moment a level is reached. The harness
notifies the session when the process ends, so the agent resumes instantly.

Pre-trigger: fires at ``pre_pct`` (default 0.95) of the distance from the
starting spot, leaving a small buffer for tool latency (min ``min_buffer``
pts). The buffer floor is capped at the level distance, so a trigger is never
armed beyond the spot it started from.

Break entries need a 1-min bar **close**, not a tick: pass ``--require-close``
to fire on the last completed 1-min bar from the NIFTY tape
(``experiments/data/nifty_tape/{date}.jsonl``) instead of the live LTP.
Tick mode stays the default for sideways/exit alerts.

Usage:
    python scripts/watch_levels.py \
        --levels "below:22690:break_pe,above:22800:cut_ce" \
        --out /tmp/opencode/watch_levels.json --timeout 1800

    python scripts/watch_levels.py --require-close \
        --levels "below:22690:break_pe" --timeout 1800
"""

from __future__ import annotations

import argparse
import json
import queue
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from config import IST  # single source of truth for IST
except Exception:  # pragma: no cover - fallback when config is unavailable
    IST = timezone(timedelta(hours=5, minutes=30))

REPO_ROOT = Path(__file__).resolve().parent.parent
TAPE_DIR = REPO_ROOT / "experiments" / "data" / "nifty_tape"

import requests  # noqa: E402

NIFTY_KEY = "NSE_INDEX|Nifty 50"
LTP_URL = "https://api.upstox.com/v2/market-quote/ltp"


def _token() -> str:
    from db.models.broker import get_shared_broker_token

    return (get_shared_broker_token("upstox") or {}).get("access_token", "")


def _fresh_token(previous: str = "") -> str:
    """The current Upstox token, re-read when the previous one stops working.

    The token is read from the DB on every call, so a re-auth mid-watch is
    picked up. Without this the watcher kept the token it loaded at startup:
    when the token died at 13:23 the live-confirm step failed on every poll
    and the watcher NEVER fired — it sat there looking armed while the tape
    had already closed below the level (2026-10-22).
    """
    token = _token()
    if token and token != previous:
        return token
    return previous or token


def _rest_spot(token: str, timeout: float = 8.0) -> float | None:
    try:
        r = requests.get(
            LTP_URL,
            params={"instrument_key": NIFTY_KEY},
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            timeout=timeout,
        )
        r.raise_for_status()
        for v in r.json().get("data", {}).values():
            px = v.get("last_price")
            if px:
                return float(px)
    except Exception:
        return None
    return None


def _parse_levels(spec: str) -> list[dict]:
    out = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        bits = part.split(":")
        if len(bits) < 2:
            raise ValueError(f"bad level spec: {part!r} (want side:level[:label])")
        side, level = bits[0].strip().lower(), float(bits[1])
        label = bits[2].strip() if len(bits) > 2 else f"{side}_{level:.0f}"
        if side not in ("below", "above"):
            raise ValueError(f"bad side: {side!r}")
        out.append({"side": side, "level": level, "label": label})
    if not out:
        raise ValueError("no levels given")
    return out


def _arm(levels: list[dict], spot: float, pre_pct: float, min_buffer: float) -> None:
    """Arm each level with a pre-trigger buffer.

    The buffer is ``max(min_buffer, (1 - pre_pct) * distance)`` — the
    ``min_buffer`` floor is a minimum number of POINTS, so a level 3 pts away
    still fires 2 pts early instead of at the level itself.

    The floor is CAPPED at the distance to the level: a floor larger than the
    distance would push the trigger past the starting spot and fire instantly
    (a 50-pt floor on a 10-pt-away level is a bug, not a safety margin).
    ``pre_pct`` is clamped to ``[0, 1]``: 1 fires AT the level (no buffer), 0
    fires at the starting spot (immediate). The CLI only accepts ``(0, 1]``;
    the clamp is the last line of defence for programmatic callers.
    """
    pre_pct = min(max(float(pre_pct), 0.0), 1.0)
    floor = max(0.0, float(min_buffer))
    for lv in levels:
        dist = max(0.0, (spot - lv["level"]) if lv["side"] == "below"
                   else (lv["level"] - spot))
        buf = max(floor, (1.0 - pre_pct) * dist)
        buf = min(buf, dist)  # never arm the trigger beyond the starting spot
        lv["trigger"] = (lv["level"] + buf) if lv["side"] == "below" else (lv["level"] - buf)
        lv["buffer"] = round(buf, 2)
        lv["distance"] = round(dist, 2)


def consume_complete_lines(buffer: str, chunk: str) -> tuple[list[str], str]:
    """Split ``buffer + chunk`` into COMPLETE lines; return ``(lines, buffer)``.

    The tail of a JSONL file can be a half-written line (the recorder is
    appending while we read). ``splitlines()`` would hand that fragment to the
    JSON parser, fail, and — because the file offset had already moved past
    it — the fragment would be LOST for good. Only newline-terminated lines
    are consumed; the remainder stays in the buffer for the next read.
    """
    data = (buffer or "") + (chunk or "")
    if not data:
        return [], buffer or ""
    parts = data.split("\n")
    tail = parts.pop()  # "" when the chunk ended on a newline
    return parts, tail


def _hit(levels: list[dict], spot: float) -> dict | None:
    for lv in levels:
        if lv["side"] == "below" and spot <= lv["trigger"]:
            return lv
        if lv["side"] == "above" and spot >= lv["trigger"]:
            return lv
    return None


def _parse_row_time(value: object) -> datetime | None:
    """Parse a tape row timestamp; naive values are assumed IST."""
    if not isinstance(value, str) or not value:
        return None
    try:
        ts = datetime.fromisoformat(value)
    except ValueError:
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=IST)
    return ts


def last_completed_bar(rows: list[dict], now: datetime) -> dict | None:
    """Return the last completed 1-min bar (its close row) from tape rows.

    A bar is complete when its minute is strictly before the current minute,
    so the still-forming bar is excluded. Each row is one tape tick with keys
    ``t`` (ISO timestamp) and ``spot`` (close of that tick); rows are grouped
    by minute and the latest tick of the latest completed minute wins.
    Malformed rows (bad ``t``, missing/non-numeric/non-positive ``spot``)
    are skipped. Naive ``now`` is assumed IST.
    """
    if now.tzinfo is None:
        now = now.replace(tzinfo=IST)
    cur_min = now.replace(second=0, microsecond=0)
    best_min: datetime | None = None
    best_ts: datetime | None = None
    close_row: dict | None = None
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            spot = float(row.get("spot"))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        if not spot > 0:
            continue
        ts = _parse_row_time(row.get("t"))
        if ts is None:
            continue
        bar_min = ts.replace(second=0, microsecond=0)
        if bar_min >= cur_min:
            continue  # forming bar (or future row): not complete yet
        if best_min is None or bar_min > best_min or (
            bar_min == best_min and (best_ts is None or ts > best_ts)
        ):
            best_min, best_ts, close_row = bar_min, ts, row
    return close_row


def bar_closes_beyond(bar: dict | None, side: str, trigger: float) -> bool:
    """True when the bar's ``spot`` close is beyond ``trigger``."""
    if not isinstance(bar, dict):
        return False
    try:
        close = float(bar.get("spot"))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return False
    if side == "below":
        return close <= trigger
    if side == "above":
        return close >= trigger
    return False


def _finish(out_path: str | None, payload: dict) -> None:
    text = json.dumps(payload)
    if out_path:
        Path(out_path).write_text(text + "\n")
    print(text, flush=True)


def _watch_ws(levels: list[dict], token: str, deadline: float) -> dict | None:
    """WS loop; returns the hit level or None on timeout/error."""
    q: queue.Queue = queue.Queue(maxsize=4096)
    stop = threading.Event()

    def _run():
        streamer = None
        try:
            import upstox_client
            from upstox_client import MarketDataStreamerV3

            cfg = upstox_client.Configuration()
            cfg.access_token = token
            client = upstox_client.ApiClient(cfg)
            streamer = MarketDataStreamerV3(client, [], mode="ltpc")

            def on_message(data):
                feeds = data.get("feeds", {}) if isinstance(data, dict) else {}
                for _k, feed in feeds.items():
                    ltp = ((feed or {}).get("ltpc") or {}).get("ltp")
                    if ltp:
                        try:
                            q.put_nowait(float(ltp))
                        except queue.Full:
                            pass

            def on_open():
                streamer.subscribe([NIFTY_KEY], "ltpc")

            streamer.on("message", on_message)
            streamer.on("open", on_open)
            streamer.connect()
            while not stop.is_set():
                stop.wait(timeout=1)
        except Exception as exc:  # noqa: BLE001
            try:
                q.put_nowait(("error", str(exc)))
            except queue.Full:
                pass
        finally:
            if streamer is not None:
                try:
                    streamer.disconnect()
                except Exception:
                    pass

    threading.Thread(target=_run, daemon=True).start()
    ws_seen = False
    while time.time() < deadline:
        try:
            item = q.get(timeout=1.0)
        except queue.Empty:
            if not ws_seen and time.time() > deadline - 1:
                break
            continue
        if isinstance(item, tuple) and item and item[0] == "error":
            stop.set()
            return None
        if isinstance(item, float):
            ws_seen = True
            hit = _hit(levels, item)
            if hit:
                stop.set()
                return {**hit, "spot": item, "source": "ws"}
    stop.set()
    return None


def _watch_close(
    levels: list[dict],
    token: str,
    deadline: float,
    interval: float,
    tape_path: Path,
    confirm_live: bool = True,
) -> dict | None:
    """Close-confirm loop; returns the hit level or None on timeout.

    Polls the 1-min tape ``tape_path`` every ``interval`` seconds and fires on
    the last completed bar's close (never on the live tick). When
    ``confirm_live`` is on, the live spot must still be beyond the trigger at
    fire time, rejecting bar closes that were already reclaimed.
    """
    rows: list[dict] = []
    pos = 0
    residual = ""  # half-written tail of the tape — never dropped
    rejected_bars: set[str] = set()
    fallback_spot: float | None = None
    while time.time() < deadline:
        # Re-read the token every poll: an expired token must not freeze the
        # watcher (2026-10-22 13:23 — it sat "armed" and never fired).
        token = _fresh_token(token) or token
        now = datetime.now(IST)
        try:
            with open(tape_path) as f:
                f.seek(pos)
                chunk = f.read()
                pos = f.tell()
        except FileNotFoundError:
            chunk = ""
        except OSError:
            chunk = ""
        lines, residual = consume_complete_lines(residual, chunk)
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        bar = last_completed_bar(rows, now)
        if bar is not None and str(bar.get("t")) not in rejected_bars:
            hit_lv: dict | None = None
            for lv in levels:
                if bar_closes_beyond(bar, lv["side"], lv["trigger"]):
                    hit_lv = lv
                    break
            if hit_lv is not None:
                try:
                    bar_close = float(bar.get("spot"))  # type: ignore[arg-type]
                except (TypeError, ValueError):
                    bar_close = 0.0
                if confirm_live:
                    live = _rest_spot(token)
                    if live is None:
                        # The token may have expired — re-read it and retry
                        # rather than silently waiting forever.
                        fresh = _fresh_token(token)
                        if fresh and fresh != token:
                            token = fresh
                            live = _rest_spot(token)
                        if live is None:
                            pass  # confirm failed; retry on the next poll
                    elif _hit([hit_lv], live):
                        return {
                            **hit_lv,
                            "spot": live,
                            "bar_close": bar_close,
                            "bar_t": bar.get("t"),
                            "source": "tape-close",
                        }
                    else:
                        # Bar closed beyond but live already reclaimed it.
                        rejected_bars.add(str(bar.get("t")))
                        fallback_spot = live
                else:
                    return {
                        **hit_lv,
                        "spot": bar_close,
                        "bar_close": bar_close,
                        "bar_t": bar.get("t"),
                        "source": "tape-close",
                    }
        if time.time() >= deadline:
            break
        time.sleep(max(0.1, interval))
    return None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--levels", required=True,
                    help='"below:22690:break_pe,above:22800:cut_ce"')
    ap.add_argument("--pre-pct", type=float, default=0.95,
                    help="fire at this fraction of the distance to the level "
                         "(0..1]; the remaining points are the buffer")
    ap.add_argument("--min-buffer", type=float, default=2.0,
                    help="minimum buffer in POINTS (floored at 0 and capped at "
                         "the level distance, so the trigger can never sit "
                         "beyond the starting spot)")
    ap.add_argument("--timeout", type=int, default=1800, help="seconds")
    ap.add_argument("--interval", type=float, default=1.0,
                    help="REST fallback poll seconds (tick mode)")
    ap.add_argument("--tape-interval", type=float, default=3.0,
                    help="tape poll seconds (only used with --require-close)")
    ap.add_argument("--require-close", action="store_true",
                    help="fire on the last completed 1-min bar close from the "
                         "nifty tape instead of the live LTP tick")
    ap.add_argument("--no-confirm-live", action="store_true",
                    help="in --require-close mode, skip the live-spot "
                         "reclaim check at fire time")
    ap.add_argument("--date", default="",
                    help="tape date YYYY-MM-DD (default: today IST)")
    ap.add_argument("--out", default="")
    args = ap.parse_args(argv)

    levels = _parse_levels(args.levels)
    if not 0.0 < args.pre_pct <= 1.0:
        print(f"error: --pre-pct must be in (0, 1], got {args.pre_pct}", file=sys.stderr)
        return 2
    if args.min_buffer < 0:
        print(f"error: --min-buffer must be >= 0, got {args.min_buffer}", file=sys.stderr)
        return 2
    token = _token()
    spot = _rest_spot(token)
    if not spot:
        _finish(args.out, {"triggered": False, "error": "no spot", "ts": datetime.now().isoformat()})
        return 2
    _arm(levels, spot, args.pre_pct, args.min_buffer)
    mode = "close" if args.require_close else "tick"
    print(json.dumps({"armed": levels, "spot": spot, "mode": mode,
                      "ts": datetime.now().isoformat()}), flush=True)

    deadline = time.time() + args.timeout
    if args.require_close:
        day = args.date or datetime.now(IST).strftime("%F")
        tape_path = TAPE_DIR / f"{day}.jsonl"
        hit = _watch_close(levels, token, deadline, args.tape_interval, tape_path,
                           confirm_live=not args.no_confirm_live)
        if hit is None:
            _finish(args.out, {"triggered": False, "mode": mode, "spot": spot,
                               "levels": levels, "ts": datetime.now().isoformat()})
            return 1
        _finish(args.out, {"triggered": True, "mode": mode, **hit,
                           "ts": datetime.now().isoformat()})
        return 0

    hit = _watch_ws(levels, token, min(deadline, time.time() + 20))
    if hit is None:
        # REST fallback: --interval cadence
        last = spot
        while time.time() < deadline:
            time.sleep(args.interval)
            cur = _rest_spot(token)
            if cur is None:
                continue
            last = cur
            h = _hit(levels, cur)
            if h:
                hit = {**h, "spot": cur, "source": "rest"}
                break
        if hit is None:
            _finish(args.out, {"triggered": False, "mode": mode, "spot": last,
                               "levels": levels, "ts": datetime.now().isoformat()})
            return 1

    _finish(args.out, {"triggered": True, "mode": mode, **hit, "ts": datetime.now().isoformat()})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
