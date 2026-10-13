"""Unit tests for the Nifty OI-burst endpoint (api/reports_api/nifty.py).

The detector/signal live in ``api.reports_api.nifty_bursts`` (pure); these
tests exercise the ``GET /api/reports/nifty/bursts`` handler end-to-end from
the stored tape, with tape + snapshot directories redirected to tmp_path.

Call the endpoint function directly, passing every Query param explicitly
(FastAPI ``Query`` defaults are ``Param`` objects outside HTTP).
"""

import json

import pytest
from fastapi import HTTPException

import api.reports_api.nifty as nifty
from api.reports_api.nifty import get_nifty_bursts

DATE = "2026-10-13"


# ------------------------------------------------------------------- fixtures

@pytest.fixture()
def _tmp_tape(tmp_path, monkeypatch):
    tape_dir = tmp_path / "nifty_tape"
    monkeypatch.setattr(nifty, "TAPE_DIR", tape_dir)
    return tape_dir


@pytest.fixture()
def _tmp_snapshots(tmp_path, monkeypatch):
    snap_dir = tmp_path / "nifty_reports"
    monkeypatch.setattr(nifty, "SNAPSHOT_DIR", snap_dir)
    return snap_dir


# --------------------------------------------------------------------- helpers

def _t(hhmm: str) -> str:
    return f"{DATE}T{hhmm}:00+05:30"


def _row(hhmm, ce_oi, pe_oi, ce_vol=0, pe_vol=0, spot=22500.0):
    return {"t": _t(hhmm), "ce_oi": ce_oi, "pe_oi": pe_oi,
            "ce_vol": ce_vol, "pe_vol": pe_vol, "spot": spot, "pcr_oi": 1.0}


def _write_tape(tape_dir, rows, date=DATE):
    tape_dir.mkdir(parents=True, exist_ok=True)
    with open(tape_dir / f"{date}.jsonl", "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")


def _spike_rows():
    """Flat call tape, then a +12 000 call-OI jump on the last minute."""
    return [
        _row("09:15", 1000, 5000),
        _row("09:16", 1100, 5000),
        _row("09:17", 1200, 5000),
        _row("09:18", 1300, 5000),
        _row("09:19", 13300, 5000),
    ]


def _snapshot(strikes, spot=22500.0):
    return {"spot": spot, "strikes": strikes}


# ----------------------------------------------------------------------- tests

class TestGetNiftyBursts:
    def test_flat_tape_count_zero(self, _tmp_tape):
        _write_tape(_tmp_tape, [_row(f"09:{15 + i:02d}", 1000, 5000)
                                for i in range(10)])
        out = get_nifty_bursts(date=DATE, window=3, min_abs=1000)
        assert out["count"] == 0
        assert out["bursts"] == []
        assert out["interval_sec"] == nifty.TAPE_INTERVAL_SEC
        assert "reason" not in out  # tape existed, just quiet

    def test_spike_yields_exactly_one_burst(self, _tmp_tape):
        _write_tape(_tmp_tape, _spike_rows())
        out = get_nifty_bursts(date=DATE, window=3, min_abs=1000)
        assert out["count"] == 1
        assert out["date"] == DATE
        b = out["bursts"][0]
        assert b["id"] == f"{_t('09:19')}-call"
        assert b["side"] == "call"
        assert b["t"] == _t("09:19")
        assert b["delta"] == 12000
        assert b["baseline"] == 1000.0
        assert b["score"] == 12.0
        assert b["severity"] == "critical"  # score 12 >= 8
        assert b["cumDoi"] == 12300
        assert b["spot"] == 22500.0
        assert b["tickVol"] == 0

    def test_spike_below_min_abs_ignored(self, _tmp_tape):
        _write_tape(_tmp_tape, _spike_rows())
        out = get_nifty_bursts(date=DATE, window=3, min_abs=20000)
        assert out["count"] == 0
        assert out["bursts"] == []

    def test_spike_during_warmup_ignored(self, _tmp_tape):
        # The +12 000 jump lands on the first delta minute, before warmup=3.
        rows = [
            _row("09:15", 1000, 5000),
            _row("09:16", 13000, 5000),
            _row("09:17", 13100, 5000),
            _row("09:18", 13200, 5000),
            _row("09:19", 13300, 5000),
        ]
        _write_tape(_tmp_tape, rows)
        out = get_nifty_bursts(date=DATE, window=3, min_abs=1000)
        assert out["count"] == 0

    def test_missing_tape_is_200_with_reason(self, _tmp_tape):
        out = get_nifty_bursts(date=DATE, window=3, min_abs=1000)
        assert out == {"date": DATE, "count": 0,
                       "interval_sec": nifty.TAPE_INTERVAL_SEC,
                       "bursts": [], "reason": "no tape"}

    def test_default_date_uses_today(self, _tmp_tape):
        out = get_nifty_bursts(date=None, window=3, min_abs=1000)
        assert out["date"] == nifty._today_str()
        assert out["count"] == 0
        assert out["reason"] == "no tape"

    def test_invalid_date_400(self, _tmp_tape):
        with pytest.raises(HTTPException) as exc:
            get_nifty_bursts(date="not-a-date", window=3, min_abs=1000)
        assert exc.value.status_code == 400


