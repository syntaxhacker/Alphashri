"""
Core MultiStrategyRunner orchestration logic.

Contains the main MultiStrategyRunner class that orchestrates multiple trading strategies.
"""

import json as _json
import signal
import sys
import time
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Optional

import pandas as pd

from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from trading.timezone import IST
from trading.utils import PRE_MARKET, MARKET_OPEN, OR_END, FORCE_EXIT, MARKET_CLOSE
from trading.strategy_runner import SWING_STRATEGY_TYPES


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
    "SHORT_52W_FAILED": ["near_52w_breakout"],
    "ADX_TREND": ["trending", "high_momentum"],
    "VOLUME_SURGE": ["trending"],
}

# ── Shared constants ──────────────────────────────────────────────────────────
WATCHLIST_SHARED_CAP = 20
WATCHLIST_STRATEGY_CAP = 15
WATCHLIST_REFRESH_CYCLES = 10
WATCHLIST_STRATEGY_REFRESH_CYCLES = 30
SCAN_INTERVAL_DEFAULT = 5
PERSIST_STATE_CYCLES = 6
REDIS_SCAN_TTL = 300
TRENDING_LIMIT = 50

_SCANNER_PATHS_RESOLVED = False

def _ensure_scanner_paths() -> bool:
    global _SCANNER_PATHS_RESOLVED
    if _SCANNER_PATHS_RESOLVED:
        return True
    import sys as _sys
    from pathlib import Path as _Path
    this_mod = _sys.modules.get('trading.runner_core', None)
    _file_ = this_mod.__file__ if this_mod and hasattr(this_mod, '__file__') else None
    if not _file_:
        return False
    project_root = _Path(_file_).parent.parent
    _sys.path.insert(0, str(project_root.parent / 'scanners'))
    _sys.path.insert(0, str(project_root.parent))
    _SCANNER_PATHS_RESOLVED = True
    return True
