"""Tests for the MNQ dealer-levels bridge.

Covers the MotiveWave tick-store reader (``mw_tickstore``) and the NDX -> MNQ
basis translation (``nq_basis``). No network and no dependency on the real
MotiveWave data directory: tick files are built byte-for-byte from the
documented layout.
"""
from __future__ import annotations

import struct
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import mw_tickstore as T  # noqa: E402
import nq_basis as B  # noqa: E402
from _tickfile import build_tick_file  # noqa: E402

BLOCK = 1_790_712_000_000  # 2026-09-29T20:00:00Z


# ------------------------------------------------------------- mw_tickstore ---


def test_last_tick_returns_final_record(tmp_path):
    f = build_tick_file(
        tmp_path / "x.tick_data",
        [(1000, 30600.5, 1, True), (2000, 30654.25, 3, False)],
    )
    tick = T.last_tick(f)
    assert tick["price"] == pytest.approx(30654.25)
    assert tick["volume"] == 3
    assert tick["is_ask"] is False
    assert tick["ts"] == BLOCK + 2000


def test_last_tick_handles_single_record(tmp_path):
    f = build_tick_file(tmp_path / "x.tick_data", [(7, 12345.0, 2, True)])
    tick = T.last_tick(f)
    assert tick["price"] == pytest.approx(12345.0)
    assert tick["ts"] == BLOCK + 7


def test_last_tick_empty_block_is_none(tmp_path):
    f = build_tick_file(tmp_path / "x.tick_data", [])
    assert T.last_tick(f) is None


def test_last_tick_rejects_legacy_magic(tmp_path):
    f = build_tick_file(tmp_path / "x.tick_data", [(1, 1.0, 1, True)], magic=0x3281BB96)
    assert T.last_tick(f) is None


def test_last_tick_rejects_unknown_magic(tmp_path):
    f = build_tick_file(tmp_path / "x.tick_data", [(1, 1.0, 1, True)], magic=0x11223344)
    assert T.last_tick(f) is None


def test_last_tick_rejects_wrong_column_size(tmp_path):
    # column 1 is 4 bytes on the wire; claim 2 -> header must be rejected
    f = build_tick_file(tmp_path / "x.tick_data", [(1, 1.0, 1, True)], col_sizes=[(1, 2)])
    assert T.last_tick(f) is None


def test_last_tick_truncated_payload_is_none(tmp_path):
    f = build_tick_file(tmp_path / "x.tick_data", [(1, 1.0, 1, True)])
    f.write_bytes(f.read_bytes()[:-5])  # chop the last record
    assert T.last_tick(f) is None


def test_last_tick_missing_file_is_none(tmp_path):
    assert T.last_tick(tmp_path / "nope.tick_data") is None


def test_find_instrument_picks_newest_block(tmp_path):
    (tmp_path / "RITHMIC").mkdir()
    build_tick_file(tmp_path / "RITHMIC/MNQZ6.CME/1000.tick_data", [(1, 1.0, 1, True)])
    build_tick_file(tmp_path / "RITHMIC/MNQZ6.CME/2000.tick_data", [(1, 1.0, 1, True)])
    build_tick_file(tmp_path / "RITHMIC/MNQU6.CME/1500.tick_data", [(1, 1.0, 1, True)])
    inst = T.find_instrument("MNQ", root=tmp_path)
    assert inst.name == "MNQZ6.CME"


def test_find_instrument_respects_prefix(tmp_path):
    (tmp_path / "RITHMIC").mkdir()
    build_tick_file(tmp_path / "RITHMIC/NQZ6.CME/1000.tick_data", [(1, 1.0, 1, True)])
    assert T.find_instrument("MNQ", root=tmp_path) is None
    assert T.find_instrument("NQ", root=tmp_path).name == "NQZ6.CME"


def test_latest_tick_walks_back_past_empty_current_block(tmp_path):
    build_tick_file(tmp_path / "RITHMIC/MNQZ6.CME/1000.tick_data", [(5, 30000.0, 1, True)])
    build_tick_file(tmp_path / "RITHMIC/MNQZ6.CME/2000.tick_data", [])  # current hour empty
    tick = T.latest_tick("MNQ", root=tmp_path)
    assert tick["price"] == pytest.approx(30000.0)
    assert tick["block_file"] == "1000.tick_data"


def test_symbol_from_strips_exchange():
    assert T.symbol_from("MNQZ6.CME") == "MNQZ6"
    assert T.symbol_from("") == ""


# ----------------------------------------------------------------- nq_basis ---

GEX = {
    "call_wall": "30400",
    "gamma_flip": "30351.06",
    "gamma_magnet": "30320",
    "put_wall": "30320",
    "nearby_flips": ["30351.06", "30324.02"],
    "time": "2026-09-29T19:52:28.000000Z",
    "source": "vol",
}


class FakeResp:
    def __init__(self, payload):
        self.status_code = 200
        self._p = payload

    def json(self):
        return self._p


class FakeClient:
    """Minimal stand-in for UWClient.get()."""

    def __init__(self, routes):
        self.routes = routes

    def get(self, path, **params):
        if path not in self.routes:
            class R:
                status_code = 404

                def json(self):
                    return {}

            return R()
        return FakeResp(self.routes[path])


