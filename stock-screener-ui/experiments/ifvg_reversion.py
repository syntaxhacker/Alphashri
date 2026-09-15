"""Five-minute inverse Fair Value Gap (iFVG) strategy.

The chart supplied with the request shows a long taken after a five-minute
imbalance flipped into support.  This module models that setup without
changing the existing fair-price/BOS strategies:

* detect bullish and bearish three-candle fair-value gaps;
* wait for a close through the gap so it inverts polarity;
* enter on a later retest with a directional confirmation candle;
* place the stop beyond the inverted zone and target a configurable R-multiple.

The chart does not define a unique trendline, volume, or higher-timeframe
rule, so those are not silently invented here.  They can be added as tested
filters after the base iFVG behavior is validated.
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_DIR not in sys.path:
    sys.path.insert(0, REPO_DIR)

ET = ZoneInfo("America/New_York")
UTC = timezone.utc


@dataclass(frozen=True)
class IFVGConfig:
    timeframe_minutes: int = 5
    min_gap_points: float = 1.0
    retest_tolerance_points: float = 0.0
    stop_buffer_points: float = 1.0
    min_stop_points: float = 1.0
    max_stop_points: float = 40.0
    target_r: float = 1.5
    max_bars_after_inversion: int = 12
    max_trades: int = 20
    require_directional_retest: bool = True
    entry_start: str | None = "09:30"
    entry_end: str | None = "16:00"
    contracts: int = 2
    point_value: float = 20.0


@dataclass(frozen=True)
class IFVGZone:
    kind: str
    low: float
    high: float
    created_index: int


@dataclass(frozen=True)
class IFVGSignal:
    side: str
    bar_time: int
    zone: IFVGZone
    inversion_index: int
    signal_index: int


def _parse_clock(value: str) -> int:
    hour, minute = (int(part) for part in value.split(":", 1))
    if not 0 <= hour <= 23 or not 0 <= minute <= 59:
        raise ValueError(f"invalid ET clock value: {value!r}")
    return hour * 60 + minute


def _et_minutes(timestamp: int) -> int:
    local = datetime.fromtimestamp(timestamp, tz=UTC).astimezone(ET)
    return local.hour * 60 + local.minute


def _within_window(timestamp: int, start: str | None, end: str | None) -> bool:
    if start is None and end is None:
        return True
    minutes = _et_minutes(timestamp)
    start_min = _parse_clock(start) if start is not None else 0
    end_min = _parse_clock(end) if end is not None else 24 * 60
    if start_min <= end_min:
        return start_min <= minutes < end_min
    return minutes >= start_min or minutes < end_min


def aggregate_bars(
    bars: list[dict[str, Any]], timeframe_minutes: int = 5
) -> list[dict[str, Any]]:
    """Aggregate minute bars into fixed UTC-aligned OHLC bars."""

    if timeframe_minutes < 1:
        raise ValueError("timeframe_minutes must be at least 1")
    width = timeframe_minutes * 60
    grouped: dict[int, dict[str, Any]] = {}
    for source in sorted(bars, key=lambda item: int(item["time"])):
        bucket = int(source["time"]) // width * width
        target = grouped.get(bucket)
        if target is None:
            grouped[bucket] = {
                "time": bucket,
                "open": float(source["open"]),
                "high": float(source["high"]),
                "low": float(source["low"]),
                "close": float(source["close"]),
            }
            continue
        target["high"] = max(target["high"], float(source["high"]))
        target["low"] = min(target["low"], float(source["low"]))
        target["close"] = float(source["close"])
    return [grouped[key] for key in sorted(grouped)]


def detect_ifvg_signals(
    bars: list[dict[str, Any]], config: IFVGConfig | None = None
) -> list[IFVGSignal]:
    """Find confirmed iFVG retests using completed bars only."""

    cfg = config or IFVGConfig()
    if cfg.min_gap_points < 0 or cfg.retest_tolerance_points < 0:
        raise ValueError("gap and retest tolerances cannot be negative")
    if cfg.max_bars_after_inversion < 1:
        raise ValueError("max_bars_after_inversion must be positive")

    ordered = sorted(bars, key=lambda item: int(item["time"]))
    zones: list[IFVGZone] = []
    active: list[tuple[IFVGZone, str, int]] = []
    inverted: set[IFVGZone] = set()
    signals: list[IFVGSignal] = []

    for index, bar in enumerate(ordered):
        high = float(bar["high"])
        low = float(bar["low"])
        close = float(bar["close"])
        open_ = float(bar["open"])

        if index >= 2:
            left = ordered[index - 2]
            left_low = float(left["low"])
            left_high = float(left["high"])
            bullish_gap = low - left_high
            bearish_gap = left_low - high
            if bullish_gap >= cfg.min_gap_points:
                zones.append(IFVGZone("BULLISH_FVG", left_high, low, index))
            if bearish_gap >= cfg.min_gap_points:
                zones.append(IFVGZone("BEARISH_FVG", high, left_low, index))

        for zone in zones:
            if zone.created_index >= index:
                continue
            if zone in inverted:
                continue
            if zone.kind == "BEARISH_FVG" and close > zone.high:
                active.append((zone, "LONG", index))
                inverted.add(zone)
            elif zone.kind == "BULLISH_FVG" and close < zone.low:
                active.append((zone, "SHORT", index))
                inverted.add(zone)

        next_active: list[tuple[IFVGZone, str, int]] = []
        for zone, side, inversion_index in active:
            age = index - inversion_index
            if age > cfg.max_bars_after_inversion:
                continue
            if index <= inversion_index:
                next_active.append((zone, side, inversion_index))
                continue

            if side == "LONG":
                retested = low <= zone.high + cfg.retest_tolerance_points
                confirmed = close > zone.high
                directional = close > open_
            else:
                retested = high >= zone.low - cfg.retest_tolerance_points
                confirmed = close < zone.low
                directional = close < open_

            if retested and confirmed and (directional or not cfg.require_directional_retest):
                signals.append(
                    IFVGSignal(
                        side=side,
                        bar_time=int(bar["time"]),
                        zone=zone,
                        inversion_index=inversion_index,
                        signal_index=index,
                    )
                )
                continue
            next_active.append((zone, side, inversion_index))
        active = next_active

    return signals


def _make_trade(
    signal: IFVGSignal,
    entry: float,
    entry_ts_ms: int,
    stop: float,
    target: float,
    result: str,
    exit_price: float,
    exit_ts_ms: int,
    config: IFVGConfig,
) -> dict[str, Any]:
    pnl = exit_price - entry if signal.side == "LONG" else entry - exit_price
    risk = abs(entry - stop)
    return {
        "time": int(entry_ts_ms // 1000),
        "exit_time": int(exit_ts_ms // 1000),
        "side": signal.side,
        "kind": "5m-ifvg-reversion",
        "entry": round(entry, 2),
        "sl": round(stop, 2),
        "tp": round(target, 2),
        "exit": round(exit_price, 2),
        "result": result,
        "pnl": round(pnl, 2),
        "rr": round(pnl / risk, 2) if risk else 0.0,
        "meta": {
            "zone_low": round(signal.zone.low, 2),
            "zone_high": round(signal.zone.high, 2),
            "zone_kind": signal.zone.kind,
            "signal_bar": signal.bar_time,
            "inversion_bar": signal.inversion_index,
            "contracts": config.contracts,
            "risk_usd": round(risk * config.contracts * config.point_value, 2),
            "pnl_usd_gross": round(pnl * config.contracts * config.point_value, 2),
            "entry_reason": f"{signal.side} 5m iFVG retest after polarity inversion",
            "exit_reason": result,
        },
    }


def run_ifvg_reversion(
    bars: list[dict[str, Any]],
    ticks: list[dict[str, Any]],
    *,
    config: IFVGConfig | None = None,
) -> list[dict[str, Any]]:
    """Replay iFVG signals with bid/ask-aware tick exits."""

    cfg = config or IFVGConfig()
    if cfg.stop_buffer_points < 0 or cfg.min_stop_points <= 0:
        raise ValueError("stop_buffer_points must be non-negative and min_stop_points positive")
    if cfg.max_stop_points < cfg.min_stop_points or cfg.target_r <= 0:
        raise ValueError("invalid stop or target configuration")
    if cfg.max_trades < 1:
        raise ValueError("max_trades must be positive")

    five_minute_bars = aggregate_bars(bars, cfg.timeframe_minutes)
    signals = detect_ifvg_signals(five_minute_bars, cfg)
    ordered_ticks = sorted(ticks, key=lambda item: int(item["timestamp"]))
    trades: list[dict[str, Any]] = []
    signal_index = 0
    position: dict[str, Any] | None = None

    for tick in ordered_ticks:
        timestamp_ms = int(tick["timestamp"])
        timestamp = timestamp_ms // 1000

        while signal_index < len(signals):
            signal = signals[signal_index]
            signal_end = signal.bar_time + cfg.timeframe_minutes * 60
            if timestamp < signal_end:
                break
            signal_index += 1
            # Signals that matured while another trade was open are stale and
            # must not be entered after the fact.
            if position is not None:
                continue
            if len(trades) >= cfg.max_trades or not _within_window(
                signal_end, cfg.entry_start, cfg.entry_end
            ):
                continue
            if signal.side == "LONG":
                entry = float(tick["askPrice"])
                stop = signal.zone.low - cfg.stop_buffer_points
                risk = entry - stop
                target = entry + risk * cfg.target_r
            else:
                entry = float(tick["bidPrice"])
                stop = signal.zone.high + cfg.stop_buffer_points
                risk = stop - entry
                target = entry - risk * cfg.target_r
            if not cfg.min_stop_points <= risk <= cfg.max_stop_points:
                continue
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
        if signal.side == "LONG":
            stop_hit = float(tick["bidPrice"]) <= position["stop"]
            target_hit = float(tick["bidPrice"]) >= position["target"]
        else:
            stop_hit = float(tick["askPrice"]) >= position["stop"]
            target_hit = float(tick["bidPrice"]) <= position["target"]

        if stop_hit or target_hit:
            result = "SL" if stop_hit else "TP"
            exit_price = position["stop"] if stop_hit else position["target"]
            trades.append(
                _make_trade(
                    signal,
                    position["entry"],
                    position["entry_ts_ms"],
                    position["stop"],
                    position["target"],
                    result,
                    exit_price,
                    timestamp_ms,
                    cfg,
                )
            )
            position = None

    if position is not None and ordered_ticks:
        last_tick = ordered_ticks[-1]
        exit_price = (
            float(last_tick["bidPrice"])
            if position["signal"].side == "LONG"
            else float(last_tick["askPrice"])
        )
        trades.append(
            _make_trade(
                position["signal"],
                position["entry"],
                position["entry_ts_ms"],
                position["stop"],
                position["target"],
                "EOD",
                exit_price,
                int(last_tick["timestamp"]),
                cfg,
            )
        )

    return trades


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", default="2026-09-14")
    parser.add_argument("--entry-start", default="09:30")
    parser.add_argument("--entry-end", default="16:00")
    parser.add_argument("--target-r", type=float, default=1.5)
    parser.add_argument("--max-stop-points", type=float, default=40.0)
    parser.add_argument("--min-gap-points", type=float, default=1.0)
    parser.add_argument("--contracts", type=int, default=2)
    parser.add_argument("--point-value", type=float, default=20.0)
    args = parser.parse_args()

    from scripts.smc_tick_eval import build_1m_bars
    from timeless_reversion import load_nq_ticks_for_date

    ticks, basis, source = load_nq_ticks_for_date(args.date)
    bars = build_1m_bars(ticks)
    config = IFVGConfig(
        entry_start=args.entry_start,
        entry_end=args.entry_end,
        target_r=args.target_r,
        max_stop_points=args.max_stop_points,
        min_gap_points=args.min_gap_points,
        contracts=args.contracts,
        point_value=args.point_value,
    )
    five_minute_bars = aggregate_bars(bars, config.timeframe_minutes)
    signals = detect_ifvg_signals(five_minute_bars, config)
    trades = run_ifvg_reversion(bars, ticks, config=config)
    points = sum(float(trade["pnl"]) for trade in trades)
    print(
        f"date={args.date} source={source} ticks={len(ticks):,} "
        f"1m_bars={len(bars)} 5m_bars={len(five_minute_bars)} basis={basis:+.2f}"
    )
    print(f"signals={len(signals)} trades={len(trades)}")
    print(f"gross_pnl={points:+.2f} points / ${points * config.contracts * config.point_value:+,.2f}")
    for trade in trades:
        entry = datetime.fromtimestamp(trade["time"], tz=UTC).astimezone(ET)
        exit_time = datetime.fromtimestamp(trade["exit_time"], tz=UTC).astimezone(ET)
        print(
            f"  {entry:%Y-%m-%d %H:%M:%S} {trade['side']} "
            f"{trade['entry']:.2f} -> {trade['result']} {trade['exit']:.2f} "
            f"at {exit_time:%H:%M:%S} PnL {trade['pnl']:+.2f} ({trade['rr']:+.2f}R)"
        )


if __name__ == "__main__":
    main()
