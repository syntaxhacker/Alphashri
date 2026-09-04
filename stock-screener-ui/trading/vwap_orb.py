"""VWAP + ORB combined strategy (simple, Phase 1 for tick replay).

Rules (history-only):
  OR = high/low of the first OR_BARS 1m bars of the session.
  VWAP = cumulative tick-VWAP (mid price weighted by ask+bid volume).
  LONG: 1m close breaks above OR high AND close > VWAP -> buy next tick (ask).
  SHORT: 1m close breaks below OR low AND close < VWAP -> sell next tick (bid).
  SL: opposite OR edge.
  TP: nearest untouched structural pivot (incl. overnight history), else fixed RR.
  One position at a time, cooldown after exit.
  Exits evaluated per tick (SL-first), same conventions as SMCIFVGEngine.
"""
from collections import defaultdict

OR_BARS = 15
RR = 2.0
COOLDOWN = 5


def compute_or_window(bars, orb_minutes: int):
    """OR high/low/end from the first orb_minutes 1m bars. Pure, history-only.

    Returns (or_high, or_low, or_end_time) where or_end_time is the first second
    AFTER the window completes (levels unknown before then). (0.0, 0.0, 0) if
    fewer than orb_minutes bars exist.
    """
    if not bars or len(bars) < orb_minutes:
        return 0.0, 0.0, 0
    window = bars[:orb_minutes]
    return (max(b["high"] for b in window), min(b["low"] for b in window),
            window[-1]["time"] + 60)


class VWAPORBEngine:
    def __init__(self, or_bars: int = OR_BARS, rr: float = RR, cooldown: int = COOLDOWN):
        self.or_bars = or_bars
        self.rr = rr
        self.cooldown = cooldown
        self.pos = None
        self.pending = None
        self.last_exit = -999
        self.trades = []
        self._cum_pv = 0.0
        self._cum_v = 0.0

    @staticmethod
    def _tick_mid(t):
        return (t["askPrice"] + t["bidPrice"]) / 2.0

    @staticmethod
    def _tick_vol(t):
        return (t.get("askVolume") or 0) + (t.get("bidVolume") or 0)

    def _struct_tp(self, bars, i, side, entry):
        """Nearest untouched opposing fractal pivot (3-bar, 2 each side). None if absent."""
        best = None
        for j in range(2, i - 2):
            w = bars[j - 2:j + 3]
            if side == "LONG":
                if not all(w[2]["high"] > w[k]["high"] for k in (0, 1, 3, 4)):
                    continue
                lvl = w[2]["high"]
                if lvl > entry and all(bars[k]["high"] < lvl for k in range(j + 3, i)):
                    best = lvl if best is None else min(best, lvl)
            else:
                if not all(w[2]["low"] < w[k]["low"] for k in (0, 1, 3, 4)):
                    continue
                lvl = w[2]["low"]
                if lvl < entry and all(bars[k]["low"] > lvl for k in range(j + 3, i)):
                    best = lvl if best is None else max(best, lvl)
        return best

    def run(self, bars, ticks, hist=None):
        """hist: optional overnight bars used for STRUCTURE ONLY (zones/TP). Session logic
        (OR, signals, fills) still runs on bars alone. No lookahead: hist must predate bars."""
        HB = list(hist or [])
        OFF = len(HB)
        ALL = HB + list(bars)
        by_min = defaultdict(list)
        for t in ticks:
            by_min[int(t["timestamp"] // 1000 // 60) * 60].append(t)
        or_high = or_low = None
        if len(bars) >= self.or_bars:
            or_high = max(b["high"] for b in bars[:self.or_bars])
            or_low = min(b["low"] for b in bars[:self.or_bars])
        vwap = None
        for i, b in enumerate(bars):
            bt = by_min.get(b["time"], [])
            for t in bt:  # session VWAP through this bar's ticks
                v = self._tick_vol(t)
                if v > 0:
                    self._cum_pv += self._tick_mid(t) * v
                    self._cum_v += v
            if self._cum_v > 0:
                vwap = self._cum_pv / self._cum_v
            # pending fill (market, first tick after signal bar)
            if self.pos is None and self.pending and i > self.pending["sig_i"]:
                if i - self.pending["sig_i"] > 2 or not bt:
                    if i - self.pending["sig_i"] > 2:
                        self.pending = None
                else:
                    t = bt[0]
                    sl = self.pending["sl"]
                    px = t["askPrice"] if self.pending["side"] == "LONG" else t["bidPrice"]
                    if (self.pending["side"] == "SHORT" and px > sl) or \
                       (self.pending["side"] == "LONG" and px < sl):
                        self.pending = None
                    else:
                        risk = abs(px - sl)
                        tp_fixed = px + risk * self.rr if self.pending["side"] == "LONG" \
                            else px - risk * self.rr
                        tp_struct = self._struct_tp(ALL, i + OFF, self.pending["side"], px)
                        # take profit at whichever comes first: structure or fixed multiple
                        if self.pending["side"] == "LONG":
                            tp = min(x for x in [tp_fixed] + ([tp_struct] if tp_struct else []) if x > px)
                        else:
                            tp = max(x for x in [tp_fixed] + ([tp_struct] if tp_struct else []) if x < px)
                        self.pos = {"side": self.pending["side"], "entry": px, "sl": sl,
                                    "tp": tp, "i": i, "ts": t["timestamp"]}
                        self.pending = None
            # manage open position: SL first, then TP
            if self.pos:
                p = self.pos
                for t in bt:
                    bid, ask = t["bidPrice"], t["askPrice"]
                    if p["side"] == "SHORT":
                        if ask >= p["sl"]:
                            self._close(i, p["sl"], "SL", t["timestamp"]); break
                        if bid <= p["tp"]:
                            self._close(i, p["tp"], "TP", t["timestamp"]); break
                    else:
                        if bid <= p["sl"]:
                            self._close(i, p["sl"], "SL", t["timestamp"]); break
                        if ask >= p["tp"]:
                            self._close(i, p["tp"], "TP", t["timestamp"]); break
            # signal on bar close
            if or_high is None or vwap is None:
                continue
            if self.pos is not None or self.pending is not None or i - self.last_exit < self.cooldown:
                continue
            if b["close"] > or_high and b["close"] > vwap:
                self.pending = {"side": "LONG", "sl": or_low, "sig_i": i}
            elif b["close"] < or_low and b["close"] < vwap:
                self.pending = {"side": "SHORT", "sl": or_high, "sig_i": i}
        return self.trades

    def _close(self, i, px, why, ts_ms):
        p = self.pos
        pnl = (px - p["entry"]) if p["side"] == "LONG" else (p["entry"] - px)
        risk = abs(p["entry"] - p["sl"])
        self.trades.append({"t_in": p["ts"], "t_out": ts_ms, "side": p["side"],
                            "entry": p["entry"], "sl": p["sl"], "tp": p["tp"], "exit": px,
                            "result": why, "pnl": round(pnl, 2),
                            "rr": round(pnl / risk, 2) if risk else 0.0})
        self.pos = None
        self.last_exit = i
