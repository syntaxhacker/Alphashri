#!/usr/bin/env python3
"""
Offline edge study over an order-flow journal.

Builds a 1-second feature table from a saved tick journal, measures each
feature's information coefficient (Pearson IC) and directional win rate
against forward returns, and runs a forward-return event study over signals
reconstructed by replaying ticks through ``OrderFlowSignalEngine``.

Usage:
  source .venv/bin/activate
  python scripts/orderflow_research.py --symbol RAYMOND --date 2026-09-15
  python scripts/orderflow_research.py --symbol RAYMOND --horizons 5,15,30 --out /tmp/ofl
"""

import argparse
import bisect
import html
import math
import sys
from datetime import datetime
from pathlib import Path
from typing import Iterable, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd

import config
from api import orderflow_journal
from api.orderflow_signals import OrderFlowSignalEngine
from scripts.backtest_orderflow_signals import _BUY_SIDES, _forward_price

SIDES = ("BUY", "STRONG_BUY", "SELL", "STRONG_SELL")
FEATURES = (
    "imb",
    "depth_imb",
    "cvd",
    "cvd_slope_60",
    "ret_10",
    "ret_30",
    "ret_60",
    "vwap_dist_pct",
    "depth_slope",
)
DEFAULT_HORIZONS = (10, 30, 60, 120)


# --------------------------------------------------------------------- helpers
def _safe_div(numerator: float, denominator: float) -> float:
    return numerator / denominator if denominator else 0.0


def _best(depth: dict, key: str):
    for level in (depth or {}).get(key) or []:
        price = level.get("price")
        if price:
            return float(price), float(level.get("quantity") or 0.0)
    return None, 0.0


def _levels(depth: dict, key: str) -> list[tuple[float, float]]:
    out = []
    for level in (depth or {}).get(key) or []:
        price = level.get("price")
        if price is not None:
            out.append((float(price), float(level.get("quantity") or 0.0)))
    return out


def _aggressor(ltp: float, best_bid, best_ask, prev_side) -> Optional[str]:
    if best_ask and ltp >= best_ask:
        return "B"
    if best_bid and ltp <= best_bid:
        return "S"
    return prev_side


def _depth_slope(bids: list, asks: list) -> float:
    def side_slope(levels: list) -> float:
        if not levels:
            return 0.0
        near = levels[0][1]
        far = levels[-1][1]
        return _safe_div(far - near, far + near)

    return (side_slope(bids) + side_slope(asks)) / 2.0


def _index_at_or_before(secs: list[int], target: int) -> Optional[int]:
    pos = bisect.bisect_right(secs, target) - 1
    return pos if pos >= 0 else None


def _index_at_or_after(secs: list[int], target: int) -> Optional[int]:
    pos = bisect.bisect_left(secs, target)
    return pos if pos < len(secs) else None


