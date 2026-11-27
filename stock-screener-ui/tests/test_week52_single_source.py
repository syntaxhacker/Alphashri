"""Structural guards against a second 52W implementation creeping back in.

These are static/identity checks, not snapshots: they fail when 52W env reads,
definitions, cache keys or persistence logic reappear outside the canonical
``trading/week52`` package.
"""
from __future__ import annotations

import ast
import importlib
import io
import tokenize
from dataclasses import fields
from pathlib import Path

import pytest

import cache.week52 as cache_week52
from trading import week52_job_status, week52_range_lookup
from trading.week52 import config as canonical_config
from trading.week52 import defaults as canonical_defaults
from trading.week52 import job as canonical_job
from trading.week52 import keys as canonical_keys
from trading.week52 import math as canonical_math
from trading.week52 import ranges as canonical_ranges
from trading.week52 import upsert as canonical_upsert

PROJECT_ROOT = Path(__file__).resolve().parents[1]

CONFIG_PATH = "trading/week52/config.py"
ENV_PREFIXES = ("SCREENER_52W_", "SCREENER_TOUCH_", "SCREENER_RETEST_")
PRODUCTION_PATHS = ("api", "trading", "cache", "scripts", "api_server_fastapi.py", "config.py")

CANONICAL_DEFS = {
    "get_52w_range": ("trading/week52/ranges.py", "trading.week52.ranges"),
    "load_all_52w_ranges": ("trading/week52/ranges.py", "trading.week52.ranges"),
    "is_job_stale": ("trading/week52/job.py", "trading.week52.job"),
    "job_age_sec": ("trading/week52/job.py", "trading.week52.job"),
    "upsert_52w_ranges": ("trading/week52/upsert.py", "trading.week52.upsert"),
}

SHIM_EXPORTS = {
    "trading/week52_range_lookup.py": {
        "get_52w_range": "get_52w_range",
        "load_all_52w_ranges": "load_all_52w_ranges",
        "_sanitize_52w_range_entry": "sanitize_entry",
        "_sanitize_52w_ranges_bulk": "sanitize_bulk",
        "SessionLocal": "SessionLocal",
    },
    "trading/week52_job_status.py": {
        "JOB_STATUS_KEY": "JOB_STATUS_KEY",
        "JOB_STATUS_TTL": "JOB_STATUS_TTL",
        "STALE_DEFAULT_SEC": "STALE_DEFAULT_SEC",
        "get_job_status": "get_job_status",
        "set_job_status": "set_job_status",
        "start_job": "start_job",
        "update_job_progress": "update_job_progress",
        "finish_job": "finish_job",
        "complete_job": "complete_job",
        "fail_job": "fail_job",
        "get_stale_threshold_sec": "get_stale_threshold_sec",
        "is_job_stale": "is_job_stale",
        "job_age_sec": "job_age_sec",
    },
}

SCREENER_EXPORTS = {
    "PROFILES_WITH_52W_BUCKETS": canonical_config,
    "STALE_52W_BREAKOUT_PCT": canonical_config,
    "exclude_etfs_from_screener": canonical_config,
    "min_52w_turnover_cr": canonical_config,
    "min_52w_volume_m": canonical_config,
    "retest_window_days": canonical_config,
    "touch_eps_pct": canonical_config,
    "touched_52w_gap_threshold_pct": canonical_config,
    "classify_approach": canonical_math,
    "gap_pct_to_52w_high": canonical_math,
    "has_live_data": canonical_math,
    "is_likely_etf": canonical_math,
    "is_plausible_52w_gap": canonical_math,
    "is_within_52w_touch_gap": canonical_math,
}

BANNED_ORCHESTRATOR_NAMES = {
    "compute_52w_ranges_task",
    "is_52w_batch_stale",
    "_52w_task",
    "_persist_52w_ranges_to_db",
    "_store_52w_ranges_in_redis",
    "_52W_RANGE_CACHE_TTL",
}


def _source(rel: str) -> str:
    return (PROJECT_ROOT / rel).read_text(encoding="utf-8")


def _tree(rel: str) -> ast.Module:
    return ast.parse(_source(rel), filename=rel)


def _production_modules() -> list[tuple[str, Path]]:
    """Production Python modules owned by the 52W duplication surface."""
    modules: list[tuple[str, Path]] = []
    for rel in PRODUCTION_PATHS:
        path = PROJECT_ROOT / rel
        if path.is_file():
            modules.append((rel, path))
            continue
        for file in sorted(path.rglob("*.py")):
            parts = file.relative_to(PROJECT_ROOT).parts
            if {"tests", "experiments", "__pycache__"} & set(parts):
                continue
            modules.append(("/".join(parts), file))
    return modules


