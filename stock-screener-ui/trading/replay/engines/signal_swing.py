"""Generic swing-signal replay engine (NSE daily bars).

One engine drives any daily-bar signal generator from
``trading.strategy_runner.SIGNAL_GENERATOR_REGISTRY``. Adding a strategy is
configuration (id, label, generator path, params) — not a new class.

Contract: :class:`trading.replay.contract.ReplayStrategy` — implements the
optional ``load`` hook so the generic endpoint fetches NSE daily bars instead
of its default NQ tick loader.
"""
from __future__ import annotations

import importlib
from datetime import datetime

from config import IST
from trading.replay.contract import ParamSpec, ReplayContext, StrategyResult
from trading.replay.datasources import load_daily_bars
from trading.replay.indicators import adx as _adx
from trading.replay.indicators import mean as _mean
from trading.replay.indicators import rsi as _rsi
from trading.week52_utils import calculate_52w_high, days_since_52w_high_touch

from trading.replay.engines._common import (
    build_generator_config,
    classify_exit,
    make_trade,
    resolve_position,
)

_SYMBOL = ParamSpec("symbol", "Symbol", "text", "NETWEB",
                    description="NSE ticker (daily bars)")
_LOOKBACK = ParamSpec("lookback_days", "Lookback (calendar days)", "int", 400, min=260, max=800,
                      description="daily bars fetched before the replay date")
_WARMUP = ParamSpec("warmup", "Warmup bars", "int", 20, min=5, max=120,
                    description="bars to skip before allowing entries")


class SwingSignalReplay:
    """Generic daily-bar replay driver for a config-dict signal generator."""

    required_data = {"daily_bars"}

    def __init__(self, strategy_id, label, module, class_name, params, aliases=None, kind=None):
        self.id = strategy_id
        self.label = label
        self.params = params
        self._module = module
        self._class = class_name
        self._aliases = aliases or {}
        self.kind = kind or strategy_id

    # ---------------- data source ----------------

    def load(self, date: str, params: dict) -> ReplayContext:
        symbol = str(params.get("symbol") or "NETWEB")
        lookback_days = int(params.get("lookback_days", 400))
        bars = load_daily_bars(symbol, date, lookback_days)
        return ReplayContext(date=date, symbol=symbol, params=params, ticks=[],
                             bars=bars, hist_bars=None, basis=None)

    # ---------------- run ----------------

    def _make_gen(self, params):
        cls = getattr(importlib.import_module(self._module), self._class)
        return cls(build_generator_config(params, self._aliases))

    def run(self, ctx: ReplayContext) -> StrategyResult:
        bars = ctx.bars or []
        params = ctx.params or {}
        symbol = str(params.get("symbol") or ctx.symbol or "NETWEB")
        warmup = int(params.get("warmup", 20))
        gen = self._make_gen(params)

        max_holding = getattr(gen, "max_holding_days", None) or int(params.get("max_holding_days", 0) or 0)
        trailing_stop_pct = float(params.get("trailing_stop_pct", getattr(gen, "trailing_stop_pct", 2.0)))
        enable_trailing_stop = bool(params.get("enable_trailing_stop", getattr(gen, "enable_trailing_stop", False)))

        highs = [float(b["high"]) for b in bars]
        lows = [float(b["low"]) for b in bars]
        closes = [float(b["close"]) for b in bars]
        volumes = [float(b.get("volume") or 0) for b in bars]

        trades: list[dict] = []
        prior_highs: list[float] = []
        pos: dict | None = None

        for i, bar in enumerate(bars):
            high, low, close = highs[i], lows[i], closes[i]
            high_52w = calculate_52w_high(prior_highs)

            if pos is None:
                if i >= warmup:
                    md = self._market_data(bars, highs, lows, closes, volumes, i, prior_highs, high_52w)
                    sig = gen.check_entry(symbol, md)
                    if sig is not None:
                        pos = {
                            "side": "LONG" if "LONG" in str(sig.signal_type) else "SHORT",
                            "entry": float(sig.price),
                            "entry_idx": i,
                            "time": int(bar["time"]),
                            "sl": float(sig.stop_loss),
                            "tp": float(sig.take_profit) if sig.take_profit else None,
                            "high_52w": high_52w,
                            "highest": float(sig.price),
                            "reason": sig.notes or "",
                        }
            else:
                exit_price, result = resolve_position(pos["side"], pos["sl"], pos["tp"], high, low)
                exit_reason = None
                if exit_price is None:
                    side = pos["side"]
                    days = i - pos["entry_idx"]
                    pos["highest"] = max(pos["highest"], high)
                    sig = gen.check_exit(
                        symbol, "BUY" if side == "LONG" else "SELL",
                        pos["entry"], pos["sl"], pos["tp"] or 0.0, close,
                        days_in_position=days,
                        max_holding_days=max_holding or 9999,
                        highest_price_since_entry=pos["highest"],
                        entry_52w_high=pos["high_52w"],
                        current_52w_high=high_52w,
                        trailing_stop_pct=trailing_stop_pct,
                        enable_trailing_stop=enable_trailing_stop,
                        timestamp=datetime.fromtimestamp(bar["time"], tz=IST),
                    )
                    if sig is not None:
                        exit_price = close
                        exit_reason = sig.notes or ""
                        result = classify_exit(exit_reason)
                    elif max_holding and days >= max_holding:
                        exit_price = close
                        result = "MAX_HOLD"

                if exit_price is not None:
                    trades.append(make_trade(
                        time=pos["time"], exit_time=int(bar["time"]), side=pos["side"], kind=self.kind,
                        entry=pos["entry"], sl=pos["sl"], tp=pos["tp"], exit_price=exit_price,
                        result=result, entry_reason=pos["reason"], exit_reason=exit_reason,
                    ))
                    if hasattr(gen, "record_exit"):
                        gen.record_exit()
                    pos = None

            prior_highs.append(high)

        pnls = [t["pnl"] for t in trades]
        return StrategyResult(
            trades=trades,
            extras={"bars": bars},
            kpis={"trades": len(trades), "net": round(sum(pnls), 2),
                  "wins": sum(1 for p in pnls if p > 0)},
        )

    @staticmethod
    def _market_data(bars, highs, lows, closes, volumes, i, prior_highs, high_52w) -> dict:
        """Superset market-data dict — extra keys are harmless."""
        days_since = days_since_52w_high_touch(prior_highs, high_52w) if high_52w else None
        return {
            "current_price": closes[i],
            "high_52w": high_52w,
            "daily_highs": list(highs[: i + 1]),
            "daily_lows": list(lows[: i + 1]),
            "daily_closes": list(closes[: i + 1]),
            "days_since_52w_high": 99 if days_since is None else days_since,
            "today_intraday_high": highs[i],
            "volume": volumes[i],
            "avg_volume_20d": _mean(volumes[max(0, i - 19): i + 1]),
            "ma50": _mean(closes[max(0, i - 49): i + 1]),
            "ma200": _mean(closes[max(0, i - 199): i + 1]),
            "rsi": _rsi(closes[: i + 1], 14),
            "adx": _adx(highs[: i + 1], lows[: i + 1], closes[: i + 1], 14),
            "timestamp": datetime.fromtimestamp(bars[i]["time"], tz=IST),
        }


