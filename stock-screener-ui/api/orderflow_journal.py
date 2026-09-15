"""
Order-flow JSONL journal.

Appends normalized ticks and emitted signals to one file per symbol per IST
day (``{SYMBOL}_{YYYY-MM-DD}.jsonl``) so signals can be replayed/backtested and
session CVD can survive WebSocket reconnects.

Stdlib only. Every write path swallows errors so the live bridge never breaks
because of disk problems.
"""

import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

import config

_JOURNAL_ROOT = ("experiments", "data", "orderflow_journal")


def is_enabled() -> bool:
    value = os.getenv("ORDERFLOW_JOURNAL")
    if value is None:
        return True
    return value.strip().lower() not in ("0", "false", "no", "off")


def journal_dir() -> Path:
    return config.BASE_DIR.joinpath(*_JOURNAL_ROOT)


def _today() -> str:
    return datetime.now(config.IST).strftime("%Y-%m-%d")


def journal_path(symbol: str, day: Optional[str] = None) -> Path:
    symbol = (symbol or "").strip().upper()
    # instrument keys contain '|' which is illegal on some filesystems
    safe = symbol.replace("|", "_").replace("/", "_").replace("\\", "_")
    day = day or _today()
    return journal_dir() / f"{safe}_{day}.jsonl"


def append(symbol: str, kind: str, payload: dict) -> None:
    if not is_enabled():
        return
    symbol = (symbol or "").strip()
    if not symbol or not isinstance(payload, dict):
        return
    try:
        path = journal_path(symbol)
        path.parent.mkdir(parents=True, exist_ok=True)
        record = {"ts": int(time.time() * 1000), "kind": kind, "data": payload}
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, separators=(",", ":"), default=str) + "\n")
    except Exception:
        return


def read(symbol: str, day: Optional[str] = None, kind: Optional[str] = None) -> list[dict]:
    try:
        path = journal_path(symbol, day)
    except Exception:
        return []
    if not path.exists():
        return []

    out: list[dict] = []
    try:
        with path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue
                if not isinstance(record, dict):
                    continue
                if kind is not None and record.get("kind") != kind:
                    continue
                out.append(record)
    except Exception:
        return out
    return out
