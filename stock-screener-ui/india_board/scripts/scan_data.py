#!/usr/bin/env python3
"""Market-wide "where are big players betting" options scan.

For each of ~210 NSE stock underlyings this fetches ONE nearest-expiry
option chain (via :mod:`fyers_data`, whose ``_get_client`` / ``get_chain`` /
``compute_levels`` / ``IST`` are reused — never duplicated) and derives a
per-ticker row plus market-wide rankings (call/put buildup, PCR extremes,
unusual OI change).

Pacing (critical): Fyers allows ~200 req/min, so the scan fetches
SEQUENTIALLY with a 0.4s gap (~2-4 min for a full scan), logs progress every
25 tickers, allows 25s per ticker, and skips failures silently.

HTTP must never block for minutes, so :func:`build_scan` serves the cached
payload and runs the scan in a background thread (serving last-good data or a
status payload while running). A proactive daemon scheduler
(:func:`ensure_started`) refreshes on ``SCAN_INTERVAL_SEC`` (default 300s) and
the last-good payload is persisted to ``data/universe/latest.json`` so a
restart serves it immediately.

Token hygiene: the Fyers token is only ever touched inside
``fyers_data._get_client`` — this module never prints or logs it.

NSE "tape" + "opportunities" (US Unusual-Whales analogue): the same scan
also emits two derived sections under ``sections.tape`` and
``sections.opportunities``. The US tape is built from exchange-tagged
sweeps/blocks that can be matched across venues; India has a single exchange
(NSE) and the Fyers chain feed exposes neither aggressor side nor sweep legs,
so a true per-print tape does not exist. Instead we diff each
ticker/strike/side's cumulative day volume and LTP against the immediately
previous scan of the same session/expiry and report the premium traded inside
that window (``Δvolume × LTP``) plus the reported OI change. The baseline is
persisted to ``data/universe/strike_state.json`` so a restart keeps diffing,
and a stale/absent baseline yields a ``warming_up`` section rather than
presenting cumulative day volume as a fresh print.
"""
from __future__ import annotations

import collections
import concurrent.futures as cf
import json
import math
import os
import sys
import threading
import time
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import fyers_data  # noqa: E402  (reuse: _get_client/get_chain/compute_levels/IST)

try:  # imported as a package submodule (india_board.scripts.scan_data)
    from . import fyers_pacer  # type: ignore
except ImportError:  # imported top-level (india_board/scripts on sys.path)
    import fyers_pacer  # type: ignore

IST = fyers_data.IST


#: Default proactive refresh interval (seconds). ``SCAN_INTERVAL_SEC`` overrides.
_DEFAULT_SCAN_INTERVAL = 300


def _env_interval() -> float:
    """Scan interval in seconds, honouring ``SCAN_INTERVAL_SEC``.

    Read on every call so an override needs no re-import; malformed values
    fall back to the default instead of raising.
    """
    try:
        return float(os.environ.get("SCAN_INTERVAL_SEC", _DEFAULT_SCAN_INTERVAL))
    except (TypeError, ValueError):
        return float(_DEFAULT_SCAN_INTERVAL)


#: Proactive refresh interval (seconds). ``_SCAN_TTL`` is the legacy alias.
SCAN_INTERVAL_SEC = _env_interval()
_SCAN_TTL = SCAN_INTERVAL_SEC

#: Outside 09:15-15:30 IST only capture one post-close session, then idle.
#: Set ``SCAN_OFFHOURS_ENABLED=0`` to disable entirely.
SCAN_OFFHOURS_ENABLED = os.environ.get(
    "SCAN_OFFHOURS_ENABLED", "1"
).strip().lower() not in ("0", "false", "no", "off")

#: Scheduler tick — short sleeps keep it prompt.
_SCHED_TICK = 10

#: Sequential pacing gap between chain calls. Fyers allows ~200/min, but
#: Cloudflare 1015 is burst-triggered and bans the IP for ~45 min, so this is
#: deliberately paced well below the API limit (sweep ~3.5-4 min).
_GAP = 0.8
#: Progress log cadence.
_LOG_EVERY = 25
#: Per-ticker timeout (reuses the fyers_data chain timeout).
_CHAIN_TIMEOUT = fyers_data._CHAIN_TIMEOUT

#: Last successful scan is persisted here for restart hydration.
DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "universe"
_LATEST_NAME = "latest.json"

#: Per-ticker strike baseline for the tape/opportunities diff. Persisted
#: alongside ``latest.json`` so a restart keeps producing real window deltas.
_STATE_NAME = "strike_state.json"

#: Module cache: {"payload": dict | None, "ts": float}.
_CACHE: dict = {"payload": None, "ts": 0.0}
#: Previous scan's per-ticker strike snapshot (tape/opportunities baseline).
_PREV_STATE: dict | None = None
#: Live scan progress (guarded by _LOCK).
_STATE: dict = {"progress": 0, "total": 0}
_LOCK = threading.Lock()
_WORKER: threading.Thread | None = None
#: Idempotency guard for :func:`ensure_started`.
_STARTED = False


# ---------------------------------------------------------------------------
# Universe
# ---------------------------------------------------------------------------

def _load_universe() -> list[tuple[str, str]]:
    """Return ``[(label, fyers_symbol)]`` for the scan universe.

    Primary: ``nse_universe.stock_underlyings()`` + ``eq_symbol()`` (imported
    lazily so a teammate can drop that module in later). Fallback: the stock
    tickers of ``fyers_data.UNIVERSE`` so this module still runs standalone.
    """
    try:
        from nse_universe import eq_symbol, stock_underlyings  # type: ignore

        unders = stock_underlyings()
        pairs = [(str(u), str(eq_symbol(u))) for u in unders]
        pairs = [(u, s) for u, s in pairs if u and s]
        if pairs:
            return pairs
    except Exception:  # noqa: BLE001  (module missing / contract broken)
        pass
    return [
        (t, fyers_data.fyers_symbol(t))
        for t in fyers_data.UNIVERSE
        if t not in ("NIFTY", "BANKNIFTY")
    ]


