#!/usr/bin/env python3
"""
ORB Strategy - Opening Range Breakout

Best performing intraday strategy:
- Timeframe: 5 minutes
- OR Period: 45 minutes
- Entry: Breakout above OR High
- Stop Loss: 0.5%
- Take Profit: 1.0%
- Exit by: 14:45 IST (EOD)

Best stocks: NETWEB, SBILIFE, ICICIBANK, TCS, COCHINSHIP
"""

import sys
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Dict, Optional

import pandas as pd
import numpy as np
from rich.console import Console
from rich.table import Table
from rich.panel import Panel

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

_current_file_dir = os.path.dirname(os.path.abspath(__file__))
_upstox_trader_dir = os.path.dirname(_current_file_dir)
_project_root_dir = os.path.dirname(_upstox_trader_dir)

if _project_root_dir not in sys.path:
    sys.path.insert(0, _project_root_dir)

from upstox_trader.screeners.tv_screen_usage import TVScreenerUsage

console = Console(width=220)

# Best performing stocks
STOCKS = ["NETWEB", "TCS", "COCHINSHIP", "SBILIFE", "ICICIBANK"]
STARTING_CAPITAL = 1_000_000.0

# Optimal parameters
OR_MINUTES = 45
STOP_LOSS_PCT = 0.5
TAKE_PROFIT_PCT = 1.0
TRADE_SIZE = 100

# Indian Trading Costs (Intraday Equity)
# Based on Zerodha/Upstox discount broker rates
BROKERAGE_PCT = 0.0003        # 0.03% (lower of ₹20 or 0.03% - using % for large trades)
STT_PCT = 0.00025             # 0.025% (sell side only)
EXCHANGE_CHARGES_PCT = 0.0000297  # 0.00297%
SEBI_FEE_PCT = 0.000001       # 0.0001%
STAMP_DUTY_PCT = 0.00003      # 0.003% (buy side only)
GST_PCT = 0.18                # 18% on brokerage + exchange + SEBI
DP_CHARGES = 0                # ₹13.5 per stock per day (not applicable for intraday)


def calculate_trading_costs(entry_price: float, exit_price: float, quantity: int) -> dict:
    """
    Calculate realistic Indian intraday trading costs.

    Returns dict with buy_costs, sell_costs, total_costs
    """
    buy_value = entry_price * quantity
    sell_value = exit_price * quantity

    # Buy side costs
    buy_brokerage = min(20, buy_value * BROKERAGE_PCT)  # Lower of ₹20 or 0.03%
    buy_stamp_duty = buy_value * STAMP_DUTY_PCT
    buy_exchange = buy_value * EXCHANGE_CHARGES_PCT
    buy_sebi = buy_value * SEBI_FEE_PCT
    buy_gst = GST_PCT * (buy_brokerage + buy_exchange + buy_sebi)
    buy_total = buy_brokerage + buy_stamp_duty + buy_exchange + buy_sebi + buy_gst

    # Sell side costs
    sell_brokerage = min(20, sell_value * BROKERAGE_PCT)  # Lower of ₹20 or 0.03%
    sell_stt = sell_value * STT_PCT  # STT only on sell side for intraday
    sell_exchange = sell_value * EXCHANGE_CHARGES_PCT
    sell_sebi = sell_value * SEBI_FEE_PCT
    sell_gst = GST_PCT * (sell_brokerage + sell_exchange + sell_sebi)
    sell_total = sell_brokerage + sell_stt + sell_exchange + sell_sebi + sell_gst

    return {
        'buy_costs': buy_total,
        'sell_costs': sell_total,
        'total_costs': buy_total + sell_total,
        'breakdown': {
            'buy_brokerage': buy_brokerage,
            'buy_stamp_duty': buy_stamp_duty,
            'sell_brokerage': sell_brokerage,
            'sell_stt': sell_stt,
        }
    }


def get_ist_time(ts_ns: int) -> tuple:
    ts_sec = ts_ns / 1_000_000_000
    dt_utc = datetime.fromtimestamp(ts_sec, tz=timezone.utc)
    dt_ist = dt_utc + timedelta(hours=5, minutes=30)
    return dt_ist.hour, dt_ist.minute, dt_ist.date()


class ORBConfig(StrategyConfig, kw_only=True):
    instrument_id: InstrumentId
    bar_type: BarType
    or_minutes: int = OR_MINUTES
    sl_pct: float = STOP_LOSS_PCT
    tp_pct: float = TAKE_PROFIT_PCT
    trade_size: int = TRADE_SIZE


