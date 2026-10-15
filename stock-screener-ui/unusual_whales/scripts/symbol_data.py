#!/usr/bin/env python3
"""Per-ticker data bundles for the symbol drill-down view.

Every accessible per-ticker endpoint is grouped into lazy-loaded tabs. The
server fetches one group at a time (concurrently), trims heavy payloads, and
caches briefly so the UI stays responsive and the API quota is respected.
"""
from __future__ import annotations

import concurrent.futures as cf
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from uw_client import UWClient  # noqa: E402
import market_status  # noqa: E402

# group -> list of (key, path, params). "@expiry" = nearest expiry.
GROUPS: dict[str, list] = {
    "overview": [
        ("info", "/api/stock/{ticker}/info", {}),
        ("stock_state", "/api/stock/{ticker}/stock-state", {}),
        ("quote", "/api/stock/{ticker}/quote", {}),
        ("unusualness", "/api/stock/{ticker}/unusualness", {}),
        ("gex_levels", "/api/stock/{ticker}/gex-levels", {}),
        ("max_pain", "/api/stock/{ticker}/max-pain", {}),
        ("options_volume", "/api/stock/{ticker}/options-volume", {}),
        ("iv_rank", "/api/stock/{ticker}/iv-rank", {}),
        ("vol_stats", "/api/stock/{ticker}/volatility/stats", {}),
        ("ohlc_daily", "/api/stock/{ticker}/ohlc/1d", {}),
    ],
    "news": [
        ("news", "/api/news/headlines", {"ticker": "@ticker", "limit": 40}),
    ],
    # single-request bundle for the cockpit tab — adds gex_matrix via _build_gexmatrix
    "today": [
        ("stock_state", "/api/stock/{ticker}/stock-state", {}),
        ("gex_levels", "/api/stock/{ticker}/gex-levels", {}),
        ("max_pain", "/api/stock/{ticker}/max-pain", {}),
        ("options_volume", "/api/stock/{ticker}/options-volume", {}),
        ("iv_rank", "/api/stock/{ticker}/iv-rank", {}),
        ("vol_stats", "/api/stock/{ticker}/volatility/stats", {}),
        ("ohlc_5m", "/api/stock/{ticker}/ohlc/5m", {}),
        ("net_prem_ticks", "/api/stock/{ticker}/net-prem-ticks", {}),
    ],
    # strike × expiry exposure matrix — assembled by _build_gexmatrix (multi-call)
    "gexmatrix": [],
    # BullFlow-style GEX chart: live 5m candles + dealer levels + the exposure matrix
    "gexchart": [
        ("stock_state", "/api/stock/{ticker}/stock-state", {}),
        ("gex_levels", "/api/stock/{ticker}/gex-levels", {}),
        ("max_pain", "/api/stock/{ticker}/max-pain", {}),
        ("ohlc_5m", "/api/stock/{ticker}/ohlc/5m", {}),
    ],
    "intraday": [
        ("stock_state", "/api/stock/{ticker}/stock-state", {}),
        ("gex_levels", "/api/stock/{ticker}/gex-levels", {}),
        ("max_pain", "/api/stock/{ticker}/max-pain", {}),
        ("options_volume", "/api/stock/{ticker}/options-volume", {}),
        ("vol_stats", "/api/stock/{ticker}/volatility/stats", {}),
        ("iv_rank", "/api/stock/{ticker}/iv-rank", {}),
        ("ohlc_5m", "/api/stock/{ticker}/ohlc/5m", {}),
        ("ohlc_1m", "/api/stock/{ticker}/ohlc/1m", {}),
        ("net_prem_ticks", "/api/stock/{ticker}/net-prem-ticks", {}),
        ("greek_flow", "/api/stock/{ticker}/greek-flow", {}),
        ("nope", "/api/stock/{ticker}/nope", {}),
        ("spot_exposures", "/api/stock/{ticker}/spot-exposures", {}),
        ("flow_per_strike_intraday", "/api/stock/{ticker}/flow-per-strike-intraday", {}),
    ],
    "whales": [
        ("stock_state", "/api/stock/{ticker}/stock-state", {}),
        ("gex_levels", "/api/stock/{ticker}/gex-levels", {}),
        ("options_volume", "/api/stock/{ticker}/options-volume", {}),
        ("flow_alerts", "/api/stock/{ticker}/flow-alerts", {}),
        ("flow_per_strike", "/api/stock/{ticker}/flow-per-strike", {}),
        ("flow_per_expiry", "/api/stock/{ticker}/flow-per-expiry", {}),
        ("oi_change", "/api/stock/{ticker}/oi-change", {}),
        ("net_prem_ticks", "/api/stock/{ticker}/net-prem-ticks", {}),
        ("max_pain", "/api/stock/{ticker}/max-pain", {}),
        ("darkpool_levels", "/api/darkpool/{ticker}/price-levels", {}),
    ],
    "timeline": [
        ("stock_state", "/api/stock/{ticker}/stock-state", {}),
        ("gex_levels", "/api/stock/{ticker}/gex-levels", {}),
        ("flow_alerts", "/api/stock/{ticker}/flow-alerts", {}),
        ("flow_ticks", "/api/stock/{ticker}/flow-per-strike-intraday", {}),
        ("darkpool", "/api/darkpool/{ticker}", {}),
        ("net_prem_ticks", "/api/stock/{ticker}/net-prem-ticks", {}),
        # underlying price time series (spot_exposures[].price) so the cumulative
        # net-premium chart can overlay price — net_prem_ticks has no price field
        ("spot_exposures", "/api/stock/{ticker}/spot-exposures", {}),
    ],
    "flow": [
        ("flow_recent", "/api/stock/{ticker}/flow-recent", {}),
        ("flow_alerts", "/api/stock/{ticker}/flow-alerts", {}),
        ("net_prem_ticks", "/api/stock/{ticker}/net-prem-ticks", {}),
        ("flow_per_strike", "/api/stock/{ticker}/flow-per-strike", {}),
        ("flow_per_expiry", "/api/stock/{ticker}/flow-per-expiry", {}),
        ("flow_per_strike_intraday", "/api/stock/{ticker}/flow-per-strike-intraday", {}),
        ("oi_change", "/api/stock/{ticker}/oi-change", {}),
        ("options_volume", "/api/stock/{ticker}/options-volume", {}),
        ("option_stance", "/api/stock/{ticker}/option-stance", {"stance": "directional"}),
        ("options_pulse", "/api/stock/{ticker}/options-pulse", {}),
        ("greek_flow", "/api/stock/{ticker}/greek-flow", {}),
        ("nope", "/api/stock/{ticker}/nope", {}),
        ("net_flow_expiry", "/api/net-flow/expiry", {}),
        # underlying price time series so the net-premium chart can overlay price
        ("spot_exposures", "/api/stock/{ticker}/spot-exposures", {}),
    ],
    "gex": [
        ("gex_levels", "/api/stock/{ticker}/gex-levels", {}),
        ("greek_exposure_strike", "/api/stock/{ticker}/greek-exposure/strike", {}),
        ("greek_exposure_expiry", "/api/stock/{ticker}/greek-exposure/expiry", {}),
        ("greek_exposure_daily", "/api/stock/{ticker}/greek-exposure", {}),
        ("spot_exposure_strike", "/api/stock/{ticker}/spot-exposures/strike", {}),
        ("spot_exposure_daily", "/api/stock/{ticker}/spot-exposures", {}),
        ("max_pain", "/api/stock/{ticker}/max-pain", {}),
        ("oi_per_strike", "/api/stock/{ticker}/oi-per-strike", {}),
        ("spot_by_expiry_strike", "/api/stock/{ticker}/spot-exposures/{expiry}/strike", {}),
    ],
    "options": [
        ("contracts", "/api/stock/{ticker}/option-contracts", {}),
        ("expiry_breakdown", "/api/stock/{ticker}/expiry-breakdown", {}),
        ("oi_per_strike", "/api/stock/{ticker}/oi-per-strike", {}),
        ("oi_per_expiry", "/api/stock/{ticker}/oi-per-expiry", {}),
        ("volume_oi_expiry", "/api/stock/{ticker}/option/volume-oi-expiry", {}),
        ("atm_chains", "/api/stock/{ticker}/atm-chains", {"expirations[]": "@expiry"}),
        ("greeks", "/api/stock/{ticker}/greeks", {"expiry": "@expiry"}),
        ("max_pain", "/api/stock/{ticker}/max-pain", {}),
        ("price_levels", "/api/stock/{ticker}/option/stock-price-levels", {}),
    ],
    "vol": [
        ("interpolated_iv", "/api/stock/{ticker}/interpolated-iv", {}),
        ("interp_iv_dist", "/api/stock/{ticker}/interpolated-iv/distribution", {}),
        ("iv_rank", "/api/stock/{ticker}/iv-rank", {}),
        ("vol_stats", "/api/stock/{ticker}/volatility/stats", {}),
        ("realized", "/api/stock/{ticker}/volatility/realized", {}),
        ("realized_windows", "/api/stock/{ticker}/volatility/realized/windows", {}),
        ("term_structure", "/api/stock/{ticker}/volatility/term-structure", {}),
        ("term_structure_dist", "/api/stock/{ticker}/volatility/term-structure/distribution", {}),
        ("variance_risk_premium", "/api/stock/{ticker}/volatility/variance-risk-premium", {}),
        ("vrp_windows", "/api/stock/{ticker}/volatility/variance-risk-premium/windows", {}),
        ("vol_anomaly", "/api/stock/{ticker}/volatility/anomaly", {}),
        ("vol_character", "/api/stock/{ticker}/volatility/character", {}),
        ("option_sentiment", "/api/stock/{ticker}/volatility/option-sentiment", {}),
        ("risk_reversal_skew", "/api/stock/{ticker}/historical-risk-reversal-skew", {"expiry": "@expiry", "delta": "25"}),
    ],
    "darkpool": [
        ("darkpool", "/api/darkpool/{ticker}", {}),
        ("darkpool_levels", "/api/darkpool/{ticker}/price-levels", {}),
        ("lit_flow", "/api/lit-flow/{ticker}", {}),
        ("volume_price_levels", "/api/stock/{ticker}/stock-volume-price-levels", {}),
    ],
    "shorts": [
        ("short_data", "/api/shorts/{ticker}/data", {}),
        ("ftds", "/api/shorts/{ticker}/ftds", {}),
        ("interest_float", "/api/shorts/{ticker}/interest-float/v2", {}),
        ("volume_ratio", "/api/shorts/{ticker}/volume-and-ratio", {}),
        ("by_exchange", "/api/shorts/{ticker}/volumes-by-exchange", {}),
    ],
    "insiders": [
        ("insiders", "/api/insider/{ticker}", {}),
        ("ticker_flow", "/api/insider/{ticker}/ticker-flow", {}),
        ("buy_sells", "/api/stock/{ticker}/insider-buy-sells", {}),
        ("ownership", "/api/institution/{ticker}/ownership", {}),
    ],
    "etf": [
        ("info", "/api/etfs/{ticker}/info", {}),
        ("holdings", "/api/etfs/{ticker}/holdings", {}),
        ("exposure", "/api/etfs/{ticker}/exposure", {}),
        ("in_outflow", "/api/etfs/{ticker}/in-outflow", {}),
        ("weights", "/api/etfs/{ticker}/weights", {}),
        ("etf_tide", "/api/market/{ticker}/etf-tide", {}),
    ],
}