def _is_environ(node: ast.AST) -> bool:
    return (
        isinstance(node, ast.Attribute)
        and node.attr == "environ"
        and isinstance(node.value, ast.Name)
        and node.value.id == "os"
    )


def _env_literal_names(tree: ast.AST) -> set[str]:
    """Literal SCREENER_{52W,TOUCH,RETEST}_* names read via os.environ/getenv."""
    names: set[str] = set()

    def capture(arg: ast.AST | None) -> None:
        if (
            isinstance(arg, ast.Constant)
            and isinstance(arg.value, str)
            and arg.value.startswith(ENV_PREFIXES)
        ):
            names.add(arg.value)

    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            # Any literal 52W env name passed to a call is a read, whether via
            # os.getenv/os.environ.get or a repo-local _env_float/_env_int helper.
            capture(node.args[0] if node.args else None)
        elif isinstance(node, ast.Subscript) and _is_environ(node.value):
            capture(node.slice)
    return names


def _imported_from(tree: ast.AST, module: str) -> set[str]:
    return {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module == module
        for alias in node.names
    }


def _definitions(tree: ast.AST) -> dict[str, ast.FunctionDef | ast.AsyncFunctionDef]:
    return {
        node.name: node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }


def _names_in(node: ast.AST) -> set[str]:
    return {child.id for child in ast.walk(node) if isinstance(child, ast.Name)}


def _delegates_to(tree: ast.AST, func, canonical_name: str, canonical_module: str) -> bool:
    """A permitted wrapper only imports and calls the canonical implementation."""
    aliases = {
        alias.asname or alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module == canonical_module
        for alias in node.names
        if alias.name == canonical_name
    }
    # A route may hand the canonical callable to asyncio.to_thread instead of
    # calling it directly, so reference (not just Call) is the delegation proof.
    return any(isinstance(node, ast.Name) and node.id in aliases for node in ast.walk(func))


class TestEnvReads:
    def test_canonical_config_owns_env_reads(self):
        assert _env_literal_names(_tree(CONFIG_PATH)), (
            f"{CONFIG_PATH} should contain the canonical SCREENER_52W_* env reads"
        )

    def test_no_literal_52w_env_read_outside_config(self):
        offenders = {}
        for rel, _ in _production_modules():
            if rel == CONFIG_PATH:
                continue
            found = _env_literal_names(_tree(rel))
            if found:
                offenders[rel] = sorted(found)
        assert not offenders, f"52W env reads outside {CONFIG_PATH}: {offenders}"


class TestCanonicalDefinitions:
    def test_canonical_modules_define_every_shared_object(self):
        for name, (rel, _) in CANONICAL_DEFS.items():
            assert name in _definitions(_tree(rel)), f"{name} missing from {rel}"

    def test_no_duplicate_definition_outside_canonical_modules(self):
        duplicates = []
        for rel, _ in _production_modules():
            tree = _tree(rel)
            for name in set(_definitions(tree)) & set(CANONICAL_DEFS):
                expected_rel, module = CANONICAL_DEFS[name]
                if rel == expected_rel:
                    continue
                # Thin route/wrapper delegation is allowed; a second body is not.
                if _delegates_to(tree, _definitions(tree)[name], name, module):
                    continue
                duplicates.append(f"{rel}:{name}")
        assert not duplicates, f"duplicate 52W definitions: {sorted(duplicates)}"


class TestPackageExports:
    def test_defaults_and_upsert_are_reexported_by_identity(self):
        pkg = importlib.import_module("trading.week52")
        expected = {
            "ChaserDefaults": canonical_defaults.ChaserDefaults,
            "TargetDefaults": canonical_defaults.TargetDefaults,
            "upsert_52w_ranges": canonical_upsert.upsert_52w_ranges,
        }
        assert set(expected) <= set(pkg.__all__)
        for name, obj in expected.items():
            assert getattr(pkg, name) is obj

    def test_dead_scheduler_wait_reader_is_gone(self):
        assert "batch_max_wait_sec" not in canonical_config.__all__
        assert not hasattr(canonical_config, "batch_max_wait_sec")


