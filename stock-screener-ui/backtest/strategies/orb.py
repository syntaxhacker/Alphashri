"""
ORB Strategy - Opening Range Breakout

Intraday strategy that trades breakouts above/below the opening range.

Features:
- Long: Breakout above OR High
- Short: Breakdown below OR Low
- Trend filter: Only trade in direction of trend (EMA + ADX based)
- ADX confirms trend strength (ADX > 25 = strong trend)
- Bullish: Price > EMA and ADX > threshold
- Bearish: Price < EMA and ADX > threshold

Best performing parameters:
- Timeframe: 5 minutes
- OR Period: 45 minutes
- Entry: Breakout above OR High + 0.1% of range (long) / breakdown below OR Low - 0.1% (short)
- Stop Loss: 0.4% (adjusted for trading costs)
- Take Profit: 1.2% (1:3 risk/reward ratio to cover costs)
- Exit by: 14:45 IST (EOD)

Note: Previous 1:2 ratio (0.5% SL, 1.0% TP) was losing due to ~0.3% trading costs.
The new 1:3 ratio (0.4% SL, 1.2% TP) provides better expectancy.
"""

import sys
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Dict, List, Optional

import pandas as pd
import numpy as np

from nautilus_trader.backtest.config import BacktestEngineConfig
from nautilus_trader.backtest.engine import BacktestEngine
from nautilus_trader.model import BarType, InstrumentId, Money, Symbol, TraderId, Venue
from nautilus_trader.model.currencies import INR
from nautilus_trader.model.enums import AccountType, OmsType, OrderSide
from nautilus_trader.model.instruments import Equity
from nautilus_trader.model.objects import Price, Quantity
from nautilus_trader.persistence.wranglers import BarDataWrangler
from nautilus_trader.trading.strategy import Strategy
from nautilus_trader.config import StrategyConfig

from .base import BaseStrategy, StrategyParam
from ..costs import calculate_trading_costs

# Add project root to path for imports
_current_file_dir = os.path.dirname(os.path.abspath(__file__))
_backtest_dir = os.path.dirname(_current_file_dir)
_ui_dir = os.path.dirname(_backtest_dir)
_project_root_dir = os.path.dirname(_ui_dir)

if _project_root_dir not in sys.path:
    sys.path.insert(0, _project_root_dir)


def get_ist_time(ts_ns: int) -> tuple:
    """Convert nanosecond timestamp to IST time components."""
    ts_sec = ts_ns / 1_000_000_000
    dt_utc = datetime.fromtimestamp(ts_sec, tz=timezone.utc)
    dt_ist = dt_utc + timedelta(hours=5, minutes=30)
    return dt_ist.hour, dt_ist.minute, dt_ist.date()