# keys that should show as "tier-gated" in the UI
GATED = [
    ("profile", "/api/companies/{ticker}/profile", "Advanced+"),
    ("dividends", "/api/companies/{ticker}/dividends", "Advanced+"),
    ("splits", "/api/companies/{ticker}/splits", "Advanced+"),
    ("earnings_estimates", "/api/companies/{ticker}/earnings-estimates", "Advanced+"),
    ("ownership_detail", "/api/stock/{ticker}/ownership", "Enterprise"),
]

_CACHE: dict[str, tuple[float, dict]] = {}
_TTL = {"open": 90, "premarket": 120, "afterhours": 180, "closed": 300}
_GRP_TTL = 600
_UNIVERSE: list[str] = []
_UNIVERSE_TS = 0.0
_EXCHANGE: dict[str, str] = {}
_EXPIRY: dict[str, tuple[float, str]] = {}
_client = UWClient()

# Unusual Whales exchange -> TradingView exchange prefix
_TV_EXCHANGE = {"nasdaq": "NASDAQ", "nyse": "NYSE", "bats": "BATS", "amex": "AMEX", "otc": "OTC"}


def _ts_key(r):
    if not isinstance(r, dict):
        return ""
    for k in ("start_time", "timestamp", "created_at", "executed_at", "time", "tape_time", "date", "trd_dt"):
        v = r.get(k)
        if v:
            return str(v)
    return ""


