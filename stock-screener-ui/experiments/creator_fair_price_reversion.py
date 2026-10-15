"""Creator-style fair-price/BOS reversion variant.

This is deliberately separate from ``timeless_reversion.py``. It models the
rules described in the supplied creator transcript:

* the fair-price anchor can be changed at explicit event times;
* both long and short reversions are supported;
* Asia, PM, and New York session windows are configurable;
* a 25-point stop and 1.5R target are the default bracket;
* entries require a wick-and-close break of the opposite local structure.

The existing production candidate remains untouched. The creator's manual
news/fair-price decisions are represented as explicit ``FairPriceEvent``
objects so they cannot introduce look-ahead.
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from typing import Any, Iterable
from zoneinfo import ZoneInfo

REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_DIR not in sys.path:
    sys.path.insert(0, REPO_DIR)

ET = ZoneInfo("America/New_York")
UTC = timezone.utc


@dataclass(frozen=True)
class SessionWindow:
    name: str
    start: str
    end: str
    fair_clock: str | None = None


DEFAULT_SESSIONS = (
    SessionWindow("asia", "18:00", "02:00", "18:00"),
    SessionWindow("pm", "02:00", "09:30", "02:00"),
    SessionWindow("new_york", "09:30", "16:00", "09:30"),
)


@dataclass(frozen=True)
class FairPriceEvent:
    """An explicit ET fair-price reset.

    If ``price`` is None, the event uses that minute's bar open. This is the
    non-lookahead equivalent of clicking a news candle in the creator's tool.
    """

    clock: str
    price: float | None = None
    label: str = "manual"
    session: str | None = None


@dataclass(frozen=True)
class CreatorReversionConfig:
    min_distance: float = 30.0
    bos_lookback: int = 1
    stop_points: float = 25.0
    target_r: float = 1.5
    cooldown_minutes: float = 0.0
    max_trades_per_session: int = 20
    max_entries_per_zone: int = 2
    rearm_points: float = 20.0
    bos_confirmation_bars: int = 0
    sessions: tuple[SessionWindow, ...] = DEFAULT_SESSIONS
    fair_price_events: tuple[FairPriceEvent, ...] = ()
    # Optional research filters. They default off to match the creator rules.
    max_signal_range_points: float | None = None
    opening_range_max_points: float | None = None
    opening_range_minutes: int = 30
    # Optional non-lookahead activity gate: wait for the first activity window
    # and require at least this many raw ticks in it.
    min_session_ticks: int | None = None
    activity_window_minutes: int = 30
    contracts: int = 6
    point_value: float = 2.0


def _et_minutes(timestamp: int) -> int:
    local = datetime.fromtimestamp(timestamp, tz=UTC).astimezone(ET)
    return local.hour * 60 + local.minute


def _parse_clock(value: str) -> int:
    hour, minute = (int(part) for part in value.split(":", 1))
    if not 0 <= hour <= 23 or not 0 <= minute <= 59:
        raise ValueError(f"invalid ET clock value: {value!r}")
    return hour * 60 + minute


def _in_window(minutes: int, start: int, end: int) -> bool:
    if start <= end:
        return start <= minutes < end
    return minutes >= start or minutes < end


def _session_for(timestamp: int, sessions: tuple[SessionWindow, ...]) -> str | None:
    minutes = _et_minutes(timestamp)
    for session in sessions:
        if _in_window(minutes, _parse_clock(session.start), _parse_clock(session.end)):
            return session.name
    return None


def _first_tick_by_bar(ticks: list[dict[str, Any]]) -> dict[int, list[dict[str, Any]]]:
    grouped: dict[int, list[dict[str, Any]]] = {}
    for tick in sorted(ticks, key=lambda item: item["timestamp"]):
        minute = int(tick["timestamp"] // 1000 // 60) * 60
        grouped.setdefault(minute, []).append(tick)
    return grouped


def _bar_at_clock(bars: list[dict[str, Any]], clock: str) -> dict[str, Any] | None:
    wanted = _parse_clock(clock)
    return next((bar for bar in bars if _et_minutes(int(bar["time"])) == wanted), None)


def _fair_price_events(
    bars: list[dict[str, Any]], events: tuple[FairPriceEvent, ...]
) -> dict[int, tuple[float, str]]:
    resolved: dict[int, tuple[float, str]] = {}
    for event in sorted(events, key=lambda item: _parse_clock(item.clock)):
        bar = _bar_at_clock(bars, event.clock)
        if bar is None:
            continue
        price = float(bar["open"]) if event.price is None else float(event.price)
        resolved[int(bar["time"])] = (price, event.label)
    return resolved


def _resolved_scoped_events(
    bars: list[dict[str, Any]], events: tuple[FairPriceEvent, ...]
) -> dict[tuple[int, str | None], tuple[float, str]]:
    resolved: dict[tuple[int, str | None], tuple[float, str]] = {}
    for event in sorted(events, key=lambda item: _parse_clock(item.clock)):
        bar = _bar_at_clock(bars, event.clock)
        if bar is None:
            continue
        price = float(bar["open"]) if event.price is None else float(event.price)
        resolved[(int(bar["time"]), event.session)] = (price, event.label)
    return resolved


def _opening_range(
    bars: list[dict[str, Any]], minutes: int
) -> tuple[int, int, float] | None:
    if minutes < 1:
        raise ValueError("opening_range_minutes must be at least 1")
    opening = _bar_at_clock(bars, "09:30")
    if opening is None:
        return None
    start = int(opening["time"])
    ready = start + minutes * 60
    window = [bar for bar in bars if start <= int(bar["time"]) < ready]
    if not window:
        return None
    return start, ready, max(float(bar["high"]) for bar in window) - min(
        float(bar["low"]) for bar in window
    )


def _session_elapsed(minutes: int, session: SessionWindow) -> int:
    start = _parse_clock(session.start)
    return (minutes - start) % (24 * 60)


def _session_activity(
    ticks: list[dict[str, Any]], sessions: tuple[SessionWindow, ...], window_minutes: int
) -> dict[str, int]:
    counts = {session.name: 0 for session in sessions}
    for tick in ticks:
        minutes = _et_minutes(int(tick["timestamp"] // 1000))
        for session in sessions:
            if 0 <= _session_elapsed(minutes, session) < window_minutes:
                counts[session.name] += 1
    return counts


def _trade(
    position: dict[str, Any], exit_price: float, result: str, exit_ts_ms: int
) -> dict[str, Any]:
    side = position["side"]
    pnl = exit_price - position["entry"] if side == "LONG" else position["entry"] - exit_price
    return {
        "time": int(position["entry_ts_ms"] // 1000),
        "exit_time": int(exit_ts_ms // 1000),
        "side": side,
        "kind": "creator-fair-price-bos",
        "session": position["session"],
        "entry": round(position["entry"], 2),
        "sl": round(position["sl"], 2),
        "tp": round(position["tp"], 2),
        "exit": round(exit_price, 2),
        "result": result,
        "pnl": round(pnl, 2),
        "rr": round(pnl / position["risk"], 2),
        "meta": {
            "fair_price": round(position["fair_price"], 2),
            "fair_label": position["fair_label"],
            "distance_at_signal": round(
                abs(position["signal_price"] - position["fair_price"]), 2
            ),
            "bos_level": round(position["bos_level"], 2),
            "signal_bar": position["signal_bar"],
            "signal_price": round(position["signal_price"], 2),
            "contracts": position["contracts"],
            "risk_usd": round(position["risk"] * position["contracts"] * position["point_value"], 2),
            "pnl_usd_gross": round(pnl * position["contracts"] * position["point_value"], 2),
            "entry_reason": (
                f"{side} after {side.lower()} wick/BOS at {position['bos_level']:.2f}; "
                f"fair price {position['fair_price']:.2f} ({position['fair_label']})"
            ),
            "exit_reason": result,
        },
    }


def run_creator_reversion(
    bars: list[dict[str, Any]],
    ticks: list[dict[str, Any]],
    *,
    initial_fair_price: float | None = None,
    config: CreatorReversionConfig | None = None,
) -> list[dict[str, Any]]:
    """Replay creator-style fair-price reversions on bars and bid/ask ticks."""

    cfg = config or CreatorReversionConfig()
    if cfg.bos_lookback < 1 or cfg.bos_confirmation_bars < 0:
        raise ValueError("bos_lookback must be >=1 and confirmation cannot be negative")
    if cfg.stop_points <= 0 or cfg.target_r <= 0 or cfg.min_distance < 0:
        raise ValueError("stop_points, target_r, and min_distance must be positive")
    if cfg.max_signal_range_points is not None and cfg.max_signal_range_points <= 0:
        raise ValueError("max_signal_range_points must be positive")
    if cfg.opening_range_max_points is not None and cfg.opening_range_max_points <= 0:
        raise ValueError("opening_range_max_points must be positive")
    if cfg.min_session_ticks is not None and cfg.min_session_ticks < 1:
        raise ValueError("min_session_ticks must be positive")
    if cfg.activity_window_minutes < 1:
        raise ValueError("activity_window_minutes must be at least 1")

    bars = sorted(bars, key=lambda item: int(item["time"]))
    ticks_by_bar = _first_tick_by_bar(ticks)
    fair_events = _resolved_scoped_events(bars, cfg.fair_price_events)
    session_by_name = {session.name: session for session in cfg.sessions}
    activity_counts = (
        _session_activity(ticks, cfg.sessions, cfg.activity_window_minutes)
        if cfg.min_session_ticks is not None
        else {}
    )
    opening_range = (
        _opening_range(bars, cfg.opening_range_minutes)
        if cfg.opening_range_max_points is not None
        else None
    )
    fair_by_session: dict[str, tuple[float, str]] = {}
    active_fair_key: tuple[str, float, str] | None = None

    trades: list[dict[str, Any]] = []
    position: dict[str, Any] | None = None
    pending: dict[str, Any] | None = None
    cooldown_until_ms = 0
    pivot_low: float | None = None
    pivot_high: float | None = None
    short_broken = False
    long_broken = False
    short_armed = False
    long_armed = False
    entries_by_zone = {"LONG": 0, "SHORT": 0}
    rearm_required = {"LONG": False, "SHORT": False}
    rearm_extreme: dict[str, float | None] = {"LONG": None, "SHORT": None}
    session_trade_counts: dict[str, int] = {}

    for index, bar in enumerate(bars):
        bar_time = int(bar["time"])
        bar_ticks = ticks_by_bar.get(bar_time, [])
        session = _session_for(bar_time, cfg.sessions)

        for (event_time, event_session), event_value in fair_events.items():
            if event_time != bar_time:
                continue
            target_session = event_session or session
            if target_session is not None:
                fair_by_session[target_session] = event_value

        if session is None:
            continue

        session_config = session_by_name[session]
        fair_clock = session_config.fair_clock or session_config.start
        if _et_minutes(bar_time) == _parse_clock(fair_clock) and session not in fair_by_session:
            fair_by_session[session] = (float(bar["open"]), f"{session} open")
        if session not in fair_by_session:
            continue

        if cfg.min_session_ticks is not None:
            session_config = session_by_name[session]
            elapsed = _session_elapsed(_et_minutes(bar_time), session_config)
            if elapsed < cfg.activity_window_minutes:
                continue
            if activity_counts.get(session, 0) < cfg.min_session_ticks:
                continue

        fair_price, fair_label = fair_by_session[session]
        fair_key = (session, fair_price, fair_label)
        if fair_key != active_fair_key:
            active_fair_key = fair_key
            short_armed = False
            long_armed = False
            pivot_low = None
            pivot_high = None
            short_broken = False
            long_broken = False
            pending = None

        for side in ("LONG", "SHORT"):
            if rearm_required[side]:
                if side == "LONG":
                    extreme = rearm_extreme[side]
                    extreme = max(float(bar["high"]), extreme) if extreme is not None else float(bar["high"])
                    rearm_extreme[side] = extreme
                    if float(bar["low"]) <= extreme - cfg.rearm_points:
                        rearm_required[side] = False
                        rearm_extreme[side] = None
                        entries_by_zone[side] = 0
                else:
                    extreme = rearm_extreme[side]
                    extreme = min(float(bar["low"]), extreme) if extreme is not None else float(bar["low"])
                    rearm_extreme[side] = extreme
                    if float(bar["high"]) >= extreme + cfg.rearm_points:
                        rearm_required[side] = False
                        rearm_extreme[side] = None
                        entries_by_zone[side] = 0

        span = cfg.bos_lookback
        candidate_index = index - span
        if candidate_index >= span:
            candidate = bars[candidate_index]
            left = bars[candidate_index - span:candidate_index]
            right = bars[candidate_index + 1:index + 1]
            if left and right:
                if all(float(candidate["low"]) < float(item["low"]) for item in (*left, *right)):
                    pivot_low = float(candidate["low"])
                    short_broken = False
                if all(float(candidate["high"]) > float(item["high"]) for item in (*left, *right)):
                    pivot_high = float(candidate["high"])
                    long_broken = False

        if pending is not None and index == pending["entry_index"]:
            confirm_start = index - cfg.bos_confirmation_bars
            confirm_bars = bars[confirm_start:index]
            confirmed = len(confirm_bars) == cfg.bos_confirmation_bars and all(
                (float(item["close"]) <= pending["bos_level"] if pending["side"] == "SHORT"
                 else float(item["close"]) >= pending["bos_level"])
                for item in confirm_bars
            )
            if confirmed and bar_ticks and session == pending["session"]:
                count = session_trade_counts.get(session, 0)
                if count < cfg.max_trades_per_session and not rearm_required[pending["side"]]:
                    first = bar_ticks[0]
                    side = pending["side"]
                    entry = float(first["askPrice"] if side == "LONG" else first["bidPrice"])
                    risk = cfg.stop_points
                    position = {
                        "side": side,
                        "entry": entry,
                        "entry_ts_ms": int(first["timestamp"]),
                        "sl": entry - risk if side == "LONG" else entry + risk,
                        "tp": entry + risk * cfg.target_r if side == "LONG" else entry - risk * cfg.target_r,
                        "risk": risk,
                        "fair_price": pending["fair_price"],
                        "fair_label": pending["fair_label"],
                        "signal_price": pending["signal_price"],
                        "bos_level": pending["bos_level"],
                        "signal_bar": pending["signal_bar"],
                        "session": session,
                        "contracts": cfg.contracts,
                        "point_value": cfg.point_value,
                    }
                    session_trade_counts[session] = count + 1
                    bar_ticks = bar_ticks[1:]
            pending = None

        if position is not None:
            for tick in bar_ticks:
                side = position["side"]
                if side == "LONG":
                    stop_hit = float(tick["bidPrice"]) <= position["sl"]
                    target_hit = float(tick["bidPrice"]) >= position["tp"]
                else:
                    stop_hit = float(tick["askPrice"]) >= position["sl"]
                    target_hit = float(tick["bidPrice"]) <= position["tp"]
                if stop_hit:
                    trades.append(_trade(position, position["sl"], "SL", int(tick["timestamp"])))
                    entries_by_zone[side] += 1
                    if entries_by_zone[side] >= cfg.max_entries_per_zone:
                        rearm_required[side] = True
                        rearm_extreme[side] = float(bar["high"] if side == "LONG" else bar["low"])
                    cooldown_until_ms = int(tick["timestamp"]) + int(cfg.cooldown_minutes * 60_000)
                    position = None
                    break
                if target_hit:
                    trades.append(_trade(position, position["tp"], "TP", int(tick["timestamp"])))
                    entries_by_zone[side] += 1
                    if entries_by_zone[side] >= cfg.max_entries_per_zone:
                        rearm_required[side] = True
                        rearm_extreme[side] = float(bar["high"] if side == "LONG" else bar["low"])
                    cooldown_until_ms = int(tick["timestamp"]) + int(cfg.cooldown_minutes * 60_000)
                    position = None
                    break

        if position is not None or pending is not None:
            continue
        if index < cfg.bos_lookback or bar_time * 1000 < cooldown_until_ms:
            continue
        if opening_range is not None:
            _, ready, points = opening_range
            if bar_time < ready or points > cfg.opening_range_max_points:
                continue
        if cfg.max_signal_range_points is not None and float(bar["high"]) - float(bar["low"]) > cfg.max_signal_range_points:
            continue

        short_zone = fair_price + cfg.min_distance
        long_zone = fair_price - cfg.min_distance
        if float(bar["high"]) >= short_zone and float(bar["close"]) >= fair_price:
            short_armed = True
        if float(bar["low"]) <= long_zone and float(bar["close"]) <= fair_price:
            long_armed = True

        if short_armed and not rearm_required["SHORT"] and pivot_low is not None and not short_broken:
            if float(bar["low"]) < pivot_low and float(bar["close"]) < pivot_low:
                short_broken = True
                pending = {
                    "entry_index": index + cfg.bos_confirmation_bars + 1,
                    "side": "SHORT",
                    "signal_bar": bar_time,
                    "signal_price": float(bar["close"]),
                    "bos_level": pivot_low,
                    "fair_price": fair_price,
                    "fair_label": fair_label,
                    "session": session,
                }
                continue
        if long_armed and not rearm_required["LONG"] and pivot_high is not None and not long_broken:
            if float(bar["high"]) > pivot_high and float(bar["close"]) > pivot_high:
                long_broken = True
                pending = {
                    "entry_index": index + cfg.bos_confirmation_bars + 1,
                    "side": "LONG",
                    "signal_bar": bar_time,
                    "signal_price": float(bar["close"]),
                    "bos_level": pivot_high,
                    "fair_price": fair_price,
                    "fair_label": fair_label,
                    "session": session,
                }

    return trades


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", default="2026-09-14")
    parser.add_argument("--session", action="append", choices=["asia", "pm", "new_york"], dest="sessions")
    parser.add_argument("--new-york-end", default="16:00")
    parser.add_argument("--news-clock", action="append", default=[])
    parser.add_argument("--max-signal-range-points", type=float, default=None)
    parser.add_argument("--opening-range-max-points", type=float, default=None)
    parser.add_argument("--opening-range-minutes", type=int, default=30)
    parser.add_argument("--min-session-ticks", type=int, default=None)
    parser.add_argument("--activity-window-minutes", type=int, default=30)
    args = parser.parse_args()

    from scripts.smc_tick_eval import build_1m_bars
    from timeless_reversion import load_nq_ticks_for_date

    ticks, basis, source = load_nq_ticks_for_date(args.date)
    bars = build_1m_bars(ticks)
    sessions = tuple(
        SessionWindow(session.name, session.start, args.new_york_end, session.fair_clock)
        if session.name == "new_york"
        else session
        for session in DEFAULT_SESSIONS
        if not args.sessions or session.name in args.sessions
    )
    events = tuple(
        FairPriceEvent(clock=clock, label=f"event {clock}", session="new_york")
        for clock in args.news_clock
    )
    config = CreatorReversionConfig(
        sessions=sessions,
        fair_price_events=events,
        max_signal_range_points=args.max_signal_range_points,
        opening_range_max_points=args.opening_range_max_points,
        opening_range_minutes=args.opening_range_minutes,
        min_session_ticks=args.min_session_ticks,
        activity_window_minutes=args.activity_window_minutes,
    )
    initial_bar = _bar_at_clock(bars, events[0].clock) if events else _bar_at_clock(bars, "09:30")
    initial_fair = float(initial_bar["open"]) if initial_bar is not None else None
    trades = run_creator_reversion(bars, ticks, initial_fair_price=initial_fair, config=config)
    print(f"date={args.date} source={source} ticks={len(ticks):,} bars={len(bars)} basis={basis:+.2f}")
    print(f"sessions={','.join(session.name for session in sessions)} trades={len(trades)}")
    points = sum(float(trade["pnl"]) for trade in trades)
    print(f"gross_pnl={points:+.2f} points / ${points * config.contracts * config.point_value:+,.2f}")
    for trade in trades:
        entry = datetime.fromtimestamp(trade["time"], tz=UTC).astimezone(ET)
        exit_time = datetime.fromtimestamp(trade["exit_time"], tz=UTC).astimezone(ET)
        print(
            f"  {entry:%Y-%m-%d %H:%M:%S} {trade['session']} {trade['side']} "
            f"{trade['entry']:.2f} -> {trade['result']} {trade['exit']:.2f} "
            f"at {exit_time:%H:%M:%S} PnL {trade['pnl']:+.2f} ({trade['rr']:+.2f}R)"
        )


if __name__ == "__main__":
    main()
