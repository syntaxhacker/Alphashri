"""Options Positioning — pure delta-weighted OI math.

No HTTP imports. Plain dicts in/out so the logic is unit-testable
without FastAPI, Upstox, or auth.

Conventions (v1):
- ``chain_rows`` are ``/chain``-shaped rows: ``{strike, ce|None, pe|None}``.
- Each contract carries ``market_data: {oi, prev_oi}``,
  ``option_greeks: {delta, ...} | None`` and ``sentiment: {type}``.
- ``dOI = oi - prev_oi`` where Upstox ``prev_oi`` is the prior-session
  close OI, so "since open" ≈ "vs prev close" (documented in the endpoint).
- A contract is *readable* when the greeks object is present AND delta
  is not None. delta == 0 with greeks present counts readable (contributes 0).
- Signed delta: +abs(delta) for CE, -abs(delta) for PE (Upstox put deltas
  are already negative; abs() normalizes both).
- Crore conversion: signed_delta * qty * lot * spot / 1e7.
"""

from typing import Any, Dict, List, Optional

CRORE = 1e7


def _flow_label(side: str, sentiment_type: str) -> str:
    """Human label for the biggest single-contract flow."""
    if sentiment_type == "Neutral":
        return "unclassified flow (today)"
    if side == "CE":
        return {
            "Short Buildup": "call writers opened (today)",
            "Long Buildup": "call buyers opened (today)",
            "Short Covering": "call writers closed (today)",
            "Long Unwinding": "call buyers closed (today)",
        }.get(sentiment_type, "unclassified flow (today)")
    return {
        "Short Buildup": "put writers opened (today)",
        "Long Buildup": "put buyers opened (today)",
        "Short Covering": "put writers closed (today)",
        "Long Unwinding": "put buyers closed (today)",
    }.get(sentiment_type, "unclassified flow (today)")


def _contract_flow(contract: Optional[Dict[str, Any]], side: str, lot_size: int, spot: float):
    """Return per-contract positioning facts or None when contract missing.

    Returns (dOI_shares, state_cr, flow_cr, readable, sentiment_type).
    Unreadable contracts still report dOI_shares (denominator for read%).
    """
    if not contract:
        return None
    md = contract.get("market_data", {}) or {}
    oi = md.get("oi", 0) or 0
    prev_oi = md.get("prev_oi", 0) or 0
    d_oi = oi - prev_oi
    d_oi_shares = d_oi * lot_size

    sentiment = contract.get("sentiment") or {}
    sentiment_type = sentiment.get("type") or "Neutral"

    greeks = contract.get("option_greeks")
    readable = greeks is not None and greeks.get("delta") is not None
    if not readable:
        return (d_oi_shares, None, None, False, sentiment_type)

    delta = greeks.get("delta")
    signed_delta = abs(delta) if side == "CE" else -abs(delta)
    state_cr = signed_delta * oi * lot_size * spot / CRORE
    flow_cr = signed_delta * d_oi * lot_size * spot / CRORE
    return (d_oi_shares, state_cr, flow_cr, True, sentiment_type)


def compute_positioning(chain_rows: List[Dict[str, Any]], spot: float, lot_size: int) -> Dict[str, Any]:
    """Delta-weighted options positioning from chain-shaped rows."""
    state_calls = 0.0
    state_puts = 0.0
    flow_calls = 0.0
    flow_puts = 0.0
    initiated_total = 0.0
    bearish_cr = 0.0
    bullish_cr = 0.0
    readable_shares = 0
    total_shares = 0
    biggest = None  # (abs_cr, strike, side, sentiment_type, flow_cr)
    rows: List[Dict[str, Any]] = []

    for row in chain_rows or []:
        strike = row.get("strike")
        out_row: Dict[str, Any] = {"strike": strike}
        net = 0.0
        net_known = False
        for side, key in (("CE", "ce"), ("PE", "pe")):
            facts = _contract_flow(row.get(key), side, lot_size, spot)
            if facts is None:
                out_row[f"{key}_class"] = "—"
                out_row[f"{key}_doi_shares"] = None
                out_row[f"{key}_cr"] = None
                continue
            d_oi_shares, state_cr, flow_cr, readable, sentiment_type = facts
            total_shares += abs(d_oi_shares)
            out_row[f"{key}_class"] = sentiment_type or "—"
            out_row[f"{key}_doi_shares"] = d_oi_shares
            if not readable:
                out_row[f"{key}_cr"] = None
                continue
            readable_shares += abs(d_oi_shares)
            out_row[f"{key}_cr"] = flow_cr
            net += flow_cr
            net_known = True
            if side == "CE":
                state_calls += state_cr
                flow_calls += flow_cr
            else:
                state_puts += state_cr
                flow_puts += flow_cr
            initiated_total += flow_cr
            bearish_cr += min(flow_cr, 0.0)
            bullish_cr += max(flow_cr, 0.0)
            magnitude = abs(flow_cr)
            if biggest is None or magnitude > biggest[0]:
                biggest = (magnitude, strike, side, sentiment_type, flow_cr)
        out_row["net_cr"] = net if net_known else None
        rows.append(out_row)

    if initiated_total < 0:
        verdict = "bearish"
        initiated_note = "▼ Short Δ · bearish"
    elif initiated_total > 0:
        verdict = "bullish"
        initiated_note = "▲ Long Δ · bullish"
    else:
        verdict = "neutral"
        initiated_note = "■ Neutral"

    gross = abs(bearish_cr) + abs(bullish_cr)
    lean_pct = abs(initiated_total) / gross * 100 if gross else 0.0

    state_note = "puts outweigh calls" if abs(state_puts) > abs(state_calls) else "calls outweigh puts"
    flow_note = "puts outweigh calls" if abs(flow_puts) > abs(flow_calls) else "calls outweigh puts"

    read_pct = readable_shares / total_shares * 100 if total_shares else 0.0

    if biggest is None:
        biggest_move = None
    else:
        _, b_strike, b_side, b_sent, b_cr = biggest
        biggest_move = {
            "strike": b_strike,
            "side": b_side,
            "sentiment": b_sent,
            "label": _flow_label(b_side, b_sent),
            "cr": b_cr,
        }

    bearish_abs = abs(bearish_cr)
    bullish_abs = abs(bullish_cr)
    return {
        "verdict": verdict,
        "initiated_cr": initiated_total,
        "lean_pct": lean_pct,
        "state": {"calls_cr": state_calls, "puts_cr": state_puts, "note": state_note},
        "flow": {"calls_cr": flow_calls, "puts_cr": flow_puts, "note": flow_note},
        "initiated": {"bearish_cr": bearish_cr, "bullish_cr": bullish_cr, "note": initiated_note},
        "split": {
            "bearish_cr": bearish_cr,
            "bearish_pct": bearish_abs / gross * 100 if gross else 0.0,
            "bullish_cr": bullish_cr,
            "bullish_pct": bullish_abs / gross * 100 if gross else 0.0,
        },
        "read": {"pct": read_pct, "readable_shares": readable_shares, "total_shares": total_shares},
        "biggest_move": biggest_move,
        "rows": rows,
    }
