"""
Support & Resistance Breakout Strategy using Pivot Points

Backtest behavior:
- Calculate pivot points (PP, R1-R3, S1-S3) from previous day's HLC
- Enter long on resistance breakout (close above R1 + buffer%)
- Enter short on support breakdown (close below S1 - buffer%) if enabled
- Manage with fixed SL/TP
- Exit at EOD
"""

import sys
import os
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from dataclasses import dataclass

import pandas as pd

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


@dataclass
class PivotPoints:
    """Pivot point levels."""
    pp: float  # Pivot Point
    r1: float  # Resistance 1
    r2: float  # Resistance 2
    r3: float  # Resistance 3
    s1: float  # Support 1
    s2: float  # Support 2
    s3: float  # Support 3


def calculate_pivot_points(high: float, low: float, close: float, pivot_type: str = 'classic') -> PivotPoints:
    """
    Calculate pivot points from previous day's HLC.

    Args:
        high: Previous day's high
        low: Previous day's low
        close: Previous day's close
        pivot_type: 'classic', 'fibonacci', or 'camarilla'

    Returns:
        PivotPoints with all levels calculated
    """
    if pivot_type == 'classic':
        pp = (high + low + close) / 3
        r1 = (2 * pp) - low
        r2 = pp + (high - low)
        r3 = high + 2 * (pp - low)
        s1 = (2 * pp) - high
        s2 = pp - (high - low)
        s3 = low - 2 * (high - pp)
    elif pivot_type == 'fibonacci':
        pp = (high + low + close) / 3
        range_hl = high - low
        r1 = pp + (0.382 * range_hl)
        r2 = pp + (0.618 * range_hl)
        r3 = pp + (1.000 * range_hl)
        s1 = pp - (0.382 * range_hl)
        s2 = pp - (0.618 * range_hl)
        s3 = pp - (1.000 * range_hl)
    elif pivot_type == 'camarilla':
        pp = (high + low + close) / 3
        range_hl = high - low
        r1 = close + (range_hl * 1.1 / 12)
        r2 = close + (range_hl * 1.1 / 6)
        r3 = close + (range_hl * 1.1 / 4)
        s1 = close - (range_hl * 1.1 / 12)
        s2 = close - (range_hl * 1.1 / 6)
        s3 = close - (range_hl * 1.1 / 4)
    else:
        # Default to classic
        pp = (high + low + close) / 3
        r1 = (2 * pp) - low
        r2 = pp + (high - low)
        r3 = high + 2 * (pp - low)
        s1 = (2 * pp) - high
        s2 = pp - (high - low)
        s3 = low - 2 * (high - pp)

    return PivotPoints(pp=pp, r1=r1, r2=r2, r3=r3, s1=s1, s2=s2, s3=s3)


def get_ist_time(ts_ns: int) -> tuple:
    """Convert nanosecond timestamp to IST time components."""
    ts_sec = ts_ns / 1_000_000_000
    dt_utc = datetime.fromtimestamp(ts_sec, tz=timezone.utc)
    dt_ist = dt_utc + timedelta(hours=5, minutes=30)
    return dt_ist.hour, dt_ist.minute, dt_ist.date()


def get_previous_day_data(df: pd.DataFrame, current_date) -> Optional[tuple]:
    """
    Get previous trading day's HLC from dataframe.

    Returns:
        Tuple of (high, low, close) or None if not available
    """
    if df is None or df.empty:
        return None

    # Get all dates before current date
    df_index = df.index
    if not isinstance(df_index, pd.DatetimeIndex):
        df_index = pd.to_datetime(df_index)

    # Convert current_date to datetime for comparison
    current_dt = datetime.combine(current_date, datetime.min.time())

    # Find the most recent trading day before current_date
    previous_dates = df_index[df_index.date < current_date.date() if hasattr(df_index.date, '__iter__') else True]

    if len(previous_dates) == 0:
        return None

    # Group by date and get the last complete trading day
    df_copy = df.copy()
    df_copy['date'] = df_copy.index.date
    unique_dates = sorted(df_copy['date'].unique())

    # Find the date before current_date
    dates_before = [d for d in unique_dates if d < current_date]
    if not dates_before:
        return None

    prev_date = dates_before[-1]
    prev_day_data = df_copy[df_copy['date'] == prev_date]

    if prev_day_data.empty:
        return None

    return (
        prev_day_data['high'].max(),
        prev_day_data['low'].min(),
        prev_day_data['close'].iloc[-1]
    )


