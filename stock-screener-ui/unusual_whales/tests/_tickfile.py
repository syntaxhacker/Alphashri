"""Shared test helper: build a MotiveWave tick block file byte-for-byte.

Kept in one place so both test modules exercise the same wire format the
decoder claims to understand.
"""
from __future__ import annotations

import struct
from pathlib import Path

TICK_MAGIC_CURRENT = 0x3281BB98
DEFAULT_COLS = [(1, 4), (2, 4), (3, 4), (5, 1)]


def build_tick_file(
    path: Path,
    ticks: list[tuple[int, float, int, bool]],
    *,
    magic: int = TICK_MAGIC_CURRENT,
    block_start: int = 1_790_712_000_000,
    n_tables: int = 0,
    col_sizes: list[tuple[int, int]] | None = None,
) -> Path:
    """Write a block exactly as MotiveWave's DataOutputStream would (big-endian)."""
    cols = col_sizes if col_sizes is not None else DEFAULT_COLS
    buf = struct.pack(">i", magic)
    buf += struct.pack(">b", 0)
    buf += struct.pack(">i", len(ticks))
    buf += struct.pack(">qqqq", block_start, block_start + 3_600_000, block_start, block_start)
    buf += struct.pack(">h", len(cols))
    for t, s in cols:
        buf += struct.pack(">hh", t, s)
    buf += struct.pack(">h", n_tables)
    for delta, price, vol, is_ask in ticks:
        buf += struct.pack(">i", delta)
        buf += struct.pack(">f", price)
        buf += struct.pack(">i", vol)
        buf += struct.pack(">b", 1 if is_ask else 0)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(buf)
    return path