def _last_session(rows, cap=600, regular_only=False):
    """Keep the most recent session's rows (oldest-first), downsampled to cap."""
    if not rows:
        return rows
    keys = [_ts_key(r) for r in rows]
    dates = [k[:10] for k in keys if k]
    if dates:
        d = max(dates)
        out = [r for r, k in zip(rows, keys) if k[:10] == d]
    else:
        out = list(rows)
    if regular_only:
        reg = [r for r in out if str(r.get("market_time") or "r") == "r"]
        if reg:
            out = reg
    out.sort(key=_ts_key)
    if len(out) > cap:
        step = len(out) / cap
        out = [out[min(len(out) - 1, int(i * step))] for i in range(cap)]
    return out


def _pick(rows, fields):
    return [{k: r.get(k) for k in fields} for r in rows]


def _fnum(v):
    """Coerce possibly-string numerics for sorting; never raises."""
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _top_union(rows, n_latest, n_top, prem_key="premium"):
    """Latest-N plus top-N by premium (dedup) — avoids recency bias so
    'largest' tables and timelines cover the whole session, not just the tail."""
    if not rows:
        return rows
    latest = rows[:n_latest]
    try:
        top = sorted(rows, key=lambda r: abs(float(r.get(prem_key) or 0)), reverse=True)[:n_top]
    except Exception:  # noqa: BLE001
        top = []
    seen, out = set(), []
    for r in list(latest) + list(top):
        k = (
            str(r.get("option_chain") or r.get("option_symbol") or ""),
            str(_ts_key(r)),
            str(r.get("premium") or r.get("total_premium") or ""),
            str(r.get("size") or r.get("volume") or ""),
        )
        if k in seen:
            continue
        seen.add(k)
        out.append(r)
    return out


