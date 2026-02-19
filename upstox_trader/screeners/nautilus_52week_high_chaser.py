#!/usr/bin/env python3
"""
52 Week High Approaching Chaser Strategy for NautilusTrader

Strategy:
1. Track 52-week high (rolling 252 trading days)
2. When current price is within threshold % of the 52-week high, enter LONG
3. Use trailing stop loss to lock in profits
4. Sell when it reaches/breaks the 52-week high
5. Uses daily data for swing trading
6. After exit, wait for cooldown before re-entering

Risk Management:
- Initial stop loss: 8% (tighter)
- Trailing stop: Activates after 2% profit, trails at 3% below highest price since entry
- Better risk-reward ratio
"""

from decimal import Decimal
from typing import Optional

import pandas as pd

from nautilus_trader.config import StrategyConfig
from nautilus_trader.core.data import Data
from nautilus_trader.indicators.base.indicator import Indicator
from nautilus_trader.model import Bar, BarType, InstrumentId, Quantity
from nautilus_trader.model.enums import OrderSide
from nautilus_trader.model.instruments import Instrument
from nautilus_trader.trading.strategy import Strategy


class FiftyTwoWeekHighIndicator(Indicator):
    """
    Custom indicator to track the 52-week (252 trading days) rolling high.
    """

    def __init__(self, period: int = 252):
        super().__init__(params=[period])
        self.period = period
        self._high_prices: list[float] = []
        self._current_52w_high: Optional[float] = None
        self._has_inputs = False
        self._count = 0

    def handle_bar(self, bar: Bar) -> None:
        """Update the indicator with a new bar."""
        high_price = float(bar.high)
        self._high_prices.append(high_price)

        # Keep only the last 'period' high prices
        if len(self._high_prices) > self.period:
            self._high_prices.pop(0)

        # Calculate 52-week high from previous periods only (shift by 1)
        if len(self._high_prices) >= self.period:
            # Exclude current bar's high to avoid look-ahead bias
            self._current_52w_high = max(self._high_prices[:-1])
        elif len(self._high_prices) > 1:
            # Use what we have if less than full period (min_periods behavior)
            self._current_52w_high = max(self._high_prices[:-1])

        self._has_inputs = True
        self._count += 1
        self._set_has_inputs(True)

    @property
    def value(self) -> Optional[float]:
        """Return the current 52-week high."""
        return self._current_52w_high

    def is_initialized(self) -> bool:
        """Check if the indicator has enough data."""
        return self._count >= 100  # min_periods equivalent

    def reset(self) -> None:
        """Reset the indicator state."""
        self._high_prices = []
        self._current_52w_high = None
        self._has_inputs = False
        self._count = 0


class FiftyTwoWeekHighChaserConfig(StrategyConfig, kw_only=True):
    """Configuration for the 52-Week High Chaser strategy."""

    instrument_id: InstrumentId
    bar_type: BarType
    entry_threshold_pct: float = 3.0  # Enter when within this % of 52-week high
    stop_loss_pct: float = 3.0  # Stop loss at -3% (balance between R:R and noise)
    trailing_stop_activation_pct: float = 2.0  # Activate trailing stop after 2% profit
    trailing_stop_pct: float = 3.0  # Trail at 3% below highest price
    cooldown_bars: int = 30  # Cooldown period in bars after exit
    max_holding_bars: int = 30  # Maximum holding period in bars
    trade_size: Decimal = Decimal("1")
    max_risk_per_trade_pct: float = 1.0  # Max 1% of capital at risk per trade
    max_total_loss_pct: float = 5.0  # Stop trading if total loss exceeds this % of capital
    max_consecutive_losses: int = 3  # Stop trading after this many consecutive losses
    enable_trend_filter: bool = False  # Require minimum trend strength for entries
    min_trend_score: float = 55.0  # 0-100 score threshold when trend filter is enabled
    trend_fast_ema_period: int = 20
    trend_slow_ema_period: int = 50
    trend_slope_lookback: int = 5
    trend_momentum_lookback: int = 10
    order_id_tag: str = "52W_HIGH"