# ---------------------------------------------------------------------------
# Chain fetch (one call per underlying)
# ---------------------------------------------------------------------------

def _direct_chain(symbol: str, label: str) -> dict:
    """Nearest-expiry chain for a raw Fyers symbol.

    Same reshape as ``fyers_data.get_chain`` (spot from the ``strike == -1``
    row, quotes fallback, expiries list) so rows are interchangeable.
    """
    client = fyers_data._get_client()
    resp = client.optionchain(data={"symbol": symbol, "strikecount": 25})
    if not isinstance(resp, dict) or resp.get("s") != "ok":
        raise RuntimeError(f"optionchain failed for {label}")
    data = resp.get("data") or {}

    rows = data.get("optionsChain") or []
    spot: float | None = None
    by_strike: dict[float, dict] = {}
    for r in rows:
        if not isinstance(r, dict):
            continue
        strike = fyers_data._num(r.get("strike_price"), default=float("nan"))
        if strike != strike:  # NaN
            continue
        if strike == -1:
            spot = fyers_data._num(r.get("ltp"), default=float("nan"))
            if spot != spot:
                spot = None
            continue
        leg = by_strike.setdefault(
            strike,
            {
                "strike": strike,
                "ce_oi": 0.0, "pe_oi": 0.0,
                "ce_oich": 0.0, "pe_oich": 0.0,
                "ce_vol": 0.0, "pe_vol": 0.0,
                "ce_ltp": 0.0, "pe_ltp": 0.0,
            },
        )
        side = str(r.get("option_type") or "").upper()
        prefix = "ce_" if side == "CE" else "pe_" if side == "PE" else None
        if prefix is None:
            continue
        leg[f"{prefix}oi"] = fyers_data._num(r.get("oi"))
        leg[f"{prefix}oich"] = fyers_data._num(r.get("oich"))
        leg[f"{prefix}vol"] = fyers_data._num(r.get("volume"))
        leg[f"{prefix}ltp"] = fyers_data._num(r.get("ltp"))

    strikes = [by_strike[k] for k in sorted(by_strike)]

    expiries: list = []
    for e in data.get("expiryData") or []:
        if isinstance(e, dict):
            v = e.get("date") or e.get("expiry") or str(e)
        else:
            v = str(e)
        try:
            if isinstance(v, (int, float)) or (isinstance(v, str) and v.isdigit()):
                v = datetime.fromtimestamp(int(v), tz=IST).date().isoformat()
        except Exception:  # noqa: BLE001
            v = str(v)
        expiries.append(v)

    if spot is None:
        spot, _ = fyers_data._quote_spot(client, symbol)

    return {
        "ticker": label,
        "spot": spot,
        "strikes": strikes,
        "expiries": expiries,
        "call_oi": fyers_data._num(data.get("callOi")),
        "put_oi": fyers_data._num(data.get("putOi")),
        "as_of": datetime.now(IST).date().isoformat(),
    }


def _chain_for_symbol(symbol: str, label: str) -> dict:
    """One nearest-expiry chain for a raw Fyers equity symbol.

    Primary path reuses ``fyers_data.get_chain`` verbatim by deriving the
    universe-style ticker (``NSE:RELIANCE-EQ`` -> ``RELIANCE`` round-trips
    through ``fyers_symbol``); the direct variant above is the fallback when
    that mapping cannot reproduce the symbol.
    """
    core = (symbol or "").strip()
    if core.startswith("NSE:"):
        core = core[4:]
    if core.endswith("-EQ"):
        core = core[:-3]
    try:
        chain = fyers_data.get_chain(core or label)
    except Exception:  # noqa: BLE001
        chain = None
    if chain and chain.get("strikes"):
        chain["ticker"] = label
        return chain
    return _direct_chain(symbol, label)


# ---------------------------------------------------------------------------
# Per-ticker summary + ranking helpers (pure — unit-testable on synthetic rows)
# ---------------------------------------------------------------------------

def _top_strike(strikes: list[dict], oi_key: str, oich_key: str) -> dict:
    best: dict | None = None
    for r in strikes:
        if not isinstance(r, dict):
            continue
        oi = fyers_data._num(r.get(oi_key))
        if best is None or oi > best["oi"]:
            best = {
                "strike": fyers_data._num(r.get("strike")),
                "oi": oi,
                "oich": fyers_data._num(r.get(oich_key)),
            }
    return best or {"strike": None, "oi": 0.0, "oich": 0.0}


def summarize_chain(label: str, chain: dict) -> dict:
    """Collapse one chain into a scan row + ranking candidates.

    Returns ``{"row", "call", "put", "unusual", "expiry"}``.
    """
    strikes = chain.get("strikes") or []
    levels = fyers_data.compute_levels(chain)
    spot = chain.get("spot")
    call_oi = fyers_data._num(chain.get("call_oi")) or sum(
        fyers_data._num(s.get("ce_oi")) for s in strikes if isinstance(s, dict)
    )
    put_oi = fyers_data._num(chain.get("put_oi")) or sum(
        fyers_data._num(s.get("pe_oi")) for s in strikes if isinstance(s, dict)
    )
    top_call = _top_strike(strikes, "ce_oi", "ce_oich")
    top_put = _top_strike(strikes, "pe_oi", "pe_oich")

    row = {
        "ticker": label,
        "spot": spot,
        "pcr": levels.get("pcr"),
        "max_pain": levels.get("max_pain"),
        "resistance": levels.get("resistance"),
        "support": levels.get("support"),
        "top_call": top_call,
        "top_put": top_put,
        "call_oi": call_oi,
        "put_oi": put_oi,
    }

    # Strike with the biggest one-day OI buildup, per side.
    best_call: dict | None = None
    best_put: dict | None = None
    # Strike whose |OI change| is largest relative to its own OI.
    unusual: dict | None = None
    for r in strikes:
        if not isinstance(r, dict):
            continue
        k = fyers_data._num(r.get("strike"))
        ce_oi = fyers_data._num(r.get("ce_oi"))
        pe_oi = fyers_data._num(r.get("pe_oi"))
        ce_oich = fyers_data._num(r.get("ce_oich"))
        pe_oich = fyers_data._num(r.get("pe_oich"))
        if best_call is None or ce_oich > best_call["oich"]:
            best_call = {"ticker": label, "spot": spot, "strike": k,
                         "oi": ce_oi, "oich": ce_oich}
        if best_put is None or pe_oich > best_put["oich"]:
            best_put = {"ticker": label, "spot": spot, "strike": k,
                        "oi": pe_oi, "oich": pe_oich}
        for side, oi, oich in (("CE", ce_oi, ce_oich), ("PE", pe_oi, pe_oich)):
            if oi > 0:
                ratio = abs(oich) / oi
                if unusual is None or ratio > unusual["ratio"]:
                    unusual = {"ticker": label, "spot": spot, "side": side,
                               "strike": k, "oi": oi, "oich": oich,
                               "ratio": ratio}

    expiries = chain.get("expiries") or []
    return {
        "row": row,
        "call": best_call,
        "put": best_put,
        "unusual": unusual,
        "expiry": expiries[0] if expiries else None,
    }


