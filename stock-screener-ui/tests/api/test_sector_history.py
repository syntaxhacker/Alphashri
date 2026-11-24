"""
Sector History API Tests

Tests for /api/sector/history: monthly aggregation, ranks, risk, seasonality,
persistence, transition matrix, and the endpoint contract.
"""

import sys
from pathlib import Path
from typing import Dict, List, Optional
from unittest.mock import patch

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from api.sector_history import (  # noqa: E402
    SectorHistoryResponse,
    _build_history_payload,
    _month_end_closes,
    _monthly_returns,
    _rank_frame,
    _risk_metrics,
    _seasonality,
    _sector_persistence,
    _transition_matrix,
    router,
)
from config import IST  # noqa: E402

BENCHMARK = "NIFTY 50"
SECTORS = ["NIFTY BANK", "NIFTY IT", "NIFTY FMCG"]
N_MONTHS = 36
RETURN_COUNT = N_MONTHS - 1


# ===== Synthetic data =====

def _returns(offset: float, mult: int, mod: int, shift: int) -> List[float]:
    return [float((i * mult) % mod - shift) + offset for i in range(RETURN_COUNT)]


A_RETURNS = _returns(0.3, 5, 17, 6)
B_RETURNS = _returns(0.2, 7, 13, 4)
C_RETURNS = _returns(0.1, 3, 11, 2)
BENCH_RETURNS = [float((i % 5) - 1) * 0.5 for i in range(RETURN_COUNT)]

EXPECTED_RETURNS = {
    "NIFTY BANK": A_RETURNS,
    "NIFTY IT": B_RETURNS,
    "NIFTY FMCG": C_RETURNS,
}


def _closes_from_returns(returns: List[float]) -> List[float]:
    closes = [100.0]
    for value in returns:
        closes.append(closes[-1] * (1.0 + value / 100.0))
    return closes


def _monthly_frame(closes: List[float], start: str = "2022-01") -> pd.DataFrame:
    """Daily closes whose last value in each calendar month is the target close."""
    periods = pd.period_range(start=start, periods=len(closes), freq="M")
    chunks = []
    previous = closes[0]
    for period, target in zip(periods, closes):
        days = pd.date_range(period.start_time, period.end_time.normalize(), freq="D")
        chunks.append(
            pd.DataFrame(
                {"close": np.linspace(previous, target, len(days))},
                index=days,
            )
        )
        previous = target
    return pd.concat(chunks)


@pytest.fixture(scope="module")
def synthetic_closes() -> Dict[str, pd.DataFrame]:
    return {
        BENCHMARK: _monthly_frame(_closes_from_returns(BENCH_RETURNS)),
        "NIFTY BANK": _monthly_frame(_closes_from_returns(A_RETURNS)),
        "NIFTY IT": _monthly_frame(_closes_from_returns(B_RETURNS)),
        "NIFTY FMCG": _monthly_frame(_closes_from_returns(C_RETURNS)),
    }


def _expected_ranks(returns_by_sector: Dict[str, List[float]]) -> Dict[str, List[Optional[int]]]:
    ranks: Dict[str, List[Optional[int]]] = {
        name: [None] * N_MONTHS for name in returns_by_sector
    }
    for i in range(RETURN_COUNT):
        ordered = sorted(
            returns_by_sector, key=lambda name: returns_by_sector[name][i], reverse=True
        )
        for position, name in enumerate(ordered, start=1):
            ranks[name][i + 1] = position
    return ranks


EXPECTED_RANKS = _expected_ranks(EXPECTED_RETURNS)


def _expected_seasonality(returns: List[float]) -> Dict[int, Dict[str, Optional[float]]]:
    result: Dict[int, Dict[str, Optional[float]]] = {}
    for month in range(1, 13):
        values = [
            value
            for i, value in enumerate(returns)
            if ((i + 1) % 12) + 1 == month
        ]
        if values:
            result[month] = {
                "n": float(len(values)),
                "avg": float(np.mean(values)),
                "hit": float(np.mean([value > 0 for value in values]) * 100),
            }
        else:
            result[month] = {"n": 0.0, "avg": None, "hit": None}
    return result


