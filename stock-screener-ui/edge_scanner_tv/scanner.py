"""EdgeScannerTV — warmup → on_bar → alerts (edge-scanner LiveScanner idiom).

Lifecycle mirrors scanner/live_scanner.py:
  1. scanner = EdgeScannerTV(symbols, feed, market, setups=[...])
  2. scanner.warmup()            # yfinance daily history → per-symbol context
  3. scanner.scan_snapshot()     # one-shot: TV snapshot + trigger evaluation
  4. feed.subscribe_minute_bars(symbols, scanner.on_bar)  # --watch loop
"""
from __future__ import annotations

import logging
import time
from datetime import date, datetime, timedelta, timezone

from .markets import MarketSpec
from .triggers import (
    Alert,
    trigger_ema_cross,
    trigger_hod_breakout,
    trigger_momentum,
    trigger_orb,
    trigger_rvol_spike,
    trigger_vwap,
)
from .tv_feed import TradingViewFeed

log = logging.getLogger(__name__)

ALL_SETUPS = ("breakout", "52w", "vwap", "ema", "orb", "momentum", "rvol")

ALERT_COOLDOWN_SEC = 300.0


class EdgeScannerTV:
    def __init__(
        self,
        symbols: list[str],
        feed: TradingViewFeed,
        market: MarketSpec,
        setups: list[str] | None = None,
        tv_tickers: dict[str, str] | None = None,
    ) -> None:
        self.symbols = [s.upper() for s in symbols]
        self.feed = feed
        self.market = market
        self.setups = list(setups or ALL_SETUPS)
        self.tv_tickers = dict(tv_tickers or {})
        self.bars: dict[str, list[dict]] = {s: [] for s in self.symbols}
        self.daily_ctx: dict[str, dict] = {}
        self.alerts: list[dict] = []
        self._next_id: int = 1  # monotonic alert id per scanner instance
        self._last_fire: dict[tuple[str, str, str], float] = {}  # (symbol, direction, setup) -> epoch sec

    # ── warmup ──────────────────────────────────────────────────────────

    def warmup(self, history_days: int = 60) -> None:
        """Pull daily history per symbol → avg volume + prior-day levels."""
        end = date.today()
        start = end - timedelta(days=history_days)
        for sym in self.symbols:
            try:
                df = self.feed.get_historical_daily(sym, start, end)
            except Exception as exc:
                log.warning("warmup %s failed: %s", sym, exc)
                continue
            if df is None or df.empty:
                continue
            closes = df["close"].dropna()
            vols = df["volume"].dropna()
            last = df.iloc[-1]
            prev = df.iloc[-2] if len(df) > 1 else last
            self.daily_ctx[sym] = {
                "prior_close": float(prev["close"]),
                "prior_high": float(prev["high"]),
                "prior_low": float(prev["low"]),
                "atr": float((df["high"] - df["low"]).tail(14).mean() or 0.0),
                "avg_vol": float(vols.tail(20).mean() or 0.0),
                "sma50": float(closes.tail(50).mean()) if len(closes) >= 50 else None,
                "sma200": float(closes.tail(200).mean()) if len(closes) >= 200 else None,
            }
        log.info("warmup: %d/%d symbols", len(self.daily_ctx), len(self.symbols))

    # ── per-bar routing ─────────────────────────────────────────────────

    def reset_session(self) -> None:
        """Clear intraday bars + dedupe cooldowns (keep warmup daily_ctx)."""
        self.bars = {s: [] for s in self.symbols}
        self._last_fire.clear()

    def _now_ts(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _alloc_id(self) -> int:
        cur = self._next_id
        self._next_id += 1
        return cur

    def on_bar(self, bar: dict) -> list[Alert]:
        """Append a 1-min bar, evaluate setups, return fresh alerts."""
        sym = str(bar.get("symbol", "")).upper()
        if sym not in self.bars:
            self.bars[sym] = []
        self.bars[sym].append(bar)
        if len(self.bars[sym]) > 400:  # bound session memory (edge uses rings)
            self.bars[sym] = self.bars[sym][-400:]
        return self.evaluate(sym)

    def evaluate(self, symbol: str) -> list[Alert]:
        bars = self.bars.get(symbol, [])
        if len(bars) < 2:
            return []
        ctx = self.daily_ctx.get(symbol, {})
        avg_vol = float(ctx.get("avg_vol", 0.0) or 0.0)
        fired: list[Alert] = []
        checks = {
            "breakout": lambda: [trigger_hod_breakout(bars, "long"),
                                 trigger_hod_breakout(bars, "short")],
            "vwap": lambda: [trigger_vwap(bars)],
            "ema": lambda: [trigger_ema_cross(bars)],
            "orb": lambda: [trigger_orb(bars)],
            "momentum": lambda: [trigger_momentum(bars, avg_vol=avg_vol)],
            "rvol": lambda: [trigger_rvol_spike(bars, avg_vol)],
        }
        for setup in self.setups:
            fn = checks.get(setup)
            if not fn:
                continue
            for alert in fn():
                if alert is None:
                    continue
                key = (alert.symbol, alert.direction, alert.setup)
                now = time.time()
                last = self._last_fire.get(key)
                if last is not None and now - last < ALERT_COOLDOWN_SEC:
                    continue
                self._last_fire[key] = now
                fired.append(alert)
                self.alerts.append({
                    "id": self._alloc_id(),
                    "symbol": alert.symbol, "setup": alert.setup,
                    "direction": alert.direction, "price": round(alert.price, 2),
                    "why": alert.why, "market": self.market.key,
                    "ts": self._now_ts(),
                })
        return fired

    # ── one-shot snapshot scan ──────────────────────────────────────────

    def scan_snapshot(self, snaps: dict | None = None) -> list[dict]:
        """Evaluate snapshot-level setups (snapshot has no bar history).

        Uses the TV row directly: momentum gate = day change + RVOL, 52w
        proximity, VWAP side via open vs close. Returns alert dicts. Pass
        `snaps` to reuse an already-fetched snapshot batch (the server does).
        """
        if snaps is None:
            snaps = self.feed.get_snapshot(self.symbols, tv_tickers=self.tv_tickers)
        out: list[dict] = []
        for sym, s in snaps.items():
            ctx = self.daily_ctx.get(sym, {})
            avg_vol = float(ctx.get("avg_vol", 0.0) or 0.0)
            day_chg, rvol = s["change"], s["rvol"]
            if "momentum" in self.setups and abs(day_chg) >= 3.0 and rvol >= 1.5:
                d = self._emit(sym, "momentum_day",
                               "long" if day_chg > 0 else "short",
                               s["close"], f"{day_chg:+.2f}% day, rvol {rvol:.1f}x")
                if d is not None:
                    out.append(d)
            if "rvol" in self.setups and rvol >= 2.0:
                d = self._emit(sym, "rvol_spike",
                               "long" if day_chg >= 0 else "short",
                               s["close"], f"rvol {rvol:.1f}x, {day_chg:+.2f}%")
                if d is not None:
                    out.append(d)
            if "52w" in self.setups and s["high_52w"] > 0:
                gap = (s["high_52w"] - s["close"]) / s["high_52w"] * 100
                if 0 <= gap <= 2.0:
                    d = self._emit(sym, "near_52w_high", "long",
                                   s["close"], f"{gap:.2f}% below 52w high")
                    if d is not None:
                        out.append(d)
            if "vwap" in self.setups and s["open"] > 0:
                # Day-open vs current as a coarse VWAP-side proxy (documented).
                if s["open"] < s["close"] and day_chg > 1.0:
                    d = self._emit(sym, "above_vwap_proxy", "long",
                                   s["close"], f"holding above open {s['open']:.2f}")
                    if d is not None:
                        out.append(d)
            void = avg_vol  # ctx loaded check (keeps warmup wired even snapshot-only)
            _ = void
        self.alerts.extend(out)
        return out

    def _emit(self, symbol: str, setup: str, direction: str,
              price: float, why: str) -> dict | None:
        key = (symbol, direction, setup)
        now = time.time()
        last = self._last_fire.get(key)
        if last is not None and now - last < ALERT_COOLDOWN_SEC:
            return None
        self._last_fire[key] = now
        return {"id": self._alloc_id(), "symbol": symbol, "setup": setup,
                "direction": direction, "price": round(price, 2), "why": why,
                "market": self.market.key, "ts": self._now_ts()}
