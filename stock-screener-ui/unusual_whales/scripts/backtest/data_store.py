#!/usr/bin/env python3
"""Load MNQ 1-minute bars and ticks from the local MotiveWave store.

The MotiveWave store has two sources that matter for MNQ:

* ``CQG/<MNQxx>/<epoch>.bar_data1``  - 1-minute bars for every contract month
  from 2019 onward, dense only in the ~6 months before each expiry.  Building a
  front-month continuous series from these gives dense 1-minute coverage over
  the whole GEX-history window (2023-10-30 .. present).
* ``RITHMIC/MNQZ6.CME`` and ``CQG/MNQU26`` - tick data, but only ~104/113
  calendar days and usually a few hours per day (see inventory).

Read-only.  Never writes into ~/.motivewave.
"""
from __future__ import annotations

import calendar
import functools
import glob
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mw_decode import decode_file  # noqa: E402

ROOT = Path(os.environ.get("MOTIVEWAVE_DATA_DIR", "~/.motivewave/historical_data")).expanduser()
PICKLE = Path("/tmp/opencode/bar_pickle")
PICKLE.mkdir(parents=True, exist_ok=True)

UTC = timezone.utc
MNQ_POINT_VALUE = 2.0      # $ per index point (Micro E-mini Nasdaq)
MNQ_TICK = 0.25            # index points

MONTH_CODE = {"F": 1, "G": 2, "H": 3, "J": 4, "K": 5, "M": 6,
              "N": 7, "Q": 8, "U": 9, "V": 10, "X": 11, "Z": 12}


def third_friday(year: int, month: int) -> date:
    c = calendar.monthcalendar(year, month)
    fridays = [w[calendar.FRIDAY] for w in c if w[calendar.FRIDAY]]
    return date(year, month, fridays[2])


def _contract_from_dir(name: str) -> tuple[date, str] | None:
    """'MNQZ25' / 'MNQZ5' / 'MNQZ6.CME' -> (expiry, normalised 'MNQZ26')."""
    core = name.split(".")[0]
    if not core.startswith("MNQ") or len(core) < 5:
        return None
    letter = core[3]
    if letter not in MONTH_CODE:
        return None
    ydigits = core[4:]
    if not ydigits.isdigit():
        return None
    yy = 2000 + int(ydigits) if len(ydigits) == 2 else 2020 + int(ydigits)
    exp = third_friday(yy, MONTH_CODE[letter])
    return exp, f"MNQ{letter}{yy % 100:02d}"


@functools.lru_cache(maxsize=1)
def mnq_contract_dirs() -> list[tuple[date, str, Path]]:
    out = []
    for src in ("CQG", "RITHMIC"):
        base = ROOT / src
        if not base.is_dir():
            continue
        for d in base.iterdir():
            if not d.is_dir():
                continue
            meta = _contract_from_dir(d.name)
            if not meta:
                continue
            if glob.glob(str(d / "*.bar_data1")):
                out.append((meta[0], meta[1], d))
    return sorted(out)


def load_contract_bars(inst: str, mins: int = 1) -> pd.DataFrame:
    """Decode every bar file for one contract dir into a DataFrame."""
    key = f"{inst}_{mins}"
    p = PICKLE / f"{key}.pkl"
    if p.exists():
        return pd.read_pickle(p)
    dirs = [d for _, n, d in mnq_contract_dirs() if n == inst]
    rows = []
    for d in dirs:
        for f in sorted(glob.glob(str(d / f"*.bar_data{mins}"))):
            try:
                bf = decode_file(f)
            except Exception:  # noqa: BLE001
                continue
            rows.extend(bf.rows)
    if not rows:
        return pd.DataFrame(columns=["ts", "open", "high", "low", "close", "volume"])
    df = pd.DataFrame(rows)[["ts", "open", "high", "low", "close", "volume"]]
    df = df.drop_duplicates(subset="ts").sort_values("ts").reset_index(drop=True)
    df.to_pickle(p)
    return df


@functools.lru_cache(maxsize=1000)
def front_month_contract(day: date) -> tuple[date, str, Path] | None:
    """Nearest-expiry contract that has not yet expired on ``day``."""
    cands = [c for c in mnq_contract_dirs() if c[0] > day]
    if not cands:
        return None
    return min(cands, key=lambda c: c[0])


