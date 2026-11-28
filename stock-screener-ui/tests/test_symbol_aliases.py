"""Tests for trading.symbol_aliases.

Conventions: pure unit tests, no network, no production DB writes. Both the
alias file and the instrument universe are local tmp fixtures, so the module
runs identically in CI where the gitignored local data is absent.
"""

import json
import re
import sqlite3

import pytest

import trading.symbol_aliases as sa

# Fixture-only copy of the curated map; the loader is exercised on this file
# rather than on the developer's data/symbol_aliases.json.
ALIASES = {
    "PTC": "PTCIL",
    "PTC02": "PTCIL",
    "PTC03": "PTC",
    "WI11": "WHEELS",
    "UAM": "UNIMECH",
    "Z": "ETERNAL",
    "IA04": "INDIGO",
    "OC03": "PAYTM",
    "JIL01": "JSWINFRA",
    "NII02": "COFORGE",
    "PF14": "POLICYBZR",
    "MT15": "MTARTECH",
    "ST20": "STLTECH",
    "CGC01": "CROMPTON",
    "GH03": "MEDANTA",
    "MP22": "MANKIND",
    "MSW": "MSUMI",
    "HGE": "HCG",
    "YHT": "YATHARTH",
    "SWS": "SWSOLAR",
    "RE07": "RAJESHEXPO",
    "PFR": "ABFRL",
    "BPI02": "BERGEPAINT",
    "LFH": "LTF",
    "HFC": "HFCL",
    "Motherson Sumi Wiring India": "MSUMI",
    "Sterlite Technologies": "STLTECH",
}

# Fixture-only NSE_EQ universe, independent of the alias map: adding a target
# not listed here must fail the validation test.
NSE_EQ_SYMBOLS = frozenset({
    "RELIANCE", "TCS", "PTCIL", "PTC", "WHEELS", "UNIMECH", "ETERNAL",
    "INDIGO", "PAYTM", "JSWINFRA", "COFORGE", "POLICYBZR", "MTARTECH",
    "STLTECH", "CROMPTON", "MEDANTA", "MANKIND", "MSUMI", "HCG",
    "YATHARTH", "SWSOLAR", "RAJESHEXPO", "ABFRL", "BERGEPAINT", "LTF",
    "HFCL", "TMPV", "TMCV",
})


@pytest.fixture(autouse=True)
def alias_data(tmp_path, monkeypatch):
    """Load aliases from a tmp file: the checked-in/local one is not required."""
    path = tmp_path / "symbol_aliases.json"
    path.write_text(json.dumps({"aliases": ALIASES}), encoding="utf-8")
    monkeypatch.setattr(sa, "_ALIAS_PATH", path)
    sa.clear_cache()
    yield path
    sa.clear_cache()


@pytest.fixture()
def nse_eq_db(tmp_path):
    """Minimal read-only instrument DB replacing the gitignored local one."""
    path = tmp_path / "instruments.db"
    con = sqlite3.connect(path)
    try:
        con.execute("CREATE TABLE instruments (trading_symbol TEXT, segment TEXT)")
        con.executemany(
            "INSERT INTO instruments (trading_symbol, segment) VALUES (?, ?)",
            [(symbol, "NSE_EQ") for symbol in NSE_EQ_SYMBOLS],
        )
        con.commit()
    finally:
        con.close()
    return path


@pytest.fixture()
def strict(monkeypatch):
    """Deterministic instrument set, resolver cache reset."""
    monkeypatch.setattr(sa, "_fetch_instruments", lambda: (NSE_EQ_SYMBOLS, True))
    sa.clear_cache()
    yield
    sa.clear_cache()


@pytest.fixture()
def no_instruments(monkeypatch):
    """Instrument source unavailable: legacy pass-through mode."""
    monkeypatch.setattr(sa, "_fetch_instruments", lambda: (frozenset(), False))
    sa.clear_cache()
    yield
    sa.clear_cache()




