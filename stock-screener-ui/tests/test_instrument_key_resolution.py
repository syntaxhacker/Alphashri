"""Instrument-key resolution for non-EQ NSE equity series.

The strict ``EQ`` pass is the first choice. Every other tradeable NSE_EQ series
(SME, trade-to-trade, InvIT/REIT units, part-paid) needs the fallback, otherwise
its chart returns ``no_data``. Government paper must never resolve through it —
a bond key in an equity path is worse than a missing one.
"""

from __future__ import annotations

import sys
import threading
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import pytest

_UI_DIR = Path(__file__).resolve().parent.parent
_ROOT = _UI_DIR.parent
for _p in (str(_ROOT), str(_UI_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import upstox_trader.config_and_utils.upstox_api as upstox_api_module
from upstox_trader.brokers.upstox.mapping import UpstoxSymbolMap
from upstox_trader.config_and_utils.upstox_api import (
    EQUITY_FALLBACK_TYPES,
    UpstoxAPI,
)

# type -> (symbol, key) taken from the real NSE instrument master.
REAL_LISTINGS = {
    "SM": ("PRIZOR", "NSE_EQ|INE0V9N01017"),
    "ST": ("KLL", "NSE_EQ|INE0Q2V01012"),
    "SZ": ("PERFECT", "NSE_EQ|INE925S01012"),
    "IV": ("CUBEINVIT", "NSE_EQ|INE0NR623014"),
    "RR": ("MINDSPACE", "NSE_EQ|INE0CCU25019"),
    "E1": ("ATLPP", "NSE_EQ|IN90NN701011"),
    "BE": ("QUINTEGRA", "NSE_EQ|INE033B01011"),
    "BZ": ("CRSL", "NSE_EQ|INE716D01033"),
}


@pytest.fixture(autouse=True)
def _no_symbol_validator():
    """Keep the resolver hermetic — the real validator blacklists synthetic tickers."""
    with patch.object(upstox_api_module, "get_valid_symbol", lambda s: str(s).upper()):
        yield


def _row(symbol: str, key: str, instrument_type: str, segment: str = "NSE_EQ") -> dict:
    return {
        "trading_symbol": symbol,
        "instrument_key": key,
        "instrument_type": instrument_type,
        "segment": segment,
    }


def _api(*rows: dict) -> UpstoxAPI:
    api = UpstoxAPI.__new__(UpstoxAPI)
    api.instruments = list(rows)
    api.quiet = True
    return api


# Deliberately test-owned rather than derived from EQUITY_FALLBACK_TYPES: a type
# dropped from the constant must surface as a failure on its own case, not
# vanish with the parametrisation.
@pytest.mark.parametrize("instrument_type", sorted(REAL_LISTINGS))
def test_non_eq_equity_series_resolve_through_the_fallback(instrument_type):
    symbol, key = REAL_LISTINGS[instrument_type]
    assert _api(_row(symbol, key, instrument_type)).get_instrument_key(symbol) == key


def test_the_covered_types_are_exactly_the_equity_series():
    assert set(EQUITY_FALLBACK_TYPES) == {"BE", "BZ", "SM", "ST", "SZ", "IV", "RR", "E1"}


@pytest.mark.parametrize("instrument_type", ["SG", "GS", "TB"])
def test_government_paper_never_resolves_through_the_equity_fallback(instrument_type):
    api = _api(_row("883GS2041", "NSE_EQ|IN0020110063", instrument_type))
    assert api.get_instrument_key("883GS2041") is None


def test_eq_still_wins_when_the_symbol_is_listed_as_both():
    api = _api(
        _row("DUALLISTED", "NSE_EQ|SMESERIES", "SM"),
        _row("DUALLISTED", "NSE_EQ|MAINSERIES", "EQ"),
    )
    assert api.get_instrument_key("DUALLISTED") == "NSE_EQ|MAINSERIES"


def test_fallback_is_scoped_to_the_requested_exchange():
    api = _api(_row("PRIZOR", "NSE_EQ|INE0V9N01017", "SM"))
    assert api.get_instrument_key("PRIZOR", exchange="BSE_EQ") is None


def test_sme_row_in_a_non_nse_segment_does_not_resolve():
    api = _api(_row("PRIZOR", "BSE_EQ|INE0V9N01017", "SM", segment="BSE_EQ"))
    assert api.get_instrument_key("PRIZOR") is None


# Frozen copies of the two pre-index linear scans. They are the parity oracle:
# an indexed implementation must agree with them on every case below.
_SUFFIXES = (".E1", ".EQ", "-EQ", "EQ", ".NS", ".BO", "-NS", "-BO")


def _legacy_resolve_token(instruments, symbol, exchange="NSE_EQ"):
    clean = symbol.upper().strip()
    for suffix in _SUFFIXES:
        if clean.endswith(suffix):
            clean = clean[: -len(suffix)]
            break

    for inst in instruments:
        if (
            inst.get("trading_symbol") == clean
            and inst.get("segment") == exchange
            and inst.get("instrument_type") == "EQ"
        ):
            return inst.get("instrument_key")

    for inst in instruments:
        if inst.get("trading_symbol") == clean and inst.get(
            "instrument_type"
        ) in ("EQ", "INDEX"):
            return inst.get("instrument_key")

    return None


def _legacy_get_instrument_key(
    instruments,
    symbol,
    exchange="NSE_EQ",
    instrument_type="EQ",
    expiry_date=None,
    strike_price=None,
    option_type=None,
):
    from chart_patterns.indices import INDEX_KEYS

    if instrument_type in ("EQ", "INDEX"):
        static = INDEX_KEYS.get(str(symbol).strip().upper())
        if static:
            return static

    clean_symbol = upstox_api_module.get_valid_symbol(symbol)
    if not clean_symbol:
        return None
    if not instruments:
        return None

    for instrument in instruments:
        if instrument_type in ("EQ", "INDEX"):
            segment = "NSE_INDEX" if instrument_type == "INDEX" else exchange
            if (
                instrument.get("trading_symbol") == clean_symbol
                and instrument.get("segment") == segment
                and instrument.get("instrument_type") == instrument_type
            ):
                return instrument.get("instrument_key")
        elif instrument_type in ("CE", "PE"):
            expiry_ts = instrument.get("expiry")
            if (
                instrument.get("name") == symbol
                and instrument.get("instrument_type") == option_type
                and instrument.get("strike_price") == strike_price
                and expiry_ts
                and datetime.fromtimestamp(expiry_ts / 1000).strftime("%Y-%m-%d")
                == expiry_date
            ):
                return instrument.get("instrument_key")

    if instrument_type == "EQ":
        for instrument in instruments:
            if (
                instrument.get("trading_symbol") == clean_symbol
                and instrument.get("segment") == exchange
                and instrument.get("instrument_type")
                in upstox_api_module.EQUITY_FALLBACK_TYPES
            ):
                return instrument.get("instrument_key")

    return None


def _symbol_map(*rows: dict) -> UpstoxSymbolMap:
    mapping = UpstoxSymbolMap.__new__(UpstoxSymbolMap)
    mapping._instruments = list(rows)
    return mapping


def _option_row(name: str, key: str, option_type: str, strike: float, expiry_ms: int):
    return {
        "trading_symbol": name,
        "name": name,
        "instrument_key": key,
        "instrument_type": option_type,
        "segment": "NSE_FO",
        "strike_price": strike,
        "expiry": expiry_ms,
    }


EXPIRY_DATE = "2026-11-27"
EXPIRY_MS = int(datetime(2026, 11, 27).timestamp() * 1000)


@pytest.mark.parametrize(
    "label,rows,symbol,expected",
    [
        ("eq_only", [_row("AAA", "KEY/EQ", "EQ")], "AAA", "KEY/EQ"),
        (
            "eq_wins_over_fallback",
            [_row("AAA", "KEY/SM", "SM"), _row("AAA", "KEY/EQ", "EQ")],
            "AAA",
            "KEY/EQ",
        ),
        ("missing_symbol", [_row("BBB", "KEY/B", "EQ")], "AAA", None),
        ("suffix_stripped", [_row("AAA", "KEY/EQ", "EQ")], "AAA.EQ", "KEY/EQ"),
        (
            "exchange_scoped_sm",
            [_row("AAA", "KEY/SM", "SM", segment="BSE_EQ")],
            "AAA",
            None,
        ),
        (
            "first_duplicate_wins",
            [_row("AAA", "KEY/FIRST", "EQ"), _row("AAA", "KEY/SECOND", "EQ")],
            "AAA",
            "KEY/FIRST",
        ),
        (
            "first_match_without_key_returns_none",
            [
                {**_row("AAA", "KEY/FIRST", "EQ"), "instrument_key": None},
                _row("AAA", "KEY/SECOND", "EQ"),
            ],
            "AAA",
            None,
        ),
        (
            "index_fallback_ignores_segment",
            [_row("AAA", "KEY/INDEX", "INDEX", segment="NSE_INDEX")],
            "AAA",
            "KEY/INDEX",
        ),
        (
            "eq_fallback_ignores_segment",
            [_row("AAA", "KEY/BSE", "EQ", segment="BSE_EQ")],
            "AAA",
            "KEY/BSE",
        ),
    ],
    ids=lambda value: value if isinstance(value, str) else "",
)
def test_resolve_token_cases_match_legacy(label, rows, symbol, expected):
    mapping = _symbol_map(*rows)
    assert mapping.resolve_token(symbol) == expected
    assert mapping.resolve_token(symbol) == _legacy_resolve_token(rows, symbol)


def test_resolve_token_exchange_scope_and_list_replacement():
    original = [_row("AAA", "KEY/NSE", "EQ")]
    mapping = _symbol_map(*original)
    assert mapping.resolve_token("AAA") == "KEY/NSE"
    assert mapping.resolve_token("AAA", exchange="BSE_EQ") == "KEY/NSE"
    assert _legacy_resolve_token(original, "AAA", exchange="BSE_EQ") == "KEY/NSE"
    assert mapping.resolve_token("AAA", exchange="BSE_EQ") == _legacy_resolve_token(
        original, "AAA", exchange="BSE_EQ"
    )

    replacement = [_row("AAA", "KEY/REPLACED", "EQ")]
    mapping._instruments = replacement
    assert mapping.resolve_token("AAA") == "KEY/REPLACED"
    assert mapping.resolve_token("AAA") == _legacy_resolve_token(replacement, "AAA")


@pytest.mark.parametrize(
    "label,rows,symbol,kwargs,expected",
    [
        ("eq_only", [_row("AAA", "KEY/EQ", "EQ")], "AAA", {}, "KEY/EQ"),
        (
            "eq_wins_over_fallback",
            [_row("AAA", "KEY/SM", "SM"), _row("AAA", "KEY/EQ", "EQ")],
            "AAA",
            {},
            "KEY/EQ",
        ),
        ("missing_symbol", [_row("BBB", "KEY/B", "EQ")], "AAA", {}, None),
        (
            "exchange_scoped_sm",
            [_row("AAA", "KEY/SM", "SM", segment="BSE_EQ")],
            "AAA",
            {},
            None,
        ),
        (
            "exchange_scoped_sm_hit",
            [_row("AAA", "KEY/SM", "SM", segment="BSE_EQ")],
            "AAA",
            {"exchange": "BSE_EQ"},
            "KEY/SM",
        ),
        (
            "government_paper",
            [_row("AAA", "KEY/SG", "SG")],
            "AAA",
            {},
            None,
        ),
        (
            "first_duplicate_wins",
            [_row("AAA", "KEY/FIRST", "EQ"), _row("AAA", "KEY/SECOND", "EQ")],
            "AAA",
            {},
            "KEY/FIRST",
        ),
        (
            "first_match_without_key_returns_none",
            [
                {**_row("AAA", None, "EQ"), "instrument_key": None},
                _row("AAA", "KEY/SECOND", "EQ"),
            ],
            "AAA",
            {},
            None,
        ),
        (
            "index_strict_segment",
            [_row("AAA", "KEY/INDEX", "INDEX", segment="NSE_INDEX")],
            "AAA",
            {"instrument_type": "INDEX"},
            "KEY/INDEX",
        ),
        (
            "index_wrong_segment",
            [_row("AAA", "KEY/INDEX", "INDEX", segment="NSE_EQ")],
            "AAA",
            {"instrument_type": "INDEX"},
            None,
        ),
        (
            "option_first_match",
            [
                _option_row("OPT", "KEY/CE/FIRST", "CE", 24000.0, EXPIRY_MS),
                _option_row("OPT", "KEY/CE/SECOND", "CE", 24000.0, EXPIRY_MS),
            ],
            "OPT",
            {
                "instrument_type": "CE",
                "expiry_date": EXPIRY_DATE,
                "strike_price": 24000.0,
                "option_type": "CE",
            },
            "KEY/CE/FIRST",
        ),
    ],
    ids=lambda value: value if isinstance(value, str) else "",
)
def test_get_instrument_key_cases_match_legacy(label, rows, symbol, kwargs, expected):
    api = _api(*rows)
    live = api.get_instrument_key(symbol, **kwargs)
    assert live == expected
    assert live == _legacy_get_instrument_key(rows, symbol, **kwargs)


def test_get_instrument_key_suffix_stripped():
    rows = [_row("AAA", "KEY/EQ", "EQ")]

    def _clean(symbol):
        return str(symbol).upper().removesuffix(".EQ")

    with patch.object(upstox_api_module, "get_valid_symbol", _clean):
        live = _api(*rows).get_instrument_key("AAA.EQ")
        assert live == "KEY/EQ"
        assert live == _legacy_get_instrument_key(rows, "AAA.EQ")


def test_get_instrument_key_force_refresh_rebuilds_index():
    original = [_row("AAA", "KEY/OLD", "EQ")]
    refreshed = [_row("AAA", "KEY/NEW", "EQ")]
    api = _api(*original)
    assert api.get_instrument_key("AAA") == "KEY/OLD"

    def _download(self):
        self.instruments = list(refreshed)

    with patch.object(UpstoxAPI, "_download_and_cache_instruments", _download):
        live = api.get_instrument_key("AAA", force_refresh=True)
    assert live == "KEY/NEW"
    assert live == _legacy_get_instrument_key(refreshed, "AAA")


def test_get_instrument_key_rebuilt_when_list_is_replaced():
    original = [_row("AAA", "KEY/OLD", "EQ")]
    api = _api(*original)
    assert api.get_instrument_key("AAA") == "KEY/OLD"

    replacement = [_row("AAA", "KEY/NEW", "EQ")]
    api.instruments = replacement
    live = api.get_instrument_key("AAA")
    assert live == "KEY/NEW"
    assert live == _legacy_get_instrument_key(replacement, "AAA")


def test_resolve_token_parity_matrix_reuses_cached_index():
    rows = [
        _row("AAA", "KEY/A/EQ", "EQ"),
        _row("AAA", "KEY/A/SM", "SM"),
        _row("AAA", "KEY/A/BSE", "EQ", segment="BSE_EQ"),
        _row("AAA", "KEY/A/INDEX", "INDEX", segment="NSE_INDEX"),
        _row("BBB", "KEY/B/EQ", "EQ"),
        {**_row("CCC", None, "EQ"), "instrument_key": None},
    ]
    mapping = _symbol_map(*rows)
    for symbol in ("AAA", "aaa.EQ", "BBB", "CCC", "DDD", "  AAA  "):
        for exchange in ("NSE_EQ", "BSE_EQ", "NSE_INDEX"):
            live = mapping.resolve_token(symbol, exchange=exchange)
            expected = _legacy_resolve_token(rows, symbol, exchange=exchange)
            assert live == expected, (symbol, exchange, live, expected)


def test_get_instrument_key_parity_matrix_reuses_cached_index():
    rows = [
        _row("AAA", "KEY/A/EQ", "EQ"),
        _row("AAA", "KEY/A/SM", "SM"),
        _row("AAA", "KEY/A/BSE", "EQ", segment="BSE_EQ"),
        _row("AAA", "KEY/A/INDEX", "INDEX", segment="NSE_INDEX"),
        _row("BBB", "KEY/B/EQ", "EQ"),
        {**_row("CCC", None, "EQ"), "instrument_key": None},
        _option_row("OPT", "KEY/OPT/CE", "CE", 24000.0, EXPIRY_MS),
    ]
    api = _api(*rows)
    for symbol in ("AAA", "BBB", "CCC", "DDD", "", "OPT"):
        for instrument_type in ("EQ", "INDEX", "SM", "CE", "SG", None):
            for exchange in ("NSE_EQ", "BSE_EQ"):
                live = api.get_instrument_key(
                    symbol,
                    exchange=exchange,
                    instrument_type=instrument_type,
                    expiry_date=EXPIRY_DATE,
                    strike_price=24000.0,
                    option_type="CE",
                )
                expected = _legacy_get_instrument_key(
                    rows,
                    symbol,
                    exchange=exchange,
                    instrument_type=instrument_type,
                    expiry_date=EXPIRY_DATE,
                    strike_price=24000.0,
                    option_type="CE",
                )
                assert live == expected, (symbol, instrument_type, exchange, live, expected)


class _CountingList(list):
    def __init__(self, rows):
        super().__init__(rows)
        self.iterations = 0

    def __iter__(self):
        self.iterations += 1
        return super().__iter__()


def test_resolve_token_indexes_once_per_list():
    instruments = _CountingList([_row("AAA", "KEY/OLD", "EQ")])
    mapping = UpstoxSymbolMap.__new__(UpstoxSymbolMap)
    mapping._instruments = instruments
    for _ in range(5):
        assert mapping.resolve_token("AAA") == "KEY/OLD"
    assert instruments.iterations == 1

    replacement = _CountingList([_row("AAA", "KEY/NEW", "EQ")])
    mapping._instruments = replacement
    assert mapping.resolve_token("AAA") == "KEY/NEW"
    assert replacement.iterations == 1


def test_get_instrument_key_indexes_once_per_list():
    instruments = _CountingList([_row("AAA", "KEY/OLD", "EQ")])
    api = _api()
    api.instruments = instruments
    for _ in range(5):
        assert api.get_instrument_key("AAA") == "KEY/OLD"
    assert instruments.iterations == 1

    replacement = _CountingList([_row("AAA", "KEY/NEW", "EQ")])
    api.instruments = replacement
    assert api.get_instrument_key("AAA") == "KEY/NEW"
    assert replacement.iterations == 1


_THREADS = 20
_MASTER_SIZE = 300_000


@pytest.mark.parametrize("resolver", ["get_instrument_key", "resolve_token"])
def test_cold_index_is_built_once_under_concurrent_lookups(resolver):
    """A cold master shared by many workers must be indexed exactly once."""
    instruments = _CountingList(
        _row(f"SYM{i:05d}", f"NSE_EQ|KEY{i}", "EQ") for i in range(_MASTER_SIZE)
    )
    if resolver == "get_instrument_key":
        api = _api()
        api.instruments = instruments
        lookup = lambda i: api.get_instrument_key(f"SYM{i:05d}")
    else:
        mapping = UpstoxSymbolMap.__new__(UpstoxSymbolMap)
        mapping._instruments = instruments
        lookup = lambda i: mapping.resolve_token(f"SYM{i:05d}")

    barrier = threading.Barrier(_THREADS)
    results: list = [None] * _THREADS
    errors: list = []

    def worker(index: int):
        try:
            barrier.wait(timeout=10)
            results[index] = lookup(index)
        except BaseException as exc:
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(_THREADS)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert not errors
    assert not any(thread.is_alive() for thread in threads)
    assert instruments.iterations == 1
    assert results == [f"NSE_EQ|KEY{i}" for i in range(_THREADS)]


class _ExplodingLock:
    def __enter__(self):
        raise AssertionError("index lock acquired on a cache hit")

    def __exit__(self, *exc):
        return False


@pytest.mark.parametrize(
    "resolver,owner,cache_attr",
    [
        ("get_instrument_key", UpstoxAPI, "_instrument_index_cache"),
        ("resolve_token", UpstoxSymbolMap, "_token_index"),
    ],
)
def test_cache_hits_never_acquire_the_index_lock(resolver, owner, cache_attr):
    rows = [_row("AAA", "KEY/EQ", "EQ")]
    if resolver == "get_instrument_key":
        target = _api(*rows)
        lookup = lambda: target.get_instrument_key("AAA")
    else:
        target = _symbol_map(*rows)
        lookup = lambda: target.resolve_token("AAA")

    assert lookup() == "KEY/EQ"
    assert getattr(target, cache_attr) is not None

    with patch.object(owner, "_INDEX_LOCK", _ExplodingLock()):
        for _ in range(5):
            assert lookup() == "KEY/EQ"
