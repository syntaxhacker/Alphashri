"""Unit tests for backend-owned chart indicator math (payload contract §5)."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from chart_patterns import indicators
from scripts.perf import bench_indicators


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


def test_vwap_custom_intraday_timeframe_is_classified_intraday():
    """A registered `90m` frame gets VWAP; the coarse frames still do not."""
    assert indicators.is_intraday_timeframe("90m")
    assert indicators.is_intraday_timeframe("6h")
    assert not indicators.is_intraday_timeframe("1D")

    candles = _intraday_session()
    assert indicators.compute_vwap(candles, "Asia/Kolkata", "90m") is not None
    payload = indicators.compute_indicators(candles, "90m")
    vwap = next(s for s in payload["series"] if s["id"] == "vwap")["values"]
    assert len(vwap) == len(candles)
    assert any(value is not None for value in vwap)

    for timeframe in ("1D", "1W", "1M"):
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


# --- Optimisation-guard vectors -------------------------------------------
# These pin the exact semantics of the vectorised session-key, JSON-null,
# cross and resampling paths so a faster implementation cannot silently drift.


def test_session_keys_vector_path_matches_per_value_semantics():
    aware = [
        "2026-01-05T09:15:00+05:30",   # IST aware
        "2026-01-05T23:30:00+05:30",   # late same IST date
        "2026-01-06T00:15:00+05:30",   # next IST date
        "2026-01-06T09:15:00+05:30",
    ]
    keys, minutes = indicators._session_keys(aware, "Asia/Kolkata")
    assert minutes is not None
    expected = [indicators._session_key(value, "Asia/Kolkata") for value in aware]
    assert list(keys) == expected
    for value, minute in zip(aware, minutes):
        ts = pd.Timestamp(value).tz_convert("Asia/Kolkata")
        assert int(minute) == ts.hour * 60 + ts.minute

    # A homogeneous UTC tape takes the same vector path and converts once.
    utc = [pd.Timestamp(value).tz_convert("UTC").isoformat() for value in aware]
    utc_keys, utc_minutes = indicators._session_keys(utc, "Asia/Kolkata")
    assert utc_minutes is not None
    assert list(utc_keys) == expected
    assert list(utc_minutes) == list(minutes)

    naive = ["2026-01-05T09:15:00", "2026-01-06T09:15:00"]
    keys, minutes = indicators._session_keys(naive, "Asia/Kolkata")
    assert minutes is not None
    assert list(keys) == [
        indicators._session_key(value, "Asia/Kolkata") for value in naive
    ]

    # Malformed/mixed inputs fall back per value and stay identical.
    mixed = ["2026-01-05T09:15:00+05:30", None, "not-a-date", 12345]
    fallback, minutes = indicators._session_keys(mixed, "Asia/Kolkata")
    assert minutes is None
    assert fallback == [
        indicators._session_key(value, "Asia/Kolkata") for value in mixed
    ]


def test_vwap_is_identical_for_ist_utc_and_naive_wire_times():
    ist = [
        "2026-01-05T09:15:00+05:30",
        "2026-01-05T09:20:00+05:30",
        "2026-01-05T23:30:00+05:30",
        "2026-01-06T00:15:00+05:30",
        "2026-01-06T09:15:00+05:30",
    ]
    candles = [_candle(t, 100.0 + i, 10.0 + i) for i, t in enumerate(ist)]
    utc = [
        pd.Timestamp(t).tz_convert("UTC").isoformat() for t in ist
    ]
    naive = [t.replace("+05:30", "") for t in ist]
    expected = indicators.compute_vwap(candles, "Asia/Kolkata", "5m")
    for times in (utc, naive):
        variant = [
            _candle(t, candle["o"], candle["v"])
            for t, candle in zip(times, candles)
        ]
        values = indicators.compute_vwap(variant, "Asia/Kolkata", "5m")
        np.testing.assert_allclose(values, expected, rtol=0.0, atol=0.0)
    # 23:30 and 00:15 are different exchange-local dates: the cumulative
    # restarts at 00:15, then 09:15 continues that calendar date's VWAP.
    def typical(candle):
        return (candle["h"] + candle["l"] + candle["c"]) / 3.0

    assert expected[3] == pytest.approx(typical(candles[3]))
    assert expected[4] == pytest.approx(
        (
            typical(candles[3]) * candles[3]["v"]
            + typical(candles[4]) * candles[4]["v"]
        )
        / (candles[3]["v"] + candles[4]["v"])
    )


def test_values_to_json_batch_matches_scalar_null_rules():
    arrays = [
        np.array([1.0, np.nan, 2.5, np.inf, -np.inf, -0.0]),
        np.array([np.nan, np.nan, 3.0, 4.0, np.nan, 5.0]),
        np.array([], dtype=float),
    ]
    batched = indicators._values_to_json_batch(arrays)
    assert batched == [indicators._values_to_json(values) for values in arrays]
    assert batched[0] == [1.0, None, 2.5, None, None, -0.0]
    assert all(
        value is None or math.isfinite(value)
        for row in batched
        for value in row
    )


def test_cross_vectorisation_matches_reference_loop():
    rng = np.random.default_rng(20261125)
    for _ in range(50):
        n = int(rng.integers(2, 260))
        fast = rng.normal(100.0, 3.0, n)
        slow = rng.normal(100.0, 3.0, n)
        # Force equality/flat stretches, which are the eps boundary.
        if n > 6:
            fast[2:5] = slow[2:5]
            slow[5:n:17] = fast[5:n:17]
        if n > 10:
            fast[n // 2] = np.nan
            slow[n // 3] = np.inf
        times = [f"t{i}" for i in range(n)]
        for earliest in (0, 1, 5, 200):
            for partial in (False, True):
                expected = []
                start = max(earliest, 1)
                for i in range(start, n):
                    if partial and i == n - 1:
                        continue
                    fi, si = fast[i], slow[i]
                    fp, sp = fast[i - 1], slow[i - 1]
                    if not (
                        np.isfinite(fi) and np.isfinite(si)
                        and np.isfinite(fp) and np.isfinite(sp)
                    ):
                        continue
                    gap = float(fi - si)
                    prev_gap = float(fp - sp)
                    eps = 1e-9 * max(1.0, abs(float(fi)), abs(float(si)))
                    kind = None
                    if prev_gap <= 0.0 and gap > eps:
                        kind = "golden"
                    elif prev_gap >= 0.0 and gap < -eps:
                        kind = "death"
                    if kind is not None:
                        expected.append({"t": times[i], "kind": kind})
                actual = indicators.detect_sma_crosses(
                    fast, slow, times, earliest_index=earliest,
                    partial_last=partial,
                )
                assert actual == expected


def test_resampled_3h_4h_vwap_anchors_at_session_open():
    """3h/4h bars carry session-binned timestamps; VWAP must still anchor."""
    from chart_patterns import candles as candles_mod

    rows = []
    index = []
    for day in ("2026-01-05", "2026-01-06"):
        for bar in range(7):
            index.append(pd.Timestamp(f"{day}T{9 + bar:02d}:15:00+05:30"))
            rows.append(
                {
                    "open": 100.0 + bar,
                    "high": 101.0 + bar,
                    "low": 99.0 + bar,
                    "close": 100.5 + bar,
                    "volume": 1000.0 + bar,
                }
            )
    hourly = pd.DataFrame(rows, index=pd.DatetimeIndex(index))
    for tf, minutes in (("3h", 180), ("4h", 240)):
        frame = candles_mod._resample(hourly, minutes)
        assert frame.index[0].strftime("%H:%M") == "09:15"
        wire = [
            {
                "t": stamp.isoformat(),
                "o": row["open"],
                "h": row["high"],
                "l": row["low"],
                "c": row["close"],
                "v": row["volume"],
            }
            for stamp, row in frame.iterrows()
        ]
        payload = indicators.compute_indicators(wire, tf)
        vwap = next(s for s in payload["series"] if s["id"] == "vwap")["values"]
        expected = indicators.compute_vwap(wire, "Asia/Kolkata", tf)
        assert len(vwap) == len(wire) == len(expected)
        assert vwap[0] == pytest.approx(expected[0])
        assert all(
            value is None or math.isfinite(value) for value in vwap
        ), "no NaN/Inf leaves the payload"
        # The second session resets to its own first bar.
        first_second = next(
            i for i, candle in enumerate(wire)
            if candle["t"].startswith("2026-01-06")
        )
        assert vwap[first_second] == pytest.approx(expected[first_second])


# --- CI golden for the #330 byte-parity win --------------------------------


_GOLDEN_PATH = Path(__file__).parent / "fixtures" / "indicators_serialized_golden.json"


def _rounded(value):
    return None if value is None else round(float(value), 6)


def _series_summary(series: dict) -> dict:
    """Structure, null positions and 6-dp coarse values; no exact float bits."""
    values = series["values"]
    n = len(values)
    finite = [value for value in values if value is not None]
    mask = "".join("1" if value is None else "0" for value in values)
    sample_at = (n // 6, n // 3, n // 2, 2 * n // 3, 5 * n // 6)
    return {
        "id": series["id"],
        "bars": n,
        "mask": hashlib.sha256(mask.encode("ascii")).hexdigest(),
        "min": _rounded(min(finite)) if finite else None,
        "max": _rounded(max(finite)) if finite else None,
        "first": _rounded(values[0]) if n else None,
        "last": _rounded(values[-1]) if n else None,
        "samples": [_rounded(values[i]) for i in sample_at],
    }


@pytest.mark.unit
def test_seeded_candles_serialized_indicators_golden_all_timeframes():
    """Pin the 11-timeframe indicator contract without pinning numpy float bits.

    Byte-level equality is proven by ``bench_indicators --compare`` at PR time,
    not by this CI guard: numpy builds differ in RNG streams and summation, so
    exact float digests fail across shards for identical code. Only structure,
    null positions and values rounded to 6 dp (far above ~1e-12 summation
    noise) are pinned here -- enough to catch window, column, alignment and
    algorithm drift.
    """
    golden = json.loads(_GOLDEN_PATH.read_text(encoding="utf-8"))
    want = golden["timeframes"]
    actual = {
        tf: bench_indicators._compute(case)
        for tf, case in bench_indicators.cases().items()
    }

    assert golden["seed"] == bench_indicators.SEED
    assert golden["warmup_bars"] == bench_indicators.WARMUP_BARS
    assert set(actual) == set(want) == set(bench_indicators.enabled_timeframes())

    for tf, expected in want.items():
        got = actual[tf]
        where = f"{tf} golden payload"
        assert got["aligned"] == expected["aligned"] == "candles", where
        assert got["timeframe"] == tf, where
        assert got["session"] == expected["session"] == bench_indicators.IST, where
        assert got["partial_last"] is expected["partial_last"], where
        assert [(s["id"], len(s["values"])) for s in got["series"]] == [
            (s["id"], s["bars"]) for s in expected["series"]
        ], f"{where}: series names/lengths"
        assert [_series_summary(s) for s in got["series"]] == expected["series"], where
        assert got["crosses"] == expected["crosses"], f"{where}: crosses"
        assert len(got["crosses"]) == expected["crosses_count"], (
            f"{where}: crosses count"
        )
