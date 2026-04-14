#!/usr/bin/env python3
"""
Replay Trading Day — Simulate live paper trading using historical candles.

Feeds historical 1-min candles through the same signal generators, risk manager,
and portfolio that the live MultiStrategyRunner uses. Zero changes to existing files.

Usage:
    python experiments/replay_trading_day.py --date 2026-04-09
    python experiments/replay_trading_day.py --date 2026-04-09 --symbols RELIANCE,TCS
    python experiments/replay_trading_day.py --date 2026-04-09 --strategy ORB
    python experiments/replay_trading_day.py --date 2026-04-09 --strategy ALL --verbose
"""

import sys
import json
import pickle
import time
import argparse
from pathlib import Path
from datetime import datetime, timedelta
from typing import Callable, Dict, List, Optional, Tuple
from dataclasses import dataclass, field

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import logging
logging.getLogger("trading.config_loader").setLevel(logging.ERROR)

import config
import pandas as pd
from rich.console import Console
from rich.table import Table

from backtest.costs import calculate_trading_costs
from market_data.market_data import fetch_candles, get_api_client, resample_candles
from trading.orb_signals import ORBSignalGenerator, ORBSignal, SignalType
from trading.sr_breakout_signals import SRBreakoutSignalGenerator
from trading.ema_cross_signals import EMACrossSignalGenerator
from trading.week52_chaser_signals import Week52ChaserSignalGenerator
from trading.week52_target_signals import Week52TargetSignalGenerator
from trading.global_risk_manager import GlobalRiskManager
from trading.portfolio.portfolio_core import SharedPortfolioManager
from trading.portfolio.portfolio_models import OrderSide

console = Console()

CACHE_DIR = Path(__file__).parent / "data" / "replay_cache"
SYMBOLS_FILE = Path(__file__).parent / "data" / "orb_symbols.json"

DEFAULT_WATCHLIST = [
    "RELIANCE", "TCS", "HDFC", "INFY", "ICICIBANK", "HDFCBANK", "SBIN",
    "BHARTIARTL", "ITC", "KOTAKBANK", "LT", "AXISBANK", "BAJFINANCE",
    "MARUTI", "ASIANPAINT", "HCLTECH", "SUNPHARMA", "TITAN", "WIPRO",
    "ULTRACEMCO",
]

STRATEGY_CONFIGS = {
    "ORB Best": {
        "or_minutes": 45, "sl_pct": 1.0, "tp_pct": 1.5, "breakout_buffer_pct": 0.3,
        "cooldown_minutes": 75, "enable_shorts": False,
        "eod_exit_hour": 15, "eod_exit_minute": 0, "min_rr_ratio": 1.5,
        "min_or_range_pct": 0.8, "max_or_range_pct": 3.0,
        "max_positions": 5, "capital_allocation_pct": 0.30,
    },
    "ORB Conservative": {
        "or_minutes": 45, "sl_pct": 0.4, "tp_pct": 1.2, "breakout_buffer_pct": 0.3,
        "cooldown_minutes": 30, "enable_shorts": False,
        "eod_exit_hour": 14, "eod_exit_minute": 45, "min_rr_ratio": 2.0,
        "min_or_range_pct": 0.5, "max_or_range_pct": 3.0,
        "max_positions": 3, "capital_allocation_pct": 0.25,
    },
    "SR Breakout": {
        "sl_pct": 0.5, "tp_pct": 1.5, "pivot_type": "classic", "breakout_buffer_pct": 0.1,
        "eod_exit_hour": 15, "eod_exit_minute": 15, "min_rr_ratio": 1.0,
        "max_positions": 3, "capital_allocation_pct": 0.15,
    },
    "EMA Cross": {
        "ema_fast_period": 9, "ema_slow_period": 21, "sl_pct": 0.5, "tp_pct": 1.5,
        "eod_exit_hour": 14, "eod_exit_minute": 45, "min_rr_ratio": 2.0,
        "max_positions": 5, "capital_allocation_pct": 0.15,
    },
}

INTRADAY_STRATEGY_TYPES = {"ORB", "SR_BREAKOUT", "EMA_CROSS"}


@dataclass
class ReplayTrade:
    symbol: str
    strategy_name: str
    side: str
    quantity: int
    entry_price: float
    exit_price: float
    entry_time: datetime
    exit_time: datetime
    pnl: float
    pnl_pct: float
    costs: float
    net_pnl: float
    exit_reason: str



def _load_symbols(symbols_arg: Optional[str]) -> List[str]:
    if symbols_arg == "DEFAULT" or not symbols_arg:
        if SYMBOLS_FILE.exists():
            with open(SYMBOLS_FILE) as f:
                return json.load(f)
        return DEFAULT_WATCHLIST
    if symbols_arg:
        return [s.strip().upper() for s in symbols_arg.split(",") if s.strip()]
    return DEFAULT_WATCHLIST


