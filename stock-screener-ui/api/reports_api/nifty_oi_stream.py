"""P1 — live OI over the Upstox WebSocket, so detection beats the 60s tape.

Why this exists
---------------
Every detector so far reads the tape, which is written by a REST snapshot of
the whole option chain **once a minute**. That 60s write is the floor on
detection latency: the 2026-10-13 call-OI explosion at 14:20 could not be
alerted before ~14:21:00. SSE (nifty_stream) removed the 30s *UI* tail, but not
this.

What it does
------------
Subscribes the NIFTY index (for spot) plus the ATM +/-N CE/PE legs over
``MarketDataStreamerV3`` in ``option_greeks`` mode, keeps a rolling OI/IV series
in memory, and runs the same first-difference + trailing-robust-baseline logic
the tape detectors use — only on a much shorter window.

``ltpc`` mode is NOT usable: it carries LTP only. The protobuf confirms OI/IV
live on ``firstLevelWithGreeks`` (``oi``, ``iv``) / ``fullFeed``, and the index
carries neither — hence subscribing the option legs explicitly.

Safety
------
* OFF unless ``NIFTY_OI_STREAM=1``.
* SHADOW by default (``NIFTY_OI_STREAM_SHADOW`` defaults on): it logs what it
  *would* alert and publishes nothing, so it can be diffed against the tape
  detectors for a session before it is trusted.
* Market-hours gated, every step wrapped, and the thread->async bridge uses a
  bounded queue so a stalled consumer drops ticks instead of blocking the feed.
"""

from __future__ import annotations

import logging
import os
import statistics
from collections import deque
from typing import Any

logger = logging.getLogger(__name__)

#: Master switch. Off by default — an untested live feed must not enable itself.
ENABLED = os.getenv("NIFTY_OI_STREAM", "").lower() in ("1", "true", "yes")
#: Shadow mode logs detections without publishing them. Default ON.
SHADOW = os.getenv("NIFTY_OI_STREAM_SHADOW", "1").lower() in ("1", "true", "yes")

#: How often the rolling state is evaluated.
SAMPLE_SEC = 5.0
#: Detection window. Shorter than the tape's 60s so a burst alerts sooner.
DETECT_WINDOW_SEC = 20.0
#: ATM +/- strikes subscribed (plus the index for spot).
ATM_N = 3
#: Per-key history kept (bounds memory; ~20 min at SAMPLE_SEC).
MAX_SAMPLES = 240
#: Re-resolve instrument keys this often (handles the expiry roll).
RESOLVE_EVERY_SEC = 900.0
#: Grace period before the first subscription (lets the tape settle).
START_DELAY_SEC = 20.0


def scaled_floor(per_minute_floor: float, window_sec: float) -> float:
    """Scale a validated per-minute floor to a shorter window.

    The tape thresholds were tuned on 60-second deltas, so a 20s window moves
    roughly a third as much. Scaling by ``window_sec / 60`` keeps sensitivity
    per unit time instead of firing on noise — the alternative (reusing the
    per-minute number) would detect nothing, and using a guessed constant would
    silently re-tune thresholds that were measured.
    """
    return float(per_minute_floor) * (float(window_sec) / 60.0)


def select_atm_contracts(
    contracts: list[dict],
    spot: float,
    n: int = ATM_N,
) -> list[dict[str, Any]]:
    """ATM +/- ``n`` strikes with their CE/PE instrument keys.

    The REST ``/option/chain`` response already carries
    ``call_options.instrument_key`` / ``put_options.instrument_key`` per strike,
    so no trading-symbol parsing is needed.
    """
    rows = []
    for c in contracts or []:
        if not isinstance(c, dict):
            continue
        try:
            strike = float(c.get("strike_price") or 0)
        except (TypeError, ValueError):
            continue
        if not strike:
            continue
        ce = (c.get("call_options") or {}).get("instrument_key") or ""
        pe = (c.get("put_options") or {}).get("instrument_key") or ""
        if not ce or not pe:
            continue
        rows.append({"strike": strike, "ce_key": ce, "pe_key": pe})
    if not rows:
        return []
    rows.sort(key=lambda r: abs(r["strike"] - float(spot or 0)))
    kept = rows[: max(1, 2 * n + 1)]
    kept.sort(key=lambda r: r["strike"])
    return kept