class ORBStrategy(Strategy):
    """Opening Range Breakout - Long Only"""

    def __init__(self, config: ORBConfig):
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
        self.trades = []

    def on_start(self):
        self.subscribe_bars(self._bar_type)

    def on_bar(self, bar):
        hour, minute, date = get_ist_time(bar.ts_event)
        cur_min = hour * 60 + minute
        close_f = float(bar.close)
        high_f = float(bar.high)
        low_f = float(bar.low)

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
                self._exit(bar, positions[0], "EOD")
            return

        # Manage existing position
        positions = self.cache.positions_open(instrument_id=self._instrument_id)
        if positions:
            self._manage(bar, positions[0])
            return

        # Only trade first 2 hours after OR
        if cur_min - self._or_end > 120:
            return

        # Check entry
        self._check_entry(bar, close_f)

    def _check_entry(self, bar, close_f):
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

    def _manage(self, bar, position):
        cur_price = float(bar.close)
        pnl_pct = ((cur_price - self._entry_price) / self._entry_price) * 100

        # Take Profit
        if pnl_pct >= self._tp_pct:
            self._exit(bar, position, "TP")
        # Stop Loss
        elif pnl_pct <= -self._sl_pct:
            self._exit(bar, position, "SL")

    def _exit(self, bar, position, reason):
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

        self.trades.append({
            'entry_price': self._entry_price,
            'exit_price': cur_price,
            'quantity': abs(pos_qty),
            'gross_pnl': gross_pnl,
            'gross_pnl_pct': gross_pnl_pct,
            'trading_costs': costs['total_costs'],
            'net_pnl': net_pnl,
            'net_pnl_pct': net_pnl_pct,
            'exit_reason': reason,
        })

        self.close_all_positions(self._instrument_id)
        self._position_side = None
        self._entry_price = None

    def on_stop(self):
        pass

    def on_reset(self):
        self._current_date = None
        self._or_high = None
        self._or_low = None
        self._or_defined = False
        self._position_side = None
        self._entry_price = None