def _fetch_and_cache(symbol: str, date_str: str, refresh: bool = False) -> Optional[pd.DataFrame]:
    cache_path = CACHE_DIR / date_str / f"{symbol}.pkl"
    if cache_path.exists() and not refresh:
        with open(cache_path, "rb") as f:
            return pickle.load(f)

    dt = pd.Timestamp(date_str, tz=config.IST)
    from_date = (dt - timedelta(days=2)).strftime("%Y-%m-%d")

    df = fetch_candles(symbol, tf=1, from_date=from_date, to_date=date_str)

    if df is None or df.empty:
        console.print(f"[yellow]{symbol}: no data for {date_str}[/yellow]")
        return None

    day_start = pd.Timestamp(date_str + " 09:00:00", tz=config.IST).tz_convert("UTC")
    day_end = pd.Timestamp(date_str + " 16:00:00", tz=config.IST).tz_convert("UTC")
    df = df[(df.index >= day_start) & (df.index <= day_end)]

    if df.empty:
        console.print(f"[yellow]{symbol}: no intraday candles for {date_str}[/yellow]")
        return None

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    with open(cache_path, "wb") as f:
        pickle.dump(df, f)

    return df


def _fetch_daily_data(symbol: str, date_str: str) -> Optional[pd.DataFrame]:
    dt = pd.Timestamp(date_str, tz=config.IST)
    from_date = (dt - timedelta(days=420)).strftime("%Y-%m-%d")
    try:
        return fetch_candles(symbol, tf=1440, from_date=from_date, to_date=date_str)
    except Exception:
        return None


def _fetch_ema_history(symbol: str, date_str: str) -> Optional[pd.DataFrame]:
    try:
        dt = pd.Timestamp(date_str, tz=config.IST)
        from_date = (dt - timedelta(days=15)).strftime("%Y-%m-%d")
        df = fetch_candles(symbol, tf=5, from_date=from_date, to_date=date_str)
        if df is None or df.empty:
            return None
        day_start = pd.Timestamp(date_str + " 09:15:00", tz=config.IST).tz_convert("UTC")
        df = df[df.index < day_start]
        if df.empty:
            return None
        return df
    except Exception:
        return None


def _build_5min_candles(df_1m: pd.DataFrame) -> pd.DataFrame:
    return resample_candles(df_1m, 5)


def _compute_ema(closes: List[float], period: int) -> List[float]:
    if not closes:
        return []
    multiplier = 2.0 / (period + 1)
    if len(closes) < period:
        ema = [closes[0]]
        for price in closes[1:]:
            ema.append(price * multiplier + ema[-1] * (1 - multiplier))
        return ema
    ema = [sum(closes[:period]) / period]
    for price in closes[period:]:
        ema.append(price * multiplier + ema[-1] * (1 - multiplier))
    return ema


def _compute_ema_per_tf(
    symbol: str,
    df_1m_today: pd.DataFrame,
    date_str: str,
    ema_fast_period: int = 9,
    ema_slow_period: int = 21,
    tfs: Optional[List[int]] = None,
) -> Optional[dict]:
    if tfs is None:
        tfs = [1, 5, 15, 60]

    if df_1m_today is None or df_1m_today.empty:
        return None

    if df_1m_today.index.tz is None:
        df_1m_today.index = df_1m_today.index.tz_localize("UTC")
    else:
        df_1m_today.index = df_1m_today.index.tz_convert("UTC")

    day_start = pd.Timestamp(date_str + " 09:15:00", tz=config.IST).tz_convert("UTC")
    day_end = pd.Timestamp(date_str + " 15:30:00", tz=config.IST).tz_convert("UTC")
    df_1m_day = df_1m_today[
        (df_1m_today.index >= day_start) & (df_1m_today.index <= day_end)
    ].copy()
    if df_1m_day.empty:
        return None

    hist_5m = _fetch_ema_history(symbol, date_str)
    timeframes: Dict[str, dict] = {}

    for tf in tfs:
        if tf == 1:
            day_resampled = df_1m_day
            if len(day_resampled) < ema_slow_period:
                continue
            closes = day_resampled["close"].tolist()
            ema_f = _compute_ema(closes, ema_fast_period)
            ema_s = _compute_ema(closes, ema_slow_period)
            timeframes[str(tf)] = {
                "ema_fast": [round(v, 2) for v in ema_f],
                "ema_slow": [round(v, 2) for v in ema_s],
            }
        else:
            day_resampled = resample_candles(df_1m_day, tf)
            if day_resampled.empty:
                continue

            if hist_5m is not None and not hist_5m.empty:
                hist_resampled = resample_candles(hist_5m, tf)
                if not hist_resampled.empty:
                    combined = pd.concat([hist_resampled, day_resampled])
                    closes = combined["close"].tolist()
                else:
                    closes = day_resampled["close"].tolist()
            else:
                closes = day_resampled["close"].tolist()

            if len(closes) < ema_slow_period:
                continue

            ema_f = _compute_ema(closes, ema_fast_period)
            ema_s = _compute_ema(closes, ema_slow_period)
            day_count = len(day_resampled)
            timeframes[str(tf)] = {
                "ema_fast": [round(v, 2) for v in ema_f[-day_count:]],
                "ema_slow": [round(v, 2) for v in ema_s[-day_count:]],
            }

    if not timeframes:
        return None

    return {
        "ema_fast_period": ema_fast_period,
        "ema_slow_period": ema_slow_period,
        "timeframes": timeframes,
    }