def run_single_stock_backtest(args):
    """Run backtest for a single stock in isolation."""
    symbol, params, days = args

    try:
        from upstox_trader.screeners.tv_screen_usage import TVScreenerUsage

        # Extract params
        pivot_type = str(params.get('pivot_type', 'classic'))
        breakout_buffer_pct = float(params.get('breakout_buffer_pct', 0.1))
        sl_pct = float(params.get('stop_loss_pct', 0.5))
        tp_pct = float(params.get('take_profit_pct', 1.5))
        trade_size = int(params.get('trade_size', 100))
        timeframe = int(params.get('timeframe', '5'))
        include_costs = bool(params.get('include_costs', True))
        enable_shorts = bool(params.get('enable_shorts', False))
        cooldown_bars = int(params.get('cooldown_bars', 3))

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

        # Fetch historical + intraday data
        today = datetime.now()
        to_date = today.strftime('%Y-%m-%d')
        from_date = (today - timedelta(days=days + 30)).strftime('%Y-%m-%d')

        screener = TVScreenerUsage(enable_paper_trading=False)
        df = screener.upstox_api.fetch_historical_data_v3(
            symbol=symbol, unit="minutes", interval=timeframe, to_date=to_date, from_date=from_date
        )

        if df is None or df.empty:
            return {'symbol': symbol, 'success': False, 'error': 'No data'}

        try:
            df_intraday = screener.upstox_api.fetch_intraday_data_v3(symbol=symbol, interval=str(timeframe))
            if df_intraday is not None and not df_intraday.empty:
                df = pd.concat([df, df_intraday]).drop_duplicates(keep='last').sort_index()
        except Exception:
            pass

        # Normalize bars for nautilus (requires UTC)
        # Data from Upstox is in IST, we localize to UTC so nautilus treats 9:15 as 9:15
        df_copy = df[['open', 'high', 'low', 'close', 'volume']].copy()
        if not isinstance(df_copy.index, pd.DatetimeIndex):
            df_copy.index = pd.to_datetime(df_copy.index)
        if df_copy.index.tz is None:
            df_copy.index = df_copy.index.tz_localize('UTC')
        else:
            df_copy.index = df_copy.index.tz_convert('UTC')

        bar_type = BarType.from_str(f"{instrument_id}-{timeframe}-MINUTE-LAST-EXTERNAL")
        wrangler = BarDataWrangler(bar_type=bar_type, instrument=instrument)
        bars = wrangler.process(df_copy)
        if not bars:
            return {'symbol': symbol, 'success': False, 'error': 'No bars'}

        config = SRBreakoutConfig(
            instrument_id=instrument_id,
            bar_type=bar_type,
            pivot_type=pivot_type,
            breakout_buffer_pct=breakout_buffer_pct,
            sl_pct=sl_pct,
            tp_pct=tp_pct,
            trade_size=trade_size,
            enable_shorts=enable_shorts,
            cooldown_bars=cooldown_bars,
            historical_df=df_copy,
        )

        engine = BacktestEngine(config=BacktestEngineConfig(trader_id=TraderId("BACKTESTER-001")))
        account_type = AccountType.MARGIN if enable_shorts else AccountType.CASH
        engine.add_venue(
            venue=venue,
            oms_type=OmsType.NETTING,
            account_type=account_type,
            base_currency=INR,
            starting_balances=[Money(1_000_000, INR)],
        )
        engine.add_instrument(instrument)
        engine.add_data(bars)
        strategy = SRBreakoutNautilusStrategy(config=config)
        engine.add_strategy(strategy=strategy)
        engine.run()

        trades = strategy.trades
        engine.dispose()

        # Output candles with IST times (from original df, not UTC-localized df_copy)
        candle_data = {
            'index': [idx.strftime('%Y-%m-%dT%H:%M:%S') if hasattr(idx, 'strftime') else str(idx)[:19] for idx in df.index],
            'open': df['open'].tolist(),
            'high': df['high'].tolist(),
            'low': df['low'].tolist(),
            'close': df['close'].tolist(),
            'volume': df['volume'].tolist() if 'volume' in df.columns else [0] * len(df),
        }

        if not trades:
            return {
                'symbol': symbol,
                'success': True,
                'trades': 0,
                'result': None,
                'candles': candle_data,
                'trade_list': [],
            }

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

        return {
            'symbol': symbol,
            'success': True,
            'trades': total_trades,
            'result': result,
            'candles': candle_data,
            'trade_list': trades,
        }
    except Exception as e:
        return {'symbol': symbol, 'success': False, 'error': str(e)}