class TestShims:
    @pytest.mark.parametrize("rel", sorted(SHIM_EXPORTS))
    def test_shim_has_no_definitions_or_env_reads(self, rel):
        tree = _tree(rel)
        assert not _definitions(tree), f"{rel} must be a pure re-export shim"
        assert not any(isinstance(node, ast.ClassDef) for node in ast.walk(tree))
        assert not any(isinstance(node, ast.Lambda) for node in ast.walk(tree))
        assert not _env_literal_names(tree)

    @pytest.mark.parametrize("rel,exports", sorted(SHIM_EXPORTS.items()))
    def test_shim_exports_are_the_canonical_objects(self, rel, exports):
        module_name = rel[: -len(".py")].replace("/", ".")
        shim = importlib.import_module(module_name)
        canonical = importlib.import_module(
            "trading.week52." + ("job" if "job_status" in rel else "ranges")
        )
        assert set(shim.__all__) == set(exports), f"unmapped shim export in {rel}"
        for exported, canonical_name in exports.items():
            assert getattr(shim, exported) is getattr(canonical, canonical_name), (
                f"{module_name}.{exported} is no longer the canonical object"
            )


class TestCacheConsumer:
    def test_imports_come_from_canonical_modules(self):
        tree = _tree("cache/week52.py")
        assert {"cache_ttl_sec"} <= _imported_from(tree, "trading.week52.config")
        assert {"BULK", "RANGE_TTL", "PAPER_52W_CACHE_DIR"} <= _imported_from(
            tree, "trading.week52.keys"
        )
        assert {"sanitize_bulk", "sanitize_entry"} <= _imported_from(
            tree, "trading.week52.ranges"
        )

    def test_reexports_and_constants_match_canonical(self):
        assert cache_week52.cache_ttl_sec is canonical_config.cache_ttl_sec
        assert cache_week52.sanitize_bulk is canonical_ranges.sanitize_bulk
        assert cache_week52.sanitize_entry is canonical_ranges.sanitize_entry
        assert cache_week52.BULK == canonical_keys.BULK == "52w_range:all"
        assert cache_week52.RANGE_TTL == canonical_keys.RANGE_TTL == 86400
        assert cache_week52.PAPER_52W_CACHE_DIR == canonical_keys.PAPER_52W_CACHE_DIR

    @pytest.mark.parametrize("func_name", ["get_52w_range", "load_all_52w_ranges"])
    def test_range_lookups_read_the_bulk_key(self, func_name):
        func = _definitions(_tree("trading/week52/ranges.py"))[func_name]
        names = _names_in(func)
        assert "BULK" in names, f"{func_name} must read the single bulk key"
        assert "per_symbol" not in names, f"{func_name} reintroduced a per-symbol key"
        strings = {
            node.value
            for node in ast.walk(func)
            if isinstance(node, ast.Constant) and isinstance(node.value, str)
        }
        strings.discard(ast.get_docstring(func, clean=False))
        assert not [value for value in strings if "52w_range:" in value], (
            f"{func_name} hardcodes a range key instead of using BULK"
        )


class TestSingleUpsert:
    @pytest.mark.parametrize(
        "rel,wrapper",
        [
            ("scripts/compute_52w_ranges_upstox.py", "persist_ranges"),
            ("scripts/sync_refresh_assets.py", "apply_52w_data"),
        ],
    )
    def test_wrappers_delegate_by_source(self, rel, wrapper):
        tree = _tree(rel)
        assert "upsert_52w_ranges" in _imported_from(tree, "trading.week52.upsert")
        func = _definitions(tree)[wrapper]
        calls = [
            node
            for node in ast.walk(func)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "upsert_52w_ranges"
        ]
        assert len(calls) == 1, f"{rel}:{wrapper} must call upsert_52w_ranges once"
        attributes = {
            node.attr for node in ast.walk(func) if isinstance(node, ast.Attribute)
        }
        assert not attributes & {
            "add", "commit", "query", "delete", "rollback", "flush", "merge"
        }, f"{rel}:{wrapper} reintroduced duplicate DB-write logic"
        assert "Stock52WeekRange" not in _names_in(func)

    def test_wrappers_call_the_canonical_upsert(self, monkeypatch):
        from scripts import compute_52w_ranges_upstox as batch
        from scripts import sync_refresh_assets as sync

        assert batch.upsert_52w_ranges is canonical_upsert.upsert_52w_ranges
        assert sync.upsert_52w_ranges is canonical_upsert.upsert_52w_ranges

        calls = []

        def spy(factory, symbols, **kwargs):
            calls.append((factory, symbols, kwargs))
            return (1, 2)

        monkeypatch.setattr(batch, "upsert_52w_ranges", spy)
        monkeypatch.setattr(sync, "upsert_52w_ranges", spy)

        payload = {"AAA": {"high": 2.0, "low": 1.0, "close": 1.5}}
        factory = lambda: None
        assert batch.persist_ranges(payload, redis=False) == (1, 2)
        assert sync.apply_52w_data(factory, {"symbols": payload}) == (1, 2)
        assert len(calls) == 2
        assert calls[0] == (batch.SessionLocal, payload, {})
        assert calls[1] == (factory, payload, {})