def _build_prev_day_data(df_daily: pd.DataFrame, date_str: str) -> Optional[dict]:
    if df_daily is None or df_daily.empty or len(df_daily) < 2:
        return None
    prev = df_daily.iloc[-2]
    curr = df_daily.iloc[-1]
    return {
        "current_price": float(curr["close"]),
        "prev_high": float(prev["high"]),
        "prev_low": float(prev["low"]),
        "prev_close": float(prev["close"]),
    }


def _build_52w_data(df_daily: pd.DataFrame, date_str: str) -> Optional[dict]:
    if df_daily is None or df_daily.empty:
        return None
    closes = df_daily["close"].tolist()
    highs = df_daily["high"].tolist()
    volumes = df_daily["volume"].tolist()
    current_price = float(closes[-1])
    window_252 = highs[-252:] if len(highs) >= 252 else highs
    high_52w = max(window_252)
    window_252_lows = df_daily["low"].tolist()
    low_52w = min(window_252_lows[-252:]) if len(window_252_lows) >= 252 else min(window_252_lows)
    daily_highs = highs[-252:] if len(highs) >= 252 else highs
    avg_volume_20d = float(sum(volumes[-20:]) / len(volumes[-20:])) if len(volumes) >= 20 else None
    ma50 = float(sum(closes[-50:]) / 50) if len(closes) >= 50 else None
    ma200 = float(sum(closes[-200:]) / 200) if len(closes) >= 200 else None
    return {
        "current_price": current_price,
        "high_52w": float(high_52w),
        "low_52w": float(low_52w),
        "daily_highs": daily_highs,
        "daily_closes": closes,
        "volume": float(volumes[-1]) if volumes else 0,
        "avg_volume_20d": avg_volume_20d,
        "ma50": ma50,
        "ma200": ma200,
        "prev_high": float(highs[-1]),
        "prev_low": float(df_daily["low"].iloc[-1]),
        "prev_close": float(closes[-1]),
    }


def _build_pivot_data(prev_day: dict) -> Optional[dict]:
    if prev_day is None:
        return None
    h = prev_day["prev_high"]
    l = prev_day["prev_low"]
    c = prev_day["prev_close"]
    hl = h - l
    pp = (h + l + c) / 3
    return {
        "current_price": prev_day["current_price"],
        "pivot_points": {
            "PP": round(pp, 2),
            "R1": round(2 * pp - l, 2),
            "S1": round(2 * pp - h, 2),
            "R2": round(pp + hl, 2),
            "S2": round(pp - hl, 2),
        },
    }


def _fetch_prev_day_data_multi(symbols: List[str], date_str: str) -> Dict[str, dict]:
    dt = pd.Timestamp(date_str, tz=config.IST)
    from_date = (dt - timedelta(days=12)).strftime("%Y-%m-%d")
    result = {}
    for symbol in symbols:
        try:
            df = fetch_candles(symbol, tf=1440, from_date=from_date, to_date=date_str)
            data = _build_prev_day_data(df, date_str)
            if data:
                result[symbol] = data
        except Exception:
            continue
    return result


def _fetch_daily_data_multi(symbols: List[str], date_str: str) -> Dict[str, dict]:
    result = {}
    for symbol in symbols:
        df = _fetch_daily_data(symbol, date_str)
        data = _build_52w_data(df, date_str)
        if data:
            result[symbol] = data
    return result


def run_replay(
    date_str: str,
    symbols: List[str],
    strategy_filter: str,
    verbose: bool,
    refresh_cache: bool,
    on_event: Optional[Callable[[dict], None]] = None,
):
    _start_time = time.time()

    def _emit(event: dict):
        if on_event:
            on_event(event)

    try:
        _do_replay(date_str, symbols, strategy_filter, verbose, refresh_cache, _emit)
        _emit({"type": "done", "success": True, "duration_ms": round((time.time() - _start_time) * 1000)})
    except Exception as e:
        console.print(f"[red]Replay error: {e}[/red]")
        _emit({"type": "error", "message": str(e)})


