"""
52 Week High Chaser Strategy - Long Only Swing Trading

Backtest behavior:
- Uses DAILY data (not intraday - this is a swing strategy)
- Track 52-week high (rolling 252 trading days)
- Enter LONG when price is within entry_threshold_pct of 52-week high
- Optional filters: ADX, RSI, Volume, Moving Averages
- Exit via: Stop Loss, Take Profit, Trailing Stop (optional), Max Holding Days
- Cooldown period after exit before re-entry
"""

import sys
import os
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from dataclasses import dataclass

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


def calculate_adx(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    """Calculate Average Directional Index (ADX) - Trend Strength Indicator."""
    tr1 = high - low
    tr2 = abs(high - close.shift(1))
    tr3 = abs(low - close.shift(1))
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)

    plus_dm = high.diff()
    minus_dm = -low.diff()
    plus_dm[plus_dm < 0] = 0
    minus_dm[minus_dm < 0] = 0

    atr = tr.rolling(window=period).mean()
    plus_di = 100 * (plus_dm.rolling(window=period).mean() / atr)
    minus_di = 100 * (minus_dm.rolling(window=period).mean() / atr)

    dx = 100 * abs(plus_di - minus_di) / (plus_di + minus_di)
    adx = dx.rolling(window=period).mean()

    return adx


def calculate_rsi(close: pd.Series, period: int = 14) -> pd.Series:
    """Calculate Relative Strength Index (RSI)."""
    delta = close.diff()
    gain = delta.where(delta > 0, 0)
    loss = -delta.where(delta < 0, 0)

    avg_gain = gain.ewm(span=period, adjust=False).mean()
    avg_loss = loss.ewm(span=period, adjust=False).mean()

    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))

    return rsi


def get_date_from_ns(ts_ns: int) -> datetime:
    """Convert nanosecond timestamp to datetime."""
    ts_sec = ts_ns / 1_000_000_000
    return datetime.fromtimestamp(ts_sec, tz=timezone.utc)


class Week52HighIndicator:
    """Track the 52-week (252 trading days) rolling high."""

    def __init__(self, period: int = 252, min_periods: int = 100):
        self.period = period
        self.min_periods = min_periods
        self._high_prices: List[float] = []
        self._current_52w_high: Optional[float] = None
        self._count = 0

    def update(self, high_price: float) -> Optional[float]:
        """Update indicator with new high price and return current 52W high."""
        self._high_prices.append(high_price)

        # Keep only the last 'period' high prices
        if len(self._high_prices) > self.period:
            self._high_prices.pop(0)

        # Calculate 52-week high from previous periods only (shift by 1 to avoid look-ahead)
        if len(self._high_prices) >= self.min_periods:
            # Exclude current bar's high to avoid look-ahead bias
            self._current_52w_high = max(self._high_prices[:-1])
        elif len(self._high_prices) > 1:
            self._current_52w_high = max(self._high_prices[:-1])

        self._count += 1
        return self._current_52w_high

    @property
    def value(self) -> Optional[float]:
        return self._current_52w_high

    def is_initialized(self) -> bool:
        return self._count >= self.min_periods


