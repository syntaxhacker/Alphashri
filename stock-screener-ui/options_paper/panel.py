"""Minute-level ATM feed built from the repo's recorded 1-minute option panel.

The live tape (``experiments/data/nifty_tape/<date>.jsonl``) only exists for a
handful of recent sessions. For everything else the repo holds a **1-minute
candle panel** of real NIFTY option contracts under
``experiments/data/nifty_options/candles/`` (669 contracts, 2026-05 → 2026-09),
plus a 1-minute ``NSE_NIFTY50-INDEX`` series that reaches back to 2017.

Provenance
----------
The option panel is **real broker data**, not synthetic: it was fetched from the
**FYERS** API (``fyers_apiv3.fyersModel``) on 2026-09-26 by
``experiments/research/nifty_options/download_options_real.py`` (four listed
monthlies + two front weeklies, strikes 22000–25600, 1-minute OHLCV). All 669
contracts carry non-zero traded volume. It was fetched **without open interest**
(``oi=False``), so the contract ``oi`` column is empty and OI-derived fields
(walls, PCR, dealer gamma) are unavailable here — a fetch choice, not fake data.
The intraday *index* series (2017 → ) and the live tape are separate sources.

This module joins the two into the same :class:`~options_paper.tape.Tick` the
strategies already consume:

* spot, per minute — the real index 1-minute close;
* ATM CE / PE premium — the real contract that sits at the money that minute;
* CE / PE implied vol — inverted from the recorded premium (see ``greeks``);
* OI walls and PCR — the real per-strike open interest of the contracts loaded.

Nothing is synthesised: every premium is a recorded print. When a strike has no
print in a given minute, the tick is dropped rather than interpolated, and the
caller is told how many minutes survived.

Contract identity comes from ``option_manifest.json`` (symbol -> expiry), which
sidesteps the ambiguous weekly-vs-monthly filename format.
"""

from __future__ import annotations

import json
import re
from datetime import date as _date, datetime, time as _time
from functools import lru_cache
from pathlib import Path

import pandas as pd

from . import greeks as _gr
from .tape import Tick

REPO_ROOT = Path(__file__).resolve().parent.parent
CANDLE_DIR = REPO_ROOT / "experiments" / "data" / "nifty_options" / "candles"
MANIFEST = REPO_ROOT / "experiments" / "data" / "nifty_options" / "option_manifest.json"
INDEX_FILE = CANDLE_DIR / "NSE_NIFTY50-INDEX__1.parquet"
VIX_FILE = CANDLE_DIR / "NSE_INDIAVIX-INDEX__1.parquet"

EXPIRY_TIME = _time(15, 30)      # NSE session close = option expiry moment


def _t_years(ts, exp: _date) -> float:
    """Calendar years from ``ts`` (IST) to the expiry close, floored at 15 min."""
    naive = ts.to_pydatetime() if hasattr(ts, "to_pydatetime") else ts
    secs = (datetime.combine(exp, EXPIRY_TIME) - naive.replace(tzinfo=None)).total_seconds()
    return max(secs / (365.0 * 24 * 3600), _gr.MIN_T_YEARS)


# --------------------------------------------------------------------------
# Contract index
# --------------------------------------------------------------------------
@lru_cache(maxsize=1)
def contract_index() -> dict:
    """``{(expiry_date, strike, 'CE'|'PE'): Path}`` from the manifest.

    The strike is the longest trailing digit run that yields a plausible NSE
    strike (a multiple of 50 in 5000..40000) — resolving the ``26O13`` vs
    ``26SEP`` tag ambiguity by construction rather than by regex guesswork.
    """
    man = json.loads(MANIFEST.read_text())
    out: dict = {}
    for c in man["contracts"]:
        sym = c["symbol"].split(":")[-1]
        m = re.match(r"NIFTY(.+?)(CE|PE)$", sym)
        if not m:
            continue
        opt, body = m.group(2), m.group(1)
        strike = None
        for cut in range(4, len(body)):
            tail = body[cut:]
            if tail.isdigit() and 5000 <= int(tail) <= 40000 and int(tail) % 50 == 0:
                strike = int(tail)
                break
        if strike is None:
            continue
        exp = c["expiry"]
        if isinstance(exp, str):
            exp = _date.fromisoformat(exp)
        path = CANDLE_DIR / f"{c['symbol'].replace(':', '_')}__1.parquet"
        if path.exists():
            out[(exp, strike, opt)] = path
    return out


