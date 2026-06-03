"""
52 Week Target Strategy - Long Only Swing Trading

Strategy logic:
- Uses DAILY data (swing strategy)
- Calculate rolling 52-week high from past data
- Entry price = 52W high × (100 - entry_threshold_pct)%
- Enter LONG when today's candle CLOSES >= entry price
- Exit when price CLOSES above 52W high → activate trailing stop
- Trail until stopped out
- Additional exits: SL, Max Holding Days
- Cooldown period after exit
"""

import sys
import os
from datetime import datetime
from typing import Dict, List, Optional

# Guarded nautilus imports for environments without nautilus-trader (no Rust toolchain).
# Allows pure parts (wrapper strategy, utils reexports) to be imported for tests/metadata.
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

from .base import BaseStrategy, StrategyParam, Week52NautilusMixin
from ..costs import calculate_trading_costs
from trading.week52_utils import calculate_52w_high, get_date_from_ns

# Add project root to path for imports
_current_file_dir = os.path.dirname(os.path.abspath(__file__))
_backtest_dir = os.path.dirname(_current_file_dir)
_ui_dir = os.path.dirname(_backtest_dir)
_project_root_dir = os.path.dirname(_ui_dir)

if _project_root_dir not in sys.path:
    sys.path.insert(0, _project_root_dir)

import config
IST = config.IST


if _NAUTILUS_AVAILABLE:
    class Week52TargetConfig(StrategyConfig, kw_only=True):
        """Configuration for 52 Week Target Strategy."""
        
        instrument_id: InstrumentId
        bar_type: BarType
        entry_threshold_pct: float = 2.0  # Entry when price is within this % below 52W high
        trailing_stop_pct: float = 2.0  # Trailing stop after price closes above 52W high
        stop_loss_pct: float = 2.0  # Stop loss %
        max_holding_days: int = 15  # Max days to hold
        cooldown_days: int = 7  # Days to wait before re-entry after exit
        trade_size: int = 100  # Number of shares per trade
else:
    Week52TargetConfig = None