def _do_replay(
    date_str: str,
    symbols: List[str],
    strategy_filter: str,
    verbose: bool,
    refresh_cache: bool,
    on_event: Callable[[dict], None],
):
    console.print(f"\n[bold]Replay Trading Day: {date_str}[/bold]")
    console.print(f"Symbols: {len(symbols)} | Strategy: {strategy_filter}\n")

    all_1m: Dict[str, pd.DataFrame] = {}
    all_5m: Dict[str, pd.DataFrame] = {}
    all_daily: Dict[str, dict] = {}
    prev_day_data: Dict[str, dict] = {}

    console.print("[bold]Loading 1-min candles...[/bold]")
    for i, sym in enumerate(symbols):
        df = _fetch_and_cache(sym, date_str, refresh=refresh_cache)
        if df is not None and not df.empty:
            all_1m[sym] = df
            all_5m[sym] = _build_5min_candles(df)
        if (i + 1) % 10 == 0:
            console.print(f"  {i+1}/{len(symbols)} loaded")

    valid_symbols = list(all_1m.keys())
    if not valid_symbols:
        console.print("[red]No data loaded. Aborting.[/red]")
        return

    console.print(f"[green]Loaded {len(valid_symbols)} symbols, "
                  f"{sum(len(df) for df in all_1m.values())} total 1-min candles[/green]\n")

    on_event({"type": "loaded", "symbols": len(valid_symbols), "candles": sum(len(df) for df in all_1m.values())})

    strategies_to_run = {}
    strat_id = 1

    if strategy_filter in ("ALL", "ORB"):
        for name in ["ORB Best", "ORB Conservative"]:
            cfg = STRATEGY_CONFIGS[name]
            gen = ORBSignalGenerator(
                or_minutes=cfg["or_minutes"],
                sl_pct=cfg["sl_pct"],
                tp_pct=cfg["tp_pct"],
                min_or_range_pct=cfg["min_or_range_pct"],
                max_or_range_pct=cfg["max_or_range_pct"],
                breakout_buffer_pct=cfg["breakout_buffer_pct"],
            )
            strategies_to_run[name] = {
                "id": strat_id, "type": "ORB", "config": cfg,
                "generator": gen, "or_levels": {},
            }
            strat_id += 1

    if strategy_filter in ("ALL", "SR"):
        name = "SR Breakout"
        cfg = STRATEGY_CONFIGS[name]
        gen = SRBreakoutSignalGenerator(cfg)
        strategies_to_run[name] = {
            "id": strat_id, "type": "SR_BREAKOUT", "config": cfg, "generator": gen,
        }
        strat_id += 1

    if strategy_filter in ("ALL", "EMA"):
        name = "EMA Cross"
        cfg = STRATEGY_CONFIGS[name]
        gen = EMACrossSignalGenerator(cfg)
        strategies_to_run[name] = {
            "id": strat_id, "type": "EMA_CROSS", "config": cfg, "generator": gen,
        }
        strat_id += 1

    if strategy_filter in ("ALL", "52W"):
        name = "52W Chaser"
        cfg = STRATEGY_CONFIGS.get(name, {
            "sl_pct": 3.0, "tp_pct": 10.0, "entry_threshold_pct": 2.0,
            "enable_trailing_stop": True, "trailing_stop_pct": 3.0,
            "trailing_activation_pct": 5.0, "max_holding_days": 45,
            "cooldown_days": 30, "enable_filters": False,
            "max_positions": 2, "capital_allocation_pct": 0.10,
        })
        gen = Week52ChaserSignalGenerator(cfg)
        strategies_to_run[name] = {
            "id": strat_id, "type": "52W_CHASER", "config": cfg, "generator": gen,
        }
        strat_id += 1

    portfolio = SharedPortfolioManager(initial_capital=1_000_000)
    risk_manager = GlobalRiskManager(
        max_total_positions=20,
        max_total_capital_pct=0.90,
        max_symbol_exposure_pct=0.20,
    )

    for sname, sdata in strategies_to_run.items():
        portfolio.set_strategy_allocation(
            strategy_id=sdata["id"],
            strategy_name=sname,
            allocation_pct=sdata["config"].get("capital_allocation_pct", 0.20),
            max_positions=sdata["config"].get("max_positions", 3),
        )

    if "SR Breakout" in strategies_to_run:
        console.print("[dim]Fetching previous-day data for SR Breakout...[/dim]")
        prev_day_data = _fetch_prev_day_data_multi(valid_symbols, date_str)
        console.print(f"[green]  {len(prev_day_data)} symbols with prev-day data[/green]")

    if "52W Chaser" in strategies_to_run:
        console.print("[dim]Fetching 400-day daily data for 52W Chaser...[/dim]")
        all_daily = _fetch_daily_data_multi(valid_symbols, date_str)
        console.print(f"[green]  {len(all_daily)} symbols with daily data[/green]")

    trades: List[ReplayTrade] = []
    cooldowns: Dict[str, datetime] = {}
    open_positions: Dict[str, dict] = {}
    or_levels_computed: Dict[str, dict] = {}

    def _open_position(sname: str, sdata: dict, signal: ORBSignal, sim_time: datetime):
        nonlocal open_positions
        side_str = "BUY" if signal.signal_type == SignalType.LONG_ENTRY else "SELL"
        side = OrderSide.BUY if side_str == "BUY" else OrderSide.SELL

        cfg = sdata["config"]
        validation = risk_manager.validate_trade(
            strategy_id=sdata["id"],
            strategy_name=sname,
            symbol=signal.symbol,
            entry_price=signal.price,
            stop_loss=signal.stop_loss,
            take_profit=signal.take_profit,
            side=side_str,
            total_capital=portfolio.initial_capital,
            cash_available=portfolio.cash,
            current_total_positions=len(portfolio.positions),
            current_total_capital_used=portfolio.get_total_capital_used(),
            strategy_max_positions=cfg.get("max_positions", 3),
            strategy_allocation_pct=cfg.get("capital_allocation_pct", 0.20),
            current_strategy_positions=portfolio.get_strategy_status(sdata["id"]).get("positions_count", 0),
            current_strategy_capital_used=portfolio.get_strategy_status(sdata["id"]).get("capital_used", 0),
            current_symbol_exposure=portfolio.get_symbol_exposure(signal.symbol),
            min_rr_ratio=cfg.get("min_rr_ratio", 2.0),
            risk_per_trade_pct=0.01,
            max_capital_per_trade_pct=0.10,
            min_trade_value=5000,
            max_trade_value=100000,
        )

        if not validation["valid"]:
            if verbose:
                console.print(f"  [dim]{sname} {signal.symbol}: rejected - {validation['reason']}[/dim]")
            return

        pos = portfolio.open_position(
            strategy_id=sdata["id"],
            strategy_name=sname,
            symbol=signal.symbol,
            side=side,
            quantity=validation["shares"],
            entry_price=signal.price,
            stop_loss=signal.stop_loss,
            take_profit=signal.take_profit,
        )
        if pos is None:
            return

        key = f"{sdata['id']}_{signal.symbol}"
        open_positions[key] = {
            "symbol": signal.symbol,
            "side": side_str,
            "strategy_id": sdata["id"],
            "strategy_name": sname,
            "entry_price": signal.price,
            "stop_loss": signal.stop_loss,
            "take_profit": signal.take_profit,
            "entry_time": sim_time,
            "peak_price": signal.price,
            "low_price": signal.price,
            "quantity": validation["shares"],
            "type": sdata["type"],
        }

        if verbose:
            console.print(f"  [green]{sname} {signal.symbol}: {side_str} "
                          f"{validation['shares']} @ {signal.price:.2f} "
                          f"SL={signal.stop_loss:.2f} TP={signal.take_profit:.2f}[/green]")

        if on_event:
            on_event({"type": "trade_open", "strategy": sname, "symbol": signal.symbol, "side": side_str, "price": signal.price, "sl": signal.stop_loss, "tp": signal.take_profit, "time": str(sim_time), "quantity": validation["shares"]})

    def _close_position(key: str, exit_price: float, sim_time: datetime, reason: str):
        nonlocal open_positions
        pos = open_positions.pop(key, None)
        if pos is None:
            return

        side = "SHORT" if pos["side"] == "SELL" else "LONG"
        costs = calculate_trading_costs(
            pos["entry_price"], exit_price, pos["quantity"], side=side,
        )
        total_costs = costs["total_costs"]

        trade = portfolio.close_position(
            strategy_id=pos["strategy_id"],
            symbol=pos["symbol"],
            exit_price=exit_price,
            exit_reason=reason,
            costs=total_costs,
        )
        if trade is None:
            return

        rt = ReplayTrade(
            symbol=pos["symbol"],
            strategy_name=pos["strategy_name"],
            side=pos["side"],
            quantity=pos["quantity"],
            entry_price=pos["entry_price"],
            exit_price=exit_price,
            entry_time=pos["entry_time"],
            exit_time=sim_time,
            pnl=trade.pnl,
            pnl_pct=trade.pnl_pct,
            costs=total_costs,
            net_pnl=trade.net_pnl,
            exit_reason=reason,
        )
        trades.append(rt)

        cooldown_min = STRATEGY_CONFIGS.get(pos["strategy_name"], {}).get("cooldown_minutes", 30)
        if pos["type"] in INTRADAY_STRATEGY_TYPES:
            cooldowns[pos["symbol"]] = sim_time + timedelta(minutes=cooldown_min)

        color = "green" if trade.net_pnl >= 0 else "red"
        if verbose:
            console.print(f"  [{color}]{pos['strategy_name']} {pos['symbol']}: "
                          f"{reason} @ {exit_price:.2f} "
                          f"PnL={trade.net_pnl:+.2f} ({trade.pnl_pct:+.2f}%) "
                          f"costs={total_costs:.2f}[/{color}]")

        if on_event:
            on_event({"type": "trade_close", "strategy": pos["strategy_name"], "symbol": pos["symbol"], "side": pos["side"], "entry_price": pos["entry_price"], "exit_price": exit_price, "reason": reason, "pnl": trade.pnl, "net_pnl": trade.net_pnl, "costs": total_costs, "entry_time": str(pos["entry_time"]), "exit_time": str(sim_time), "quantity": pos["quantity"]})

    def _check_sl_tp(key: str, candle_high: float, candle_low: float, sim_time: datetime):
        pos = open_positions.get(key)
        if pos is None:
            return

        pos["peak_price"] = max(pos["peak_price"], candle_high)
        pos["low_price"] = min(pos["low_price"], candle_low)

        if pos["side"] == "BUY":
            if candle_low <= pos["stop_loss"]:
                _close_position(key, pos["stop_loss"], sim_time, "SL")
            elif candle_high >= pos["take_profit"]:
                _close_position(key, pos["take_profit"], sim_time, "TP")
        else:
            if candle_high >= pos["stop_loss"]:
                _close_position(key, pos["stop_loss"], sim_time, "SL")
            elif candle_low <= pos["take_profit"]:
                _close_position(key, pos["take_profit"], sim_time, "TP")

    all_candles = []
    for sym in valid_symbols:
        for _, row in all_1m[sym].iterrows():
            ts_local = row.name.tz_convert(config.IST)
            vol = float(row["volume"]) if "volume" in row.index else 0
            all_candles.append((ts_local, sym, row["open"], row["high"], row["low"], row["close"], vol))

    all_candles.sort(key=lambda x: x[0])

    market_open = pd.Timestamp(date_str + " 09:15:00", tz=config.IST)
    market_close = pd.Timestamp(date_str + " 15:30:00", tz=config.IST)

    five_min_counter: Dict[str, int] = {}
    ema_closes: Dict[str, List[float]] = {}

    console.print(f"[bold]Processing {len(all_candles)} candles...[/bold]\n")

    if on_event:
        for sym in valid_symbols:
            if "SR Breakout" in strategies_to_run and sym in prev_day_data:
                piv = _build_pivot_data(prev_day_data[sym])
                if piv:
                    pp_dict = piv["pivot_points"]
                    on_event({"type": "pivot_levels", "strategy": "SR Breakout", "symbol": sym,
                              "pp": pp_dict["PP"], "r1": pp_dict["R1"], "s1": pp_dict["S1"],
                              "r2": pp_dict["R2"], "s2": pp_dict["S2"]})

    if "EMA Cross" in strategies_to_run:
        console.print("[dim]Computing EMA for all timeframes...[/dim]")
        ema_count = 0
        for sym in valid_symbols:
            if sym in all_1m:
                gen_ema = strategies_to_run["EMA Cross"]["generator"]
                ema_result = _compute_ema_per_tf(
                    symbol=sym,
                    df_1m_today=all_1m[sym],
                    date_str=date_str,
                    ema_fast_period=gen_ema.ema_fast_period,
                    ema_slow_period=gen_ema.ema_slow_period,
                )
                if ema_result:
                    on_event({"type": "ema_series", "symbol": sym, **ema_result})
                    ema_count += 1
        console.print(f"[green]  {ema_count} symbols with EMA data[/green]")

    for sym in valid_symbols:
        if "52W Chaser" in strategies_to_run and sym in all_daily:
            d52 = all_daily[sym]
            if d52 and d52.get("high_52w"):
                on_event({"type": "52w_high", "strategy": "52W Chaser", "symbol": sym,
                          "high_52w": d52["high_52w"], "low_52w": d52.get("low_52w", 0)})

    total_candles = len(all_candles)
    candle_count = 0
    candle_buffer: Dict[str, list] = {}
    CANDLE_FLUSH_INTERVAL = 100

    for candle_time, sym, c_open, c_high, c_low, c_close, c_volume in all_candles:
        if candle_time < market_open or candle_time > market_close:
            continue

        candle_count += 1
        if candle_count % 50 == 0:
            on_event({"type": "progress", "candle": candle_count, "total": total_candles, "time": str(candle_time), "symbol": sym})

        if sym not in candle_buffer:
            candle_buffer[sym] = []
        candle_buffer[sym].append({"time": candle_time.strftime("%H:%M"), "open": float(c_open), "high": float(c_high), "low": float(c_low), "close": float(c_close), "volume": float(c_volume)})

        if candle_count % CANDLE_FLUSH_INTERVAL == 0:
            for buf_sym, buf_candles in candle_buffer.items():
                if buf_candles:
                    on_event({"type": "candles", "symbol": buf_sym, "candles": buf_candles})
                    candle_buffer[buf_sym] = []

        is_5min_boundary = candle_time.minute % 5 == 0 and candle_time.second == 0

        if is_5min_boundary:
            five_min_counter[sym] = five_min_counter.get(sym, 0) + 1

        pending_signals: List[Tuple[str, dict, object]] = []

        for sname, sdata in strategies_to_run.items():
            stype = sdata["type"]
            gen = sdata["generator"]
            cfg = sdata["config"]
            sid = sdata["id"]

            if stype in ("ORB",) and is_5min_boundary:
                if sym not in all_5m or all_5m[sym].empty:
                    continue

                df_5m_local = all_5m[sym].copy()
                df_5m_local.index = df_5m_local.index.tz_convert(config.IST)
                mask = df_5m_local.index <= candle_time
                candles_so_far = df_5m_local[mask]

                or_levels = gen.calculate_or_levels(
                    [{"time": str(t), "high": r["high"], "low": r["low"],
                      "open": r["open"], "close": r["close"]}
                     for t, r in candles_so_far.iterrows()]
                )

                if or_levels is None:
                    continue

                or_key = f"{sname}_{sym}"
                if or_key not in or_levels_computed:
                    or_levels_computed[or_key] = or_levels
                    if verbose:
                        console.print(f"  [dim]{sname} {sym}: OR range={or_levels['or_range_pct']:.2f}% "
                                      f"(min={cfg['min_or_range_pct']}%, max={cfg['max_or_range_pct']}%)[/dim]")
                    if on_event:
                        on_event({"type": "or_levels", "strategy": sname, "symbol": sym, "or_high": or_levels["or_high"], "or_low": or_levels["or_low"], "or_range_pct": round(or_levels["or_range_pct"], 2)})

                if sym in cooldowns and candle_time < cooldowns[sym]:
                    continue

                if any(f"{s['id']}_{sym}" in open_positions for s in strategies_to_run.values()):
                    continue

                key = f"{sid}_{sym}"
                if key in open_positions:
                    continue

                signal = gen.check_breakout(sym, c_close, or_levels)
                if signal is None:
                    continue

                if signal.signal_type == SignalType.SHORT_ENTRY and not cfg.get("enable_shorts", False):
                    continue

                pending_signals.append((sname, sdata, signal))

            elif stype == "SR_BREAKOUT" and is_5min_boundary:
                if sym not in prev_day_data:
                    continue

                if sym in cooldowns and candle_time < cooldowns[sym]:
                    continue

                key = f"{sid}_{sym}"
                if key in open_positions:
                    continue

                if any(f"{s['id']}_{sym}" in open_positions for s in strategies_to_run.values()):
                    continue

                pivot_data = _build_pivot_data(prev_day_data[sym])
                if pivot_data is None:
                    continue

                market_data = {
                    **pivot_data,
                    "current_price": c_close,
                }
                signal = gen.check_entry(sym, market_data)
                if signal is None:
                    continue

                if signal.signal_type == SignalType.SHORT_ENTRY:
                    continue

                pending_signals.append((sname, sdata, signal))

            elif stype == "EMA_CROSS" and is_5min_boundary:
                if sym not in all_5m or all_5m[sym].empty:
                    continue

                df_5m_local = all_5m[sym].copy()
                df_5m_local.index = df_5m_local.index.tz_convert(config.IST)
                mask = df_5m_local.index <= candle_time
                candles_so_far = df_5m_local[mask]

                if len(candles_so_far) < gen.ema_slow_period + 2:
                    continue

                ema_closes[sym] = candles_so_far["close"].tolist()
                ema_fast = _compute_ema(ema_closes[sym], gen.ema_fast_period)
                ema_slow = _compute_ema(ema_closes[sym], gen.ema_slow_period)

                if len(ema_fast) < 2 or len(ema_slow) < 2:
                    continue

                market_data = {
                    "current_price": c_close,
                    "ema_fast_current": ema_fast[-1],
                    "ema_fast_prev": ema_fast[-2],
                    "ema_slow_current": ema_slow[-1],
                    "ema_slow_prev": ema_slow[-2],
                }
                signal = gen.check_entry(sym, market_data)
                if signal is None:
                    continue

                if signal.signal_type == SignalType.SHORT_ENTRY:
                    continue

                key = f"{sid}_{sym}"
                if key in open_positions:
                    continue

                pending_signals.append((sname, sdata, signal))

        opened_this_candle: set = set()
        earliest_eod = min(
            candle_time.replace(hour=sdata["config"].get("eod_exit_hour", 15),
                                minute=sdata["config"].get("eod_exit_minute", 0), second=0)
            for sdata in strategies_to_run.values()
        )
        for sname, sdata, signal in pending_signals:
            sym_key = signal.symbol
            if candle_time >= earliest_eod - timedelta(minutes=30):
                continue
            if (sym_key in opened_this_candle
                    or any(f"{s['id']}_{sym_key}" in open_positions for s in strategies_to_run.values())):
                continue
            _open_position(sname, sdata, signal, candle_time)
            opened_this_candle.add(sym_key)

        for key in list(open_positions.keys()):
            pos = open_positions[key]
            if pos["symbol"] != sym:
                continue
            _check_sl_tp(key, c_high, c_low, candle_time)

            if key in open_positions:
                pos_cfg = STRATEGY_CONFIGS.get(pos["strategy_name"], {})
                eod_hour = pos_cfg.get("eod_exit_hour", 15)
                eod_minute = pos_cfg.get("eod_exit_minute", 0)
                eod_time = candle_time.replace(hour=eod_hour, minute=eod_minute, second=0)
                if candle_time >= eod_time:
                    _close_position(key, c_close, candle_time, "EOD")

    for buf_sym, buf_candles in candle_buffer.items():
        if buf_candles:
            on_event({"type": "candles", "symbol": buf_sym, "candles": buf_candles})

    for key in list(open_positions.keys()):
        pos = open_positions[key]
        _close_position(key, pos["entry_price"], market_close, "FORCE_CLOSE")

    _print_summary(trades, strategies_to_run, portfolio, date_str)

    winners = [t for t in trades if t.net_pnl >= 0]
    losers = [t for t in trades if t.net_pnl < 0]
    total_pnl = sum(t.net_pnl for t in trades)
    total_costs = sum(t.costs for t in trades)
    gross_pnl = total_pnl + total_costs
    wr = len(winners) / len(trades) * 100 if trades else 0
    pf = sum(t.net_pnl for t in winners) / abs(sum(t.net_pnl for t in losers)) if losers else float("inf")

    by_strategy: Dict[str, List[ReplayTrade]] = {}
    for t in trades:
        by_strategy.setdefault(t.strategy_name, []).append(t)
    strategy_breakdown = {}
    for sname, strades in by_strategy.items():
        sw = [t for t in strades if t.net_pnl >= 0]
        sl = [t for t in strades if t.net_pnl < 0]
        strategy_breakdown[sname] = {
            "trades": len(strades),
            "win_rate": round(len(sw) / len(strades) * 100, 1) if strades else 0,
            "net_pnl": round(sum(t.net_pnl for t in strades), 2),
            "profit_factor": round(sum(t.net_pnl for t in sw) / abs(sum(t.net_pnl for t in sl)), 2) if sl else None,
            "min_rr_ratio": strategies.get(sname, {}).get("min_rr_ratio", 2.0),
        }

    on_event({
        "type": "summary",
        "total_trades": len(trades),
        "winners": len(winners),
        "losers": len(losers),
        "win_rate": round(wr, 1),
        "profit_factor": round(pf, 2) if pf != float("inf") else None,
        "gross_pnl": round(gross_pnl, 2),
        "total_costs": round(total_costs, 2),
        "net_pnl": round(total_pnl, 2),
        "strategy_breakdown": strategy_breakdown,
    })


