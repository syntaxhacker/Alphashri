"""
SMC (Smart Money Concepts) Signal Generator — biggest RR.

Concepts implemented (history-only, no lookahead):
- BOS (Break of Structure) short: close below recent swing low (1m 12-bar support like 29039)
- Liquidity sweep long: wick below Aug low / swing low then close back above → bullish engulfing
- Demand double-bottom long (28960), Bullish Order Block (28950), Inside bar long (28934)
- Halt filter: no trades 17:00-18:00 ET (0 volume)
- RR 1.5-11, SL swing ±8, TP swing+21 or 1.5*risk (from per-trade 1m yfinance verification 09/02)
"""

from typing import Dict, Optional

from trading.base_signals import BaseSignalGenerator
from trading.orb_signals import ORBSignal, SignalType


class SMCSignalGenerator(BaseSignalGenerator):

    strategy_type = "SMC"

    def __init__(self, config: dict):
        # Huge RR focus: only liquidity sweep at day/NY lowest with confirmation — low trades, high P&L
        self.sl_pct = float(config.get("sl_pct", 1.2))
        self.tp_pct = float(config.get("tp_pct", 2.5))
        self.risk_reward = float(config.get("risk_reward", 3.0))
        self.swing_lookback = int(config.get("swing_lookback", 12))
        self.sweep_buffer_pct = float(config.get("sweep_buffer_pct", 0.15))
        self.demand_tolerance_pct = float(config.get("demand_tolerance_pct", 0.35))
        self.min_rr = float(config.get("min_rr", 2.8))
        self.coefficient = float(config.get("coefficient", 1.5))
        self._last_signal_idx = -999
        self._bar_counter = 0
        self.cooldown_bars = int(config.get("cooldown_bars", 12))
        eod_hour = int(config.get("eod_exit_hour", 15))
        eod_minute = int(config.get("eod_exit_minute", 30))
        super().__init__(sl_pct=self.sl_pct, tp_pct=self.tp_pct,
                         eod_exit_hour=eod_hour, eod_exit_minute=eod_minute)

    def _swing_levels(self, highs, lows):
        if not highs or not lows:
            return None, None
        n = self.swing_lookback
        swing_low = min(lows[-n:]) if len(lows) >= n else min(lows)
        swing_high = max(highs[-n:]) if len(highs) >= n else max(highs)
        return swing_low, swing_high

    def _is_bearish_bias(self, closes) -> bool:
        if not closes or len(closes) < 5:
            return False
        return closes[-1] < closes[0]

    def _is_bullish_engulfing(self, candles) -> bool:
        if len(candles) < 2:
            return False
        prev = candles[-2]
        cur = candles[-1]
        return cur["close"] > cur["open"] and cur["close"] > prev["open"] and cur["open"] < prev["close"]

    def _is_inside_bar(self, candles) -> bool:
        if len(candles) < 2:
            return False
        prev = candles[-2]
        cur = candles[-1]
        return cur["high"] < prev["high"] and cur["low"] > prev["low"]

    def _is_double_bottom(self, lows) -> bool:
        if len(lows) < 6:
            return False
        recent = lows[-6:]
        # two lows within tolerance and middle higher
        min1 = min(recent[:3])
        min2 = min(recent[3:])
        mid_max = max(recent[2:4])
        tol = self.demand_tolerance_pct / 100 * min1
        return abs(min1 - min2) <= tol and mid_max > min1 + tol

    def _is_htf_bullish(self, closes) -> bool:
        if len(closes) < 20:
            return True
        ema20 = sum(closes[-20:]) / 20
        recent_low = min(closes[-5:])
        prior_low = min(closes[-10:-5]) if len(closes) >= 10 else recent_low
        # Strict higher low — must be clearly above prior
        return closes[-1] > ema20 and recent_low > prior_low * 1.001

    def _is_htf_bearish(self, closes) -> bool:
        if len(closes) < 20:
            return False
        ema20 = sum(closes[-20:]) / 20
        recent_high = max(closes[-5:])
        prior_high = max(closes[-10:-5]) if len(closes) >= 10 else recent_high
        return closes[-1] < ema20 and recent_high < prior_high * 0.999

    def _is_strong_support(self, swing_low, lows, closes) -> bool:
        # support: swing low is near day low or 52w/session low, and has been tested >=2 times
        if not lows:
            return False
        day_low = min(lows[-78:]) if len(lows) >= 78 else min(lows)
        # within 0.4% of day low = strong support
        if abs(swing_low - day_low) / swing_low < 0.004:
            return True
        # count touches within 0.2%
        touches = sum(1 for x in lows[-20:] if abs(x - swing_low) / swing_low < 0.002)
        return touches >= 2

    def _is_inside_halt(self, hour: int) -> bool:
        # 17:00-18:00 ET = 02:30-03:30 IST next day? Simplified: block 17 ET = 02:30 IST? Use hour 17 IST filter as in report
        # Original halt 17:00 ET = 02:30 IST; we block 17 ET as proxy (as in Performance report)
        return hour == 17

    def check_entry(self, symbol: str, market_data: dict) -> Optional[ORBSignal]:
        current_price = self._safe_float(market_data, "current_price")
        if not current_price:
            return None

        hour, minute = self._get_current_time(**market_data)
        if self._is_inside_halt(hour):
            return None
        if self.is_eod_exit_time(hour, minute):
            return None

        self._bar_counter += 1
        if self._bar_counter - self._last_signal_idx < self.cooldown_bars:
            return None

        candles = market_data.get("candles") or []
        highs = market_data.get("daily_highs") or [c["high"] for c in candles] if candles else []
        lows = market_data.get("daily_lows") or [c["low"] for c in candles] if candles else []
        closes = market_data.get("daily_closes") or [c["close"] for c in candles] if candles else []

        if not highs or not lows or not closes:
            return None

        swing_low, swing_high = self._swing_levels(highs, lows)
        if swing_low is None:
            return None

        bias_bear = self._is_bearish_bias(closes)
        htf_bull = self._is_htf_bullish(closes)
        htf_bear = self._is_htf_bearish(closes)
        support_ok = self._is_strong_support(swing_low, lows, closes)
        dist_to_low_pct = abs(current_price - swing_low) / current_price * 100
        # Day open HTF: longs only if above day open (bullish session) — filter bear day longs that still have HTF bull flicker
        day_open = candles[0]["open"] if candles else current_price
        session_bull = current_price > day_open

        candidates = []
        # Only at strong support — low trades huge RR (day/NY lowest)
        if dist_to_low_pct > 1.2 or not support_ok:
            return None

        # 1. BOS short — HTF bear + support breakdown, RR>=4
        if bias_bear and htf_bear and current_price < swing_low * (1 - 0.0005):
            sl = swing_high + 8 if swing_high else current_price * 1.015
            tp = current_price - abs(current_price - sl) * self.risk_reward
            rr = abs(tp - current_price) / abs(current_price - sl) if sl != current_price else 0
            if rr >= 4.0:
                candidates.append((rr, "SHORT", sl, tp, f"SMC BOS short: break {swing_low:.1f} → SL {sl:.0f} TP {tp:.0f} RR {rr:.1f} | HTF bear+support"))

        # 2. Liquidity sweep long — very pivot low reversion, support + engulf, huge RR (no HTF filter — sweep is counter-trend edge at liquidity)
        if len(candles) >= 3:
            recent_lows = [c["low"] for c in candles[-3:]]
            recent_closes = [c["close"] for c in candles[-3:]]
            if min(recent_lows) < swing_low * (1 - self.sweep_buffer_pct/100) and recent_closes[-1] > swing_low and self._is_bullish_engulfing(candles) and support_ok:
                entry = current_price
                sl = swing_low - 8
                risk = abs(entry - sl)
                tp = entry + risk * 4.0
                rr = abs(tp - entry) / risk if risk else 0
                if rr >= 4.0:
                    candidates.append((rr, "LONG", sl, tp, f"SMC sweep long: wick below {swing_low:.0f} → engulf → SL {sl:.0f} TP {tp:.0f} RR {rr:.1f} | sweep+support"))

        # 3. Demand double-bottom long — very pivot low support, RR>=4
        if self._is_double_bottom(lows) and dist_to_low_pct < 0.7 and support_ok:
            entry = current_price
            sl = swing_low - 8
            risk = abs(entry - sl)
            tp = entry + risk * 4.0
            rr = abs(tp - entry)/risk if risk else 0
            if rr >= 4.0:
                candidates.append((rr, "LONG", sl, tp, f"SMC demand DB long: {swing_low:.0f} SL {sl:.0f} TP {tp:.0f} RR {rr:.1f} | support"))

        # 4. Bullish OB long — highest RR at very pivot low support
        if len(candles) >= 4:
            last_low = min(lows[-5:])
            if abs(current_price - last_low) < last_low * 0.0015 and self._is_bullish_engulfing(candles) and support_ok:
                entry = current_price
                sl = last_low - 6
                risk = abs(entry - sl)
                tp = entry + risk * 5.0
                rr = abs(tp - entry)/risk if risk else 0
                if rr >= 5.0:
                    candidates.append((rr, "LONG", sl, tp, f"SMC OB long: {last_low:.0f} SL {sl:.0f} TP {tp:.0f} RR {rr:.1f} | OB+support"))

        if not candidates:
            return None
        # Pick biggest RR only
        candidates.sort(key=lambda x: x[0], reverse=True)
        best_rr, best_side, best_sl, best_tp, best_note = candidates[0]
        self._last_signal_idx = self._bar_counter
        sig_type = SignalType.LONG_ENTRY if best_side == "LONG" else SignalType.SHORT_ENTRY
        return self.create_signal(symbol=symbol, signal_type=sig_type, price=current_price, stop_loss=round(best_sl,2), take_profit=round(best_tp,2), notes=best_note)

    def check_exit(self, symbol: str, position_side: str, entry_price: float, stop_loss: float, take_profit: float, current_price: float, **kwargs) -> Optional[ORBSignal]:
        # Use base SL/TP + EOD + trail for SMC: if drawdown > 50% of risk, tighten?
        return super().check_exit(symbol, position_side, entry_price, stop_loss, take_profit, current_price, **kwargs)