#: Per-strike floor per minute. CALIBRATED, not guessed: on 2026-10-14 a quiet
#: 150s window showed a maximum 20s per-strike |ΔOI| of 80,340 with a median of
#: 0, so the index-scale floor (2M/min) could never fire on a single strike.
#: 200k/min -> 66.7k per 20s -> an effective watch gate of ~200k per 20s, i.e.
#: ~2.5x the quiet maximum. Re-measure and re-tune if the OI scale changes.
STRIKE_MIN_ABS_PER_MIN = 200_000.0


def detect_oi_ticks(
    series: dict[tuple[float, str], list[tuple[float, float]]],
    *,
    window_sec: float = DETECT_WINDOW_SEC,
    min_abs_per_min: float = STRIKE_MIN_ABS_PER_MIN,
    warmup: int = 3,
    tiers: tuple[float, float, float] = (3.0, 5.0, 8.0),
) -> list[dict[str, Any]]:
    """OI bursts from rolling tick series — pure, so it is testable.

    ``series`` maps ``(strike, leg)`` to an ascending list of ``(ts, oi)``
    samples. For the newest sample the delta over ``window_sec`` is compared
    with the median of the previous deltas of the same span; a hit needs both
    the scaled absolute floor and a score above the watch tier.

    The default floor is per-strike and measured (see
    ``STRIKE_MIN_ABS_PER_MIN``), not the index floor: a single strike's whole OI
    is often under 1M, so an index-sized floor could never fire here.
    """
    watch, alert, critical = tiers
    floor = scaled_floor(min_abs_per_min, window_sec)
    out: list[dict[str, Any]] = []

    for (strike, leg), samples in (series or {}).items():
        if len(samples) < warmup + 1:
            continue
        ts_now, oi_now = samples[-1]
        window_start = ts_now - window_sec
        # Samples inside the detection window, oldest first.
        window = [s for s in samples if s[0] >= window_start]
        if len(window) < 2:
            continue
        delta = oi_now - window[0][1]
        magnitude = abs(delta)
        if magnitude < floor:
            continue

        # Baseline: spans that CLOSED before the window opened, each normalised
        # to the window length so a 5s sample and a 30s gap are comparable.
        deltas = []
        for a, b in zip(samples, samples[1:]):
            if b[0] > window_start:
                continue
            span = b[0] - a[0]
            if span <= 0:
                continue
            deltas.append(abs(b[1] - a[1]) * (window_sec / span))
        if len(deltas) < warmup:
            continue
        baseline = max(floor, statistics.median(deltas[-30:]))
        score = magnitude / baseline if baseline > 0 else 0.0
        if score < watch:
            continue

        out.append({
            "id": f"stream-{int(ts_now)}-{strike:.0f}-{leg}",
            "type": "strike" if strike else "burst",
            "side": "call" if leg == "ce" else "put",
            "leg": "CE" if leg == "ce" else "PE",
            "strike": strike,
            "t": _iso(ts_now),
            "delta": delta,
            "baseline": baseline,
            "score": round(score, 3),
            "severity": ("critical" if score >= critical
                         else "alert" if score >= alert
                         else "watch"),
            "source": "ws",
        })
    return out


def _iso(ts: float) -> str:
    from datetime import datetime

    import config

    return datetime.fromtimestamp(float(ts), tz=config.IST).isoformat()


