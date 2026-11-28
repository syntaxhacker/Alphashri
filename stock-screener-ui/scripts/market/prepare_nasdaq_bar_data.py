"""Resample the cached Dukascopy 1-minute Nasdaq series into canonical 1h/4h bars.

Output is consumed by the nasdaq_hourly_eda research lanes and the report builder.
All timestamps are UTC; a session runs 04:00 UTC -> 03:59 UTC the next day.
Regenerate the source parquet with scripts/research/double_vwap/build_bars.py.
"""

import json
import os
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
SOURCE = str(ROOT / "experiments" / "data" / "duka_cache" / "usatechidxusd_1m.parquet")
OUT_DIR = str(ROOT / "reports" / "nasdaq_hourly_eda" / "data")
START = "2026-03-01"
END = "2026-09-16"


def session_id(idx: pd.DatetimeIndex) -> pd.Series:
    utc = idx.tz_convert("UTC")
    day = utc.normalize().where(utc.hour >= 4, utc - pd.Timedelta(days=1))
    return pd.Series(day.normalize().date, index=idx)


def build_bars(minute: pd.DataFrame, minutes_per_bar: int) -> pd.DataFrame:
    freq = f"{minutes_per_bar}min"
    g = minute.resample(freq, label="left", closed="left")
    bars = g.agg(o=("o", "first"), h=("h", "max"), l=("l", "min"), c=("c", "last"),
                 vol=("vol", "sum"), ticks=("ticks", "sum"),
                 spread_pts=("spread_pts", "mean"), n1m=("c", "size"),
                 t_first=("ticks", "size")).drop(columns="t_first")
    bars = bars[bars.n1m >= minutes_per_bar * 0.6].copy()

    work = minute.dropna(subset=["h", "l"]).copy()
    work["bar_key"] = work.index.floor(freq)
    hi_idx = work.groupby("bar_key")["h"].idxmax()
    lo_idx = work.groupby("bar_key")["l"].idxmin()
    hi_ts = hi_idx.reindex(bars.index)
    lo_ts = lo_idx.reindex(bars.index)
    bars["high_min"] = (hi_ts.dt.hour * 60 + hi_ts.dt.minute) % minutes_per_bar
    bars["low_min"] = (lo_ts.dt.hour * 60 + lo_ts.dt.minute) % minutes_per_bar

    first5 = work.groupby("bar_key").head(min(5, minutes_per_bar))
    first15 = work.groupby("bar_key").head(min(15, minutes_per_bar))
    r5 = first5.groupby("bar_key").agg(h=("h", "max"), l=("l", "min"))
    r15 = first15.groupby("bar_key").agg(h=("h", "max"), l=("l", "min"))
    bars["first5_range_bp"] = np.log(r5.h / r5.l).reindex(bars.index) * 10000
    bars["first15_range_bp"] = np.log(r15.h / r15.l).reindex(bars.index) * 10000

    bars["range_bp"] = np.log(bars.h / bars.l) * 10000
    bars["body_bp"] = np.log(bars.c / bars.o) * 10000
    bars["upper_wick_bp"] = np.log(bars.h / bars[["o", "c"]].max(axis=1)) * 10000
    bars["lower_wick_bp"] = np.log(bars[["o", "c"]].min(axis=1) / bars.l) * 10000
    bars["absret_bp"] = bars.body_bp.abs()
    bars["direction"] = np.sign(bars.body_bp).astype(int)

    sess = session_id(bars.index)
    bars["session"] = sess.values
    bars["bar_in_session"] = bars.groupby("session").cumcount()
    bars["first_in_session"] = (bars.bar_in_session == 0).astype(int)

    bars["prev_c"] = bars.c.shift(1)
    bars["gap_bp"] = np.log(bars.o / bars.prev_c) * 10000
    bars.loc[bars.first_in_session == 1, "gap_bp"] = np.nan

    bars["next_o"] = bars.o.shift(-1)
    bars["next_c"] = bars.c.shift(-1)
    bars["next_h"] = bars.h.shift(-1)
    bars["next_l"] = bars.l.shift(-1)
    bars["next_range_bp"] = bars.range_bp.shift(-1)
    bars["next_gap_bp"] = np.log(bars.next_o / bars.c) * 10000
    bars["next_ret_bp"] = np.log(bars.next_c / bars.c) * 10000
    bars["next_absret_bp"] = bars.next_ret_bp.abs()
    bars["next_dir_bp"] = np.log(bars.next_c / bars.next_o) * 10000
    bars["followthrough_bp"] = bars.body_bp * bars.direction.shift(-1)
    bars["next_high_break"] = (bars.next_h > bars.h).astype(int)
    bars["next_low_break"] = (bars.next_l < bars.l).astype(int)
    bars["next_inside"] = ((bars.next_h < bars.h) & (bars.next_l > bars.l)).astype(int)
    bars["first5_range_share"] = bars.first5_range_bp / bars.range_bp
    bars["first15_range_share"] = bars.first15_range_bp / bars.range_bp
    bars["high_phase"] = np.floor(bars.high_min / (minutes_per_bar / 4)).clip(0, 3).astype(int)
    bars["low_phase"] = np.floor(bars.low_min / (minutes_per_bar / 4)).clip(0, 3).astype(int)
    bars["body_frac"] = (bars.absret_bp / bars.range_bp).replace([np.inf, -np.inf], np.nan)

    # Keep every qualifying bar. Next-bar fields are only valid when the following
    # bar is contiguous and belongs to the same session; otherwise they are null.
    next_ts = pd.Series(bars.index + pd.Timedelta(minutes=minutes_per_bar), index=bars.index)
    contiguous = bars.index.to_series().shift(-1).eq(next_ts)
    same_session = bars.session.shift(-1).eq(bars.session)
    valid_next = contiguous & same_session
    next_fields = ["next_o", "next_c", "next_h", "next_l", "next_range_bp", "next_gap_bp",
                   "next_ret_bp", "next_absret_bp", "next_dir_bp", "followthrough_bp",
                   "next_high_break", "next_low_break", "next_inside"]
    for col in next_fields:
        bars[col] = bars[col].where(valid_next)
    bars["has_next"] = valid_next.astype(int)
    return bars


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    raw = pd.read_parquet(SOURCE).sort_index()
    minute = raw.loc[(raw.index >= START) & (raw.index < END)].copy()
    minute["session"] = session_id(minute.index).values

    manifest = {
        "source": SOURCE,
        "instrument": "usatechidxusd (Dukascopy Nasdaq-100 cash index CFD, NQ proxy)",
        "window": [str(minute.index[0]), str(minute.index[-1])],
        "session_definition": "04:00 UTC -> 03:59 UTC next day",
        "timezone": "UTC",
        "minute_bars": int(len(minute)),
        "sessions": int(minute.session.nunique()),
    }
    minute.to_parquet(f"{OUT_DIR}/minute_1m.parquet")
    for minutes in (1, 4):
        bars = build_bars(minute, minutes * 60)
        bars.to_parquet(f"{OUT_DIR}/bars_{minutes}h.parquet")
        manifest[f"bars_{minutes}h"] = int(len(bars))

    with open(f"{OUT_DIR}/manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
