"""Pure-helper and mocked-HTTP tests for scripts/market/options_analytics_probe.py.

No network: every chain is built in-process and HTTP is a fake session.
"""

from __future__ import annotations

import importlib.util
import math
import os
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_SPEC = importlib.util.spec_from_file_location(
    "options_analytics_probe",
    _ROOT / "scripts" / "market" / "options_analytics_probe.py",
)
probe = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(probe)



def leg(strike: float, side: str, *, ltp: float = 10.0, oi: float = 1000.0,
        iv: float = 20.0, delta: float | None = None, gamma: float = 0.01,
        close_price: float = 0.0, vega: float = 0.1, theta: float = -0.05) -> dict:
    if delta is None:
        delta = 0.5 if side == "CE" else -0.5
    return {
        "strike_price": strike,
        "market_data": {"ltp": ltp, "oi": oi, "close_price": close_price},
        "option_greeks": {"iv": iv, "delta": delta, "gamma": gamma,
                          "vega": vega, "theta": theta},
    }


def row(strike: float, ce: dict | None = None, pe: dict | None = None) -> dict:
    return {"strike": strike, "ce": ce, "pe": pe}


class FakeResponse:
    def __init__(self, payload: dict):
        self.payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self.payload


class FakeSession:
    """Records calls and returns canned payloads by URL suffix."""

    def __init__(self, payloads: dict[str, dict]):
        self.headers: dict[str, str] = {}
        self.payloads = payloads
        self.calls: list[tuple[str, dict | None]] = []

    def post(self, url: str, json: dict | None = None, timeout: float | None = None):
        self.calls.append((url, json))
        return FakeResponse({"access_token": "minted-token"})

    def get(self, url: str, params: dict | None = None, timeout: float | None = None):
        self.calls.append((url, params))
        return FakeResponse(self.payloads[url.split("/api/", 1)[-1]])



def test_raw_num_rejects_nan_inf_and_text() -> None:
    assert probe.raw_num(1.5) == 1.5
    assert probe.raw_num(float("nan")) is None
    assert probe.raw_num(float("inf")) is None
    assert probe.raw_num("oops") is None
    assert probe.num(float("inf"), 7.0) == 7.0


def test_leg_uses_ltp_never_close_price() -> None:
    stale = probe.leg_from_row(row(100, ce=leg(100, "CE", ltp=0.0, close_price=250.0)), "ce")
    assert stale["ltp"] == 0.0
    assert stale["valid"] is False
    live = probe.leg_from_row(row(100, ce=leg(100, "CE", ltp=2.5, close_price=999.0)), "ce")
    assert live["ltp"] == 2.5
    assert live["valid"] is True


def test_filter_valid_legs_applies_all_gates_and_sorts() -> None:
    chain = [
        row(110, ce=leg(110, "CE", iv=100.1)),                      # IV > 100
        row(100, pe=leg(100, "PE")),                                # valid
        row(115, pe=leg(115, "PE", delta=float("nan"))),            # non-finite greek
        row(100, ce=leg(100, "CE")),                                # valid
        row(90, ce=leg(90, "CE", ltp=0.0)),                         # no LTP
        row(105, ce=leg(105, "CE", oi=0.0)),                        # no OI
        row(95, pe=leg(95, "PE", iv=0.0)),                          # no IV
        row(120, ce=leg(120, "CE", gamma=float("inf"))),            # non-finite gamma
        row(108, ce=leg(108, "CE")),                                # valid
    ]
    calls, puts = probe.valid_legs(chain)
    assert [c["strike"] for c in calls] == [100, 108]
    assert [p["strike"] for p in puts] == [100]  # 95 has no IV, 115 has NaN delta



def test_interpolate_strike_linear_clamp_and_exact() -> None:
    points = [{"strike": 110, "iv": 18.0}, {"strike": 100, "iv": 20.0}]
    assert probe.interpolate(points, 105)["value"] == pytest.approx(19.0)
    assert probe.interpolate(points, 110)["exact"] is True
    assert probe.interpolate(points, 90)["value"] == pytest.approx(20.0)
    assert probe.interpolate(points, 90)["exact"] is False
    assert probe.interpolate([], 100)["value"] == 0.0


def test_interpolate_by_delta_25_put() -> None:
    points = [{"delta": -0.5, "iv": 21.0}, {"delta": -0.1, "iv": 19.0}]
    result = probe.interpolate(points, -0.25, xkey="delta")
    assert result["value"] == pytest.approx(19.75)


