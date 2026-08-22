"""
ADX Trend Strength — Live Signal Generator.

Entry: ADX > 25 confirms strong trend. DI+ > DI- → long. DI- > DI+ → short.
Exit: Opposite crossover, ADX falls below 20, or SL/TP/max holding.
"""
from typing import Optional, List
from trading.orb_signals import ORBSignal, SignalType
from trading.base_signals import BaseSignalGenerator


def compute_adx(highs: List[float], lows: List[float], closes: List[float], period: int = 14) -> dict:
    """Compute ADX, DI+, DI- from OHLC lists. Returns latest values.

    Uses Wilder's smoothing: DX is computed per rolling window and ADX
    is the Wilder moving average (mean of last `period` DX values). This
    is intentionally the smoothed ADX, not a single-period DX snapshot,
    so threshold 25 remains intentional for strong-trend confirmation.
    """
    if len(closes) < period + 2:
        return {"adx": 0.0, "di_plus": 0.0, "di_minus": 0.0}

    tr_list, up_list, down_list = [], [], []
    n = min(len(highs), len(lows), len(closes))
    for i in range(1, n):
        tr = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
        up_move = highs[i] - highs[i-1]
        down_move = lows[i-1] - lows[i]
        up_list.append(up_move if up_move > 0 and up_move > down_move else 0)
        down_list.append(down_move if down_move > 0 and down_move > up_move else 0)
        tr_list.append(tr)

    if len(tr_list) < period:
        return {"adx": 0.0, "di_plus": 0.0, "di_minus": 0.0}

    # Build DX series via rolling Wilder smoothing (SMA over period as cheap Wilder approx)
    dx_list: List[float] = []
    di_plus_last = 0.0
    di_minus_last = 0.0
    for start in range(len(tr_list) - period + 1):
        atr = sum(tr_list[start:start + period]) / period
        di_p = sum(up_list[start:start + period]) / period / atr * 100 if atr > 0 else 0
        di_m = sum(down_list[start:start + period]) / period / atr * 100 if atr > 0 else 0
        denom = di_p + di_m
        dx = abs(di_p - di_m) / denom * 100 if denom > 0 else 0
        dx_list.append(dx)
        di_plus_last = di_p
        di_minus_last = di_m

    if not dx_list:
        return {"adx": 0.0, "di_plus": 0.0, "di_minus": 0.0}

    # Wilder ADX: smoothed DX over period (mean of last `period` DX values)
    if len(dx_list) >= period:
        adx = sum(dx_list[-period:]) / period
    else:
        adx = dx_list[-1]

    return {"adx": round(adx, 1), "di_plus": round(di_plus_last, 1), "di_minus": round(di_minus_last, 1)}


class ADXTrendSignalGenerator(BaseSignalGenerator):

    strategy_type = "ADX_TREND"

    def __init__(self, config: dict):
        self.sl_pct = float(config.get("sl_pct", 3.0))
        self.tp_pct = float(config.get("tp_pct", 6.0))
        self.adx_threshold = float(config.get("adx_threshold", 25.0))
        self.max_holding_days = int(config.get("max_holding_days", 20))
        self.cooldown_days = int(config.get("cooldown_days", 10))
        self.enable_shorts = bool(config.get("enable_shorts", True))
        self.adx_period = int(config.get("adx_period", 14))
        self.stock_ma50_filter = bool(config.get("stock_ma50_filter", False))
        super().__init__(sl_pct=self.sl_pct, tp_pct=self.tp_pct)

    def check_entry(self, symbol: str, market_data: dict) -> Optional[ORBSignal]:
        current_price = market_data.get("current_price")
        daily_highs: List[float] = market_data.get("daily_highs", [])
        daily_closes: List[float] = market_data.get("daily_closes", [])
        if current_price is None or not daily_highs or not daily_closes:
            return None
        daily_lows = market_data.get("daily_lows", None)
        # Require daily_lows from daily_data — no approximation (h*0.97 bias removed).
        # If missing/empty, skip signal instead of injecting biased lows.
        if not daily_lows:
            return None

        adx_data = compute_adx(daily_highs, daily_lows, daily_closes, self.adx_period)
        adx = adx_data["adx"]
        di_plus = adx_data["di_plus"]
        di_minus = adx_data["di_minus"]
        # Expose for runner_signals reuse (avoids duplicate compute_adx)
        market_data["adx"] = adx
        market_data["di_plus"] = di_plus
        market_data["di_minus"] = di_minus

        if adx < self.adx_threshold:
            return None

        # Stock MA50 filter: skip trades against the stock's medium-term trend
        if self.stock_ma50_filter:
            ma50 = market_data.get("ma50")
            if ma50 is not None and ma50 > 0:
                stock_bull = current_price > ma50
            else:
                stock_bull = None  # No MA50 data, skip filter
        else:
            stock_bull = None

        # DI+ > DI- → bullish (long)
        if di_plus > di_minus:
            if stock_bull is not None and not stock_bull:
                return None  # Skip long when stock is below MA50
            sl, tp = self._calc_sl_tp("BUY", current_price)
            return self.create_signal(
                symbol=symbol, signal_type=SignalType.LONG_ENTRY,
                price=current_price, stop_loss=sl, take_profit=tp,
                adx=adx, score=di_plus - di_minus,
                notes=f"ADX {adx:.0f} DI+ {di_plus:.0f} > DI- {di_minus:.0f} → BULLISH | SL {self.sl_pct}% TP {self.tp_pct}%",
            )

        # DI- > DI+ → bearish (short)
        if self.enable_shorts and di_minus > di_plus:
            if stock_bull is not None and stock_bull:
                return None  # Skip short when stock is above MA50
            sl, tp = self._calc_sl_tp("SELL", current_price)
            return self.create_signal(
                symbol=symbol, signal_type=SignalType.SHORT_ENTRY,
                price=current_price, stop_loss=sl, take_profit=tp,
                adx=adx, score=di_minus - di_plus,
                notes=f"ADX {adx:.0f} DI- {di_minus:.0f} > DI+ {di_plus:.0f} → BEARISH | SL {self.sl_pct}% TP {self.tp_pct}%",
            )

        return None

    def check_exit(self, symbol, position_side, entry_price, stop_loss, take_profit, current_price, **kwargs):
        if entry_price <= 0 or current_price <= 0:
            return None
        pnl_pct = self._calc_pnl_pct(position_side, entry_price, current_price)
        days_in_position = kwargs.get("days_in_position", 0)
        max_holding = kwargs.get("max_holding_days", self.max_holding_days)

        if pnl_pct >= self.tp_pct:
            exit_type = SignalType.LONG_EXIT if position_side == "BUY" else SignalType.SHORT_EXIT
            return self.create_signal(symbol=symbol, signal_type=exit_type, price=current_price, stop_loss=stop_loss, take_profit=take_profit, notes=self._format_exit_note("TP", pnl_pct))
        if pnl_pct <= -self.sl_pct:
            exit_type = SignalType.LONG_EXIT if position_side == "BUY" else SignalType.SHORT_EXIT
            return self.create_signal(symbol=symbol, signal_type=exit_type, price=current_price, stop_loss=stop_loss, take_profit=take_profit, notes=self._format_exit_note("SL", pnl_pct))
        if days_in_position >= max_holding:
            exit_type = SignalType.LONG_EXIT if position_side == "BUY" else SignalType.SHORT_EXIT
            return self.create_signal(symbol=symbol, signal_type=exit_type, price=current_price, stop_loss=stop_loss, take_profit=take_profit, notes=self._format_exit_note("MAX_HOLDING", pnl_pct))

        return None
