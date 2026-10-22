"""Tests for Options Positioning (api/positioning.py + /positioning endpoint).

Pure-math tests use a hand-computed 2-strike fixture (spot=25000). The chain is
Upstox ``/option/chain`` data, where OI is already in **units (shares)**, so
``lot_size`` is accepted for back-compat but never applied:

  Strike 25000 CE: oi=1000 prev=500 dOI=500  delta=+0.5  class LB  (bullish)
      state = 0.5*1000*25000/1e7 = 1.25
      flow  = 0.5*500*25000/1e7  = 0.625
      init  = +1*500*0.5*25000/1e7 = +0.625  (class-weighted)
  Strike 25000 PE: oi=2000 prev=1500 dOI=500  delta=-0.6  class SB  (bullish)
      state = -0.6*2000*25000/1e7 = -3.0
      flow  = -0.6*500*25000/1e7  = -0.75
      init  = +1*500*0.6*25000/1e7 = +0.75
  Strike 25100 CE: oi=800 prev=1000 dOI=-200  delta=+0.4  class LU  (bearish)
      state = 0.4*800*25000/1e7  = 0.8
      flow  = 0.4*-200*25000/1e7 = -0.2
      init  = -1*200*0.4*25000/1e7 = -0.2
  Strike 25100 PE: oi=300 prev=100 dOI=200, greeks None (unreadable)

  initiated (class-weighted) = 0.625 + 0.75 - 0.2 = +1.175
  flow_class (same signs)   = 0.625 + 0.75 + 0.2 = +1.575
  bearish = 0.2, bullish = 1.375, gross = 1.575
  lean = 1.175/1.575*100 = 74.603
  read: readable 1200 / total 1400 = 85.71
  biggest: 25000 PE (-0.75)

Only the EMITTED totals are rounded (2 dp); the per-row figures stay exact.
The verdict needs a book above the noise floor
(``max(5% of gross, 50 Cr)``), so this 1.575 Cr fixture reads "neutral".
"""

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.positioning import compute_positioning

LOT = 25
SPOT = 25000.0


def _contract(oi, prev_oi, delta, sentiment="Long Buildup"):
    md = {"oi": oi, "prev_oi": prev_oi}
    greeks = None if delta is None else {"delta": delta}
    return {"market_data": md, "option_greeks": greeks, "sentiment": {"type": sentiment}}


def _fixture_rows():
    return [
        {
            "strike": 25000,
            "ce": _contract(1000, 500, 0.5, "Long Buildup"),
            "pe": _contract(2000, 1500, -0.6, "Short Buildup"),
        },
        {
            "strike": 25100,
            "ce": _contract(800, 1000, 0.4, "Long Unwinding"),
            "pe": _contract(300, 100, None, "Neutral"),
        },
    ]


