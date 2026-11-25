"""Unit tests for backend-owned chart indicator math (payload contract §5)."""

from __future__ import annotations

import math

import numpy as np
import pytest

from chart_patterns import indicators


def _candle(t, price, volume=100.0, *, o=None, h=None, l=None, c=None):
    open_ = price if o is None else o
    high = price if h is None else h
    low = price if l is None else l
    close = price if c is None else c
    return {"t": t, "o": open_, "h": high, "l": low, "c": close, "v": volume}


# --- SMA -------------------------------------------------------------------


def test_sma_vector_1_to_25_has_warmup_nulls_and_known_values():
    values = np.arange(1, 26, dtype=float)
    out = indicators.sma(values, 20)
    assert np.isnan(out[:19]).all(), "indices 0-18 are warm-up"
    assert out[19] == pytest.approx(10.5)
    assert out[20] == pytest.approx(11.5)
    assert out[24] == pytest.approx(15.5)


def test_sma_short_series_and_invalid_bars_stay_null():
    assert np.isnan(indicators.sma([1.0, 2.0], 20)).all()
    values = np.arange(1, 26, dtype=float)
    values[5] = np.nan
    out = indicators.sma(values, 20)
    assert np.isnan(out[19]) and np.isnan(out[24])
    assert np.isnan(out).all(), "a poisoned window carries through its whole window"


# --- Bollinger -------------------------------------------------------------


def test_bollinger_uses_population_sigma():
    upper, middle, lower = indicators.bollinger_bands(np.arange(1, 21, dtype=float))
    population_sigma = math.sqrt((20 ** 2 - 1) / 12.0)
    sample_sigma = population_sigma * math.sqrt(20 / 19)
    assert middle[19] == pytest.approx(10.5)
    assert upper[19] == pytest.approx(10.5 + 2 * population_sigma)
    assert lower[19] == pytest.approx(10.5 - 2 * population_sigma)
    # A sample-sigma implementation would be visibly wider.
    assert upper[19] != pytest.approx(10.5 + 2 * sample_sigma)
    assert np.isnan(upper[:19]).all() and upper[19] == pytest.approx(22.03256259)


def test_bollinger_flat_series_collapses_onto_middle():
    upper, middle, lower = indicators.bollinger_bands(np.full(25, 100.0))
    tail = slice(19, None)
    assert np.all(upper[tail] == 100.0)
    assert np.all(middle[tail] == 100.0)
    assert np.all(lower[tail] == 100.0)


# --- Crosses ---------------------------------------------------------------


def test_golden_and_death_cross_vectors():
    fast = [1.0, 1.0, 1.0, 3.0, 3.0]
    slow = [2.0, 2.0, 2.0, 2.0, 2.0]
    assert indicators.detect_sma_crosses(fast, slow, list("abcde")) == [
        {"t": "d", "kind": "golden"}
    ]
    assert indicators.detect_sma_crosses(slow, fast, list("abcde")) == [
        {"t": "d", "kind": "death"}
    ]


def test_cross_equality_alone_is_not_an_event():
    assert indicators.detect_sma_crosses(
        [1.0, 2.0, 2.0], [2.0, 2.0, 2.0], list("abc")
    ) == []
    # A sub-epsilon separation is also not an event.
    assert indicators.detect_sma_crosses(
        [2.0, 2.0 + 5e-10], [2.0, 2.0], list("ab")
    ) == []
    # ... while a gap above eps is.
    assert indicators.detect_sma_crosses(
        [2.0, 2.0 + 1e-8], [2.0, 2.0], list("ab")
    ) == [{"t": "b", "kind": "golden"}]


def test_partial_last_bar_suppresses_cross():
    fast = [1.0, 1.0, 1.0, 1.0, 3.0]
    slow = [2.0, 2.0, 2.0, 2.0, 2.0]
    assert indicators.detect_sma_crosses(fast, slow, list("abcde")) == [
        {"t": "e", "kind": "golden"}
    ]
    assert indicators.detect_sma_crosses(
        fast, slow, list("abcde"), partial_last=True
    ) == []


def test_crosses_respect_earliest_index_floor():
    fast = [1.0] * 200 + [3.0]
    slow = [2.0] * 201
    assert indicators.detect_sma_crosses(fast, slow, [str(i) for i in range(201)]) == [
        {"t": "200", "kind": "golden"}
    ]
    early = [1.0, 1.0, 1.0, 3.0, 3.0]
    assert indicators.detect_sma_crosses(
        early, [2.0] * 5, list("abcde"), earliest_index=200
    ) == []


