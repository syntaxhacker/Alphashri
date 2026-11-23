"""Chain-at-time-T providers for multi-day option replay.

Three ordered sources expose one read-only interface: DB minute snapshots,
recorded 10-second chain files and (feature-flagged) Upstox active-contract
history. No source invents a price. A quote is the latest observation at or
before the requested timestamp; a leg without a print is simply absent from
``ChainQuote.premiums``, and ``premium_series`` marks it ``priced=False`` while
carrying the last known premium.

Timestamps in the DB are **naive IST**; file rows are ISO strings of the same
wall clock. Both are normalised to IST-aware datetimes at the boundary.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from itertools import islice
from pathlib import Path
from typing import Callable, Optional, Protocol, Sequence

import config

IST = config.IST

#: Network history is opt-in. Nothing below reaches Upstox unless the operator
#: sets this explicitly; local snapshots and recorded files are the default.
UPSTOX_HISTORY_FLAG = "OPTIONS_PAPER_UPSTOX_HISTORY"


def upstox_history_enabled() -> bool:
    """True only when the operator explicitly opts into Upstox history reads."""
    return os.getenv(UPSTOX_HISTORY_FLAG, "").strip().lower() in {"1", "true", "yes", "on"}


#: Hard caps. Replay is precomputed, so every read must be bounded in rows and
#: in wall-clock span; nothing here may grow with an unbounded upstream feed.
MAX_WINDOW = timedelta(days=62)
MAX_ROWS = 5000
_FILE_LOOKBACK_DAYS = 5
_SNAPSHOT_LOOKBACK = timedelta(days=5)


# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class ChainQuote:
    """One chain observation at time ``t`` (IST-aware)."""

    t: datetime
    spot: float
    expiry: str
    ladder: tuple[float, ...]
    premiums: dict[tuple[float, str], float]
    source: str
    gaps: int


class ChainProvider(Protocol):
    def chain_at(self, underlying: str, expiry: str,
                 ts: datetime) -> Optional[ChainQuote]:
        """Latest chain at or before ``ts``, or ``None`` when unavailable."""
        ...

    def premium_series(
        self, underlying: str, expiry: str, strike: float, opt: str,
        from_ts: datetime, to_ts: datetime,
    ) -> list[tuple[datetime, float, bool]]:
        """``(t, premium, priced)`` observations; ``priced=False`` carries last."""
        ...


_UNDERLYING_RE = re.compile(r"^[A-Z0-9][A-Z0-9.&-]{0,29}$")


def safe_underlying(underlying: str) -> str:
    """Validate an underlying before it becomes a filesystem path component."""
    symbol = str(underlying or "").strip().upper()
    if not _UNDERLYING_RE.fullmatch(symbol) or ".." in symbol:
        raise ValueError(f"invalid underlying {underlying!r}")
    return symbol


def _ist(ts: datetime) -> datetime:
    """Attach IST to a naive timestamp; convert an aware one to IST."""
    if ts.tzinfo is None:
        return ts.replace(tzinfo=IST)
    return ts.astimezone(IST)


def _finite(value) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


def _clamp_window(from_ts: datetime, to_ts: datetime) -> tuple[datetime, datetime]:
    lo, hi = _ist(from_ts), _ist(to_ts)
    return max(lo, hi - MAX_WINDOW), hi


def _carry_series(observations: Sequence[tuple[datetime, Optional[float]]]
                  ) -> list[tuple[datetime, float, bool]]:
    """Deduplicate by minute and carry the last real print forward.

    A missing LTP is reported as ``(t, last, False)`` — never dropped (dropping
    would silently compress the timeline) and never filled with a guessed
    value. The engine uses the flag to surface coverage gaps.
    """
    by_minute: dict[datetime, Optional[float]] = {}
    for ts, premium in observations:
        by_minute[ts.replace(second=0, microsecond=0)] = premium
    out: list[tuple[datetime, float, bool]] = []
    last = 0.0
    for ts in sorted(by_minute):
        px = _finite(by_minute[ts])
        if px is not None and px > 0:
            last = px
            out.append((ts, last, True))
        else:
            out.append((ts, last, False))
    return out


def _quote(ts, spot, expiry, ladder, premiums, source, gaps) -> ChainQuote:
    return ChainQuote(t=_ist(ts), spot=float(spot or 0.0), expiry=str(expiry),
                      ladder=tuple(sorted(set(float(k) for k in ladder))),
                      premiums=dict(premiums), source=source, gaps=int(gaps))


# ---------------------------------------------------------------------------
# 1. DB snapshots
# ---------------------------------------------------------------------------
class SnapshotChainProvider:
    """Reads ``OptionChainSnapshot`` rows; injectable session factory."""

    source = "snapshot"

    def __init__(self, session_factory=None):
        self._session_factory = session_factory

    def _session(self):
        factory = self._session_factory
        if factory is None:
            from db.database import SessionLocal as factory  # lazy: no import at load
        return factory()

    def _rows(self, underlying=None, expiry=None, lo=None, hi=None):
        session = self._session()
        try:
            # Narrow in SQL *before* LIMIT: an oldest-first global cap silently
            # hides the requested window in an append-only snapshots table.
            # Python below stays the source of truth so a lightweight fake
            # session can still be injected in tests.
            model = _snapshot_model()
            query = session.query(model)
            if underlying is not None:
                query = query.filter(model.underlying == underlying)
            if expiry is not None:
                query = query.filter(model.expiry == expiry)
            if lo is not None:
                query = query.filter(model.ts >= lo)
            if hi is not None:
                query = query.filter(model.ts <= hi)
            return list(query.order_by(model.ts.desc()).limit(MAX_ROWS).all())
        finally:
            close = getattr(session, "close", None)
            if close:
                close()

    def chain_at(self, underlying: str, expiry: str,
                 ts: datetime) -> Optional[ChainQuote]:
        target = _ist(ts)
        underlying = safe_underlying(underlying)
        rows = [r for r in self._rows(
                    underlying=underlying, expiry=expiry,
                    lo=target - _SNAPSHOT_LOOKBACK, hi=target)
                if str(getattr(r, "underlying", "")).upper() == str(underlying).upper()
                and str(getattr(r, "expiry", "")) == str(expiry)
                and _snapshot_ts(r) <= target
                and _snapshot_ts(r) >= target - _SNAPSHOT_LOOKBACK]
        if not rows:
            return None
        latest = max(_snapshot_ts(r) for r in rows)
        rows = [r for r in rows if _snapshot_ts(r) == latest]
        ladder = [float(r.strike) for r in rows if _finite(r.strike) is not None]
        premiums = {}
        for r in rows:
            px = _finite(r.ltp)
            if px is not None and px > 0:
                premiums[(float(r.strike), str(r.side).upper())] = px
        spot = next((_finite(r.spot) for r in rows if _finite(r.spot)), 0.0)
        gaps = sum(1 for r in rows if _finite(r.ltp) is None or _finite(r.ltp) <= 0)
        return _quote(latest, spot, expiry, ladder, premiums, self.source, gaps)

    def premium_series(self, underlying: str, expiry: str, strike: float,
                       opt: str, from_ts: datetime,
                       to_ts: datetime) -> list[tuple[datetime, float, bool]]:
        lo, hi = _clamp_window(from_ts, to_ts)
        underlying = safe_underlying(underlying)
        observations = []
        for r in self._rows(underlying=underlying, expiry=expiry, lo=lo, hi=hi):
            if str(getattr(r, "underlying", "")).upper() != str(underlying).upper():
                continue
            if str(getattr(r, "expiry", "")) != str(expiry):
                continue
            if _finite(r.strike) is None or abs(float(r.strike) - float(strike)) > 1e-6:
                continue
            if str(getattr(r, "side", "")).upper() != str(opt).upper():
                continue
            ts = _snapshot_ts(r)
            if lo <= ts <= hi:
                observations.append((ts, _finite(r.ltp)))
        return _carry_series(observations)


def _snapshot_model():
    from db.models.option_snapshot import OptionChainSnapshot
    return OptionChainSnapshot


def _snapshot_ts(row) -> datetime:
    return _ist(row.ts)


# ---------------------------------------------------------------------------
# 2. Recorded 10-second chain files
# ---------------------------------------------------------------------------
class FileChainProvider:
    """Read-only reader for ``experiments/data/options_chain10s/{SYM}/{date}.jsonl``."""

    source = "file"
    CE_LTP, PE_LTP = 1, 4

    def __init__(self, root=None):
        self.root = Path(root) if root is not None else (
            Path(config.BASE_DIR) / "experiments" / "data")

    def _path(self, underlying: str, day: date) -> Path:
        path = (self.root / "options_chain10s" / safe_underlying(underlying)
                / f"{day.isoformat()}.jsonl")
        if not path.resolve().is_relative_to(self.root.resolve()):
            raise ValueError(f"invalid underlying {underlying!r}")
        return path

    def _read(self, underlying: str, day: date) -> list[dict]:
        path = self._path(underlying, day)
        if not path.is_file():
            return []
        out = []
        with path.open("r", encoding="utf-8") as fh:
            for line in islice(fh, MAX_ROWS):
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except (ValueError, TypeError):
                    continue
                ts = _row_ts(row)
                if ts is not None:
                    out.append({"t": ts, "spot": _finite(row.get("spot")),
                                "expiry": str(row.get("expiry") or ""),
                                "rows": row.get("rows") or []})
        return out

    def _recent_rows(self, underlying: str, target: datetime) -> list[dict]:
        day = _ist(target).date()
        for back in range(_FILE_LOOKBACK_DAYS):
            rows = self._read(underlying, day - timedelta(days=back))
            if rows:
                return rows
        return []

    def chain_at(self, underlying: str, expiry: str,
                 ts: datetime) -> Optional[ChainQuote]:
        target = _ist(ts)
        underlying = safe_underlying(underlying)
        rows = [r for r in self._recent_rows(underlying, target)
                if r["t"] <= target and r["expiry"] == str(expiry)]
        if not rows:
            return None
        row = max(rows, key=lambda r: r["t"])
        ladder, premiums, gaps = [], {}, 0
        for entry in row["rows"]:
            if not isinstance(entry, (list, tuple)) or len(entry) < 5:
                continue
            strike = _finite(entry[0])
            if strike is None:
                continue
            ladder.append(strike)
            for opt, idx in (("CE", self.CE_LTP), ("PE", self.PE_LTP)):
                px = _finite(entry[idx]) if len(entry) > idx else None
                if px is not None and px > 0:
                    premiums[(strike, opt)] = px
                else:
                    gaps += 1
        return _quote(row["t"], row["spot"] or 0.0, expiry, ladder,
                      premiums, self.source, gaps)

    def premium_series(self, underlying: str, expiry: str, strike: float,
                       opt: str, from_ts: datetime,
                       to_ts: datetime) -> list[tuple[datetime, float, bool]]:
        lo, hi = _clamp_window(from_ts, to_ts)
        underlying = safe_underlying(underlying)
        idx = {"CE": self.CE_LTP, "PE": self.PE_LTP}.get(str(opt).upper())
        if idx is None:
            return []
        observations = []
        day = _ist(lo).date()
        last_day = _ist(hi).date()
        count = 0
        while day <= last_day and count < _FILE_LOOKBACK_DAYS + MAX_WINDOW.days:
            for row in self._read(underlying, day):
                if not (lo <= row["t"] <= hi) or row["expiry"] != str(expiry):
                    continue
                px = None
                for entry in row["rows"]:
                    if (isinstance(entry, (list, tuple)) and len(entry) > idx
                            and _finite(entry[0]) is not None
                            and abs(float(entry[0]) - float(strike)) < 1e-6):
                        px = _finite(entry[idx])
                        break
                observations.append((row["t"], px))
            day += timedelta(days=1)
            count += 1
        return _carry_series(observations)


def _row_ts(row: dict) -> Optional[datetime]:
    raw = row.get("t")
    if raw is None:
        return None
    try:
        return _ist(datetime.fromisoformat(str(raw)))
    except (TypeError, ValueError):
        return None


def _file_sessions(root: Path, underlying: str) -> list[str]:
    if root is None:
        root = Path(config.BASE_DIR) / "experiments" / "data"
    folder = Path(root) / "options_chain10s" / safe_underlying(underlying)
    if not folder.is_dir():
        return []
    out = set()
    for path in folder.glob("*.jsonl"):
        try:
            out.add(date.fromisoformat(path.stem).isoformat())
        except ValueError:
            continue
    return sorted(out)


def available_sessions(underlying: str, root=None,
                       session_factory=None) -> list[str]:
    """Union of DB snapshot dates and recorded file dates; never network."""
    underlying = safe_underlying(underlying)
    out = set(_file_sessions(
        Path(root) if root is not None else Path(config.BASE_DIR) / "experiments" / "data",
        underlying))
    session = (session_factory() if session_factory is not None
               else SnapshotChainProvider()._session())
    try:
        model = _snapshot_model()
        rows = list(session.query(model)
                    .filter(model.underlying == underlying)
                    .order_by(model.ts.desc())
                    .limit(MAX_ROWS).all())
    finally:
        close = getattr(session, "close", None)
        if close:
            close()
    for r in rows:
        if str(getattr(r, "underlying", "")).upper() != str(underlying).upper():
            continue
        day = getattr(r, "session_date", None)
        if not day:
            try:
                day = _snapshot_ts(r).date().isoformat()
            except (AttributeError, TypeError, ValueError):
                continue
        out.add(str(day))
    return sorted(out)


# ---------------------------------------------------------------------------
# 3. Upstox active-contract adapter (feature-flagged OFF by default)
# ---------------------------------------------------------------------------
def _call_async(factory: Callable[[], object]):
    """Run an async helper factory from a synchronous provider method.

    Replay pricing runs in a worker thread (see ``service.place_order``) and
    FastAPI's replay routes are sync, so no loop is active here and
    ``asyncio.run`` is safe. A loop-active caller fails loudly instead of
    blocking the loop or returning an empty series that would read as "no
    trades": neither is an honest answer.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(factory())  # type: ignore[arg-type]
    raise RuntimeError(
        "Upstox history bridge called from a running event loop; use the "
        "service-level async path (place_order runs replay in a worker thread)"
    )