class TestComputePositioningMath:
    def test_exact_cr_values(self):
        pos = compute_positioning(_fixture_rows(), SPOT, LOT)
        assert pos["state"]["calls_cr"] == pytest.approx(2.05)
        assert pos["state"]["puts_cr"] == pytest.approx(-3.0)
        # Emitted totals are rounded; the per-row figures stay exact.
        assert pos["flow"]["calls_cr"] == pytest.approx(0.42)
        assert pos["flow"]["puts_cr"] == pytest.approx(-0.75)
        # `initiated` is CLASS-WEIGHTED (each leg signed by its buildup class)
        # — the same convention as the Nifty report's positioning block. The
        # signed-delta net is emitted as `flow`.
        assert pos["initiated_cr"] == pytest.approx(1.18)
        assert pos["flow_class_cr"] == pytest.approx(1.57)
        assert pos["initiated"]["bearish_cr"] == pytest.approx(0.2)
        assert pos["initiated"]["bullish_cr"] == pytest.approx(1.38)
        assert pos["lean_pct"] == pytest.approx(1.175 / 1.575 * 100, abs=0.01)
        assert pos["rows"][0]["net_init_cr"] == pytest.approx(1.375)

    def test_signed_delta_flow_is_kept_separate(self):
        # The signed-delta net (calls +, puts −) is `flow`, NOT `initiated`.
        pos = compute_positioning(_fixture_rows(), SPOT, LOT)
        assert pos["flow"]["calls_cr"] == pytest.approx(0.42)
        assert pos["flow"]["puts_cr"] == pytest.approx(-0.75)
        assert pos["initiated_cr"] > 0  # class-weighted: bullish

    def test_lot_size_does_not_scale_cr_values(self):
        # Upstox OI is in units; passing the contract lot must not multiply.
        small = compute_positioning(_fixture_rows(), SPOT, 1)
        big = compute_positioning(_fixture_rows(), SPOT, LOT)
        assert big["initiated_cr"] == pytest.approx(small["initiated_cr"])
        assert big["state"] == small["state"]

    def test_ce_pe_sign(self):
        rows = [
            {
                "strike": 100,
                "ce": _contract(100, 0, 0.5),
                "pe": _contract(100, 0, -0.5),
            }
        ]
        pos = compute_positioning(rows, 100.0, 1)
        ce_cr = pos["rows"][0]["ce_cr"]
        pe_cr = pos["rows"][0]["pe_cr"]
        assert ce_cr == pytest.approx(0.5 * 100 * 1 * 100.0 / 1e7)
        assert pe_cr == pytest.approx(-0.5 * 100 * 1 * 100.0 / 1e7)
        assert ce_cr > 0 > pe_cr

    def test_put_delta_normalized_to_negative(self):
        # Positive delta on a PE is still treated as short exposure.
        rows = [{"strike": 100, "ce": None, "pe": _contract(100, 50, 0.5)}]
        pos = compute_positioning(rows, 100.0, 1)
        assert pos["rows"][0]["pe_cr"] < 0

    def test_bearish_verdict_on_a_real_book(self):
        # A put long build is BEARISH by the house convention, so the
        # class-weighted initiation is negative and the verdict is bearish.
        # The book has to clear the noise floor (max(5% of gross, 50 Cr)).
        rows = [{"strike": 100, "ce": None,
                 "pe": _contract(1_000_000, 500_000, 0.5)}]
        pos = compute_positioning(rows, 25000.0, 1)
        assert pos["initiated_cr"] < 0
        assert pos["flow_class_cr"] < 0
        assert pos["verdict"] == "bearish"
        assert pos["initiated"]["bearish_cr"] > 0
        assert pos["initiated"]["bullish_cr"] == 0.0

    def test_empty_chain_div_zero(self):
        pos = compute_positioning([], SPOT, LOT)
        assert pos["verdict"] == "neutral"
        assert pos["initiated_cr"] == 0
        assert pos["lean_pct"] == 0
        assert pos["state"] == {"calls_cr": 0.0, "puts_cr": 0.0, "note": "calls outweigh puts"}
        assert pos["read"] == {"pct": 0.0, "readable_shares": 0, "total_shares": 0}
        assert pos["biggest_move"] is None
        assert pos["rows"] == []
        assert pos["split"]["bearish_pct"] == 0
        assert pos["split"]["bullish_pct"] == 0

    def test_null_greeks_unreadable(self):
        pos = compute_positioning(_fixture_rows(), SPOT, LOT)
        row = next(r for r in pos["rows"] if r["strike"] == 25100)
        assert row["pe_cr"] is None
        assert row["pe_doi_shares"] == 200
        assert row["ce_cr"] == pytest.approx(-0.2)
        # None treated as 0 in net, net known because CE readable
        assert row["net_cr"] == pytest.approx(-0.2)
        # Unreadable shares count toward denominator only
        assert pos["read"]["readable_shares"] == 1200
        assert pos["read"]["total_shares"] == 1400
        assert pos["read"]["pct"] == pytest.approx(1200 / 1400 * 100, abs=0.01)

    def test_prev_oi_zero_full_oi_as_flow(self):
        rows = [{"strike": 100, "ce": _contract(1000, 0, 0.5), "pe": None}]
        pos = compute_positioning(rows, 100.0, 1)
        expected = 0.5 * 1000 * 1 * 100.0 / 1e7
        # The per-row figure stays exact; only the emitted total is rounded.
        assert pos["rows"][0]["ce_cr"] == pytest.approx(expected)
        assert pos["flow"]["calls_cr"] == pytest.approx(round(expected, 2))
        assert pos["state"]["calls_cr"] == pytest.approx(round(expected, 2))

    def test_biggest_move_label(self):
        pos = compute_positioning(_fixture_rows(), SPOT, LOT)
        assert pos["biggest_move"] == {
            "strike": 25000,
            "side": "PE",
            "sentiment": "Short Buildup",
            "label": "put writers opened (today)",
            "cr": pytest.approx(-0.75),
        }

    @pytest.mark.parametrize(
        "side,sentiment,label",
        [
            ("CE", "Short Buildup", "call writers opened (today)"),
            ("CE", "Long Buildup", "call buyers opened (today)"),
            ("CE", "Short Covering", "call writers closed (today)"),
            ("CE", "Long Unwinding", "call buyers closed (today)"),
            ("PE", "Short Buildup", "put writers opened (today)"),
            ("PE", "Long Buildup", "put buyers opened (today)"),
            ("PE", "Short Covering", "put writers closed (today)"),
            ("PE", "Long Unwinding", "put buyers closed (today)"),
            ("CE", "Neutral", "unclassified flow (today)"),
            ("PE", "Neutral", "unclassified flow (today)"),
        ],
    )
    def test_biggest_move_labels(self, side, sentiment, label):
        other = "PE" if side == "CE" else "CE"
        row = {"strike": 100, "ce": None, "pe": None}
        row[side.lower()] = _contract(1000, 0, 0.5 if side == "CE" else -0.5, sentiment)
        row[other.lower()] = _contract(10, 0, 0.1 if other == "CE" else -0.1, "Neutral")
        pos = compute_positioning([row], 100.0, 1)
        assert pos["biggest_move"]["side"] == side
        assert pos["biggest_move"]["label"] == label

    def test_verdict_neutral_on_zero(self):
        rows = [
            {
                "strike": 100,
                "ce": _contract(100, 0, 0.5),
                "pe": _contract(100, 0, -0.5),
            }
        ]
        pos = compute_positioning(rows, 100.0, 1)
        assert pos["initiated_cr"] == pytest.approx(0.0)
        assert pos["verdict"] == "neutral"
        assert pos["initiated"]["note"] == "■ Neutral"

    def test_zero_delta_readable_contributes_zero(self):
        rows = [{"strike": 100, "ce": _contract(100, 50, 0.0), "pe": None}]
        pos = compute_positioning(rows, 100.0, 1)
        assert pos["rows"][0]["ce_cr"] == pytest.approx(0.0)
        assert pos["read"]["readable_shares"] == 50
        assert pos["biggest_move"]["cr"] == pytest.approx(0.0)

    def test_row_classes_default_dash(self):
        rows = [{"strike": 100, "ce": _contract(100, 0, 0.5), "pe": None}]
        pos = compute_positioning(rows, 100.0, 1)
        assert pos["rows"][0]["ce_class"] == "Long Buildup"
        assert pos["rows"][0]["pe_class"] == "—"
        assert pos["rows"][0]["pe_cr"] is None
        assert pos["rows"][0]["pe_doi_shares"] is None