def _print_summary(
    trades: List[ReplayTrade],
    strategies: dict,
    portfolio: SharedPortfolioManager,
    date_str: str,
):
    if not trades:
        console.print("[yellow]No trades executed.[/yellow]")
        return

    table = Table(title=f"Replay Results — {date_str}")
    table.add_column("#", style="dim", width=4)
    table.add_column("Strategy", width=18)
    table.add_column("Symbol", width=12)
    table.add_column("Side", width=5)
    table.add_column("Qty", width=5, justify="right")
    table.add_column("Entry", width=10, justify="right")
    table.add_column("Exit", width=10, justify="right")
    table.add_column("P&L", width=10, justify="right")
    table.add_column("P&L%", width=8, justify="right")
    table.add_column("Cost", width=8, justify="right")
    table.add_column("Net", width=10, justify="right")
    table.add_column("Reason", width=12)

    winners = [t for t in trades if t.net_pnl >= 0]
    losers = [t for t in trades if t.net_pnl < 0]
    total_pnl = sum(t.net_pnl for t in trades)
    total_costs = sum(t.costs for t in trades)
    gross_pnl = total_pnl + total_costs

    for i, t in enumerate(trades, 1):
        pnl_color = "green" if t.net_pnl >= 0 else "red"
        table.add_row(
            str(i), t.strategy_name, t.symbol, t.side, str(t.quantity),
            f"{t.entry_price:.2f}", f"{t.exit_price:.2f}",
            f"[{pnl_color}]{t.pnl:+.2f}[/{pnl_color}]",
            f"[{pnl_color}]{t.pnl_pct:+.2f}%[/{pnl_color}]",
            f"{t.costs:.2f}",
            f"[{pnl_color}]{t.net_pnl:+.2f}[/{pnl_color}]",
            t.exit_reason,
        )

    console.print()
    console.print(table)

    wr = len(winners) / len(trades) * 100
    pf = sum(t.net_pnl for t in winners) / abs(sum(t.net_pnl for t in losers)) if losers else float("inf")
    avg_win = sum(t.net_pnl for t in winners) / len(winners) if winners else 0
    avg_loss = sum(t.net_pnl for t in losers) / len(losers) if losers else 0

    summary = Table(title="Summary")
    summary.add_column("Metric", style="bold")
    summary.add_column("Value", justify="right")
    summary.add_row("Total Trades", str(len(trades)))
    summary.add_row("Winners / Losers", f"{len(winners)} / {len(losers)}")
    summary.add_row("Win Rate", f"{wr:.1f}%")
    summary.add_row("Profit Factor", f"{pf:.2f}" if pf != float("inf") else "inf")
    summary.add_row("Gross P&L", f"₹{gross_pnl:+,.2f}")
    summary.add_row("Total Costs", f"₹{total_costs:,.2f}")
    summary.add_row("Net P&L", f"₹{total_pnl:+,.2f}")
    summary.add_row("Avg Win", f"₹{avg_win:+,.2f}")
    summary.add_row("Avg Loss", f"₹{avg_loss:+,.2f}")

    console.print()
    console.print(summary)

    by_strategy: Dict[str, List[ReplayTrade]] = {}
    for t in trades:
        by_strategy.setdefault(t.strategy_name, []).append(t)

    if len(by_strategy) > 1:
        strat_table = Table(title="Per-Strategy Breakdown")
        strat_table.add_column("Strategy", style="bold")
        strat_table.add_column("Trades", justify="right")
        strat_table.add_column("Win Rate", justify="right")
        strat_table.add_column("Net P&L", justify="right")
        strat_table.add_column("PF", justify="right")

        for sname, strades in by_strategy.items():
            sw = [t for t in strades if t.net_pnl >= 0]
            sl = [t for t in strades if t.net_pnl < 0]
            swr = len(sw) / len(strades) * 100 if strades else 0
            spnl = sum(t.net_pnl for t in strades)
            spf = sum(t.net_pnl for t in sw) / abs(sum(t.net_pnl for t in sl)) if sl else float("inf")
            strat_table.add_row(
                sname, str(len(strades)), f"{swr:.1f}%",
                f"₹{spnl:+,.2f}", f"{spf:.2f}" if spf != float("inf") else "inf",
            )

        console.print()
        console.print(strat_table)


def main():
    parser = argparse.ArgumentParser(description="Replay a trading day using historical candles")
    parser.add_argument("--date", type=str, required=True, help="Date to replay (YYYY-MM-DD)")
    parser.add_argument("--symbols", type=str, default=None, help="Comma-separated symbol list")
    parser.add_argument("--strategy", type=str, default="ALL",
                        choices=["ALL", "ORB", "SR", "EMA", "52W"],
                        help="Strategy to run (default: ALL)")
    parser.add_argument("--verbose", "-v", action="store_true", help="Print every signal and trade")
    parser.add_argument("--refresh-cache", action="store_true", help="Re-fetch data even if cached")
    args = parser.parse_args()

    symbols = _load_symbols(args.symbols)
    run_replay(args.date, symbols, args.strategy, args.verbose, args.refresh_cache)


if __name__ == "__main__":
    main()
