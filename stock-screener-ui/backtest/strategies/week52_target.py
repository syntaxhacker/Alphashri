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
from ..costs import calculate_total_cost

# Add project root to path for imports
_current_file_dir = os.path.dirname(os.path.abspath(__file__))
_backtest_dir = os.path.dirname(_current_file_dir)
_ui_dir = os.path.dirname(_backtest_dir)
_project_root_dir = os.path.dirname(_ui_dir)

if _project_root_dir not in sys.path:
    sys.path.insert(0, _project_root_dir)


def get_date_from_ns(ts_ns: int) -> datetime:
    """Convert nanosecond timestamp to datetime."""
    ts_sec = ts_ns / 1_000_000_000
    return datetime.fromtimestamp(ts_sec, tz=timezone.utc)


class Week52TargetConfig(StrategyConfig, kw_only=True):
    """Configuration for 52 Week Target Strategy."""
    
    instrument_id: InstrumentId
    bar_type: BarType
    entry_threshold_pct: float = 2.0  # Entry when price is within this % below 52W high
    trailing_stop_pct: float = 0.5  # Trailing stop after price closes above 52W high
    stop_loss_pct: float = 2.0  # Stop loss %
    max_holding_days: int = 15  # Max days to hold
    cooldown_days: int = 7  # Days to wait before re-entry after exit
    trade_size: int = 100  # Number of shares per trade


