"""Filesystem-only tests for the changed-test mapper.

A fake project tree stands in for the repo: no git, no pytest, no network.
"""

from __future__ import annotations

import pytest

from scripts.test import run_changed as runner


@pytest.fixture
def project(tmp_path):
    files = {
        "api/__init__.py": "",
        "api/replay_api.py": (
            "from fastapi import APIRouter\n"
            "router = APIRouter()\n"
            "@router.get('/replay')\n"
            "def replay():\n    pass\n"
        ),
        "api/value_scan/__init__.py": "",
        "api/value_scan/cache.py": "def get():\n    return None\n",
        "api/value_scan/router.py": (
            "from fastapi import APIRouter\n"
            "router = APIRouter()\n"
            "@router.get('/value')\n"
            "def scan():\n    pass\n"
        ),
        "db/models.py": "from sqlalchemy.orm import declarative_base\nBase = declarative_base()\n",
        "tests/test_replay_api.py": "def test_exact_root():\n    pass\n",
        "tests/api/test_replay_api.py": "def test_exact_api():\n    pass\n",
        "tests/api/test_value_scan/test_cache_singleflight.py": (
            "from api.value_scan import cache as cache_module\n"
            "def test_cache():\n    assert cache_module\n"
        ),
        "tests/api/test_value_scan/test_router.py": (
            "from unittest.mock import patch\n"
            "@patch('api.value_scan.router.fetch')\n"
            "def test_router(mock_fetch):\n    pass\n"
        ),
        "tests/contract/test_openapi_sync.py": "def test_schema():\n    pass\n",
        "tests/integration/test_slow.py": "def test_slow():\n    pass\n",
        "tests/test_news_integration.py": "def test_root_integration():\n    pass\n",
        "tests/test_unrelated.py": "def test_unrelated():\n    pass\n",
    }
    for rel, content in files.items():
        path = tmp_path / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    return tmp_path


def test_normalize_path_strips_repo_prefix_and_rejects_outside(tmp_path):
    assert (
        runner.normalize_path("stock-screener-ui/api/replay_api.py", "stock-screener-ui")
        == "api/replay_api.py"
    )
    assert runner.normalize_path("./api//replay_api.py", "stock-screener-ui") == "api/replay_api.py"
    assert runner.normalize_path("../secret.py", "stock-screener-ui") is None
    assert runner.normalize_path("/etc/passwd", "stock-screener-ui") is None
    project = tmp_path / "project"
    assert runner.to_relative(str(project / "api" / "x.py"), project) == "api/x.py"
    assert runner.to_relative(str(tmp_path / "outside.py"), project) is None


def test_exact_stem_maps_both_test_locations(project):
    selection = runner.select_tests(["api/replay_api.py"], project)
    assert "tests/test_replay_api.py" in selection.tests
    assert "tests/api/test_replay_api.py" in selection.tests
    assert any("exact stem" in reason for reason in selection.reasons["tests/test_replay_api.py"])
    assert runner.CONTRACT_TEST in selection.forced


def test_grep_style_importers_and_patch_targets(project):
    selection = runner.select_tests(["api/value_scan/cache.py"], project)
    assert "tests/api/test_value_scan/test_cache_singleflight.py" in selection.tests
    assert runner.CONTRACT_TEST not in selection.forced

    selection = runner.select_tests(["api/value_scan/router.py"], project)
    assert "tests/api/test_value_scan/test_router.py" in selection.tests
    assert runner.CONTRACT_TEST in selection.forced


def test_package_init_fans_out_to_that_packages_tests(project):
    selection = runner.select_tests(["api/value_scan/__init__.py"], project)
    assert "tests/api/test_value_scan/test_cache_singleflight.py" in selection.tests
    assert "tests/api/test_value_scan/test_router.py" in selection.tests
    assert any(
        "package init" in reason
        for reason in selection.reasons["tests/api/test_value_scan/test_router.py"]
    )


def test_api_route_and_model_changes_force_openapi_contract(project):
    assert runner.is_api_contract_relevant("api/value_scan/router.py", project)
    assert runner.is_api_contract_relevant("db/models.py", project)
    assert runner.is_api_contract_relevant("openapi.yaml", project)
    assert not runner.is_api_contract_relevant("api/value_scan/cache.py", project)

    for changed in ("api/value_scan/router.py", "db/models.py", "openapi.yaml"):
        selection = runner.select_tests([changed], project)
        assert runner.CONTRACT_TEST in selection.forced
        assert runner.CONTRACT_TEST not in selection.tests

    combined = runner.select_tests(
        ["api/replay_api.py", "api/value_scan/router.py", "db/models.py"], project
    )
    assert combined.forced == [runner.CONTRACT_TEST]


def test_heavy_test_paths_are_skipped(project):
    selection = runner.select_tests(
        ["tests/integration/test_slow.py", "tests/test_news_integration.py"], project
    )
    assert selection.empty
    assert "tests/integration/test_slow.py" in selection.skipped
    assert "tests/test_news_integration.py" in selection.skipped


def test_changed_test_file_is_selected_directly(project):
    selection = runner.select_tests(["tests/test_unrelated.py"], project)
    assert selection.tests == ["tests/test_unrelated.py"]
    assert "changed test file" in selection.reasons["tests/test_unrelated.py"]


def test_empty_selection_falls_back_to_full_fast_tier(project):
    selection = runner.select_tests(["src/ui/button.tsx"], project)
    assert selection.empty
    filled = runner.full_fallback(selection, project)
    assert "tests/test_unrelated.py" in filled.tests
    assert "tests/test_replay_api.py" in filled.tests
    assert "tests/integration/test_slow.py" not in filled.tests
    assert runner.CONTRACT_TEST not in filled.tests


def test_jobs_are_capped_to_available_and_four(monkeypatch):
    monkeypatch.setattr(runner, "available_cores", lambda: 8)
    assert runner.cap_jobs() == 4
    assert runner.cap_jobs(16) == 8
    monkeypatch.setattr(runner, "available_cores", lambda: 2)
    assert runner.cap_jobs() == 2
    assert runner.cap_jobs(0) == 1


def test_command_applies_ci_marker_and_runs_contract_without_it():
    command = runner.build_command(["tests/test_unrelated.py"], 2)
    assert "-m" in command and runner.DEFAULT_MARKER in command
    assert ["-n", "2"] == command[command.index("-n") : command.index("-n") + 2]
    forced = runner.build_command([runner.CONTRACT_TEST], 2, force=True)
    assert runner.DEFAULT_MARKER not in forced
    assert forced[-1] == runner.CONTRACT_TEST
