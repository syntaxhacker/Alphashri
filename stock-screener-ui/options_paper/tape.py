"""Price layer for the options sandbox.

Primary source: the repo's own **real NIFTY intraday tape**, written every
minute during market hours by ``api/reports_api/nifty.py``
(``start_nifty_tape_task``) to ``experiments/data/nifty_tape/<date>.jsonl``.
Each row carries the live spot, the ATM strike, the **real ATM CE/PE LTP and
IV**, PCR, max-pain, net GEX, the top OI walls and the per-strike OI book — all
of which the strategies need, and all of which are real recorded prices.

A live Upstox chain fetch is provided for stock-option strategies; it requires a
fresh broker token (Upstox tokens expire daily) and degrades to "skip" cleanly.
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass, field
from datetime import date as _date, datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TAPE_DIR = REPO_ROOT / "experiments" / "data" / "nifty_tape"
SPOT_DAILY = REPO_ROOT / "experiments" / "data" / "nifty_spot_daily.csv"


@dataclass
class Tick:
    """One minute of the NIFTY tape, typed."""
    t: datetime
    spot: float
    atm_strike: float
    ce_ltp: float
    pe_ltp: float
    ce_iv: float
    pe_iv: float
    expiry: str
    pcr_oi: float = 0.0
    pcr_vol: float = 0.0
    max_pain: float = 0.0
    net_gex: float = 0.0
    ce_oi: float = 0.0
    pe_oi: float = 0.0
    walls_calls: list = field(default_factory=list)
    walls_puts: list = field(default_factory=list)
    strikes_top: list = field(default_factory=list)
    # strike -> (ce_ltp, pe_ltp) for the strikes loaded for this minute. Lets a
    # position be marked at the contract it actually bought, not at the ATM,
    # which drifts as spot moves. Empty on the live tape (ATM-only fallback).
    chain: dict = field(default_factory=dict)
    # strike -> (ce_oi, pe_oi, ce_vol, pe_vol), when the tape carries them.
    chain_meta: dict = field(default_factory=dict)

    def premium(self, opt: str) -> float:
        return self.ce_ltp if opt.upper() == "CE" else self.pe_ltp

    def wall_strike(self, side: str) -> float | None:
        """Nearest heavy wall strike at or beyond spot (calls above, puts below)."""
        arr = self.walls_calls if side == "call" else self.walls_puts
        if not arr:
            return None
        if side == "call":
            above = [w["strike"] for w in arr if w.get("strike", 0) >= self.spot]
            return min(above) if above else max(w["strike"] for w in arr)
        below = [w["strike"] for w in arr if w.get("strike", 0) <= self.spot]
        return max(below) if below else min(w["strike"] for w in arr)


def tape_path(d: str | _date) -> Path:
    ds = d.isoformat() if isinstance(d, _date) else str(d)
    return TAPE_DIR / f"{ds}.jsonl"


def available_dates() -> list[str]:
    if not TAPE_DIR.exists():
        return []
    return sorted(p.stem for p in TAPE_DIR.glob("*.jsonl") if p.stem[:2] == "20")


def _to_tick(row: dict) -> Tick | None:
    try:
        t = datetime.fromisoformat(row["t"])
        walls = row.get("walls") or {}
        chain: dict = {}
        chain_meta: dict = {}
        for k, v in (row.get("chain") or {}).items():
            try:
                ks = int(float(k))
                ce = float(v[0]) if v and v[0] is not None else 0.0
                pe = float(v[1]) if v and len(v) > 1 and v[1] is not None else 0.0

                def _f(i):
                    try:
                        return float(v[i]) if i < len(v) and v[i] is not None else 0.0
                    except (TypeError, ValueError):
                        return 0.0

                meta = (_f(2), _f(3), _f(4), _f(5))
            except (TypeError, ValueError, IndexError):
                continue
            if ce > 0 or pe > 0:
                chain[ks] = (ce, pe)
                if any(meta):
                    chain_meta[ks] = meta
        # The tape records ATM IV in percent (e.g. 28.08); the engine works in
        # fractions (0.2808). Normalise here so both sources agree.
        ce_iv = float(row.get("atm_ce_iv") or 0.0)
        pe_iv = float(row.get("atm_pe_iv") or 0.0)
        if ce_iv > 3:
            ce_iv /= 100.0
        if pe_iv > 3:
            pe_iv /= 100.0
        return Tick(
            t=t,
            spot=float(row.get("spot") or 0.0),
            atm_strike=float(row.get("atm_strike") or 0.0),
            ce_ltp=float(row.get("atm_ce_ltp") or 0.0),
            pe_ltp=float(row.get("atm_pe_ltp") or 0.0),
            ce_iv=ce_iv,
            pe_iv=pe_iv,
            expiry=str(row.get("expiry") or ""),
            pcr_oi=float(row.get("pcr_oi") or 0.0),
            pcr_vol=float(row.get("pcr_vol") or 0.0),
            max_pain=float(row.get("max_pain") or 0.0),
            net_gex=float(row.get("net_gex") or 0.0),
            ce_oi=float(row.get("ce_oi") or 0.0),
            pe_oi=float(row.get("pe_oi") or 0.0),
            walls_calls=list(walls.get("calls") or []),
            walls_puts=list(walls.get("puts") or []),
            strikes_top=list(row.get("strikes_top") or []),
            chain=chain,
            chain_meta=chain_meta,
        )
    except (KeyError, TypeError, ValueError):
        return None


def probe(d: str | _date) -> dict:
    """Diagnose a tape file: total rows vs rows that carry a usable premium.

    Early tapes (e.g. 2026-10-13) predate the ``atm_ce_ltp``/``atm_pe_ltp``
    fields and therefore cannot be priced. This distinguishes "no file" from
    "file present but unpriced" so the runner can say which.
    """
    p = tape_path(d)
    if not p.exists():
        return {"file": False, "rows": 0, "priced": 0}
    rows = priced = 0
    with p.open() as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            rows += 1
            if (row.get("atm_ce_ltp") or 0) > 0 or (row.get("atm_pe_ltp") or 0) > 0:
                priced += 1
    return {"file": True, "rows": rows, "priced": priced}


def load_tape(d: str | _date) -> list[Tick]:
    """Parse the day's tape into typed ticks, sorted by time.

    Rows with a non-positive spot or no ATM premium are dropped (the recorder
    occasionally writes a partial row, and early tape formats have no premium).
    """
    p = tape_path(d)
    if not p.exists():
        return []
    ticks: list[Tick] = []
    with p.open() as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            tk = _to_tick(row)
            if tk and tk.spot > 0 and (tk.ce_ltp > 0 or tk.pe_ltp > 0):
                ticks.append(tk)
    ticks.sort(key=lambda x: x.t)
    return ticks


def prev_session_close(d: str | _date) -> float | None:
    """Prior session's closing spot.

    Prefers the previous tape's last tick (real recorded spot); falls back to
    ``experiments/data/nifty_spot_daily.csv``.
    """
    ds = d.isoformat() if isinstance(d, _date) else str(d)
    earlier = [x for x in available_dates() if x < ds]
    if earlier:
        prev = load_tape(earlier[-1])
        if prev:
            return prev[-1].spot
    # CSV fallback: expects at least [date, close] somewhere in the header.
    if SPOT_DAILY.exists():
        try:
            with SPOT_DAILY.open() as fh:
                rows = list(csv.reader(fh))
            if not rows:
                return None
            header = [h.strip().lower() for h in rows[0]]
            di = next((i for i, h in enumerate(header) if "date" in h), 0)
            ci = next((i for i, h in enumerate(header) if "close" in h), len(header) - 1)
            best = None
            for r in rows[1:]:
                if len(r) > max(di, ci) and r[di] <= ds:
                    best = r
            return float(best[ci]) if best else None
        except (ValueError, IndexError):
            return None
    return None


# --------------------------------------------------------------------------
# Live chain (optional; needs a fresh broker token)
# --------------------------------------------------------------------------
def upstox_token() -> str | None:
    """Fresh Upstox access token from the DB, or None. Never raises."""
    try:
        from db.models import get_shared_broker_token
        data = get_shared_broker_token("upstox")
        if data and data.get("access_token"):
            return data["access_token"]
    except Exception:
        pass
    return None


def live_option_quote(instrument_key: str, token: str | None = None) -> float | None:
    """Real-time LTP for one option instrument key (Upstox v3 market quote).

    Returns None (never raises) when there is no token or the call fails — the
    caller treats that as "live data unavailable today".
    """
    token = token or upstox_token()
    if not token:
        return None
    try:
        import httpx
        r = httpx.get(
            "https://api.upstox.com/v3/market-quote/ltp",
            params={"instrument_key": instrument_key},
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            timeout=15,
        )
        if r.status_code != 200:
            return None
        data = r.json().get("data") or {}
        for _k, v in data.items():
            ltp = v.get("last_price")
            if ltp:
                return float(ltp)
    except Exception:
        return None
    return None