def _trim(key: str, data):
    """Cap heavy payloads so the browser stays fast."""
    if isinstance(data, list) and key in ("ohlc_5m", "ohlc_1m"):
        return _last_session(data, cap=420, regular_only=True)
    if isinstance(data, list) and key == "spot_exposures":
        return _pick(_last_session(data, cap=320), ["time", "start_time", "price", "gamma_per_one_percent_move_dir", "charm_per_one_percent_move_dir"])
    if isinstance(data, list) and key == "darkpool":
        return _last_session(_top_union(data, 1200, 1200), cap=20000)
    if isinstance(data, list) and key == "flow_per_strike":
        return _pick(data, ["strike", "call_volume", "put_volume", "call_premium", "put_premium"])
    if isinstance(data, list) and key == "flow_ticks":
        return _pick(_last_session(data, cap=800), ["timestamp", "strike", "net_premium", "call_premium", "put_premium", "volume", "call_volume", "put_volume", "call_volume_ask_side", "call_volume_bid_side", "put_volume_ask_side", "put_volume_bid_side", "call_premium_ask_side", "call_premium_bid_side", "put_premium_ask_side", "put_premium_bid_side", "trades"])
    if isinstance(data, list) and key == "flow_per_strike_intraday":
        return _pick(_last_session(data, cap=20000), ["timestamp", "strike", "net_premium", "call_premium", "put_premium", "volume"])
    if isinstance(data, list) and key == "net_flow_expiry":
        # /api/net-flow/expiry returns [{data:[rows], moneyness, tide_type}, ...]
        # (fetch_group already peeled the outer {"data": ...}); flatten any
        # nested series, keep the latest session, cap for the browser.
        rows = []
        for w in data:
            inner = w.get("data") if isinstance(w, dict) else None
            if isinstance(inner, list):
                rows.extend(inner)
            elif isinstance(w, dict):
                rows.append(w)
        return _pick(
            _last_session(rows, cap=400),
            ["timestamp", "date", "net_call_premium", "net_put_premium", "net_volume", "underlying_price"],
        )
    if isinstance(data, dict) and key == "financials":
        for k, v in list(data.items()):
            if isinstance(v, list) and len(v) > 12:
                data[k] = v[-12:]
        return data
    if isinstance(data, list):
        if key in ("contracts", "option_chains"):
            return data[:300]
        if key in ("flow_per_strike_intraday",):
            return data[-150:]
        if key in ("net_prem_ticks", "greek_flow", "nope"):
            return _last_session(data, cap=400)
        if key in ("realized_windows", "vrp_windows"):
            return data[-180:]
        if key in ("flow_per_strike",):
            return data[:600]
        if key in ("flow_alerts",):
            return _top_union(data, 200, 100, prem_key="total_premium")
        if key in ("greek_exposure_strike", "spot_exposure_strike", "oi_per_strike", "greek_exposure_daily", "spot_exposure_daily"):
            return data[:200]
        if key in ("spot_by_expiry_strike",):
            return data[:60]
        if key in ("income", "balance", "cashflow", "earnings"):
            return data[:12]
        if key in ("earnings_history",):
            return data[:40]
        if key in ("seasonality_year_month", "rsi", "macd", "sma50"):
            return data[:120]
        if key == "volume_price_levels":
            return sorted(data, key=lambda x: _fnum(x.get("lit_vol")) + _fnum(x.get("off_vol")), reverse=True)[:80]
        if key == "price_levels":
            return sorted(data, key=lambda x: _fnum(x.get("call_volume")) + _fnum(x.get("put_volume")), reverse=True)[:80]
        if key in ("buy_sells", "shorts_data"):
            return data[-300:]
        if key in ("ftds", "short_data"):
            return data[-500:]
        if key == "news":
            return data[:60]
        return data[:800] if len(data) > 800 else data
    return data


