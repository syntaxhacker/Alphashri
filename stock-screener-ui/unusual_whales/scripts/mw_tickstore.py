#!/usr/bin/env python3
"""MotiveWave local tick-store reader — minimum viable slice for the dashboard.

MotiveWave keeps every Rithmic tick it receives on disk, one file per hour:

    ~/.motivewave/historical_data/RITHMIC/MNQZ6.CME/<blockStartEpochMs>.tick_data

The format was reverse-engineered from MotiveWave 7.1.1
(``com/motivewave/platform/service/ad.class``). All primitives come from
``java.io.DataInputStream``, so everything is **big-endian**.

Tick file layout (magic ``c`` = 0x3281BB98, the current writer)::

    int32   magic
    byte    flag
    int32   tickCount
    int64   blockStart (ms)
    int64   blockEnd   (ms)
    int64   firstTickTs (ms)
    int64   lastTickTs  (ms)
    int16   nColumns
    nColumns x { int16 type, int16 byteSize }
    int16   nSymbolTables          (0 for MNQ — skip)
    tickCount x { column values in order }

Column types (see ``TICK_COLUMNS``). MNQ uses 10 columns = **45 bytes/tick**.

Magics ``a`` (0x3281BB96) and ``b`` (0x3281BB97) are legacy layouts with an
unknown payload encoding; they are header-only here and return ``None``.

This module only reads. It never writes to the MotiveWave data directory.
"""
from __future__ import annotations

import os
import struct
import zipfile
from pathlib import Path

DEFAULT_ROOT = Path(
    os.environ.get("MOTIVEWAVE_DATA_DIR", "~/.motivewave/historical_data")
).expanduser()

BAR_MAGICS = {0x16D01DE3, 0x16D01DE4}
TICK_MAGICS_LEGACY = {0x3281BB96, 0x3281BB97}  # a, b
TICK_MAGIC_CURRENT = 0x3281BB98  # c

# column type -> (name, struct fmt, size)
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


def find_instrument(prefix: str = "MNQ", root: Path | None = None, source: str = "RITHMIC") -> Path | None:
    """Newest instrument directory matching ``prefix`` (e.g. MNQZ6.CME).

    Contracts roll, so we never hardcode the expiry — pick whichever ``MNQ*``
    directory holds the most recent block file.
    """
    base = (root or DEFAULT_ROOT) / source
    if not base.is_dir():
        return None
    best: tuple[int, Path] | None = None
    for d in base.iterdir():
        if not d.is_dir() or not d.name.upper().startswith(prefix.upper()):
            continue
        blocks = _block_files(d)
        if not blocks:
            continue
        newest = int(blocks[-1].name.split(".")[0])
        if best is None or newest > best[0]:
            best = (newest, d)
    return best[1] if best else None


def _block_files(d: Path) -> list[Path]:
    try:
        files = [p for p in d.iterdir() if ".tick_data" in p.name]
    except OSError:
        return []
    return sorted(files, key=lambda p: int(p.name.split(".")[0]) if p.name.split(".")[0].isdigit() else 0)


def _read_head(path: Path, n: int = 4096) -> bytes:
    with open(path, "rb") as fh:
        return fh.read(n)


def _parse_header(data: bytes):
    """Return (count, block_start, cols, payload_offset) or None."""
    if len(data) < 43:
        return None
    magic, = struct.unpack_from(">i", data, 0)
    if magic in TICK_MAGICS_LEGACY:
        return None  # legacy payload encoding not decoded
    if magic != TICK_MAGIC_CURRENT:
        return None
    count, = struct.unpack_from(">i", data, 5)
    block_start, = struct.unpack_from(">q", data, 9)
    ncols, = struct.unpack_from(">h", data, 41)
    if not 0 <= ncols <= 32:
        return None
    cols, o = [], 43
    for _ in range(ncols):
        if o + 4 > len(data):
            return None
        t, s = struct.unpack_from(">hh", data, o)
        o += 4
        if t not in TICK_COLUMNS or TICK_COLUMNS[t][2] != s:
            return None
        cols.append((t, s, TICK_COLUMNS[t][0]))
    if o + 2 > len(data):
        return None
    ntables, = struct.unpack_from(">h", data, o)
    o += 2
    return count, block_start, cols, o, ntables


def last_tick(path: Path, source: str = "RITHMIC") -> dict | None:
    """Most recent tick in one block file, without decoding the whole file."""
    try:
        if path.name.endswith(".zip"):
            # archives bundle many hourly blocks — take the NEWEST entry
            with zipfile.ZipFile(path) as z:
                names = z.namelist()
                newest = max(names, key=lambda n: int(n.split(".")[0]) if n.split(".")[0].isdigit() else -1)
                data = z.read(newest)
            head = data[:4096]
        else:
            data = None
            head = _read_head(path)
        hdr = _parse_header(head)
        if not hdr:
            return None
        count, block_start, cols, payload, n_tables = hdr
        if count == 0 or n_tables:
            return None
        row = sum(s for _, s, _ in cols)
        if row <= 0:
            return None
        offset = payload + (count - 1) * row
        if data is not None:  # zip already in memory
            rec = data[offset:offset + row]
        else:
            with open(path, "rb") as fh:
                fh.seek(offset)
                rec = fh.read(row)
        if len(rec) < row:
            return None
        out: dict = {"block_start": block_start}
        p = 0
        for t, s, name in cols:
            v, = struct.unpack_from(TICK_COLUMNS[t][1], rec, p)
            p += s
            if t == 5:
                out[name] = bool(v == 1)
            elif t in (12, 13):
                continue
            else:
                out[name] = v
        out["ts"] = block_start + out.pop("time_delta", 0)
        return out
    except (OSError, struct.error, KeyError, zipfile.BadZipFile, ValueError):
        return None


