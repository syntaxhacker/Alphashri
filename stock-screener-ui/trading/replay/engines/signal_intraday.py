"""Generic intraday-signal replay engine (NQ 1m bars).

One engine drives any intraday signal generator (ORB, S/R breakout, EMA cross,
SMC) over the endpoint's default NQ tick/1m-bar loader. It deliberately does
NOT implement the ``load`` hook, so the generic endpoint uses
``trading.replay.datasources.load_nq_session`` exactly like ``vwap-orb``.
"""
from __future__ import annotations

import importlib
from datetime import datetime

from config import IST
from trading.ema_utils import calculate_ema
from trading.orb_utils import calculate_or_levels
from trading.pivot_utils import calculate_pivot_points
from trading.replay.contract import ParamSpec, ReplayContext, StrategyResult
from trading.replay.indicators import adx as _adx
from trading.replay.indicators import atr_pct as _atr_pct
from trading.replay.indicators import rsi as _rsi

from trading.replay.engines._common import (
    build_generator_config,
    classify_exit,
    make_trade,
    resolve_position,
)

# ORB is the only generator that takes constructor kwargs instead of a config dict.
_ORB_KWARGS = ("or_minutes", "sl_pct", "tp_pct", "min_or_range_pct",
               "max_or_range_pct", "breakout_buffer_pct")

_WARMUP = ParamSpec("warmup", "Warmup bars", "int", 5, min=0, max=120,
                    description="bars to skip before allowing entries")


class IntradaySignalReplay:
    """Generic 1m-bar replay driver for an intraday signal generator."""

    required_data = {"bars"}

    def __init__(self, strategy_id, label, module, class_name, params, style="dict"):
        self.id = strategy_id
        self.label = label
        self.params = params
        self._module = module
        self._class = class_name
        self._style = style

    def _make_gen(self, params):
        cls = getattr(importlib.import_module(self._module), self._class)
        if self._style == "kwargs":
            return cls(**{k: params[k] for k in _ORB_KWARGS if k in params})
        return cls(build_generator_config(params))

    def run(self, ctx: ReplayContext) -> StrategyResult:
        bars = ctx.bars or []
        params = ctx.params or {}
        symbol = ctx.symbol or "NQ=F"
        warmup = int(params.get("warmup", 5))
        gen = self._make_gen(params)

        or_minutes = int(params.get("or_minutes", 45))
        pivot_type = str(params.get("pivot_type", "classic"))
        pivot_points = self._pivot_points(ctx.hist_bars, pivot_type)

        candles: list[dict] = []
        highs: list[float] = []
        lows: list[float] = []
        closes: list[float] = []
        trades: list[dict] = []
        pos: dict | None = None

        for i, bar in enumerate(bars):
            ts = datetime.fromtimestamp(bar["time"], tz=IST)
            candles.append({
                "time": ts, "open": float(bar["open"]), "high": float(bar["high"]),
                "low": float(bar["low"]), "close": float(bar["close"]),
            })
            highs.append(float(bar["high"]))
            lows.append(float(bar["low"]))
            closes.append(float(bar["close"]))
            high, low, close = highs[-1], lows[-1], closes[-1]

            md = self._market_data(candles, highs, lows, closes, or_minutes, pivot_points, ts, params)

            if pos is None:
                if i >= warmup:
                    sig = gen.check_entry(symbol, md)
                    if sig is not None:
                        pos = {
                            "side": "LONG" if "LONG" in str(sig.signal_type) else "SHORT",
                            "entry": float(sig.price),
                            "time": int(bar["time"]),
                            "sl": float(sig.stop_loss),
                            "tp": float(sig.take_profit) if sig.take_profit else None,
                            "reason": sig.notes or "",
                        }
            else:
                exit_price, result = resolve_position(pos["side"], pos["sl"], pos["tp"], high, low)
                exit_reason = None
                if exit_price is None:
                    sig = gen.check_exit(
                        symbol, "BUY" if pos["side"] == "LONG" else "SELL",
                        pos["entry"], pos["sl"], pos["tp"] or 0.0, close,
                        timestamp=ts,
                    )
                    if sig is not None:
                        exit_price = close
                        exit_reason = sig.notes or ""
                        result = classify_exit(exit_reason)

                if exit_price is not None:
                    trades.append(make_trade(
                        time=pos["time"], exit_time=int(bar["time"]), side=pos["side"], kind=self.id,
                        entry=pos["entry"], sl=pos["sl"], tp=pos["tp"], exit_price=exit_price,
                        result=result, entry_reason=pos["reason"], exit_reason=exit_reason,
                    ))
                    if hasattr(gen, "record_exit"):
                        gen.record_exit()
                    pos = None

        pnls = [t["pnl"] for t in trades]
        return StrategyResult(
            trades=trades,
            extras={"bars": bars},
            kpis={"trades": len(trades), "net": round(sum(pnls), 2),
                  "wins": sum(1 for p in pnls if p > 0)},
        )

    @staticmethod
    def _pivot_points(hist_bars, pivot_type):
        if not hist_bars:
            return {}
        highs = [float(b["high"]) for b in hist_bars]
        lows = [float(b["low"]) for b in hist_bars]
        close = float(hist_bars[-1]["close"])
        p = calculate_pivot_points(max(highs), min(lows), close, pivot_type)
        return {"PP": round(p.pp, 2), "R1": round(p.r1, 2), "R2": round(p.r2, 2),
                "R3": round(p.r3, 2), "S1": round(p.s1, 2), "S2": round(p.s2, 2),
                "S3": round(p.s3, 2)}

    @staticmethod
    def _market_data(candles, highs, lows, closes, or_minutes, pivot_points, ts, params) -> dict:
        fast_period = int(params.get("ema_fast_period", 9))
        slow_period = int(params.get("ema_slow_period", 21))
        fast = calculate_ema(closes, fast_period, return_full=True)
        slow = calculate_ema(closes, slow_period, return_full=True)
        return {
            "current_price": closes[-1],
            "timestamp": ts,
            "candles": candles,
            "daily_highs": list(highs),
            "daily_lows": list(lows),
            "daily_closes": list(closes),
            "or_levels": calculate_or_levels(candles, or_minutes=or_minutes),
            "pivot_points": pivot_points,
            "ema_fast_current": fast[-1] if fast and fast[-1] is not None else None,
            "ema_fast_prev": fast[-2] if len(fast) >= 2 and fast[-2] is not None else None,
            "ema_slow_current": slow[-1] if slow and slow[-1] is not None else None,
            "ema_slow_prev": slow[-2] if len(slow) >= 2 and slow[-2] is not None else None,
            "atr_pct": _atr_pct(highs, lows, closes, 14),
            "adx": _adx(highs, lows, closes, 14),
            "rsi": _rsi(closes, 14),
        }