def _nearest_expiry(ticker: str) -> str:
    now = time.time()
    cached = _EXPIRY.get(ticker)
    if cached and now - cached[0] < _GRP_TTL:
        return cached[1]
    exp = ""
    try:
        r = _client.get(f"/api/stock/{ticker}/expiry-breakdown", timeout=20)
        if r.status_code == 200:
            rows = r.json().get("data") or []
            if rows:
                exp = str(rows[0].get("expires") or rows[0].get("expiry") or "")[:10]
    except Exception:  # noqa: BLE001
        pass
    _EXPIRY[ticker] = (now, exp)
    return exp


def _prev_session_dates(n: int = 5) -> list[str]:
    """Most recent completed US trading weekdays, newest first (skips weekends)."""
    d = datetime.now(ZoneInfo("America/New_York")).date()
    out: list[str] = []
    step = 1
    while len(out) < n:
        cand = d - timedelta(days=step)
        if cand.weekday() < 5:
            out.append(cand.isoformat())
        step += 1
    return out


def _options_pulse_prior(path: str, empty: dict) -> dict:
    """options-pulse only populates for *completed* sessions; today's bucket is
    empty intraday. Fall back to the most recent prior trading day."""
    for d in _prev_session_dates():
        try:
            r = _client.get(path, timeout=30, date=d)
        except Exception:  # noqa: BLE001
            break
        if r.status_code != 200:
            continue
        j = r.json()
        data = j.get("data") if isinstance(j, dict) and "data" in j else j
        if isinstance(data, dict) and (data.get("latest") or data.get("intraday")):
            return data
    return empty


