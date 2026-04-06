"""
Core MultiStrategyRunner orchestration logic.

Contains the main MultiStrategyRunner class that orchestrates multiple trading strategies.
"""

import json
import signal
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Optional

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

console = Console()

IST = None
try:
    import config
    IST = config.IST
except ImportError:
    from datetime import timezone
    IST = timezone(timedelta(hours=5, minutes=30))

from trading.shared_portfolio import SharedPortfolioManager
from trading.global_risk_manager import GlobalRiskManager
from trading.journal import get_journal
from trading.strategy_runner import StrategyRunner, INTRADAY_STRATEGY_TYPES, SWING_STRATEGY_TYPES
from trading.runner_signals import RunnerSignalsMixin
from trading.runner_risk import RunnerRiskMixin

_db_available = False
try:
    from db.database import SessionLocal
    from db.models import BotConfig, StrategyConfig, bot_strategies
    _db_available = True
except ImportError:
    pass

def _get_shared_portfolio():
    """Get SharedPortfolioManager from multi_strategy_runner module if available."""
    try:
        import trading.multi_strategy_runner
        if hasattr(trading.multi_strategy_runner, 'SharedPortfolioManager'):
            return trading.multi_strategy_runner.SharedPortfolioManager
    except (ImportError, AttributeError):
        pass
    return SharedPortfolioManager

def _get_session_local():
    """Get SessionLocal from multi_strategy_runner module if available, else use local."""
    try:
        import trading.multi_strategy_runner
        if hasattr(trading.multi_strategy_runner, 'SessionLocal'):
            return trading.multi_strategy_runner.SessionLocal
    except (ImportError, AttributeError):
        pass
    return SessionLocal

def _get_bot_strategies():
    """Get bot_strategies from multi_strategy_runner module if available, else use local."""
    try:
        import trading.multi_strategy_runner
        if hasattr(trading.multi_strategy_runner, 'bot_strategies'):
            return trading.multi_strategy_runner.bot_strategies
    except (ImportError, AttributeError):
        pass
    return bot_strategies

def _get_bot_config():
    """Get BotConfig from multi_strategy_runner module if available, else use local."""
    try:
        import trading.multi_strategy_runner
        if hasattr(trading.multi_strategy_runner, 'BotConfig'):
            return trading.multi_strategy_runner.BotConfig
    except (ImportError, AttributeError):
        pass
    return BotConfig

def _get_strategy_config():
    """Get StrategyConfig from multi_strategy_runner module if available, else use local."""
    try:
        import trading.multi_strategy_runner
        if hasattr(trading.multi_strategy_runner, 'StrategyConfig'):
            return trading.multi_strategy_runner.StrategyConfig
    except (ImportError, AttributeError):
        pass
    return StrategyConfig


