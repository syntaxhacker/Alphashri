"""Feed-freshness tracking for the TradingView scanner.

``update_mode`` tells us whether the data is live (``streaming``) or delayed
(``delayed_streaming_900``). The scanner client notes the mode after every
frame so a health endpoint / badge can report it without another request.
"""

from __future__ import annotations

import time
from typing import Any, Optional

_last: dict[str, Any] = {"mode": None, "at": None, "rows": 0}


def note_update_mode(df) -> None:
    """Record the ``update_mode`` values of a scanner frame. Never raises."""
    try:
        columns = getattr(df, "columns", None)
        if columns is None or "update_mode" not in columns:
            return
        modes = [str(v) for v in df["update_mode"].dropna().unique().tolist()]
        if not modes:
            return
        mode = modes[0] if len(modes) == 1 else ",".join(sorted(modes)[:3])
        _last.update(mode=mode, at=time.time(), rows=int(len(df)))
    except Exception:
        return


def tv_feed_status() -> dict[str, Optional[Any]]:
    """Latest observed scanner freshness (no secrets)."""
    age = round(time.time() - float(_last["at"]), 1) if _last["at"] else None
    mode = _last["mode"]
    return {
        "mode": mode,
        "live": mode == "streaming" if mode else None,
        "delayed": mode.startswith("delayed") if isinstance(mode, str) else None,
        "rows": int(_last["rows"]),
        "age_sec": age,
    } if mode else {
        "mode": None,
        "live": None,
        "delayed": None,
        "rows": 0,
        "age_sec": None,
    }
