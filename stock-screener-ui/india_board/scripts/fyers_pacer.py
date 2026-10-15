#!/usr/bin/env python3
"""Process-wide Fyers REST pacer (roadmap wave W1a).

Fyers v3 rate limits are **global per API key** (shared by every REST
endpoint, every thread, every caller in this process)::

    per second   10   -> we target  8
    per minute  200   -> we target 180
    per day  100,000  -> hard-stop at FYERS_DAILY_CAP (default 90,000)

Breaching the per-minute cap **more than 3 times in a day blocks the key for
the rest of the day**, so the guard is a precondition, not a nice-to-have.

This module owns one module-level token bucket used by every Fyers call path.
Callers create clients per request, so pacer state is deliberately module-level
(never per-object).

Public surface
--------------
``acquire(n=1)``
    Block until ``n`` slots are reserved under *both* the per-second and
    per-minute windows, then consume the daily budget. Raises
    :class:`FyersDailyCapExceeded` once the day's budget is gone.
``paced_request(method, url, *, headers, params, json, timeout, max_retries)``
    ``requests`` call wrapped in :func:`acquire`, with 429 / 5xx / network
    retries and ``Retry-After`` / ``X-Retry-After-Ms`` handling. Returns a
    :class:`PacedResponse` (whose ``.json()`` tolerates Fyers' concatenated
    ``429``+``200`` payload quirk). Raises :class:`FyersAuthError` on 401
    (never retried — a dead token must be re-resolved by the caller).
``parse_json_multi(text)``
    Extract the **last** complete JSON value from a payload (used to survive
    the concatenated-429 quirk). :func:`leading_is_429` reports whether the
    first value is a rate-limit error.
``requests_today()``
    Daily request counter (IST day).
``PacedSession``
    Minimal ``requests.Session``-shaped adapter so the Fyers SDK
    (``m.optionchain(...)`` etc.) is paced without the SDK knowing.

Env overrides: ``FYERS_MAX_PER_SEC`` (8), ``FYERS_MAX_PER_MIN`` (180),
``FYERS_DAILY_CAP`` (90000).

This module never logs or stores credentials — it only paces and retries.
"""
from __future__ import annotations

import json as _json
import os
import random
import threading
import time
from contextlib import contextmanager
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

IST = ZoneInfo("Asia/Kolkata")


def _env_int(name: str, default: int) -> int:
    """Positive int from ``name``; malformed/absent/non-positive -> default."""
    try:
        val = int(str(os.environ.get(name, "")).strip())
        return val if val > 0 else default
    except (TypeError, ValueError):
        return default


#: Guard targets (headroom under the real 10/s, 200/min, 100k/day limits).
_PER_SEC_MAX = _env_int("FYERS_MAX_PER_SEC", 8)
_PER_MIN_MAX = _env_int("FYERS_MAX_PER_MIN", 180)
_DAILY_CAP = _env_int("FYERS_DAILY_CAP", 90000)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------
class FyersPacerError(RuntimeError):
    """Base class for pacer-raised errors."""


class FyersDailyCapExceeded(FyersPacerError):
    """The configured daily request budget has been exhausted."""


class FyersRateLimitError(FyersPacerError):
    """429 persisted past ``max_retries``."""


class FyersRateLimited(FyersRateLimitError):
    """Hard rate-limit / WAF ban (e.g. Cloudflare 1015 on ``api-t1.fyers.in``).

    Cloudflare answers with HTTP 429 and a large ``Retry-After`` (often tens of
    minutes). Sleeping through that would look like a hung request and retrying
    only deepens the ban, so the pacer **latches** the window and fails fast
    until it expires.
    """

    def __init__(self, message: str, *, retry_after: float = 0.0, response=None):
        # RuntimeError.__init__ takes no ``response`` kwarg (only FyersAuthError
        # defines one), so keep the response here instead of forwarding it.
        super().__init__(message)
        self.retry_after = float(retry_after or 0.0)
        self.response = response


