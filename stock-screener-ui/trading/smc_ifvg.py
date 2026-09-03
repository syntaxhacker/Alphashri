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
    ):
        self.gap_min = gap_min
        self.sl_buf = sl_buf
        self.retest_tol = retest_tol
        self.min_rr = min_rr
        self.min_risk = min_risk
        self.cooldown = cooldown
        self.retest_ttl = retest_ttl
        self.max_zone_dist = max_zone_dist
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
        if self.pos is not None or self.pending is not None or i - self.last_exit < self.cooldown:
            return
        armed = None
        for f in self.fvgs:
            if f["inv"]:
                continue
            if f["type"] == "bear" and b["close"] > f["top"]:
                f["inv"] = True
                if self.bos_dir == 1 and (self.max_zone_dist is None or b["close"] - f["top"] <= self.max_zone_dist):
                    refs = [x for x in (self.trail_lo, f["bot"]) if x is not None]
                    armed = ("inv", "LONG", max(refs), f)
            elif f["type"] == "bull" and b["close"] < f["bot"]:
                f["inv"] = True
                if self.bos_dir == -1 and (self.max_zone_dist is None or f["bot"] - b["close"] <= self.max_zone_dist):
                    refs = [x for x in (self.trail_hi, f["top"]) if x is not None]
                    armed = ("inv", "SHORT", min(refs), f)
        if armed is None and self.bos_dir != 0:
            if self.bos_dir == -1:
                zones = [f for f in self.fvgs if not f["inv"] and f["type"] == "bear"
                         and f["bot"] > b["close"]
                         and (self.max_zone_dist is None or f["bot"] - b["close"] <= self.max_zone_dist)]
                if zones:
                    f = min(zones, key=lambda z: z["bot"])
                    armed = ("retest", "SHORT", f["top"], f)
            else:
                zones = [f for f in self.fvgs if not f["inv"] and f["type"] == "bull"
                         and f["top"] < b["close"]
                         and (self.max_zone_dist is None or b["close"] - f["top"] <= self.max_zone_dist)]
                if zones:
                    f = max(zones, key=lambda z: z["top"])
                    armed = ("retest", "LONG", f["bot"], f)
        if armed:
            kind, side, sl_ref, f = armed
            self.pending = {"kind": kind, "side": side, "sl_ref": sl_ref, "sig_i": i, "zone": f,
                            "trigger": f["bot"] if (kind == "retest" and side == "SHORT") else
                                       (f["top"] if kind == "retest" else None)}

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
        return min(ok, key=lambda c: abs(entry - c)) if side == "SHORT" else max(ok, key=lambda c: abs(entry - c))

    # ---------------- position helpers ----------------
    def open_pos(self, side, fill, sl, i, kind, ts_ms, bars):
        risk = abs(fill - sl)
        if risk < self.min_risk:
            return False
        tp = self.find_tp(bars, i, side, fill, risk)
        self.pos = {"side": side, "entry": fill, "sl": sl, "tp": tp, "i": i, "kind": kind, "ts": ts_ms}
        return True

    def close_pos(self, i, px, why, ts_ms):
        p = self.pos
        pnl = (px - p["entry"]) if p["side"] == "LONG" else (p["entry"] - px)
        self.trades.append({"t_in": p["ts"], "t_out": ts_ms, "side": p["side"], "kind": p["kind"],
                            "entry": p["entry"], "sl": p["sl"], "tp": p["tp"], "exit": px, "result": why,
                            "pnl": round(pnl, 2), "rr": round(pnl / abs(p["entry"] - p["sl"]), 2)})
        self.pos = None
        self.last_exit = i

    # ---------------- main loop ----------------
    def run(self, bars, ticks):
        by_min = defaultdict(list)
        for t in ticks:
            by_min[int(t["timestamp"] // 1000 // 60) * 60].append(t)
        for i, b in enumerate(bars):
            bt = by_min.get(b["time"], [])
            # pending inv market fill: first tick of bars sig_i+1..sig_i+2, cancel if gapped past SL
            if self.pos is None and self.pending and self.pending["kind"] == "inv" and i > self.pending["sig_i"]:
                pd = self.pending
                if i - pd["sig_i"] > 2:
                    self.pending = None
                elif bt:
                    t = bt[0]
                    sl = pd["sl_ref"] + self.sl_buf if pd["side"] == "SHORT" else pd["sl_ref"] - self.sl_buf
                    px = t["bidPrice"] if pd["side"] == "SHORT" else t["askPrice"]
                    if (pd["side"] == "SHORT" and px > sl) or (pd["side"] == "LONG" and px < sl):
                        self.pending = None
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
                        if p["tp"] and bid <= p["tp"]:
                            self.close_pos(i, p["tp"], "TP", t["timestamp"]); break
                    else:
                        if bid <= p["sl"]:
                            self.close_pos(i, p["sl"], "SL", t["timestamp"]); break
                        if p["tp"] and ask >= p["tp"]:
                            self.close_pos(i, p["tp"], "TP", t["timestamp"]); break
            # pending retest fill: touch of zone near edge within tolerance
            if self.pos is None and self.pending and self.pending["kind"] == "retest":
                pd = self.pending
                for t in bt:
                    if pd["side"] == "SHORT" and t["bidPrice"] >= pd["trigger"] - self.retest_tol:
                        if self.open_pos("SHORT", t["bidPrice"], pd["sl_ref"] + self.sl_buf, i, "retest", t["timestamp"], bars):
                            self.pending = None
                        break
                    if pd["side"] == "LONG" and t["askPrice"] <= pd["trigger"] + self.retest_tol:
                        if self.open_pos("LONG", t["askPrice"], pd["sl_ref"] - self.sl_buf, i, "retest", t["timestamp"], bars):
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
