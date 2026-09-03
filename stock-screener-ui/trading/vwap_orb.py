"""VWAP + ORB combined strategy (simple, Phase 1 for tick replay).

Rules (history-only):
  OR = high/low of the first OR_BARS 1m bars of the session.
  VWAP = cumulative tick-VWAP (mid price weighted by ask+bid volume).
  LONG: 1m close breaks above OR high AND close > VWAP -> buy next tick (ask).
  SHORT: 1m close breaks below OR low AND close < VWAP -> sell next tick (bid).
  SL: opposite OR edge. TP: 2R. One position at a time, cooldown after exit.
  Exits evaluated per tick (SL-first), same conventions as SMCIFVGEngine.
"""
from collections import defaultdict

OR_BARS = 15
RR = 2.0
COOLDOWN = 5


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

    def run(self, bars, ticks):
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
                        tp = px + (px - sl) * self.rr if self.pending["side"] == "LONG" \
                            else px - (sl - px) * self.rr
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