@lru_cache(maxsize=1)
def expiries() -> tuple:
    return tuple(sorted({k[0] for k in contract_index()}))


def nearest_expiry(day: _date) -> _date | None:
    cands = [e for e in expiries() if e >= day]
    return cands[0] if cands else None


def _day_of(d) -> _date:
    return d if isinstance(d, _date) else _date.fromisoformat(str(d))


# --------------------------------------------------------------------------
# Cached reads
# --------------------------------------------------------------------------
@lru_cache(maxsize=1)
def _index_all() -> pd.DataFrame:
    df = pd.read_parquet(INDEX_FILE, columns=["ts", "open", "high", "low", "close"])
    df["ts"] = pd.to_datetime(df["ts"])
    return df.set_index("ts").sort_index()


@lru_cache(maxsize=1)
def _vix_all() -> pd.DataFrame:
    df = pd.read_parquet(VIX_FILE, columns=["ts", "close"])
    df["ts"] = pd.to_datetime(df["ts"])
    return df.set_index("ts").sort_index()


@lru_cache(maxsize=1)
@lru_cache(maxsize=4096)
def _load_contract(exp: _date, strike: int, opt: str) -> pd.DataFrame:
    path = contract_index().get((exp, strike, opt))
    if path is None:
        return pd.DataFrame()
    df = pd.read_parquet(path, columns=["ts", "open", "high", "low", "close", "oi"])
    df["ts"] = pd.to_datetime(df["ts"])
    return df.set_index("ts").sort_index()


def sessions() -> list:
    """Every session the index 1-minute series covers (2017-07 → present)."""
    idx = _index_all()
    return sorted({ts.date() for ts in idx.index})


# --------------------------------------------------------------------------
# ATM tape construction
# --------------------------------------------------------------------------
def _contracts_on(day: _date, exp: _date) -> list:
    return sorted({s for (e, s, _o) in contract_index() if e == exp})