def _order_error(message: str) -> Exception:
    """The service's user-facing 400, imported lazily to avoid a cycle."""
    from api.options_paper.service import OrderError
    return OrderError(message)


def _upstream_order_error(underlying: str, exc: Exception) -> Exception:
    """Map an auth/rate-limit/upstream failure to a 400 naming the cause."""
    from api.options_paper.service import OrderError
    if isinstance(exc, OrderError):
        return exc
    status = getattr(exc, "status_code", None)
    if status == 401:
        cause = "Upstox token missing or expired (reconnect in Settings)"
    elif status == 429:
        cause = "Upstox rate limit reached (429)"
    elif isinstance(status, int) and status >= 500:
        cause = f"Upstox upstream error {status}"
    else:
        cause = f"{type(exc).__name__}: {exc}"[:200].replace("\n", " ")
    return OrderError(f"entryTs: Upstox history for {underlying}: {cause}")


def upstox_resolve_key() -> Callable:
    """Build the sync ``resolve_key`` seam over the repo's Upstox client.

    Reuses ``api.options.fetch_upstox`` (the single HTTP client, DB-first
    token) and ``api.options_underlying._resolve_instrument``; no second HTTP
    stack and no secret handling here. ``None`` means the contract genuinely
    is not listed, never "no data" to be filled with a guess.
    """
    def resolve(underlying: str, expiry: str, strike: float, opt: str):
        async def _resolve():
            from fastapi import HTTPException
            from api.options import fetch_upstox
            from api.options_underlying import _resolve_instrument

            try:
                broker_key, _exchange = _resolve_instrument(underlying)
            except HTTPException as exc:
                if getattr(exc, "status_code", None) == 404:
                    return None
                raise
            payload = await fetch_upstox(
                "/option/contract",
                {"instrument_key": broker_key, "expiry_date": str(expiry)},
            )
            rows = payload.get("data") if isinstance(payload, dict) else None
            for row in rows or []:
                if not isinstance(row, dict):
                    continue
                if str(row.get("expiry") or "") != str(expiry):
                    continue
                if str(row.get("instrument_type") or "").upper() != str(opt).upper():
                    continue
                row_strike = _finite(row.get("strike_price", row.get("strike")))
                if row_strike is None or abs(row_strike - float(strike)) > 1e-6:
                    continue
                key = str(row.get("instrument_key") or "")
                if key.startswith("NSE_FO|"):
                    return key
            return None

        return _call_async(_resolve)

    return resolve


