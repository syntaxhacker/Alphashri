"""
Order-flow signal engine (Tier 1 confluence).

Consumes normalized Upstox ``full``-mode ticks (see ``api/orderflow_stream.py``)
and produces a confluence signal — ``STRONG_BUY`` / ``BUY`` / ``NEUTRAL`` /
``SELL`` / ``STRONG_SELL`` — together with human-readable reasons.

Inputs (all already present in the Upstox full feed, no extra API calls):

* ``ltp``, ``ltt`` (ms), ``volume`` (cumulative ``vtt``)
* ``depth`` ``{buy:[{price,quantity}], sell:[...]}``  → aggressor classification
* ``tbq`` / ``tsq``                                   → total book imbalance
* ``vwap`` (``atp``)                                  → day VWAP position

The class is pure/stateful with no I/O so it can be unit-tested directly.
"""

from collections import deque
from typing import Optional


def clampleft(x: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return lo if x < lo else (hi if x > hi else x)


class OrderFlowSignalEngine:
    """Stateful confluence scorer. Call :meth:`update` per tick."""

    # --- gating: don't emit until there is "appropriate" data ---
    MIN_TICKS = 30
    MIN_ELAPSED_SEC = 30.0
    COOLDOWN_SEC = 30.0

    # --- label thresholds on the composite score (-1..+1) ---
    STRONG = 0.62
    WEAK = 0.28

    # --- windows / normalisation ---
    WINDOW_SEC = 60.0
    SWEEP_SEC = 3.0
    SWEEP_MIN_QTY = 2000.0
    VWAP_FULL_PCT = 0.25  # 0.25% from VWAP == full weight
    MOM_FULL_PCT = 0.20   # 0.20% move over window == full weight

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.tick_count = 0
        self.first_ts: Optional[float] = None
        self.prev_volume: Optional[float] = None
        self.prev_ltp: Optional[float] = None
        self.prev_side: Optional[str] = None
        self.cvd = 0.0
        self.cvd_series: deque = deque()
        self.price_series: deque = deque()
        self.agg_flow: deque = deque()  # (ts, side, qty)
        self.last_signal = "NEUTRAL"
        self.last_signal_ts = -1e12
        self.last_score = 0.0

    # ------------------------------------------------------------------ utils
    @staticmethod
    def _best(depth: dict, key: str):
        for lv in (depth or {}).get(key) or []:
            p, q = lv.get("price"), lv.get("quantity")
            if p and q:
                return float(p), float(q)
        return None, 0.0

    def _prune(self, now: float) -> None:
        cutoff = now - self.WINDOW_SEC
        while self.cvd_series and self.cvd_series[0][0] < cutoff:
            self.cvd_series.popleft()
        while self.price_series and self.price_series[0][0] < cutoff:
            self.price_series.popleft()
        while self.agg_flow and self.agg_flow[0][0] < cutoff:
            self.agg_flow.popleft()

    def _label(self, score: float) -> str:
        if score >= self.STRONG:
            return "STRONG_BUY"
        if score >= self.WEAK:
            return "BUY"
        if score <= -self.STRONG:
            return "STRONG_SELL"
        if score <= -self.WEAK:
            return "SELL"
        return "NEUTRAL"

    def _classify(self, ltp: float, bbid, bask) -> Optional[str]:
        """Aggressor side: buy at ask, sell at bid, else infer from price drift."""
        if bask and ltp >= bask:
            return "B"
        if bbid and ltp <= bbid:
            return "S"
        if self.prev_ltp is not None:
            if ltp > self.prev_ltp:
                return "B"
            if ltp < self.prev_ltp:
                return "S"
        return self.prev_side

    # ----------------------------------------------------------------- update
    def update(self, tick: dict) -> Optional[dict]:
        """Feed one normalized tick. Returns a signal event on a label change."""
        ltp = float(tick.get("ltp") or 0.0)
        vol = float(tick.get("volume") or 0.0)
        ts = float(tick.get("ltt") or 0.0) / 1000.0
        if ltp <= 0 or ts <= 0:
            return None

        if self.first_ts is None:
            self.first_ts = ts
        self.tick_count += 1

        depth = tick.get("depth") or {}
        bbid, _ = self._best(depth, "buy")
        bask, _ = self._best(depth, "sell")

        # --- aggressor-classified delta (buy at ask / sell at bid) ---
        if self.prev_volume is not None and vol >= self.prev_volume:
            dv = vol - self.prev_volume
            if dv > 0:
                side = self._classify(ltp, bbid, bask)
                if side == "B":
                    self.cvd += dv
                elif side == "S":
                    self.cvd -= dv
                # keep total volume for normalisation even when side is unknown
                self.agg_flow.append((ts, side or "N", dv))
                if side:
                    self.prev_side = side
        self.prev_volume = vol
        self.prev_ltp = ltp

        self.cvd_series.append((ts, self.cvd))
        self.price_series.append((ts, ltp))
        self._prune(ts)

        elapsed = ts - self.first_ts
        if self.tick_count < self.MIN_TICKS or elapsed < self.MIN_ELAPSED_SEC:
            return None

        score, reasons = self._score(tick, ltp, ts)
        self.last_score = score
        label = self._label(score)

        if label == self.last_signal:
            return None
        # cooldown: block weak flips, allow strong overrides
        if (ts - self.last_signal_ts) < self.COOLDOWN_SEC and abs(score) < self.STRONG:
            return None

        self.last_signal = label
        self.last_signal_ts = ts
        if not reasons:
            reasons = [f"Composite score {score:+.2f}"]
        return {
            "type": "signal",
            "side": label,
            "score": round(score, 3),
            "cvd": int(self.cvd),
            "reasons": reasons,
            "ts": int(ts * 1000),
        }

    # ------------------------------------------------------------------ score
    def _score(self, tick: dict, ltp: float, ts: float):
        reasons: list[str] = []

        # 1) total book imbalance across all levels (tbq vs tsq)
        tbq = float(tick.get("tbq") or 0.0)
        tsq = float(tick.get("tsq") or 0.0)
        if tbq + tsq > 0:
            s_imb = clampleft((tbq - tsq) / (tbq + tsq) * 1.6)
        else:
            s_imb = 0.0
        if abs(s_imb) >= 0.15:
            reasons.append(
                f"{'Bid' if s_imb > 0 else 'Ask'}-heavy book ({tbq:,.0f} vs {tsq:,.0f})"
            )

        # 2) CVD slope over the window, normalised by traded volume
        s_cvd = 0.0
        d_cvd = 0.0
        if len(self.cvd_series) >= 2:
            d_cvd = self.cvd_series[-1][1] - self.cvd_series[0][1]
            window_vol = sum(q for _, _, q in self.agg_flow)
            denom = window_vol if window_vol > 0 else (abs(d_cvd) or 1.0)
            s_cvd = clampleft(d_cvd / denom * 2.0)
        if abs(s_cvd) >= 0.15:
            reasons.append(
                f"CVD {'rising' if d_cvd > 0 else 'falling'} {d_cvd:+,.0f} ({int(self.WINDOW_SEC)}s)"
            )

        # 3) VWAP position (day average traded price)
        vwap = float(tick.get("vwap") or 0.0)
        s_vwap = 0.0
        if vwap > 0:
            pct = (ltp - vwap) / vwap * 100.0
            s_vwap = clampleft(pct / self.VWAP_FULL_PCT)
        if abs(s_vwap) >= 0.2:
            reasons.append(
                f"{'Above' if s_vwap > 0 else 'Below'} VWAP ({ltp:,.2f} vs {vwap:,.2f})"
            )

        # 4) sweep / aggression burst in the last few seconds
        recent = [(s, q) for t, s, q in self.agg_flow if t >= ts - self.SWEEP_SEC]
        buy_sweep = sum(q for s, q in recent if s == "B")
        sell_sweep = sum(q for s, q in recent if s == "S")
        s_sweep = 0.0
        if max(buy_sweep, sell_sweep) >= self.SWEEP_MIN_QTY:
            s_sweep = 1.0 if buy_sweep > sell_sweep else -1.0
            reasons.append(
                f"{'Buy' if s_sweep > 0 else 'Sell'} sweep "
                f"{max(buy_sweep, sell_sweep):,.0f} ({self.SWEEP_SEC:.0f}s)"
            )

        # 5) short-term price momentum
        s_mom = 0.0
        if len(self.price_series) >= 2:
            p0 = self.price_series[0][1]
            if p0 > 0:
                s_mom = clampleft((ltp - p0) / p0 * 100.0 / self.MOM_FULL_PCT)
        if abs(s_mom) >= 0.5:
            reasons.append(f"Momentum {s_mom:+.2f}")

        score = clampleft(
            0.34 * s_imb
            + 0.28 * s_cvd
            + 0.16 * s_vwap
            + 0.14 * s_sweep
            + 0.08 * s_mom
        )
        return score, reasons

    # --------------------------------------------------------------- snapshot
    def snapshot(self) -> dict:
        """Current state for stats/diagnostics (not a signal)."""
        return {
            "score": round(self.last_score, 3),
            "label": self.last_signal,
            "cvd": int(self.cvd),
            "ticks": self.tick_count,
        }
