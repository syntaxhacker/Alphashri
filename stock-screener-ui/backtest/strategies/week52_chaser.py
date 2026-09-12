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
from datetime import datetime
from typing import Dict, List, Optional

import pandas as pd
import numpy as np

# Guarded nautilus imports for environments without nautilus-trader (no Rust toolchain).
# Allows importing pure parts of module (Week52HighIndicator, calculate_adx/rsi, get_date_from_ns, Week52ChaserStrategy wrapper).
try:
    from nautilus_trader.model import BarType, InstrumentId
    from nautilus_trader.trading.strategy import Strategy
    from nautilus_trader.config import StrategyConfig
    _NAUTILUS_AVAILABLE = True
except ImportError:
    Strategy = object  # type: ignore
    StrategyConfig = object  # type: ignore
    BarType = None  # type: ignore
    InstrumentId = None  # type: ignore
    _NAUTILUS_AVAILABLE = False

if not _NAUTILUS_AVAILABLE:
    class _SafeNautilusBase: pass
    Strategy = _SafeNautilusBase

from .base import BaseStrategy, StrategyParam, Week52NautilusMixin

# Add project root to path for imports
_current_file_dir = os.path.dirname(os.path.abspath(__file__))
_backtest_dir = os.path.dirname(_current_file_dir)
_ui_dir = os.path.dirname(_backtest_dir)
_project_root_dir = os.path.dirname(_ui_dir)

if _project_root_dir not in sys.path:
    sys.path.insert(0, _project_root_dir)

import config
IST = config.IST

from trading.week52_utils import calculate_52w_high, get_date_from_ns, Week52HighTracker


class Week52HighIndicator(Week52HighTracker):
    """
    Backward-compatible wrapper around calculate_52w_high() / Week52HighTracker.
    Kept for backward compatibility with existing tests.
    (Previously duplicated the tracking logic here.)
    """
    def __init__(self, period: int = 252, min_periods: int = 100):
        super().__init__(period=period, min_periods=min_periods)
        # legacy attr some tests may inspect
        self._count = 0

    def update(self, high_price: float) -> Optional[float]:
        val = super().update(high_price)
        self._count = len(self._high_prices)
        return val

    def is_initialized(self) -> bool:
        return self._count >= self.min_periods


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


class Week52ChaserNautilusStrategy(Strategy, Week52NautilusMixin):
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

        # 52W high tracking - use shared tracker (mixin inits containers)
        self._high_prices: List[float] = []
        self._current_52w_high: Optional[float] = None
        self._min_periods: int = 20
        self._init_52w_tracker(min_periods=20)

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
        # ensure tracker (in case)
        self._init_52w_tracker(min_periods=self._min_periods)

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

        # Use shared tracker (updates _high_prices + _current_52w_high, etc)
        high_52w = self._update_52w_high(high_price)

        # Wait for indicator to initialize
        if len(self._high_prices) < self._min_periods or high_52w is None:
            return

        # Update cooldown counter FIRST then check (exact prior chaser ordering)
        if not self._in_position:
            self._increment_cooldown_if_not_in_position()
        in_cooldown = self._is_in_cooldown()

        # Use mixin's skeleton for entry block (DRY; _should_enter holds the distance logic)
        self._try_enter_position(close_price, high_52w, bar_time, in_cooldown=in_cooldown)

        # Use mixin's skeleton for exit block (DRY the update/inc/peak + reason chain)
        self._check_and_exit_if_needed(close_price, high_price, high_52w, bar_time)

    def _should_enter(self, close_price: float, high_52w: Optional[float], bar_time: datetime) -> bool:
        """Chaser entry: within threshold (incl. at/above 52W)."""
        if high_52w is None:
            return False
        distance_to_52w_pct = ((high_52w - close_price) / close_price) * 100
        return distance_to_52w_pct <= self._entry_threshold_pct

    def _determine_exit_reason(self, close_price: float, high_price: float, high_52w: Optional[float], bar_time: datetime) -> Optional[str]:
        """Exact chaser exit priority/conditions (incl. trailing activation mutation, NEW_52W_HIGH etc)."""
        if not self._in_position:
            return None

        # Update highest already done by skeleton's _update_peak before calling this.
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
        elif high_52w is not None and self._entry_52w_high is not None and high_52w > self._entry_52w_high * 1.10:
            exit_reason = 'NEW_52W_HIGH'

        return exit_reason

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
        """Enter long position. Delegates to mixin (chaser has trailing attr so gets correct keys)."""
        self._common_enter_long(price, high_52w, bar_time)
        # trailing already reset in common; entry sets were covered

    def _exit_long(self, price: float, reason: str, bar_time: datetime):
        """Exit long position. Delegates to mixin (reset_cooldown_to=0 to match chaser prior)."""
        # Delegate will close early (chaser did close first), compute, append with chaser keys, reset.
        self._common_exit_long(price, reason, bar_time, reset_cooldown_to=0)
        # Note: original computed entry_date_str with None check; mixin replicates that logic.

    def on_stop(self):
        pass

    def on_reset(self):
        self._reset_common_state()
        # chaser specific already covered by _reset_52w_common (high_prices, current_...)


