#!/usr/bin/env python3
"""
MotiveWave local historical-data decoder.

Reverse-engineered from MotiveWave 7.1.1 (com/motivewave/platform/service/ad.class,
decompiled with CFR). All primitives are Java DataInputStream -> BIG-ENDIAN.

File magics (com.motivewave.platform.service.ad):
    a = 0x3281BB96  tick data (old)
    b = 0x3281BB97  tick data (old)
    c = 0x3281BB98  tick data (current, columnar)
    d = 0x16D01DE3  bar data  (row / fixed record)
    e = 0x16D01DE4  bar data  (columnar)
"""
from __future__ import annotations

import io
import struct
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone

TICK_MAGICS = {0x3281BB96: "a", 0x3281BB97: "b", 0x3281BB98: "c"}
BAR_MAGICS = {0x16D01DE3: "d", 0x16D01DE4: "e"}

# column type -> (name, struct fmt, byte size)
TICK_COLUMNS = {
    1: ("time_delta", ">i", 4),
    2: ("price", ">f", 4),
    3: ("volume", ">i", 4),
    4: ("volume", ">f", 4),
    5: ("is_ask", ">b", 1),
    6: ("bid", ">f", 4),
    7: ("ask", ">f", 4),
    8: ("bid_size", ">f", 4),
    9: ("ask_size", ">f", 4),
    10: ("exch_order_id", ">q", 8),
    11: ("agg_exch_order_id", ">q", 8),
    12: ("symbol_id", ">h", 2),
    13: ("symbol_id2", ">h", 2),
}

# bar column types for the columnar 'e' format
BAR_COLUMNS = {
    1: ("ts", ">q", 8),
    2: ("time_index", ">h", 2),
    3: ("volume", ">f", 4),
    4: ("open", ">f", 4),
    5: ("high", ">f", 4),
    6: ("low", ">f", 4),
    7: ("close", ">f", 4),
    8: ("x8", ">f", 4),
    9: ("x9", ">f", 4),
    10: ("x10", ">f", 4),
    11: ("x11", ">f", 4),
    12: ("x12", ">f", 4),
    13: ("x13", ">f", 4),
    14: ("x14", ">f", 4),
    15: ("x15", ">f", 4),
    16: ("trades", ">i", 4),
    17: ("open_interest", ">f", 4),
    18: ("settlement", ">f", 4),
    19: ("vwap", ">f", 4),
    20: ("volume_at_bid", ">f", 4),
    21: ("volume_at_offer", ">f", 4),
    22: ("trades_at_bid", ">i", 4),
    23: ("trades_at_offer", ">i", 4),
}


class DecodeError(Exception):
    pass


@dataclass
class BarFile:
    magic: str
    fmt_minutes: int
    g: int
    count: int
    header_longs: list[int]
    ncols: int = 0
    columns: list[tuple[int, int, str]] = field(default_factory=list)
    records: list[dict] = field(default_factory=list)
    rows: list[dict] = field(default_factory=list)


@dataclass
class TickFile:
    magic: str
    block_start: int
    block_end: int
    count: int
    first_ts: int
    last_ts: int
    columns: list[tuple[int, int, str]] = field(default_factory=list)
    ticks: list[dict] = field(default_factory=list)


def _ts(ms: int) -> str:
    try:
        return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    except (OverflowError, OSError, ValueError):
        return str(ms)


# ---------------------------------------------------------------- bar files ---
# (g, daily?) -> row size, from ad.validateDataFile / the record reader
def _bar_row_size(g: int, f: int) -> int:
    daily = f >= 1440
    if g == 2:
        return 40 if daily else 30
    if g == 3:
        return 44 if daily else 38
    if g == 4:
        return 44 if daily else 30
    return 32 if daily else 22  # g in (0, 1, >=5)


