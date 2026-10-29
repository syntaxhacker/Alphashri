#!/usr/bin/env python3
"""Read-only Upstox option-contract resolver with a disk cache.

Resolves an option ``instrument_key`` for ``(underlying, expiry, strike, opt)``
via ``GET /v2/option/contract`` and caches the full contract list per expiry
**and underlying** under ``experiments/data/instruments_cache/`` so repeated
lookups (and the stale local ``instruments`` table, which has 0 rows for the
current expiry) don't need a network round-trip.

The cache file is ``<UNDERLYING>_<expiry>.json`` (``NIFTY_2026-10-27.json``,
``BANKNIFTY_2026-10-27.json``) and every cached row is stamped with the
underlying it was fetched for, so a BANKNIFTY lookup can never be served a
NIFTY key.

Read-only by construction: only HTTP GETs, cache writes go to
``experiments/data/`` (never the DB). Requests go through the shared Upstox
rate limiter (``scripts.upstox_rate``).

Usage:
    .venv/bin/python scripts/upstox_contract.py --expiry 2026-10-27 --strike 23000 --opt CE
    .venv/bin/python scripts/upstox_contract.py --expiry 2026-10-27 --strike 23000 --opt PE --chain-fallback
    .venv/bin/python scripts/upstox_contract.py --expiry 2026-10-27 --strike 23000 --opt CE --json
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import upstox_common  # noqa: E402
from scripts.upstox_common import as_float as _as_float  # noqa: E402
from scripts.upstox_common import data as _data  # noqa: E402

BASE_URL = upstox_common.BASE_V2
NIFTY_KEY = "NSE_INDEX|Nifty 50"

CACHE_DIR = ROOT / "experiments" / "data" / "instruments_cache"

#: Well-known index underlyings → the short name used in cache filenames.
#: The short name is ONLY a filename token; the row-level stamp below keeps
#: the full instrument key, so two underlyings can never share a cache entry.
UNDERLYING_NAMES = {
    NIFTY_KEY: "NIFTY",
    "NSE_INDEX|Bank Nifty": "BANKNIFTY",
    "NSE_INDEX|Nifty Fin Service": "FINNIFTY",
    "NSE_INDEX|Nifty Midcap Select": "MIDCPNIFTY",
}


def underlying_name(underlying: str) -> str:
    """Short, filesystem-safe name for an underlying key (``NIFTY``, ...).

    Unknown underlyings fall back to the sanitised raw key, so an unknown
    underlying still gets its OWN cache file instead of sharing NIFTY's.
    """
    key = str(underlying or "").strip()
    known = UNDERLYING_NAMES.get(key)
    if known:
        return known
    safe = "".join(c if (c.isalnum() or c in "-_") else "_" for c in key)
    return safe or "UNKNOWN"


def _same_underlying(a, b) -> bool:
    """Case/whitespace-insensitive underlying comparison."""
    return str(a or "").strip().upper() == str(b or "").strip().upper()


# ---------------------------------------------------------------------------
# pure helpers (unit-tested, no network)
# ---------------------------------------------------------------------------
def _norm_opt(opt: str | None) -> str | None:
    if opt is None:
        return None
    text = str(opt).strip().upper()
    if text in ("CE", "C", "CALL"):
        return "CE"
    if text in ("PE", "P", "PUT"):
        return "PE"
    return None


def parse_contract_payload(payload, underlying: str | None = None) -> list[dict]:
    """Normalise ``GET /option/contract`` → ``[{instrument_key, strike, opt, expiry, ...}]``.

    Malformed rows are skipped. Tolerates both enveloped and bare payloads.
    When ``underlying`` is given every row is stamped with it, so a cached
    row can be traced back to the underlying it was fetched for.
    """
    data = _data(payload)
    if not isinstance(data, list):
        return []
    out: list[dict] = []
    for row in data:
        if not isinstance(row, dict):
            continue
        key = row.get("instrument_key")
        strike = _as_float(row.get("strike_price", row.get("strike")))
        opt = _norm_opt(row.get("instrument_type", row.get("option_type")))
        if not key or strike is None or opt is None:
            continue
        out.append(
            {
                "instrument_key": str(key),
                "strike": strike,
                "opt": opt,
                "expiry": str(row.get("expiry", "")),
                "underlying": str(underlying) if underlying else "",
                "trading_symbol": str(row.get("trading_symbol", "")),
                "lot_size": row.get("lot_size"),
                "tick_size": row.get("tick_size"),
            }
        )
    return out


def find_contract(contracts: list[dict], strike: float, opt: str,
                  underlying: str | None = None) -> dict | None:
    """Exact strike + side match (float-tolerant). Returns the row or None.

    When ``underlying`` is given, rows stamped with a DIFFERENT underlying are
    skipped — a BANKNIFTY lookup can never return a NIFTY key.
    """
    want = _norm_opt(opt)
    target = _as_float(strike)
    if want is None or target is None:
        return None
    for row in contracts or []:
        if not isinstance(row, dict):
            continue
        if underlying is not None:
            stamp = row.get("underlying")
            if stamp and not _same_underlying(stamp, underlying):
                continue
        if _norm_opt(row.get("opt")) != want:
            continue
        got = _as_float(row.get("strike"))
        if got is None:
            continue
        if abs(got - target) < 1e-9:
            return row
    return None


def parse_chain_payload(payload, underlying: str | None = None) -> list[dict]:
    """Normalise ``GET /option/chain`` rows into the same contract-row shape.

    Each chain row yields up to two rows (call → CE, put → PE) carrying the
    row's ``strike_price``/``expiry`` and each leg's ``instrument_key``.
    """
    data = _data(payload)
    if not isinstance(data, list):
        return []
    out: list[dict] = []
    for row in data:
        if not isinstance(row, dict):
            continue
        strike = _as_float(row.get("strike_price", row.get("strike")))
        if strike is None:
            continue
        expiry = str(row.get("expiry", ""))
        chain_underlying = str(underlying or row.get("underlying_key") or "")
        for leg_key, opt in (("call_options", "CE"), ("put_options", "PE")):
            leg = row.get(leg_key)
            if not isinstance(leg, dict):
                continue
            key = leg.get("instrument_key")
            if not key:
                continue
            out.append(
                {
                    "instrument_key": str(key),
                    "strike": strike,
                    "opt": opt,
                    "expiry": expiry,
                    "underlying": chain_underlying,
                    "trading_symbol": str(leg.get("trading_symbol", "")),
                    "lot_size": leg.get("lot_size"),
                    "tick_size": leg.get("tick_size"),
                }
            )
    return out


def cache_path(expiry: str, cache_dir: pathlib.Path | str = CACHE_DIR,
               underlying: str = NIFTY_KEY) -> pathlib.Path:
    """Cache file for one expiry+underlying: ``<UNDERLYING>_<YYYY-MM-DD>.json``.

    The underlying is part of the filename: a BANKNIFTY chain must never be
    served out of the NIFTY cache file.
    """
    safe = "".join(c if (c.isalnum() or c in "-_") else "_" for c in str(expiry))
    return pathlib.Path(cache_dir) / f"{underlying_name(underlying)}_{safe}.json"


def load_cached_contracts(
    expiry: str, cache_dir: pathlib.Path | str = CACHE_DIR,
    underlying: str = NIFTY_KEY,
) -> list[dict] | None:
    """Read cached contract rows for ``expiry``/``underlying``; None when missing/corrupt.

    The cached file must have been written for the SAME underlying: a
    mismatch (a hand-copied or stale file) is treated as a cache miss, not as
    a hit.
    """
    path = cache_path(expiry, cache_dir, underlying)
    try:
        with open(path, encoding="utf-8") as fh:
            payload = json.load(fh)
    except (OSError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    cached_underlying = payload.get("underlying")
    if cached_underlying and not _same_underlying(cached_underlying, underlying):
        return None
    rows = payload.get("contracts")
    if not isinstance(rows, list) or not rows:
        return None
    for row in rows:
        if not isinstance(row, dict):
            return None
        stamp = row.get("underlying")
        if stamp and not _same_underlying(stamp, underlying):
            return None
    return rows


def save_cached_contracts(
    expiry: str,
    contracts: list[dict],
    cache_dir: pathlib.Path | str = CACHE_DIR,
    underlying: str = NIFTY_KEY,
) -> pathlib.Path:
    """Persist contract rows for ``expiry``/``underlying`` (creates the cache dir)."""
    path = cache_path(expiry, cache_dir, underlying)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"expiry": expiry, "underlying": str(underlying),
               "saved_at": dt.datetime.now(dt.timezone.utc).isoformat(),
               "contracts": contracts}
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh)
    return path


# ---------------------------------------------------------------------------
# live sources (network, read-only)
# ---------------------------------------------------------------------------
def _get(path: str, params: dict, timeout: float):
    return upstox_common.get(path, params, timeout)


def fetch_contracts(underlying: str, expiry: str, timeout: float = 10.0) -> list[dict]:
    """GET /option/contract → normalised rows (may be empty for a bad expiry)."""
    raw = _get(
        "/option/contract",
        {"instrument_key": underlying, "expiry_date": expiry},
        timeout,
    )
    return parse_contract_payload(raw, underlying=underlying)


def fetch_chain_contracts(underlying: str, expiry: str, timeout: float = 10.0) -> list[dict]:
    """GET /option/chain → normalised rows (chain legs carry instrument keys)."""
    raw = _get(
        "/option/chain",
        {"instrument_key": underlying, "expiry_date": expiry},
        timeout,
    )
    return parse_chain_payload(raw, underlying=underlying)


def resolve_option_key(
    expiry: str,
    strike: float,
    opt: str,
    underlying: str = NIFTY_KEY,
    cache_dir: pathlib.Path | str = CACHE_DIR,
    use_cache: bool = True,
    chain_fallback: bool = False,
    timeout: float = 10.0,
) -> tuple[str | None, str]:
    """Resolve ``(expiry, strike, opt)`` → ``(instrument_key, source)``.

    Source is one of ``"cache"`` / ``"contract"`` / ``"chain"``; the key is
    None when nothing matched (with ``"chain"``/``"contract"``/``"cache"``
    reporting the last source consulted). The cache is per-underlying, and
    every row is verified against ``underlying`` before it can match.
    """
    if use_cache:
        cached = load_cached_contracts(expiry, cache_dir, underlying) or []
        hit = find_contract(cached, strike, opt, underlying=underlying)
        if hit is not None:
            return hit["instrument_key"], "cache"
    contracts = fetch_contracts(underlying, expiry, timeout)
    if contracts:
        save_cached_contracts(expiry, contracts, cache_dir, underlying)
    hit = find_contract(contracts, strike, opt, underlying=underlying)
    if hit is not None:
        return hit["instrument_key"], "contract"
    if chain_fallback:
        chained = fetch_chain_contracts(underlying, expiry, timeout)
        hit = find_contract(chained, strike, opt, underlying=underlying)
        if hit is not None:
            return hit["instrument_key"], "chain"
        return None, "chain"
    return None, "contract"


# ---------------------------------------------------------------------------
# cli
# ---------------------------------------------------------------------------
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="upstox_contract",
        description="Resolve an option instrument key (read-only, cached per expiry).",
    )
    ap.add_argument("--expiry", required=True, help="expiry date YYYY-MM-DD")
    ap.add_argument("--strike", required=True, type=float, help="strike price")
    ap.add_argument("--opt", required=True, help="CE or PE")
    ap.add_argument("--underlying", default=NIFTY_KEY, help=f"underlying key (default {NIFTY_KEY})")
    ap.add_argument("--chain-fallback", action="store_true", help="fall back to /option/chain when /option/contract lacks the strike")
    ap.add_argument("--no-cache", action="store_true", help="skip the disk cache (always hit the API)")
    ap.add_argument("--refresh", action="store_true", help="ignore cache, refetch and rewrite it")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of the bare key")
    ap.add_argument("--timeout", type=float, default=10.0)
    args = ap.parse_args(argv)

    try:
        dt.date.fromisoformat(args.expiry)
    except ValueError:
        ap.error("--expiry must be YYYY-MM-DD")
    if _norm_opt(args.opt) is None:
        ap.error("--opt must be CE or PE")

    try:
        key, source = resolve_option_key(
            args.expiry,
            args.strike,
            args.opt,
            underlying=args.underlying,
            use_cache=not (args.no_cache or args.refresh),
            chain_fallback=args.chain_fallback,
            timeout=args.timeout,
        )
    except Exception as exc:  # noqa: BLE001 — CLI reports, never tracebacks
        print(f"error: {type(exc).__name__}: {exc}")
        return 2
    if key is None:
        print(f"not found: {args.underlying} {args.expiry} {args.strike:g} {_norm_opt(args.opt)} (via {source})")
        return 1
    if args.json:
        print(json.dumps({"instrument_key": key, "source": source, "expiry": args.expiry,
                           "strike": args.strike, "opt": _norm_opt(args.opt)}))
    else:
        print(key)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