class Week52TargetNautilusStrategy(Strategy):
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
        self._quantity = Quantity.from_str(str(config.trade_size))

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
        
        # Track 52W high
        self._52w_high: Optional[float] = None
        self._price_history: List[float] = []
        
        # Trade tracking
        self.trades: List[Dict] = []
        
        # Store bar_type for subscription
        self._bar_type: Optional[BarType] = None

    def on_start(self):
        """Initialize strategy on start."""
        self._price_history = []
        self._52w_high = None
        # Subscribe to daily bars from config
        self.subscribe_bars(self.config.bar_type)
        print(f"[52W Target] Strategy started, subscribed to {self.config.bar_type}")

    def on_bar(self, bar):
        """Process each bar."""
        bar_time = get_date_from_ns(bar.ts_event)
        close_price = bar.close
        high_price = bar.high
        
        # Track price history for 52W high calculation
        self._price_history.append(high_price)
        
        # Calculate 52W high (252 trading days)
        if len(self._price_history) >= 252:
            self._52w_high = max(self._price_history[-252:])
        elif len(self._price_history) >= 100:
            # Use available history if at least 100 days
            self._52w_high = max(self._price_history)
        
        # Debug logging
        if len(self._price_history) % 50 == 0:
            print(f"[52W Target] Bar {len(self._price_history)}: close={close_price}, 52w_high={self._52w_high}")
        
        # Skip if no 52W high calculated yet
        if self._52w_high is None:
            return
        
        # Calculate entry price (52W high × (100 - entry_threshold_pct)%)
        entry_price_threshold = self._52w_high * (1 - self._entry_threshold_pct / 100)
        
        print(f"[52W Target] DEBUG: close={close_price}, threshold={entry_price_threshold}, 52w_high={self._52w_high}, in_pos={self._in_position}, cooldown={self._bars_since_exit}")
        
        # Check cooldown
        in_cooldown = self._bars_since_exit < self._cooldown_bars
        
        # Update cooldown counter when not in position
        if not self._in_position:
            self._bars_since_exit += 1
        
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
        """Enter a long position."""
        # Convert to float if Decimal
        price = float(price)
        
        order = self.order_factory.market(
            instrument_id=self._instrument_id,
            order_side=OrderSide.BUY,
            quantity=self._quantity,
        )
        self.submit_order(order)
        
        self._in_position = True
        self._entry_price = float(price)  # Store as float
        self._entry_52w_high = float(self._52w_high) if self._52w_high else None  # Store 52W high at entry
        self._highest_price_since_entry = float(price)
        self._entry_time = bar_time  # Store entry time
        self._bars_in_trade = 0
        self._bars_since_exit = 0

    def _exit_long(self, price: float, reason: str, bar_time: datetime):
        """Exit the long position."""
        if not self._in_position:
            return
        
        # Convert to float if Decimal
        price = float(price)
        entry_price = self._entry_price
        
        # Format entry/exit times properly
        entry_date_str = self._entry_time.strftime('%Y-%m-%dT%H:%M') if self._entry_time else bar_time.strftime('%Y-%m-%dT%H:%M')
        entry_date_only = self._entry_time.strftime('%Y-%m-%d') if self._entry_time else bar_time.strftime('%Y-%m-%d')
        
        # Calculate P&L
        gross_pnl = (price - entry_price) * self._trade_size
        pnl_pct = ((price - entry_price) / entry_price) * 100
        
        # Calculate trading costs
        costs = calculate_total_cost(
            entry_price, price, self._trade_size
        )

        net_pnl = gross_pnl - costs
        net_pnl_pct = (net_pnl / (self._entry_price * self._trade_size)) * 100
        
        # Calculate hold duration
        hold_days = self._bars_in_trade
        
        self.trades.append({
            'entry_price': round(self._entry_price, 2),
            'exit_price': round(price, 2),
            'entry_time': entry_date_str,
            'exit_time': bar_time.strftime('%Y-%m-%dT%H:%M'),
            'quantity': self._trade_size,
            'gross_pnl': round(gross_pnl, 2),
            'gross_pnl_pct': round(pnl_pct, 2),
            'trading_costs': round(costs, 2),
            'net_pnl': round(net_pnl, 2),
            'net_pnl_pct': round(net_pnl_pct, 2),
            'exit_reason': reason,
            'hold_duration_minutes': hold_days * 24 * 60,
            'date': entry_date_only,
            'side': 'LONG',
            '52w_high_entry': round(self._entry_52w_high, 2) if self._entry_52w_high else None,
        })
        
        # Reset state
        self._in_position = False
        self._entry_price = None
        self._entry_52w_high = None
        self._highest_price_since_entry = None
        self._entry_time = None
        self._bars_in_trade = 0
        self._bars_since_exit = 1  # Start cooldown
        
        # Exit position
        self.close_all_positions(self._instrument_id)

    def on_stop(self):
        """Clean up on stop."""
        pass

    def on_reset(self):
        """Reset strategy state."""
        self._in_position = False
        self._entry_price = None
        self._entry_52w_high = None
        self._highest_price_since_entry = None
        self._bars_in_trade = 0
        self._bars_since_exit = 0
        self._price_history = []
        self._52w_high = None


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

        from db.models import get_shared_broker_token

        token_data = get_shared_broker_token('upstox')
        access_token = token_data.get('access_token') if token_data else None

        worker_args = [(symbol, params, days, access_token) for symbol in symbols]
        total = len(symbols)
        completed = 0
        num_workers = min(4, cpu_count() or 4, max(1, total))
        
        # Force sequential to avoid multiprocessing issues
        use_parallel = False
        
        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"[52W Target] Running for {symbols}, params={params}, days={days}")
        logger.info(f"[52W Target] use_parallel={use_parallel}, total={total}")

        if use_parallel:
            if progress_callback:
                progress_callback(0, total, f"Starting parallel backtest with {num_workers} workers...")
            with Pool(processes=num_workers) as pool:
                for result in pool.imap_unordered(run_single_stock_week52_target, worker_args, chunksize=2):
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
                result = run_single_stock_week52_target(args)
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
            },
            'chart_data': chart_data,
            'candles': all_candles,
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
    
    try:
        from backtest.utils import get_upstox_client_from_db, get_upstox_client_with_token

        entry_threshold_pct = float(params.get('entry_threshold_pct', 2.0))
        stop_loss_pct = float(params.get('stop_loss_pct', 2.0))
        trailing_stop_pct = float(params.get('trailing_stop_pct', 0.5))
        max_holding_days = int(params.get('max_holding_days', 15))
        cooldown_days = int(params.get('cooldown_days', 7))
        trade_size = int(params.get('trade_size', 100))
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

        # Normalize dataframe for nautilus (requires UTC)
        df_copy = df[['open', 'high', 'low', 'close', 'volume']].copy()
        if not isinstance(df_copy.index, pd.DatetimeIndex):
            df_copy.index = pd.to_datetime(df_copy.index)
        if df_copy.index.tz is None:
            df_copy.index = df_copy.index.tz_localize('UTC')
        else:
            df_copy.index = df_copy.index.tz_convert('UTC')

        # Sort by date
        df_copy = df_copy.sort_index()

        # Filter to requested date range
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

        # Configure backtest
        config = BacktestEngineConfig(
            # bypass_logging=True,
        )
        engine = BacktestEngine(config=config)
        engine.add_venue(
            venue=venue,
            oms_type=OmsType.NETTING,
            account_type=AccountType.CASH,
            base_currency=INR,
            starting_balances=[Money(1_000_000, INR)],
        )
        engine.add_instrument(instrument)
        engine.add_data(bars)
        
        # Create bar type for daily data
        bar_type = BarType.from_str(f"{instrument_id}-1-DAY-LAST-EXTERNAL")
        
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
        
        strategy = Week52TargetNautilusStrategy(config=strategy_config)
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

        trailing_exits = sum(1 for t in trades if t['exit_reason'] == 'TRAILING_STOP')
        sl_exits = sum(1 for t in trades if t['exit_reason'] == 'SL')
        max_hold_exits = sum(1 for t in trades if t['exit_reason'] == 'MAX_HOLDING')

        result = {
            'symbol': symbol,
            'trades': total_trades,
            'wins': wins,
            'losses': losses,
            'win_rate': round(win_rate, 2),
            'gross_pnl': round(gross_pnl, 2),
            'total_costs': round(total_costs, 2),
            'net_pnl': round(net_pnl, 2),
            'pf': round(profit_factor, 2),
            'trailing_exits': trailing_exits,
            'sl_exits': sl_exits,
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
        traceback.print_exc()
        return {'symbol': symbol, 'success': False, 'error': str(e)}
