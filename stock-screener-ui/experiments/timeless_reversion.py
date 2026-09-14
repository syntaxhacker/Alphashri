"""Tick-accurate implementation of the screenshot's fair-price reversion setup.

The strategy is intentionally small and explicit:

* fair price is the 09:30 ET opening price;
* a short thesis is armed only after price trades ``min_distance`` points above
  fair price;
* entry requires a bearish wick/BOS break: the current bar's low and close both
  break the prior structure low;
* the short fills at the first tick of the next bar;
* the default exit bracket is a 25-point stop and 1.5R target;
* exits are resolved from bid/ask ticks, with stop loss winning on ambiguity.

The module is usable with the repository's existing ``build_1m_bars`` output
and Dukascopy tick shape. The CLI fetches Dukascopy ticks and applies the same
NQ basis shift used by ``scripts/nq_ticks.py`` when the local cache is empty.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
import sys
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo


# Allow the script to be run from either stock-screener-ui/ or experiments/.
REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_DIR not in sys.path:
    sys.path.insert(0, REPO_DIR)


ET = ZoneInfo("America/New_York")
UTC = timezone.utc


@dataclass(frozen=True)
class ReversionConfig:
    """Parameters visible or directly implied by the chart setup."""

    min_distance: float = 30.0
    bos_lookback: int = 1
    stop_points: float = 25.0
    target_r: float = 1.5
    cooldown_minutes: float = 0.0
    max_trades: int = 20
    max_entries_per_zone: int = 2
    rearm_points: float = 20.0
    contracts: int = 6
    point_value: float = 2.0
    entry_start: str | None = None
    entry_end: str | None = None


def _first_tick_by_bar(ticks: list[dict[str, Any]]) -> dict[int, list[dict[str, Any]]]:
    grouped: dict[int, list[dict[str, Any]]] = {}
    for tick in sorted(ticks, key=lambda item: item["timestamp"]):
        minute = int(tick["timestamp"] // 1000 // 60) * 60
        grouped.setdefault(minute, []).append(tick)
    return grouped


def _et_minutes(timestamp: int) -> int:
    local = datetime.fromtimestamp(timestamp, tz=UTC).astimezone(ET)
    return local.hour * 60 + local.minute


def _parse_clock(value: str | None) -> int | None:
    if value is None:
        return None
    hour, minute = (int(part) for part in value.split(":", 1))
    if not 0 <= hour <= 23 or not 0 <= minute <= 59:
        raise ValueError(f"invalid ET clock value: {value!r}")
    return hour * 60 + minute


def _inside_entry_window(timestamp: int, config: ReversionConfig) -> bool:
    start = _parse_clock(config.entry_start)
    end = _parse_clock(config.entry_end)
    if start is None or end is None:
        return True
    current = _et_minutes(timestamp)
    if start <= end:
        return start <= current <= end
    return current >= start or current <= end


def fair_price_at_et_open(bars: list[dict[str, Any]], session_date: str, open_clock: str = "09:30") -> float:
    """Return the bar open containing ``open_clock`` in New York time."""

    hour, minute = (int(part) for part in open_clock.split(":", 1))
    local = datetime.combine(date.fromisoformat(session_date), time(hour, minute), tzinfo=ET)
    anchor = int(local.timestamp())
    for bar in bars:
        if bar["time"] <= anchor < bar["time"] + 60:
            return float(bar["open"])
    raise ValueError(f"no 1-minute bar contains {session_date} {open_clock} ET")


def _trade(p: dict[str, Any], exit_price: float, result: str, exit_ts_ms: int) -> dict[str, Any]:
    pnl = p["entry"] - exit_price
    return {
        "time": int(p["entry_ts_ms"] // 1000),
        "exit_time": int(exit_ts_ms // 1000),
        "side": "SHORT",
        "kind": "timeless-reversion-bos",
        "entry": round(p["entry"], 2),
        "sl": round(p["sl"], 2),
        "tp": round(p["tp"], 2),
        "exit": round(exit_price, 2),
        "result": result,
        "pnl": round(pnl, 2),
        "rr": round(pnl / p["risk"], 2),
        "meta": {
            "fair_price": round(p["fair_price"], 2),
            "distance_at_signal": round(p["signal_price"] - p["fair_price"], 2),
            "bos_level": round(p["bos_level"], 2),
            "contracts": p["contracts"],
            "risk_usd": round(p["risk"] * p["contracts"] * p["point_value"], 2),
            "pnl_usd_gross": round(pnl * p["contracts"] * p["point_value"], 2),
            "signal_bar": p["signal_bar"],
            "entry_reason": (
                f"Short after bearish wick/BOS below {p['bos_level']:.2f}; "
                f"fair price {p['fair_price']:.2f}"
            ),
            "exit_reason": result,
        },
    }


def run_timeless_reversion(
    bars: list[dict[str, Any]],
    ticks: list[dict[str, Any]],
    *,
    fair_price: float,
    config: ReversionConfig | None = None,
) -> list[dict[str, Any]]:
    """Run the strategy over canonical 1-minute bars and raw bid/ask ticks."""

    cfg = config or ReversionConfig()
    if cfg.bos_lookback < 1:
        raise ValueError("bos_lookback must be at least 1")
    if cfg.stop_points <= 0 or cfg.target_r <= 0:
        raise ValueError("stop_points and target_r must be positive")

    ticks_by_bar = _first_tick_by_bar(ticks)
    trades: list[dict[str, Any]] = []
    position: dict[str, Any] | None = None
    pending_signal: dict[str, Any] | None = None
    cooldown_until_ms = 0
    zone_armed = False
    zone_entries = 0
    rearm_required = False
    rearm_low: float | None = None
    pivot_low: float | None = None
    pivot_broken = False
    short_zone = fair_price + cfg.min_distance

    for index, bar in enumerate(bars):
        bar_ticks = ticks_by_bar.get(bar["time"], [])

        if rearm_required:
            rearm_low = min(rearm_low, float(bar["low"])) if rearm_low is not None else float(bar["low"])
            if float(bar["high"]) >= rearm_low + cfg.rearm_points:
                rearm_required = False
                rearm_low = None
                zone_entries = 0

        # Confirm a swing low only after the configured number of bars on its
        # right has closed. With the default span of one this is the wick/BOS
        # structure visible in the chart: a local low, then a close through it.
        span = cfg.bos_lookback
        candidate_index = index - span
        if candidate_index >= span:
            candidate = bars[candidate_index]
            left = bars[candidate_index - span:candidate_index]
            right = bars[candidate_index + 1:index + 1]
            if left and right and all(candidate["low"] < item["low"] for item in (*left, *right)):
                pivot_low = float(candidate["low"])
                pivot_broken = False

        # A BOS is confirmed at bar close; fill only on the next bar's first tick.
        if pending_signal is not None and index == pending_signal["entry_index"]:
            if bar_ticks and len(trades) < cfg.max_trades:
                first = bar_ticks[0]
                entry = float(first["bidPrice"])
                if entry >= short_zone:
                    risk = cfg.stop_points
                    position = {
                        "entry": entry,
                        "entry_ts_ms": int(first["timestamp"]),
                        "sl": entry + risk,
                        "tp": entry - risk * cfg.target_r,
                        "risk": risk,
                        "fair_price": fair_price,
                        "signal_price": pending_signal["signal_price"],
                        "bos_level": pending_signal["bos_level"],
                        "signal_bar": pending_signal["signal_bar"],
                        "contracts": cfg.contracts,
                        "point_value": cfg.point_value,
                    }
                    # The fill tick cannot also be an exit tick.
                    bar_ticks = bar_ticks[1:]
            pending_signal = None

        # Tick-level management: ask crosses the short stop; bid crosses target.
        if position is not None:
            for tick in bar_ticks:
                if float(tick["askPrice"]) >= position["sl"]:
                    trades.append(_trade(position, position["sl"], "SL", int(tick["timestamp"])))
                    cooldown_until_ms = int(tick["timestamp"]) + int(cfg.cooldown_minutes * 60_000)
                    zone_entries += 1
                    if zone_entries >= cfg.max_entries_per_zone:
                        rearm_required = True
                        rearm_low = float(bar["low"])
                    position = None
                    break
                if float(tick["bidPrice"]) <= position["tp"]:
                    trades.append(_trade(position, position["tp"], "TP", int(tick["timestamp"])))
                    cooldown_until_ms = int(tick["timestamp"]) + int(cfg.cooldown_minutes * 60_000)
                    zone_entries += 1
                    if zone_entries >= cfg.max_entries_per_zone:
                        rearm_required = True
                        rearm_low = float(bar["low"])
                    position = None
                    break

        # Once the current bar has been processed, a close back below fair
        # invalidates the old zone. A valid next-bar fill above the zone is
        # allowed to happen first, even if that bar later closes below fair.
        if float(bar["close"]) < fair_price:
            zone_armed = False
            pending_signal = None
            rearm_required = False
            rearm_low = None
            zone_entries = 0
            pivot_low = None
            pivot_broken = False

        if position is not None or pending_signal is not None or rearm_required:
            continue
        if index < cfg.bos_lookback or len(trades) >= cfg.max_trades:
            continue
        if not _inside_entry_window(bar["time"], cfg):
            continue

        if float(bar["close"]) >= fair_price and float(bar["high"]) >= short_zone:
            zone_armed = True
        if not zone_armed:
            continue
        if bar["time"] * 1000 < cooldown_until_ms:
            continue
        if index + 1 >= len(bars):
            continue

        # Both the wick and close must break structure; this avoids entering on
        # a one-tick probe that immediately closes back above the wick.
        if pivot_low is not None and not pivot_broken and \
                float(bar["close"]) >= short_zone and \
                float(bar["low"]) < pivot_low and float(bar["close"]) < pivot_low:
            pivot_broken = True
            pending_signal = {
                "entry_index": index + 1,
                "signal_bar": int(bar["time"]),
                "signal_price": float(bar["close"]),
                "bos_level": pivot_low,
            }

    return trades


def _fetch_fresh_dukascopy_ticks(session_date: str) -> list[dict[str, Any]]:
    """Fetch raw ticks without touching the repository's cache files."""

    d = date.fromisoformat(session_date)
    start = datetime(d.year, d.month, d.day, 4, tzinfo=UTC)
    end = start + timedelta(days=1)
    duka_dir = os.environ.get("DUKA_DIR", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    js = f"""
const {{ getHistoricalRates }} = require('dukascopy-node');
(async () => {{
  try {{
    const data = await getHistoricalRates({{
      instrument: 'usatechidxusd',
      dates: {{ from: new Date('{start.isoformat()}'), to: new Date('{end.isoformat()}') }},
      timeframe: 'tick',
      format: 'json',
    }});
    process.stdout.write(JSON.stringify(data));
  }} catch (error) {{
    process.stdout.write(JSON.stringify({{error: error.message}}));
    process.exitCode = 1;
  }}
}})();
"""
    result = subprocess.run(
        ["node", "-e", js], cwd=duka_dir, capture_output=True, text=True, timeout=600, check=False
    )
    try:
        data = json.loads(result.stdout.strip())
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"dukascopy-node returned invalid JSON: {result.stderr[:300]}") from exc
    if isinstance(data, dict) and data.get("error"):
        raise RuntimeError(f"dukascopy-node error: {data['error']}")
    if not isinstance(data, list) or not data:
        raise RuntimeError(f"dukascopy-node returned no ticks for {session_date}")
    return data


