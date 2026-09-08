"""R-based risk controls for the SMC-iFVG engine — pure functions, no I/O.

Conventions
-----------
* All P&L / thresholds in **points** (MNQ = $5/pt; 30 pts = $150).
* A "trade" dict needs at minimum: ``t_in`` / ``t_out`` (ms epochs),
  ``entry``, ``sl``, ``pnl`` (points, realized at ``t_out``).
* ``risk_pts = abs(entry - sl)``; ``R`` multiple = ``pnl / risk``.
* Functions are history-only and side-effect free: they take sorted lists
  and return new lists / scalars, never mutate inputs.

Rules implemented
-----------------
1. ``should_flatten`` — flatten-at-breach predicate: True once the running
   daily P&L has breached ``-threshold_pts``.
2. ``apply_day_stop`` — trade-level replay of flatten-at-breach + block-new-
   entries-rest-of-day. Trades must be sorted by ``t_in``. With
   ``flatten=True`` the breaching trade is truncated to exactly ``-threshold``
   (models closing ALL open positions the tick the breach occurs; zero
   slippage assumed — optimistic by ~1-3 pts vs live). With
   ``flatten=False`` the breaching trade runs to its full loss (models the
   engine's entry-block-only ``day_stop_pts``: open trades run past it).
3. ``stop_from_running_avg`` — R-based stop: ``threshold = k * avg_risk``.
4. ``pass_risk_cap`` — per-trade risk cap as a multiple of ATR at entry.
5. ``apply_max_concurrent`` — cap overlapping positions across stacks
   (no-op on the single-engine serial deployment; binds on divided
   inv+retest stacks where 2 concurrent are possible).
"""

from __future__ import annotations


def trade_risk_pts(entry: float, sl: float) -> float:
    """Per-trade risk in points."""
    return abs(entry - sl)


def trade_r_pts(pnl_pts: float, risk_pts: float) -> float:
    """Realized R multiple; 0.0 guard for zero risk."""
    if not risk_pts:
        return 0.0
    return pnl_pts / risk_pts


def should_flatten(cum_pnl_pts: float, threshold_pts: float) -> bool:
    """True once daily P&L has breached -threshold (inclusive)."""
    return cum_pnl_pts <= -threshold_pts


def stop_from_running_avg(avg_risk_pts: float, k: float = 2.0) -> float:
    """R-based stop in points: k * running-average risk. Pure."""
    return k * avg_risk_pts


def pass_risk_cap(risk_pts: float, atr_pts: float, k: float = 5.0) -> bool:
    """True if a new trade's risk fits within k * ATR at entry.

    Rejects fat-tail stops (e.g. 200+ pt risk when ATR ~13) that turn a
    normal losing streak into a day-killer. Returns False on non-positive
    ATR (fail-closed: cannot size without volatility context).
    """
    if atr_pts is None or atr_pts <= 0:
        return False
    return risk_pts <= k * atr_pts


def apply_day_stop(day_trades: list[dict], threshold_pts: float,
                   flatten: bool = True) -> tuple[list[dict], float]:
    """Replay one day's trades (sorted by ``t_in``) through a daily stop.

    Returns ``(kept_trades, realized_net)``. With ``flatten=True`` the first
    trade that would push the cumulative at/through ``-threshold`` is kept
    with its ``pnl`` truncated to exactly ``-threshold - cum_before`` and
    tagged ``flattened=True`` (copy, input untouched); all later trades are
    dropped. With ``flatten=False`` (entry-block only) the breaching trade is
    kept whole and only *subsequent* trades are dropped.
    """
    kept: list[dict] = []
    cum = 0.0
    breached = False
    for t in sorted(day_trades, key=lambda x: x["t_in"]):
        if breached:
            continue
        pnl = float(t["pnl"])
        if cum + pnl <= -threshold_pts:
            if flatten:
                cp = dict(t)
                cp["pnl"] = round(-threshold_pts - cum, 2)
                cp["flattened"] = True
                kept.append(cp)
                cum = -threshold_pts
            else:
                kept.append(t)
                cum += pnl
            breached = True
        else:
            kept.append(t)
            cum += pnl
    return kept, round(cum, 2)


def apply_max_concurrent(day_trades: list[dict], max_n: int = 1) -> list[dict]:
    """Drop trades that would exceed ``max_n`` overlapping positions.

    Overlap defined by ``[t_in, t_out)`` intervals in ``t_in`` order. Pure;
    returns a new list. On the single-engine deployment trades are serial so
    this is a no-op (verified: 0 overlaps across Jun-Aug 2026); it binds on
    divided inv+retest stacks.
    """
    kept: list[dict] = []
    open_outs: list[int] = []  # t_out of currently open kept trades
    for t in sorted(day_trades, key=lambda x: x["t_in"]):
        open_outs = [o for o in open_outs if o > t["t_in"]]
        if len(open_outs) < max_n:
            kept.append(t)
            open_outs.append(t["t_out"])
    return kept


def day_min_cum(trades_in_out_order: list[dict]) -> float:
    """Max intraday adverse excursion: min of cumulative P&L in exit order."""
    cum = m = 0.0
    for t in sorted(trades_in_out_order, key=lambda x: x["t_out"]):
        cum += float(t["pnl"])
        m = min(m, cum)
    return round(m, 2)


def max_loss_streak(pnls: list[float]) -> int:
    """Longest run of non-winning trades (pnl <= 0)."""
    best = cur = 0
    for p in pnls:
        if p <= 0:
            cur += 1
            best = max(best, cur)
        else:
            cur = 0
    return best