from trading.bot_heartbeat import BotHeartbeat
from trading.global_risk_manager import GlobalRiskManager
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

    PRE_MARKET = PRE_MARKET
    MARKET_OPEN = MARKET_OPEN
    OR_END = OR_END
    FORCE_EXIT = FORCE_EXIT
    MARKET_CLOSE = MARKET_CLOSE

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
        self._scan_cursors: dict = {}
        self._streaming_started = False
        self._screener = None
        self._data_fetcher = None
        self._daily_summary_sent = False
        self._cycle_data_cache: dict = {}
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

    def _process_command(self, cmd: dict) -> bool:
        """Process a single command dict. Returns True if handled."""
        action = cmd.get("action")
        if action == "close_all":
            prices = cmd.get("prices", {})
            self._execute_close_all(prices)
            console.print(f"[red]Executed close_all command for {len(prices)} symbols[/red]")
            return True
        elif action == "close_position":
            symbol = cmd.get("symbol", "")
            exit_price = cmd.get("exit_price", 0)
            strategy_id = cmd.get("strategy_id")
            self._execute_close_position(symbol, exit_price, strategy_id)
            console.print(f"[red]Executed close_position command for {symbol}[/red]")
            return True
        elif action == "reload_strategy":
            sid = cmd.get("strategy_id")
            if sid and self._reload_strategy_config(sid):
                self.refresh_watchlist(sid)
                self._start_websocket_stream()
                console.print(f"[green]Reloaded config + watchlist for strategy {sid}[/green]")
            elif sid:
                console.print(f"[yellow]reload_strategy: strategy {sid} config unchanged[/yellow]")
            return True
        elif action == "reload_all_strategies":
            for sid in list(self.strategies.keys()):
                if self._reload_strategy_config(sid):
                    self.refresh_watchlist(sid)
            self._start_websocket_stream()
            console.print(f"[green]Reloaded config + watchlist for all strategies[/green]")
            return True
        return False

    def _check_command_file(self):
        """Read and process all command files from the command directory.

        Uses a directory of files instead of a single file to avoid
        race conditions when multiple commands arrive in one cycle.
        """
        bot_id = self.bot_config.id if self.bot_config else 0
        cmd_dir = Path(f"/tmp/bot-cmd-{bot_id}")
        if not cmd_dir.is_dir():
            return
        cmd_files = sorted(cmd_dir.iterdir())
        for f in cmd_files:
            try:
                cmd = _json.loads(f.read_text())
                self._process_command(cmd)
            except Exception as e:
                console.print(f"[yellow]Error processing command file {f.name}: {e}[/yellow]")
            try:
                f.unlink(missing_ok=True)
            except Exception:
                pass

    def _execute_close_all(self, prices: dict):
        for key, pos in list(self.portfolio.positions.items()):
            exit_price = prices.get(pos.symbol, pos.current_price or pos.entry_price)
            if exit_price <= 0:
                continue
            try:
                _p = self._fetch_live_price(pos.symbol)
                if _p is not None:
                    exit_price = _p
            except Exception:
                pass
            side = self._side_str(pos.side, "LONG_SHORT")
            costs = self._calc_costs(pos.entry_price, exit_price, pos.quantity, side)
            order_mgr = self._get_order_manager()
            if order_mgr:
                tag_str = self._build_order_tag(pos.strategy_name, pos.symbol)
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
                    _p = self._fetch_live_price(symbol)
                    if _p is not None:
                        exit_price = _p
                except Exception:
                    pass
                side = self._side_str(pos.side, "LONG_SHORT")
                costs = self._calc_costs(pos.entry_price, exit_price, pos.quantity, side)
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
            if not _ensure_scanner_paths():
                console.print("[red]Cannot resolve scanner module path for screener[/red]")
                return None
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

            # TVScreenerUsage.__init__ can silently fail to initialize upstox_api
            # (relative import bug in config_and_utils when upstox_trader/ is added to sys.path).
            # Fall back to creating UpstoxAPI directly via the full package path.
            if self._data_fetcher and not getattr(self._data_fetcher, 'upstox_api', None):
                try:
                    from upstox_trader.config_and_utils.upstox_api import UpstoxAPI
                    import config as _cfg
                    api = UpstoxAPI(
                        api_key=_cfg.UPSTOX_CONFIG.get('api_key'),
                        api_secret=_cfg.UPSTOX_CONFIG.get('api_secret'),
                        quiet=True,
                    )
                    # TVScreenerUsage's "robust import setup" adds Alphashri/ to
                    # sys.path, making import config resolve to the parent project
                    # (Alphashri/config.py). That config loads its own .env which
                    # lacks UPSTOX_ACCESS_TOKEN. Re-load the UI's .env so the
                    # token env var is available.
                    if not api.auth_handler.access_token:
                        from pathlib import Path as _P
                        _dotenv = _P(__file__).resolve().parent.parent / '.env'
                        if _dotenv.exists():
                            from dotenv import load_dotenv
                            load_dotenv(str(_dotenv), override=True)
                        import os as _os
                        _tok = _os.environ.get('UPSTOX_ACCESS_TOKEN')
                        if _tok:
                            api.auth_handler.access_token = _tok
                    self._data_fetcher.upstox_api = api
                    console.print("[green]✅ Direct UpstoxAPI fallback created for data fetcher[/green]")
                except Exception as e:
                    console.print(f"[red]Direct UpstoxAPI fallback also failed: {e}[/red]")
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

    @contextmanager
    def _db_session(self):
        db = None
        try:
            db = self._get_db_session()
            yield db
            db.commit()
        except Exception as e:
            if db:
                db.rollback()
            console.print(f"[yellow]DB error: {e}[/yellow]")
        finally:
            if db:
                db.close()

    def _persist_trade_to_db(self, trade_data: dict):
        try:
            with self._db_session() as db:
                from db.models import Trade
                entry_time = trade_data['entry_time']
                if isinstance(entry_time, str):
                    entry_time = datetime.fromisoformat(entry_time)
                existing = db.query(Trade).filter(
                    Trade.bot_id == (self.bot_config.id if self.bot_config else 0),
                    Trade.strategy_id == trade_data.get('strategy_id', 0),
                    Trade.symbol == trade_data['symbol'],
                    Trade.entry_time == entry_time,
                ).first()
                if existing:
                    existing.exit_price = trade_data.get('exit_price')
                    existing.exit_time = trade_data.get('exit_time')
                    existing.pnl = trade_data.get('pnl', 0.0)
                    existing.pnl_pct = trade_data.get('pnl_pct', 0.0)
                    existing.costs = trade_data.get('costs', 0.0)
                    existing.net_pnl = trade_data.get('net_pnl', 0.0)
                    existing.exit_reason = trade_data.get('exit_reason', '')
                    existing.reason = trade_data.get('reason', '')
                    existing.peak_price = trade_data.get('peak_price', 0.0)
                    existing.low_price = trade_data.get('low_price', 0.0)
                else:
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
                        entry_time=entry_time,
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
        except Exception as e:
            console.print(f"[red]_persist_trade_to_db failed for {trade_data.get('symbol','?')}: {e}[/red]")
            import traceback as _tb
            console.print(_tb.format_exc())

    def _persist_position_to_db(self, pos_data: dict, action: str = "upsert"):
        try:
            with self._db_session() as db:
                from db.models import Position
                from sqlalchemy import text
                if action == "delete":
                    db.execute(
                        text("DELETE FROM positions WHERE bot_id = :bot_id AND strategy_id = :strategy_id AND symbol = :symbol"),
                        {"bot_id": self.bot_config.id if self.bot_config else 0, "strategy_id": pos_data.get('strategy_id', 0), "symbol": pos_data['symbol']}
                    )
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
                        # Handle entry_time being datetime, ISO string, or None
                        et_raw = pos_data.get('entry_time')
                        if isinstance(et_raw, datetime):
                            et_val = et_raw
                        elif isinstance(et_raw, str) and et_raw:
                            try:
                                et_val = datetime.fromisoformat(et_raw)
                            except Exception:
                                et_val = datetime.now(IST)
                        elif et_raw is None:
                            et_val = datetime.now(IST)
                        else:
                            et_val = datetime.now(IST)
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
                            entry_time=et_val,
                            current_price=pos_data.get('current_price', 0.0),
                            is_test=self.test_mode,
                            strategy_type=pos_data.get('strategy_type', ''),
                            peak_price=pos_data.get('peak_price', 0.0),
                            low_price=pos_data.get('low_price', 0.0),
                            metadata_json=_json.dumps(pos_data.get('metadata', {})) if pos_data.get('metadata') else '',
                        )
                        db.add(position)
        except Exception as e:
            console.print(f"[red]_persist_position_to_db failed for {pos_data.get('symbol','?')}: {e}[/red]")
            import traceback as _tb
            console.print(_tb.format_exc())

    def _get_all_watchlist_symbols(self) -> list:
        """Get deduplicated union of all watchlist symbols."""
        return list(set(
            list(self.watchlist) + sum(
                (wl for wl in self.strategy_watchlists.values()), []
            )
        ))

    def _start_websocket_stream(self):
        """Start or restart WebSocket live price streaming for all watchlist symbols.
        
        Reconnects if the symbol set changed since last connect.
        """
        try:
            fetcher = self._get_data_fetcher()
            if fetcher and hasattr(fetcher, 'upstox_api') and fetcher.upstox_api:
                api = fetcher.upstox_api
                symbols = self._get_all_watchlist_symbols()
                if not symbols:
                    return
                if self._streaming_started and hasattr(self, '_ws_symbols') and set(symbols) == self._ws_symbols:
                    return
                if self._streaming_started:
                    try:
                        api.stop_realtime_streaming()
                    except Exception:
                        pass
                if api.setup_realtime_streaming(symbols, callback=api._default_tick_handler):
                    api.start_realtime_streaming()
                    self._streaming_started = True
                    self._ws_symbols = set(symbols)
                    console.print(f"[green]WebSocket live prices started for {len(symbols)} symbols[/green]")
        except Exception as e:
            console.print(f"[yellow]WebSocket stream init failed (non-fatal): {e}[/yellow]")

    def _load_positions_from_db(self):
        try:
            with self._db_session() as db:
                from db.models import Position
                query = db.query(Position).filter(
                    Position.bot_id == (self.bot_config.id if self.bot_config else 0),
                )
                # For live bots, exclude test positions — prevents test pollution.
                # For test_mode, do not filter strictly to preserve existing test expectations
                # (legacy rows with is_test=False should still restore in tests).
                if not self.test_mode:
                    try:
                        query = query.filter(Position.is_test == False)
                    except Exception:
                        pass
                positions = query.all()
                if positions:
                    restored = 0
                    for p in positions:
                        try:
                            # Robust metadata parsing — corrupted json must not drop the position
                            metadata = {}
                            raw_meta = getattr(p, 'metadata_json', None)
                            if raw_meta:
                                try:
                                    metadata = _json.loads(raw_meta)
                                    if not isinstance(metadata, dict):
                                        metadata = {}
                                except Exception as je:
                                    console.print(f"[yellow]Corrupted metadata for {p.symbol}: {je} — using empty[/yellow]")
                                    metadata = {}
                            pos_data = {
                                'strategy_id': p.strategy_id or 0,
                                'strategy_name': p.strategy_name or '',
                                'symbol': p.symbol,
                                'side': p.side,
                                'quantity': p.quantity,
                                'entry_price': p.entry_price,
                                'stop_loss': self._safe_stop_loss(p),
                                'take_profit': self._safe_take_profit(p),
                                'entry_time': p.entry_time.isoformat() if p.entry_time else None,
                                'current_price': p.current_price or p.entry_price,
                                'peak_price': self._safe_peak_price(p, p.entry_price),
                                'low_price': self._safe_low_price(p, p.entry_price),
                                'strategy_type': getattr(p, 'strategy_type', '') or '',
                                'metadata': metadata,
                            }
                            self.portfolio.restore_position(pos_data)
                            restored += 1
                        except Exception as e:
                            console.print(f"[yellow]Failed to restore position {p.symbol}: {e}[/yellow]")
                    if restored > 0:
                        console.print(f"[green]Restored {restored} positions from database[/green]")

                        now = self._ist_now()
                        # Normalize now to IST-aware before date extraction
                        if now.tzinfo is None:
                            now = now.replace(tzinfo=IST)
                        today = now.astimezone(IST).date()
                        today_symbols = set()
                        for pos in self.portfolio.positions.values():
                            et = pos.entry_time
                            if et is None:
                                continue
                            # Normalize entry_time to IST date — handles UTC-stored rows
                            if et.tzinfo is None:
                                et = et.replace(tzinfo=IST)
                            else:
                                et = et.astimezone(IST)
                            entry_date = et.date()
                            if entry_date >= today:
                                today_symbols.add(pos.symbol)

                        if today_symbols:
                            console.print(f"[dim]Fetching fresh prices for {len(today_symbols)} symbols...[/dim]")
                            fetcher = self._get_data_fetcher()
                            if fetcher:
                                close_prices = {}
                                for symbol in today_symbols:
                                    try:
                                        _p = self._fetch_live_price(symbol)
                                        if _p is not None:
                                            close_prices[symbol] = _p
                                    except Exception as e:
                                        console.print(f"[dim red]Price fetch failed for {symbol}: {e}[/dim red]")
                                if close_prices:
                                    self.portfolio.update_prices(close_prices)
                                    console.print(f"[green]Updated prices for {len(close_prices)} symbols[/green]")
                                    for key, pos in self.portfolio.positions.items():
                                        self._persist_position_to_db(pos, action="upsert")

                        def _is_swing_position(pos) -> bool:
                            """Return True if position belongs to a swing strategy (multi-day hold)."""
                            # Primary: Position.strategy_type column
                            st = (getattr(pos, 'strategy_type', '') or '').upper()
                            if st in SWING_STRATEGY_TYPES:
                                return True
                            if st and st not in SWING_STRATEGY_TYPES:
                                # Explicit intraday type — not swing
                                # Fall through to check runner as confirmation, but already intraday
                                pass
                            # Fallback: runner config for that strategy_id (covers legacy rows with empty type)
                            runner = self.strategies.get(getattr(pos, 'strategy_id', None))
                            if runner:
                                rt = (getattr(runner, 'strategy_type', '') or '').upper()
                                if rt in SWING_STRATEGY_TYPES:
                                    return True
                                cfg_type = (runner.config.get('strategy_type', '') or '').upper() if hasattr(runner, 'config') and isinstance(runner.config, dict) else ''
                                if cfg_type in SWING_STRATEGY_TYPES:
                                    return True
                                # If runner is known intraday, not swing
                                if rt or cfg_type:
                                    return False
                            # Unknown strategy — conservative: keep to avoid accidental loss, log
                            if not st:
                                console.print(f"[yellow]Unknown strategy type for {pos.symbol} (id={getattr(pos,'strategy_id',0)}) — keeping to avoid data loss[/yellow]")
                                return True
                            return False

                        to_close = []
                        for key, pos in list(self.portfolio.positions.items()):
                            et = pos.entry_time
                            if et is None:
                                # No entry time — cannot determine staleness, keep and warn
                                console.print(f"[yellow]Skipping stale check for {pos.symbol}: missing entry_time[/yellow]")
                                continue
                            if et.tzinfo is None:
                                et = et.replace(tzinfo=IST)
                            else:
                                et = et.astimezone(IST)
                            entry_date = et.date()
                            if entry_date < today:
                                if _is_swing_position(pos):
                                    console.print(f"[cyan]Keeping swing position {pos.symbol} ({getattr(pos,'strategy_type','') or 'SWING'}) from {entry_date} — multi-day hold[/cyan]")
                                    continue
                                to_close.append((key, pos))
                        if to_close:
                            closed = 0
                            for key, pos in to_close:
                                exit_price = pos.current_price or pos.entry_price
                                if exit_price <= 0:
                                    console.print(f"[yellow]Skipping stale close for {pos.symbol}: invalid exit_price {exit_price}[/yellow]")
                                    continue
                                side = self._side_str(pos.side, "LONG_SHORT")
                                costs = self._calc_costs(pos.entry_price, exit_price, pos.quantity, side)
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
                                    closed += 1
                                    # Structured log wherever needed — console + logger hook
                                    try:
                                        import logging
                                        logging.getLogger("trading.runner").info(
                                            "force_close stale intraday",
                                            extra={"symbol": pos.symbol, "strategy_id": pos.strategy_id, "entry_date": str(entry_date), "exit_price": exit_price}
                                        )
                                    except Exception:
                                        pass
                            console.print(f"[yellow]Closed {closed}/{len(to_close)} stale intraday positions from previous days (swings kept)[/yellow]")
                        else:
                            console.print(f"[dim]No stale intraday positions to close — all {len(self.portfolio.positions)} positions current[/dim]")
        except Exception as e:
            console.print(f"[red] _load_positions_from_db failed: {e}[/red]")
            import traceback as _tb
            console.print(_tb.format_exc())

    def is_market_open(self) -> bool:
        from trading.utils import is_market_open as _is_market_open
        return _is_market_open(self._ist_now())

    def is_trading_hours(self) -> bool:
        from trading.utils import is_trading_hours as _is_trading_hours
        return _is_trading_hours(self._ist_now())

    def is_force_exit_time(self) -> bool:
        from trading.utils import is_force_exit_time
        return is_force_exit_time(self._ist_now())

    def refresh_watchlist(self, strategy_id=None):
        """Refresh watchlist - per strategy if strategy_id provided."""
        if strategy_id is not None and strategy_id in self.strategies:
            return self._refresh_strategy_watchlist(strategy_id)

        console.print("\n[cyan]Refreshing shared watchlist from screener...[/cyan]")

        if not _ensure_scanner_paths():
            console.print(f"[red]Cannot resolve scanner module path[/red]")
            self.watchlist = DEFAULT_WATCHLIST.copy()
            return self.watchlist

        try:
            import trending_upside as _tu
            df = _tu.fetch_trending_stocks(limit=TRENDING_LIMIT, profile='trending')

            if df is None or df.empty:
                console.print("[yellow]No stocks from screener - using default watchlist[/yellow]")
                if not self.watchlist:
                    self.watchlist = DEFAULT_WATCHLIST.copy()
                return self.watchlist

            self.watchlist = df['name'].tolist()[:WATCHLIST_SHARED_CAP]
            console.print(f"[green]Watchlist updated: {len(self.watchlist)} stocks[/green]")

            table = Table(title="Shared Watchlist")
            table.add_column("#", width=3)
            table.add_column("Symbol")
            table.add_column("Price", justify="right")

            for i, (_, row) in enumerate(df.head(WATCHLIST_SHARED_CAP).iterrows(), 1):
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
            valid = []
            for s in custom_symbols:
                s = s.strip().upper()
                if s and len(s) <= 20 and s.isascii():
                    valid.append(s)
                else:
                    console.print(f"[yellow]Skipping invalid custom_watchlist symbol: '{s}'[/yellow]")
            custom_symbols = valid
            console.print(f"[cyan]Custom watchlist for strategy {strategy_id}: {custom_symbols}[/cyan]")

        console.print(f"[cyan]Refreshing watchlist for strategy {strategy_id} ({strategy_type}) with profiles: {profiles}[/cyan]")

        all_symbols = list(custom_symbols)

        if not _ensure_scanner_paths():
            console.print(f"[red]Cannot resolve scanner module path[/red]")
            return self.watchlist

        for profile in profiles:
            for attempt in range(3):
                try:
                    import trending_upside as _tu
                    df = _tu.fetch_trending_stocks(limit=TRENDING_LIMIT, profile=profile)
                    if df is not None and not df.empty:
                        all_symbols.extend(df['name'].tolist())
                    break
                except Exception as e:
                    if attempt < 2:
                        console.print(f"[yellow]Retry {attempt+1}/3 for profile {profile}: {e}[/yellow]")
                        import time as _time
                        _time.sleep(2)
                    else:
                        console.print(f"[yellow]Error screening with profile {profile} after 3 attempts: {e}[/yellow]")

        if not all_symbols:
            # Fallback to shared watchlist or default — store it so scan doesn't silently fall through
            result = (self.watchlist or DEFAULT_WATCHLIST).copy()
            self.strategy_watchlists[strategy_id] = result
            console.print(f"[yellow]Strategy {strategy_id} watchlist: screener returned empty, using fallback ({len(result)} stocks)[/yellow]")
            return result

        # Deduplicate while preserving order
        seen = set()
        unique_symbols = []
        for s in all_symbols:
            if s not in seen:
                seen.add(s)
                unique_symbols.append(s)

        # Store per-strategy watchlist (capped to avoid API rate limits)
        self.strategy_watchlists[strategy_id] = unique_symbols[:WATCHLIST_STRATEGY_CAP]
        console.print(f"[green]Strategy {strategy_id} watchlist updated: {len(unique_symbols[:WATCHLIST_STRATEGY_CAP])} stocks[/green]")
        return self.strategy_watchlists[strategy_id]

    def persist_state(self):
        try:
            with self._db_session() as db:
                from db.models import BotRuntimeState, StrategyRuntimeState
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
                watchlist_data = {
                    "shared": self.watchlist or [],
                    "per_strategy": {
                        str(sid): symbols
                        for sid, symbols in self.strategy_watchlists.items()
                    },
                }
                bot_state.watchlist = _json.dumps(watchlist_data)
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
        except Exception as e:
            import traceback as _tb
            console.print(f"[red]persist_state bot/strategy state failed: {e}[/red]")
            console.print(_tb.format_exc())

        self._persist_scan_items_to_redis()
        self._persist_scan_items_to_db()

    def _build_scan_items(self) -> list:
        now_ts = self._ist_now().isoformat()
        items = []
        for strategy_id, runner in self.strategies.items():
            for item in getattr(runner, 'last_scan_items', []):
                item_copy = dict(item)
                item_copy['strategy_name'] = runner.strategy_name
                item_copy['strategy_id'] = strategy_id
                item_copy['strategy_type'] = getattr(runner, 'strategy_type', '')
                item_copy['timestamp'] = now_ts
                items.append(item_copy)
        return items

    def _has_meaningful_scan_items(self, items: list) -> bool:
        """Check if scan_items have any data worth persisting.

        Returns True if at least one item is a real 'watching'/'signal' result
        OR at least one skipped item carries a non-rate-limit reason.  A
        snapshot where *every* item was skipped purely due to rate-limiting /
        data-unavailable is not meaningful: persisting it would overwrite the
        last good snapshot (Redis TTL 300s) with a wall of error rows.

        ADX skipped rows with e.g. 'ADX 18 < 25' must be considered
        meaningful so the watchlist stays populated and the stale-window
        logic in api/bot_state can keep it fresh.
        """
        if not items:
            return False
        has_non_rate_limited = False
        for item in items:
            status = item.get('status')
            if status in ('watching', 'signal'):
                return True
            reason = (item.get('reason') or '')
            is_rate_limited = any(
                tok in reason.lower() for tok in ('rate limit', 'rate-limited', 'unavailable', 'error')
            )
            if status == 'skipped' and not is_rate_limited:
                has_non_rate_limited = True
            elif status != 'skipped':
                has_non_rate_limited = True
        # Non-empty and not exclusively rate-limited skips → meaningful (persist).
        if has_non_rate_limited:
            return True
        return False

    def _persist_scan_items_to_redis(self):
        scan_items = self._build_scan_items()
        if not self._has_meaningful_scan_items(scan_items):
            return
        try:
            from cache.redis_client import get_redis_client
            client = get_redis_client()
            if client is not None:
                client.setex(
                    f"bot:{self.bot_config.id}:scan_items",
                    REDIS_SCAN_TTL,
                    _json.dumps(scan_items),
                )
        except Exception as e:
            console.print(f"[yellow]persist scan_items Redis failed: {e}[/yellow]")

    def _persist_scan_items_to_db(self):
        scan_items = self._build_scan_items()
        if not self._has_meaningful_scan_items(scan_items):
            return
        try:
            with self._db_session() as db:
                from db.models import BotRuntimeState
                bot_state = db.query(BotRuntimeState).filter(
                    BotRuntimeState.bot_id == self.bot_config.id
                ).first()
                if bot_state:
                    bot_state.scan_items = _json.dumps(scan_items)
        except Exception as e:
            console.print(f"[yellow]persist scan_items DB failed: {e}[/yellow]")

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

    def _reload_strategy_config(self, strategy_id: int) -> bool:
        """Re-read strategy config from DB and update in-memory runner.config.

        Returns True if config changed, False otherwise.
        """
        runner = self.strategies.get(strategy_id)
        if not runner:
            return False
        try:
            from db.models import StrategyConfig as _SC
            SessionLocal = _get_session_local()
            with SessionLocal() as db:
                fresh = db.query(_SC).filter(_SC.id == strategy_id).first()
                if not fresh:
                    return False
                new_config = fresh.to_dict()
                old_config = runner.config
                if new_config.get('updated_at') != old_config.get('updated_at'):
                    runner.config = new_config
                    console.print(f"[green]Reloaded config for strategy {runner.strategy_name}[/green]")
                    return True
        except Exception as e:
            console.print(f"[yellow]Could not reload strategy {strategy_id} config: {e}[/yellow]")
        return False

    def start_all_strategies(self):
        """Start all strategies."""
        for strategy_id in self.strategies:
            self.start_strategy(strategy_id)

    def stop_all_strategies(self):
        """Stop all strategies."""
        for strategy_id in self.strategies:
            self.stop_strategy(strategy_id)

    def run(self, interval: int | None = None):
        """
        Run the multi-strategy trading loop.

        Args:
            interval: Seconds between scan cycles. If None, computed from strategy configs.
        """
        if interval is None:
            interval = min(
                (s.config.get('scan_interval_secs', 5) for s in self.strategies.values()),
                default=5,
            )
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
                self._cycle_data_cache.clear()

                try:
                    now_ist = self._ist_now()
                    if now_ist.date() != self.portfolio.day_start:
                        console.print(f"[yellow]Day changed ({self.portfolio.day_start} → {now_ist.date()}), resetting daily counters[/yellow]")
                        self.portfolio.reset_daily()
                        if self.risk_manager:
                            self.risk_manager.reset_daily()
                        self._daily_summary_sent = False

                    print(f"\n--- Cycle {cycle} @ {now_ist.strftime('%H:%M:%S')} ---")

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

                    # Start WebSocket (reconnects if symbol set changed)
                    if cycle == 1 or cycle % 10 == 0:
                        self._start_websocket_stream()

                    # Monitor positions FIRST — exits before entries
                    self.monitor_positions()

                    # Periodic config reload from DB (every 30 cycles)
                    if cycle % 30 == 0 and cycle != 1:
                        for sid in list(self.strategies.keys()):
                            self._reload_strategy_config(sid)

                    for strategy_id, runner in self.strategies.items():
                        try:
                            if runner.status == "running":
                                # Refresh per-strategy watchlist periodically (every 30 cycles)
                                if cycle % 30 == 0:
                                    self.refresh_watchlist(strategy_id)
                                    self._start_websocket_stream()
                                if runner.strategy_type in SWING_STRATEGY_TYPES and cycle != 1 and cycle % 10 != 0:
                                    continue
                                signals = self.scan_for_signals(strategy_id)
                                for signal in signals:
                                    try:
                                        self.execute_signal(strategy_id, signal)
                                    except Exception as e:
                                        console.print(f"[red]execute_signal error ({strategy_id}): {e}[/red]")
                        except Exception as e:
                            # Isolate per-strategy failures so one flaky strategy
                            # (e.g. a symbol that makes check_entry raise) doesn't
                            # stall every other strategy this cycle or skip the
                            # persist/command-file handling below.
                            console.print(f"[red]scan_for_signals error ({strategy_id}): {e}[/red]")
                            import traceback as tb
                            console.print(tb.format_exc())

                    self._persist_scan_items_to_redis()
                    self._check_command_file()

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

                    if cycle % 30 == 0:
                        self.display_status()

                    if cycle % 6 == 0:
                        self.persist_state()

                    if self.running and not self.is_force_exit_time():
                        if cycle % 10 == 0:
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
                    # Skip swing strategy positions — they carry over between days
                    runner = self.strategies.get(pos.strategy_id)
                    if runner and runner.strategy_type in SWING_STRATEGY_TYPES:
                        continue
                    side = self._side_str(pos.side, "LONG_SHORT")
                    costs = self._calc_costs(pos.entry_price, pos.current_price, pos.quantity, side)
                    trade = self.portfolio.close_position(
                        strategy_id=pos.strategy_id, symbol=pos.symbol,
                        exit_price=pos.current_price, exit_reason="FORCE_CLOSE",
                        costs=costs, exit_time=market_close,
                    )
                    if on_event and trade:
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
