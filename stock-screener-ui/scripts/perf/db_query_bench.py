#!/usr/bin/env python3
"""Read-only microbenchmark for the hottest non-agri SQL read paths.

Everything runs against ``sqlite:///:memory:``. ``DATABASE_URL`` is pinned
before importing any project module so even an accidental connection from an
import side effect cannot reach the local user database.

Usage::

    .venv/bin/python scripts/perf/db_query_bench.py --report
    .venv/bin/python scripts/perf/db_query_bench.py --json

The numbers are indicative, not a gate: they come from synthetic rows on one
machine and must never become a wall-clock assertion in a test.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sqlite3
import statistics
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

# Safety first: no project import below may open the real local database.
os.environ["DATABASE_URL"] = "sqlite:///:memory:"

_REPO = Path(__file__).resolve().parents[2]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

IN_MEMORY_URL = "sqlite:///:memory:"
WARMUP = 5
ITERATIONS = 40

# Synthetic volumes. Chosen to expose index/scan differences (tens of thousands
# of rows) while keeping a single run under a few seconds.
N_USERS = 60
N_BOTS = 90
N_STRATEGIES = 12
N_TRADES = 60_000
N_POSITIONS = 6_000
N_INSTRUMENTS = 120_000
N_USER_CONFIGS = 3_000
N_REPLAY_CONFIGS = 2_000
N_TOUCHES = 25_000

CUTOFF_DAYS = 30
LOOKBACK_DAYS = 180


@dataclass(frozen=True)
class QuerySpec:
    """One measured query shape, traced back to its production call site."""

    id: str
    source: str
    sql: str
    params: tuple[Any, ...]
    note: str = ""


def _placeholders(n: int) -> str:
    return ",".join("?" for _ in range(n))


def _cutoff(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(sep=" ")


def build_queries() -> tuple[QuerySpec, ...]:
    """Query shapes copied from the production call sites (no agri paths)."""
    symbol_sample = tuple(f"SYM{i:03d}" for i in range(24))
    strategy_sample = tuple(range(4, 8))
    bot_sample = tuple(range(1, 16))
    cutoff30 = _cutoff(CUTOFF_DAYS)
    cutoff7 = _cutoff(7)
    end = datetime.now(timezone.utc).isoformat(sep=" ")
    start = _cutoff(CUTOFF_DAYS)

    return (
        QuerySpec(
            "trade_history",
            "api/paper/history.py:95,123",
            "SELECT * FROM trades WHERE user_id = ? AND is_test = 0 "
            "AND exit_time >= ? ORDER BY exit_time DESC LIMIT 50",
            (1, cutoff7),
            "Default trade-history query; composite index should remove the sort.",
        ),
        QuerySpec(
            "strategy_performance_unbounded",
            "api/strategy_performance.py:23",
            "SELECT * FROM trades WHERE user_id = ? AND is_test = 0 "
            "AND exit_time IS NOT NULL AND exit_time >= ?",
            (1, cutoff30),
            "Unbounded read: every matching row is fetched and aggregated in Python.",
        ),
        QuerySpec(
            "dashboard_analytics_range",
            "api/paper/dashboard_analytics.py:161",
            "SELECT * FROM trades WHERE user_id = ? AND is_test = 0 "
            "AND exit_time IS NOT NULL AND exit_time <= ? AND exit_time >= ? "
            "ORDER BY exit_time ASC",
            (1, end, start),
            "30D/90D/ALL analytics; ALL preset drops the lower bound entirely.",
        ),
        QuerySpec(
            "dashboard_analytics_projection",
            "api/paper/dashboard_analytics.py:161",
            "SELECT strategy_id, bot_id, symbol, entry_time, exit_time, pnl, pnl_pct, costs, net_pnl "
            "FROM trades WHERE user_id = ? AND is_test = 0 AND exit_time IS NOT NULL "
            "AND exit_time <= ? AND exit_time >= ? ORDER BY exit_time ASC",
            (1, end, start),
            "Same range, only the columns the aggregation actually consumes.",
        ),
        QuerySpec(
            "bot_lazy_load_by_id",
            "api/paper/dashboard_analytics.py:209",
            "SELECT * FROM bot_configs WHERE id = ?",
            (3,),
            "Stand-in for the ORM lazy load `t.bot` inside the per-trade loop.",
        ),
        QuerySpec(
            "bot_batch_resolve",
            "api/paper/history.py:36",
            f"SELECT id, uuid, name FROM bot_configs WHERE id IN ({_placeholders(len(bot_sample))})",
            bot_sample,
            "Batched alternative; one query replaces repeated point lookups.",
        ),
        QuerySpec(
            "positions_by_bot",
            "api/bot_state.py:60",
            "SELECT * FROM positions WHERE bot_id = ? AND is_test = 0",
            (3,),
            "Bot state open positions; candidate composite (bot_id, is_test).",
        ),
        QuerySpec(
            "positions_by_user",
            "api/paper/live_stream.py:49",
            "SELECT * FROM positions WHERE user_id = ?",
            (1,),
            "Live price stream reads every position of the user on connect.",
        ),
        QuerySpec(
            "positions_symbols_by_user",
            "api/paper/live_stream.py:49,51",
            "SELECT symbol FROM positions WHERE user_id = ?",
            (1,),
            "Only p.symbol is consumed; full-row read is unnecessary here.",
        ),
        QuerySpec(
            "bot_by_id_user",
            "api/bot_state.py:54",
            "SELECT * FROM bot_configs WHERE id = ? AND user_id = ?",
            (3, 1),
            "Ownership check at the start of get_bot_state().",
        ),
        QuerySpec(
            "bot_runtime_by_bot",
            "api/bot_state.py:58",
            "SELECT * FROM bot_runtime_states WHERE bot_id = ?",
            (3,),
            "Unique index on bot_id should already make this a single-row search.",
        ),
        QuerySpec(
            "strategy_runtime_by_bot",
            "api/bot_state.py:98",
            f"SELECT * FROM strategy_runtime_states WHERE bot_id = ? "
            f"AND strategy_id IN ({_placeholders(len(strategy_sample))})",
            (3, *strategy_sample),
            "Already covered by the model's UNIQUE(bot_id, strategy_id) index.",
        ),
        QuerySpec(
            "bot_strategies_by_bot",
            "api/bot_state.py:83",
            "SELECT * FROM bot_strategies WHERE bot_id = ?",
            (3,),
            "Association table is PK(bot_id, strategy_id): should be a prefix search.",
        ),
        QuerySpec(
            "replay_configs_list",
            "api/replay_api.py:183",
            "SELECT * FROM replay_saved_configs WHERE user_id = ? ORDER BY updated_at DESC",
            (1,),
            "Model declares (user_id, updated_at) at final HEAD; no temp sort remains.",
        ),
        QuerySpec(
            "user_saved_config_get",
            "api/user_configs.py:564",
            "SELECT * FROM user_saved_configs WHERE user_id = ? AND scope = ? AND name = ?",
            (1, "screener", ""),
            "Covered by UNIQUE(user_id, scope, name); reference for a good plan.",
        ),
        QuerySpec(
            "instruments_by_segment",
            "api/symbols.py:82",
            "SELECT * FROM instruments WHERE segment = ?",
            ("NSE_EQ",),
            "Model declares (segment); scan is gone but 30k row reads still dominate.",
        ),
        QuerySpec(
            "instrument_key_lookup",
            "api/reports_api/movers.py:125",
            f"SELECT trading_symbol, instrument_key FROM instruments "
            f"WHERE segment = ? AND trading_symbol IN ({_placeholders(len(symbol_sample))})",
            ("NSE_EQ", *symbol_sample),
            "Movers quote resolution; model now declares the covering (segment, symbol, key) index.",
        ),
        QuerySpec(
            "instruments_count_all",
            "api/symbols.py:475",
            "SELECT count(*) FROM instruments",
            (),
            "Debug endpoint query 1; index-only count.",
        ),
        QuerySpec(
            "instruments_count_segment",
            "api/symbols.py:476",
            "SELECT count(*) FROM instruments WHERE segment = ?",
            ("NSE_EQ",),
            "Debug endpoint query 2; model declares (segment) so this is an index-only count.",
        ),
        QuerySpec(
            "stock52_recent_touches",
            "api/screener_api/screener_scan.py:612",
            f"SELECT * FROM stock_52week_touches WHERE symbol IN ({_placeholders(len(symbol_sample))}) "
            f"AND touched_date >= ? AND is_high = 1 "
            "ORDER BY symbol, touched_date DESC",
            (*symbol_sample, cutoff7),
            "Recent high-touch lookup; candidate (symbol, is_high, touched_date).",
        ),
    )


CANDIDATE_INDEXES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    (
        "ix_positions_bot_test",
        "CREATE INDEX ix_positions_bot_test ON positions (bot_id, is_test)",
        ("positions_by_bot",),
    ),
    (
        "ix_replay_saved_configs_user_updated",
        "CREATE INDEX ix_replay_saved_configs_user_updated "
        "ON replay_saved_configs (user_id, updated_at)",
        ("replay_configs_list",),
    ),
    (
        "ix_instruments_segment",
        "CREATE INDEX ix_instruments_segment ON instruments (segment)",
        ("instruments_by_segment", "instruments_count_segment"),
    ),
    (
        "ix_instruments_segment_symbol_key",
        "CREATE INDEX ix_instruments_segment_symbol_key "
        "ON instruments (segment, trading_symbol, instrument_key)",
        ("instrument_key_lookup",),
    ),
    (
        "ix_stock52_touches_symbol_high_date",
        "CREATE INDEX ix_stock52_touches_symbol_high_date "
        "ON stock_52week_touches (symbol, is_high, touched_date)",
        ("stock52_recent_touches",),
    ),
)

AGRI_TOKENS = ("agri", "mandi", "agri_prices")


def percentile(values: Sequence[float], fraction: float) -> float:
    """Linearly interpolated percentile; pure so tests can assert exact values."""
    ordered = sorted(values)
    if not ordered:
        raise ValueError("empty sample")
    if not 0 <= fraction <= 1:
        raise ValueError("fraction must be in [0, 1]")
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def plan_rows(conn: sqlite3.Connection, query: QuerySpec) -> list[str]:
    """EXPLAIN QUERY PLAN detail rows for one query."""
    cursor = conn.execute("EXPLAIN QUERY PLAN " + query.sql, query.params)
    return [str(row[3]) for row in cursor.fetchall()]


def plan_kind(details: Iterable[str]) -> dict[str, Any]:
    """Summarise an EXPLAIN plan: access mode, index name, temp sort."""
    text = " | ".join(details)
    if "SEARCH " in text:
        kind = "search"
    elif "SCAN " in text:
        kind = "scan"
    else:
        kind = "other"
    match = re.search(r"USING (?:COVERING )?INDEX (\S+)", text)
    index = match.group(1) if match else None
    if index is None and "USING INTEGER PRIMARY KEY" in text:
        index = "INTEGER PRIMARY KEY"
    return {
        "kind": kind,
        "index": index,
        "temp_b_tree": "USE TEMP B-TREE" in text,
    }


def _execute(conn: sqlite3.Connection, query: QuerySpec) -> int:
    cursor = conn.execute(query.sql, query.params)
    rows = cursor.fetchall()
    cursor.close()
    return len(rows)


def bench(
    conn: sqlite3.Connection,
    query: QuerySpec,
    iterations: int = ITERATIONS,
    warmup: int = WARMUP,
) -> dict[str, Any]:
    """Warm up, then time full execute+fetch cycles (no wall-clock assertions)."""
    for _ in range(warmup):
        _execute(conn, query)

    samples: list[float] = []
    row_count = 0
    for _ in range(iterations):
        start = time.perf_counter()
        row_count = _execute(conn, query)
        samples.append((time.perf_counter() - start) * 1000.0)

    return {
        "id": query.id,
        "source": query.source,
        "rows": row_count,
        "p50_ms": round(percentile(samples, 0.50), 3),
        "p95_ms": round(percentile(samples, 0.95), 3),
        "plan": plan_kind(plan_rows(conn, query)),
        "plan_detail": plan_rows(conn, query),
    }


def build_db(seed: int = 7) -> sqlite3.Connection:
    """Create and seed an isolated in-memory DB from the SQLAlchemy models."""
    from sqlalchemy import create_engine

    from db.models import Base  # noqa: F401 - imports register every table

    engine = create_engine(IN_MEMORY_URL, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)

    src = engine.raw_connection().driver_connection
    dst = sqlite3.connect(":memory:")
    src.backup(dst)
    engine.dispose()
    seed_rows(dst, seed=seed)
    dst.commit()
    return dst


def _many(conn: sqlite3.Connection, sql: str, rows: Iterable[tuple[Any, ...]]) -> None:
    conn.executemany(sql, rows)


def seed_rows(conn: sqlite3.Connection, seed: int = 7) -> None:
    """Deterministic synthetic rows; no live/user data is ever read."""
    rng = random.Random(seed)
    now = datetime.now(timezone.utc)
    ts = lambda days_back: (now - timedelta(days=days_back)).isoformat(sep=" ")

    users = [(i, f"user{i}@example.test", 1) for i in range(1, N_USERS + 1)]
    _many(
        conn,
        "INSERT INTO users (id, email, hashed_password, is_active) VALUES (?, ?, ?, ?)",
        [(u, e, "x", 1) for u, e, _ in users],
    )

    strategies = [
        (i, f"strategy-{i}", "ORB", 1, 0, ts(100), ts(1))
        for i in range(1, N_STRATEGIES + 1)
    ]
    _many(
        conn,
        "INSERT INTO strategy_configs (id, name, strategy_type, is_active, is_template, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        strategies,
    )

    bots = []
    for i in range(1, N_BOTS + 1):
        uid = 1 if i <= 15 else 2 + (i % (N_USERS - 1))
        bots.append((i, f"bot-uuid-{i:04d}", uid, f"bot-{i}", 1, ts(90), ts(1)))
    _many(
        conn,
        "INSERT INTO bot_configs (id, uuid, user_id, name, is_active, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        bots,
    )

    bot_strategy_rows = []
    sid = 1
    for bot in bots:
        for _ in range(4):
            bot_strategy_rows.append((bot[0], sid, 3, 0.20))
            sid = sid % N_STRATEGIES + 1
    _many(
        conn,
        "INSERT INTO bot_strategies (bot_id, strategy_id, max_positions, capital_allocation_pct) "
        "VALUES (?, ?, ?, ?)",
        bot_strategy_rows,
    )

    _many(
        conn,
        "INSERT INTO bot_runtime_states "
        "(bot_id, user_id, cash, daily_pnl, daily_trades, realized_pnl, day_start, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [(b[0], b[2], 100000.0, 0.0, 0, 0.0, "2026-01-01", ts(0)) for b in bots],
    )

    _many(
        conn,
        "INSERT INTO strategy_runtime_states "
        "(bot_id, strategy_id, user_id, status, signals_generated, trades_executed, "
        "capital_used, available_capital, positions_count, realized_pnl, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (b[0], s, b[2], "running", 10, 3, 1000.0, 9000.0, 1, 0.0, ts(0))
            for b in bots
            for s in range(1, 5)
        ],
    )

    trade_rows = []
    for i in range(1, N_TRADES + 1):
        uid = 1 if i <= N_TRADES // 3 else 2 + (i % (N_USERS - 1))
        bot = bots[0] if uid == 1 else bots[uid % len(bots)]
        strategy_id = 1 + (i % N_STRATEGIES)
        days = rng.randint(0, LOOKBACK_DAYS - 1)
        # Per-row seconds offset keeps UNIQUE(bot, strategy, symbol, entry_time)
        # from colliding in synthetic data.
        entry = (now - timedelta(days=days, seconds=i)).isoformat(sep=" ")
        exit_ = (now - timedelta(days=max(0, days - 1), seconds=i)).isoformat(sep=" ")
        is_test = 1 if i % 20 == 0 else 0
        trade_rows.append(
            (
                f"trade-uuid-{i:07d}",
                uid,
                bot[0],
                strategy_id,
                f"strategy-{strategy_id}",
                f"SYM{rng.randrange(200):03d}",
                "BUY",
                10,
                100.0,
                entry,
                ts(days),
                is_test,
                exit_,
                1.0,
                0.5,
                1.0,
                1.5,
                "live",
            )
        )
    _many(
        conn,
        "INSERT INTO trades (uuid, user_id, bot_id, strategy_id, strategy_name, symbol, side, "
        "quantity, entry_price, entry_time, created_at, is_test, exit_time, pnl, pnl_pct, "
        "costs, net_pnl, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        trade_rows,
    )

    position_rows = []
    for i in range(1, N_POSITIONS + 1):
        uid = 1 if i <= N_POSITIONS // 3 else 2 + (i % (N_USERS - 1))
        bot = bots[0] if uid == 1 else bots[uid % len(bots)]
        strategy_id = 1 + (i % N_STRATEGIES)
        created = ts(rng.randint(0, 5))
        position_rows.append(
            (
                f"pos-uuid-{i:06d}",
                uid,
                bot[0],
                strategy_id,
                f"strategy-{strategy_id}",
                f"SYM{i:06d}",
                "BUY",
                10,
                100.0,
                created,
                created,
                created,
                1 if i % 30 == 0 else 0,
            )
        )
    _many(
        conn,
        "INSERT INTO positions (uuid, user_id, bot_id, strategy_id, strategy_name, symbol, side, "
        "quantity, entry_price, entry_time, created_at, updated_at, is_test) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        position_rows,
    )

    instruments = []
    for i in range(1, N_INSTRUMENTS + 1):
        segment = "NSE_EQ" if i % 4 == 0 else "NSE_FO" if i % 2 == 0 else "BSE_EQ"
        symbol = f"SYM{i % 500:03d}"
        instruments.append(
            (f"NSE_EQ|{i:06d}", symbol, f"Company {i}", "NSE", segment)
        )
    _many(
        conn,
        "INSERT INTO instruments (instrument_key, trading_symbol, name, exchange, segment) "
        "VALUES (?, ?, ?, ?, ?)",
        instruments,
    )

    _many(
        conn,
        "INSERT INTO user_saved_configs (user_id, scope, name, config, version, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, 1, ?, ?)",
        [
            (
                1 if i == 0 else 1 + (i % N_USERS),
                "screener" if i == 0 or i % 2 else "chart",
                "" if i == 0 else f"cfg-{i}",
                "{}",
                ts(5),
                ts(1),
            )
            for i in range(N_USER_CONFIGS)
        ],
    )
    _many(
        conn,
        "INSERT INTO replay_saved_configs (user_id, name, description, config, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        [
            (1 + (i % N_USERS), f"cfg-{i}", "", "{}", ts(10), ts(i % 30))
            for i in range(N_REPLAY_CONFIGS)
        ],
    )
    _many(
        conn,
        "INSERT INTO stock_52week_touches "
        "(uuid, symbol, touched_date, touched_price, is_high, is_current_52w_high, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
            (
                f"touch-{i:07d}",
                f"SYM{i % 500:03d}",
                (now - timedelta(days=i % LOOKBACK_DAYS, seconds=i)).isoformat(sep=" "),
                100.0 + i % 50,
                1 if i % 3 else 0,
                0,
                ts(0),
            )
            for i in range(N_TOUCHES)
        ],
    )


def _existing_indexes(conn: sqlite3.Connection) -> dict[str, str]:
    """Named indexes and their DDL; sqlite_autoindex_* have no SQL and are skipped."""
    rows = conn.execute(
        "SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL"
    ).fetchall()
    return {str(name): str(sql) for name, sql in rows}


def _index_columns(ddl: str) -> tuple[str, ...]:
    """Column list of a CREATE INDEX statement, for detecting same-name drift."""
    match = re.search(r"\(([^)]*)\)", ddl)
    if match is None:
        raise ValueError(f"cannot read index columns from DDL: {ddl}")
    return tuple(col.strip().lower() for col in match.group(1).split(","))


def with_candidate_indexes(
    conn: sqlite3.Connection,
) -> tuple[sqlite3.Connection, dict[str, str]]:
    """Clone the seeded DB and add missing candidate indexes.

    Returns the clone plus a per-index status. Candidates already declared in
    the models are left untouched, so the 'after' DB really is identical to
    'before' for that query and no speedup is claimed.
    """
    existing = _existing_indexes(conn)
    clone = sqlite3.connect(":memory:")
    conn.backup(clone)

    status: dict[str, str] = {}
    for name, ddl, _targets in CANDIDATE_INDEXES:
        current_ddl = existing.get(name)
        if current_ddl is not None:
            if _index_columns(current_ddl) != _index_columns(ddl):
                raise RuntimeError(
                    f"candidate {name} exists with different columns "
                    f"({_index_columns(current_ddl)} != {_index_columns(ddl)})"
                )
            status[name] = "already_present"
            continue
        clone.execute(ddl.replace("CREATE INDEX ", "CREATE INDEX IF NOT EXISTS ", 1))
        status[name] = "applied"

    clone.commit()
    return clone, status


def _fmt_plan(plan: dict[str, Any]) -> str:
    index = plan.get("index") or "-"
    suffix = " +sort" if plan.get("temp_b_tree") else ""
    return f"{plan.get('kind')} {index}{suffix}"


def run_report(iterations: int = ITERATIONS, warmup: int = WARMUP) -> dict[str, Any]:
    queries = build_queries()
    before = build_db()
    after, index_status = with_candidate_indexes(before)

    base = [bench(before, q, iterations, warmup) for q in queries]
    tuned = [bench(after, q, iterations, warmup) for q in queries]
    before.close()
    after.close()

    result: dict[str, Any] = {
        "iterations": iterations,
        "warmup": warmup,
        "volumes": {
            "users": N_USERS,
            "bots": N_BOTS,
            "trades": N_TRADES,
            "positions": N_POSITIONS,
            "instruments": N_INSTRUMENTS,
            "user_configs": N_USER_CONFIGS,
            "replay_configs": N_REPLAY_CONFIGS,
            "touches": N_TOUCHES,
        },
        "queries": [],
        "index_status": dict(index_status),
    }
    for b, a in zip(base, tuned):
        spec = next(q for q in queries if q.id == b["id"])
        already_present = [
            name
            for name, _ddl, targets in CANDIDATE_INDEXES
            if b["id"] in targets and index_status.get(name) == "already_present"
        ]
        # An index declared in the model is in both DBs: comparing the two as
        # if we had added it would manufacture a speedup that does not exist.
        speedup = None
        if not already_present and a["p50_ms"]:
            speedup = round(b["p50_ms"] / a["p50_ms"], 2)
        result["queries"].append(
            {
                "id": b["id"],
                "source": spec.source,
                "note": spec.note,
                "rows": b["rows"],
                "before_p50_ms": b["p50_ms"],
                "before_p95_ms": b["p95_ms"],
                "before_plan": _fmt_plan(b["plan"]),
                "after_p50_ms": a["p50_ms"],
                "after_p95_ms": a["p95_ms"],
                "after_plan": _fmt_plan(a["plan"]),
                "p50_speedup": speedup,
                "comparison": "already-present" if already_present else "index-added-or-unaffected",
                "already_present_indexes": already_present,
                "before_plan_detail": b["plan_detail"],
                "after_plan_detail": a["plan_detail"],
            }
        )

    result["candidate_indexes"] = [
        {
            "name": name,
            "ddl": ddl,
            "targets": list(targets),
            "status": index_status[name],
        }
        for name, ddl, targets in CANDIDATE_INDEXES
    ]
    return result


def print_report(result: dict[str, Any]) -> None:
    print("DB query microbenchmark - in-memory SQLite only (no user DB access)")
    print(f"volumes: {result['volumes']}")
    print(f"timed iterations: {result['iterations']} (warmup {result['warmup']})")
    print()
    header = (
        f"{'query':32} {'rows':>7} {'p50 before':>10} {'p95 before':>10} {'plan (before)':38} "
        f"{'p50 after':>9} {'plan (after)':38} {'status':16} {'x':>8}"
    )
    print(header)
    print("-" * len(header))
    for row in result["queries"]:
        speedup = "n/a" if row["p50_speedup"] is None else str(row["p50_speedup"])
        print(
            f"{row['id']:32} {row['rows']:>7} {row['before_p50_ms']:>10.3f} {row['before_p95_ms']:>10.3f} "
            f"{row['before_plan'][:38]:38} {row['after_p50_ms']:>9.3f} {row['after_plan'][:38]:38} "
            f"{row['comparison']:16} {speedup:>8}"
        )
    print()
    print("Candidate index status (already-present = declared in the model, in both DBs, no gain claimed):")
    for idx in result["candidate_indexes"]:
        print(f"  {idx['name']:40} {idx['status']:16} -> {', '.join(idx['targets'])}")
    print()
    print("Source call sites:")
    for row in result["queries"]:
        print(f"  {row['id']:32} {row['source']:44} {row['note']}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", action="store_true", help="print the human-readable report (default)")
    parser.add_argument("--json", action="store_true", help="print machine-readable JSON")
    parser.add_argument("--iterations", type=int, default=ITERATIONS)
    parser.add_argument("--warmup", type=int, default=WARMUP)
    args = parser.parse_args()

    result = run_report(iterations=args.iterations, warmup=args.warmup)
    if args.json:
        print(json.dumps(result, indent=2, default=str))
    else:
        print_report(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