# ---------------- registry specs (ids are frozen) ----------------

def _target_params():
    return [
        _SYMBOL, _LOOKBACK,
        ParamSpec("sl_pct", "Stop loss %", "float", 2.0),
        ParamSpec("entry_threshold_pct", "Entry threshold %", "float", 2.0),
        ParamSpec("trailing_stop_pct", "Trailing stop %", "float", 2.0),
        ParamSpec("max_holding_days", "Max holding days", "int", 15, min=1, max=120),
        ParamSpec("cooldown_days", "Cooldown days", "int", 7, min=0, max=60),
        ParamSpec("recent_touch_days", "Recent touch days", "int", 5, min=0, max=60),
        _WARMUP,
    ]


SWING_ENGINES = [
    SwingSignalReplay(
        "52w-target", "52W Target",
        "trading.week52_target_signals", "Week52TargetSignalGenerator",
        _target_params(),
    ),
    SwingSignalReplay(
        "blind-52w", "Blind 52W",
        "trading.blind_52w_signals", "Blind52WSignalGenerator",
        [
            _SYMBOL, _LOOKBACK,
            ParamSpec("near_high_threshold_pct", "Near-high threshold %", "float", 3.0),
            ParamSpec("min_days_since_52w_high", "Min days since 52W high", "int", 20, min=0, max=250),
            ParamSpec("max_holding_days", "Max holding days", "int", 30, min=1, max=120),
            ParamSpec("sl_pct", "Stop loss %", "float", 5.0),
            _WARMUP,
        ],
    ),
    SwingSignalReplay(
        "short-52w-failed", "Short 52W Failed",
        "trading.short_52w_failed_signals", "Short52WFailedSignalGenerator",
        [
            _SYMBOL, _LOOKBACK,
            ParamSpec("sl_pct", "Stop loss %", "float", 3.0),
            ParamSpec("tp_pct", "Take profit %", "float", 5.0),
            ParamSpec("max_holding_days", "Max holding days", "int", 15, min=1, max=120),
            ParamSpec("cooldown_days", "Cooldown days", "int", 15, min=0, max=60),
            ParamSpec("signal_lookback_days", "Signal lookback days", "int", 5, min=1, max=60),
            _WARMUP,
        ],
        aliases={"signal_lookback_days": "lookback_days"},
    ),
    SwingSignalReplay(
        "adx-trend", "ADX Trend",
        "trading.adx_trend_signals", "ADXTrendSignalGenerator",
        [
            _SYMBOL, _LOOKBACK,
            ParamSpec("sl_pct", "Stop loss %", "float", 3.0),
            ParamSpec("tp_pct", "Take profit %", "float", 6.0),
            ParamSpec("adx_threshold", "ADX threshold", "float", 25.0),
            ParamSpec("max_holding_days", "Max holding days", "int", 20, min=1, max=120),
            ParamSpec("cooldown_days", "Cooldown days", "int", 10, min=0, max=60),
            ParamSpec("enable_shorts", "Enable shorts", "bool", True),
            ParamSpec("adx_period", "ADX period", "int", 14, min=2, max=50),
            _WARMUP,
        ],
    ),
    SwingSignalReplay(
        "volume-surge", "Volume Surge",
        "trading.volume_surge_signals", "VolumeSurgeSignalGenerator",
        [
            _SYMBOL, _LOOKBACK,
            ParamSpec("sl_pct", "Stop loss %", "float", 5.0),
            ParamSpec("tp_pct", "Take profit %", "float", 8.0),
            ParamSpec("min_volume_ratio", "Min volume ratio", "float", 2.0),
            ParamSpec("min_adx", "Min ADX", "float", 20.0),
            ParamSpec("max_holding_days", "Max holding days", "int", 15, min=1, max=120),
            ParamSpec("cooldown_days", "Cooldown days", "int", 10, min=0, max=60),
            ParamSpec("enable_shorts", "Enable shorts", "bool", False),
            _WARMUP,
        ],
    ),
]
