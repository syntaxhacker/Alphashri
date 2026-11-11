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
import re
import time
from dataclasses import dataclass, field
from datetime import date as _date, datetime
from pathlib import Path

from scripts import desk_common
from scripts import upstox_common

REPO_ROOT = Path(__file__).resolve().parent.parent
TAPE_DIR = REPO_ROOT / "experiments" / "data" / "nifty_tape"
SPOT_DAILY = REPO_ROOT / "experiments" / "data" / "nifty_spot_daily.csv"

#: A tape file stem must be a real session date. The recorder also writes
#: ``<date>.gaps.jsonl`` (the gap log) next to the tape: its stem is
#: ``<date>.gaps``, it carries no prices, and it used to be picked as "the
#: previous session" — the lookup then fell through to a stale CSV and
#: reported 25,867 for a NIFTY that closed at 22,811.
SESSION_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

#: The NIFTY index instrument key (URL-encoded for the V3 candle endpoint).
NIFTY_INDEX_KEY = "NSE_INDEX|Nifty 50"
NIFTY_INDEX_KEY_ENC = "NSE_INDEX%7CNifty%2050"
UPSTOX_V3 = "https://api.upstox.com"
UPSTOX_OHLC = "https://api.upstox.com/v2/market-quote/ohlc"

#: How stale the daily CSV may be before it is ignored entirely. The file in
#: the repo ends 2026-02-09; using it for an October session is how a
#: 25,867 "previous close" reached the strategy filters.
CSV_MAX_STALE_DAYS = 10


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
    """Recorded SESSION dates (ascending).

    Only strict ``YYYY-MM-DD`` stems count: the recorder's ``*.gaps.jsonl``
    log lives in the same directory and must never be mistaken for a session.
    """
    if not TAPE_DIR.exists():
        return []
    out = [p.stem for p in TAPE_DIR.glob("*.jsonl") if SESSION_DATE_RE.match(p.stem)]
    return sorted(out)


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


def _f(value, default: float = 0.0) -> float:
    """Finite float or the default — never raises."""
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    if out != out or out in (float("inf"), float("-inf")):
        return default
    return out


def parse_daily_candles(payload) -> list[dict]:
    """Upstox V3 daily candles → ``[{date, open, high, low, close, ...}]``.

    V3 daily rows are ``[date, o, h, l, c, volume, oi]``; the date element is
    an ISO string. Malformed rows are skipped.
    """
    data = payload
    if isinstance(payload, dict):
        data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    rows = data.get("candles") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return []
    out: list[dict] = []
    for row in rows:
        if not isinstance(row, (list, tuple)) or len(row) < 5:
            continue
        out.append({
            "date": str(row[0])[:10],
            "open": _f(row[1]),
            "high": _f(row[2]),
            "low": _f(row[3]),
            "close": _f(row[4]),
            "volume": _f(row[5]) if len(row) > 5 else 0.0,
            "oi": _f(row[6]) if len(row) > 6 else 0.0,
        })
    return out


def close_for_date(candles: list[dict], date_str: str) -> float | None:
    """The close of ``date_str`` in ``candles`` (None when absent/zero)."""
    for row in candles or []:
        if isinstance(row, dict) and row.get("date") == date_str:
            close = _f(row.get("close"))
            return close if close > 0 else None
    return None


#: date -> (close, expires_at). A PAST session's official close never
#: changes, so it is cached for the process lifetime; today's live value is
#: cached for a minute only.
_OFFICIAL_CLOSE_CACHE: dict[str, tuple[float, float]] = {}
_PAST_CLOSE_TTL = 24 * 3600.0
_TODAY_CLOSE_TTL = 60.0


def _today_ist() -> str:
    try:
        return desk_common.today_ist()
    except Exception:
        return datetime.now().strftime("%Y-%m-%d")


def _is_today(date_str: str) -> bool:
    return date_str == _today_ist()


def fetch_daily_close(date_str: str, timeout: float = 10.0) -> float | None:
    """Official NIFTY close for a PAST session (Upstox V3 daily candle).

    ``GET /v3/historical-candle/NSE_INDEX%7CNifty%2050/days/1/{date}/{date}``
    — the daily candle carries the official (auction) close, which the
    in-session tape does not: the CAS freezes the index print from 15:15.

    Returns None (never raises) when there is no token or the call fails.
    """
    token = upstox_token()
    if not token:
        return None
    try:
        import requests
        url = (f"{UPSTOX_V3}/v3/historical-candle/{NIFTY_INDEX_KEY_ENC}"
               f"/days/1/{date_str}/{date_str}")
        r = requests.get(url, headers={"Authorization": f"Bearer {token}",
                                       "Accept": "application/json"},
                         timeout=timeout)
        if r.status_code != 200:
            return None
        return close_for_date(parse_daily_candles(r.json()), date_str)
    except Exception:
        return None


