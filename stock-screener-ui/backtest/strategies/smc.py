"""
SMC Strategy — Smart Money Concepts, biggest RR.

Uses same SMC logic as trading/smc_signals.py:
BOS short, sweep long, demand DB, OB, inside-bar, HL.
RR filtered to >= min_rr (default 2.0), SL swing ±8, TP 1.5* risk.
"""

import sys
import os
from datetime import datetime, timezone
from typing import Dict, List

import config
IST = config.IST
import pandas as pd

try:
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
    _NAUTILUS_AVAILABLE = True
except ImportError:
    BacktestEngineConfig = None  # type: ignore
    BacktestEngine = None  # type: ignore
    BarType = None  # type: ignore
    InstrumentId = None  # type: ignore
    Money = None  # type: ignore
    Symbol = None  # type: ignore
    TraderId = None  # type: ignore
    Venue = None  # type: ignore
    INR = None  # type: ignore
    AccountType = None  # type: ignore
    OmsType = None  # type: ignore
    OrderSide = None  # type: ignore
    Equity = None  # type: ignore
    Price = None  # type: ignore
    Quantity = None  # type: ignore
    BarDataWrangler = None  # type: ignore
    Strategy = object  # type: ignore
    StrategyConfig = object  # type: ignore
    _NAUTILUS_AVAILABLE = False

from .base import BaseStrategy, StrategyParam, NautilusBacktestMixin, get_ist_time

_current_file_dir = os.path.dirname(os.path.abspath(__file__))
_backtest_dir = os.path.dirname(_current_file_dir)
_ui_dir = os.path.dirname(_backtest_dir)
_project_root_dir = os.path.dirname(_ui_dir)
if _project_root_dir not in sys.path:
    sys.path.insert(0, _project_root_dir)


def run_single_stock_backtest(args):
    symbol, params, days, access_token = args if len(args) == 4 else (*args, None)
    if not _NAUTILUS_AVAILABLE:
        return {"symbol": symbol, "success": False, "error": "nautilus_trader not available"}
    try:
        from backtest.utils import get_upstox_client_from_db, get_upstox_client_with_token
        timeframe = int(params.get('timeframe', '5'))
        sl_pct = float(params.get('sl_pct', 1.2))
        tp_pct = float(params.get('tp_pct', 2.5))
        risk_reward = float(params.get('risk_reward', 1.5))
        swing_lookback = int(params.get('swing_lookback', 12))
        min_rr = float(params.get('min_rr', 2.0))
        trade_size = int(params.get('trade_size', 100))

        venue = Venue("SIMULATED")
        instrument_id = InstrumentId.from_str(f"{symbol}.{venue}")
        instrument = Equity(instrument_id=instrument_id, raw_symbol=Symbol(symbol), currency=INR, price_precision=2, price_increment=Price.from_str("0.01"), lot_size=Quantity.from_str("1"), ts_event=0, ts_init=0, isin=None)
        from datetime import timedelta
        today = datetime.now(IST)
        to_date = today.strftime('%Y-%m-%d')
        from_date = (today - timedelta(days=days + 30)).strftime('%Y-%m-%d')
        if access_token:
            upstox_api, error = get_upstox_client_with_token(access_token, quiet=True)
        else:
            upstox_api, error = get_upstox_client_from_db(quiet=True)
        if error or not upstox_api:
            return {'symbol': symbol, 'success': False, 'error': error or 'Failed to get Upstox client'}
        df = upstox_api.fetch_historical_data_v3(symbol=symbol, unit="minutes", interval=timeframe, to_date=to_date, from_date=from_date)
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
        config = SMCConfig(instrument_id=instrument_id, bar_type=bar_type, sl_pct=sl_pct, tp_pct=tp_pct, risk_reward=risk_reward, swing_lookback=swing_lookback, min_rr=min_rr, trade_size=trade_size)
        engine = BacktestEngine(config=BacktestEngineConfig(trader_id=TraderId("BACKTESTER-001")))
        engine.add_venue(venue=venue, oms_type=OmsType.NETTING, account_type=AccountType.CASH, base_currency=INR, starting_balances=[Money(1_000_000, INR)])
        engine.add_instrument(instrument)
        engine.add_data(bars)
        strategy = SMCNautilusStrategy(config=config)
        engine.add_strategy(strategy=strategy)
        engine.run()
        trades = strategy.trades
        engine.dispose()
        candle_data = {'index': [idx.strftime('%Y-%m-%dT%H:%M:%S') for idx in df.index], 'open': df['open'].tolist(), 'high': df['high'].tolist(), 'low': df['low'].tolist(), 'close': df['close'].tolist(), 'volume': df['volume'].tolist() if 'volume' in df.columns else [0]*len(df)}
        if not trades:
            return {'symbol': symbol, 'success': True, 'trades': 0, 'result': None, 'candles': candle_data, 'trade_list': []}
        gross_pnl = sum(t['gross_pnl'] for t in trades)
        total_costs = sum(t['trading_costs'] for t in trades)
        net_pnl = gross_pnl - total_costs
        wins = sum(1 for t in trades if t['net_pnl'] > 0)
        losses = sum(1 for t in trades if t['net_pnl'] < 0)
        total_trades = wins + losses
        win_rate = (wins / total_trades * 100) if total_trades else 0
        gross_profits = sum(t['net_pnl'] for t in trades if t['net_pnl'] > 0)
        gross_losses = abs(sum(t['net_pnl'] for t in trades if t['net_pnl'] < 0))
        profit_factor = gross_profits / gross_losses if gross_losses > 0 else float('inf') if gross_profits > 0 else 0
        result = {'symbol': symbol, 'trades': total_trades, 'wins': wins, 'losses': losses, 'win_rate': round(win_rate,1), 'gross_pnl': round(gross_pnl,2), 'total_costs': round(total_costs,2), 'net_pnl': round(net_pnl,2), 'pf': round(profit_factor,2)}
        return {'symbol': symbol, 'success': True, 'trades': total_trades, 'result': result, 'candles': candle_data, 'trade_list': trades}
    except Exception as e:
        return {'symbol': symbol, 'success': False, 'error': str(e)}


