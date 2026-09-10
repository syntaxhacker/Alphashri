"""SMC iFVG strategy v2 — strict history-only, tick-accurate fills.

Per bar (bars[i] close drives state; ticks drive fills/exits):
  1. open position: SL first, then TP, on raw ticks (short exits at ask, long at bid)
  2. pending inv fill: market at first tick of bars sig_i+1..sig_i+2, else cancel
  3. pending retest fill: nearest active opposing FVG ABOVE (short) / BELOW (long), fill on
     touch of near edge within RETEST_TOL; cancel on zone invalidation or TTL
  4. close state: fractal pivots -> trail refs + BOS; new FVGs; mark ALL inversions, arm only
     the last one aligned with bos_dir; retest arming
  5. TP-less positions: structure trail exit (close beyond latest opposite fractal pivot)
"""
import argparse
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

sys.path.insert(0, __file__.rsplit("/", 2)[0])

from scripts.smc_tick_eval import fetch_ticks, build_1m_bars

IST = timezone(timedelta(hours=5, minutes=30))
GAP_MIN, SL_BUF, RETEST_TOL = 2.0, 6.0, 2.0
MIN_RR, MIN_RISK, COOLDOWN, RETEST_TTL = 2.0, 5.0, 3, 30
SUPPLY_PROX = 25.0   # tie-break conflict distance (opt-in, see TIEBREAK)
HTF_SMA = 60         # HTF bias: 60x1m SMA (~1h)
TIEBREAK = False
DEBUG = False
SWEEP_BUF = 3.0
MIN_RR_SWEEP = 5.0
SWEEP_COOLDOWN = 15
MIN_RISK_SWEEP = 8.0