class Week52ChaserNautilusStrategy(Strategy):
    """52-Week High Chaser implementation for NautilusTrader."""

    def __init__(self, config: 'Week52ChaserConfig'):
        super().__init__(config)

        # Strategy parameters
        self._entry_threshold_pct = config.entry_threshold_pct
        self._stop_loss_pct = config.stop_loss_pct
        self._take_profit_pct = config.take_profit_pct
        self._enable_trailing_stop = config.enable_trailing_stop
        self._trailing_stop_pct = config.trailing_stop_pct
        self._trailing_activation_pct = config.trailing_activation_pct
        self._max_holding_bars = config.max_holding_days
        self._cooldown_bars = config.cooldown_days
        self._trade_size = config.trade_size
        self._enable_filters = config.enable_filters
        self._historical_df = config.historical_df

        # 52W high indicator
        self._high_52w = Week52HighIndicator(period=252, min_periods=20)

        # State tracking
        self._instrument_id = config.instrument_id
        self._bar_type = config.bar_type
        self._entry_price: Optional[float] = None
        self._entry_52w_high: Optional[float] = None
        self._highest_price_since_entry: Optional[float] = None
        self._bars_in_trade: int = 0
        self._bars_since_exit: int = 0
        self._in_position: bool = False
        self._trailing_stop_active: bool = False
        self._current_entry_time: Optional[datetime] = None

        # Pre-calculated indicators from historical data
        self._precalc_adx: Optional[pd.Series] = None
        self._precalc_rsi: Optional[pd.Series] = None
        self._precalc_ma50: Optional[pd.Series] = None
        self._precalc_ma200: Optional[pd.Series] = None
        self._precalc_vol_avg: Optional[pd.Series] = None

        # Trade history
        self.trades: List[Dict] = []

    def on_start(self):
        """Initialize strategy."""
        self.subscribe_bars(self._bar_type)

        # Pre-calculate indicators from historical data for filtering
        if self._historical_df is not None and not self._historical_df.empty and self._enable_filters:
            df = self._historical_df.copy()
            self._precalc_adx = calculate_adx(df['high'], df['low'], df['close'])
            self._precalc_rsi = calculate_rsi(df['close'])
            self._precalc_ma50 = df['close'].rolling(window=50).mean()
            self._precalc_ma200 = df['close'].rolling(window=200).mean()
            self._precalc_vol_avg = df['volume'].rolling(window=20).mean()

    def on_bar(self, bar):
        """Process incoming bar."""
        bar_time = get_date_from_ns(bar.ts_event)
        close_price = float(bar.close)
        high_price = float(bar.high)

        # Update 52W high indicator
        high_52w = self._high_52w.update(high_price)

        # Wait for indicator to initialize
        if not self._high_52w.is_initialized() or high_52w is None:
            return

        # Update cooldown counter
        if not self._in_position:
            self._bars_since_exit += 1

        # Check cooldown
        in_cooldown = self._bars_since_exit < self._cooldown_bars

        # Calculate distance to 52-week high
        distance_to_52w_pct = ((high_52w - close_price) / close_price) * 100

        # ENTRY CONDITIONS
        if not self._in_position and not in_cooldown:
            # Entry on breakout (price at or above 52W high) 
            # OR if within threshold of 52W high
            if distance_to_52w_pct <= self._entry_threshold_pct:
                # Check filters if enabled
                if self._enable_filters:
                    if not self._check_entry_filters(close_price, bar_time):
                        return

                self._enter_long(close_price, high_52w, bar_time)

        # EXIT CONDITIONS
        if self._in_position:
            self._bars_in_trade += 1

            # Update highest price since entry
            if self._highest_price_since_entry is None or high_price > self._highest_price_since_entry:
                self._highest_price_since_entry = high_price

            pnl_pct = ((close_price - self._entry_price) / self._entry_price) * 100
            exit_reason = None

            # Check if trailing stop should activate (after reaching 52W high)
            if self._enable_trailing_stop and not self._trailing_stop_active:
                if close_price >= self._entry_52w_high:
                    self._trailing_stop_active = True

            # 1. Take Profit (if trailing disabled or before activation)
            if not self._trailing_stop_active and pnl_pct >= self._take_profit_pct:
                exit_reason = 'TP'

            # 2. Trailing Stop (if enabled and activated)
            elif self._enable_trailing_stop and self._trailing_stop_active and self._highest_price_since_entry:
                trailing_stop_price = self._highest_price_since_entry * (1 - self._trailing_stop_pct / 100)
                if close_price <= trailing_stop_price:
                    exit_reason = 'TRAILING_STOP'

            # 3. Initial Stop Loss (only if trailing not active)
            elif not self._trailing_stop_active and pnl_pct <= -self._stop_loss_pct:
                exit_reason = 'SL'

            # 4. Max Holding Period
            elif self._bars_in_trade >= self._max_holding_bars:
                exit_reason = 'MAX_HOLDING'

            # 5. New 52W high formed far above entry (momentum fading)
            elif high_52w > self._entry_52w_high * 1.10:
                exit_reason = 'NEW_52W_HIGH'

            if exit_reason:
                self._exit_long(close_price, exit_reason, bar_time)

    def _check_entry_filters(self, close_price: float, bar_time: datetime) -> bool:
        """Check optional entry filters."""
        if self._precalc_adx is None:
            return True

        # Find the closest date in pre-calculated data
        try:
            bar_date = bar_time.date()
            df_index = self._historical_df.index
            if not isinstance(df_index, pd.DatetimeIndex):
                df_index = pd.to_datetime(df_index)

            # Find matching date
            mask = df_index.date == bar_date
            if not mask.any():
                return True

            idx = mask.argmax()
            adx_val = self._precalc_adx.iloc[idx] if idx < len(self._precalc_adx) else None
            rsi_val = self._precalc_rsi.iloc[idx] if idx < len(self._precalc_rsi) else None
            ma50_val = self._precalc_ma50.iloc[idx] if idx < len(self._precalc_ma50) else None
            ma200_val = self._precalc_ma200.iloc[idx] if idx < len(self._precalc_ma200) else None
            vol_avg_val = self._precalc_vol_avg.iloc[idx] if idx < len(self._precalc_vol_avg) else None
            volume_val = self._historical_df['volume'].iloc[idx] if idx < len(self._historical_df) else None

            # ADX > 25 (strong trend)
            if pd.notna(adx_val) and adx_val < 25:
                return False

            # RSI 50-70 (momentum room)
            if pd.notna(rsi_val) and (rsi_val < 50 or rsi_val > 70):
                return False

            # Volume > 1.5x average
            if pd.notna(vol_avg_val) and pd.notna(volume_val) and volume_val < vol_avg_val * 1.5:
                return False

            # Price > MA50 and MA200
            if pd.notna(ma50_val) and close_price < ma50_val:
                return False
            if pd.notna(ma200_val) and close_price < ma200_val:
                return False

            return True
        except Exception:
            return True

    def _enter_long(self, price: float, high_52w: float, bar_time: datetime):
        """Enter long position."""
        order = self.order_factory.market(
            instrument_id=self._instrument_id,
            order_side=OrderSide.BUY,
            quantity=Quantity.from_str(str(self._trade_size)),
        )
        self.submit_order(order)

        self._entry_price = price
        self._entry_52w_high = high_52w
        self._highest_price_since_entry = price
        self._bars_in_trade = 0
        self._in_position = True
        self._trailing_stop_active = False
        self._current_entry_time = bar_time

    def _exit_long(self, price: float, reason: str, bar_time: datetime):
        """Exit long position."""
        self.close_all_positions(self._instrument_id)

        pnl_pct = ((price - self._entry_price) / self._entry_price) * 100
        gross_pnl = (price - self._entry_price) * self._trade_size

        costs = calculate_trading_costs(self._entry_price, price, self._trade_size)
        net_pnl = gross_pnl - costs['total_costs']
        net_pnl_pct = (net_pnl / (self._entry_price * self._trade_size)) * 100

        # Calculate hold duration in days
        hold_days = self._bars_in_trade  # Since we're using daily bars

        # Use datetime format for compatibility with chart and table
        entry_date_str = self._current_entry_time.strftime('%Y-%m-%dT%H:%M') if self._current_entry_time else None
        exit_date_str = bar_time.strftime('%Y-%m-%dT%H:%M')
        # Keep date-only for the date field (used for matching with candles)
        entry_date_only = self._current_entry_time.strftime('%Y-%m-%d') if self._current_entry_time else None

        self.trades.append({
            'entry_price': round(self._entry_price, 2),
            'exit_price': round(price, 2),
            'entry_time': entry_date_str,
            'exit_time': exit_date_str,
            'quantity': self._trade_size,
            'gross_pnl': round(gross_pnl, 2),
            'gross_pnl_pct': round(pnl_pct, 2),
            'trading_costs': round(costs['total_costs'], 2),
            'net_pnl': round(net_pnl, 2),
            'net_pnl_pct': round(net_pnl_pct, 2),
            'exit_reason': reason,
            'hold_duration_minutes': hold_days * 24 * 60,  # Convert days to minutes for UI consistency
            'date': entry_date_only,
            'side': 'LONG',
            '52w_high': round(self._entry_52w_high, 2),
            'trailing_active': self._trailing_stop_active,
        })

        # Reset state
        self._entry_price = None
        self._entry_52w_high = None
        self._highest_price_since_entry = None
        self._bars_in_trade = 0
        self._bars_since_exit = 0
        self._in_position = False
        self._trailing_stop_active = False
        self._current_entry_time = None

    def on_stop(self):
        pass

    def on_reset(self):
        self._entry_price = None
        self._entry_52w_high = None
        self._highest_price_since_entry = None
        self._bars_in_trade = 0
        self._bars_since_exit = 0
        self._in_position = False
        self._trailing_stop_active = False
        self._current_entry_time = None
        self._high_52w = Week52HighIndicator(period=252, min_periods=100)


