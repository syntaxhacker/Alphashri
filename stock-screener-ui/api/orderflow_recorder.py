"""
Server-side (headless) full-session order-flow recorder.

Runs ONE Upstox ``MarketDataStreamerV3`` in ``full`` mode for a configurable
symbol list, normalizes every tick with the existing bridge helpers, journals
it, and runs a per-symbol :class:`OrderFlowSignalEngine`. No browser tab is
required, so the session is captured continuously from the API process.

The recorder is started from the FastAPI lifespan during market hours. It can
also be driven by the standalone ``scripts/orderflow_recorder.py`` runner.
"""

import asyncio
import logging
import os
import time
from typing import Optional

from api import orderflow_journal
from api.orderflow_signals import OrderFlowSignalEngine
from api.orderflow_stream import (
    _normalize_market_status,
    _normalize_tick,
    _resolve_instrument_key,
)

logger = logging.getLogger("orderflow.recorder")

GAP_WARN_SEC = 15.0
_POLL_SEC = 60

# Liquid NSE cash names + the NIFTY 50 index key (passthrough in
# ``_resolve_instrument_key`` because it already contains ``|``).
_DEFAULT_SYMBOLS = ["RELIANCE", "TCS", "INFY", "SBIN", "ICICIBANK"]
_NIFTY_INDEX_KEY = "NSE_INDEX|Nifty 50"


def recorder_symbols() -> list[str]:
    """Symbols to record, from ``ORDERFLOW_RECORDER_SYMBOLS`` or the default."""
    raw = os.getenv("ORDERFLOW_RECORDER_SYMBOLS")
    if raw is None or not raw.strip():
        candidates = [*_DEFAULT_SYMBOLS, _NIFTY_INDEX_KEY]
    else:
        candidates = [s.strip().upper() for s in raw.split(",") if s.strip()]

    seen: set[str] = set()
    out: list[str] = []
    for symbol in candidates:
        if symbol and symbol not in seen:
            seen.add(symbol)
            out.append(symbol)
    return out


def _default_streamer_factory(token: str):
    """Construct the real Upstox full-mode streamer (lazy SDK import)."""
    import upstox_client
    from upstox_client import MarketDataStreamerV3

    cfg = upstox_client.Configuration()
    cfg.access_token = token
    client = upstox_client.ApiClient(cfg)
    return MarketDataStreamerV3(client, [], mode="full")