class MultiStrategyRunner(RunnerSignalsMixin, RunnerRiskMixin):
    """
    Main orchestrator for running multiple trading strategies in parallel.

    Features:
    - Loads strategies from bot_strategies table
    - Creates separate signal generators per strategy
    - Runs scan loop for all strategies
    - Coordinates signal execution through shared portfolio
    - Enforces global and per-strategy risk limits
    """

    PRE_MARKET = (9, 0)
    MARKET_OPEN = (9, 15)
    OR_END = (10, 0)
    FORCE_EXIT = (15, 30)
    MARKET_CLOSE = (15, 30)

    def __init__(
        self,
        bot_config_id: int = None,
        bot_config: 'BotConfig' = None,
        user_id: int = None,
        initial_capital: float = 1_000_000,
        test_mode: bool = False,
    ):
        self.user_id = user_id
        self.test_mode = test_mode
        self.running = False
        self.bot_config_id = bot_config_id

        if bot_config is not None:
            self.bot_config = bot_config
        elif bot_config_id is not None and _db_available:
            self.bot_config = self._load_bot_config(bot_config_id)
        else:
            raise ValueError("Either bot_config_id or bot_config must be provided")

        self.portfolio = _get_shared_portfolio()(
            initial_capital=initial_capital,
            max_total_capital_pct=self.bot_config.max_total_capital_pct,
            max_total_positions=self.bot_config.max_total_positions,
            user_id=user_id,
        )

        self.risk_manager = GlobalRiskManager(
            max_total_positions=self.bot_config.max_total_positions,
            max_total_capital_pct=self.bot_config.max_total_capital_pct,
        )

        self.watchlist = []
        self.or_levels = {}
        self.cooldown_stocks: Dict[str, datetime] = {}
        self.snapshot_file = Path(f"/tmp/multi-strategy-bot-{self.user_id}-{self.bot_config.id}.json")

        self.strategies: Dict[int, StrategyRunner] = {}
        self._load_strategies()

        self.load_snapshot()

        self.journal = get_journal(user_id)

        self._screener = None
        self._data_fetcher = None

        self._daily_summary_sent = False

        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)

    def _load_bot_config(self, bot_id: int) -> 'BotConfig':
        """Load bot configuration from database."""
        SessionLocal = _get_session_local()
        BotConfig = _get_bot_config()
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

        SessionLocal = _get_session_local()
        bot_strategies = _get_bot_strategies()
        StrategyConfig = _get_strategy_config()
        with SessionLocal() as db:
            result = db.execute(
                bot_strategies.select().where(bot_strategies.c.bot_id == self.bot_config.id)
            ).fetchall()

            for row in result:
                strategy_id = row.strategy_id
                max_positions = row.max_positions
                capital_allocation_pct = row.capital_allocation_pct

                strategy = db.query(StrategyConfig).filter(StrategyConfig.id == strategy_id).first()
                if not strategy:
                    console.print(f"[yellow]Strategy {strategy_id} not found, skipping[/yellow]")
                    continue

                runner = StrategyRunner(
                    strategy_id=strategy.id,
                    strategy_name=strategy.name,
                    strategy_type=strategy.strategy_type,
                    config=strategy.to_dict(),
                    max_positions=max_positions,
                    capital_allocation_pct=capital_allocation_pct,
                )

                self.strategies[strategy.id] = runner

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

            self.watchlist = df['name'].tolist()[:20]
            console.print(f"[green]Watchlist updated: {len(self.watchlist)} stocks[/green]")

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
                'scan_items': [],
            }

            for strategy_id, runner in self.strategies.items():
                strategy_scan_items = getattr(runner, 'last_scan_items', [])

                snapshot['strategies'][str(strategy_id)] = {
                    'id': runner.strategy_id,
                    'name': runner.strategy_name,
                    'status': runner.status,
                    'signals_generated': runner.signals_generated,
                    'trades_executed': runner.trades_executed,
                    'last_scan_time': runner.last_scan_time.isoformat() if runner.last_scan_time else None,
                    'portfolio_status': self.portfolio.get_strategy_status(strategy_id),
                    'scan_items': strategy_scan_items,
                }

                for item in strategy_scan_items:
                    item['strategy_name'] = runner.strategy_name
                    snapshot['scan_items'].append(item)

            self.snapshot_file.write_text(json.dumps(snapshot, indent=2))

        except Exception as e:
            console.print(f"[dim red]Error saving snapshot: {e}[/dim red]")

    def load_snapshot(self):
        """Load state from snapshot file if it exists."""
        import traceback
        if not self.snapshot_file.exists():
            return

        try:
            console.print(f"[cyan]Loading state from snapshot: {self.snapshot_file}[/cyan]")
            snapshot = json.loads(self.snapshot_file.read_text())
            
            if 'portfolio' in snapshot:
                p_state = snapshot['portfolio']
                self.portfolio.restore_state(p_state)
            
            if 'positions' in snapshot:
                for pos_data in snapshot['positions']:
                    self.portfolio.restore_position(pos_data)
            
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
        from trading.telegram_notifier import send_bot_status, send_daily_summary

        console.print(Panel.fit(
            f"[bold cyan]Starting Multi-Strategy Bot: {self.bot_config.name}[/bold cyan]\n"
            f"Strategies: {len(self.strategies)}\n"
            f"Mode: {'TEST' if self.test_mode else 'LIVE'}",
            border_style="green"
        ))

        self.start_all_strategies()
        self.running = True
        self._daily_summary_sent = False

        self._write_heartbeat()

        send_bot_status(
            bot_name=self.bot_config.name,
            status="started",
            details=f"Strategies: {len(self.strategies)} | Mode: {'TEST' if self.test_mode else 'LIVE'}",
        )

        self.refresh_watchlist()
        self._load_positions_from_db()

        cycle = 0
        while self.running:
            cycle += 1

            try:
                console.print(f"\n[dim]--- Cycle {cycle} @ {datetime.now(IST).strftime('%H:%M:%S')} ---[/dim]")

                if not self.is_market_open():
                    console.print("[yellow]Market closed. Waiting...[/yellow]")
                    self.save_snapshot()
                    time.sleep(interval)
                    continue

                if cycle % 10 == 0:
                    self.refresh_watchlist()

                for strategy_id, runner in self.strategies.items():
                    if runner.status == "running":
                        if runner.strategy_type in SWING_STRATEGY_TYPES and cycle % 30 != 0:
                            continue
                        signals = self.scan_for_signals(strategy_id)
                        for signal in signals:
                            self.execute_signal(strategy_id, signal)

                self.monitor_positions()

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

                self.display_status()

                self.save_snapshot()

                self._write_heartbeat()

                if self.running and not self.is_force_exit_time():
                    console.print(f"\n[dim]Waiting {interval}s until next scan...[/dim]")
                    time.sleep(interval)

            except Exception as e:
                console.print(f"[red]Error in cycle {cycle}: {e}[/red]")
                import traceback as tb
                console.print(tb.format_exc())
                time.sleep(5)

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