class SRBreakoutNautilusStrategy(Strategy):
    """Support & Resistance Breakout implementation using Pivot Points."""

    def __init__(self, config: 'SRBreakoutConfig'):
        super().__init__(config)
        self._instrument_id = config.instrument_id
        self._bar_type = config.bar_type
        self._pivot_type = config.pivot_type
        self._breakout_buffer_pct = config.breakout_buffer_pct
        self._sl_pct = config.sl_pct
        self._tp_pct = config.tp_pct
        self._trade_size = config.trade_size
        self._enable_shorts = config.enable_shorts
        self._cooldown_bars = config.cooldown_bars
        self._historical_df = config.historical_df

        self._current_date = None
        self._pivot_points: Optional[PivotPoints] = None
        self._entry_price = None
        self._position_side = None
        self._last_exit_bar = None
        self._bar_number = 0

        self.trades = []
        self._current_entry_time = None

    def on_start(self):
        self.subscribe_bars(self._bar_type)

    def on_bar(self, bar):
        hour, minute, date = get_ist_time(bar.ts_event)
        cur_min = hour * 60 + minute
        close_f = float(bar.close)
        bar_time = datetime.fromtimestamp(bar.ts_event / 1_000_000_000, tz=timezone.utc)
        bar_time_ist = bar_time + timedelta(hours=5, minutes=30)

        self._bar_number += 1

        # New trading day - recalculate pivot points
        if self._current_date != date:
            self._current_date = date
            self._pivot_points = None
            self._last_exit_bar = None

            # Calculate pivot points from previous day's data
            prev_day_data = self._get_previous_day_hlc(date)
            if prev_day_data:
                high, low, close = prev_day_data
                self._pivot_points = calculate_pivot_points(high, low, close, self._pivot_type)

        # Skip if pivot points not available
        if self._pivot_points is None:
            return

        # Market timing
        mkt_open = 9 * 60 + 15  # 9:15 AM IST

        # Wait for market open
        if cur_min < mkt_open:
            return

        # EOD safety exit (3:15 PM IST)
        if cur_min >= 15 * 60 + 15:
            positions = self.cache.positions_open(instrument_id=self._instrument_id)
            if positions:
                self._exit(bar, positions[0], "EOD", bar_time_ist)
            return

        # Manage existing position
        positions = self.cache.positions_open(instrument_id=self._instrument_id)
        if positions:
            self._manage(bar, positions[0], bar_time_ist)
            return

        # Check for new entry
        self._check_entry(close_f, bar_time_ist)

    def _get_previous_day_hlc(self, current_date) -> Optional[tuple]:
        """Get previous trading day's HLC from historical data."""
        if self._historical_df is None or self._historical_df.empty:
            return None

        df = self._historical_df.copy()
        df['date'] = df.index.date

        unique_dates = sorted(df['date'].unique())
        dates_before = [d for d in unique_dates if d < current_date]

        if not dates_before:
            return None

        prev_date = dates_before[-1]
        prev_day_data = df[df['date'] == prev_date]

        if prev_day_data.empty:
            return None

        return (
            prev_day_data['high'].max(),
            prev_day_data['low'].min(),
            prev_day_data['close'].iloc[-1]
        )

    def _check_entry(self, close_f: float, bar_time_ist: datetime):
        if self._pivot_points is None:
            return

        # Check cooldown
        if self._last_exit_bar is not None and self._cooldown_bars > 0:
            if (self._bar_number - self._last_exit_bar) < self._cooldown_bars:
                return

        # Calculate breakout levels with buffer
        buffer_multiplier = self._breakout_buffer_pct / 100

        # Long entry: close above R1 + buffer
        long_trigger = self._pivot_points.r1 * (1 + buffer_multiplier)
        long_entry = close_f > long_trigger

        # Short entry: close below S1 - buffer
        short_trigger = self._pivot_points.s1 * (1 - buffer_multiplier)
        short_entry = close_f < short_trigger

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

        if self._position_side == "SHORT":
            pnl_pct = ((self._entry_price - cur_price) / self._entry_price) * 100
        else:
            pnl_pct = ((cur_price - self._entry_price) / self._entry_price) * 100

        if pnl_pct >= self._tp_pct:
            self._exit(bar, position, "TP", bar_time_ist)
        elif pnl_pct <= -self._sl_pct:
            self._exit(bar, position, "SL", bar_time_ist)

    def _exit(self, bar, position, reason, bar_time_ist):
        cur_price = float(bar.close)
        pos_qty = int(float(position.quantity)) if position.quantity else 0

        if self._position_side == "SHORT":
            gross_pnl = (self._entry_price - cur_price) * abs(pos_qty)
            gross_pnl_pct = ((self._entry_price - cur_price) / self._entry_price) * 100
        else:
            gross_pnl = (cur_price - self._entry_price) * abs(pos_qty)
            gross_pnl_pct = ((cur_price - self._entry_price) / self._entry_price) * 100

        costs = calculate_trading_costs(self._entry_price, cur_price, abs(pos_qty))
        net_pnl = gross_pnl - costs['total_costs']
        net_pnl_pct = (net_pnl / (self._entry_price * abs(pos_qty))) * 100 if pos_qty != 0 else 0

        hold_minutes = 0
        if self._current_entry_time and bar_time_ist:
            hold_minutes = int((bar_time_ist - self._current_entry_time).total_seconds() / 60)

        # Store pivot levels for trade record
        pp_data = {}
        if self._pivot_points:
            pp_data = {
                'pp': round(self._pivot_points.pp, 2),
                'r1': round(self._pivot_points.r1, 2),
                's1': round(self._pivot_points.s1, 2),
                'r2': round(self._pivot_points.r2, 2),
                's2': round(self._pivot_points.s2, 2),
            }

        self.trades.append({
            'entry_price': self._entry_price,
            'exit_price': cur_price,
            'entry_time': self._current_entry_time.strftime('%Y-%m-%dT%H:%M') if self._current_entry_time else None,
            'exit_time': bar_time_ist.strftime('%Y-%m-%dT%H:%M') if bar_time_ist else None,
            'quantity': abs(pos_qty),
            'gross_pnl': gross_pnl,
            'gross_pnl_pct': gross_pnl_pct,
            'trading_costs': costs['total_costs'],
            'net_pnl': net_pnl,
            'net_pnl_pct': net_pnl_pct,
            'exit_reason': reason,
            'hold_duration_minutes': hold_minutes,
            'date': self._current_entry_time.strftime('%Y-%m-%d') if self._current_entry_time else None,
            'side': self._position_side,
            **pp_data,
        })

        self.close_all_positions(self._instrument_id)
        self._position_side = None
        self._entry_price = None
        self._current_entry_time = None
        self._last_exit_bar = self._bar_number

    def on_stop(self):
        pass

    def on_reset(self):
        self._current_date = None
        self._pivot_points = None
        self._position_side = None
        self._entry_price = None


