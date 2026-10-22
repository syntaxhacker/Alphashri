"""Unit tests for scripts/trade_cost.py — pure functions only, no network/DB."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import trade_cost as tc


# --------------------------------------------------------------------------
# Fixtures: canned Upstox payloads (shapes per developer docs)
# --------------------------------------------------------------------------

MARGIN_OK = {
    "status": "success",
    "data": {
        "margins": [{
            "span_margin": 12000.5,
            "exposure_margin": 3000.25,
            "equity_margin": 0,
            "net_buy_premium": 0,
            "additional_margin": 0,
            "total_margin": 15000.75,
            "tender_margin": 0,
        }],
        "required_margin": 15000.75,
        "final_margin": 15000.75,
    },
}

BROKERAGE_SELL = {
    "status": "success",
    "data": {"charges": {
        "total": 28.5,
        "brokerage": 20.0,
        "taxes": {"gst": 4.1, "stt": 6.87, "stamp_duty": 0.0},
        "other_charges": {"transaction": 1.63, "clearing": 0.0,
                          "ipft": 0.02, "sebi_turnover": 0.01},
    }},
}

BROKERAGE_BUY_CAMEL = {  # camelCase variant shown in docs
    "status": "success",
    "data": {"charges": {
        "total": 25.1,
        "brokerage": 20.0,
        "taxes": {"gst": 3.9, "stt": 0.0, "stampDuty": 0.14},
        "otherCharges": {"transaction": 1.63, "clearing": 0.0,
                         "ipft": 0.02, "sebiTurnover": 0.01},
    }},
}

ROWS = [
    {"instrument_key": "NSE_FO|37806", "trading_symbol": "NIFTY 23000 CE 29 DEC 26",
     "strike_price": 23000.0, "name": "NIFTY"},
    {"instrument_key": "NSE_FO|37810", "trading_symbol": "NIFTY 23000 PE 29 DEC 26",
     "strike_price": 23000.0, "name": "NIFTY"},
]

# Canned GET /option/chain rows (shape per developer docs).
CHAIN = [
    {"expiry": "2026-10-27", "strike_price": 23000,
     "underlying_key": "NSE_INDEX|Nifty 50",
     "call_options": {"instrument_key": "NSE_FO|90001",
                      "market_data": {"ltp": 70.45}},
     "put_options": {"instrument_key": "NSE_FO|90002",
                     "market_data": {"ltp": 65.1}}},
    {"expiry": "2026-10-27", "strike_price": 23100,
     "underlying_key": "NSE_INDEX|Nifty 50",
     "call_options": {"instrument_key": "NSE_FO|90003"},
     "put_options": {"instrument_key": "NSE_FO|90004"}},
]


# --------------------------------------------------------------------------
# Live chain matching
# --------------------------------------------------------------------------

def test_match_chain_row_call():
    hit = tc.match_chain_row(CHAIN, opt="CE", strike=23000)
    assert hit == {"instrument_key": "NSE_FO|90001"}


def test_match_chain_row_put():
    hit = tc.match_chain_row(CHAIN, opt="PE", strike=23000)
    assert hit == {"instrument_key": "NSE_FO|90002"}


def test_match_chain_row_case_insensitive_opt():
    assert tc.match_chain_row(CHAIN, opt="ce", strike=23000)["instrument_key"] == "NSE_FO|90001"


def test_match_chain_row_strike_miss_returns_none():
    assert tc.match_chain_row(CHAIN, opt="CE", strike=99999) is None
    assert tc.match_chain_row([], opt="CE", strike=23000) is None


def test_match_chain_row_missing_side_returns_none():
    rows = [{"strike_price": 23000, "call_options": {}}]
    assert tc.match_chain_row(rows, opt="CE", strike=23000) is None
    rows = [{"strike_price": 23000}]  # no legs at all
    assert tc.match_chain_row(rows, opt="PE", strike=23000) is None


# --------------------------------------------------------------------------
# Margin normalisation
# --------------------------------------------------------------------------

def test_normalize_margin_ok():
    m = tc.normalize_margin_response(MARGIN_OK)
    assert m["required_margin"] == pytest.approx(15000.75)
    assert m["final_margin"] == pytest.approx(15000.75)
    assert len(m["legs"]) == 1
    assert m["legs"][0]["span_margin"] == pytest.approx(12000.5)
    assert m["legs"][0]["total_margin"] == pytest.approx(15000.75)


def test_normalize_margin_missing_fields_default_zero():
    m = tc.normalize_margin_response({"status": "success", "data": {}})
    assert m["required_margin"] == 0.0
    assert m["legs"] == []


def test_normalize_margin_error_status_raises():
    with pytest.raises(ValueError):
        tc.normalize_margin_response({"status": "error", "errors": [{"errorCode": "UDAPI1000"}]})


# --------------------------------------------------------------------------
# Brokerage normalisation
# --------------------------------------------------------------------------

def test_normalize_brokerage_sell_leg():
    b = tc.normalize_brokerage_response(BROKERAGE_SELL)
    assert b["total"] == pytest.approx(28.5)
    assert b["brokerage"] == pytest.approx(20.0)
    assert b["stt"] == pytest.approx(6.87)
    assert b["exchange"] == pytest.approx(1.63)
    assert b["stamp"] == pytest.approx(0.0)
    assert b["sebi"] == pytest.approx(0.01)


def test_normalize_brokerage_camel_case_keys():
    b = tc.normalize_brokerage_response(BROKERAGE_BUY_CAMEL)
    assert b["stamp"] == pytest.approx(0.14)
    assert b["sebi"] == pytest.approx(0.01)
    assert b["exchange"] == pytest.approx(1.63)


def test_normalize_brokerage_missing_fields_default_zero():
    b = tc.normalize_brokerage_response({"status": "success", "data": {"charges": {}}})
    assert b == {"total": 0.0, "brokerage": 0.0, "stt": 0.0, "gst": 0.0,
                 "stamp": 0.0, "exchange": 0.0, "clearing": 0.0,
                 "ipft": 0.0, "sebi": 0.0}


def test_normalize_brokerage_error_status_raises():
    with pytest.raises(ValueError):
        tc.normalize_brokerage_response({"status": "error"})


# --------------------------------------------------------------------------
# Round-trip + comparison
# --------------------------------------------------------------------------

def test_round_trip_total_two_legs():
    assert tc.round_trip_total([{"total": 28.5}, {"total": 25.1}]) == pytest.approx(53.6)


def test_round_trip_total_empty():
    assert tc.round_trip_total([]) == 0.0


def test_compare_api_higher_verdict():
    c = tc.compare_totals(53.6, 47.8)
    assert c["delta"] == pytest.approx(5.8)
    assert "higher" in c["verdict"] and "API" in c["verdict"]


def test_compare_api_lower_verdict():
    c = tc.compare_totals(40.0, 50.0)
    assert c["delta"] == pytest.approx(-10.0)
    assert "lower" in c["verdict"]


def test_compare_match_verdict():
    c = tc.compare_totals(47.80, 47.804)
    assert c["verdict"] == "API and local match"


# --------------------------------------------------------------------------
# Instrument resolution (pure match, no DB)
# --------------------------------------------------------------------------

def test_match_instrument_spaced_format():
    row = tc.match_instrument(ROWS, opt="CE", strike=23000, expiry_iso="2026-12-29")
    assert row is not None
    assert row["instrument_key"] == "NSE_FO|37806"


def test_match_instrument_pe():
    row = tc.match_instrument(ROWS, opt="PE", strike=23000, expiry_iso="2026-12-29")
    assert row is not None
    assert row["instrument_key"] == "NSE_FO|37810"


def test_match_instrument_no_match_returns_none():
    assert tc.match_instrument(ROWS, opt="CE", strike=99999, expiry_iso="2026-12-29") is None
    assert tc.match_instrument([], opt="CE", strike=23000, expiry_iso="2026-12-29") is None


def test_match_instrument_wrong_expiry_returns_none():
    # 2026-10-27 is not in the table — must NOT silently match another
    # expiry's contract (Upstox rejects stale keys with UDAPI100011).
    assert tc.match_instrument(ROWS, opt="CE", strike=23000, expiry_iso="2026-10-27") is None


def test_spaced_symbol_format():
    assert tc.spaced_symbol(23000, "CE", "2026-12-29") == "NIFTY 23000 CE 29 DEC 26"
    assert tc.db_expiry_label("2026-10-27") == "27 OCT 26"


# --------------------------------------------------------------------------
# CLI: --exit-price
# --------------------------------------------------------------------------

def _patch_charge_apis(monkeypatch):
    """Pretend the token/instrument/margin/brokerage calls all succeed."""
    calls = []

    monkeypatch.setattr(tc, "get_token", lambda: "token")
    monkeypatch.setattr(
        tc, "resolve_instrument",
        lambda headers, opt, strike, expiry: (
            {"instrument_key": "NSE_FO|1", "trading_symbol": "SYM"}, "chain"))
    monkeypatch.setattr(
        tc, "fetch_margin",
        lambda *a, **k: {"required_margin": 0.0, "final_margin": 0.0, "legs": []})

    def fake_brokerage(headers, key, qty, side, product, price):
        calls.append({"key": key, "qty": qty, "side": side, "product": product,
                      "price": price})
        return {"total": 10.0, "brokerage": 5.0, "stt": 1.0, "gst": 1.0,
                "stamp": 0.0, "exchange": 1.0, "clearing": 0.0, "ipft": 0.0,
                "sebi": 0.0}

    monkeypatch.setattr(tc, "fetch_brokerage", fake_brokerage)
    return calls


BASE_ARGV = ["--opt", "CE", "--strike", "23000", "--expiry", "2026-10-27",
             "--side", "SELL", "--qty", "65", "--price", "70.45", "--json"]


def test_parser_accepts_exit_price():
    args = tc.build_parser().parse_args(BASE_ARGV + ["--exit-price", "55.20"])
    assert args.exit_price == pytest.approx(55.20)
    assert tc.build_parser().parse_args(BASE_ARGV).exit_price is None


def test_main_prices_each_leg_at_its_own_premium(monkeypatch, capsys):
    calls = _patch_charge_apis(monkeypatch)

    assert tc.main(BASE_ARGV + ["--exit-price", "55.20"]) == 0

    result = json.loads(capsys.readouterr().out)
    assert result["exit_price"] == pytest.approx(55.20)
    assert result["flat_round_trip"] is False
    # opening leg sells at the entry, closing leg buys back at the exit
    assert [(c["side"], c["price"]) for c in calls] == [
        ("SELL", 70.45), ("BUY", 55.20)]
    # local costs use the same two premiums
    from options_paper.costs import option_round_trip_cost
    expected = option_round_trip_cost(70.45, 55.20, 65, is_short=True)["costs"]
    assert result["local_total"] == pytest.approx(expected)


def test_main_without_exit_price_flags_a_flat_round_trip(monkeypatch, capsys):
    calls = _patch_charge_apis(monkeypatch)

    assert tc.main(BASE_ARGV) == 0

    result = json.loads(capsys.readouterr().out)
    assert result["exit_price"] == pytest.approx(70.45)
    assert result["flat_round_trip"] is True
    assert calls[1]["price"] == pytest.approx(70.45)


def test_main_rejects_non_positive_exit_price(monkeypatch):
    calls = _patch_charge_apis(monkeypatch)
    assert tc.main(BASE_ARGV + ["--exit-price", "0"]) == 2
    assert calls == []  # validated before any network call