def run_single_stock_backtest(args):
    """
    Run backtest for a single stock in isolation.
    This function is at module level for multiprocessing compatibility.

    Args:
        args: tuple of (symbol, params_dict, days)

    Returns:
        dict with symbol, success flag, and result or error
    """
    symbol, params, days = args

    try:
        from upstox_trader.screeners.tv_screen_usage import TVScreenerUsage

        # Extract params
        or_minutes = params.get('or_minutes', 45)
        sl_pct = params.get('stop_loss_pct', 0.4)  # Updated: 1:3 ratio
        tp_pct = params.get('take_profit_pct', 1.2)  # Updated: 1:3 ratio
        trade_size = params.get('trade_size', 100)
        timeframe = int(params.get('timeframe', '5'))
        include_costs = params.get('include_costs', True)
        enable_shorts = params.get('enable_shorts', False)
        trend_filter = params.get('trend_filter', False)
        ema_period = params.get('ema_period', 20)
        adx_period = params.get('adx_period', 14)
        adx_threshold = params.get('adx_threshold', 25.0)
        cooldown_bars = params.get('cooldown_bars', 3)

        # Create instrument
        venue = Venue("SIMULATED")
        instrument_id = InstrumentId.from_str(f"{symbol}.{venue}")
        instrument = Equity(
            instrument_id=instrument_id,
            raw_symbol=Symbol(symbol),
            currency=INR,
            price_precision=2,
            price_increment=Price.from_str("0.01"),
            lot_size=Quantity.from_str("1"),
            ts_event=0,
            ts_init=0,
            isin=None,
        )

        # Fetch data
        today = datetime.now()
        to_date = today.strftime('%Y-%m-%d')
        from_date = (today - timedelta(days=days + 30)).strftime('%Y-%m-%d')

        screener = TVScreenerUsage(enable_paper_trading=False)
        df = screener.upstox_api.fetch_historical_data_v3(
            symbol=symbol, unit="minutes", interval=timeframe,
            to_date=to_date, from_date=from_date,
        )

        if df is None or df.empty:
            return {'symbol': symbol, 'success': False, 'error': 'No data'}

        # Also fetch today's intraday data (historical API doesn't include today)
        try:
            df_intraday = screener.upstox_api.fetch_intraday_data_v3(
                symbol=symbol,
                interval=str(timeframe)
            )
            if df_intraday is not None and not df_intraday.empty:
                # Merge intraday with historical data, avoiding duplicates
                df = pd.concat([df, df_intraday]).drop_duplicates(keep='last')
                df = df.sort_index()
        except Exception as e:
            print(f"Warning: Could not fetch intraday data for {symbol}: {e}")

        # Prepare data
        df_copy = df[['open', 'high', 'low', 'close', 'volume']].copy()
        if not isinstance(df_copy.index, pd.DatetimeIndex):
            df_copy.index = pd.to_datetime(df_copy.index)
        if df_copy.index.tz is None:
            df_copy.index = df_copy.index.tz_localize('UTC')
        else:
            df_copy.index = df_copy.index.tz_convert('UTC')

        # Convert to NautilusTrader bars
        bar_type = BarType.from_str(f"{instrument_id}-{timeframe}-MINUTE-LAST-EXTERNAL")
        wrangler = BarDataWrangler(bar_type=bar_type, instrument=instrument)
        bars = wrangler.process(df_copy)

        if not bars:
            return {'symbol': symbol, 'success': False, 'error': 'No bars'}

        # Create config and strategy
        config = ORBConfig(
            instrument_id=instrument_id,
            bar_type=bar_type,
            or_minutes=or_minutes,
            sl_pct=sl_pct,
            tp_pct=tp_pct,
            trade_size=trade_size,
            enable_shorts=enable_shorts,
            trend_filter=trend_filter,
            ema_period=ema_period,
            adx_period=adx_period,
            adx_threshold=adx_threshold,
            cooldown_bars=cooldown_bars,
        )

        # Run backtest
        engine = BacktestEngine(
            config=BacktestEngineConfig(trader_id=TraderId("BACKTESTER-001"))
        )
        account_type = AccountType.MARGIN if enable_shorts else AccountType.CASH
        engine.add_venue(
            venue=venue,
            oms_type=OmsType.NETTING,
            account_type=account_type,
            base_currency=INR,
            starting_balances=[Money(1_000_000, INR)]
        )
        engine.add_instrument(instrument)
        engine.add_data(bars)

        strategy = ORBNautilusStrategy(config=config)
        engine.add_strategy(strategy=strategy)
        engine.run()

        trades = strategy.trades
        engine.dispose()

        if not trades:
            return {'symbol': symbol, 'success': True, 'trades': 0, 'result': None}

        # Calculate metrics
        gross_pnl = sum(t['gross_pnl'] for t in trades)
        total_costs = sum(t['trading_costs'] for t in trades) if include_costs else 0
        net_pnl = gross_pnl - total_costs

        wins = sum(1 for t in trades if t['net_pnl'] > 0)
        losses = sum(1 for t in trades if t['net_pnl'] < 0)
        total_trades = wins + losses
        win_rate = (wins / total_trades * 100) if total_trades > 0 else 0

        gross_profits = sum(t['net_pnl'] for t in trades if t['net_pnl'] > 0)
        gross_losses = abs(sum(t['net_pnl'] for t in trades if t['net_pnl'] < 0))
        profit_factor = gross_profits / gross_losses if gross_losses > 0 else float('inf') if gross_profits > 0 else 0

        tp_exits = sum(1 for t in trades if t['exit_reason'] == 'TP')
        sl_exits = sum(1 for t in trades if t['exit_reason'] == 'SL')
        eod_exits = sum(1 for t in trades if t['exit_reason'] == 'EOD')

        result = {
            'symbol': symbol,
            'trades': total_trades,
            'wins': wins,
            'losses': losses,
            'win_rate': round(win_rate, 1),
            'gross_pnl': round(gross_pnl, 2),
            'total_costs': round(total_costs, 2),
            'net_pnl': round(net_pnl, 2),
            'pf': round(profit_factor, 2),
            'tp_exits': tp_exits,
            'sl_exits': sl_exits,
            'eod_exits': eod_exits,
        }

        # Prepare candle data for charting (serialize DataFrame)
        candle_data = {
            'index': [idx.isoformat() for idx in df.index],
            'open': df['open'].tolist(),
            'high': df['high'].tolist(),
            'low': df['low'].tolist(),
            'close': df['close'].tolist(),
            'volume': df['volume'].tolist() if 'volume' in df.columns else [0] * len(df),
        }

        return {
            'symbol': symbol,
            'success': True,
            'trades': total_trades,
            'result': result,
            'candles': candle_data,
            'trade_list': trades,  # Include trade details for chart
        }

    except Exception as e:
        return {'symbol': symbol, 'success': False, 'error': str(e)}