if _NAUTILUS_AVAILABLE:
    class SMCNautilusStrategy(Strategy, NautilusBacktestMixin):
        def __init__(self, config: 'SMCConfig'):
            super().__init__(config)
            self._instrument_id = config.instrument_id
            self._bar_type = config.bar_type
            self._sl_pct = config.sl_pct
            self._tp_pct = config.tp_pct
            self._risk_reward = config.risk_reward
            self._swing_lookback = config.swing_lookback
            self._min_rr = config.min_rr
            self._trade_size = config.trade_size
            self._bar_number = 0
            self._current_date = None
            self._highs: List[float] = []
            self._lows: List[float] = []
            self._closes: List[float] = []
            self._candles: List[dict] = []
            self._entry_price = None
            self._position_side = None
            self._current_entry_time = None
            self._position_peak = None
            self._position_low = None
            self._last_exit_bar = None
            self.trades = []

        def on_start(self):
            self.subscribe_bars(self._bar_type)

        def on_bar(self, bar):
            hour, minute, date = get_ist_time(bar.ts_event)
            if hour == 17:
                return
            if hour == 15 and minute >= 30:
                positions = self.cache.positions_open(instrument_id=self._instrument_id)
                if positions:
                    self._exit(bar, positions[0], "EOD", datetime.fromtimestamp(bar.ts_event/1e9, tz=timezone.utc).astimezone(IST))
                return
            self._bar_number += 1
            if self._current_date != date:
                self._highs.clear(); self._lows.clear(); self._closes.clear(); self._candles.clear()
                self._current_date = date
            close_f = float(bar.close); high_f = float(bar.high); low_f = float(bar.low)
            self._highs.append(high_f); self._lows.append(low_f); self._closes.append(close_f)
            self._candles.append({"open": float(bar.open), "high": high_f, "low": low_f, "close": close_f})
            if len(self._closes) < self._swing_lookback + 2:
                return
            positions = self.cache.positions_open(instrument_id=self._instrument_id)
            if positions:
                self._manage(bar, positions[0], datetime.fromtimestamp(bar.ts_event/1e9, tz=timezone.utc).astimezone(IST))
                return
            if self._is_in_cooldown_bars(self._bar_number, self._last_exit_bar, 3):
                return
            self._check_entry(close_f, datetime.fromtimestamp(bar.ts_event/1e9, tz=timezone.utc).astimezone(IST))

        def _swing(self):
            n = self._swing_lookback
            return min(self._lows[-n:]), max(self._highs[-n:])

        def _bear_bias(self):
            return len(self._closes) >= 5 and self._closes[-1] < self._closes[0]

        def _is_bull_engulf(self):
            if len(self._candles) < 2: return False
            p,c = self._candles[-2], self._candles[-1]
            return c["close"] > c["open"] and c["close"] > p["open"] and c["open"] < p["close"]

        def _is_inside(self):
            if len(self._candles) < 2: return False
            p,c = self._candles[-2], self._candles[-1]
            return c["high"] < p["high"] and c["low"] > p["low"]

        def _is_db(self):
            if len(self._lows) < 6: return False
            recent = self._lows[-6:]
            min1 = min(recent[:3]); min2 = min(recent[3:]); mid = max(recent[2:4])
            tol = min1 * 0.0035
            return abs(min1-min2) <= tol and mid > min1 + tol

        def _check_entry(self, close_f, bar_time):
            swing_low, swing_high = self._swing()
            bias_bear = self._bear_bias()
            # BOS short
            if bias_bear and close_f < swing_low * 0.9995:
                sl = swing_high + 8; tp = close_f - abs(close_f - sl) * self._risk_reward
                rr = abs(tp-close_f)/abs(close_f-sl) if sl!=close_f else 0
                if rr >= self._min_rr:
                    self._enter(close_f, "SHORT", sl, tp, bar_time, f"BOS short {swing_low:.0f} RR {rr:.1f}")
                    return
            # sweep long
            if len(self._candles) >= 3 and min(c["low"] for c in self._candles[-3:]) < swing_low * 0.9985 and self._closes[-1] > swing_low and self._is_bull_engulf():
                entry = close_f; sl = swing_low - 8; tp = entry + abs(entry-sl)*self._risk_reward
                rr = abs(tp-entry)/abs(entry-sl) if sl!=entry else 0
                if rr >= self._min_rr:
                    self._enter(entry, "LONG", sl, tp, bar_time, f"sweep long {swing_low:.0f} RR {rr:.1f}")
                    return
            if self._is_db() and abs(close_f - swing_low)/close_f < 0.01:
                entry=close_f; sl=swing_low-8; tp=entry+abs(entry-sl)*self._risk_reward
                if abs(tp-entry)/abs(entry-sl) >= self._min_rr:
                    self._enter(entry, "LONG", sl, tp, bar_time, f"DB long {swing_low:.0f}")
                    return
            if len(self._candles)>=4 and min(self._lows[-5:]) == self._lows[-1] and self._is_bull_engulf():
                entry=close_f; sl=min(self._lows[-5:])-6; tp=entry+abs(entry-sl)*3.0
                if abs(tp-entry)/abs(entry-sl) >= 3.0:
                    self._enter(entry, "LONG", sl, tp, bar_time, f"OB long {sl+6:.0f}")
                    return
            if self._is_inside() and abs(close_f - swing_low)/swing_low < 0.015:
                entry=close_f; sl=swing_low-8; tp=entry+abs(entry-sl)*2.0
                if abs(tp-entry)/abs(entry-sl) >= self._min_rr:
                    self._enter(entry, "LONG", sl, tp, bar_time, f"inside long {swing_low:.0f}")
                    return
            if abs(close_f - swing_low)/close_f < 0.006:
                entry=close_f; sl=swing_low-8
                if 8 <= abs(entry-sl) <= 35:
                    tp=entry+abs(entry-sl)*self._risk_reward
                    if abs(tp-entry)/abs(entry-sl) >= self._min_rr:
                        self._enter(entry, "LONG", sl, tp, bar_time, f"HL long {swing_low:.0f}")
                        return

        def _enter(self, price, side, sl, tp, bar_time, note):
            self._submit_market_entry(is_long=(side=="LONG"))
            self._position_side = side; self._entry_price = price; self._current_entry_time = bar_time
            self._position_peak = price; self._position_low = price
            self._sl = sl; self._tp = tp; self._note = note

        def _manage(self, bar, position, bar_time):
            cur = float(bar.close); high_f = float(bar.high); low_f = float(bar.low)
            self._update_position_peak_low(high_f, low_f)
            if self._position_side == "LONG":
                pnl_pct = ((cur - self._entry_price)/self._entry_price)*100
            else:
                pnl_pct = ((self._entry_price - cur)/self._entry_price)*100
            if self._position_side == "LONG" and cur <= self._sl:
                self._exit(bar, position, "SL", bar_time)
            elif self._position_side == "SHORT" and cur >= self._sl:
                self._exit(bar, position, "SL", bar_time)
            elif self._position_side == "LONG" and cur >= self._tp:
                self._exit(bar, position, "TP", bar_time)
            elif self._position_side == "SHORT" and cur <= self._tp:
                self._exit(bar, position, "TP", bar_time)

        def _exit(self, bar, position, reason, bar_time):
            cur = float(bar.close)
            qty = int(float(position.quantity)) if position.quantity else 0
            pnl = self._calc_pnl_and_costs(self._entry_price, cur, qty, self._position_side)
            hold = self._calc_hold_minutes(self._current_entry_time, bar_time)
            self.trades.append({'entry_price': self._entry_price, 'exit_price': cur, 'entry_time': self._current_entry_time.strftime('%Y-%m-%dT%H:%M') if self._current_entry_time else None, 'exit_time': bar_time.strftime('%Y-%m-%dT%H:%M') if bar_time else None, 'quantity': abs(qty), 'gross_pnl': pnl['gross_pnl'], 'gross_pnl_pct': pnl['gross_pnl_pct'], 'trading_costs': pnl['trading_costs'], 'net_pnl': pnl['net_pnl'], 'net_pnl_pct': pnl['net_pnl_pct'], 'exit_reason': reason, 'hold_duration_minutes': hold, 'date': self._current_entry_time.strftime('%Y-%m-%d') if self._current_entry_time else None, 'side': self._position_side, 'peak_price': round(self._position_peak,2) if self._position_peak else cur, 'low_price': round(self._position_low,2) if self._position_low else cur, 'note': getattr(self, '_note','')})
            self.close_all_positions(self._instrument_id)
            self._position_side = None; self._entry_price = None; self._current_entry_time = None; self._last_exit_bar = self._bar_number; self._position_peak = None; self._position_low = None

        def on_stop(self): pass
        def on_reset(self): self._highs.clear(); self._lows.clear(); self._closes.clear(); self._candles.clear(); self._current_date=None; self._position_side=None; self._entry_price=None

    SMCConfig = None