class TestBurstSignal:
    def test_signal_attached_from_snapshot(self, _tmp_tape, _tmp_snapshots):
        _write_tape(_tmp_tape, _spike_rows())
        _tmp_snapshots.mkdir(parents=True, exist_ok=True)
        (_tmp_snapshots / f"{DATE}.json").write_text(json.dumps(_snapshot([
            {"strike": 22500.0, "ce": {"ltp": 80.0}, "pe": {"ltp": 30.0}},
        ])))
        out = get_nifty_bursts(date=DATE, window=3, min_abs=1000)
        assert out["count"] == 1
        sig = out["bursts"][0]["signal"]
        assert sig is not None
        # call OI build -> fade with puts
        assert sig["leg"] == "PE"
        assert sig["strike"] == 22500.0
        assert sig["entry"] == 30.0
        assert sig["sl"] == 22.5
        assert sig["target"] == 45.0
        assert sig["lots"] == 8
        assert sig["qty"] == 600
        # trend gate fields are always present
        assert set(sig) == {"leg", "strike", "entry", "sl",
                            "target", "qty", "lots", "basis",
                            "trend", "aligned"}
        assert sig["trend"] in ("up", "down", None)
        assert sig["aligned"] in (True, False, None)

    def test_signal_null_without_snapshot(self, _tmp_tape, _tmp_snapshots):
        _write_tape(_tmp_tape, _spike_rows())
        out = get_nifty_bursts(date=DATE, window=3, min_abs=1000)
        assert out["count"] == 1
        assert out["bursts"][0]["signal"] is None

    def test_signal_null_on_corrupt_snapshot(self, _tmp_tape, _tmp_snapshots):
        _write_tape(_tmp_tape, _spike_rows())
        _tmp_snapshots.mkdir(parents=True, exist_ok=True)
        (_tmp_snapshots / f"{DATE}.json").write_text("{not valid json")
        out = get_nifty_bursts(date=DATE, window=3, min_abs=1000)
        assert out["count"] == 1
        assert out["bursts"][0]["signal"] is None

    def test_signal_null_when_snapshot_lacks_strikes(self, _tmp_tape,
                                                    _tmp_snapshots):
        _write_tape(_tmp_tape, _spike_rows())
        _tmp_snapshots.mkdir(parents=True, exist_ok=True)
        (_tmp_snapshots / f"{DATE}.json").write_text(
            json.dumps({"spot": 22500.0}))
        out = get_nifty_bursts(date=DATE, window=3, min_abs=1000)
        assert out["count"] == 1
        assert out["bursts"][0]["signal"] is None

    def test_flat_tape_has_no_bursts_even_with_snapshot(self, _tmp_tape,
                                                        _tmp_snapshots):
        _write_tape(_tmp_tape, [_row(f"09:{15 + i:02d}", 1000, 5000)
                                for i in range(10)])
        _tmp_snapshots.mkdir(parents=True, exist_ok=True)
        (_tmp_snapshots / f"{DATE}.json").write_text(json.dumps(_snapshot([
            {"strike": 22500.0, "ce": {"ltp": 80.0}, "pe": {"ltp": 30.0}},
        ])))
        out = get_nifty_bursts(date=DATE, window=3, min_abs=1000)
        assert out["count"] == 0
        assert out["bursts"] == []