def rank_call_buildup(cands: list[dict], n: int = 15) -> list[dict]:
    """Top-N tickers by call-side OI buildup (raw oich, descending)."""
    return sorted(
        (c for c in cands if isinstance(c, dict) and c.get("oich") is not None),
        key=lambda c: c.get("oich") or 0.0,
        reverse=True,
    )[:n]


def rank_put_buildup(cands: list[dict], n: int = 15) -> list[dict]:
    """Top-N tickers by put-side OI buildup (raw oich, descending)."""
    return sorted(
        (c for c in cands if isinstance(c, dict) and c.get("oich") is not None),
        key=lambda c: c.get("oich") or 0.0,
        reverse=True,
    )[:n]


def rank_pcr_extremes(rows: list[dict], n: int = 8) -> dict:
    """Top-N lowest + top-N highest PCR rows, each with spot context."""
    valid = [r for r in rows if isinstance(r, dict) and r.get("pcr") is not None]

    def _ctx(r: dict) -> dict:
        return {"ticker": r.get("ticker"), "pcr": r.get("pcr"),
                "spot": r.get("spot")}

    return {
        "lowest": [_ctx(r) for r in sorted(valid, key=lambda r: r["pcr"])[:n]],
        "highest": [_ctx(r) for r in
                    sorted(valid, key=lambda r: r["pcr"], reverse=True)[:n]],
    }


def rank_unusual(cands: list[dict], n: int = 15) -> list[dict]:
    """Top-N strikes by |oich| relative to that strike's own OI."""
    return sorted(
        (c for c in cands if isinstance(c, dict) and c.get("ratio") is not None),
        key=lambda c: c.get("ratio") or 0.0,
        reverse=True,
    )[:n]


# ---------------------------------------------------------------------------
# Tape + opportunities — NSE analogues of the US Unusual-Whales cards.
#
# A US "tape" is exchange-tagged sweeps/blocks matched across venues; India
# has one exchange and the Fyers chain feed tags neither aggressor side nor
# sweep legs, so we approximate a window tape by diffing per-ticker/strike/
# side cumulative volume + LTP against the previous scan. All helpers below
# are pure and defensive: the whole computation is wrapped so it can never
# raise into a scan.
# ---------------------------------------------------------------------------

#: Per-side strike fields: (side, volume, ltp, oi, oich).
_SIDE_FIELDS = (
    ("CE", "ce_vol", "ce_ltp", "ce_oi", "ce_oich"),
    ("PE", "pe_vol", "pe_ltp", "pe_oi", "pe_oich"),
)

#: Tape/opportunities output caps (UI contract).
TAPE_LIMIT = 12
OPPS_LIMIT = 10


def _window_int(window_sec) -> int:
    """Coerce a window length to ``int`` seconds (fallback: configured)."""
    try:
        return int(window_sec)
    except (TypeError, ValueError):
        return int(_DEFAULT_SCAN_INTERVAL)


def _strike_entries(strikes: list[dict]) -> dict:
    """Per-strike/side snapshot keyed ``"{SIDE}|{strike}"`` (never raises)."""
    out: dict = {}
    for s in strikes or []:
        if not isinstance(s, dict):
            continue
        strike = fyers_data._num(s.get("strike"))
        for side, vol_k, ltp_k, oi_k, oich_k in _SIDE_FIELDS:
            out[f"{side}|{strike}"] = {
                "strike": strike,
                "side": side,
                "vol": fyers_data._num(s.get(vol_k)),
                "ltp": fyers_data._num(s.get(ltp_k)),
                "oi": fyers_data._num(s.get(oi_k)),
                "oich": fyers_data._num(s.get(oich_k)),
            }
    return out


def _build_state(snapshots, ts_iso: str, ts_epoch: float) -> dict:
    """Baseline ``{"ts","ts_epoch","tickers"}`` from ``(ticker, expiry, strikes)``.

    ``snapshots`` is an iterable of ``(ticker, expiry, strikes)`` tuples; a
    malformed entry is skipped rather than aborting the whole baseline.
    """
    tickers: dict = {}
    for item in snapshots or []:
        try:
            label, expiry, strikes = item
        except (TypeError, ValueError):
            continue
        if not label:
            continue
        tickers[str(label)] = {
            "expiry": expiry,
            "strikes": _strike_entries(strikes),
        }
    return {"ts": ts_iso, "ts_epoch": ts_epoch, "tickers": tickers}