# --- VWAP ------------------------------------------------------------------


def _session_candles():
    return [
        _candle("2026-01-05T09:15:00+05:30", 100.0, 10),
        _candle("2026-01-05T09:20:00+05:30", 110.0, 30),
        _candle("2026-01-06T09:15:00+05:30", 200.0, 20),
        _candle("2026-01-06T09:20:00+05:30", 220.0, 20),
        _candle("2026-01-06T09:25:00+05:30", 999.0, 0),
        _candle("2026-01-07T09:15:00+05:30", 300.0, 0),
        _candle("2026-01-07T09:20:00+05:30", 310.0, 0),
    ]


def test_vwap_resets_across_sessions_and_uses_typical_price():
    out = indicators.compute_vwap(_session_candles(), "Asia/Kolkata", "5m")
    assert out[0] == pytest.approx(100.0)
    assert out[1] == pytest.approx(107.5)  # (100*10 + 110*30) / 40
    assert out[2] == pytest.approx(200.0)  # new session reset
    assert out[3] == pytest.approx(210.0)
    assert out[4] == pytest.approx(210.0)  # zero volume carries


def test_vwap_all_zero_session_is_null():
    out = indicators.compute_vwap(_session_candles(), "Asia/Kolkata", "5m")
    assert np.isnan(out[5]) and np.isnan(out[6])


def test_vwap_omitted_for_daily_weekly_monthly():
    candles = _session_candles()
    for timeframe in ("1D", "1W", "1M"):
        assert indicators.compute_vwap(candles, "Asia/Kolkata", timeframe) is None
        payload = indicators.compute_indicators(candles, timeframe)
        assert "vwap" not in {series["id"] for series in payload["series"]}


def test_vwap_resets_by_exchange_timezone():
    candles = [
        _candle("2026-01-06T03:00:00+00:00", 100.0, 10),  # 22:00 ET Jan 5
        _candle("2026-01-06T06:00:00+00:00", 200.0, 10),  # 01:00 ET Jan 6
    ]
    new_york = indicators.compute_vwap(candles, "America/New_York", "1h")
    kolkata = indicators.compute_vwap(candles, "Asia/Kolkata", "1h")
    # NY sees two sessions; the first starts after its open and cannot be
    # anchored, so it stays null. Kolkata sees one session from 08:30, which is
    # before its 09:15 open and therefore anchored.
    assert np.isnan(new_york[0]) and new_york[1] == pytest.approx(200.0)
    assert kolkata.tolist() == pytest.approx([100.0, 150.0])


def test_vwap_invalid_price_and_volume_never_emit_nan_to_payload():
    candles = [
        _candle("2026-01-05T09:15:00+05:30", 100.0, 10),
        _candle("2026-01-05T09:20:00+05:30", 110.0, -5),  # invalid volume
        _candle("2026-01-05T09:25:00+05:30", 120.0, 10, h=100.0),  # h < l
        _candle("2026-01-05T09:30:00+05:30", 130.0, 10),
    ]
    raw = indicators.compute_vwap(candles, "Asia/Kolkata", "5m")
    assert raw[0] == pytest.approx(100.0)
    assert np.isnan(raw[1]) and np.isnan(raw[2])
    assert raw[3] == pytest.approx((1000.0 + 1300.0) / 20.0)
    payload = indicators.compute_indicators(candles, "5m")
    vwap = next(s for s in payload["series"] if s["id"] == "vwap")
    assert len(vwap["values"]) == len(candles)
    assert vwap["values"][1] is None and vwap["values"][2] is None
    assert all(value is None or math.isfinite(value) for value in vwap["values"])


def _intraday_session(start: str = "2026-01-05 09:15", periods: int = 24):
    import pandas as pd

    idx = pd.date_range(start, periods=periods, freq="5min", tz="Asia/Kolkata")
    return [_candle(ts.isoformat(), 100.0 + i, 10.0 + i) for i, ts in enumerate(idx)]


