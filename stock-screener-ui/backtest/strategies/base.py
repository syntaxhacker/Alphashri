"""
Base Strategy Class

Abstract interface for all trading strategies.
"""

from abc import ABC, abstractmethod
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict


@dataclass
class StrategyParam:
    """Configuration parameter for a strategy."""
    key: str
    label: str
    type: str  # 'number', 'select', 'boolean'
    default: Any
    min: Optional[float] = None
    max: Optional[float] = None
    step: Optional[float] = None
    options: Optional[List[str]] = None

    def to_dict(self):
        return asdict(self)


class BaseStrategy(ABC):
    """Abstract base class for all trading strategies."""

    @classmethod
    @abstractmethod
    def get_name(cls) -> str:
        """Return strategy display name."""
        pass

    @classmethod
    @abstractmethod
    def get_description(cls) -> str:
        """Return strategy description."""
        pass

    @classmethod
    @abstractmethod
    def get_params(cls) -> List[StrategyParam]:
        """Return list of configurable parameters."""
        pass

    @abstractmethod
    def validate_params(self, params: Dict) -> List[str]:
        """
        Validate strategy parameters.

        Returns:
            List of error messages (empty if valid)
        """
        pass

    @abstractmethod
    def run(self, symbols: List[str], days: int, params: Dict,
            progress_callback=None) -> Dict:
        """
        Run backtest for given symbols and parameters.

        Args:
            symbols: List of stock symbols to backtest
            days: Number of days of historical data
            params: Strategy-specific parameters
            progress_callback: Optional callback for progress updates

        Returns:
            Dict with results, chart_data, and metadata
        """
        pass

    def get_visuals(self, trades: List[Dict], params: Dict) -> List[Dict]:
        """
        Return a list of chart visuals (overlays) for the given trades.
        Each overlay is a dict with type, id, label, color, levels, etc.
        """
        return []

    def get_default_params(self) -> Dict:
        """Get default parameter values."""
        return {p.key: p.default for p in self.get_params()}

    # --- Common multi-stock run execution to DRY the near-identical pool/sequential + aggregation
    # boilerplate in chaser/target/sr/orb Strategy.run() methods (addresses 20-60 line clones).
    # Subclasses call this from their run(), supplying prebuilt worker_args (to support token passing) and flags for shape.
    def run_backtests(
        self,
        symbols: List[str],
        days: int,
        params: Dict,
        run_single_func,
        worker_args: List[tuple],
        progress_callback=None,
        strategy_key: str = 'unknown',
        use_parallel: Optional[bool] = None,
        include_config: bool = True,
        include_run_time: bool = True,
        extra_result_fields: Optional[Dict] = None,
    ) -> Dict:
        """
        Executes per-symbol backtests (parallel if requested and >1 symbols), aggregates,
        builds chart_data etc. Keeps exact prior output shapes via flags.
        Pass worker_args already built (e.g. with access_token) so run_single unpacking works as before.
        """
        from multiprocessing import Pool, cpu_count

        results = []
        chart_data = {}
        all_candles = {}
        skipped_stocks = []

        total = len(symbols)
        completed = 0
        num_workers = min(4, cpu_count() or 4, max(1, total))
        do_parallel = use_parallel if use_parallel is not None else (total > 1 and num_workers > 1)

        if do_parallel:
            if progress_callback:
                progress_callback(0, total, f"Starting parallel backtest with {num_workers} workers...")
            with Pool(processes=num_workers) as pool:
                for result in pool.imap_unordered(run_single_func, worker_args, chunksize=2):
                    completed += 1
                    if progress_callback:
                        progress_callback(completed, total, f"Completed {result.get('symbol', '?')}...")
                    if not result.get('success', False):
                        skipped_stocks.append({'symbol': result.get('symbol'), 'error': result.get('error', 'Unknown')})
                        continue
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
            for args in worker_args:
                completed += 1
                result = run_single_func(args)
                if progress_callback:
                    progress_callback(completed, total, f"Completed {result.get('symbol', '?')}...")
                if not result.get('success', False):
                    skipped_stocks.append({'symbol': result.get('symbol'), 'error': result.get('error', 'Unknown')})
                    continue
                if result.get('candles'):
                    all_candles[result['symbol']] = result['candles']
                if result.get('result'):
                    results.append(result['result'])
                if result.get('trade_list'):
                    chart_data[result['symbol']] = {
                        'trades': result['trade_list'],
                        'visuals': self.get_visuals(result['trade_list'], params)
                    }

        total_gross = sum(r.get('gross_pnl', 0) for r in results)
        total_costs = sum(r.get('total_costs', 0) for r in results)
        total_net = sum(r.get('net_pnl', 0) for r in results)
        total_trades = sum(r.get('trades', 0) for r in results)
        total_wins = sum(r.get('wins', 0) for r in results)
        total_win_rate = (total_wins / total_trades * 100) if total_trades > 0 else 0

        out: Dict[str, Any] = {
            'strategy': strategy_key,
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
        }
        if include_config:
            out['config'] = {
                'symbols': symbols,
                'days': days,
                'params': params,
            }
        if include_run_time:
            out['run_time'] = datetime.now().isoformat()
        if extra_result_fields:
            out.update(extra_result_fields)
        return out