@pytest.mark.parametrize("raw,expected", [
    ("PTC", "PTCIL"),
    ("ptc", "PTCIL"),          # case-insensitive
    ("NSE:PTC", "PTCIL"),      # exchange prefix stripped by shared normalizer
    ("PTC02", "PTCIL"),        # moneycontrol code, PTC Industries
    ("PTC03", "PTC"),          # moneycontrol code, PTC India
    ("WI11", "WHEELS"),        # moneycontrol code, Wheels India
    ("UAM", "UNIMECH"),        # moneycontrol code, Unimech Aerospace
    ("Z", "ETERNAL"),          # Zomato -> Eternal rename
    ("IA04", "INDIGO"),
    ("OC03", "PAYTM"),
    ("JIL01", "JSWINFRA"),
    ("NII02", "COFORGE"),
    ("PF14", "POLICYBZR"),
    ("MT15", "MTARTECH"),
    ("ST20", "STLTECH"),
    ("CGC01", "CROMPTON"),
    ("GH03", "MEDANTA"),
    ("MP22", "MANKIND"),
    ("MSW", "MSUMI"),
    ("HGE", "HCG"),
    ("YHT", "YATHARTH"),
    ("SWS", "SWSOLAR"),
    ("RE07", "RAJESHEXPO"),
    ("PFR", "ABFRL"),
    ("BPI02", "BERGEPAINT"),
    ("LFH", "LTF"),
    ("HFC", "HFCL"),
    ("Motherson Sumi Wiring India", "MSUMI"),
    ("Sterlite Technologies", "STLTECH"),
])
def test_known_aliases(strict, raw, expected):
    assert sa.resolve_symbol(raw) == expected


def test_exact_instruments_pass_through(strict):
    assert sa.resolve_symbol("RELIANCE") == "RELIANCE"
    assert sa.resolve_symbol("tcs") == "TCS"




@pytest.mark.parametrize("raw", [
    "TATAMOTORS",   # demerger: TMPV + TMCV, structurally ambiguous
    "MM",           # ET short code: M&M vs M&MFIN unclear
    "FEV",          # unverified code
    "SCREENER.IN",  # extractor noise
    "MORGAN STANLEY",
    "BRENT CRUDE",
    "ZZZ9",         # unknown
    "", "   ", None,
])
def test_ambiguous_leftovers_resolve_none(strict, raw):
    assert sa.resolve_symbol(raw) is None


@pytest.mark.parametrize("raw", [None, 123, 4.5, ["X"], {"a": 1}, object()])
def test_never_raises(strict, raw):
    assert sa.resolve_symbol(raw) in (None, "123", "4.5")


def test_fail_open_when_instruments_unavailable(no_instruments):
    # Legacy pass-through: unknown symbols keep normalized form ...
    assert sa.resolve_symbol("SOMEJUNK") == "SOMEJUNK"
    # ... while curated aliases still apply.
    assert sa.resolve_symbol("PTC") == "PTCIL"
    assert sa.resolve_symbol("") is None




def test_alias_map_hygiene(strict):
    m = sa.alias_map()
    assert len(m) >= 20
    assert sa.stats()["alias_collisions"] == 0
    for target in m.values():
        assert re.fullmatch(r"[A-Z0-9&.\- ]+", target), target
    # No cycles: single-hop lookup must terminate (PTC is legitimately both
    # a key and a value: PTC03 -> PTC -> PTCIL across separate lookups).
    for key, target in m.items():
        assert target != key, key
        assert m.get(target, target) != key or target == key, (key, target)
    # Mutating the copy does not affect the loader.
    m["X"] = "Y"
    assert "X" not in sa.alias_map()


def test_alias_targets_exist_in_nse_eq(nse_eq_db):
    """Curated targets must be present in the NSE_EQ universe fixture."""
    con = sqlite3.connect(f"file:{nse_eq_db}?mode=ro", uri=True)
    try:
        inst = {r[0] for r in con.execute(
            "SELECT UPPER(trading_symbol) FROM instruments "
            "WHERE segment='NSE_EQ'")}
    finally:
        con.close()
    missing = [t for t in sa.alias_map().values() if t not in inst]
    assert not missing, f"alias targets missing from NSE_EQ: {missing}"