# ---------------- registry specs (ids are frozen) ----------------

INTRADAY_ENGINES = [
    IntradaySignalReplay(
        "orb", "ORB",
        "trading.orb_signals", "ORBSignalGenerator",
        [
            ParamSpec("or_minutes", "Opening range (min)", "int", 45, min=1, max=120),
            ParamSpec("sl_pct", "Stop loss %", "float", 1.0),
            ParamSpec("tp_pct", "Take profit %", "float", 1.5),
            ParamSpec("min_or_range_pct", "Min OR range %", "float", 0.5),
            ParamSpec("max_or_range_pct", "Max OR range %", "float", 3.0),
            ParamSpec("breakout_buffer_pct", "Breakout buffer %", "float", 0.3),
            _WARMUP,
        ],
        style="kwargs",
    ),
    IntradaySignalReplay(
        "sr-breakout", "S/R Breakout",
        "trading.sr_breakout_signals", "SRBreakoutSignalGenerator",
        [
            ParamSpec("sl_pct", "Stop loss %", "float", 1.5),
            ParamSpec("tp_pct", "Take profit %", "float", 2.5),
            ParamSpec("pivot_type", "Pivot type", "select", "classic",
                      options=["classic", "camarilla", "fibonacci", "woodie"]),
            ParamSpec("breakout_buffer_pct", "Breakout buffer %", "float", 1.0),
            ParamSpec("max_distance_from_r1_pct", "Max distance from R1 %", "float", 5.0),
            ParamSpec("hist", "Overnight history (h)", "int", 8, min=0, max=24,
                      description="prior-session hours used to derive pivot levels"),
            _WARMUP,
        ],
    ),
    IntradaySignalReplay(
        "ema-cross", "EMA Cross",
        "trading.ema_cross_signals", "EMACrossSignalGenerator",
        [
            ParamSpec("ema_fast_period", "Fast EMA", "int", 9, min=2, max=100),
            ParamSpec("ema_slow_period", "Slow EMA", "int", 21, min=3, max=200),
            ParamSpec("sl_pct", "Stop loss %", "float", 1.0),
            ParamSpec("tp_pct", "Take profit %", "float", 1.5),
            ParamSpec("enable_shorts", "Enable shorts", "bool", False),
            ParamSpec("cooldown_bars", "Cooldown bars", "int", 3, min=0, max=60),
            ParamSpec("warmup", "Warmup bars", "int", 21, min=0, max=200),
        ],
    ),
    IntradaySignalReplay(
        "smc", "SMC",
        "trading.smc_signals", "SMCSignalGenerator",
        [
            ParamSpec("sl_pct", "Stop loss %", "float", 1.2),
            ParamSpec("tp_pct", "Take profit %", "float", 2.5),
            ParamSpec("risk_reward", "Risk/Reward", "float", 3.0),
            ParamSpec("swing_lookback", "Swing lookback", "int", 12, min=2, max=100),
            ParamSpec("min_rr", "Min R/R", "float", 2.2),
            ParamSpec("warmup", "Warmup bars", "int", 30, min=0, max=200),
        ],
    ),
]
