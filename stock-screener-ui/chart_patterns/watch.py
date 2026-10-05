"""Breakout Watch: arm from the latest scan hits, then check live prices.

Shared by the app (``api/chart_patterns.py`` ``/watch`` endpoints) and the
``scripts/breakout_watch.py`` CLI. Two phases:

1. :func:`arm` — read the latest stored hits for a setup's ``source_pattern``
   (via :mod:`chart_patterns.store`, deduped) and keep the ones matching the
   setup's status/base/range gates. One row per symbol (highest confidence).
   A ``confirmed`` hit is armed only when the break is fresh (stored close
   at/just above the box); stale breakouts far above the box stay excluded.
   Fresh-cross rows carry ``fresh=True`` so :func:`live` can mark them
   ``triggered`` even though the last completed bar was already above the box.
2. :func:`live` — attach the latest price + TradingView rel-volume to each
   armed row and classify it as ``triggered`` / ``invalidated`` / ``armed``.
   Prices come from the OAuth LTP batch; when that fails (e.g. an expired
   token) each missing symbol falls back to the 1m tape via a bounded thread
   pool, memoised for a short TTL so repeated polls stay cheap.

Both functions never raise on empty stores or failed price feeds: ``arm``
returns ``[]`` when the store has no hits, and ``live`` marks rows with a
missing price as ``armed`` with ``ltp=None``.
"""

from __future__ import annotations

import importlib
import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

LTP_URL = "https://api.upstox.com/v3/market-quote/ltp"

SETUPS: dict[str, dict] = {
    "breakout": {
        "id": "breakout",
        "label": "Long-base breakout",
        "description": "Long tight base; trigger = box high, invalidate = box low",
        "source_pattern": "consolidation",
        # Arm bases that have NOT already broken out — plus *fresh* breakouts.
        # ``confirmed`` means the last completed close is above the box high,
        # which is usually a stale breakout (e.g. +18% above its box), not a
        # watch candidate. But ``confirmed`` also covers a fresh same-day
        # break (close 37.15 vs trigger 36.95, only +0.54%): those rows are
        # armed with ``fresh=True`` (see ``_fresh_confirmed``) so the live
        # state machine can mark them ``triggered``. ``forming`` = within 2%
        # below the trigger; ``failed`` covers the mid-box bases (a
        # consolidation's close is normally well below the line, so
        # ``classify_status`` calls that "failed"); breakdowns among them are
        # marked ``invalidated`` by the live state machine.
        "statuses": ["forming", "failed", "marginal"],
        "min_base_days": 60,
        "max_range_pct": 20.0,
        "trigger": "breakout_level",
        "invalidate": "base_low",
        "default_min_rel_volume": 1.5,
    },
}

#: Upper bound on rows pulled from the store per ``arm`` call.
_ARM_QUERY_LIMIT = 5000

#: A ``confirmed`` hit counts as a fresh same-day break (not a stale
#: breakout) while its stored close sits at/just above the box top.
#: ``range_pos`` is the base-close position on a ``0..100`` box scale, so
#: ``<= 110`` means the close is at most ~10% of the box height above the
#: trigger — a just-crossed bar, not a runaway move.
_FRESH_RANGE_POS_MAX = 110.0

#: Fallback freshness gate on the stored close's gap above ``breakout_level``
#: (percent), used alongside ``_FRESH_RANGE_POS_MAX`` and alone when the hit
#: carries no usable ``range_pos`` (via the stored ``end_price``). Stale
#: breakouts (e.g. +18% above the box) stay excluded.
_FRESH_GAP_PCT_MAX = 5.0

#: Upstox OAuth access tokens live ~a day; a DB token older than this is
#: treated as expired and the doomed LTP call is skipped (straight to the
#: tape fallback).
_UPSTOX_TOKEN_TTL_SECONDS = 24 * 3600

#: Bounded fan-out for the per-symbol tape fallback (one 1m fetch each).
_TAPE_WORKERS = 5

#: Memoised tape prices stay valid this long (seconds) so repeated polls —
#: and the endpoint + CLI polling the same names — don't refetch every bar.
_TAPE_CACHE_TTL_SECONDS = 30.0

