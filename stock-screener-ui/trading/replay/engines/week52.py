"""52-week high chaser replay engine (NSE daily swing).

Unlike the default NQ-tick engines, this engine owns its data source: it
implements the optional ``load`` hook on the replay contract to fetch daily
bars for an NSE symbol via ``market_data.market_data.fetch_candles(tf=1440)``.
The generic ``/api/poc/replay/{strategy_id}`` endpoint detects the hook and
uses it instead of its default NQ loader.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from market_data.market_data import fetch_candles
from trading.replay.contract import ParamSpec, ReplayContext, StrategyResult
from trading.week52_utils import calculate_52w_high, days_since_52w_high_touch


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


class Week52ChaserReplay:
    id = "week52-chaser"
    label = "52W High Chaser"
    params = [
        ParamSpec("symbol", "Symbol", "text", "NETWEB",
                  description="NSE ticker (daily bars)"),
        ParamSpec("lookback_days", "Lookback (calendar days)", "int", 400, min=260, max=800,
                  description="daily bars fetched before the replay date"),
        ParamSpec("sl_pct", "Stop loss %", "float", 2.0,
                  description="stop-loss percent used for TP fallback/risk"),
        ParamSpec("tp_pct", "Take profit %", "float", 3.0,
                  description="take-profit percent from entry"),
        ParamSpec("entry_threshold_pct", "Entry threshold %", "float", 3.0,
                  description="max percent above 52W high still chaseable"),
        ParamSpec("min_breakout_pct", "Min breakout %", "float", 0.5,
                  description="min percent above 52W high required to enter"),
        ParamSpec("max_holding_days", "Max holding days", "int", 30, min=1, max=120,
                  description="force-exit a swing after this many daily bars"),
        ParamSpec("enable_trailing_stop", "Trailing stop", "bool", False,
                  description="enable trailing stop exits"),
        ParamSpec("trailing_stop_pct", "Trailing stop %", "float", 2.0,
                  description="trailing distance from the highest price"),
        ParamSpec("warmup", "Warmup bars", "int", 20, min=5, max=120,
                  description="bars to skip before allowing entries"),
    ]
    required_data = {"daily_bars"}

    def load(self, date: str, params: dict) -> ReplayContext:
        """Fetch NSE daily bars ending at ``date`` and build a bar-only context."""
        symbol = str(params.get("symbol") or "NETWEB")
        lookback_days = int(params.get("lookback_days", 400))
        to_date = date
        from_date = (datetime.fromisoformat(date) - timedelta(days=lookback_days + 260)).strftime("%Y-%m-%d")

        df = fetch_candles(symbol, tf=1440, from_date=from_date, to_date=to_date)
        daily_bars: list[dict] = []
        if df is not None and not df.empty:
            for ts, row in df.iterrows():
                try:
                    volume = row["volume"] if "volume" in row else 0
                    daily_bars.append({
                        "time": int(ts.timestamp()),
                        "open": float(row["open"]),
                        "high": float(row["high"]),
                        "low": float(row["low"]),
                        "close": float(row["close"]),
                        "volume": float(volume) if volume == volume else 0.0,
                    })
                except Exception:
                    continue

        return ReplayContext(date=date, symbol=symbol, params=params, ticks=[],
                             bars=daily_bars, hist_bars=None, basis=None)

    def run(self, ctx: ReplayContext) -> StrategyResult:
        from trading.week52_chaser_signals import Week52ChaserSignalGenerator

        bars = ctx.bars or []
        params = ctx.params
        symbol = str(params.get("symbol") or "NETWEB")
        warmup = int(params.get("warmup", 20))
        max_holding_days = int(params.get("max_holding_days", 30))
        enable_trailing_stop = bool(params.get("enable_trailing_stop", False))
        trailing_stop_pct = float(params.get("trailing_stop_pct", 2.0))
        gen = Week52ChaserSignalGenerator(params)

        closes = [float(b["close"]) for b in bars]
        volumes = [float(b.get("volume") or 0) for b in bars]

        trades: list[dict] = []
        prior_highs: list[float] = []
        pos: dict | None = None

        for i, bar in enumerate(bars):
            high_52w = calculate_52w_high(prior_highs)
            close = float(bar["close"])
            high = float(bar["high"])
            low = float(bar["low"])

            if pos is None:
                if i >= warmup and high_52w and high_52w > 0:
                    md = self._build_market_data(bars, closes, volumes, i, prior_highs, high_52w)
                    sig = gen.check_entry(symbol, md)
                    if sig is not None:
                        pos = {
                            "entry": close,
                            "entry_idx": i,
                            "time": int(bar["time"]),
                            "sl": float(sig.stop_loss),
                            "tp": float(sig.take_profit) if sig.take_profit else None,
                            "high_52w": high_52w,
                            "highest": close,
                            "reason": sig.notes or "",
                        }
            else:
                sl = pos["sl"]
                tp = pos["tp"]
                exit_price = None
                result = None
                exit_reason = None

                if low <= sl:  # conservative: SL resolved before TP intrabar
                    exit_price = sl
                    result = "SL"
                elif tp and high >= tp:
                    exit_price = tp
                    result = "TP"
                else:
                    days_in_position = i - pos["entry_idx"]
                    pos["highest"] = max(pos["highest"], high)
                    sig = gen.check_exit(
                        symbol, "BUY", pos["entry"], sl, tp or 0.0, close,
                        days_in_position=days_in_position,
                        max_holding_days=max_holding_days,
                        highest_price_since_entry=pos["highest"],
                        entry_52w_high=pos["high_52w"],
                        current_52w_high=high_52w,
                        trailing_stop_pct=trailing_stop_pct,
                        enable_trailing_stop=enable_trailing_stop,
                    )
                    if sig is not None:
                        exit_price = close
                        exit_reason = sig.notes or ""
                        lowered = exit_reason.lower()
                        if "max" in lowered or "holding" in lowered:
                            result = "MAX_HOLD"
                        else:
                            result = "TRAIL"
                    elif days_in_position >= max_holding_days:
                        exit_price = close
                        result = "MAX_HOLD"

                if exit_price is not None:
                    pnl = exit_price - pos["entry"]
                    risk = pos["entry"] - sl
                    trades.append({
                        "time": pos["time"],
                        "exit_time": int(bar["time"]),
                        "side": "LONG",
                        "kind": "52w-chaser",
                        "entry": round(pos["entry"], 2),
                        "sl": round(sl, 2),
                        "tp": round(tp, 2) if tp else None,
                        "exit": round(exit_price, 2),
                        "result": result,
                        "pnl": round(pnl, 2),
                        "rr": round(pnl / risk, 2) if risk else 0.0,
                        "meta": {"entry_reason": pos["reason"], "exit_reason": exit_reason},
                    })
                    pos = None

            prior_highs.append(high)

        pnls = [t["pnl"] for t in trades]
        return StrategyResult(
            trades=trades,
            levels=[],
            extras={"bars": bars},
            kpis={
                "trades": len(trades),
                "net": round(sum(pnls), 2),
                "wins": sum(1 for p in pnls if p > 0),
            },
        )

    @staticmethod
    def _build_market_data(bars, closes, volumes, i, prior_highs, high_52w) -> dict:
        """Market-data dict mirroring ``scripts/debug_52w.py`` for the chaser."""
        days_since = days_since_52w_high_touch(prior_highs, high_52w)
        return {
            "current_price": closes[i],
            "high_52w": high_52w,
            "daily_highs": list(prior_highs),
            "volume": volumes[i],
            "avg_volume_20d": _mean(volumes[max(0, i - 19):i + 1]),
            "days_since_52w_high": 99 if days_since is None else days_since,
            "ma50": _mean(closes[max(0, i - 49):i + 1]),
            "ma200": _mean(closes[max(0, i - 199):i + 1]),
        }
