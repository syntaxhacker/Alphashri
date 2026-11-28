#!/usr/bin/env python3
"""Deterministic cache-stats command-count probe (no network, no file writes).

Run from the project root with the task venv::

    PYTHONPATH=. CI_MODE=1 <venv>/bin/python scripts/perf/bench_cache_stats.py

fakeredis does not implement INFO, so the probe wraps it with a recorder that
serves the same sections a real Redis server does and logs every command. The
recorder accepts a list of sections, but production still issues two INFO calls:
fakeredis rejects the combined form with DataError and has no INFO at all.
"""

from __future__ import annotations

import json
from unittest.mock import patch

import fakeredis

import cache.redis_client as rc

_MEMORY = {
    "used_memory": 1_234_567,
    "used_memory_human": "1.18M",
    "used_memory_peak": 2_345_678,
    "used_memory_peak_human": "2.24M",
    "maxmemory_policy": "allkeys-lru",
    "mem_fragmentation_ratio": 1.37,
}

_STATS = {
    "evicted_keys": 11,
    "expired_keys": 22,
    "keyspace_hits": 3300,
    "keyspace_misses": 700,
}


class RecordingRedis:
    """fakeredis plus INFO support and a command log."""

    def __init__(self) -> None:
        self._inner = fakeredis.FakeRedis(decode_responses=True)
        self.commands: list[str] = []

    def hset(self, key, mapping=None, **kwargs):
        self.commands.append("hset")
        return self._inner.hset(key, mapping=mapping or kwargs)

    def dbsize(self):
        self.commands.append("dbsize")
        return self._inner.dbsize()

    def info(self, section=None):
        sections = ("memory", "stats") if section is None else (
            (section,) if isinstance(section, str) else tuple(section)
        )
        self.commands.append("info:" + ",".join(sections))
        result = {}
        if "memory" in sections:
            result.update(_MEMORY)
        if "stats" in sections:
            result.update(_STATS)
        return result

    def scan_iter(self, match=None, count=100):
        self.commands.append(f"scan:{match}:{count}")
        return self._inner.scan_iter(match=match, count=count)


def main() -> None:
    client = RecordingRedis()
    for key in (
        "screener:a", "screener:b", "screener:c", "screener:d",
        "news:a", "news:b",
        "backtest:a", "backtest:b", "backtest:c",
        "untracked:key",
        "nocolon",
    ):
        client._inner.set(key, "v")

    rc._redis_available = True
    rc._global_hits = 40
    rc._global_misses = 10
    rc._domain_hits.clear()
    rc._domain_hits.update({"screener": 30, "news": 10, "other": 1})
    rc._domain_misses.clear()
    rc._domain_misses.update({"backtest": 10})
    rc._last_flush_time = 0.0

    with patch.object(rc, "get_redis_client", return_value=client):
        stats = rc.get_cache_stats()

    print(json.dumps({"stats": stats, "commands": client.commands}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