#: Epoch (``time.time``) until which every call is refused after a 1015-style ban.
_RATE_LIMIT_UNTIL: float = 0.0
#: A ``Retry-After`` longer than this is treated as a ban, not a transient burst.
_RATE_LIMIT_LATCH_SEC = 60.0


def note_rate_limit(seconds: float) -> None:
    """Latch a hard rate-limit window (seconds from now); never shortens it."""
    global _RATE_LIMIT_UNTIL
    try:
        wait = max(0.0, float(seconds or 0.0))
    except (TypeError, ValueError):
        wait = 0.0
    until = time.time() + wait
    if until > _RATE_LIMIT_UNTIL:
        _RATE_LIMIT_UNTIL = until


def rate_limit_remaining() -> float:
    """Seconds left on the latched ban (0 when not limited)."""
    return max(0.0, _RATE_LIMIT_UNTIL - time.time())


def rate_limited() -> bool:
    """True while a hard rate-limit/WAF ban is latched."""
    return rate_limit_remaining() > 0.0


def rate_limited_until() -> float:
    """Epoch seconds when the latched ban expires (0 when not limited)."""
    return _RATE_LIMIT_UNTIL


class FyersAuthError(requests.HTTPError):
    """The token is dead (401 / token-expired error). Never retried."""


class FyersOffHoursBlocked(FyersPacerError):
    """A Fyers call was attempted outside market hours.

    Raised by :func:`acquire` / :func:`paced_request` *before* any network
    I/O. Deliberate off-hours work (EOD archival, an operator opening the
    board) must enter a :func:`allow_offhours` block first.
    """


# ---------------------------------------------------------------------------
# Module-level state (one process-wide pacer)
# ---------------------------------------------------------------------------
_LOCK = threading.Lock()

_sec_tokens: float = float(_PER_SEC_MAX)
_min_tokens: float = float(_PER_MIN_MAX)
_last_sec: float | None = None
_last_min: float | None = None
_day: str | None = None
_day_count: int = 0

#: Off-hours circuit-breaker state. ``_blocked_calls`` counts the calls refused
#: while the market is closed; ``_OFFHOURS_ENFORCED`` mirrors the feature flag
#: at import and is re-derived by :func:`reset_state` (see that docstring).
_blocked_calls: int = 0
_OFFHOURS_ENFORCED: bool = True
#: Thread-local exemption depth for :func:`allow_offhours`.
_EXEMPT = threading.local()

#: Token-bucket availability tolerance. Float refill can land a hair below the
#: integer target (e.g. 0.9999999999999998); without this, a sub-ULP deficit
#: spins forever on a virtual clock.
_EPS = 1e-9


def _today_ist() -> str:
    """Current IST calendar date (``YYYY-MM-DD``)."""
    return datetime.now(IST).date().isoformat()


def _roll_day_locked() -> None:
    """Reset the daily counter when the IST calendar day changes."""
    global _day, _day_count
    today = _today_ist()
    if _day != today:
        _day = today
        _day_count = 0


def reset_state() -> None:
    """Reset all limits/state. Used by tests (and safe to call anytime).

    Also clears the off-hours ``blocked_calls()`` counter. Because the offline
    unit suite calls this in an autouse fixture and never sets
    ``FYERS_OFFHOURS_BLOCK``, it re-disarms the off-hours gate unless the env
    var is **explicitly** enabled — keeping the existing pacer tests
    time-independent while production (where ``reset_state`` is never called)
    stays armed by default.
    """
    global _sec_tokens, _min_tokens, _last_sec, _last_min, _day, _day_count
    global _blocked_calls, _OFFHOURS_ENFORCED, _RATE_LIMIT_UNTIL
    with _LOCK:
        _RATE_LIMIT_UNTIL = 0.0
        _sec_tokens = float(_PER_SEC_MAX)
        _min_tokens = float(_PER_MIN_MAX)
        _last_sec = None
        _last_min = None
        _day = _today_ist()
        _day_count = 0
        _blocked_calls = 0
        _OFFHOURS_ENFORCED = _explicit_env_flag("FYERS_OFFHOURS_BLOCK") is True
    _EXEMPT.depth = 0