def uw_routes(**over):
    routes = {
        "/api/stock/NDX/gex-levels": {"data": dict(GEX)},
        "/api/stock/QQQ/stock-state": {"data": {"close": "737.68"}},
        "/api/stock/QQQ/ohlc/1d": {"data": [{"date": "2026-09-22", "close": "747.46"}]},
        "/api/stock/NDX/ohlc/1d": {"data": [{"date": "2026-09-22", "close": "30732.40"}]},
    }
    routes.update(over)
    return routes


@pytest.fixture
def live_tick(monkeypatch):
    tick = {"price": 30633.5, "ts": int(BLOCK), "instrument": "MNQZ6.CME", "block_file": "b.tick_data"}
    monkeypatch.setattr(B, "latest_tick", lambda *a, **k: tick)
    return tick


def test_ndx_cash_uses_qqq_ratio():
    out = B.ndx_cash(FakeClient(uw_routes()))
    # 737.68 * (30732.40 / 747.46)
    assert out["value"] == pytest.approx(737.68 * (30732.40 / 747.46), rel=1e-6)
    assert out["ratio"] == pytest.approx(41.1158, abs=1e-4)


def test_ndx_cash_none_when_qqq_missing():
    out = B.ndx_cash(FakeClient(uw_routes(**{"/api/stock/QQQ/stock-state": {"data": {}}})))
    assert out["value"] is None


def test_mnq_levels_translates_index_walls_into_futures_points(live_tick):
    m = B.mnq_levels(FakeClient(uw_routes()))
    ndx = 737.68 * (30732.40 / 747.46)
    basis = 30633.5 - ndx
    assert m["basis"] == pytest.approx(basis, abs=0.11)
    by = {l["key"]: l for l in m["levels"]}
    assert by["call_wall"]["ndx"] == pytest.approx(30400.0)
    assert by["call_wall"]["mnq"] == pytest.approx(30400.0 + basis, abs=0.11)
    assert by["call_wall"]["dist"] == pytest.approx(30400.0 + basis - 30633.5, abs=0.11)
    assert len(m["levels"]) == 4
    assert m["errors"] == []


def test_mnq_levels_distances_are_signed_from_price(live_tick):
    m = B.mnq_levels(FakeClient(uw_routes()))
    # call wall 30400 is above cash 30342 -> basis pushes it near/above price
    call = next(l for l in m["levels"] if l["key"] == "call_wall")
    put = next(l for l in m["levels"] if l["key"] == "put_wall")
    assert call["dist"] > put["dist"]


def test_mnq_levels_regime_long_gamma_when_cash_above_flip():
    # The basis is derived from the futures price, so it cancels out of the
    # regime test: price >= flip_mnq  <=>  ndx_cash >= flip_ndx. Drive the cash
    # estimate up (QQQ 740 x ratio), not the futures price.
    routes = uw_routes(
        **{
            "/api/stock/QQQ/stock-state": {"data": {"close": "740.00"}},
            "/api/stock/QQQ/ohlc/1d": {"data": [{"date": "2026-09-22", "close": "747.46"}]},
            "/api/stock/NDX/ohlc/1d": {"data": [{"date": "2026-09-22", "close": "30732.40"}]},
        }
    )
    m = B.mnq_levels(FakeClient(routes))
    assert m["ndx_cash"] > 30351.06  # above the NDX gamma flip
    assert m["regime"] == "long-gamma"
    assert m["above_flip"] is True


def test_mnq_levels_regime_short_gamma_when_cash_below_flip(live_tick):
    # QQQ 737.68 -> cash ~30342, just under the 30351.06 flip.
    m = B.mnq_levels(FakeClient(uw_routes()))
    assert m["ndx_cash"] < 30351.06
    assert m["regime"] == "short-gamma"
    assert m["above_flip"] is False


def test_regime_is_independent_of_futures_price(monkeypatch):
    """Basis cancels, so the regime must not change with the futures price."""
    regimes = set()
    for px in (20000.0, 30633.5, 40000.0):
        monkeypatch.setattr(
            B, "latest_tick", lambda *a, _p=px, **k: {"price": _p, "ts": BLOCK, "instrument": "MNQZ6.CME"}
        )
        regimes.add(B.mnq_levels(FakeClient(uw_routes()))["regime"])
    assert regimes == {"short-gamma"}


def test_mnq_levels_degrades_without_price(monkeypatch):
    monkeypatch.setattr(B, "latest_tick", lambda *a, **k: None)
    m = B.mnq_levels(FakeClient(uw_routes()))
    assert m["price"] is None
    assert m["levels"] == []
    assert m["basis"] is None
    assert any("no live" in e for e in m["errors"])


def test_mnq_levels_degrades_without_gex(live_tick):
    m = B.mnq_levels(FakeClient(uw_routes(**{"/api/stock/NDX/gex-levels": {"data": []}})))
    assert m["levels"] == []
    assert m["price"] == pytest.approx(30633.5)
    assert m["basis"] is not None
    assert any("gex-levels" in e for e in m["errors"])


def test_mnq_levels_survives_api_exception(live_tick):
    class Boom:
        def get(self, path, **params):
            raise RuntimeError("network down")

    m = B.mnq_levels(Boom())
    assert m["price"] == pytest.approx(30633.5)
    assert m["levels"] == []
    assert m["errors"]


def test_mnq_levels_price_age_is_reported(live_tick):
    m = B.mnq_levels(FakeClient(uw_routes()))
    assert m["price_age_s"] is not None
    assert m["price_ts"] == BLOCK