def _expected_persistence(ranks: List[Optional[int]]) -> Dict[str, Optional[float]]:
    top3_months = sum(1 for rank in ranks if rank is not None and rank <= 3)
    stayed = 0
    denominator = 0
    next_ranks: List[int] = []
    for i, rank in enumerate(ranks):
        if rank is None:
            continue
        if i + 1 >= len(ranks) or ranks[i + 1] is None:
            continue
        next_ranks.append(ranks[i + 1])
        if rank <= 3:
            denominator += 1
            if ranks[i + 1] <= 3:
                stayed += 1
    return {
        "top3_months": top3_months,
        "top3_stayed": stayed,
        "pct": (stayed / denominator * 100) if denominator else None,
        "avg": float(np.mean(next_ranks)) if next_ranks else None,
    }


def _expected_matrix(
    ranks_by_name: Dict[str, List[Optional[int]]], size: int = 3
) -> List[List[float]]:
    counts = np.zeros((size, size), dtype=float)
    for ranks in ranks_by_name.values():
        for i in range(len(ranks) - 1):
            current, nxt = ranks[i], ranks[i + 1]
            if current is not None and nxt is not None:
                counts[current - 1, nxt - 1] += 1
    matrix = []
    for row in counts:
        total = row.sum()
        matrix.append([round(float(value) / total * 100, 2) for value in row])
    return matrix


# ===== Monthly aggregation =====

class TestMonthlyAggregation:

    def test_month_end_closes_drops_current_month(self):
        now = pd.Timestamp.now(tz=IST)
        start = (now - pd.DateOffset(months=2)).normalize()
        index = pd.date_range(start, now, freq="D")
        series = pd.Series(np.arange(len(index), dtype=float) + 100, index=index)

        monthly = _month_end_closes(series)

        assert len(monthly) == 2
        assert monthly.index[-1] == now.to_period("M") - 1
        assert now.to_period("M") not in monthly.index

    def test_month_end_closes_groups_by_month(self):
        index = pd.date_range("2024-01-01", "2024-03-31", freq="D")
        series = pd.Series([float(day) for day in range(1, len(index) + 1)], index=index)

        monthly = _month_end_closes(series)

        assert [str(period) for period in monthly.index] == ["2024-01", "2024-02", "2024-03"]
        assert monthly.iloc[0] == series.loc["2024-01-31"]
        assert monthly.iloc[1] == series.loc["2024-02-29"]

    def test_monthly_returns_first_month_null(self):
        index = pd.period_range("2024-01", periods=3, freq="M")
        closes = pd.Series([100.0, 110.0, 121.0], index=index)

        returns = _monthly_returns(closes)

        assert returns.iloc[0] is np.nan or pd.isna(returns.iloc[0])
        assert returns.iloc[1] == pytest.approx(10.0)
        assert returns.iloc[2] == pytest.approx(10.0)

    def test_rank_frame_uses_min_method(self):
        index = pd.period_range("2024-01", periods=1, freq="M")
        returns = pd.DataFrame(
            {"A": [5.0], "B": [5.0], "C": [1.0]}, index=index
        )

        ranks = _rank_frame(returns, ["A", "B", "C"])

        assert ranks.iloc[0].tolist() == [1.0, 1.0, 3.0]


# ===== Risk =====

class TestRiskMetrics:

    def test_drawdown_and_recovery(self):
        index = pd.to_datetime(
            [
                "2024-01-01",
                "2024-01-10",
                "2024-01-20",
                "2024-01-25",
                "2024-02-10",
                "2024-02-20",
            ]
        )
        close = pd.Series([100.0, 120.0, 90.0, 95.0, 125.0, 130.0], index=index)

        metrics = _risk_metrics(close)

        assert metrics["max_drawdown"] == -25.0
        assert metrics["current_drawdown"] == 0.0
        assert metrics["recovery_days"] == 21
        assert metrics["sharpe"] is not None
        assert metrics["volatility"] > 0

    def test_never_recovered(self):
        index = pd.to_datetime(
            ["2024-01-01", "2024-01-10", "2024-01-20", "2024-01-25", "2024-02-10"]
        )
        close = pd.Series([100.0, 120.0, 90.0, 100.0, 110.0], index=index)

        metrics = _risk_metrics(close)

        assert metrics["max_drawdown"] == -25.0
        assert metrics["current_drawdown"] == -8.33
        assert metrics["recovery_days"] is None

    def test_zero_volatility_has_null_sharpe(self):
        index = pd.date_range("2024-01-01", periods=5, freq="D")
        close = pd.Series([100.0] * 5, index=index)

        metrics = _risk_metrics(close)

        assert metrics["sharpe"] is None
        assert metrics["volatility"] == 0.0
        assert metrics["max_drawdown"] == 0.0

    def test_empty_series(self):
        metrics = _risk_metrics(pd.Series(dtype=float))

        assert metrics == {
            "max_drawdown": None,
            "current_drawdown": None,
            "recovery_days": None,
            "sharpe": None,
            "volatility": None,
        }