# ------------------------------------------------------------ trend gate

class TestTrendGate:
    """The trend gate: counter-trend plans are flagged, not silently emitted.

    Evidence (2026-10-13): trend-aligned plans went 10/12 (avg +81.7 pts) while
    counter-trend plans went 1/9 (avg −94.4 pts) — the whole loss side.
    """

    @staticmethod
    def _rows(spots):
        return [{"t": f"2026-10-13T09:{15 + i:02d}:00+05:30", "spot": s}
                for i, s in enumerate(spots)]

    def test_rising_tape_is_an_up_trend(self):
        from api.reports_api.nifty_bursts import session_trend
        assert session_trend(self._rows([100, 110, 120, 130, 140])) == "up"

    def test_falling_tape_is_a_down_trend(self):
        from api.reports_api.nifty_bursts import session_trend
        assert session_trend(self._rows([140, 130, 120, 110, 100])) == "down"

    def test_too_few_points_yields_none(self):
        from api.reports_api.nifty_bursts import session_trend
        assert session_trend([]) is None
        assert session_trend(self._rows([100])) is None

    def test_at_time_only_uses_data_up_to_that_minute(self):
        from api.reports_api.nifty_bursts import session_trend
        rows = self._rows([100, 101, 102, 103, 90, 80])
        # up to the 4th minute it is still rising; the later crash must not leak
        assert session_trend(rows, at_time=rows[3]["t"]) == "up"
        assert session_trend(rows) == "down"

    def _burst(self, side, delta):
        return {"id": "x", "side": side, "t": "2026-10-13T14:20:00+05:30",
                "delta": delta, "baseline": 1000.0, "score": 60.0,
                "severity": "critical", "cumDoi": 0.0, "spot": 22700.0,
                "tickVol": 0.0}

    _chain = [{"strike": 22700, "ce": {"ltp": 22.0}, "pe": {"ltp": 28.0}}]

    def test_aligned_plan_is_not_flagged(self):
        from api.reports_api.nifty_bursts import derive_oi_signal
        # call unwind -> CE (bullish); trend up -> aligned
        sig = derive_oi_signal(self._burst("call", -50_000), self._chain, 22700, trend="up")
        assert sig["leg"] == "CE"
        assert sig["aligned"] is True
        assert "COUNTER-TREND" not in sig["basis"]

    def test_counter_trend_plan_is_flagged_with_reason(self):
        from api.reports_api.nifty_bursts import derive_oi_signal
        # call unwind -> CE (bullish) but session trend is DOWN -> wrong side
        sig = derive_oi_signal(self._burst("call", -50_000), self._chain, 22700, trend="down")
        assert sig["leg"] == "CE"
        assert sig["aligned"] is False
        assert sig["basis"].startswith("COUNTER-TREND (session down) — skip:")

    def test_unknown_trend_leaves_the_plan_ungated(self):
        from api.reports_api.nifty_bursts import derive_oi_signal
        sig = derive_oi_signal(self._burst("put", 50_000), self._chain, 22700)
        assert sig["aligned"] is None
        assert sig["trend"] is None
        assert "COUNTER-TREND" not in sig["basis"]

    def test_endpoint_flags_today_style_losers_as_counter_trend(self, _tmp_tape, _tmp_snapshots):
        """A rising tape + a bearish (PE) plan must come back aligned=False."""
        rows = []
        spot = 22500.0
        for i in range(14):
            # steady grind up, with a CALL-OI build (-> bearish -> PE) on the
            # last minute: bullish tape + bearish plan = counter-trend.
            spot += 5
            rows.append({"t": f"2026-10-13T09:{15 + i:02d}:00+05:30", "spot": spot,
                         "ce_oi": 1000 * i, "pe_oi": 0, "ce_vol": 0, "pe_vol": 0,
                         "pcr_oi": 1.0, "max_pain": 22500, "flip": 22500,
                         "walls": {"calls": [], "puts": []}})
        rows[-1]["ce_oi"] = rows[-2]["ce_oi"] + 5_000_000
        _write_tape(_tmp_tape, rows)
        _tmp_snapshots.mkdir(parents=True, exist_ok=True)
        (_tmp_snapshots / f"{DATE}.json").write_text(json.dumps(_snapshot([
            {"strike": 22600.0, "ce": {"ltp": 25.0}, "pe": {"ltp": 30.0}},
        ])))
        out = get_nifty_bursts(date=DATE, window=3, min_abs=1000)
        pe_plans = [b for b in out["bursts"]
                    if b.get("signal") and b["signal"]["leg"] == "PE"]
        assert pe_plans, "expected at least one bearish plan"
        # tape only rises -> a bearish leg is counter-trend
        assert all(b["signal"]["aligned"] is False for b in pe_plans)
        assert all("COUNTER-TREND" in b["signal"]["basis"] for b in pe_plans)


