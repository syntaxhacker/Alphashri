"""
ORB Strategy - Opening Range Breakout

Intraday strategy that trades breakouts above the opening range.

Best performing parameters:
- Timeframe: 5 minutes
- OR Period: 45 minutes
- Entry: Breakout above OR High + 0.1% of range
- Stop Loss: 0.5%
- Take Profit: 1.0%
- Exit by: 14:45 IST (EOD)
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


class ORBNautilusStrategy(Strategy):
    """NautilusTrader implementation of ORB strategy."""

    def __init__(self, config: 'ORBConfig'):
        super().__init__(config)
        self._instrument_id = config.instrument_id
        self._bar_type = config.bar_type
        self._or_minutes = config.or_minutes
        self._sl_pct = config.sl_pct
        self._tp_pct = config.tp_pct
        self._trade_size = config.trade_size

        self._current_date = None
        self._or_high = None
        self._or_low = None
        self._or_bars = 0
        self._or_defined = False
        self._or_end = 0
        self._entry_price = None
        self._position_side = None

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

        # New day - reset OR
        if self._current_date != date:
            self._current_date = date
            self._or_high = None
            self._or_low = None
            self._or_bars = 0
            self._or_defined = False

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

    def _check_entry(self, bar, close_f, bar_time_ist):
        if self._or_high is None or self._or_low is None:
            return

        or_range = self._or_high - self._or_low
        breakout = self._or_high + or_range * 0.001

        # LONG ONLY
        if close_f > breakout:
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

        # Calculate gross PnL
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
        })

        self.close_all_positions(self._instrument_id)
        self._position_side = None
        self._entry_price = None
        self._current_entry_time = None

    def on_stop(self):
        pass

    def on_reset(self):
        self._current_date = None
        self._or_high = None
        self._or_low = None
        self._or_defined = False
        self._position_side = None
        self._entry_price = None


class ORBConfig(StrategyConfig, kw_only=True):
    """Configuration for ORB NautilusTrader strategy."""
    instrument_id: InstrumentId
    bar_type: BarType
    or_minutes: int = 45
    sl_pct: float = 0.5
    tp_pct: float = 1.0
    trade_size: int = 100


class ORBStrategy(BaseStrategy):
    """Opening Range Breakout Strategy - API wrapper."""

    @classmethod
    def get_name(cls) -> str:
        return "ORB - Opening Range Breakout"

    @classmethod
    def get_description(cls) -> str:
        return (
            "Intraday strategy that enters long positions when price breaks "
            "above the opening range high. Uses fixed stop loss and take profit."
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

        results = []
        chart_data = {}
        all_candles = {}  # Store raw candle data for chart generation

        total = len(symbols)

        for idx, symbol in enumerate(symbols):
            if progress_callback:
                progress_callback(idx + 1, total, f"Processing {symbol}...")

            try:
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
                    continue

                # Store raw candles for chart data - convert to list of dicts for JSON serialization
                df_copy = df[['open', 'high', 'low', 'close', 'volume']].copy()
                if not isinstance(df_copy.index, pd.DatetimeIndex):
                    df_copy.index = pd.to_datetime(df_copy.index)
                if df_copy.index.tz is None:
                    df_copy.index = df_copy.index.tz_localize('UTC')
                else:
                    df_copy.index = df_copy.index.tz_convert('UTC')

                # Convert DataFrame to list of dicts for JSON serialization
                all_candles[symbol] = {
                    'index': [idx.isoformat() for idx in df_copy.index],
                    'open': df_copy['open'].tolist(),
                    'high': df_copy['high'].tolist(),
                    'low': df_copy['low'].tolist(),
                    'close': df_copy['close'].tolist(),
                    'volume': df_copy['volume'].tolist(),
                }

                # Convert to NautilusTrader bars
                df_for_bars = df_copy.copy()
                bar_type = BarType.from_str(f"{instrument_id}-{timeframe}-MINUTE-LAST-EXTERNAL")
                wrangler = BarDataWrangler(bar_type=bar_type, instrument=instrument)
                bars = wrangler.process(df_for_bars)

                if not bars:
                    continue

                # Run backtest
                config = ORBConfig(
                    instrument_id=instrument_id,
                    bar_type=bar_type,
                    or_minutes=or_minutes,
                    sl_pct=sl_pct,
                    tp_pct=tp_pct,
                    trade_size=trade_size,
                )

                engine = BacktestEngine(
                    config=BacktestEngineConfig(trader_id=TraderId("BACKTESTER-001"))
                )
                engine.add_venue(
                    venue=venue,
                    oms_type=OmsType.NETTING,
                    account_type=AccountType.CASH,
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
                    continue

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

                results.append({
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
                })

                # Store chart data
                chart_data[symbol] = {
                    'trades': trades,
                }

            except Exception as e:
                print(f"Error processing {symbol}: {e}")
                continue

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
            'totals': {
                'gross_pnl': round(total_gross, 2),
                'total_costs': round(total_costs, 2),
                'net_pnl': round(total_net, 2),
                'trades': total_trades,
                'win_rate': round(total_win_rate, 1),
            },
            'chart_data': chart_data,
            'candles': all_candles,  # Raw candle data for visualization
            'run_time': datetime.now().isoformat(),
        }