class Week52ChaserConfig(StrategyConfig, kw_only=True):
    """Configuration for 52-Week High Chaser strategy."""
    instrument_id: InstrumentId
    bar_type: BarType
    entry_threshold_pct: float = 3.0
    stop_loss_pct: float = 3.0
    take_profit_pct: float = 5.0
    enable_trailing_stop: bool = False
    trailing_stop_pct: float = 3.0
    trailing_activation_pct: float = 2.0
    max_holding_days: int = 30
    cooldown_days: int = 30
    trade_size: int = 100
    enable_filters: bool = False
    historical_df: Optional[pd.DataFrame] = None


def run_single_stock_backtest(args):
    """Run backtest for a single stock in isolation."""
    symbol, params, days, access_token = args if len(args) == 4 else (*args, None)

    try:
        from backtest.utils import get_upstox_client_from_db, get_upstox_client_with_token

        entry_threshold_pct = float(params.get('entry_threshold_pct', 3.0))
        stop_loss_pct = float(params.get('stop_loss_pct', 3.0))
        take_profit_pct = float(params.get('take_profit_pct', 5.0))
        enable_trailing_stop = bool(params.get('enable_trailing_stop', False))
        trailing_stop_pct = float(params.get('trailing_stop_pct', 3.0))
        trailing_activation_pct = float(params.get('trailing_activation_pct', 2.0))
        max_holding_days = int(params.get('max_holding_days', 30))
        cooldown_days = int(params.get('cooldown_days', 30))
        trade_size = int(params.get('trade_size', 100))
        enable_filters = bool(params.get('enable_filters', False))
        include_costs = bool(params.get('include_costs', True))

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

        today = datetime.now()
        to_date = today.strftime('%Y-%m-%d')
        fetch_days = max(days + 400, 500)
        from_date = (today - timedelta(days=fetch_days)).strftime('%Y-%m-%d')

        if access_token:
            api, error = get_upstox_client_with_token(access_token), None
        else:
            api, error = get_upstox_client_from_db()
        
        if error or not api:
            return {'symbol': symbol, 'success': False, 'error': error or 'No API client'}

        df = api.fetch_historical_data_v3(
            symbol=symbol, unit="days", interval=1, to_date=to_date, from_date=from_date
        )

        if df is None or df.empty:
            return {'symbol': symbol, 'success': False, 'error': 'No data'}

        # Normalize dataframe for nautilus (requires UTC)
        # Data from Upstox is in IST, we localize to UTC so nautilus treats times correctly
        df_copy = df[['open', 'high', 'low', 'close', 'volume']].copy()
        if not isinstance(df_copy.index, pd.DatetimeIndex):
            df_copy.index = pd.to_datetime(df_copy.index)
        if df_copy.index.tz is None:
            df_copy.index = df_copy.index.tz_localize('UTC')
        else:
            df_copy.index = df_copy.index.tz_convert('UTC')

        # Sort by date
        df_copy = df_copy.sort_index()

        # Filter to requested date range (but keep extra for indicator warmup)
        cutoff_date = (today - timedelta(days=days)).date()
        df_for_backtest = df_copy[df_copy.index.date >= cutoff_date].copy()

        if df_for_backtest.empty:
            return {'symbol': symbol, 'success': False, 'error': 'No data in date range'}

        # Create bar type for daily data
        bar_type = BarType.from_str(f"{instrument_id}-1-DAY-LAST-EXTERNAL")
        wrangler = BarDataWrangler(bar_type=bar_type, instrument=instrument)
        bars = wrangler.process(df_copy)

        if not bars:
            return {'symbol': symbol, 'success': False, 'error': 'No bars'}

        config = Week52ChaserConfig(
            instrument_id=instrument_id,
            bar_type=bar_type,
            entry_threshold_pct=entry_threshold_pct,
            stop_loss_pct=stop_loss_pct,
            take_profit_pct=take_profit_pct,
            enable_trailing_stop=enable_trailing_stop,
            trailing_stop_pct=trailing_stop_pct,
            trailing_activation_pct=trailing_activation_pct,
            max_holding_days=max_holding_days,
            cooldown_days=cooldown_days,
            trade_size=trade_size,
            enable_filters=enable_filters,
            historical_df=df_copy,
        )

        engine = BacktestEngine(config=BacktestEngineConfig(trader_id=TraderId("BACKTESTER-001")))
        engine.add_venue(
            venue=venue,
            oms_type=OmsType.NETTING,
            account_type=AccountType.CASH,
            base_currency=INR,
            starting_balances=[Money(1_000_000, INR)],
        )
        engine.add_instrument(instrument)
        engine.add_data(bars)
        strategy = Week52ChaserNautilusStrategy(config=config)
        engine.add_strategy(strategy=strategy)
        engine.run()

        trades = strategy.trades
        engine.dispose()

        if not trades:
            return {'symbol': symbol, 'success': True, 'trades': 0, 'result': None}

        # Filter trades to only those within the requested date range
        filtered_trades = []
        for t in trades:
            if t.get('entry_time'):
                entry_dt = datetime.fromisoformat(t['entry_time'].replace('Z', '+00:00'))
                if entry_dt.date() >= cutoff_date:
                    filtered_trades.append(t)
        trades = filtered_trades

        if not trades:
            return {'symbol': symbol, 'success': True, 'trades': 0, 'result': None}

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
        trailing_exits = sum(1 for t in trades if t['exit_reason'] == 'TRAILING_STOP')
        max_hold_exits = sum(1 for t in trades if t['exit_reason'] == 'MAX_HOLDING')

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
            'trailing_exits': trailing_exits,
            'max_hold_exits': max_hold_exits,
        }

        # Use only the backtest period data for charting
        candle_data = {
            'index': [idx.strftime('%Y-%m-%d') if hasattr(idx, 'strftime') else str(idx)[:10] for idx in df_for_backtest.index],
            'open': df_for_backtest['open'].tolist(),
            'high': df_for_backtest['high'].tolist(),
            'low': df_for_backtest['low'].tolist(),
            'close': df_for_backtest['close'].tolist(),
            'volume': df_for_backtest['volume'].tolist() if 'volume' in df_for_backtest.columns else [0] * len(df_for_backtest),
        }

        return {
            'symbol': symbol,
            'success': True,
            'trades': total_trades,
            'result': result,
            'candles': candle_data,
            'trade_list': trades,
        }
    except Exception as e:
        import traceback
        return {'symbol': symbol, 'success': False, 'error': str(e), 'traceback': traceback.format_exc()}


