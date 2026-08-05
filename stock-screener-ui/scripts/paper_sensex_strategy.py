#!/usr/bin/env python3
"""Range-trading strategy for paper SENSEX options.

Strategy: RANGE REVERSION WITH MOMENTUM CONFIRMATION
  - Day range from SENSEX OHLC (support = day low, resistance = day high).
  - Support zone: spot within ZONE_PTS of the day low.
  - Resistance zone: spot within ZONE_PTS of the day high.
  - Entry requires 2 consecutive polls moving INTO the zone (bounce confirmation).
  - LONG (buy CE) at support zone, SHORT (buy PE) at resistance zone.
  - Exit on fixed target / SL (net ₹). One open position at a time.
  - Cooldown after every close before re-entry (avoid immediate whipsaw).

Designed to be driven by scripts/paper_options_monitor.py each poll.
"""
from __future__ import annotations

from datetime import datetime

import config as root_config
IST = root_config.IST

# --- tuning knobs ---
ZONE_PTS = 50.0            # distance from band edge that counts as "in zone"
OI_MAGNET_DIST = 100.0     # distance from an OI-magnet level that counts as "at level"
PIVOT_BOUNCE_DIST = 60.0   # distance from pivot S1/R1 that counts as a bounce zone
BREAK_BUFFER = 15.0        # pts beyond support/resistance that confirms a break
CONFIRM_SAMPLES = 2        # consecutive polls moving into the zone required
TARGET_NET = 600.0         # net P&L ₹ to take profit
SL_NET = -400.0            # net P&L ₹ to stop out
COOLDOWN_POLLS = 4         # polls to wait after a close before re-entry
MAX_OPEN = 1               # max simultaneous paper positions
STRIKE_OFFSET_CE = 0       # buy CE at nearest strike >= spot (ATM/ITM)
STRIKE_OFFSET_PE = 0       # buy PE at nearest strike <= spot


