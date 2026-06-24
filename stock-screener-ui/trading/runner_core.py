"""
Core MultiStrategyRunner orchestration logic.

Contains the main MultiStrategyRunner class that orchestrates multiple trading strategies.
"""

import json as _json
import signal
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Optional

import pandas as pd

from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from backtest.costs import calculate_trading_costs
from trading.timezone import IST


class _TimestampedConsole(Console):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._ist = IST

    def print(self, *args, **kwargs):
        ts = datetime.now(self._ist).strftime("%H:%M:%S")
        ts_text = Text(f"[{ts}] ", style="dim")
        super().print(ts_text, *args, **kwargs)


console = _TimestampedConsole()
from trading.replay_utils import DEFAULT_WATCHLIST, STRATEGY_FILTER_MAP, build_trade_close_event
from trading.shared_portfolio import SharedPortfolioManager, OrderSide

# Default screener profiles per strategy type (used if not configured)
STRATEGY_TYPE_DEFAULT_PROFILES = {
    "ORB": ["volatility_trend"],
    "SR_BREAKOUT": ["volatility_trend"],
    "EMA_CROSS": ["trending"],
    "52W_CHASER": ["near_52w_breakout"],
    "52W_TARGET": ["near_52w_breakout"],
    "BLIND_52W": ["near_52w_breakout"],
}
from trading.bot_heartbeat import BotHeartbeat
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
        live_trading: bool = False,
    ):
        self.user_id = user_id
        self.test_mode = test_mode
        self.live_trading = live_trading
        self._order_manager = None
        self.running = False
        self.bot_config_id = bot_config_id

        if bot_config is not None:
            self.bot_config = bot_config
        elif bot_config_id is not None and _db_available:
            self.bot_config = self._load_bot_config(bot_config_id)
        else:
            raise ValueError("Either bot_config_id or bot_config must be provided")

        self._init_common_fields()

        self.portfolio = _get_shared_portfolio()(
            initial_capital=initial_capital,
            max_total_capital_pct=self.bot_config.max_total_capital_pct,
            max_total_positions=self.bot_config.max_total_positions,
            user_id=user_id,
        )

        self.risk_manager = GlobalRiskManager(
            max_total_positions=self.bot_config.max_total_positions,
            max_total_capital_pct=self.bot_config.max_total_capital_pct,
            max_daily_loss_pct=self.bot_config.max_daily_loss_pct if hasattr(self.bot_config, 'max_daily_loss_pct') else 0.03,
        )

        self.strategies: Dict[int, StrategyRunner] = {}
        self._load_strategies()

        self.journal = get_journal(user_id)
        self._heartbeat = BotHeartbeat(
            user_id=self.user_id,
            bot_config_id=self.bot_config.id,
        )

        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)

    def _init_common_fields(self):
        self.watchlist = []  # Shared watchlist (fallback)
        self.strategy_watchlists = {}  # Per-strategy watchlists: {strategy_id: [symbols]}
        self.or_levels = {}
        self.cooldown_stocks: Dict[str, datetime] = {}
        self._screener = None
        self._data_fetcher = None
        self._daily_summary_sent = False
        self.replay_mode = False
        self._replay_time = None
        self._replay_on_event = None

    @classmethod
    def create_for_replay(cls, bot_config):
        """Create a runner for replay mode with minimal init (no portfolio, no journal, no signal handlers)."""
        self = cls.__new__(cls)
        self.user_id = 1
        self.test_mode = True
        self.live_trading = False
        self.running = False
        self.bot_config_id = bot_config.id
        self.bot_config = bot_config
        self._init_common_fields()
        self._heartbeat = None
        self.portfolio = None
        self.risk_manager = None
        self.strategies = {}
        return self

    @staticmethod
    def _load_bot_config(bot_id: int) -> 'BotConfig':
        """Load bot configuration from database by integer PK."""
        SessionLocal = _get_session_local()
        BotConfig = _get_bot_config()
        with SessionLocal() as db:
            bot = db.query(BotConfig).filter(BotConfig.id == bot_id).first()
            if not bot:
                raise ValueError(f"Bot config {bot_id} not found")
            return bot

    @staticmethod
    def _load_bot_config_by_uuid(uuid: str) -> 'BotConfig':
        """Load bot configuration from database by UUID string."""
        SessionLocal = _get_session_local()
        BotConfig = _get_bot_config()
        with SessionLocal() as db:
            bot = db.query(BotConfig).filter(BotConfig.uuid == uuid).first()
            if not bot:
                raise ValueError(f"Bot config with uuid {uuid} not found")
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
        sig_name = signal.Signals(signum).name
        console.print(f"\n[yellow]Received {sig_name}. Stopping all strategies...[/yellow]")
        self.running = False

    def _check_command_file(self):
        bot_id = self.bot_config.id if self.bot_config else 0
        cmd_path = Path(f"/tmp/bot-cmd-{bot_id}.json")
        if not cmd_path.exists():
            return
        try:
            cmd = _json.loads(cmd_path.read_text())
            if cmd.get("action") == "close_all":
                prices = cmd.get("prices", {})
                self._execute_close_all(prices)
                console.print(f"[red]Executed close_all command for {len(prices)} symbols[/red]")
            elif cmd.get("action") == "close_position":
                symbol = cmd.get("symbol", "")
                exit_price = cmd.get("exit_price", 0)
                strategy_id = cmd.get("strategy_id")
                self._execute_close_position(symbol, exit_price, strategy_id)
                console.print(f"[red]Executed close_position command for {symbol}[/red]")
        except Exception as e:
            console.print(f"[yellow]Error reading command file: {e}[/yellow]")
        finally:
            try:
                cmd_path.unlink(missing_ok=True)
            except Exception:
                pass

    def _execute_close_all(self, prices: dict):
        from backtest.costs import calculate_trading_costs
        for key, pos in list(self.portfolio.positions.items()):
            exit_price = prices.get(pos.symbol, pos.current_price or pos.entry_price)
            if exit_price <= 0:
                continue
            try:
                _fetcher = self._get_data_fetcher()
                if _fetcher and hasattr(_fetcher, 'upstox_api') and _fetcher.upstox_api:
                    _df = _fetcher.upstox_api.fetch_intraday_data_v3(pos.symbol, "1")
                    if _df is not None and not _df.empty:
                        exit_price = float(_df.iloc[-1]["close"])
            except Exception:
                pass
            side = 'LONG' if pos.side == OrderSide.BUY else 'SHORT'
            costs = calculate_trading_costs(pos.entry_price, exit_price, pos.quantity, side)['total_costs']
            order_mgr = self._get_order_manager()
            if order_mgr:
                tag_str = f"{pos.strategy_name}_{pos.symbol}"[:40]
                result = order_mgr.place_exit_order(
                    symbol=pos.symbol,
                    side=side,
                    quantity=pos.quantity,
                    tag=tag_str,
                )
                if result and result.get('filled_price'):
                    exit_price = result['filled_price']
            trade = self.portfolio.close_position(
                strategy_id=pos.strategy_id,
                symbol=pos.symbol,
                exit_price=exit_price,
                exit_reason="MANUAL_CLOSE",
                costs=costs,
                exit_time=self._ist_now(),
            )
            if trade:
                self._persist_trade_to_db({
                    'strategy_id': pos.strategy_id,
                    'strategy_name': '',
                    'symbol': pos.symbol,
                    'side': side,
                    'quantity': pos.quantity,
                    'entry_price': pos.entry_price,
                    'exit_price': exit_price,
                    'entry_time': pos.entry_time,
                    'exit_time': trade.exit_time,
                    'pnl': trade.pnl,
                    'pnl_pct': trade.pnl_pct,
                    'costs': trade.costs,
                    'net_pnl': trade.net_pnl,
                    'exit_reason': "MANUAL_CLOSE",
                    'reason': "Closed via Close All",
                    'stop_loss': pos.stop_loss,
                    'take_profit': pos.take_profit,
                    'peak_price': trade.peak_price,
                    'low_price': trade.low_price,
                })
                self._persist_position_to_db({
                    'strategy_id': pos.strategy_id,
                    'symbol': pos.symbol,
                }, action="delete")

    def _execute_close_position(self, symbol: str, exit_price: float, strategy_id: int = None):
        for key, pos in list(self.portfolio.positions.items()):
            if pos.symbol == symbol and (strategy_id is None or pos.strategy_id == strategy_id):
                if exit_price <= 0:
                    exit_price = pos.current_price or pos.entry_price
                try:
                    _fetcher = self._get_data_fetcher()
                    if _fetcher and hasattr(_fetcher, 'upstox_api') and _fetcher.upstox_api:
                        _df = _fetcher.upstox_api.fetch_intraday_data_v3(symbol, "1")
                        if _df is not None and not _df.empty:
                            exit_price = float(_df.iloc[-1]["close"])
                except Exception:
                    pass
                side = 'LONG' if pos.side == OrderSide.BUY else 'SHORT'
                from backtest.costs import calculate_trading_costs
                costs = calculate_trading_costs(pos.entry_price, exit_price, pos.quantity, side)['total_costs']
                self.portfolio.close_position(
                    strategy_id=pos.strategy_id,
                    symbol=pos.symbol,
                    exit_price=exit_price,
                    exit_reason="MANUAL_CLOSE",
                    costs=costs,
                    exit_time=self._ist_now(),
                )
                console.print(f"[red]Closed position {pos.symbol} in strategy {pos.strategy_id} via API command[/red]")
                break

    def _get_screener(self):
        """Lazy load screener."""
        if self._screener is None:
            try:
                import sys as _sys
                from pathlib import Path as _Path
                project_root = _Path(__file__).parent.parent
                scanners_path = project_root / 'scanners'
                _sys.path.insert(0, str(scanners_path))
                _sys.path.insert(0, str(project_root.parent))
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

    def _get_order_manager(self):
        if not self.live_trading:
            return None
        if self._order_manager is None:
            try:
                from trading.live_order_manager import LiveOrderManager
                fetcher = self._get_data_fetcher()
                if fetcher and hasattr(fetcher, 'upstox_api'):
                    self._order_manager = LiveOrderManager(fetcher.upstox_api)
                else:
                    console.print("[red]Cannot initialize LiveOrderManager: no UpstoxAPI available[/red]")
            except ImportError as e:
                console.print(f"[red]Failed to import LiveOrderManager: {e}[/red]")
        return self._order_manager

    def _ist_now(self) -> datetime:
        if self._replay_time is not None:
            return self._replay_time
        return datetime.now(IST)

    def _get_to_date(self) -> datetime:
        return self._ist_now()

    def _get_db_session(self):
        from db.database import SessionLocal
        return SessionLocal()

    def _write_heartbeat(self):
        if self._heartbeat:
            self._heartbeat.start()

    def _clear_heartbeat(self):
        if self._heartbeat:
            self._heartbeat.stop()

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
                    reason=trade_data.get('reason', ''),
                    peak_price=trade_data.get('peak_price', 0.0),
                    low_price=trade_data.get('low_price', 0.0),
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
                        if hasattr(existing, 'peak_price'):
                            existing.peak_price = pos_data.get('peak_price', 0.0)
                        if hasattr(existing, 'low_price'):
                            existing.low_price = pos_data.get('low_price', 0.0)
                        if hasattr(existing, 'strategy_type'):
                            existing.strategy_type = pos_data.get('strategy_type', '')
                        if hasattr(existing, 'metadata_json'):
                            existing.metadata_json = _json.dumps(pos_data.get('metadata', {})) if pos_data.get('metadata') else ''
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
                            strategy_type=pos_data.get('strategy_type', ''),
                            peak_price=pos_data.get('peak_price', 0.0),
                            low_price=pos_data.get('low_price', 0.0),
                            metadata_json=_json.dumps(pos_data.get('metadata', {})) if pos_data.get('metadata') else '',
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
                                'peak_price': getattr(p, 'peak_price', None) or p.entry_price,
                                'low_price': getattr(p, 'low_price', None) or p.entry_price,
                                'strategy_type': getattr(p, 'strategy_type', '') or '',
                                'metadata': _json.loads(p.metadata_json) if getattr(p, 'metadata_json', None) else {},
                            }
                            self.portfolio.restore_position(pos_data)
                            restored += 1
                        except Exception as e:
                            console.print(f"[yellow]Failed to restore position {p.symbol}: {e}[/yellow]")
                    if restored > 0:
                        console.print(f"[green]Restored {restored} positions from database[/green]")

                        today_symbols = set()
                        for pos in self.portfolio.positions.values():
                            entry_date = pos.entry_time.date() if pos.entry_time else None
                            if entry_date and entry_date >= now.date():
                                today_symbols.add(pos.symbol)

                        if today_symbols:
                            console.print(f"[dim]Fetching fresh prices for {len(today_symbols)} symbols...[/dim]")
                            fetcher = self._get_data_fetcher()
                            if fetcher:
                                close_prices = {}
                                for symbol in today_symbols:
                                    try:
                                        df = fetcher.upstox_api.fetch_intraday_data_v3(symbol=symbol, interval='1')
                                        if df is not None and not df.empty:
                                            close_prices[symbol] = df.iloc[-1]['close']
                                    except Exception as e:
                                        console.print(f"[dim red]Price fetch failed for {symbol}: {e}[/dim red]")
                                if close_prices:
                                    self.portfolio.update_prices(close_prices)
                                    console.print(f"[green]Updated prices for {len(close_prices)} symbols[/green]")
                                    for key, pos in self.portfolio.positions.items():
                                        self._persist_position_to_db(pos, action="upsert")

                        now = self._ist_now()
                        today = now.date()
                        to_close = []
                        for key, pos in list(self.portfolio.positions.items()):
                            entry_date = pos.entry_time.date() if pos.entry_time else None
                            if entry_date and entry_date < today:
                                to_close.append((key, pos))
                        if to_close:
                            for key, pos in to_close:
                                exit_price = pos.current_price or pos.entry_price
                                if exit_price <= 0:
                                    continue
                                side = 'LONG' if pos.side == OrderSide.BUY else 'SHORT'
                                costs = calculate_trading_costs(pos.entry_price, exit_price, pos.quantity, side)['total_costs']
                                trade = self.portfolio.close_position(
                                    strategy_id=pos.strategy_id,
                                    symbol=pos.symbol,
                                    exit_price=exit_price,
                                    exit_reason="FORCE_CLOSE",
                                    costs=costs,
                                    exit_time=self._ist_now(),
                                )
                                if trade:
                                    self._persist_trade_to_db({
                                        'strategy_id': pos.strategy_id,
                                        'strategy_name': pos.strategy_name or '',
                                        'symbol': pos.symbol,
                                        'side': side,
                                        'quantity': pos.quantity,
                                        'entry_price': pos.entry_price,
                                        'exit_price': exit_price,
                                        'entry_time': pos.entry_time,
                                        'exit_time': trade.exit_time,
                                        'pnl': trade.pnl,
                                        'pnl_pct': trade.pnl_pct,
                                        'costs': trade.costs,
                                        'net_pnl': trade.net_pnl,
                                        'exit_reason': "FORCE_CLOSE",
                                        'reason': "Stale position from previous day",
                                        'stop_loss': pos.stop_loss,
                                        'take_profit': pos.take_profit,
                                        'peak_price': trade.peak_price,
                                        'low_price': trade.low_price,
                                    })
                                    self._persist_position_to_db({
                                        'strategy_id': pos.strategy_id,
                                        'symbol': pos.symbol,
                                    }, action="delete")
                            console.print(f"[yellow]Closed {len(to_close)} stale positions from previous days[/yellow]")
            finally:
                db.close()
        except Exception:
            pass

    def is_market_open(self) -> bool:
        from trading.utils import is_market_open as _is_market_open
        return _is_market_open(self._ist_now())

    def is_trading_hours(self) -> bool:
        from trading.utils import is_trading_hours as _is_trading_hours
        return _is_trading_hours(self._ist_now())

    def is_force_exit_time(self) -> bool:
        now = self._ist_now()
        return now.hour >= self.FORCE_EXIT[0] and now.minute >= self.FORCE_EXIT[1]

    def refresh_watchlist(self, strategy_id=None):
        """Refresh watchlist - per strategy if strategy_id provided."""
        if strategy_id is not None and strategy_id in self.strategies:
            return self._refresh_strategy_watchlist(strategy_id)

        console.print("\n[cyan]Refreshing shared watchlist from screener...[/cyan]")

        try:
            import sys as _sys
            from pathlib import Path as _Path
            this_mod = _sys.modules.get('trading.runner_core', None)
            _file_ = this_mod.__file__ if this_mod and hasattr(this_mod, '__file__') else None
            if not _file_:
                console.print(f"[red]Cannot determine module path[/red]")
                self.watchlist = DEFAULT_WATCHLIST.copy()
                return self.watchlist
            project_root = Path(_file_).parent.parent
            _sys.path.insert(0, str(project_root.parent / 'scanners'))
            _sys.path.insert(0, str(project_root.parent))

            import trending_upside as _tu
            df = _tu.fetch_trending_stocks(limit=50, profile='trending')

            if df is None or df.empty:
                console.print("[yellow]No stocks from screener - using default watchlist[/yellow]")
                if not self.watchlist:
                    self.watchlist = DEFAULT_WATCHLIST.copy()
                return self.watchlist

            self.watchlist = df['name'].tolist()[:20]
            console.print(f"[green]Watchlist updated: {len(self.watchlist)} stocks[/green]")

            table = Table(title="Shared Watchlist")
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
            return self.watchlist

        except Exception as e:
            console.print(f"[red]Error refreshing watchlist: {e}[/red]")
            if not self.watchlist:
                console.print("[yellow]Using default watchlist[/yellow]")
                self.watchlist = DEFAULT_WATCHLIST.copy()
            return self.watchlist

    def _refresh_strategy_watchlist(self, strategy_id):
        """Refresh watchlist for a specific strategy using its screener profiles."""
        runner = self.strategies.get(strategy_id)
        if not runner:
            return self.watchlist  # Fallback to shared

        config = runner.config if hasattr(runner, 'config') else {}
        strategy_type = config.get('strategy_type', '')

        # Get profiles from config, or use defaults
        profiles = config.get('screener_profiles') or STRATEGY_TYPE_DEFAULT_PROFILES.get(
            strategy_type, ['trending']
        )

        # Custom watchlist takes priority — prepend to screener results
        custom_symbols = config.get('custom_watchlist', [])
        if custom_symbols:
            console.print(f"[cyan]Custom watchlist for strategy {strategy_id}: {custom_symbols}[/cyan]")

        console.print(f"[cyan]Refreshing watchlist for strategy {strategy_id} ({strategy_type}) with profiles: {profiles}[/cyan]")

        all_symbols = list(custom_symbols)

        import sys as _sys
        from pathlib import Path as _Path
        this_mod = _sys.modules.get('trading.runner_core', None)
        _file_ = this_mod.__file__ if this_mod and hasattr(this_mod, '__file__') else None
        if not _file_:
            console.print(f"[red]Cannot determine module path[/red]")
            return self.watchlist
        project_root = Path(_file_).parent.parent
        _sys.path.insert(0, str(project_root.parent / 'scanners'))
        _sys.path.insert(0, str(project_root.parent))

        for profile in profiles:
            try:
                import trending_upside as _tu
                df = _tu.fetch_trending_stocks(limit=50, profile=profile)
                if df is not None and not df.empty:
                    all_symbols.extend(df['name'].tolist())
            except Exception as e:
                console.print(f"[yellow]Error screening with profile {profile}: {e}[/yellow]")

        if not all_symbols:
            # Fallback to shared watchlist or default
            if self.watchlist:
                return self.watchlist
            return DEFAULT_WATCHLIST.copy()

        # Deduplicate while preserving order
        seen = set()
        unique_symbols = []
        for s in all_symbols:
            if s not in seen:
                seen.add(s)
                unique_symbols.append(s)

        # Store per-strategy watchlist (capped to avoid API rate limits)
        self.strategy_watchlists[strategy_id] = unique_symbols[:15]
        console.print(f"[green]Strategy {strategy_id} watchlist updated: {len(unique_symbols[:15])} stocks[/green]")
        return self.strategy_watchlists[strategy_id]

    def persist_state(self):
        try:
            from db.models import BotRuntimeState, StrategyRuntimeState

            db = self._get_db_session()
            try:
                portfolio = self.portfolio.get_portfolio_status()

                bot_state = db.query(BotRuntimeState).filter(
                    BotRuntimeState.bot_id == self.bot_config.id
                ).first()
                if not bot_state:
                    bot_state = BotRuntimeState(
                        bot_id=self.bot_config.id,
                        user_id=self.user_id,
                    )
                    db.add(bot_state)
                bot_state.cash = portfolio.get('cash', 0.0)
                bot_state.daily_pnl = portfolio.get('daily_pnl', 0.0)
                bot_state.daily_trades = portfolio.get('daily_trades', 0)
                bot_state.realized_pnl = portfolio.get('realized_pnl', 0.0)
                bot_state.day_start = self.portfolio.day_start.isoformat() if hasattr(self.portfolio, 'day_start') and self.portfolio.day_start else ""
                bot_state.watchlist = _json.dumps(self.watchlist or [])
                db.flush()

                for strategy_id, runner in self.strategies.items():
                    s_status = self.portfolio.get_strategy_status(strategy_id)
                    s_state = db.query(StrategyRuntimeState).filter(
                        StrategyRuntimeState.bot_id == self.bot_config.id,
                        StrategyRuntimeState.strategy_id == strategy_id,
                    ).first()
                    if not s_state:
                        s_state = StrategyRuntimeState(
                            bot_id=self.bot_config.id,
                            strategy_id=strategy_id,
                            user_id=self.user_id,
                        )
                        db.add(s_state)
                    s_state.status = runner.status
                    s_state.signals_generated = runner.signals_generated
                    s_state.trades_executed = runner.trades_executed
                    s_state.last_scan_time = runner.last_scan_time if runner.last_scan_time else None
                    s_state.capital_used = s_status.get('capital_used', 0.0) if s_status else 0.0
                    s_state.available_capital = s_status.get('available_capital', 0.0) if s_status else 0.0
                    s_state.positions_count = s_status.get('positions_count', 0) if s_status else 0
                    s_state.realized_pnl = s_status.get('realized_pnl', 0.0) if s_status else 0.0
                    db.flush()

                db.commit()
            except Exception as e:
                db.rollback()
                console.print(f"[yellow]DB state persist failed: {e}[/yellow]")
            finally:
                db.close()
        except Exception as e:
            console.print(f"[yellow]persist_state failed: {e}[/yellow]")

        scan_items = []
        for strategy_id, runner in self.strategies.items():
            for item in getattr(runner, 'last_scan_items', []):
                item_copy = dict(item)
                item_copy['strategy_name'] = runner.strategy_name
                item_copy['strategy_id'] = strategy_id
                scan_items.append(item_copy)

        try:
            db = self._get_db_session()
            try:
                from db.models import BotRuntimeState
                bot_state = db.query(BotRuntimeState).filter(
                    BotRuntimeState.bot_id == self.bot_config.id
                ).first()
                if bot_state:
                    bot_state.scan_items = _json.dumps(scan_items)
                    db.commit()
            except Exception as e:
                db.rollback()
                console.print(f"[yellow]persist_state scan_items DB failed: {e}[/yellow]")
            finally:
                db.close()
        except Exception as e:
            console.print(f"[yellow]persist_state scan_items DB failed: {e}[/yellow]")

        try:
            from cache.redis_client import get_redis_client
            client = get_redis_client()
            if client is not None:
                client.setex(
                    f"bot:{self.bot_config.id}:scan_items",
                    300,
                    _json.dumps(scan_items),
                )
        except Exception as e:
            console.print(f"[yellow]persist_state Redis failed: {e}[/yellow]")

    def display_status(self):
        """Display current trading status."""
        portfolio_status = self.portfolio.get_portfolio_status()

        mode_str = 'TEST' if self.test_mode else ('LIVE' if self.live_trading else 'PAPER')
        console.print(Panel.fit(
            f"[bold cyan]Multi-Strategy Bot: {self.bot_config.name}[/bold cyan]\n"
            f"Mode: {mode_str} | "
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

        mode_str = 'TEST' if self.test_mode else ('LIVE' if self.live_trading else 'PAPER')
        console.print(Panel.fit(
            f"[bold cyan]Starting Multi-Strategy Bot: {self.bot_config.name}[/bold cyan]\n"
            f"Strategies: {len(self.strategies)}\n"
            f"Mode: {mode_str}",
            border_style="green"
        ))

        self.start_all_strategies()
        self.running = True
        self._daily_summary_sent = False

        self._write_heartbeat()

        send_bot_status(
            bot_name=self.bot_config.name,
            status="started",
            details=f"Strategies: {len(self.strategies)} | Mode: {mode_str}",
        )

        self.refresh_watchlist()
        self._load_positions_from_db()

        cycle = 0
        crashed = False
        try:
            while self.running:
                cycle += 1

                try:
                    now_ist = self._ist_now()
                    if now_ist.date() != self.portfolio.day_start:
                        console.print(f"[yellow]Day changed ({self.portfolio.day_start} → {now_ist.date()}), resetting daily counters[/yellow]")
                        self.portfolio.reset_daily()
                        if self.risk_manager:
                            self.risk_manager.reset_daily()
                        self._daily_summary_sent = False

                    console.print(f"\n[dim]--- Cycle {cycle} @ {now_ist.strftime('%H:%M:%S')} ---[/dim]")

                    if not self.is_market_open():
                        console.print("[yellow]Market closed. Waiting...[/yellow]")
                        self._check_command_file()
                        self.persist_state()
                        time.sleep(interval)
                        continue

                    if cycle % 10 == 0:
                        self.refresh_watchlist()  # Refresh shared watchlist

                    # Also refresh per-strategy watchlist on first cycle (ensures custom stocks are included)
                    if cycle == 1:
                        for sid in self.strategies:
                            self.refresh_watchlist(sid)

                    for strategy_id, runner in self.strategies.items():
                        if runner.status == "running":
                            # Refresh per-strategy watchlist periodically (every 30 cycles)
                            if cycle % 30 == 0:
                                self.refresh_watchlist(strategy_id)
                            if runner.strategy_type in SWING_STRATEGY_TYPES and cycle != 1 and cycle % 30 != 0:
                                continue
                            signals = self.scan_for_signals(strategy_id)
                            for signal in signals:
                                self.execute_signal(strategy_id, signal)

                    self._check_command_file()
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

                    self.persist_state()

                    if self.running and not self.is_force_exit_time():
                        console.print(f"\n[dim]Waiting {interval}s until next scan...[/dim]")
                        time.sleep(interval)

                except Exception as e:
                    console.print(f"[red]Error in cycle {cycle}: {e}[/red]")
                    import traceback as tb
                    console.print(tb.format_exc())
                    time.sleep(5)

        except Exception as e:
            crashed = True
            console.print(f"[red]Bot crashed: {e}[/red]")
            import traceback as tb
            console.print(tb.format_exc())
        else:
            console.print("\n[bold]Trading stopped. Final status:[/bold]")
            self.display_status()
            self.journal.save_journal()
            ps = self.portfolio.get_portfolio_status()
            send_bot_status(
                bot_name=self.bot_config.name,
                status="stopped",
                details=f"Total P&L: ₹{ps.get('total_pnl', 0):+,.0f} | Trades today: {ps.get('daily_trades', 0)}",
            )
        finally:
            self._clear_heartbeat()
            if crashed:
                try:
                    ps = self.portfolio.get_portfolio_status() if self.portfolio else None
                    open_pos = self.portfolio.get_all_positions() if self.portfolio else []
                    from trading.telegram_notifier import send_bot_status
                    send_bot_status(
                        bot_name=self.bot_config.name,
                        status="crashed",
                        details=f"Positions open: {len(open_pos)} | P&L: ₹{ps.get('total_pnl', 0):+,.0f}" if ps else "Bot crashed on startup",
                    )
                except Exception:
                    pass


    def run_replay(
        self,
        date_str: str,
        symbols: list[str],
        strategy_filter: str = "ALL",
        on_event=None,
        end_date_str: str | None = None,
    ):
        from datetime import timedelta as td
        from trading.replay_data_provider import ReplayDataProvider
        from market_data.market_data import fetch_candles, resample_candles

        self.replay_mode = True
        self._replay_on_event = on_event
        self._replay_time = None
        self.watchlist = list(symbols)

        dates_to_run = pd.date_range(
            pd.Timestamp(date_str, tz=IST),
            pd.Timestamp(end_date_str or date_str, tz=IST),
            freq='D',
        )
        current_date_str = dates_to_run[0].strftime('%Y-%m-%d')

        try:
            if on_event:
                on_event({"type": "loaded", "symbols": len(symbols), "candles": 0})

            api_client = None
            try:
                from market_data.market_data import get_api_client
                api_client = get_api_client()
            except Exception:
                pass

            provider = ReplayDataProvider(
                date_str=current_date_str,
                symbols=symbols,
                get_current_time_fn=self._ist_now,
                api_client=api_client,
            )
        except Exception as e:
            if on_event:
                on_event({"type": "error", "message": str(e)})
            self.replay_mode = False
            self._replay_time = None
            self._replay_on_event = None
            return

        try:
            class DataFetcherProxy:
                pass
            DataFetcherProxy.upstox_api = provider
            self._data_fetcher = DataFetcherProxy()

            initial_capital = getattr(self.bot_config, 'initial_capital', 1_000_000)
            self.portfolio = _get_shared_portfolio()(
                initial_capital=initial_capital,
                max_total_capital_pct=self.bot_config.max_total_capital_pct,
                max_total_positions=self.bot_config.max_total_positions,
                user_id=None,
                simulated_date=pd.Timestamp(current_date_str, tz=IST),
            )

            self.risk_manager = GlobalRiskManager(
                max_total_positions=self.bot_config.max_total_positions,
                max_total_capital_pct=self.bot_config.max_total_capital_pct,
                max_daily_loss_pct=self.bot_config.max_daily_loss_pct if hasattr(self.bot_config, 'max_daily_loss_pct') else 0.03,
            )

            self._load_strategies()
            for r in self.strategies.values():
                r.status = "running"

            if strategy_filter != "ALL":
                allowed = STRATEGY_FILTER_MAP.get(strategy_filter, ())
                remove = [
                    sid for sid, r in self.strategies.items()
                    if r.strategy_type not in allowed
                ]
                for sid in remove:
                    del self.strategies[sid]

            # Main date loop
            _replay_start_time = datetime.now(IST)
            for current_date_str in dates_to_run.strftime('%Y-%m-%d'):
                provider = ReplayDataProvider(
                    date_str=current_date_str,
                    symbols=symbols,
                    get_current_time_fn=self._ist_now,
                    api_client=api_client,
                )
                DataFetcherProxy.upstox_api = provider

                total_candles = sum(len(df) for df in provider._1m_data.values())
                if on_event:
                    on_event({"type": "loaded", "symbols": len(provider._1m_data), "candles": total_candles})

                self._replay_symbol_candle_counts = {
                    sym: len(provider._1m_data[sym])
                    for sym in symbols if sym in provider._1m_data
                }
                self._emit_precomputed_overlays(provider, symbols)

                market_open = pd.Timestamp(current_date_str + " 09:15:00", tz=IST)
                market_close = pd.Timestamp(current_date_str + " 15:30:00", tz=IST)
                current = market_open
                candle_count = 0
                candle_buffer = {}
                CANDLE_FLUSH_INTERVAL = 100

                while current <= market_close:
                    self._replay_time = current
                    candle_count += 1

                    if candle_count % 50 == 0 and on_event:
                        on_event({"type": "progress", "candle": candle_count, "total": total_candles,
                                    "time": current.strftime("%H:%M"), "symbol": ""})

                    for sym in symbols:
                        if sym not in provider._1m_data or provider._1m_data[sym].empty:
                            continue
                        df_sym = provider._1m_data[sym]
                        mask = df_sym.index == current
                        if not mask.any():
                            continue
                        row = df_sym[mask].iloc[0]
                        if sym not in candle_buffer:
                            candle_buffer[sym] = []
                        candle_buffer[sym].append({
                            "time": current.strftime("%H:%M"),
                            "open": float(row["open"]),
                            "high": float(row["high"]),
                            "low": float(row["low"]),
                            "close": float(row["close"]),
                            "volume": float(row.get("volume", 0)),
                        })

                    if candle_count % CANDLE_FLUSH_INTERVAL == 0 and on_event:
                        for buf_sym, buf_candles in candle_buffer.items():
                            if buf_candles:
                                on_event({"type": "candles", "symbol": buf_sym, "candles": buf_candles})
                                candle_buffer[buf_sym] = []

                    is_5min = current.minute % 5 == 0 and current.second == 0
                    is_market_open = current == market_open

                    if is_5min or is_market_open:
                        for sid, rnr in self.strategies.items():
                            try:
                                signals = self.scan_for_signals(sid)
                                for signal in signals:
                                    sym = signal.symbol.upper()
                                    if sym not in provider._1m_data:
                                        continue
                                    self.execute_signal(sid, signal)
                            except Exception as e:
                                console.print(f"[dim red]Replay scan error: {e}[/dim red]")

                    self.monitor_positions()

                    current += timedelta(minutes=1)

                if on_event:
                    for buf_sym, buf_candles in candle_buffer.items():
                        if buf_candles:
                            on_event({"type": "candles", "symbol": buf_sym, "candles": buf_candles})

                for key in list(self.portfolio.positions.keys()):
                    pos = self.portfolio.positions[key]
                    side = "LONG" if pos.side.value == "BUY" else "SHORT"
                    costs = calculate_trading_costs(pos.entry_price, pos.current_price, pos.quantity, side)['total_costs']
                    trade = self.portfolio.close_position(
                        strategy_id=pos.strategy_id, symbol=pos.symbol,
                        exit_price=pos.current_price, exit_reason="FORCE_CLOSE",
                        costs=costs, exit_time=market_close,
                    )
                    if on_event and trade:
                        runner = self.strategies.get(pos.strategy_id)
                        on_event(build_trade_close_event(trade, runner))

            if on_event:
                self._emit_summary(on_event)
                duration_ms = int((datetime.now(IST) - _replay_start_time).total_seconds() * 1000)
                on_event({"type": "done", "success": True, "duration_ms": duration_ms})
        finally:
            self.replay_mode = False
            self._replay_time = None
            self._replay_on_event = None

    def _emit_precomputed_overlays(self, provider, symbols):
        if not self._replay_on_event:
            return

        from trading.ema_utils import calculate_ema

        for sym in symbols:
            if sym not in provider._daily_data or provider._daily_data[sym].empty:
                continue
            df = provider._daily_data[sym]
            closes = df["close"].tolist()
            highs = df["high"].tolist()
            if len(highs) < 2:
                continue

            from trading.week52_utils import calculate_52w_high
            high_52w = calculate_52w_high(highs, period=252, exclude_current=True)
            current_price = float(closes[-1])

            if current_price > 0 and high_52w is not None and current_price >= high_52w * 0.95:
                for sid, runner in self.strategies.items():
                    if runner.strategy_type in ("52W_CHASER", "52W_TARGET"):
                        n_candles = len(provider._1m_data.get(sym, []))
                        self._replay_on_event({
                            "type": "52w_high", "strategy": runner.strategy_name,
                            "symbol": sym, "high_52w": float(high_52w),
                            "from_index": 0,
                            "to_index": max(n_candles - 1, 0),
                        })
                        break

            for sid, runner in self.strategies.items():
                if runner.strategy_type != "EMA_CROSS":
                    continue

                if sym not in provider._1m_data or provider._1m_data[sym].empty:
                    continue

                ema_fast_period = runner.config.get('ema_fast_period', 9)
                ema_slow_period = runner.config.get('ema_slow_period', 21)
                df_1m = provider._1m_data[sym]
                day_closes = df_1m["close"].tolist()
                n_today = len(day_closes)

                if n_today < ema_slow_period:
                    continue

                seed_df = provider._1m_seed_data.get(sym)
                seed_closes = seed_df["close"].tolist() if seed_df is not None and not seed_df.empty else []
                full_closes = seed_closes + day_closes
                n_seed = len(seed_closes)

                ema_fast_full = calculate_ema(full_closes, ema_fast_period, return_full=True)
                ema_slow_full = calculate_ema(full_closes, ema_slow_period, return_full=True)
                ema_fast_today = ema_fast_full[n_seed:]
                ema_slow_today = ema_slow_full[n_seed:]

                timeframes = {}
                for tf in [5, 15, 60]:
                    tf_full = [full_closes[i:i + tf][-1] for i in range(0, len(full_closes), tf) if full_closes[i:i + tf]]
                    if len(tf_full) < ema_slow_period:
                        continue
                    ema_f_full = calculate_ema(tf_full, ema_fast_period, return_full=True)
                    ema_s_full = calculate_ema(tf_full, ema_slow_period, return_full=True)
                    tf_seed = [seed_closes[i:i + tf][-1] for i in range(0, len(seed_closes), tf) if seed_closes[i:i + tf]]
                    n_seed_tf = len(tf_seed)
                    timeframes[str(tf)] = {
                        "ema_fast": [round(v, 2) for v in ema_f_full[n_seed_tf:] if v is not None],
                        "ema_slow": [round(v, 2) for v in ema_s_full[n_seed_tf:] if v is not None],
                    }

                if timeframes:
                    timeframes["1"] = {
                        "ema_fast": [round(v, 2) for v in ema_fast_today if v is not None],
                        "ema_slow": [round(v, 2) for v in ema_slow_today if v is not None],
                    }

                if sym in provider._daily_data and not provider._daily_data[sym].empty:
                    daily_closes = provider._daily_data[sym]["close"].tolist()
                    if len(daily_closes) >= ema_slow_period:
                        daily_ema_f = calculate_ema(daily_closes, ema_fast_period, return_full=True)
                        daily_ema_s = calculate_ema(daily_closes, ema_slow_period, return_full=True)
                        if not timeframes:
                            timeframes = {}
                        timeframes["1440"] = {
                            "ema_fast": [round(v, 2) for v in daily_ema_f if v is not None],
                            "ema_slow": [round(v, 2) for v in daily_ema_s if v is not None],
                        }
                    self._replay_on_event({
                        "type": "ema_series",
                        "symbol": sym,
                        "ema_fast_period": ema_fast_period,
                        "ema_slow_period": ema_slow_period,
                        "timeframes": timeframes,
                    })
                break

    def _emit_summary(self, on_event):
        trades = self.portfolio.trades
        if not trades:
            on_event({"type": "summary", "total_trades": 0, "winners": 0, "losers": 0,
                        "win_rate": 0, "profit_factor": 0, "gross_pnl": 0, "total_costs": 0,
                        "net_pnl": 0, "strategy_breakdown": {}})
            return

        winners = [t for t in trades if t.net_pnl >= 0]
        losers = [t for t in trades if t.net_pnl < 0]
        total_pnl = sum(t.net_pnl for t in trades)
        total_costs = sum(t.costs for t in trades)
        gross_pnl = total_pnl + total_costs
        wr = len(winners) / len(trades) * 100 if trades else 0
        pf = sum(t.net_pnl for t in winners) / abs(sum(t.net_pnl for t in losers)) if losers else None

        by_strategy = {}
        for t in trades:
            by_strategy.setdefault(t.strategy_name, []).append(t)
        strategy_breakdown = {}
        for sname, strades in by_strategy.items():
            sw = [t for t in strades if t.net_pnl >= 0]
            sl = [t for t in strades if t.net_pnl < 0]
            runner = None
            for r in self.strategies.values():
                if r.strategy_name == sname:
                    runner = r
                    break
            strategy_breakdown[sname] = {
                "trades": len(strades),
                "win_rate": round(len(sw) / len(strades) * 100, 1) if strades else 0,
                "net_pnl": round(sum(t.net_pnl for t in strades), 2),
                "profit_factor": round(sum(t.net_pnl for t in sw) / abs(sum(t.net_pnl for t in sl)), 2) if sl else None,
            }

        on_event({
            "type": "summary", "total_trades": len(trades), "winners": len(winners),
            "losers": len(losers), "win_rate": round(wr, 1),
            "profit_factor": round(pf, 2) if pf is not None else None,
            "gross_pnl": round(gross_pnl, 2), "total_costs": round(total_costs, 2),
            "net_pnl": round(total_pnl, 2),
            "strategy_breakdown": strategy_breakdown,
        })


def create_multi_strategy_runner(
    bot_id: int,
    user_id: int = None,
    test_mode: bool = False,
    live_trading: bool = False,
) -> MultiStrategyRunner:
    """
    Create a multi-strategy runner from a bot ID.

    Args:
        bot_id: Database ID of the bot configuration
        user_id: User ID for multi-user support
        test_mode: If True, don't execute actual trades
        live_trading: If True, place real orders via Upstox

    Returns:
        MultiStrategyRunner instance
    """
    return MultiStrategyRunner(
        bot_config_id=bot_id,
        user_id=user_id,
        test_mode=test_mode,
        live_trading=live_trading,
    )