def requests_today() -> int:
    """Requests consumed so far today (IST), including retries."""
    with _LOCK:
        _roll_day_locked()
        return _day_count


# ---------------------------------------------------------------------------
# Off-hours circuit breaker (Mon-Fri 09:15-15:30 IST)
# ---------------------------------------------------------------------------
def _env_flag(name: str, default: bool) -> bool:
    """Boolean env flag: unset/blank -> ``default``; 0/false/no/off -> False."""
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    return str(raw).strip().lower() not in ("0", "false", "no", "off")


def _explicit_env_flag(name: str):
    """``True``/``False`` when ``name`` is set explicitly, else ``None``."""
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == "":
        return None
    return str(raw).strip().lower() not in ("0", "false", "no", "off")


def is_market_open(now: datetime | None = None) -> bool:
    """True during Mon-Fri 09:15-15:30 IST (weekday session bounds)."""
    cur = now or datetime.now(IST)
    if cur.tzinfo is None:
        cur = cur.replace(tzinfo=IST)
    else:
        cur = cur.astimezone(IST)
    if cur.weekday() >= 5:  # Sat / Sun
        return False
    mins = cur.hour * 60 + cur.minute
    return 9 * 60 + 15 <= mins <= 15 * 60 + 30


def _offhours_enabled() -> bool:
    """Feature switch, read live so tests can toggle it per case."""
    return _env_flag("FYERS_OFFHOURS_BLOCK", True)


def offhours_blocked(now: datetime | None = None) -> bool:
    """True when outside Mon-Fri 09:15-15:30 IST and the feature is enabled.

    Purely a market/flag predicate — it does **not** consider the calling
    thread's :func:`allow_offhours` exemption (use the module-private
    enforcement helper for that).
    """
    return _offhours_enabled() and not is_market_open(now)


def is_offhours_exempt() -> bool:
    """True while the current thread is inside an :func:`allow_offhours` block."""
    return int(getattr(_EXEMPT, "depth", 0)) > 0


def blocked_calls() -> int:
    """Calls refused by the off-hours circuit breaker since the last reset."""
    with _LOCK:
        return _blocked_calls


@contextmanager
def allow_offhours(reason: str = ""):
    """Exempt the enclosed calls from the off-hours circuit breaker.

    Thread-local and re-entrant (nesting is fine); the exemption never leaks
    to another thread, so a background loop cannot ride on a request thread's
    exemption. Usage::

        with fyers_pacer.allow_offhours("eod-capture"):
            ...
    """
    depth = int(getattr(_EXEMPT, "depth", 0)) + 1
    _EXEMPT.depth = depth
    try:
        yield
    finally:
        _EXEMPT.depth = max(0, int(getattr(_EXEMPT, "depth", 0)) - 1)


def enforce_offhours() -> None:
    """Public form of the off-hours refusal, for call paths outside the pacer.

    Same semantics as the internal check used by :func:`acquire`: honours
    ``FYERS_OFFHOURS_BLOCK`` arming and the calling thread's exemption.
    """
    _enforce_offhours()


def _enforce_offhours() -> None:
    """Raise :class:`FyersOffHoursBlocked` off-hours unless exempt.

    Called at the very top of :func:`acquire` so ``paced_request`` (and every
    SDK call routed through :class:`PacedSession`) fails before any socket is
    opened. Increments :func:`blocked_calls` on each refusal.
    """
    global _blocked_calls
    if not _OFFHOURS_ENFORCED:
        return
    if offhours_blocked() and not is_offhours_exempt():
        with _LOCK:
            _blocked_calls += 1
        raise FyersOffHoursBlocked(
            "Fyers API blocked outside market hours "
            "(Mon-Fri 09:15-15:30 IST); set FYERS_OFFHOURS_BLOCK=0 or use "
            "allow_offhours() for deliberate off-hours work"
        )