def _baseline_missing_or_stale(prev_state, cur_state, window_sec) -> bool:
    """True when there is no usable previous baseline to diff against.

    A missing/empty baseline, or one whose timestamp is older than ~3× the
    scan interval (e.g. after an overnight restart), is treated as absent so
    cumulative day volume is never presented as a fresh window print.
    """
    if not isinstance(prev_state, dict) or not prev_state.get("tickers"):
        return True
    try:
        prev_ts = float(prev_state.get("ts_epoch"))
        cur_ts = float((cur_state or {}).get("ts_epoch"))
    except (TypeError, ValueError):
        return True
    if prev_ts <= 0 or cur_ts <= 0:
        return True
    try:
        window = max(float(window_sec), 1.0)
    except (TypeError, ValueError):
        window = float(_DEFAULT_SCAN_INTERVAL)
    return (cur_ts - prev_ts) > 3.0 * window


def _warming_tape(window_sec) -> dict:
    """``sections.tape`` for a scan with no usable baseline."""
    return {"status": "warming_up", "window_sec": _window_int(window_sec), "rows": []}


def _warming_opps() -> dict:
    """``sections.opportunities`` for a scan with no usable baseline."""
    return {"status": "warming_up", "rows": []}


def _score_opportunity(ratio: float, premium: float) -> float:
    """``ratio * log1p(premium)`` — OI intensity scaled by premium traded.

    ``ratio`` is ``|oi_change| / max(oi, 1)`` and ``premium`` is the window
    premium (``Δvolume × LTP``). Both inputs are clamped non-negative so a
    single bad number cannot poison the ranking.
    """
    try:
        r = float(ratio)
        p = float(premium)
    except (TypeError, ValueError):
        return 0.0
    if r < 0:
        r = 0.0
    if p < 0:
        p = 0.0
    return r * math.log1p(p)


def _rank_tape(cands: list[dict], n: int = TAPE_LIMIT) -> list[dict]:
    """Top-N window prints by premium, descending."""
    return sorted(
        (c for c in cands if isinstance(c, dict)),
        key=lambda c: c.get("premium") or 0.0,
        reverse=True,
    )[:n]


def _rank_opportunities(cands: list[dict], n: int = OPPS_LIMIT) -> list[dict]:
    """Top-N opportunity strikes by score, descending."""
    return sorted(
        (c for c in cands if isinstance(c, dict)),
        key=lambda c: c.get("score") or 0.0,
        reverse=True,
    )[:n]


def _diff_window(prev_state, cur_state, ts, window_sec):
    """Diff two per-strike snapshots into ``(tape, opportunities)``.

    Pure and defensive — missing/stale baselines yield ``warming_up`` and any
    per-ticker/per-strike problem is skipped, never raised. Rules:

    * premium = ``Δvolume × LTP`` with ``Δvolume = vol_now - vol_prev`` for the
      same ticker+strike+side; ``Δvolume <= 0`` is skipped;
    * a ticker whose nearest expiry changed contributes nothing this cycle;
    * a strike absent from the previous scan is skipped;
    * opportunities keep only ``volume > 0 and oi_change != 0``.
    """
    if _baseline_missing_or_stale(prev_state, cur_state, window_sec):
        return _warming_tape(window_sec), _warming_opps()

    prev_tickers = prev_state.get("tickers") or {}
    cur_tickers = (cur_state or {}).get("tickers") or {}
    tape_cands: list[dict] = []
    opp_cands: list[dict] = []

    for ticker, cur in cur_tickers.items():
        try:
            if not isinstance(cur, dict):
                continue
            prev = prev_tickers.get(ticker)
            if not isinstance(prev, dict):
                continue
            # Expiry rollover: never diff across two different contracts.
            expiry = cur.get("expiry")
            if expiry != prev.get("expiry"):
                continue
            prev_strikes = prev.get("strikes") or {}
            for key, now in (cur.get("strikes") or {}).items():
                try:
                    old = prev_strikes.get(key)
                    if not isinstance(old, dict):
                        continue  # strike absent from the previous scan
                    vol_now = float(now.get("vol") or 0.0)
                    vol_prev = float(old.get("vol") or 0.0)
                    dvol = vol_now - vol_prev
                    if dvol <= 0:
                        continue  # nothing traded in this window
                    ltp = float(now.get("ltp") or 0.0)
                    premium = dvol * ltp
                    strike = now.get("strike")
                    side = now.get("side")
                    oi = float(now.get("oi") or 0.0)
                    oich = float(now.get("oich") or 0.0)
                except (TypeError, ValueError):
                    continue
                tape_cands.append({
                    "ticker": ticker,
                    "side": side,
                    "strike": strike,
                    "expiry": expiry,
                    "premium": premium,
                    "volume": dvol,
                    "oi_change": oich,
                    "ltp": ltp,
                    "ts": ts,
                })
                if oich != 0:
                    ratio = abs(oich) / max(oi, 1.0)
                    opp_cands.append({
                        "ticker": ticker,
                        "side": side,
                        "strike": strike,
                        "expiry": expiry,
                        "oi": oi,
                        "oi_change": oich,
                        "volume": dvol,
                        "ratio": ratio,
                        "premium": premium,
                        "score": _score_opportunity(ratio, premium),
                        "ts": ts,
                    })
        except Exception:  # noqa: BLE001  (skip a bad ticker, keep the rest)
            continue

    return (
        {"status": "ok", "window_sec": _window_int(window_sec),
         "rows": _rank_tape(tape_cands)},
        {"status": "ok", "rows": _rank_opportunities(opp_cands)},
    )


# ---------------------------------------------------------------------------
# Breadth (F9) — one batch-quotes call per <=50 names; never breaks a scan.
#
# The full scan is chain-per-name (~105s for 210 names). Fetching `chp` for the
# same names via `/data/quotes` (50 symbols/request, ~5 requests) gives a
# market-wide advancers/decliners read and a per-row %change without another
# chain sweep, so every row carries a fresh `chg_pct`.
# ---------------------------------------------------------------------------

#: Fyers ``/data/quotes`` hard limit (mirrors ``fyers_data._QUOTES_BATCH``).
_QUOTES_BATCH = 50


