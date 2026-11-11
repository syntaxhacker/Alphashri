"""chart_patterns.tags: F&O / ETF membership for watch and pattern rows.

Rules (verified against the NSE instruments file):
* ETF / fund unit  — segment NSE_EQ, instrument_type "EQ", ISIN starts with
  "INF" (SILVERBEES INF204KC1402, LIQUIDCASE INF0R8F01034,
  NIFTYBEES INF204KB14I2). Genuine companies are INE… (JETFREIGHT
  INE982V01025, SHANTIGOLD INE06ZD01017) — never name/ticker heuristics.
* F&O stock        — in get_universe("nse_fo") (218 equity underlyings).
* Instruments load once per path (lru_cache); any failure -> empty sets,
  never raises; unknown symbol -> [].
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from chart_patterns import universes
import chart_patterns.tags as tags_mod

_REAL_ETF = ("NIFTYBEES", "SILVERBEES", "LIQUIDCASE")
_REAL_COMPANY = ("JETFREIGHT", "SHANTIGOLD")  # INE ISINs, not ETFs
_REAL_FNO = ("RELIANCE", "TCS", "INFY", "ICICIBANK")


@pytest.fixture(autouse=True)
def _canonical_instruments_path():
    """Each test starts at the canonical instruments path with an empty tag
    cache; restored on teardown so later test files (watch / api) reload it."""
    universes.set_instruments_path(None)
    tags_mod._membership.cache_clear()
    yield
    universes.set_instruments_path(None)
    tags_mod._membership.cache_clear()


def _write_tmp_instruments(tmp_path: Path, records: list[dict]) -> Path:
    p = tmp_path / "instruments.json"
    p.write_text(json.dumps(records), encoding="utf-8")
    return p


def _use_tmp_instruments(monkeypatch, tmp_path: Path, records: list[dict]) -> Path:
    path = _write_tmp_instruments(tmp_path, records)
    universes.set_instruments_path(path)
    tags_mod._membership.cache_clear()
    return path


# ---------------------------------------------------------------------------
# Detection rules on the real instruments file
# ---------------------------------------------------------------------------


def test_real_file_counts_match_verified_rules():
    """218 F&O equity underlyings, 359 ETF/fund units (INF ISINs), disjoint."""
    fno = tags_mod.fno_symbols()
    etf = tags_mod.etf_symbols()
    assert len(fno) == 218
    assert len(etf) == 359
    assert not (fno & etf)  # no symbol is both on the real file


def test_etf_detected_by_inf_isin_never_by_name():
    for sym in _REAL_ETF:
        assert tags_mod.is_etf(sym) is True
        assert tags_mod.is_fno(sym) is False
        assert tags_mod.tags_for(sym) == ["ETF"]
        assert tags_mod.tags_for(sym.lower()) == ["ETF"]  # case-insensitive
    assert "NIFTYBEES" in tags_mod.etf_symbols()
    assert "SILVERBEES" in tags_mod.etf_symbols()
    assert "LIQUIDCASE" in tags_mod.etf_symbols()


def test_genuine_company_with_ine_isin_is_not_etf():
    for sym in _REAL_COMPANY:
        assert tags_mod.is_etf(sym) is False
        assert tags_mod.is_fno(sym) is False
        assert tags_mod.tags_for(sym) == []
    assert "JETFREIGHT" not in tags_mod.etf_symbols()
    assert "SHANTIGOLD" not in tags_mod.etf_symbols()


def test_fno_membership_is_case_insensitive():
    for sym in _REAL_FNO:
        assert tags_mod.is_fno(sym) is True
        assert tags_mod.tags_for(sym) == ["F&O"]
        assert tags_mod.tags_for(sym.lower()) == ["F&O"]
        assert tags_mod.tags_for(sym.title()) == ["F&O"]
    assert "RELIANCE" in tags_mod.fno_symbols()
    assert "AAA" not in tags_mod.fno_symbols()


def test_unknown_symbol_returns_empty():
    assert tags_mod.tags_for("NOPE_SYMBOL_X") == []
    assert tags_mod.tags_for("") == []
    assert tags_mod.tags_for(None) == []  # str()'d, never raises


# ---------------------------------------------------------------------------
# Both tags, caching, failure modes
# ---------------------------------------------------------------------------


def test_symbol_in_both_universes_gets_both_tags(tmp_path, monkeypatch):
    _use_tmp_instruments(monkeypatch, tmp_path, [
        {"segment": "NSE_FO", "underlying_type": "EQUITY",
         "underlying_symbol": "DUAL"},
        {"segment": "NSE_EQ", "instrument_type": "EQ", "isin": "INF9DUAL0000",
         "trading_symbol": "DUAL"},
    ])
    assert tags_mod.tags_for("DUAL") == ["F&O", "ETF"]
    assert tags_mod.tags_for("dual") == ["F&O", "ETF"]


def test_instruments_parsed_once_per_path(tmp_path, monkeypatch):
    """The file is read+parsed exactly once regardless of how many tag
    lookups follow; repeats hit the cache."""
    _use_tmp_instruments(monkeypatch, tmp_path, [
        {"segment": "NSE_FO", "underlying_type": "EQUITY",
         "underlying_symbol": "STOCK1"},
        {"segment": "NSE_EQ", "instrument_type": "EQ", "isin": "INF0ABCD1234",
         "trading_symbol": "ETF1"},
    ])
    before = tags_mod._membership.cache_info()
    tags_mod.fno_symbols()
    tags_mod.etf_symbols()
    tags_mod.tags_for("STOCK1")
    tags_mod.tags_for("etf1")
    tags_mod.is_fno("STOCK1")
    tags_mod.is_etf("ETF1")
    after = tags_mod._membership.cache_info()
    assert after.misses == before.misses + 1   # exactly one parse
    assert after.hits == before.hits + 7        # remaining seven calls cached
    assert tags_mod.fno_symbols() == frozenset({"STOCK1"})
    assert tags_mod.etf_symbols() == frozenset({"ETF1"})


def test_return_types_are_frozensets():
    assert isinstance(tags_mod.fno_symbols(), frozenset)
    assert isinstance(tags_mod.etf_symbols(), frozenset)
    assert isinstance(tags_mod.tags_for("RELIANCE"), list)


def test_missing_or_bad_instruments_file_never_raises(tmp_path, monkeypatch):
    universes.set_instruments_path(tmp_path / "does_not_exist.json")
    tags_mod._membership.cache_clear()
    assert tags_mod.fno_symbols() == frozenset()
    assert tags_mod.etf_symbols() == frozenset()
    assert tags_mod.tags_for("RELIANCE") == []
    assert tags_mod.tags_for("NIFTYBEES") == []
    assert tags_mod.is_fno("RELIANCE") is False
    assert tags_mod.is_etf("NIFTYBEES") is False

    garbage = tmp_path / "garbage.json"
    garbage.write_text("{not valid json", encoding="utf-8")
    universes.set_instruments_path(garbage)
    tags_mod._membership.cache_clear()
    assert tags_mod.tags_for("ANYTHING") == []


# ---------------------------------------------------------------------------
# Symbol normalization (shared helper)
# ---------------------------------------------------------------------------


def test_norm_symbol_case_and_blank():
    from chart_patterns._symbols import norm_symbol, norm_symbols

    assert norm_symbol("reliance") == "RELIANCE"
    assert norm_symbol(" RELIANCE ") == "RELIANCE"
    assert norm_symbol("RELIANCE") == "RELIANCE"
    assert norm_symbol(None) == ""
    assert norm_symbol("") == ""
    assert norm_symbols(["reliance", " tcs ", None, "", "TCS"]) == ["RELIANCE", "TCS", "TCS"]
