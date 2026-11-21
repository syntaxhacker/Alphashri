"""Shared JSONL file readers and symbol validation for the Index Report.

Every report reader consumes the same newline-delimited JSON contract: skip
blank lines, malformed JSON and non-object rows, and return ``[]`` instead of
raising when the file is missing or unreadable. Centralised here so the tape,
chain, breadth, futures and wall-event readers cannot drift apart.

A symbol that reaches a report reader ends up inside a filesystem path, so the
charset is enforced rather than trusted: ``..`` / ``/`` / whitespace can never
escape the data root.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Callable

from fastapi import HTTPException

#: Underlying names seen in F&O: RELIANCE, BAJAJ-AUTO, M&M, NIFTYNXT50.
_SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9&_-]{0,23}$")


def read_jsonl(
    path: Path, predicate: Callable[[dict], bool] | None = None
) -> list[dict]:
    """Every parseable object in ``path`` (oldest first); ``[]`` on I/O error.

    Blank lines, malformed JSON and non-dict rows are skipped. When ``predicate``
    is given, only rows for which it is truthy are kept.
    """
    out: list[dict] = []
    try:
        with open(path) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue
                if isinstance(row, dict) and (predicate is None or predicate(row)):
                    out.append(row)
    except OSError:
        pass
    return out


def read_jsonl_tail(
    path: Path,
    max_bytes: int = 1_500_000,
    predicate: Callable[[dict], bool] | None = None,
) -> list[dict]:
    """Last ``max_bytes`` of a growing JSONL file, parsed (oldest first).

    The first line of a tail read is almost always partial, so it is dropped
    unless the read started at byte 0. Malformed / non-dict rows are skipped and
    ``predicate`` (when given) filters the surviving rows. Never raises.
    """
    try:
        with open(path, "rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            start = max(0, size - max_bytes)
            fh.seek(start)
            data = fh.read()
    except OSError:
        return []
    lines = data.split(b"\n")
    if start > 0:
        lines = lines[1:]
    out: list[dict] = []
    for raw in lines:
        raw = raw.strip()
        if not raw:
            continue
        try:
            row = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(row, dict) and (predicate is None or predicate(row)):
            out.append(row)
    return out


def symbol_or_400(underlying: str, *, noun: str = "symbol") -> str:
    """Upper-cased, path-safe underlying symbol or an HTTP 400.

    ``noun`` selects the error wording: the simulator says 'symbol', the
    options-history routes say 'underlying'.
    """
    symbol = str(underlying or "").strip().upper()
    if not _SYMBOL_RE.match(symbol):
        raise HTTPException(
            status_code=400,
            detail=f"bad {noun}: {underlying!r}, want a symbol like NIFTY/RELIANCE",
        )
    return symbol
