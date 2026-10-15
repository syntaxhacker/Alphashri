"""Causal strategy library for NIFTY option research.

Each strategy is ``f(ctx, i, **params) -> Signal | None`` where ``i`` is the
index of the **completed** bar. Features come from ``ctx`` prefix arrays that
only index up to ``i`` (see ``engine.StrategyContext``). A strategy may also use
an injected *previous-day* OHLC (strictly prior session).
"""

from __future__ import annotations

from engine import Leg, Signal


def orb_breakout(ctx, i, or_min=15, buffer=0.0015, stop_pct=0.35, target_pct=0.60,
                 max_hold_min=120, cutoff_min=90, retest=False):
    """Opening-range breakout → buy ATM CE (up) / PE (down)."""
    if ctx.to_close_min(i) < 30:
        return None
    orng = ctx.opening_range(i, or_min)
    if orng is None:
        return None
    hi, lo, n = orng
    mins = ctx.minutes(i)
    if mins > cutoff_min:
        return None
    close = float(ctx._closes[i])
    prev = float(ctx._closes[i - 1]) if i >= 1 else close
    if close > hi * (1 + buffer) and prev <= hi * (1 + buffer):
        return Signal([Leg("CE", "BUY", 0)], reason=f"ORB long OR[{lo:.0f},{hi:.0f}]",
                      tag="orb_long", stop_pct=stop_pct, target_pct=target_pct,
                      max_hold_min=max_hold_min)
    if close < lo * (1 - buffer) and prev >= lo * (1 - buffer):
        return Signal([Leg("PE", "BUY", 0)], reason=f"ORB short OR[{lo:.0f},{hi:.0f}]",
                      tag="orb_short", stop_pct=stop_pct, target_pct=target_pct,
                      max_hold_min=max_hold_min)
    return None


def vwap_reclaim(ctx, i, lookback=6, buffer=0.0008, stop_pct=0.35, target_pct=0.60,
                 max_hold_min=90, cutoff_min=300):
    """Fade a VWAP pierce and buy the reclaim (CE) / rejection (PE)."""
    if ctx.to_close_min(i) < 30:
        return None
    mins = ctx.minutes(i)
    if mins < 30 or mins > cutoff_min:
        return None
    vwap = ctx.vwap(i)
    c = float(ctx._closes[i])
    was_below = any(ctx.vwap(k) > ctx._closes[k] for k in range(max(0, i - lookback), i))
    was_above = any(ctx.vwap(k) < ctx._closes[k] for k in range(max(0, i - lookback), i))
    if was_below and c > vwap * (1 + buffer):
        return Signal([Leg("CE", "BUY", 0)], reason="VWAP reclaim", tag="vwap_reclaim",
                      stop_pct=stop_pct, target_pct=target_pct, max_hold_min=max_hold_min)
    if was_above and c < vwap * (1 - buffer):
        return Signal([Leg("PE", "BUY", 0)], reason="VWAP rejection", tag="vwap_reject",
                      stop_pct=stop_pct, target_pct=target_pct, max_hold_min=max_hold_min)
    return None


def prev_day_break(ctx, i, buffer=0.001, stop_pct=0.35, target_pct=0.60,
                   max_hold_min=150, cutoff_min=240):
    """Break of previous-day high/low → buy the breakout option."""
    pdh = getattr(ctx, "prev_high", None)
    pdl = getattr(ctx, "prev_low", None)
    if not pdh or not pdl or ctx.to_close_min(i) < 30:
        return None
    if ctx.minutes(i) < 5 or ctx.minutes(i) > cutoff_min:
        return None
    c = float(ctx._closes[i]); p = float(ctx._closes[i - 1])
    if c > pdh * (1 + buffer) and p <= pdh * (1 + buffer):
        return Signal([Leg("CE", "BUY", 0)], reason=f"PDH break {pdh:.0f}", tag="pdh_break",
                      stop_pct=stop_pct, target_pct=target_pct, max_hold_min=max_hold_min)
    if c < pdl * (1 - buffer) and p >= pdl * (1 - buffer):
        return Signal([Leg("PE", "BUY", 0)], reason=f"PDL break {pdl:.0f}", tag="pdl_break",
                      stop_pct=stop_pct, target_pct=target_pct, max_hold_min=max_hold_min)
    return None


def momentum_pullback(ctx, i, ema_span=20, stop_pct=0.35, target_pct=0.60,
                      max_hold_min=120, cutoff_min=240):
    """Buy continuation on a pullback to the rising/falling intraday EMA."""
    if ctx.to_close_min(i) < 30:
        return None
    mins = ctx.minutes(i)
    if mins < 30 or mins > cutoff_min or i < ema_span + 2:
        return None
    e = ctx.ema(i, ema_span)
    e_prev = ctx.ema(i - 3, ema_span)
    c = float(ctx._closes[i])
    up = e > e_prev and c > e
    dn = e < e_prev and c < e
    touched = min(ctx._lows[i], ctx._lows[i - 1]) <= e * 1.001
    if up and touched and c > float(ctx._opens[i]):
        return Signal([Leg("CE", "BUY", 0)], reason="momentum pullback long", tag="mom_long",
                      stop_pct=stop_pct, target_pct=target_pct, max_hold_min=max_hold_min)
    touched_top = max(ctx._highs[i], ctx._highs[i - 1]) >= e * 0.999
    if dn and touched_top and c < float(ctx._opens[i]):
        return Signal([Leg("PE", "BUY", 0)], reason="momentum pullback short", tag="mom_short",
                      stop_pct=stop_pct, target_pct=target_pct, max_hold_min=max_hold_min)
    return None


def short_straddle_intraday(ctx, i, entry_min=30, stop_pct=0.35, target_pct=0.40,
                            max_hold_min=300, otm_steps=0):
    """Sell an ATM (or 1-step OTM) straddle/strangle intraday, stop on premium."""
    mins = ctx.minutes(i)
    if abs(mins - entry_min) > 3:
        return None
    legs = [Leg("CE", "SELL", otm_steps), Leg("PE", "SELL", otm_steps)]
    return Signal(legs, reason=f"short {'strangle' if otm_steps else 'straddle'} @{entry_min}m",
                  tag="short_straddle" if not otm_steps else "short_strangle",
                  stop_pct=stop_pct, target_pct=target_pct, max_hold_min=max_hold_min)


def credit_spread_intraday(ctx, i, entry_min=30, short_steps=2, width_steps=1,
                           stop_pct=0.5, target_pct=0.5, max_hold_min=300, side="both"):
    """Sell an OTM vertical (credit spread), buy the wing."""
    mins = ctx.minutes(i)
    if abs(mins - entry_min) > 3:
        return None
    legs = []
    if side in ("both", "put"):
        legs += [Leg("PE", "SELL", -short_steps), Leg("PE", "BUY", -(short_steps + width_steps))]
    if side in ("both", "call"):
        legs += [Leg("CE", "SELL", short_steps), Leg("CE", "BUY", short_steps + width_steps)]
    return Signal(legs, reason=f"credit spread {side}", tag="credit_spread",
                  stop_pct=stop_pct, target_pct=target_pct, max_hold_min=max_hold_min)


REGISTRY = {
    "orb_breakout": orb_breakout,
    "vwap_reclaim": vwap_reclaim,
    "prev_day_break": prev_day_break,
    "momentum_pullback": momentum_pullback,
    "short_straddle_intraday": short_straddle_intraday,
    "credit_spread_intraday": credit_spread_intraday,
}
