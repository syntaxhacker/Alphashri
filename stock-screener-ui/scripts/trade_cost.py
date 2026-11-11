#!/usr/bin/env python3
"""Read-only Upstox margin + charges probe for a proposed NIFTY option order.

Computes the EXACT broker margin and round-trip charges for a proposed order
via Upstox's read-only charge calculators and compares them with the local
estimate (``options_paper/costs.py: option_round_trip_cost``).

Read-only: this script only calls read-only Upstox endpoints (option chain /
contracts for resolution, /charges/brokerage and /charges/margin calculators).
It NEVER places, modifies, or cancels orders, and it never writes to the
database (the local instruments table is only a fallback, read via a
read-only SQLite URI).

Upstox docs:
  chain     https://upstox.com/developer/api-documentation/get-pc-option-chain
  contracts https://upstox.com/developer/api-documentation/get-option-contracts
  margin    https://upstox.com/developer/api-documentation/margin
  brokerage https://upstox.com/developer/api-documentation/get-brokerage

Example:
  .venv/bin/python scripts/trade_cost.py \\
      --opt CE --strike 23000 --expiry 2026-10-27 \\
      --side SELL --qty 65 --price 70.45 --exit-price 55.20 --product I

``--exit-price`` is the premium the closing leg is expected to trade at.
Without it the round trip is priced FLAT (entry premium for both legs) and
the output says so — the local cost model and the broker's calculators then
both see a buy/sell at the same premium.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any, Optional

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from options_paper.costs import option_round_trip_cost  # noqa: E402
from options_paper.spec import option_symbol  # noqa: E402
from scripts import desk_common  # noqa: E402
from scripts import upstox_common  # noqa: E402

BASE_URL = "https://api.upstox.com/v2"
UNDERLYING = "NIFTY"
UNDERLYING_KEY = "NSE_INDEX|Nifty 50"

_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
           "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


# --------------------------------------------------------------------------
# Pure helpers (no I/O — unit-tested in tests/test_trade_cost.py)
# --------------------------------------------------------------------------

def db_expiry_label(expiry_iso: str) -> str:
    """Convert ``YYYY-MM-DD`` to the local instruments-table tail, e.g. ``27 OCT 26``."""
    d = _dt.date.fromisoformat(expiry_iso)
    return f"{d.day:02d} {_MONTHS[d.month - 1]} {d.year % 100:02d}"


def spaced_symbol(strike: float, opt: str, expiry_iso: str) -> str:
    """Local instruments-table symbol format, e.g. ``NIFTY 23000 CE 29 DEC 26``."""
    return f"{UNDERLYING} {int(round(strike))} {opt.upper()} {db_expiry_label(expiry_iso)}"


def match_instrument(
    rows: list[dict[str, Any]],
    *,
    opt: str,
    strike: float,
    expiry_iso: str,
) -> Optional[dict[str, Any]]:
    """Pick the matching instrument row from a list of candidate rows.

    Tries, in order:
      1. exact canonical NSE symbol (``NIFTY26OCT23000CE`` via ``option_symbol``)
      2. exact spaced-table symbol (``NIFTY 23000 CE 29 DEC 26``)

    Only an exact-expiry match is accepted: falling back to a different
    expiry's contract would silently price the wrong instrument (and Upstox
    rejects expired keys with UDAPI100011). Returns the matched row dict
    or ``None`` (caller prints candidates).
    """
    canonical = option_symbol(UNDERLYING, expiry_iso, strike, opt)
    for r in rows:
        if (r.get("trading_symbol") or "").upper() == canonical.upper():
            return r
    spaced = spaced_symbol(strike, opt, expiry_iso)
    for r in rows:
        if (r.get("trading_symbol") or "").upper() == spaced.upper():
            return r
    return None


def match_chain_row(
    chain: list[dict[str, Any]],
    *,
    opt: str,
    strike: float,
) -> Optional[dict[str, Any]]:
    """Pick the chain row for ``strike`` + ``opt`` (CE/PE) from a live
    ``GET /option/chain`` payload.

    Each row carries ``strike_price`` plus ``call_options.instrument_key``
    / ``put_options.instrument_key``. Only an exact-strike match is
    accepted. Returns ``{"instrument_key": ...}`` or ``None``.
    """
    side_key = "call_options" if opt.upper() == "CE" else "put_options"
    for row in chain:
        try:
            same_strike = abs(float(row.get("strike_price")) - float(strike)) < 0.01
        except (TypeError, ValueError):
            continue
        if not same_strike:
            continue
        leg = row.get(side_key) or {}
        key = leg.get("instrument_key")
        if key:
            return {"instrument_key": key}
    return None


def normalize_margin_response(payload: dict[str, Any]) -> dict[str, Any]:
    """Normalise a POST /charges/margin response. Raises ValueError on error payloads."""
    if not isinstance(payload, dict) or payload.get("status") != "success":
        raise ValueError(f"margin API error: {payload!r}"[:300])
    data = payload.get("data") or {}
    legs = []
    for m in data.get("margins") or []:
        legs.append({
            "span_margin": float(m.get("span_margin") or 0.0),
            "exposure_margin": float(m.get("exposure_margin") or 0.0),
            "equity_margin": float(m.get("equity_margin") or 0.0),
            "net_buy_premium": float(m.get("net_buy_premium") or 0.0),
            "additional_margin": float(m.get("additional_margin") or 0.0),
            "tender_margin": float(m.get("tender_margin") or 0.0),
            "total_margin": float(m.get("total_margin") or 0.0),
        })
    return {
        "required_margin": float(data.get("required_margin") or 0.0),
        "final_margin": float(data.get("final_margin") or 0.0),
        "legs": legs,
    }


def normalize_brokerage_response(payload: dict[str, Any]) -> dict[str, Any]:
    """Normalise a GET /charges/brokerage response. Raises ValueError on error payloads."""
    if not isinstance(payload, dict) or payload.get("status") != "success":
        raise ValueError(f"brokerage API error: {payload!r}"[:300])
    charges = (payload.get("data") or {}).get("charges") or {}
    taxes = charges.get("taxes") or {}
    # Docs show both snake_case and camelCase keys; accept either.
    other = charges.get("other_charges") or charges.get("otherCharges") or {}
    return {
        "total": float(charges.get("total") or 0.0),
        "brokerage": float(charges.get("brokerage") or 0.0),
        "stt": float(taxes.get("stt") or 0.0),
        "gst": float(taxes.get("gst") or 0.0),
        "stamp": float(taxes.get("stamp_duty") or taxes.get("stampDuty") or 0.0),
        "exchange": float(other.get("transaction") or 0.0),
        "clearing": float(other.get("clearing") or 0.0),
        "ipft": float(other.get("ipft") or 0.0),
        "sebi": float(other.get("sebi_turnover") or other.get("sebiTurnover") or 0.0),
    }


def round_trip_total(legs: list[dict[str, Any]]) -> float:
    """Sum per-leg ``total`` charges for a round trip."""
    return round(sum(float(leg.get("total") or 0.0) for leg in legs), 2)


def compare_totals(api_total: float, local_total: float) -> dict[str, Any]:
    """Compare API vs local round-trip totals; returns delta, pct and a verdict line."""
    delta = round(api_total - local_total, 2)
    if local_total:
        pct = round(100.0 * delta / local_total, 1)
    else:
        pct = 0.0 if delta == 0 else float("inf")
    if abs(delta) < 0.01:
        verdict = "API and local match"
    else:
        direction = "higher" if delta > 0 else "lower"
        verdict = f"API {abs(pct):.0f}% {direction} than local"
    return {"api_total": api_total, "local_total": local_total,
            "delta": delta, "pct": pct, "verdict": verdict}


# --------------------------------------------------------------------------
# I/O (DB reads + Upstox read-only charge calculators)
# --------------------------------------------------------------------------

def find_instrument_db(opt: str, strike: float, expiry_iso: str) -> tuple[dict[str, Any], list[str]]:
    """Resolve the instrument row from the local table (read-only fallback).

    Returns (row, candidate_symbols). Raises LookupError when nothing matches.
    """
    con = sqlite3.connect(f"file:{desk_common.db_path()}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        db_rows = [dict(r) for r in con.execute(
            "SELECT instrument_key, trading_symbol, strike_price, name, expiry"
            " FROM instruments WHERE name = ? AND abs(strike_price - ?) < 0.01",
            (UNDERLYING, float(strike)),
        ).fetchall()]
    finally:
        con.close()
    row = match_instrument(db_rows, opt=opt, strike=strike, expiry_iso=expiry_iso)
    candidates = sorted({r["trading_symbol"] for r in db_rows if r.get("trading_symbol")})
    if row is None:
        raise LookupError(
            f"no {UNDERLYING} {opt.upper()} {strike:g} instrument for expiry {expiry_iso} "
            f"(tried {option_symbol(UNDERLYING, expiry_iso, strike, opt)!r} and "
            f"{spaced_symbol(strike, opt, expiry_iso)!r}). "
            f"Candidates for strike {strike:g} ({len(candidates)}): "
            + (", ".join(candidates[:20]) + (" ..." if len(candidates) > 20 else "")
               if candidates else "(none — instruments table has no such strike)")
        )
    return row, candidates


def fetch_chain(headers: dict[str, str], expiry_iso: str) -> list[dict[str, Any]]:
    """GET /option/chain for the expiry — read-only. Raises ValueError on error payloads."""
    resp = requests.get(f"{BASE_URL}/option/chain", headers=headers,
                        params={"instrument_key": UNDERLYING_KEY,
                                "expiry_date": expiry_iso}, timeout=20)
    resp.raise_for_status()
    payload = resp.json()
    if not isinstance(payload, dict) or payload.get("status") != "success":
        raise ValueError(f"option chain API error: {payload!r}"[:300])
    return payload.get("data") or []


def fetch_expiries(headers: dict[str, str]) -> list[str]:
    """GET /option/contract — available expiries for the underlying (read-only)."""
    resp = requests.get(f"{BASE_URL}/option/contract", headers=headers,
                        params={"instrument_key": UNDERLYING_KEY}, timeout=20)
    resp.raise_for_status()
    payload = resp.json()
    if not isinstance(payload, dict) or payload.get("status") != "success":
        raise ValueError(f"option contract API error: {payload!r}"[:300])
    return sorted({str(r.get("expiry")) for r in (payload.get("data") or []) if r.get("expiry")})


def resolve_instrument(headers: dict[str, str], opt: str, strike: float,
                       expiry_iso: str) -> tuple[dict[str, Any], str]:
    """Resolve ``(instrument_row, source)`` — live chain first, local DB as fallback.

    Returns source ``"chain"`` or ``"db"``. Raises LookupError (exit 2 in
    main) when neither finds the contract; the message lists available
    expiries from /option/contract when reachable.
    """
    chain_error: Optional[str] = None
    try:
        hit = match_chain_row(fetch_chain(headers, expiry_iso), opt=opt, strike=strike)
    except (requests.HTTPError, ValueError) as e:
        hit, chain_error = None, str(e)[:200]
    if hit is not None:
        return {"instrument_key": hit["instrument_key"],
                "trading_symbol": spaced_symbol(strike, opt, expiry_iso)}, "chain"
    try:
        row, _ = find_instrument_db(opt, strike, expiry_iso)
        return row, "db"
    except LookupError as db_error:
        try:
            expiries = fetch_expiries(headers)
            hint = f"Available expiries: {', '.join(expiries)}" if expiries \
                else "No expiries returned by /option/contract."
        except (requests.HTTPError, ValueError) as e:
            hint = f"Could not list expiries: {e}"[:200]
        msg = (f"no {UNDERLYING} {opt.upper()} {strike:g} instrument for expiry {expiry_iso} "
               f"(live chain + local DB both missed). {hint}")
        if chain_error:
            msg += f" Chain error: {chain_error}"
        msg += f" DB detail: {db_error}"
        raise LookupError(msg)


def get_token() -> str:
    token = upstox_common.token()
    if not token:
        raise SystemExit("ERROR: no shared Upstox token in broker_connections (run broker OAuth first).")
    return token


def fetch_margin(headers: dict[str, str], instrument_key: str,
                 qty: int, side: str, product: str, price: float) -> dict[str, Any]:
    """POST /charges/margin — pure calculator, places no order."""
    body = {"instruments": [{
        "instrument_key": instrument_key,
        "quantity": int(qty),
        "transaction_type": side.upper(),
        "product": product.upper(),
        "price": float(price),
    }]}
    resp = requests.post(f"{BASE_URL}/charges/margin", headers=headers, json=body, timeout=20)
    resp.raise_for_status()
    return normalize_margin_response(resp.json())


def fetch_brokerage(headers: dict[str, str], instrument_token: str,
                    qty: int, side: str, product: str, price: float) -> dict[str, Any]:
    """GET /charges/brokerage — pure calculator, places no order."""
    params = {
        "instrument_token": instrument_token,
        "quantity": int(qty),
        "product": product.upper(),
        "transaction_type": side.upper(),
        "price": float(price),
    }
    resp = requests.get(f"{BASE_URL}/charges/brokerage", headers=headers,
                        params=params, timeout=20)
    resp.raise_for_status()
    return normalize_brokerage_response(resp.json())


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Read-only Upstox margin + round-trip charges probe.")
    p.add_argument("--opt", required=True, choices=["CE", "PE", "ce", "pe"])
    p.add_argument("--strike", required=True, type=float)
    p.add_argument("--expiry", required=True, help="YYYY-MM-DD, e.g. 2026-12-29")
    p.add_argument("--side", required=True, choices=["BUY", "SELL", "buy", "sell"])
    p.add_argument("--qty", required=True, type=int)
    p.add_argument("--price", required=True, type=float,
                   help="entry premium (the proposed order price)")
    p.add_argument("--exit-price", type=float, default=None,
                   help="expected exit premium for the closing leg "
                        "(default: the entry price — the round trip is then "
                        "priced flat, which is flagged in the output)")
    p.add_argument("--product", default="I", choices=["I", "D", "i", "d"],
                   help="I=intraday, D=delivery (default I)")
    p.add_argument("--json", action="store_true", dest="as_json")
    return p


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    opt = args.opt.upper()
    side = args.side.upper()
    product = args.product.upper()
    is_short = side == "SELL"

    try:
        _dt.date.fromisoformat(args.expiry)
    except ValueError:
        print(f"ERROR: --expiry must be YYYY-MM-DD, got {args.expiry!r}", file=sys.stderr)
        return 2
    if args.qty <= 0 or args.price <= 0:
        print("ERROR: --qty and --price must be positive.", file=sys.stderr)
        return 2
    if args.exit_price is not None and args.exit_price <= 0:
        print("ERROR: --exit-price must be positive.", file=sys.stderr)
        return 2
    # The closing leg trades at a DIFFERENT premium. Using the entry price
    # for both legs understated the STT/turnover of the round trip (and
    # priced a flat trade that never happened).
    exit_px = float(args.exit_price) if args.exit_price is not None else float(args.price)

    token = get_token()
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json",
               "Content-Type": "application/json"}

    try:
        inst, source = resolve_instrument(headers, opt, args.strike, args.expiry)
    except LookupError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    key = inst["instrument_key"]

    try:
        margin = fetch_margin(headers, key, args.qty, side, product, args.price)
        close_side = "BUY" if is_short else "SELL"
        legs_meta = [(side, "open", float(args.price)),
                     (close_side, "close", exit_px)]
        legs = []
        for leg_side, _role, leg_px in legs_meta:
            legs.append(fetch_brokerage(headers, key, args.qty, leg_side, product, leg_px))
    except requests.HTTPError as e:
        body = e.response.text[:300] if e.response is not None else ""
        print(f"ERROR: Upstox charges API HTTP {e} {body}", file=sys.stderr)
        return 1
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    api_total = round_trip_total(legs)
    local = option_round_trip_cost(args.price, exit_px, args.qty, is_short=is_short)
    cmp_ = compare_totals(api_total, float(local["costs"]))

    result = {
        "instrument_token": key,
        "trading_symbol": inst.get("trading_symbol"),
        "resolution": source,
        "side": side,
        "qty": args.qty,
        "price": args.price,
        "exit_price": exit_px,
        "flat_round_trip": exit_px == float(args.price),
        "product": product,
        "margin": margin,
        "legs": [
            {"role": role, "side": ls, "price": px, **leg}
            for (ls, role, px), leg in zip(legs_meta, legs)
        ],
        "api_total": cmp_["api_total"],
        "local_total": cmp_["local_total"],
        "local_breakdown": local["breakdown"],
        "delta": cmp_["delta"],
        "delta_pct": cmp_["pct"],
        "verdict": cmp_["verdict"],
    }

    if args.as_json:
        print(json.dumps(result, indent=2))
    else:
        m = margin
        print(f"Instrument : {inst.get('trading_symbol')} ({key}) [via {source}]")
        print(f"Order      : {side} {args.qty} @ {args.price:.2f} (product {product})")
        print(f"Round trip : entry {args.price:.2f} -> exit {exit_px:.2f}"
              + ("  [FLAT: no --exit-price given]" if result["flat_round_trip"] else ""))
        leg0 = m["legs"][0] if m["legs"] else {}
        print(f"Margin req : Rs.{m['required_margin']:.2f} (final Rs.{m['final_margin']:.2f})"
              + "".join(f" [{k}={leg0.get(k, 0):.2f}]"
                        for k in ("span_margin", "exposure_margin", "net_buy_premium")
                        if leg0.get(k)))
        for entry in result["legs"]:
            print(f"Leg {entry['role']:5s} {entry['side']:4s} @ {entry['price']:.2f}: "
                  f"total=Rs.{entry['total']:.2f} "
                  f"(brokerage={entry['brokerage']:.2f} stt={entry['stt']:.2f} "
                  f"exchange={entry['exchange']:.2f} gst={entry['gst']:.2f} "
                  f"stamp={entry['stamp']:.2f} sebi={entry['sebi']:.2f})")
        print(f"Round-trip : API Rs.{cmp_['api_total']:.2f} vs local Rs.{cmp_['local_total']:.2f} "
              f"(delta Rs.{cmp_['delta']:+.2f})")
        print(f"Verdict    : {cmp_['verdict']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