if _NAUTILUS_AVAILABLE:
    class SMCConfig(StrategyConfig, kw_only=True):
        instrument_id: InstrumentId
        bar_type: BarType
        sl_pct: float = 1.2
        tp_pct: float = 2.5
        risk_reward: float = 1.5
        swing_lookback: int = 12
        min_rr: float = 2.0
        trade_size: int = 100
else:
    SMCConfig = None


class SMCStrategy(BaseStrategy):
    @classmethod
    def get_name(cls) -> str: return "SMC — Smart Money (Biggest RR)"
    @classmethod
    def get_description(cls) -> str: return "BOS, liquidity sweep, demand DB, OB, inside-bar with 1.5-11R, halt filter, history-only swing"
    @classmethod
    def get_params(cls) -> List[StrategyParam]:
        return [
            StrategyParam(key='timeframe', label='Timeframe', type='select', default='5', options=['1','5','15']),
            StrategyParam(key='sl_pct', label='SL %', type='number', default=1.2, min=0.1, max=5, step=0.1),
            StrategyParam(key='tp_pct', label='TP %', type='number', default=2.5, min=0.1, max=5, step=0.1),
            StrategyParam(key='risk_reward', label='Risk Reward', type='number', default=1.5, min=1.0, max=5, step=0.1),
            StrategyParam(key='swing_lookback', label='Swing Lookback', type='number', default=12, min=5, max=30, step=1),
            StrategyParam(key='min_rr', label='Min RR', type='number', default=2.0, min=1.0, max=5, step=0.1),
            StrategyParam(key='trade_size', label='Trade Size', type='number', default=100, min=1, max=5000, step=1),
        ]
    def validate_params(self, params: Dict) -> List[str]:
        errs=[]
        if float(params.get('sl_pct',1.2)) >= float(params.get('tp_pct',2.5)):
            errs.append("SL must be < TP")
        return errs
    def run(self, symbols: List[str], days: int, params: Dict, progress_callback=None) -> Dict:
        from db.models import get_shared_broker_token
        token_data = get_shared_broker_token('upstox')
        access_token = token_data.get('access_token') if token_data else None
        worker_args = [(symbol, params, days, access_token) for symbol in symbols]
        return self.run_backtests(symbols=symbols, days=days, params=params, run_single_func=run_single_stock_backtest, worker_args=worker_args, progress_callback=progress_callback, strategy_key='smc', use_parallel=None, include_config=True, include_run_time=True)
    def get_visuals(self, trades: List[Dict], params: Dict) -> List[Dict]:
        visuals=[]
        for t in trades:
            if t.get('note'):
                visuals.append({'id': f"smc_{t.get('date')}_{t.get('entry_time')}", 'type': 'line', 'label': t['note'][:30], 'color': '#FFD700', 'value': t.get('entry_price'), 'date': t.get('date')})
        return visuals