# ===== Seasonality / persistence helpers =====

class TestSeasonalityAndPersistence:

    def test_seasonality_groups_by_calendar_month(self):
        index = pd.period_range("2022-01", periods=25, freq="M")
        values = [np.nan] + [float(v) for v in range(1, 25)]
        returns = pd.Series(values, index=index)

        items = _seasonality(returns)

        assert len(items) == 12
        assert [item["month"] for item in items] == list(range(1, 13))
        january = items[0]
        assert january["n"] == 2
        assert january["avg_return"] == pytest.approx((12.0 + 24.0) / 2)
        assert january["hit_rate"] == 100.0

    def test_transition_matrix_rows_sum_to_100(self):
        index = pd.period_range("2022-01", periods=5, freq="M")
        ranks = pd.DataFrame(
            {
                "A": [1.0, 2.0, 1.0, 3.0, 2.0],
                "B": [2.0, 1.0, 2.0, 1.0, 3.0],
                "C": [3.0, 3.0, 3.0, 2.0, 1.0],
            },
            index=index,
        )

        matrix = _transition_matrix(ranks, 3)

        assert len(matrix) == 3
        assert all(len(row) == 3 for row in matrix)
        for row in matrix:
            assert sum(row) == pytest.approx(100.0, abs=0.05)

    def test_persistence_counts_top3_stays(self):
        index = pd.period_range("2022-01", periods=6, freq="M")
        ranks = pd.Series([1.0, 2.0, 4.0, 3.0, 1.0, 2.0], index=index)

        result = _sector_persistence(ranks)

        assert result["top3_months"] == 5
        assert result["top3_stayed"] == 3
        assert result["top3_persistence_pct"] == pytest.approx(75.0)
        assert result["avg_next_rank"] == pytest.approx((2 + 4 + 3 + 1 + 2) / 5)

    def test_persistence_null_when_no_top3_observations(self):
        index = pd.period_range("2022-01", periods=2, freq="M")
        ranks = pd.Series([4.0, 5.0], index=index)

        result = _sector_persistence(ranks)

        assert result["top3_months"] == 0
        assert result["top3_stayed"] == 0
        assert result["top3_persistence_pct"] is None


# ===== Payload build =====