def decode_bar(data: bytes) -> BarFile:
    if len(data) < 46:
        raise DecodeError("bar file too small")
    magic, = struct.unpack_from(">i", data, 0)
    if magic not in BAR_MAGICS:
        raise DecodeError(f"not a bar file (magic 0x{magic:08X})")
    name = BAR_MAGICS[magic]

    if name == "d":
        # row format: int magic, short ?, short f, short g, int count, long x4, rows
        f = struct.unpack_from(">h", data, 6)[0]
        g = struct.unpack_from(">h", data, 8)[0]
        count = struct.unpack_from(">i", data, 10)[0]
        longs = [struct.unpack_from(">q", data, 14 + 8 * i)[0] for i in range(4)]
        row_size = _bar_row_size(g, f)
        if 46 + count * row_size != len(data):
            raise DecodeError(
                f"row-format size mismatch: 46 + {count}*{row_size} != {len(data)}")
        out = BarFile(name, f, g, count, longs)
        daily = f >= 1440
        # wire layout per g (from ad.java record readers + validateDataFile sizes):
        #   g 0/1 -> O H L C V                       (5 floats)  [daily adds int]
        #   g 2   -> O H L C V x5                    (6 floats)  [daily adds int]
        #   g 3   -> O H L C V x5 x6 x7 x8 x9        (9 floats)
        #   g 4   -> O H L C V x5                    (6 floats)  [daily adds int+float]
        n_floats = {0: 5, 1: 5, 2: 6, 3: 9, 4: 6}[g]
        names = ["open", "high", "low", "close", "volume",
                 "x5", "x6", "x7", "x8", "x9"]
        o = 46
        for _ in range(count):
            r = data[o:o + row_size]
            o += row_size
            if daily:
                ts = struct.unpack_from(">q", r, 0)[0]
                p = 8
            else:
                idx = struct.unpack_from(">h", r, 0)[0]
                ts = longs[0] + idx * f * 60_000
                p = 2
            rec = {"ts": ts}
            for i in range(n_floats):
                rec[names[i]] = struct.unpack_from(">f", r, p)[0]
                p += 4
            if g in (1, 2, 3, 4):
                if g == 3:
                    pass
                elif daily:
                    rec["trades"] = struct.unpack_from(">i", r, p)[0]
                    p += 4
                    if g == 4:
                        rec["x10"] = struct.unpack_from(">f", r, p)[0]
                        p += 4
                else:
                    if g == 2:
                        rec["trades"] = struct.unpack_from(">i", r, p)[0]
                        p += 4
                    elif g == 4:
                        rec["trades"] = struct.unpack_from(">i", r, p)[0]
                        p += 4
            if p != row_size:
                if daily and p < row_size:
                    p = row_size  # tolerate unknown trailing fields on daily bars
                else:
                    raise DecodeError(
                        f"bar row not fully consumed (g={g} f={f}): {p} != {row_size}")
            out.rows.append(rec)
        return out

    # 'e' -> columnar: int magic, short n4, long barMs, int count, long x4,
    #                  short ncols, (short type, short size)*, short n6, data
    if len(data) < 50:
        raise DecodeError("columnar bar file too small")
    n4 = struct.unpack_from(">h", data, 4)[0]
    bar_ms = struct.unpack_from(">q", data, 6)[0]
    f = int(bar_ms // 60_000)
    count = struct.unpack_from(">i", data, 14)[0]
    longs = [struct.unpack_from(">q", data, 18 + 8 * i)[0] for i in range(4)]
    ncols = struct.unpack_from(">h", data, 50)[0]
    if ncols < 0 or ncols > 64:
        raise DecodeError(f"dodgy column count {ncols}")
    cols, o = [], 52
    for _ in range(ncols):
        t, s = struct.unpack_from(">hh", data, o)
        o += 4
        if t not in BAR_COLUMNS:
            raise DecodeError(f"unknown bar column type {t}")
        exp = BAR_COLUMNS[t][2]
        if s != exp:
            raise DecodeError(f"column {t} size {s} != {exp}")
        cols.append((t, s, BAR_COLUMNS[t][0]))
    o += 2  # short n6
    out = BarFile(name, f, 1, count, longs, ncols, cols)
    ts_base = longs[0]
    for _ in range(count):
        rec = {}
        for t, s, nm in cols:
            fmt = BAR_COLUMNS[t][1]
            v, = struct.unpack_from(fmt, data, o)
            o += s
            rec[nm] = v
        if "time_index" in rec:
            rec["ts"] = ts_base + rec["time_index"] * f * 60_000
        out.rows.append(rec)
    if o != len(data):
        raise DecodeError(f"columnar bar trailing bytes: {o} != {len(data)}")
    return out


# --------------------------------------------------------------- tick files ---
def _read_tables(data: bytes, o: int, n: int):
    """Read symbol tables. Returns (labels, new_offset)."""
    labels = {}
    for _ in range(n):
        ttype, total = struct.unpack_from(">hi", data, o)
        start = o
        cnt, = struct.unpack_from(">i", data, o + 6)
        p = o + 10
        for _ in range(cnt):
            sid, slen = struct.unpack_from(">hh", data, p)
            p += 4
            s = data[p:p + slen * 2].decode("utf-16-be", "replace")
            p += slen * 2
            labels[sid] = s
        o = start + total
    return labels, o


def decode_tick(data: bytes) -> TickFile:
    magic, = struct.unpack_from(">i", data, 0)
    if magic not in TICK_MAGICS:
        raise DecodeError(f"not a tick file (magic 0x{magic:08X})")
    name = TICK_MAGICS[magic]

    if name in ("a", "b"):
        # old format: int magic, short ?, short g, int count, long, long, [int]
        if len(data) < 28:
            raise DecodeError("tick file too small")
        count = struct.unpack_from(">i", data, 8)[0]
        t0 = struct.unpack_from(">q", data, 12)[0]
        t1 = struct.unpack_from(">q", data, 20)[0]
        return TickFile(name, t0, t1, count, t0, t1)

    # 'c': int magic, byte flag, int count, long x4, short ncols, cols, short ntables
    flag, = struct.unpack_from(">b", data, 4)
    count, = struct.unpack_from(">i", data, 5)
    t0, t1, first, last = struct.unpack_from(">qqqq", data, 9)
    # 41-byte stub written by the "no data available" branch: header only.
    if len(data) <= 41:
        return TickFile(name, t0, t1, 0, first, last)
    ncols, = struct.unpack_from(">h", data, 41)
    if ncols < 0 or ncols > 32:
        raise DecodeError(f"dodgy tick column count {ncols}")
    cols, o = [], 43
    for _ in range(ncols):
        t, s = struct.unpack_from(">hh", data, o)
        o += 4
        if t not in TICK_COLUMNS:
            raise DecodeError(f"unknown tick column type {t}")
        if s != TICK_COLUMNS[t][2]:
            raise DecodeError(f"tick column {t} size {s} != {TICK_COLUMNS[t][2]}")
        cols.append((t, s, TICK_COLUMNS[t][0]))
    ntables, = struct.unpack_from(">h", data, o)
    o += 2
    labels, o = _read_tables(data, o, ntables)

    row = sum(s for _, s, _ in cols)
    if o + count * row > len(data):
        raise DecodeError(
            f"tick payload short: {o} + {count}*{row} > {len(data)}")
    out = TickFile(name, t0, t1, count, first, last, cols)
    for _ in range(count):
        rec = {}
        for t, s, nm in cols:
            v, = struct.unpack_from(TICK_COLUMNS[t][1], data, o)
            o += s
            if t == 5:
                rec[nm] = bool(v == 1)
            elif t in (12, 13):
                rec[nm] = labels.get(v, v)
            else:
                rec[nm] = v
        rec["ts"] = t0 + rec.pop("time_delta", 0)
        out.ticks.append(rec)
    return out


def decode_file(path: str):
    """Decode a .tick_data / .bar_dataN file, transparently unzipping."""
    if path.endswith(".zip"):
        with zipfile.ZipFile(path) as z:
            inner = z.namelist()[0]
            data = z.read(inner)
    else:
        with open(path, "rb") as fh:
            data = fh.read()
    magic, = struct.unpack_from(">i", data, 0)
    if magic in BAR_MAGICS:
        return decode_bar(data)
    if magic in TICK_MAGICS:
        return decode_tick(data)
    raise DecodeError(f"unknown magic 0x{magic:08X}")


if __name__ == "__main__":
    import glob
    import os
    import sys

    root = os.path.expanduser("~/.motivewave/historical_data")
    patterns = sys.argv[1:] or ["**/*.bar_data*", "**/*.tick_data*"]
    files = []
    for pat in patterns:
        files += glob.glob(os.path.join(root, pat), recursive=True)
    files = sorted(set(files))
    ok = err = 0
    errors = {}
    for p in files:
        try:
            decode_file(p)
            ok += 1
        except Exception as exc:  # noqa: BLE001
            err += 1
            key = f"{type(exc).__name__}: {exc}".split(":")[0:2]
            errors["|".join(key)] = errors.get("|".join(key), 0) + 1
    print(f"decoded OK: {ok}   failed: {err}   (of {len(files)})")
    for k, v in sorted(errors.items(), key=lambda kv: -kv[1])[:10]:
        print(f"   {v:5d}  {k}")
