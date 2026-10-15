"""Low-resistance-liquidity (LRL) plus multi-timeframe iFVG strategy.

The supplied chart is more specific than a plain iFVG setup.  It first marks a
clean line through repeated swing highs or lows (the low-resistance liquidity
target), then only takes an iFVG inversion in the direction of that target:

* a valid LRL below price targets sell-side liquidity -> SHORT;
* a valid LRL above price targets buy-side liquidity -> LONG;
* the highest available 30s/1m/2m/3m iFVG must agree;
* entry is the first tick after the confirmed one-minute signal bar;
* the stop is beyond a recent swing and the default target is 1R.

All pivots and FVG events are confirmed from completed bars.  The module is
separate from the existing fair-price and five-minute iFVG strategies so their
historical results remain reproducible.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from itertools import combinations
from typing import Any, Iterable
from zoneinfo import ZoneInfo

REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_DIR not in sys.path:
    sys.path.insert(0, REPO_DIR)

ET = ZoneInfo("America/New_York")
UTC = timezone.utc


@dataclass(frozen=True)
class LRLLiquidityConfig:
    base_timeframe_seconds: int = 60
    lrl_lookback_bars: int = 120
    lrl_min_touches: int = 3
    lrl_tolerance_atr: float = 0.60
    lrl_max_distance_atr: float = 5.0
    atr_period: int = 14
    fvg_timeframes_seconds: tuple[int, ...] = (30, 60, 120, 180)
    fvg_gap_points: tuple[float, ...] = (1.0, 2.0, 3.0, 4.0)
    max_inversion_age_bars: int = 12
    # The screenshot's cyan box is a retest zone; an inversion alone is not an
    # entry.  This prevents repeatedly trading the first impulse through the
    # gap and keeps the rule faithful to the annotated setup.
    require_fvg_retest: bool = True
    stop_buffer_points: float = 6.0
    min_stop_points: float = 5.0
    max_stop_points: float = 60.0
    target_r: float = 1.0
    max_hold_bars: int = 90
    max_trades: int = 20
    cooldown_minutes: float = 0.0
    max_consecutive_losses: int | None = None
    entry_start: str | None = "18:00"
    entry_end: str | None = "02:00"
    htf_bias_timeframe_seconds: int | None = None
    htf_fast_ema_period: int = 20
    htf_slow_ema_period: int = 50
    require_htf_bias_alignment: bool = False
    contracts: int = 6
    point_value: float = 2.0


@dataclass(frozen=True)
class LRLTarget:
    direction: str  # "above" or "below"
    target: float
    touches: int
    residual: float
    slope: float
    pivot_indices: tuple[int, ...]


@dataclass(frozen=True)
class FVGInversion:
    side: str
    timeframe_seconds: int
    zone_low: float
    zone_high: float
    inversion_index: int


@dataclass(frozen=True)
class LRLSignal:
    side: str
    bar_time: int
    signal_index: int
    lrl: LRLTarget
    inversion: FVGInversion


def measured_lrl_config() -> LRLLiquidityConfig:
    """Return the strongest fixed profile from the cached full replay.

    This keeps the chart's LRL direction and retest logic while requiring a
    confirmed four-touch line and a 3-minute iFVG.  It is exposed separately
    from ``LRLLiquidityConfig`` so the literal chart rules remain inspectable.
    """

    return LRLLiquidityConfig(
        lrl_min_touches=4,
        fvg_timeframes_seconds=(180,),
        fvg_gap_points=(4.0,),
        max_inversion_age_bars=12,
        require_fvg_retest=True,
    )


def build_bars(ticks: Iterable[dict[str, Any]], seconds: int) -> list[dict[str, Any]]:
    """Build bid-price OHLC bars from sorted or unsorted tick records."""

    if seconds < 1:
        raise ValueError("bar duration must be positive")
    grouped: dict[int, dict[str, Any]] = {}
    for tick in sorted(ticks, key=lambda item: int(item["timestamp"])):
        timestamp = int(tick["timestamp"]) // 1000
        bucket = timestamp // seconds * seconds
        price = float(tick["bidPrice"])
        bar = grouped.get(bucket)
        if bar is None:
            grouped[bucket] = {
                "time": bucket,
                "open": price,
                "high": price,
                "low": price,
                "close": price,
            }
        else:
            bar["high"] = max(float(bar["high"]), price)
            bar["low"] = min(float(bar["low"]), price)
            bar["close"] = price
    return [grouped[key] for key in sorted(grouped)]


def _atr(bars: list[dict[str, Any]], index: int, period: int) -> float:
    start = max(0, index - period + 1)
    ranges = [float(bar["high"]) - float(bar["low"]) for bar in bars[start : index + 1]]
    return sum(ranges) / len(ranges) if ranges else 0.0


def _confirmed_pivots(
    bars: list[dict[str, Any]], index: int, lookback: int
) -> tuple[list[tuple[int, float]], list[tuple[int, float]]]:
    """Return confirmed pivot highs/lows strictly before ``index``.

    A pivot at ``pivot`` needs two bars on its right, so no future bar after
    the current completed bar is used.
    """

    first = max(2, index - lookback)
    highs: list[tuple[int, float]] = []
    lows: list[tuple[int, float]] = []
    for pivot in range(first, max(first, index - 1)):
        if pivot + 2 > index:
            break
        window = bars[pivot - 2 : pivot + 3]
        if len(window) != 5:
            continue
        center = window[2]
        if all(
            float(center["high"]) > float(window[position]["high"])
            for position in (0, 1, 3, 4)
        ):
            highs.append((pivot, float(center["high"])))
        if all(
            float(center["low"]) < float(window[position]["low"])
            for position in (0, 1, 3, 4)
        ):
            lows.append((pivot, float(center["low"])))
    return highs, lows


def _fit_lrl(
    points: list[tuple[int, float]],
    index: int,
    current_price: float,
    tolerance: float,
    max_distance: float,
    direction: str,
) -> LRLTarget | None:
    if len(points) < 3:
        return None
    candidates: list[LRLTarget] = []
    pool = points[-6:]
    sizes = (4, 3) if len(pool) >= 4 else (3,)
    for size in sizes:
        for combo in combinations(pool, size):
            mean_x = sum(point[0] for point in combo) / size
            mean_y = sum(point[1] for point in combo) / size
            denominator = sum((point[0] - mean_x) ** 2 for point in combo)
            slope = (
                sum((point[0] - mean_x) * (point[1] - mean_y) for point in combo)
                / denominator
                if denominator
                else 0.0
            )
            intercept = mean_y - slope * mean_x
            residual = max(
                abs(point[1] - (slope * point[0] + intercept)) for point in combo
            )
            target = slope * index + intercept
            distance = abs(target - current_price)
            if residual > tolerance or distance > max_distance:
                continue
            if direction == "above" and target <= current_price + 2.0:
                continue
            if direction == "below" and target >= current_price - 2.0:
                continue
            candidates.append(
                LRLTarget(
                    direction=direction,
                    target=target,
                    touches=size,
                    residual=residual,
                    slope=slope,
                    pivot_indices=tuple(point[0] for point in combo),
                )
            )
        if candidates:
            break
    if not candidates:
        return None
    return min(candidates, key=lambda target: (target.residual, abs(target.target - current_price)))


def _detect_lrl_from_points(
    bars: list[dict[str, Any]],
    index: int,
    config: LRLLiquidityConfig,
    highs: list[tuple[int, float]],
    lows: list[tuple[int, float]],
) -> LRLTarget | None:
    if index < max(20, config.lrl_min_touches * 3):
        return None
    current_price = float(bars[index]["close"])
    volatility = _atr(bars, index, config.atr_period) or 5.0
    first = max(2, index - config.lrl_lookback_bars)
    above = _fit_lrl(
        [point for point in highs if point[0] >= first],
        index,
        current_price,
        config.lrl_tolerance_atr * volatility,
        config.lrl_max_distance_atr * volatility,
        "above",
    )
    below = _fit_lrl(
        [point for point in lows if point[0] >= first],
        index,
        current_price,
        config.lrl_tolerance_atr * volatility,
        config.lrl_max_distance_atr * volatility,
        "below",
    )
    targets = [target for target in (above, below) if target is not None]
    if not targets:
        return None
    return min(
        targets,
        key=lambda target: (-target.touches, target.residual, abs(target.target - current_price)),
    )


def detect_lrl(
    bars: list[dict[str, Any]],
    index: int,
    config: LRLLiquidityConfig | None = None,
) -> LRLTarget | None:
    """Detect the nearest clean confirmed LRL at a completed bar."""

    cfg = config or LRLLiquidityConfig()
    highs, lows = _confirmed_pivots(bars, index, cfg.lrl_lookback_bars)
    return _detect_lrl_from_points(bars, index, cfg, highs, lows)


def _fvg_at(
    bars: list[dict[str, Any]], index: int, gap_points: float
) -> tuple[str, float, float] | None:
    if index < 2:
        return None
    left = bars[index - 2]
    current = bars[index]
    left_low = float(left["low"])
    left_high = float(left["high"])
    current_low = float(current["low"])
    current_high = float(current["high"])
    if current_low - left_high >= gap_points:
        return "BULLISH_FVG", left_high, current_low
    if left_low - current_high >= gap_points:
        return "BEARISH_FVG", current_high, left_low
    return None


def _ema(values: list[float], period: int) -> list[float]:
    if period < 1:
        raise ValueError("EMA period must be positive")
    if not values:
        return []
    alpha = 2.0 / (period + 1.0)
    result = [values[0]]
    for value in values[1:]:
        result.append(alpha * value + (1.0 - alpha) * result[-1])
    return result


def _htf_bias_by_base_bar(
    base_bars: list[dict[str, Any]],
    htf_bars: list[dict[str, Any]],
    config: LRLLiquidityConfig,
) -> list[str | None]:
    """Return completed-HTF EMA bias available at each base-bar close."""

    if config.htf_bias_timeframe_seconds is None:
        return [None] * len(base_bars)
    closes = [float(bar["close"]) for bar in htf_bars]
    fast = _ema(closes, config.htf_fast_ema_period)
    slow = _ema(closes, config.htf_slow_ema_period)
    result: list[str | None] = []
    htf_index = -1
    timeframe = config.htf_bias_timeframe_seconds
    for base_bar in base_bars:
        complete_at = int(base_bar["time"]) + config.base_timeframe_seconds
        while htf_index + 1 < len(htf_bars):
            candidate = htf_bars[htf_index + 1]
            if int(candidate["time"]) + timeframe > complete_at:
                break
            htf_index += 1
        if htf_index < 0 or htf_index < config.htf_slow_ema_period - 1:
            result.append(None)
            continue
        close = closes[htf_index]
        if close > fast[htf_index] > slow[htf_index]:
            result.append("LONG")
        elif close < fast[htf_index] < slow[htf_index]:
            result.append("SHORT")
        else:
            result.append("NEUTRAL")
    return result


def _in_window(timestamp: int, start: str | None, end: str | None) -> bool:
    if start is None and end is None:
        return True
    local = datetime.fromtimestamp(timestamp, tz=UTC).astimezone(ET)
    minutes = local.hour * 60 + local.minute

    def parse(value: str | None, fallback: int) -> int:
        if value is None:
            return fallback
        hour, minute = (int(part) for part in value.split(":", 1))
        return hour * 60 + minute

    start_minute = parse(start, 0)
    end_minute = parse(end, 24 * 60)
    return (
        start_minute <= minutes < end_minute
        if start_minute <= end_minute
        else minutes >= start_minute or minutes < end_minute
    )


def _last_inversions(
    bars_by_tf: dict[int, list[dict[str, Any]]],
    base_bars: list[dict[str, Any]],
    config: LRLLiquidityConfig,
) -> dict[int, dict[int, FVGInversion]]:
    """Return all confirmed inversions keyed by base-bar index and timeframe."""

    events: dict[int, dict[int, FVGInversion]] = {}
    pointers = {tf: 0 for tf in bars_by_tf}
    zones: dict[int, list[dict[str, Any]]] = {tf: [] for tf in bars_by_tf}
    latest: dict[int, FVGInversion] = {}
    for index, base_bar in enumerate(base_bars):
        complete_at = int(base_bar["time"]) + config.base_timeframe_seconds
        for tf, tf_bars in bars_by_tf.items():
            gap = config.fvg_gap_points[config.fvg_timeframes_seconds.index(tf)]
            while pointers[tf] < len(tf_bars):
                tf_index = pointers[tf]
                tf_bar = tf_bars[tf_index]
                if int(tf_bar["time"]) + tf > complete_at:
                    break
                if tf_index >= 2:
                    fvg = _fvg_at(tf_bars, tf_index, gap)
                    if fvg is not None:
                        zones[tf].append(
                            {
                                "kind": fvg[0],
                                "low": fvg[1],
                                "high": fvg[2],
                                "inverted": False,
                            }
                        )
                close = float(tf_bar["close"])
                for zone in zones[tf]:
                    if zone["inverted"]:
                        continue
                    if zone["kind"] == "BEARISH_FVG" and close > zone["high"]:
                        zone["inverted"] = True
                        latest[tf] = FVGInversion(
                            side="LONG",
                            timeframe_seconds=tf,
                            zone_low=zone["low"],
                            zone_high=zone["high"],
                            inversion_index=index,
                        )
                    elif zone["kind"] == "BULLISH_FVG" and close < zone["low"]:
                        zone["inverted"] = True
                        latest[tf] = FVGInversion(
                            side="SHORT",
                            timeframe_seconds=tf,
                            zone_low=zone["low"],
                            zone_high=zone["high"],
                            inversion_index=index,
                        )
                pointers[tf] += 1
        events[index] = dict(latest)
    return events


def detect_lrl_signals(
    ticks: list[dict[str, Any]], config: LRLLiquidityConfig | None = None
) -> list[LRLSignal]:
    """Find history-only LRL/iFVG signals before tick execution."""

    cfg = config or LRLLiquidityConfig()
    if len(cfg.fvg_timeframes_seconds) != len(cfg.fvg_gap_points):
        raise ValueError("each FVG timeframe needs one gap threshold")
    if cfg.lrl_min_touches < 3 or cfg.max_inversion_age_bars < 1:
        raise ValueError("LRL touch count and inversion age are invalid")
    base_bars = build_bars(ticks, cfg.base_timeframe_seconds)
    bars_by_tf = {tf: build_bars(ticks, tf) for tf in cfg.fvg_timeframes_seconds}
    if cfg.htf_bias_timeframe_seconds is not None:
        htf_bars = build_bars(ticks, cfg.htf_bias_timeframe_seconds)
    else:
        htf_bars = []
    htf_bias = _htf_bias_by_base_bar(base_bars, htf_bars, cfg)
    inversions = _last_inversions(bars_by_tf, base_bars, cfg)
    signals: list[LRLSignal] = []
    used_inversions: set[tuple[int, int]] = set()
    confirmed_highs: list[tuple[int, float]] = []
    confirmed_lows: list[tuple[int, float]] = []

    for index, bar in enumerate(base_bars):
        pivot = index - 2
        if pivot >= 2:
            window = base_bars[pivot - 2 : pivot + 3]
            center = window[2]
            if len(window) == 5 and all(
                float(center["high"]) > float(window[position]["high"])
                for position in (0, 1, 3, 4)
            ):
                confirmed_highs.append((pivot, float(center["high"])))
            if len(window) == 5 and all(
                float(center["low"]) < float(window[position]["low"])
                for position in (0, 1, 3, 4)
            ):
                confirmed_lows.append((pivot, float(center["low"])))
        signal_end = int(bar["time"]) + cfg.base_timeframe_seconds
        if not _in_window(signal_end, cfg.entry_start, cfg.entry_end):
            continue
        lrl = _detect_lrl_from_points(base_bars, index, cfg, confirmed_highs, confirmed_lows)
        if lrl is None:
            continue
        side = "SHORT" if lrl.direction == "below" else "LONG"
        if cfg.require_htf_bias_alignment and htf_bias[index] != side:
            continue
        available: list[FVGInversion] = []
        for tf in reversed(cfg.fvg_timeframes_seconds):
            inversion = inversions.get(index, {}).get(tf)
            if inversion is None or inversion.side != side:
                continue
            if index - inversion.inversion_index > cfg.max_inversion_age_bars:
                continue
            if (tf, inversion.inversion_index) in used_inversions:
                continue
            available.append(inversion)
        if not available:
            continue
        inversion = available[0]
        if cfg.require_fvg_retest and index <= inversion.inversion_index:
            continue
        if cfg.require_fvg_retest:
            low = float(bar["low"])
            high = float(bar["high"])
            close = float(bar["close"])
            if side == "LONG" and not (low <= inversion.zone_high and close > inversion.zone_high):
                continue
            if side == "SHORT" and not (high >= inversion.zone_low and close < inversion.zone_low):
                continue
        signals.append(
            LRLSignal(
                side=side,
                bar_time=int(bar["time"]),
                signal_index=index,
                lrl=lrl,
                inversion=inversion,
            )
        )
        used_inversions.add((inversion.timeframe_seconds, inversion.inversion_index))
    return signals


def _recent_swing_stop(
    bars: list[dict[str, Any]], index: int, side: str, buffer_points: float
) -> float:
    start = max(0, index - 10)
    recent = bars[start:index]
    if side == "SHORT":
        pivot = max((float(bar["high"]) for bar in recent), default=float(bars[index]["high"]))
        return pivot + buffer_points
    pivot = min((float(bar["low"]) for bar in recent), default=float(bars[index]["low"]))
    return pivot - buffer_points


def _make_trade(
    signal: LRLSignal,
    entry: float,
    stop: float,
    target: float,
    entry_ts_ms: int,
    exit_price: float,
    exit_ts_ms: int,
    result: str,
    config: LRLLiquidityConfig,
) -> dict[str, Any]:
    pnl = entry - exit_price if signal.side == "SHORT" else exit_price - entry
    risk = abs(entry - stop)
    return {
        "time": int(entry_ts_ms // 1000),
        "exit_time": int(exit_ts_ms // 1000),
        "side": signal.side,
        "kind": "lrl-ifvg",
        "entry": round(entry, 2),
        "sl": round(stop, 2),
        "tp": round(target, 2),
        "exit": round(exit_price, 2),
        "result": result,
        "pnl": round(pnl, 2),
        "rr": round(pnl / risk, 2) if risk else 0.0,
        "meta": {
            "lrl_direction": signal.lrl.direction,
            "lrl_target": round(signal.lrl.target, 2),
            "lrl_touches": signal.lrl.touches,
            "lrl_residual": round(signal.lrl.residual, 2),
            "fvg_timeframe_seconds": signal.inversion.timeframe_seconds,
            "fvg_zone_low": round(signal.inversion.zone_low, 2),
            "fvg_zone_high": round(signal.inversion.zone_high, 2),
            "contracts": config.contracts,
            "point_value": config.point_value,
            "risk_usd": round(risk * config.contracts * config.point_value, 2),
            "pnl_usd_gross": round(pnl * config.contracts * config.point_value, 2),
            "entry_reason": (
                f"{signal.side} toward {signal.lrl.direction} LRL "
                f"({signal.lrl.touches} touches) with "
                f"{signal.inversion.timeframe_seconds}s iFVG inversion"
            ),
        },
    }


def run_lrl_liquidity_strategy(
    ticks: list[dict[str, Any]], config: LRLLiquidityConfig | None = None
) -> list[dict[str, Any]]:
    """Replay LRL/iFVG signals against bid/ask ticks."""

    cfg = config or LRLLiquidityConfig()
    if cfg.stop_buffer_points < 0 or cfg.min_stop_points <= 0:
        raise ValueError("invalid stop configuration")
    if cfg.max_stop_points < cfg.min_stop_points or cfg.target_r <= 0:
        raise ValueError("invalid stop or target configuration")
    if cfg.cooldown_minutes < 0:
        raise ValueError("cooldown_minutes cannot be negative")
    if cfg.max_consecutive_losses is not None and cfg.max_consecutive_losses < 1:
        raise ValueError("max_consecutive_losses must be positive")
    ordered_ticks = sorted(ticks, key=lambda item: int(item["timestamp"]))
    base_bars = build_bars(ordered_ticks, cfg.base_timeframe_seconds)
    signals = detect_lrl_signals(ordered_ticks, cfg)
    base_by_time = {int(bar["time"]): index for index, bar in enumerate(base_bars)}
    trades: list[dict[str, Any]] = []
    signal_index = 0
    position: dict[str, Any] | None = None
    cooldown_until_ms = 0
    consecutive_losses = 0
    halted = False

    for tick in ordered_ticks:
        timestamp_ms = int(tick["timestamp"])
        timestamp = timestamp_ms // 1000
        while signal_index < len(signals):
            signal = signals[signal_index]
            signal_end = signal.bar_time + cfg.base_timeframe_seconds
            if timestamp < signal_end:
                break
            signal_index += 1
            if (
                position is not None
                or len(trades) >= cfg.max_trades
                or halted
                or timestamp_ms < cooldown_until_ms
            ):
                continue
            entry = float(tick["bidPrice"] if signal.side == "SHORT" else tick["askPrice"])
            bar_index = base_by_time.get(signal.bar_time, signal.signal_index)
            stop = _recent_swing_stop(base_bars, bar_index, signal.side, cfg.stop_buffer_points)
            risk = stop - entry if signal.side == "SHORT" else entry - stop
            if not cfg.min_stop_points <= risk <= cfg.max_stop_points:
                continue
            target = entry - risk * cfg.target_r if signal.side == "SHORT" else entry + risk * cfg.target_r
            position = {
                "signal": signal,
                "entry": entry,
                "stop": stop,
                "target": target,
                "entry_ts_ms": timestamp_ms,
            }
            break

        if position is None:
            continue
        signal = position["signal"]
        bid = float(tick["bidPrice"])
        ask = float(tick["askPrice"])
        if signal.side == "LONG":
            stop_hit = bid <= position["stop"]
            target_hit = bid >= position["target"]
        else:
            stop_hit = ask >= position["stop"]
            target_hit = bid <= position["target"]
        if stop_hit or target_hit:
            result = "SL" if stop_hit else "TP"
            exit_price = position["stop"] if stop_hit else position["target"]
            trades.append(
                _make_trade(
                    signal,
                    position["entry"],
                    position["stop"],
                    position["target"],
                    position["entry_ts_ms"],
                    exit_price,
                    timestamp_ms,
                    result,
                    cfg,
                )
            )
            cooldown_until_ms = timestamp_ms + int(cfg.cooldown_minutes * 60_000)
            if result == "SL":
                consecutive_losses += 1
                if (
                    cfg.max_consecutive_losses is not None
                    and consecutive_losses >= cfg.max_consecutive_losses
                ):
                    halted = True
            elif result == "TP":
                consecutive_losses = 0
            position = None
            continue
        if timestamp_ms - position["entry_ts_ms"] >= cfg.max_hold_bars * 60_000:
            exit_price = bid if signal.side == "LONG" else ask
            trades.append(
                _make_trade(
                    signal,
                    position["entry"],
                    position["stop"],
                    position["target"],
                    position["entry_ts_ms"],
                    exit_price,
                    timestamp_ms,
                    "TIME",
                    cfg,
                )
            )
            cooldown_until_ms = timestamp_ms + int(cfg.cooldown_minutes * 60_000)
            position = None

    if position is not None and ordered_ticks:
        last = ordered_ticks[-1]
        exit_price = float(last["bidPrice"] if position["signal"].side == "LONG" else last["askPrice"])
        trades.append(
            _make_trade(
                position["signal"],
                position["entry"],
                position["stop"],
                position["target"],
                position["entry_ts_ms"],
                exit_price,
                int(last["timestamp"]),
                "EOD",
                cfg,
            )
        )
    return trades


def _load_ticks(date_value: str) -> tuple[list[dict[str, Any]], float, str]:
    from timeless_reversion import load_nq_ticks_for_date

    return load_nq_ticks_for_date(date_value)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", default="2026-09-14")
    parser.add_argument("--profile", choices=["chart", "measured"], default="chart")
    parser.add_argument("--entry-start", default="18:00")
    parser.add_argument("--entry-end", default="02:00")
    parser.add_argument("--target-r", type=float, default=1.0)
    parser.add_argument("--max-trades", type=int, default=20)
    parser.add_argument("--cooldown-minutes", type=float, default=0.0)
    parser.add_argument("--max-consecutive-losses", type=int, default=None)
    parser.add_argument(
        "--no-fvg-retest",
        dest="require_fvg_retest",
        action="store_false",
        default=True,
        help="allow the first inversion impulse instead of waiting for the cyan-zone retest",
    )
    parser.add_argument("--contracts", type=int, default=6)
    args = parser.parse_args()
    ticks, basis, source = _load_ticks(args.date)
    base_config = measured_lrl_config() if args.profile == "measured" else LRLLiquidityConfig()
    config = LRLLiquidityConfig(
        **{
            **base_config.__dict__,
            "entry_start": args.entry_start,
            "entry_end": args.entry_end,
            "target_r": args.target_r,
            "require_fvg_retest": args.require_fvg_retest,
            "max_trades": args.max_trades,
            "cooldown_minutes": args.cooldown_minutes,
            "max_consecutive_losses": args.max_consecutive_losses,
            "contracts": args.contracts,
        }
    )
    signals = detect_lrl_signals(ticks, config)
    trades = run_lrl_liquidity_strategy(ticks, config)
    print(
        f"date={args.date} source={source} ticks={len(ticks):,} basis={basis:+.2f} "
        f"signals={len(signals)} trades={len(trades)}"
    )
    points = sum(float(trade["pnl"]) for trade in trades)
    print(f"gross_pnl={points:+.2f} points / ${points * config.contracts * config.point_value:+,.2f}")
    for trade in trades:
        entry = datetime.fromtimestamp(trade["time"], tz=UTC).astimezone(ET)
        exit_time = datetime.fromtimestamp(trade["exit_time"], tz=UTC).astimezone(ET)
        print(
            f"  {entry:%Y-%m-%d %H:%M:%S} {trade['side']} "
            f"{trade['entry']:.2f} -> {trade['result']} {trade['exit']:.2f} "
            f"at {exit_time:%H:%M:%S} PnL {trade['pnl']:+.2f} ({trade['rr']:+.2f}R) "
            f"LRL {trade['meta']['lrl_direction']} x{trade['meta']['lrl_touches']} "
            f"FVG {trade['meta']['fvg_timeframe_seconds']}s"
        )


if __name__ == "__main__":
    main()