#: ``symbol|timeframe`` -> ``(price, monotonic_ts)``. Small and self-expiring;
#: only successful fetches are stored.
_TAPE_CACHE: dict[str, tuple[float, float]] = {}


def public_setups() -> list[dict]:
    """Registry entries without the ``source_pattern`` internals."""
    return [
        {
            "id": setup["id"],
            "label": setup["label"],
            "description": setup["description"],
            "default_min_rel_volume": setup["default_min_rel_volume"],
        }
        for setup in SETUPS.values()
    ]


def _base_low_from_hit(hit: dict) -> Optional[float]:
    """Base low from the hit's lower trendline, else ``None`` (caller falls back)."""
    try:
        lines = hit.get("trendlines") or []
        if len(lines) >= 2 and lines[1]:
            price = lines[1][0].get("price")
            if price is not None:
                return float(price)
    except (TypeError, ValueError, IndexError, KeyError, AttributeError):
        pass
    return None


def _fresh_confirmed(hit: dict, trigger: float, base_low: float) -> bool:
    """True when a ``confirmed`` hit is a fresh same-day break, not stale.

    Fresh = the stored close is at/just above the box top: ``range_pos``
    (the base-close position on the ``0..100`` box scale) ``<= 110``, or the
    stored close's gap above ``breakout_level`` is small. The close is
    derived from the hit as
    ``close = base_low + range_pos / 100 * (box_high - base_low)`` with
    ``box_high = breakout_level``; when the hit carries no usable
    ``range_pos`` the stored ``end_price`` stands in for the close. A stale
    breakout (e.g. +18% above its box) fails both gates. Never raises.
    """
    try:
        trigger = float(trigger)
        base_low = float(base_low)
    except (TypeError, ValueError):
        return False
    try:
        rp = hit.get("range_pos")
        if rp is not None:
            rp = float(rp)
            span = trigger - base_low
            if span > 0 and trigger > 0:
                close = base_low + rp / 100.0 * span
                gap_pct = (close - trigger) / trigger * 100.0
                return rp <= _FRESH_RANGE_POS_MAX or gap_pct <= _FRESH_GAP_PCT_MAX
            return rp <= _FRESH_RANGE_POS_MAX
    except (TypeError, ValueError, ZeroDivisionError):
        pass
    try:
        end = hit.get("end_price")
        if end is None or trigger <= 0:
            return False
        return (float(end) - trigger) / trigger * 100.0 <= _FRESH_GAP_PCT_MAX
    except (TypeError, ValueError, ZeroDivisionError):
        return False