def fetch_live_close(timeout: float = 10.0) -> float | None:
    """The LIVE NIFTY close (today's daily OHLC quote). None when unavailable."""
    token = upstox_token()
    if not token:
        return None
    try:
        import requests
        r = requests.get(
            UPSTOX_OHLC,
            params={"instrument_key": NIFTY_INDEX_KEY, "interval": "1d"},
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            timeout=timeout,
        )
        if r.status_code != 200:
            return None
        data = (r.json().get("data") or {})
        row = next(iter(data.values()), {}) if isinstance(data, dict) else {}
        close = _f((row.get("ohlc") or {}).get("close"))
        return close if close > 0 else None
    except Exception:
        return None


def official_nifty_close(date_str: str | None = None, timeout: float = 10.0) -> float | None:
    """Official NIFTY close for ``date_str`` (today's live close by default).

    * today (or no date) → the live daily OHLC quote;
    * a past session → the V3 daily candle for that date.

    Cached per date. Never raises; None means "no official close available".
    """
    today = _is_today(date_str or "")
    if date_str is None:
        date_str = _today_ist()
        today = True
    key = date_str
    ttl = _TODAY_CLOSE_TTL if today else _PAST_CLOSE_TTL
    cached = _OFFICIAL_CLOSE_CACHE.get(key)
    if cached and cached[1] > time.monotonic():
        return cached[0]
    close = fetch_live_close(timeout) if today else fetch_daily_close(date_str, timeout)
    if close is not None:
        _OFFICIAL_CLOSE_CACHE[key] = (close, time.monotonic() + ttl)
    return close


def prev_session_close(d: str | _date, timeout: float = 10.0) -> float | None:
    """Prior session's closing spot (the OFFICIAL close when available).

    The previous session is the latest RECORDED session before ``d`` — only
    strict ``YYYY-MM-DD`` tape stems count, so the recorder's
    ``*.gaps.jsonl`` log can never be picked as a session.

    The close is the official one (the CAS freezes the index print at 15:15,
    so the tape's last tick is NOT the close). The legacy
    ``nifty_spot_daily.csv`` is only consulted when it is actually current
    (its last row within ``CSV_MAX_STALE_DAYS``) — a stale CSV used to
    answer "25,867" for an October session.
    """
    ds = d.isoformat() if isinstance(d, _date) else str(d)
    earlier = [x for x in available_dates() if x < ds]
    if earlier:
        prev_date = earlier[-1]
        official = official_nifty_close(prev_date, timeout=timeout)
        if official:
            return official
        prev = load_tape(prev_date)
        if prev:
            return prev[-1].spot
    return _csv_prev_close(ds)


def _csv_prev_close(ds: str) -> float | None:
    """Previous close from the legacy daily CSV — only when it is current.

    The CSV in the repo ends 2026-02-09; a stale row is ignored rather than
    handed to the strategy filters as "yesterday's close".
    """
    if not SPOT_DAILY.exists():
        return None
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
        if not best:
            return None
        last_date = _date.fromisoformat(str(best[di])[:10])
        ref = _date.fromisoformat(ds)
        if (ref - last_date).days > CSV_MAX_STALE_DAYS:
            return None  # the CSV is too old to describe the previous session
        return float(best[ci])
    except (ValueError, IndexError, TypeError):
        return None


# --------------------------------------------------------------------------
# Live chain (optional; needs a fresh broker token)
# --------------------------------------------------------------------------
def upstox_token() -> str | None:
    """Fresh Upstox access token, or None. Never raises."""
    try:
        return upstox_common.token() or None
    except Exception:
        return None


def live_option_quote(instrument_key: str, token: str | None = None) -> float | None:
    """Real-time LTP for one option instrument key (Upstox v3 market quote).

    Returns None (never raises) when there is no token or the call fails — the
    caller treats that as "live data unavailable today".
    """
    return upstox_common.rest_spot(
        instrument_key,
        token or upstox_token(),
        timeout=15,
        base=upstox_common.BASE_V3,
    )
