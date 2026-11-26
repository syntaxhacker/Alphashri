"""Structural contract for the in-memory DB benchmark harness.

No timings are asserted here: wall-clock numbers are reported by the script,
not gated by a test. These checks keep the query catalogue honest (real call
sites, no agri paths, no accidental real-DB access).
"""
from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

_REPO = Path(__file__).resolve().parents[2]
_MODULE_PATH = _REPO / "scripts" / "perf" / "db_query_bench.py"


@pytest.fixture(scope="module")
def bench():
    spec = importlib.util.spec_from_file_location("db_query_bench", _MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # dataclasses resolve annotations via sys.modules
    spec.loader.exec_module(module)
    return module


def _source_text() -> str:
    return _MODULE_PATH.read_text(encoding="utf-8")


def test_harness_is_in_memory_only(bench):
    assert bench.IN_MEMORY_URL == "sqlite:///:memory:"
    assert "sqlite:///:memory:" in _source_text()
    # The real 185 MB user DB must never be named in the harness.
    assert "alphashri.db" not in _source_text().lower()


def test_query_catalogue_shape(bench):
    queries = bench.build_queries()
    assert len(queries) >= 15
    ids = [q.id for q in queries]
    assert len(ids) == len(set(ids))

    for query in queries:
        assert re.fullmatch(r"[a-z0-9_]+", query.id)
        assert query.sql.lstrip().upper().startswith("SELECT ")
        assert ";" not in query.sql  # no stacked statements
        assert isinstance(query.params, tuple)
        assert re.fullmatch(r"api/[^\s:]+\.py:\d+(,\d+)?", query.source), query.source
        for token in bench.AGRI_TOKENS:
            assert token not in query.sql.lower()
            assert token not in query.source.lower()


def test_source_call_sites_exist(bench):
    for query in bench.build_queries():
        relative = query.source.split(":")[0]
        assert (_REPO / relative).is_file(), relative


def test_catalogue_covers_the_audited_paths(bench):
    ids = {q.id for q in bench.build_queries()}
    assert {
        "trade_history",
        "positions_by_bot",
        "positions_by_user",
        "positions_symbols_by_user",
        "dashboard_analytics_projection",
        "bot_runtime_by_bot",
        "user_saved_config_get",
        "replay_configs_list",
        "instruments_by_segment",
        "instrument_key_lookup",
        "stock52_recent_touches",
    } <= ids


def test_candidate_indexes_are_additive_only(bench):
    queries = {q.id for q in bench.build_queries()}
    assert len(bench.CANDIDATE_INDEXES) >= 3
    names = [name for name, _ddl, _targets in bench.CANDIDATE_INDEXES]
    assert len(names) == len(set(names))

    for name, ddl, targets in bench.CANDIDATE_INDEXES:
        assert ddl.startswith("CREATE INDEX ")
        assert name in ddl
        assert "DROP " not in ddl.upper()
        assert "DELETE " not in ddl.upper()
        assert targets
        assert set(targets) <= queries


def test_percentile_is_deterministic(bench):
    assert bench.percentile([0, 10, 20, 30], 0.5) == 15
    assert bench.percentile([1], 0.95) == 1
    assert bench.percentile([5, 5, 5], 0.5) == 5
    assert bench.percentile([0, 10], 0.25) == 2.5
    with pytest.raises(ValueError):
        bench.percentile([], 0.5)
    with pytest.raises(ValueError):
        bench.percentile([1, 2], 1.5)


def test_plan_kind_classification(bench):
    assert bench.plan_kind(
        ["SEARCH trades USING INDEX ix_trades_user_test_exit_time"]
    ) == {"kind": "search", "index": "ix_trades_user_test_exit_time", "temp_b_tree": False}

    assert bench.plan_kind(["SCAN instruments"]) == {
        "kind": "scan",
        "index": None,
        "temp_b_tree": False,
    }

    assert bench.plan_kind(
        ["SEARCH t USING COVERING INDEX ix_cover", "USE TEMP B-TREE FOR ORDER BY"]
    ) == {"kind": "search", "index": "ix_cover", "temp_b_tree": True}

    assert bench.plan_kind(
        ["SEARCH bot_configs USING INTEGER PRIMARY KEY (rowid=?)"]
    )["index"] == "INTEGER PRIMARY KEY"


def test_no_agri_module_is_imported():
    # Other test modules import the FastAPI app, which legitimately registers
    # agri routers. Inspecting this process's sys.modules would be
    # order-dependent, so import only the harness in a fresh interpreter.
    child = (
        "import importlib.util, json, sys\n"
        "spec = importlib.util.spec_from_file_location('db_query_bench', sys.argv[1])\n"
        "module = importlib.util.module_from_spec(spec)\n"
        "sys.modules[spec.name] = module\n"
        "spec.loader.exec_module(module)\n"
        "print(json.dumps({\n"
        "    'harness_loaded': hasattr(module, 'build_queries'),\n"
        "    'agri': sorted(n for n in sys.modules if n.startswith('api.agri')),\n"
        "}))\n"
    )
    completed = subprocess.run(
        [sys.executable, "-c", child, str(_MODULE_PATH)],
        capture_output=True,
        text=True,
        check=True,
        timeout=60,
    )
    result = json.loads(completed.stdout.strip().splitlines()[-1])
    assert result["harness_loaded"] is True
    assert result["agri"] == []