def arm(
    setup_id: str,
    *,
    universe: Optional[str] = None,
    timeframe: str = "1D",
    min_base_days: Optional[int] = None,
    max_range_pct: Optional[float] = None,
    symbol: Optional[str] = None,
) -> list[dict]:
    """Armed rows for ``setup_id`` from the latest stored hits.

    Reads the latest store hits for the setup's ``source_pattern`` (via
    ``store.query_results`` with a ``pattern_id`` + ``timeframe`` filter,
    deduped), keeps rows whose ``status`` is in the setup's ``statuses`` and
    that pass the base/range gates, and returns one row per symbol (highest
    confidence). A ``confirmed`` hit is additionally armed when its break is
    fresh (stored close at/just above the box — see ``_fresh_confirmed``);
    stale ``confirmed`` breakouts far above the box stay excluded. Fresh-cross
    rows carry ``fresh=True`` (all other rows ``fresh=False``) so the live
    state machine can mark them ``triggered`` even though the last completed
    bar was already above the box. Returns ``[]`` when the store has no hits
    (never raises).
    """
    from chart_patterns import store

    setup = SETUPS.get(setup_id)
    if setup is None:
        raise ValueError(f"unknown setup {setup_id!r}")
    floor_days = int(min_base_days) if min_base_days is not None else int(setup["min_base_days"])
    ceiling_pct = float(max_range_pct) if max_range_pct is not None else float(setup["max_range_pct"])

    filters: dict = {"pattern_id": setup["source_pattern"], "timeframe": timeframe}
    if universe:
        filters["universe"] = universe
    if symbol:
        filters["symbol"] = [symbol.upper()] if isinstance(symbol, str) else [str(s).upper() for s in symbol]
    try:
        items, _total, _summary = store.query_results(filters, limit=_ARM_QUERY_LIMIT)
    except Exception as exc:
        log.warning("breakout watch: store query failed (%s)", exc)
        return []

    best: dict[str, dict] = {}
    for hit in items or []:
        try:
            base_days = hit.get("base_days")
            range_pct = hit.get("range_pct")
            if base_days is None or int(base_days) < floor_days:
                continue
            if range_pct is None or float(range_pct) > ceiling_pct:
                continue
            trigger = hit.get("breakout_level")
            if trigger is None:
                continue
            trigger = float(trigger)
            base_low = _base_low_from_hit(hit)
            if base_low is None:
                base_low = trigger * (1.0 - float(range_pct) / 100.0)
            status = hit.get("status") or ""
            if status in setup["statuses"]:
                fresh = False
            elif status == "confirmed" and _fresh_confirmed(hit, trigger, base_low):
                fresh = True
            else:
                continue
            row = {
                "symbol": str(hit.get("symbol") or "").upper(),
                "setup_id": setup_id,
                "trigger_level": trigger,
                "invalidate_level": float(base_low),
                "base_days": int(base_days),
                "range_pct": float(range_pct),
                "confidence": hit.get("confidence"),
                "status": hit.get("status"),
                "end_date": hit.get("end_date"),
                # Fresh-cross contract: True only for an armed ``confirmed``
                # hit whose stored close sits at/just above the box. ``live``
                # marks such a row ``triggered`` when the price holds above
                # the trigger, even though the last completed bar already
                # crossed it.
                "fresh": fresh,
            }
        except (TypeError, ValueError):
            continue
        if not row["symbol"]:
            continue
        prev = best.get(row["symbol"])
        if prev is None or (row["confidence"] or 0.0) > (prev["confidence"] or 0.0):
            best[row["symbol"]] = row
    return sorted(best.values(), key=lambda r: -(r["confidence"] or 0.0))


def _broker_token_data() -> Optional[dict]:
    """Shared Upstox broker token row (DB), else ``None``. Never raises."""
    try:
        from db.models import get_shared_broker_token

        return get_shared_broker_token("upstox")
    except Exception:
        return None


def _token() -> Optional[str]:
    """Upstox OAuth token: DB → ``.upstox_token.json`` → env. Never raises."""
    try:
        data = _broker_token_data()
        if data and data.get("access_token"):
            return data["access_token"]
    except Exception:
        pass
    try:
        token_file = Path(__file__).resolve().parent.parent / ".upstox_token.json"
        if token_file.exists():
            token = json.loads(token_file.read_text()).get("access_token")
            if token:
                return token
    except Exception:
        pass
    return os.getenv("UPSTOX_ACCESS_TOKEN")


def _upstox_token_expired() -> bool:
    """True when the DB OAuth token is older than its TTL (expired).

    Only the DB row carries a ``token_timestamp``; file/env tokens have no
    age signal and are treated as usable (``False``). Unknown/unparseable
    timestamps also yield ``False`` — the LTP call itself is the fallback
    detector via HTTP 401. Never raises.
    """
    try:
        data = _broker_token_data()
        ts = (data or {}).get("token_timestamp")
        if not ts:
            return False
        if isinstance(ts, datetime):
            when = ts
        else:
            text = str(ts).strip()
            if text.endswith("Z"):
                text = text[:-1] + "+00:00"
            when = datetime.fromisoformat(text)
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        age = (datetime.now(timezone.utc) - when).total_seconds()
        return age > _UPSTOX_TOKEN_TTL_SECONDS
    except Exception:
        return False


#: Optional OAuth refresh helpers, ``(module, fn names)``. Neither module
#: ships in this repo today (there is no ``upstox_auth.py`` /
#: ``upstox_auth_refresh.py`` and the broker row stores no refresh token),
#: so the lookup below is a seam: when such a helper exists it is reused,
#: otherwise the 401 path degrades to the tape fallback.
_REFRESH_HELPERS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("upstox_auth_refresh", ("refresh_access_token", "refresh_token", "refresh")),
    ("upstox_auth", ("refresh_access_token", "refresh_token", "refresh")),
)