def upstox_fetch_candles() -> Callable:
    """Build the sync ``fetch_candles`` seam over the V3 historical helper.

    ``api.options_contract_chart`` already owns the V3 URL shape, the DB-first
    token, the 401/429/5xx mapping and the newest-first wire parsing, so this
    only supplies the bounded window and lifts each traded close as the LTP.
    """
    def fetch(key: str, from_ts: datetime, to_ts: datetime):
        async def _fetch():
            from api import options_contract_chart as occ

            url = occ._historical_url(
                key, "1", _ist(to_ts).date().isoformat(),
                _ist(from_ts).date().isoformat(),
            )
            rows = await occ._fetch_candles(url)
            by_ts: dict[datetime, float] = {}
            for row in rows or []:
                parsed = occ._parse_candle(row)
                if parsed is None:
                    continue
                ts, _session, wire = parsed
                px = _finite(wire.get("c"))
                if px is None or px <= 0:
                    continue
                by_ts[ts] = px  # upstream is newest-first; keep its last print
            return sorted(by_ts.items())

        return _call_async(_fetch)

    return fetch


class UpstoxChainProvider:
    """Per-leg history from Upstox **active** contracts only.

    Third in the composite: local snapshots and recorded files always win, and
    this provider stays inert unless ``OPTIONS_PAPER_UPSTOX_HISTORY`` is set.
    ``chain_at`` is intentionally unimplemented — Upstox has no historical
    chain endpoint, and a ladder cannot be derived from leg candles without
    inventing strikes.

    The two seams are synchronous so the sync replay engine can call them::

        resolve_key(underlying, expiry, strike, opt) -> "NSE_FO|<token>" | None
        fetch_candles(key, from_ts, to_ts) -> [(datetime, ltp), ...]

    ``make_provider`` wires them to the repo's async Upstox helpers; tests
    inject fakes. Expired instruments need Upstox Plus and are not used.
    """

    MAX_WINDOW = timedelta(days=31)
    source = "upstox"

    def __init__(self, resolve_key: Optional[Callable] = None,
                 fetch_candles: Optional[Callable] = None,
                 enabled: bool = False):
        self.resolve_key = resolve_key
        self.fetch_candles = fetch_candles
        self.enabled = bool(enabled)

    def chain_at(self, underlying: str, expiry: str,
                 ts: datetime) -> Optional[ChainQuote]:
        raise NotImplementedError(
            "UpstoxChainProvider.chain_at: Upstox has no historical chain "
            "endpoint; use SnapshotChainProvider/FileChainProvider for the "
            "ladder and this provider only for premium_series"
        )

    def premium_series(self, underlying: str, expiry: str, strike: float,
                       opt: str, from_ts: datetime,
                       to_ts: datetime) -> list[tuple[datetime, float, bool]]:
        if not self.enabled or not self.resolve_key or not self.fetch_candles:
            raise NotImplementedError(
                "UpstoxChainProvider is feature-flagged off: pass "
                "resolve_key/fetch_candles and enabled=True to wire the "
                "active-contract candle seam; expired instruments need "
                "Upstox Plus and are not used"
            )
        underlying = safe_underlying(underlying)
        lo, hi = _ist(from_ts), _ist(to_ts)
        lo = max(lo, hi - self.MAX_WINDOW)
        try:
            key = self.resolve_key(underlying, expiry, float(strike), str(opt).upper())
        except Exception as exc:
            raise _upstream_order_error(underlying, exc) from None
        if not key:
            raise _order_error(
                f"entryTs: no active Upstox contract for {underlying} {expiry} "
                f"{float(strike):g} {str(opt).upper()}"
            )
        try:
            rows = self.fetch_candles(key, lo, hi) or []
        except Exception as exc:
            raise _upstream_order_error(underlying, exc) from None
        observations = []
        for ts, ltp in rows:
            px = _finite(ltp)
            if px is None or px <= 0:
                continue
            t = _ist(ts)
            if lo <= t <= hi:
                observations.append((t, px))
        return _carry_series(observations)


