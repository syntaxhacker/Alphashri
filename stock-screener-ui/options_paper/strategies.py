"""Strategy registry + event-driven intraday engine.

Honesty contract (mirrors the programme's research rules)
--------------------------------------------------------
* A signal is computed on the **close of a completed bar** and filled at the
  **next bar's** recorded premium. We cannot see the fill bar's future.
* **No profit exit on the fill bar.** A stop is allowed on the fill bar; a
  target is not.
* **Stop is checked before target** on every bar.
* No overnight carry: every position is flattened at ``eod_exit``.

The engine trades **ATM** contracts, priced from the tape's real
``atm_ce_ltp`` / ``atm_pe_ltp``. OTM strike selection needs the 1-minute
contract panel or a live chain and is deliberately out of scope for v1 (a
documented limitation, not a hidden one).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date as _date, datetime as _dt, time as _time

from . import greeks as _gr
from . import spec
from .costs import option_round_trip_cost
from .tape import Tick


def chain_px(tk: Tick, strike: float, opt: str) -> float:
    """Premium of ``strike``/``opt`` at ``tk`` (chain-aware, ATM fallback)."""
    row = tk.chain.get(int(strike)) if tk.chain else None
    if row:
        v = row[0] if opt.upper() == "CE" else row[1]
        if v and v > 0:
            return float(v)
    return tk.premium(opt)


# --------------------------------------------------------------------------
# Primitives
# --------------------------------------------------------------------------
@dataclass
class Signal:
    opt: str            # "CE" | "PE" | "STRADDLE"
    reason: str
    direction: str = "LONG"     # LONG (buy premium) | SHORT (sell premium)
    strike: float | None = None # None = ATM at the fill bar


@dataclass
class Position:
    strategy: str
    underlying: str
    expiry: str
    opt: str
    direction: str
    lots: int
    lot: int
    qty: int
    entry_index: int
    fill_index: int
    entry_time: datetime
    entry_premium: float
    entry_spot: float
    entry_ce: float = 0.0
    entry_pe: float = 0.0
    reason: str = ""
    leg_orders: int = 1          # 1 for single leg, 2 for a straddle/strangle
    peak_premium: float = 0.0
    trough_premium: float = 0.0
    strike: float = 0.0          # ATM strike at entry (real, from the fill tick)
    entry_iv: float = 0.0        # IV of the chosen leg at entry (for vol exits)

    def premium_at(self, tk: Tick) -> float:
        """Mark at the **entry strike**, not the current ATM.

        The ATM drifts as spot moves (e.g. 23400 -> 23350), so pricing at
        ``tk.atm_strike`` silently switches contracts mid-trade. When the tick
        carries a strike chain we use the exact contract; the live tape is
        ATM-only, so it falls back to the recorded ATM premium there.
        """
        if self.opt == "STRADDLE":
            return self._leg_px(tk, "CE") + self._leg_px(tk, "PE")
        return self._leg_px(tk, self.opt)

    def _leg_px(self, tk: Tick, opt: str) -> float:
        return chain_px(tk, self.strike, opt)


@dataclass
class Trade:
    strategy: str
    underlying: str
    symbol: str
    opt: str
    direction: str
    lots: int
    lot: int
    qty: int
    expiry: str
    entry_time: str
    entry_premium: float
    entry_spot: float
    exit_time: str
    exit_premium: float
    exit_spot: float
    exit_reason: str
    hold_min: float
    gross_pnl: float
    costs: float
    net_pnl: float
    points: float
    reason: str
    strike: float = 0.0
    sl_pct: float = 0.0
    tp_pct: float = 0.0

    def as_row(self) -> dict:
        return self.__dict__.copy()


# --------------------------------------------------------------------------
# Strategy base
# --------------------------------------------------------------------------
class Strategy:
    name = "base"
    underlying = "NIFTY"
    opt_pool = ("CE", "PE")

    def __init__(self, lots: int = 1, lot: int | None = None,
                 sl_pct: float = 0.30, tp_pct: float = 0.60,
                 max_hold_min: int = 60,
                 eod_exit: _time = spec.DEFAULT_EOD_EXIT,
                 trail_pct: float = 0.0, **params):
        self.lots = lots
        self.lot = lot or spec.get_lot(self.underlying)
        self.sl_pct = sl_pct
        self.tp_pct = tp_pct
        self.max_hold_min = max_hold_min
        self.eod_exit = eod_exit
        self.trail_pct = trail_pct      # 0 = off; else trail this far off the peak
        self.params = params

    # --- hooks ---------------------------------------------------------
    def prepare(self, ticks: list[Tick], ctx: dict) -> None:
        """Precompute per-day state (opening range, prev close, ...)."""

    def entry_signal(self, i: int, tk: Tick, ticks: list[Tick],
                     ctx: dict) -> Signal | None:
        raise NotImplementedError

    def exit_hook(self, pos: Position, tk: Tick, ticks: list[Tick],
                  ctx: dict) -> str | None:
        """Strategy-specific discretionary exit (returns a reason or None)."""
        return None

    # --- engine --------------------------------------------------------
    def run(self, ticks: list[Tick], ctx: dict) -> list[Trade]:
        ticks = [t for t in ticks if t.expiry == ticks[0].expiry] if ticks else []
        if len(ticks) < 3:
            return []
        self.prepare(ticks, ctx)
        trades: list[Trade] = []
        pos: Position | None = None
        i = 0
        n = len(ticks)
        current_day = ticks[0].t.date()
        while i < n:
            tk = ticks[i]
            # new session guard (tape files are per-day, but be safe)
            if tk.t.date() != current_day:
                if pos is not None:
                    trades.append(self._close(pos, ticks[i - 1], "EOD"))
                    pos = None
                self.prepare(ticks[i:], ctx)
                current_day = tk.t.date()

            if pos is None:
                if tk.t.time() < self._entry_after:
                    i += 1
                    continue
                sig = self.entry_signal(i, tk, ticks, ctx)
                if sig and i + 1 < n:
                    fill = ticks[i + 1]
                    if self._fillable(sig, fill):
                        pos = self._open(sig, fill, fill_index=i + 1, entry_index=i)
                        # evaluate the fill bar next: a stop is allowed there,
                        # a target is not (see _exit_reason)
                        i += 1
                        continue
            else:
                reason = self._exit_reason(pos, tk, ticks, ctx)
                if reason:
                    trades.append(self._close(pos, tk, reason))
                    pos = None
            i += 1

        if pos is not None:
            last = ticks[-1]
            # A full-day run ends at/after the EOD cut -> "EOD".
            # A partial (intraday preview) run marks the position "MTM" so it is
            # never mistaken for a settled trade.
            final = "EOD" if last.t.time() >= self.eod_exit else "MTM"
            trades.append(self._close(pos, last, final))
        return trades

    _entry_after = _time(9, 15)

    def _open(self, sig: Signal, fill: Tick, fill_index: int,
              entry_index: int) -> Position:
        strike = float(sig.strike) if sig.strike else float(fill.atm_strike)
        if sig.opt == "STRADDLE":
            entry_premium = chain_px(fill, strike, "CE") + chain_px(fill, strike, "PE")
            leg_orders = 2
        else:
            entry_premium = chain_px(fill, strike, sig.opt)
            leg_orders = 1
        if sig.opt == "STRADDLE":
            entry_iv = (fill.ce_iv + fill.pe_iv) / 2.0
        else:
            entry_iv = fill.ce_iv if sig.opt == "CE" else fill.pe_iv
        return Position(
            strategy=self.name, underlying=self.underlying, expiry=fill.expiry,
            opt=sig.opt, direction=sig.direction, lots=self.lots, lot=self.lot,
            qty=self.lots * self.lot, entry_index=entry_index,
            fill_index=fill_index, entry_time=fill.t, entry_premium=entry_premium,
            entry_spot=fill.spot, entry_ce=chain_px(fill, strike, "CE"),
            entry_pe=chain_px(fill, strike, "PE"),
            reason=sig.reason, leg_orders=leg_orders,
            peak_premium=entry_premium, trough_premium=entry_premium,
            strike=strike, entry_iv=entry_iv,
        )

    def _fillable(self, sig: Signal, fill: Tick) -> bool:
        """A leg with no price cannot be traded — never open at zero premium."""
        strike = float(sig.strike) if sig.strike else float(fill.atm_strike)
        if sig.opt == "STRADDLE":
            return (chain_px(fill, strike, "CE") > 0
                    and chain_px(fill, strike, "PE") > 0)
        return chain_px(fill, strike, sig.opt) > 0

    def _exit_reason(self, pos: Position, tk: Tick, ticks: list[Tick],
                     ctx: dict) -> str | None:
        prem = pos.premium_at(tk)
        pos.peak_premium = max(pos.peak_premium, prem)
        pos.trough_premium = min(pos.trough_premium, prem)
        moved = (prem - pos.entry_premium) / pos.entry_premium if pos.entry_premium else 0.0
        favorable = moved if pos.direction == "LONG" else -moved

        is_fill_bar = tk.t == ticks[pos.fill_index].t
        # stop first (allowed even on the fill bar)
        if favorable <= -self.sl_pct:
            return "SL"
        if is_fill_bar:
            return None          # only a stop may fire on the fill bar
        if favorable >= self.tp_pct:
            return "TP"
        # Trailing stop: once in profit, give back no more than trail_pct of the
        # best premium seen. This is the "active management" for a runner that
        # would otherwise sit until the fixed target or EOD.
        if self.trail_pct > 0 and favorable > 0:
            if pos.direction == "LONG":
                peak = pos.peak_premium
                if peak > 0 and (peak - prem) / peak >= self.trail_pct:
                    return "TRAIL"
            else:
                trough = pos.trough_premium
                if trough > 0 and (prem - trough) / trough >= self.trail_pct:
                    return "TRAIL"
        held = (tk.t - pos.entry_time).total_seconds() / 60.0
        if held >= self.max_hold_min:
            return "TIME"
        if tk.t.time() >= self.eod_exit:
            return "EOD"
        return self.exit_hook(pos, tk, ticks, ctx)

    def _close(self, pos: Position, tk: Tick, reason: str) -> Trade:
        exit_premium = pos.premium_at(tk)
        # Straddle = 2 orders per side; model each leg's costs at its own premium.
        if pos.opt == "STRADDLE":
            ce_x, pe_x = pos._leg_px(tk, "CE"), pos._leg_px(tk, "PE")
            leg1 = option_round_trip_cost(pos.entry_ce, ce_x, pos.qty,
                                          pos.direction == "SHORT")
            leg2 = option_round_trip_cost(pos.entry_pe, pe_x, pos.qty,
                                          pos.direction == "SHORT")
            gross = leg1["gross_pnl"] + leg2["gross_pnl"]
            costs = leg1["costs"] + leg2["costs"]
            net = leg1["net_pnl"] + leg2["net_pnl"]
        else:
            rc = option_round_trip_cost(pos.entry_premium, exit_premium, pos.qty,
                                        pos.direction == "SHORT")
            gross, costs, net = rc["gross_pnl"], rc["costs"], rc["net_pnl"]
        pts = net / pos.qty
        return Trade(
            strategy=pos.strategy, underlying=pos.underlying,
            symbol=spec.option_symbol(pos.underlying, pos.expiry,
                                      pos.strike or tk.atm_strike, pos.opt)
            if pos.opt in ("CE", "PE") else f"{pos.underlying} {pos.expiry} STRADDLE",
            opt=pos.opt, direction=pos.direction, lots=pos.lots, lot=pos.lot,
            qty=pos.qty, expiry=pos.expiry,
            entry_time=pos.entry_time.isoformat(), entry_premium=round(pos.entry_premium, 2),
            entry_spot=round(pos.entry_spot, 2),
            exit_time=tk.t.isoformat(), exit_premium=round(exit_premium, 2),
            exit_spot=round(tk.spot, 2), exit_reason=reason,
            hold_min=round((tk.t - pos.entry_time).total_seconds() / 60.0, 1),
            gross_pnl=round(gross, 2), costs=round(costs, 2),
            net_pnl=round(net, 2), points=round(pts, 3), reason=pos.reason,
            strike=round(pos.strike, 2), sl_pct=self.sl_pct, tp_pct=self.tp_pct,
        )


# --------------------------------------------------------------------------
# 1. NIFTY long-premium momentum (opening-range breakout)
# --------------------------------------------------------------------------
class NiftyMomentum(Strategy):
    name = "nifty_momentum"
    underlying = "NIFTY"

    def __init__(self, or_minutes: int = 15, buffer_pct: float = 0.05,
                 trail_pct: float = 0.25, **kw):
        kw.setdefault("trail_pct", trail_pct)
        super().__init__(**kw)
        self.or_minutes = or_minutes
        self.buffer_pct = buffer_pct
        self.entered = False

    def prepare(self, ticks, ctx):
        self.entered = False
        or_end = self.or_minutes
        window = ticks[:or_end]
        self.or_high = max(t.spot for t in window)
        self.or_low = min(t.spot for t in window)
        self._entry_after = window[-1].t.time()

    def entry_signal(self, i, tk, ticks, ctx):
        if self.entered:
            return None
        buf = tk.spot * self.buffer_pct / 100.0
        if tk.spot > self.or_high + buf and tk.ce_ltp > 0:
            self.entered = True
            return Signal("CE", f"ORB up break {tk.spot:.0f}>{self.or_high:.0f}")
        if tk.spot < self.or_low - buf and tk.pe_ltp > 0:
            self.entered = True
            return Signal("PE", f"ORB down break {tk.spot:.0f}<{self.or_low:.0f}")
        return None


# --------------------------------------------------------------------------
# 2. Stock-option momentum (same rule; needs live chain -> skipped if offline)
# --------------------------------------------------------------------------
class StockMomentum(Strategy):
    name = "stock_momentum"

    def __init__(self, symbol: str = "RELIANCE", **kw):
        self.symbol = symbol.upper()
        kw.setdefault("lot", spec.get_lot(self.symbol))
        super().__init__(**kw)
        self.underlying = self.symbol
        self.entered = False

    def prepare(self, ticks, ctx):
        self.entered = False
        if len(ticks) < 2:
            return
        self.or_high = max(t.spot for t in ticks[:10])
        self.or_low = min(t.spot for t in ticks[:10])
        self._entry_after = ticks[min(9, len(ticks) - 1)].t.time()

    def entry_signal(self, i, tk, ticks, ctx):
        if self.entered or len(ticks) < 11:
            return None
        if tk.spot > self.or_high:
            self.entered = True
            return Signal("CE", f"{self.symbol} break up")
        if tk.spot < self.or_low:
            self.entered = True
            return Signal("PE", f"{self.symbol} break down")
        return None


# --------------------------------------------------------------------------
# 3. NIFTY premium-selling control (short ATM straddle)
# --------------------------------------------------------------------------
class NiftyVRP(Strategy):
    name = "nifty_vrp"
    underlying = "NIFTY"

    def __init__(self, entry_after_min: int = 20, sl_pct: float = 1.00,
                 tp_pct: float = 0.50, **kw):
        kw.setdefault("max_hold_min", 400)
        super().__init__(sl_pct=sl_pct, tp_pct=tp_pct, **kw)
        self.entry_after_min = entry_after_min
        self.entered = False

    def prepare(self, ticks, ctx):
        self.entered = False
        if ticks:
            idx = min(self.entry_after_min, len(ticks) - 1)
            self._entry_after = ticks[idx].t.time()

    def entry_signal(self, i, tk, ticks, ctx):
        if self.entered or tk.ce_ltp <= 0 or tk.pe_ltp <= 0:
            return None
        self.entered = True
        return Signal("STRADDLE", f"sell ATM straddle {tk.atm_strike:.0f}", "SHORT")


# --------------------------------------------------------------------------
# 4. NIFTY gap conditioning (gap-and-go / gap-fade)
# --------------------------------------------------------------------------
class NiftyGap(Strategy):
    name = "nifty_gap"
    underlying = "NIFTY"

    def __init__(self, gap_min_pct: float = 0.30, mode: str = "go", **kw):
        super().__init__(**kw)
        self.gap_min_pct = gap_min_pct
        self.mode = mode
        self.entered = False

    def prepare(self, ticks, ctx):
        self.entered = False
        prev = ctx.get("prev_close")
        self.gap_pct = None
        if ticks and prev:
            self.gap_pct = (ticks[0].spot - prev) / prev * 100.0
        if ticks:
            self._entry_after = ticks[0].t.time()

    def entry_signal(self, i, tk, ticks, ctx):
        if self.entered or self.gap_pct is None:
            return None
        if abs(self.gap_pct) < self.gap_min_pct:
            return None
        up = self.gap_pct > 0
        go = self.mode == "go"
        buy_ce = up if go else not up      # go: gap-up -> CE; fade: gap-up -> PE
        self.entered = True
        opt = "CE" if buy_ce else "PE"
        return Signal(opt, f"gap {self.gap_pct:+.2f}% ({self.mode})")


# --------------------------------------------------------------------------
# 5. NIFTY OI-wall bounce (re-test of a refuted idea)
# --------------------------------------------------------------------------
class NiftyWallBounce(Strategy):
    name = "nifty_wall_bounce"
    underlying = "NIFTY"

    def __init__(self, proximity_pct: float = 0.15, cooldown_min: int = 30, **kw):
        super().__init__(**kw)
        self.proximity_pct = proximity_pct
        self.cooldown_min = cooldown_min
        self.last_side = None

    def prepare(self, ticks, ctx):
        self.last_side = None
        if ticks:
            self._entry_after = ticks[0].t.time()

    def entry_signal(self, i, tk, ticks, ctx):
        prox = tk.spot * self.proximity_pct / 100.0
        put_wall = tk.wall_strike("put")
        call_wall = tk.wall_strike("call")
        if put_wall and abs(tk.spot - put_wall) <= prox and self.last_side != "put":
            self.last_side = "put"
            return Signal("CE", f"bounce off put wall {put_wall:.0f}")
        if call_wall and abs(tk.spot - call_wall) <= prox and self.last_side != "call":
            self.last_side = "call"
            return Signal("PE", f"reject at call wall {call_wall:.0f}")
        return None


# --------------------------------------------------------------------------
# 6. NIFTY RSI mean-reversion
# --------------------------------------------------------------------------
class NiftyIVDelta(Strategy):
    """IV + greeks, with a delta-selected ("good moneyness") strike.

    The premise, fixed in advance (not fitted to any week):

    * **Direction** — short-term spot momentum (``trend_window`` minutes).
    * **Moneyness** — instead of the ATM, buy the strike whose **|delta|** is
      closest to ``target_delta`` (~0.40). That is slightly OTM: cheaper per
      unit, more gamma per rupee, less theta per unit than the ATM.
    * **IV filter** — only buy when the ATM IV is at or below its own median
      over the last ``iv_window`` minutes. Buying rich vol is a headwind the
      premium move has to overcome.
    * **Exit** — the usual premium stop/target, a **vol-expansion exit** (ATM IV
      re-rates up by ``iv_expand`` points), a time stop, or EOD.

    This is a hypothesis with fixed parameters, not a validated edge. Five
    sessions cannot prove it; the report says so.
    """

    name = "nifty_iv_delta"
    underlying = "NIFTY"

    def __init__(self, target_delta: float = 0.40, trend_window: int = 15,
                 trend_min_pct: float = 0.12, iv_window: int = 60,
                 cooldown_min: int = 15, iv_expand: float = 0.02,
                 trail_pct: float = 0.25, **kw):
        # trail 25% off the peak: the 13:30 open P&L round-tripped from +2.3k
        # to +0.6k because this strategy had no trailing stop.
        kw.setdefault("trail_pct", trail_pct)
        # trend_min_pct default = 0.12% ~ one sigma of a 15-minute NIFTY move
        # (10% annualised vol -> ~147 pt/day -> ~29 pt/15 min ~ 0.12%), i.e. a
        # move that is actually a move rather than bid-ask noise. A 0.02%
        # threshold trades 4-point noise and bleeds theta+costs.
        super().__init__(**kw)
        self.target_delta = target_delta
        self.trend_window = trend_window
        self.trend_min_pct = trend_min_pct
        self.iv_window = iv_window
        self.cooldown_min = cooldown_min
        self.iv_expand = iv_expand
        self.last_entry = None

    # --- helpers -------------------------------------------------------
    @staticmethod
    def _iv(tk: Tick) -> float:
        vals = [v for v in (tk.ce_iv, tk.pe_iv) if v and v > 0]
        return sum(vals) / len(vals) if vals else 0.0

    @staticmethod
    def _t_years(tk: Tick) -> float:
        exp = _date.fromisoformat(tk.expiry)
        exp_dt = _dt.combine(exp, _time(15, 30))
        secs = (exp_dt - tk.t.replace(tzinfo=None)).total_seconds()
        return max(secs / (365.0 * 24 * 3600), _gr.MIN_T_YEARS)

    def _pick_strike(self, tk: Tick, opt: str) -> float | None:
        """Strike whose |delta| is closest to ``target_delta`` on ``opt`` side."""
        if not tk.chain:
            return None
        t = self._t_years(tk)
        best = None
        for k, (ce, pe) in tk.chain.items():
            px = ce if opt == "CE" else pe
            if px <= 0:
                continue
            if abs(k - tk.spot) > 400:      # only near-the-money candidates
                continue
            fwd = _gr.implied_forward(k, ce, pe, t) if ce > 0 and pe > 0 else None
            fwd = fwd or tk.spot * math.exp(_gr.RISK_FREE * t)
            iv = _gr.implied_vol(px, fwd, k, t, opt)
            if not iv:
                continue
            d = abs(_gr.greeks_from_iv(fwd, k, t, iv, opt).delta)
            score = abs(d - self.target_delta)
            if best is None or score < best[0]:
                best = (score, float(k))
        return best[1] if best else None

    # --- hooks ---------------------------------------------------------
    def prepare(self, ticks, ctx):
        self.spots = [t.spot for t in ticks]
        self.ivs = [self._iv(t) for t in ticks]
        self.last_entry = None
        if ticks:
            self._entry_after = ticks[0].t.time()

    def entry_signal(self, i, tk, ticks, ctx):
        if i < self.trend_window + 1:
            return None
        if self.last_entry is not None:
            if (tk.t - self.last_entry).total_seconds() / 60.0 < self.cooldown_min:
                return None
        prev = self.spots[i - self.trend_window]
        if prev <= 0:
            return None
        ret = (tk.spot - prev) / prev * 100.0
        if abs(ret) < self.trend_min_pct:
            return None
        opt = "CE" if ret > 0 else "PE"

        # IV must not be rich versus its own recent median
        window = [v for v in self.ivs[max(0, i - self.iv_window):i + 1] if v > 0]
        cur_iv = self.ivs[i]
        if len(window) >= 20 and cur_iv > 0:
            med = sorted(window)[len(window) // 2]
            if cur_iv > med:
                return None

        strike = self._pick_strike(tk, opt)
        if strike is None:
            return None
        self.last_entry = tk.t
        return Signal(opt, f"IV cheap + {ret:+.2f}%/{self.trend_window}m; "
                           f"delta~{self.target_delta:.2f} @ {strike:.0f}",
                      "LONG", strike=strike)

    def exit_hook(self, pos, tk, ticks, ctx):
        cur = self._iv(tk)
        entry_iv = getattr(pos, "entry_iv", 0.0)
        if entry_iv <= 0:
            return None
        if cur > 0 and cur - entry_iv >= self.iv_expand:
            return "IV_EXPAND"
        return None


class NiftyOpenStraddle(Strategy):
    """ATM straddle at the open, held for the session (naked long vol).

    The purest "NIFTY will move" bet: no direction, no signal — buy the ATM
    CE+PE on the first tradeable bar and hold to the premium stop/target, the
    time stop, or EOD. It is the cleanest test of whether an intraday NIFTY
    move is large enough to pay for **both legs and two round trips**.

    ``side="SHORT"`` flips it into the seller control (sell the straddle at the
    open), which is *not* naked buying and is excluded from ``--naked-only``.
    """

    name = "nifty_open_straddle"
    underlying = "NIFTY"

    def __init__(self, entry_after_min: int = 0, side: str = "LONG",
                 max_hold_min: int = 60, trail_pct: float = 0.15,
                 iv_drop: float = 0.02, **kw):
        kw.setdefault("max_hold_min", max_hold_min)
        kw.setdefault("trail_pct", trail_pct)
        super().__init__(**kw)
        self.entry_after_min = entry_after_min
        self.side = str(side).upper()
        self.iv_drop = iv_drop
        self.entered = False

    def prepare(self, ticks, ctx):
        self.entered = False
        if ticks:
            idx = min(self.entry_after_min, len(ticks) - 1)
            self._entry_after = ticks[idx].t.time()

    def entry_signal(self, i, tk, ticks, ctx):
        if self.entered or tk.ce_ltp <= 0 or tk.pe_ltp <= 0:
            return None
        self.entered = True
        return Signal("STRADDLE",
                      f"{self.side} ATM straddle @ {tk.t:%H:%M} K{tk.atm_strike:.0f}",
                      "SHORT" if self.side == "SHORT" else "LONG")

    def exit_hook(self, pos, tk, ticks, ctx):
        # A long straddle is long vega: a 2-point IV crush is a real, fast loss
        # that a premium stop can miss. Exit on it rather than hoping for a move.
        if pos.direction != "LONG" or pos.entry_iv <= 0:
            return None
        cur = (tk.ce_iv + tk.pe_iv) / 2.0
        if cur > 0 and (pos.entry_iv - cur) >= self.iv_drop:
            return "IV_CRUSH"
        return None


class NiftySpotScalp(Strategy):
    """Minute-to-minute **spot** momentum scalp (continuous naked long premium).

    Every minute: if spot has moved at least ``threshold_pct`` over the last
    ``lookback`` minutes, buy the ATM option in that direction and hold for at
    most ``max_hold_min`` minutes, or until the premium stop/target. A cooldown
    stops one move from firing over and over.

    This exists to trade *continuously*, which is the opposite of selective —
    expect heavy cost drag. It is a paper experiment, not a demonstrated edge.
    """

    name = "nifty_spot_scalp"
    underlying = "NIFTY"

    def __init__(self, lookback: int = 5, threshold_pct: float = 0.08,
                 cooldown_min: int = 10, max_hold_min: int = 15,
                 sl_pct: float = 0.25, tp_pct: float = 0.50,
                 trail_pct: float = 0.20, **kw):
        super().__init__(sl_pct=sl_pct, tp_pct=tp_pct,
                         max_hold_min=max_hold_min, trail_pct=trail_pct, **kw)
        self.lookback = lookback
        self.threshold_pct = threshold_pct
        self.cooldown_min = cooldown_min
        self.last_entry = None

    def prepare(self, ticks, ctx):
        self.spots = [t.spot for t in ticks]
        self.last_entry = None
        if ticks:
            self._entry_after = ticks[0].t.time()

    def entry_signal(self, i, tk, ticks, ctx):
        if i < self.lookback:
            return None
        if self.last_entry is not None:
            if (tk.t - self.last_entry).total_seconds() / 60.0 < self.cooldown_min:
                return None
        prev = self.spots[i - self.lookback]
        if prev <= 0:
            return None
        ret = (tk.spot - prev) / prev * 100.0
        if abs(ret) < self.threshold_pct:
            return None
        self.last_entry = tk.t
        opt = "CE" if ret > 0 else "PE"
        return Signal(opt, f"spot {ret:+.2f}%/{self.lookback}m", "LONG")


# --------------------------------------------------------------------------
# Registry
# --------------------------------------------------------------------------
REGISTRY: dict[str, type[Strategy]] = {
    NiftyMomentum.name: NiftyMomentum,
    StockMomentum.name: StockMomentum,
    NiftyVRP.name: NiftyVRP,
    NiftyGap.name: NiftyGap,
    NiftyWallBounce.name: NiftyWallBounce,
    NiftyIVDelta.name: NiftyIVDelta,
    NiftyOpenStraddle.name: NiftyOpenStraddle,
    NiftySpotScalp.name: NiftySpotScalp,
}

STRATEGY_LABELS = {
    "nifty_momentum": "NIFTY long-premium momentum (ORB)",
    "stock_momentum": "Stock-option momentum",
    "nifty_vrp": "NIFTY premium-selling control (short straddle)",
    "nifty_gap": "NIFTY gap conditioning",
    "nifty_wall_bounce": "NIFTY OI-wall bounce (re-test)",
    "nifty_iv_delta": "NIFTY IV + greeks, delta-selected moneyness",
    "nifty_open_straddle": "NIFTY ATM straddle at open (naked long vol)",
    "nifty_spot_scalp": "NIFTY spot momentum scalp (continuous)",
}


def build(name: str, lots: int = 1, **overrides) -> Strategy:
    if name not in REGISTRY:
        raise KeyError(f"unknown strategy {name!r}; known: {sorted(REGISTRY)}")
    return REGISTRY[name](lots=lots, **overrides)
