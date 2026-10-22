"""Strategy registry + event-driven intraday engine.

Honesty contract (mirrors the programme's research rules)
--------------------------------------------------------
* A signal is computed on the **close of a completed bar** and filled at the
  **next bar's** recorded premium. We cannot see the fill bar's future.
* **No profit exit on the fill bar.** A stop is allowed on the fill bar; a
  target is not.
* **Stop is checked before target** on every bar.
* **A crossed target fills at the target**, never at the bar close (the close
  can overshoot the level and booking the overshoot flatters every target).
  Stops fill at the close — the conservative side.
* A position is marked at **the contract it holds** (the chain price of its
  entry strike), never at the current ATM: the ATM drifts, so an ATM mark
  silently prices a different contract. A dead or absent leg carries the last
  known price *for that strike*; a strike that was never priced leaves the
  trade **unpriced** and it is never booked.
* No overnight carry: every position is flattened at ``eod_exit``, and no
  position is opened at/after it.

The engine trades **ATM** contracts, priced from the tape's real
``atm_ce_ltp`` / ``atm_pe_ltp``. OTM strike selection needs the 1-minute
contract panel or a live chain and is deliberately out of scope for v1 (a
documented limitation, not a hidden one).
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field
from datetime import date as _date, datetime as _dt, time as _time

from . import greeks as _gr
from . import spec
from .costs import (COSTS_VERSION, break_even_move_points,
                    break_even_move_points_multi, option_round_trip_cost)
from .tape import Tick


def chain_px(tk: Tick, strike: float, opt: str) -> float:
    """Premium of ``strike``/``opt`` at ``tk`` — 0.0 when it is not priced.

    **Never** substitutes the current ATM for a *different* contract: the ATM
    drifts as spot moves (23,400 -> 23,350), so marking a held 23,400 leg at
    the ATM silently prices a different instrument. The only exception is the
    ATM contract itself: a tape without a chain records just the ATM premium,
    and that *is* this contract's price.

    A row that exists but whose leg is 0/None is a **dead** leg -> 0.0 (the
    caller decides whether to carry the last known price or to treat the
    position as unpriced).
    """
    row = (tk.chain or {}).get(int(strike))
    if row is not None:
        v = row[0] if opt.upper() == "CE" else row[1]
        return float(v) if v and v > 0 else 0.0
    if int(strike) == int(tk.atm_strike):
        p = tk.premium(opt)
        return float(p) if p and p > 0 else 0.0
    return 0.0


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
    stop_premium: float = 0.0    # ratcheted stop (SL -> breakeven -> trail)
    strike: float = 0.0          # ATM strike at entry (real, from the fill tick)
    entry_iv: float = 0.0        # IV of the chosen leg at entry (for vol exits)
    #: leg -> the last price seen for **this** strike ("CE"/"PE"). Carried
    #: forward when the chain drops the strike or the leg goes dead.
    last_leg_px: dict = field(default_factory=dict)

    def premium_at(self, tk: Tick) -> float:
        """Mark at the **entry strike**, never at the current ATM.

        The ATM drifts as spot moves (e.g. 23400 -> 23350), so pricing at
        ``tk.atm_strike`` silently switches contracts mid-trade. The chain
        price of the held strike is used; when that leg is dead or the strike
        is missing from the chain, the **last known price for this strike** is
        carried forward. A strike that was never priced leaves the position
        *unpriced* (:attr:`priced` is False) — never a fabricated mark.
        """
        if self.opt == "STRADDLE":
            return self._leg_px(tk, "CE") + self._leg_px(tk, "PE")
        return self._leg_px(tk, self.opt)

    def _leg_px(self, tk: Tick, opt: str) -> float:
        """Price one leg at the held strike, carrying the last known price."""
        px = chain_px(tk, self.strike, opt)
        if px > 0:
            self.last_leg_px[opt] = px
            return px
        # dead leg / strike absent from the chain -> the last price we saw
        # for THIS strike (never the current ATM: a different contract).
        return float(self.last_leg_px.get(opt, 0.0))

    @property
    def legs(self) -> tuple:
        """The option legs this position holds."""
        return ("CE", "PE") if self.opt == "STRADDLE" else (self.opt,)

    @property
    def priced(self) -> bool:
        """True when every held leg has a known price (nothing fabricated)."""
        return all(float(self.last_leg_px.get(l, 0.0)) > 0 for l in self.legs)

    def leg_premiums(self) -> list[float]:
        """Entry premium of each held leg (used for the straddle break-even)."""
        if self.opt == "STRADDLE":
            return [p for p in (self.entry_ce, self.entry_pe) if p > 0]
        return [self.entry_premium] if self.entry_premium > 0 else []


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
    #: False when the exit could not be priced (a dead/absent leg) — such a
    #: trade is never booked, because its P&L would be fabricated.
    priced: bool = True
    #: The charge schedule this trade was priced with.
    costs_version: str = COSTS_VERSION
    #: Per-leg entry/exit premiums (a straddle is two legs, four orders).
    entry_ce: float = 0.0
    entry_pe: float = 0.0
    exit_ce: float = 0.0
    exit_pe: float = 0.0
    leg_orders: int = 1

    def as_row(self) -> dict:
        return self.__dict__.copy()

    def trade_id(self) -> str:
        """Stable identity: ``strategy|symbol|entry_bar``.

        The entry bar (the fill bar's timestamp) plus the strategy is what
        makes a trade unique — two strategies may hold the same contract in
        the same minute, and one strategy may re-enter the same contract
        later. Used to make the live runner's booking idempotent.
        """
        return f"{self.strategy}|{self.symbol}|{self.entry_time}"


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
                 trail_pct: float = 0.0, be_trigger_pct: float = 0.08,
                 open_veto_min: float = 0.0, **params):
        self.lots = lots
        self.lot = lot or spec.get_lot(self.underlying)
        self.sl_pct = sl_pct
        self.tp_pct = tp_pct
        self.max_hold_min = max_hold_min
        self.eod_exit = eod_exit
        self.trail_pct = trail_pct      # 0 = off; else trail this far off the peak
        # Once the trade has run this far in our favour, ratchet the stop to
        # breakeven-after-costs (never leave a winner able to round-trip).
        self.be_trigger_pct = be_trigger_pct
        # No entries for this many minutes after the first tape bar. The
        # opening drive is the most whipsaw-prone window (2026-10-21: two
        # 25%-SL losses at 09:32/09:33 were both opening-drive longs).
        self.open_veto_min = open_veto_min
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

    def _opening_drive_veto(self, tk: Tick, ticks: list[Tick]) -> bool:
        """True while the opening drive is still unresolved (no entries)."""
        if not self.open_veto_min or not ticks:
            return False
        mins = (tk.t - ticks[0].t).total_seconds() / 60.0
        return mins < self.open_veto_min

    # --- engine --------------------------------------------------------
    def run(self, ticks: list[Tick], ctx: dict) -> list[Trade]:
        ticks = list(ticks or [])
        if not ticks:
            return []
        # One tape day carries one chain and therefore one expiry. If a stray
        # row names a different expiry, keep the dominant one: a position must
        # never be marked against a chain that does not contain its contract.
        expiry = Counter(t.expiry for t in ticks).most_common(1)[0][0]
        ticks = [t for t in ticks if t.expiry == expiry]
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
                if pos is not None and pos.priced:
                    trades.append(self._close(pos, ticks[i - 1], "EOD"))
                pos = None
                self.prepare(ticks[i:], ctx)
                current_day = tk.t.date()

            # Expiry guard: a held contract is never marked on another
            # expiry's chain. Settle it on the last bar that carried the held
            # expiry (unpriced -> excluded entirely, never fabricated).
            if pos is not None and tk.expiry != pos.expiry:
                prev = next((t for t in reversed(ticks[:i])
                             if t.expiry == pos.expiry), None)
                if prev is not None and pos.priced:
                    trades.append(self._close(pos, prev, "EXPIRY"))
                pos = None

            if pos is None:
                if tk.t.time() < self._entry_after:
                    i += 1
                    continue
                sig = self.entry_signal(i, tk, ticks, ctx)
                # Two hard entry guards:
                #  * never fill on the last bar — there is no bar after it to
                #    observe the exit, so the round-trip cannot be settled;
                #  * never fill at/after the EOD cut — a 15:22 entry could
                #    only ever be closed at 15:22 (a -₹65 round trip for
                #    nothing). The fill bar must be strictly before it.
                if (sig and i + 2 < n
                        and ticks[i + 1].t.time() < self.eod_exit):
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
            # An unpriced position has no honest exit premium: it is excluded
            # rather than booked at 0 (a fabricated -100% loss).
            if pos.priced:
                trades.append(self._close(pos, last, final))
        return trades

    _entry_after = _time(9, 15)

    def _open(self, sig: Signal, fill: Tick, fill_index: int,
              entry_index: int) -> Position:
        strike = float(sig.strike) if sig.strike else float(fill.atm_strike)
        if sig.opt == "STRADDLE":
            entry_ce = chain_px(fill, strike, "CE")
            entry_pe = chain_px(fill, strike, "PE")
            entry_premium = entry_ce + entry_pe
            leg_orders = 2
            last_leg_px = {"CE": entry_ce, "PE": entry_pe}
        else:
            entry_premium = chain_px(fill, strike, sig.opt)
            leg_orders = 1
            last_leg_px = {sig.opt: entry_premium}
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
            stop_premium=(entry_premium * (1 + self.sl_pct)
                          if sig.direction == "SHORT"
                          else entry_premium * (1 - self.sl_pct)),
            strike=strike, entry_iv=entry_iv, last_leg_px=last_leg_px,
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
        if not pos.priced:
            # The held leg has no price at all — never fabricate a mark and
            # never invent a -100% "stop". Keep the position open.
            return None
        pos.peak_premium = max(pos.peak_premium, prem)
        pos.trough_premium = min(pos.trough_premium, prem)
        entry = pos.entry_premium
        moved = (prem - entry) / entry if entry else 0.0
        long = pos.direction == "LONG"
        favorable = moved if long else -moved

        # Best favourable excursion so far, in % of the entry premium.
        best = pos.peak_premium if long else pos.trough_premium
        best_fav = ((best - entry) / entry) if long else ((entry - best) / entry)

        is_fill_bar = tk.t == ticks[pos.fill_index].t
        # hard stop first (allowed even on the fill bar)
        if favorable <= -self.sl_pct:
            return "SL"
        if is_fill_bar:
            return None          # only a stop may fire on the fill bar

        # --- ratchet: breakeven after costs, then trail the best print -----
        # The trail gives back a fraction of the **profit**, not a fraction of
        # the premium:  stop = entry + (1 - trail) * (best - entry)  for a
        # long (mirrored for a short). The old formula (best * (1 - trail))
        # gave back a slice of the premium — at arming it gave back 100% of
        # the profit, and higher up it gave back a *smaller* share, i.e. the
        # trail loosened exactly when it should have tightened.
        # The breakeven-after-costs level is the floor (long) / ceiling
        # (short): the stop can never sit on the wrong side of it.
        # Monotonic — the stop can only improve, never worsen.
        ratchet: float | None = None
        if self.be_trigger_pct > 0 and best_fav >= self.be_trigger_pct:
            legs = pos.leg_premiums()
            if len(legs) > 1:
                # A straddle is two legs / four orders: its break-even is the
                # sum of the legs' break-evens, not one round trip on the
                # combined premium.
                be = break_even_move_points_multi(legs, pos.qty,
                                                  is_short=(not long))
            else:
                be = break_even_move_points(entry, pos.qty, is_short=(not long))
            # No root inside the legal exit range: there is no honest
            # breakeven, so leave the original stop alone instead of using the
            # search bound (which used to push a short's stop to/below 0).
            if getattr(be, "found", True):
                ratchet = (entry + float(be)) if long else (entry - float(be))
        # The trail is armed by the same trigger as the break-even — unless
        # the trigger is switched off (be_trigger_pct == 0), in which case the
        # trail must still work (it is the only protection left) and it arms
        # on the first profitable print.
        trail_armed = (best_fav >= self.be_trigger_pct if self.be_trigger_pct > 0
                       else best_fav > 0)
        if self.trail_pct > 0 and trail_armed:
            trail_stop = (entry + (1 - self.trail_pct) * (best - entry) if long
                          else entry - (1 - self.trail_pct) * (entry - best))
            if ratchet is None:
                ratchet = trail_stop
            else:
                ratchet = (max(ratchet, trail_stop) if long
                           else min(ratchet, trail_stop))
        if ratchet is not None:
            pos.stop_premium = (max(pos.stop_premium, ratchet) if long
                                else min(pos.stop_premium, ratchet))

        # Stop before target: the ratcheted stop can never sit the wrong side
        # of breakeven once it has been armed.
        if long and prem <= pos.stop_premium:
            return "TRAIL"
        if (not long) and prem >= pos.stop_premium:
            return "TRAIL"

        if favorable >= self.tp_pct:
            return "TP"
        held = (tk.t - pos.entry_time).total_seconds() / 60.0
        # The clock only closes trades that never got going. Once the stop has
        # been lifted past the entry the position is protected and the clock
        # is disarmed; cutting a runner at 15 minutes was the single biggest
        # leak in the 2026-10-21 coded book (+₹2,013 and +₹1,753 were both
        # TIME exits below their peaks).
        protected = (pos.stop_premium > entry) if long else (pos.stop_premium < entry)
        if held >= self.max_hold_min and not protected:
            return "TIME"
        if tk.t.time() >= self.eod_exit:
            return "EOD"
        return self.exit_hook(pos, tk, ticks, ctx)

    def _close(self, pos: Position, tk: Tick, reason: str) -> Trade:
        long = pos.direction == "LONG"
        entry = pos.entry_premium
        exit_premium = pos.premium_at(tk)
        target = ((entry * (1 + self.tp_pct) if long
                   else entry * (1 - self.tp_pct)) if entry > 0 else 0.0)
        # A target that was crossed fills **at the target**, not at the bar
        # close: the close can overshoot the level, and booking the overshoot
        # flatters every target. Stops keep the close (conservative).
        if reason == "TP" and target > 0:
            exit_premium = (min(exit_premium, target) if long
                            else max(exit_premium, target))
        # Straddle = 2 legs / 4 orders; model each leg's costs at its own
        # premium.
        if pos.opt == "STRADDLE":
            ce_x, pe_x = pos._leg_px(tk, "CE"), pos._leg_px(tk, "PE")
            combined = ce_x + pe_x
            if reason == "TP" and target > 0 and combined > 0 and combined != target:
                # The target was hit on the combined premium — split it back
                # across the legs so both round trips stay consistent with
                # the booked exit premium.
                scale = target / combined
                ce_x, pe_x = ce_x * scale, pe_x * scale
            leg1 = option_round_trip_cost(pos.entry_ce, ce_x, pos.qty,
                                          not long)
            leg2 = option_round_trip_cost(pos.entry_pe, pe_x, pos.qty,
                                          not long)
            gross = leg1["gross_pnl"] + leg2["gross_pnl"]
            costs = leg1["costs"] + leg2["costs"]
            net = leg1["net_pnl"] + leg2["net_pnl"]
            exit_ce, exit_pe = ce_x, pe_x
        else:
            rc = option_round_trip_cost(entry, exit_premium, pos.qty, not long)
            gross, costs, net = rc["gross_pnl"], rc["costs"], rc["net_pnl"]
            exit_ce = pos._leg_px(tk, "CE")
            exit_pe = pos._leg_px(tk, "PE")
        pts = net / pos.qty
        return Trade(
            strategy=pos.strategy, underlying=pos.underlying,
            symbol=spec.option_symbol(pos.underlying, pos.expiry,
                                      pos.strike or tk.atm_strike, pos.opt)
            if pos.opt in ("CE", "PE") else f"{pos.underlying} {pos.expiry} STRADDLE",
            opt=pos.opt, direction=pos.direction, lots=pos.lots, lot=pos.lot,
            qty=pos.qty, expiry=pos.expiry,
            entry_time=pos.entry_time.isoformat(), entry_premium=round(entry, 2),
            entry_spot=round(pos.entry_spot, 2),
            exit_time=tk.t.isoformat(), exit_premium=round(exit_premium, 2),
            exit_spot=round(tk.spot, 2), exit_reason=reason,
            hold_min=round((tk.t - pos.entry_time).total_seconds() / 60.0, 1),
            gross_pnl=round(gross, 2), costs=round(costs, 2),
            net_pnl=round(net, 2), points=round(pts, 3), reason=pos.reason,
            strike=round(pos.strike, 2), sl_pct=self.sl_pct, tp_pct=self.tp_pct,
            priced=pos.priced, costs_version=COSTS_VERSION,
            entry_ce=round(pos.entry_ce, 2), entry_pe=round(pos.entry_pe, 2),
            exit_ce=round(exit_ce, 2), exit_pe=round(exit_pe, 2),
            leg_orders=pos.leg_orders,
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
                 trail_pct: float = 0.20, open_veto_min: float = 20,
                 twap_window: int = 30, **kw):
        super().__init__(sl_pct=sl_pct, tp_pct=tp_pct,
                         max_hold_min=max_hold_min, trail_pct=trail_pct,
                         open_veto_min=open_veto_min, **kw)
        self.twap_window = twap_window
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
        if self._opening_drive_veto(tk, ticks):
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
        opt = "CE" if ret > 0 else "PE"
        # Don't fight the 30-minute trend: a 5-minute bounce below the mean is
        # how the 11:05 CE long lost ₹2,455 on 2026-10-21.
        if self.twap_window and i >= self.twap_window:
            mean = sum(self.spots[i - self.twap_window:i]) / self.twap_window
            if opt == "CE" and tk.spot < mean:
                return None
            if opt == "PE" and tk.spot > mean:
                return None
        self.last_entry = tk.t
        return Signal(opt, f"spot {ret:+.2f}%/{self.lookback}m", "LONG")


# --------------------------------------------------------------------------
# 9. NIFTY pin reversal (failed break at a repeatedly-tested level)
# --------------------------------------------------------------------------
class NiftyPinReversal(Strategy):
    """Buy the reclaim after a failed break of a repeatedly-tested level.

    Origin: 2026-10-21 — the session low (22,663) was tested ~8x; each dip
    below was swept and reclaimed, then the reversal squeezed to 22,712.
    This strategy enters the OTHER side: a low sweep that reclaims -> long CE,
    a high spike that fails back below -> long PE.

    No lookahead: the level and its touch count come from bars strictly
    before the sweep candidate (``ticks[:i-1]``), the sweep is the previous
    bar's close, and the reclaim is the current completed bar ``tk``.
    The engine fills on the next bar (existing contract).
    """

    name = "nifty_pin_reversal"
    underlying = "NIFTY"

    def __init__(self, touch_tol_pts: float = 6.0, min_touches: int = 3,
                 sweep_max_pts: float = 15.0, cooldown_min: int = 15,
                 sl_pct: float = 0.22, tp_pct: float = 0.45,
                 max_hold_min: int = 45, **kw):
        super().__init__(sl_pct=sl_pct, tp_pct=tp_pct,
                         max_hold_min=max_hold_min, **kw)
        self.touch_tol_pts = touch_tol_pts
        self.min_touches = min_touches
        self.sweep_max_pts = sweep_max_pts
        self.cooldown_min = cooldown_min
        self.last_entry = None

    def prepare(self, ticks, ctx):
        self.last_entry = None
        if ticks:
            self._entry_after = ticks[0].t.time()

    @staticmethod
    def _count_touches(spots: list[float], level: float, tol: float) -> int:
        """Bars entering the |spot - level| <= tol zone; runs collapse to one."""
        n = 0
        in_zone = False
        for s in spots:
            zone = abs(s - level) <= tol
            if zone and not in_zone:
                n += 1
            in_zone = zone
        return n

    def entry_signal(self, i, tk, ticks, ctx):
        if i < 3:
            return None
        if self.last_entry is not None:
            if (tk.t - self.last_entry).total_seconds() / 60.0 < self.cooldown_min:
                return None
        # Strictly before the sweep candidate: the sweep bar itself must not
        # define the level it is breaking.
        window = ticks[:i - 1]
        if len(window) < self.min_touches:
            return None
        spots = [t.spot for t in window]
        prev = ticks[i - 1]

        lo = min(spots)
        lo_edge = lo - self.touch_tol_pts
        if (prev.spot < lo_edge and (lo - prev.spot) <= self.sweep_max_pts
                and tk.spot >= lo_edge):
            touches = self._count_touches(spots, lo, self.touch_tol_pts)
            if touches >= self.min_touches:
                self.last_entry = tk.t
                return Signal("CE",
                              f"pin sweep reclaimed {lo:.0f} "
                              f"({touches}x touches, sweep {lo - prev.spot:.0f}pt)",
                              "LONG")

        hi = max(spots)
        hi_edge = hi + self.touch_tol_pts
        if (prev.spot > hi_edge and (prev.spot - hi) <= self.sweep_max_pts
                and tk.spot <= hi_edge):
            touches = self._count_touches(spots, hi, self.touch_tol_pts)
            if touches >= self.min_touches:
                self.last_entry = tk.t
                return Signal("PE",
                              f"pin spike rejected {hi:.0f} "
                              f"({touches}x touches, spike {prev.spot - hi:.0f}pt)",
                              "LONG")
        return None


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
    NiftyPinReversal.name: NiftyPinReversal,
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
    "nifty_pin_reversal": "NIFTY pin reversal (failed break at tested level)",
}


def build(name: str, lots: int = 1, **overrides) -> Strategy:
    if name not in REGISTRY:
        raise KeyError(f"unknown strategy {name!r}; known: {sorted(REGISTRY)}")
    return REGISTRY[name](lots=lots, **overrides)
