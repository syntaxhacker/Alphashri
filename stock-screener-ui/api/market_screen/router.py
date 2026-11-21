"""Market screen router — GET /api/market/snapshot."""

from __future__ import annotations

import asyncio
import logging
import threading
from collections import OrderedDict
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from api.auth import get_current_user
from .config import ALLOWED_UNIVERSES, UNIVERSES, UNSERVABLE_UNIVERSES
from .snapshot import MAX_LIMIT, MAX_SYMBOLS, build_snapshot, select_rows
from .wire import WIRE_FORMAT_COLUMNS, dumps, normalize_format, to_columnar

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/market", tags=["market"])

_DEFAULT_UNIVERSE = "all_equity"


def _universe_description() -> str:
    """Build the Query docs from the registry so they cannot drift from it."""
    options = []
    for uid in ALLOWED_UNIVERSES:
        label = uid
        if uid == _DEFAULT_UNIVERSE:
            label += " (default)"
        if UNIVERSES[uid].currency == "USD":
            label += " (US large/mid/small caps listed on NASDAQ/NYSE/AMEX)"
        options.append(label)
    excluded = ", ".join(sorted(UNSERVABLE_UNIVERSES))
    return (
        f"Universe: {', '.join(options)}. {excluded} is intentionally unsupported "
        "(see UNSERVABLE_UNIVERSES in api/market_screen/config.py for why)."
    )


# Evaluated once at import time: FastAPI copies this into the OpenAPI schema.
_UNIVERSE_DESCRIPTION = _universe_description()

# Fixed so an upstream error string can never reach a 502 response.
_MARKET_SOURCE_UNAVAILABLE_DETAIL = (
    "market_source_unavailable: upstream market data temporarily unavailable"
)

#: Encoding a full frame costs 130-170 ms of event-loop time, and consecutive
#: polls are served from the same cached snapshot. Four entries hold both wire
#: formats for the frames a poll cycle can land on (~7 MB of bodies at the
#: 3,229-row frame); older entries are evicted first.
_ENCODED_CACHE_MAX_ENTRIES = 4
_encoded_cache: OrderedDict[tuple[Any, ...], tuple[list[dict[str, Any]], bytes]] = (
    OrderedDict()
)
_encoded_cache_lock = threading.Lock()


def _encoded_cache_key(
    fmt: str, payload: dict[str, Any], symbols_key: tuple[str, ...]
) -> tuple[Any, ...]:
    """Identity of one encoded body.

    ``format`` keeps the two layouts apart, and ``symbols_key`` keeps filtered
    subsets apart -- two different filters of the same frame can share a length
    and their first/last rows (``[A,C,D]`` vs ``[A,B,D]``), so the requested
    symbols are the only exact identity for them.

    ``_envelope`` slices the cached frame per request, so the ``rows`` list is a
    new object every time while its row dicts are shared with the shape cache.
    The first row therefore identifies the frame; ``as_of``/``update_mode``
    separate two frames whose row dicts happen to be reused.

    ``age_sec`` is deliberately absent: it is recomputed from ``time.time()``
    on every request, so keying on it would miss on every poll and re-encode
    the frame the cache exists to avoid. A hit reuses the age captured at
    encode time, bounded by the frame's own TTL and the entry's LRU slot; the
    client drops the field (``MarketSnapshot`` carries ``asOf`` only).
    """
    rows = payload.get("rows") or []
    # The anchor id is only trustworthy while the row dict is alive -- the
    # cache entry holds the rows list, which keeps every dict referenced.
    anchor = id(rows[0]) if rows else 0
    return (
        fmt,
        symbols_key,
        anchor,
        len(rows),
        payload.get("universe"),
        payload.get("as_of"),
        payload.get("update_mode"),
        payload.get("total"),
        bool(payload.get("cached")),
        bool(payload.get("stale")),
    )


def _encode_body(
    payload: dict[str, Any], fmt: str, symbols_key: tuple[str, ...]
) -> bytes:
    """Return the encoded body, encoding at most once per key."""
    key = _encoded_cache_key(fmt, payload, symbols_key)
    with _encoded_cache_lock:
        hit = _encoded_cache.get(key)
        if hit is not None:
            _encoded_cache.move_to_end(key)
            return hit[1]

    body = (
        dumps(to_columnar(payload))
        if fmt == WIRE_FORMAT_COLUMNS
        else dumps(payload)
    )

    with _encoded_cache_lock:
        _encoded_cache[key] = (payload.get("rows") or [], body)
        _encoded_cache.move_to_end(key)
        while len(_encoded_cache) > _ENCODED_CACHE_MAX_ENTRIES:
            _encoded_cache.popitem(last=False)
    return body