# =============================================================================
# Nautilus backtest shared support (DRY for 52W family + sr_breakout/orb)
# - NautilusBacktestMixin: general helpers (cooldown bars, submit, pnl calc, hold, peak, build trade, run_backtests on BaseStrategy)
# - Week52NautilusMixin(NautilusBacktestMixin): 52W + extended on_bar skeletons (_try_enter, _check_and_exit, hooks)
# All edits in this file per rules. Behavior/trade dicts/debug/prints/Nautilus identical.
# =============================================================================

import sys
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone

import config
IST = config.IST

# Soft import nautilus bits so base.py remains importable without nautilus (e.g. for registry)
try:
    from nautilus_trader.trading.strategy import Strategy
    from nautilus_trader.config import StrategyConfig
    from nautilus_trader.model.enums import OrderSide
    from nautilus_trader.model.objects import Quantity
    _NAUTILUS_AVAILABLE = True
except ImportError:
    Strategy = object  # type: ignore
    StrategyConfig = object  # type: ignore
    OrderSide = None  # type: ignore
    Quantity = None  # type: ignore
    _NAUTILUS_AVAILABLE = False

# We also soft-import pandas only when needed inside methods (to keep top level light)
# from trading.week52_utils import ... will be done inside methods to avoid cycles / dep order


def get_ist_time(ts_ns: int) -> tuple:
    """Convert nanosecond timestamp to IST time components. Shared to eliminate dup in sr_breakout/orb (and ema)."""
    ts_sec = ts_ns / 1_000_000_000
    dt_utc = datetime.fromtimestamp(ts_sec, tz=timezone.utc)
    dt_ist = dt_utc.astimezone(IST)
    return dt_ist.hour, dt_ist.minute, dt_ist.date()