def create_instrument(symbol: str, instrument_id: InstrumentId) -> Equity:
    return Equity(
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


def fetch_data(symbol: str, num_days: int, instrument: Equity, interval: int = 5) -> list:
    today = datetime.now()
    to_date = today.strftime('%Y-%m-%d')
    from_date = (today - timedelta(days=num_days + 30)).strftime('%Y-%m-%d')

    try:
        screener = TVScreenerUsage(enable_paper_trading=False)
        df = screener.upstox_api.fetch_historical_data_v3(
            symbol=symbol, unit="minutes", interval=interval,
            to_date=to_date, from_date=from_date,
        )
        if df is None or df.empty:
            return []
        df = df[['open', 'high', 'low', 'close', 'volume']].copy()
        if not isinstance(df.index, pd.DatetimeIndex):
            df.index = pd.to_datetime(df.index)
        if df.index.tz is None:
            df.index = df.index.tz_localize('UTC')
        else:
            df.index = df.index.tz_convert('UTC')
        bar_type = BarType.from_str(f"{instrument.id}-{interval}-MINUTE-LAST-EXTERNAL")
        wrangler = BarDataWrangler(bar_type=bar_type, instrument=instrument)
        return wrangler.process(df)
    except Exception as e:
        console.print(f"[red]Error fetching {symbol}: {e}[/red]")
        return []


def run_backtest(symbol: str, bars: list, venue: Venue, instrument: Equity) -> Optional[Dict]:
    try:
        config = ORBConfig(
            instrument_id=instrument.id,
            bar_type=BarType.from_str(f"{instrument.id}-5-MINUTE-LAST-EXTERNAL"),
        )

        engine = BacktestEngine(config=BacktestEngineConfig(trader_id=TraderId("BACKTESTER-001")))
        engine.add_venue(venue=venue, oms_type=OmsType.NETTING, account_type=AccountType.CASH,
                         base_currency=INR, starting_balances=[Money(STARTING_CAPITAL, INR)])
        engine.add_instrument(instrument)
        engine.add_data(bars)

        strategy = ORBStrategy(config=config)
        engine.add_strategy(strategy=strategy)
        engine.run()

        trades = strategy.trades
        engine.dispose()

        if not trades:
            return None

        # Calculate metrics using NET PnL (after trading costs)
        gross_pnl = sum(t['gross_pnl'] for t in trades)
        total_costs = sum(t['trading_costs'] for t in trades)
        net_pnl = sum(t['net_pnl'] for t in trades)

        wins = sum(1 for t in trades if t['net_pnl'] > 0)
        losses = sum(1 for t in trades if t['net_pnl'] < 0)
        total = wins + losses
        wr = (wins / total * 100) if total > 0 else 0

        gp = sum(t['net_pnl'] for t in trades if t['net_pnl'] > 0)
        gl = abs(sum(t['net_pnl'] for t in trades if t['net_pnl'] < 0))
        pf = gp / gl if gl > 0 else float('inf') if gp > 0 else 0

        tp_exits = sum(1 for t in trades if t['exit_reason'] == 'TP')
        sl_exits = sum(1 for t in trades if t['exit_reason'] == 'SL')
        eod_exits = sum(1 for t in trades if t['exit_reason'] == 'EOD')

        return {
            'symbol': symbol,
            'trades': len(trades),
            'wins': wins,
            'losses': losses,
            'win_rate': wr,
            'gross_pnl': gross_pnl,
            'total_costs': total_costs,
            'net_pnl': net_pnl,
            'pf': pf,
            'tp_exits': tp_exits,
            'sl_exits': sl_exits,
            'eod_exits': eod_exits,
        }
    except Exception as e:
        console.print(f"[red]Backtest error for {symbol}: {e}[/red]")
        return None


def main():
    console.print(Panel.fit(
        "[bold cyan]ORB Strategy - Opening Range Breakout[/bold cyan]\n"
        f"Stocks: {', '.join(STOCKS)}\n"
        f"5-min TF | OR: {OR_MINUTES}min | 180 days | Long Only\n"
        f"SL: {STOP_LOSS_PCT}% | TP: {TAKE_PROFIT_PCT}%",
        border_style="blue"
    ))

    # Fetch data
    console.print("\n[cyan]Fetching data...[/cyan]")
    data_cache = {}
    for sym in STOCKS:
        venue = Venue("SIMULATED")
        iid = InstrumentId.from_str(f"{sym}.{venue}")
        inst = create_instrument(sym, iid)
        bars = fetch_data(sym, 180, inst, 5)
        if bars:
            data_cache[sym] = {'bars': bars, 'inst': inst, 'venue': venue}
            console.print(f"  {sym}: [green]{len(bars)} bars[/green]")
        else:
            console.print(f"  {sym}: [red]No data[/red]")

    if not data_cache:
        console.print("[red]No data fetched![/red]")
        return

    # Run backtests
    console.print(f"\n[bold yellow]Running Backtests (with realistic costs)...[/bold yellow]")
    results = []
    for sym, data in data_cache.items():
        console.print(f"  {sym}...", end=" ")
        r = run_backtest(sym, data['bars'], data['venue'], data['inst'])
        if r:
            results.append(r)
            pnl_s = "green" if r['net_pnl'] >= 0 else "red"
            wr_s = "green" if r['win_rate'] >= 50 else "yellow"
            console.print(f"[{pnl_s}]₹{r['net_pnl']:,.0f}[/{pnl_s}] (Gross: ₹{r['gross_pnl']:,.0f}, Costs: ₹{r['total_costs']:,.0f}) | WR: [{wr_s}]{r['win_rate']:.1f}%[/{wr_s}] | PF: {r['pf']:.2f}")
        else:
            console.print("[yellow]No trades[/yellow]")

    # Summary
    console.print(f"\n[bold green]{'='*80}[/bold green]")
    console.print(f"[bold green]RESULTS (After Trading Costs)[/bold green]")
    console.print(f"[bold green]{'='*80}[/bold green]")

    # Table
    table = Table(show_lines=True)
    table.add_column("Symbol", style="cyan", width=12)
    table.add_column("Net PnL ₹", justify="right")
    table.add_column("Gross PnL ₹", justify="right")
    table.add_column("Costs ₹", justify="right")
    table.add_column("Trades", justify="right")
    table.add_column("WR%", justify="right")
    table.add_column("PF", justify="right")
    table.add_column("TP", justify="right")
    table.add_column("SL", justify="right")

    for r in sorted(results, key=lambda x: x['net_pnl'], reverse=True):
        pnl_s = "green" if r['net_pnl'] >= 0 else "red"
        wr_s = "green" if r['win_rate'] >= 50 else "yellow" if r['win_rate'] >= 40 else "red"
        table.add_row(
            r['symbol'],
            f"[{pnl_s}]₹{r['net_pnl']:,.0f}[/{pnl_s}]",
            f"₹{r['gross_pnl']:,.0f}",
            f"₹{r['total_costs']:,.0f}",
            str(r['trades']),
            f"[{wr_s}]{r['win_rate']:.1f}[/{wr_s}]",
            f"{r['pf']:.2f}",
            str(r['tp_exits']),
            str(r['sl_exits']),
        )
    console.print(table)

    # Totals
    total_gross = sum(r['gross_pnl'] for r in results)
    total_costs = sum(r['total_costs'] for r in results)
    total_net = sum(r['net_pnl'] for r in results)
    total_trades = sum(r['trades'] for r in results)
    total_wins = sum(r['wins'] for r in results)
    total_wr = (total_wins / total_trades * 100) if total_trades > 0 else 0

    console.print(f"\n[bold cyan]Gross PnL: ₹{total_gross:,.0f} | Trading Costs: ₹{total_costs:,.0f} | Net PnL: [{'green' if total_net >= 0 else 'red'}]₹{total_net:,.0f}[/{'green' if total_net >= 0 else 'red'}][/bold cyan]")
    console.print(f"[bold cyan]Win Rate: {total_wr:.1f}% | Trades: {total_trades} | Avg Cost/Trade: ₹{total_costs/total_trades:.0f}[/bold cyan]")

    # Best
    if results:
        best = max(results, key=lambda x: x['net_pnl'])
        console.print(f"\n[bold green]Best: {best['symbol']} - Net: ₹{best['net_pnl']:,.0f} | Gross: ₹{best['gross_pnl']:,.0f} | WR: {best['win_rate']:.1f}% | PF: {best['pf']:.2f}[/bold green]")


if __name__ == "__main__":
    main()
    console.print("\n[bold green]Done![/bold green]")
