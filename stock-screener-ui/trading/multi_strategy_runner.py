"""
Multi-Strategy Runner - Orchestrates multiple trading strategies in parallel.

This module provides:
- Parallel execution of multiple strategies
- Shared portfolio management
- Cross-strategy risk coordination
- Unified signal generation and execution
"""

import sys
import signal
import json
import asyncio
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional

import config
IST = config.IST
from dataclasses import dataclass, field
from enum import Enum
import traceback

INTRADAY_STRATEGY_TYPES = {"ORB", "SR_BREAKOUT", "EMA_CROSS"}
SWING_STRATEGY_TYPES = {"52W_CHASER", "52W_TARGET"}

# Add project paths
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'scanners'))

from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.live import Live

console = Console()

# Import trading components
from trading.shared_portfolio import SharedPortfolioManager, OrderSide
from trading.global_risk_manager import GlobalRiskManager
from trading.orb_signals import ORBSignalGenerator, ORBSignal, SignalType, create_entry_signal
from trading.sr_breakout_signals import SRBreakoutSignalGenerator
from trading.week52_chaser_signals import Week52ChaserSignalGenerator
from trading.week52_target_signals import Week52TargetSignalGenerator
from trading.ema_cross_signals import EMACrossSignalGenerator
from trading.journal import TradeJournal, get_journal
from trading.telegram_notifier import (
    send_trade_entry,
    send_trade_exit,
    send_bot_status,
    send_daily_summary,
    send_risk_alert,
    send_signal_rejected,
)

# Database imports
try:
    from db.database import SessionLocal
    from db.models import BotConfig, StrategyConfig, bot_strategies
    _db_available = True
except ImportError:
    _db_available = False


@dataclass
class StrategyRunner:
    """Configuration for a single strategy within the multi-strategy runner."""
    strategy_id: int
    strategy_name: str
    strategy_type: str
    config: dict  # StrategyConfig.to_dict()
    max_positions: int
    capital_allocation_pct: float
    signal_generator: Optional[ORBSignalGenerator] = None
    status: str = "pending"  # pending, running, paused, stopped
    last_scan_time: Optional[datetime] = None
    last_scan_items: List = field(default_factory=list)  # Scan items for UI
    signals_generated: int = 0
    trades_executed: int = 0

    def __post_init__(self):
        """Initialize signal generator based on strategy type."""
        if self.strategy_type == "ORB":
            self.signal_generator = ORBSignalGenerator(
                or_minutes=self.config.get('or_minutes', 45),
                sl_pct=self.config.get('sl_pct', 0.4),
                tp_pct=self.config.get('tp_pct', 1.2),
                min_or_range_pct=self.config.get('min_or_range_pct', 0.5),
                max_or_range_pct=self.config.get('max_or_range_pct', 3.0),
            )
        elif self.strategy_type == "SR_BREAKOUT":
            self.signal_generator = SRBreakoutSignalGenerator(self.config)
        elif self.strategy_type == "52W_CHASER":
            self.signal_generator = Week52ChaserSignalGenerator(self.config)
        elif self.strategy_type == "52W_TARGET":
            self.signal_generator = Week52TargetSignalGenerator(self.config)
        elif self.strategy_type == "EMA_CROSS":
            self.signal_generator = EMACrossSignalGenerator(self.config)
        else:
            console.print(f"[yellow]Unknown strategy type '{self.strategy_type}', using ORB generator as fallback[/yellow]")
            self.signal_generator = ORBSignalGenerator()