def _build_gexmatrix(ticker: str, n_expiries: int = 8) -> dict:
    """Assemble a strike × expiry dealer-exposure matrix.

    `/greek-exposure/strike-expiry` is single-expiry, so we fan out over the next
    expiries and stitch the grid. ALL strikes are kept (the UI scrolls); expiries
    are bounded only to keep the API-call count sane.
    """
    spot = 0.0
    try:
        st = _client.get(f"/api/stock/{ticker}/stock-state", timeout=20)
        if st.status_code == 200:
            d = st.json().get("data")
            if isinstance(d, list):
                d = d[0] if d else {}
            spot = _fnum((d or {}).get("close"))
    except Exception:  # noqa: BLE001
        pass

    exps: list[str] = []
    try:
        r = _client.get(f"/api/stock/{ticker}/expiry-breakdown", timeout=20)
        if r.status_code == 200:
            for x in r.json().get("data") or []:
                e = str(x.get("expires") or x.get("expiry") or "")[:10]
                if e and e not in exps:
                    exps.append(e)
    except Exception:  # noqa: BLE001
        pass
    exps = exps[: max(1, n_expiries)]

    def one(e):
        try:
            r = _client.get(f"/api/stock/{ticker}/greek-exposure/strike-expiry", expiry=e, timeout=25)
            if r.status_code == 200:
                return e, (r.json().get("data") or [])
        except Exception:  # noqa: BLE001
            pass
        return e, []

    raw: list = []
    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        for e, rows in pool.map(one, exps):
            for x in rows or []:
                raw.append((e, x))

    all_strikes = sorted({_fnum(x.get("strike")) for _, x in raw if _fnum(x.get("strike"))})
    strikes = all_strikes  # full data — the panel scrolls; nothing dropped
    keep = set(strikes)

    cells = []
    for e, x in raw:
        k = _fnum(x.get("strike"))
        if k not in keep:
            continue
        cells.append({
            "e": e,
            "k": k,
            "gex": round(_fnum(x.get("call_gex")) + _fnum(x.get("put_gex")), 2),
            "delta": round(_fnum(x.get("call_delta")) + _fnum(x.get("put_delta")), 2),
            "charm": round(_fnum(x.get("call_charm")) + _fnum(x.get("put_charm")), 2),
            "vanna": round(_fnum(x.get("call_vanna")) + _fnum(x.get("put_vanna")), 2),
        })
    return {"spot": round(spot, 2), "expiries": exps, "strikes": sorted(strikes, reverse=True), "cells": cells}