def acquire(n: int = 1) -> None:
    """Reserve ``n`` slots under the per-second and per-minute windows.

    Blocks (``time.sleep``) until both buckets can cover ``n`` tokens, then
    decrements both and adds to the daily counter. Raises
    :class:`FyersDailyCapExceeded` when the day's budget would be exceeded.
    """
    if n <= 0:
        return
    _enforce_offhours()
    if rate_limited():
        remaining = rate_limit_remaining()
        raise FyersRateLimited(
            f"Fyers API banned for another {int(remaining)}s "
            "(Cloudflare 1015 rate limit) — backing off",
            retry_after=remaining,
        )
    global _sec_tokens, _min_tokens, _last_sec, _last_min, _day_count
    with _LOCK:
        while True:
            now = time.monotonic()
            _roll_day_locked()
            if _day_count + n > _DAILY_CAP:
                raise FyersDailyCapExceeded(
                    f"Fyers daily request cap reached ({_day_count}/{_DAILY_CAP})"
                )

            if _last_sec is None:
                _last_sec = now
            if _last_min is None:
                _last_min = now

            # Refill (token bucket). Rates derived live so tests can retune the
            # limits with a simple monkeypatch.
            sec_rate = float(_PER_SEC_MAX)
            min_rate = float(_PER_MIN_MAX) / 60.0
            _sec_tokens = min(sec_rate, _sec_tokens + max(0.0, now - _last_sec) * sec_rate)
            _last_sec = now
            _min_tokens = min(
                float(_PER_MIN_MAX), _min_tokens + max(0.0, now - _last_min) * min_rate
            )
            _last_min = now

            if _sec_tokens >= n - _EPS and _min_tokens >= n - _EPS:
                _sec_tokens = max(0.0, _sec_tokens - n)
                _min_tokens = max(0.0, _min_tokens - n)
                _day_count += n
                return

            wait = 0.0
            if _sec_tokens < n - _EPS:
                wait = max(wait, (n - _sec_tokens) / sec_rate)
            if _min_tokens < n - _EPS:
                wait = max(wait, (n - _min_tokens) / min_rate)
            if wait <= 0:
                wait = 0.001
            # Held under the lock: this is a single global pacer, and sleeping
            # here is what serialises every caller behind the same budget.
            time.sleep(wait)


# ---------------------------------------------------------------------------
# Response parsing (Fyers concatenated 429+200 quirk)
# ---------------------------------------------------------------------------
_DECODER = _json.JSONDecoder()


def _iter_json_values(text: str) -> list:
    """Every complete JSON value found left-to-right in ``text``."""
    out: list = []
    if not text:
        return out
    i = 0
    end = len(text)
    while i < end:
        if text[i] in "{[":
            try:
                obj, consumed = _DECODER.raw_decode(text, i)
            except ValueError:
                i += 1
                continue
            out.append(obj)
            i = consumed
        else:
            i += 1
    return out


def parse_json_multi(text: str):
    """Last complete JSON value in ``text``.

    Handles the known Fyers quirk where a 429 JSON object is concatenated with
    a 200 JSON body in one payload: the trailing (good) object is returned.
    Raises ``ValueError`` when no JSON value can be found.
    """
    if text is None:
        raise ValueError("empty response body")
    stripped = text.strip()
    if not stripped:
        raise ValueError("empty response body")
    try:
        return _json.loads(stripped)
    except ValueError:
        pass
    values = _iter_json_values(stripped)
    if not values:
        raise ValueError("no JSON value in response")
    return values[-1]


def _is_429_obj(obj) -> bool:
    """True when ``obj`` looks like a Fyers rate-limit error object."""
    if not isinstance(obj, dict):
        return False
    if obj.get("code") in (429, -429):
        return True
    msg = str(obj.get("message") or "").lower()
    return "429" in msg or "too many request" in msg or "rate limit" in msg