# -------------------------------------------------------------------- features
def build_features(ticks: Iterable[dict]) -> list[dict]:
    """Collapse raw ticks into a 1-second feature table sorted by tick ``ltt``."""
    valid = []
    for tick in ticks:
        if not isinstance(tick, dict):
            continue
        try:
            ltp = float(tick.get("ltp") or 0.0)
            ltt = int(tick.get("ltt") or 0)
            volume = float(tick.get("volume") or 0.0)
        except (TypeError, ValueError):
            continue
        if ltp > 0 and ltt > 0:
            valid.append((ltt, ltp, volume, tick))
    valid.sort(key=lambda row: row[0])

    rows: list[dict] = []
    index: dict[int, int] = {}
    prev_volume: Optional[float] = None
    prev_side: Optional[str] = None
    cvd = 0.0

    for ltt, ltp, volume, tick in valid:
        depth = tick.get("depth") or {}
        best_bid, _ = _best(depth, "buy")
        best_ask, _ = _best(depth, "sell")

        if prev_volume is not None and volume >= prev_volume:
            delta = volume - prev_volume
            if delta > 0:
                side = _aggressor(ltp, best_bid, best_ask, prev_side)
                if side == "B":
                    cvd += delta
                elif side == "S":
                    cvd -= delta
                if side:
                    prev_side = side
        prev_volume = volume

        tbq = float(tick.get("tbq") or 0.0)
        tsq = float(tick.get("tsq") or 0.0)
        vwap = float(tick.get("vwap") or 0.0)
        bids = _levels(depth, "buy")
        asks = _levels(depth, "sell")
        bid_qty = sum(qty for _, qty in bids)
        ask_qty = sum(qty for _, qty in asks)

        row = {
            "sec": ltt // 1000,
            "ltp": ltp,
            "vwap": vwap,
            "volume": volume,
            "imb": _safe_div(tbq - tsq, tbq + tsq),
            "depth_imb": _safe_div(bid_qty - ask_qty, bid_qty + ask_qty),
            "cvd": cvd,
            "depth_slope": _depth_slope(bids, asks),
            "vwap_dist_pct": (ltp - vwap) / vwap * 100.0 if vwap > 0 else 0.0,
        }

        existing = index.get(row["sec"])
        if existing is None:
            index[row["sec"]] = len(rows)
            rows.append(row)
        else:
            rows[existing] = row

    _attach_trailing(rows)
    return rows


def _attach_trailing(rows: list[dict]) -> None:
    secs = [row["sec"] for row in rows]
    for pos, row in enumerate(rows):
        for window in (10, 30, 60):
            prev_pos = _index_at_or_before(secs, row["sec"] - window)
            prev_price = rows[prev_pos]["ltp"] if prev_pos is not None and prev_pos < pos else None
            row[f"ret_{window}"] = (
                (row["ltp"] - prev_price) / prev_price * 100.0 if prev_price else None
            )
        prev_pos = _index_at_or_before(secs, row["sec"] - 60)
        row["cvd_slope_60"] = row["cvd"] - rows[prev_pos]["cvd"] if prev_pos is not None else None


def forward_returns(features: list[dict], horizons: Iterable[int]) -> list[dict]:
    """Attach forward return (``fwd_{h}``) and direction label (``label_{h}``)."""
    if not features:
        return []
    secs = [row["sec"] for row in features]
    out = []
    for row in features:
        new_row = dict(row)
        for horizon in horizons:
            future_pos = _index_at_or_after(secs, row["sec"] + horizon)
            if future_pos is None:
                new_row[f"fwd_{horizon}"] = None
                new_row[f"label_{horizon}"] = 0
                continue
            future = features[future_pos]["ltp"]
            ret = (
                (future - row["ltp"]) / row["ltp"] * 100.0
                if row.get("ltp")
                else 0.0
            )
            new_row[f"fwd_{horizon}"] = ret
            new_row[f"label_{horizon}"] = 1 if ret > 0 else (-1 if ret < 0 else 0)
        out.append(new_row)
    return out


# ------------------------------------------------------------------ edge study
def _pearson(a: pd.Series, b: pd.Series) -> float:
    if len(a) < 2:
        return 0.0
    if float(a.std()) == 0.0 or float(b.std()) == 0.0:
        return 0.0
    value = float(a.corr(b))
    return 0.0 if math.isnan(value) else value


def edge_table(features: list[dict], horizons: Iterable[int]) -> list[dict]:
    """For each feature/horizon: Pearson IC and sign-agreement win rate."""
    if not features:
        return []
    frame = pd.DataFrame(features)
    out = []
    for feature in FEATURES:
        if feature not in frame.columns:
            continue
        for horizon in horizons:
            fwd = f"fwd_{horizon}"
            if fwd not in frame.columns:
                continue
            pair = frame[[feature, fwd]].dropna()
            ic = _pearson(pair[feature], pair[fwd])
            directional = pair[(pair[feature] != 0) & (pair[fwd] != 0)]
            wins = ((directional[feature] > 0) == (directional[fwd] > 0)).sum()
            win_rate = wins / len(directional) * 100.0 if len(directional) else 0.0
            out.append(
                {
                    "feature": feature,
                    "horizon_sec": horizon,
                    "n": int(len(pair)),
                    "ic": round(ic, 4),
                    "win_rate_pct": round(win_rate, 2),
                }
            )
    return out


