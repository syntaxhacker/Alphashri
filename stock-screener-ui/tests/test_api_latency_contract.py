"""Static contract for the API latency budget file and benchmark helpers.

No live server and no app import: these tests catch a renamed route, a silently
changed target, a malformed budget document and a broken percentile/verdict
helper. Wall-clock timings are deliberately NOT asserted here -- they belong in
``scripts/bench_api.py`` reports and vary with CI load.

Run with:
    .venv/bin/python -m pytest tests/test_api_latency_contract.py -q
"""

from __future__ import annotations

import copy
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import bench_api  # noqa: E402

pytestmark = pytest.mark.contract

EXPECTED_ROUTES = {
    "health": ("GET", "/api/health", 100, None, False),
    "login": ("POST", "/api/auth/login", 500, None, False),
    "agri_filters": ("GET", "/api/agri/filters", 500, 10000, False),
    "agri_prices": ("GET", "/api/agri/prices", 500, None, False),
    "nifty_report": ("GET", "/api/reports/nifty", 1000, None, False),
    "profitability": ("GET", "/api/reports/profitability", 2000, None, False),
    "market_snapshot": ("GET", "/api/market/snapshot", 2000, None, True),
    "replay_configs": ("GET", "/api/replay/configs", 500, None, True),
}


@pytest.fixture(scope="module")
def doc():
    return bench_api.load_budgets()


@pytest.fixture(scope="module")
def specs(doc):
    return bench_api.parse_routes(doc)


class TestBudgetDocument:
    def test_file_is_valid_and_route_list_is_exact(self, doc):
        assert doc["schema_version"] == 1
        assert set(doc["routes"]) == set(EXPECTED_ROUTES)
        assert bench_api.validate_budgets(doc) == []

    def test_defaults_match_harness_protocol(self, doc):
        assert doc["defaults"] == {
            "warmups": 5,
            "iterations": 30,
            "warn_factor": 1.25,
            "percentiles": [50, 95, 99],
        }

    @pytest.mark.parametrize("name,expected", sorted(EXPECTED_ROUTES.items()))
    def test_route_shape_and_budgets(self, specs, name, expected):
        method, path, warm, cold, auth = expected
        spec = specs[name]
        assert (spec.method, spec.path, spec.auth) == (method, path, auth)
        assert (spec.budgets_ms["warm"], spec.budgets_ms["cold"]) == (warm, cold)

    def test_agri_filters_is_the_only_route_with_a_cold_budget(self, specs):
        with_cold = {name for name, spec in specs.items() if spec.budgets_ms["cold"] is not None}
        assert with_cold == {"agri_filters"}

    def test_fixed_query_parameters_are_string_valued(self, specs):
        assert specs["agri_prices"].query == {"commodity": "onion", "range": "1m"}
        assert specs["market_snapshot"].query == {"universe": "all_equity", "limit": "100"}
        assert specs["health"].query == {}


class TestValidation:
    @pytest.mark.parametrize(
        "mutate",
        [
            lambda d: d.update(schema_version=2),
            lambda d: d.update(routes={}),
            lambda d: d["defaults"].pop("iterations"),
            lambda d: d["defaults"].update(percentiles=[50, 95]),
            lambda d: d["defaults"].update(warn_factor=0.5),
            lambda d: d["routes"]["health"].update(method="FETCH"),
            lambda d: d["routes"]["health"].update(path="api/health"),
            lambda d: d["routes"]["health"].update(query={"limit": 100}),
            lambda d: d["routes"]["login"].update(extra=True),
            lambda d: d["routes"]["health"]["budgets_ms"].update(warm=-1),
            lambda d: d["routes"]["health"]["budgets_ms"].update(cold=-5),
            lambda d: d["routes"]["replay_configs"].update(auth="yes"),
            lambda d: d["routes"]["health"].pop("cache_state"),
        ],
    )
    def test_malformed_documents_are_rejected(self, doc, mutate):
        broken = copy.deepcopy(doc)
        mutate(broken)
        assert bench_api.validate_budgets(broken), "mutation should have been detected"

    def test_load_budgets_reports_all_problems_at_once(self, tmp_path):
        target = tmp_path / "budgets.json"
        target.write_text('{"schema_version": 9, "routes": {}}', encoding="utf-8")
        with pytest.raises(ValueError) as exc:
            bench_api.load_budgets(target)
        message = str(exc.value)
        assert "schema_version" in message
        assert "routes" in message