class Week52ChaserStrategy(BaseStrategy):
    """52-Week High Chaser Strategy - API wrapper."""

    @classmethod
    def get_name(cls) -> str:
        return "52W Chaser - 52-Week High Breakout (Swing)"

    @classmethod
    def get_description(cls) -> str:
        return (
            "Swing trading strategy: Enter LONG when price is within X% of 52-week high, "
            "use fixed TP/SL or optional trailing stop after 52W high reached. "
            "Uses daily data. Optional trend/momentum filters available."
        )

    @classmethod
    def get_params(cls) -> List[StrategyParam]:
        return [
            StrategyParam(
                key='entry_threshold_pct',
                label='Entry Threshold %',
                type='number',
                default=3.0,
                min=1.0,
                max=10.0,
                step=0.5,
            ),
            StrategyParam(
                key='stop_loss_pct',
                label='Stop Loss %',
                type='number',
                default=3.0,
                min=1.0,
                max=8.0,
                step=0.5,
            ),
            StrategyParam(
                key='take_profit_pct',
                label='Take Profit %',
                type='number',
                default=5.0,
                min=1.0,
                max=15.0,
                step=0.5,
            ),
            StrategyParam(
                key='enable_trailing_stop',
                label='Enable Trailing Stop',
                type='boolean',
                default=False,
            ),
            StrategyParam(
                key='trailing_stop_pct',
                label='Trailing Stop %',
                type='number',
                default=3.0,
                min=1.0,
                max=5.0,
                step=0.5,
            ),
            StrategyParam(
                key='trailing_activation_pct',
                label='Trailing Activation %',
                type='number',
                default=2.0,
                min=0.5,
                max=5.0,
                step=0.5,
            ),
            StrategyParam(
                key='max_holding_days',
                label='Max Holding Days',
                type='number',
                default=30,
                min=10,
                max=60,
                step=5,
            ),
            StrategyParam(
                key='cooldown_days',
                label='Cooldown Days',
                type='number',
                default=30,
                min=10,
                max=60,
                step=5,
            ),
            StrategyParam(
                key='trade_size',
                label='Trade Size',
                type='number',
                default=100,
                min=1,
                max=1000,
                step=1,
            ),
            StrategyParam(
                key='enable_filters',
                label='Enable Filters',
                type='boolean',
                default=False,
            ),
        ]

    def validate_params(self, params: Dict) -> List[str]:
        errors = []

        if float(params.get('stop_loss_pct', 3.0)) >= float(params.get('take_profit_pct', 5.0)):
            errors.append("Stop Loss should be less than Take Profit")

        if float(params.get('entry_threshold_pct', 3.0)) <= 0:
            errors.append("Entry Threshold must be positive")

        if bool(params.get('enable_trailing_stop', False)):
            if float(params.get('trailing_stop_pct', 3.0)) <= 0:
                errors.append("Trailing Stop must be positive when enabled")

        return errors

    def run(self, symbols: List[str], days: int, params: Dict, progress_callback=None) -> Dict:
        results = []
        chart_data = {}
        all_candles = {}

        from multiprocessing import Pool, cpu_count
        from db.models import get_shared_broker_token

        token_data = get_shared_broker_token('upstox')
        access_token = token_data.get('access_token') if token_data else None

        worker_args = [(symbol, params, days, access_token) for symbol in symbols]
        total = len(symbols)
        completed = 0
        num_workers = min(4, cpu_count() or 4, max(1, total))
        use_parallel = total > 1 and num_workers > 1

        if use_parallel:
            if progress_callback:
                progress_callback(0, total, f"Starting parallel backtest with {num_workers} workers...")
            with Pool(processes=num_workers) as pool:
                for result in pool.imap_unordered(run_single_stock_backtest, worker_args, chunksize=2):
                    completed += 1
                    if progress_callback:
                        progress_callback(completed, total, f"Completed {result['symbol']}...")
                    if result['success'] and result.get('result'):
                        results.append(result['result'])
                        if result.get('candles'):
                            all_candles[result['symbol']] = result['candles']
                        if result.get('trade_list'):
                            chart_data[result['symbol']] = {
                                'trades': result['trade_list'],
                                'visuals': self.get_visuals(result['trade_list'], params)
                            }
        else:
            for args in worker_args:
                completed += 1
                result = run_single_stock_backtest(args)
                if progress_callback:
                    progress_callback(completed, total, f"Completed {result['symbol']}...")
                if result['success'] and result.get('result'):
                    results.append(result['result'])
                    if result.get('candles'):
                        all_candles[result['symbol']] = result['candles']
                    if result.get('trade_list'):
                        chart_data[result['symbol']] = {
                            'trades': result['trade_list'],
                            'visuals': self.get_visuals(result['trade_list'], params)
                        }

        total_gross = sum(r['gross_pnl'] for r in results)
        total_costs = sum(r['total_costs'] for r in results)
        total_net = sum(r['net_pnl'] for r in results)
        total_trades = sum(r['trades'] for r in results)
        total_wins = sum(r['wins'] for r in results)
        total_win_rate = (total_wins / total_trades * 100) if total_trades > 0 else 0

        return {
            'strategy': '52w_chaser',
            'config': {
                'symbols': symbols,
                'days': days,
                'params': params,
            },
            'results': results,
            'totals': {
                'gross_pnl': round(total_gross, 2),
                'total_costs': round(total_costs, 2),
                'net_pnl': round(total_net, 2),
                'trades': total_trades,
                'win_rate': round(total_win_rate, 1),
                'stocks_tested': len(results),
            },
            'chart_data': chart_data,
            'candles': all_candles,
            'run_time': datetime.now().isoformat(),
        }

    def get_visuals(self, trades: List[Dict], params: Dict) -> List[Dict]:
        """Return 52-week high levels as chart visuals."""
        if not trades:
            return []

        visuals = []
        # Group trades by date to find 52W high levels
        dates_seen = set()
        for trade in trades:
            trade_date = trade.get('date')
            if trade_date and trade_date not in dates_seen:
                dates_seen.add(trade_date)
                high_52w = trade.get('52w_high')
                
                if high_52w is not None:
                    # 52W High line
                    visuals.append({
                        'id': f"h52w_{trade_date}",
                        'type': 'line',
                        'label': '52W High',
                        'color': '#ff9f43',
                        'value': high_52w,
                        'date': trade_date,
                        'dash': [4, 4]
                    })
        
        return visuals
