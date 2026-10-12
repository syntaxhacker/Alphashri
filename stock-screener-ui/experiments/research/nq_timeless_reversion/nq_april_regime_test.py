"""Test non-calendar regime filters specifically on April's cached sessions."""

import gc
import json
import sys
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
        opening_range_max_points=175.0,
        **kwargs,
    )


CONFIGS = {
    "or30_175": config(),
    "or30_175_ema": config(require_bearish_ema=True),
    "or30_175_confirm": config(bos_confirmation_bars=1),
    "or30_175_ema_confirm": config(require_bearish_ema=True, bos_confirmation_bars=1),
    "or30_175_loss1": config(max_consecutive_losses=1),
}


rows = {name: [] for name in CONFIGS}
paths = sorted(CACHE.glob("usatechidxusd_2026-04-*.json"))
for path in paths:
    day = path.stem.rsplit("_", 1)[-1]
    if path.stat().st_size < 1000:
        continue
    basis = float(BASIS.get(day, {}).get("med", 0.0))
    raw = json.loads(path.read_text())
    ticks = [
        {**tick, "bidPrice": float(tick["bidPrice"]) + basis, "askPrice": float(tick["askPrice"]) + basis}
        for tick in raw
    ]
    bars = build_1m_bars(ticks)
    try:
        fair = fair_price_at_et_open(bars, day)
    except ValueError:
        continue
    for name, cfg in CONFIGS.items():
        rows[name].extend((day, float(trade["pnl"])) for trade in run_timeless_reversion(bars, ticks, fair_price=fair, config=cfg))
    print(f"processed {day}", flush=True)
    del raw, ticks, bars
    gc.collect()


for name, values in rows.items():
    wins = sum(p > 0 for _, p in values)
    points = sum(p for _, p in values)
    gross_win = sum(p for _, p in values if p > 0)
    gross_loss = -sum(p for _, p in values if p <= 0)
    print(
        f"{name:24s} trades={len(values):3d} W/L={wins:2d}/{len(values)-wins:2d} "
        f"points={points:+7.1f} usd={points*12:+8.0f} PF={gross_win/gross_loss if gross_loss else 0:.2f}"
    )
