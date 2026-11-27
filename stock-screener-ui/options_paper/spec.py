"""Real-world contract and charge specification for option paper trading.

Every number here is either read from the repo's own live broker master or
fetched from the broker's published charge list. Nothing is recalled.

Sources
-------
Lot sizes
    ``db/alphashri.db`` table ``instruments`` (the Upstox instrument master as
    synced into this repo, rows created 2026-05-23). NIFTY's value is
    independently corroborated by ``api/options.py``, whose comment records that
    23 consecutive real exchange prints were exact multiples of 65.
    NOTE: the options *research* engine (``reports/OPTIONS_REAL_5Y/opteng.py``)
    used ``LOT=75``. Both are recorded here; ``DEFAULT_LOT_POLICY`` documents
    which one this sandbox trades with and why.

Charges
    Upstox "Brokerage Charges" page, fetched 2026-10-18. Rates are the ones in
    force from **1 April 2026** (STT) and **1 March 2026** (NSE transaction
    charges). Cross-checked against Zerodha's published options schedule.

Sessions
    ``trading/utils.py`` — ``MARKET_CLOSE`` / ``CONTINUOUS_CLOSE`` / ``FORCE_EXIT``.
"""

from __future__ import annotations

import re
import time as _time
from dataclasses import dataclass, asdict
from datetime import date, datetime, time

# --------------------------------------------------------------------------
# Sessions (all IST)
# --------------------------------------------------------------------------
MARKET_OPEN = time(9, 15)
MARKET_CLOSE = time(15, 40)
CONTINUOUS_CLOSE = time(15, 15)
FORCE_EXIT = time(15, 10)          # global safety-net exit used by the equity bot
DEFAULT_EOD_EXIT = time(15, 10)    # paper options: flatten here unless a strategy overrides

# --------------------------------------------------------------------------
# Lot sizes  (units per lot)
# --------------------------------------------------------------------------
# Index derivatives — from the instruments master.
INDEX_LOTS: dict[str, int] = {
    "NIFTY": 65,
    "BANKNIFTY": 30,
    "FINNIFTY": 60,
    "MIDCPNIFTY": 120,
    "NIFTYNXT50": 25,
    "SENSEX": 20,          # BSE
}

# A handful of liquid F&O underlyings the sandbox may trade.
# Names here are the *display* names; ``symbol`` is the tradable alias.
STOCK_LOTS: dict[str, int] = {
    # IRFC's 23-Nov-26 F&O series: lot 5,425 units (the broker master synced in
    # May 2026 has no NSE_FO row for IRFC, so this is sourced from the recorded
    # contract in scripts/market/irfc_90ce_research.py, not guessed).
    "IRFC": 5425,
    "RELIANCE": 500,
    "HDFCBANK": 550,
    "ICICIBANK": 700,
    "INFY": 400,
    "TCS": 175,
    "ITC": 1600,
    "LT": 175,
    "KOTAKBANK": 2000,
    "SBIN": 750,
    "AXISBANK": 625,
    "MARUTI": 50,
    "BAJFINANCE": 750,
    "HINDUNILVR": 300,
    "BHARTIARTL": 950,
    "TATAMOTORS": 800,
    "WIPRO": 3000,
}

# The instruments master stores some stock names differently from the tradable
# alias. Map alias -> the exact string used in ``instruments.name`` so a lot
# lookup can fall back to the live master.
MASTER_NAME_HINTS: dict[str, str] = {
    "HDFCBANK": "HDFC BANK",
    "ICICIBANK": "ICICI BANK",
    "INFY": "INFOSYS",
    "TCS": "TATA CONSULTANCY",
    "LT": "LARSEN",
    "KOTAKBANK": "KOTAK MAHINDRA",
    "SBIN": "STATE BANK",
    "AXISBANK": "AXIS BANK",
    "BAJFINANCE": "BAJAJ FINANCE",
    "HINDUNILVR": "HINDUSTAN UNILEVER",
    "BHARTIARTL": "BHARTI AIRTEL",
    "TATAMOTORS": "TATA MOTORS",
}

# Which lot convention the sandbox trades with. See module docstring for the
# 65-vs-75 discrepancy on NIFTY.
DEFAULT_LOT_POLICY = "master"     # "master" (instrument table) | "report" (opteng LOT=75)
REPORT_LOT_OVERRIDE: dict[str, int] = {"NIFTY": 75}

# Tick sizes (minimum premium increment), from the instruments master / NSE.
TICK_SIZES: dict[str, float] = {
    "NIFTY": 0.05,
    "BANKNIFTY": 0.05,
    "FINNIFTY": 0.05,
    "MIDCPNIFTY": 0.05,
    "SENSEX": 0.05,
}