def _is_auth_obj(obj) -> bool:
    """True when ``obj`` looks like a dead-token error object."""
    if not isinstance(obj, dict):
        return False
    if obj.get("code") in (401, -401):
        return True
    msg = str(obj.get("message") or "").lower()
    return "token" in msg and any(w in msg for w in ("expir", "invalid", "not valid"))


def leading_is_429(text: str) -> bool:
    """True when the FIRST JSON value in ``text`` is a rate-limit error.

    Used to detect the concatenated payload even when the HTTP status says 200.
    """
    values = _iter_json_values(text or "")
    return bool(values) and _is_429_obj(values[0])


# ---------------------------------------------------------------------------
# Paced response wrapper
# ---------------------------------------------------------------------------
class PacedResponse:
    """``requests.Response``-shaped wrapper whose ``.json()`` is quirk-safe."""

    __slots__ = ("_resp", "_json_cache", "_error")

    def __init__(self, resp, parsed=None, error: str | None = None):
        self._resp = resp
        self._json_cache = parsed
        self._error = error

    @property
    def status_code(self) -> int:
        return int(self._resp.status_code)

    @property
    def headers(self):
        return self._resp.headers

    @property
    def text(self) -> str:
        try:
            return self._resp.text or ""
        except Exception:  # noqa: BLE001 - synthetic/partial responses
            return ""

    @property
    def content(self) -> bytes:
        return self._resp.content

    @property
    def ok(self) -> bool:
        return self._resp.status_code < 400 and not self._error

    @property
    def error(self) -> str | None:
        return self._error

    def json(self):
        if self._json_cache is None:
            self._json_cache = parse_json_multi(self.text)
        return self._json_cache

    def raise_for_status(self) -> None:
        if self._error:
            raise requests.HTTPError(
                f"{self._error} in Fyers response", response=self._resp
            )
        self._resp.raise_for_status()

    def __getattr__(self, name):
        return getattr(self._resp, name)


# ---------------------------------------------------------------------------
# Request pacing + retries
# ---------------------------------------------------------------------------
def _header_get(headers, name: str):
    """Case-insensitive header lookup over a plain or CIDict mapping."""
    if not headers:
        return None
    try:
        for key, value in headers.items():
            if str(key).lower() == name.lower():
                return value
    except AttributeError:
        return None
    return None


def _retry_after_seconds(resp) -> float | None:
    """``Retry-After`` (s) or ``X-Retry-After-Ms`` (ms) as seconds, else None."""
    headers = getattr(resp, "headers", None)
    retry_after = _header_get(headers, "Retry-After")
    if retry_after is not None:
        try:
            return max(0.0, float(retry_after))
        except (TypeError, ValueError):
            pass
    retry_ms = _header_get(headers, "X-Retry-After-Ms")
    if retry_ms is not None:
        try:
            return max(0.0, float(retry_ms) / 1000.0)
        except (TypeError, ValueError):
            pass
    return None


def _backoff(attempt: int) -> float:
    """Exponential backoff (1s, 2s, 4s, ...) plus a little jitter."""
    return float(2 ** max(0, int(attempt))) + random.random() * 0.5


