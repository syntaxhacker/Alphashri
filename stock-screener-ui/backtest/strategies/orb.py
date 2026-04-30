"""
Simplified ORB Strategy - Opening Range Breakout

Backtest behavior aligned to paper-trading flow:
- Wait for opening range to complete (OR minutes)
- Trade breakout side:
  - LONG above OR high
  - SHORT below OR low (if enabled)
- Manage with fixed SL/TP
- Exit at EOD
"""

import sys
import os
from datetime import datetime, timedelta, timezone
from typing import Dict, List

import config
IST = config.IST

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

# Import shared ORB utilities (single source of truth for OR calculations)
from trading.orb_utils import calculate_or_levels as utils_calculate_or_levels


def get_ist_time(ts_ns: int) -> tuple:
    """Convert nanosecond timestamp to IST time components."""
    ts_sec = ts_ns / 1_000_000_000
    dt_utc = datetime.fromtimestamp(ts_sec, tz=timezone.utc)
    dt_ist = dt_utc.astimezone(IST)
    return dt_ist.hour, dt_ist.minute, dt_ist.date()


def run_single_stock_backtest(args):
    """Run backtest for a single stock in isolation."""
    symbol, params, days, access_token = args if len(args) == 4 else (*args, None)

    try:
        from backtest.utils import get_upstox_client_from_db, get_upstox_client_with_token

        or_minutes = int(params.get('or_minutes', 45))
        sl_pct = float(params.get('sl_pct', 1.0))
        tp_pct = float(params.get('tp_pct', 1.5))
        trade_size = int(params.get('trade_size', 100))
        timeframe = int(params.get('timeframe', '5'))
        include_costs = bool(params.get('include_costs', True))
        enable_shorts = bool(params.get('enable_shorts', False))
        cooldown_bars = int(params.get('cooldown_bars', 3))
        breakout_buffer_pct = float(params.get('breakout_buffer_pct', 0.3))

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

        today = datetime.now(IST)
        to_date = today.strftime('%Y-%m-%d')
        from_date = (today - timedelta(days=days + 30)).strftime('%Y-%m-%d')

        if access_token:
            upstox_api, error = get_upstox_client_with_token(access_token, quiet=True)
        else:
            upstox_api, error = get_upstox_client_from_db(quiet=True)
        
        if error or not upstox_api:
            return {'symbol': symbol, 'success': False, 'error': error or 'Failed to get Upstox client'}

        df = upstox_api.fetch_historical_data_v3(
            symbol=symbol, unit="minutes", interval=timeframe, to_date=to_date, from_date=from_date
        )

        if df is None or df.empty:
            return {'symbol': symbol, 'success': False, 'error': 'No data'}

        try:
            df_intraday = upstox_api.fetch_intraday_data_v3(symbol=symbol, interval=str(timeframe))
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

        config = ORBConfig(
            instrument_id=instrument_id,
            bar_type=bar_type,
            or_minutes=or_minutes,
            sl_pct=sl_pct,
            tp_pct=tp_pct,
            trade_size=trade_size,
            enable_shorts=enable_shorts,
            cooldown_bars=cooldown_bars,
            breakout_buffer_pct=breakout_buffer_pct,
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
        strategy = ORBNautilusStrategy(config=config)
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


class ORBNautilusStrategy(Strategy):
    """Simplified ORB implementation aligned with paper flow.
    Uses shared OR calculation utility from trading.orb_utils."""

    def __init__(self, config: 'ORBConfig'):
        super().__init__(config)
        self._instrument_id = config.instrument_id
        self._bar_type = config.bar_type
        self._or_minutes = config.or_minutes
        self._sl_pct = config.sl_pct
        self._tp_pct = config.tp_pct
        self._trade_size = config.trade_size
        self._enable_shorts = config.enable_shorts
        self._cooldown_bars = config.cooldown_bars
        self._breakout_buffer_pct = config.breakout_buffer_pct

        self._current_date = None
        self._or_levels = None  # Dict from calculate_or_levels()
        self._or_candles = []  # Collect OR candles for shared utility
        self._or_defined = False
        self._entry_price = None
        self._position_side = None
        self._last_exit_bar = None
        self._bar_number = 0

        self.trades = []
        self._current_entry_time = None

        # Track peak and low during position
        self._position_peak = None
        self._position_low = None

    def on_start(self):
        self.subscribe_bars(self._bar_type)

    def on_bar(self, bar):
        hour, minute, date = get_ist_time(bar.ts_event)
        cur_min = hour * 60 + minute
        close_f = float(bar.close)
        high_f = float(bar.high)
        low_f = float(bar.low)
        bar_time = datetime.fromtimestamp(bar.ts_event / 1_000_000_000, tz=timezone.utc)
        bar_time_ist = bar_time.astimezone(IST)

        self._bar_number += 1

        if self._current_date != date:
            self._current_date = date
            self._or_levels = None
            self._or_candles = []
            self._or_defined = False
            self._last_exit_bar = None

        mkt_open = 9 * 60 + 15
        or_end = mkt_open + self._or_minutes

        # Collect OR candles during OR period
        if cur_min < or_end:
            self._or_candles.append({
                'time': bar_time_ist.isoformat(),
                'open': float(bar.open),
                'high': high_f,
                'low': low_f,
                'close': close_f,
            })
            return

        # OR period just ended - calculate OR levels using shared utility
        if not self._or_defined and len(self._or_candles) > 0:
            self._or_levels = utils_calculate_or_levels(
                candles=self._or_candles,
                or_minutes=self._or_minutes,
            )
            self._or_defined = True

        if not self._or_defined or self._or_levels is None:
            return

        # EOD safety exit
        if cur_min >= 14 * 60 + 45:
            positions = self.cache.positions_open(instrument_id=self._instrument_id)
            if positions:
                self._exit(bar, positions[0], "EOD", bar_time_ist)
            return

        positions = self.cache.positions_open(instrument_id=self._instrument_id)
        if positions:
            self._manage(bar, positions[0], bar_time_ist)
            return

        self._check_entry(close_f, bar_time_ist)

    def _check_entry(self, close_f: float, bar_time_ist: datetime):
        if self._or_levels is None:
            return

        if self._last_exit_bar is not None and self._cooldown_bars > 0:
            if (self._bar_number - self._last_exit_bar) < self._cooldown_bars:
                return

        buffer = self._breakout_buffer_pct / 100
        or_high = self._or_levels['or_high']
        or_low = self._or_levels['or_low']
        long_entry = close_f > or_high * (1 + buffer)
        short_entry = close_f < or_low * (1 - buffer)

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
            self._position_peak = close_f
            self._position_low = close_f
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
            self._position_peak = close_f
            self._position_low = close_f

    def _manage(self, bar, position, bar_time_ist):
        cur_price = float(bar.close)
        high_f = float(bar.high)
        low_f = float(bar.low)

        # Update peak and low prices
        if self._position_peak is not None:
            self._position_peak = max(self._position_peak, high_f)
        if self._position_low is not None:
            self._position_low = min(self._position_low, low_f)

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
            'or_high': self._or_levels['or_high'] if self._or_levels else None,
            'or_low': self._or_levels['or_low'] if self._or_levels else None,
            'side': self._position_side,
            'peak_price': round(self._position_peak, 2) if self._position_peak else cur_price,
            'low_price': round(self._position_low, 2) if self._position_low else cur_price,
        })

        self.close_all_positions(self._instrument_id)
        self._position_side = None
        self._entry_price = None
        self._current_entry_time = None
        self._last_exit_bar = self._bar_number
        self._position_peak = None
        self._position_low = None

    def on_stop(self):
        pass

    def on_reset(self):
        self._current_date = None
        self._or_levels = None
        self._or_candles = []
        self._or_defined = False
        self._position_side = None
        self._entry_price = None