class ORBNautilusStrategy(Strategy):
    """NautilusTrader implementation of ORB strategy with trend filter and short support."""

    def __init__(self, config: 'ORBConfig'):
        super().__init__(config)
        self._instrument_id = config.instrument_id
        self._bar_type = config.bar_type
        self._or_minutes = config.or_minutes
        self._sl_pct = config.sl_pct
        self._tp_pct = config.tp_pct
        self._trade_size = config.trade_size
        self._enable_shorts = config.enable_shorts
        self._trend_filter = config.trend_filter
        self._ema_period = config.ema_period
        self._adx_period = config.adx_period
        self._adx_threshold = config.adx_threshold
        self._cooldown_bars = config.cooldown_bars

        self._current_date = None
        self._or_high = None
        self._or_low = None
        self._or_bars = 0
        self._or_defined = False
        self._or_end = 0
        self._entry_price = None
        self._position_side = None

        # Cooldown tracking
        self._last_exit_bar = None  # Bar number when last trade exited
        self._bar_number = 0  # Current bar counter

        # EMA tracking for trend filter
        self._ema = None
        self._ema_multiplier = 2 / (self._ema_period + 1)
        self._bars_count = 0

        # ADX tracking for trend strength
        self._adx = None
        self._plus_dm = None
        self._minus_dm = None
        self._tr = None
        self._smoothed_plus_dm = None
        self._smoothed_minus_dm = None
        self._smoothed_tr = None
        self._adx_values = []  # Store ADX history

        # Previous day OR levels for trend context
        self._prev_or_high = None
        self._prev_or_low = None

        # Store trade data with timestamps for chart visualization
        self.trades = []
        self._current_entry_time = None

    def on_start(self):
        self.subscribe_bars(self._bar_type)

    def on_bar(self, bar):
        hour, minute, date = get_ist_time(bar.ts_event)
        cur_min = hour * 60 + minute
        close_f = float(bar.close)
        high_f = float(bar.high)
        low_f = float(bar.low)

        # Store bar timestamp for trade tracking
        bar_time = datetime.fromtimestamp(bar.ts_event / 1_000_000_000, tz=timezone.utc)
        bar_time_ist = bar_time + timedelta(hours=5, minutes=30)

        # Increment bar counter
        self._bar_number += 1

        # Update EMA for trend filter
        if self._trend_filter:
            self._update_ema(close_f)
            self._update_adx(high_f, low_f, close_f)

        # New day - reset OR and cooldown
        if self._current_date != date:
            # Store previous day's OR for context
            if self._or_defined and self._or_high and self._or_low:
                self._prev_or_high = self._or_high
                self._prev_or_low = self._or_low

            self._current_date = date
            self._or_high = None
            self._or_low = None
            self._or_bars = 0
            self._or_defined = False
            self._last_exit_bar = None  # Reset cooldown on new day

        # Build opening range
        mkt_open = 9 * 60 + 15
        or_end = mkt_open + self._or_minutes
        self._or_end = or_end

        if cur_min < or_end:
            if self._or_high is None:
                self._or_high = high_f
                self._or_low = low_f
            else:
                self._or_high = max(self._or_high, high_f)
                self._or_low = min(self._or_low, low_f)
            self._or_bars += 1
            return

        if not self._or_defined and self._or_bars > 0:
            self._or_defined = True

        if not self._or_defined or self._or_high is None:
            return

        # Exit before market close
        if cur_min >= 14 * 60 + 45:
            positions = self.cache.positions_open(instrument_id=self._instrument_id)
            if positions:
                self._exit(bar, positions[0], "EOD", bar_time_ist)
            return

        # Manage existing position
        positions = self.cache.positions_open(instrument_id=self._instrument_id)
        if positions:
            self._manage(bar, positions[0], bar_time_ist)
            return

        # Only trade first 2 hours after OR
        if cur_min - self._or_end > 120:
            return

        # Check entry
        self._check_entry(bar, close_f, bar_time_ist)

    def _update_ema(self, close: float):
        """Update EMA for trend detection."""
        self._bars_count += 1
        if self._ema is None:
            self._ema = close
        else:
            self._ema = (close - self._ema) * self._ema_multiplier + self._ema

    def _update_adx(self, high: float, low: float, close: float):
        """Update ADX indicator for trend strength measurement."""
        if self._bars_count < 2:
            # Need at least 2 bars to calculate DM and TR
            self._prev_high = high
            self._prev_low = low
            self._prev_close = close
            return

        # Calculate +DM and -DM
        up_move = high - self._prev_high
        down_move = self._prev_low - low

        plus_dm = up_move if up_move > down_move and up_move > 0 else 0
        minus_dm = down_move if down_move > up_move and down_move > 0 else 0

        # Calculate True Range
        tr1 = high - low
        tr2 = abs(high - self._prev_close)
        tr3 = abs(low - self._prev_close)
        tr = max(tr1, tr2, tr3)

        # Smooth the values using Wilder's smoothing (similar to EMA)
        alpha = 1 / self._adx_period

        if self._smoothed_tr is None:
            self._smoothed_tr = tr
            self._smoothed_plus_dm = plus_dm
            self._smoothed_minus_dm = minus_dm
        else:
            self._smoothed_tr = alpha * tr + (1 - alpha) * self._smoothed_tr
            self._smoothed_plus_dm = alpha * plus_dm + (1 - alpha) * self._smoothed_plus_dm
            self._smoothed_minus_dm = alpha * minus_dm + (1 - alpha) * self._smoothed_minus_dm

        # Calculate +DI and -DI
        plus_di = (self._smoothed_plus_dm / self._smoothed_tr * 100) if self._smoothed_tr > 0 else 0
        minus_di = (self._smoothed_minus_dm / self._smoothed_tr * 100) if self._smoothed_tr > 0 else 0

        # Calculate DX
        di_sum = plus_di + minus_di
        dx = (abs(plus_di - minus_di) / di_sum * 100) if di_sum > 0 else 0

        # Smooth DX to get ADX
        if self._adx is None:
            self._adx = dx
        else:
            self._adx = alpha * dx + (1 - alpha) * self._adx

        # Store ADX history for debugging
        self._adx_values.append(self._adx)
        if len(self._adx_values) > 100:
            self._adx_values.pop(0)

        # Store previous values for next calculation
        self._prev_high = high
        self._prev_low = low
        self._prev_close = close

    def _get_trend(self, close: float) -> tuple:
        """
        Determine trend direction and strength.

        Returns:
            tuple: (trend_direction, trend_strength)
            - trend_direction: "BULLISH", "BEARISH", or "NEUTRAL"
            - trend_strength: "STRONG" if ADX > threshold, "WEAK" otherwise
        """
        if not self._trend_filter or self._ema is None:
            return "NEUTRAL", "WEAK"

        # Determine trend direction based on price vs EMA and DI
        bullish = close > self._ema
        bearish = close < self._ema

        # Check ADX strength
        strong_trend = self._adx is not None and self._adx > self._adx_threshold

        if bullish:
            return "BULLISH", "STRONG" if strong_trend else "WEAK"
        elif bearish:
            return "BEARISH", "STRONG" if strong_trend else "WEAK"
        else:
            return "NEUTRAL", "WEAK"

    def _check_entry(self, bar, close_f, bar_time_ist):
        if self._or_high is None or self._or_low is None:
            return

        # Check cooldown period - skip entry if too soon after last exit
        if self._last_exit_bar is not None and self._cooldown_bars > 0:
            bars_since_exit = self._bar_number - self._last_exit_bar
            if bars_since_exit < self._cooldown_bars:
                return  # Still in cooldown period

        or_range = self._or_high - self._or_low
        breakout_threshold = or_range * 0.001

        # Get trend if filter enabled
        trend_direction, trend_strength = self._get_trend(close_f)

        # LONG: Breakout above OR High
        long_entry = close_f > self._or_high + breakout_threshold
        # SHORT: Breakdown below OR Low
        short_entry = close_f < self._or_low - breakout_threshold

        # Apply trend filter
        if self._trend_filter:
            # Long only in bullish trend, short only in bearish trend
            long_entry = long_entry and trend_direction == "BULLISH"
            short_entry = short_entry and trend_direction == "BEARISH"

            # Only trade when trend is strong (ADX > threshold)
            long_entry = long_entry and trend_strength == "STRONG"
            short_entry = short_entry and trend_strength == "STRONG"

        # Check SHORT first if shorts enabled (prioritize breakdowns in downtrend)
        if short_entry and self._enable_shorts:
            order = self.order_factory.market(
                instrument_id=self._instrument_id,
                order_side=OrderSide.SELL,
                quantity=Quantity.from_str(str(self._trade_size)),
            )
            self.submit_order(order)
            self._position_side = "SHORT"
            self._entry_price = close_f
            self._current_entry_time = bar_time_ist

        elif long_entry:
            order = self.order_factory.market(
                instrument_id=self._instrument_id,
                order_side=OrderSide.BUY,
                quantity=Quantity.from_str(str(self._trade_size)),
            )
            self.submit_order(order)
            self._position_side = "LONG"
            self._entry_price = close_f
            self._current_entry_time = bar_time_ist

    def _manage(self, bar, position, bar_time_ist):
        cur_price = float(bar.close)

        # Calculate PnL based on position side
        if self._position_side == "SHORT":
            pnl_pct = ((self._entry_price - cur_price) / self._entry_price) * 100
        else:
            pnl_pct = ((cur_price - self._entry_price) / self._entry_price) * 100

        # Take Profit
        if pnl_pct >= self._tp_pct:
            self._exit(bar, position, "TP", bar_time_ist)
        # Stop Loss
        elif pnl_pct <= -self._sl_pct:
            self._exit(bar, position, "SL", bar_time_ist)

    def _exit(self, bar, position, reason, bar_time_ist):
        cur_price = float(bar.close)
        pos_qty = int(float(position.quantity)) if position.quantity else 0

        # Calculate gross PnL based on position side
        if self._position_side == "SHORT":
            gross_pnl = (self._entry_price - cur_price) * abs(pos_qty)
            gross_pnl_pct = ((self._entry_price - cur_price) / self._entry_price) * 100
        else:
            gross_pnl = (cur_price - self._entry_price) * abs(pos_qty)
            gross_pnl_pct = ((cur_price - self._entry_price) / self._entry_price) * 100

        # Calculate trading costs
        costs = calculate_trading_costs(self._entry_price, cur_price, abs(pos_qty))

        # Net PnL after costs
        net_pnl = gross_pnl - costs['total_costs']
        net_pnl_pct = (net_pnl / (self._entry_price * abs(pos_qty))) * 100 if pos_qty != 0 else 0

        # Calculate hold duration
        hold_minutes = 0
        if self._current_entry_time and bar_time_ist:
            delta = bar_time_ist - self._current_entry_time
            hold_minutes = int(delta.total_seconds() / 60)

        self.trades.append({
            'entry_price': self._entry_price,
            'exit_price': cur_price,
            'entry_time': self._current_entry_time.isoformat() if self._current_entry_time else None,
            'exit_time': bar_time_ist.isoformat() if bar_time_ist else None,
            'quantity': abs(pos_qty),
            'gross_pnl': gross_pnl,
            'gross_pnl_pct': gross_pnl_pct,
            'trading_costs': costs['total_costs'],
            'net_pnl': net_pnl,
            'net_pnl_pct': net_pnl_pct,
            'exit_reason': reason,
            'hold_duration_minutes': hold_minutes,
            'date': self._current_entry_time.strftime('%Y-%m-%d') if self._current_entry_time else None,
            'or_high': self._or_high,
            'or_low': self._or_low,
            'side': self._position_side,  # LONG or SHORT
        })

        self.close_all_positions(self._instrument_id)
        self._position_side = None
        self._entry_price = None
        self._current_entry_time = None
        self._last_exit_bar = self._bar_number  # Record exit bar for cooldown

    def on_stop(self):
        pass

    def on_reset(self):
        self._current_date = None
        self._or_high = None
        self._or_low = None
        self._or_defined = False
        self._position_side = None
        self._entry_price = None
        self._ema = None
        self._bars_count = 0