# ---------------------------------------------------------------- event study
def _excursions(prices, ts, entry, max_horizon_sec, direction):
    if not prices or entry <= 0 or max_horizon_sec <= 0:
        return 0.0, 0.0
    start = bisect.bisect_left(prices, (ts, -math.inf))
    end = bisect.bisect_right(prices, (ts + max_horizon_sec * 1000, math.inf))
    window = prices[start:end]
    if not window:
        return 0.0, 0.0
    moves = [direction * (price - entry) / entry * 100.0 for _, price in window]
    return max(moves), min(moves)


def _aggregate(details: list[dict], horizons: Iterable[int], side) -> list[dict]:
    subset = details if side is None else [d for d in details if d["side"] == side]
    label = "OVERALL" if side is None else side
    rows = []
    for horizon in horizons:
        rets = [d[f"ret_{horizon}"] for d in subset if d.get(f"ret_{horizon}") is not None]
        wins = [d[f"win_{horizon}"] for d in subset if d.get(f"win_{horizon}") is not None]
        mfes = [d["mfe_pct"] for d in subset]
        maes = [d["mae_pct"] for d in subset]
        rows.append(
            {
                "side": label,
                "horizon_sec": horizon,
                "count": len(rets),
                "win_rate_pct": round(sum(wins) / len(wins) * 100.0, 2) if wins else 0.0,
                "avg_return_pct": round(sum(rets) / len(rets), 4) if rets else 0.0,
                "avg_mfe_pct": round(sum(mfes) / len(mfes), 4) if mfes else 0.0,
                "avg_mae_pct": round(sum(maes) / len(maes), 4) if maes else 0.0,
            }
        )
    return rows


def event_study(ticks: Iterable[dict], horizons: Iterable[int]) -> dict:
    """Replay ticks through the signal engine and score forward returns."""
    horizons = tuple(horizons)
    engine = OrderFlowSignalEngine()
    prices: list[tuple[int, float]] = []
    emitted: list[tuple[dict, float, int]] = []

    for tick in ticks:
        if not isinstance(tick, dict):
            continue
        try:
            ltp = float(tick.get("ltp") or 0.0)
            ltt = int(tick.get("ltt") or 0)
        except (TypeError, ValueError):
            continue
        if ltp > 0 and ltt > 0:
            prices.append((ltt, ltp))
        signal = engine.update(tick)
        if signal:
            emitted.append((signal, ltp, int(signal.get("ts") or ltt)))
    prices.sort()

    max_horizon = max(horizons) if horizons else 0
    details = []
    for signal, entry, ts in emitted:
        side = signal.get("side")
        if side not in SIDES or entry <= 0:
            continue
        direction = 1.0 if side in _BUY_SIDES else -1.0
        detail = {
            "ts": ts,
            "side": side,
            "score": signal.get("score"),
            "entry": round(entry, 4),
        }
        for horizon in horizons:
            future = _forward_price(prices, ts + horizon * 1000)
            if future is None or future <= 0:
                detail[f"ret_{horizon}"] = None
                detail[f"win_{horizon}"] = None
                continue
            ret = direction * (future - entry) / entry * 100.0
            detail[f"ret_{horizon}"] = round(ret, 4)
            detail[f"win_{horizon}"] = 1 if ret > 0 else 0
        mfe, mae = _excursions(prices, ts, entry, max_horizon, direction)
        detail["mfe_pct"] = round(mfe, 4)
        detail["mae_pct"] = round(mae, 4)
        details.append(detail)

    by_side = [row for side in SIDES for row in _aggregate(details, horizons, side)]
    return {
        "signal_count": len(emitted),
        "evaluated": len(details),
        "max_horizon": max_horizon,
        "by_side": by_side,
        "overall": _aggregate(details, horizons, None),
        "signals": details,
    }