def paced_request(
    method: str,
    url: str,
    *,
    headers=None,
    params=None,
    json=None,
    timeout: int = 30,
    max_retries: int = 3,
):
    """A ``requests`` call that first reserves a slot via :func:`acquire`.

    Retries on 429 (honouring ``Retry-After`` / ``X-Retry-After-Ms``, else
    exponential backoff + jitter), on 5xx, and on transient network errors.
    A 401 (or a Fyers token-expired object) raises :class:`FyersAuthError`
    immediately — a dead token must never be retried in a loop. Raises
    :class:`FyersRateLimitError` when 429s persist past ``max_retries``.

    Returns a :class:`PacedResponse` on success.
    """
    method = (method or "GET").upper()
    attempt = 0  # retries consumed so far
    while True:
        acquire()
        try:
            raw = requests.request(
                method,
                url,
                headers=headers,
                params=params,
                json=json,
                timeout=timeout,
            )
        except requests.RequestException:
            if attempt >= max_retries:
                raise
            time.sleep(_backoff(attempt))
            attempt += 1
            continue

        status = int(raw.status_code)
        text = getattr(raw, "text", "") or ""
        parsed = None
        try:
            parsed = parse_json_multi(text)
        except ValueError:
            parsed = None

        if status == 401 or _is_auth_obj(parsed):
            raise FyersAuthError(
                f"Fyers auth failed (HTTP {status})", response=raw
            )

        leading_429 = leading_is_429(text)
        if status == 429 or leading_429 or _is_429_obj(parsed):
            if attempt >= max_retries:
                raise FyersRateLimitError(
                    f"Fyers rate limit persisted after {attempt} retries"
                )
            wait = _retry_after_seconds(raw)
            if wait is not None and wait >= _RATE_LIMIT_LATCH_SEC:
                # Ban window (Cloudflare 1015): latch it and fail fast rather
                # than sleeping for minutes and retrying into the ban.
                note_rate_limit(wait)
                raise FyersRateLimited(
                    f"Fyers rate limited for {int(wait)}s (HTTP 429)",
                    retry_after=wait,
                    response=raw,
                )
            if wait is None:
                wait = _backoff(attempt)
            time.sleep(wait)
            attempt += 1
            continue

        if 500 <= status < 600:
            if attempt >= max_retries:
                raw.raise_for_status()
            time.sleep(_backoff(attempt))
            attempt += 1
            continue

        return PacedResponse(raw, parsed=parsed)


# ---------------------------------------------------------------------------
# requests.Session-shaped adapter (paced SDK calls)
# ---------------------------------------------------------------------------
class _SyntheticResponse:
    """Minimal response for a 401 caught in :class:`PacedSession`."""

    def __init__(self, status_code: int, body: dict, message: str):
        self.status_code = status_code
        self._body = body
        self._message = message
        self.headers: dict = {}
        self.text = _json.dumps(body)
        self.content = self.text.encode()

    def json(self):
        return self._body

    def raise_for_status(self):
        raise requests.HTTPError(self._message, response=self)


class PacedSession:
    """``requests.Session``-shaped adapter that routes through ``paced_request``.

    The Fyers SDK only uses ``.get`` / ``.post`` internally
    (``self.session.get(url=..., headers=...)``); swapping
    ``client.service.session`` for this adapter paces every SDK call. A 401 is
    surfaced as a normal 401 response (not an exception) so the SDK returns its
    error dict, which callers can detect and re-resolve the token.
    """

    def __init__(self, inner=None):
        self._inner = inner

    def get(self, url=None, headers=None, **kwargs):
        return self._request("GET", url, headers=headers, **kwargs)

    def post(self, url=None, headers=None, data=None, json=None, **kwargs):
        body = json
        if body is None and data is not None:
            if isinstance(data, (str, bytes, bytearray)):
                try:
                    body = _json.loads(data)
                except (ValueError, TypeError):
                    body = None
            else:
                body = data
        return self._request("POST", url, headers=headers, json=body, **kwargs)

    def _request(self, method, url, headers=None, params=None, json=None,
                 timeout=30, **kwargs):
        try:
            return paced_request(
                method,
                url,
                headers=headers,
                params=params,
                json=json,
                timeout=timeout,
            )
        except FyersAuthError as exc:
            return PacedResponse(
                _SyntheticResponse(
                    401, {"s": "error", "code": 401, "message": str(exc)}, str(exc)
                ),
                parsed={"s": "error", "code": 401, "message": str(exc)},
            )

    def close(self) -> None:
        inner = self._inner
        if inner is not None and hasattr(inner, "close"):
            inner.close()

    def __getattr__(self, name):
        return getattr(object.__getattribute__(self, "_inner"), name)
