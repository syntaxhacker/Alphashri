#!/usr/bin/env python3
"""Local read-only dashboard for the India board (Fyers data).

The credentials never reach the browser: this server fetches Fyers data and
serves JSON + a static page on localhost.

    python scripts/dashboard_server.py --port 8902
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

_SCRIPTS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_SCRIPTS_DIR))
sys.path.insert(0, str(_REPO_ROOT))

import fyers_data  # noqa: E402

import fyers_pacer  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DASHBOARD_DIR = ROOT / "dashboard"
INDEX = DASHBOARD_DIR / "index.html"

_STATIC_FILES = ("/app.js", "/symbol.js", "/info.js", "/charts.js", "/hints.js", "/heat.js", "/universe.js")


def _clear_fyers_caches() -> None:
    for name in ("_CACHE", "_cache", "CACHE", "cache"):
        cache = getattr(fyers_data, name, None)
        if isinstance(cache, dict):
            try:
                cache.clear()
            except Exception:  # noqa: BLE001, S110
                pass


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

    #: Endpoints a person explicitly opens — exempt from the off-hours block so
    #: an operator can still read data after the close (served from cache where
    #: possible). Unsupervised background polling has no such exemption.
    _USER_ENDPOINT_PREFIXES = (
        "/api/snapshot",
        "/api/symbol/",
        "/api/futures/",
        "/api/greeks/",
        "/api/rollover/",
        "/api/basis/",
        "/api/universe",
        "/api/breadth",
        "/api/oi-flow",
        "/api/oi-history",
    )

    def _is_user_endpoint(self, path: str) -> bool:
        """True for the user-initiated Fyers-touching endpoints."""
        if path == "/api/refresh":
            return True
        return any(
            path == p or path.startswith(p) for p in self._USER_ENDPOINT_PREFIXES
        )

    def do_GET(self):  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)
        if self._is_user_endpoint(path):
            # A person opening the board after hours is exempt from the
            # off-hours circuit breaker; a tab left open overnight is not.
            with fyers_pacer.allow_offhours(f"GET {path}"):
                self._route_get(path, qs)
        else:
            self._route_get(path, qs)

    def _route_get(self, path: str, qs: dict):
        if path in ("/", "/index.html"):
            self._send(200, INDEX.read_bytes(), "text/html; charset=utf-8")
        elif path.startswith(("/panels/", "/vendor/")) or path in _STATIC_FILES:
            f = (DASHBOARD_DIR / path.lstrip("/")).resolve()
            if str(f).startswith(str(DASHBOARD_DIR)) and f.is_file():
                ctype = "application/javascript" if f.suffix == ".js" else "text/plain"
                self._send(200, f.read_bytes(), ctype + "; charset=utf-8")
            else:
                self._send(404, b"not found", "text/plain")
        elif path == "/api/snapshot":
            try:
                self._send(200, json.dumps(fyers_data.build_snapshot()).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/symbols":
            q = (qs.get("q") or [""])[0]
            try:
                self._send(200, json.dumps({"symbols": fyers_data.search_symbols(q)}).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path.startswith("/api/symbol/"):
            ticker = unquote(path.rsplit("/", 1)[-1]).strip().upper()
            try:
                # Any ticker shape is allowed through — Fyers itself validates
                # (unknown symbols fail in build_symbol with a clear error).
                import re  # noqa: PLC0415

                if not re.fullmatch(r"[A-Z0-9][A-Z0-9.\-]{0,24}", ticker):
                    self._send(404, json.dumps({"error": f"bad ticker: {ticker}"}).encode(), "application/json")
                else:
                    self._send(200, json.dumps(fyers_data.build_symbol(ticker)).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path.startswith("/api/futures/"):
            ticker = unquote(path.rsplit("/", 1)[-1]).strip().upper()
            try:
                import re  # noqa: PLC0415

                if not re.fullmatch(r"[A-Z0-9][A-Z0-9.\-]{0,24}", ticker):
                    self._send(404, json.dumps({"error": f"bad ticker: {ticker}"}).encode(), "application/json")
                else:
                    self._send(200, json.dumps(fyers_data.build_futures(ticker)).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/universe":
            try:
                from scan_data import build_scan  # noqa: PLC0415

                self._send(200, json.dumps(build_scan()).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/oi-flow":
            ticker = ((qs.get("ticker") or [""])[0] or "").strip().upper()
            try:
                import oi_tracker  # noqa: PLC0415

                snap = oi_tracker.latest(ticker or None)
                if snap is None and ticker:
                    # On-demand fetch so the panel shows something even
                    # before the background poller has swept this ticker.
                    snap = oi_tracker.take_snapshot(ticker)
                body = snap if snap is not None else {"ticker": ticker or None, "unavailable": True}
                self._send(200, json.dumps(body).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/oi-flow/history":
            ticker = ((qs.get("ticker") or [""])[0] or "").strip().upper()
            try:
                import oi_tracker  # noqa: PLC0415

                snaps = oi_tracker.history(ticker or None)
                if not snaps and ticker:
                    snap = oi_tracker.take_snapshot(ticker)
                    snaps = [snap] if snap is not None else []
                self._send(
                    200,
                    json.dumps({"ticker": ticker or None, "count": len(snaps), "snapshots": snaps}).encode(),
                    "application/json",
                )
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/oi-history/refresh":
            # Manual trigger: ?ticker={T} snapshots one ticker now,
            # otherwise the whole universe in a background thread.
            ticker = ((qs.get("ticker") or [""])[0] or "").strip().upper()
            try:
                import oi_history  # noqa: PLC0415

                if ticker:
                    rec = oi_history.snapshot_ticker(ticker)
                    self._send(
                        200,
                        json.dumps({"ok": True, "saved": rec["ticker"],
                                    "date": rec["date"],
                                    "strikes": len(rec["strikes"])}).encode(),
                        "application/json",
                    )
                else:
                    import threading  # noqa: PLC0415

                    threading.Thread(target=oi_history.snapshot_all,
                                     name="oi-history-manual", daemon=True).start()
                    self._send(200, b'{"ok":true,"background":true}', "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path.startswith("/api/oi-history/"):
            ticker = unquote(path.rsplit("/", 1)[-1]).strip().upper()
            try:
                import re  # noqa: PLC0415

                import oi_history  # noqa: PLC0415

                if not re.fullmatch(r"[A-Z0-9][A-Z0-9.\-]{0,24}", ticker):
                    self._send(404, json.dumps({"error": f"bad ticker: {ticker}"}).encode(), "application/json")
                else:
                    self._send(200, json.dumps(oi_history.load_history(ticker)).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path.startswith("/api/greeks/"):
            ticker = unquote(path.rsplit("/", 1)[-1]).strip().upper()
            try:
                import re  # noqa: PLC0415

                import greeks_data  # noqa: PLC0415

                if not re.fullmatch(r"[A-Z0-9][A-Z0-9.\-]{0,24}", ticker):
                    self._send(404, json.dumps({"error": f"bad ticker: {ticker}"}).encode(), "application/json")
                else:
                    # ?expiry=<epoch> selects a non-nearest expiry (Fyers timestamp).
                    expiry = (qs.get("expiry") or [""])[0] or None
                    chain = fyers_data.get_chain(ticker, expiry_epoch=expiry, greeks=True)
                    self._send(200, json.dumps(greeks_data.summarize(ticker, chain)).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path.startswith("/api/rollover/"):
            ticker = unquote(path.rsplit("/", 1)[-1]).strip().upper()
            try:
                import re  # noqa: PLC0415

                import rollover_data  # noqa: PLC0415

                if not re.fullmatch(r"[A-Z0-9][A-Z0-9.\-]{0,24}", ticker):
                    self._send(404, json.dumps({"error": f"bad ticker: {ticker}"}).encode(), "application/json")
                else:
                    # Either sub-payload may be {"unavailable": true}; that is
                    # still a 200 — the caller distinguishes missing data.
                    body = {
                        "ticker": ticker,
                        "rollover": rollover_data.rollover_series(ticker),
                        "basis": rollover_data.basis_snapshot(ticker),
                    }
                    self._send(200, json.dumps(body).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path.startswith("/api/basis/"):
            ticker = unquote(path.rsplit("/", 1)[-1]).strip().upper()
            try:
                import re  # noqa: PLC0415

                import rollover_data  # noqa: PLC0415

                if not re.fullmatch(r"[A-Z0-9][A-Z0-9.\-]{0,24}", ticker):
                    self._send(404, json.dumps({"error": f"bad ticker: {ticker}"}).encode(), "application/json")
                else:
                    self._send(200, json.dumps(rollover_data.basis_snapshot(ticker)).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/breadth":
            # Read-only: never trigger a 210-underlying scan from the home
            # card. Serve the breadth from the last scan; fall back to a live
            # quote sweep over its rows, throttled to one sweep per
            # BREADTH_TTL (and skipped entirely off-hours without exemption).
            try:
                import scan_data  # noqa: PLC0415

                payload = scan_data.cached_scan(trigger=False) or {}
                sections = payload.get("sections") if isinstance(payload, dict) else None
                sections = sections if isinstance(sections, dict) else {}
                breadth = sections.get("breadth")
                if not (isinstance(breadth, dict) and not breadth.get("unavailable")):
                    tickers = [
                        r.get("ticker")
                        for r in (sections.get("rows") or [])
                        if isinstance(r, dict) and r.get("ticker")
                    ]
                    breadth = scan_data.cached_breadth(tickers) if tickers else {"unavailable": True}
                self._send(200, json.dumps(breadth).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/signals":
            date_s = ((qs.get("date") or [""])[0] or "").strip()
            try:
                import signal_log  # noqa: PLC0415

                day_obj = signal_log._date_obj(date_s) if date_s else None
                if date_s and day_obj is None:
                    self._send(400, json.dumps({"error": f"bad date: {date_s}"}).encode(), "application/json")
                else:
                    day = (day_obj or datetime.now(fyers_data.IST).date()).isoformat()
                    signals = signal_log.read_signals(day)
                    self._send(
                        200,
                        json.dumps({"date": day, "count": len(signals), "signals": signals}).encode(),
                        "application/json",
                    )
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/eval":
            # NOTE: evaluation fetches forward candles per ticker per day, so a
            # multi-day request can take a while — the date list is capped at 5
            # to bound the work.
            dates_param = ((qs.get("dates") or [""])[0] or "").strip()
            if not dates_param:
                dates_param = ((qs.get("date") or [""])[0] or "").strip()
            dates = [d.strip() for d in dates_param.split(",") if d.strip()]
            if not dates:
                dates = [datetime.now(fyers_data.IST).date().isoformat()]
            if len(dates) > 5:
                self._send(400, json.dumps({"error": "too many dates"}).encode(), "application/json")
            else:
                try:
                    import eval_harness  # noqa: PLC0415

                    self._send(200, json.dumps(eval_harness.evaluate_from_disk(dates)).encode(), "application/json")
                except Exception as exc:  # noqa: BLE001
                    self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/refresh":
            _clear_fyers_caches()
            self._send(200, b'{"ok":true}', "application/json")
        elif path == "/api/hotlist":
            # Tiered-freshness list: names the scan/signals say matter now, each
            # refreshed on a much shorter interval than the 210-name sweep.
            try:
                import hotlist_data  # noqa: PLC0415

                limit = int((qs.get("limit") or ["0"])[0] or 0) or None
                hot = hotlist_data.build_hotlist(limit=limit)
                hot["latest"] = hotlist_data.latest()
                self._send(200, json.dumps(hot).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/bulk-deals":
            # NSE end-of-day bulk/block deals with heuristic client
            # classification (mutual fund / insurer / PMS / AIF / FPI).
            # `?date=` selects a captured day; default = latest captured.
            date_s = ((qs.get("date") or [""])[0] or "").strip()
            try:
                import bulk_deals  # noqa: PLC0415

                day = date_s or bulk_deals.latest_date()
                if not day:
                    self._send(404, json.dumps({"unavailable": True, "reason": "nothing captured yet"}).encode(),
                               "application/json")
                else:
                    self._send(200, json.dumps(bulk_deals.day_payload(day)).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        elif path == "/api/emitters/run":
            # Manual, one-shot evaluation of the intraday detectors over the
            # PERSISTED snapshots (no polling). Useful to verify the pipeline
            # outside market hours; `enrich=0` (default) keeps it API-free.
            tickers = [t.strip().upper() for t in ((qs.get("tickers") or [""])[0] or "").split(",") if t.strip()]
            enrich = ((qs.get("enrich") or ["0"])[0] or "0").strip().lower() in ("1", "true", "yes")
            try:
                import signal_emitters  # noqa: PLC0415

                counts = signal_emitters.run_once(tickers or None, enrich=enrich)
                self._send(200, json.dumps({"ok": True, "counts": counts}).encode(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
        else:
            self._send(404, b"not found", "text/plain")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8902)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()
    import oi_tracker  # noqa: E402

    oi_tracker.ensure_started()
    import oi_history  # noqa: E402

    oi_history.start_eod_poller()
    import scan_data  # noqa: E402

    scan_data.ensure_started()
    import rollover_data  # noqa: E402

    rollover_data.ensure_started()
    import hotlist_data  # noqa: E402

    hotlist_data.ensure_started()
    import signal_emitters  # noqa: E402

    signal_emitters.ensure_started()
    import signal_emitters_swing  # noqa: E402

    signal_emitters_swing.ensure_started()
    import bulk_deals  # noqa: E402

    bulk_deals.ensure_started()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"India board -> http://{args.host}:{args.port}")
    print("Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