def _reset_encoded_cache() -> None:
    """Drop every encoded body (tests; also the escape hatch after a schema change)."""
    with _encoded_cache_lock:
        _encoded_cache.clear()


@router.get(
    "/snapshot",
    summary="Market snapshot (NSE / US) for the one-page screener",
    # Both layouts are pre-encoded bytes, not a Pydantic model.
    response_model=None,
    dependencies=[Depends(get_current_user)],
)
async def market_snapshot(
    universe: str = Query(
        default=_DEFAULT_UNIVERSE,
        description=_UNIVERSE_DESCRIPTION,
    ),
    limit: int = Query(
        default=MAX_LIMIT,
        ge=1,
        le=MAX_LIMIT,
        description="Max rows returned (1..4000).",
    ),
    symbols: str | None = Query(
        default=None,
        description=(
            "Optional comma-separated symbols (max 20). Filtered against the "
            "full cached snapshot, before `limit` is applied; unknown symbols "
            "are omitted."
        ),
    ),
    force: bool = Query(
        default=False,
        description="Bypass the in-process/disk cache and re-fetch from TradingView.",
    ),
    response_format: str = Query(
        default="json",
        alias="format",
        description=(
            "Response layout: json (default, the object envelope with rows) or "
            "columns (columns-v1: fields + equal-length columns + meta). Both "
            "layouts are encoded once per cached snapshot and served from an "
            "in-process encoded-body cache."
        ),
    ),
) -> Response:
    """Return the whole NSE market (one TV scan) shaped for the screener.

    The (potentially 58s cold) TV scan runs off the event loop via
    ``asyncio.to_thread`` so it can never block other requests.

    ``symbols`` is optional. An empty or whitespace-only value (e.g.
    ``?symbols=``) means no filter and returns all rows; otherwise it filters
    the full snapshot to the requested symbols (max 20, deduplicated
    case-insensitively) and ``total`` is the number of matches. The filter runs
    before ``limit`` truncates the response, so a symbol outside the first
    ``limit`` rows of the universe is still found.

    ``format`` is the wire layout, not a different dataset: both layouts encode
    the same rows (``columns`` hoists the field names once and transposes the
    values; ``json`` keeps the object envelope with ``rows``). Validated before
    any scan so a typo cannot burn a TradingView call. Both layouts are encoded
    once per cached frame and served as bytes from the encoded-body cache;
    GZipMiddleware still compresses against the request's ``Accept-Encoding``.
    """
    try:
        fmt = normalize_format(response_format)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    wanted: list[str] | None = None
    if symbols is not None:
        raw = [s.strip() for s in symbols.split(",") if s.strip()]
        # Dedupe case-insensitively (first occurrence wins) before the cap
        # check so repeated entries do not burn the symbol budget.
        seen: set[str] = set()
        wanted = []
        for s in raw:
            key = s.upper()
            if key in seen:
                continue
            seen.add(key)
            wanted.append(s)
        if len(wanted) > MAX_SYMBOLS:
            raise HTTPException(
                status_code=400,
                detail=f"symbols accepts at most {MAX_SYMBOLS} symbols",
            )

    # A symbol filter must see the whole universe: the TV scan truncates to
    # ``limit``, so filtering a 12-row frame can never find rank 400. Build the
    # full frame (the same one the prewarm task caches) and apply the cap after
    # the filter. The cached frame is therefore keyed on MAX_LIMIT -- the cache
    # stores the full snapshot, and the filter stays a response transform.
    frame_limit = MAX_LIMIT if wanted else limit
    try:
        result = await asyncio.to_thread(build_snapshot, universe, frame_limit, force)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # upstream TV failure without a cached fallback
        logger.exception("market snapshot upstream failure universe=%s", universe)
        raise HTTPException(
            status_code=502, detail=_MARKET_SOURCE_UNAVAILABLE_DETAIL
        ) from exc

    if wanted:
        rows, matched = select_rows(result["rows"], wanted, limit)
        result = {**result, "rows": rows, "total": matched}

    symbols_key = tuple(sorted(s.upper() for s in wanted)) if wanted else ()
    return Response(
        content=_encode_body(result, fmt, symbols_key),
        media_type="application/json",
    )