class TestBuildHistoryPayload:

    @pytest.fixture(scope="class")
    def payload(self, synthetic_closes):
        return _build_history_payload("india", 5, synthetic_closes)

    def test_shape_and_metadata(self, payload):
        assert isinstance(payload, SectorHistoryResponse)
        assert payload.market == "india"
        assert payload.years == 5
        assert payload.cached is False
        assert payload.source == "NIFTY sector indices"
        assert payload.disclaimer == (
            "Monthly history. Sample size per calendar month is shown. "
            "Historical context, not a forecast."
        )
        assert payload.months[0] == "2022-01"
        assert payload.months[-1] == "2024-12"
        assert payload.as_of == "2024-12-31"
        assert payload.universe == SECTORS
        assert [series.name for series in payload.series] == [BENCHMARK] + SECTORS
        assert [risk.name for risk in payload.risk] == [BENCHMARK] + SECTORS
        for series in payload.series:
            assert len(series.monthly_returns) == N_MONTHS
            assert len(series.ranks) == N_MONTHS

    def test_monthly_returns_and_exact_ranks(self, payload):
        by_name = {series.name: series for series in payload.series}

        for name, expected in EXPECTED_RETURNS.items():
            series = by_name[name]
            assert series.is_benchmark is False
            assert series.monthly_returns[0] is None
            for i, value in enumerate(expected, start=1):
                assert series.monthly_returns[i] == pytest.approx(value, abs=0.01)
            assert series.ranks == EXPECTED_RANKS[name]

    def test_benchmark_is_included_but_never_ranked(self, payload):
        benchmark = payload.series[0]

        assert benchmark.name == BENCHMARK
        assert benchmark.is_benchmark is True
        assert benchmark.ranks == [None] * N_MONTHS
        assert benchmark.monthly_returns[0] is None
        assert all(value is not None for value in benchmark.monthly_returns[1:])
        assert BENCHMARK not in payload.universe

    def test_seasonality_per_non_benchmark_sector(self, payload):
        assert all(item.name != BENCHMARK for item in payload.seasonality)
        for name in SECTORS:
            items = [item for item in payload.seasonality if item.name == name]
            assert len(items) == 12
            expected = _expected_seasonality(EXPECTED_RETURNS[name])
            for item in items:
                assert item.n == int(expected[item.month]["n"])
                assert item.avg_return == pytest.approx(expected[item.month]["avg"], abs=0.01)
                assert item.hit_rate == pytest.approx(expected[item.month]["hit"], abs=0.01)

    def test_persistence_probabilities(self, payload):
        by_name = {item.name: item for item in payload.persistence.by_sector}

        assert list(by_name) == SECTORS
        for name in SECTORS:
            expected = _expected_persistence(EXPECTED_RANKS[name])
            item = by_name[name]
            assert item.top3_months == expected["top3_months"]
            assert item.top3_stayed == expected["top3_stayed"]
            assert item.top3_persistence_pct == pytest.approx(expected["pct"], abs=0.01)
            assert item.avg_next_rank == pytest.approx(expected["avg"], abs=0.01)

    def test_transition_matrix_shape_and_values(self, payload):
        matrix = payload.persistence.transition_matrix
        expected = _expected_matrix(EXPECTED_RANKS)

        assert len(matrix) == 3
        assert all(len(row) == 3 for row in matrix)
        for i in range(3):
            for j in range(3):
                assert matrix[i][j] == pytest.approx(expected[i][j], abs=0.01)
        for row in matrix:
            assert sum(row) == pytest.approx(100.0, abs=0.05)

    def test_missing_month_keeps_alignment_with_nulls(self, synthetic_closes):
        closes = dict(synthetic_closes)
        it_frame = closes["NIFTY IT"]
        missing = pd.Period("2022-06", "M")
        closes["NIFTY IT"] = it_frame[it_frame.index.to_period("M") != missing]

        payload = _build_history_payload("india", 5, closes)

        assert payload is not None
        assert len(payload.months) == N_MONTHS
        position = payload.months.index("2022-06")
        by_name = {series.name: series for series in payload.series}

        assert by_name["NIFTY IT"].monthly_returns[position] is None
        assert by_name["NIFTY IT"].ranks[position] is None
        # No prior close means the next month's return is undefined too.
        assert by_name["NIFTY IT"].monthly_returns[position + 1] is None
        assert by_name["NIFTY BANK"].monthly_returns[position] is not None
        assert by_name["NIFTY BANK"].ranks[position] is not None

    def test_fewer_than_two_ranked_sectors_unavailable(self, synthetic_closes):
        closes = {
            BENCHMARK: synthetic_closes[BENCHMARK],
            "NIFTY BANK": synthetic_closes["NIFTY BANK"],
        }

        assert _build_history_payload("india", 5, closes) is None

    def test_fewer_than_thirteen_months_unavailable(self):
        closes = {
            BENCHMARK: _monthly_frame(_closes_from_returns(BENCH_RETURNS[:11])),
            "NIFTY BANK": _monthly_frame(_closes_from_returns(A_RETURNS[:11])),
            "NIFTY IT": _monthly_frame(_closes_from_returns(B_RETURNS[:11])),
        }

        assert _build_history_payload("india", 1, closes) is None

    def test_america_uses_etf_universe(self, synthetic_closes):
        closes = {
            "SPY": synthetic_closes[BENCHMARK],
            "XLK": synthetic_closes["NIFTY BANK"],
            "XLF": synthetic_closes["NIFTY IT"],
            "XLE": synthetic_closes["NIFTY FMCG"],
        }

        payload = _build_history_payload("america", 5, closes)

        assert payload is not None
        assert payload.source == "US sector ETFs"
        assert payload.universe == ["XLK", "XLF", "XLE"]
        assert [series.name for series in payload.series] == ["SPY", "XLK", "XLF", "XLE"]
        assert payload.series[0].ranks == [None] * N_MONTHS


