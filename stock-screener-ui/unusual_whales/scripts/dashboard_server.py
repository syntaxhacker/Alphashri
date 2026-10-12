#!/usr/bin/env python3
"""Local read-only dashboard for the Unusual Whales alpha snapshot.

The API key never reaches the browser: this server fetches UW data and serves
JSON + a static page on localhost.

    python scripts/dashboard_server.py --port 8901
"""
from __future__ import annotations

import argparse
import concurrent.futures as futures
import json
import math
import os
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from snapshot_data import build_snapshot  # noqa: E402
import market_status  # noqa: E402
import symbol_data  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "dashboard" / "index.html"


def _num(v):
    """Coerce to a finite float, else None."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

_cache: dict = {"ts": 0.0, "payload": None, "building": False, "evt": threading.Event()}
_lock = threading.Lock()


def get_snapshot() -> dict:
    ttl = market_status.ttl()
    with _lock:
        if _cache["payload"] is not None and (time.time() - _cache["ts"]) < ttl:
            return _cache["payload"]
        if _cache["building"]:
            evt = _cache["evt"]  # another request is already building — wait for it
        else:
            _cache["building"] = True
            _cache["evt"] = threading.Event()
            evt = None
    if evt is not None:
        evt.wait(60)
        with _lock:
            return _cache["payload"] or {"sections": {}, "market": market_status.status_payload()}
    try:
        payload = build_snapshot()
        payload["market"] = market_status.status_payload()
    except Exception:
        with _lock:
            _cache["building"] = False
            _cache["evt"].set()
        raise
    with _lock:
        _cache["payload"] = payload          # set payload before ts so a reader
        _cache["ts"] = time.time()           # never pairs a fresh ts with old data
        _cache["building"] = False
        _cache["evt"].set()
    return payload


def _qint(qs: dict, key: str, default: int, lo: int = 1, hi: int = 500) -> int:
    """Clamp a query-string integer; malformed input falls back to the default."""
    try:
        return max(lo, min(int((qs.get(key) or [default])[0]), hi))
    except (TypeError, ValueError):
        return default


# ------------------------------------------------------------- edge pipeline
_last_px_cache: dict = {}
_last_px_lock = threading.Lock()
_LAST_PX_TTL = 60
_WHALE_STATE_BUDGET = 25       # max `/stock-state` fallbacks per whales request


def _edge_status() -> dict:
    """`{configured, resolving, last_run}` for the /api/edge header."""
    try:
        from edge_resolver import state as _st  # noqa: PLC0415

        s = _st()
    except Exception:  # noqa: BLE001
        s = {"resolving": False, "last_run": None}
    ok = False
    try:
        import edge_store  # noqa: PLC0415

        ok = edge_store.init()
    except Exception:  # noqa: BLE001
        ok = False
    return {"configured": bool(ok), "resolving": bool(s.get("resolving")), "last_run": s.get("last_run")}


def _stock_state_last(ticker: str, budget: list):
    """Latest close from `/stock-state`, cached 60s. Consumes one budget slot."""
    if not ticker:
        return None
    now = time.time()
    with _last_px_lock:
        c = _last_px_cache.get(ticker)
        if c and now - c[0] < _LAST_PX_TTL:
            return c[1]
    if budget and budget[0] <= 0:
        return None
    val = None
    try:
        from uw_client import UWClient  # noqa: PLC0415

        r = UWClient().get(f"/api/stock/{ticker}/stock-state", timeout=10)
        if r.status_code == 200:
            d = r.json().get("data")
            d = d[0] if isinstance(d, list) and d else (d or {})
            val = _num(d.get("close"))
    except Exception:  # noqa: BLE001
        val = None
    if budget:
        budget[0] -= 1
    with _last_px_lock:
        _last_px_cache[ticker] = (now, val)
    return val


def _augment_whales(rows: list) -> list:
    """Add entry/last price + move + win status to persisted alert rows."""
    from edge_resolver import direction  # noqa: PLC0415
    import edge_store  # noqa: PLC0415

    tickers = sorted({str(r.get("ticker") or "").upper() for r in rows if r.get("ticker")})
    bars_cache: dict = {}
    for t in tickers:
        bars_cache[t] = edge_store.get_bars(t)
    budget = [_WHALE_STATE_BUDGET]
    out = []
    for r in rows:
        d = direction(r.get("side"))
        t = str(r.get("ticker") or "").upper()
        bars = bars_cache.get(t) or []
        ev = str(r.get("event_ts") or "")
        entry_px = None
        for b in bars:  # intraday bar at/after the alert
            if b["ts"].endswith("T00:00:00Z"):
                continue
            if ev and b["ts"] >= ev:
                entry_px = _num(b.get("c"))
                break
        if entry_px is None and ev:  # daily close at/after the alert's date
            date = ev[:10]
            for b in bars:
                if b["ts"].endswith("T00:00:00Z") and b["ts"][:10] >= date:
                    entry_px = _num(b.get("c"))
                    break
        last_px = _num(bars[-1].get("c")) if bars else None
        if last_px is None:
            last_px = _stock_state_last(t, budget)
        move = None
        if d and entry_px and last_px:
            move = round(d * (last_px / entry_px - 1.0) * 100.0, 2)
        if move is None:
            status = "unknown"
        elif move > 0.25:
            status = "winning"
        elif move < -0.25:
            status = "wrecked"
        else:
            status = "flat"
        row = dict(r)
        row.update({"dir": d, "entry_px": entry_px, "last_px": last_px, "move_pct": move, "status": status})
        out.append(row)
    return out


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # quiet
        pass

    def _send(self, code: int, body: bytes, ctype: str):
        try:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # client navigated away

    # --------------------------------------------------------------- SSE helpers
    def _sse_open(self) -> None:
        """Write the SSE response headers (no Content-Length — this streams)."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

    def _sse(self, event: str, data: dict) -> bool:
        """Emit one SSE event. Returns False when the client has gone away."""
        try:
            body = f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"
            self.wfile.write(body.encode("utf-8"))
            self.wfile.flush()
            return True
        except (BrokenPipeError, ConnectionResetError, OSError):
            return False

    def _sse_ping(self) -> bool:
        """Heartbeat comment so half-open connections surface quickly."""
        try:
            self.wfile.write(b": ping\n\n")
            self.wfile.flush()
            return True
        except (BrokenPipeError, ConnectionResetError, OSError):
            return False

    def _stream_alerts(self) -> None:
        """GET /api/stream/alerts — live flow/unusual/dark-pool + OI over SSE."""
        from stream_data import HUB  # noqa: PLC0415

        HUB.start()
        snap = HUB.snapshot()
        seen = set(snap.get("ids") or [])          # seed so backlog isn't "new"
        oi_seen = set(snap.get("oi_ids") or [])
        phase = snap.get("phase") or market_status.phase()

        self._sse_open()
        if not self._sse("status", {"phase": phase, "connected": True}):
            return
        if not self._sse("snapshot", {"ids": list(snap.get("ids") or [])}):
            return
        # initial render: full backlog + counts, but the client already has the
        # snapshot ids so it won't treat these as fresh notifications
        if not self._sse(
            "live",
            {
                "ts": snap.get("ts") or _now_iso(),
                "phase": phase,
                "counts": snap.get("counts") or {},
                "total": snap.get("total") or 0,
                "new": snap.get("items") or [],
            },
        ):
            return

        last_ping = time.time()
        while True:
            new, _version, phase = HUB.poll(seen)
            if new and not self._sse("live", {"ts": _now_iso(), "phase": phase, "new": new}):
                return
            oi_new, _oi_version = HUB.poll_oi(oi_seen)
            if oi_new and not self._sse("oi", {"new": oi_new}):
                return
            if time.time() - last_ping >= 15:
                if not self._sse_ping():
                    return
                last_ping = time.time()
            time.sleep(1)

    @staticmethod
    def _quote_row(client, ticker: str):
        """One `/api/stock/{t}/stock-state` row, shaped for the SSE quote contract."""
        try:
            r = client.get(f"/api/stock/{ticker}/stock-state", timeout=15)
            if r.status_code != 200:
                return None
            payload = r.json()
            data = payload.get("data") if isinstance(payload, dict) else payload
            if isinstance(data, list):
                data = data[0] if data else {}
            d = data or {}
            last = _num(d.get("close"))
            prev = _num(d.get("prev_close"))
            chg = ((last / prev - 1.0) * 100.0) if (last and prev) else None
            return {
                "ticker": ticker,
                "last": round(last, 4) if last is not None else None,
                "prev_close": round(prev, 4) if prev is not None else None,
                "chg_pct": round(chg, 2) if chg is not None else None,
                "market_time": d.get("market_time"),
                "ts": _now_iso(),
            }
        except Exception:  # noqa: BLE001
            return None

    def _fetch_quotes(self, client, tickers: list):
        workers = max(1, min(8, len(tickers)))
        with futures.ThreadPoolExecutor(max_workers=workers) as pool:
            return list(pool.map(lambda t: self._quote_row(client, t), tickers))

    def _stream_quote(self, qs: dict) -> None:
        """GET /api/stream/quote?tickers=A,B — live NBBO-ish state over SSE."""
        raw = (qs.get("tickers") or [""])[0]
        tickers = [t.strip().upper() for t in raw.split(",") if t.strip()][:20]

        try:
            from uw_client import UWClient  # noqa: PLC0415

            client = UWClient()
        except Exception:  # noqa: BLE001
            client = None

        self._sse_open()
        sigs: dict = {}
        last_emit: dict = {}
        last_ping = time.time()
        try:
            while True:
                phase = market_status.phase()
                if client is not None and tickers:
                    rows = self._fetch_quotes(client, tickers)
                    now = time.time()
                    for row in rows:
                        if not row:
                            continue
                        t = row["ticker"]
                        sig = (row["last"], row["prev_close"], row["chg_pct"], row["market_time"])
                        if sig != sigs.get(t) or (now - last_emit.get(t, 0.0)) >= 5:
                            if not self._sse("quote", row):
                                return
                            sigs[t] = sig
                            last_emit[t] = now
                if time.time() - last_ping >= 15:
                    if not self._sse_ping():
                        return
                    last_ping = time.time()
                time.sleep(2 if phase == "open" else 15)
        except (BrokenPipeError, ConnectionResetError):
            return

    def do_GET(self):  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)
        if path in ("/", "/index.html"):
            self._send(200, INDEX.read_bytes(), "text/html; charset=utf-8")
        elif path.startswith(("/panels/", "/vendor/")) or path in ("/app.js", "/symbol.js", "/info.js", "/charts.js", "/hints.js", "/heat.js", "/screener.js", "/opps.js", "/week.js", "/day.js", "/tape.js", "/news.js", "/alerts.js", "/freshness.js", "/pulse.js", "/tour.js", "/stream.js", "/mode.js", "/edge.js"):
            base = (ROOT / "dashboard").resolve()
            f = (base / path.lstrip("/")).resolve()
            if f.is_relative_to(base) and f.is_file():
                ctype = "application/javascript" if f.suffix == ".js" else "text/plain"
                self._send(200, f.read_bytes(), ctype + "; charset=utf-8")
            else:
                self._send(404, b"not found", "text/plain")
        elif path == "/api/snapshot":
            try:
                self._send(200, json.dumps(get_snapshot()).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/symbols":
            q = (qs.get("q") or [""])[0]
            try:
                self._send(200, json.dumps({"symbols": symbol_data.search_symbols(q)}).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path.startswith("/api/symbol/"):
            ticker = path.rsplit("/", 1)[-1].upper()
            group = (qs.get("group") or ["overview"])[0]
            try:
                self._send(200, json.dumps(symbol_data.fetch_group(ticker, group)).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/opps":
            try:
                from opps_data import build_opps  # noqa: PLC0415

                self._send(200, json.dumps(build_opps()).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/news":
            try:
                from news_data import build_news  # noqa: PLC0415

                major = (qs.get("major") or ["0"])[0] in ("1", "true", "yes")
                payload = build_news(
                    ticker=(qs.get("ticker") or [None])[0],
                    q=(qs.get("q") or [None])[0],
                    major_only=major,
                    limit=_qint(qs, "limit", 60),
                )
                self._send(200, json.dumps(payload).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/alerts":
            try:
                from alerts_data import build_alerts  # noqa: PLC0415

                payload = build_alerts(
                    min_severity=(qs.get("severity") or ["watch"])[0],
                    limit=_qint(qs, "limit", 60),
                )
                self._send(200, json.dumps(payload).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/pulse":
            try:
                from pulse_data import build_pulse  # noqa: PLC0415

                payload = dict(build_pulse())  # copy — don't mutate the cached dict
                payload["market"] = market_status.status_payload()
                self._send(200, json.dumps(payload).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/alerts/history":
            try:
                from alert_store import query as aq, stats as astats  # noqa: PLC0415

                res = aq(
                    kind=(qs.get("kind") or [None])[0] or None,
                    ticker=(qs.get("ticker") or [None])[0] or None,
                    asset_class=(qs.get("class") or [None])[0] or None,
                    q=(qs.get("q") or [None])[0] or None,
                    since=(qs.get("since") or [None])[0] or None,
                    limit=_qint(qs, "limit", 200, 1, 1000),
                )
                res["stats"] = astats()
                self._send(200, json.dumps(res).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/edge":
            try:
                import edge_store  # noqa: PLC0415
                import edge_stats  # noqa: PLC0415
                from edge_resolver import HORIZONS  # noqa: PLC0415

                payload = {
                    "generated_at": _now_iso(),
                    "sample": edge_stats.sample(),
                    "horizons": list(HORIZONS),
                    "stats": edge_store.query_stats(min_n=1)[:400],
                    "status": _edge_status(),
                }
                self._send(200, json.dumps(payload).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/edge/players":
            try:
                from players_data import build_players  # noqa: PLC0415

                self._send(200, json.dumps(build_players()).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/edge/whales":
            try:
                from alert_store import query as aq  # noqa: PLC0415

                res = aq(
                    kind=(qs.get("kind") or [None])[0] or None,
                    limit=_qint(qs, "limit", 50, 1, 500),
                )
                res["rows"] = _augment_whales(res.get("rows") or [])
                res["generated_at"] = _now_iso()
                self._send(200, json.dumps(res).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/status":
            try:
                self._send(200, json.dumps(market_status.status_payload()).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/gex/history":
            ticker = (qs.get("ticker") or [""])[0].strip().upper()
            if not ticker:
                self._send(400, json.dumps({"error": "ticker required"}).encode(), "application/json")
            else:
                try:
                    import gex_history  # noqa: PLC0415

                    payload = gex_history.changes(
                        ticker,
                        metric=(qs.get("metric") or ["gex"])[0],
                        days=_qint(qs, "days", 10, 1, 60),
                    )
                    self._send(200, json.dumps(payload).encode(), "application/json")
                except Exception as exc:  # noqa: BLE001
                    self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/live":
            try:
                from live_alerts import build_live_alerts  # noqa: PLC0415

                payload = build_live_alerts(
                    min_premium=_qint(qs, "min", 250000, 0, 100_000_000),
                    kinds=(qs.get("kinds") or ["flow,unusual,darkpool"])[0],
                )
                self._send(200, json.dumps(payload).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/week":
            try:
                from week_data import build_week  # noqa: PLC0415

                self._send(200, json.dumps(build_week()).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/day":
            try:
                from day_data import build_day  # noqa: PLC0415

                self._send(200, json.dumps(build_day()).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/tape":
            raw = (qs.get("t") or [""])[0]
            tickers = [t.strip().upper() for t in raw.split(",") if t.strip()][:20]
            try:
                from movers_data import build_tape  # noqa: PLC0415

                self._send(200, json.dumps(build_tape(tickers)).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/usage":
            # lightweight quota readout (1 cheap upstream call); drives the header badge on every view
            try:
                from uw_client import UWClient  # noqa: PLC0415

                self._send(200, json.dumps(UWClient().usage()).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(200, json.dumps({"error": str(exc)[:120]}).encode(), "application/json")
        elif path == "/api/refresh":
            with _lock:
                _cache["ts"] = 0.0
            symbol_data._CACHE.clear()
            for _mod, _attr in (("news_data", "_CACHE"), ("alerts_data", "_CACHE"), ("alerts_data", "_NATIVE_CACHE"), ("pulse_data", "_CACHE"), ("live_alerts", "_CACHE")):
                try:
                    _m = __import__(_mod)  # noqa: PLC0415
                    getattr(_m, _attr)["ts"] = 0.0
                except Exception:  # noqa: BLE001
                    pass
            try:
                import gex_history  # noqa: PLC0415

                gex_history.clear_cache()
            except Exception:  # noqa: BLE001
                pass
            self._send(200, b'{"ok":true}', "application/json")
        elif path == "/api/telegram":
            try:
                from notify import telegram_status  # noqa: PLC0415

                self._send(200, json.dumps(telegram_status()).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/stream/alerts":
            self._stream_alerts()
        elif path == "/api/stream/quote":
            self._stream_quote(qs)
        else:
            self._send(404, b"not found", "text/plain")

    def _read_json(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > 65536:
                return None
            return json.loads(self.rfile.read(n).decode("utf-8", "replace"))
        except Exception:  # noqa: BLE001
            return None

    def do_POST(self):  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/telegram":
            body = self._read_json() or {}
            alert = body.get("alert") if isinstance(body, dict) else None
            want_test = bool(body.get("test")) if isinstance(body, dict) else False
            try:
                from notify import send_live_alert, send_test, telegram_status  # noqa: PLC0415

                if want_test:
                    res = send_test()
                elif alert:
                    res = send_live_alert(alert)
                else:
                    res = telegram_status()
                self._send(200, json.dumps(res).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        else:
            self._send(404, b"not found", "text/plain")


def _start_edge_thread(interval: int) -> None:
    """Daemon loop: resolve pending alerts, then refresh stats. Never dies."""

    def loop() -> None:
        time.sleep(10)  # let the server settle before the first (slow) pass
        while True:
            try:
                from edge_resolver import resolve_pending  # noqa: PLC0415
                from edge_stats import refresh  # noqa: PLC0415

                resolve_pending()
                refresh()
            except Exception:  # noqa: BLE001
                pass
            time.sleep(max(30, interval))

    t = threading.Thread(target=loop, name="edge-resolver", daemon=True)
    t.start()


# Daily OI (open interest) build time in ET: 06:45 — options OI settles after the
# prior close, so this is the freshest positioning before the open.
_OI_BUILD_MIN = 6 * 60 + 45


def _start_oi_scheduler() -> None:
    """Daemon loop: run the OI build once per weekday at/after 06:45 ET.

    Reuses the existing threading pattern (no new dependency). On a startup that
    happens after 06:45 ET the first pass fires a few seconds later, catching up
    a missed morning build; before 06:45 it waits for the window. Weekends are
    skipped entirely.
    """

    def loop() -> None:
        time.sleep(10)  # let the server settle before the first pass
        last_day: str | None = None
        while True:
            try:
                now = market_status.now_et()
                mins = now.hour * 60 + now.minute
                today = now.date().isoformat()
                if now.weekday() < 5 and mins >= _OI_BUILD_MIN and last_day != today:
                    from alerts_data import build_alerts  # noqa: PLC0415

                    payload = build_alerts()
                    last_day = today
                    print(
                        f"[oi-scheduler] {today} OI build ran: "
                        f"{payload.get('total')} alert(s), session {payload.get('session')}"
                    )
            except Exception as exc:  # noqa: BLE001 - the loop must never die
                print(f"[oi-scheduler] error: {exc}")
            time.sleep(60)

    t = threading.Thread(target=loop, name="oi-scheduler", daemon=True)
    t.start()


def main() -> None:
    # Line-buffer stdout so boot/thread messages reach the redirect-log at once
    # (a daemonized process writing to a file would otherwise hold them in the
    # block buffer indefinitely).
    try:
        sys.stdout.reconfigure(line_buffering=True)
        sys.stderr.reconfigure(line_buffering=True)
    except Exception:  # noqa: BLE001
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8901)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Unusual Whales dashboard -> http://{args.host}:{args.port}")
    print("Ctrl+C to stop.")
    if not os.environ.get("CI_MODE"):
        try:
            _start_edge_thread(int(os.environ.get("EDGE_INTERVAL", "300")))
            print("Edge resolver thread started (interval %ss)." % os.environ.get("EDGE_INTERVAL", "300"))
        except Exception as exc:  # noqa: BLE001
            print(f"Edge resolver thread not started: {exc}")
        # Always-on live poller: start it at boot so alerts are captured even
        # with zero browser connections (previously HUB only started on the
        # first /api/stream/alerts subscriber).
        try:
            from stream_data import HUB  # noqa: PLC0415

            HUB.start()
            print("Live alert poller started (always-on, no browser required).")
        except Exception as exc:  # noqa: BLE001
            print(f"Live alert poller not started: {exc}")
        # Always-on daily OI scan (weekdays ~06:45 ET, plus a startup catch-up).
        try:
            _start_oi_scheduler()
            print("OI scheduler thread started (weekdays 06:45 ET).")
        except Exception as exc:  # noqa: BLE001
            print(f"OI scheduler thread not started: {exc}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