def _symbol_key(item) -> str:
    """Label for a ``(label, symbol)`` pair, or the string itself."""
    if isinstance(item, (tuple, list)):
        return str(item[0]).strip() if item else ""
    return str(item or "").strip()


def _chp_of(quote) -> float | None:
    """Finite ``chp`` from a quote dict, else ``None`` (never fabricated)."""
    if not isinstance(quote, dict):
        return None
    return fyers_data._num_opt(quote.get("chp"))


def _fetch_quotes(symbols: list[str], quote_fn=None) -> tuple[dict, bool]:
    """Batch-fetch quotes for ``symbols``; returns ``(quotes, ok)``.

    Splits into <=50-symbol calls (Fyers limit). Any failure yields
    ``({}, False)`` so callers degrade to ``unavailable`` / ``chg_pct: None``
    instead of breaking the scan.
    """
    fetch = quote_fn or getattr(fyers_data, "get_quotes", None)
    out: dict = {}
    if not symbols or not callable(fetch):
        return out, True
    try:
        for i in range(0, len(symbols), _QUOTES_BATCH):
            got = fetch(symbols[i:i + _QUOTES_BATCH])
            if isinstance(got, dict):
                out.update(got)
    except Exception as exc:  # noqa: BLE001  (breadth must never break a scan)
        print(f"[scan_data] quotes failed: {type(exc).__name__}", flush=True)
        return {}, False
    return out, True


def _breadth_from_quotes(symbols: list[str], quotes: dict) -> dict:
    """Aggregate advancers/decliners/unchanged from per-symbol quotes.

    Also returns ``rows`` (``[{ticker, chp}]``, best-first) so the UI can show
    the strongest/weakest names without a second fetch. Symbols without a
    usable ``chp`` are skipped (never fabricated as 0).
    """
    adv = dec = unch = 0
    rows: list[dict] = []
    for sym in symbols:
        chp = _chp_of((quotes or {}).get(sym))
        if chp is None:
            continue
        rows.append({"ticker": sym, "chp": chp})
        if chp > 0:
            adv += 1
        elif chp < 0:
            dec += 1
        else:
            unch += 1
    total = adv + dec + unch
    rows.sort(key=lambda r: r["chp"], reverse=True)
    return {
        "advancers": adv,
        "decliners": dec,
        "unchanged": unch,
        "pct_advancing": (adv / total * 100.0) if total else None,
        "rows": rows,
        "as_of": datetime.now(IST).isoformat(),
    }


def build_breadth(pairs_or_symbols, quote_fn=None) -> dict:
    """Market breadth across ``pairs_or_symbols`` (F9; pure when injected).

    Accepts universe ``(label, symbol)`` pairs or plain symbol strings and does
    one batch ``quotes`` call per <=50 names. Returns
    ``{advancers, decliners, unchanged, pct_advancing, as_of}``; any fetch
    failure degrades to ``{"unavailable": True}`` and never raises.
    """
    symbols: list[str] = []
    seen: set[str] = set()
    for item in pairs_or_symbols or []:
        key = _symbol_key(item)
        if key and key not in seen:
            seen.add(key)
            symbols.append(key)
    quotes, ok = _fetch_quotes(symbols, quote_fn=quote_fn)
    if not ok:
        return {"unavailable": True}
    return _breadth_from_quotes(symbols, quotes)


#: In-process TTL (seconds) for the live breadth fallback the home card hits.
#: ``BREADTH_TTL`` (env) overrides; evaluated per call so tests can retune it.
BREADTH_TTL = 300.0
#: Last live breadth sweep: ``{"payload": dict | None, "ts": float}``.
_BREADTH_CACHE: dict = {"payload": None, "ts": 0.0}


def _breadth_ttl() -> float:
    """Breadth fallback TTL in seconds (``BREADTH_TTL`` env, default 300)."""
    try:
        val = float(os.environ.get("BREADTH_TTL", BREADTH_TTL))
        return val if val > 0 else BREADTH_TTL
    except (TypeError, ValueError):
        return BREADTH_TTL


def cached_breadth(pairs_or_symbols, quote_fn=None) -> dict:
    """Breadth from a live quote sweep, throttled to at most one per TTL.

    Unlike :func:`build_breadth` this keeps a small in-process cache so a 60s
    home-card refresh cannot re-fetch five quote batches every minute. When the
    market is closed and the caller is **not** inside an
    :func:`fyers_pacer.allow_offhours` exemption the sweep is skipped entirely
    (last cached payload, or ``{"unavailable": True}``).
    """
    now = time.time()
    hit = _BREADTH_CACHE.get("payload")
    if fyers_pacer.offhours_blocked() and not fyers_pacer.is_offhours_exempt():
        return hit if hit is not None else {"unavailable": True}
    if hit is not None and now - float(_BREADTH_CACHE.get("ts", 0.0)) < _breadth_ttl():
        return hit
    out = build_breadth(pairs_or_symbols, quote_fn=quote_fn)
    _BREADTH_CACHE["payload"] = out
    _BREADTH_CACHE["ts"] = now
    return out


def apply_chg_pct(rows: list[dict], quotes: dict, ok: bool = True) -> list[dict]:
    """Stamp ``chg_pct`` on each row from its quote's ``chp``.

    Quotes are keyed by ``row['ticker']``; a missing quote (or ``ok=False``)
    yields ``None`` — never a fabricated value. Returns ``rows`` for chaining.
    """
    quotes = quotes if isinstance(quotes, dict) else {}
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        row["chg_pct"] = _chp_of(quotes.get(row.get("ticker"))) if ok else None
    return rows


# ---------------------------------------------------------------------------
# Scan runner (sequential, paced)
# ---------------------------------------------------------------------------

def _fetch_one(label: str, symbol: str) -> dict | None:
    """One underlying -> summary bundle; None on any failure (skip silently).

    The raw ``strikes`` list rides along so the tape/opportunities diff can
    compare this scan's per-strike volume/LTP/OI against the previous one.
    """
    try:
        chain = _chain_for_symbol(symbol, label)
        bundle = summarize_chain(label, chain)
        bundle["strikes"] = chain.get("strikes") or []
        return bundle
    except Exception:  # noqa: BLE001
        return None


