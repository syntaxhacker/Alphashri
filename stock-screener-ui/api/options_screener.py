"""F&O momentum screener: OTM call picks across the NSE stock F&O universe.

The screener builds one raw snapshot per expiry (momentum + chain candidates)
and applies presets/user filters on top of it, so a preset switch is a pure
in-memory pass. Chain and daily momentum are cached separately because they
change on very different timescales.

All upstream access goes through :func:`api.options.fetch_upstox`, so the same
token resolution / timeout policy applies here as everywhere else.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import time
import urllib.parse
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query

import config
from api.options import fetch_upstox, get_instrument_key

logger = logging.getLogger("options_screener")

router = APIRouter(prefix="/api/options", tags=["options-screener"])

INSTRUMENTS_TTL_SEC = 3600.0
CHAIN_TTL_SEC = 300.0
MOMENTUM_TTL_SEC = 3600.0
SNAPSHOT_TTL_SEC = 120.0

CHAIN_CONCURRENCY = 6
CANDLE_CONCURRENCY = 8

DAILY_LOOKBACK_DAYS = 92
MAX_LOT_COST = 15_000.0
MIN_PREMIUM = 0.02
MIN_OI = 50_000.0
MIN_OPTION_VOLUME = 10_000.0
MAX_SPREAD_PCT = 8.0
MIN_DELTA = 0.03
MIN_POP = 3.0

_CANDIDATES = ("cheap_momentum", "max_torque", "balanced", "high_pop", "breakout")

#: Presets define the inclusion rules; explicit request params replace the
#: matching preset value (so `max_cost=4000` can loosen cheap_momentum's 3000
#: cap instead of being silently clipped by it).
PRESETS: dict[str, dict] = {
    "cheap_momentum": {
        "max_cost": 3000.0,
        "min_pop": 8.0,
        "d1_min": 0.0,
        "d5_min": 4.0,
        "vol_ratio_min": 1.1,
        "exclude_setups": ("WEAK",),
        "sort": (("move_2pct_est", True),),
    },
    "max_torque": {
        "max_cost": 5000.0,
        "min_pop": 5.0,
        "d1_strict": True,
        "d5_strict": True,
        "sort": (("move_2pct_est", True),),
    },
    "balanced": {
        "max_cost": 10_000.0,
        "min_pop": 12.0,
        "d1_strict": True,
        "d5_strict": True,
        "sort": (("pop", True), ("move_2pct_est", True)),
    },
    "high_pop": {
        "max_cost": 15_000.0,
        "min_pop": 20.0,
        "sort": (("pop", True),),
    },
    "breakout": {
        "max_cost": 10_000.0,
        "min_pop": 0.0,
        "d1_strict": True,
        "vol_ratio_min": 1.1,
        "near_high": True,
        "sort": (("move_2pct_est", True),),
    },
}

_INSTRUMENTS_CACHE: dict = {"ts": 0.0, "data": None}
_CHAIN_CACHE: dict[tuple[str, str], tuple[float, dict]] = {}
_MOMENTUM_CACHE: dict[str, tuple[float, dict]] = {}
_SNAPSHOT_CACHE: dict[str, tuple[float, dict]] = {}


def _f(value, default: float = 0.0) -> float:
    if value is None or isinstance(value, bool):
        return default
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    return out if math.isfinite(out) else default


def _today() -> date:
    return datetime.now(config.IST).date()


def _instruments_path():
    from pathlib import Path

    return (
        Path(config.BASE_DIR).parent
        / "upstox_trader"
        / "config_and_utils"
        / "nse_instruments.json"
    )


def _expiry_from_ms(value) -> str | None:
    try:
        ms = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(ms) or ms <= 0:
        return None
    try:
        return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).date().isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def parse_instruments(raw) -> list[dict]:
    """Keep the NSE_FO equity CE contracts we need (universe, expiries, lots)."""
    out: list[dict] = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        if item.get("segment") != "NSE_FO":
            continue
        if item.get("asset_type") != "EQUITY":
            continue
        if item.get("instrument_type") != "CE":
            continue
        expiry = _expiry_from_ms(item.get("expiry"))
        if not expiry:
            continue
        symbol = str(
            item.get("underlying_symbol") or item.get("asset_symbol") or ""
        ).strip().upper()
        if not symbol:
            continue
        out.append(
            {
                "symbol": symbol,
                "underlying_key": item.get("underlying_key") or item.get("asset_key"),
                "expiry": expiry,
                "lot_size": int(_f(item.get("lot_size"))),
                "strike": _f(item.get("strike_price")),
                "instrument_type": "CE",
            }
        )
    return out


def load_contracts(force: bool = False) -> list[dict]:
    """Parse the 43 MB instruments file once per hour."""
    now = time.monotonic()
    cached = _INSTRUMENTS_CACHE.get("data")
    if (
        not force
        and cached is not None
        and now - _INSTRUMENTS_CACHE.get("ts", 0.0) < INSTRUMENTS_TTL_SEC
    ):
        return cached
    raw = json.loads(_instruments_path().read_text(encoding="utf-8"))
    parsed = parse_instruments(raw)
    _INSTRUMENTS_CACHE["data"] = parsed
    _INSTRUMENTS_CACHE["ts"] = now
    return parsed


def list_expiries(contracts: list[dict], today: date) -> list[str]:
    floor = today.isoformat()
    dates = {
        c["expiry"]
        for c in contracts
        if c.get("expiry") and c["expiry"] >= floor
    }
    return sorted(dates)


def universe_for_expiry(contracts: list[dict], expiry: str) -> dict[str, dict]:
    """symbol -> {underlying_key, lot_size} for one expiry."""
    universe: dict[str, dict] = {}
    for c in contracts:
        if c.get("expiry") != expiry:
            continue
        symbol = c.get("symbol")
        if not symbol:
            continue
        entry = universe.get(symbol)
        if entry is None:
            universe[symbol] = {
                "underlying_key": c.get("underlying_key"),
                "lot_size": c.get("lot_size") or 0,
            }
        elif not entry.get("lot_size") and c.get("lot_size"):
            entry["lot_size"] = c["lot_size"]
    return universe


def classify_setup(
    last: float,
    hi20: float,
    vol_ratio: float,
    d5: float,
    above20: float,
    d1: float | None = None,
) -> str:
    if hi20 > 0 and last >= 0.995 * hi20 and vol_ratio >= 1.1:
        return "BREAKOUT"
    if hi20 > 0 and last >= 0.98 * hi20:
        return "NEAR HIGH"
    if d5 > 12.0 or above20 > 15.0:
        return "EXTENDED"
    if abs(above20) <= 3.0 and vol_ratio < 1.1:
        return "BASE"
    if d1 is not None and d1 < 0 and d5 < 0:
        return "WEAK"
    return "WATCH"


def momentum_from_candles(candles) -> dict | None:
    """Momentum block from chronological daily candles [ts,o,h,l,c,v,...]."""
    rows: list[tuple[float, float, float]] = []
    for candle in candles or []:
        if not isinstance(candle, (list, tuple)) or len(candle) < 5:
            continue
        high = _f(candle[2])
        close = _f(candle[4])
        volume = _f(candle[5]) if len(candle) > 5 else 0.0
        if close <= 0:
            continue
        rows.append((high if high > 0 else close, close, max(volume, 0.0)))
    if len(rows) < 2:
        return None

    closes = [r[1] for r in rows]
    highs = [r[0] for r in rows]
    volumes = [r[2] for r in rows]
    last = closes[-1]

    d1 = (last / closes[-2] - 1.0) * 100.0
    if len(closes) >= 6:
        d5 = (last / closes[-6] - 1.0) * 100.0
    else:
        d5 = (last / closes[0] - 1.0) * 100.0

    window = closes[-20:]
    hi20 = max(highs[-20:])
    sma20 = sum(window) / len(window)
    previous_volumes = volumes[-21:-1] or volumes[:-1]
    avg_volume = (
        sum(previous_volumes) / len(previous_volumes) if previous_volumes else 0.0
    )
    vol_ratio = volumes[-1] / avg_volume if avg_volume > 0 else 0.0
    above20 = (last / sma20 - 1.0) * 100.0 if sma20 > 0 else 0.0

    d1 = 0.0 if not math.isfinite(d1) else d1
    d5 = 0.0 if not math.isfinite(d5) else d5
    above20 = 0.0 if not math.isfinite(above20) else above20

    setup = classify_setup(last, hi20, vol_ratio, d5, above20, d1)

    return {
        "last": last,
        "d1": d1,
        "d5": d5,
        "hi20": hi20,
        "sma20": sma20,
        "avg_volume": avg_volume,
        "vol_ratio": vol_ratio,
        "above20": above20,
        "setup": setup,
    }


def move_2pct_est(delta: float, gamma: float, spot: float, premium: float) -> float:
    if premium <= 0:
        return 0.0
    move = 0.02 * spot
    est = (delta * move + 0.5 * gamma * move * move) / premium * 100.0
    if not math.isfinite(est):
        return 0.0
    return max(0.0, min(500.0, est))


def spread_pct(bid: float, ask: float) -> float | None:
    mid = (bid + ask) / 2.0
    if mid <= 0:
        return None
    return (ask - bid) / mid * 100.0


def parse_chain(payload) -> dict:
    """Flatten an Upstox /option/chain payload to {spot, calls:[...]}."""
    data = payload or {}
    contracts = data.get("data") or []
    spot = _f(data.get("underlying_spot_price"))
    if spot <= 0 and contracts:
        spot = _f((contracts[0] or {}).get("underlying_spot_price"))

    calls: list[dict] = []
    for item in contracts:
        if not isinstance(item, dict):
            continue
        call = item.get("call_options") or {}
        market = call.get("market_data") or {}
        greeks = call.get("option_greeks") or {}
        strike = _f(item.get("strike_price"))
        if strike <= 0:
            continue
        calls.append(
            {
                "strike": strike,
                "ltp": _f(market.get("ltp")),
                "bid": _f(market.get("bid_price")),
                "ask": _f(market.get("ask_price")),
                "oi": _f(market.get("oi")),
                "volume": _f(market.get("volume")),
                "delta": _f(greeks.get("delta")),
                "gamma": _f(greeks.get("gamma")),
                "theta": _f(greeks.get("theta")),
                "vega": _f(greeks.get("vega")),
                "iv": _f(greeks.get("iv")),
                "pop": _f(greeks.get("pop")),
            }
        )
    return {"spot": spot, "calls": calls}


def build_candidates(
    symbol: str,
    momentum: dict,
    chain: dict,
    lot_size: int,
    *,
    otm_min: float = 2.0,
    otm_max: float = 10.0,
    max_cost: float = MAX_LOT_COST,
) -> list[dict]:
    spot = _f(chain.get("spot")) or _f(momentum.get("last"))
    lot = int(lot_size or 0)
    if spot <= 0 or lot <= 0:
        return []

    rows: list[dict] = []
    for call in chain.get("calls") or []:
        strike = _f(call.get("strike"))
        if strike <= 0:
            continue
        otm = (strike - spot) / spot * 100.0
        if otm < otm_min or otm > otm_max:
            continue

        premium = _f(call.get("ltp"))
        if premium <= MIN_PREMIUM:
            continue
        cost = premium * lot
        if cost > max_cost:
            continue

        oi = _f(call.get("oi"))
        volume = _f(call.get("volume"))
        if oi < MIN_OI or volume < MIN_OPTION_VOLUME:
            continue

        bid = _f(call.get("bid"))
        ask = _f(call.get("ask"))
        spread = spread_pct(bid, ask)
        if spread is None or spread > MAX_SPREAD_PCT:
            continue

        delta = _f(call.get("delta"))
        gamma = _f(call.get("gamma"))
        pop = _f(call.get("pop"))
        if delta < MIN_DELTA or pop < MIN_POP:
            continue

        rows.append(
            {
                "symbol": symbol,
                "spot": round(spot, 2),
                "d1": round(_f(momentum.get("d1")), 2),
                "d5": round(_f(momentum.get("d5")), 2),
                "vol_ratio": round(_f(momentum.get("vol_ratio")), 2),
                "above20": round(_f(momentum.get("above20")), 2),
                "setup": momentum.get("setup") or "WATCH",
                "call": f"{strike:g} CE",
                "strike": round(strike, 2),
                "otm_pct": round(otm, 2),
                "premium": round(premium, 2),
                "cost_lot": int(round(cost)),
                "breakeven": round(strike + premium, 2),
                "pop": round(pop, 1),
                "delta": round(delta, 3),
                "gamma": round(gamma, 3),
                "theta": round(_f(call.get("theta")), 3),
                "vega": round(_f(call.get("vega")), 3),
                "iv": round(_f(call.get("iv")), 1),
                "oi": int(oi),
                "volume": int(volume),
                "spread_pct": round(spread, 1),
                "move_2pct_est": round(move_2pct_est(delta, gamma, spot, premium), 1),
                # Internal only: breakout preset compares spot against hi20.
                "_hi20": _f(momentum.get("hi20")),
            }
        )
    return rows


def apply_preset(
    rows: list[dict],
    preset: str,
    *,
    max_cost: float | None = None,
    min_pop: float | None = None,
    min_volume: float | None = None,
) -> list[dict]:
    cfg = PRESETS[preset]
    cost_cap = cfg.get("max_cost", MAX_LOT_COST) if max_cost is None else max_cost
    pop_floor = cfg.get("min_pop", 0.0) if min_pop is None else min_pop
    volume_floor = 0.0 if min_volume is None else min_volume

    kept: list[dict] = []
    for row in rows:
        if _f(row.get("cost_lot")) > cost_cap:
            continue
        if _f(row.get("pop")) < pop_floor:
            continue
        if _f(row.get("volume")) < volume_floor:
            continue
        if "d1_min" in cfg and _f(row.get("d1")) < cfg["d1_min"]:
            continue
        if cfg.get("d1_strict") and _f(row.get("d1")) <= 0:
            continue
        if "d5_min" in cfg and _f(row.get("d5")) < cfg["d5_min"]:
            continue
        if cfg.get("d5_strict") and _f(row.get("d5")) <= 0:
            continue
        if "vol_ratio_min" in cfg and _f(row.get("vol_ratio")) < cfg["vol_ratio_min"]:
            continue
        if cfg.get("exclude_setups") and row.get("setup") in cfg["exclude_setups"]:
            continue
        if cfg.get("near_high"):
            hi20 = _f(row.get("_hi20"))
            if hi20 <= 0 or _f(row.get("spot")) < 0.98 * hi20:
                continue
        kept.append(row)

    sort_keys = cfg.get("sort") or ()
    if sort_keys:
        kept.sort(
            key=lambda r: tuple(_f(r.get(k)) for k, _ in sort_keys),
            reverse=True,
        )
    return kept


def public_row(row: dict) -> dict:
    return {k: v for k, v in row.items() if not k.startswith("_")}


def _empty_response(
    expiry: str | None,
    expiries: list[dict],
    preset: str,
    errors: list,
    warnings: list,
) -> dict:
    return {
        "status": "ok",
        "as_of": datetime.now(config.IST).isoformat(),
        "expiry": expiry or "",
        "expiries": expiries,
        "preset": preset,
        "scanned": 0,
        "matched": 0,
        "stale": False,
        "warnings": warnings,
        "rows": [],
        "errors": errors,
    }


async def _get_chain(
    symbol: str,
    instrument_key: str,
    expiry: str,
    *,
    force: bool,
    sem: asyncio.Semaphore,
) -> dict:
    cache_key = (symbol, expiry)
    now = time.monotonic()
    if not force:
        cached = _CHAIN_CACHE.get(cache_key)
        if cached and now - cached[0] < CHAIN_TTL_SEC:
            return cached[1]

    async with sem:
        payload = await fetch_upstox(
            "/option/chain",
            {"instrument_key": instrument_key, "expiry_date": expiry},
        )
    parsed = parse_chain(payload)
    _CHAIN_CACHE[cache_key] = (time.monotonic(), parsed)
    return parsed


def _daily_candle_endpoint(instrument_key: str, today: date) -> str:
    encoded = urllib.parse.quote(instrument_key, safe="")
    start = today - timedelta(days=DAILY_LOOKBACK_DAYS)
    return (
        f"/historical-candle/{encoded}/day/{today.isoformat()}/{start.isoformat()}"
    )


async def _get_momentum(
    symbol: str,
    instrument_key: str,
    *,
    force: bool,
    sem: asyncio.Semaphore,
) -> dict | None:
    now = time.monotonic()
    if not force:
        cached = _MOMENTUM_CACHE.get(symbol)
        if cached and now - cached[0] < MOMENTUM_TTL_SEC:
            return cached[1]

    endpoint = _daily_candle_endpoint(instrument_key, _today())
    async with sem:
        payload = await fetch_upstox(endpoint)

    data = (payload or {}).get("data") or {}
    candles = data.get("candles") or []
    # Upstox v2 returns newest-first; momentum reads chronological.
    if isinstance(candles, list):
        candles = list(reversed(candles))
    momentum = momentum_from_candles(candles)
    if momentum is None:
        return None
    _MOMENTUM_CACHE[symbol] = (time.monotonic(), momentum)
    return momentum


async def _build_snapshot(
    expiry: str,
    contracts: list[dict],
    *,
    force: bool,
) -> dict:
    universe = universe_for_expiry(contracts, expiry)
    symbols = list(universe)
    chain_sem = asyncio.Semaphore(CHAIN_CONCURRENCY)
    candle_sem = asyncio.Semaphore(CANDLE_CONCURRENCY)
    errors: list[dict] = []
    error_lock = asyncio.Lock()

    # A dead token must fail once, not fan out into 200+ upstream 401s.
    if symbols:
        first = symbols[0]
        first_info = universe.get(first) or {}
        first_key = first_info.get("underlying_key")
        if first_key:
            try:
                await _get_chain(
                    first, first_key, expiry, force=force, sem=chain_sem
                )
            except HTTPException as exc:
                if exc.status_code in (401, 403):
                    return {
                        "as_of": datetime.now(config.IST).isoformat(),
                        "scanned": len(symbols),
                        "rows": [],
                        "errors": [
                            {
                                "symbol": "",
                                "stage": "auth",
                                "error": str(exc.detail)[:160],
                            }
                        ],
                        "warnings": ["Upstox token expired or invalid — reconnect the broker"],
                    }
                raise

    async def one(symbol: str) -> list[dict]:
        info = universe.get(symbol) or {}
        instrument_key = info.get("underlying_key")
        if not instrument_key:
            instrument_key = await asyncio.to_thread(get_instrument_key, symbol)
        try:
            chain, momentum = await asyncio.gather(
                _get_chain(
                    symbol, instrument_key, expiry, force=force, sem=chain_sem
                ),
                _get_momentum(symbol, instrument_key, force=force, sem=candle_sem),
            )
        except Exception as exc:  # noqa: BLE001 - one bad symbol must not kill the scan
            async with error_lock:
                errors.append(
                    {
                        "symbol": symbol,
                        "stage": "fetch",
                        "error": f"{type(exc).__name__}: {str(exc)[:160]}",
                    }
                )
            return []
        if not chain or not momentum:
            return []
        # Snapshot keeps every OTM call; the request's otm_min/otm_max are
        # applied per request so widening them does not force a rebuild.
        return build_candidates(
            symbol,
            momentum,
            chain,
            int(info.get("lot_size") or 0),
            otm_min=0.0,
            otm_max=100.0,
        )

    results = await asyncio.gather(*(one(symbol) for symbol in symbols))
    rows = [row for part in results for row in part]
    warnings: list[str] = []
    if errors:
        warnings.append(f"{len(errors)} of {len(symbols)} symbols failed to fetch")

    return {
        "as_of": datetime.now(config.IST).isoformat(),
        "scanned": len(symbols),
        "rows": rows,
        "errors": errors[:50],
        "warnings": warnings,
    }


@router.get("/screener")
async def get_options_screener(
    expiry: str | None = Query(None, description="Expiry YYYY-MM-DD (nearest by default)"),
    preset: str = Query("cheap_momentum", description="|".join(_CANDIDATES)),
    limit: int = Query(100, ge=1, le=500),
    max_cost: float | None = Query(None, ge=0, description="Max cost per lot (₹)"),
    min_pop: float | None = Query(None, description="Min probability of profit (%)"),
    min_volume: float | None = Query(None, ge=0, description="Min option volume"),
    otm_min: float = Query(2.0, ge=0, description="Min OTM %"),
    otm_max: float = Query(10.0, ge=0, description="Max OTM %"),
    refresh: bool = Query(False, description="Bypass snapshot/chain/momentum caches"),
):
    """Rank OTM calls on the NSE stock F&O universe by momentum and torque."""
    if preset not in PRESETS:
        raise HTTPException(
            status_code=400,
            detail=f"unknown preset {preset!r}, want one of {list(PRESETS)}",
        )
    if otm_min > otm_max:
        raise HTTPException(
            status_code=400, detail="otm_min must be <= otm_max"
        )

    today = _today()
    if expiry:
        try:
            expiry = datetime.strptime(expiry, "%Y-%m-%d").date().isoformat()
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=400,
                detail=f"bad expiry: {expiry!r}, want YYYY-MM-DD",
            )

    try:
        contracts = await asyncio.to_thread(load_contracts)
    except Exception as exc:  # noqa: BLE001 - missing file must not 500
        logger.warning("options screener: instruments unavailable: %s", exc)
        return _empty_response(
            expiry,
            [],
            preset,
            [{"symbol": "", "stage": "instruments", "error": str(exc)[:160]}],
            ["F&O instrument file unavailable"],
        )

    expiry_dates = list_expiries(contracts, today)
    expiries = [
        {
            "date": d,
            "days_to_expiry": (date.fromisoformat(d) - today).days,
        }
        for d in expiry_dates
    ]
    if not expiry_dates:
        return _empty_response(
            expiry, expiries, preset, [], ["no listed F&O expiries"]
        )

    if expiry is None:
        expiry = expiry_dates[0]
    elif expiry not in expiry_dates:
        raise HTTPException(
            status_code=400,
            detail=f"expiry {expiry} is not listed; available: {expiry_dates}",
        )

    cached = _SNAPSHOT_CACHE.get(expiry)
    stale = False
    warnings: list[str] = []
    fresh_cache = (
        not refresh
        and cached is not None
        and time.monotonic() - cached[0] < SNAPSHOT_TTL_SEC
    )

    if fresh_cache:
        snapshot = cached[1]
    else:
        try:
            built = await _build_snapshot(expiry, contracts, force=refresh)
            # An empty rebuild with an older snapshot is a refresh failure, not
            # a real market state — keep the last good scan.
            if not built["rows"] and cached is not None and built["errors"]:
                raise RuntimeError("refresh returned no rows")
            snapshot = built
            _SNAPSHOT_CACHE[expiry] = (time.monotonic(), snapshot)
        except Exception as exc:  # noqa: BLE001 - transient upstream failure
            logger.warning("options screener: snapshot build failed: %s", exc)
            if cached is not None:
                snapshot = cached[1]
                stale = True
                warnings.append(
                    "refresh failed "
                    f"({type(exc).__name__}: {str(exc)[:120]}); serving cached snapshot"
                )
            else:
                return _empty_response(
                    expiry,
                    expiries,
                    preset,
                    [{"symbol": "", "stage": "snapshot", "error": str(exc)[:160]}],
                    ["snapshot build failed"],
                )

    matched_rows = apply_preset(
        [
            row
            for row in snapshot["rows"]
            if otm_min <= _f(row.get("otm_pct")) <= otm_max
        ],
        preset,
        max_cost=max_cost,
        min_pop=min_pop,
        min_volume=min_volume,
    )
    matched = len(matched_rows)
    rows = [public_row(r) for r in matched_rows[:limit]]

    return {
        "status": "ok",
        "as_of": snapshot["as_of"],
        "expiry": expiry,
        "expiries": expiries,
        "preset": preset,
        "scanned": snapshot["scanned"],
        "matched": matched,
        "stale": stale,
        "warnings": list(snapshot.get("warnings") or []) + warnings,
        "rows": rows,
        "errors": snapshot.get("errors") or [],
    }