def _try_refresh_upstox_token() -> Optional[str]:
    """Best-effort Upstox OAuth refresh; new access token or ``None``.

    Reuses the first importable helper in ``_REFRESH_HELPERS``, passing the
    broker row's ``refresh_token`` when one is stored (else calling it
    bare). Accepts a plain token string or a ``{"access_token": ...}`` dict
    back. There is currently no refresh path in this repo, so this usually
    returns ``None`` and callers fall back to the tape. Never raises.
    """
    try:
        data = _broker_token_data() or {}
    except Exception:
        data = {}
    refresh_token = data.get("refresh_token")
    for mod_name, fn_names in _REFRESH_HELPERS:
        try:
            mod = importlib.import_module(mod_name)
        except Exception:
            continue
        for fn_name in fn_names:
            helper = getattr(mod, fn_name, None)
            if not callable(helper):
                continue
            try:
                if refresh_token:
                    try:
                        result = helper(refresh_token)
                    except TypeError:
                        result = helper()
                else:
                    result = helper()
            except Exception as exc:
                log.warning("breakout watch: token refresh helper failed (%s)", exc)
                continue
            try:
                if isinstance(result, dict):
                    result = result.get("access_token")
                if result:
                    return str(result)
            except Exception:
                continue
    return None


def _instrument_keys(symbols: list[str]) -> dict[str, str]:
    """Map trading symbols to Upstox instrument keys. Never raises."""
    try:
        from api.symbols import _load_instruments

        want = {str(s).upper() for s in symbols}
        out: dict[str, str] = {}
        for inst in _load_instruments():
            sym = inst.get("trading_symbol")
            if sym in want and inst.get("instrument_key"):
                out[sym] = inst["instrument_key"]
        return out
    except Exception:
        return {}


def _ltp_batch(instrument_keys: list[str], token: str):
    """One LTP request; the response or ``None`` on transport failure."""
    try:
        import requests
    except Exception:
        return None
    try:
        return requests.get(
            LTP_URL,
            params={"instrument_key": ",".join(instrument_keys)},
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            timeout=15,
        )
    except Exception as exc:
        log.warning("breakout watch: LTP batch failed (%s)", exc)
        return None


def _ltp_prices(symbols: list[str]) -> dict[str, float]:
    """Batch LTP via Upstox V3 (OAuth). Returns ``{}`` on any failure.

    An expired DB token skips the doomed call outright; on HTTP 401 the
    access token is refreshed once (when a refresh path exists) and the
    failed batch is retried before giving up. Never raises.
    """
    if _upstox_token_expired():
        log.warning("breakout watch: OAuth token expired, skipping LTP (tape fallback)")
        return {}
    token = _token()
    if not token:
        return {}
    keys = _instrument_keys([str(s).upper() for s in symbols])
    if not keys:
        return {}
    reverse = {v: k for k, v in keys.items()}
    out: dict[str, float] = {}
    key_list = list(keys.values())
    refreshed = False
    try:
        i = 0
        while i < len(key_list):
            part = key_list[i : i + 400]
            resp = _ltp_batch(part, token)
            if resp is None:
                i += len(part)
                continue
            if resp.status_code == 401 and not refreshed:
                refreshed = True
                log.warning("breakout watch: LTP token expired (401), attempting refresh")
                new_token = _try_refresh_upstox_token()
                if new_token:
                    token = new_token
                    continue  # retry the same batch with the fresh token
                return out
            if resp.status_code == 401:
                log.warning("breakout watch: LTP token expired (401)")
                return out
            i += len(part)
            if resp.status_code != 200:
                continue
            try:
                data = (resp.json().get("data") or {})
            except Exception:
                continue
            for key, quote in data.items():
                try:
                    px = quote.get("last_price")
                    if px is not None and key in reverse:
                        out[reverse[key]] = float(px)
                except (TypeError, ValueError, AttributeError):
                    continue
    except Exception:
        pass
    return out


