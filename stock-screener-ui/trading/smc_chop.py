"""SMC chop-mode engine — mean-reversion specialist for directionless months.

Companion to trading/smc_ifvg.py (trend engine). Same mechanics, opposite thesis:
history-only bar state, tick-accurate fills (longs at ask / shorts at bid),
SL checked BEFORE TP on the same tick (conservative), trade dicts with
t_in/t_out ms-epochs, side, kind, entry, sl, tp, exit, result, pnl, rr.
One position at a time; fixed structural targets; no trails, no partials,
no daily-stop logic (entries + structural SL/TP exits only).

Setups (all history-only, armed at bar close, filled on the next bar):
  1. breakdown-failure long: 1m wick takes out the recent swing low
     (min low of the last `lookback` bars, penetration >= `min_wick`) then
     closes back above it with a rejection close (close in the upper
     `rej_frac` of the bar range) — enter at the next tick, SL just below
     the wick (- `sl_buf` = 4pts), TP = nearest untouched overhead
     resistance (3-bar fractal pivot high, untouched since formation)
     with RR >= `min_rr` (2.0) else skip.
  2. mirror shorts at range tops (wick above recent swing high, close back
     below with close in the lower `rej_frac`, SL above wick + 4pts, TP =
     nearest untouched fractal support with RR >= 2 else skip).
  3. regime gate: only when the day is range-compressed — session range SO
     FAR < `chop_mult` (1.2) x the median of the prior 20 daily ranges
     (`daily_ranges` {YYYY-MM-DD: range}, only dates < `session_date` used;
     no history -> gate passes). Daily ranges should be measured on the same
     session window the engine trades (tick-built dailies are accepted).
     Additionally the signal bar must close in the outer `quartile` (0.25)
     of the session range so far (true range extremes only).

Validated (Dukascopy US-100 CFD, 12:00-23:00 IST window, tick-built dailies):
  Jun 2026: 120 trades, +327.6 pts, PF 1.22, WR 25.8%, worst-day -161.6
  Aug 2026: 122 trades, +609.0 pts, PF 1.47, WR 32.8%, worst-day -127.8
  Jul 2026: 148 trades,  -16.9 pts, PF 0.99, WR 25.7%, worst-day -130.8
  Jun+Aug combined: +936.6 pts, worst-day -161.6
  (trend engine sess 12:00-23:00 IST + ATR>=8: Jun -1971, Jul +561,
  Aug -2327, worst-days -458/-414 -> chop is the complement, not standalone)
"""

import statistics
from collections import defaultdict