def _finalize(rows: list[dict], calls: list[dict], puts: list[dict],
              unus: list[dict], expiries: list,
              tape: dict | None = None,
              opportunities: dict | None = None,
              breadth: dict | None = None) -> dict:
    top_expiry = collections.Counter(e for e in expiries if e).most_common(1)
    now_iso = datetime.now(IST).isoformat()
    if tape is None:
        tape = _warming_tape(_env_interval())
    if opportunities is None:
        opportunities = _warming_opps()
    if breadth is None:
        breadth = {"unavailable": True}
    return {
        "generated_at": now_iso,
        "expiry": top_expiry[0][0] if top_expiry else None,
        "sections": {
            "rows": rows,
            "top_call_buildup": rank_call_buildup(calls),
            "top_put_buildup": rank_put_buildup(puts),
            "pcr_extremes": rank_pcr_extremes(rows),
            "unusual": rank_unusual(unus),
            "tape": tape,
            "opportunities": opportunities,
            "breadth": breadth,
        },
        "status": {"state": "ready", "progress": len(rows),
                   "total": len(rows), "updated_at": now_iso},
    }


def _run_scan_sync(pairs: list[tuple[str, str]] | None = None) -> dict:
    """Synchronous full scan over ``pairs`` (defaults to the universe).

    Sequential with a 0.4s gap, 25s per-ticker timeout, progress log every
    25 tickers. ``pairs`` lets tests run a 3-ticker smoke instead.
    """
    work = list(pairs) if pairs is not None else _load_universe()
    total = len(work)
    started = time.time()
    global _PREV_STATE
    with _LOCK:
        _STATE["total"] = total
        _STATE["progress"] = 0
    print(f"[scan_data] starting scan over {total} underlyings", flush=True)

    rows: list[dict] = []
    calls: list[dict] = []
    puts: list[dict] = []
    unus: list[dict] = []
    expiries: list = []
    snapshots: list[tuple] = []
    if not work:
        return _finalize(rows, calls, puts, unus, expiries)

    # A sweep is a deliberate operation, so it opts out of the off-hours gate.
    # IMPORTANT: the exemption is thread-local, and the fetches run in a
    # ThreadPoolExecutor — so each worker must receive it too, otherwise every
    # call is silently blocked off-hours (the pool does the work, not this
    # thread) and the sweep "succeeds" with zero rows.
    #
    # The rate-limit latch is enforced separately inside the pacer, so this
    # exemption can never hammer a Cloudflare ban.
    import fyers_pacer  # noqa: PLC0415

    def _fetch_worker(label: str, symbol: str):
        with fyers_pacer.allow_offhours("scan-sweep"):
            return _fetch_one(label, symbol)

    with fyers_pacer.allow_offhours("scan-sweep"), cf.ThreadPoolExecutor(max_workers=1) as pool:
        for i, (label, symbol) in enumerate(work, 1):
            # Circuit breaker: a dead token / rate-limit ban fails every call,
            # so stop the sweep instead of burning hundreds of doomed requests.
            if i > 2 and fyers_data.fyers_paused():
                print(
                    f"[scan_data] aborting sweep at {i}/{total} — "
                    f"{fyers_data.pause_reason() or 'Fyers unavailable'}",
                    flush=True,
                )
                break
            fut = pool.submit(_fetch_worker, label, symbol)
            try:
                bundle = fut.result(timeout=_CHAIN_TIMEOUT)
            except Exception:  # noqa: BLE001  (timeout -> skip silently)
                bundle = None
            if bundle:
                rows.append(bundle["row"])
                if bundle["call"] is not None:
                    calls.append(bundle["call"])
                if bundle["put"] is not None:
                    puts.append(bundle["put"])
                if bundle["unusual"] is not None:
                    unus.append(bundle["unusual"])
                if bundle["expiry"]:
                    expiries.append(bundle["expiry"])
                snapshots.append(
                    (label, bundle.get("expiry"), bundle.get("strikes"))
                )
            with _LOCK:
                _STATE["progress"] = i
            time.sleep(_GAP)
            if i % _LOG_EVERY == 0 or i == total:
                print(f"[scan_data] progress {i}/{total} ({len(rows)} ok)",
                      flush=True)

    # Tape/opportunities: diff this scan's per-strike snapshot against the
    # previous one. Wrapped so a bad diff can never break the scan itself.
    now_iso = datetime.now(IST).isoformat()
    window_sec = _window_int(_env_interval())
    cur_state = _build_state(snapshots, now_iso, time.time())
    try:
        tape, opps = _diff_window(_PREV_STATE, cur_state, now_iso, window_sec)
    except Exception as exc:  # noqa: BLE001
        print(f"[scan_data] tape failed: {type(exc).__name__}", flush=True)
        tape, opps = _warming_tape(window_sec), _warming_opps()
    _PREV_STATE = cur_state
    _persist_state(cur_state)

    # Breadth + per-row %change from one batch-quotes sweep (<=50 names/call).
    # Wrapped end-to-end so a quotes failure can never break a scan: rows keep
    # chg_pct=None and sections.breadth reads {"unavailable": true}.
    labels = [label for label, _ in work]
    try:
        # Deliberate sweep: exempt the breadth quotes too (same thread-local
        # off-hours gate; the pacer's rate-limit latch still applies).
        import fyers_pacer  # noqa: PLC0415

        with fyers_pacer.allow_offhours("scan-breadth"):
            quotes, quotes_ok = _fetch_quotes(labels)
        breadth = _breadth_from_quotes(labels, quotes) if quotes_ok else {"unavailable": True}
        apply_chg_pct(rows, quotes, quotes_ok)
    except Exception as exc:  # noqa: BLE001
        print(f"[scan_data] breadth failed: {type(exc).__name__}", flush=True)
        breadth = {"unavailable": True}
        apply_chg_pct(rows, {}, False)

    payload = _finalize(rows, calls, puts, unus, expiries,
                        tape=tape, opportunities=opps, breadth=breadth)
    print(f"[scan_data] done: {len(rows)}/{total} rows in {time.time() - started:.0f}s",
          flush=True)
    return payload