def test_atm_iv_uses_two_nearest_strikes_and_averages_legs() -> None:
    calls, puts = probe.valid_legs([
        row(90, ce=leg(90, "CE", iv=18.0)),
        row(110, ce=leg(110, "CE", iv=22.0)),
        row(95, pe=leg(95, "PE", iv=19.0)),
        row(105, pe=leg(105, "PE", iv=21.0)),
    ])
    result = probe.atm_iv(calls, puts, 100.0)
    assert result["value"] == pytest.approx(20.0)
    assert result["exact"] is False
    # Two legs at the lower strike -> averaged before interpolation.
    extra, _ = probe.valid_legs([row(95, ce=leg(95, "CE", iv=23.0))])
    doubled = probe.atm_iv(calls + extra, puts, 100.0)
    assert doubled["value"] == pytest.approx(21.0)


def test_rr_and_fly_on_synthetic_smile_known_values() -> None:
    chain = [
        row(90, ce=leg(90, "CE", iv=22.0, delta=0.5), pe=leg(90, "PE", iv=22.0, delta=-0.5)),
        row(110, ce=leg(110, "CE", iv=18.0, delta=0.1), pe=leg(110, "PE", iv=18.0, delta=-0.1)),
    ]
    calls, puts = probe.valid_legs(chain)
    smile = probe.smile_stats(calls, puts, 100.0)
    assert smile["atm"]["value"] == pytest.approx(20.0)
    assert smile["call25"]["value"] == pytest.approx(19.5)
    assert smile["put25"]["value"] == pytest.approx(19.5)
    assert smile["rr"] == pytest.approx(0.0)
    assert smile["fly"] == pytest.approx(-0.5)


def test_otm_smile_selects_calls_above_and_puts_below_spot() -> None:
    chain = []
    for strike in range(95, 106):
        ce = leg(strike, "CE", iv=20.0) if strike >= 100 else None
        pe = leg(strike, "PE", iv=20.0) if strike <= 100 else None
        chain.append(row(strike, ce=ce, pe=pe))
    calls, puts = probe.valid_legs(chain)
    points = probe.otm_smile(calls, puts, 100.0, n=6)
    assert len(points) == 6
    assert all(p["moneyness_pct"] > 0 for p in points if p["side"] == "CE")
    assert all(p["moneyness_pct"] < 0 for p in points if p["side"] == "PE")
    assert all(p["strike"] != 100 for p in points)
    assert sum(p["side"] == "CE" for p in points) == 3
    assert probe.otm_smile(calls, puts, 0.0) == []



def _parity_chain(spot: float, strike: float, r: float, q: float, years: float) -> dict:
    theo = spot * math.exp(-q * years) - strike * math.exp(-r * years)
    base = 1.0
    return row(
        strike,
        ce=leg(strike, "CE", ltp=theo + base, oi=100, iv=20, delta=0.5),
        pe=leg(strike, "PE", ltp=base, oi=100, iv=20, delta=-0.5),
    )


def test_parity_with_q_zero_and_two_percent() -> None:
    spot, r, years = 100.0, 0.065, 0.1
    chain = [_parity_chain(spot, k, r, 0.02, years) for k in (98.0, 102.0)]
    calls, puts = probe.valid_legs(chain)
    correct = probe.parity_stats(calls, puts, spot, years, r, 0.02)
    wrong = probe.parity_stats(calls, puts, spot, years, r, 0.0)
    assert len(correct["points"]) == 2
    assert abs(correct["median_abs"]) < 1e-3
    assert correct["median_pct"] == pytest.approx(0.0, abs=1e-3)
    assert wrong["median_abs"] > 0.1
    assert correct["flag"] is False

    chain0 = [_parity_chain(spot, k, r, 0.0, years) for k in (98.0, 102.0)]
    calls0, puts0 = probe.valid_legs(chain0)
    assert abs(probe.parity_stats(calls0, puts0, spot, years, r, 0.0)["median_abs"]) < 1e-3


def test_parity_flags_error_above_threshold() -> None:
    spot = 100.0
    chain = [
        row(98, ce=leg(98, "CE", ltp=10.0), pe=leg(98, "PE", ltp=1.0)),
        row(102, ce=leg(102, "CE", ltp=10.0), pe=leg(102, "PE", ltp=1.0)),
    ]
    calls, puts = probe.valid_legs(chain)
    result = probe.parity_stats(calls, puts, spot, 0.1, 0.065, 0.02)
    assert result["flag"] is True
    assert result["median_pct"] > 5.0



def _level_chain() -> list[dict]:
    return [
        row(90, ce=leg(90, "CE", oi=100, gamma=0.01), pe=leg(90, "PE", oi=50, gamma=0.01)),
        row(100, ce=leg(100, "CE", oi=200, gamma=0.02), pe=leg(100, "PE", oi=400, gamma=0.02)),
        row(110, ce=leg(110, "CE", oi=100, gamma=0.01), pe=leg(110, "PE", oi=50, gamma=0.01)),
    ]