# --------------------------------------------------------------------------
# Charges  (Upstox, in force 2026)
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Charges:
    """Per-order option charges. All rates are fractions of *premium* value."""
    brokerage_per_order: float = 30.0      # flat ₹30 / executed order (verified vs Upstox /charges/brokerage 2026-10-21)
    stt_sell_pct: float = 0.0015           # 0.15% of sell premium (from 1 Apr 2026)
    stt_exercise_pct: float = 0.0015       # 0.15% of intrinsic if exercised/assigned
    exch_txn_pct: float = 0.0003553        # NSE 0.03553% of premium, both sides (from 1 Mar 2026)
    sebi_pct: float = 1e-6                 # ₹10 / crore
    stamp_buy_pct: float = 0.00003         # 0.003% of buy premium
    ipft_pct: float = 5e-6                 # ₹0.50 / lakh of premium (options)
    gst_pct: float = 0.18                  # on brokerage + txn + sebi + ipft

    def as_dict(self) -> dict:
        return asdict(self)


CHARGES = Charges()

# Margin approximation for **naked short** options (SPAN + exposure). The real
# figure comes from Upstox's margin API; this is only used to sanity-check that
# a short-premium strategy has enough capital and to size it conservatively.
SELL_MARGIN_PCT_OF_NOTIONAL = 0.13     # ~13% of contract notional, typical index-weekly
SELL_MARGIN_MIN_PER_LOT = 6000.0       # floor per lot


# --------------------------------------------------------------------------
# Universe
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Instrument:
    symbol: str          # tradable alias, e.g. "NIFTY"
    kind: str            # "index" | "stock"
    lot: int
    tick: float


def get_lot(symbol: str, policy: str | None = None) -> int:
    """Lot size for ``symbol`` under the configured policy.

    Precedence (first match wins; a lot is never invented):

    1. ``REPORT_LOT_OVERRIDE`` when ``policy == "report"``.
    2. Static ``INDEX_LOTS`` / ``STOCK_LOTS`` — authoritative when present, so
       NIFTY stays 65 and IRFC stays 5425 regardless of what any fetch returns.
    3. The CURRENT expiry's lot from the live Upstox ``/option/contract``
       listing (``api.options_underlying``'s cached listing, or one read-only
       fetch on a cold cache). Exchanges re-lot a series at rollover: KAYNES is
       150 now while the master still carries a 100-lot 2026 series, CROMPTON is
       2150 (2325 only in Jan/Feb) and TATAELXSI is 125 (175 in Jan/Feb). The
       default/first upcoming expiry is the one an order trades, so that is the
       lot used — not the smallest number found in a historical master row.
    4. The instruments master (read-only) for offline/CI environments. Both
       ``trading_symbol`` and ``name`` are searched (``name`` is empty for some
       NSE_FO rows, e.g. HINDZINC), and when several historical lots share a
       symbol the NEWEST expiry encoded in ``trading_symbol`` (e.g.
       ``28 JUL 26``) wins over the minimum lot.

    Unknown symbols raise ``KeyError``.
    """
    policy = policy or DEFAULT_LOT_POLICY
    sym = symbol.upper()
    if policy == "report" and sym in REPORT_LOT_OVERRIDE:
        return REPORT_LOT_OVERRIDE[sym]
    if sym in INDEX_LOTS:
        return INDEX_LOTS[sym]
    if sym in STOCK_LOTS:
        return STOCK_LOTS[sym]
    lot = _live_expiry_lot(sym)
    if lot:
        return lot
    lot = _lookup_master_lot(sym)
    if lot:
        return lot
    raise KeyError(f"unknown lot size for {symbol!r}")


def _live_expiry_lot(symbol: str) -> int | None:
    """Lot of the default expiry in the live contract listing (never guessed)."""
    return _lot_from_listing(_live_listing(symbol))


def _lot_from_listing(listing) -> int | None:
    """Lot of the default (nearest upcoming) expiry in a contract ``listing``.

    ``listing`` uses the ``api.options_underlying._listing`` shape — entries
    with ``date`` (ISO) and ``lot_size``, sorted oldest-first. Past expiries are
    skipped (today only after the 15:40 derivatives close, matching that
    module's ``default_expiry`` rule); a zero/missing lot is skipped, never
    invented. If every listed expiry is past, the latest one is used — it is
    still authoritative broker data, unlike a guess.
    """
    try:
        import config
        now = datetime.now(config.IST)
    except Exception:
        return None
    today = now.date()
    rollover = now.time() >= time(15, 40)
    entries = []
    for row in listing or []:
        try:
            lot = int(row.get("lot_size") or 0)
            expiry = date.fromisoformat(str(row.get("date") or "")[:10])
        except (AttributeError, TypeError, ValueError):
            continue
        if lot > 0:
            entries.append((expiry, lot))
    if not entries:
        return None
    entries.sort()
    for expiry, lot in entries:
        if expiry > today or (expiry == today and not rollover):
            return lot
    return entries[-1][1]


