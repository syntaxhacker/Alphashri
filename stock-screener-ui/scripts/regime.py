"""Pre-noon session regime classifier: "trend" or "chop".

Uses ONLY information available BEFORE 12:00 IST on the session date:
  1. 5-day trend efficiency from prior yfinance NQ=F daily closes
       eff = |close[-1] - close[-6]| / sum(|5 daily changes|), 6 closes strictly before date
  2. Overnight tick range vs trailing 20-day median.
       overnight = high-low of 1m bars in [prev-day 23:00 IST, today 09:39 IST]
       (prev 17:30 UTC -> today 04:09 UTC), from Dukascopy tick cache only.
  3. Morning range expansion vs its trailing 20-day median.
       morning = high-low of 1m bars in [09:39, 12:00] IST today (04:09-06:30 UTC).

Rule (thresholds calibrated on June+July 2026 ONLY, locked):
    trend iff  eff >= 0.15
           AND 0.8 <= morning_ratio <= 1.8
           AND 0.5 <= overnight_ratio <= 1.8
    else chop.
Rationale: trend = healthy expansion; chop = either exhaustion (ratio > hi,
violent June) or dead tape (ratio < lo, small-range August) or directionless
dailies (eff < 0.15). Insufficient trailing history (<3 priors) -> chop.

Calibration (June+July, 45 sessions):
    June:  7/22 trend (32%, mostly chop)
    July: 14/23 trend (61%, mostly trend)
Locked, then August OOS: 5/21 trend (24%, mostly chop) -> 16/21 chop correct.

Allocator: trend days -> run trend engine, chop days -> stand down (0).
Engine = SMCIFVGEngine(sess 12:00-23:00 IST, ATR>=8): Jun -1971.1, Jul +560.5, Aug -2326.6.
Kept (trend-only): Jun -180.1, Jul +1683.8, Aug -930.2 -> combined +573.5 vs -3737.2 baseline.
"""

import os
import statistics
import sys
from datetime import date as date_cls
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.htf_bias import fetch_daily
from scripts.smc_tick_eval import CACHE_DIR, INSTRUMENT, build_1m_bars, fetch_ticks

# ---- locked thresholds (calibrated June+July, do not retune on August) ----
EFF_MIN = 0.15
MORN_LO, MORN_HI = 0.8, 1.8
ON_LO, ON_HI = 0.5, 1.8
MED_WINDOW = 20
MIN_PRIORS = 3

# IST-minute helpers (no tz lib needed): IST = UTC + 5:30
MORN_START_MIN = 9 * 60 + 39   # 579
MORN_END_MIN = 12 * 60         # 720