class NautilusBacktestMixin:
    """
    General mixin for common Nautilus backtest strategy boilerplate (intraday breakout style + some 52W overlap).

    Provides:
    - Cooldown check by bar count (used by sr/orb)
    - Market order submit for long/short
    - Side-aware PnL + costs calculation
    - Hold time calc
    - Peak/low update helpers
    - Common result post-processing skeleton (can be used by wrappers too)

    52W strategies use their own Week52NautilusMixin which can also inherit this.
    Subclasses declare their state attrs; call the helpers from their on_bar/_check_entry etc.
    """

    def _is_in_cooldown_bars(self, bar_number: int, last_exit_bar: Optional[int], cooldown_bars: int) -> bool:
        """Common cooldown check for bar-based (intraday) cooldowns. Returns True if still cooling."""
        if last_exit_bar is None or cooldown_bars <= 0:
            return False
        return (bar_number - last_exit_bar) < cooldown_bars

    def _submit_market_entry(self, is_long: bool = True) -> None:
        """Shared order submission for long or short entry."""
        if not _NAUTILUS_AVAILABLE:
            raise RuntimeError("Nautilus not available")
        order_side = OrderSide.BUY if is_long else OrderSide.SELL
        order = self.order_factory.market(
            instrument_id=self._instrument_id,
            order_side=order_side,
            quantity=Quantity.from_str(str(self._trade_size)),
        )
        self.submit_order(order)

    def _calc_pnl_and_costs(self, entry_price: float, exit_price: float, qty: int, side: str = "LONG") -> Dict[str, float]:
        """Side-aware gross/net PnL + trading costs. Returns dict with keys used in trade records."""
        if side == "SHORT":
            gross_pnl = (entry_price - exit_price) * abs(qty)
            gross_pnl_pct = ((entry_price - exit_price) / entry_price) * 100 if entry_price > 0 else 0.0
        else:
            gross_pnl = (exit_price - entry_price) * abs(qty)
            gross_pnl_pct = ((exit_price - entry_price) / entry_price) * 100 if entry_price > 0 else 0.0

        # Local import to match prior pattern and avoid top-level issues
        from ..costs import calculate_trading_costs
        costs = calculate_trading_costs(entry_price, exit_price, abs(qty))

        net_pnl = gross_pnl - costs['total_costs']
        net_pnl_pct = (net_pnl / (entry_price * abs(qty))) * 100 if entry_price > 0 and qty != 0 else 0.0

        return {
            'gross_pnl': gross_pnl,
            'gross_pnl_pct': gross_pnl_pct,
            'trading_costs': costs['total_costs'],
            'net_pnl': net_pnl,
            'net_pnl_pct': net_pnl_pct,
        }

    def _calc_hold_minutes(self, entry_time: Optional[datetime], exit_time: Optional[datetime]) -> int:
        if entry_time and exit_time:
            return int((exit_time - entry_time).total_seconds() / 60)
        return 0

    def _update_position_peak_low(self, high_f: float, low_f: float) -> None:
        """For strategies that track peak/low (e.g. orb). Safe if attrs missing."""
        if hasattr(self, '_position_peak') and self._position_peak is not None:
            if high_f > self._position_peak:
                self._position_peak = high_f
        if hasattr(self, '_position_low') and self._position_low is not None:
            if low_f < self._position_low:
                self._position_low = low_f

    def _build_common_trade_record(
        self,
        entry_price: float,
        exit_price: float,
        entry_time: Optional[datetime],
        exit_time: Optional[datetime],
        qty: int,
        side: str,
        exit_reason: str,
        extra: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        """Builds the common parts of a trade record; caller adds strategy-specific like pivots/or/52w."""
        pnl = self._calc_pnl_and_costs(entry_price, exit_price, qty, side)
        hold = self._calc_hold_minutes(entry_time, exit_time)

        rec: Dict[str, Any] = {
            'entry_price': round(entry_price, 2) if isinstance(entry_price, (int, float)) else entry_price,
            'exit_price': round(exit_price, 2) if isinstance(exit_price, (int, float)) else exit_price,
            'entry_time': entry_time.strftime('%Y-%m-%dT%H:%M') if entry_time else None,
            'exit_time': exit_time.strftime('%Y-%m-%dT%H:%M') if exit_time else None,
            'quantity': abs(qty),
            'gross_pnl': round(pnl['gross_pnl'], 2),
            'gross_pnl_pct': round(pnl['gross_pnl_pct'], 2),
            'trading_costs': round(pnl['trading_costs'], 2),
            'net_pnl': round(pnl['net_pnl'], 2),
            'net_pnl_pct': round(pnl['net_pnl_pct'], 2),
            'exit_reason': exit_reason,
            'hold_duration_minutes': hold,
            'date': entry_time.strftime('%Y-%m-%d') if entry_time else None,
            'side': side,
        }
        if extra:
            rec.update(extra)
        return rec


class Week52NautilusMixin(NautilusBacktestMixin):
    """
    Mixin with common 52W boilerplate for Nautilus-based strategies (now extends NautilusBacktestMixin).

    - Uses Week52HighTracker...
    - Common _enter_long / _exit_long ...
    - Plus new: _update_peak, _try_enter_position, _check_and_exit_if_needed + _should_enter/_determine_exit_reason hooks.
    - This + prior further reduces the on_bar / entry/exit / cooldown / trailing / peak blocks between chaser/target and cross to sr/orb.

    Subclasses ... same as before.
    """

    # --- 52W tracking (delegates to shared tracker, syncs legacy names for test compat) ---

    def _init_52w_tracker(self, min_periods: int = 20) -> None:
        from trading.week52_utils import Week52HighTracker
        self._52w_tracker = Week52HighTracker(period=252, min_periods=min_periods)
        # Initialize legacy containers so direct access in tests and on_reset work
        if not hasattr(self, '_high_prices') or self._high_prices is None:
            self._high_prices: List[float] = []
        if not hasattr(self, '_price_history') or self._price_history is None:
            self._price_history: List[float] = []
        if not hasattr(self, '_current_52w_high'):
            self._current_52w_high: Optional[float] = None
        if not hasattr(self, '_52w_high'):
            self._52w_high: Optional[float] = None

    def _update_52w_high(self, high_price: float) -> Optional[float]:
        """Update shared tracker and sync to whatever legacy names the subclass declared."""
        if not hasattr(self, '_52w_tracker') or self._52w_tracker is None:
            self._init_52w_tracker()
        tracker = self._52w_tracker
        # Support tests that manually poke _price_history/_high_prices (and _52w_high) before on_bar
        # Seed tracker from the poked history if tracker is empty (common in exit unit tests).
        if len(getattr(tracker, '_high_prices', [])) == 0:
            hist = None
            if hasattr(self, '_price_history') and self._price_history:
                hist = self._price_history
            elif hasattr(self, '_high_prices') and self._high_prices:
                hist = self._high_prices
            if hist:
                for h in hist:
                    tracker._high_prices.append(float(h))
                if len(tracker._high_prices) > tracker.period:
                    tracker._high_prices[:] = tracker._high_prices[-tracker.period:]
        val = tracker.update(high_price)
        # sync lists (use same list object for efficiency where possible)
        if hasattr(self, '_high_prices'):
            self._high_prices = tracker._high_prices
        if hasattr(self, '_price_history'):
            self._price_history = tracker._high_prices
        # sync current value to both common names
        if hasattr(self, '_current_52w_high'):
            self._current_52w_high = val
        if hasattr(self, '_52w_high'):
            self._52w_high = val
        return val

    # --- Cooldown / bar counting (common pattern) ---
    # Note: original chaser and target had slightly different inc/check ordering;
    # we provide primitives so each can preserve its exact prior behavior.

    def _is_in_cooldown(self) -> bool:
        """Pure check (no mutation)."""
        cooldown_bars = getattr(self, '_cooldown_bars', getattr(self, '_cooldown_days', 30))
        return getattr(self, '_bars_since_exit', 0) < cooldown_bars

    def _increment_cooldown_if_not_in_position(self) -> None:
        if not getattr(self, '_in_position', False):
            self._bars_since_exit = getattr(self, '_bars_since_exit', 0) + 1

    # --- Common enter / exit with configurability for per-strategy diffs ---

    def _common_enter_long(self, price: float, high_52w: Optional[float], bar_time: datetime) -> None:
        """Shared order submit + state setup. Subclasses call this then tweak specifics if needed."""
        if not _NAUTILUS_AVAILABLE:
            raise RuntimeError("Nautilus not available")

        order = self.order_factory.market(
            instrument_id=self._instrument_id,
            order_side=OrderSide.BUY,
            quantity=Quantity.from_str(str(self._trade_size)),
        )
        self.submit_order(order)

        price_f = float(price)
        high_f = float(high_52w) if high_52w is not None else None

        self._entry_price = price_f
        self._entry_52w_high = high_f
        self._highest_price_since_entry = price_f
        self._bars_in_trade = 0
        self._in_position = True
        self._current_entry_time = bar_time
        if hasattr(self, '_entry_time'):
            self._entry_time = bar_time
        self._bars_since_exit = 0

        # chaser specific
        if hasattr(self, '_trailing_stop_active'):
            self._trailing_stop_active = False

    def _common_exit_long(self, price: float, reason: str, bar_time: datetime, *, reset_cooldown_to: int = 0) -> None:
        """
        Shared P&L calc, trade recording, close, state reset.
        reset_cooldown_to allows target (1) vs chaser (0) slight timing diff to be preserved.
        """
        if not getattr(self, '_in_position', False):
            return

        price_f = float(price)
        entry_price = float(self._entry_price) if self._entry_price is not None else 0.0
        trade_size = getattr(self, '_trade_size', 100)

        # Close first (matches both impls order)
        self.close_all_positions(self._instrument_id)

        gross_pnl = (price_f - entry_price) * trade_size
        pnl_pct = ((price_f - entry_price) / entry_price) * 100 if entry_price > 0 else 0.0

        # Local import to avoid top-level backtest dep issues
        from ..costs import calculate_trading_costs
        costs = calculate_trading_costs(entry_price, price_f, trade_size)

        net_pnl = gross_pnl - costs['total_costs']
        net_pnl_pct = (net_pnl / (entry_price * trade_size)) * 100 if entry_price > 0 else 0.0

        hold_days = getattr(self, '_bars_in_trade', 0)

        entry_time = getattr(self, '_current_entry_time', None) or getattr(self, '_entry_time', None)
        entry_date_str = entry_time.strftime('%Y-%m-%dT%H:%M') if entry_time else bar_time.strftime('%Y-%m-%dT%H:%M')
        entry_date_only = entry_time.strftime('%Y-%m-%d') if entry_time else bar_time.strftime('%Y-%m-%d')

        trade_record: Dict[str, Any] = {
            'entry_price': round(entry_price, 2),
            'exit_price': round(price_f, 2),
            'entry_time': entry_date_str,
            'exit_time': bar_time.strftime('%Y-%m-%dT%H:%M'),
            'quantity': trade_size,
            'gross_pnl': round(gross_pnl, 2),
            'gross_pnl_pct': round(pnl_pct, 2),
            'trading_costs': round(costs['total_costs'], 2),
            'net_pnl': round(net_pnl, 2),
            'net_pnl_pct': round(net_pnl_pct, 2),
            'exit_reason': reason,
            'hold_duration_minutes': hold_days * 24 * 60,
            'date': entry_date_only,
            'side': 'LONG',
        }

        # Strategy-specific extra fields (preserve exact output shape and key names)
        # Chaser declares _trailing_stop_active -> gets '52w_high' + 'trailing_active'
        # Target does not -> gets '52w_high_entry' (exact prior shape)
        entry_52w = getattr(self, '_entry_52w_high', None)
        val = round(entry_52w, 2) if entry_52w is not None else None
        if hasattr(self, '_trailing_stop_active'):
            trade_record['52w_high'] = val
            trade_record['trailing_active'] = bool(getattr(self, '_trailing_stop_active', False))
        else:
            trade_record['52w_high_entry'] = val

        if not hasattr(self, 'trades') or self.trades is None:
            self.trades = []
        self.trades.append(trade_record)

        # Reset common state
        self._entry_price = None
        self._entry_52w_high = None
        self._highest_price_since_entry = None
        self._bars_in_trade = 0
        self._in_position = False
        self._current_entry_time = None
        if hasattr(self, '_entry_time'):
            self._entry_time = None
        self._bars_since_exit = reset_cooldown_to
        if hasattr(self, '_trailing_stop_active'):
            self._trailing_stop_active = False

    # --- Reset helpers (called from on_reset) ---

    def _reset_52w_common(self) -> None:
        if hasattr(self, '_52w_tracker') and self._52w_tracker is not None:
            self._52w_tracker.reset()
        if hasattr(self, '_high_prices'):
            self._high_prices = []
        if hasattr(self, '_price_history'):
            self._price_history = []
        if hasattr(self, '_current_52w_high'):
            self._current_52w_high = None
        if hasattr(self, '_52w_high'):
            self._52w_high = None

    def _reset_common_state(self) -> None:
        """Reset fields that both strategies share. Safe to call from on_reset."""
        self._in_position = False
        self._entry_price = None
        self._entry_52w_high = None
        self._highest_price_since_entry = None
        self._bars_in_trade = 0
        self._bars_since_exit = 0
        self._current_entry_time = None
        if hasattr(self, '_entry_time'):
            self._entry_time = None
        if hasattr(self, '_trailing_stop_active'):
            self._trailing_stop_active = False
        self._reset_52w_common()
        if hasattr(self, 'trades'):
            # do not clear trades on reset typically; on_stop etc handle
            pass

    # --- Extended 52W skeleton to further DRY on_bar entry/exit blocks, peak/cooldown/update ---
    # (used by chaser + target; specific conditions via hooks to keep behavior+prints+order identical)

    def _update_peak(self, high_price: float) -> None:
        """Common peak update used in exit management (trailing, new high checks etc)."""
        if getattr(self, '_highest_price_since_entry', None) is None or high_price > self._highest_price_since_entry:
            self._highest_price_since_entry = high_price

    def _increment_trade_bars(self) -> None:
        self._bars_in_trade = getattr(self, '_bars_in_trade', 0) + 1

    def _should_enter(self, close_price: float, high_52w: Optional[float], bar_time: datetime) -> bool:
        """Override in subclass for entry price condition (e.g. distance <= thresh or close >= thresh)."""
        return False

    def _determine_exit_reason(self, close_price: float, high_price: float, high_52w: Optional[float], bar_time: datetime) -> Optional[str]:
        """Override in subclass: return 'SL'/'TP'/'TRAILING_STOP'/'MAX_HOLDING'/'NEW_52W_HIGH' or None."""
        return None

    def _try_enter_position(
        self,
        close_price: float,
        high_52w: Optional[float],
        bar_time: datetime,
        *,
        in_cooldown: Optional[bool] = None,
    ) -> None:
        """
        Common 'if not in pos and not cooldown: if should: [filter]: enter' skeleton.
        Subclass does its cooldown inc/snapshot ordering, passes the snapshot if needed, implements _should_enter.
        Preserves chaser filter logic and exact prior behavior.
        """
        if getattr(self, '_in_position', False):
            return
        if in_cooldown is None:
            in_cooldown = self._is_in_cooldown()
        if in_cooldown:
            return
        if not self._should_enter(close_price, high_52w, bar_time):
            return

        # chaser-specific filters (only if attr present and enabled)
        if getattr(self, '_enable_filters', False) and hasattr(self, '_check_entry_filters'):
            if not self._check_entry_filters(close_price, bar_time):
                return

        self._enter_long(close_price, high_52w, bar_time)

    def _check_and_exit_if_needed(
        self,
        close_price: float,
        high_price: float,
        high_52w: Optional[float],
        bar_time: datetime,
    ) -> None:
        """
        Common exit management skeleton: inc bars, update peak, determine reason via hook, exit if set.
        Replaces duplicated 'if in_pos: bars+=1; update peak; ifs for sl/tp/trail/max/new52w; if reason: exit'
        blocks. Order and side effects preserved by hook impls.
        """
        if not getattr(self, '_in_position', False):
            return
        self._increment_trade_bars()
        self._update_peak(high_price)
        exit_reason = self._determine_exit_reason(close_price, high_price, high_52w, bar_time)
        if exit_reason:
            self._exit_long(close_price, exit_reason, bar_time)