def test_vwap_warmup_anchors_mid_session_display_to_session_open():
    """A tail-clamped window uses the morning warm-up, not its own first bar."""
    candles = _intraday_session()
    displayed = candles[12:]  # starts 10:15, mid-session
    warmup = candles[:12]
    expected = indicators.compute_vwap(candles, "Asia/Kolkata", "5m")

    payload = indicators.compute_indicators(displayed, "5m", warmup=warmup)
    vwap = next(s for s in payload["series"] if s["id"] == "vwap")["values"]

    assert displayed[0]["t"].startswith("2026-01-05T10:15")
    assert len(vwap) == len(displayed)
    for i, value in enumerate(vwap):
        assert value == pytest.approx(float(expected[12 + i]))


def test_vwap_without_warmup_leaves_partial_first_session_null():
    """No warm-up: do not fabricate a session VWAP from the afternoon only."""
    candles = _intraday_session()
    displayed = candles[12:]  # entire displayed window is the partial session

    payload = indicators.compute_indicators(displayed, "5m")
    vwap = next(s for s in payload["series"] if s["id"] == "vwap")["values"]
    assert all(value is None for value in vwap), "partial session must stay null"


def test_vwap_partial_warmup_does_not_fake_the_open_and_next_session_resumes():
    candles = _intraday_session()
    displayed = candles[12:]
    partial_warmup = candles[4:12]  # still mid-session: no 09:15 bar

    payload = indicators.compute_indicators(displayed, "5m", warmup=partial_warmup)
    vwap = next(s for s in payload["series"] if s["id"] == "vwap")["values"]
    assert all(value is None for value in vwap)

    next_session = [
        _candle("2026-01-06T09:15:00+05:30", 200.0, 10),
        _candle("2026-01-06T09:20:00+05:30", 220.0, 10),
    ]
    resumed = indicators.compute_indicators(displayed + next_session, "5m")
    values = next(s for s in resumed["series"] if s["id"] == "vwap")["values"]
    assert all(value is None for value in values[: len(displayed)])
    assert values[-2] == pytest.approx(200.0)
    assert values[-1] == pytest.approx(210.0)


# --- Full payload ----------------------------------------------------------


def test_compute_indicators_alignment_series_and_no_nan():
    prices = [100.0 + (i % 7) for i in range(260)]
    times = [f"2026-{1 + (i // 28) % 12:02d}-{1 + i % 28:02d}T00:00:00+00:00" for i in range(260)]
    candles = [
        _candle(t, price, 1000.0, h=price + 1.0, l=price - 1.0)
        for t, price in zip(times, prices)
    ]
    payload = indicators.compute_indicators(candles, "1D")
    assert payload["aligned"] == "candles"
    assert payload["timeframe"] == "1D"
    assert payload["session"] == "Asia/Kolkata"
    assert payload["partial_last"] is False
    assert [s["id"] for s in payload["series"]] == [
        "sma20", "sma50", "sma200", "bbUpper", "bbMiddle", "bbLower",
    ]
    for series in payload["series"]:
        assert len(series["values"]) == len(candles)
        assert all(value is None or math.isfinite(value) for value in series["values"])
    for cross in payload["crosses"]:
        assert cross["kind"] in {"golden", "death"}
        assert cross["t"] in set(times)


def test_compute_indicators_suppresses_cross_on_partial_tail():
    candles = []
    for i in range(201):
        price = 100.0 if i < 200 else 300.0
        candles.append(
            {
                "t": f"2026-01-{i % 28 + 1:02d}T00:00:00+00:00",
                "o": price,
                "h": price + 1.0,
                "l": price - 1.0,
                "c": price,
                "v": 1000.0,
            }
        )
    complete = indicators.compute_indicators(candles, "1D", partial_last=False)
    assert complete["crosses"] == [
        {"t": candles[-1]["t"], "kind": "golden"}
    ]
    partial = indicators.compute_indicators(candles, "1D", partial_last=True)
    assert partial["crosses"] == []
    assert partial["partial_last"] is True


def test_compute_indicators_marks_partial_last_and_uses_market_session():
    candles = [_candle(f"2026-01-05T09:{15 + i:02d}:00+05:30", 100.0 + i) for i in range(5)]
    candles[-1]["is_partial"] = True
    india = indicators.compute_indicators(candles, "5m")
    assert india["partial_last"] is True
    assert india["session"] == "Asia/Kolkata"
    assert "vwap" in {series["id"] for series in india["series"]}
    usa = indicators.compute_indicators(candles, "5m", market="usa")
    assert usa["session"] == "America/New_York"