class MultiStrategyRunner:
    """
    Main orchestrator for running multiple trading strategies in parallel.

    Features:
    - Loads strategies from bot_strategies table
    - Creates separate signal generators per strategy
    - Runs scan loop for all strategies
    - Coordinates signal execution through shared portfolio
    - Enforces global and per-strategy risk limits
    """

    # Market timings (IST)
    PRE_MARKET = (9, 0)
    MARKET_OPEN = (9, 15)
    OR_END = (10, 0)
    FORCE_EXIT = (15, 30)  # 3:30 PM - market close
    MARKET_CLOSE = (15, 30)

    def __init__(
        self,
        bot_config_id: int = None,
        bot_config: BotConfig = None,
        user_id: int = None,
        initial_capital: float = 1_000_000,
        test_mode: bool = False,
    ):
        """
        Initialize multi-strategy runner.

        Args:
            bot_config_id: Database ID of BotConfig to load
            bot_config: BotConfig object (alternative to bot_config_id)
            user_id: User ID for multi-user support
            initial_capital: Initial capital (overrides user setting)
            test_mode: If True, don't execute actual trades
        """
        self.user_id = user_id
        self.test_mode = test_mode
        self.running = False
        self.bot_config_id = bot_config_id

        # Load bot configuration
        if bot_config is not None:
            self.bot_config = bot_config
        elif bot_config_id is not None and _db_available:
            self.bot_config = self._load_bot_config(bot_config_id)
        else:
            raise ValueError("Either bot_config_id or bot_config must be provided")

        # Initialize shared portfolio
        self.portfolio = SharedPortfolioManager(
            initial_capital=initial_capital,
            max_total_capital_pct=self.bot_config.max_total_capital_pct,
            max_total_positions=self.bot_config.max_total_positions,
            user_id=user_id,
        )

        # Initialize global risk manager
        self.risk_manager = GlobalRiskManager(
            max_total_positions=self.bot_config.max_total_positions,
            max_total_capital_pct=self.bot_config.max_total_capital_pct,
        )

        # State tracking
        self.watchlist = []
        self.or_levels = {}
        self.cooldown_stocks: Dict[str, datetime] = {}  # {symbol: exit_time}
        self.snapshot_file = Path(f"/tmp/multi-strategy-bot-{self.user_id}-{self.bot_config.id}.json")

        # Initialize strategies
        self.strategies: Dict[int, StrategyRunner] = {}
        self._load_strategies()

        # Attempt to recover state from snapshot
        self.load_snapshot()

        # Trading journal
        self.journal = get_journal(user_id)



        # Data fetcher (lazy loaded)
        self._screener = None
        self._data_fetcher = None

        # Telegram daily summary tracking
        self._daily_summary_sent = False

        # Setup signal handler
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)

    def _load_bot_config(self, bot_id: int) -> BotConfig:
        """Load bot configuration from database."""
        with SessionLocal() as db:
            bot = db.query(BotConfig).filter(BotConfig.id == bot_id).first()
            if not bot:
                raise ValueError(f"Bot config {bot_id} not found")
            return bot

    def _load_strategies(self):
        """Load strategies from bot_strategies association table."""
        if not _db_available:
            console.print("[red]Database not available, cannot load strategies[/red]")
            return

        with SessionLocal() as db:
            # Query bot_strategies to get allocation info
            result = db.execute(
                bot_strategies.select().where(bot_strategies.c.bot_id == self.bot_config.id)
            ).fetchall()

            for row in result:
                strategy_id = row.strategy_id
                max_positions = row.max_positions
                capital_allocation_pct = row.capital_allocation_pct

                # Load full strategy config
                strategy = db.query(StrategyConfig).filter(StrategyConfig.id == strategy_id).first()
                if not strategy:
                    console.print(f"[yellow]Strategy {strategy_id} not found, skipping[/yellow]")
                    continue

                # Create strategy runner
                runner = StrategyRunner(
                    strategy_id=strategy.id,
                    strategy_name=strategy.name,
                    strategy_type=strategy.strategy_type,
                    config=strategy.to_dict(),
                    max_positions=max_positions,
                    capital_allocation_pct=capital_allocation_pct,
                )

                self.strategies[strategy.id] = runner

                # Configure portfolio allocation
                self.portfolio.set_strategy_allocation(
                    strategy_id=strategy.id,
                    strategy_name=strategy.name,
                    allocation_pct=capital_allocation_pct,
                    max_positions=max_positions,
                )

        console.print(f"[green]Loaded {len(self.strategies)} strategies for bot '{self.bot_config.name}'[/green]")

    def _signal_handler(self, signum, frame):
        """Handle shutdown signals."""
        console.print("\n[yellow]Shutdown signal received. Stopping all strategies...[/yellow]")
        self.running = False

    def _get_screener(self):
        """Lazy load screener."""
        if self._screener is None:
            try:
                from orb_stock_screener import ORBStockScreener
                self._screener = ORBStockScreener(use_relaxed=True)
            except ImportError:
                console.print("[red]Could not import ORBStockScreener[/red]")
        return self._screener

    def _get_data_fetcher(self):
        """Lazy load data fetcher."""
        if self._data_fetcher is None:
            try:
                from upstox_trader.screeners.tv_screen_usage import TVScreenerUsage
                self._data_fetcher = TVScreenerUsage(enable_paper_trading=False)
            except ImportError:
                console.print("[red]Could not import TVScreenerUsage[/red]")
        return self._data_fetcher

    def _ist_now(self) -> datetime:
        return datetime.now(IST)

    def _get_db_session(self):
        from db.database import SessionLocal
        return SessionLocal()

    def _write_heartbeat(self):
        try:
            from cache.redis_client import get_redis_client
            client = get_redis_client()
            if client is not None:
                import os
                pid = os.getpid()
                bot_id = self.bot_config.id if self.bot_config else 0
                client.setex(f"bot:{self.user_id}:{bot_id}:status", 90, f"running:{pid}")
        except Exception:
            pass

    def _clear_heartbeat(self):
        try:
            from cache.redis_client import get_redis_client
            client = get_redis_client()
            if client is not None:
                bot_id = self.bot_config.id if self.bot_config else 0
                client.delete(f"bot:{self.user_id}:{bot_id}:status")
        except Exception:
            pass

    def _persist_trade_to_db(self, trade_data: dict):
        try:
            db = self._get_db_session()
            try:
                from db.models import Trade
                trade = Trade(
                    user_id=self.user_id,
                    bot_id=self.bot_config.id if self.bot_config else 0,
                    strategy_id=trade_data.get('strategy_id', 0),
                    strategy_name=trade_data.get('strategy_name', ''),
                    symbol=trade_data['symbol'],
                    side=trade_data['side'],
                    quantity=trade_data['quantity'],
                    entry_price=trade_data['entry_price'],
                    exit_price=trade_data.get('exit_price'),
                    entry_time=trade_data['entry_time'] if isinstance(trade_data['entry_time'], datetime) else datetime.fromisoformat(trade_data['entry_time']),
                    exit_time=trade_data.get('exit_time'),
                    stop_loss=trade_data.get('stop_loss', 0.0),
                    take_profit=trade_data.get('take_profit', 0.0),
                    pnl=trade_data.get('pnl', 0.0),
                    pnl_pct=trade_data.get('pnl_pct', 0.0),
                    costs=trade_data.get('costs', 0.0),
                    net_pnl=trade_data.get('net_pnl', 0.0),
                    exit_reason=trade_data.get('exit_reason', ''),
                    is_test=self.test_mode,
                    source='live' if not self.test_mode else 'test',
                )
                db.add(trade)
                db.commit()
            except Exception as e:
                db.rollback()
                console.print(f"[yellow]DB trade persist failed: {e}[/yellow]")
            finally:
                db.close()
        except Exception:
            pass

    def _persist_position_to_db(self, pos_data: dict, action: str = "upsert"):
        try:
            db = self._get_db_session()
            try:
                from db.models import Position
                from sqlalchemy import text
                if action == "delete":
                    db.execute(
                        text("DELETE FROM positions WHERE bot_id = :bot_id AND strategy_id = :strategy_id AND symbol = :symbol"),
                        {"bot_id": self.bot_config.id if self.bot_config else 0, "strategy_id": pos_data.get('strategy_id', 0), "symbol": pos_data['symbol']}
                    )
                    db.commit()
                else:
                    existing = db.query(Position).filter(
                        Position.bot_id == (self.bot_config.id if self.bot_config else 0),
                        Position.strategy_id == pos_data.get('strategy_id', 0),
                        Position.symbol == pos_data['symbol'],
                    ).first()
                    if existing:
                        existing.quantity = pos_data['quantity']
                        existing.current_price = pos_data.get('current_price', 0.0)
                        existing.stop_loss = pos_data.get('stop_loss', 0.0)
                        existing.take_profit = pos_data.get('take_profit', 0.0)
                        existing.unrealized_pnl = pos_data.get('unrealized_pnl', 0.0)
                        existing.unrealized_pnl_pct = pos_data.get('unrealized_pnl_pct', 0.0)
                    else:
                        position = Position(
                            user_id=self.user_id,
                            bot_id=self.bot_config.id if self.bot_config else None,
                            strategy_id=pos_data.get('strategy_id', 0),
                            strategy_name=pos_data.get('strategy_name', ''),
                            symbol=pos_data['symbol'],
                            side=pos_data['side'],
                            quantity=pos_data['quantity'],
                            entry_price=pos_data['entry_price'],
                            stop_loss=pos_data.get('stop_loss', 0.0),
                            take_profit=pos_data.get('take_profit', 0.0),
                            entry_time=pos_data['entry_time'] if isinstance(pos_data['entry_time'], datetime) else datetime.fromisoformat(pos_data['entry_time']),
                            current_price=pos_data.get('current_price', 0.0),
                            is_test=self.test_mode,
                        )
                        db.add(position)
                    db.commit()
            except Exception as e:
                db.rollback()
                console.print(f"[yellow]DB position persist failed: {e}[/yellow]")
            finally:
                db.close()
        except Exception:
            pass

    def _load_positions_from_db(self):
        try:
            db = self._get_db_session()
            try:
                from db.models import Position
                positions = db.query(Position).filter(
                    Position.bot_id == (self.bot_config.id if self.bot_config else 0),
                ).all()
                if positions:
                    restored = 0
                    for p in positions:
                        try:
                            pos_data = {
                                'strategy_id': p.strategy_id or 0,
                                'strategy_name': p.strategy_name or '',
                                'symbol': p.symbol,
                                'side': p.side,
                                'quantity': p.quantity,
                                'entry_price': p.entry_price,
                                'stop_loss': p.stop_loss or 0.0,
                                'take_profit': p.take_profit or 0.0,
                                'entry_time': p.entry_time.isoformat() if p.entry_time else None,
                                'current_price': p.current_price or p.entry_price,
                                'peak_price': p.entry_price,
                                'low_price': p.entry_price,
                            }
                            self.portfolio.restore_position(pos_data)
                            restored += 1
                        except Exception as e:
                            console.print(f"[yellow]Failed to restore position {p.symbol}: {e}[/yellow]")
                    if restored > 0:
                        console.print(f"[green]Restored {restored} positions from database[/green]")
            finally:
                db.close()
        except Exception:
            pass

    def is_market_open(self) -> bool:
        now = self._ist_now()
        open_time = datetime(now.year, now.month, now.day, *self.MARKET_OPEN, tzinfo=IST)
        close_time = datetime(now.year, now.month, now.day, *self.MARKET_CLOSE, tzinfo=IST)
        return open_time <= now <= close_time

    def is_trading_hours(self) -> bool:
        now = self._ist_now()
        or_end = datetime(now.year, now.month, now.day, *self.OR_END, tzinfo=IST)
        force_exit = datetime(now.year, now.month, now.day, *self.FORCE_EXIT, tzinfo=IST)
        return or_end <= now <= force_exit

    def is_force_exit_time(self) -> bool:
        now = self._ist_now()
        return now.hour >= self.FORCE_EXIT[0] and now.minute >= self.FORCE_EXIT[1]

    # Default fallback watchlist (F&O stocks commonly traded)
    DEFAULT_WATCHLIST = [
        "RELIANCE", "TCS", "HDFC", "INFY", "ICICIBANK", "HDFCBANK", "SBIN",
        "BHARTIARTL", "ITC", "KOTAKBANK", "LT", "AXISBANK", "BAJFINANCE",
        "MARUTI", "ASIANPAINT", "HCLTECH", "SUNPHARMA", "TITAN", "WIPRO",
        "ULTRACEMCO"
    ]

    def refresh_watchlist(self):
        """Refresh watchlist from screener (shared across all strategies)."""
        console.print("\n[cyan]Refreshing shared watchlist from screener...[/cyan]")

        screener = self._get_screener()
        if not screener:
            console.print("[red]Screener not available - using default watchlist[/red]")
            if not self.watchlist:
                self.watchlist = self.DEFAULT_WATCHLIST.copy()
            return

        try:
            df = screener.screen(limit=50, verify_nse=True)

            if df.empty:
                console.print("[yellow]No stocks from screener - using default watchlist[/yellow]")
                if not self.watchlist:
                    self.watchlist = self.DEFAULT_WATCHLIST.copy()
                return

            self.watchlist = df['name'].tolist()[:20]  # Top 20 stocks
            console.print(f"[green]Watchlist updated: {len(self.watchlist)} stocks[/green]")

            # Display watchlist
            table = Table(title="Shared ORB Watchlist")
            table.add_column("#", width=3)
            table.add_column("Symbol")
            table.add_column("Price", justify="right")

            for i, (_, row) in enumerate(df.head(20).iterrows(), 1):
                table.add_row(
                    str(i),
                    row['name'],
                    f"₹{row['close']:.0f}",
                )

            console.print(table)

        except Exception as e:
            console.print(f"[red]Error refreshing watchlist: {e}[/red]")
            if not self.watchlist:
                console.print("[yellow]Using default watchlist[/yellow]")
                self.watchlist = self.DEFAULT_WATCHLIST.copy()

    def fetch_or_data(self, symbol: str) -> Optional[dict]:
        """Fetch opening range data for a symbol."""
        try:
            fetcher = self._get_data_fetcher()
            if not fetcher:
                return None

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

            orb_runner = next(
                (r for r in self.strategies.values() if r.strategy_type == "ORB"),
                None,
            )
            if orb_runner and orb_runner.signal_generator:
                or_levels = orb_runner.signal_generator.calculate_or_levels(candles)
                if or_levels and candles:
                    or_levels['latest_price'] = candles[-1]['close']
                    or_levels['latest_high'] = candles[-1]['high']
                    or_levels['latest_low'] = candles[-1]['low']
                return or_levels

            return None

        except Exception as e:
            console.print(f"[dim red]Error fetching OR for {symbol}: {e}[/dim red]")
            return None

    def fetch_daily_data(self, symbol: str) -> Optional[dict]:
        """Fetch daily OHLCV data for a symbol (used by swing strategies)."""
        try:
            fetcher = self._get_data_fetcher()
            if not fetcher:
                return None

            from datetime import timedelta as td
            to_date = datetime.now(IST).strftime('%Y-%m-%d')
            from_date = (datetime.now(IST) - td(days=400)).strftime('%Y-%m-%d')

            df = fetcher.upstox_api.fetch_historical_data_v3(
                symbol=symbol,
                unit='days',
                interval=1,
                to_date=to_date,
                from_date=from_date,
            )

            if df is None or df.empty:
                return None

            closes = df['close'].tolist()
            highs = df['high'].tolist()
            lows = df['low'].tolist()
            volumes = df['volume'].tolist() if 'volume' in df.columns else []

            window_252_highs = highs[-252:] if len(highs) >= 252 else highs
            high_52w = max(window_252_highs) if window_252_highs else 0.0

            avg_volume_20d = 0.0
            if len(volumes) >= 20:
                avg_volume_20d = sum(volumes[-20:]) / 20

            ma50 = 0.0
            ma200 = 0.0
            if len(closes) >= 50:
                ma50 = sum(closes[-50:]) / 50
            if len(closes) >= 200:
                ma200 = sum(closes[-200:]) / 200

            return {
                'current_price': closes[-1],
                'high_52w': high_52w,
                'daily_highs': highs,
                'daily_closes': closes,
                'volume': volumes[-1] if volumes else 0.0,
                'avg_volume_20d': avg_volume_20d,
                'ma50': ma50,
                'ma200': ma200,
                'prev_high': highs[-2] if len(highs) >= 2 else highs[-1],
                'prev_low': lows[-2] if len(lows) >= 2 else lows[-1],
                'prev_close': closes[-2] if len(closes) >= 2 else closes[-1],
            }

        except Exception as e:
            console.print(f"[dim red]Error fetching daily data for {symbol}: {e}[/dim red]")
            return None

    def fetch_previous_day_data(self, symbol: str) -> Optional[dict]:
        """Fetch previous day's HLC for pivot point calculation."""
        try:
            fetcher = self._get_data_fetcher()
            if not fetcher:
                return None

            from datetime import timedelta as td
            to_date = datetime.now(IST).strftime('%Y-%m-%d')
            from_date = (datetime.now(IST) - td(days=10)).strftime('%Y-%m-%d')

            df = fetcher.upstox_api.fetch_historical_data_v3(
                symbol=symbol,
                unit='days',
                interval=1,
                to_date=to_date,
                from_date=from_date,
            )

            if df is None or df.empty or len(df) < 2:
                return None

            prev_row = df.iloc[-2]
            current_price = df.iloc[-1]['close']

            return {
                'current_price': current_price,
                'prev_high': prev_row['high'],
                'prev_low': prev_row['low'],
                'prev_close': prev_row['close'],
            }

        except Exception as e:
            console.print(f"[dim red]Error fetching prev day data for {symbol}: {e}[/dim red]")
            return None

    def fetch_ema_data(self, symbol: str, ema_fast_period: int = 9, ema_slow_period: int = 21) -> Optional[dict]:
        """Fetch intraday data and compute EMA crossover state for a symbol."""
        try:
            fetcher = self._get_data_fetcher()
            if not fetcher:
                return None

            df = fetcher.upstox_api.fetch_intraday_data_v3(
                symbol=symbol,
                interval='5',
            )

            if df is None or df.empty:
                return None

            closes = df['close'].tolist()
            if len(closes) < ema_slow_period + 2:
                return None

            ema_fast = EMACrossSignalGenerator.calculate_ema(closes, ema_fast_period)
            ema_slow = EMACrossSignalGenerator.calculate_ema(closes, ema_slow_period)

            if len(ema_fast) < 2 or len(ema_slow) < 2:
                return None

            current_price = closes[-1]
            ema_fast_current = ema_fast[-1]
            ema_fast_prev = ema_fast[-2]
            ema_slow_current = ema_slow[-1]
            ema_slow_prev = ema_slow[-2]

            return {
                'current_price': current_price,
                'ema_fast_current': round(ema_fast_current, 2),
                'ema_fast_prev': round(ema_fast_prev, 2),
                'ema_slow_current': round(ema_slow_current, 2),
                'ema_slow_prev': round(ema_slow_prev, 2),
                'closes': closes,
            }

        except Exception as e:
            console.print(f"[dim red]Error fetching EMA data for {symbol}: {e}[/dim red]")
            return None

    def scan_for_signals(self, strategy_id: int) -> list:
        """
        Scan watchlist for signals for a specific strategy.

        Dispatches to the appropriate scan method based on strategy type.
        """
        runner = self.strategies.get(strategy_id)
        if not runner or runner.status != "running":
            return []

        if runner.strategy_type in INTRADAY_STRATEGY_TYPES:
            return self._scan_intraday_strategy(strategy_id)
        elif runner.strategy_type in SWING_STRATEGY_TYPES:
            return self._scan_swing_strategy(strategy_id)
        else:
            return self._scan_intraday_strategy(strategy_id)

    def _scan_intraday_strategy(self, strategy_id: int) -> list:
        """Scan for signals using intraday data (ORB, SR_BREAKOUT)."""
        runner = self.strategies.get(strategy_id)
        if not runner or runner.status != "running":
            return []

        if not self.is_trading_hours():
            return []

        new_signals = []
        scan_items = []

        for symbol in self.watchlist:
            key = f"{strategy_id}_{symbol}"
            if key in self.portfolio.positions:
                continue

            if symbol in self.cooldown_stocks:
                exit_time = self.cooldown_stocks[symbol]
                cooldown_end = exit_time + timedelta(minutes=runner.config.get('cooldown_minutes', 30))
                if datetime.now(IST) < cooldown_end:
                    continue
                else:
                    del self.cooldown_stocks[symbol]

            if runner.strategy_type == "SR_BREAKOUT":
                prev_data = self.fetch_previous_day_data(symbol)
                if not prev_data:
                    continue

                live_price = None
                try:
                    fetcher = self._get_data_fetcher()
                    if fetcher:
                        df_1m = fetcher.upstox_api.fetch_intraday_data_v3(symbol=symbol, interval='1')
                        if df_1m is not None and not df_1m.empty:
                            live_price = float(df_1m.iloc[-1]['close'])
                except Exception:
                    pass

                if live_price is None:
                    continue

                gen = runner.signal_generator
                pivot_points = gen.calculate_pivot_points(
                    prev_data['prev_high'], prev_data['prev_low'], prev_data['prev_close']
                )

                market_data = {
                    'current_price': live_price,
                    'pivot_points': pivot_points,
                }

                signal = gen.check_entry(symbol, market_data)

                scan_item = {
                    'symbol': symbol,
                    'price': live_price,
                    'status': 'watching',
                    'side': None,
                    'reason': None,
                }

            elif runner.strategy_type == "EMA_CROSS":
                ema_data = self.fetch_ema_data(
                    symbol,
                    runner.config.get('ema_fast_period', 9),
                    runner.config.get('ema_slow_period', 21),
                )
                if not ema_data:
                    continue

                signal = runner.signal_generator.check_entry(symbol, ema_data)

                scan_item = {
                    'symbol': symbol,
                    'price': ema_data.get('current_price', 0),
                    'status': 'watching',
                    'side': None,
                    'reason': None,
                }

            else:
                or_levels = self.fetch_or_data(symbol)
                if not or_levels:
                    continue

                self.or_levels[symbol] = or_levels

                current_price = or_levels.get('latest_price', or_levels['or_close'])
                or_high = or_levels['or_high']
                or_low = or_levels['or_low']
                or_range_pct = or_levels.get('or_range_pct', 0)

                scan_item = {
                    'symbol': symbol,
                    'price': current_price,
                    'or_high': or_high,
                    'or_low': or_low,
                    'or_range_pct': or_range_pct,
                    'status': 'watching',
                    'side': None,
                    'reason': None,
                }

                min_or_pct = runner.signal_generator.min_or_range_pct
                max_or_pct = runner.signal_generator.max_or_range_pct

                if or_range_pct < min_or_pct or or_range_pct > max_or_pct:
                    scan_item['status'] = 'skipped'
                    scan_item['reason'] = f'OR range {or_range_pct:.2f}% outside [{min_or_pct}-{max_or_pct}]%'
                    scan_items.append(scan_item)
                    continue

                signal = runner.signal_generator.check_breakout(
                    symbol=symbol,
                    current_price=current_price,
                    or_levels=or_levels,
                )

            if signal:
                max_distance = runner.config.get('max_distance_from_or_pct', 1.5)

                if signal.signal_type == SignalType.LONG_ENTRY:
                    if runner.strategy_type == "ORB":
                        day_open = or_levels.get('or_open', current_price)
                        day_change_pct = ((current_price - day_open) / day_open) * 100 if day_open > 0 else 0
                        if day_change_pct > 2.0:
                            scan_item['status'] = 'skipped'
                            scan_item['reason'] = f'Day already up {day_change_pct:.1f}%'
                            scan_items.append(scan_item)
                            continue

                    scan_item['status'] = 'signal'
                    scan_item['side'] = 'LONG'
                    scan_item['reason'] = signal.notes

                elif signal.signal_type == SignalType.SHORT_ENTRY:
                    if runner.strategy_type == "ORB":
                        day_open = or_levels.get('or_open', current_price)
                        day_change_pct = ((current_price - day_open) / day_open) * 100 if day_open > 0 else 0
                        if day_change_pct > 1.0:
                            scan_item['status'] = 'skipped'
                            scan_item['reason'] = f'Uptrend, skip SHORT'
                            scan_items.append(scan_item)
                            continue

                    scan_item['status'] = 'signal'
                    scan_item['side'] = 'SHORT'
                    scan_item['reason'] = signal.notes

                new_signals.append(signal)
                runner.signals_generated += 1
                console.print(f"[green]✓ {runner.strategy_name}: Signal {signal.signal_type.value} {signal.symbol} @ ₹{signal.price:.2f}[/green]")

            scan_items.append(scan_item)

        runner.last_scan_items = scan_items
        runner.last_scan_time = datetime.now(IST)
        return new_signals

    def _scan_swing_strategy(self, strategy_id: int) -> list:
        """Scan for signals using daily data (52W_CHASER, 52W_TARGET)."""
        runner = self.strategies.get(strategy_id)
        if not runner or runner.status != "running":
            return []

        if not self.is_market_open():
            return []

        new_signals = []
        scan_items = []

        for symbol in self.watchlist:
            key = f"{strategy_id}_{symbol}"
            if key in self.portfolio.positions:
                continue

            if symbol in self.cooldown_stocks:
                exit_time = self.cooldown_stocks[symbol]
                cooldown_days = runner.config.get('cooldown_days', 30)
                cooldown_end = exit_time + timedelta(days=cooldown_days)
                if datetime.now(IST) < cooldown_end:
                    continue
                else:
                    del self.cooldown_stocks[symbol]

            daily_data = self.fetch_daily_data(symbol)
            if not daily_data:
                continue

            market_data = {
                'current_price': daily_data['current_price'],
                'high_52w': daily_data['high_52w'],
                'daily_highs': daily_data['daily_highs'],
                'volume': daily_data['volume'],
                'avg_volume_20d': daily_data['avg_volume_20d'],
                'ma50': daily_data['ma50'],
                'ma200': daily_data['ma200'],
            }

            signal = runner.signal_generator.check_entry(symbol, market_data)

            scan_item = {
                'symbol': symbol,
                'price': daily_data['current_price'],
                'high_52w': daily_data['high_52w'],
                'status': 'watching',
                'side': None,
                'reason': None,
            }

            if signal:
                scan_item['status'] = 'signal'
                scan_item['side'] = 'LONG'
                scan_item['reason'] = signal.notes

                new_signals.append(signal)
                runner.signals_generated += 1
                console.print(f"[green]✓ {runner.strategy_name}: Signal {signal.signal_type.value} {symbol} @ ₹{signal.price:.2f}[/green]")
            else:
                distance_pct = ((daily_data['high_52w'] - daily_data['current_price']) / daily_data['current_price']) * 100 if daily_data['current_price'] > 0 else 0
                scan_item['status'] = 'skipped'
                scan_item['reason'] = f'52W high distance: {distance_pct:.1f}%'

            scan_items.append(scan_item)

        runner.last_scan_items = scan_items
        runner.last_scan_time = datetime.now(IST)
        return new_signals

    def execute_signal(self, strategy_id: int, signal: ORBSignal) -> bool:
        """
        Execute a trading signal for a strategy.

        Returns True if successful, False otherwise.
        """
        if self.test_mode:
            console.print(f"[yellow]TEST MODE: Would execute {signal.signal_type.value} {signal.symbol} @ ₹{signal.price:.2f}[/yellow]")
            return False

        runner = self.strategies.get(strategy_id)
        if not runner:
            return False

        # Get current portfolio state
        portfolio_status = self.portfolio.get_portfolio_status()
        strategy_status = self.portfolio.get_strategy_status(strategy_id)

        if not strategy_status:
            return False

        # Get symbol exposure
        symbol_exposure = self.portfolio.get_symbol_exposure(signal.symbol)

        # Validate with global risk manager
        validation = self.risk_manager.validate_trade(
            strategy_id=strategy_id,
            strategy_name=runner.strategy_name,
            symbol=signal.symbol,
            entry_price=signal.price,
            stop_loss=signal.stop_loss,
            take_profit=signal.take_profit,
            side="BUY" if signal.signal_type == SignalType.LONG_ENTRY else "SELL",
            total_capital=portfolio_status['initial_capital'],
            cash_available=portfolio_status['cash'],
            current_total_positions=portfolio_status['total_positions'],
            current_total_capital_used=portfolio_status['capital_used'],
            strategy_max_positions=runner.max_positions,
            strategy_allocation_pct=runner.capital_allocation_pct,
            current_strategy_positions=strategy_status['positions_count'],
            current_strategy_capital_used=strategy_status['capital_used'],
            current_symbol_exposure=symbol_exposure,
            daily_pnl=portfolio_status['daily_pnl'],
            risk_per_trade_pct=runner.config.get('risk_per_trade_pct', 0.01),
            max_capital_per_trade_pct=runner.config.get('max_capital_per_trade_pct', 0.10),
            min_trade_value=runner.config.get('min_trade_value', 5000),
            max_trade_value=runner.config.get('max_trade_value', 100000),
        )

        if not validation['valid']:
            console.print(f"[red]{runner.strategy_name}: Signal rejected - {validation['reason']}[/red]")
            send_signal_rejected(
                bot_name=self.bot_config.name,
                strategy_name=runner.strategy_name,
                symbol=signal.symbol,
                signal_type=signal.signal_type.value,
                reason=validation['reason'],
            )
            return False

        # Open position in shared portfolio
        position = self.portfolio.open_position(
            strategy_id=strategy_id,
            strategy_name=runner.strategy_name,
            symbol=signal.symbol,
            side=OrderSide.BUY if signal.signal_type == SignalType.LONG_ENTRY else OrderSide.SELL,
            quantity=validation['shares'],
            entry_price=signal.price,
            stop_loss=signal.stop_loss,
            take_profit=signal.take_profit,
        )

        if position:
            runner.trades_executed += 1
            send_trade_entry(
                bot_name=self.bot_config.name,
                strategy_name=runner.strategy_name,
                symbol=signal.symbol,
                side="BUY" if signal.signal_type == SignalType.LONG_ENTRY else "SELL",
                price=signal.price,
                quantity=validation['shares'],
                sl=signal.stop_loss or 0.0,
                tp=signal.take_profit or 0.0,
            )
            self._persist_position_to_db({
                'strategy_id': strategy_id,
                'strategy_name': runner.strategy_name,
                'symbol': signal.symbol,
                'side': "BUY" if signal.signal_type == SignalType.LONG_ENTRY else "SELL",
                'quantity': validation['shares'],
                'entry_price': signal.price,
                'stop_loss': signal.stop_loss or 0.0,
                'take_profit': signal.take_profit or 0.0,
                'entry_time': datetime.now(IST),
                'current_price': signal.price,
            }, action="upsert")
            if runner.strategy_type in SWING_STRATEGY_TYPES:
                if not hasattr(position, 'metadata'):
                    position.metadata = {}
                position.metadata['strategy_type'] = runner.strategy_type
                if runner.strategy_type in ("52W_CHASER", "52W_TARGET"):
                    position.metadata['entry_52w_high'] = signal.or_high if signal.or_high > 0 else None
                    position.metadata['max_holding_days'] = runner.config.get('max_holding_days', 30)
                    position.metadata['trailing_stop_pct'] = runner.config.get('trailing_stop_pct', 3.0)
                    position.metadata['enable_trailing_stop'] = runner.config.get('enable_trailing_stop', False)
            return True

        return False

    def monitor_positions(self):
        """Monitor all positions across all strategies for exits."""
        if not self.portfolio.positions:
            return

        # Fetch prices for all symbols
        symbols = set(pos.symbol for pos in self.portfolio.positions.values())
        prices = {}

        for symbol in symbols:
            try:
                fetcher = self._get_data_fetcher()
                if fetcher:
                    df = fetcher.upstox_api.fetch_intraday_data_v3(symbol=symbol, interval='1')
                    if df is not None and not df.empty:
                        last = df.iloc[-1]
                        prices[symbol] = {
                            'high': last['high'],
                            'low': last['low'],
                            'close': last['close'],
                        }
            except Exception as e:
                console.print(f"[dim red]Error fetching price for {symbol}: {e}[/dim red]")

        # Update portfolio prices
        close_prices = {s: d['close'] for s, d in prices.items()}
        self.portfolio.update_prices(close_prices)

        for pos in self.portfolio.get_all_positions():
            self._persist_position_to_db(pos, action="upsert")

        # Check exit conditions for each position
        positions_to_close = []

        for key, pos in self.portfolio.positions.items():
            if pos.symbol not in prices:
                continue

            data = prices[pos.symbol]
            candle_high = data['high']
            candle_low = data['low']

            exit_triggered = False
            exit_price = None
            exit_reason = None

            # Check SL/TP
            if pos.side == OrderSide.BUY:
                if candle_low <= pos.stop_loss:
                    exit_triggered = True
                    exit_price = pos.stop_loss
                    exit_reason = "SL"
                elif candle_high >= pos.take_profit:
                    exit_triggered = True
                    exit_price = pos.take_profit
                    exit_reason = "TP"
            else:  # SELL
                if candle_high >= pos.stop_loss:
                    exit_triggered = True
                    exit_price = pos.stop_loss
                    exit_reason = "SL"
                elif candle_low <= pos.take_profit:
                    exit_triggered = True
                    exit_price = pos.take_profit
                    exit_reason = "TP"

            if not exit_triggered:
                runner = self.strategies.get(pos.strategy_id)
                if runner and runner.strategy_type in SWING_STRATEGY_TYPES:
                    gen = runner.signal_generator
                    metadata = pos.metadata if hasattr(pos, 'metadata') and isinstance(pos.metadata, dict) else {}
                    exit_signal = gen.check_exit(
                        symbol=pos.symbol,
                        position_side=pos.side.value,
                        entry_price=pos.entry_price,
                        stop_loss=pos.stop_loss,
                        take_profit=pos.take_profit,
                        current_price=data['close'],
                        highest_price_since_entry=pos.peak_price,
                        entry_52w_high=metadata.get('entry_52w_high'),
                        current_52w_high=metadata.get('current_52w_high'),
                        days_in_position=(datetime.now(IST) - pos.entry_time).days,
                    )
                    if exit_signal:
                        exit_triggered = True
                        exit_price = exit_signal.price
                        exit_reason = exit_signal.notes.split(':')[-1].strip() if ':' in exit_signal.notes else exit_signal.notes

            if exit_triggered:
                positions_to_close.append((pos.strategy_id, pos.symbol, exit_price, exit_reason))

        # Close positions
        trade_logged = False
        for strategy_id, symbol, exit_price, exit_reason in positions_to_close:
            # Calculate costs (simplified)
            trade_value = exit_price * self.portfolio.positions[f"{strategy_id}_{symbol}"].quantity
            costs = trade_value * 0.0006  # Approx 0.06% costs

            trade = self.portfolio.close_position(
                strategy_id=strategy_id,
                symbol=symbol,
                exit_price=exit_price,
                exit_reason=exit_reason,
                costs=costs,
            )

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
                    'exit_reason': trade.exit_reason,
                    'costs': trade.costs,
                    'net_pnl': trade.net_pnl,
                    'strategy_id': trade.strategy_id,
                    'strategy_name': trade.strategy_name,
                }, strategy_id=trade.strategy_id, strategy_name=trade.strategy_name, bot_id=self.bot_config.id, bot_name=self.bot_config.name)

                self._persist_position_to_db({
                    'strategy_id': strategy_id,
                    'strategy_name': runner.strategy_name,
                    'symbol': symbol,
                }, action="delete")

                self._persist_trade_to_db({
                    'strategy_id': strategy_id,
                    'strategy_name': runner.strategy_name,
                    'symbol': trade.symbol,
                    'side': trade.side.value,
                    'quantity': trade.quantity,
                    'entry_price': trade.entry_price,
                    'exit_price': trade.exit_price,
                    'entry_time': trade.entry_time,
                    'exit_time': trade.exit_time,
                    'pnl': trade.pnl,
                    'pnl_pct': trade.pnl_pct,
                    'costs': trade.costs,
                    'net_pnl': trade.net_pnl,
                    'exit_reason': trade.exit_reason,
                    'stop_loss': trade.sl_price if hasattr(trade, 'sl_price') else 0.0,
                    'take_profit': trade.tp_price if hasattr(trade, 'tp_price') else 0.0,
                })

                send_trade_exit(
                    bot_name=self.bot_config.name,
                    strategy_name=runner.strategy_name,
                    symbol=trade.symbol,
                    side=trade.side.value,
                    entry_price=trade.entry_price,
                    exit_price=trade.exit_price,
                    quantity=trade.quantity,
                    pnl=trade.pnl,
                    pnl_pct=trade.pnl_pct,
                    exit_reason=trade.exit_reason,
                    entry_time=trade.entry_time,
                )

                trade_logged = True
                # Add to cooldown
                self.cooldown_stocks[symbol] = datetime.now(IST)
        if trade_logged:
            self.journal.save_journal()

        # Check force exit time
        if self.is_force_exit_time():
            console.print("\n[yellow]Force exit time reached. Closing intraday positions...[/yellow]")
            for key in list(self.portfolio.positions.keys()):
                pos = self.portfolio.positions[key]
                runner = self.strategies.get(pos.strategy_id)
                if runner and runner.strategy_type not in SWING_STRATEGY_TYPES and pos.symbol in close_prices:
                    self.portfolio.close_position(
                        strategy_id=pos.strategy_id,
                        symbol=pos.symbol,
                        exit_price=close_prices[pos.symbol],
                        exit_reason="EOD",
                        costs=close_prices[pos.symbol] * pos.quantity * 0.0006,
                    )

        # Risk alert: daily loss approaching
        portfolio_status = self.portfolio.get_portfolio_status()
        daily_pnl = portfolio_status.get('daily_pnl', 0)
        max_daily_loss_pct = 0.03
        for runner in self.strategies.values():
            max_daily_loss_pct = max(max_daily_loss_pct, runner.config.get('max_daily_loss_pct', 0.03))
        daily_loss_threshold = portfolio_status.get('initial_capital', 0) * max_daily_loss_pct
        if daily_pnl < 0 and abs(daily_pnl) >= daily_loss_threshold * 0.8:
            send_risk_alert(
                bot_name=self.bot_config.name,
                alert_type="daily_loss_approaching",
                current_value=daily_pnl,
                threshold=-daily_loss_threshold,
                message=f"Daily loss ₹{daily_pnl:,.0f} is approaching limit of ₹{-daily_loss_threshold:,.0f} ({max_daily_loss_pct:.0%})",
            )

    def save_snapshot(self):
        """Save current state to snapshot file for UI."""
        try:
            snapshot = {
                'timestamp': datetime.now(IST).isoformat(),
                'bot_id': self.bot_config.id,
                'bot_name': self.bot_config.name,
                'running': self.running,
                'portfolio': self.portfolio.get_portfolio_status(),
                'strategies': {},
                'positions': self.portfolio.get_all_positions(),
                'scan_items': [],  # Combined scan items from all strategies
            }

            for strategy_id, runner in self.strategies.items():
                # Get strategy-specific scan items
                strategy_scan_items = getattr(runner, 'last_scan_items', [])

                snapshot['strategies'][str(strategy_id)] = {
                    'id': runner.strategy_id,
                    'name': runner.strategy_name,
                    'status': runner.status,
                    'signals_generated': runner.signals_generated,
                    'trades_executed': runner.trades_executed,
                    'last_scan_time': runner.last_scan_time.isoformat() if runner.last_scan_time else None,
                    'portfolio_status': self.portfolio.get_strategy_status(strategy_id),
                    'scan_items': strategy_scan_items,  # Per-strategy scan items
                }

                # Add to combined scan items with strategy attribution
                for item in strategy_scan_items:
                    item['strategy_name'] = runner.strategy_name
                    snapshot['scan_items'].append(item)

            self.snapshot_file.write_text(json.dumps(snapshot, indent=2))

        except Exception as e:
            console.print(f"[dim red]Error saving snapshot: {e}[/dim red]")

    def load_snapshot(self):
        """Load state from snapshot file if it exists."""
        if not self.snapshot_file.exists():
            return

        try:
            console.print(f"[cyan]Loading state from snapshot: {self.snapshot_file}[/cyan]")
            snapshot = json.loads(self.snapshot_file.read_text())
            
            # Restore portfolio state
            if 'portfolio' in snapshot:
                p_state = snapshot['portfolio']
                self.portfolio.restore_state(p_state)
            
            # Restore positions
            if 'positions' in snapshot:
                for pos_data in snapshot['positions']:
                    self.portfolio.restore_position(pos_data)
            
            # Restore strategy statuses
            if 'strategies' in snapshot:
                for s_id_str, s_data in snapshot['strategies'].items():
                    s_id = int(s_id_str)
                    if s_id in self.strategies:
                        self.strategies[s_id].status = s_data.get('status', 'pending')
                        self.strategies[s_id].signals_generated = s_data.get('signals_generated', 0)
                        self.strategies[s_id].trades_executed = s_data.get('trades_executed', 0)
            
            console.print(f"[green]✓ State restored from snapshot[/green]")
        except Exception as e:
            console.print(f"[red]Error loading snapshot: {e}[/red]")
            console.print(traceback.format_exc())

    def display_status(self):
        """Display current trading status."""
        portfolio_status = self.portfolio.get_portfolio_status()

        console.print(Panel.fit(
            f"[bold cyan]Multi-Strategy Bot: {self.bot_config.name}[/bold cyan]\n"
            f"Mode: {'TEST' if self.test_mode else 'LIVE'} | "
            f"Strategies: {len(self.strategies)} | "
            f"Time: {datetime.now(IST).strftime('%H:%M:%S')}",
            border_style="green"
        ))

        # Portfolio summary
        table = Table(title="Portfolio Summary")
        table.add_column("Metric", style="cyan")
        table.add_column("Value", justify="right")

        table.add_row("Capital", f"₹{portfolio_status['initial_capital']:,.0f}")
        table.add_row("Cash", f"₹{portfolio_status['cash']:,.0f}")
        table.add_row("Capital Used", f"₹{portfolio_status['capital_used']:,.0f}")
        table.add_row("Positions", f"{portfolio_status['total_positions']}/{self.bot_config.max_total_positions}")
        table.add_row("Daily P&L", f"₹{portfolio_status['daily_pnl']:,.0f}")
        table.add_row("Total P&L", f"₹{portfolio_status['total_pnl']:,.0f} ({portfolio_status['total_pnl_pct']:.2f}%)")

        console.print(table)

        # Strategy status
        strategy_table = Table(title="Strategy Status")
        strategy_table.add_column("Strategy", style="cyan")
        strategy_table.add_column("Status", justify="center")
        strategy_table.add_column("Positions", justify="center")
        strategy_table.add_column("Capital Used", justify="right")
        strategy_table.add_column("P&L", justify="right")

        for strategy_id, runner in self.strategies.items():
            status = self.portfolio.get_strategy_status(strategy_id)
            if status:
                pnl_color = "green" if status['total_pnl'] >= 0 else "red"
                strategy_table.add_row(
                    runner.strategy_name,
                    runner.status,
                    f"{status['positions_count']}/{status['max_positions']}",
                    f"₹{status['capital_used']:,.0f}/{status['allocated_capital']:,.0f}",
                    f"[{pnl_color}]₹{status['total_pnl']:,.0f}[/{pnl_color}]",
                )

        console.print(strategy_table)

    def start_strategy(self, strategy_id: int):
        """Start a specific strategy."""
        if strategy_id in self.strategies:
            self.strategies[strategy_id].status = "running"
            console.print(f"[green]Started strategy: {self.strategies[strategy_id].strategy_name}[/green]")

    def stop_strategy(self, strategy_id: int):
        """Stop a specific strategy."""
        if strategy_id in self.strategies:
            self.strategies[strategy_id].status = "stopped"
            console.print(f"[yellow]Stopped strategy: {self.strategies[strategy_id].strategy_name}[/yellow]")

    def pause_strategy(self, strategy_id: int):
        """Pause a specific strategy."""
        if strategy_id in self.strategies:
            self.strategies[strategy_id].status = "paused"
            console.print(f"[yellow]Paused strategy: {self.strategies[strategy_id].strategy_name}[/yellow]")

    def start_all_strategies(self):
        """Start all strategies."""
        for strategy_id in self.strategies:
            self.start_strategy(strategy_id)

    def stop_all_strategies(self):
        """Stop all strategies."""
        for strategy_id in self.strategies:
            self.stop_strategy(strategy_id)

    def run(self, interval: int = 60):
        """
        Run the multi-strategy trading loop.

        Args:
            interval: Seconds between scan cycles
        """
        console.print(Panel.fit(
            f"[bold cyan]Starting Multi-Strategy Bot: {self.bot_config.name}[/bold cyan]\n"
            f"Strategies: {len(self.strategies)}\n"
            f"Mode: {'TEST' if self.test_mode else 'LIVE'}",
            border_style="green"
        ))

        # Start all strategies
        self.start_all_strategies()
        self.running = True
        self._daily_summary_sent = False

        self._write_heartbeat()

        send_bot_status(
            bot_name=self.bot_config.name,
            status="started",
            details=f"Strategies: {len(self.strategies)} | Mode: {'TEST' if self.test_mode else 'LIVE'}",
        )

        # Initial setup
        self.refresh_watchlist()
        self._load_positions_from_db()

        # Main loop
        cycle = 0
        while self.running:
            cycle += 1

            try:
                console.print(f"\n[dim]--- Cycle {cycle} @ {datetime.now(IST).strftime('%H:%M:%S')} ---[/dim]")

                # Check market status
                if not self.is_market_open():
                    console.print("[yellow]Market closed. Waiting...[/yellow]")
                    self.save_snapshot()
                    time.sleep(interval)
                    continue

                # Refresh watchlist periodically
                if cycle % 10 == 0:
                    self.refresh_watchlist()

                # Scan for signals for each strategy
                for strategy_id, runner in self.strategies.items():
                    if runner.status == "running":
                        if runner.strategy_type in SWING_STRATEGY_TYPES and cycle % 30 != 0:
                            continue
                        signals = self.scan_for_signals(strategy_id)
                        for signal in signals:
                            self.execute_signal(strategy_id, signal)

                # Monitor positions
                self.monitor_positions()

                # Daily summary at EOD (15:30 IST)
                now_ist = self._ist_now()
                if now_ist.hour >= 15 and now_ist.minute >= 30 and not self._daily_summary_sent:
                    self._daily_summary_sent = True
                    ps = self.portfolio.get_portfolio_status()
                    trades = self.portfolio.trades
                    today_trades = [t for t in trades if t.exit_time and t.exit_time.date() == now_ist.date()]
                    wins = [t for t in today_trades if t.net_pnl > 0]
                    losses = [t for t in today_trades if t.net_pnl <= 0]
                    best = max(today_trades, key=lambda t: t.net_pnl) if today_trades else None
                    worst = min(today_trades, key=lambda t: t.net_pnl) if today_trades else None
                    open_pos = self.portfolio.get_all_positions()
                    send_daily_summary(
                        bot_name=self.bot_config.name,
                        total_pnl=ps.get('daily_pnl', 0),
                        win_count=len(wins),
                        loss_count=len(losses),
                        best_trade={'symbol': best.symbol, 'pnl': best.pnl_pct} if best else None,
                        worst_trade={'symbol': worst.symbol, 'pnl': worst.pnl_pct} if worst else None,
                        open_positions=open_pos,
                    )

                # Display status
                self.display_status()

                # Save snapshot
                self.save_snapshot()

                self._write_heartbeat()

                # Wait for next cycle
                if self.running and not self.is_force_exit_time():
                    console.print(f"\n[dim]Waiting {interval}s until next scan...[/dim]")
                    time.sleep(interval)

            except Exception as e:
                console.print(f"[red]Error in cycle {cycle}: {e}[/red]")
                console.print(traceback.format_exc())
                time.sleep(5)

        # Final status
        console.print("\n[bold]Trading stopped. Final status:[/bold]")
        self.display_status()
        self.journal.save_journal()
        self._clear_heartbeat()

        ps = self.portfolio.get_portfolio_status()
        send_bot_status(
            bot_name=self.bot_config.name,
            status="stopped",
            details=f"Total P&L: ₹{ps.get('total_pnl', 0):+,.0f} | Trades today: {ps.get('daily_trades', 0)}",
        )


# For importing time module
import time


def create_multi_strategy_runner(
    bot_id: int,
    user_id: int = None,
    test_mode: bool = False,
) -> MultiStrategyRunner:
    """
    Create a multi-strategy runner from a bot ID.

    Args:
        bot_id: Database ID of the bot configuration
        user_id: User ID for multi-user support
        test_mode: If True, don't execute actual trades

    Returns:
        MultiStrategyRunner instance
    """
    return MultiStrategyRunner(
        bot_config_id=bot_id,
        user_id=user_id,
        test_mode=test_mode,
    )


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Multi-Strategy Trading Runner')
    parser.add_argument('--bot-id', type=int, required=True, help='Bot configuration ID')
    parser.add_argument('--user-id', type=int, help='User ID for multi-user support')
    parser.add_argument('--test', action='store_true', help='Test mode (no real trades)')
    parser.add_argument('--interval', type=int, default=30, help='Scan interval in seconds')

    args = parser.parse_args()

    runner = create_multi_strategy_runner(
        bot_id=args.bot_id,
        user_id=args.user_id,
        test_mode=args.test,
    )

    runner.run(interval=args.interval)
