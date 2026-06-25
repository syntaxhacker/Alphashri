"""
Signal handling and execution logic for MultiStrategyRunner.

Contains scanning, signal generation, and trade execution methods.
"""

from datetime import datetime, timedelta
from typing import Dict, List, Optional

from rich.console import Console
from trading.orb_signals import SignalType
from trading.shared_portfolio import OrderSide
from trading.strategy_runner import INTRADAY_STRATEGY_TYPES, SWING_STRATEGY_TYPES
from backtest.costs import calculate_trading_costs

console = Console()

from trading.timezone import IST
from trading.replay_utils import build_trade_close_event


class RunnerSignalsMixin:
    """Mixin class providing signal handling and execution methods for MultiStrategyRunner."""

    @staticmethod
    def _side_str(signal_or_side, fmt: str = "BUY_SELL") -> str:
        from trading.orb_signals import SignalType
        if hasattr(signal_or_side, 'signal_type'):
            return "BUY" if signal_or_side.signal_type == SignalType.LONG_ENTRY else "SELL"
        val = getattr(signal_or_side, 'value', signal_or_side)
        if fmt == "LONG_SHORT":
            return "LONG" if val == "BUY" else "SHORT"
        return val

    def _fetch_live_price(self, symbol: str) -> float | None:
        fetcher = self._get_data_fetcher()
        if not fetcher:
            return None
        df = fetcher.upstox_api.fetch_intraday_data_v3(symbol=symbol, interval='1')
        if df is not None and not df.empty:
            return float(df.iloc[-1]['close'])
        return None

    @staticmethod
    def _build_order_tag(strategy_name: str, symbol: str) -> str:
        return f"{strategy_name}_{symbol}"[:40]

    def _check_cooldown(self, symbol: str, runner) -> bool:
        if symbol not in self.cooldown_stocks:
            return False
        exit_time = self.cooldown_stocks[symbol]
        if runner.strategy_type in INTRADAY_STRATEGY_TYPES:
            cooldown_end = exit_time + timedelta(minutes=runner.config.get('cooldown_minutes', 30))
        else:
            cooldown_end = exit_time + timedelta(days=runner.config.get('cooldown_days', 30))
        if self._ist_now() < cooldown_end:
            return True
        del self.cooldown_stocks[symbol]
        return False

    def _emit_once_per_symbol(self, attr: str, strategy_id: int, symbol: str, event: dict) -> bool:
        if not self.replay_mode or not self._replay_on_event:
            return False
        key = (strategy_id, symbol)
        if key in getattr(self, attr, set()):
            return False
        if event.get("type") in ("or_levels", "pivot_levels"):
            counts = getattr(self, '_replay_symbol_candle_counts', {})
            n = counts.get(symbol, 0)
            event["from_index"] = 0
            event["to_index"] = max(n - 1, 0)
        self._replay_on_event(event)
        if not hasattr(self, attr):
            setattr(self, attr, set())
        getattr(self, attr).add(key)
        return True

    def scan_for_signals(self, strategy_id: int) -> list:
        """
        Scan watchlist for signals for a specific strategy.

        Dispatches to the appropriate scan method based on strategy type.
        Uses per-strategy watchlist if available, otherwise falls back to shared watchlist.
        """
        # Reset consecutive loss counter on new day
        losses = getattr(self, '_consecutive_losses', {})
        runner = self.strategies.get(strategy_id)
        if runner and runner.status == "paused":
            today_date = self._ist_now().date()
            paused_date = getattr(runner, '_paused_date', None)
            if paused_date != today_date:
                sid = str(runner.strategy_id)
                losses.pop(sid, None)
                runner.status = "running"
                console.print(f"[green]{runner.strategy_name}: Unpaused - new trading day[/green]")
                runner._paused_date = today_date
        self._consecutive_losses = losses

        runner = self.strategies.get(strategy_id)
        if not runner or runner.status != "running":
            return []

        # Get per-strategy watchlist or fall back to shared
        watchlist = self.strategy_watchlists.get(strategy_id, self.watchlist)

        if runner.strategy_type in INTRADAY_STRATEGY_TYPES:
            return self._scan_intraday_strategy(strategy_id, watchlist)
        elif runner.strategy_type in SWING_STRATEGY_TYPES:
            return self._scan_swing_strategy(strategy_id, watchlist)
        else:
            return self._scan_intraday_strategy(strategy_id, watchlist)

    def _scan_intraday_strategy(self, strategy_id: int, watchlist: list = None) -> list:
        """Scan for signals using intraday data (ORB, SR_BREAKOUT)."""
        runner = self.strategies.get(strategy_id)
        if not runner or runner.status != "running":
            return []

        if not self.is_trading_hours():
            return []

        # Use provided watchlist or fall back to shared watchlist
        if watchlist is None:
            watchlist = self.watchlist

        new_signals = []
        scan_items = []

        custom_watchlist_set = set(runner.config.get('custom_watchlist', []) if hasattr(runner, 'config') else [])
        if custom_watchlist_set:
            console.print(f"[cyan]Scan custom watchlist: {len(custom_watchlist_set)} stocks[/cyan]")

        for symbol in watchlist:
            key = f"{strategy_id}_{symbol}"
            if key in self.portfolio.positions:
                continue

            if self._check_cooldown(symbol, runner):
                continue

            if runner.strategy_type == "SR_BREAKOUT":
                now_ist = self._ist_now()
                min_entry_minutes = runner.config.get('min_entry_minutes', 600)
                current_minutes = now_ist.hour * 60 + now_ist.minute
                if current_minutes < min_entry_minutes:
                    continue

                prev_data = self.fetch_previous_day_data(symbol)
                if not prev_data:
                    continue

                live_price = self._fetch_live_price(symbol)

                if live_price is None:
                    continue

                gen = runner.signal_generator
                pivot_points = gen.calculate_pivot_points(
                    prev_data['prev_high'], prev_data['prev_low'], prev_data['prev_close']
                )

                if self._emit_once_per_symbol('_pivot_levels_emitted', runner.strategy_id, symbol, {
                    "type": "pivot_levels",
                    "strategy": runner.strategy_name,
                    "symbol": symbol,
                    **pivot_points,
                }):
                    pass

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
                    'source': 'custom' if symbol in custom_watchlist_set else None,
                    'timestamp': self._ist_now().isoformat(),
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
                    'source': 'custom' if symbol in custom_watchlist_set else None,
                    'timestamp': self._ist_now().isoformat(),
                }

            else:
                or_levels = self.fetch_or_data(symbol, runner=runner)
                if not or_levels:
                    scan_items.append({
                        'symbol': symbol,
                        'status': 'watching',
                        'side': None,
                        'reason': 'Data fetch failed (rate limit)',
                        'source': 'custom' if symbol in custom_watchlist_set else None,
                        'timestamp': self._ist_now().isoformat(),
                    })
                    continue

                self.or_levels[symbol] = or_levels

                current_price = or_levels.get('latest_price', or_levels['or_close'])
                or_high = or_levels['or_high']
                or_low = or_levels['or_low']
                or_range_pct = or_levels.get('or_range_pct', 0)

                if self._emit_once_per_symbol('_or_levels_emitted', runner.strategy_id, symbol, {
                    "type": "or_levels",
                    "strategy": runner.strategy_name,
                    "symbol": symbol,
                    "or_high": or_high,
                    "or_low": or_low,
                    "or_range_pct": round(or_range_pct, 2),
                }):
                    pass

                scan_item = {
                    'symbol': symbol,
                    'price': current_price,
                    'or_high': or_high,
                    'or_low': or_low,
                    'or_range_pct': or_range_pct,
                    'status': 'watching',
                    'side': None,
                    'reason': None,
                    'source': 'custom' if symbol in custom_watchlist_set else None,
                    'timestamp': self._ist_now().isoformat(),
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
                    scan_item['reason'] = signal.notes or ''

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
                    scan_item['reason'] = signal.notes or ''

                new_signals.append(signal)
                runner.signals_generated += 1
                console.print(f"[green]✓ {runner.strategy_name}: Signal {signal.signal_type.value} {signal.symbol} @ ₹{signal.price:.2f}[/green]")

            scan_items.append(scan_item)

        runner.last_scan_items = scan_items
        runner.last_scan_time = self._ist_now()
        return new_signals

    def _scan_swing_strategy(self, strategy_id: int, watchlist: list = None) -> list:
        """Scan for signals using daily data (52W_CHASER, 52W_TARGET)."""
        runner = self.strategies.get(strategy_id)
        if not runner or runner.status != "running":
            return []

        if not self.is_market_open():
            return []

        # Use provided watchlist or fall back to shared
        if watchlist is None:
            watchlist = self.watchlist

        new_signals = []
        scan_items = []

        custom_watchlist_set = set(runner.config.get('custom_watchlist', []) if hasattr(runner, 'config') else [])

        today = self._ist_now().date()
        if not hasattr(self, '_swing_entered_today'):
            self._swing_entered_today: dict = {}
        if self._swing_entered_today.get('_date') != today:
            self._swing_entered_today.clear()
            self._swing_entered_today['_date'] = today
        if strategy_id not in self._swing_entered_today:
            self._swing_entered_today[strategy_id] = set()

        for symbol in watchlist:
            key = f"{strategy_id}_{symbol}"
            if key in self.portfolio.positions:
                continue
            if symbol in self._swing_entered_today[strategy_id]:
                continue

            if self._check_cooldown(symbol, runner):
                continue

            daily_data = self.fetch_daily_data(symbol)
            if not daily_data:
                continue

            market_data = {
                'current_price': daily_data['current_price'],
                'high_52w': daily_data['high_52w'],
                'today_intraday_high': daily_data.get('today_intraday_high', 0.0),
                'days_since_52w_high': daily_data.get('days_since_52w_high', 0),
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
                'source': 'custom' if symbol in custom_watchlist_set else None,
                'timestamp': self._ist_now().isoformat(),
            }

            if signal:
                scan_item['status'] = 'signal'
                scan_item['side'] = 'LONG'
                scan_item['reason'] = signal.notes or ''

                self._swing_entered_today[strategy_id].add(symbol)
                new_signals.append(signal)
                runner.signals_generated += 1
                console.print(f"[green]✓ {runner.strategy_name}: Signal {signal.signal_type.value} {symbol} @ ₹{signal.price:.2f}[/green]")
            else:
                distance_pct = ((daily_data['high_52w'] - daily_data['current_price']) / daily_data['current_price']) * 100 if daily_data['current_price'] > 0 else 0
                scan_item['status'] = 'skipped'
                scan_item['reason'] = f'52W high distance: {distance_pct:.1f}%'

            scan_items.append(scan_item)

        runner.last_scan_items = scan_items
        runner.last_scan_time = self._ist_now()
        return new_signals

    def execute_signal(self, strategy_id: int, signal: 'ORBSignal') -> bool:
        """
        Execute a trading signal for a strategy.

        Returns True if successful, False otherwise.
        """
        from trading.orb_signals import ORBSignal
        from trading.telegram_notifier import send_trade_entry, send_signal_rejected

        if self.replay_mode:
            return self._execute_replay_signal(strategy_id, signal, SignalType)

        if self.test_mode:
            console.print(f"[yellow]TEST MODE: Would execute {signal.signal_type.value} {signal.symbol} @ ₹{signal.price:.2f}[/yellow]")
            return False

        runner = self.strategies.get(strategy_id)
        if runner and hasattr(runner, 'signal_generator') and hasattr(runner.signal_generator, 'is_eod_exit_time'):
            now = self._ist_now()
            if runner.signal_generator.is_eod_exit_time(now.hour, now.minute):
                return False

            eod_entry_cutoff_minutes = getattr(runner.signal_generator, 'eod_entry_cutoff_minutes', 15)
            if eod_entry_cutoff_minutes > 0:
                eod_dt = now.replace(hour=runner.signal_generator.eod_exit_hour, minute=runner.signal_generator.eod_exit_minute, second=0, microsecond=0)
                if eod_dt - now < timedelta(minutes=eod_entry_cutoff_minutes):
                    console.print(f"[yellow]{runner.strategy_name}: Entry blocked - within {eod_entry_cutoff_minutes}min of EOD exit ({runner.signal_generator.eod_exit_hour}:{runner.signal_generator.eod_exit_minute:02d})[/yellow]")
                    return False

        runner, validation, position = self._execute_signal_core(strategy_id, signal, SignalType)

        if not runner:
            return False

        if not validation:
            return False

        if validation.get('rejected'):
            console.print(f"[red]{runner.strategy_name}: Signal rejected - {validation['reason']}[/red]")
            for item in getattr(runner, 'last_scan_items', []):
                if item.get('symbol') == signal.symbol:
                    item['status'] = 'rejected'
                    item['reason'] = validation.get('reason', 'Risk check failed')
                    break
            send_signal_rejected(
                bot_name=self.bot_config.name,
                strategy_name=runner.strategy_name,
                symbol=signal.symbol,
                signal_type=signal.signal_type.value,
                reason=validation['reason'],
            )
            return False

        if not position:
            return False

        send_trade_entry(
            bot_name=self.bot_config.name,
            strategy_name=runner.strategy_name,
            symbol=signal.symbol,
            side=self._side_str(signal),
            price=signal.price,
            quantity=validation['shares'],
            sl=signal.stop_loss or 0.0,
            tp=signal.take_profit or 0.0,
        )
        entry_price = getattr(position, 'entry_price', signal.price)
        pos_metadata = getattr(position, 'metadata', {}) or {}
        self._persist_position_to_db({
            'strategy_id': strategy_id,
            'strategy_name': runner.strategy_name,
            'symbol': signal.symbol,
            'side': self._side_str(signal),
            'quantity': validation['shares'],
            'entry_price': entry_price,
            'stop_loss': signal.stop_loss or 0.0,
            'take_profit': signal.take_profit or 0.0,
            'entry_time': self._ist_now(),
            'current_price': signal.price,
            'strategy_type': getattr(runner, 'strategy_type', ''),
            'metadata': {**({'entry_reason': signal.notes or ''} if signal.notes else {}),
                         **({'upstox_order_id': pos_metadata.get('upstox_order_id')} if pos_metadata.get('upstox_order_id') else {})},
        }, action="upsert")
        return True

    def _execute_replay_signal(self, strategy_id: int, signal, SignalType) -> bool:
        runner, validation, position = self._execute_signal_core(strategy_id, signal, SignalType)

        if not runner or not validation or not position:
            return False

        if validation.get('rejected'):
            return False

        if self._replay_on_event:
            self._replay_on_event({
                "type": "trade_open", "strategy": runner.strategy_name,
                "symbol": signal.symbol,
                "side": self._side_str(signal),
                "price": signal.price, "sl": signal.stop_loss or 0.0,
                "tp": signal.take_profit or 0.0, "time": str(self._ist_now()),
                "quantity": validation['shares'],
            })
        return True

    def _execute_signal_core(self, strategy_id, signal, SignalType):
        runner = self.strategies.get(strategy_id)
        if not runner:
            return runner, None, None

        portfolio_status = self.portfolio.get_portfolio_status()
        strategy_status = self.portfolio.get_strategy_status(strategy_id)
        if not strategy_status:
            return runner, None, None

        symbol_exposure = self.portfolio.get_symbol_exposure(signal.symbol)
        side = self._side_str(signal)
        validation = self.risk_manager.validate_trade(
            strategy_id=strategy_id,
            strategy_name=runner.strategy_name,
            symbol=signal.symbol,
            entry_price=signal.price,
            stop_loss=signal.stop_loss,
            take_profit=signal.take_profit,
            side=side,
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
            validation['rejected'] = True
            return runner, validation, None

        # === LIVE ORDER PLACEMENT ===
        order_mgr = self._get_order_manager()
        filled_price = signal.price
        order_id = None
        if order_mgr:
            tag = self._build_order_tag(runner.strategy_name, signal.symbol)
            side_str = self._side_str(signal, "LONG_SHORT")
            try:
                result = order_mgr.place_entry_order(
                    symbol=signal.symbol,
                    side=side_str,
                    quantity=validation['shares'],
                    price=signal.price,
                    tag=tag,
                )
                if result is None:
                    console.print(f"[red]Live order FAILED for {signal.symbol}, rejecting signal[/red]")
                    validation['rejected'] = True
                    validation['reason'] = 'Live order placement failed'
                    return runner, validation, None
                filled_price = result['filled_price']
                order_id = result['order_id']
            except Exception as e:
                console.print(f"[red]Live order error for {signal.symbol}: {e}[/red]")
                validation['rejected'] = True
                validation['reason'] = f'Live order error: {str(e)}'
                return runner, validation, None

        position = self.portfolio.open_position(
            strategy_id=strategy_id,
            strategy_name=runner.strategy_name,
            strategy_type=runner.strategy_type,
            symbol=signal.symbol,
            side=OrderSide.BUY if signal.signal_type == SignalType.LONG_ENTRY else OrderSide.SELL,
            quantity=validation['shares'],
            entry_price=filled_price,
            stop_loss=signal.stop_loss,
            take_profit=signal.take_profit,
            entry_time=self._ist_now() if self.replay_mode else None,
        )

        if position:
            runner.trades_executed += 1
            if not hasattr(position, 'metadata') or not isinstance(position.metadata, dict):
                position.metadata = {}
            if signal.notes:
                position.metadata['entry_reason'] = signal.notes
            if order_id:
                position.metadata['upstox_order_id'] = order_id
            if runner.strategy_type in SWING_STRATEGY_TYPES:
                position.metadata['strategy_type'] = runner.strategy_type
                if runner.strategy_type in ("52W_CHASER", "52W_TARGET", "BLIND_52W"):
                    position.metadata['entry_52w_high'] = signal.or_high if signal.or_high > 0 else None
                    position.metadata['entry_adx'] = signal.adx if hasattr(signal, 'adx') else None
                    position.metadata['entry_rsi'] = signal.rsi if hasattr(signal, 'rsi') else None
                    position.metadata['max_holding_days'] = runner.config.get('max_holding_days', 30)
                    position.metadata['trailing_stop_pct'] = runner.config.get('trailing_stop_pct', 3.0)
                    position.metadata['enable_trailing_stop'] = runner.config.get('enable_trailing_stop', False)
                    position.metadata['sl_pct'] = runner.config.get('sl_pct', 2.0)
                    position.metadata['tp_pct'] = runner.config.get('tp_pct', 0.0)
                    position.metadata['entry_threshold_pct'] = runner.config.get('entry_threshold_pct', 2.0)
                    position.metadata['min_breakout_pct'] = runner.config.get('min_breakout_pct', 0.5)
                    position.metadata['enable_filters'] = runner.config.get('enable_filters', False)

        return runner, validation, position

    def monitor_positions(self):
        """Monitor all positions across all strategies for exits."""
        from trading.telegram_notifier import send_trade_exit, send_risk_alert

        if not self.portfolio.positions:
            return

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

        close_prices = {s: d['close'] for s, d in prices.items()}
        self.portfolio.update_prices(close_prices)

        all_positions = self.portfolio.get_all_positions()
        low_prices = {
            (p.strategy_id, p.symbol): p.low_price if p.low_price != float('inf') else 0.0
            for p in self.portfolio.positions.values()
        }
        for pos in all_positions:
            if not self.replay_mode:
                pos['low_price'] = low_prices.get((pos['strategy_id'], pos['symbol']), 0.0)
                self._persist_position_to_db(pos, action="upsert")

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

            if pos.side == OrderSide.BUY:
                if candle_low <= pos.stop_loss:
                    exit_triggered = True
                    exit_price = pos.stop_loss
                    exit_reason = "SL"
                elif pos.take_profit > 0 and candle_high >= pos.take_profit:
                    exit_triggered = True
                    exit_price = pos.take_profit
                    exit_reason = "TP"
            else:
                if candle_high >= pos.stop_loss:
                    exit_triggered = True
                    exit_price = pos.stop_loss
                    exit_reason = "SL"
                elif pos.take_profit > 0 and candle_low <= pos.take_profit:
                    exit_triggered = True
                    exit_price = pos.take_profit
                    exit_reason = "TP"

            if not exit_triggered:
                runner = self.strategies.get(pos.strategy_id)
                if runner and runner.signal_generator:
                    gen = runner.signal_generator
                    metadata = pos.metadata if hasattr(pos, 'metadata') and isinstance(pos.metadata, dict) else {}
                    entry_dt = pos.entry_time
                    days_in_position = (self._ist_now() - (entry_dt if entry_dt.tzinfo else entry_dt.replace(tzinfo=IST))).days
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
                            days_in_position=days_in_position,
                            timestamp=self._ist_now(),
                    )
                    if exit_signal:
                        exit_triggered = True
                        exit_price = exit_signal.price
                        exit_reason = exit_signal.notes

            if exit_triggered:
                order_mgr = self._get_order_manager()
                exit_price_to_use = exit_price
                if order_mgr:
                    side_str = self._side_str(pos.side, "LONG_SHORT")
                    tag_str = self._build_order_tag(pos.strategy_name, pos.symbol)
                    try:
                        result = order_mgr.place_exit_order(
                            symbol=pos.symbol,
                            side=side_str,
                            quantity=pos.quantity,
                            tag=tag_str,
                        )
                        if result and result.get('filled_price'):
                            exit_price_to_use = result['filled_price']
                    except Exception as e:
                        console.print(f"[red]Live exit order error for {pos.symbol}: {e}[/red]")
                positions_to_close.append((pos.strategy_id, pos.symbol, exit_price_to_use, exit_reason))

        trade_logged = False
        for strategy_id, symbol, exit_price, exit_reason in positions_to_close:
            pos = self.portfolio.positions[f"{strategy_id}_{symbol}"]
            side = self._side_str(pos.side, "LONG_SHORT")
            costs = calculate_trading_costs(pos.entry_price, exit_price, pos.quantity, side)['total_costs']

            trade = self.portfolio.close_position(
                strategy_id=strategy_id,
                symbol=symbol,
                exit_price=exit_price,
                exit_reason=exit_reason,
                costs=costs,
                exit_time=self._ist_now(),
            )

            if trade:
                runner = self.strategies.get(trade.strategy_id)

                if self.replay_mode:
                    if self._replay_on_event:
                        self._replay_on_event(build_trade_close_event(trade, runner))
                else:
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
                        'strategy_name': runner.strategy_name if runner else '',
                        'symbol': symbol,
                    }, action="delete")

                    self._persist_trade_to_db({
                        'strategy_id': strategy_id,
                        'strategy_name': runner.strategy_name if runner else '',
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
                        'reason': trade.reason,
                        'stop_loss': trade.sl_price,
                        'take_profit': trade.tp_price,
                        'peak_price': trade.peak_price,
                        'low_price': trade.low_price,
                    })

                    send_trade_exit(
                        bot_name=self.bot_config.name,
                        strategy_name=runner.strategy_name if runner else '',
                        symbol=trade.symbol,
                        side=trade.side.value,
                        entry_price=trade.entry_price,
                        exit_price=trade.exit_price,
                        quantity=trade.quantity,
                        pnl=trade.pnl,
                        pnl_pct=trade.pnl_pct,
                        exit_reason=trade.exit_reason,
                        entry_time=trade.entry_time,
                        costs=trade.costs,
                        net_pnl=trade.net_pnl,
                    )

                trade_logged = True
                self.cooldown_stocks[symbol] = self._ist_now()

                # Consecutive loss tracking
                if runner:
                    max_consecutive = int(runner.config.get("max_consecutive_losses", 3))
                    if max_consecutive > 0:
                        losses = getattr(self, '_consecutive_losses', {})
                        sid = str(trade.strategy_id)
                        if trade.pnl is not None and trade.pnl < 0:
                            losses[sid] = losses.get(sid, 0) + 1
                            if losses[sid] >= max_consecutive:
                                runner.status = "paused"
                                runner._paused_date = self._ist_now().date()
                                console.print(f"[red]{runner.strategy_name}: Paused - {losses[sid]} consecutive losses (limit: {max_consecutive})[/red]")
                        elif trade.pnl is not None and trade.pnl > 0:
                            losses[sid] = 0
                        self._consecutive_losses = losses

        if trade_logged and not self.replay_mode:
            self.journal.save_journal()

        portfolio_status = self.portfolio.get_portfolio_status()
        daily_pnl = portfolio_status.get('daily_pnl', 0)
        max_daily_loss_pct = 0.03
        for runner in self.strategies.values():
            max_daily_loss_pct = max(max_daily_loss_pct, runner.config.get('max_daily_loss_pct', 0.03))
        daily_loss_threshold = portfolio_status.get('initial_capital', 0) * max_daily_loss_pct
        if daily_pnl < 0 and abs(daily_pnl) >= daily_loss_threshold * 0.8:
            if not self.replay_mode:
                send_risk_alert(
                    bot_name=self.bot_config.name,
                    alert_type="daily_loss_approaching",
                    current_value=daily_pnl,
                    threshold=-daily_loss_threshold,
                    message=f"Daily loss ₹{daily_pnl:,.0f} is approaching limit of ₹{-daily_loss_threshold:,.0f} ({max_daily_loss_pct:.0%})",
                )