# ---------------------------------------------------------------------------
# Ordered composite
# ---------------------------------------------------------------------------
class CompositeChainProvider:
    """Try sources in order; expose which one served the last call."""

    def __init__(self, providers: Sequence[ChainProvider]):
        self.providers = list(providers or [])
        self.last_sources: dict[str, str] = {}

    def chain_at(self, underlying: str, expiry: str,
                 ts: datetime) -> Optional[ChainQuote]:
        for p in self.providers:
            try:
                quote = p.chain_at(underlying, expiry, ts)
            except NotImplementedError:
                continue
            if quote is not None:
                self.last_sources["chain_at"] = quote.source
                return quote
        self.last_sources["chain_at"] = ""
        return None

    def premium_series(self, underlying: str, expiry: str, strike: float,
                       opt: str, from_ts: datetime,
                       to_ts: datetime) -> list[tuple[datetime, float, bool]]:
        for p in self.providers:
            try:
                series = p.premium_series(underlying, expiry, strike, opt,
                                          from_ts, to_ts)
            except NotImplementedError:
                continue
            if series:
                self.last_sources["premium_series"] = getattr(p, "source", "")
                return series
        self.last_sources["premium_series"] = ""
        return []


__all__ = [
    "ChainQuote", "ChainProvider", "SnapshotChainProvider", "FileChainProvider",
    "UpstoxChainProvider", "upstox_resolve_key", "upstox_fetch_candles",
    "upstox_history_enabled", "UPSTOX_HISTORY_FLAG",
    "CompositeChainProvider", "available_sessions",
]
