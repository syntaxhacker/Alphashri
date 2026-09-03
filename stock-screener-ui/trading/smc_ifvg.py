"""SMC iFVG strategy engine — clean rebuild of the validated v2 configuration.

Strictly history-only: state at bar i uses bars[0..i]; fills/exits resolve on raw ticks.
Tick convention: long entries fill at ask, short entries at bid; exits: SL checked BEFORE TP
on the same tick (conservative); short exits at ask, long exits at bid.

Bar-close state machine (v2 semantics — do not reorder without re-validating):
  1. fractal pivots (3-bar, 2 each side, strict) -> trail refs + BOS levels
  2. BOS: close beyond last unbroken pivot -> bos_dir
  3. new FVG from bars[i-2..i] (gap > gap_min)
  4. while flat, post-cooldown: mark inversions one-pass (first match wins, break) and arm;
     else arm retest into nearest active opposing zone beyond price
  5. TP: nearest untouched opposing structure (fractal pivot OR active FVG edge) across full
     history with rr >= min_rr; positions without a structural TP use a structure trail
"""
from collections import defaultdict


class SMCIFVGEngine:
    def __init__(
        self,
        gap_min: float = 2.0,
        sl_buf: float = 6.0,
        retest_tol: float = 2.0,
        min_rr: float = 3.0,  # validated: +875 vs +696 pts on 6 tick sessions (RR2)
        min_risk: float = 5.0,
        cooldown: int = 3,
        retest_ttl: int = 30,
        max_zone_dist: float | None = None,  # disabled: per-trade sound but system-negative (path dependence), see docs
        max_zone_age: int | None = None,      # skip arms on zones older than this many bars (forensics: PF 0.87->0.94)
        min_displacement_r: float | None = None,  # skip arms when |close-close[3]| < this * ATR(14) (dead tape)
        inv_flip_margin: float | None = None,  # strong inversion (close clears zone edge by >= margin)
                                               # flips bos_dir immediately instead of dying unaligned
        entries: str = "both",               # "both" | "inv" | "retest" — enables stacked/divided deployment
        tp_mode: str = "far",                # "far": farthest RR>=min_rr target (LONG); "near": nearest — fixes LONG/SHORT asymmetry
        partials: bool = False,              # take half at +1R, move stop to breakeven
        rev_exit: bool = False,              # opposite-side fill closes the open position (REV) instead of waiting for SL
        shared: dict | None = None,          # cross-stack registry {"fills": [(ts_ms, side)]} for dedupe
        sess_start: int | None = None,       # IST minutes: arm only inside [start, end] (wrap-aware)
        sess_end: int | None = None,
        atr_min: float | None = None,        # arm only if 1m ATR(14) >= this (volatility gate)
        day_stop_pts: float | None = None,   # arm blocked rest of IST day once day P&L <= -this
        session_date: str | None = None,       # YYYY-MM-DD for daily-bias gating
        daily_bias: dict | None = None,        # {date: +1/-1/0} from scripts/htf_bias.py (history-only)
    ):
        self.gap_min = gap_min
        self.sl_buf = sl_buf
        self.retest_tol = retest_tol
        self.min_rr = min_rr
        self.min_risk = min_risk
        self.cooldown = cooldown
        self.retest_ttl = retest_ttl
        self.max_zone_dist = max_zone_dist
        self.max_zone_age = max_zone_age
        self.min_displacement_r = min_displacement_r
        self.inv_flip_margin = inv_flip_margin
        self.entries = entries
        self.tp_mode = tp_mode
        self.partials = partials
        self.shared = shared
        self.sess_start = sess_start
        self.sess_end = sess_end
        self.atr_min = atr_min
        self.day_stop_pts = day_stop_pts
        self.session_date = session_date
        self.daily_bias = daily_bias
        self._day_idx = None
        self._day_pnl = 0.0
        self.rev_exit = rev_exit
        # structure state
        self.trail_hi = None
        self.trail_lo = None
        self.micro_hi = None   # nearest untouched 1-bar fractal high (tight SL anchor)
        self.micro_lo = None
        self.piv_high = None
        self.piv_low = None
        self.piv_high_broken = False
        self.piv_low_broken = False
        self.bos_dir = 0
        self.fvgs = []
        # position state
        self.pos = None
        self.pending = None
        self.last_exit = -999
        self.trades = []

    # ---------------- bar-close state machine ----------------
    def on_close(self, bars, i):
        b = bars[i]
        # 3-bar fractals -> trail refs + BOS pivots (validated optimum; 5-bar swing BOS tested
        # system-negative: +425 vs +875 — slow bias blocks good entries like the 14:13 short)
        if i >= 4:
            j = i - 2
            w = bars[j - 2:j + 3]
            if all(w[2]["high"] > w[k]["high"] for k in (0, 1, 3, 4)):
                self.trail_hi = self.piv_high = w[2]["high"]
                self.piv_high_broken = False
            if all(w[2]["low"] < w[k]["low"] for k in (0, 1, 3, 4)):
                self.trail_lo = self.piv_low = w[2]["low"]
                self.piv_low_broken = False
        # micro pivots (1 bar each side, confirmed at i) + invalidation
        if i >= 2:
            m = i - 1
            if bars[m]["high"] > bars[m - 1]["high"] and bars[m]["high"] > bars[m + 1]["high"]:
                self.micro_hi = bars[m]["high"]
            if bars[m]["low"] < bars[m - 1]["low"] and bars[m]["low"] < bars[m + 1]["low"]:
                self.micro_lo = bars[m]["low"]
        if self.micro_hi is not None and b["close"] > self.micro_hi:
            self.micro_hi = None   # traded through -> no longer above price
        if self.micro_lo is not None and b["close"] < self.micro_lo:
            self.micro_lo = None
        if self.piv_high is not None and not self.piv_high_broken and b["close"] > self.piv_high:
            self.bos_dir = 1
            self.piv_high_broken = True
        if self.piv_low is not None and not self.piv_low_broken and b["close"] < self.piv_low:
            self.bos_dir = -1
            self.piv_low_broken = True
        if i >= 2:
            a, c = bars[i - 2], bars[i]
            if c["high"] < a["low"] and a["low"] - c["high"] > self.gap_min:
                self.fvgs.append({"type": "bear", "top": a["low"], "bot": c["high"], "form": i, "inv": False, "used": False})
            if c["low"] > a["high"] and c["low"] - a["high"] > self.gap_min:
                self.fvgs.append({"type": "bull", "top": c["low"], "bot": a["high"], "form": i, "inv": False, "used": False})
        if self.pending is not None or i - self.last_exit < self.cooldown:
            return
        if self.pos is not None and not self.rev_exit:
            return
        if self.sess_start is not None and self.sess_end is not None:
            m = ((b["time"] // 60) + 330) % 1440   # IST minute, no tz lib needed
            if self.sess_start <= self.sess_end:
                if not (self.sess_start <= m <= self.sess_end):
                    return
            elif not (m >= self.sess_start or m <= self.sess_end):
                return
        if self.atr_min is not None:
            if i < 14:
                return
            atr = sum(bars[k]["high"] - bars[k]["low"] for k in range(i - 13, i + 1)) / 14.0
            if atr < self.atr_min:
                return
        if self.day_stop_pts is not None and self._day_idx is not None and self._day_pnl <= -self.day_stop_pts:
            return
        if self.daily_bias is not None and self.session_date is not None:
            # neutral (0) days allow both directions; decisive bias blocks counter-trades only
            self._day_dir = self.daily_bias.get(self.session_date, 0)
        self._gate_ok = True
        if self.min_displacement_r is not None:
            if i < 14:
                return
            atr = sum(bars[k]["high"] - bars[k]["low"] for k in range(i - 13, i + 1)) / 14.0
            if abs(b["close"] - bars[i - 3]["close"]) < self.min_displacement_r * atr:
                self._gate_ok = False
        armed = None
        if self.entries == "retest":
            armed = self._arm_retest(bars, i, b)
            if armed:
                self._set_pending(armed, i)
            return
        for f in self.fvgs:
            if f["inv"]:
                continue
            if f["type"] == "bear" and b["close"] > f["top"]:
                f["inv"] = True
                if self.inv_flip_margin is not None and self.bos_dir == -1 and b["close"] - f["top"] >= self.inv_flip_margin:
                    self.bos_dir = 1   # strong inversion = the structure break itself
                if self.bos_dir == 1 and (self.daily_bias is None or self._day_dir >= 0) and self._gate_ok and self._zone_fresh(f, i) and (self.max_zone_dist is None or b["close"] - f["top"] <= self.max_zone_dist):
                    refs = [x for x in (self.trail_lo, f["bot"]) if x is not None]
                    armed = ("inv", "LONG", max(refs), f)
            elif f["type"] == "bull" and b["close"] < f["bot"]:
                f["inv"] = True
                if self.inv_flip_margin is not None and self.bos_dir == 1 and f["bot"] - b["close"] >= self.inv_flip_margin:
                    self.bos_dir = -1
                if self.bos_dir == -1 and (self.daily_bias is None or self._day_dir <= 0) and self._gate_ok and self._zone_fresh(f, i) and (self.max_zone_dist is None or f["bot"] - b["close"] <= self.max_zone_dist):
                    refs = [x for x in (self.trail_hi, f["top"]) if x is not None]
                    armed = ("inv", "SHORT", min(refs), f)
        if armed is None:
            r = self._arm_retest(bars, i, b)
            if r:
                armed = r
        if armed:
            self._set_pending(armed, i)

    def _zone_fresh(self, f, i):
        if self.max_zone_age is None:
            return True
        return i - f["form"] <= self.max_zone_age

    def _dup_recent(self, side, ts_ms, window_min=5):
        """True if a same-side fill (this or the sibling stack) exists within the window."""
        if self.shared is None:
            return False
        for fts, fside in self.shared.get("fills", []):
            if fside == side and abs(ts_ms - fts) <= window_min * 60 * 1000:
                return True
        return False

    def _set_pending(self, armed, i):
        kind, side, sl_ref, f = armed
        self.pending = {"kind": kind, "side": side, "sl_ref": sl_ref, "sig_i": i, "zone": f,
                        "trigger": f["bot"] if (kind == "retest" and side == "SHORT") else
                                   (f["top"] if kind == "retest" else None)}

    def _arm_retest(self, bars, i, b):
        """Zone-fade arming (retest stack): pullback into nearest active opposing zone."""
        if self.bos_dir == 0:
            return None
        if self.bos_dir == -1 and (self.daily_bias is None or self._day_dir <= 0):
            zones = [f for f in self.fvgs if not f["inv"] and f["type"] == "bear" and self._zone_fresh(f, i)
                     and f["bot"] > b["close"]
                     and (self.max_zone_dist is None or f["bot"] - b["close"] <= self.max_zone_dist)]
            if zones:
                f = min(zones, key=lambda z: z["bot"])
                return ("retest", "SHORT", f["top"], f)
        else:
            zones = [f for f in self.fvgs if not f["inv"] and f["type"] == "bull" and self._zone_fresh(f, i)
                     and f["top"] < b["close"]
                     and (self.max_zone_dist is None or b["close"] - f["top"] <= self.max_zone_dist)]
            if zones:
                f = max(zones, key=lambda z: z["top"])
                return ("retest", "LONG", f["bot"], f)
        return None

    # ---------------- target selection (full history, never forward) ----------------
    def find_tp(self, bars, i, side, entry, risk):
        cands = []
        for j in range(2, i - 2):
            w = bars[j - 2:j + 3]
            if side == "SHORT":
                if not all(w[2]["low"] < w[k]["low"] for k in (0, 1, 3, 4)):
                    continue
                lvl = w[2]["low"]
                if lvl < entry and all(bars[k]["low"] > lvl for k in range(j + 3, i)):
                    cands.append(lvl)
            else:
                if not all(w[2]["high"] > w[k]["high"] for k in (0, 1, 3, 4)):
                    continue
                lvl = w[2]["high"]
                if lvl > entry and all(bars[k]["high"] < lvl for k in range(j + 3, i)):
                    cands.append(lvl)
        for f in self.fvgs:
            if f["inv"] or f["form"] + 3 >= i:
                continue
            if side == "SHORT" and f["type"] == "bull" and f["top"] < entry:
                if all(bars[k]["low"] > f["top"] for k in range(f["form"] + 3, i)):
                    cands.append(f["top"])
            elif side == "LONG" and f["type"] == "bear" and f["bot"] > entry:
                if all(bars[k]["high"] < f["bot"] for k in range(f["form"] + 3, i)):
                    cands.append(f["bot"])
        ok = [c for c in cands if abs(entry - c) / risk >= self.min_rr]
        if not ok:
            return None
        if side == "SHORT" or self.tp_mode == "near":
            return min(ok, key=lambda c: abs(entry - c))
        return max(ok, key=lambda c: abs(entry - c))

    # ---------------- position helpers ----------------
    def open_pos(self, side, fill, sl, i, kind, ts_ms, bars):
        risk = abs(fill - sl)
        if risk < self.min_risk:
            return False
        tp = self.find_tp(bars, i, side, fill, risk)
        self.pos = {"side": side, "entry": fill, "sl": sl, "tp": tp, "i": i, "kind": kind, "ts": ts_ms,
                    "risk": risk, "partial": False}
        if self.shared is not None:
            self.shared.setdefault("fills", []).append((ts_ms, side))
        return True

    def close_pos(self, i, px, why, ts_ms):
        p = self.pos
        leg = (px - p["entry"]) if p["side"] == "LONG" else (p["entry"] - px)
        pnl = 0.5 * p["risk"] + 0.5 * leg if p.get("partial") else leg
        self.trades.append({"t_in": p["ts"], "t_out": ts_ms, "side": p["side"], "kind": p["kind"],
                            "entry": p["entry"], "sl": p["sl"], "tp": p["tp"], "exit": px, "result": why,
                            "pnl": round(pnl, 2),
                            "rr": round(pnl / (abs(p.get("risk", 0)) or abs(p["entry"] - p["sl"]) or 1), 2)})
        self.pos = None
        self.last_exit = i
        day = (ts_ms // 1000 + 19800) // 86400   # IST day index
        if self._day_idx != day:
            self._day_idx = day
            self._day_pnl = 0.0
        self._day_pnl += pnl

    # ---------------- main loop ----------------
    def run(self, bars, ticks):
        by_min = defaultdict(list)
        for t in ticks:
            by_min[int(t["timestamp"] // 1000 // 60) * 60].append(t)
        for i, b in enumerate(bars):
            bt = by_min.get(b["time"], [])
            # pending inv market fill: first tick of bars sig_i+1..sig_i+2, cancel if gapped past SL
            if self.pending and self.pending["kind"] == "inv" and i > self.pending["sig_i"] and \
               (self.pos is None or (self.rev_exit and self.pos["side"] != self.pending["side"])):
                pd = self.pending
                if i - pd["sig_i"] > 2:
                    self.pending = None
                elif bt:
                    t = bt[0]
                    sl = pd["sl_ref"] + self.sl_buf if pd["side"] == "SHORT" else pd["sl_ref"] - self.sl_buf
                    px = t["bidPrice"] if pd["side"] == "SHORT" else t["askPrice"]
                    if (pd["side"] == "SHORT" and px > sl) or (pd["side"] == "LONG" and px < sl):
                        self.pending = None
                    elif self._dup_recent(pd["side"], t["timestamp"]):
                        self.pending = None   # sibling stack already holds this thesis
                    elif self.pos is not None:
                        leg = (px - self.pos["entry"]) if self.pos["side"] == "LONG" else (self.pos["entry"] - px)
                        if leg > 0:
                            self.close_pos(i, px, "REV", t["timestamp"])
                        self.pending = None   # exit only — no reversal flip
                    elif self.open_pos(pd["side"], px, sl, i, "inv", t["timestamp"], bars):
                        self.pending = None
            # position management: SL first, then TP
            if self.pos:
                p = self.pos
                for t in bt:
                    bid, ask = t["bidPrice"], t["askPrice"]
                    if p["side"] == "SHORT":
                        if ask >= p["sl"]:
                            self.close_pos(i, p["sl"], "SL", t["timestamp"]); break
                        if self.partials and not p.get("partial") and ask <= p["entry"] - p["risk"]:
                            p["partial"] = True
                            p["sl"] = p["entry"]   # half banked at +1R, rest rides risk-free
                        if p["tp"] and bid <= p["tp"]:
                            self.close_pos(i, p["tp"], "TP", t["timestamp"]); break
                    else:
                        if bid <= p["sl"]:
                            self.close_pos(i, p["sl"], "SL", t["timestamp"]); break
                        if self.partials and not p.get("partial") and bid >= p["entry"] + p["risk"]:
                            p["partial"] = True
                            p["sl"] = p["entry"]
                        if p["tp"] and ask >= p["tp"]:
                            self.close_pos(i, p["tp"], "TP", t["timestamp"]); break
            # pending retest fill: touch of zone near edge within tolerance
            if self.pending and self.pending["kind"] == "retest" and \
               (self.pos is None or (self.rev_exit and self.pos["side"] != self.pending["side"])):
                pd = self.pending
                for t in bt:
                    if pd["side"] == "SHORT" and t["bidPrice"] >= pd["trigger"] - self.retest_tol:
                        if self._dup_recent("SHORT", t["timestamp"]):
                            self.pending = None
                        elif self.pos is not None:
                            if self.pos["entry"] - t["bidPrice"] > 0:
                                self.close_pos(i, t["bidPrice"], "REV", t["timestamp"])
                            self.pending = None
                        elif self.open_pos("SHORT", t["bidPrice"], pd["sl_ref"] + self.sl_buf, i, "retest", t["timestamp"], bars):
                            self.pending = None
                        break
                    if pd["side"] == "LONG" and t["askPrice"] <= pd["trigger"] + self.retest_tol:
                        if self._dup_recent("LONG", t["timestamp"]):
                            self.pending = None
                        elif self.pos is not None:
                            if t["askPrice"] - self.pos["entry"] > 0:
                                self.close_pos(i, t["askPrice"], "REV", t["timestamp"])
                            self.pending = None
                        elif self.open_pos("LONG", t["askPrice"], pd["sl_ref"] - self.sl_buf, i, "retest", t["timestamp"], bars):
                            self.pending = None
                        break
            # bar-close state update + signal arming
            self.on_close(bars, i)
            # retest pending expiry / invalidation
            if self.pending and self.pending["kind"] == "retest":
                pd = self.pending
                if i - pd["sig_i"] > self.retest_ttl or \
                   (pd["side"] == "SHORT" and b["close"] > pd["zone"]["top"]) or \
                   (pd["side"] == "LONG" and b["close"] < pd["zone"]["bot"]):
                    self.pending = None
            # structure trail for TP-less positions
            if self.pos and self.pos["tp"] is None and bt:
                p = self.pos
                if p["side"] == "SHORT" and self.trail_hi is not None and b["close"] > self.trail_hi:
                    self.close_pos(i, bt[-1]["bidPrice"], "TRAIL", bt[-1]["timestamp"])
                elif p["side"] == "LONG" and self.trail_lo is not None and b["close"] < self.trail_lo:
                    self.close_pos(i, bt[-1]["askPrice"], "TRAIL", bt[-1]["timestamp"])
        return self.trades
