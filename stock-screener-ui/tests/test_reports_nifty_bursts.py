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
from api.reports_api.nifty_bursts import NIFTY_LOT_SIZE, coalesce_bursts

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
        # Derived, not magic: risk budget 5000 / 7.5 risk-per-unit = 666 units.
        assert sig["lots"] == 666 // NIFTY_LOT_SIZE
        assert sig["qty"] == sig["lots"] * NIFTY_LOT_SIZE
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
    """The trend gate: counter-trend bursts get no plan — they were the entire
    loss side on 2026-10-13 (1/9) and again on 2026-10-15 (resolved 0.32 vs
    0.80 aligned), so emitting a plan that says "skip" is just noise.
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

    def test_counter_trend_burst_gets_no_plan(self):
        from api.reports_api.nifty_bursts import derive_oi_signal
        # call unwind -> CE (bullish) but session trend is DOWN -> wrong side
        sig = derive_oi_signal(self._burst("call", -50_000), self._chain, 22700, trend="down")
        assert sig is None

    def test_unknown_trend_leaves_the_plan_ungated(self):
        from api.reports_api.nifty_bursts import derive_oi_signal
        sig = derive_oi_signal(self._burst("put", 50_000), self._chain, 22700)
        assert sig["aligned"] is None
        assert sig["trend"] is None
        assert "COUNTER-TREND" not in sig["basis"]

    def test_endpoint_emits_no_bearish_plan_on_rising_tape(self, _tmp_tape, _tmp_snapshots):
        """A rising tape + a bearish (PE) move must NOT produce a plan."""
        rows = []
        spot = 22500.0
        for i in range(14):
            # steady grind up, with a CALL-OI build (-> bearish -> PE) on the
            # last minute: bullish tape + bearish move = counter-trend = no plan.
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
        assert out["bursts"], "expected bursts to still be recorded"
        assert not any(b.get("signal") and b["signal"]["leg"] == "PE" for b in out["bursts"]), \
            "no bearish plan on a rising tape"


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


# ---------------------------------------------------- per-strike bursts

class TestDetectStrikeBursts:
    """A single strike exploding is invisible in the index total — these
    alerts name the exact strike and leg."""

    @staticmethod
    def _row(t, strike, ce_oi, pe_oi):
        return {"t": t, "spot": 22700, "call_doi": 0, "put_doi": 0,
                "call_tick": 0, "put_tick": 0,
                "strikes_top": [{"strike": strike, "ce_oi": ce_oi, "pe_oi": pe_oi}]}

    def _tape(self, ce_series):
        return [self._row(f"2026-10-13T14:{20 + i:02d}:00+05:30", 22750.0, ce, 1_000_000)
                for i, ce in enumerate(ce_series)]

    def test_single_strike_explosion_is_detected(self):
        from api.reports_api.nifty_bursts import detect_strike_bursts
        ce = [100_000 * i for i in range(14)]
        ce[-1] += 6_200_000
        out = detect_strike_bursts(self._tape(ce))
        assert len(out) == 1
        b = out[0]
        assert b["type"] == "strike"
        assert b["leg"] == "CE"
        assert b["side"] == "call"
        assert b["strike"] == 22750.0
        assert b["delta"] == 6_300_000     # +6.2M spike on a +100k/minute series
        assert b["severity"] == "critical"

    def test_small_move_is_ignored(self):
        from api.reports_api.nifty_bursts import detect_strike_bursts
        ce = [100_000 * i for i in range(14)]
        ce[-1] += 250_000          # below STRIKE_BURST_MIN_ABS (300K)
        assert detect_strike_bursts(self._tape(ce)) == []

    def test_old_tape_without_strikes_top_is_a_noop(self):
        from api.reports_api.nifty_bursts import detect_strike_bursts
        rows = [{"t": "09:15", "spot": 100}, {"t": "09:16", "spot": 101}]
        assert detect_strike_bursts(rows) == []

    def test_put_leg_explosion_names_the_put(self):
        from api.reports_api.nifty_bursts import detect_strike_bursts
        rows = []
        pe = 0
        for i in range(14):
            pe += 100_000
            rows.append(self._row(f"2026-10-13T14:{20 + i:02d}:00+05:30", 22500.0, 1_000_000, pe))
        rows[-1]["strikes_top"] = [{"strike": 22500.0, "ce_oi": 1_000_000,
                                    "pe_oi": pe + 5_000_000}]
        out = detect_strike_bursts(rows)
        assert out and out[0]["leg"] == "PE" and out[0]["side"] == "put"

    def test_signal_uses_the_named_strike_not_the_nearest(self):
        from api.reports_api.nifty_bursts import derive_oi_signal
        chain = [{"strike": 22700.0, "ce": {"ltp": 22.0}, "pe": {"ltp": 28.0}},
                 {"strike": 22750.0, "ce": {"ltp": 9.0}, "pe": {"ltp": 60.0}}]
        burst = {"type": "strike", "side": "call", "strike": 22750.0, "delta": 6_200_000.0}
        # call build -> PE leg; trend down keeps it aligned so the plan survives
        sig = derive_oi_signal(burst, chain, 22_720.0, trend="down")
        assert sig["strike"] == 22750.0     # named, even though 22,700 is nearer

    def test_endpoint_includes_strike_bursts(self, _tmp_tape, _tmp_snapshots):
        rows = []
        for i in range(14):
            rows.append({
                "t": f"2026-10-13T14:{20 + i:02d}:00+05:30", "spot": 22700.0,
                "ce_oi": 1000 * i, "pe_oi": 0, "ce_vol": 0, "pe_vol": 0,
                "pcr_oi": 1.0, "max_pain": 22700, "flip": 22700,
                "walls": {"calls": [{"strike": 23000.0, "oi": 9_000_000}],
                          "puts": [{"strike": 22000.0, "oi": 9_000_000}]},
                "strikes_top": [{"strike": 22750.0, "ce_oi": 100_000 * i,
                                 "pe_oi": 1_000_000}],
            })
        rows[-1]["strikes_top"] = [{"strike": 22750.0, "ce_oi": 100_000 * 13 + 6_200_000,
                                    "pe_oi": 1_000_000}]
        _write_tape(_tmp_tape, rows)
        out = get_nifty_bursts(date=DATE, window=3, min_abs=1000)
        strikes = [b for b in out["bursts"] if b.get("type") == "strike"]
        assert strikes, "expected a per-strike burst in the feed"
        assert strikes[0]["strike"] == 22750.0


# ------------------------------------------------- premium velocity (P4)

class TestDetectPremiumMoves:
    """Needs atm_ce_ltp/atm_pe_ltp (recorded from 2026-10-14 on)."""

    @staticmethod
    def _row(t, spot, ce, pe, strike=22700.0):
        return {"t": t, "spot": spot, "atm_strike": strike,
                "atm_ce_ltp": ce, "atm_pe_ltp": pe,
                "call_doi": 0, "put_doi": 0, "call_tick": 0, "put_tick": 0}

    def test_ce_impulse_is_detected(self):
        from api.reports_api.nifty_bursts import detect_premium_moves
        rows = [self._row("2026-10-14T14:00:00+05:30", 22700, 20.0, 25.0),
                self._row("2026-10-14T14:01:00+05:30", 22705, 22.0, 24.0),
                self._row("2026-10-14T14:02:00+05:30", 22710, 25.0, 23.0),
                self._row("2026-10-14T14:03:00+05:30", 22715, 30.0, 22.0)]
        out = detect_premium_moves(rows, window_min=3)
        assert len(out) == 1
        assert out[0]["leg"] == "CE" and out[0]["side"] == "call"
        assert out[0]["pct"] == 50.0
        assert out[0]["severity"] == "critical"

    def test_atm_strike_roll_is_not_a_premium_move(self):
        """The whole point of the guard: a roll changes the strike, not the premium."""
        from api.reports_api.nifty_bursts import detect_premium_moves
        rows = [self._row("2026-10-14T14:00:00+05:30", 22700, 20.0, 25.0, strike=22700.0),
                self._row("2026-10-14T14:03:00+05:30", 22760, 200.0, 5.0, strike=22750.0)]
        assert detect_premium_moves(rows, window_min=3) == []

    def test_small_move_ignored_and_old_tapes_noop(self):
        from api.reports_api.nifty_bursts import detect_premium_moves
        rows = [self._row("2026-10-14T14:00:00+05:30", 22700, 20.0, 25.0),
                self._row("2026-10-14T14:03:00+05:30", 22710, 21.0, 25.0)]
        assert detect_premium_moves(rows, window_min=3) == []
        assert detect_premium_moves([{"t": "09:15", "spot": 100}]) == []

    def test_premium_signal_is_momentum_on_the_moved_leg(self):
        from api.reports_api.nifty_bursts import derive_oi_signal
        chain = [{"strike": 22700.0, "ce": {"ltp": 30.0}, "pe": {"ltp": 22.0}}]
        b = {"type": "premium", "side": "call", "leg": "CE", "strike": 22700.0,
             "pct": 50.0, "delta": 10.0}
        s = derive_oi_signal(b, chain, 22715.0, trend="down")
        assert s["leg"] == "CE"           # with the impulse, not against the trend
        assert s["aligned"] is True
        assert "premium impulse" in s["basis"]


# ------------------------------------------------------- coiling (P6)

class TestDetectCoiling:
    @staticmethod
    def _row(t, spot, call_wall=22750.0, put_wall=22650.0):
        return {"t": t, "spot": spot, "call_doi": 0, "put_doi": 0,
                "walls": {"calls": [{"strike": call_wall, "oi": 5e6}],
                          "puts": [{"strike": put_wall, "oi": 5e6}]}}

    def test_tight_range_on_a_wall_is_a_coil(self):
        from api.reports_api.nifty_bursts import detect_coiling
        rows = [self._row(f"2026-10-14T14:{i:02d}:00+05:30", 22748 + (i % 3))
                for i in range(11)]
        out = detect_coiling(rows, window_min=10)
        assert out and out[0]["side"] == "call"
        assert out[0]["severity"] == "watch"

    def test_wide_range_is_not_a_coil(self):
        from api.reports_api.nifty_bursts import detect_coiling
        rows = [self._row(f"2026-10-14T14:{i:02d}:00+05:30", 22600 + i * 10)
                for i in range(11)]
        assert detect_coiling(rows, window_min=10) == []

    def test_far_from_the_wall_is_not_a_coil(self):
        from api.reports_api.nifty_bursts import detect_coiling
        rows = [self._row(f"2026-10-14T14:{i:02d}:00+05:30", 22700 + (i % 2))
                for i in range(11)]
        assert detect_coiling(rows, window_min=10) == []

    def test_coil_has_no_trade_plan(self):
        from api.reports_api.nifty_bursts import derive_oi_signal
        chain = [{"strike": 22750.0, "ce": {"ltp": 9.0}, "pe": {"ltp": 60.0}}]
        assert derive_oi_signal({"type": "coil", "side": "call", "wall": 22750.0},
                                chain, 22748.0, trend="up") is None

    def test_onset_only_a_persistent_coil_is_one_event(self):
        """A coil that lasts 10 minutes must not emit 10 alerts."""
        from api.reports_api.nifty_bursts import detect_coiling
        rows = [self._row(f"2026-10-14T14:{i:02d}:00+05:30", 22748 + (i % 3))
                for i in range(21)]
        out = detect_coiling(rows, window_min=10)
        call = [b for b in out if b["side"] == "call"]
        assert len(call) == 1, f"expected one onset, got {len(call)}"

    def test_dead_flat_range_is_stale_not_a_coil(self):
        """0.000% range is a stale chain repeating the last spot."""
        from api.reports_api.nifty_bursts import detect_coiling
        rows = [self._row(f"2026-10-14T15:{20 + i:02d}:00+05:30", 22702.05)
                for i in range(11)]
        assert detect_coiling(rows, window_min=10) == []


# ------------------------------------------------------------------- coalescing

class TestCoalesceBursts:
    """One alert per (minute, side) — the 2026-10-16 10:01 flood was 4 bursts
    (one index + a burst per strike) all describing the same call-side event."""

    def test_same_minute_same_side_merges_to_strongest(self):
        t = "2026-10-16T10:01:35+05:30"
        bursts = [
            {"t": t, "side": "call", "strike": None, "severity": "watch", "score": 3.86},
            {"t": t, "side": "call", "strike": 22950.0, "severity": "alert", "score": 6.38},
            {"t": t, "side": "call", "strike": 23000.0, "severity": "alert", "score": 7.19},
            {"t": t, "side": "call", "strike": 23100.0, "severity": "watch", "score": 4.04},
        ]
        out = coalesce_bursts(bursts)
        assert len(out) == 1
        assert out[0]["strike"] == 23000.0  # strongest of the two 'alert's
        assert out[0]["coalesced"] == 4
        assert out[0]["strikes"] == [22950.0, 23000.0, 23100.0]

    def test_critical_beats_higher_scored_alert(self):
        t = "2026-10-16T10:01:00+05:30"
        bursts = [
            {"t": t, "side": "call", "strike": 23000.0, "severity": "alert", "score": 99.0},
            {"t": t, "side": "call", "strike": 23100.0, "severity": "critical", "score": 8.0},
        ]
        out = coalesce_bursts(bursts)
        assert out[0]["strike"] == 23100.0

    def test_different_side_or_minute_stay_separate(self):
        bursts = [
            {"t": "2026-10-16T10:01:00+05:30", "side": "call", "severity": "alert", "score": 5},
            {"t": "2026-10-16T10:01:00+05:30", "side": "put", "severity": "alert", "score": 5},
            {"t": "2026-10-16T10:02:00+05:30", "side": "call", "severity": "alert", "score": 5},
        ]
        assert len(coalesce_bursts(bursts)) == 3

    def test_single_burst_untouched(self):
        bursts = [{"t": "2026-10-16T10:01:00+05:30", "side": "call",
                   "severity": "alert", "score": 5}]
        out = coalesce_bursts(bursts)
        assert out == bursts
        assert "coalesced" not in out[0]

    def test_empty(self):
        assert coalesce_bursts([]) == []