class OrderFlowRecorder:
    """Headless recorder for a fixed symbol list using one Upstox stream."""

    def __init__(self, symbols, token: str, streamer_factory=None):
        self.symbols = [s for s in (symbols or []) if s]
        self.token = token
        self._streamer_factory = streamer_factory or _default_streamer_factory
        self._streamer = None
        self._running = False
        # instrument_key -> symbol, and symbol -> per-symbol engine.
        self._keys: dict[str, str] = {}
        self._engines: dict[str, OrderFlowSignalEngine] = {}
        self._last_tick: dict[str, float] = {}
        self._last_gap_warn: dict[str, float] = {}

        for symbol in self.symbols:
            key = _resolve_instrument_key(symbol, "NSE")
            if not key:
                logger.warning("orderflow recorder: unresolved symbol %s", symbol)
                continue
            self._keys[key] = symbol
            self._engines[symbol] = OrderFlowSignalEngine()

    # ------------------------------------------------------------------ lifecycle
    def start(self) -> None:
        if self._running:
            return
        if not self._keys:
            logger.warning("orderflow recorder: no resolved symbols; not starting")
            return

        streamer = self._streamer_factory(self.token)
        self._streamer = streamer
        streamer.on("open", self._on_open)
        streamer.on("message", self.on_message)
        streamer.on("error", self._on_error)
        streamer.on("close", self._on_close)
        streamer.on("reconnecting", self._on_reconnecting)

        now = time.monotonic()
        self._last_tick = {symbol: now for symbol in self._engines}
        self._last_gap_warn = dict(self._last_tick)
        self._running = True
        logger.info(
            "orderflow recorder starting: %d symbols, %d instrument keys",
            len(self._engines),
            len(self._keys),
        )
        try:
            streamer.connect()
        except Exception as exc:  # noqa: BLE001 - start must not crash the caller
            logger.warning("orderflow recorder connect failed: %s", exc)

    def stop(self) -> None:
        self._running = False
        streamer, self._streamer = self._streamer, None
        if streamer is not None:
            try:
                streamer.disconnect()
            except Exception:  # noqa: BLE001
                pass
        logger.info("orderflow recorder stopped")

    # ------------------------------------------------------------------- handlers
    def _on_open(self) -> None:
        keys = list(self._keys)
        try:
            self._streamer.subscribe(keys, "full")
            logger.info("orderflow recorder subscribed %d keys", len(keys))
        except Exception as exc:  # noqa: BLE001
            logger.warning("orderflow recorder subscribe failed: %s", exc)

    def _on_error(self, err) -> None:
        logger.warning("orderflow recorder stream error: %s", err)

    def _on_close(self, *args) -> None:
        logger.warning("orderflow recorder stream closed: %s", args)

    def _on_reconnecting(self, *args) -> None:
        logger.warning("orderflow recorder reconnecting: %s", args)

    def on_message(self, data) -> None:
        """Route one decoded feed message to per-symbol journal + engine."""
        if not isinstance(data, dict):
            return

        status = _normalize_market_status(data)
        if status:
            logger.info("orderflow recorder market status: %s", status.get("segments"))
            return

        feeds = data.get("feeds")
        if not isinstance(feeds, dict) or not feeds:
            return

        for key, feed in feeds.items():
            symbol = self._keys.get(key)
            if not symbol or not isinstance(feed, dict):
                continue
            tick = _normalize_tick({key: feed})
            if not tick or not isinstance(tick.get("data"), dict):
                continue
            self._record_tick(symbol, tick["data"])

    def _record_tick(self, symbol: str, tick: dict) -> None:
        orderflow_journal.append(symbol, "tick", tick)
        self._last_tick[symbol] = time.monotonic()

        engine = self._engines.get(symbol)
        if engine is None:
            return
        signal = engine.update(tick)
        if signal:
            orderflow_journal.append(symbol, "signal", signal)

    # -------------------------------------------------------------------- health
    def check_gaps(self, now: Optional[float] = None) -> None:
        """Log a warning for symbols with no tick within ``GAP_WARN_SEC``."""
        now = time.monotonic() if now is None else now
        for symbol, last in self._last_tick.items():
            if now - last < GAP_WARN_SEC:
                continue
            if now - self._last_gap_warn.get(symbol, 0.0) < GAP_WARN_SEC:
                continue
            self._last_gap_warn[symbol] = now
            logger.warning(
                "orderflow recorder: no tick for %s in %.0fs", symbol, now - last
            )


def run_recorder(stop_event=None) -> None:
    """Blocking convenience loop used by the standalone runner / threads."""
    from api.paper.live_stream import _get_upstox_token

    token = _get_upstox_token()
    if not token:
        logger.error("orderflow recorder: no Upstox access token; not starting")
        return

    recorder = OrderFlowRecorder(recorder_symbols(), token)
    recorder.start()
    try:
        while not (stop_event is not None and stop_event.is_set()):
            recorder.check_gaps()
            if stop_event is not None:
                stop_event.wait(GAP_WARN_SEC)
            else:
                time.sleep(GAP_WARN_SEC)
    except KeyboardInterrupt:
        pass
    finally:
        recorder.stop()


def _ci_mode() -> bool:
    return os.getenv("CI_MODE", "").lower() in ("1", "true", "yes")


async def recorder_task() -> None:
    """FastAPI background task: one recorder start/stop per trading day.

    Polls the canonical market-open check every 60s, starts the recorder while
    the market is open, and stops it after close. Never raises.
    """
    if _ci_mode():
        logger.info("orderflow recorder: CI_MODE — not starting")
        return

    from api.paper.live_stream import _get_upstox_token
    from trading.utils import is_market_open

    recorder: Optional[OrderFlowRecorder] = None
    try:
        while True:
            try:
                if is_market_open():
                    if recorder is None:
                        token = await asyncio.to_thread(_get_upstox_token)
                        if not token:
                            logger.warning(
                                "orderflow recorder: no Upstox token; will retry"
                            )
                        else:
                            recorder = OrderFlowRecorder(recorder_symbols(), token)
                            await asyncio.to_thread(recorder.start)
                elif recorder is not None:
                    await asyncio.to_thread(recorder.stop)
                    recorder = None
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - background task must survive
                logger.warning("orderflow recorder task error: %s", exc)

            await asyncio.sleep(_POLL_SEC)
    finally:
        if recorder is not None:
            try:
                await asyncio.to_thread(recorder.stop)
            except Exception:  # noqa: BLE001
                pass