if _NAUTILUS_AVAILABLE:
    class Week52ChaserConfig(StrategyConfig, kw_only=True):
        """Configuration for 52-Week High Chaser strategy."""
        instrument_id: InstrumentId
        bar_type: BarType
        entry_threshold_pct: float = 2.0
        stop_loss_pct: float = 2.0
        take_profit_pct: float = 3.0
        enable_trailing_stop: bool = False
        trailing_stop_pct: float = 2.0
        trailing_activation_pct: float = 3.0
        max_holding_days: int = 30
        cooldown_days: int = 30
        trade_size: int = 100
        enable_filters: bool = False
        historical_df: Optional[pd.DataFrame] = None
else:
    Week52ChaserConfig = None


def run_single_stock_backtest(args):
    """Run backtest for a single stock in isolation."""
    symbol, params, days, access_token = args if len(args) == 4 else (*args, None)

    if not _NAUTILUS_AVAILABLE:
        return {'symbol': symbol, 'success': False, 'error': 'nautilus_trader not available (requires Rust toolchain)'}

    try:
        from backtest.utils import (
            get_upstox_client_from_db, get_upstox_client_with_token,
            get_52w_backtest_dates, normalize_df_for_nautilus,
            filter_df_to_requested_range, build_nautilus_equity_instrument,
            create_daily_bar_type, wrangle_bars, make_backtest_engine,
            setup_venue_and_instrument, add_bars_and_strategy,
            filter_trades_by_cutoff, build_candle_data, compute_52w_result_metrics,
        )


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

        venue, instrument_id, instrument = build_nautilus_equity_instrument(symbol)

        to_date, from_date, _fetch_days = get_52w_backtest_dates(days)

        if access_token:
            api, error = get_upstox_client_with_token(access_token)
        else:
            api, error = get_upstox_client_from_db()
        
        if error or not api:
            return {'symbol': symbol, 'success': False, 'error': error or 'No API client'}

        df = api.fetch_historical_data_v3(
            symbol=symbol, unit="days", interval=1, to_date=to_date, from_date=from_date
        )

        if df is None or df.empty:
            return {'symbol': symbol, 'success': False, 'error': 'No data'}

        # Normalize + filter using shared (keeps extra warmup data in df_copy)
        df_copy = normalize_df_for_nautilus(df)
        df_for_backtest, cutoff_date = filter_df_to_requested_range(df_copy, days)

        if df_for_backtest.empty:
            return {'symbol': symbol, 'success': False, 'error': 'No data in date range'}

        # Create bar type / bars using shared
        bar_type = create_daily_bar_type(instrument_id)
        bars = wrangle_bars(bar_type, instrument, df_copy)

        if not bars:
            return {'symbol': symbol, 'success': False, 'error': 'No bars'}

        strategy_config = Week52ChaserConfig(
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

        engine = make_backtest_engine(trader_id="BACKTESTER-001")
        setup_venue_and_instrument(engine, venue, instrument)
        strategy = Week52ChaserNautilusStrategy(config=strategy_config)
        add_bars_and_strategy(engine, bars, strategy)
        engine.run()

        trades = strategy.trades
        engine.dispose()

        if not trades:
            candle_data = build_candle_data(df_for_backtest)
            return {'symbol': symbol, 'success': True, 'trades': 0, 'result': None, 'candles': candle_data}

        trades = filter_trades_by_cutoff(trades, cutoff_date)

        if not trades:
            candle_data = build_candle_data(df_for_backtest)
            return {'symbol': symbol, 'success': True, 'trades': 0, 'result': None, 'candles': candle_data}

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

        # shared gives the exit counts + base metrics (we force chaser rounding/fields for exact output)
        metrics = compute_52w_result_metrics(trades, include_costs=include_costs, strategy_kind='chaser')
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
            'tp_exits': metrics.get('tp_exits', 0),
            'sl_exits': metrics.get('sl_exits', 0),
            'trailing_exits': metrics.get('trailing_exits', 0),
            'max_hold_exits': metrics.get('max_hold_exits', 0),
        }

        # Use only the backtest period data for charting
        candle_data = build_candle_data(df_for_backtest)

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
        from db.models import get_shared_broker_token

        token_data = get_shared_broker_token('upstox')
        access_token = token_data.get('access_token') if token_data else None

        worker_args = [(symbol, params, days, access_token) for symbol in symbols]

        # Use shared helper (eliminates ~50 lines of duplicated pool/agg logic vs sr/orb/target)
        return self.run_backtests(
            symbols=symbols,
            days=days,
            params=params,
            run_single_func=run_single_stock_backtest,
            worker_args=worker_args,
            progress_callback=progress_callback,
            strategy_key='52w_chaser',
            use_parallel=None,  # auto
            include_config=True,
            include_run_time=True,
        )

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

if not _NAUTILUS_AVAILABLE:
    Week52ChaserNautilusStrategy = None