class TestPercentilesAndVerdicts:
    def test_percentile_interpolates_and_sorts(self):
        values = [100, 10, 40, 20, 30]
        assert bench_api.percentile(values, 50) == pytest.approx(30.0)
        assert bench_api.percentile(values, 95) == pytest.approx(88.0)
        assert bench_api.percentile(values, 99) == pytest.approx(97.6)

    def test_percentile_empty_and_single(self):
        assert bench_api.percentile([], 95) is None
        assert bench_api.percentile([42.0], 95) == 42.0

    def test_percentile_rejects_out_of_range_q(self):
        with pytest.raises(ValueError):
            bench_api.percentile([1, 2], 101)

    @pytest.mark.parametrize(
        "p95,budget,expected",
        [
            (90.0, 100.0, "PASS"),
            (100.0, 100.0, "PASS"),
            (110.0, 100.0, "WARN"),
            (125.0, 100.0, "WARN"),
            (125.1, 100.0, "FAIL"),
            (50.0, None, "INFO"),
            (None, 100.0, "SKIP"),
        ],
    )
    def test_classify(self, p95, budget, expected):
        assert bench_api.classify(p95, budget, warn_factor=1.25) == expected

    def test_summarize_and_status_counts(self):
        summary = bench_api.summarize([1.0, 2.0, 3.0])
        assert summary["count"] == 3
        assert summary["p50_ms"] == pytest.approx(2.0)
        assert summary["p95_ms"] == pytest.approx(2.9)
        assert bench_api.status_counts([200, 201, 404, 500]) == {"2xx": 2, "3xx": 0, "4xx": 1, "5xx": 1}


class TestRequestConstruction:
    def test_public_route_has_no_auth_or_query(self, specs):
        method, path, kwargs = bench_api.build_request(
            specs["health"], credentials={"email": "a", "password": "b"}, token="tok"
        )
        assert (method, path) == ("GET", "/api/health")
        assert kwargs == {}

    def test_login_carries_credentials(self, specs):
        credentials = {"email": "a", "password": "b"}
        _, _, kwargs = bench_api.build_request(specs["login"], credentials=credentials, token=None)
        assert kwargs["json"] == credentials

    def test_auth_route_uses_bearer_token_and_fixed_params(self, specs):
        _, _, kwargs = bench_api.build_request(
            specs["market_snapshot"], credentials={}, token="tok"
        )
        assert kwargs["params"] == {"universe": "all_equity", "limit": "100"}
        assert kwargs["headers"] == {"Authorization": "Bearer tok"}
        _, _, without = bench_api.build_request(specs["market_snapshot"], credentials={}, token=None)
        assert "headers" not in without


class TestCliAndColdChild:
    def test_parser_defaults(self):
        args = bench_api.build_parser().parse_args(["--in-process"])
        assert args.mode == "warm"
        assert args.budgets == bench_api.BUDGETS_PATH
        assert args.enforce is False
        assert args.in_process is True

    def test_parser_flags(self):
        args = bench_api.build_parser().parse_args(
            ["--base-url", "http://localhost:8765", "--mode", "cold", "--enforce", "--route", "health"]
        )
        assert (args.base_url, args.mode, args.enforce, args.route) == (
            "http://localhost:8765", "cold", True, ["health"]
        )

    def test_password_has_no_hardcoded_default(self, monkeypatch):
        monkeypatch.delenv("BENCH_QA_PASSWORD", raising=False)
        assert bench_api.build_parser().parse_args(["--in-process"]).password is None
        monkeypatch.setenv("BENCH_QA_PASSWORD", "b")
        assert bench_api.build_parser().parse_args(["--in-process"]).password == "b"
        assert not hasattr(bench_api, "DEFAULT_PASSWORD")

    def test_missing_password_reason_is_explicit(self):
        reason = bench_api.PASSWORD_MISSING_REASON
        assert "BENCH_QA_PASSWORD" in reason
        assert "no password fallback" in reason

    def test_cold_child_omits_password_when_absent(self, monkeypatch):
        monkeypatch.delenv("BENCH_QA_PASSWORD", raising=False)
        args = bench_api.build_parser().parse_args(
            ["--in-process", "--mode", "cold", "--route", "health"]
        )
        assert "--password" not in bench_api.cold_child_command(args, "health")

    @pytest.mark.parametrize("flags", [[], ["--in-process", "--base-url", "http://x"]])
    def test_exactly_one_transport_is_required(self, flags):
        with pytest.raises(SystemExit):
            bench_api.build_parser().parse_args(flags)

    def test_cold_child_is_a_fresh_interpreter_for_one_route(self):
        args = bench_api.build_parser().parse_args(
            ["--in-process", "--mode", "cold", "--route", "health"]
        )
        command = bench_api.cold_child_command(args, "health")
        assert command[0] == sys.executable
        assert "--_cold-child" in command
        assert command[command.index("--route") + 1] == "health"
        assert "cold" in command