class RangeStrategy:
    def __init__(self):
        self._recent = []          # [(spot, ts)] momentum buffer
        self._cooldown_until = 0   # poll count
        self.target_net = TARGET_NET
        self.sl_net = SL_NET

    def _momentum(self, spot: float) -> float:
        """Slope of the last few spot samples (pts per sample). Positive = rising."""
        if len(self._recent) < 2:
            return 0.0
        return self._recent[-1][0] - self._recent[-2][0]

    def update(self, spot: float, now=None):
        now = now or datetime.now(IST)
        self._recent.append((spot, now))
        if len(self._recent) > 5:
            self._recent.pop(0)
        return self._recent

    def _in_support_zone(self, spot: float, low: float) -> bool:
        return spot <= low + ZONE_PTS

    def _in_resistance_zone(self, spot: float, high: float) -> bool:
        return spot >= high - ZONE_PTS

    def _consecutive_in_zone(self, zone_check) -> bool:
        """Require the last CONFIRM_SAMPLES spots all in the zone AND moving in."""
        if len(self._recent) < CONFIRM_SAMPLES:
            return False
        recent_zone = [zone_check(s) for s, _ in self._recent[-CONFIRM_SAMPLES:]]
        return all(recent_zone)

    def decide(self, spot: float, low: float, high: float, poll_index: int,
               open_positions: int) -> dict:
        """Return an action dict: {action:'none'|'open', side, strike, premium} or none."""
        self.update(spot)
        if open_positions >= MAX_OPEN:
            return {"action": "none"}
        if poll_index < self._cooldown_until:
            return {"action": "none"}
        if high <= low:
            return {"action": "none"}

        mom = self._momentum(spot)
        # Support zone: spot near day low AND drifting up (bounce starting)
        if self._in_support_zone(spot, low) and mom >= 0:
            if self._consecutive_in_zone(lambda s: self._in_support_zone(s, low)):
                return {"action": "open", "side": "CE", "bias": "LONG",
                        "reason": f"support bounce @ {spot:,.0f} (low {low:,.0f})"}
        # Resistance zone: spot near day high AND drifting down (rejection)
        if self._in_resistance_zone(spot, high) and mom <= 0:
            if self._consecutive_in_zone(lambda s: self._in_resistance_zone(s, high)):
                return {"action": "open", "side": "PE", "bias": "SHORT",
                        "reason": f"resistance reject @ {spot:,.0f} (high {high:,.0f})"}
        return {"action": "none"}

    def decide_with_levels(self, spot: float, levels: dict, poll_index: int,
                           open_positions: int) -> dict:
        """S/R-aware decision using OI magnets + pivots + max pain.

        levels (from scripts.paper_sr_levels.scan):
          {spot, day:{low,high}, pivots:{r1,s1,...}, oi_support:[(strike,oi)...],
           oi_resistance:[...], max_pain, next_support, next_resistance}
        Rules (momentum-confirmed):
          LONG (CE):  (a) reversion — spot <= next_support+ZONE_PTS AND momentum up
                      (b) breakout  — spot >= next_resistance+BREAK_BUFFER AND momentum up
          SHORT(PE):  (a) reversion — spot >= next_resistance-ZONE_PTS AND momentum down
                      (b) breakdown — spot <= next_support-BREAK_BUFFER AND momentum down
        """
        self.update(spot)
        if open_positions >= MAX_OPEN:
            return {"action": "none"}
        if poll_index < self._cooldown_until:
            return {"action": "none"}
        day = levels.get("day", {})
        low = day.get("low", 0)
        high = day.get("high", 0)
        if high <= low:
            return {"action": "none"}

        # pick the strongest nearby support / resistance
        sup_level = levels.get("next_support") or low
        res_level = levels.get("next_resistance") or high
        sup_zone = sup_level + ZONE_PTS
        res_zone = res_level - ZONE_PTS
        sup_break = sup_level - BREAK_BUFFER
        res_break = res_level + BREAK_BUFFER

        mom = self._momentum(spot)
        reason_extra = f"support={sup_level:,.0f} resistance={res_level:,.0f} maxpain={levels.get('max_pain',0):,.0f}"

        # (LONG) reversion: support bounce
        if spot <= sup_zone and mom >= 0:
            if self._consecutive_in_zone(lambda s: s <= sup_zone):
                return {"action": "open", "side": "CE", "bias": "LONG",
                        "reason": f"OI/pivot support bounce @ {spot:,.0f} ({reason_extra})"}
        # (SHORT) reversion: resistance reject
        if spot >= res_zone and mom <= 0:
            if self._consecutive_in_zone(lambda s: s >= res_zone):
                return {"action": "open", "side": "PE", "bias": "SHORT",
                        "reason": f"OI/pivot resistance reject @ {spot:,.0f} ({reason_extra})"}
        # (SHORT) breakdown: support broken, downside continuation
        if spot <= sup_break and mom <= 0:
            if self._consecutive_in_zone(lambda s: s <= sup_break):
                return {"action": "open", "side": "PE", "bias": "SHORT",
                        "reason": f"support BREAKDOWN @ {spot:,.0f} (broke {sup_level:,.0f})"}
        # (LONG) breakout: resistance broken, upside continuation
        if spot >= res_break and mom >= 0:
            if self._consecutive_in_zone(lambda s: s >= res_break):
                return {"action": "open", "side": "CE", "bias": "LONG",
                        "reason": f"resistance BREAKOUT @ {spot:,.0f} (broke {res_level:,.0f})"}
        return {"action": "none"}

    def mark_closed(self, poll_index: int):
        self._cooldown_until = poll_index + COOLDOWN_POLLS

    def pick_strike(self, spot: float, side: str, chain: dict) -> float | None:
        """Pick the best strike from the live chain near spot."""
        best = None
        best_diff = float("inf")
        for c in chain.get("data", []):
            st = c.get("strike_price")
            if st is None:
                continue
            ltp = ((c.get("call_options") or {}).get("market_data") or {}).get("ltp", 0) \
                if side == "CE" else ((c.get("put_options") or {}).get("market_data") or {}).get("ltp", 0)
            if ltp and ltp > 0:
                diff = abs(st - spot)
                if diff < best_diff:
                    best_diff = diff
                    best = st
        return best

    def premium_for(self, chain: dict, strike: float, side: str) -> float:
        for c in chain.get("data", []):
            if abs((c.get("strike_price") or 0) - strike) < 1:
                side_d = c.get("call_options" if side == "CE" else "put_options") or {}
                return float((side_d.get("market_data") or {}).get("ltp", 0) or 0)
        return 0.0