class FiftyTwoWeekHighChaser(Strategy):
    """
    52-Week High Approaching Chaser Strategy with Trailing Stop Loss and Risk-Based Position Sizing.

    Buy when price is within entry_threshold_pct of the 52-week high.
    Use trailing stop loss to lock in profits.
    Position size is calculated based on risk (max X% of capital per trade).
    Sell when price reaches/breaks the 52-week high, stop loss hits, or max holding period exceeded.
    """

    def __init__(self, config: FiftyTwoWeekHighChaserConfig):
        super().__init__(config)

        # Strategy configuration
        self.entry_threshold_pct = config.entry_threshold_pct
        self.stop_loss_pct = config.stop_loss_pct
        self.trailing_stop_activation_pct = config.trailing_stop_activation_pct
        self.trailing_stop_pct = config.trailing_stop_pct
        self.cooldown_bars = config.cooldown_bars
        self.max_holding_bars = config.max_holding_bars
        self.trade_size = config.trade_size
        self.max_risk_per_trade_pct = config.max_risk_per_trade_pct
        self.max_total_loss_pct = config.max_total_loss_pct
        self.max_consecutive_losses = config.max_consecutive_losses
        self.enable_trend_filter = config.enable_trend_filter
        self.min_trend_score = config.min_trend_score
        self.trend_fast_ema_period = config.trend_fast_ema_period
        self.trend_slow_ema_period = config.trend_slow_ema_period
        self.trend_slope_lookback = config.trend_slope_lookback
        self.trend_momentum_lookback = config.trend_momentum_lookback

        # Custom indicator for 52-week high
        self.high_52w = FiftyTwoWeekHighIndicator(period=252)

        # State tracking
        self.instrument: Optional[Instrument] = None
        self.entry_price: Optional[float] = None
        self.entry_52w_high: Optional[float] = None
        self.highest_price_since_entry: Optional[float] = None  # For trailing stop
        self.bars_in_trade: int = 0
        self.bars_since_exit: int = 0
        self.in_position: bool = False
        self.trailing_stop_active: bool = False
        self.current_trade_size: int = 0  # Actual size for current trade
        self.entry_trend_score: Optional[float] = None
        self.close_history: list[float] = []
        self.signals_seen: int = 0
        self.signals_filtered_by_trend: int = 0

        # Trade history for reporting
        self.trades: list = []  # List of trade dictionaries
        self.entry_time = None  # Track entry timestamp

        # Risk management tracking
        self.total_pnl: float = 0.0  # Running total PnL
        self.consecutive_losses: int = 0  # Count of consecutive losing trades
        self.trading_stopped: bool = False  # Flag to stop trading
        self.stop_reason: str = ""  # Reason for stopping

    def on_start(self) -> None:
        """Actions to perform when strategy starts."""
        self.instrument = self.cache.instrument(self.config.instrument_id)
        if self.instrument is None:
            self.log.error(f"Could not find instrument for {self.config.instrument_id}")
            self.stop()
            return

        # Register indicator for bar updates
        self.register_indicator_for_bars(self.config.bar_type, self.high_52w)

        # Request historical data to hydrate indicator
        self.request_bars(self.config.bar_type)

        # Subscribe to live bar data
        self.subscribe_bars(self.config.bar_type)

        self.log.info(f"52-Week High Chaser strategy started for {self.config.instrument_id}")
        self.log.info(f"Config: Entry threshold={self.entry_threshold_pct}%, Stop loss={self.stop_loss_pct}%, "
                      f"Trailing stop activation={self.trailing_stop_activation_pct}%, Trailing stop={self.trailing_stop_pct}%")
        if self.enable_trend_filter:
            self.log.info(
                f"Trend filter ON: min score={self.min_trend_score:.1f}, "
                f"EMA={self.trend_fast_ema_period}/{self.trend_slow_ema_period}, "
                f"slope lookback={self.trend_slope_lookback}, momentum lookback={self.trend_momentum_lookback}"
            )
        else:
            self.log.info("Trend filter OFF")

    def on_stop(self) -> None:
        """Actions to perform when strategy stops."""
        if self.signals_seen > 0:
            trend_filtered_pct = (self.signals_filtered_by_trend / self.signals_seen) * 100
            self.log.info(
                f"Signal stats: seen={self.signals_seen}, "
                f"filtered_by_trend={self.signals_filtered_by_trend} ({trend_filtered_pct:.1f}%)"
            )
        self.log.info("52-Week High Chaser strategy stopped")

    def on_bar(self, bar: Bar) -> None:
        """Handle incoming bar data."""
        current_price = float(bar.close)
        self.close_history.append(current_price)

        # Wait for indicator to initialize
        if not self.high_52w.is_initialized():
            return

        # Check if trading is stopped due to risk limits
        if self.trading_stopped:
            return

        current_high = float(bar.high)  # Use high for trailing stop calculation
        high_52w_value = self.high_52w.value

        if high_52w_value is None:
            return

        # Update cooldown counter if not in position
        if not self.in_position:
            self.bars_since_exit += 1

        # Check if in cooldown
        in_cooldown = self.bars_since_exit < self.cooldown_bars

        # Calculate distance to 52-week high
        distance_to_52w_pct = ((high_52w_value - current_price) / current_price) * 100

        # ENTRY CONDITION - Check risk limits before entering
        if not self.in_position and not in_cooldown:
            # Check max total loss limit
            if self.total_pnl < -(self.max_total_loss_pct / 100 * 1_000_000):
                self.trading_stopped = True
                self.stop_reason = f"Max loss limit reached: {self.total_pnl:,.0f} < -{self.max_total_loss_pct}% of capital"
                self.log.warning(f"TRADING STOPPED: {self.stop_reason}")
                return

            # Check consecutive losses limit
            if self.consecutive_losses >= self.max_consecutive_losses:
                self.trading_stopped = True
                self.stop_reason = f"Max consecutive losses reached: {self.consecutive_losses}"
                self.log.warning(f"TRADING STOPPED: {self.stop_reason}")
                return

            if 0 < distance_to_52w_pct <= self.entry_threshold_pct:
                self.signals_seen += 1
                trend_score = self._calculate_trend_score()
                if self.enable_trend_filter:
                    if trend_score is None or trend_score < self.min_trend_score:
                        self.signals_filtered_by_trend += 1
                        return
                self._enter_long(current_price, high_52w_value, bar, trend_score)

        # EXIT CONDITIONS (if in position)
        if self.in_position:
            self.bars_in_trade += 1

            # Update highest price since entry (for trailing stop)
            if self.highest_price_since_entry is None or current_high > self.highest_price_since_entry:
                self.highest_price_since_entry = current_high
                self.log.debug(f"New high since entry: {self.highest_price_since_entry:.2f}")

            pnl_pct = ((current_price - self.entry_price) / self.entry_price) * 100
            exit_reason = None

            # Check if trailing stop should activate
            if not self.trailing_stop_active and pnl_pct >= self.trailing_stop_activation_pct:
                self.trailing_stop_active = True
                self.log.info(f"Trailing stop ACTIVATED at {self.trailing_stop_pct}% below highest price")

            # 1. Take Profit: Reached/Broke 52-week high
            if current_price >= self.entry_52w_high:
                exit_reason = "52W_HIGH_REACHED"

            # 2. Trailing Stop Loss (if activated)
            elif self.trailing_stop_active and self.highest_price_since_entry:
                trailing_stop_price = self.highest_price_since_entry * (1 - self.trailing_stop_pct / 100)
                if current_price <= trailing_stop_price:
                    exit_reason = "TRAILING_STOP"
                    self.log.info(f"Trailing stop hit: Price {current_price:.2f} <= Stop {trailing_stop_price:.2f}")

            # 3. Initial Stop Loss (only if trailing stop not active)
            elif not self.trailing_stop_active and pnl_pct <= -self.stop_loss_pct:
                exit_reason = "STOP_LOSS"

            # 4. Max Holding Period
            elif self.bars_in_trade >= self.max_holding_bars:
                exit_reason = "MAX_HOLDING"

            # 5. New 52-week high formed far above entry (momentum fading)
            elif high_52w_value > self.entry_52w_high * 1.05:
                exit_reason = "NEW_52W_HIGH_FORMED"

            if exit_reason:
                self._exit_long(current_price, exit_reason, bar)

    def _calculate_trend_score(self) -> Optional[float]:
        """Calculate simple trend strength score (0-100) from close history."""
        min_history = max(
            self.trend_slow_ema_period + self.trend_slope_lookback,
            self.trend_momentum_lookback + 1,
        )
        if len(self.close_history) < min_history:
            return None

        closes = pd.Series(self.close_history, dtype=float)
        fast_ema = closes.ewm(span=self.trend_fast_ema_period, adjust=False).mean()
        slow_ema = closes.ewm(span=self.trend_slow_ema_period, adjust=False).mean()

        close_now = float(closes.iloc[-1])
        fast_now = float(fast_ema.iloc[-1])
        slow_now = float(slow_ema.iloc[-1])
        fast_prev = float(fast_ema.iloc[-(self.trend_slope_lookback + 1)])
        momentum_ref = float(closes.iloc[-(self.trend_momentum_lookback + 1)])

        score = 0.0

        # Trend structure: price above fast EMA and fast EMA above slow EMA.
        if close_now > fast_now:
            score += 25.0
        if fast_now > slow_now:
            score += 35.0

        # EMA slope rewards persistent uptrend.
        slope_pct = ((fast_now - fast_prev) / fast_prev) * 100 if fast_prev > 0 else 0.0
        if slope_pct > 1.0:
            score += 25.0
        elif slope_pct > 0.0:
            score += 15.0

        # Medium-term price momentum.
        if close_now > momentum_ref:
            score += 15.0

        return min(100.0, score)

    def _enter_long(self, price: float, high_52w: float, bar: Bar, trend_score: Optional[float]) -> None:
        """Enter a long position with risk-based position sizing."""
        # Calculate position size based on risk
        # Risk = (entry_price - stop_loss_price) per share
        # Max risk = max_risk_per_trade_pct% of capital
        stop_loss_price = price * (1 - self.stop_loss_pct / 100)
        risk_per_share = price - stop_loss_price

        # Get account balance (approximate starting balance)
        # In backtest, we know starting balance is 1,000,000
        capital = 1_000_000.0  # Could be dynamic in live trading

        # Calculate max risk amount
        max_risk_amount = capital * (self.max_risk_per_trade_pct / 100)

        # Calculate shares based on risk
        shares_by_risk = int(max_risk_amount / risk_per_share)

        # Use minimum of risk-based size and configured trade size
        self.current_trade_size = min(int(self.trade_size), shares_by_risk)

        # Ensure at least 1 share
        self.current_trade_size = max(1, self.current_trade_size)

        order = self.order_factory.market(
            instrument_id=self.config.instrument_id,
            order_side=OrderSide.BUY,
            quantity=self.instrument.make_qty(Decimal(str(self.current_trade_size))),
        )

        self.submit_order(order)

        self.entry_price = price
        self.entry_52w_high = high_52w
        self.highest_price_since_entry = price
        self.bars_in_trade = 0
        self.in_position = True
        self.trailing_stop_active = False
        self.entry_time = bar.ts_event  # Track entry time
        self.entry_trend_score = trend_score

        # Calculate actual risk with this position size
        actual_risk = risk_per_share * self.current_trade_size
        actual_risk_pct = (actual_risk / capital) * 100

        # Calculate potential profit
        potential_profit_pct = ((high_52w - price) / price) * 100
        risk_reward_ratio = potential_profit_pct / self.stop_loss_pct if self.stop_loss_pct > 0 else 0

        trend_display = f"{trend_score:.1f}" if trend_score is not None else "NA"

        self.log.info(
            f"LONG ENTRY @ {price:.2f} | 52w-High: {high_52w:.2f} | "
            f"Distance: {((high_52w - price) / price) * 100:.2f}% | "
            f"Shares: {self.current_trade_size} | "
            f"Risk: ₹{actual_risk:,.0f} ({actual_risk_pct:.1f}%) | "
            f"R:R = 1:{risk_reward_ratio:.1f} | "
            f"TrendScore: {trend_display} | "
            f"Date: {bar.ts_event}"
        )

    def _exit_long(self, price: float, reason: str, bar: Bar) -> None:
        """Exit the long position."""
        # Close all positions for this instrument
        self.close_all_positions(self.config.instrument_id)

        pnl_pct = ((price - self.entry_price) / self.entry_price) * 100
        pnl_amount = (price - self.entry_price) * self.current_trade_size

        # Update risk management tracking
        self.total_pnl += pnl_amount
        if pnl_amount < 0:
            self.consecutive_losses += 1
        else:
            self.consecutive_losses = 0  # Reset on win

        # Calculate risk-reward ratio
        potential_profit_pct = ((self.entry_52w_high - self.entry_price) / self.entry_price) * 100
        risk_reward_ratio = potential_profit_pct / self.stop_loss_pct if self.stop_loss_pct > 0 else 0

        trailing_info = ""
        if self.trailing_stop_active and self.highest_price_since_entry:
            trailing_info = f" | High: {self.highest_price_since_entry:.2f}"

        # Record trade for reporting
        trade_record = {
            'entry_date': self.entry_time,
            'exit_date': bar.ts_event,
            'entry_price': self.entry_price,
            'exit_price': price,
            '52w_high': self.entry_52w_high,
            'distance_pct': ((self.entry_52w_high - self.entry_price) / self.entry_price) * 100,
            'shares': self.current_trade_size,
            'pnl_pct': pnl_pct,
            'pnl_amount': pnl_amount,
            'bars_held': self.bars_in_trade,
            'risk_reward': risk_reward_ratio,
            'reason': reason,
            'trailing_active': self.trailing_stop_active,
            'trend_score': self.entry_trend_score,
        }
        self.trades.append(trade_record)

        self.log.info(
            f"EXIT @ {price:.2f} | P&L: {pnl_pct:+.2f}% | "
            f"Bars Held: {self.bars_in_trade} | Reason: {reason}{trailing_info} | "
            f"Date: {bar.ts_event} | "
            f"Total PnL: ₹{self.total_pnl:,.0f} | Consec Losses: {self.consecutive_losses}"
        )

        # Reset state
        self.entry_price = None
        self.entry_52w_high = None
        self.highest_price_since_entry = None
        self.bars_in_trade = 0
        self.bars_since_exit = 0
        self.in_position = False
        self.trailing_stop_active = False
        self.entry_time = None
        self.entry_trend_score = None

    def on_order_filled(self, event) -> None:
        """Handle order fill events."""
        self.log.info(f"Order filled: {event.client_order_id}")

    def on_position_opened(self, event) -> None:
        """Handle position opened events."""
        self.log.info(f"Position opened: {event.position_id}")

    def on_position_closed(self, event) -> None:
        """Handle position closed events."""
        self.log.info(
            f"Position closed: {event.position_id} | "
            f"P&L: {event.realized_pnl}"
        )
