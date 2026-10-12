"""FastAPI compatibility server: UNMODIFIED dashboard-v2 <-> TradingView engine.

One process can serve one or both markets (``--market both``, the default).
Routes pick a market with ``?market=india|america``; the dashboard top bar
exposes an India/US switcher that sets it. An old client that sends no
``market`` gets the primary (first) market, so single-market runs behave
exactly as before.
Run: ``python -m edge_scanner_tv.server --market both --port 7777 --limit 50``.

Lifespan: for each market, fetch_universe (limit flag) -> tv_tickers map ->
EdgeScannerTV + TradingViewFeed -> warmup() in a background thread (yfinance is
slow; the server starts serving before warmup completes) -> 60s poll loop that
(1) pulls fresh 1-min yfinance bars and runs the real triggers via on_bar()
(hod_breakout, vwap_reclaim/reject, ema3_9_cross, orb15_breakout, momentum_5m,
rvol_spike), and (2) appends the snapshot-level proxies via scan_snapshot() to
that market's alert log.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, RedirectResponse

from . import store
from .markets import MARKETS
from .triggers import SETUPS, setup_group

log = logging.getLogger(__name__)

ALERT_CAP = 5000
POLL_SEC = 60
BARS_CACHE_SEC = 60

# dashboard TF -> feed timeframe names (feed maps these to yfinance intervals)
_TF_MAP = {
    "1min": "1Min", "5min": "5Min", "15min": "15Min", "30min": "30Min",
    "1hour": "1Hour", "4hour": "4Hour",
    "1day": "Day", "1d": "Day", "day": "Day",
    "1week": "1Week", "1w": "1Week", "week": "1Week",
    # feed-native names pass through (case-insensitive)
    "1min_": "1Min", "5min_": "5Min",
}

# alert setups that count as HOD/LOD-style events (honest subset of triggers)
_EVENT_KEYWORDS = ("breakout", "hod", "lod", "momentum", "52w", "orb")

_SETUP_NAMES = {
    "breakout": "Breakout", "52w": "52W High", "vwap": "VWAP",
    "ema": "EMA Cross", "orb": "Opening Range", "momentum": "Momentum",
    "rvol": "RVOL Spike",
}

# Human label for the specific trigger behind an alert (the Setup badge shows
# this; the group code drives filters). Falls back to Title Case.
_TRIGGER_LABELS = {
    "hod_breakout": "HOD Breakout", "lod_breakdown": "LOD Breakdown",
    "vwap_reclaim": "VWAP Reclaim", "vwap_reject": "VWAP Reject",
    "above_vwap_proxy": "Above VWAP (proxy)",
    "orb15_breakout": "ORB Breakout", "orb15_breakdown": "ORB Breakdown",
    "ema3_9_bull": "EMA 3/9 Bull", "ema3_9_bear": "EMA 3/9 Bear",
    "momentum_5m": "Momentum 5m", "momentum_day": "Momentum (Day)",
    "rvol_spike": "RVOL Spike", "near_52w_high": "Near 52W High",
}


def _trigger_label(setup: str) -> str:
    return _TRIGGER_LABELS.get(setup, setup.replace("_", " ").title())


def _pct_change_5m(bars: list[dict] | None, back: int = 5) -> float | None:
    """Percent change over the last `back` 1-minute bars, or None if too few."""
    if not bars or len(bars) < back + 1:
        return None
    try:
        cur = float(bars[-1].get("close"))
        base = float(bars[-(back + 1)].get("close"))
    except (TypeError, ValueError):
        return None
    if base <= 0:
        return None
    return (cur / base - 1) * 100


# ── per-app runtime state ─────────────────────────────────────────────────

class _State:
    def __init__(self, market_key: str, limit: int) -> None:
        self.market_key = market_key
        self.market = MARKETS[market_key]
        self.limit = limit
        self.lock = threading.Lock()
        self.symbols: list[str] = []
        self.tv_tickers: dict[str, str] = {}
        self.universe_rows: list[dict] = []
        self.feed: Any = None
        self.scanner: Any = None
        self.snapshots: dict[str, dict] = {}
        self.snapshots_at: str = store.now_iso()
        self.alerts: list[dict] = []  # newest-first, full Alert JSON
        self.seq = 0
        self.last_bar_ts: dict[str, str] = {}  # symbol -> newest 1-min bar ts fed
        self.bars_cache = store.TTLCache(BARS_CACHE_SEC)
        self.settings_values: dict = {}
        self.profiles: list = []
        self.assignments: dict = {}
        self.parameter_sets: list = []
        self.toplists_cfg: dict[str, dict] = {
            d["name"]: dict(d) for d in store.TOPLIST_DEFS
        }
        self.ready = False


class _TvStates:
    """Every market engine this process serves, keyed by market.

    Routes select one with ``?market=india`` / ``?market=america`` (the alert
    WebSocket takes the same query param). When the param is missing or unknown
    the primary market wins, so a single-market process behaves exactly as
    before and an older client that sends no ``market`` still gets data.
    """

    def __init__(self, market_keys: list[str], limit: int) -> None:
        self.states = {k: _State(k, limit) for k in market_keys}
        self.primary = market_keys[0]

    def resolve(self, market: str | None) -> _State:
        if market:
            st = self.states.get(market.lower().strip())
            if st is not None:
                return st
        return self.states[self.primary]

    @property
    def keys(self) -> list[str]:
        return list(self.states)


def _get(request: Request) -> _State:
    return request.app.state.tv.resolve(request.query_params.get("market"))


# ── alert shaping ─────────────────────────────────────────────────────────

def _score(change: float) -> int:
    try:
        return 50 + min(49, int(abs(float(change)) * 10))
    except (TypeError, ValueError):
        return 50


def to_alert(raw: dict, snapshots: dict, seq: int) -> dict:
    """Map an engine alert dict to the dashboard Alert shape (§2).

    `setup` is the system setup-group code (breakout/vwap/ema/orb/momentum/rvol)
    so dashboard filters match; `setup_label` carries the specific trigger name.
    """
    symbol = str(raw.get("symbol", "")).upper()
    trigger = str(raw.get("setup") or raw.get("trigger") or "unknown")
    group = setup_group(trigger)
    direction = str(raw.get("direction", "neutral")).lower()
    if direction not in ("long", "short"):
        direction = "neutral"
    snap = snapshots.get(symbol, {}) if isinstance(snapshots, dict) else {}
    try:
        price = float(raw.get("price", 0) or 0)
    except (TypeError, ValueError):
        price = 0.0
    change = snap.get("change", 0) if isinstance(snap, dict) else 0
    return store.sanitize({
        "symbol": symbol,
        "direction": direction,
        "timestamp": store.coerce_ts(raw.get("ts") or raw.get("timestamp")),
        "price": price,
        "trigger": trigger,
        "triggers_fired": [trigger],
        "score": _score(change),
        "market_regime": "neutral",
        "conditions": {},
        "vwap": None, "ema3": None, "ema9": None,
        "pct_change": change,
        "rvol": snap.get("rvol") if isinstance(snap, dict) else None,
        "setup": group,
        "setup_label": _trigger_label(trigger),
        "source": "system",
        "seq": seq,
    })


# ── snapshot shaping ──────────────────────────────────────────────────────

def _prior_close(sym: str, snap: dict, daily_ctx: dict) -> float | None:
    ctx = daily_ctx.get(sym, {}) if isinstance(daily_ctx, dict) else {}
    if ctx.get("prior_close"):
        return ctx["prior_close"]
    close = snap.get("close", 0) or 0
    chg = snap.get("change", 0) or 0
    if close > 0:
        try:
            return close / (1 + chg / 100)
        except ZeroDivisionError:
            return close
    return None


def snapshot_row(sym: str, snap: dict, daily_ctx: dict) -> dict:
    close = snap.get("close")
    chg = snap.get("change")
    prior = _prior_close(sym, snap, daily_ctx)
    return store.sanitize({
        "price": close,
        "prior_close": prior,
        "chg_pct": chg,
        "rth_chg_pct": chg,
        "rvol": snap.get("rvol"),
        "vwap": None,
        "dist_vwap_pct": None,
        "hod": snap.get("high"),
        "lod": snap.get("low"),
        "gap_pct": snap.get("gap"),
    })


# ── background loop ───────────────────────────────────────────────────────

def _frame_to_bars(sym: str, df) -> list[dict]:
    """yfinance 1-min frame -> edge-scanner bar dicts (UTC ISO timestamps)."""
    bars: list[dict] = []
    for ts, row in df.iterrows():
        try:
            close = float(row["close"])
            if close != close or close <= 0:  # NaN or bad row
                continue
            bars.append({
                "symbol": sym,
                "timestamp": ts.isoformat() if hasattr(ts, "isoformat") else str(ts),
                "open": float(row["open"]), "high": float(row["high"]),
                "low": float(row["low"]), "close": close,
                "volume": float(row["volume"]), "vwap": close,
            })
        except (TypeError, ValueError, KeyError):
            continue
    return bars


def _feed_minute_bars(st: _State) -> list[dict]:
    """Feed real 1-minute yfinance bars into the scanner's bar path.

    The first time a symbol is seen (or on a new session) its session bars are
    seeded directly — no alerts — so ORB/EMA/VWAP have opening-range context.
    Only genuinely new bars then go through ``on_bar()``, which runs every real
    trigger: hod_breakout / lod_breakdown, vwap_reclaim / vwap_reject,
    ema3_9_cross, orb15_breakout, momentum_5m, rvol_spike. One batch yfinance
    call per poll.
    """
    if st.scanner is None or st.feed is None or not st.symbols:
        return []
    # Poll only while the session is live, plus one seeding fetch at startup.
    if st.last_bar_ts and not st.market.is_open():
        return []
    try:
        frames = st.feed.get_intraday_minute_frames(st.symbols)
    except Exception as exc:
        log.warning("minute bars failed for %s: %s", st.market_key, exc)
        return []
    out: list[dict] = []
    for sym, df in frames.items():
        bars = _frame_to_bars(sym, df)
        if not bars:
            continue
        last = st.last_bar_ts.get(sym)
        if last is None or bars[-1]["timestamp"][:10] != last[:10]:
            # Seed / re-seed the session without emitting (avoids replay burst).
            st.scanner.bars[sym] = bars[-400:]
            st.last_bar_ts[sym] = bars[-1]["timestamp"]
            continue
        fresh = [b for b in bars if b["timestamp"] > last]
        if not fresh:
            continue
        for b in fresh:
            for alert in st.scanner.on_bar(b):
                out.append({"symbol": alert.symbol, "setup": alert.setup,
                            "direction": alert.direction, "price": alert.price,
                            "why": alert.why})
        st.last_bar_ts[sym] = fresh[-1]["timestamp"]
    return out


def _poll_once(st: _State) -> None:
    try:
        snaps = st.feed.get_snapshot(st.symbols, tv_tickers=st.tv_tickers)
    except Exception as exc:
        log.warning("snapshot poll failed: %s", exc)
        snaps = {}
    # Real intraday setups from 1-min bars, then the snapshot-level proxies.
    fresh: list[dict] = list(_feed_minute_bars(st))
    try:
        fresh += st.scanner.scan_snapshot(snaps) or []
    except Exception as exc:
        log.warning("scan_snapshot failed: %s", exc)
    with st.lock:
        if snaps:
            st.snapshots = snaps
            st.snapshots_at = store.now_iso()
        # One row per symbol: drop the older entry before inserting, so the
        # alert table never shows the same symbol on 2-3 rows (one per setup).
        # Reversed so the first-emitted (highest-priority) setup per symbol
        # ends up newest and survives the collapse.
        for raw in reversed(fresh):
            st.seq += 1
            sym = (raw.get("symbol") or "").upper()
            if sym:
                st.alerts = [a for a in st.alerts
                             if (a.get("symbol") or "").upper() != sym]
            st.alerts.insert(0, to_alert(raw, st.snapshots, st.seq))
        del st.alerts[ALERT_CAP:]


def _background(st: _State) -> None:
    try:
        st.scanner.warmup()
    except Exception as exc:
        log.warning("warmup failed: %s", exc)
    st.ready = True
    while True:
        _poll_once(st)
        time.sleep(POLL_SEC)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    tv: _TvStates = app.state.tv
    # Lazy imports: keep `import server` network- and dependency-free.
    from .scanner import EdgeScannerTV
    from .tv_feed import TradingViewFeed
    from .tv_universe import fetch_universe

    for st in tv.states.values():
        try:
            rows = await asyncio.to_thread(
                fetch_universe, st.market, st.limit)
        except Exception as exc:
            log.warning("fetch_universe failed for %s: %s", st.market_key, exc)
            rows = []
        st.universe_rows = rows or []
        st.symbols = [str(r.get("symbol", "")).upper()
                      for r in st.universe_rows if r.get("symbol")]
        st.tv_tickers = {s: r.get("tv_ticker", s) for s, r in
                         zip(st.symbols, st.universe_rows)}
        st.feed = TradingViewFeed(st.market)
        st.scanner = EdgeScannerTV(st.symbols, st.feed, st.market,
                                   tv_tickers=st.tv_tickers)
        threading.Thread(target=_background, args=(st,), daemon=True).start()
    yield


# ── app factory ───────────────────────────────────────────────────────────

def _parse_market_keys(raw: str) -> list[str]:
    """'both' | 'india' | 'america' | 'india,america' -> ordered market keys."""
    raw = (raw or "india").lower().strip()
    if raw in ("both", "all", "*"):
        return list(MARKETS)
    keys = [k.strip() for k in raw.split(",") if k.strip()]
    unknown = [k for k in keys if k not in MARKETS]
    if unknown:
        raise ValueError(f"unknown market(s) {unknown}; "
                         f"expected one of: {sorted(MARKETS)} or 'both'")
    return keys or ["india"]


def create_app(market_key: str = "india", limit: int = 100) -> FastAPI:
    raw = market_key or os.environ.get("EDGE_MARKET", "india")
    keys = _parse_market_keys(raw)
    app = FastAPI(title=f"edge-scanner-tv ({', '.join(keys)})")
    app.state.tv = _TvStates(keys, limit)
    app.router.lifespan_context = _lifespan

    # ── layouts ──
    @app.get("/api/v2/layouts")
    def get_layouts(request: Request):
        st = _get(request)
        return {"screens": store.load_list(st.market_key, "layouts.json")}

    @app.put("/api/v2/layouts/{screen_id}")
    async def put_layout(screen_id: str, request: Request):
        st = _get(request)
        body = await request.json()
        screens = store.load_list(st.market_key, "layouts.json")
        screens = [s for s in screens
                   if not (isinstance(s, dict) and s.get("id") == screen_id)]
        if isinstance(body, dict):
            body.setdefault("id", screen_id)
            screens.append(body)
        store.save_list(st.market_key, "layouts.json", screens)
        return {"ok": True}

    @app.delete("/api/v2/layouts/{screen_id}")
    def del_layout(screen_id: str, request: Request):
        st = _get(request)
        screens = [s for s in store.load_list(st.market_key, "layouts.json")
                   if not (isinstance(s, dict) and s.get("id") == screen_id)]
        store.save_list(st.market_key, "layouts.json", screens)
        return {"ok": True}

    # ── universe ──
    @app.get("/api/v2/universe/meta")
    def universe_meta(request: Request):
        st = _get(request)
        with st.lock:
            syms = list(st.symbols)
            snaps = dict(st.snapshots)
        ctx = st.scanner.daily_ctx if st.scanner else {}
        meta = {}
        for i, sym in enumerate(syms):
            snap = snaps.get(sym, {})
            uni = st.universe_rows[i] if i < len(st.universe_rows) else {}
            last = snap.get("close") or uni.get("close")
            avg = (ctx.get(sym, {}) or {}).get("avg_vol") or snap.get("volume")
            meta[sym] = store.sanitize(
                {"last_price": last, "avg_vol_20d": avg})
        return {"symbols": syms, "meta": meta}

    @app.get("/api/universe")
    def universe_legacy(request: Request):
        st = _get(request)
        with st.lock:
            syms = list(st.symbols)
        return {"symbols": syms, "count": len(syms)}

    # ── watchlists ──
    @app.get("/api/v2/watchlists")
    def get_watchlists(request: Request):
        st = _get(request)
        return {"watchlists": store.load_list(st.market_key, "watchlists.json")}

    @app.put("/api/v2/watchlists/{wl_id}")
    async def put_watchlist(wl_id: str, request: Request):
        st = _get(request)
        body = await request.json()
        lists = store.load_list(st.market_key, "watchlists.json")
        lists = [w for w in lists
                 if not (isinstance(w, dict) and w.get("id") == wl_id)]
        if isinstance(body, dict):
            body.setdefault("id", wl_id)
            body.setdefault("updatedAt", store.now_iso())
            lists.append(body)
        store.save_list(st.market_key, "watchlists.json", lists)
        return {"ok": True}

    @app.delete("/api/v2/watchlists/{wl_id}")
    def del_watchlist(wl_id: str, request: Request):
        st = _get(request)
        lists = [w for w in store.load_list(st.market_key, "watchlists.json")
                 if not (isinstance(w, dict) and w.get("id") == wl_id)]
        store.save_list(st.market_key, "watchlists.json", lists)
        return {"ok": True}

    # ── capabilities / setups ──
    @app.get("/api/v2/capabilities")
    def capabilities():
        return {"system_setups": True}

    @app.get("/api/v2/markets")
    def markets_meta():
        """Markets this process serves (the dashboard shows a switcher for >1)."""
        return {"markets": keys, "primary": keys[0], "default": keys[0]}

    def _setups_payload():
        system = [{"code": c, "name": _SETUP_NAMES.get(c, c),
                   "direction": "both"} for c in SETUPS]
        catalog = [{
            "id": c, "name": _SETUP_NAMES.get(c, c), "category": "intraday",
            "desc": trig, "direction": "both", "options": [], "params": [],
            "sessions": ["rth"], "source": "native", "default_options": [],
        } for c, trig in SETUPS.items()]
        return {"system": system, "custom": [], "catalog": catalog,
                "stats": {"since": None, "setups": {}}, "live": True}

    @app.get("/api/v2/setups")
    def get_setups():
        return _setups_payload()

    @app.put("/api/v2/setups/names")
    async def rename_setups(request: Request):
        body = await request.json()
        names = body if isinstance(body, dict) else {}
        return {"ok": True, "names": names}

    @app.put("/api/v2/setups/{setup_id}")
    async def save_setup(setup_id: str, request: Request):
        body = await request.json()
        return {"ok": True, "setup": body}

    @app.delete("/api/v2/setups/{setup_id}")
    def del_setup(setup_id: str):
        return {"ok": True}

    _CHECK_MSG = "per-setup check not implemented in TV slice"

    @app.get("/api/v2/setups/{setup_id}/check")
    def setup_check(setup_id: str, symbol: str = ""):
        sym = symbol.upper()
        return {"symbol": sym, "in_universe": bool(sym),
                "setup": setup_id, "fired": False, "gates": [],
                "notes": [_CHECK_MSG], "context": {},
                "message": _CHECK_MSG}

    @app.get("/api/v2/check/{symbol}")
    def check_symbol(symbol: str, request: Request):
        st = _get(request)
        sym = symbol.upper()
        with st.lock:
            found = sym in st.symbols
        return {"symbol": sym, "found": found, "setups": [],
                "message": _CHECK_MSG}

    # ── clock ──
    @app.get("/api/v2/clock")
    def clock(request: Request):
        st = _get(request)
        m = st.market
        now = datetime.now(m.tz)
        mins = now.hour * 60 + now.minute
        if m.is_open(now):
            session = "rth"
        elif mins < m.open_min:
            session = "pre"
        elif mins >= m.close_min:
            session = "post"
        else:
            session = "closed"
        return {"now_et": now.isoformat(), "session": session,
                "regime": "neutral", "spy": None, "next_change_et": None}

    # ── toplists ──
    @app.get("/api/v2/toplists")
    def toplists_cfg(request: Request):
        st = _get(request)
        return {"toplists": list(st.toplists_cfg.values())}

    @app.put("/api/v2/toplists/{name}")
    async def put_toplist(name: str, request: Request):
        st = _get(request)
        try:
            body = await request.json()
        except Exception:
            body = {}
        cfg = st.toplists_cfg.get(name, {"name": name, "label": name,
                                         "universe": "up_all", "rows": 25,
                                         "scope": "full"})
        if isinstance(body, dict):
            if "rows" in body:
                cfg["rows"] = body["rows"]
            if "universe" in body:
                cfg["universe"] = body["universe"]
        st.toplists_cfg[name] = cfg
        return {"toplists": list(st.toplists_cfg.values())}

    @app.get("/api/v2/toplists/{name}")
    def toplist_rows(name: str, request: Request, limit: int = 25):
        st = _get(request)
        with st.lock:
            snaps = dict(st.snapshots)
            as_of = st.snapshots_at
            bars_by_sym = ({k: list(v) for k, v in st.scanner.bars.items()}
                           if st.scanner else {})
        rows = []
        for sym, s in snaps.items():
            chg = s.get("change")
            rows.append(store.sanitize({
                "symbol": sym, "price": s.get("close"), "value": chg,
                "chg_pct": chg, "chg_5m": _pct_change_5m(bars_by_sym.get(sym)),
                "rvol": s.get("rvol"), "volume": s.get("volume")}))
        lname = (name or "").lower()
        if "rvol" in lname:
            for r in rows:
                r["value"] = r["rvol"]
            rows.sort(key=lambda r: (r["value"] is None, r["value"] or 0),
                      reverse=True)
        elif "loser" in lname:
            rows.sort(key=lambda r: (r["value"] is None, r["value"] or 0))
        elif "active" in lname or "volume" in lname:
            for r in rows:
                r["value"] = r["volume"]
            rows.sort(key=lambda r: (r["value"] is None, r["value"] or 0),
                      reverse=True)
        elif "5m" in lname or "mover" in lname:
            # Real 5-minute change from the scanner's 1-min bars; fall back to
            # day change until enough bars have accumulated for a symbol.
            for r in rows:
                r["value"] = r["chg_5m"] if r["chg_5m"] is not None else r["chg_pct"]
            rows.sort(key=lambda r: (r["value"] is None, r["value"] or 0),
                      reverse=True)
        else:  # gainers / highs / default: day change desc
            rows.sort(key=lambda r: (r["value"] is None, r["value"] or 0),
                      reverse=True)
        return {"list": name, "as_of": as_of, "rows": rows[:max(limit, 0)]}

    # ── events ──
    @app.get("/api/v2/events")
    def events(request: Request, since: int = 0, limit: int = 200):
        st = _get(request)
        with st.lock:
            alerts = list(st.alerts)
            cur = st.seq
        evts = []
        for a in alerts:
            setup = str(a.get("setup", "")).lower()
            if not any(k in setup for k in _EVENT_KEYWORDS):
                continue
            if (a.get("seq") or 0) <= since:
                continue
            evts.append({
                "seq": a.get("seq"), "symbol": a.get("symbol"),
                "type": "HOD" if a.get("direction") == "long" else "LOD",
                "price": a.get("price"), "ts": a.get("timestamp")})
        evts.sort(key=lambda e: e["seq"] or 0, reverse=True)
        return {"seq": cur, "events": evts[:max(limit, 0)]}

    # ── snapshot ──
    @app.get("/api/v2/snapshot")
    def snapshot(request: Request, symbols: str = ""):
        st = _get(request)
        wanted = [s.strip().upper() for s in symbols.split(",") if s.strip()]
        with st.lock:
            snaps = dict(st.snapshots)
            as_of = st.snapshots_at
        ctx = st.scanner.daily_ctx if st.scanner else {}
        rows = {s: snapshot_row(s, snaps[s], ctx)
                for s in wanted if s in snaps}
        return {"as_of": as_of, "rows": rows}

    # ── state ──
    @app.get("/api/v2/state/{symbol}")
    def state(symbol: str, request: Request):
        st = _get(request)
        sym = symbol.upper()
        with st.lock:
            snap = dict(st.snapshots.get(sym, {}))
            as_of = st.snapshots_at
        if not snap:
            return {"found": False, "symbol": sym}
        ctx = (st.scanner.daily_ctx.get(sym, {}) if st.scanner else {})
        return store.sanitize({
            "found": True, "symbol": sym, "as_of": as_of,
            "price": snap.get("close"),
            "prior_close": _prior_close(sym, snap, {sym: ctx}),
            "chg_pct": snap.get("change"),
            "rsi": snap.get("rsi"), "adx": snap.get("adx"),
            "sector": snap.get("sector"),
            "sma50": ctx.get("sma50"), "sma200": ctx.get("sma200"),
            "atr_d1": ctx.get("atr"),
        })

    # ── bars ──
    @app.get("/api/bars/{symbol}/{timeframe}")
    def bars(symbol: str, timeframe: str, request: Request):
        st = _get(request)
        tf = _TF_MAP.get(timeframe.lower(), _TF_MAP.get(timeframe))
        if tf is None:
            return JSONResponse({"error": f"unknown timeframe {timeframe!r}"},
                                status_code=400)
        sym = symbol.upper()
        key = f"{sym}/{tf}"
        cached = st.bars_cache.get(key)
        if cached is not None:
            return cached
        if st.feed is None:
            return {"bars": []}
        end = date.today()
        start = end - timedelta(days=5 if tf not in ("Day", "1Week") else 730)
        try:
            df = st.feed.get_historical_bars(sym, tf, start, end)
        except Exception as exc:
            log.warning("bars %s %s failed: %s", sym, tf, exc)
            return {"bars": [], "error": str(exc)}
        out = []
        if df is not None and not df.empty:
            for ts, row in df.iterrows():
                try:
                    t = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
                    out.append(store.sanitize({
                        "t": t, "o": float(row["open"]),
                        "h": float(row["high"]), "l": float(row["low"]),
                        "c": float(row["close"]), "v": float(row["volume"])}))
                except (TypeError, ValueError, KeyError):
                    continue
        payload = {"bars": out}
        st.bars_cache.set(key, payload)
        return payload

    # ── fundamentals / news / premarket ──
    @app.get("/api/v2/fundamentals/{symbol}")
    def fundamentals(symbol: str, request: Request):
        st = _get(request)
        sym = symbol.upper()
        with st.lock:
            snap = st.snapshots.get(sym)
        if not snap:
            return {"symbol": sym, "ok": False, "pending": False}
        return store.sanitize({"symbol": sym, "ok": True, "name": sym,
                               "sector": snap.get("sector"),
                               "market_cap": snap.get("mcap")})

    @app.get("/api/v2/news")
    def news(limit: int = 20, hours: int = 24):
        return {"fetched_at": store.now_iso(), "items": []}

    @app.get("/api/premarket")
    def premarket(request: Request):
        st = _get(request)
        with st.lock:
            total, active = len(st.symbols), len(st.snapshots)
        return {"gainers": [], "losers": [], "volume": [],
                "symbols_total": total, "symbols_active": active,
                "fetched_at": store.now_iso()}

    # ── settings ──
    @app.get("/api/v2/settings")
    def get_settings(request: Request):
        return store.settings_payload(_get(request).settings_values)

    @app.put("/api/v2/settings")
    async def put_settings(request: Request):
        st = _get(request)
        body = await request.json()
        if isinstance(body, dict) and isinstance(body.get("values"), dict):
            st.settings_values.update(body["values"])
        return store.settings_payload(st.settings_values)

    @app.post("/api/v2/settings/reset")
    async def reset_settings(request: Request):
        st = _get(request)
        st.settings_values = {}
        return store.settings_payload({})

    @app.get("/api/v2/settings/stats")
    def settings_stats():
        return {"setups": {}, "alerts": 0}

    @app.put("/api/v2/settings/presets/{name}")
    def save_preset(name: str):
        return {"ok": True}

    @app.post("/api/v2/settings/presets/{name}/apply")
    def apply_preset(name: str, request: Request):
        return store.settings_payload(_get(request).settings_values)

    @app.delete("/api/v2/settings/presets/{name}")
    def del_preset(name: str):
        return {"ok": True}

    # ── universe profiles ──
    def _profiles(st: _State):
        return store.profiles_payload(len(st.symbols), st.profiles,
                                      st.assignments, st.parameter_sets)

    @app.get("/api/v2/universe/profiles")
    def get_profiles(request: Request):
        return _profiles(_get(request))

    @app.put("/api/v2/universe/profiles/{pid}")
    async def put_profile(pid: str, request: Request):
        st = _get(request)
        body = await request.json()
        if isinstance(body, dict):
            body.setdefault("id", pid)
            st.profiles = [p for p in st.profiles
                           if not (isinstance(p, dict) and p.get("id") == pid)]
            st.profiles.append(body)
        return {"ok": True, "profile": body, **_profiles(st)}

    @app.delete("/api/v2/universe/profiles/{pid}")
    def del_profile(pid: str, request: Request):
        st = _get(request)
        st.profiles = [p for p in st.profiles
                       if not (isinstance(p, dict) and p.get("id") == pid)]
        return {"ok": True, **_profiles(st)}

    @app.put("/api/v2/universe/assignments")
    async def put_assignments(request: Request):
        st = _get(request)
        body = await request.json()
        if isinstance(body, dict):
            st.assignments.update(body)
        return {"ok": True, **_profiles(st)}

    @app.get("/api/v2/universe/profiles/{pid}/members")
    def profile_members(pid: str, request: Request, limit: int = 200):
        st = _get(request)
        with st.lock:
            syms = list(st.symbols)
        name = next((p.get("name", pid) for p in st.profiles
                     if isinstance(p, dict) and p.get("id") == pid), pid)
        return {"id": pid, "name": name, "universe_size": len(syms),
                "count": 0, "symbols": [], "truncated": False,
                "static_conditions": 0, "dynamic_conditions": 0}

    @app.put("/api/v2/universe/paramsets/{pid}")
    async def put_paramset(pid: str, request: Request):
        st = _get(request)
        body = await request.json()
        if isinstance(body, dict):
            body.setdefault("id", pid)
            st.parameter_sets = [
                p for p in st.parameter_sets
                if not (isinstance(p, dict) and p.get("id") == pid)]
            st.parameter_sets.append(body)
        return {"ok": True, **_profiles(st)}

    @app.delete("/api/v2/universe/paramsets/{pid}")
    def del_paramset(pid: str, request: Request):
        st = _get(request)
        st.parameter_sets = [
            p for p in st.parameter_sets
            if not (isinstance(p, dict) and p.get("id") == pid)]
        return {"ok": True, **_profiles(st)}

    # ── websocket ──
    @app.websocket("/ws/alerts")
    async def ws_alerts(ws: WebSocket):
        await ws.accept()
        params = dict(ws.query_params)
        filt = {s.strip().upper() for s in
                params.get("symbols", "").split(",") if s.strip()}
        st: _State = ws.app.state.tv.resolve(params.get("market"))

        def _visible(a: dict) -> bool:
            return not filt or a.get("symbol") in filt

        with st.lock:
            replay = [a for a in st.alerts if _visible(a)]
            last_seq = st.seq
        try:
            await ws.send_json({"type": "replay", "alerts": replay})
            while True:
                await asyncio.sleep(1.0)
                with st.lock:
                    fresh = [a for a in st.alerts
                             if (a.get("seq") or 0) > last_seq
                             and _visible(a)]
                    if fresh:
                        last_seq = max(a.get("seq") or last_seq
                                       for a in fresh)
                for a in sorted(fresh, key=lambda x: x.get("seq") or 0):
                    await ws.send_json({"type": "alert", "alert": a})
        except (WebSocketDisconnect, RuntimeError):
            pass

    # ── static dashboard + root ──
    @app.get("/")
    def root():
        return RedirectResponse("/v2/")

    from pathlib import Path as _P
    _candidates = []
    if os.environ.get("DASH_DIST"):
        _candidates.append(_P(os.environ["DASH_DIST"]))
    _candidates += [
        _P("/tmp/opencode/edge-scan-ref/dashboard-v2/dist"),
        _P(__file__).resolve().parent / "dashboard-v2" / "dist",
    ]
    dist = next((d for d in _candidates if str(d) and d.is_dir()), None)
    if dist is not None:
        from fastapi.staticfiles import StaticFiles
        app.mount("/v2", StaticFiles(directory=str(dist), html=True),
                  name="v2")
    else:
        @app.get("/v2/")
        @app.get("/v2/{path:path}")
        def v2_missing(path: str = ""):
            return JSONResponse({"error": "dashboard not built"},
                                status_code=503)

    return app


# ── entrypoint ────────────────────────────────────────────────────────────

def main() -> None:
    import uvicorn

    parser = argparse.ArgumentParser(description="TV-backed edge scanner API")
    parser.add_argument("--market", default=os.environ.get("EDGE_MARKET",
                                                           "both"),
                        help="'both' (default) | 'india' | 'america' | "
                             "'india,america'")
    parser.add_argument("--port", type=int, default=7777)
    parser.add_argument("--limit", type=int, default=50)
    args = parser.parse_args()
    app = create_app(args.market, args.limit)
    uvicorn.run(app, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