class ORBConfig(StrategyConfig, kw_only=True):
    """Configuration for ORB NautilusTrader strategy."""
    instrument_id: InstrumentId
    bar_type: BarType
    or_minutes: int = 45
    sl_pct: float = 0.5
    tp_pct: float = 1.0
    trade_size: int = 100
    enable_shorts: bool = False
    trend_filter: bool = False
    ema_period: int = 20
    adx_period: int = 14
    adx_threshold: float = 25.0
    cooldown_bars: int = 3
    # Range-bound stock filtering
    skip_range_bound: bool = True
    min_atr_pct: float = 0.5
    min_adx_avg: float = 15.0


class ORBStrategy(BaseStrategy):
    """Opening Range Breakout Strategy - API wrapper."""

    @classmethod
    def get_name(cls) -> str:
        return "ORB - Opening Range Breakout"

    @classmethod
    def get_description(cls) -> str:
        return (
            "Intraday strategy that enters positions when price breaks "
            "above (long) or below (short) the opening range. "
            "Optional trend filter using EMA to trade only in trend direction."
        )

    @classmethod
    def get_params(cls) -> List[StrategyParam]:
        return [
            StrategyParam(
                key='or_minutes',
                label='OR Period (min)',
                type='number',
                default=45,
                min=15,
                max=120,
                step=5
            ),
            StrategyParam(
                key='stop_loss_pct',
                label='Stop Loss %',
                type='number',
                default=0.5,
                min=0.1,
                max=2.0,
                step=0.1
            ),
            StrategyParam(
                key='take_profit_pct',
                label='Take Profit %',
                type='number',
                default=1.0,
                min=0.2,
                max=3.0,
                step=0.1
            ),
            StrategyParam(
                key='trade_size',
                label='Trade Size',
                type='number',
                default=100,
                min=1,
                max=1000,
                step=1
            ),
            StrategyParam(
                key='timeframe',
                label='Timeframe',
                type='select',
                default='5',
                options=['1', '5', '15']
            ),
            StrategyParam(
                key='enable_shorts',
                label='Enable Shorts',
                type='boolean',
                default=False
            ),
            StrategyParam(
                key='trend_filter',
                label='Trend Filter (EMA+ADX)',
                type='boolean',
                default=False
            ),
            StrategyParam(
                key='ema_period',
                label='EMA Period',
                type='number',
                default=20,
                min=5,
                max=50,
                step=1
            ),
            StrategyParam(
                key='adx_period',
                label='ADX Period',
                type='number',
                default=14,
                min=7,
                max=30,
                step=1
            ),
            StrategyParam(
                key='adx_threshold',
                label='ADX Threshold',
                type='number',
                default=25.0,
                min=15.0,
                max=40.0,
                step=1.0
            ),
            StrategyParam(
                key='cooldown_bars',
                label='Cooldown Bars',
                type='number',
                default=3,
                min=0,
                max=10,
                step=1
            ),
            StrategyParam(
                key='skip_range_bound',
                label='Skip Range-Bound Stocks',
                type='boolean',
                default=True
            ),
            StrategyParam(
                key='min_atr_pct',
                label='Min ATR %',
                type='number',
                default=0.5,
                min=0.1,
                max=2.0,
                step=0.1
            ),
            StrategyParam(
                key='min_adx_avg',
                label='Min Avg ADX',
                type='number',
                default=15.0,
                min=10.0,
                max=30.0,
                step=1.0
            ),
        ]

    def validate_params(self, params: Dict) -> List[str]:
        """Validate strategy parameters."""
        errors = []

        if params.get('or_minutes', 45) < 15:
            errors.append("OR Period must be at least 15 minutes")

        if params.get('stop_loss_pct', 0.5) >= params.get('take_profit_pct', 1.0):
            errors.append("Stop Loss must be less than Take Profit")

        return errors

    def run(self, symbols: List[str], days: int, params: Dict,
            progress_callback=None) -> Dict:
        """
        Run ORB backtest for given symbols.

        Args:
            symbols: List of stock symbols
            days: Number of days of historical data
            params: Strategy parameters (or_minutes, stop_loss_pct, take_profit_pct, etc.)
            progress_callback: Optional callback(current, total, message)

        Returns:
            Dict with results, chart_data, and metadata
        """
        from upstox_trader.screeners.tv_screen_usage import TVScreenerUsage

        # Extract parameters
        or_minutes = params.get('or_minutes', 45)
        sl_pct = params.get('stop_loss_pct', 0.5)
        tp_pct = params.get('take_profit_pct', 1.0)
        trade_size = params.get('trade_size', 100)
        timeframe = int(params.get('timeframe', '5'))
        include_costs = params.get('include_costs', True)
        enable_shorts = params.get('enable_shorts', False)
        trend_filter = params.get('trend_filter', False)
        ema_period = params.get('ema_period', 20)
        adx_period = params.get('adx_period', 14)
        adx_threshold = params.get('adx_threshold', 25.0)
        cooldown_bars = params.get('cooldown_bars', 3)
        # Range-bound filtering
        skip_range_bound = params.get('skip_range_bound', True)
        min_atr_pct = params.get('min_atr_pct', 0.5)
        min_adx_avg = params.get('min_adx_avg', 15.0)

        results = []
        chart_data = {}
        all_candles = {}
        skipped_stocks = []

        # Define volatility analysis function
        def analyze_stock_volatility(df: pd.DataFrame, or_minutes: int, timeframe: int) -> dict:
            """
            Analyze if stock is suitable for ORB strategy.
            Uses quick pre-backtest to check recent performance.
            """
            if df is None or len(df) < 100:
                return {'is_suitable': True, 'reason': None}

            # Calculate DAILY volatility
            daily_data = df.groupby(df.index.date).agg({
                'high': 'max',
                'low': 'min',
                'open': 'first',
                'close': 'last'
            })

            if len(daily_data) < 5:
                return {'is_suitable': True, 'reason': None}

            # Daily range as % of price
            daily_range_pct = ((daily_data['high'] - daily_data['low']) / daily_data['close'] * 100)
            avg_daily_range = daily_range_pct.mean()

            # Quick ORB simulation on recent days
            # Check if OR breakouts typically follow through
            mkt_open_min = 9 * 60 + 15
            or_end_min = mkt_open_min + or_minutes

            # Group intraday data by date
            df_with_date = df.copy()
            df_with_date['date'] = df.index.date
            df_with_date['time'] = df.index.hour * 60 + df.index.minute

            follow_through_count = 0
            false_breakout_count = 0
            days_checked = 0

            for date, day_df in df_with_date.groupby('date'):
                if len(day_df) < 10:
                    continue

                # Get OR high/low
                or_bars = day_df[day_df['time'] < or_end_min]
                if len(or_bars) < 3:
                    continue

                or_high = or_bars['high'].max()
                or_low = or_bars['low'].min()
                or_close = or_bars['close'].iloc[-1]

                # Post-OR bars
                post_or = day_df[day_df['time'] >= or_end_min]
                if len(post_or) < 3:
                    continue

                # Check for breakouts and follow-through
                for i in range(min(5, len(post_or))):
                    bar = post_or.iloc[i]
                    # Breakout above OR high?
                    if bar['close'] > or_high * 1.001:
                        # Did next bars stay above? (follow-through)
                        if i + 1 < len(post_or):
                            next_bar = post_or.iloc[i + 1]
                            if next_bar['close'] > or_high:
                                follow_through_count += 1
                            else:
                                false_breakout_count += 1
                        break
                    # Breakdown below OR low?
                    elif bar['close'] < or_low * 0.999:
                        if i + 1 < len(post_or):
                            next_bar = post_or.iloc[i + 1]
                            if next_bar['close'] < or_low:
                                follow_through_count += 1
                            else:
                                false_breakout_count += 1
                        break

                days_checked += 1

            # Calculate false breakout rate
            total_breakouts = follow_through_count + false_breakout_count
            if total_breakouts >= 3:
                false_breakout_rate = false_breakout_count / total_breakouts
            else:
                false_breakout_rate = 0.5  # Unknown, assume neutral

            # Determine suitability
            reasons = []
            is_suitable = True

            # Reject if daily range too low
            if avg_daily_range < 1.5:
                is_suitable = False
                reasons.append(f"Low range: {avg_daily_range:.1f}%")

            # Reject if high false breakout rate (> 60%)
            if false_breakout_rate > 0.6 and total_breakouts >= 5:
                is_suitable = False
                reasons.append(f"High false breakouts: {false_breakout_rate*100:.0f}%")

            return {
                'is_suitable': is_suitable,
                'daily_range_pct': round(avg_daily_range, 2),
                'follow_through_rate': round(1 - false_breakout_rate, 2) if total_breakouts >= 3 else None,
                'reason': '; '.join(reasons) if reasons else None
            }

        # PARALLEL PROCESSING using multiprocessing
        from multiprocessing import Pool, cpu_count
        import os

        # Determine number of workers (max 4 to avoid resource contention)
        num_workers = min(4, cpu_count() or 4, len(symbols))
        use_parallel = params.get('parallel', True) and len(symbols) > 1

        # Prepare arguments for worker function
        worker_args = [(symbol, params, days) for symbol in symbols]

        results = []
        completed = 0
        total = len(symbols)

        if use_parallel and num_workers > 1:
            # Use multiprocessing Pool
            if progress_callback:
                progress_callback(0, total, f"Starting parallel backtest with {num_workers} workers...")

            with Pool(processes=num_workers) as pool:
                for result in pool.imap_unordered(run_single_stock_backtest, worker_args, chunksize=2):
                    completed += 1
                    if progress_callback:
                        progress_callback(completed, total, f"Completed {result['symbol']}...")

                    if result['success'] and result.get('result'):
                        results.append(result['result'])
                        # Store candle data for charting
                        if result.get('candles'):
                            all_candles[result['symbol']] = result['candles']
                        if result.get('trade_list'):
                            chart_data[result['symbol']] = {'trades': result['trade_list']}
        else:
            # Sequential fallback
            for args in worker_args:
                completed += 1
                result = run_single_stock_backtest(args)
                if progress_callback:
                    progress_callback(completed, total, f"Completed {result['symbol']}...")

                if result['success'] and result.get('result'):
                    results.append(result['result'])
                    # Store candle data for charting
                    if result.get('candles'):
                        all_candles[result['symbol']] = result['candles']
                    if result.get('trade_list'):
                        chart_data[result['symbol']] = {'trades': result['trade_list']}

        # Calculate totals
        total_gross = sum(r['gross_pnl'] for r in results)
        total_costs = sum(r['total_costs'] for r in results)
        total_net = sum(r['net_pnl'] for r in results)
        total_trades = sum(r['trades'] for r in results)
        total_wins = sum(r['wins'] for r in results)
        total_win_rate = (total_wins / total_trades * 100) if total_trades > 0 else 0

        return {
            'strategy': 'orb',
            'config': {
                'symbols': symbols,
                'days': days,
                'params': params,
            },
            'results': results,
            'skipped_stocks': skipped_stocks,  # Stocks filtered out as range-bound
            'totals': {
                'gross_pnl': round(total_gross, 2),
                'total_costs': round(total_costs, 2),
                'net_pnl': round(total_net, 2),
                'trades': total_trades,
                'win_rate': round(total_win_rate, 1),
                'stocks_tested': len(results),
                'stocks_skipped': len(skipped_stocks),
            },
            'chart_data': chart_data,
            'candles': all_candles,  # Raw candle data for visualization
            'run_time': datetime.now().isoformat(),
        }