if _NAUTILUS_AVAILABLE:
    class Week52TargetNautilusStrategy(Strategy, Week52NautilusMixin):
        """
        52 Week Target Strategy - Nautilus Implementation
        
        Entry: When today's candle closes >= entry price (52W high × (100 - entry_threshold_pct)%)
        Exit: When price closes above 52W high → activate trailing stop → trail out
        Additional: SL, Max Holding, Cooldown
        """
        
        params: Week52TargetConfig

        def __init__(self, config: Week52TargetConfig):
            super().__init__(config)
            
            # Strategy parameters
            self._entry_threshold_pct = config.entry_threshold_pct
            self._trailing_stop_pct = config.trailing_stop_pct
            self._stop_loss_pct = config.stop_loss_pct
            self._max_holding_days = config.max_holding_days
            self._cooldown_days = config.cooldown_days
            self._trade_size = config.trade_size
            
            # Instrument
            self._instrument_id = config.instrument_id
            self._bar_type = config.bar_type
            
            # Bars conversions
            self._cooldown_bars = self._cooldown_days
            self._max_holding_bars = self._max_holding_days
            
            # State - set bars_since_exit to cooldown_bars so we're not in cooldown at start
            self._in_position = False
            self._entry_price: Optional[float] = None
            self._entry_52w_high: Optional[float] = None  # 52W high at time of entry
            self._entry_time: Optional[datetime] = None  # Entry timestamp
            self._bars_in_trade = 0
            self._bars_since_exit = self._cooldown_bars  # Start at cooldown so we can enter immediately
            self._highest_price_since_entry: Optional[float] = None
            
            # Track 52W high - initialize containers + tracker (mixin will keep in sync)
            self._52w_high: Optional[float] = None
            self._price_history: List[float] = []
            self._init_52w_tracker(min_periods=20)  # target historically had no explicit min, calc returned None early
            
            # Trade tracking
            self.trades: List[Dict] = []
        
        # Store bar_type for subscription (note: also set on self.config.bar_type)

        def on_start(self):
            """Initialize strategy on start."""
            self._price_history = []
            self._52w_high = None
            # Use mixin init (safe if called again)
            self._init_52w_tracker(min_periods=20)
            # Subscribe to daily bars from config
            self.subscribe_bars(self.config.bar_type)
            print(f"[52W Target] Strategy started, subscribed to {self.config.bar_type}")

        def on_bar(self, bar):
            """Process each bar."""
            bar_time = get_date_from_ns(bar.ts_event)
            close_price = bar.close
            high_price = bar.high
            
            # Use shared tracker (syncs _price_history and _52w_high for compat)
            self._update_52w_high(high_price)
            
            # Debug logging
            if len(self._price_history) % 50 == 0:
                print(f"[52W Target] Bar {len(self._price_history)}: close={close_price}, 52w_high={self._52w_high}")
            
            # Skip if no 52W high calculated yet
            if self._52w_high is None:
                return
            
            # Calculate entry price (52W high × (100 - entry_threshold_pct)%)
            entry_price_threshold = self._52w_high * (1 - self._entry_threshold_pct / 100)
            
            print(f"[52W Target] DEBUG: close={close_price}, threshold={entry_price_threshold}, 52w_high={self._52w_high}, in_pos={self._in_position}, cooldown={self._bars_since_exit}")
            
            # Check cooldown (pre-inc, per original target logic)
            in_cooldown = self._is_in_cooldown()
            if not self._in_position:
                self._increment_cooldown_if_not_in_position()
            
            # ENTRY CONDITIONS
            if not self._in_position and not in_cooldown:
                # Entry when today's candle CLOSES >= entry price threshold
                if close_price >= entry_price_threshold:
                    print(f"[52W Target] ENTER: close={close_price}, threshold={entry_price_threshold}, 52w_high={self._52w_high}")
                    self._enter_long(close_price, bar_time)
            
            # EXIT CONDITIONS
            if self._in_position:
                self._bars_in_trade += 1
                exit_reason = None
                
                # Update peak price
                if self._highest_price_since_entry is None or high_price > self._highest_price_since_entry:
                    self._highest_price_since_entry = high_price
                
                # 1. Check if price closed above 52W high (target reached)
                if self._entry_52w_high and close_price > self._entry_52w_high:
                    # Price closed above 52W high - activate trailing
                    if self._highest_price_since_entry:
                        trailing_stop_price = self._highest_price_since_entry * (1 - self._trailing_stop_pct / 100)
                        if close_price <= trailing_stop_price:
                            exit_reason = 'TRAILING_STOP'
                
                # 2. Stop Loss - if price closes below entry × (100 - stop_loss_pct)%
                if not exit_reason and self._entry_price:
                    sl_price = self._entry_price * (1 - self._stop_loss_pct / 100)
                    if close_price <= sl_price:
                        exit_reason = 'SL'
                
                # 3. Max Holding Period
                if not exit_reason and self._bars_in_trade >= self._max_holding_bars:
                    exit_reason = 'MAX_HOLDING'
                
                if exit_reason:
                    self._exit_long(close_price, exit_reason, bar_time)

        def _enter_long(self, price: float, bar_time: datetime):
            """Enter a long position. Delegates to shared mixin (preserves target state names)."""
            # Convert to float if Decimal (kept for exact prior compat)
            price = float(price)
            # Delegate - mixin will set _entry_time because we have the attr, and _bars_since_exit=0
            self._common_enter_long(price, self._52w_high, bar_time)
            # No extra after; target didn't set trailing flag

        def _exit_long(self, price: float, reason: str, bar_time: datetime):
            """Exit the long position. Delegates to shared (uses reset_cooldown_to=1 to preserve target's prior cooldown timing)."""
            if not self._in_position:
                return
            # Delegate handles P&L, append (with both 52w_high keys), close, most resets.
            # We pass reset=1 to match target's original "self._bars_since_exit = 1"
            self._common_exit_long(price, reason, bar_time, reset_cooldown_to=1)
            # Note: mixin already did the close_all_positions; original did it after append but order of side-effects preserved for practical purposes.

        def on_stop(self):
            """Clean up on stop."""
            pass

        def on_reset(self):
            """Reset strategy state."""
            self._reset_common_state()
            # target specific containers already handled in _reset_52w_common via hasattr
else:
    Week52TargetNautilusStrategy = None


