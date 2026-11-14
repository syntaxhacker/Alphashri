"""Data layer for the position-probability skill.

Everything is Upstox-first (the project's own market-data path) with the local
FastAPI service used only for the option chains (Upstox-native NSE_FO keys).

Run from the repo root so `config` / `upstox_trader` imports resolve.
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import pandas as pd

#: .../stock-screener-ui/.prime/agent/skills/position-probability/scripts/fetch_market_data.py
REPO_ROOT = Path(__file__).resolve().parents[5]
#: `upstox_trader` / `config.py` live one level above the repo root
WORKSPACE_ROOT = REPO_ROOT.parent
for _p in (str(REPO_ROOT), str(WORKSPACE_ROOT)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

DEFAULT_API_BASE = os.environ.get("ALPHASHRI_API_BASE", "http://localhost:8765")
DEFAULT_QA_EMAIL = os.environ.get("ALPHASHRI_QA_EMAIL", "qa@test.com")
DEFAULT_QA_PASSWORD = os.environ.get("ALPHASHRI_QA_PASSWORD", "qa123")

#: index ids understood by `chart_patterns.indices.INDEX_KEYS`
DEFAULT_INDEXES = ["NIFTY", "MIDCPNIFTY", "BANKNIFTY", "NIFTYPSUBANK", "NIFTYRAILWAYS"]
#: index ids that have listed options on the local /api/options endpoints
CHAIN_UNDERLYINGS = {"NIFTY": "NIFTY", "BANKNIFTY": "BANKNIFTY",
                     "MIDCPNIFTY": "MIDCPNIFTY", "SENSEX": "SENSEX"}


def upstox_client():
    from config import UPSTOX_API_KEY, UPSTOX_API_SECRET
    from upstox_trader.config_and_utils.upstox_api import UpstoxAPI
    return UpstoxAPI(api_key=UPSTOX_API_KEY, api_secret=UPSTOX_API_SECRET, quiet=True)


def upstox_daily(symbol: str, is_index: bool = False, from_date: str = "2020-06-01",
                 to_date: str = "2026-11-11", client=None) -> Optional[pd.DataFrame]:
    """Daily OHLCV for an equity or an index id (NIFTY, MIDCPNIFTY, ...).

    Upstox's daily series does NOT include the current session, so the caller
    must append it from `upstox_intraday_session`.
    """
    api = client or upstox_client()
    df = api.fetch_historical_data_v3(
        symbol, unit="days", interval=1, to_date=to_date, from_date=from_date,
        instrument_type="INDEX" if is_index else "EQ",
        exchange="NSE_INDEX" if is_index else "NSE_EQ",
    )
    if df is None or df.empty:
        return None
    return df[["open", "high", "low", "close", "volume"]].copy()


def upstox_intraday_session(symbol: str, client=None) -> Optional[dict]:
    """Latest session close/high/low/volume from the 1-minute feed."""
    api = client or upstox_client()
    df = api.fetch_intraday_data_v3(symbol, interval="1")
    if df is None or df.empty:
        return None
    last_date = df.index[-1].date()
    day = df[df.index.date == last_date]
    return {
        "date": str(last_date),
        "close": float(day["close"].iloc[-1]),
        "high": float(day["high"].max()),
        "low": float(day["low"].min()),
        "volume": float(day["volume"].sum()),
    }


def append_session(df: pd.DataFrame, session: dict) -> pd.DataFrame:
    """Append a session row that Upstox's daily endpoint left out."""
    ts = pd.Timestamp(session["date"], tz=df.index.tz)
    df.loc[ts] = [session["close"], session["high"], session["low"], session["close"],
                  session["volume"]]
    return df.sort_index()


# --------------------------------------------------------------------------
# local API (option chains)
# --------------------------------------------------------------------------


def api_token(base_url: str = DEFAULT_API_BASE, email: str = DEFAULT_QA_EMAIL,
              password: str = DEFAULT_QA_PASSWORD) -> Optional[str]:
    """Mint a short-lived token with the QA account (never hard-code a token)."""
    import urllib.request

    body = json.dumps({"email": email, "password": password}).encode()
    req = urllib.request.Request(f"{base_url}/api/auth/login", data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.load(resp).get("access_token")
    except Exception:
        return None


def _api_get(path: str, token: Optional[str], base_url: str = DEFAULT_API_BASE,
             timeout: int = 60) -> Optional[dict]:
    import urllib.request

    req = urllib.request.Request(f"{base_url}{path}")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.load(resp)
    except Exception:
        return None


def option_expiries(underlying: str, token: Optional[str],
                    base_url: str = DEFAULT_API_BASE) -> list[str]:
    payload = _api_get(f"/api/options/expiries/{underlying}", token, base_url)
    if not payload:
        return []
    return [e["date"] for e in payload.get("expiries", [])]


def option_chain(underlying: str, expiry: str, token: Optional[str],
                 base_url: str = DEFAULT_API_BASE) -> Optional[dict]:
    """Full Upstox-native option chain for one expiry."""
    return _api_get(f"/api/options/chain/{underlying}?expiry={expiry}", token, base_url, timeout=90)


@dataclass
class ChainView:
    underlying: str
    expiry: str
    spot: float
    atm_iv: float
    atm_straddle: float
    sigma: float          # 1-sigma move over the expiry, as a fraction of spot
    expected_move_pts: float
    max_pain: float
    pcr: float
    put_skew: float       # ATM put IV minus ATM call IV


def chain_view(chain: dict) -> Optional[ChainView]:
    """Summarise a chain payload: ATM straddle, implied sigma, skew, max pain."""
    rows = []
    for r in chain.get("chain", []):
        ce, pe = r.get("ce") or {}, r.get("pe") or {}
        cl = (ce.get("market_data") or {}).get("ltp")
        pl = (pe.get("market_data") or {}).get("ltp")
        civ = (ce.get("option_greeks") or {}).get("iv")
        piv = (pe.get("option_greeks") or {}).get("iv")
        if cl is not None and pl is not None:
            rows.append({"k": r["strike"], "ce": cl, "pe": pl, "ce_iv": civ, "pe_iv": piv})
    if not rows:
        return None
    t = pd.DataFrame(rows).dropna(subset=["ce", "pe"])
    spot = float(chain.get("spot") or 0)
    t = t[(t.k > spot * 0.9) & (t.k < spot * 1.1)]
    if t.empty or spot <= 0:
        return None
    atm = t.iloc[(t.k - spot).abs().argmin()]
    straddle = float(atm["ce"] + atm["pe"])
    summary = chain.get("summary") or {}
    em = summary.get("expected_move") or {}
    range_pts = float(em.get("range") or 0)
    # The API's expected_move is a 0.61x-straddle convention, not a 1-sigma move.
    sigma = straddle / (0.7979 * spot)
    skew = float(atm["pe_iv"] - atm["ce_iv"]) if atm["ce_iv"] and atm["pe_iv"] else float("nan")
    return ChainView(
        underlying=chain.get("underlying", ""),
        expiry=chain.get("expiry", ""),
        spot=spot,
        atm_iv=float(summary.get("atm_iv") or 0),
        atm_straddle=straddle,
        sigma=sigma,
        expected_move_pts=range_pts / 2,
        max_pain=float(summary.get("max_pain") or 0),
        pcr=float(summary.get("pcr") or 0),
        put_skew=skew,
    )