def _tape_price(symbol: str, timeframe: str = "1m") -> Optional[float]:
    """Latest close from the market-data tape (API-key auth). Never raises.

    Successful fetches are memoised per ``symbol|timeframe`` for
    ``_TAPE_CACHE_TTL_SECONDS`` so repeated polls (endpoint + CLI watching
    the same names) don't refetch every bar.
    """
    key = f"{str(symbol).upper()}|{timeframe}"
    try:
        now = time.monotonic()
        cached = _TAPE_CACHE.get(key)
        if cached is not None and now - cached[1] < _TAPE_CACHE_TTL_SECONDS:
            return cached[0]
    except Exception:
        now = time.monotonic()
    try:
        from chart_patterns import candles

        df = candles.fetch_for_timeframe(symbol, timeframe)
        if df is not None and not getattr(df, "empty", True):
            price = float(df["close"].iloc[-1])
            try:
                _TAPE_CACHE[key] = (price, now)
            except Exception:
                pass
            return price
    except Exception:
        pass
    return None


def live(rows: list[dict], *, min_rel_volume: float = 1.5) -> list[dict]:
    """Attach live price + rel-volume to armed rows and classify each row.

    ``state`` is ``"triggered"`` when ``ltp > trigger_level`` AND
    ``rel_volume >= min_rel_volume``; a ``fresh``-cross row (armed from a
    fresh ``confirmed`` break) holding above the trigger with unknown volume
    (``rel_volume is None``) is also ``"triggered"`` — the EOD-confirmed
    break plus price holding above the line is the signal when no volume
    measurement arrived. Otherwise ``"invalidated"`` when
    ``ltp < invalidate_level``; else ``"armed"``. Missing LTP symbols fall
    back to the 1m tape via a bounded thread pool (memoised, so repeated
    polls stay cheap). Never raises; a missing price yields ``ltp=None``
    and ``state="armed"``.
    """
    from chart_patterns.tv_prefilter import fetch_tv_volume_metrics

    rows = [dict(r) for r in rows or []]
    symbols = [str(r.get("symbol") or "").upper() for r in rows if r.get("symbol")]
    try:
        prices = _ltp_prices(symbols)
    except Exception:
        prices = {}
    missing = [s for s in symbols if s not in prices]
    if missing:
        try:
            workers = min(_TAPE_WORKERS, len(missing))
            with ThreadPoolExecutor(max_workers=workers) as pool:
                for sym, px in zip(missing, pool.map(_tape_price, missing)):
                    if px is not None:
                        prices[sym] = px
        except Exception as exc:
            log.warning("breakout watch: tape fallback failed (%s)", exc)
    try:
        metrics = fetch_tv_volume_metrics(symbols) if symbols else {}
    except Exception as exc:
        log.warning("breakout watch: TV metrics failed (%s)", exc)
        metrics = {}

    out: list[dict] = []
    for row in rows:
        try:
            sym = str(row.get("symbol") or "").upper()
            ltp = prices.get(sym)
            rel = (metrics.get(sym) or {}).get("rel_volume")
            try:
                rel = float(rel) if rel is not None else None
            except (TypeError, ValueError):
                rel = None
            trigger = row.get("trigger_level")
            invalidate = row.get("invalidate_level")
            try:
                pct = (float(ltp) - float(trigger)) / float(trigger) * 100.0 if ltp is not None and trigger else None
            except (TypeError, ValueError, ZeroDivisionError):
                pct = None
            row["ltp"] = float(ltp) if ltp is not None else None
            row["rel_volume"] = rel
            row["pct_to_trigger"] = round(pct, 2) if pct is not None else None
            above = (
                ltp is not None
                and trigger is not None
                and float(ltp) > float(trigger)
            )
            if above and rel is not None and rel >= float(min_rel_volume):
                row["state"] = "triggered"
            elif above and rel is None and bool(row.get("fresh")):
                # Fresh EOD-confirmed cross holding above the trigger but no
                # volume measurement arrived: the break itself is the signal.
                row["state"] = "triggered"
            elif ltp is not None and invalidate is not None and float(ltp) < float(invalidate):
                row["state"] = "invalidated"
            else:
                row["state"] = "armed"
        except Exception:
            row.setdefault("ltp", None)
            row.setdefault("rel_volume", None)
            row.setdefault("pct_to_trigger", None)
            row["state"] = "armed"
        out.append(row)
    return out