def fetch_group(ticker: str, group: str) -> dict:
    ticker = ticker.upper()
    if group not in GROUPS:
        raise ValueError(f"unknown group: {group}")
    ck = f"{ticker}:{group}"
    now = time.time()
    hit = _CACHE.get(ck)
    if hit and now - hit[0] < _TTL.get(market_status.phase(), 120):
        return hit[1]

    specs = GROUPS[group]
    needs_expiry = any("{expiry}" in p or any(v == "@expiry" for v in params.values()) for _, p, params in specs)
    expiry = _nearest_expiry(ticker) if needs_expiry else ""

    def one(spec):
        key, path, params = spec
        path = path.replace("{ticker}", ticker).replace("{expiry}", expiry)
        q = {}
        for k, v in params.items():
            if v == "@expiry":
                q[k] = expiry
            elif v == "@ticker":
                q[k] = ticker
            else:
                q[k] = v
        try:
            r = None
            for attempt in range(3):
                r = _client.get(path, timeout=30, **q)
                if r.status_code == 429:
                    time.sleep(1.2 * (attempt + 1))
                    continue
                break
            if r.status_code == 200:
                j = r.json()
                if isinstance(j, list):
                    data = j
                elif isinstance(j, dict):
                    data = j.get("data") if "data" in j else j
                else:
                    data = j
                if key == "options_pulse" and isinstance(data, dict) and not (data.get("latest") or data.get("intraday")):
                    data = _options_pulse_prior(path, data)
                return key, _trim(key, data)
            if r.status_code in (401, 403):
                body = {}
                try:
                    body = r.json()
                except Exception:  # noqa: BLE001
                    pass
                return key, {"__error": body.get("code") or "forbidden", "message": (body.get("message") or "")[:160]}
            return key, {"__error": f"http_{r.status_code}"}
        except Exception as exc:  # noqa: BLE001
            return key, {"__error": type(exc).__name__}

    out: dict = {}
    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        for key, val in pool.map(one, specs):
            out[key] = val
    if group in ("today", "gexmatrix", "gexchart"):
        out["gex_matrix"] = _build_gexmatrix(ticker)
    payload = {"ticker": ticker, "group": group, "expiry": expiry, "tv": tv_symbol(ticker), "data": out,
               "gated": [{"key": k, "path": p.replace("{ticker}", ticker), "tier": t} for k, p, t in GATED]}
    _CACHE[ck] = (time.time(), payload)
    return payload


def universe() -> list[str]:
    global _UNIVERSE, _UNIVERSE_TS, _EXCHANGE
    if _UNIVERSE and time.time() - _UNIVERSE_TS < 86400:
        return _UNIVERSE
    try:
        r = _client.get("/api/stock-directory/ticker-exchanges", timeout=40)
        if r.status_code == 200:
            rows = r.json().get("data") or []
            tickers = sorted({str(x.get("ticker")).upper() for x in rows if x.get("ticker")})
            exch = {
                str(x.get("ticker")).upper(): _TV_EXCHANGE.get(str(x.get("exchange")).lower(), str(x.get("exchange")).upper())
                for x in rows
                if x.get("ticker") and x.get("exchange")
            }
            if tickers:
                _UNIVERSE = tickers
                _EXCHANGE = exch
                _UNIVERSE_TS = time.time()
    except Exception:  # noqa: BLE001
        pass
    return _UNIVERSE


def tv_symbol(ticker: str) -> str:
    """Return a TradingView symbol like NASDAQ:NVDA (falls back to bare ticker)."""
    ticker = ticker.upper()
    if not _EXCHANGE:
        universe()
    ex = _EXCHANGE.get(ticker)
    return f"{ex}:{ticker}" if ex else ticker


def search_symbols(q: str, limit: int = 20) -> list[str]:
    q = (q or "").upper().strip()
    uni = universe()
    if not q:
        return uni[:limit]
    starts = [t for t in uni if t.startswith(q)]
    contains = [t for t in uni if q in t and not t.startswith(q)]
    return (starts + contains)[:limit]


if __name__ == "__main__":
    import json

    t = sys.argv[1] if len(sys.argv) > 1 else "NVDA"
    g = sys.argv[2] if len(sys.argv) > 2 else "overview"
    res = fetch_group(t, g)
    print(json.dumps({k: (len(v) if isinstance(v, list) else type(v).__name__) for k, v in res["data"].items()}, indent=2))