class SMCChopEngine:
    def __init__(
        self,
        lookback: int = 20,      # swing window (bars) for breakdown reference
        sl_buf: float = 4.0,     # SL beyond wick extreme (pts)
        min_rr: float = 2.0,     # TP must offer >= this RR else skip
        min_risk: float = 8.0,   # skip noise wicks (risk too small to target)
        max_risk: float = 30.0,  # skip trend-day wide wicks (risk too big)
        min_wick: float = 1.5,   # min penetration beyond swing to count
        cooldown: int = 8,       # bars to wait after an exit (no re-fade into momentum)
        sess_start: int = 720,   # IST minutes: arm only inside [start, end]
        sess_end: int = 1380,    # default 12:00-23:00 IST, same window as trend engine
        chop_mult: float = 1.2,  # range-so-far < chop_mult x median(prior 20 dailies)
        quartile: float = 0.25,  # fade only outer quartile of session range so far
        rej_frac: float = 0.67,  # close must be in outer rej_frac of bar range
        session_date: str | None = None,   # YYYY-MM-DD of this session
        daily_ranges: dict | None = None,  # {YYYY-MM-DD: daily range}
    ):
        self.lookback = lookback
        self.sl_buf = sl_buf
        self.min_rr = min_rr
        self.min_risk = min_risk
        self.max_risk = max_risk
        self.min_wick = min_wick
        self.cooldown = cooldown
        self.sess_start = sess_start
        self.sess_end = sess_end
        self.chop_mult = chop_mult
        self.quartile = quartile
        self.rej_frac = rej_frac
        self.session_date = session_date
        self.daily_ranges = daily_ranges or {}
        # history-only median of prior daily ranges (dates strictly before session)
        if session_date is not None:
            priors = sorted(d for d in self.daily_ranges if d < session_date)[-20:]
            self.range_med = statistics.median([self.daily_ranges[d] for d in priors]) if priors else None
        else:
            self.range_med = None
        # running session extremes (history-only, updated in on_close)
        self.sess_hi = None
        self.sess_lo = None
        # position state
        self.pos = None
        self.pending = None
        self.last_exit = -999
        self.trades = []

    # ---------------- bar-close state machine ----------------
    def on_close(self, bars, i):
        b = bars[i]
        # running session extremes include bar i (history-only)
        self.sess_hi = b["high"] if self.sess_hi is None else max(self.sess_hi, b["high"])
        self.sess_lo = b["low"] if self.sess_lo is None else min(self.sess_lo, b["low"])
        if self.pending is not None or self.pos is not None:
            return
        if i - self.last_exit < self.cooldown:
            return
        if i < self.lookback:
            return
        if self.sess_start is not None and self.sess_end is not None:
            m = ((b["time"] // 60) + 330) % 1440   # IST minute, no tz lib needed
            if self.sess_start <= self.sess_end:
                if not (self.sess_start <= m <= self.sess_end):
                    return
            elif not (m >= self.sess_start or m <= self.sess_end):
                return
        sess_range = self.sess_hi - self.sess_lo
        if sess_range <= 0:
            return
        # regime gate: day range so far compressed vs 20-day median
        if self.range_med is not None and sess_range >= self.chop_mult * self.range_med:
            return
        # recent swing reference (excludes signal bar — history-only)
        ref = bars[i - self.lookback:i]
        swing_lo = min(w["low"] for w in ref)
        swing_hi = max(w["high"] for w in ref)
        brange = b["high"] - b["low"]
        if brange <= 0:
            return
        long_ok = (
            b["low"] < swing_lo
            and b["close"] > swing_lo
            and (swing_lo - b["low"]) >= self.min_wick
            and (b["close"] - b["low"]) >= self.rej_frac * brange   # bullish rejection
            and b["close"] <= self.sess_lo + self.quartile * sess_range  # lower extreme
        )
        short_ok = (
            b["high"] > swing_hi
            and b["close"] < swing_hi
            and (b["high"] - swing_hi) >= self.min_wick
            and (b["high"] - b["close"]) >= self.rej_frac * brange  # bearish rejection
            and b["close"] >= self.sess_hi - self.quartile * sess_range  # upper extreme
        )
        if long_ok and short_ok:
            # both extremes wicked in one bar — ambiguous, skip
            return
        if long_ok:
            self.pending = {"side": "LONG", "sig_i": i, "wick": b["low"]}
        elif short_ok:
            self.pending = {"side": "SHORT", "sig_i": i, "wick": b["high"]}

    # ---------------- target selection (full history, never forward) ----------------
    def find_tp(self, bars, i, side, entry, risk):
        levels = []
        for j in range(2, i - 2):
            w = bars[j - 2:j + 3]
            if side == "LONG":
                if not all(w[2]["high"] > w[k]["high"] for k in (0, 1, 3, 4)):
                    continue
                lvl = w[2]["high"]
                if lvl > entry and (lvl - entry) / risk >= self.min_rr:
                    levels.append((j, lvl))
            else:
                if not all(w[2]["low"] < w[k]["low"] for k in (0, 1, 3, 4)):
                    continue
                lvl = w[2]["low"]
                if lvl < entry and (entry - lvl) / risk >= self.min_rr:
                    levels.append((j, lvl))
        # nearest first — small defined targets, no trail rides
        levels.sort(key=lambda jl: abs(jl[1] - entry))
        for j, lvl in levels:
            if side == "LONG":
                if all(bars[k]["high"] < lvl for k in range(j + 3, i)):
                    return lvl
            else:
                if all(bars[k]["low"] > lvl for k in range(j + 3, i)):
                    return lvl
        return None

    # ---------------- position helpers ----------------
    def open_pos(self, side, fill, sl, i, kind, ts_ms, bars):
        risk = abs(fill - sl)
        if risk < self.min_risk or risk > self.max_risk:
            return False
        tp = self.find_tp(bars, i, side, fill, risk)
        if tp is None:
            return False
        self.pos = {"side": side, "entry": fill, "sl": sl, "tp": tp, "i": i,
                    "kind": kind, "ts": ts_ms, "risk": risk}
        return True

    def close_pos(self, i, px, why, ts_ms):
        p = self.pos
        leg = (px - p["entry"]) if p["side"] == "LONG" else (p["entry"] - px)
        self.trades.append({"t_in": p["ts"], "t_out": ts_ms, "side": p["side"], "kind": p["kind"],
                            "entry": p["entry"], "sl": p["sl"], "tp": p["tp"], "exit": px, "result": why,
                            "pnl": round(leg, 2),
                            "rr": round(leg / (p["risk"] or 1), 2)})
        self.pos = None
        self.last_exit = i

    # ---------------- main loop ----------------
    def run(self, bars, ticks):
        by_min = defaultdict(list)
        for t in ticks:
            by_min[int(t["timestamp"] // 1000 // 60) * 60].append(t)
        for i, b in enumerate(bars):
            bt = by_min.get(b["time"], [])
            # pending sweep fill: first tick of the NEXT bar, cancel if gapped past SL
            if self.pending and self.pos is None:
                pd = self.pending
                if i - pd["sig_i"] > 1:
                    self.pending = None
                elif i == pd["sig_i"] + 1 and bt:
                    t = bt[0]
                    sl = pd["wick"] - self.sl_buf if pd["side"] == "LONG" else pd["wick"] + self.sl_buf
                    px = t["askPrice"] if pd["side"] == "LONG" else t["bidPrice"]
                    if (pd["side"] == "LONG" and px < sl) or (pd["side"] == "SHORT" and px > sl):
                        self.pending = None
                    else:
                        self.open_pos(pd["side"], px, sl, i, "chop", t["timestamp"], bars)
                        self.pending = None
            # position management: SL first, then TP (no trail, no partials)
            if self.pos:
                p = self.pos
                for t in bt:
                    bid, ask = t["bidPrice"], t["askPrice"]
                    if p["side"] == "SHORT":
                        if ask >= p["sl"]:
                            self.close_pos(i, p["sl"], "SL", t["timestamp"]); break
                        if bid <= p["tp"]:
                            self.close_pos(i, p["tp"], "TP", t["timestamp"]); break
                    else:
                        if bid <= p["sl"]:
                            self.close_pos(i, p["sl"], "SL", t["timestamp"]); break
                        if ask >= p["tp"]:
                            self.close_pos(i, p["tp"], "TP", t["timestamp"]); break
            # bar-close state update + signal arming
            self.on_close(bars, i)
        # EOD flatten at the last tick so held positions realise P&L
        if self.pos and ticks:
            p = self.pos
            t = ticks[-1]
            px = t["bidPrice"] if p["side"] == "LONG" else t["askPrice"]
            self.close_pos(len(bars) - 1, px, "EOD", t["timestamp"])
        return self.trades