def ist(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone(IST).strftime("%H:%M:%S")


def dbg(m):
    if DEBUG:
        print(m)


class Engine:
    def __init__(self, gate="none", trail_only=False):
        self.gate = gate                # "none" | "sma60" | "ema15m"
        self.trail_only = trail_only    # disable structural TP -> pure trail exits
        self.trail_hi = self.trail_lo = None       # latest confirmed fractal extremes
        self.piv_high = self.piv_low = None        # last unbroken pivot (BOS ref)
        self.piv_high_broken = self.piv_low_broken = False
        self.bos_dir = 0
        self.fvgs = []
        self.pos = None
        self.pending = None
        self.last_exit = -999
        self.win = None              # (start_min, end_min) IST — session filter
        self.htf_ema = None          # 15m EMA20 — HTF bias (completed bars only, no lookahead)
        self.trades = []

    def _sma(self, bars, i):
        seg = bars[max(0, i - HTF_SMA + 1):i + 1]
        return sum(x["close"] for x in seg) / len(seg)

    def _zone_above(self, b):
        zones = [f for f in self.fvgs if not f["inv"] and f["type"] == "bear" and f["bot"] > b["close"]]
        return min(zones, key=lambda z: z["bot"]) if zones else None

    def _zone_below(self, b):
        zones = [f for f in self.fvgs if not f["inv"] and f["type"] == "bull" and f["top"] < b["close"]]
        return max(zones, key=lambda z: z["top"]) if zones else None

    def _ist_min(self, b):
        dt = datetime.fromtimestamp(b["time"], tz=timezone.utc).astimezone(IST)
        return dt.hour * 60 + dt.minute

    def on_close(self, bars, i):
        b = bars[i]
        # fractal pivot at i-2
        if i >= 4:
            j = i - 2
            w = bars[j - 2:j + 3]
            if all(w[2]["high"] > w[k]["high"] for k in (0, 1, 3, 4)):
                self.trail_hi = self.piv_high = w[2]["high"]
                self.piv_high_broken = False
            if all(w[2]["low"] < w[k]["low"] for k in (0, 1, 3, 4)):
                self.trail_lo = self.piv_low = w[2]["low"]
                self.piv_low_broken = False
        # BOS
        if self.piv_high is not None and not self.piv_high_broken and b["close"] > self.piv_high:
            self.bos_dir = 1
            self.piv_high_broken = True
            dbg(f"    BOS UP @{ist(b['time']*1000)} close {b['close']:.2f} > {self.piv_high:.2f}")
        if self.piv_low is not None and not self.piv_low_broken and b["close"] < self.piv_low:
            self.bos_dir = -1
            self.piv_low_broken = True
            dbg(f"    BOS DOWN @{ist(b['time']*1000)} close {b['close']:.2f} < {self.piv_low:.2f}")
        # new FVG
        if i >= 2:
            a, c = bars[i - 2], bars[i]
            if c["high"] < a["low"] and a["low"] - c["high"] > GAP_MIN:
                self.fvgs.append({"type": "bear", "top": a["low"], "bot": c["high"], "form": i, "inv": False})
            if c["low"] > a["high"] and c["low"] - a["high"] > GAP_MIN:
                self.fvgs.append({"type": "bull", "top": c["low"], "bot": a["high"], "form": i, "inv": False})
        if self.pos is not None or self.pending is not None or i - self.last_exit < COOLDOWN:
            return
        if self.win and not (self.win[0] <= self._ist_min(b) <= self.win[1]):
            return
        if self.gate == "ema15m" and self.htf_ema is None:
            return  # HTF warmup — no bias, no trades
        if self.gate == "sma60":
            ref = self._sma(bars, i)
            allow_long, allow_short = b["close"] > ref, b["close"] < ref
        elif self.gate == "ema15m":
            allow_long, allow_short = b["close"] > self.htf_ema, b["close"] < self.htf_ema
        else:
            allow_long = allow_short = True
        # v2 semantics: mark+arm inversions in one pass (only while flat)
        armed = None
        for f in self.fvgs:
            if f["inv"]:
                continue
            if f["type"] == "bear" and b["close"] > f["top"]:
                f["inv"] = True
                if self.bos_dir == 1 and allow_long:
                    refs = [x for x in (self.trail_lo, f["bot"]) if x is not None]
                    armed = ("inv", "LONG", max(refs), f)
                break
            if f["type"] == "bull" and b["close"] < f["bot"]:
                f["inv"] = True
                if self.bos_dir == -1 and allow_short:
                    refs = [x for x in (self.trail_hi, f["top"]) if x is not None]
                    armed = ("inv", "SHORT", min(refs), f)
                break
        # retest arming: nearest active opposing zone beyond price, HTF-aligned only
        if armed is None:
            if self.bos_dir == -1 and allow_short:
                zones = [f for f in self.fvgs if not f["inv"] and f["type"] == "bear" and f["bot"] > b["close"]]
                if zones:
                    f = min(zones, key=lambda z: z["bot"])
                    armed = ("retest", "SHORT", f["top"], f)
            elif self.bos_dir == 1 and allow_long:
                zones = [f for f in self.fvgs if not f["inv"] and f["type"] == "bull" and f["top"] < b["close"]]
                if zones:
                    f = max(zones, key=lambda z: z["top"])
                    armed = ("retest", "LONG", f["bot"], f)
        if armed:
            kind, side, sl_ref, f = armed
            self.pending = {"kind": kind, "side": side, "sl_ref": sl_ref, "sig_i": i,
                            "zone": f, "form_i": f["form"],
                            "trigger": f["bot"] if (kind == "retest" and side == "SHORT") else
                                       (f["top"] if kind == "retest" else None)}
            dbg(f"    ARM {kind} {side} sl_ref {sl_ref:.2f} @{ist(b['time']*1000)}")

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
        ok = [c for c in cands if abs(entry - c) / risk >= MIN_RR]
        if not ok:
            return None
        return min(ok, key=lambda c: abs(entry - c)) if side == "SHORT" else max(ok, key=lambda c: abs(entry - c))

    def open_pos(self, side, fill, sl, i, kind, ts_ms, bars):
        risk = abs(fill - sl)
        if risk < MIN_RISK:
            return False
        tp = None if self.trail_only else self.find_tp(bars, i, side, fill, risk)
        ema = self.htf_ema
        with_trend = True if ema is None else ((fill > ema) if side == "LONG" else (fill < ema))
        self.pos = {"side": side, "entry": fill, "sl": sl, "tp": tp, "i": i, "kind": kind, "ts": ts_ms,
                    "with_trend": with_trend, "tp_mode": tp is not None}
        dbg(f"    OPEN {side} {kind} fill {fill:.2f} SL {sl:.2f} TP {tp and round(tp, 2)} @{ist(ts_ms)}")
        return True

    def close_pos(self, i, px, why, ts_ms):
        p = self.pos
        pnl = (px - p["entry"]) if p["side"] == "LONG" else (p["entry"] - px)
        self.trades.append({"t_in": ist(p["ts"]), "t_out": ist(ts_ms), "side": p["side"], "kind": p["kind"],
                            "entry": p["entry"], "sl": p["sl"], "tp": p["tp"], "exit": px, "result": why,
                            "pnl": round(pnl, 2), "rr": round(pnl / abs(p["entry"] - p["sl"]), 2),
                            "with_trend": p["with_trend"], "tp_mode": p["tp_mode"]})
        dbg(f"    CLOSE {why} {px:.2f} pnl {pnl:+.2f} @{ist(ts_ms)}")
        self.pos = None
        self.last_exit = i

    def run(self, bars, ticks):
        by_min = defaultdict(list)
        for t in ticks:
            by_min[int(t["timestamp"] // 1000 // 60) * 60].append(t)
        # 15m HTF EMA20 from 1m closes (bucket close = last 1m close); read only COMPLETED buckets
        alpha = 2 / 21
        bucket_last, order = {}, []
        for b in bars:
            k = b["time"] // 900
            if k not in bucket_last:
                order.append(k)
            bucket_last[k] = b["close"]
        ema_vals, e = [], None
        for k in order:
            e = bucket_last[k] if e is None else alpha * bucket_last[k] + (1 - alpha) * e
            ema_vals.append(e)
        pos_of = {k: idx for idx, k in enumerate(order)}
        for i, b in enumerate(bars):
            bt = by_min.get(b["time"], [])
            pos = pos_of.get(b["time"] // 900, 0)
            # bias only after 20 completed 15m bars (~5h warmup) — no fake early bias
            self.htf_ema = ema_vals[pos - 1] if pos >= 20 else None
            # pending inv fill
            if self.pos is None and self.pending and self.pending["kind"] == "inv" and i > self.pending["sig_i"]:
                pd = self.pending
                if i - pd["sig_i"] > 2 or not bt:
                    if i - pd["sig_i"] > 2:
                        self.pending = None
                else:
                    t = bt[0]
                    sl = pd["sl_ref"] + SL_BUF if pd["side"] == "SHORT" else pd["sl_ref"] - SL_BUF
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
            # pending retest fill
            if self.pos is None and self.pending and self.pending["kind"] == "retest":
                pd = self.pending
                for t in bt:
                    if pd["side"] == "SHORT" and t["bidPrice"] >= pd["trigger"] - RETEST_TOL:
                        if self.open_pos("SHORT", t["bidPrice"], pd["sl_ref"] + SL_BUF, i, "retest", t["timestamp"], bars):
                            self.pending = None
                        break
                    if pd["side"] == "LONG" and t["askPrice"] <= pd["trigger"] + RETEST_TOL:
                        if self.open_pos("LONG", t["askPrice"], pd["sl_ref"] - SL_BUF, i, "retest", t["timestamp"], bars):
                            self.pending = None
                        break
            # close-state update + signal arming
            self.on_close(bars, i)
            # retest expiry / invalidation
            if self.pending and self.pending["kind"] == "retest":
                pd = self.pending
                if i - pd["sig_i"] > RETEST_TTL or \
                   (pd["side"] == "SHORT" and b["close"] > pd["zone"]["top"]) or \
                   (pd["side"] == "LONG" and b["close"] < pd["zone"]["bot"]):
                    self.pending = None
            # trail exit for TP-less positions
            if self.pos and self.pos["tp"] is None and bt:
                p = self.pos
                if p["side"] == "SHORT" and self.trail_hi is not None and b["close"] > self.trail_hi:
                    self.close_pos(i, bt[-1]["bidPrice"], "TRAIL", bt[-1]["timestamp"])
                elif p["side"] == "LONG" and self.trail_lo is not None and b["close"] < self.trail_lo:
                    self.close_pos(i, bt[-1]["askPrice"], "TRAIL", bt[-1]["timestamp"])
        return self.trades


def main():
    global DEBUG
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default="2026-09-02")
    ap.add_argument("--from-ist", default=None)
    ap.add_argument("--to-ist", default=None)
    ap.add_argument("--start-ist", default=None, help="session filter: only ARM signals at/after HH:MM IST")
    ap.add_argument("--end-ist", default=None)
    ap.add_argument("--gate", default="none", choices=["none", "sma60", "ema15m"])
    ap.add_argument("--min-rr", type=float, default=None)
    ap.add_argument("--cooldown", type=int, default=None)
    ap.add_argument("--strategy", default="ifvg", choices=["ifvg", "sweep"])
    ap.add_argument("--trail-only", action="store_true")
    ap.add_argument("--tiebreak", action="store_true")
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args()
    DEBUG = args.debug
    globals()['TIEBREAK'] = args.tiebreak

    ticks = fetch_ticks(args.date)
    bars = build_1m_bars(ticks)
    eng = SweepEngine() if args.strategy == "sweep" else Engine(gate=args.gate, trail_only=args.trail_only)
    if args.start_ist or args.end_ist:
        h1, m1 = map(int, (args.start_ist or "00:00").split(":"))
        h2, m2 = map(int, (args.end_ist or "23:59").split(":"))
        eng.win = (h1 * 60 + m1, h2 * 60 + m2)
    trades = eng.run(bars, ticks)
    win = [t for t in trades
           if (not args.from_ist or t["t_in"][:5] >= args.from_ist)
           and (not args.to_ist or t["t_in"][:5] <= args.to_ist)]
    print(f"\n=== {args.date} — SMC iFVG v2 — {len(bars)} bars / {len(ticks):,} ticks — "
          f"{len(trades)} trades, {len(win)} in window ===\n")
    for t in trades:
        mark = "*" if t in win else " "
        tp_s = f"{t['tp']:.2f}" if t["tp"] else "trail"
        print(f"{mark} {t['t_in']:<9}{t['t_out']:<9}{t['side']:<6}{t['kind']:<7}fill {t['entry']:>9.2f}  SL {t['sl']:>9.2f}  "
              f"TP {tp_s:>9}  exit {t['exit']:>9.2f} {t['result']:<6}{t['pnl']:>+8.2f}{t['rr']:>+7.2f}R  {'T+' if t.get('with_trend', True) else 'T-'}")
    if win:
        gp = sum(t["pnl"] for t in win if t["pnl"] > 0)
        gl = abs(sum(t["pnl"] for t in win if t["pnl"] < 0))
        print(f"\n  window: {len(win)} trades · net {sum(t['pnl'] for t in win):+.2f} pts · "
              f"win {sum(1 for t in win if t['pnl'] > 0)}/{len(win)} · PF {gp / gl if gl else float('inf'):.2f}")


class SweepEngine:
    """HTF (15m) structure bias + 1m liquidity-sweep entries — prop style: tiny SL, big TP.

    Bias: 15m close breaking above last 15m swing high = bull, below last 15m swing low = bear.
    Entry LONG: 1m bar wicks below the last confirmed 1m swing low (or the 15m swing low —
    stronger), closes back above it, bias bull. Fill next tick (ask).
    SL: sweep wick low - SWEEP_BUF. TP: nearest untouched swing high above (1m or 15m) with
    RR >= MIN_RR_SWEEP, else NO TRADE. No trail — defined target only.
    """
    def __init__(self):
        self.bias = 0
        self.sh15 = self.sl15 = None          # confirmed 15m swing levels
        self.sh15_prev = self.sl15_prev = None
        self.f_low = self.f_high = None       # last confirmed 1m fractal levels
        self.pos = None
        self.pending = None
        self.last_exit = -999
        self._cur_i = -999
        self.trades = []
        self.bars15 = []                       # completed 15m dicts

    def _update_htf(self, bars, i):
        b = bars[i]
        k = b["time"] // 900
        if not self.bars15 or self.bars15[-1]["time"] != k:
            self.bars15.append({"time": k * 900, "open": b["open"], "high": b["high"],
                                "low": b["low"], "close": b["close"]})
        else:
            c = self.bars15[-1]
            c["high"] = max(c["high"], b["high"]); c["low"] = min(c["low"], b["low"]); c["close"] = b["close"]
        # evaluate structure on the just-completed bucket
        if i + 1 < len(bars) and bars[i + 1]["time"] // 900 != k:
            done = self.bars15[-1]
            n = len(self.bars15)
            if n >= 5:
                w = self.bars15[n - 5:]
                j = 2  # candidate = w[2] (second of last three? use middle of last 5 minus forming)
                cand = self.bars15[n - 3]
                if cand["high"] > w[0]["high"] and cand["high"] > w[1]["high"] and cand["high"] > w[3]["high"] and cand["high"] > w[4]["high"] if len(w) == 5 else False:
                    pass
            # simpler: fractal with 2 bars each side among completed buckets
            if n >= 5:
                w = self.bars15[n - 5:n]
                cand = w[2]
                if all(cand["high"] > w[m]["high"] for m in (0, 1, 3, 4)):
                    self.sh15_prev = self.sh15; self.sh15 = cand["high"]
                if all(cand["low"] < w[m]["low"] for m in (0, 1, 3, 4)):
                    self.sl15_prev = self.sl15; self.sl15 = cand["low"]
            # swing-sequence bias: HH+HL = bull, LH+LL = bear, confirmed by close crossing the level
            hh = self.sh15_prev is not None and self.sh15 is not None and self.sh15 > self.sh15_prev
            hl = self.sl15_prev is not None and self.sl15 is not None and self.sl15 > self.sl15_prev
            lh = self.sh15_prev is not None and self.sh15 is not None and self.sh15 < self.sh15_prev
            ll = self.sl15_prev is not None and self.sl15 is not None and self.sl15 < self.sl15_prev
            if self.sh15 is not None and done["close"] > self.sh15 and (hh or hl) and self.bias != 1:
                self.bias = 1
                dbg(f"    HTF BIAS UP @{ist(b['time']*1000)} close {done['close']:.2f} > sh15 {self.sh15:.2f}")
            elif self.sl15 is not None and done["close"] < self.sl15 and (lh or ll) and self.bias != -1:
                self.bias = -1
                dbg(f"    HTF BIAS DOWN @{ist(b['time']*1000)} close {done['close']:.2f} < sl15 {self.sl15:.2f}")

    def _update_1m_pivots(self, bars, i):
        if i >= 4:
            j = i - 2
            w = bars[j - 2:j + 3]
            if all(w[2]["low"] < w[m]["low"] for m in (0, 1, 3, 4)):
                self.f_low = w[2]["low"]
            if all(w[2]["high"] > w[m]["high"] for m in (0, 1, 3, 4)):
                self.f_high = w[2]["high"]

    def _find_tp(self, bars, i, side, entry, risk):
        cands = []
        # 1m fractal extremes (untouched)
        for j in range(2, i - 2):
            w = bars[j - 2:j + 3]
            if side == "LONG":
                if all(w[2]["high"] > w[m]["high"] for m in (0, 1, 3, 4)):
                    lvl = w[2]["high"]
                    if lvl > entry and all(bars[k]["high"] < lvl for k in range(j + 3, i)):
                        cands.append(lvl)
            else:
                if all(w[2]["low"] < w[m]["low"] for m in (0, 1, 3, 4)):
                    lvl = w[2]["low"]
                    if lvl < entry and all(bars[k]["low"] > lvl for k in range(j + 3, i)):
                        cands.append(lvl)
        # 15m swing levels (big liquidity)
        if side == "LONG" and self.sh15 and self.sh15 > entry:
            cands.append(self.sh15)
        if side == "SHORT" and self.sl15 and self.sl15 < entry:
            cands.append(self.sl15)
        ok = [c for c in cands if abs(entry - c) / risk >= MIN_RR_SWEEP]
        if not ok:
            return None
        return min(ok, key=lambda c: abs(entry - c)) if side == "LONG" else max(ok, key=lambda c: abs(entry - c))

    def open_pos(self, side, fill, sl, i, kind, ts_ms, bars):
        risk = abs(fill - sl)
        if risk < MIN_RISK_SWEEP:
            return False
        tp = self._find_tp(bars, i, side, fill, risk)
        if tp is None:
            dbg(f"    skip {side} sweep: no RR>={MIN_RR_SWEEP} target")
            return False
        self.pos = {"side": side, "entry": fill, "sl": sl, "tp": tp, "ts": ts_ms, "kind": kind}
        dbg(f"    OPEN {side} {kind} fill {fill:.2f} SL {sl:.2f} TP {tp:.2f} RR {abs(tp-fill)/risk:.1f} @{ist(ts_ms)}")
        return True

    def close_pos(self, ts_ms, px, why):
        p = self.pos
        pnl = (px - p["entry"]) if p["side"] == "LONG" else (p["entry"] - px)
        self.trades.append({"t_in": ist(p["ts"]), "t_out": ist(ts_ms), "side": p["side"], "kind": p["kind"],
                            "entry": p["entry"], "sl": p["sl"], "tp": p["tp"], "exit": px, "result": why,
                            "pnl": round(pnl, 2), "rr": round(pnl / abs(p["entry"] - p["sl"]), 2)})
        dbg(f"    CLOSE {why} {px:.2f} pnl {pnl:+.2f} @{ist(ts_ms)}")
        self.last_exit = self._cur_i
        self.pos = None

    def run(self, bars, ticks):
        by_min = defaultdict(list)
        for t in ticks:
            by_min[int(t["timestamp"] // 1000 // 60) * 60].append(t)
        for i, b in enumerate(bars):
            self._cur_i = i
            bt = by_min.get(b["time"], [])
            # pending sweep fill (market, next bar)
            if self.pos is None and self.pending and i > self.pending["sig_i"]:
                if i - self.pending["sig_i"] > 2 or not bt:
                    if i - self.pending["sig_i"] > 2:
                        self.pending = None
                else:
                    t = bt[0]
                    px = t["askPrice"] if self.pending["side"] == "LONG" else t["bidPrice"]
                    # gap through the sweep wick before fill = sweep failed -> cancel
                    if (self.pending["side"] == "LONG" and px <= self.pending["sl"]) or \
                       (self.pending["side"] == "SHORT" and px >= self.pending["sl"]):
                        self.pending = None
                    elif self.open_pos(self.pending["side"], px, self.pending["sl"], i, self.pending["kind"], t["timestamp"], bars):
                        self.pending = None
            # manage position: SL first, then TP
            if self.pos:
                p = self.pos
                for t in bt:
                    bid, ask = t["bidPrice"], t["askPrice"]
                    if p["side"] == "LONG":
                        if bid <= p["sl"]:
                            self.close_pos(t["timestamp"], p["sl"], "SL"); break
                        if ask >= p["tp"]:
                            self.close_pos(t["timestamp"], p["tp"], "TP"); break
                    else:
                        if ask >= p["sl"]:
                            self.close_pos(t["timestamp"], p["sl"], "SL"); break
                        if bid <= p["tp"]:
                            self.close_pos(t["timestamp"], p["tp"], "TP"); break
            # signal detection on bar close
            self._update_1m_pivots(bars, i)
            self._update_htf(bars, i)
            if self.pos is None and self.pending is None and i - self.last_exit >= SWEEP_COOLDOWN and self.bias != 0:
                # 15m-level sweeps only — the real liquidity grabs (1m-level sweeps are noise)
                sig = None
                if self.bias == 1 and self.sl15 is not None:
                    if b["low"] < self.sl15 and b["close"] > self.sl15:
                        sig = ("LONG", "sweep15m", b["low"])
                if sig is None and self.bias == -1 and self.sh15 is not None:
                    if b["high"] > self.sh15 and b["close"] < self.sh15:
                        sig = ("SHORT", "sweep15m", b["high"])
                if sig:
                    side, kind, wick = sig
                    sl = wick - SWEEP_BUF if side == "LONG" else wick + SWEEP_BUF
                    self.pending = {"side": side, "kind": kind, "sl": sl, "sig_i": i}
                    dbg(f"    ARM {side} {kind} wick {wick:.2f} SL {sl:.2f} @{ist(b['time']*1000)}")
            if self.pos is None and self.pending is None and i - self.last_exit >= SWEEP_COOLDOWN:
                pass
        return self.trades


if __name__ == "__main__":
    main()