class RollingOi:
    """Bounded per-key ``(ts, oi)`` history. Thread-safe enough for one writer."""

    def __init__(self, max_samples: int = MAX_SAMPLES) -> None:
        self._series: dict[tuple[float, str], deque] = {}
        self._max = max(1, int(max_samples))

    def push(self, strike: float, leg: str, ts: float, oi: float) -> None:
        key = (float(strike), leg)
        dq = self._series.get(key)
        if dq is None:
            dq = deque(maxlen=self._max)
            self._series[key] = dq
        dq.append((float(ts), float(oi)))

    def snapshot(self) -> dict[tuple[float, str], list[tuple[float, float]]]:
        return {k: list(v) for k, v in self._series.items() if v}

    def keys(self) -> list[tuple[float, str]]:
        return list(self._series.keys())


def _resolve_subscriptions() -> tuple[list[str], dict[str, tuple[float, str]]]:
    """(instrument keys to subscribe, key -> (strike, leg)) from one chain fetch.

    Blocking (REST) — call via a thread.
    """
    import requests

    from api.options import get_instrument_key
    from api.paper.live_stream import _get_upstox_token  # the app's token path

    token = _get_upstox_token()
    if not token:
        return [], {}

    base = "https://api.upstox.com/v2"
    headers = {"Accept": "application/json", "Authorization": f"Bearer {token}"}

    underlying = get_instrument_key("NIFTY")
    # Nearest expiry that still has quotes.
    r = requests.get(f"{base}/option/contract", params={"instrument_key": underlying},
                     headers=headers, timeout=20)
    expiries = sorted({c.get("expiry") for c in (r.json().get("data") or [])
                       if isinstance(c, dict) and c.get("expiry")})
    if not expiries:
        return [], {}
    expiry = expiries[0]

    r = requests.get(f"{base}/option/chain",
                     params={"instrument_key": underlying, "expiry_date": expiry},
                     headers=headers, timeout=20)
    payload = r.json()
    contracts = payload.get("data") or []
    spot = payload.get("underlying_spot_price") or 0
    if not spot and contracts:
        spot = contracts[0].get("underlying_spot_price") or 0

    selected = select_atm_contracts(contracts, spot, ATM_N)
    mapping: dict[str, tuple[float, str]] = {}
    for row in selected:
        mapping[row["ce_key"]] = (row["strike"], "ce")
        mapping[row["pe_key"]] = (row["strike"], "put")
    mapping[underlying] = (0.0, "index")
    return list(mapping.keys()), mapping


async def nifty_oi_stream_task() -> None:
    """WS consumer → rolling OI → detectors → (shadow log | publish)."""
    import asyncio
    import queue as thr_queue
    import threading
    import time

    if not ENABLED:
        logger.info("nifty OI stream: disabled (set NIFTY_OI_STREAM=1)")
        return

    from trading.utils import is_market_open

    await asyncio.sleep(START_DELAY_SEC)
    rings = RollingOi()
    key_map: dict[str, tuple[float, str]] = {}
    last_resolve = 0.0

    while True:
        try:
            if not is_market_open():
                await asyncio.sleep(60)
                continue

            if not key_map or (time.time() - last_resolve) > RESOLVE_EVERY_SEC:
                try:
                    keys, mapping = await asyncio.to_thread(_resolve_subscriptions)
                    if keys:
                        key_map, last_resolve = mapping, time.time()
                        logger.info("nifty OI stream: %s keys resolved", len(keys))
                except Exception as exc:
                    logger.warning("nifty OI stream: resolve failed: %s", exc)

            if not key_map:
                await asyncio.sleep(30)
                continue

            # --- WS session (blocking) lives in a thread; ticks hop via a queue
            q: thr_queue.Queue = thr_queue.Queue(maxsize=20000)
            closed = threading.Event()
            streamer = _run_ws(key_map, q, closed)

            deadline = time.time() + RESOLVE_EVERY_SEC
            next_eval = time.time() + SAMPLE_SEC
            try:
                while time.time() < deadline and not closed.is_set():
                    try:
                        tick = q.get_nowait()
                    except thr_queue.Empty:
                        await asyncio.sleep(0.25)
                        continue
                    rings.push(tick["strike"], tick["leg"], tick["ts"], tick["oi"])

                    # Evaluate on a CADENCE, not per tick. The feed delivers ~29
                    # updates/sec across the keys; scoring every one re-copied
                    # every ring and ran medians 29x/sec, which starved the event
                    # loop and made the whole API (including /health)
                    # unresponsive.
                    if time.time() < next_eval:
                        continue
                    next_eval = time.time() + SAMPLE_SEC

                    events = detect_oi_ticks(
                        rings.snapshot(), window_sec=DETECT_WINDOW_SEC
                    )
                    if not events:
                        continue
                    if SHADOW:
                        for e in events[:3]:
                            logger.info(
                                "nifty OI stream [shadow] %s %s %s delta=%.0f score=%.1f",
                                e["severity"], e["leg"], e["strike"],
                                e["delta"], e["score"],
                            )
                    else:
                        from api.reports_api.nifty_stream import publish

                        publish(events)
            finally:
                closed.set()
                # The socket MUST be closed: ``connect()`` returns immediately
                # and the SDK keeps the connection (and its thread) alive, so
                # without this every 15-minute cycle leaked one Upstox WS.
                _disconnect(streamer)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("nifty OI stream error: %s", exc)
            await asyncio.sleep(15)


