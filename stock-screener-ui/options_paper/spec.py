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

from dataclasses import dataclass, asdict
from datetime import time

# --------------------------------------------------------------------------
# Sessions (all IST)
# --------------------------------------------------------------------------
MARKET_OPEN = time(9, 15)
MARKET_CLOSE = time(15, 30)
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
    brokerage_per_order: float = 20.0      # flat ₹20 / executed order
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

    Falls back to the live ``instruments`` master when the symbol is not in the
    static tables, so newly-listed underlyings still work.
    """
    policy = policy or DEFAULT_LOT_POLICY
    sym = symbol.upper()
    if policy == "report" and sym in REPORT_LOT_OVERRIDE:
        return REPORT_LOT_OVERRIDE[sym]
    if sym in INDEX_LOTS:
        return INDEX_LOTS[sym]
    if sym in STOCK_LOTS:
        return STOCK_LOTS[sym]
    lot = _lookup_master_lot(sym)
    if lot:
        return lot
    raise KeyError(f"unknown lot size for {symbol!r}")


def _lookup_master_lot(symbol: str) -> int | None:
    """Best-effort lot lookup from the live instruments table (read-only)."""
    hint = MASTER_NAME_HINTS.get(symbol.upper(), symbol.upper())
    try:
        import sqlite3
        import config
        from pathlib import Path
        db_path = Path(getattr(config, "LOCAL_DB_PATH", "db/alphashri.db"))
        if not db_path.is_absolute():
            db_path = Path(config.BASE_DIR) / db_path
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            row = con.execute(
                "select lot_size from instruments where segment like 'NSE_FO%' "
                "and upper(name) like ? order by lot_size limit 1",
                (f"%{hint}%",),
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
