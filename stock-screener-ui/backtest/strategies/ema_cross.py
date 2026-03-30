"""
EMA Crossover Strategy using NautilusTrader

Backtest behavior:
- Calculate fast and slow EMA from close prices
- Enter long when fast EMA crosses above slow EMA
- Enter short when fast EMA crosses below slow EMA (if enabled)
- Manage with fixed SL/TP
- Exit at EOD
"""

import sys
import os
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from dataclasses import dataclass

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
    dt_ist = dt_utc.astimezone(IST)
    return dt_ist.hour, dt_ist.minute, dt_ist.date()


def calculate_ema(prices: List[float], period: int) -> float:
    """Calculate Exponential Moving Average from a list of prices."""
    if len(prices) < period:
        return prices[-1] if prices else 0.0

    multiplier = 2.0 / (period + 1)
    ema = sum(prices[:period]) / period
    for price in prices[period:]:
        ema = (price - ema) * multiplier + ema
    return ema


def run_single_stock_backtest(args):
    """Run backtest for a single stock in isolation."""
    symbol, params, days, access_token = args if len(args) == 4 else (*args, None)

    try:
        from backtest.utils import get_upstox_client_from_db, get_upstox_client_with_token

        ema_fast_period = int(params.get('ema_fast_period', 9))
        ema_slow_period = int(params.get('ema_slow_period', 21))
        sl_pct = float(params.get('stop_loss_pct', 0.5))
        tp_pct = float(params.get('take_profit_pct', 1.5))
        trade_size = int(params.get('trade_size', 100))
        timeframe = int(params.get('timeframe', 5))
        include_costs = bool(params.get('include_costs', True))
        enable_shorts = bool(params.get('enable_shorts', False))
        cooldown_bars = int(params.get('cooldown_bars', 3))

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

        config = EMACrossConfig(
            instrument_id=instrument_id,
            bar_type=bar_type,
            ema_fast_period=ema_fast_period,
            ema_slow_period=ema_slow_period,
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
        strategy = EMACrossNautilusStrategy(config=config)
        engine.add_strategy(strategy=strategy)
        engine.run()

        trades = strategy.trades
        engine.dispose()

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


class EMACrossNautilusStrategy(Strategy):
    """EMA Crossover implementation using NautilusTrader."""

    def __init__(self, config: 'EMACrossConfig'):
        super().__init__(config)
        self._instrument_id = config.instrument_id
        self._bar_type = config.bar_type
        self._ema_fast_period = config.ema_fast_period
        self._ema_slow_period = config.ema_slow_period
        self._sl_pct = config.sl_pct
        self._tp_pct = config.tp_pct
        self._trade_size = config.trade_size
        self._enable_shorts = config.enable_shorts
        self._cooldown_bars = config.cooldown_bars
        self._historical_df = config.historical_df

        self._current_date = None
        self._entry_price = None
        self._position_side = None
        self._last_exit_bar = None
        self._bar_number = 0

        self.trades = []
        self._current_entry_time = None

        self._close_prices: List[float] = []
        self._prev_ema_fast = None
        self._prev_ema_slow = None

    def on_start(self):
        self.subscribe_bars(self._bar_type)

    def on_bar(self, bar):
        hour, minute, date = get_ist_time(bar.ts_event)
        cur_min = hour * 60 + minute
        close_f = float(bar.close)
        bar_time = datetime.fromtimestamp(bar.ts_event / 1_000_000_000, tz=timezone.utc)
        bar_time_ist = bar_time.astimezone(IST)

        self._bar_number += 1

        if self._current_date != date:
            self._current_date = date
            self._last_exit_bar = None
            self._close_prices = []
            self._prev_ema_fast = None
            self._prev_ema_slow = None

        mkt_open = 9 * 60 + 15

        if cur_min < mkt_open:
            return

        if cur_min >= 14 * 60 + 45:
            positions = self.cache.positions_open(instrument_id=self._instrument_id)
            if positions:
                ema_fast = calculate_ema(self._close_prices, self._ema_fast_period) if self._close_prices else 0.0
                ema_slow = calculate_ema(self._close_prices, self._ema_slow_period) if self._close_prices else 0.0
                self._exit(bar, positions[0], "EOD", bar_time_ist, ema_fast, ema_slow)
            return

        self._close_prices.append(close_f)

        if len(self._close_prices) < self._ema_slow_period:
            return

        ema_fast = calculate_ema(self._close_prices, self._ema_fast_period)
        ema_slow = calculate_ema(self._close_prices, self._ema_slow_period)

        positions = self.cache.positions_open(instrument_id=self._instrument_id)
        if positions:
            self._manage(bar, positions[0], bar_time_ist, ema_fast, ema_slow)
            return

        if self._prev_ema_fast is not None and self._prev_ema_slow is not None:
            bullish_cross = self._prev_ema_fast <= self._prev_ema_slow and ema_fast > ema_slow
            bearish_cross = self._prev_ema_fast >= self._prev_ema_slow and ema_fast < ema_slow

            if bullish_cross:
                self._check_entry("LONG", close_f, bar_time_ist, ema_fast, ema_slow)
            elif bearish_cross and self._enable_shorts:
                self._check_entry("SHORT", close_f, bar_time_ist, ema_fast, ema_slow)

        self._prev_ema_fast = ema_fast
        self._prev_ema_slow = ema_slow

    def _check_entry(self, side: str, close_f: float, bar_time_ist: datetime, ema_fast: float, ema_slow: float):
        if self._last_exit_bar is not None and self._cooldown_bars > 0:
            if (self._bar_number - self._last_exit_bar) < self._cooldown_bars:
                return

        order_side = OrderSide.BUY if side == "LONG" else OrderSide.SELL
        order = self.order_factory.market(
            instrument_id=self._instrument_id,
            order_side=order_side,
            quantity=Quantity.from_str(str(self._trade_size)),
        )
        self.submit_order(order)
        self._position_side = side
        self._entry_price = close_f
        self._current_entry_time = bar_time_ist
        self._entry_ema_fast = ema_fast
        self._entry_ema_slow = ema_slow

    def _manage(self, bar, position, bar_time_ist, ema_fast: float, ema_slow: float):
        cur_price = float(bar.close)

        if self._position_side == "SHORT":
            pnl_pct = ((self._entry_price - cur_price) / self._entry_price) * 100
        else:
            pnl_pct = ((cur_price - self._entry_price) / self._entry_price) * 100

        if pnl_pct >= self._tp_pct:
            self._exit(bar, position, "TP", bar_time_ist, ema_fast, ema_slow)
        elif pnl_pct <= -self._sl_pct:
            self._exit(bar, position, "SL", bar_time_ist, ema_fast, ema_slow)

    def _exit(self, bar, position, reason, bar_time_ist, ema_fast: float, ema_slow: float):
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

        entry_ema_fast = getattr(self, '_entry_ema_fast', ema_fast)
        entry_ema_slow = getattr(self, '_entry_ema_slow', ema_slow)

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
            'ema_fast': round(entry_ema_fast, 2),
            'ema_slow': round(entry_ema_slow, 2),
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
        self._position_side = None
        self._entry_price = None
        self._close_prices = []
        self._prev_ema_fast = None
        self._prev_ema_slow = None


class EMACrossConfig(StrategyConfig, kw_only=True):
    """Configuration for EMA Crossover strategy."""
    instrument_id: InstrumentId
    bar_type: BarType
    ema_fast_period: int = 9
    ema_slow_period: int = 21
    sl_pct: float = 0.5
    tp_pct: float = 1.5
    trade_size: int = 100
    enable_shorts: bool = False
    cooldown_bars: int = 3
    historical_df: Optional[pd.DataFrame] = None


class EMACrossStrategy(BaseStrategy):
    """EMA Crossover Strategy - API wrapper."""

    @classmethod
    def get_name(cls) -> str:
        return "EMA Crossover"

    @classmethod
    def get_description(cls) -> str:
        return "EMA Crossover strategy. Long when fast EMA crosses above slow EMA, short when fast crosses below."

    @classmethod
    def get_params(cls) -> List[StrategyParam]:
        return [
            StrategyParam(
                key='ema_fast_period',
                label='Fast EMA Period',
                type='number',
                default=9,
                min=3,
                max=50,
                step=1,
            ),
            StrategyParam(
                key='ema_slow_period',
                label='Slow EMA Period',
                type='number',
                default=21,
                min=10,
                max=200,
                step=1,
            ),
            StrategyParam(
                key='stop_loss_pct',
                label='Stop Loss %',
                type='number',
                default=0.5,
                min=0.1,
                max=3.0,
                step=0.1,
            ),
            StrategyParam(
                key='take_profit_pct',
                label='Take Profit %',
                type='number',
                default=1.5,
                min=0.3,
                max=5.0,
                step=0.1,
            ),
            StrategyParam(
                key='timeframe',
                label='Candle Timeframe (min)',
                type='number',
                default=5,
                min=1,
                max=60,
                step=1,
            ),
            StrategyParam(
                key='trade_size',
                label='Trade Size',
                type='number',
                default=100,
                min=1,
                max=10000,
                step=1,
            ),
            StrategyParam(
                key='enable_shorts',
                label='Enable Short Trades',
                type='boolean',
                default=False,
            ),
            StrategyParam(
                key='cooldown_bars',
                label='Cooldown Bars After Exit',
                type='number',
                default=3,
                min=1,
                max=20,
                step=1,
            ),
            StrategyParam(
                key='include_costs',
                label='Include Trading Costs',
                type='boolean',
                default=True,
            ),
        ]

    def validate_params(self, params: Dict) -> List[str]:
        errors = []

        ema_fast = int(params.get('ema_fast_period', 9))
        ema_slow = int(params.get('ema_slow_period', 21))
        sl_pct = float(params.get('stop_loss_pct', 0.5))
        tp_pct = float(params.get('take_profit_pct', 1.5))
        timeframe = int(params.get('timeframe', 5))
        trade_size = int(params.get('trade_size', 100))
        cooldown_bars = int(params.get('cooldown_bars', 3))

        if ema_fast >= ema_slow:
            errors.append("Fast EMA Period must be less than Slow EMA Period")
        if ema_fast < 3 or ema_fast > 50:
            errors.append("Fast EMA Period must be between 3 and 50")
        if ema_slow < 10 or ema_slow > 200:
            errors.append("Slow EMA Period must be between 10 and 200")
        if sl_pct < 0.1 or sl_pct > 3.0:
            errors.append("Stop Loss % must be between 0.1 and 3.0")
        if tp_pct < 0.3 or tp_pct > 5.0:
            errors.append("Take Profit % must be between 0.3 and 5.0")
        if sl_pct >= tp_pct:
            errors.append("Stop Loss must be less than Take Profit")
        if timeframe < 1 or timeframe > 60:
            errors.append("Timeframe must be between 1 and 60 minutes")
        if trade_size < 1 or trade_size > 10000:
            errors.append("Trade Size must be between 1 and 10000")
        if cooldown_bars < 1 or cooldown_bars > 20:
            errors.append("Cooldown Bars must be between 1 and 20")

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
            'strategy': 'ema_cross',
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
        """Return EMA line overlays on chart."""
        if not trades:
            return []

        visuals = []
        dates_seen = set()
        for trade in trades:
            trade_date = trade.get('date')
            if trade_date and trade_date not in dates_seen:
                dates_seen.add(trade_date)
                ema_fast = trade.get('ema_fast')
                ema_slow = trade.get('ema_slow')

                if ema_fast is not None:
                    visuals.append({
                        'id': f"ema_fast_{trade_date}",
                        'type': 'line',
                        'label': 'EMA Fast',
                        'color': '#10ac84',
                        'value': ema_fast,
                        'date': trade_date,
                    })
                if ema_slow is not None:
                    visuals.append({
                        'id': f"ema_slow_{trade_date}",
                        'type': 'line',
                        'label': 'EMA Slow',
                        'color': '#ee5253',
                        'value': ema_slow,
                        'date': trade_date,
                    })

        return visuals
