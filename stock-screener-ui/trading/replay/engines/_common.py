"""Shared helpers for the generic replay engines (config merge, trade shape)."""
from __future__ import annotations

# Param names that describe the replay wrapper, not the signal generator.
GENERIC_KEYS = {"symbol", "lookback_days", "warmup"}


def build_generator_config(params: dict, aliases: dict | None = None) -> dict:
    """Build a signal-generator config dict from replay params.

    Generic wrapper-only keys are dropped. ``aliases`` maps replay param names
    to the generator's expected config key (e.g. ``signal_lookback_days`` ->
    ``lookback_days`` for the short-52w generator).
    """
    cfg = {k: v for k, v in params.items() if k not in GENERIC_KEYS}
    for src, dst in (aliases or {}).items():
        if src in params:
            cfg[dst] = params[src]
    return cfg


def classify_exit(notes: str | None) -> str:
    """Map a generator exit note to a canonical ``result`` token."""
    text = (notes or "").lower()
    if "max" in text or "holding" in text:
        return "MAX_HOLD"
    if "trail" in text:
        return "TRAIL"
    if "new_52w" in text or "new 52w" in text:
        return "NEW_52W_HIGH"
    if "eod" in text or "force exit" in text:
        return "EOD"
    if "stop loss" in text or "sl (" in text or text.startswith("sl"):
        return "SL"
    if "take profit" in text or "tp (" in text or text.startswith("tp") or "target reached" in text:
        return "TP"
    return "EXIT"


def make_trade(*, time, exit_time, side, kind, entry, sl, tp, exit_price,
               result, entry_reason, exit_reason) -> dict:
    """Build a canonical trade dict (see ``contract.py``).

    ``pnl`` is in price points; ``rr`` is sign-aware (pnl / |entry - sl|).
    """
    pnl = (exit_price - entry) if side == "LONG" else (entry - exit_price)
    risk = abs(entry - sl) if sl else 0.0
    return {
        "time": int(time),
        "exit_time": int(exit_time),
        "side": side,
        "kind": kind,
        "entry": round(entry, 2),
        "sl": round(sl, 2) if sl else sl,
        "tp": round(tp, 2) if tp else None,
        "exit": round(exit_price, 2),
        "result": result,
        "pnl": round(pnl, 2),
        "rr": round(pnl / risk, 2) if risk else 0.0,
        "meta": {"entry_reason": entry_reason or "", "exit_reason": exit_reason or result},
    }


def resolve_position(side, sl, tp, high, low):
    """Conservative intrabar exit: SL first, then TP. Returns (price, result)."""
    if side == "LONG":
        if low <= sl:
            return sl, "SL"
        if tp and high >= tp:
            return tp, "TP"
    else:
        if high >= sl:
            return sl, "SL"
        if tp and low <= tp:
            return tp, "TP"
    return None, None
