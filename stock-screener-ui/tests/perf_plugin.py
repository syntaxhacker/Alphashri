"""Low-overhead pytest timing recorder (opt-in via ``PERF_TIMINGS_JSON``).

Load it explicitly with ``-p tests.perf_plugin``. It records, for every test:

* setup / call / teardown durations (pytest already measures these per phase),
* final status (passed / failed / skipped / error),
* node id, file, and the marker names attached at collection time,

plus an aggregate over the ``pytest_fixture_setup`` phase (count / total / max
per fixture). It writes one compact JSON document at session end.

Design notes
------------
* Nothing happens unless ``PERF_TIMINGS_JSON`` is set. When the plugin is
  loaded without that env var the hooks are effectively no-ops, so adding
  ``-p tests.perf_plugin`` to an unrelated run changes nothing.
* With xdist, pytest workers do not run tests on the controller; instead every
  worker report is forwarded to the controller's ``pytest_runtest_logreport``
  hook (verified against xdist 3.8 ``dsession.worker_testreport``). Therefore
  collection/writing happens only in the controller process (workers are
  identified by ``PYTEST_XDIST_WORKER``) and there is a single writer, so shards
  never clobber each other.
* Timing uses ``report.duration`` (pytest's own measurement) except for the two
  wrapper hooks, which take one ``perf_counter()`` pair each. The per-fixture
  wrapper is active only in the instrumented run. The file is written once,
  atomically, with compact JSON.
* No pytest options, markers, or collection filters are added; test behaviour
  and pass/fail outcomes are untouched.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Dict

import pytest

_state: Dict[str, Any] = {
    "enabled": False,
    "path": None,
    "start": 0.0,
    "collection_duration": 0.0,
    "tier": "",
    "marker_expr": "",
    "shard": "",
    "total_shards": "",
    "xdist_workers": 0,
    "tests": {},     # nodeid -> per-test record
    "fixtures": {},  # fixture argname -> {count, total, max}
    "markers": {},   # nodeid -> [marker name, ...]
}


def pytest_configure(config: pytest.Config) -> None:
    """Enable recording only when explicitly requested and on the controller."""
    path = os.environ.get("PERF_TIMINGS_JSON")
    if not path or os.environ.get("PYTEST_XDIST_WORKER"):
        return
    _state["enabled"] = True
    _state["path"] = path
    _state["start"] = time.perf_counter()
    _state["xdist_workers"] = int(getattr(config.option, "numprocesses", 0) or 0)
    _state["tier"] = os.environ.get("PERF_TIER", "")
    _state["marker_expr"] = os.environ.get("PERF_MARKER_EXPR", "")
    _state["shard"] = os.environ.get("PERF_SHARD", "")
    _state["total_shards"] = os.environ.get("PERF_TOTAL_SHARDS", "")


@pytest.hookimpl(hookwrapper=True)
def pytest_collection(session: pytest.Session):
    """Time the (controller-side) collection phase without altering it."""
    if not _state["enabled"]:
        yield
        return
    start = time.perf_counter()
    yield
    _state["collection_duration"] = time.perf_counter() - start


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    """Remember marker names per node id so slow/unmarked tests can be flagged."""
    if not _state["enabled"]:
        return
    markers = _state["markers"]
    for item in items:
        markers[item.nodeid] = [mark.name for mark in item.iter_markers()]


@pytest.hookimpl(hookwrapper=True)
def pytest_fixture_setup(fixturedef, request):
    """Aggregate fixture setup cost (only in an instrumented run)."""
    if not _state["enabled"]:
        yield
        return
    start = time.perf_counter()
    outcome = yield
    elapsed = time.perf_counter() - start
    # pluggy re-raises any exception from the inner hooks when the wrapper
    # finishes, so we do not need to call outcome.get_result() here.
    agg = _state["fixtures"].setdefault(
        fixturedef.argname, {"count": 0, "total": 0.0, "max": 0.0}
    )
    agg["count"] += 1
    agg["total"] += elapsed
    if elapsed > agg["max"]:
        agg["max"] = elapsed


def pytest_runtest_logreport(report: pytest.TestReport) -> None:
    """Accumulate the three phase reports pytest emits for each test."""
    if not _state["enabled"]:
        return
    nodeid = report.nodeid
    rec = _state["tests"].get(nodeid)
    if rec is None:
        rec = {
            "nodeid": nodeid,
            "file": nodeid.split("::", 1)[0],
            "name": nodeid.rsplit("::", 1)[-1] if "::" in nodeid else nodeid,
            "status": "passed",
            "setup": 0.0,
            "call": 0.0,
            "teardown": 0.0,
            "markers": _state["markers"].get(nodeid, []),
        }
        _state["tests"][nodeid] = rec

    when = report.when
    if when in ("setup", "call", "teardown"):
        rec[when] = round(float(getattr(report, "duration", 0.0) or 0.0), 6)

    outcome = report.outcome
    if when == "setup":
        if outcome == "skipped":
            rec["status"] = "skipped"
        elif outcome == "failed":
            rec["status"] = "error"
    elif when == "call":
        rec["status"] = outcome
    elif when == "teardown" and outcome == "failed" and rec["status"] == "passed":
        rec["status"] = "error"


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    """Write the accumulated timings as one compact, atomically replaced JSON."""
    if not _state["enabled"]:
        return

    tests = []
    for rec in _state["tests"].values():
        rec["duration"] = round(rec["setup"] + rec["call"] + rec["teardown"], 6)
        tests.append(rec)

    fixtures = {}
    for name, agg in _state["fixtures"].items():
        count = agg["count"]
        fixtures[name] = {
            "count": count,
            "total_seconds": round(agg["total"], 6),
            "mean_ms": round(agg["total"] / count * 1000, 4) if count else 0.0,
            "max_ms": round(agg["max"] * 1000, 4),
        }

    payload = {
        "schema_version": 1,
        "generator": "tests/perf_plugin.py",
        "tier": _state["tier"],
        "marker_expr": _state["marker_expr"],
        "shard": _state["shard"],
        "total_shards": _state["total_shards"],
        "xdist_workers": _state["xdist_workers"],
        "collection_seconds": round(_state["collection_duration"], 6),
        "wall_seconds": round(time.perf_counter() - _state["start"], 6),
        "tests": tests,
        "fixtures": fixtures,
    }

    path = Path(_state["path"])
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(
        json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    os.replace(tmp, path)