# ---------------------------------------------------------------------------
# Background scheduling + public API
# ---------------------------------------------------------------------------

def _is_running() -> bool:
    with _LOCK:
        return _WORKER is not None and _WORKER.is_alive()


def _background_scan(exempt_reason: str | None = None) -> None:
    try:
        if exempt_reason:
            # Deliberate off-hours capture (EOD): exempt from the pacer gate.
            with fyers_pacer.allow_offhours(exempt_reason):
                payload = _run_scan_sync()
        else:
            payload = _run_scan_sync()
    except Exception:  # noqa: BLE001  (never kill the worker thread loudly)
        payload = None
    # Cache only non-empty boards; keep serving last-good otherwise.
    if payload and payload["sections"]["rows"]:
        _CACHE["payload"] = payload
        _CACHE["ts"] = time.time()
        # Persist for restart hydration (best-effort, never raises).
        _persist(payload)
    global _WORKER
    with _LOCK:
        _WORKER = None
    stored = _CACHE.get("payload")
    if stored is not None:
        stored["status"] = scan_status()


def _start_background(exempt_reason: str | None = None) -> None:
    global _WORKER
    with _LOCK:
        if _WORKER is not None and _WORKER.is_alive():
            return
        _WORKER = threading.Thread(
            target=_background_scan, args=(exempt_reason,), daemon=True
        )
        _WORKER.start()


# ---------------------------------------------------------------------------
# Disk persistence — last-good scan survives a restart. Helpers take an
# overridable ``root`` (default :data:`DATA_DIR`) and never raise.
# ---------------------------------------------------------------------------

def _latest_path(root: Path | str | None = None) -> Path:
    """``{root}/latest.json`` — the persisted last-good scan payload."""
    base = Path(root) if root is not None else DATA_DIR
    return base / _LATEST_NAME


def _payload_epoch(payload: dict) -> float:
    """Epoch seconds of a payload's ``generated_at`` (fallback: now)."""
    try:
        dt = datetime.fromisoformat(str((payload or {}).get("generated_at") or ""))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=IST)
        return dt.timestamp()
    except (TypeError, ValueError):
        return time.time()


def _payload_date(payload: dict) -> str | None:
    """IST calendar date (``YYYY-MM-DD``) a payload was generated, or None."""
    try:
        dt = datetime.fromisoformat(str((payload or {}).get("generated_at") or ""))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=IST)
        return dt.astimezone(IST).date().isoformat()
    except (TypeError, ValueError):
        return None


def _persist(payload: dict, root: Path | str | None = None) -> bool:
    """Atomically write ``payload`` to ``latest.json`` (tmp + ``os.replace``).

    Best-effort: a full/read-only disk logs briefly and returns False.
    """
    try:
        dest = _latest_path(root)
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(dest.name + ".tmp")
        tmp.write_text(
            json.dumps(payload, separators=(",", ":"), default=str),
            encoding="utf-8",
        )
        os.replace(tmp, dest)
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"[scan_data] persist failed: {type(exc).__name__}: {exc}"[:160], flush=True)
        return False


def _hydrate(root: Path | str | None = None) -> dict | None:
    """Restore the persisted payload into ``_CACHE`` (payload + ts + status).

    Missing or corrupt files are ignored (returns None), never raised.
    """
    path = _latest_path(root)
    try:
        if not path.is_file():
            return None
        obj = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001  (corrupt/partial file -> ignore)
        print(f"[scan_data] hydrate failed: {type(exc).__name__}", flush=True)
        return None
    if not isinstance(obj, dict) or not (obj.get("sections") or {}).get("rows"):
        return None
    with _LOCK:
        _CACHE["payload"] = obj
        _CACHE["ts"] = _payload_epoch(obj)
    obj["status"] = scan_status()  # re-derive state/updated_at after restore
    print(f"[scan_data] hydrated {len(obj['sections']['rows'])} rows from disk", flush=True)
    return obj


def _state_path(root: Path | str | None = None) -> Path:
    """``{root}/strike_state.json`` — the persisted tape/opportunities baseline."""
    base = Path(root) if root is not None else DATA_DIR
    return base / _STATE_NAME


def _persist_state(state: dict, root: Path | str | None = None) -> bool:
    """Atomically write the per-ticker strike baseline (tmp + ``os.replace``).

    Best-effort: a full/read-only disk logs briefly and returns False.
    """
    try:
        dest = _state_path(root)
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(dest.name + ".tmp")
        tmp.write_text(
            json.dumps(state, separators=(",", ":"), default=str),
            encoding="utf-8",
        )
        os.replace(tmp, dest)
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"[scan_data] state persist failed: {type(exc).__name__}: {exc}"[:160],
              flush=True)
        return False


def _hydrate_state(root: Path | str | None = None) -> dict | None:
    """Load the persisted strike baseline into ``_PREV_STATE``.

    Missing, empty or corrupt files are ignored (returns None), never raised;
    staleness is judged later by :func:`_baseline_missing_or_stale`.
    """
    global _PREV_STATE
    path = _state_path(root)
    try:
        if not path.is_file():
            return None
        obj = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001  (corrupt/partial file -> ignore)
        print(f"[scan_data] state hydrate failed: {type(exc).__name__}", flush=True)
        return None
    if not isinstance(obj, dict) or not obj.get("tickers"):
        return None
    _PREV_STATE = obj
    print(f"[scan_data] hydrated strike baseline ({len(obj['tickers'])} tickers)",
          flush=True)
    return obj


# ---------------------------------------------------------------------------
# Proactive scheduler — refresh on an interval, survive restarts.
# ---------------------------------------------------------------------------

