#!/usr/bin/env python3
"""
Daily ORB Trading Runner - Execute paper trades based on ORB signals.

This script:
1. Gets ORB-ready stocks from screener
2. Fetches live 5-min data
3. Calculates opening range
4. Detects breakouts and generates signals
5. Executes paper trades
6. Monitors positions and exits

Usage:
    python3 run_daily_trading.py           # Normal run
    python3 run_daily_trading.py --test    # Test mode (no real trades)
    python3 run_daily_trading.py --status  # Just show current status
"""

import sys
import time
import argparse
import json
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List
import signal

# Add project paths
sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent / 'scanners'))

from rich.console import Console
from rich.table import Table
from rich.live import Live
from rich.panel import Panel

console = Console()

# Import trading modules
from trading.paper_trader import PaperTrader, OrderSide, get_paper_trader
from trading.orb_signals import ORBSignalGenerator, SignalType, create_entry_signal
from trading.risk_manager import RiskManager, get_risk_manager
from trading.journal import TradeJournal, get_journal


class DailyTradingRunner:
    """
    Daily ORB trading runner.

    Executes the ORB strategy in real-time during market hours.
    """

    # Market timings (IST)
    PRE_MARKET = (9, 0)
    MARKET_OPEN = (9, 15)
    OR_END = (10, 0)
    FORCE_EXIT = (14, 45)
    MARKET_CLOSE = (15, 30)

    # Cooldown period in minutes after a trade closes
    COOLDOWN_MINUTES = 30

    def __init__(
        self,
        capital: float = 1_000_000,
        max_positions: int = 5,
        test_mode: bool = False,
        force_signals: bool = False,
    ):
        """
        Initialize daily trading runner.

        Args:
            capital: Initial capital
            max_positions: Maximum concurrent positions
            test_mode: If True, don't execute trades
            force_signals: If True, generate synthetic signals for testing
        """
        self.capital = capital
        self.max_positions = max_positions
        self.test_mode = test_mode
        self.force_signals = force_signals

        # Initialize components
        self.trader = get_paper_trader()
        self.signal_generator = ORBSignalGenerator()
        self.risk_manager = get_risk_manager()
        self.journal = get_journal()

        # State
        self.running = True
        self.or_levels = {}
        self.watchlist = []
        self.signals_generated = []
        self.cooldown_stocks = {}  # {symbol: exit_time} - stocks in cooldown
        self.snapshot_file = Path("/tmp/paper-trading-snapshot.json")

        # Data fetcher
        self._screener = None
        self._data_fetcher = None

        # Setup signal handler
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)

    def _signal_handler(self, signum, frame):
        """Handle shutdown signals."""
        console.print("\n[yellow]Shutdown signal received. Closing positions...[/yellow]")
        self.running = False

    def _write_scan_snapshot(self, scan_items: List[dict], signals: List = None):
        """Persist latest scan/watchlist state for UI consumption."""
        try:
            open_positions_data = []
            for symbol, pos in self.trader.positions.items():
                open_positions_data.append({
                    "symbol": symbol,
                    "side": pos.side.value,
                    "quantity": pos.quantity,
                    "entry_price": round(float(pos.entry_price), 2),
                    "current_price": round(float(pos.current_price), 2),
                    "entry_time": pos.entry_time.isoformat() if hasattr(pos.entry_time, "isoformat") else str(pos.entry_time),
                    "stop_loss": round(float(pos.stop_loss), 2),
                    "take_profit": round(float(pos.take_profit), 2),
                    "pnl": round(float(pos.unrealized_pnl), 2),
                    "pnl_pct": round(float(pos.unrealized_pnl_pct), 2),
                    "margin_used": round(float(pos.entry_price * pos.quantity), 2),
                    "order_id": f"LIVE-{symbol}",
                })

            payload = {
                "timestamp": datetime.now().isoformat(),
                "watchlist": self.watchlist,
                "open_positions": list(self.trader.positions.keys()),
                "open_positions_data": open_positions_data,
                "scan_items": scan_items,
                "signals": [
                    {
                        "symbol": s.symbol,
                        "side": "LONG" if s.signal_type == SignalType.LONG_ENTRY else "SHORT",
                        "price": round(float(s.price), 2),
                        "notes": s.notes,
                    }
                    for s in (signals or [])
                ],
            }
            self.snapshot_file.write_text(json.dumps(payload))
        except Exception as e:
            console.print(f"[dim red]Failed to write scan snapshot: {e}[/dim red]")

    def _get_screener(self):
        """Lazy load screener."""
        if self._screener is None:
            from orb_stock_screener import ORBStockScreener
            self._screener = ORBStockScreener(use_relaxed=True)
        return self._screener

    def _get_data_fetcher(self):
        """Lazy load data fetcher."""
        if self._data_fetcher is None:
            from upstox_trader.screeners.tv_screen_usage import TVScreenerUsage
            self._data_fetcher = TVScreenerUsage(enable_paper_trading=False)
        return self._data_fetcher

    def is_market_open(self) -> bool:
        """Check if market is currently open."""
        now = datetime.now()
        open_time = datetime(now.year, now.month, now.day, *self.MARKET_OPEN)
        close_time = datetime(now.year, now.month, now.day, *self.MARKET_CLOSE)
        return open_time <= now <= close_time

    def is_trading_hours(self) -> bool:
        """Check if within trading hours (after OR, before force exit)."""
        now = datetime.now()
        or_end = datetime(now.year, now.month, now.day, *self.OR_END)
        force_exit = datetime(now.year, now.month, now.day, *self.FORCE_EXIT)
        return or_end <= now <= force_exit

    def is_force_exit_time(self) -> bool:
        """Check if it's force exit time."""
        now = datetime.now()
        return now.hour >= self.FORCE_EXIT[0] and now.minute >= self.FORCE_EXIT[1]

    def refresh_watchlist(self):
        """Refresh watchlist from screener."""
        console.print("\n[cyan]Refreshing watchlist from screener...[/cyan]")

        screener = self._get_screener()
        df = screener.screen(limit=50, verify_nse=True)

        if df.empty:
            console.print("[red]No stocks found from screener[/red]")
            return

        self.watchlist = df['name'].tolist()[:20]  # Top 20 stocks
        console.print(f"[green]Watchlist updated: {len(self.watchlist)} stocks[/green]")
        self._write_scan_snapshot([
            {
                "symbol": symbol,
                "status": "watching",
                "reason": "In watchlist, waiting for next scan",
            }
            for symbol in self.watchlist
        ], [])

        # Display watchlist
        table = Table(title="Today's ORB Watchlist")
        table.add_column("#", width=3)
        table.add_column("Symbol")
        table.add_column("Price", justify="right")
        table.add_column("RSI", justify="right")
        table.add_column("ADX", justify="right")
        table.add_column("Score", justify="right")

        for i, (_, row) in enumerate(df.head(20).iterrows(), 1):
            table.add_row(
                str(i),
                row['name'],
                f"₹{row['close']:.0f}",
                f"{row['RSI']:.1f}",
                f"{row['ADX']:.1f}",
                f"{row.get('orb_score', 0):.1f}",
            )

        console.print(table)

    def fetch_or_data(self, symbol: str) -> dict:
        """Fetch opening range data for a symbol using intraday API."""
        try:
            fetcher = self._get_data_fetcher()

            # Fetch today's intraday 5-min data
            df = fetcher.upstox_api.fetch_intraday_data_v3(
                symbol=symbol,
                interval='5'
            )

            if df is None or df.empty:
                return None

            # Convert to candle format
            candles = []
            for idx, row in df.iterrows():
                candles.append({
                    'time': idx.isoformat() if hasattr(idx, 'isoformat') else str(idx),
                    'open': row['open'],
                    'high': row['high'],
                    'low': row['low'],
                    'close': row['close'],
                })

            # Calculate OR levels
            or_levels = self.signal_generator.calculate_or_levels(candles)

            # Add latest price (last candle close)
            if or_levels and candles:
                or_levels['latest_price'] = candles[-1]['close']
                or_levels['latest_high'] = candles[-1]['high']
                or_levels['latest_low'] = candles[-1]['low']

            return or_levels

        except Exception as e:
            console.print(f"[dim red]Error fetching OR for {symbol}: {e}[/dim red]")
            return None

    def fetch_live_price_for_exit(self, symbol: str) -> dict:
        """Fetch 1-minute data for accurate exit monitoring (checks candle high/low)."""
        try:
            fetcher = self._get_data_fetcher()

            # Fetch 1-minute intraday data for more precise exit checking
            df = fetcher.upstox_api.fetch_intraday_data_v3(
                symbol=symbol,
                interval='1'
            )

            if df is None or df.empty:
                return None

            # Get the last candle's high/low/close
            last_candle = df.iloc[-1]
            return {
                'high': last_candle['high'],
                'low': last_candle['low'],
                'close': last_candle['close'],
                'time': df.index[-1].isoformat() if hasattr(df.index[-1], 'isoformat') else str(df.index[-1]),
            }

        except Exception as e:
            console.print(f"[dim red]Error fetching 1-min data for {symbol}: {e}[/dim red]")
            return None

    def scan_for_signals(self):
        """Scan watchlist for ORB signals."""
        scan_items: List[dict] = []

        if not self.is_trading_hours():
            console.print("[dim]Outside trading hours, skipping signal scan[/dim]")
            self._write_scan_snapshot([{
                "symbol": "*",
                "status": "outside_trading_hours",
                "reason": "Outside OR scan window",
            }], [])
            return []

        new_signals = []

        # FORCE SIGNALS MODE: Generate synthetic signals for testing
        if self.force_signals:
            console.print("[yellow]Force signals mode: Generating test signals...[/yellow]")
            import random

            # Pick random stocks from watchlist that we don't have positions in
            available = [s for s in self.watchlist if s not in self.trader.positions]
            if available and len(self.trader.positions) < self.max_positions:
                # Pick 1-2 stocks randomly
                num_signals = min(2, self.max_positions - len(self.trader.positions), len(available))
                selected = random.sample(available, num_signals)

                for symbol in selected:
                    # Create synthetic OR levels with easy breakout
                    # Use current screener price and create OR range around it
                    # Get price from screener data if available
                    price = 400 + random.uniform(-50, 50)  # Placeholder price

                    # Create synthetic OR levels - price is already above OR high
                    or_high = price * 0.98  # OR high is 2% below current price
                    or_low = price * 0.95   # OR low is 5% below current price
                    or_range_pct = 3.0  # Valid OR range

                    signal = create_entry_signal(
                        symbol=symbol,
                        price=price,
                        or_high=or_high,
                        or_low=or_low,
                        sl_pct=0.4,
                        tp_pct=1.2,
                        side="LONG",
                    )
                    signal.notes = f"[TEST] Synthetic breakout above OR high ₹{or_high:.2f}"
                    new_signals.append(signal)
                    scan_items.append({
                        "symbol": symbol,
                        "status": "signal",
                        "side": "LONG",
                        "price": round(price, 2),
                        "or_high": round(or_high, 2),
                        "or_low": round(or_low, 2),
                        "reason": "Force-signal test mode",
                    })
                    console.print(f"[green]Generated test signal for {symbol}[/green]")

            self._write_scan_snapshot(scan_items, new_signals)
            return new_signals

        # NORMAL MODE: Real signal detection with parallel data fetching
        # First, filter symbols to scan
        symbols_to_scan = []
        for symbol in self.watchlist:
            # Skip if already have position
            if symbol in self.trader.positions:
                scan_items.append({
                    "symbol": symbol,
                    "status": "skipped",
                    "reason": "Already in position",
                })
                continue

            # Skip if in cooldown period (recently exited)
            if symbol in self.cooldown_stocks:
                exit_time = self.cooldown_stocks[symbol]
                cooldown_end = exit_time + timedelta(minutes=self.COOLDOWN_MINUTES)
                if datetime.now() < cooldown_end:
                    remaining = (cooldown_end - datetime.now()).seconds // 60
                    console.print(f"[dim yellow]  {symbol}: In cooldown ({remaining}m remaining)[/dim yellow]")
                    scan_items.append({
                        "symbol": symbol,
                        "status": "cooldown",
                        "reason": f"In cooldown ({remaining}m remaining)",
                    })
                    continue
                else:
                    # Cooldown expired, remove from list
                    del self.cooldown_stocks[symbol]

            symbols_to_scan.append(symbol)

        # Fetch OR data sequentially (parallel has issues with signal handlers)
        for symbol in symbols_to_scan:
            # Fetch OR data
            or_levels = self.fetch_or_data(symbol)
            if not or_levels:
                scan_items.append({
                    "symbol": symbol,
                    "status": "no_data",
                    "reason": "No intraday OR data",
                })
                continue

            # Store OR levels
            self.or_levels[symbol] = or_levels

            # Get latest price (use the most recent candle close)
            current_price = or_levels.get('latest_price', or_levels['or_close'])
            or_high = or_levels['or_high']
            or_low = or_levels['or_low']
            or_range_pct = or_levels['or_range_pct']

            # Calculate distance from OR levels
            distance_from_or_high = ((current_price - or_high) / or_high) * 100
            distance_from_or_low = ((or_low - current_price) / or_low) * 100

            # Debug output
            console.print(f"[dim]  {symbol}: Price ₹{current_price:.2f} | OR High ₹{or_high:.2f} | OR Low ₹{or_low:.2f}[/dim]")

            # ENTRY FILTERS to avoid bad entries
            MAX_DISTANCE_FROM_OR = 1.5  # Don't enter if more than 1.5% away from OR level
            MIN_ATR_PCT = 0.6  # Minimum ATR% for enough volatility
            MIN_DAY_RANGE_PCT = 6.0  # Minimum day range %

            # Calculate trend indicators from OR data
            day_open = or_levels.get('or_open', current_price)
            day_change_pct = ((current_price - day_open) / day_open) * 100 if day_open > 0 else 0
            or_range_pct = or_levels.get('or_range_pct', 0)

            # Check for breakout (price above OR high)
            if current_price > or_high:
                # FILTER: Don't enter if too far from OR high (already overextended)
                if distance_from_or_high > MAX_DISTANCE_FROM_OR:
                    console.print(f"[yellow]  ⚠️ {symbol}: Skip LONG - too far from OR high ({distance_from_or_high:.2f}%)[/yellow]")
                    scan_items.append({
                        "symbol": symbol,
                        "status": "blocked",
                        "side": "LONG",
                        "price": round(current_price, 2),
                        "or_high": round(or_high, 2),
                        "or_low": round(or_low, 2),
                        "reason": f"Too far above OR high ({distance_from_or_high:.2f}%)",
                    })
                    continue

                # FILTER: Don't buy if day already up too much (buying at top)
                if day_change_pct > 2.0:
                    console.print(f"[yellow]  ⚠️ {symbol}: Skip LONG - day already up {day_change_pct:.1f}%[/yellow]")
                    scan_items.append({
                        "symbol": symbol,
                        "status": "blocked",
                        "side": "LONG",
                        "price": round(current_price, 2),
                        "or_high": round(or_high, 2),
                        "or_low": round(or_low, 2),
                        "reason": f"Day already up {day_change_pct:.1f}%",
                    })
                    continue

                # FILTER: Need enough volatility for TP to be reached
                if or_range_pct < 2.0:
                    console.print(f"[yellow]  ⚠️ {symbol}: Skip LONG - low volatility (OR range {or_range_pct:.1f}%)[/yellow]")
                    scan_items.append({
                        "symbol": symbol,
                        "status": "blocked",
                        "side": "LONG",
                        "price": round(current_price, 2),
                        "or_high": round(or_high, 2),
                        "or_low": round(or_low, 2),
                        "reason": f"Low volatility (OR range {or_range_pct:.1f}%)",
                    })
                    continue

                signal = create_entry_signal(
                    symbol=symbol,
                    price=current_price,
                    or_high=or_high,
                    or_low=or_low,
                    sl_pct=0.4,
                    tp_pct=1.2,
                    side="LONG",
                )
                signal.notes = f"Breakout above OR high ₹{or_high:.2f} (+{distance_from_or_high:.2f}%)"
                new_signals.append(signal)
                scan_items.append({
                    "symbol": symbol,
                    "status": "signal",
                    "side": "LONG",
                    "price": round(current_price, 2),
                    "or_high": round(or_high, 2),
                    "or_low": round(or_low, 2),
                    "reason": f"Breakout +{distance_from_or_high:.2f}%",
                })
                console.print(f"[green]✓ Breakout detected: {symbol} @ ₹{current_price:.2f} (OR High: ₹{or_high:.2f}, +{distance_from_or_high:.2f}%)[/green]")

            # Check for breakdown (price below OR low)
            elif current_price < or_low:
                # FILTER: Don't enter if too far from OR low (already overextended down)
                if distance_from_or_low > MAX_DISTANCE_FROM_OR:
                    console.print(f"[yellow]  ⚠️ {symbol}: Skip SHORT - too far from OR low ({distance_from_or_low:.2f}%)[/yellow]")
                    scan_items.append({
                        "symbol": symbol,
                        "status": "blocked",
                        "side": "SHORT",
                        "price": round(current_price, 2),
                        "or_high": round(or_high, 2),
                        "or_low": round(or_low, 2),
                        "reason": f"Too far below OR low ({distance_from_or_low:.2f}%)",
                    })
                    continue

                # FILTER: Don't SHORT if stock is in uptrend (day positive)
                if day_change_pct > 1.0:
                    console.print(f"[yellow]  ⚠️ {symbol}: Skip SHORT - uptrend (day +{day_change_pct:.1f}%)[/yellow]")
                    scan_items.append({
                        "symbol": symbol,
                        "status": "blocked",
                        "side": "SHORT",
                        "price": round(current_price, 2),
                        "or_high": round(or_high, 2),
                        "or_low": round(or_low, 2),
                        "reason": f"Uptrend day +{day_change_pct:.1f}%",
                    })
                    continue

                # FILTER: Need enough volatility for TP to be reached
                if or_range_pct < 2.0:
                    console.print(f"[yellow]  ⚠️ {symbol}: Skip SHORT - low volatility (OR range {or_range_pct:.1f}%)[/yellow]")
                    scan_items.append({
                        "symbol": symbol,
                        "status": "blocked",
                        "side": "SHORT",
                        "price": round(current_price, 2),
                        "or_high": round(or_high, 2),
                        "or_low": round(or_low, 2),
                        "reason": f"Low volatility (OR range {or_range_pct:.1f}%)",
                    })
                    continue

                signal = create_entry_signal(
                    symbol=symbol,
                    price=current_price,
                    or_high=or_high,
                    or_low=or_low,
                    sl_pct=0.4,
                    tp_pct=1.2,
                    side="SHORT",
                )
                signal.notes = f"Breakdown below OR low ₹{or_low:.2f} (-{distance_from_or_low:.2f}%)"
                new_signals.append(signal)
                scan_items.append({
                    "symbol": symbol,
                    "status": "signal",
                    "side": "SHORT",
                    "price": round(current_price, 2),
                    "or_high": round(or_high, 2),
                    "or_low": round(or_low, 2),
                    "reason": f"Breakdown -{distance_from_or_low:.2f}%",
                })
                console.print(f"[red]✓ Breakdown detected: {symbol} @ ₹{current_price:.2f} (OR Low: ₹{or_low:.2f}, -{distance_from_or_low:.2f}%)[/red]")
            else:
                scan_items.append({
                    "symbol": symbol,
                    "status": "watching",
                    "price": round(current_price, 2),
                    "or_high": round(or_high, 2),
                    "or_low": round(or_low, 2),
                    "reason": "Waiting for OR breakout",
                })

        self._write_scan_snapshot(scan_items, new_signals)
        return new_signals

    def execute_signal(self, signal):
        """Execute a trading signal."""
        if self.test_mode:
            console.print(f"[yellow]TEST MODE: Would execute {signal.signal_type.value} {signal.symbol} @ ₹{signal.price:.2f}[/yellow]")
            return None

        # Validate with risk manager
        portfolio = self.trader.get_portfolio_status()
        validation = self.risk_manager.validate_trade(
            capital=portfolio['total_value'],
            cash=portfolio['cash'],
            current_positions=len(self.trader.positions),
            current_exposure=portfolio['margin_used'],
            entry_price=signal.price,
            stop_loss=signal.stop_loss,
            take_profit=signal.take_profit,
            side="BUY" if signal.signal_type == SignalType.LONG_ENTRY else "SELL",
        )

        if not validation['valid']:
            console.print(f"[red]Signal rejected: {validation['reason']}[/red]")
            return None

        # Execute trade
        order = self.trader.place_order(
            symbol=signal.symbol,
            side=OrderSide.BUY if signal.signal_type == SignalType.LONG_ENTRY else OrderSide.SELL,
            quantity=validation['shares'],
            price=signal.price,
            stop_loss=signal.stop_loss,
            take_profit=signal.take_profit,
        )

        return order

    def monitor_positions(self):
        """Monitor open positions for exits using 1-min candle high/low."""
        if not self.trader.positions:
            return

        # Track positions before update
        positions_before = set(self.trader.positions.keys())

        # Fetch 1-min data for all positions (more accurate exit detection)
        price_data = {}

        for symbol in list(self.trader.positions.keys()):
            try:
                # Use 1-minute data for exit monitoring
                live_data = self.fetch_live_price_for_exit(symbol)
                if live_data:
                    price_data[symbol] = live_data
                else:
                    # Fallback to 5-min data
                    or_data = self.fetch_or_data(symbol)
                    if or_data and 'latest_price' in or_data:
                        price_data[symbol] = {
                            'high': or_data.get('latest_high', or_data['latest_price']),
                            'low': or_data.get('latest_low', or_data['latest_price']),
                            'close': or_data['latest_price'],
                        }
            except Exception as e:
                # Fallback to position's current price
                pos = self.trader.positions[symbol]
                price_data[symbol] = {
                    'high': pos.current_price,
                    'low': pos.current_price,
                    'close': pos.current_price,
                }

        # Manually check SL/TP using candle high/low (more accurate)
        for symbol, pos in list(self.trader.positions.items()):
            if symbol not in price_data:
                continue

            data = price_data[symbol]
            candle_high = data['high']
            candle_low = data['low']
            candle_close = data['close']

            exit_triggered = False
            exit_price = None
            exit_reason = None

            # For LONG positions: SL below candle low, TP above candle high
            if pos.side.value == 'BUY':
                if candle_low <= pos.stop_loss:
                    # SL hit - exit at stop loss price
                    exit_triggered = True
                    exit_price = pos.stop_loss
                    exit_reason = 'SL'
                    console.print(f"[red]🔴 {symbol} SL hit! Low ₹{candle_low:.2f} <= SL ₹{pos.stop_loss:.2f}[/red]")
                elif candle_high >= pos.take_profit:
                    # TP hit - exit at take profit price
                    exit_triggered = True
                    exit_price = pos.take_profit
                    exit_reason = 'TP'
                    console.print(f"[green]🟢 {symbol} TP hit! High ₹{candle_high:.2f} >= TP ₹{pos.take_profit:.2f}[/green]")

            # For SHORT positions: SL above candle high, TP below candle low
            elif pos.side.value == 'SELL':
                if candle_high >= pos.stop_loss:
                    # SL hit - exit at stop loss price
                    exit_triggered = True
                    exit_price = pos.stop_loss
                    exit_reason = 'SL'
                    console.print(f"[red]🔴 {symbol} SL hit! High ₹{candle_high:.2f} >= SL ₹{pos.stop_loss:.2f}[/red]")
                elif candle_low <= pos.take_profit:
                    # TP hit - exit at take profit price
                    exit_triggered = True
                    exit_price = pos.take_profit
                    exit_reason = 'TP'
                    console.print(f"[green]🟢 {symbol} TP hit! Low ₹{candle_low:.2f} <= TP ₹{pos.take_profit:.2f}[/green]")

            if exit_triggered:
                # Close position manually
                from trading.paper_trader import ExitReason
                exit_reason_enum = ExitReason.TAKE_PROFIT if exit_reason == 'TP' else ExitReason.STOP_LOSS
                trade = self.trader.close_position(symbol, exit_price, exit_reason_enum)

                if trade:
                    # Log to journal
                    self.journal.log_trade({
                        'trade_id': trade.trade_id,
                        'symbol': trade.symbol,
                        'side': trade.side.value,
                        'quantity': trade.quantity,
                        'entry_price': trade.entry_price,
                        'exit_price': trade.exit_price,
                        'entry_time': trade.entry_time.isoformat(),
                        'exit_time': trade.exit_time.isoformat(),
                        'pnl': trade.pnl,
                        'pnl_pct': trade.pnl_pct,
                        'exit_reason': trade.exit_reason.value,
                        'costs': trade.costs,
                        'net_pnl': trade.net_pnl,
                        'sl_price': pos.stop_loss,
                        'tp_price': pos.take_profit,
                    })
                    console.print(f"[green]📝 Logged trade to journal: {symbol} ({exit_reason})[/green]")
                    # Save journal to disk
                    self.journal.save_journal()

        # Check force exit time
        if self.is_force_exit_time():
            console.print("\n[yellow]Force exit time reached. Closing all positions...[/yellow]")
            current_prices = {s: d['close'] for s, d in price_data.items()}
            self.trader.close_all_positions(current_prices)
            # Add all to cooldown
            for symbol in positions_before:
                self.cooldown_stocks[symbol] = datetime.now()
            return

        # Update position prices for display (using close)
        current_prices = {s: d['close'] for s, d in price_data.items()}
        if current_prices:
            self.trader.update_prices(current_prices)

        # Track positions after update - add closed positions to cooldown
        positions_after = set(self.trader.positions.keys())
        closed_positions = positions_before - positions_after

        for symbol in closed_positions:
            self.cooldown_stocks[symbol] = datetime.now()
            console.print(f"[yellow]⏳ {symbol} added to 30-min cooldown[/yellow]")

            # Log any new closed trades to journal
            if trades_after > trades_before:
                new_trades = self.trader.trades[trades_before:]
                for trade in new_trades:
                    self.journal.log_trade({
                        'trade_id': trade.trade_id,
                        'symbol': trade.symbol,
                        'side': trade.side.value,
                        'quantity': trade.quantity,
                        'entry_price': trade.entry_price,
                        'exit_price': trade.exit_price,
                        'entry_time': trade.entry_time.isoformat(),
                        'exit_time': trade.exit_time.isoformat(),
                        'pnl': trade.pnl,
                        'pnl_pct': trade.pnl_pct,
                        'exit_reason': trade.exit_reason.value,
                        'costs': trade.costs,
                        'net_pnl': trade.net_pnl,
                        'sl_price': 0,  # Not stored in PaperTrade
                        'tp_price': 0,  # Not stored in PaperTrade
                    })
                    console.print(f"[green]📝 Logged trade to journal: {trade.symbol} ({trade.exit_reason.value})[/green]")

        # Track positions after update - add closed positions to cooldown
        positions_after = set(self.trader.positions.keys())
        closed_positions = positions_before - positions_after

        for symbol in closed_positions:
            self.cooldown_stocks[symbol] = datetime.now()
            console.print(f"[yellow]⏳ {symbol} added to 30-min cooldown[/yellow]")

    def display_status(self):
        """Display current trading status."""
        portfolio = self.trader.get_portfolio_status()

        # Create status panel
        status_table = Table.grid()
        status_table.add_column("Metric", style="cyan")
        status_table.add_column("Value", justify="right")

        status_table.add_row("Time", datetime.now().strftime("%H:%M:%S"))
        status_table.add_row("Market Status", "OPEN" if self.is_market_open() else "CLOSED")
        status_table.add_row("Trading Hours", "YES" if self.is_trading_hours() else "NO")
        status_table.add_row("Capital", f"₹{portfolio['total_value']:,.0f}")
        status_table.add_row("Cash", f"₹{portfolio['cash']:,.0f}")
        status_table.add_row("Positions", f"{portfolio['positions']}/{self.max_positions}")
        status_table.add_row("Daily P&L", f"₹{portfolio['daily_pnl']:,.0f}")
        status_table.add_row("Trades Today", str(portfolio['daily_trades']))

        console.print(Panel(status_table, title="Trading Status", border_style="cyan"))

        # Show positions if any
        if self.trader.positions:
            pos_table = Table(title="Open Positions")
            pos_table.add_column("Symbol")
            pos_table.add_column("Side")
            pos_table.add_column("Qty", justify="right")
            pos_table.add_column("Entry", justify="right")
            pos_table.add_column("Current", justify="right")
            pos_table.add_column("P&L", justify="right")
            pos_table.add_column("SL/TP", justify="right")

            for symbol, pos in self.trader.positions.items():
                pnl_color = "green" if pos.unrealized_pnl >= 0 else "red"
                pos_table.add_row(
                    symbol,
                    pos.side.value,
                    str(pos.quantity),
                    f"₹{pos.entry_price:.2f}",
                    f"₹{pos.current_price:.2f}",
                    f"[{pnl_color}]₹{pos.unrealized_pnl:,.0f}[/{pnl_color}]",
                    f"₹{pos.stop_loss:.2f}/₹{pos.take_profit:.2f}",
                )

            console.print(pos_table)

    def run(self, interval: int = 60):
        """
        Run the daily trading loop.

        Args:
            interval: Seconds between scan cycles
        """
        console.print(Panel.fit(
            "[bold cyan]ORB Daily Trading Runner[/bold cyan]\n"
            f"Mode: {'TEST' if self.test_mode else 'LIVE'}\n"
            f"Capital: ₹{self.capital:,.0f}\n"
            f"Max Positions: {self.max_positions}",
            border_style="green"
        ))

        # Initial setup
        self.refresh_watchlist()

        # Main loop
        cycle = 0
        while self.running:
            cycle += 1

            try:
                console.print(f"\n[dim]--- Cycle {cycle} @ {datetime.now().strftime('%H:%M:%S')} ---[/dim]")

                # Check market status
                if not self.is_market_open():
                    console.print("[yellow]Market closed. Waiting...[/yellow]")
                    time.sleep(interval)
                    continue

                # Refresh watchlist periodically
                if cycle % 10 == 0:  # Every 10 cycles
                    self.refresh_watchlist()

                # Scan for signals
                signals = self.scan_for_signals()
                if signals:
                    console.print(f"\n[green]Found {len(signals)} new signals![/green]")
                    for sig in signals:
                        console.print(f"  {sig.signal_type.value} {sig.symbol} @ ₹{sig.price:.2f}")
                        console.print(f"    SL: ₹{sig.stop_loss:.2f} | TP: ₹{sig.take_profit:.2f}")

                        # Execute signal
                        self.execute_signal(sig)

                # Monitor positions
                self.monitor_positions()

                # Display status
                self.display_status()

                # Wait for next cycle
                if self.running and not self.is_force_exit_time():
                    console.print(f"\n[dim]Waiting {interval}s until next scan...[/dim]")
                    time.sleep(interval)

            except Exception as e:
                console.print(f"[red]Error in cycle {cycle}: {e}[/red]")
                time.sleep(5)

        # Final status
        console.print("\n[bold]Trading stopped. Final status:[/bold]")
        self.trader.display_status()
        self.journal.display_summary()

        # Save journal
        self.journal.save_journal()


def main():
    parser = argparse.ArgumentParser(description='Daily ORB Trading Runner')
    parser.add_argument('--test', action='store_true', help='Test mode (no real trades)')
    parser.add_argument('--force-signals', action='store_true', help='Force generate test signals')
    parser.add_argument('--status', action='store_true', help='Just show current status')
    parser.add_argument('--capital', type=float, default=1_000_000, help='Initial capital')
    parser.add_argument('--positions', type=int, default=5, help='Max positions')
    parser.add_argument('--interval', type=int, default=60, help='Scan interval in seconds')

    args = parser.parse_args()

    runner = DailyTradingRunner(
        capital=args.capital,
        max_positions=args.positions,
        test_mode=args.test,
        force_signals=args.force_signals,
    )

    if args.status:
        runner.display_status()
        return

    runner.run(interval=args.interval)


if __name__ == '__main__':
    main()