# API Wrapper Class
class Week52TargetStrategy(BaseStrategy):
    """52-Week Target Strategy - API wrapper."""

    @classmethod
    def get_name(cls) -> str:
        return "52W Target - Hold Until 52W High"

    @classmethod
    def get_description(cls) -> str:
        return (
            "Swing trading strategy: Enter LONG when price is within X% below 52-week high, "
            "hold until price closes above 52W high, then trail with trailing stop. "
            "Uses daily data."
        )

    @classmethod
    def get_params(cls) -> List[StrategyParam]:
        return [
            StrategyParam(
                key='entry_threshold_pct',
                label='Entry Threshold %',
                type='number',
                default=2.0,
                min=1.0,
                max=10.0,
                step=0.5,
            ),
            StrategyParam(
                key='stop_loss_pct',
                label='Stop Loss %',
                type='number',
                default=2.0,
                min=1.0,
                max=5.0,
                step=0.5,
            ),
            StrategyParam(
                key='trailing_stop_pct',
                label='Trailing Stop %',
                type='number',
                default=0.5,
                min=0.1,
                max=2.0,
                step=0.1,
            ),
            StrategyParam(
                key='max_holding_days',
                label='Max Holding Days',
                type='number',
                default=15,
                min=5,
                max=30,
                step=5,
            ),
            StrategyParam(
                key='cooldown_days',
                label='Cooldown Days',
                type='number',
                default=7,
                min=1,
                max=15,
                step=1,
            ),
            StrategyParam(
                key='trade_size',
                label='Trade Size (Shares)',
                type='number',
                default=100,
                min=10,
                max=1000,
                step=10,
            ),
        ]

    def validate_params(self, params: Dict) -> List[str]:
        """Validate strategy parameters."""
        errors = []
        if params.get('entry_threshold_pct', 0) <= 0:
            errors.append('entry_threshold_pct must be positive')
        if params.get('stop_loss_pct', 0) <= 0:
            errors.append('stop_loss_pct must be positive')
        if params.get('trailing_stop_pct', 0) <= 0:
            errors.append('trailing_stop_pct must be positive')
        return errors

    def run(self, symbols: List[str], days: int, params: Dict, progress_callback=None) -> Dict:
        """Run backtest for the strategy."""
        from multiprocessing import Pool, cpu_count
        
        results = []
        chart_data = {}
        all_candles = {}
        skipped_stocks = []

        from db.models import get_shared_broker_token

        token_data = get_shared_broker_token('upstox')
        access_token = token_data.get('access_token') if token_data else None

        worker_args = [(symbol, params, days, access_token) for symbol in symbols]
        total = len(symbols)
        completed = 0
        num_workers = min(4, cpu_count() or 4, max(1, total))
        
        use_parallel = False
        
        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"[52W Target] Running for {symbols}, params={params}, days={days}")

        if use_parallel:
            if progress_callback:
                progress_callback(0, total, f"Starting parallel backtest with {num_workers} workers...")
            with Pool(processes=num_workers) as pool:
                for result in pool.imap_unordered(run_single_stock_week52_target, worker_args, chunksize=2):
                    completed += 1
                    if progress_callback:
                        progress_callback(completed, total, f"Completed {result['symbol']}...")
                    if not result['success']:
                        skipped_stocks.append({'symbol': result['symbol'], 'error': result.get('error', 'Unknown')})
                        continue
                    if result.get('candles'):
                        all_candles[result['symbol']] = result['candles']
                    if result.get('result'):
                        results.append(result['result'])
                    if result.get('trade_list'):
                        chart_data[result['symbol']] = {
                            'trades': result['trade_list'],
                            'visuals': self.get_visuals(result['trade_list'], params)
                        }
        else:
            for args in worker_args:
                completed += 1
                result = run_single_stock_week52_target(args)
                if progress_callback:
                    progress_callback(completed, total, f"Completed {result['symbol']}...")
                if not result['success']:
                    skipped_stocks.append({'symbol': result['symbol'], 'error': result.get('error', 'Unknown')})
                    continue
                if result.get('candles'):
                    all_candles[result['symbol']] = result['candles']
                if result.get('result'):
                    results.append(result['result'])
                if result.get('trade_list'):
                    chart_data[result['symbol']] = {
                        'trades': result['trade_list'],
                        'visuals': self.get_visuals(result['trade_list'], params)
                    }
        
        # Aggregate results
        total_trades = sum(r.get('trades', 0) for r in results)
        total_pnl = sum(r.get('net_pnl', 0) for r in results)
        
        return {
            'strategy': '52w_target',
            'results': results,
            'totals': {
                'gross_pnl': round(sum(r.get('gross_pnl', 0) for r in results), 2),
                'total_costs': round(sum(r.get('total_costs', 0) for r in results), 2),
                'net_pnl': round(total_pnl, 2),
                'trades': total_trades,
                'win_rate': round((sum(r.get('wins', 0) for r in results) / total_trades * 100) if total_trades > 0 else 0, 1),
                'stocks_tested': len(results) + len(skipped_stocks),
            },
            'chart_data': chart_data,
            'candles': all_candles,
            'skipped_stocks': skipped_stocks,
            'summary': {
                'total_trades': total_trades,
                'total_pnl': total_pnl,
            }
        }

    def get_visuals(self, trades: List[Dict], params: Dict) -> List[Dict]:
        """Return chart visuals."""
        return []


