"""Skip journals (and the minute index) for the report recorders.

The recorders keep five journals, and the dedupe policy is **not** the same in
all of them:

* the tape journals answer "why is this minute's row missing", so a failure
  repeating every 10 s is ONE missing minute → dedupe by ``t[:16]``;
* the 10-second journal answers "why is the series holed", where the same
  minute can fail twice for different causes (a slow fetch and a disk error)
  → dedupe by ``(t[:16], reason)``;
* the tape/snapshot *minute indexes* are not journals at all — they only need
  the set of minutes already present in a file.

The policy is an explicit argument so no caller can silently inherit the wrong
one. Every helper is best-effort and never raises: a full disk must not take
the recorder down.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional, Union

#: One entry per minute (the tape journals).
MINUTE = "minute"
#: One entry per (minute, reason) pair (the 10-second journal).
MINUTE_REASON = "minute+reason"


def read_minute_keys(path: Path) -> set[str]:
    """``t[:16]`` for every object line in a JSONL file (missing → empty set).

    Reads the whole file once; callers cache the result per path, because these
    files only grow and a per-tick scan of a multi-MB day file is wasteful.
    """
    keys: set[str] = set()
    try:
        with open(path) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    value = json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue
                t = value.get("t") if isinstance(value, dict) else None
                if isinstance(t, str) and t:
                    keys.add(t[:16])
    except OSError:
        pass
    return keys


def append_gap(path: Path, t_iso: str, reason: str, *,
               seen: set,
               symbol: Optional[str] = None,
               detail: str = "",
               dedupe: str = MINUTE) -> bool:
    """Append one skipped-minute entry unless ``dedupe`` says it is a repeat.

    ``seen`` is the caller's own cache for this file (so a module-level dict can
    be cleared by tests / a restart without this module holding state). Entries
    are written with the default ``json.dumps`` separators — the journals'
    existing bytes. Returns ``True`` when a line was appended.
    """
    try:
        minute = str(t_iso)[:16]
        key: Union[str, tuple[str, str]]
        key = (minute, reason) if dedupe == MINUTE_REASON else minute
        if key in seen:
            return False
        # Key order matches every journal already on disk (t, [symbol], reason,
        # [detail]).
        if symbol is None:
            entry: dict = {"t": t_iso, "reason": reason}
        else:
            entry = {"t": t_iso, "symbol": symbol, "reason": reason}
        if detail:
            entry["detail"] = str(detail)[:200]
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a") as fh:
            fh.write(json.dumps(entry) + "\n")
        seen.add(key)
        return True
    except Exception:
        return False