# ===== Endpoint =====

@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as test_client:
        yield test_client


class TestSectorHistoryEndpoint:

    @patch("api.sector_history._write_cache")
    @patch("api.sector_history._read_cache", return_value=None)
    @patch("api.sector_history._fetch_history_data")
    def test_success_shape(
        self, mock_fetch, mock_read_cache, mock_write_cache, client, synthetic_closes
    ):
        mock_fetch.return_value = synthetic_closes

        response = client.get("/api/sector/history?market=india&years=5")

        assert response.status_code == 200
        data = response.json()
        assert set(data) == {
            "market",
            "years",
            "cached",
            "months",
            "as_of",
            "last_updated",
            "source",
            "disclaimer",
            "universe",
            "series",
            "risk",
            "seasonality",
            "persistence",
        }
        assert data["market"] == "india"
        assert data["years"] == 5
        assert data["cached"] is False
        assert len(data["months"]) == N_MONTHS
        assert data["as_of"] == "2024-12-31"
        assert data["source"] == "NIFTY sector indices"
        assert data["universe"] == SECTORS
        assert len(data["series"]) == 4
        assert len(data["risk"]) == 4
        assert len(data["seasonality"]) == 36
        assert len(data["persistence"]["by_sector"]) == 3
        assert len(data["persistence"]["transition_matrix"]) == 3
        benchmark = next(series for series in data["series"] if series["is_benchmark"])
        assert benchmark["ranks"] == [None] * N_MONTHS
        mock_read_cache.assert_called_once_with("india_5")
        mock_write_cache.assert_called_once()
        assert mock_write_cache.call_args[0][0] == "india_5"

    @patch("api.sector_history._fetch_history_data")
    @patch("api.sector_history._read_cache")
    def test_cached_payload_skips_fetch(
        self, mock_read_cache, mock_fetch, client, synthetic_closes
    ):
        payload = _build_history_payload("india", 5, synthetic_closes)
        mock_read_cache.return_value = payload.model_dump()

        response = client.get("/api/sector/history?market=india&years=5")

        assert response.status_code == 200
        assert response.json()["cached"] is True
        mock_fetch.assert_not_called()

    @patch("api.sector_history._write_cache")
    @patch("api.sector_history._read_cache", return_value=None)
    @patch("api.sector_history._fetch_history_data")
    def test_insufficient_sectors_returns_503(
        self, mock_fetch, mock_read_cache, mock_write_cache, client, synthetic_closes
    ):
        mock_fetch.return_value = {
            BENCHMARK: synthetic_closes[BENCHMARK],
            "NIFTY BANK": synthetic_closes["NIFTY BANK"],
        }

        response = client.get("/api/sector/history?market=india")

        assert response.status_code == 503
        assert response.json() == {"detail": "sector_history_unavailable"}
        mock_write_cache.assert_not_called()

    @patch("api.sector_history._write_cache")
    @patch("api.sector_history._read_cache", return_value=None)
    @patch("api.sector_history._fetch_history_data")
    def test_short_history_returns_503(
        self, mock_fetch, mock_read_cache, mock_write_cache, client
    ):
        mock_fetch.return_value = {
            BENCHMARK: _monthly_frame(_closes_from_returns(BENCH_RETURNS[:11])),
            "NIFTY BANK": _monthly_frame(_closes_from_returns(A_RETURNS[:11])),
            "NIFTY IT": _monthly_frame(_closes_from_returns(B_RETURNS[:11])),
        }

        response = client.get("/api/sector/history?market=india&years=1")

        assert response.status_code == 503
        assert response.json() == {"detail": "sector_history_unavailable"}

    def test_invalid_market_returns_422(self, client):
        response = client.get("/api/sector/history?market=invalid")

        assert response.status_code == 422

    def test_years_bounds_return_422(self, client):
        assert client.get("/api/sector/history?years=0").status_code == 422
        assert client.get("/api/sector/history?years=11").status_code == 422