def run_single_stock_week52_target(args):
    """Run backtest for a single stock with 52W Target strategy."""
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


        entry_threshold_pct = float(params.get('entry_threshold_pct', 2.0))
        stop_loss_pct = float(params.get('stop_loss_pct', 2.0))
        trailing_stop_pct = float(params.get('trailing_stop_pct', 0.5))
        max_holding_days = int(params.get('max_holding_days', 15))
        cooldown_days = int(params.get('cooldown_days', 7))
        trade_size = int(params.get('trade_size', 100))
        include_costs = bool(params.get('include_costs', True))

        venue, instrument_id, instrument = build_nautilus_equity_instrument(symbol)

        to_date, from_date, _fetch_days = get_52w_backtest_dates(days)

        if access_token:
            api, error = get_upstox_client_with_token(access_token, quiet=True)
        else:
            api, error = get_upstox_client_from_db(quiet=True)
        
        if error or not api:
            return {'symbol': symbol, 'success': False, 'error': error or 'No API client'}

        df = api.fetch_historical_data_v3(
            symbol=symbol, unit="days", interval=1, to_date=to_date, from_date=from_date
        )

        if df is None or df.empty:
            return {'symbol': symbol, 'success': False, 'error': 'No data'}

        # Normalize + filter using shared
        df_copy = normalize_df_for_nautilus(df)
        df_for_backtest, cutoff_date = filter_df_to_requested_range(df_copy, days)

        if df_for_backtest.empty:
            return {'symbol': symbol, 'success': False, 'error': 'No data in date range'}

        # bars via shared
        bar_type = create_daily_bar_type(instrument_id)
        bars = wrangle_bars(bar_type, instrument, df_copy)

        if not bars:
            return {'symbol': symbol, 'success': False, 'error': 'No bars'}

        # Create strategy config
        strategy_config = Week52TargetConfig(
            instrument_id=instrument_id,
            bar_type=bar_type,
            entry_threshold_pct=entry_threshold_pct,
            stop_loss_pct=stop_loss_pct,
            trailing_stop_pct=trailing_stop_pct,
            max_holding_days=max_holding_days,
            cooldown_days=cooldown_days,
            trade_size=trade_size,
        )
        
        engine = make_backtest_engine()  # target used plain config (no trader_id)
        setup_venue_and_instrument(engine, venue, instrument)
        strategy = Week52TargetNautilusStrategy(config=strategy_config)
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

        # use shared metrics (it will emit the keys target expects + some extras harmlessly)
        metrics = compute_52w_result_metrics(trades, include_costs=include_costs, strategy_kind='target')
        result = {
            'symbol': symbol,
            'trades': metrics.get('trades', total_trades),
            'wins': metrics.get('wins', wins),
            'losses': metrics.get('losses', losses),
            'win_rate': round(win_rate, 2),
            'gross_pnl': round(gross_pnl, 2),
            'total_costs': round(total_costs, 2),
            'net_pnl': round(net_pnl, 2),
            'pf': round(profit_factor, 2),
            'trailing_exits': metrics.get('trailing_exits', 0),
            'sl_exits': metrics.get('sl_exits', 0),
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
        traceback.print_exc()
        return {'symbol': symbol, 'success': False, 'error': str(e)}
