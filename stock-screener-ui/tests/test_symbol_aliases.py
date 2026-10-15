"""Tests for trading.symbol_aliases + its events-feed join wiring.

Conventions: pure unit tests, no network, no DB writes. Instrument data is
monkeypatched; one optional test validates curated targets against the local
SQLite file read-only and skips when the file is absent (CI).
"""

import re
import sqlite3
from pathlib import Path

import pytest

import api.reports_api.events_feed as ef
import trading.symbol_aliases as sa

INSTR = frozenset({
    "RELIANCE", "TCS", "PTCIL", "PTC", "WHEELS", "UNIMECH", "ETERNAL",
    "INDIGO", "PAYTM", "JSWINFRA", "COFORGE", "POLICYBZR", "MTARTECH",
    "STLTECH", "CROMPTON", "MEDANTA", "MANKIND", "MSUMI", "HCG",
    "YATHARTH", "SWSOLAR", "RAJESHEXPO", "ABFRL", "BERGEPAINT", "LTF",
    "HFCL", "TMPV", "TMCV",
})


@pytest.fixture()
def strict(monkeypatch):
    """Deterministic instrument set, resolver cache reset."""
    monkeypatch.setattr(sa, "_fetch_instruments", lambda: (INSTR, True))
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


# --- known curated aliases (seeded from news_symbol_mentions evidence) ---


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


# --- ambiguous / junk leftovers: precision over recall ---


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


# --- map hygiene ---


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


def test_alias_targets_exist_in_nse_eq():
    """Curated targets must be real NSE_EQ symbols (read-only, skips w/o DB)."""
    db_path = Path(__file__).resolve().parent.parent / "db" / "alphashri.db"
    if not db_path.exists():
        pytest.skip("no local DB file")
    try:
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    except Exception as exc:
        pytest.skip(f"cannot open DB read-only: {exc}")
    try:
        inst = {r[0] for r in con.execute(
            "SELECT UPPER(trading_symbol) FROM instruments "
            "WHERE segment='NSE_EQ'")}
    finally:
        con.close()
    if not inst:
        pytest.skip("no instruments in local DB")
    missing = [t for t in sa.alias_map().values() if t not in inst]
    assert not missing, f"alias targets missing from NSE_EQ: {missing}"


# --- join hit-rate improvement on a fixture (the V4 QIP cases) ---


def _row(i, day, sym, headline):
    return {"article_id": i, "headline": headline, "content": "",
            "source": "moneycontrol", "day": day, "symbol": sym, "name": sym}


def test_join_hit_rate_improvement(strict):
    rows = [
        _row(1, "2026-10-07", "PTC", "PTC Industries shares rise 7% after company launches QIP"),
        _row(2, "2026-09-24", "WI11", "Wheels India to raise Rs 250 crore through QIP"),
        _row(3, "2026-09-16", "UNIMECH", "Unimech Aerospace likely to launch Rs 750-crore QIP"),
        _row(4, "2026-09-16", "SCREENER.IN", "Screener.in market breadth notes"),
        _row(5, "2026-10-07", "RELIANCE", "Reliance launches QIP to fund retail expansion"),
    ]
    allowed = {"PTCIL", "WHEELS", "UNIMECH", "RELIANCE"}
    naive_hits = {r["symbol"] for r in rows if r["symbol"] in allowed}
    events = ef._news_to_events(rows, allowed, "2026-09-01", "2026-10-10")
    got = {(e["symbol"], e["kind"]) for e in events}
    assert naive_hits == {"UNIMECH", "RELIANCE"}
    assert got == {("PTCIL", "qip"), ("WHEELS", "qip"),
                   ("UNIMECH", "qip"), ("RELIANCE", "qip")}
    assert len(got) - len(naive_hits) == 2  # PTC + WI11 recovered, junk dropped