def latest_tick(prefix: str = "MNQ", root: Path | None = None, source: str = "RITHMIC") -> dict | None:
    """Newest tick for the newest contract matching ``prefix``.

    Walks back through the last few block files so an in-progress (or empty)
    current hour still returns the most recent real print.
    """
    inst = find_instrument(prefix, root, source)
    if not inst:
        return None
    for block in reversed(_block_files(inst)[-3:]):
        tick = last_tick(block, source)
        if tick:
            tick["instrument"] = inst.name
            tick["block_file"] = block.name
            return tick
    return None


def decode_ticks_bytes(data: bytes) -> list[dict]:
    """Full decode of one block's bytes. Returns [] on any problem.

    MotiveWave's ``.tick_data.zip`` archives bundle MANY hourly blocks in one
    zip, so callers must iterate every entry rather than just the first.
    """
    try:
        hdr = _parse_header(data)
        if not hdr:
            return []
        count, block_start, cols, payload, n_tables = hdr
        if count == 0 or n_tables:
            return []
        row = sum(s for _, s, _ in cols)
        if payload + count * row > len(data):
            return []
        out = []
        o = payload
        for _ in range(count):
            rec = {"ts": block_start}
            for t, s, name in cols:
                v, = struct.unpack_from(TICK_COLUMNS[t][1], data, o)
                o += s
                if t == 1:
                    rec["ts"] = block_start + v
                elif t == 5:
                    rec["is_ask"] = bool(v == 1)
                elif t in (12, 13):
                    continue
                else:
                    rec[name] = v
            out.append(rec)
        return out
    except (struct.error, KeyError, ValueError):
        return []


def decode_ticks(path: Path) -> list[dict]:
    """Full decode of one block file (every entry, for zips). Returns [] on error."""
    try:
        if path.name.endswith(".zip"):
            out: list[dict] = []
            with zipfile.ZipFile(path) as z:
                for name in z.namelist():
                    out += decode_ticks_bytes(z.read(name))
            return out
        return decode_ticks_bytes(path.read_bytes())
    except (OSError, zipfile.BadZipFile):
        return []


def volume_profile(ticks, tick: float = 0.25, value_area: float = 0.70) -> dict | None:
    """Volume profile from ticks. Returns dict(poc, vah, val) or None.

    ``value_area`` is the fraction of volume the value area must contain
    (0.70 is the market-profile convention; TradingView calls it
    "Value Area Volume %").
    """
    prof: dict[float, float] = {}
    for t in ticks:
        k = round(float(t[1]) / tick) * tick
        prof[k] = prof.get(k, 0.0) + max(float(t[2] or 0), 0.0)
    tot = sum(prof.values())
    if not tot:
        return None
    poc = max(prof, key=lambda k: prof[k])
    lo = hi = poc
    acc = prof[poc]
    while acc < value_area * tot:
        up = prof.get(round(hi + tick, 10), 0.0)
        dn = prof.get(round(lo - tick, 10), 0.0)
        if not up and not dn:
            break
        if up >= dn:
            hi = round(hi + tick, 10)
            acc += up
        else:
            lo = round(lo - tick, 10)
            acc += dn
    return {"poc": poc, "vah": hi, "val": lo, "total": tot}


def cumulative_delta(ticks) -> float:
    """Buy volume (lifted the offer) minus sell volume (hit the bid)."""
    return sum((float(t[2] or 0) if t[3] else -float(t[2] or 0)) for t in ticks)


class TickCache:
    """Incremental per-block cache so a watcher can poll cheaply.

    MotiveWave rewrites the in-progress hour file repeatedly; blocks are
    re-decoded only when their size changes. Keyed by filename so a rewritten
    block replaces its previous copy rather than duplicating.
    """

    def __init__(self, prefix: str = "MNQ", root: Path | None = None, source: str = "RITHMIC"):
        self.prefix = prefix
        self.root = root
        self.source = source
        self._blocks: dict[str, tuple[int, list[tuple]]] = {}

    def _files(self, since_ms: int) -> list[Path]:
        inst = find_instrument(self.prefix, self.root, self.source)
        if not inst:
            return []
        out = []
        for p in _block_files(inst):
            try:
                start = int(p.name.split(".")[0])
            except ValueError:
                continue
            if start + 3_600_000 >= since_ms:  # block overlaps the window
                out.append(p)
        return out

    def load(self, since_ms: int) -> list[tuple]:
        """Ticks at/after ``since_ms``, sorted ascending: (ts, price, volume, is_ask)."""
        wanted = {p.name for p in self._files(since_ms)}
        for name in list(self._blocks):
            if name not in wanted:
                del self._blocks[name]  # fell out of the window
        for p in self._files(since_ms):
            try:
                size = p.stat().st_size
            except OSError:
                continue
            prev = self._blocks.get(p.name)
            if prev and prev[0] == size:
                continue
            ticks = [(r["ts"], r["price"], r.get("volume", 0) or 0, r.get("is_ask"))
                     for r in decode_ticks(p)]
            self._blocks[p.name] = (size, ticks)
        out: list[tuple] = []
        for _size, ticks in self._blocks.values():
            out += ticks
        out = [t for t in out if t[0] >= since_ms]
        out.sort()
        return out


def symbol_from(instrument_name: str) -> str:
    """'MNQZ6.CME' -> 'MNQZ6' (drop the exchange suffix)."""
    return instrument_name.split(".")[0] if instrument_name else ""


if __name__ == "__main__":
    import json
    import sys

    t = latest_tick(sys.argv[1] if len(sys.argv) > 1 else "MNQ")
    print(json.dumps(t, indent=2) if t else "no tick found")