class TestOrchestration:
    def test_fastapi_has_no_duplicate_orchestrator(self):
        source = _source("api_server_fastapi.py")
        tokens = {
            tok.string
            for tok in tokenize.generate_tokens(io.StringIO(source).readline)
            if tok.type == tokenize.NAME
        }
        assert not tokens & BANNED_ORCHESTRATOR_NAMES

    def test_admin_route_uses_canonical_config_and_job(self):
        tree = _tree("api/admin_routes.py")
        imports = {
            (node.module, frozenset(alias.name for alias in node.names))
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom) and node.module
        }
        assert any(
            module == "trading.week52" and "config" in names for module, names in imports
        )
        assert any(module == "trading.week52.job" for module, _ in imports)
        assert any(
            isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id == "config"
            for node in ast.walk(tree)
        ), "admin route must read thresholds through trading.week52.config"
        assert not _env_literal_names(tree), "admin route reads a 52W env var directly"


class TestScreenerCompat:
    def test_screener_models_imports_canonical_names(self):
        tree = _tree("api/screener_api/screener_models.py")
        for module in (canonical_config.__name__, canonical_math.__name__):
            expected = {name for name, obj in SCREENER_EXPORTS.items() if obj.__name__ == module}
            assert expected <= _imported_from(tree, module)

    def test_screener_models_has_no_duplicate_bodies(self):
        defs = _definitions(_tree("api/screener_api/screener_models.py"))
        assert not defs.keys() & set(SCREENER_EXPORTS)
        math_fragments = ("52w", "gap", "touch", "classify", "etf", "approach", "plausible")
        duplicated = [name for name in defs if any(part in name.lower() for part in math_fragments)]
        assert not duplicated, f"duplicate 52W math in screener_models: {duplicated}"

    def test_screener_models_reexports_by_identity(self):
        from api.screener_api import screener_models

        for name, canonical in SCREENER_EXPORTS.items():
            assert getattr(screener_models, name) is getattr(canonical, name), (
                f"screener_models.{name} is no longer a canonical re-export"
            )


class TestDefaults:
    CANONICAL_PATH = "trading/week52/defaults.py"
    PARITY_TEST = "tests/test_week52_defaults_parity.py"
    CONSUMERS = {
        "trading/week52_chaser_signals.py": "ChaserDefaults",
        "trading/week52_target_signals.py": "TargetDefaults",
        "backtest/strategies/week52_chaser.py": "ChaserDefaults",
        "backtest/strategies/week52_target.py": "TargetDefaults",
    }

    def test_canonical_module_and_ts_parity_test_exist(self):
        assert (PROJECT_ROOT / self.CANONICAL_PATH).is_file()
        parity = _source(self.PARITY_TEST)
        assert self.CANONICAL_PATH in parity
        assert "ChaserDefaults" in parity

    def test_python_defaults_are_populated(self):
        for dataclass in (canonical_defaults.ChaserDefaults, canonical_defaults.TargetDefaults):
            populated = {field.name: getattr(dataclass, field.name) for field in fields(dataclass)}
            assert populated and all(value is not None for value in populated.values())

    @pytest.mark.parametrize("rel,dataclass", sorted(CONSUMERS.items()))
    def test_consumers_reference_the_canonical_defaults(self, rel, dataclass):
        tree = _tree(rel)
        assert "trading.week52.defaults" in {
            node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)
        }
        assert dataclass in _names_in(tree)


class TestDocs:
    def test_architecture_doc_names_the_canonical_modules(self):
        doc = _source("docs/WEEK52_SINGLE_SOURCE.md")
        for module in ("config", "math", "ranges", "job", "keys", "upsert", "defaults"):
            assert f"trading/week52/{module}.py" in doc, (
                f"docs/WEEK52_SINGLE_SOURCE.md no longer names trading/week52/{module}.py"
            )