class ORBConfig(StrategyConfig, kw_only=True):
    """Configuration for simplified ORB strategy."""
    instrument_id: InstrumentId
    bar_type: BarType
    or_minutes: int = 45
    sl_pct: float = 1.0
    tp_pct: float = 1.5
    trade_size: int = 100
    enable_shorts: bool = False
    cooldown_bars: int = 3
    breakout_buffer_pct: float = 0.3


class ORBStrategy(BaseStrategy):
    """Opening Range Breakout Strategy - API wrapper."""

    @classmethod
    def get_name(cls) -> str:
        return "ORB - Opening Range Breakout"

    @classmethod
    def get_description(cls) -> str:
        return (
            "Simple ORB: wait for opening range, trade breakout side, "
            "manage with SL/TP, optional shorts, optional cooldown."
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
                step=5,
            ),
            StrategyParam(
                key='timeframe',
                label='Timeframe',
                type='select',
                default='5',
                options=['1', '5', '15'],
            ),
            StrategyParam(
                key='sl_pct',
                label='Stop Loss %',
                type='number',
                default=1.0,
                min=0.1,
                max=5.0,
                step=0.1,
            ),
            StrategyParam(
                key='take_profit_pct',
                label='Take Profit %',
                type='number',
                default=1.2,
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
            StrategyParam(
                key='breakout_buffer_pct',
                label='Breakout Buffer %',
                type='number',
                default=0.3,
                min=0.0,
                max=1.0,
                step=0.05,
            ),
        ]

    def validate_params(self, params: Dict) -> List[str]:
        errors = []

        if int(params.get('or_minutes', 45)) < 15:
            errors.append("OR Period must be at least 15 minutes")
        if float(params.get('sl_pct', 1.0)) >= float(params.get('tp_pct', 1.5)):
            errors.append("Stop Loss must be less than Take Profit")
        if str(params.get('timeframe', '5')) not in {'1', '5', '15'}:
            errors.append("Timeframe must be one of 1, 5, 15")

        return errors

    def run(self, symbols: List[str], days: int, params: Dict, progress_callback=None) -> Dict:
        results = []
        chart_data = {}
        all_candles = {}
        skipped_stocks = []

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
                    if result['success']:
                        # Always include candles for chart display
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
                        skipped_stocks.append({'symbol': result['symbol'], 'error': result.get('error', 'Unknown')})
        else:
            for args in worker_args:
                completed += 1
                result = run_single_stock_backtest(args)
                if progress_callback:
                    progress_callback(completed, total, f"Completed {result['symbol']}...")
                if result['success']:
                    # Always include candles for chart display
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
                    skipped_stocks.append({'symbol': result['symbol'], 'error': result.get('error', 'Unknown')})

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
            'totals': {
                'gross_pnl': round(total_gross, 2),
                'total_costs': round(total_costs, 2),
                'net_pnl': round(total_net, 2),
                'trades': total_trades,
                'win_rate': round(total_win_rate, 1),
                'stocks_tested': len(results) + len(skipped_stocks),
            },
            'chart_data': chart_data,
            'candles': all_candles,
            'skipped_stocks': skipped_stocks,
            'run_time': datetime.now().isoformat(),
        }

    def get_visuals(self, trades: List[Dict], params: Dict) -> List[Dict]:
        """Return ORB zones as chart visuals."""
        if not trades:
            return []

        visuals = []
        # Group trades by date to find OR zones
        dates_seen = set()
        for trade in trades:
            trade_date = trade.get('date')
            if trade_date and trade_date not in dates_seen:
                dates_seen.add(trade_date)
                or_high = trade.get('or_high')
                or_low = trade.get('or_low')
                
                if or_high is not None and or_low is not None:
                    or_minutes = params.get('or_minutes', 45)
                    # Create ORB zone box
                    visuals.append({
                        'id': f"orb_{trade_date}",
                        'type': 'box',
                        'label': f'ORB ({or_minutes}m)',
                        'color': 'rgba(0, 255, 157, 0.05)',
                        'levels': {'top': or_high, 'bottom': or_low},
                        'date': trade_date,
                        'time_range': {'start': '09:15', 'end': f"{9 + (15 + or_minutes) // 60:02d}:{(15 + or_minutes) % 60:02d}"}
                    })
                    # Add boundary lines
                    visuals.append({
                        'id': f"orb_high_{trade_date}",
                        'type': 'line',
                        'label': 'OR High',
                        'color': '#00ff9d',
                        'value': or_high,
                        'date': trade_date,
                        'dash': [2, 2]
                    })
                    visuals.append({
                        'id': f"orb_low_{trade_date}",
                        'type': 'line',
                        'label': 'OR Low',
                        'color': '#ff4757',
                        'value': or_low,
                        'date': trade_date,
                        'dash': [2, 2]
                    })
        
        return visuals