# ------------------------------------------------------------ auth gate

class TestBurstsAuthGate:
    """`/nifty/bursts` leaks trade signals, so it requires an app user while
    its sibling market-data endpoints stay open."""

    @staticmethod
    def _client():
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from api.reports_api.nifty import router
        from api.auth import get_current_user

        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_current_user] = lambda: object()
        return TestClient(app), app, get_current_user

    def test_requires_auth(self):
        client, app, dep = self._client()
        app.dependency_overrides.pop(dep, None)
        assert client.get("/api/reports/nifty/bursts").status_code == 401

    def test_ok_with_a_user(self):
        client, _app, _dep = self._client()
        assert client.get("/api/reports/nifty/bursts").status_code == 200

    def test_sibling_market_data_endpoints_stay_open(self, monkeypatch, tmp_path):
        """Deliberate: market data is never gated (see AGENTS.md)."""
        client, _app, _dep = self._client()
        # tape returns 200-with-envelope or 404 when empty — never 401
        assert client.get("/api/reports/nifty/tape?date=1999-01-01").status_code != 401


# ------------------------------------------------------------- squeezes

class TestDetectSqueezes:
    """Short-covering squeezes: a wall break WITH that side's OI unwinding.

    Validated on the real 2026-10-13 tape, where the money move was spot
    crossing 22,600 at 14:21 while 16.46M call contracts were bought back at
    14:20 — the unwind and the cross land on ADJACENT minutes.
    """

    @staticmethod
    def _row(t, spot, call_oi, put_oi, call_wall=22600.0, put_wall=22500.0):
        return {"t": t, "spot": spot, "call_doi": call_oi, "put_doi": put_oi,
                "call_tick": 0, "put_tick": 0,
                "walls": {"calls": [{"strike": call_wall, "oi": 5_000_000}],
                          "puts": [{"strike": put_wall, "oi": 5_000_000}]}}

    def _tape(self, spots, call_oi, put_oi):
        return [self._row(f"2026-10-13T14:{20 + i:02d}:00+05:30", s, call_oi[i], put_oi[i])
                for i, s in enumerate(spots)]

    def test_same_minute_cross_and_unwind_is_detected(self):
        from api.reports_api.nifty_bursts import detect_squeezes
        rows = self._tape([22590, 22610], [0, -12_000_000], [0, 0])
        sq = detect_squeezes(rows)
        assert len(sq) == 1
        assert sq[0]["side"] == "call"
        assert sq[0]["type"] == "squeeze"
        assert sq[0]["severity"] == "critical"
        assert sq[0]["wall"] == 22600.0

    def test_unwind_one_minute_before_the_cross_is_still_detected(self):
        """The real 2026-10-13 shape: unwind at 14:20, cross at 14:21."""
        from api.reports_api.nifty_bursts import detect_squeezes
        rows = self._tape([22584, 22597, 22601], [0, -16_461_965, 0], [0, 0, 0])
        sq = detect_squeezes(rows)
        assert len(sq) == 1
        assert sq[0]["side"] == "call"
        assert sq[0]["unwind_t"].endswith("14:21:00+05:30")   # emitted at the cross
        assert abs(sq[0]["delta"]) == 16_461_965

    def test_window_zero_misses_the_adjacent_minute_case(self):
        """Proves the window is what catches the real move."""
        from api.reports_api.nifty_bursts import detect_squeezes
        rows = self._tape([22584, 22597, 22601], [0, -16_461_965, 0], [0, 0, 0])
        assert detect_squeezes(rows, window_min=0) == []

    def test_small_unwind_is_ignored(self):
        from api.reports_api.nifty_bursts import detect_squeezes
        rows = self._tape([22590, 22610], [0, -500_000], [0, 0])
        assert detect_squeezes(rows) == []

    def test_building_oi_on_a_break_is_not_a_squeeze(self):
        """A break with OI BUILDING is new writing, not covering."""
        from api.reports_api.nifty_bursts import detect_squeezes
        rows = self._tape([22590, 22610], [0, +12_000_000], [0, 0])
        assert detect_squeezes(rows) == []

    def test_put_squeeze_on_a_downside_break(self):
        from api.reports_api.nifty_bursts import detect_squeezes
        rows = self._tape([22510, 22480], [0, 0], [0, -9_000_000])
        sq = detect_squeezes(rows)
        assert len(sq) == 1
        assert sq[0]["side"] == "put"
        assert sq[0]["severity"] == "critical"

    def test_no_break_no_squeeze(self):
        from api.reports_api.nifty_bursts import detect_squeezes
        rows = self._tape([22590, 22595], [0, -12_000_000], [0, 0])
        assert detect_squeezes(rows) == []

    def test_squeeze_signal_buys_the_break_not_the_fade(self):
        """A squeeze is momentum: call squeeze -> CE, regardless of trend."""
        from api.reports_api.nifty_bursts import detect_squeezes, derive_oi_signal
        chain = [{"strike": 22600, "ce": {"ltp": 40.0}, "pe": {"ltp": 35.0}}]
        rows = self._tape([22590, 22610], [0, -12_000_000], [0, 0])
        sq = detect_squeezes(rows)[0]
        sig = derive_oi_signal(sq, chain, 22610.0, trend="down")  # even against trend
        assert sig["leg"] == "CE"
        assert sig["aligned"] is True
        assert "short-covering squeeze" in sig["basis"]
        assert "22,600" in sig["basis"]

    def test_endpoint_includes_squeezes_alongside_bursts(self, _tmp_tape, _tmp_snapshots):
        rows = []
        spot = 22590.0
        for i in range(14):
            spot += 2
            rows.append({"t": f"2026-10-13T14:{20 + i:02d}:00+05:30", "spot": spot,
                         "ce_oi": 1000 * i, "pe_oi": 0, "ce_vol": 0, "pe_vol": 0,
                         "pcr_oi": 1.0, "max_pain": 22590, "flip": 22590,
                         "walls": {"calls": [{"strike": 22620.0, "oi": 5_000_000}],
                                   "puts": [{"strike": 22500.0, "oi": 5_000_000}]}})
        # last minute: spot crosses the call wall while call OI collapses
        rows[-1]["spot"] = 22630.0
        rows[-1]["ce_oi"] = rows[-2]["ce_oi"] - 12_000_000
        _write_tape(_tmp_tape, rows)
        _tmp_snapshots.mkdir(parents=True, exist_ok=True)
        (_tmp_snapshots / f"{DATE}.json").write_text(json.dumps(_snapshot([
            {"strike": 22600.0, "ce": {"ltp": 40.0}, "pe": {"ltp": 35.0}},
        ])))
        out = get_nifty_bursts(date=DATE, window=3, min_abs=1000)
        kinds = [b.get("type") for b in out["bursts"] if b.get("type") == "squeeze"]
        assert kinds, "expected a squeeze in the feed"
        sq = [b for b in out["bursts"] if b.get("type") == "squeeze"][0]
        assert sq["signal"]["leg"] == "CE"
        assert sq["signal"]["aligned"] is True