def test_max_pain_agrees_with_shared_options_levels_formula() -> None:
    # probe exposes the very functions loaded from api/options_levels.py.
    chain = _level_chain()
    expected = probe.compute_max_pain(probe.normalize_strikes(chain))
    stats = probe.level_stats(chain, 100.0, expected)
    assert stats["max_pain"] == expected == 100.0
    assert stats["summary_max_pain"] == expected
    assert stats["agree"] is True
    assert probe.level_stats(chain, 100.0, 0)["agree"] is False
    assert stats["ce_wall"]["strike"] == 100.0
    assert stats["pe_wall"]["strike"] == 100.0


def test_gex_marked_degraded_below_50pct_gamma_coverage() -> None:
    chain = _level_chain()
    no_gamma = [
        r | {"ce": leg(r["strike"], "CE", oi=100, gamma=0.0),
             "pe": leg(r["strike"], "PE", oi=100, gamma=0.0)}
        for r in chain
    ]
    degraded = probe.level_stats(no_gamma, 100.0, 100.0)
    assert degraded["gex"]["gamma_coverage_pct"] == 0.0
    assert degraded["gex"]["degraded"] is True
    healthy = probe.level_stats(chain, 100.0, 100.0)
    assert healthy["gex"]["gamma_coverage_pct"] == 100.0
    assert healthy["gex"]["degraded"] is False


def test_data_quality_counts_iv_gaps_and_high_iv() -> None:
    rows = [
        row(90, ce=leg(90, "CE", ltp=5, iv=0.0), pe=leg(90, "PE", ltp=0, iv=20)),
        row(100, ce=leg(100, "CE", ltp=5, iv=105.0), pe=leg(100, "PE", ltp=5, iv=25)),
    ]
    quality = probe.data_quality(rows, quotes_live=False)
    assert quality["legs"] == 4
    assert quality["iv_coverage_pct"] == pytest.approx(75.0)
    assert quality["iv_gt_max"] == 1
    assert quality["ltp_no_iv"] == 1
    assert quality["quotes_live"] is False



def test_client_and_report_with_mocked_http() -> None:
    chain = _level_chain()
    fake = FakeSession({
        "options/underlying/NIFTY": {
            "symbol": "NIFTY", "fno": True, "spot": 100.0, "quotes_live": True,
            "market_state": "open", "instrument_key": "NSE_INDEX|Nifty 50",
            "expiries": [{"date": "2026-11-17", "dte_days": 1}],
        },
        "options/chain/NIFTY": {
            "status": "ok", "spot": 100.0, "chain": chain,
            "summary": {"dte": 1, "max_pain": 100.0},
        },
    })
    client = probe.Client("http://example/", session=fake, token="t")
    password = os.getenv("QA_PASSWORD", "dummy-test-password")
    assert client.login(probe.QA_EMAIL, password) == "minted-token"
    assert fake.headers["Authorization"] == "Bearer minted-token"

    report = probe.build_symbol_report(client, "NIFTY", 1, 0.065, 0.02)
    assert report["symbol"] == "NIFTY"
    assert report["expiries"][0]["rows"] == 3
    assert report["expiries"][0]["levels"]["agree"] is True
    assert report["expiries"][0]["quality"]["quotes_live"] is True
    assert ("http://example/api/options/chain/NIFTY", {"expiry": "2026-11-17"}) in fake.calls
    assert probe.parse_symbols(" nifty, RELIANCE , ") == ["NIFTY", "RELIANCE"]


def test_report_caveats_non_fno_symbol() -> None:
    fake = FakeSession({"options/underlying/TEST": {"fno": False, "spot": 0.0, "expiries": []}})
    report = probe.build_symbol_report(probe.Client("http://x", session=fake), "TEST", 2,
                                       0.065, 0.0)
    assert report["expiries"] == []
    assert "no listed options" in report["caveats"]


def test_main_fails_clearly_without_password_or_token(monkeypatch, capsys) -> None:
    monkeypatch.setattr(probe, "QA_PASSWORD", None)
    assert probe.main(["--symbols", "NIFTY"]) == 1
    assert "QA_PASSWORD" in capsys.readouterr().err


def test_main_token_skips_login_without_password(monkeypatch, capsys) -> None:
    monkeypatch.setattr(probe, "QA_PASSWORD", None)

    class FakeClient:
        def __init__(self, base, timeout=20.0):
            pass

        def get(self, path, **params):
            return {"fno": False, "spot": 0.0, "expiries": []}

    monkeypatch.setattr(probe, "Client", FakeClient)
    assert probe.main(["--symbols", "NIFTY", "--token", "t"]) == 0
    assert capsys.readouterr().err == ""