def _live_listing(symbol: str) -> list[dict]:
    """Per-expiry contract rows for ``symbol`` from the live listing.

    A warm ``api.options_underlying`` cache is read synchronously — no HTTP.
    On a cold cache one read-only ``/option/contract`` call is made through the
    same client the route uses; it runs in a worker thread because that client
    is async and ``get_lot`` has sync callers on both sides of the event loop.
    Any upstream/resolution failure returns ``[]`` so the master fallback can
    still answer offline. CI (no broker token/network) also stays offline.
    """
    import asyncio
    from concurrent.futures import ThreadPoolExecutor

    try:
        import config
        from api import options_underlying as ou

        key = str(symbol or "").strip().upper()
        if not key or getattr(config, "CI_MODE", False):
            return []
        entry = ou._cache.get(key)
        if entry:
            return list((entry.get("data") or {}).get("listing") or [])

        instrument_key, exchange = ou._resolve_instrument(key)

        async def _load():
            return await ou._contract_rows(instrument_key)

        def _run():
            return asyncio.run(_load())

        try:
            asyncio.get_running_loop()
        except RuntimeError:
            rows = _run()
        else:
            with ThreadPoolExecutor(max_workers=1) as pool:
                rows = pool.submit(_run).result(timeout=15)

        listing = ou._listing(rows)
        ou._cache[key] = {
            "ts": _time.monotonic(),
            "ttl": ou.CACHE_TTL_OPEN_SEC,
            "data": {
                "instrument_key": instrument_key,
                "exchange": exchange,
                "fno": bool(rows),
                "spot": 0.0,
                "listing": listing,
            },
        }
        return listing
    except Exception:
        return []


def _expiry_sort_key(trading_symbol: str) -> tuple[int, int, int]:
    """Sortable key for the NSE expiry in a ``trading_symbol``.

    ``"KAYNES 150 CE 28 JUL 27"`` -> ``(2027, 7, 28)``; unparseable -> zeros.
    """
    match = re.search(
        r"\b(\d{1,2})\s+([A-Z]{3})\s+(\d{2})\b",
        str(trading_symbol or "").upper(),
    )
    if not match:
        return (0, 0, 0)
    day, month_name, year = match.groups()
    month = _MONTHS.index(month_name) + 1 if month_name in _MONTHS else 0
    return (2000 + int(year), month, int(day))


def _pick_master_lot(rows) -> int | None:
    """Lot from ``(lot_size, trading_symbol)`` master rows.

    When several historical series share a symbol the newest expiry encoded in
    ``trading_symbol`` wins; taking the smallest lot returns a stale contract
    size (KAYNES 100 instead of 150, CROMPTON 1800 instead of 2150).
    """
    candidates = [
        (_expiry_sort_key(trading_symbol), int(lot or 0))
        for lot, trading_symbol in rows
        if int(lot or 0) > 0
    ]
    if not candidates:
        return None
    return max(candidates)[1]


def _lookup_master_lot(symbol: str) -> int | None:
    """Best-effort lot lookup from the live instruments table (read-only).

    ``trading_symbol`` stays in the match because some NSE_FO rows (HINDZINC)
    have an empty ``name``. Newest expiry wins when a symbol has old series.
    """
    hint = MASTER_NAME_HINTS.get(symbol.upper(), symbol.upper()).replace(" ", "")
    try:
        import sqlite3
        import config
        from pathlib import Path
        db_path = Path(getattr(config, "LOCAL_DB_PATH", "db/alphashri.db"))
        if not db_path.is_absolute():
            db_path = Path(config.BASE_DIR) / db_path
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            where = (
                "from instruments where segment like 'NSE_FO%' "
                "and (replace(upper(trading_symbol), ' ', '') like ? "
                "or replace(upper(name), ' ', '') like ?)"
            )
            params = (f"%{hint}%", f"%{hint}%")
            rows = con.execute(
                f"select lot_size, trading_symbol {where}", params
            ).fetchall()
            lot = _pick_master_lot(rows)
            if lot:
                return lot
            # Single-column shape (mocked sqlite connections in lot tests).
            row = con.execute(
                f"select lot_size {where} order by lot_size limit 1", params
            ).fetchone()
            return int(row[0]) if row else None
        finally:
            con.close()
    except Exception:
        return None


def instrument(symbol: str, policy: str | None = None) -> Instrument:
    sym = symbol.upper()
    kind = "index" if sym in INDEX_LOTS else "stock"
    return Instrument(
        symbol=sym,
        kind=kind,
        lot=get_lot(sym, policy),
        tick=TICK_SIZES.get(sym, 0.05),
    )


# --------------------------------------------------------------------------
# Option symbol format (NSE / Upstox): NIFTY26OCT23000CE
# --------------------------------------------------------------------------
_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
           "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


def option_symbol(underlying: str, expiry_iso: str, strike: float,
                  opt: str) -> str:
    """Build the NSE-style contract symbol, e.g. ``NIFTY26OCT23000CE``."""
    import datetime as _dt
    d = _dt.date.fromisoformat(expiry_iso)
    yy = f"{d.year % 100:02d}"
    mon = _MONTHS[d.month - 1]
    k = int(round(strike))
    return f"{underlying.upper()}{yy}{mon}{k}{opt.upper()}"