def _is_market_open(now: datetime | None = None) -> bool:
    """True during Mon-Fri 09:15-15:30 IST (local copy, no oi_tracker import)."""
    cur = now or datetime.now(IST)
    if cur.tzinfo is None:
        cur = cur.replace(tzinfo=IST)
    else:
        cur = cur.astimezone(IST)
    if cur.weekday() >= 5:  # Sat / Sun
        return False
    mins = cur.hour * 60 + cur.minute
    return 9 * 60 + 15 <= mins <= 15 * 60 + 30


def _run_scan_blocking(exempt_reason: str | None = None) -> None:
    """Kick the shared worker and wait — no overlapping scans."""
    _start_background(exempt_reason)
    with _LOCK:
        worker = _WORKER
    if worker is not None:
        worker.join()


def _run_due_scan(now: float | None = None, today: date | None = None) -> bool:
    """Run one scheduled scan if due; returns True when a scan was started.

    Blocking: waits for the scan to finish so the next tick cannot overlap.
    During market hours a scan runs when the cache is older than
    :func:`_env_interval`; off-hours only when the cache is absent or from a
    previous session (post-close capture), and only if
    :data:`SCAN_OFFHOURS_ENABLED`.
    """
    if _is_running():
        return False

    now_ts = time.time() if now is None else now
    payload = _CACHE.get("payload")
    interval = _env_interval()
    age = now_ts - _CACHE.get("ts", 0.0)

    if _is_market_open():
        if payload is not None and age < interval:
            return False
        if payload is None:
            print("[scan_data] scheduled scan (no cached payload)", flush=True)
        else:
            print(f"[scan_data] scheduled scan (age {age:.0f}s >= {interval:.0f}s)",
                  flush=True)
        _run_scan_blocking()
        return True

    if not SCAN_OFFHOURS_ENABLED:
        return False
    today_iso = (today or datetime.now(IST).date()).isoformat()
    if payload is None:
        print("[scan_data] scheduled off-hours scan (no cached payload)", flush=True)
        _run_scan_blocking("scan-offhours-capture")
        return True
    if _payload_date(payload) != today_iso:
        print("[scan_data] scheduled off-hours scan (previous session)", flush=True)
        _run_scan_blocking("scan-offhours-capture")
        return True
    return False


def _loop() -> None:
    print(f"[scan_data] scheduler started (interval {_env_interval():.0f}s, "
          f"tick {_SCHED_TICK}s)", flush=True)
    while True:
        try:
            _run_due_scan()
        except Exception as exc:  # noqa: BLE001  (never kill the loop)
            print(f"[scan_data] scheduler error: {type(exc).__name__}: {exc}"[:160],
                  flush=True)
        time.sleep(_SCHED_TICK)


def ensure_started() -> None:
    """Hydrate the last scan from disk and start the scheduler once.

    Idempotent: extra calls are no-ops. The scheduler is a daemon thread.
    """
    global _STARTED
    if _STARTED:
        return
    _STARTED = True
    try:
        _hydrate()
    except Exception as exc:  # noqa: BLE001
        print(f"[scan_data] hydrate failed: {type(exc).__name__}: {exc}"[:160], flush=True)
    try:
        _hydrate_state()
    except Exception as exc:  # noqa: BLE001
        print(f"[scan_data] state hydrate failed: {type(exc).__name__}: {exc}"[:160],
              flush=True)
    threading.Thread(target=_loop, name="scan-scheduler", daemon=True).start()


def _empty_payload() -> dict:
    return {
        "generated_at": None,
        "expiry": None,
        "sections": {
            "rows": [],
            "top_call_buildup": [],
            "top_put_buildup": [],
            "pcr_extremes": {"lowest": [], "highest": []},
            "unusual": [],
            "tape": _warming_tape(_env_interval()),
            "opportunities": _warming_opps(),
            "breadth": {"unavailable": True},
        },
        "status": scan_status(),
    }


def scan_status() -> dict:
    """``{state: ready|running|empty, progress, total, updated_at}``."""
    with _LOCK:
        running = _WORKER is not None and _WORKER.is_alive()
        progress = _STATE.get("progress", 0)
        total = _STATE.get("total", 0)
    ts = _CACHE.get("ts", 0.0)
    has = _CACHE.get("payload") is not None
    state = "running" if running else ("ready" if has else "empty")
    return {
        "state": state,
        "progress": progress,
        "total": total,
        "updated_at": datetime.fromtimestamp(ts, tz=IST).isoformat() if ts else None,
    }


def cached_scan(trigger: bool = False) -> dict:
    """Market-wide scan payload, never blocking for minutes.

    ``trigger=False`` (default) is strictly read-only: it returns the cached
    (or disk-hydrated) last-good payload, or a status/empty payload when there
    is none, and **never** starts a scan. ``trigger=True`` preserves
    :func:`build_scan`'s lazy behaviour — serve fresh cache, otherwise serve
    last-good and kick a background refresh.
    """
    now = time.time()
    payload = _CACHE.get("payload")
    if payload is None:
        # Cold start (server restart): restore the persisted last-good scan so
        # the first request serves data instead of waiting ~3 minutes.
        payload = _hydrate()
    if not trigger:
        return payload if payload is not None else _empty_payload()
    if payload is not None and now - _CACHE.get("ts", 0.0) < _env_interval():
        return payload
    if _is_running():
        return payload if payload is not None else _empty_payload()
    _start_background()
    return payload if payload is not None else _empty_payload()


def build_scan() -> dict:
    """Lazy scan accessor (may kick a background refresh). See cached_scan."""
    return cached_scan(trigger=True)


if __name__ == "__main__":
    import json

    # Manual smoke test: 3 tickers only, never the full scan.
    probe = _load_universe()[:3]
    print(json.dumps({"universe_probe": [u for u, _ in probe],
                      "status_before": scan_status()}, indent=2))
    try:
        out = _run_scan_sync(probe)
        out["sections"]["rows"] = out["sections"]["rows"][:3]
        print(json.dumps(out, indent=2, default=str)[:3000])
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": type(exc).__name__}))