class SRBreakoutConfig(StrategyConfig, kw_only=True):
    """Configuration for Support & Resistance Breakout strategy."""
    instrument_id: InstrumentId
    bar_type: BarType
    pivot_type: str = 'classic'
    breakout_buffer_pct: float = 0.1
    sl_pct: float = 0.5
    tp_pct: float = 1.5
    trade_size: int = 100
    enable_shorts: bool = False
    cooldown_bars: int = 3
    historical_df: Optional[pd.DataFrame] = None


class SRBreakoutStrategy(BaseStrategy):
    """Support & Resistance Breakout Strategy - API wrapper."""

    @classmethod
    def get_name(cls) -> str:
        return "S/R Breakout - Support & Resistance Breakout"

    @classmethod
    def get_description(cls) -> str:
        return (
            "Pivot Point Breakout: Calculate PP/R1-R3/S1-S3 from previous day's HLC, "
            "enter on resistance breakout (long) or support breakdown (short), "
            "manage with SL/TP, optional shorts, optional cooldown."
        )

    @classmethod
    def get_params(cls) -> List[StrategyParam]:
        return [
            StrategyParam(
                key='pivot_type',
                label='Pivot Type',
                type='select',
                default='classic',
                options=['classic', 'fibonacci', 'camarilla'],
            ),
            StrategyParam(
                key='breakout_buffer_pct',
                label='Breakout Buffer %',
                type='number',
                default=0.1,
                min=0.0,
                max=0.5,
                step=0.05,
            ),
            StrategyParam(
                key='timeframe',
                label='Timeframe',
                type='select',
                default='5',
                options=['1', '5', '15'],
            ),
            StrategyParam(
                key='stop_loss_pct',
                label='Stop Loss %',
                type='number',
                default=0.5,
                min=0.1,
                max=2.0,
                step=0.1,
            ),
            StrategyParam(
                key='take_profit_pct',
                label='Take Profit %',
                type='number',
                default=1.5,
                min=0.2,
                max=4.0,
                step=0.1,
            ),
            StrategyParam(
                key='trade_size',
                label='Trade Size',
                type='number',
                default=100,
                min=1,
                max=5000,
                step=1,
            ),
            StrategyParam(
                key='cooldown_bars',
                label='Cooldown Bars',
                type='number',
                default=3,
                min=0,
                max=20,
                step=1,
            ),
            StrategyParam(
                key='enable_shorts',
                label='Enable Shorts',
                type='boolean',
                default=False,
            ),
        ]

    def validate_params(self, params: Dict) -> List[str]:
        errors = []

        if str(params.get('pivot_type', 'classic')) not in {'classic', 'fibonacci', 'camarilla'}:
            errors.append("Pivot Type must be one of classic, fibonacci, camarilla")
        if float(params.get('stop_loss_pct', 0.5)) >= float(params.get('take_profit_pct', 1.5)):
            errors.append("Stop Loss must be less than Take Profit")
        if str(params.get('timeframe', '5')) not in {'1', '5', '15'}:
            errors.append("Timeframe must be one of 1, 5, 15")

        return errors

    def run(self, symbols: List[str], days: int, params: Dict, progress_callback=None) -> Dict:
        results = []
        chart_data = {}
        all_candles = {}

        from multiprocessing import Pool, cpu_count

        worker_args = [(symbol, params, days) for symbol in symbols]
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
                            chart_data[result['symbol']] = {'trades': result['trade_list']}
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
                        chart_data[result['symbol']] = {'trades': result['trade_list']}

        total_gross = sum(r['gross_pnl'] for r in results)
        total_costs = sum(r['total_costs'] for r in results)
        total_net = sum(r['net_pnl'] for r in results)
        total_trades = sum(r['trades'] for r in results)
        total_wins = sum(r['wins'] for r in results)
        total_win_rate = (total_wins / total_trades * 100) if total_trades > 0 else 0

        return {
            'strategy': 'sr_breakout',
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