class TestPositioningEndpoint:
    def _chain_payload(self):
        return _fixture_rows(), SPOT

    def test_200_shape_keys(self, client: TestClient):
        from unittest.mock import patch, AsyncMock

        rows, spot = self._chain_payload()
        with patch("api.options._fetch_chain_rows", new_callable=AsyncMock, return_value=(rows, spot)):
            response = client.get("/api/options/positioning/NIFTY?expiry=2026-03-17")
        assert response.status_code == 200
        data = response.json()
        for key in (
            "status", "underlying", "expiry", "mode", "spot", "lot_size",
            "timestamp", "baseline", "baseline_note", "verdict",
            "initiated_cr", "flow_class_cr", "lean_pct", "state", "flow",
            "initiated", "split", "read", "biggest_move", "rows",
        ):
            assert key in data, f"missing key {key}"
        assert data["underlying"] == "NIFTY"
        assert data["mode"] == "since_open"
        # 65, not 25: the endpoint resolves NIFTY's contract lot for display,
        # but OI is already in units so the lot never scales the Cr figures.
        assert data["lot_size"] == 65  # NIFTY lookup
        assert data["baseline"] == "prev_close_oi"
        # `initiated` is the CLASS-WEIGHTED number (same convention as the
        # Nifty report); the signed-delta net is `flow`. One field, one
        # meaning — the two used to disagree in sign for the same chain.
        assert data["initiated_cr"] == pytest.approx(1.18)
        assert data["flow_class_cr"] == pytest.approx(1.57)
        assert data["flow"]["calls_cr"] == pytest.approx(0.42)
        assert data["flow"]["puts_cr"] == pytest.approx(-0.75)
        # The hand-built book is 1.575 Cr gross — below the 50 Cr noise
        # floor, so no direction is published.
        assert data["verdict"] == "neutral"
        assert len(data["rows"]) == 2

    def test_422_without_expiry(self, client: TestClient):
        response = client.get("/api/options/positioning/NIFTY")
        assert response.status_code == 422

    def test_empty_chain_neutral(self, client: TestClient):
        from unittest.mock import patch, AsyncMock

        with patch("api.options._fetch_chain_rows", new_callable=AsyncMock, return_value=([], 0)):
            response = client.get("/api/options/positioning/NIFTY?expiry=2026-03-17")
        assert response.status_code == 200
        data = response.json()
        assert data["verdict"] == "neutral"
        assert data["rows"] == []
        assert data["biggest_move"] is None

    def test_unknown_underlying_lot_fallback(self, client: TestClient):
        from unittest.mock import patch, AsyncMock

        rows, spot = self._chain_payload()
        with patch("api.options._fetch_chain_rows", new_callable=AsyncMock, return_value=(rows, spot)):
            response = client.get("/api/options/positioning/UNKNOWN?expiry=2026-03-17")
        assert response.status_code == 200
        assert response.json()["lot_size"] == 1
