"""Causal, event-driven NIFTY options replay engine.

Non-negotiable design rules:
* A signal is computed at the **close of a completed bar** using only bars up to
  and including that bar. The fill happens at the **next bar's open**.
* No future high/low/close/volume/OI/IV ever enters a signal.
* Position management walks bars forward; when a bar's range spans both stop and
  target, the **stop is assumed first** (conservative).
* Every trade carries realistic spread + slippage + NSE fees.

Two modes via an ``OptionSource``: actual FYERS premiums (listed contracts) or
Black-Scholes priced from the real underlying path.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Callable, Optional, Protocol

import numpy as np
import pandas as pd

import pricing
from costs import ExecutionModel, capital_for_structure, round_trip_costs


# ---------------------------------------------------------------------------
# data structures
# ---------------------------------------------------------------------------
@dataclass
class Leg:
    opt: str            # "CE" / "PE"
    side: str           # "BUY" / "SELL"
    offset_steps: int   # strike steps from ATM (0 = ATM)
    ratio: int = 1


@dataclass
class Signal:
    legs: list[Leg]
    reason: str
    tag: str = ""
    stop_pct: Optional[float] = None
    target_pct: Optional[float] = None
    max_hold_min: int = 120
    score: float = 0.0


@dataclass
class Trade:
    date: str
    tag: str
    direction: str
    expiry: str
    entry_ts: pd.Timestamp
    exit_ts: pd.Timestamp
    entry_net: float
    exit_net: float
    lots: int
    lot_size: int
    gross_pnl: float
    fees: float
    net_pnl: float
    capital: float
    mae: float
    mfe: float
    reason: str
    exit_reason: str
    spot_entry: float
    spot_exit: float
    legs: list[dict] = field(default_factory=list)


# ---------------------------------------------------------------------------
# option sources
# ---------------------------------------------------------------------------
class OptionSource(Protocol):
    def leg_price(self, ts, leg, spot, field="close") -> Optional[float]: ...


class SyntheticOptionSource:
    """BS-priced options off the real 1-min spot path with a causal IV surface."""

    def __init__(self, spot1m: pd.DataFrame, iv: pd.Series,
                 surface: pricing.IVSurface | None = None, iv_mult: float = 1.0):
        self.spot = spot1m
        self.iv = iv.reindex(spot1m.index).ffill()
        self.surface = surface or pricing.IVSurface()
        self.iv_mult = iv_mult

    @classmethod
    def from_cached(cls) -> "SyntheticOptionSource":
        import json
        from fyers_data import CANDLE_DIR
        spot = pd.read_parquet(CANDLE_DIR / "NSE_NIFTY50-INDEX__1.parquet").set_index("ts").sort_index()
        vix = pd.read_parquet(CANDLE_DIR / "NSE_INDIAVIX-INDEX__1.parquet").set_index("ts").sort_index()
        rv = pricing.trailing_vol(spot["close"], window=288)
        iv = pricing.combine_iv(vix["close"], rv)
        mult, coeff = 1.0, 0.55
        cal = CANDLE_DIR.parent / "calibration.json"
        if cal.exists():
            try:
                d = json.loads(cal.read_text())
                mult, coeff = d.get("iv_mult", 1.0), d.get("smile_coeff", 0.55)
            except Exception:
                pass
        return cls(spot, iv, surface=pricing.IVSurface(smile_coeff=coeff), iv_mult=mult)

    def _atm_vol(self, ts) -> float:
        v = self.iv.asof(ts)
        return (float(v) if v == v else 0.15) * self.iv_mult

    def leg_price(self, ts, leg, spot, field="close"):
        T = pricing.t_years(ts, leg["expiry"])
        sigma = self.surface.sigma(self._atm_vol(ts), spot, leg["strike"], T)
        return pricing.bs_price(spot, leg["strike"], T, sigma, leg["opt"])


class RealOptionSource:
    """Actual FYERS premiums; missing minutes forward-filled with a staleness cap."""

    def __init__(self, max_stale_min: int = 45):
        from fyers_data import CANDLE_DIR
        self.dir = CANDLE_DIR
        self.cache: dict[str, Optional[pd.DataFrame]] = {}
        self.max_stale = pd.Timedelta(minutes=max_stale_min)

    def _load(self, symbol: str):
        if symbol in self.cache:
            return self.cache[symbol]
        path = self.dir / f"{symbol.replace(':', '_')}__1.parquet"
        df = None
        if path.exists():
            try:
                df = pd.read_parquet(path).set_index("ts").sort_index()
            except Exception:
                df = None
        self.cache[symbol] = df
        return df

    def leg_price(self, ts, leg, spot, field="close"):
        df = self._load(leg["symbol"])
        if df is None or df.empty or field not in df.columns:
            return None
        try:
            row = df.loc[ts]
        except KeyError:
            sub = df.index[df.index <= ts]
            if len(sub) == 0 or (ts - sub[-1]) > self.max_stale:
                return None
            row = df.loc[sub[-1]]
        if isinstance(row, pd.DataFrame):
            row = row.iloc[-1]
        val = row.get(field)
        if val is None or (isinstance(val, float) and val != val):
            return None
        return float(val)


def has_data(source: "RealOptionSource", symbol: str) -> bool:
    df = source._load(symbol)
    return df is not None and not df.empty


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def build_legdicts(legs: list[Leg], expiry: date, spot: float, step: int, weekly: bool) -> list[dict]:
    from fyers_data import nifty_symbol
    atm = int(round(spot / step) * step)
    out = []
    for lg in legs:
        strike = atm + lg.offset_steps * step
        out.append({"opt": lg.opt, "side": lg.side, "ratio": lg.ratio, "strike": strike,
                    "expiry": expiry, "symbol": nifty_symbol(expiry, strike, lg.opt, weekly=weekly)})
    return out


def _prices(source, legdicts, ts, spot, field):
    out = []
    for l in legdicts:
        p = source.leg_price(ts, l, spot, field=field)
        if p is None:
            return None
        out.append(p)
    return out


def _leg_fills(prices, legdicts, ex, mode):
    """Per-leg execution prices. mode 'entry' opens (BUY pays ask); 'mark' liquidates."""
    out = []
    for l, p in zip(legdicts, prices):
        if l["side"] == "BUY":
            px = p * (1 + ex.half_spread_pct + ex.slippage_pct) if mode == "entry" \
                else p * (1 - ex.half_spread_pct - ex.slippage_pct)
        else:
            px = p * (1 - ex.half_spread_pct - ex.slippage_pct) if mode == "entry" \
                else p * (1 + ex.half_spread_pct + ex.slippage_pct)
        out.append(px)
    return out


def _net(legdicts, prices, ex, mode):
    fills = _leg_fills(prices, legdicts, ex, mode)
    return sum((1 if l["side"] == "BUY" else -1) * px * l["ratio"]
               for l, px in zip(legdicts, fills))


# ---------------------------------------------------------------------------
# expiry resolution
# ---------------------------------------------------------------------------
class ExpiryResolver:
    def __init__(self, expiries: list[date], weekly_flag: dict[date, bool]):
        self.expiries = sorted(expiries)
        self.weekly_flag = weekly_flag

    def front(self, day: date) -> Optional[date]:
        fut = [e for e in self.expiries if e >= day]
        return fut[0] if fut else None

    def is_weekly(self, expiry: date) -> bool:
        return self.weekly_flag.get(expiry, True)


def build_real_resolver(source: RealOptionSource, seed_spot: float, step: int) -> tuple[ExpiryResolver, dict]:
    """Discover expiries + weekly/monthly flags from cached contract filenames."""
    import re
    from datetime import datetime
    found = {}
    for p in (source.dir).glob("NSE_NIFTY*__1.parquet"):
        name = p.name
        m = re.match(r"NSE_NIFTY(\d{2})([A-Z0-9]{3})(\d+)(CE|PE)__1\.parquet", name)
        if not m:
            continue
    # fall back to the download manifest (authoritative)
    import json
    man = (source.dir.parent / "option_manifest.json")
    if not man.exists():
        raise RuntimeError("option_manifest.json missing — run download_options_real.py")
    data = json.loads(man.read_text())
    by_exp: dict[date, bool] = {}
    for c in data["contracts"]:
        d = date.fromisoformat(c["expiry"])
        by_exp[d] = c["weekly"]
    res = ExpiryResolver(list(by_exp.keys()), by_exp)
    return res, by_exp


# ---------------------------------------------------------------------------
# engine
# ---------------------------------------------------------------------------
@dataclass
class EngineConfig:
    step: int = 50
    lot: int = 65
    capital: float = 300_000.0
    risk_pct: float = 0.01
    max_lots: int = 20
    execution: ExecutionModel = field(default_factory=ExecutionModel)
    stop_pct: float = 0.30
    target_pct: float = 0.50
    max_hold_min: int = 120


def replay(strategy: Callable, spot: pd.DataFrame, source: OptionSource,
           resolver: ExpiryResolver, cfg: EngineConfig, start: date, end: date,
           require_data: bool = False, day_meta: dict | None = None) -> list[Trade]:
    trades: list[Trade] = []
    day_meta = day_meta or {}
    days = sorted({d for d in spot.index.date if start <= d <= end})
    for day in days:
        bars = spot[spot.index.date == day]
        if len(bars) < 8:
            continue
        expiry = resolver.front(day)
        if expiry is None:
            continue
        weekly = resolver.is_weekly(expiry)
        ctx = StrategyContext(day, bars, source, expiry, weekly, cfg)
        for k, v in day_meta.get(day, {}).items():
            setattr(ctx, k, v)
        i = 2
        while i < len(bars) - 2:
            sig = strategy(ctx, i)
            if sig is not None:
                res = _open(ctx, sig, i + 1, bars, require_data)
                if res is not None:
                    trade, exit_i = res
                    trades.append(trade)
                    i = max(exit_i, i + 1)
                    continue
            i += 1
    return trades


class StrategyContext:
    """Causal view handed to a strategy at bar ``i`` (close of a completed bar).

    All session features are precomputed once per session as prefix arrays, so a
    strategy lookup is O(1) and cannot accidentally read the future (arrays only
    index up to ``i``).
    """

    def __init__(self, day, bars, source, expiry, weekly, cfg: EngineConfig):
        self.day = day
        self.bars = bars
        self.source = source
        self.expiry = expiry
        self.weekly = weekly
        self.cfg = cfg
        self._closes = bars["close"].to_numpy(dtype=float)
        self._highs = bars["high"].to_numpy(dtype=float)
        self._lows = bars["low"].to_numpy(dtype=float)
        self._opens = bars["open"].to_numpy(dtype=float)
        v = bars["volume"].to_numpy(dtype=float) if "volume" in bars else np.ones(len(bars))
        tp = (self._highs + self._lows + self._closes) / 3.0
        self._cum_tpv = np.cumsum(tp * v)
        self._cum_v = np.cumsum(v)
        self._vwap_arr = np.where(self._cum_v > 0, self._cum_tpv / np.where(self._cum_v == 0, 1, self._cum_v),
                                  self._closes)
        self._cummax_h = np.maximum.accumulate(self._highs)
        self._cummin_l = np.minimum.accumulate(self._lows)
        # minute offset from session open for each bar
        open_ts = bars.index[0].normalize() + pd.Timedelta(hours=9, minutes=15)
        self._offsets = np.array([(t - open_ts).total_seconds() / 60.0 for t in bars.index])
        self._ema_cache: dict[int, np.ndarray] = {}
        self._atr_cache: dict[int, np.ndarray] = {}
        self._or_end: dict[int, int] = {}

    def ts(self, i):
        return self.bars.index[i]

    def hist(self, arr, i, n):
        return arr[max(0, i - n + 1):i + 1]

    @property
    def spot(self):
        return float(self._closes[0])

    def atm(self):
        return int(round(self.spot / self.cfg.step) * self.cfg.step)

    def to_close_min(self, i):
        return max(0.0, 375.0 - self._offsets[i] - 15.0)

    def session_open(self):
        return float(self._opens[0])

    def minutes(self, i):
        return float(self._offsets[i])

    def vwap(self, i):
        return float(self._vwap_arr[i])

    def ema(self, i, span):
        arr = self._ema_cache.get(span)
        if arr is None:
            alpha = 2.0 / (span + 1.0)
            out = np.empty(len(self._closes))
            acc = self._closes[0]
            for k in range(len(self._closes)):
                acc = alpha * self._closes[k] + (1 - alpha) * acc
                out[k] = acc
            self._ema_cache[span] = arr = out
        return float(arr[i])

    def atr(self, i, n=14):
        arr = self._atr_cache.get(n)
        if arr is None:
            h, l, c = self._highs, self._lows, self._closes
            tr = np.empty(len(c))
            tr[0] = h[0] - l[0]
            for k in range(1, len(c)):
                tr[k] = max(h[k] - l[k], abs(h[k] - c[k - 1]), abs(l[k] - c[k - 1]))
            self._atr_cache[n] = arr = pd.Series(tr).rolling(n).mean().to_numpy()
        v = arr[i]
        return float(v) if v == v else 0.0

    def opening_range(self, i, or_min):
        idx = self._or_end.get(or_min)
        if idx is None:
            idx = int(np.searchsorted(self._offsets, or_min, side="right") - 1)
            self._or_end[or_min] = idx
        if idx < 0 or i <= idx:
            return None
        return float(self._cummax_h[idx]), float(self._cummin_l[idx]), idx + 1


def _open(ctx: StrategyContext, sig: Signal, fill_i: int, bars, require_data: bool):
    ts = bars.index[fill_i]
    spot = float(bars["open"].iloc[fill_i])
    legdicts = build_legdicts(sig.legs, ctx.expiry, spot, ctx.cfg.step, ctx.weekly)
    ex = ctx.cfg.execution

    if require_data:
        for l in legdicts:
            if not has_data(ctx.source, l["symbol"]):
                return None

    prices = _prices(ctx.source, legdicts, ts, spot, "open")
    if prices is None:
        return None
    entry_net = _net(legdicts, prices, ex, "entry")
    if abs(entry_net) <= 0.01:
        return None
    is_long = entry_net > 0
    fill_entry = _leg_fills(prices, legdicts, ex, "entry")
    struct_legs = [{**l, "premium": abs(p)} for l, p in zip(legdicts, fill_entry)]

    stop_pct = sig.stop_pct if sig.stop_pct is not None else ctx.cfg.stop_pct
    risk_budget = ctx.cfg.capital * ctx.cfg.risk_pct
    if is_long:
        risk_per_lot = entry_net * ctx.cfg.lot * stop_pct
        lots = int(max(1, min(ctx.cfg.max_lots, math.floor(risk_budget / max(risk_per_lot, 1.0)))))
    else:
        cap = capital_for_structure(spot, ctx.cfg.lot, struct_legs)
        lots = int(max(1, min(ctx.cfg.max_lots,
                              math.floor(risk_budget / max(abs(entry_net) * ctx.cfg.lot * stop_pct, 1.0)),
                              math.floor(ctx.cfg.capital / max(cap, 1.0)))))

    stop_lvl = entry_net - abs(entry_net) * stop_pct
    tgt_pct = sig.target_pct if sig.target_pct is not None else ctx.cfg.target_pct
    tgt_lvl = entry_net + abs(entry_net) * tgt_pct

    bar_min = _bar_minutes(bars)
    end_i = len(bars) - 1
    exit_i = min(fill_i + max(1, int(sig.max_hold_min / bar_min)), end_i)
    exit_net = None
    exit_reason = "TIME"
    mae = mfe = 0.0

    for j in range(fill_i + 1, min(exit_i, end_i) + 1):
        b = bars.iloc[j]
        jts = bars.index[j]
        lo_p = _prices(ctx.source, legdicts, jts, float(b["low"]), "open")
        hi_p = _prices(ctx.source, legdicts, jts, float(b["high"]), "open")
        if lo_p is None or hi_p is None:
            continue
        cand = [_net(legdicts, lo_p, ex, "entry"), _net(legdicts, hi_p, ex, "entry")]
        worst, best = min(cand), max(cand)
        mae = min(mae, (worst - entry_net) * lots * ctx.cfg.lot)
        mfe = max(mfe, (best - entry_net) * lots * ctx.cfg.lot)
        # conservative: stop first
        if worst <= stop_lvl:
            exit_net, exit_reason, exit_i = stop_lvl, "STOP", j
            break
        if best >= tgt_lvl:
            exit_net, exit_reason, exit_i = tgt_lvl, "TARGET", j
            break

    if exit_net is None:
        b = bars.iloc[exit_i]
        raw = _prices(ctx.source, legdicts, bars.index[exit_i], float(b["close"]), "close")
        exit_net = _net(legdicts, raw, ex, "mark") if raw is not None else entry_net
        exit_reason = "EOD" if exit_i >= end_i else "TIME"

    # fees on each leg at its own entry/exit reference price
    ent_prices = _prices(ctx.source, legdicts, bars.index[fill_i], spot, "open") or prices
    out_prices = _prices(ctx.source, legdicts, bars.index[exit_i], float(bars["close"].iloc[exit_i]), "close") or ent_prices
    fees = sum(round_trip_costs(pe, px, ctx.cfg.lot * lots * l["ratio"], l["side"])
               for pe, px, l in zip(ent_prices, out_prices, legdicts))

    gross = (exit_net - entry_net) * lots * ctx.cfg.lot
    cap = abs(entry_net) * ctx.cfg.lot * lots if is_long else \
        capital_for_structure(spot, ctx.cfg.lot, struct_legs) * lots
    return Trade(
        date=str(ctx.day), tag=sig.tag, direction="LONG" if is_long else "SHORT",
        expiry=ctx.expiry.isoformat(), entry_ts=bars.index[fill_i], exit_ts=bars.index[exit_i],
        entry_net=entry_net, exit_net=exit_net, lots=lots, lot_size=ctx.cfg.lot,
        gross_pnl=gross, fees=fees, net_pnl=gross - fees, capital=cap,
        mae=mae, mfe=mfe, reason=sig.reason, exit_reason=exit_reason,
        spot_entry=spot, spot_exit=float(bars["close"].iloc[exit_i]), legs=legdicts,
    ), exit_i


def _bar_minutes(bars) -> int:
    if len(bars) < 2:
        return 5
    return max(1, int((bars.index[1] - bars.index[0]).total_seconds() // 60))