def build_front_month(start: str, end: str, mins: int = 1,
                      roll_days_early: int = 0) -> pd.DataFrame:
    """Continuous front-month MNQ bars. ``roll_days_early`` rolls before expiry."""
    s = datetime.strptime(start, "%Y-%m-%d").date()
    e = datetime.strptime(end, "%Y-%m-%d").date()
    cache = PICKLE / f"front_{mins}_{start}_{end}_{roll_days_early}.pkl"
    if cache.exists():
        return pd.read_pickle(cache)
    need = {}
    for day in [s + timedelta(days=i) for i in range((e - s).days + 1)]:
        fm = front_month_contract(day + timedelta(days=roll_days_early))
        if fm:
            need.setdefault(fm[1], fm[2])
    frames = []
    for inst in need:
        df = load_contract_bars(inst, mins)
        if df.empty:
            continue
        df = df.copy()
        df["contract"] = inst
        frames.append(df)
    if not frames:
        return pd.DataFrame(columns=["ts", "open", "high", "low", "close", "volume", "contract"])
    allbars = pd.concat(frames, ignore_index=True)
    allbars["day"] = pd.to_datetime(allbars["ts"], unit="ms", utc=True).dt.date
    # pick, per calendar day, the contract that is front month that day
    keep = []
    for day, grp in allbars.groupby("day"):
        fm = front_month_contract(day + timedelta(days=roll_days_early))
        if not fm:
            continue
        sub = grp[grp["contract"] == fm[1]]
        if not sub.empty:
            keep.append(sub)
    out = pd.concat(keep, ignore_index=True) if keep else allbars.iloc[0:0]
    out = out.drop(columns=["day"]).drop_duplicates(subset="ts").sort_values("ts").reset_index(drop=True)
    out.to_pickle(cache)
    return out


# ------------------------------------------------------------------ ticks ---
def mnq_tick_dirs() -> list[Path]:
    out = []
    for src in ("RITHMIC", "CQG"):
        base = ROOT / src
        if not base.is_dir():
            continue
        for d in base.iterdir():
            if d.is_dir() and d.name.split(".")[0].startswith("MNQ"):
                if glob.glob(str(d / "*.tick_data*")):
                    out.append(d)
    return out


def tick_days() -> dict[str, list[tuple[str, Path]]]:
    """Map ISO date -> [(contract, tick_file)] for every MNQ tick block."""
    from mw_inventory import tick_header
    out: dict[str, list] = {}
    for d in mnq_tick_dirs():
        for f in sorted(glob.glob(str(d / "*.tick_data*"))):
            h = tick_header(Path(f))
            if not h or h.get("count", 0) == 0:
                continue
            day = datetime.fromtimestamp(h["block_start"] / 1000, UTC).date().isoformat()
            out.setdefault(day, []).append((d.name, Path(f)))
    return out


def load_ticks(files: list[Path]) -> pd.DataFrame:
    rows = []
    for f in files:
        try:
            tf = decode_file(str(f))
        except Exception:  # noqa: BLE001
            continue
        for t in tf.ticks:
            rows.append((t["ts"], t.get("price"), t.get("volume", 0),
                         bool(t.get("is_ask")), t.get("bid"), t.get("ask")))
    if not rows:
        return pd.DataFrame(columns=["ts", "price", "size", "is_ask", "bid", "ask"])
    df = pd.DataFrame(rows, columns=["ts", "price", "size", "is_ask", "bid", "ask"])
    return df.dropna(subset=["price"]).sort_values("ts").reset_index(drop=True)


def load_day_ticks(day: str) -> pd.DataFrame:
    td = tick_days().get(day, [])
    if not td:
        return pd.DataFrame(columns=["ts", "price", "size", "is_ask", "bid", "ask"])
    files = [f for _, f in td]
    return load_ticks(files)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["dirs", "bars", "ticks", "days"])
    ap.add_argument("--inst", default=None)
    ap.add_argument("--day", default=None)
    ap.add_argument("--start", default="2023-10-31")
    ap.add_argument("--end", default="2026-09-29")
    a = ap.parse_args()
    if a.cmd == "dirs":
        for exp, n, d in mnq_contract_dirs():
            print(exp, n, d)
    elif a.cmd == "bars":
        df = load_contract_bars(a.inst) if a.inst else build_front_month(a.start, a.end)
        print(df.shape)
        print(df.head(3))
        print(df.tail(3))
    elif a.cmd == "days":
        td = tick_days()
        for k in sorted(td):
            print(k, len(td[k]), sorted({c for c, _ in td[k]}))
    elif a.cmd == "ticks":
        print(load_day_ticks(a.day).shape)