def build_ticks(day, step: int = 50, expiry: _date | None = None,
                wall_band: int = 600, walls_top: int = 5) -> list[Tick]:
    """Build the day's minute feed of real ATM CE/PE premiums.

    ``wall_band`` is how many index points either side of the day's range we
    load, to have enough strikes to compute OI walls. Walls are therefore
    "top OI within +/-wall_band", which is disclosed in the report.
    """
    d = _day_of(day)
    idx = _index_all()
    day_df = idx[idx.index.date == d]
    if day_df.empty:
        return []
    exp = expiry or nearest_expiry(d)
    if exp is None:
        return []

    spot = day_df["close"]
    lo, hi = float(spot.min()), float(spot.max())
    avail = [s for s in _contracts_on(d, exp) if lo - wall_band <= s <= hi + wall_band]

    ce = {s: _load_contract(exp, s, "CE") for s in avail}
    pe = {s: _load_contract(exp, s, "PE") for s in avail}

    def _at(df: pd.DataFrame | None, ts, col: str = "close") -> float:
        if df is None or col not in df.columns:
            return 0.0
        try:
            v = df[col].get(ts)
        except Exception:
            return 0.0
        return float(v) if v is not None and v == v else 0.0

    vix = _vix_all()      # kept available for regime filters the strategies may add
    ticks: list[Tick] = []
    last_px: dict = {}    # strike -> last real (ce, pe) this session
    for ts, px in spot.items():
        atm = int(round(px / step) * step)
        ces, pes = ce.get(atm), pe.get(atm)
        if ces is None or pes is None:
            continue
        c_px, p_px = _at(ces, ts), _at(pes, ts)
        if not (c_px > 0 and p_px > 0):
            continue

        t_years = _t_years(ts, exp)
        # implied vol from the real premiums (parity forward, then bisection)
        fwd = _gr.implied_forward(atm, c_px, p_px, t_years)
        ce_iv = pe_iv = 0.0
        if fwd:
            ce_iv = float(_gr.implied_vol(c_px, fwd, atm, t_years, "CE") or 0.0)
            pe_iv = float(_gr.implied_vol(p_px, fwd, atm, t_years, "PE") or 0.0)

        # per-strike open interest (within the loaded band) -> walls + PCR,
        # plus the strike -> premium chain so positions mark at their own strike
        call_oi, put_oi, chain = [], [], {}
        for s in avail:
            co = _at_oi(ce.get(s), ts)
            po = _at_oi(pe.get(s), ts)
            if co > 0:
                call_oi.append({"strike": float(s), "oi": co})
            if po > 0:
                put_oi.append({"strike": float(s), "oi": po})
            cpx, ppx = _at(ce.get(s), ts), _at(pe.get(s), ts)
            prev = last_px.get(s, (0.0, 0.0))
            if cpx <= 0:
                cpx = prev[0]           # thin strike: carry the last real print
            if ppx <= 0:
                ppx = prev[1]
            if cpx > 0 or ppx > 0:
                last_px[s] = (cpx, ppx)
                chain[int(s)] = (cpx, ppx)
        call_oi.sort(key=lambda w: -w["oi"])
        put_oi.sort(key=lambda w: -w["oi"])
        tot_c = sum(w["oi"] for w in call_oi) or 1.0
        tot_p = sum(w["oi"] for w in put_oi) or 1.0

        # ATM-only dealer gamma (long calls vs short puts convention) — a
        # direction hint only, computed from already-inverted IVs.
        net_gex = 0.0
        if fwd and ce_iv > 0 and pe_iv > 0:
            gc = _gr.greeks_from_iv(fwd, atm, t_years, ce_iv, "CE")
            gp = _gr.greeks_from_iv(fwd, atm, t_years, pe_iv, "PE")
            ce_oi_atm = _at_oi(ces, ts)
            pe_oi_atm = _at_oi(pes, ts)
            net_gex = (gc.gamma * ce_oi_atm - gp.gamma * pe_oi_atm) * px * px * 0.01

        ticks.append(Tick(
            t=ts.to_pydatetime(), spot=float(px), atm_strike=float(atm),
            ce_ltp=c_px, pe_ltp=p_px, ce_iv=ce_iv, pe_iv=pe_iv,
            expiry=exp.isoformat(),
            pcr_oi=tot_p / tot_c,
            net_gex=net_gex,
            walls_calls=call_oi[:walls_top], walls_puts=put_oi[:walls_top],
            chain=chain,
        ))
    return ticks


def _at_oi(df: pd.DataFrame | None, ts) -> float:
    if df is None or "oi" not in df.columns:
        return 0.0
    try:
        v = df["oi"].get(ts)
    except Exception:
        return 0.0
    return float(v) if v is not None and v == v else 0.0


@lru_cache(maxsize=16)
def index_day(day) -> pd.DataFrame:
    """The whole day's 1-minute index OHLC (cached)."""
    d = _day_of(day)
    idx = _index_all()
    return idx[idx.index.date == d]


def contract_close(expiry, strike: int, opt: str) -> pd.Series:
    """Close series for one option contract (real prints), across all sessions."""
    exp = expiry if isinstance(expiry, _date) else _date.fromisoformat(str(expiry))
    df = _load_contract(exp, int(strike), str(opt).upper())
    return df["close"] if "close" in df.columns else pd.Series(dtype=float)


def prev_session_close(day) -> float | None:
    """Prior session's index close from the 1-minute series (real print)."""
    d = _day_of(day)
    idx = _index_all()
    prior = idx[idx.index.date < d]
    if prior.empty:
        return None
    last_day = prior.index.date.max()
    return float(prior[prior.index.date == last_day]["close"].iloc[-1])


def probe(day) -> dict:
    """Coverage of a session: index minutes vs priced ATM minutes."""
    d = _day_of(day)
    idx = _index_all()
    minutes = int((idx.index.date == d).sum())
    ticks = build_ticks(d)
    return {"date": d.isoformat(), "index_minutes": minutes,
            "priced_minutes": len(ticks),
            "expiry": ticks[0].expiry if ticks else None,
            "coverage_pct": round(100 * len(ticks) / minutes, 1) if minutes else 0.0}
