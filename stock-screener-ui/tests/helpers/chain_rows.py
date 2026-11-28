"""Synthetic parsed option-chain rows shared by the report-parity tests."""

from __future__ import annotations


def full_chain_rows(
    base: float = 23500.0,
    n: int = 21,
    call_wall: float | None = None,
    put_wall: float | None = None,
) -> list[dict]:
    """One strike per 50 around ``base``, with greeks and prev_oi.

    ``call_wall``/``put_wall`` optionally boost one strike's OI so a synthetic
    wall sits at that strike.
    """
    rows = []
    for i in range(n):
        strike = float(base - (n // 2) * 50 + i * 50)
        ce_oi = 1_000_000 if strike == call_wall else 10_000 + i
        pe_oi = 1_000_000 if strike == put_wall else 8_000 + i
        rows.append({
            "strike": strike,
            "ce": {"ltp": 10.0 + i, "oi": ce_oi, "prev_oi": ce_oi - 500,
                   "volume": 100, "delta": 0.4, "gamma": 0.002,
                   "iv": 12.0, "oi_change": 500,
                   "sentiment": {"type": "Neutral"}},
            "pe": {"ltp": 20.0 + i, "oi": pe_oi, "prev_oi": pe_oi - 400,
                   "volume": 90, "delta": -0.4, "gamma": 0.002,
                   "iv": 13.0, "oi_change": 400,
                   "sentiment": {"type": "Neutral"}},
        })
    return rows
