"""Request-duration middleware for finding slow API endpoints.

Uvicorn's default access log records only method/path/status, so a 4-second
request is indistinguishable from a 4-millisecond one. This middleware logs
time-to-first-byte (TTFB) and total duration for requests that cross a
threshold, and appends the same record to a JSONL file for offline analysis.

Pure ASGI on purpose: ``BaseHTTPMiddleware`` buffers bodies and breaks SSE
streams. Here a streaming response is judged by TTFB only; its lifetime is
recorded but not treated as "slow".

Env:
  SLOW_API_MS=500          log requests whose TTFB or total exceeds this
  SLOW_API_LOG_ALL=1       log every request (for true percentiles)
  SLOW_API_JSONL=logs/slow_api.jsonl  append records here (empty disables)
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, MutableMapping, Optional

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

_log = logging.getLogger("uvicorn.error")
_jsonl_lock = threading.Lock()


def _flag(name: str) -> bool:
    return os.getenv(name, "").lower() in ("1", "true", "yes", "on")


class SlowAPIMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        threshold_ms: Optional[float] = None,
        jsonl_path: Optional[str] = None,
    ) -> None:
        self.app = app
        raw_threshold = threshold_ms if threshold_ms is not None else os.getenv("SLOW_API_MS", "500")
        try:
            self.threshold_ms = max(0.0, float(raw_threshold))
        except (TypeError, ValueError):
            self.threshold_ms = 500.0
        self.log_all = _flag("SLOW_API_LOG_ALL")
        configured = jsonl_path if jsonl_path is not None else os.getenv(
            "SLOW_API_JSONL", "logs/slow_api.jsonl"
        )
        self.jsonl_path: Optional[Path] = Path(configured) if configured else None
        if self.jsonl_path is not None:
            try:
                self.jsonl_path.parent.mkdir(parents=True, exist_ok=True)
            except OSError:
                self.jsonl_path = None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        started = time.perf_counter()
        status = 500
        ttfb: Optional[float] = None
        content_type = ""
        finalized = False

        async def timed_send(message: Message) -> None:
            nonlocal status, ttfb, content_type, finalized
            if message.get("type") == "http.response.start":
                ttfb = time.perf_counter() - started
                status = int(message.get("status", 500))
                for name, value in message.get("headers", []):
                    if name.lower() == b"content-type":
                        content_type = value.decode("latin-1", "replace")
                        break
            elif message.get("type") == "http.response.body" and not message.get("more_body", False):
                finalized = True
                self._emit(scope, status, ttfb, time.perf_counter() - started, content_type)
            await send(message)

        try:
            await self.app(scope, receive, timed_send)
        except Exception:
            if not finalized:
                total = time.perf_counter() - started
                self._emit(scope, status, ttfb or total, total, content_type, error=True)
            raise
        else:
            if not finalized and ttfb is not None:
                # The app returned without a final body message (rare, but a
                # disconnect can do it). TTFB is still useful.
                self._emit(scope, status, ttfb, time.perf_counter() - started, content_type)

    def _emit(
        self,
        scope: Scope,
        status: int,
        ttfb: float,
        total: float,
        content_type: str,
        error: bool = False,
    ) -> None:
        stream = content_type.lower().startswith("text/event-stream")
        threshold = self.threshold_ms / 1000.0
        slow = ttfb >= threshold or (not stream and total >= threshold)
        if not slow and not self.log_all and not error:
            return

        path = str(scope.get("path", ""))
        route = scope.get("route")
        route_path = getattr(route, "path", None) or path
        query = scope.get("query_string", b"").decode("latin-1", "replace")[:300]
        client = scope.get("client") or ("", 0)
        record = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "method": str(scope.get("method", "")),
            "path": path,
            "route": str(route_path),
            "query": query,
            "status": int(status),
            "ttfb_ms": round(ttfb * 1000.0, 1),
            "total_ms": round(total * 1000.0, 1),
            "stream": stream,
            "client": str(client[0]),
        }
        if error:
            record["error"] = "exception"

        line = "SLOW_API " + json.dumps(record, separators=(",", ":"))
        if slow or error:
            _log.warning(line)
        else:
            _log.info(line)

        if self.jsonl_path is None:
            return
        try:
            with _jsonl_lock:
                with self.jsonl_path.open("a", encoding="utf-8") as fh:
                    fh.write(json.dumps(record, separators=(",", ":")) + "\n")
        except OSError:
            # A missing/unwritable log directory must never break a request.
            pass