def _shift_cash_ticks_to_nq(session_date: str, ticks: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], float]:
    """Apply the intraday NQ-minus-cash median basis used by the repo."""

    import pandas as pd
    import yfinance as yf

    end = (pd.to_datetime(session_date) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
    df = yf.download(
        "NQ=F", start=session_date, end=end, interval="1m", progress=False, auto_adjust=False
    )
    if hasattr(df.columns, "levels") and df.columns.nlevels > 1:
        df.columns = df.columns.droplevel(1)
    nq_close = {int(ts.timestamp()) // 60 * 60: float(row["Close"]) for ts, row in df.iterrows()}
    cash_close: dict[int, float] = {}
    for tick in ticks:
        minute = int(tick["timestamp"] // 1000 // 60) * 60
        cash_close[minute] = (float(tick["bidPrice"]) + float(tick["askPrice"])) / 2
    diffs = [nq_close[key] - cash_close[key] for key in cash_close if key in nq_close]
    basis = statistics.median(diffs) if len(diffs) >= 60 else 0.0
    shifted = [
        {
            **tick,
            "bidPrice": float(tick["bidPrice"]) + basis,
            "askPrice": float(tick["askPrice"]) + basis,
        }
        for tick in ticks
    ]
    return shifted, basis


def load_nq_ticks_for_date(session_date: str) -> tuple[list[dict[str, Any]], float, str]:
    """Load cached NQ ticks or fresh Dukascopy ticks with a Yahoo basis."""

    from scripts.nq_ticks import fetch_nq_ticks

    cached, stats = fetch_nq_ticks(session_date)
    if cached:
        return cached, float(stats.get("median", 0.0)), f"cache/{stats.get('method', 'unknown')}"
    raw = _fetch_fresh_dukascopy_ticks(session_date)
    shifted, basis = _shift_cash_ticks_to_nq(session_date, raw)
    return shifted, basis, "fresh/duka+1m-basis"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", default="2026-09-14")
    parser.add_argument("--entry-start", default="09:30")
    parser.add_argument("--entry-end", default="11:00")
    args = parser.parse_args()

    from scripts.smc_tick_eval import build_1m_bars

    ticks, basis, source = load_nq_ticks_for_date(args.date)
    bars = build_1m_bars(ticks)
    fair = fair_price_at_et_open(bars, args.date)
    config = ReversionConfig(entry_start=args.entry_start, entry_end=args.entry_end)
    trades = run_timeless_reversion(bars, ticks, fair_price=fair, config=config)

    print(f"date={args.date} source={source} ticks={len(ticks):,} bars={len(bars)} basis={basis:+.2f}")
    print(f"fair_price_09:30_ET={fair:.2f} entry_window={args.entry_start}-{args.entry_end} ET")
    if not trades:
        print("trades=0")
        return
    print(f"trades={len(trades)}")
    gross_points = sum(trade["pnl"] for trade in trades)
    gross_usd = gross_points * config.contracts * config.point_value
    print(f"gross_pnl={gross_points:+.2f} points / ${gross_usd:+,.2f} before costs ({config.contracts} MNQ)")
    for trade in trades:
        entry = datetime.fromtimestamp(trade["time"], tz=UTC).astimezone(ET)
        exit_ = datetime.fromtimestamp(trade["exit_time"], tz=UTC).astimezone(ET)
        print(
            f"  {entry:%H:%M:%S} SHORT {trade['entry']:.2f} "
            f"SL {trade['sl']:.2f} TP {trade['tp']:.2f} -> "
            f"{trade['result']} {trade['exit']:.2f} at {exit_:%H:%M:%S} "
            f"PnL {trade['pnl']:+.2f} ({trade['rr']:+.2f}R)"
        )


if __name__ == "__main__":
    main()
