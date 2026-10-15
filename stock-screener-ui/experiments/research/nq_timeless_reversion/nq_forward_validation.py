"""Evaluate volatility/regime candidates on cached sessions only.

The recent sessions that require a Dukascopy refresh are intentionally not
fetched here. This keeps this comparison reproducible and makes the final
period a clean cached forward slice rather than mixing network retries into
the benchmark.
"""

import gc
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT.parent))

from scripts.smc_tick_eval import build_1m_bars
from timeless_reversion import ReversionConfig, fair_price_at_et_open, run_timeless_reversion


BASIS = json.loads((ROOT.parent / "scripts" / "nq_basis.json").read_text())
CACHE = ROOT / "data" / "duka_cache"


def config(**kwargs: object) -> ReversionConfig:
    return ReversionConfig(
        entry_start="09:30",
        entry_end="11:00",
        max_signal_range_points=30.0,
        **kwargs,
    )


CONFIGS = {
    "range30": config(),
    "or30_175": config(opening_range_max_points=175.0),
    "or30_200": config(opening_range_max_points=200.0),
    "or30_225": config(opening_range_max_points=225.0),
    "or30_175_ema": config(opening_range_max_points=175.0, require_bearish_ema=True),
    "or30_200_ema": config(opening_range_max_points=200.0, require_bearish_ema=True),
    "or30_175_confirm": config(opening_range_max_points=175.0, bos_confirmation_bars=1),
    "or30_200_confirm": config(opening_range_max_points=200.0, bos_confirmation_bars=1),
}


def evaluate(day: str, raw: list[dict]) -> dict[str, list[tuple[str, float]]]:
    if len(raw) < 1000:
        return {name: [] for name in CONFIGS}
    basis = float(BASIS.get(day, {}).get("med", 0.0))
    ticks = [
        {**tick, "bidPrice": float(tick["bidPrice"]) + basis, "askPrice": float(tick["askPrice"]) + basis}
        for tick in raw
    ]
    bars = build_1m_bars(ticks)
    try:
        fair = fair_price_at_et_open(bars, day)
    except ValueError:
        return {name: [] for name in CONFIGS}
    result = {
        name: [(day, float(trade["pnl"])) for trade in run_timeless_reversion(bars, ticks, fair_price=fair, config=cfg)]
        for name, cfg in CONFIGS.items()
    }
    del ticks, bars
    gc.collect()
    return result


rows = {name: [] for name in CONFIGS}
paths = [
    path
    for path in sorted(CACHE.glob("usatechidxusd_2026-*.json"))
    if path.stat().st_size >= 1000
]
for index, path in enumerate(paths, 1):
    day = path.stem.rsplit("_", 1)[-1]
    if not "2026-03-01" <= day <= "2026-09-14":
        continue
    for name, values in evaluate(day, json.loads(path.read_text())).items():
        rows[name].extend(values)
    print(f"processed {index}/{len(paths)} {day}", flush=True)


def stats(values: list[tuple[str, float]]) -> str:
    wins = sum(p > 0 for _, p in values)
    gross_win = sum(p for _, p in values if p > 0)
    gross_loss = -sum(p for _, p in values if p <= 0)
    points = sum(p for _, p in values)
    pf = gross_win / gross_loss if gross_loss else 0.0
    return f"n={len(values):3d} W/L={wins:3d}/{len(values)-wins:3d} points={points:+7.1f} usd={points*12:+8.0f} PF={pf:.2f}"


def period(values: list[tuple[str, float]], start: str, end: str) -> list[tuple[str, float]]:
    return [(day, pnl) for day, pnl in values if start <= day <= end]


print("name | Apr | May-Jul | Aug | Sep cached | all")
for name, values in rows.items():
    print(
        f"{name:17s} | {stats(period(values, '2026-04-01', '2026-04-30'))}"
        f" | {stats(period(values, '2026-05-01', '2026-07-31'))}"
        f" | {stats(period(values, '2026-08-01', '2026-08-31'))}"
        f" | {stats(period(values, '2026-09-01', '2026-09-14'))}"
        f" | {stats(values)}"
    )
    by_month = defaultdict(float)
    for day, pnl in values:
        by_month[day[:7]] += pnl
    print("  monthly", dict(sorted(by_month.items())))