def _disconnect(streamer) -> None:
    """Close the Upstox socket best-effort (never raises)."""
    try:
        if streamer is None:
            return
        streamer.disconnect()
    except Exception as exc:
        logger.debug("nifty OI stream: disconnect failed: %s", exc)


def _run_ws(key_map: dict[str, tuple[float, str]], q, closed):
    """Own the Upstox WS for this session (runs inside a worker thread).

    Returns the streamer so the caller can close the socket when the session
    ends (``connect()`` returns immediately, so the socket would otherwise stay
    open for the life of the process).
    """
    import queue as thr_queue

    streamer = None
    try:
        import upstox_client
        from upstox_client import MarketDataStreamerV3

        from api.paper.live_stream import _get_upstox_token

        token = _get_upstox_token()
        cfg = upstox_client.Configuration()
        cfg.access_token = token
        client = upstox_client.ApiClient(cfg)

        # option_greeks carries oi + iv; ltpc does not.
        streamer = MarketDataStreamerV3(client, [], mode="option_greeks")
        instrument_keys = list(key_map.keys())

        def on_message(data):
            if closed.is_set():
                return
            feeds = data.get("feeds", {}) if isinstance(data, dict) else {}
            for ikey, feed in feeds.items():
                if not isinstance(feed, dict):
                    continue
                strike, leg = key_map.get(ikey, (0.0, ""))
                if leg not in ("ce", "pe"):
                    continue
                # option_greeks: oi/iv are flat fields alongside ltpc.
                oi = feed.get("oi")
                if oi is None:
                    oi = ((feed.get("firstLevelWithGreeks") or {}).get("oi"))
                if oi is None:
                    continue
                ltt = ((feed.get("ltpc") or {}) or {}).get("ltt")
                try:
                    ts = float(ltt) / 1000.0 if ltt else __import__("time").time()
                except (TypeError, ValueError):
                    ts = __import__("time").time()
                try:
                    q.put_nowait({"strike": strike, "leg": leg, "ts": ts, "oi": float(oi)})
                except thr_queue.Full:
                    pass

        def on_error(err):
            logger.warning("nifty OI stream WS error: %s", err)
            closed.set()

        streamer.on("message", on_message)
        streamer.on("error", on_error)
        streamer.on("open", lambda: streamer.subscribe(instrument_keys, "option_greeks"))
        streamer.connect()
        return streamer
    except Exception as exc:
        logger.warning("nifty OI stream WS failed: %s", exc)
        closed.set()
        _disconnect(streamer)
        return None