def _ist_min(bar_time_sec: int) -> int:
    return ((bar_time_sec // 60) + 330) % 1440


def _cached_days():
    """Sorted YYYY-MM-DD session dates present in the tick cache."""
    days = []
    if os.path.isdir(CACHE_DIR):
        for f in os.listdir(CACHE_DIR):
            if f.startswith(INSTRUMENT + "_") and f.endswith(".json"):
                days.append(f[len(INSTRUMENT) + 1:-5])
    return sorted(days)


_BARS_CACHE: dict = {}


def _bars(day_str: str):
    if day_str not in _BARS_CACHE:
        _BARS_CACHE[day_str] = build_1m_bars(fetch_ticks(day_str))
    return _BARS_CACHE[day_str]


def _prev_days(day_str: str, n: int):
    """Up to n cached session dates strictly before day_str."""
    return [d for d in _cached_days() if d < day_str][-n:]


def eff5(day_str: str):
    """5-change efficiency on prior daily closes, strictly before day_str."""
    import pandas as pd

    df = fetch_daily()
    df.index = pd.to_datetime(df.index)
    d = date_cls.fromisoformat(day_str)
    s = df[df.index.date < d]["Close"]
    if isinstance(s, pd.DataFrame):
        s = s.iloc[:, 0]
    vals = s.tail(6).values.flatten().astype(float)
    if len(vals) < 6:
        return None
    changes = [float(vals[i] - vals[i - 1]) for i in range(1, 6)]
    denom = sum(abs(c) for c in changes)
    if denom == 0:
        return 0.0
    return abs(float(vals[-1] - vals[0])) / denom


def morning_range(day_str: str) -> float:
    bars = _bars(day_str)
    sel = [b for b in bars if MORN_START_MIN <= _ist_min(b["time"]) <= MORN_END_MIN]
    if not sel:
        return 0.0
    return max(b["high"] for b in sel) - min(b["low"] for b in sel)


def overnight_range(day_str: str):
    """High-low over [prev 23:00 IST, today 09:39 IST]; None if no prior cache."""
    d = date_cls.fromisoformat(day_str)
    prevs = _prev_days(day_str, 1)
    if not prevs:
        return None
    prev = date_cls.fromisoformat(prevs[0])
    start_utc = int(datetime(prev.year, prev.month, prev.day, 17, 30,
                             tzinfo=timezone.utc).timestamp())
    end_utc = int(datetime(d.year, d.month, d.day, 4, 9,
                           tzinfo=timezone.utc).timestamp())
    bars_prev = _bars(prevs[0])
    bars_cur = _bars(day_str)
    cand = ([b for b in bars_prev if start_utc <= b["time"] <= end_utc]
            + [b for b in bars_cur if start_utc <= b["time"] <= end_utc])
    if not cand:
        return 0.0
    return max(b["high"] for b in cand) - min(b["low"] for b in cand)


def features(day_str: str) -> dict:
    e = eff5(day_str)
    m = morning_range(day_str)
    o = overnight_range(day_str)
    priors = _prev_days(day_str, MED_WINDOW)
    m_hist = [morning_range(p) for p in priors]
    o_hist = [overnight_range(p) for p in priors]
    o_hist = [x for x in o_hist if x is not None]
    m_med = statistics.median(m_hist) if len(m_hist) >= MIN_PRIORS else None
    o_med = statistics.median(o_hist) if len(o_hist) >= MIN_PRIORS else None
    return {
        "eff": e,
        "morning": m,
        "overnight": o,
        "morning_med": m_med,
        "overnight_med": o_med,
        "morning_ratio": (m / m_med) if (m_med) else None,
        "overnight_ratio": (o / o_med) if (o_med and o is not None) else None,
    }


def day_regime(day_str: str) -> str:
    """'trend' or 'chop' using only pre-12:00 IST info for day_str."""
    f = features(day_str)
    if f["eff"] is None or f["morning_ratio"] is None or f["overnight_ratio"] is None:
        return "chop"
    if f["eff"] < EFF_MIN:
        return "chop"
    if not (MORN_LO <= f["morning_ratio"] <= MORN_HI):
        return "chop"
    if not (ON_LO <= f["overnight_ratio"] <= ON_HI):
        return "chop"
    return "trend"


if __name__ == "__main__":
    days = [d for d in _cached_days() if "2026-06-01" <= d <= "2026-08-31"]
    print(f"{'date':<12}{'regime':<8}{'eff':>7}{'morn':>8}{'morn_med':>9}{'mratio':>8}"
          f"{'over':>8}{'over_med':>9}{'oratio':>8}")
    counts = {}
    for d in days:
        f = features(d)
        r = day_regime(d)
        counts.setdefault(d[:7], {"trend": 0, "chop": 0})[r] += 1
        e = f"{f['eff']:.3f}" if f["eff"] is not None else "NA"
        mr = f"{f['morning_ratio']:.2f}" if f["morning_ratio"] is not None else "NA"
        orr = f"{f['overnight_ratio']:.2f}" if f["overnight_ratio"] is not None else "NA"
        mm = f"{f['morning_med']:.1f}" if f["morning_med"] is not None else "NA"
        om = f"{f['overnight_med']:.1f}" if f["overnight_med"] is not None else "NA"
        ov = "NA" if f["overnight"] is None else f"{f['overnight']:.1f}"
        print(f"{d:<12}{r:<8}{e:>7}{f['morning']:>8.1f}{mm:>9}{mr:>8}{ov:>8}{om:>9}{orr:>8}")
    print(f"\nTotal sessions: {len(days)}")
    for m in sorted(counts):
        t, c = counts[m]["trend"], counts[m]["chop"]
        print(f"{m}: trend {t}/{t + c} ({100 * t / (t + c):.0f}%), "
              f"chop {c}/{t + c} ({100 * c / (t + c):.0f}%)")
