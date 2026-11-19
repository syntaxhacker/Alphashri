"""Shared JSONL / JSON-file primitives for the report recorders.

``nifty.py`` and ``options_recorder.py`` each carried their own copy of the
same three operations, and the copies had already drifted (compact vs default
``json.dumps`` separators, a tail reader without an empty-file guard). The
separators stay a caller decision: the on-disk bytes are part of each
recorder's frozen contract — the NIFTY tape is written with the default
separators, the generic recorder compactly — so this module never silently
re-encodes a file.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional, Sequence


def append_line(path: Path, obj: Any,
                *, separators: Optional[Sequence[str]] = None) -> None:
    """Append one JSON line (blocking; call via a thread from async code)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a") as fh:
        fh.write(json.dumps(obj, separators=separators) + "\n")


def write_json_atomic(path: Path, obj: Any,
                      *, separators: Sequence[str] = (",", ":")) -> Path:
    """Write a whole JSON file atomically (tmp + ``os.replace``)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w") as fh:
        json.dump(obj, fh, separators=separators)
    os.replace(tmp, path)
    return path


def tail_last_json_line(path: Path, chunk: int = 65536) -> Optional[dict]:
    """Last complete JSON object in a growing JSONL file, reading the tail.

    These logs reach tens of MB by the close and the minute-dedupe / latest-row
    readers only need the final line. O(1) (last ``chunk`` bytes, growing when
    the last line is longer) instead of O(file). Never raises.
    """
    try:
        if not path.exists():
            return None
        with open(path, "rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            if size <= 0:
                return None
            window = min(chunk, size)
            lines: list[bytes] = []
            while True:
                fh.seek(size - window)
                data = fh.read(window)
                lines = [ln for ln in data.split(b"\n") if ln.strip()]
                if len(lines) >= (1 if window == size else 2) or window == size:
                    break
                window = min(window * 2, size)
        if not lines:
            return None
        value = json.loads(lines[-1])
        return value if isinstance(value, dict) else None
    except Exception:
        return None