# -------------------------------------------------------------------- outputs
def _sparkline(features: list[dict], width: int = 900, height: int = 160) -> str:
    prices = [row["ltp"] for row in features if row.get("ltp")]
    if len(prices) < 2:
        return "<p>Not enough data for a price chart.</p>"
    low, high = min(prices), max(prices)
    span = (high - low) or 1.0
    step = width / (len(prices) - 1)
    points = []
    for pos, price in enumerate(prices):
        x = pos * step
        y = height - (price - low) / span * (height - 20.0) - 10.0
        points.append(f"{x:.1f},{y:.1f}")
    polyline = " ".join(points)
    return (
        f'<svg viewBox="0 0 {width} {height}" width="100%" height="{height}" '
        'preserveAspectRatio="none" role="img" aria-label="price series">'
        f'<polyline fill="none" stroke="#2563EB" stroke-width="1.5" points="{polyline}"/>'
        "</svg>"
    )


def _table(headers: list[str], rows: list[list]) -> str:
    head = "".join(f"<th>{html.escape(str(h))}</th>" for h in headers)
    body = "".join(
        "<tr>" + "".join(f"<td>{html.escape(str(c))}</td>" for c in row) + "</tr>"
        for row in rows
    )
    return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"


def _render_html(symbol, day, tick_count, features, edges, study) -> str:
    edge_rows = [
        [r["feature"], r["horizon_sec"], r["n"], r["ic"], r["win_rate_pct"]]
        for r in edges
    ]
    event_rows = [
        [r["side"], r["horizon_sec"], r["count"], r["win_rate_pct"], r["avg_return_pct"],
         r["avg_mfe_pct"], r["avg_mae_pct"]]
        for r in study["by_side"] + study["overall"]
    ]
    signal_rows = [
        [s["ts"], s["side"], s["score"], s["entry"], s["mfe_pct"], s["mae_pct"]]
        for s in study["signals"]
    ]
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{html.escape(symbol)} order-flow edge study — {html.escape(day)}</title>
<style>
  body {{ font-family: system-ui, sans-serif; margin: 24px; color: #0f172a; }}
  h1 {{ font-size: 20px; margin-bottom: 4px; }}
  h2 {{ font-size: 15px; margin-top: 28px; }}
  .meta {{ color: #64748b; font-size: 13px; margin-bottom: 8px; }}
  table {{ border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 12px; }}
  th, td {{ border-bottom: 1px solid #e2e8f0; padding: 4px 8px; text-align: right; }}
  th:first-child, td:first-child {{ text-align: left; }}
  th {{ background: #f8fafc; color: #475569; }}
  svg {{ background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; }}
</style>
</head>
<body>
<h1>{html.escape(symbol)} order-flow edge study</h1>
<div class="meta">Day {html.escape(day)} · {tick_count} ticks · {len(features)} one-second rows ·
{study['evaluated']} signals evaluated</div>
<h2>Price</h2>
{_sparkline(features)}
<h2>Feature edge (IC = Pearson corr, Win % = sign agreement)</h2>
{_table(["Feature", "Horizon (s)", "N", "IC", "Win %"], edge_rows)}
<h2>Signal event study (direction-adjusted)</h2>
{_table(["Side", "Horizon (s)", "Count", "Win %", "Avg %", "MFE %", "MAE %"], event_rows)}
<h2>Signals</h2>
{_table(["ts", "Side", "Score", "Entry", "MFE %", "MAE %"], signal_rows)}
</body>
</html>
"""


def write_outputs(out_dir: Path, symbol, day, tick_count, features, edges, study) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    if features:
        pd.DataFrame(features).to_csv(out_dir / "features.csv", index=False)
    else:
        (out_dir / "features.csv").write_text("", encoding="utf-8")
    pd.DataFrame(edges).to_csv(out_dir / "edge.csv", index=False)
    pd.DataFrame(study["signals"]).to_csv(out_dir / "signals.csv", index=False)
    (out_dir / "index.html").write_text(
        _render_html(symbol, day, tick_count, features, edges, study), encoding="utf-8"
    )


# ------------------------------------------------------------------------ CLI
def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Edge study over an order-flow journal")
    parser.add_argument("--symbol", required=True, help="Symbol whose journal to study")
    parser.add_argument("--date", default=None, help="IST day (YYYY-MM-DD), defaults to today")
    parser.add_argument("--horizons", default="10,30,60,120", help="Comma-separated forward horizons (s)")
    parser.add_argument("--out", default="reports", help="Output root directory")
    parser.add_argument("--journal-dir", default=None, help="Override the journal directory")
    return parser


def _parse_horizons(value) -> tuple[int, ...]:
    out = []
    for part in str(value).split(","):
        part = part.strip()
        if part:
            out.append(int(part))
    return tuple(out) or DEFAULT_HORIZONS


def main(argv: Optional[list[str]] = None) -> int:
    args = _build_parser().parse_args(argv)

    if args.journal_dir:
        override = Path(args.journal_dir)
        orderflow_journal.journal_dir = lambda: override

    day = args.date or datetime.now(config.IST).strftime("%Y-%m-%d")
    symbol = args.symbol.strip().upper()
    horizons = _parse_horizons(args.horizons)

    # Files are broker-scoped, so read every file for the day and say which
    # feeds it spans — a day that changed feed is data-quality relevant here.
    entries = orderflow_journal.read_all(symbol, day=day, kind="tick")
    if not entries:
        print(f"No tick journal found for {symbol} on {day}.")
        return 0
    feeds = orderflow_journal.sources(symbol, day=day)
    print(f"{symbol} {day}: {len(entries)} ticks from {", ".join(feeds)}")

    ticks = [entry.get("data") for entry in entries if isinstance(entry.get("data"), dict)]
    features = forward_returns(build_features(ticks), horizons)
    edges = edge_table(features, horizons)
    study = event_study(ticks, horizons)

    print(f"Order-flow edge study — {symbol} {day}")
    print(f"Ticks: {len(ticks)} | Seconds: {len(features)} | Signals: {study['evaluated']} "
          f"| Horizons: {list(horizons)}s")
    print()
    print("Edge table (IC = Pearson corr with forward return; Win % = sign agreement)")
    print(f"{'Feature':<16}{'Horizon':>9}{'N':>7}{'IC':>9}{'Win %':>9}")
    for row in edges:
        print(f"{row['feature']:<16}{row['horizon_sec']:>8}s{row['n']:>7}{row['ic']:>9.4f}"
              f"{row['win_rate_pct']:>9.2f}")
    print()
    print("Signal event study (direction-adjusted)")
    print(f"{'Side':<12}{'Horizon':>9}{'Count':>7}{'Win %':>9}{'Avg %':>10}{'MFE %':>9}{'MAE %':>9}")
    for row in study["by_side"]:
        print(f"{row['side']:<12}{row['horizon_sec']:>8}s{row['count']:>7}{row['win_rate_pct']:>9.2f}"
              f"{row['avg_return_pct']:>10.4f}{row['avg_mfe_pct']:>9.3f}{row['avg_mae_pct']:>9.3f}")
    for row in study["overall"]:
        print(f"{'OVERALL':<12}{row['horizon_sec']:>8}s{row['count']:>7}{row['win_rate_pct']:>9.2f}"
              f"{row['avg_return_pct']:>10.4f}{row['avg_mfe_pct']:>9.3f}{row['avg_mae_pct']:>9.3f}")

    out_dir = Path(args.out) / f"{symbol}_ORDERFLOW"
    write_outputs(out_dir, symbol, day, len(ticks), features, edges, study)
    print()
    print(f"Wrote {out_dir}/index.html, features.csv, edge.csv, signals.csv")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
