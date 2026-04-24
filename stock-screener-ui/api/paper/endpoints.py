"""
Additional endpoints: signals, risk, health, chart, config.
"""

import asyncio
import sys
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException, Depends
from pydantic import BaseModel

from trading.paper_trader import get_paper_trader
from trading.risk_manager import get_risk_manager
from trading.journal import get_journal
from trading.orb_signals import create_entry_signal
from api.auth import get_current_user
from db.models import User
from db.database import SessionLocal
from db.models import StrategyConfig
import config
from rich.console import Console

from .paper_api import router, _get_user_id, _load_fresh_bot_snapshot, _get_symbol_trades_from_db
from .chart_cache import get_cached_candles, save_cached_candles

console = Console()


class StrategyConfigUpdate(BaseModel):
    or_minutes: Optional[int] = None
    sl_pct: Optional[float] = None
    tp_pct: Optional[float] = None
    min_or_range_pct: Optional[float] = None
    max_or_range_pct: Optional[float] = None
    max_positions: Optional[int] = None
    max_capital_per_trade_pct: Optional[float] = None
    max_daily_loss_pct: Optional[float] = None
    max_total_exposure_pct: Optional[float] = None
    risk_per_trade_pct: Optional[float] = None
    min_trade_value: Optional[float] = None
    max_trade_value: Optional[float] = None
    cooldown_minutes: Optional[int] = None
    max_distance_from_or_pct: Optional[float] = None
    brokerage_pct: Optional[float] = None
    min_brokerage: Optional[float] = None
    stt_pct: Optional[float] = None
    exchange_pct: Optional[float] = None
    sebi_pct: Optional[float] = None
    stamp_pct: Optional[float] = None
    gst_pct: Optional[float] = None


@router.get("/signals")
async def get_signals():
    """Get current ORB signals from screener."""
    try:
        sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'scanners'))
        from orb_stock_screener import ORBStockScreener

        screener = ORBStockScreener(use_relaxed=True)
        df = screener.screen(limit=100, verify_nse=True)

        signals = []
        for _, row in df.head(20).iterrows():
            signals.append({
                "symbol": row['name'],
                "price": row['close'],
                "rsi": round(row['RSI'], 1),
                "adx": round(row['ADX'], 1),
                "atr_pct": round(row.get('atr_pct', 0), 2),
                "score": round(row.get('orb_score', 0), 1),
            })

        return {
            "count": len(signals),
            "signals": signals,
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/signal/create")
async def create_signal(
    symbol: str,
    price: float,
    or_high: float,
    or_low: float,
    side: str = "LONG",
    sl_pct: float = 0.4,
    tp_pct: float = 1.2,
    user: "User" = Depends(get_current_user),
):
    """Create a manual ORB signal."""
    signal = create_entry_signal(
        symbol=symbol.upper(),
        price=price,
        or_high=or_high,
        or_low=or_low,
        sl_pct=sl_pct,
        tp_pct=tp_pct,
        side=side.upper(),
    )

    return {
        "symbol": signal.symbol,
        "signal_type": signal.signal_type.value,
        "price": signal.price,
        "stop_loss": signal.stop_loss,
        "take_profit": signal.take_profit,
        "or_high": signal.or_high,
        "or_low": signal.or_low,
        "or_range_pct": signal.or_range_pct,
        "timestamp": signal.timestamp.isoformat(),
    }


@router.get("/risk/config")
async def get_risk_config():
    """Get risk management configuration."""
    risk_manager = get_risk_manager()
    return risk_manager.get_config()


@router.post("/risk/validate")
async def validate_trade(
    entry_price: float,
    stop_loss: float,
    take_profit: float,
    side: str = "BUY",
):
    """Validate a potential trade."""
    trader = get_paper_trader()
    risk_manager = get_risk_manager()
    portfolio = trader.get_portfolio_status()

    validation = risk_manager.validate_trade(
        capital=portfolio['total_value'],
        cash=portfolio['cash'],
        current_positions=len(trader.positions),
        current_exposure=portfolio['margin_used'],
        entry_price=entry_price,
        stop_loss=stop_loss,
        take_profit=take_profit,
        side=side.upper(),
    )

    return validation


@router.get("/health")
async def health_check():
    """Health check endpoint."""
    trader = get_paper_trader()
    return {
        "status": "healthy",
        "portfolio_value": trader.get_portfolio_status()['total_value'],
        "open_positions": len(trader.positions),
        "total_trades": len(trader.trades),
        "timestamp": datetime.now().isoformat(),
    }


@router.get("/chart/{symbol}")
async def get_paper_chart(
    symbol: str,
    date: Optional[str] = None,
    timeframe: str = "5min",
    strategy_id: Optional[int] = None,
    user: "User" = Depends(get_current_user),
):
    """
    Get intraday chart data with paper trade markers.
    """
    try:
        import pandas as pd
        sys.path.insert(0, str(Path(__file__).parent.parent.parent))
        from upstox_trader.config_and_utils.free_indian_apis import UpstoxAPI
        upstox_api = UpstoxAPI(
            api_key=config.UPSTOX_API_KEY or "",
            api_secret=config.UPSTOX_API_SECRET or "",
            quiet=True,
        )

        def _resample_to_timeframe(df_1m, tf: str):
            if df_1m is None or df_1m.empty:
                return None

            tf_map = {
                '1min': '1min',
                '5min': '5min',
                '15min': '15min',
                '30min': '30min',
                '1hour': '1h',
            }
            resample_str = tf_map.get(tf, '5min')

            df_work = df_1m.copy()

            if not isinstance(df_work.index, pd.DatetimeIndex):
                df_work.index = pd.to_datetime(df_work.index)

            df_work = df_work.sort_index()

            agg_map = {
                'open': 'first',
                'high': 'max',
                'low': 'min',
                'close': 'last',
                'volume': 'sum',
            }
            available_agg = {k: v for k, v in agg_map.items() if k in df_work.columns}
            if {'open', 'high', 'low', 'close'} - set(available_agg.keys()):
                return None

            resampled = (
                df_work
                .resample(resample_str, label='left', closed='left')
                .agg(available_agg)
                .dropna(subset=['open', 'high', 'low', 'close'])
            )

            return resampled if not resampled.empty else None

        today = datetime.now(config.IST).strftime('%Y-%m-%d')
        if date is None:
            date = today

        def _filter_to_date_or_recent(df_full, target_date_str):
            if df_full is None or df_full.empty:
                return df_full
            date_start = pd.Timestamp(target_date_str + " 00:00:00", tz=config.IST)
            date_end = pd.Timestamp(target_date_str + " 23:59:59", tz=config.IST)
            filtered = df_full[(df_full.index >= date_start) & (df_full.index <= date_end)]
            if filtered.empty:
                last_day = df_full.index.date[-1]
                target_day = date_start.date()
                if last_day == target_day or (last_day < target_day):
                    return df_full
            return filtered

        def _fetch_chart_data():
            sym = symbol.upper()

            if timeframe == '1day':
                cached_df, cached = get_cached_candles(sym, date)
                if cached_df is not None:
                    return cached_df, True
                from_date = (datetime.strptime(date, '%Y-%m-%d') - timedelta(days=10)).strftime('%Y-%m-%d')
                df_1m = upstox_api.fetch_historical_data_v3(
                    sym, unit='days', interval=1,
                    to_date=date, from_date=from_date,
                )
                df_1m = _filter_to_date_or_recent(df_1m, date)
                save_cached_candles(sym, date, df_1m)
                return df_1m, False

            cached_df, cached = get_cached_candles(sym, date)
            if cached_df is not None:
                return cached_df, True

            if date == today:
                df_1m = upstox_api.fetch_intraday_data_v3(sym, interval='1')
                if df_1m is not None and not df_1m.empty:
                    save_cached_candles(sym, date, df_1m)
                return df_1m, False

            df_1m = upstox_api.fetch_historical_data_v3(
                sym, unit='minutes', interval=1, to_date=date,
            )
            df_1m = _filter_to_date_or_recent(df_1m, date)
            save_cached_candles(sym, date, df_1m)
            return df_1m, False

        df_1m, cached = await asyncio.to_thread(_fetch_chart_data)

        df = _resample_to_timeframe(df_1m, timeframe) if timeframe != '1day' else df_1m

        if df is None or df.empty:
            return {"error": f"No data for {symbol} on {date}", "symbol": symbol, "date": date}

        candles = []
        for idx, row in df.iterrows():
            time_str = idx.isoformat() if hasattr(idx, 'isoformat') else str(idx)
            candles.append({
                "time": time_str,
                "open": float(row['open']),
                "high": float(row['high']),
                "low": float(row['low']),
                "close": float(row['close']),
                "volume": int(row.get('volume', 0)),
            })

        or_minutes = 45
        if strategy_id:
            try:
                from db.models.bot import StrategyConfig
                from db.database import SessionLocal
                with SessionLocal() as db:
                    cfg = db.query(StrategyConfig).filter(StrategyConfig.id == strategy_id).first()
                    if cfg:
                        or_minutes = cfg.or_minutes
            except Exception:
                pass

        or_candle_count = max(1, or_minutes // 5)
        or_candles = candles[:or_candle_count] if len(candles) >= or_candle_count else candles
        orb_levels = None
        if or_candles:
            or_high = max(c['high'] for c in or_candles)
            or_low = min(c['low'] for c in or_candles)
            or_open = or_candles[0]['open'] if or_candles else 0
            orb_levels = {
                "or_high": or_high,
                "or_low": or_low,
                "or_open": or_open,
                "or_range": or_high - or_low,
                "or_range_pct": ((or_high - or_low) / or_open * 100) if or_open > 0 else 0,
                "or_minutes": or_minutes,
            }

        ema_series = None
        try:
            with SessionLocal() as db:
                strategy_config = db.query(StrategyConfig).filter(
                    StrategyConfig.is_active == True,
                    StrategyConfig.strategy_type == "EMA_CROSS"
                ).first()
            ema_fast_period = strategy_config.ema_fast_period if strategy_config else 9
            ema_slow_period = strategy_config.ema_slow_period if strategy_config else 21
            closes = df['close'].tolist()
            ema_fast = pd.Series(closes).ewm(span=ema_fast_period, adjust=False).mean().round(2).tolist()
            ema_slow = pd.Series(closes).ewm(span=ema_slow_period, adjust=False).mean().round(2).tolist()
            ema_series = {
                'ema_fast': {'label': f'EMA {ema_fast_period}', 'color': '#10ac84', 'data': ema_fast},
                'ema_slow': {'label': f'EMA {ema_slow_period}', 'color': '#ee5253', 'data': ema_slow},
            }
        except Exception as e:
            console.print(f"[yellow]EMA series computation failed: {e}[/yellow]")

        week52_levels = None
        pivot_levels = None
        try:
            to_date = datetime.now(config.IST).strftime('%Y-%m-%d')
            from_date = (datetime.now(config.IST) - timedelta(days=400)).strftime('%Y-%m-%d')
            df_52w = upstox_api.fetch_historical_data_v3(
                symbol=symbol.upper(),
                unit='days',
                interval=1,
                to_date=to_date,
                from_date=from_date,
            )
            if df_52w is not None and not df_52w.empty:
                highs = df_52w['high'].tolist()
                lows = df_52w['low'].tolist()
                window = highs[-252:] if len(highs) >= 252 else highs
                high_52w = max(window) if window else 0
                low_window = lows[-252:] if len(lows) >= 252 else lows
                low_52w = min(low_window) if low_window else 0
                if high_52w > 0:
                    current_price = candles[-1]['close'] if candles else 0
                    week52_levels = {
                        "high_52w": float(high_52w),
                        "low_52w": float(low_52w) if low_52w > 0 else 0,
                        "distance_to_high_pct": ((high_52w - current_price) / high_52w * 100) if high_52w > 0 and current_price > 0 else 0,
                        "distance_to_low_pct": ((current_price - low_52w) / low_52w * 100) if low_52w > 0 and current_price > 0 else 0,
                        "near_high": ((high_52w - current_price) / high_52w * 100) <= 3.0 if high_52w > 0 and current_price > 0 else False,
                    }

                    date_ts = pd.Timestamp(date + " 00:00:00", tz=config.IST)
                    prev_days = df_52w[df_52w.index < date_ts]
                    if not prev_days.empty:
                        last = prev_days.iloc[-1]
                        prev_h, prev_l, prev_c = float(last['high']), float(last['low']), float(last['close'])
                        pp = (prev_h + prev_l + prev_c) / 3
                        hl = prev_h - prev_l
                        pivot_levels = {
                            "pp": round(pp, 2),
                            "r1": round(2 * pp - prev_l, 2),
                            "r2": round(pp + hl, 2),
                            "s1": round(2 * pp - prev_h, 2),
                            "s2": round(pp - hl, 2),
                        }
        except Exception as e:
            console.print(f"[yellow]Could not fetch 52W levels for {symbol}: {e}[/yellow]")

        uid = _get_user_id(user)
        symbol_trades = _get_symbol_trades_from_db(uid, symbol, date)

        if not symbol_trades:
            journal_dir = Path(__file__).parent.parent.parent / "journals" / str(uid)
            date_str = date.replace('-', '')
            journal_file = journal_dir / f"journal_{date_str}.json"

            if journal_file.exists():
                from trading.journal import TradeJournal
                temp_journal = TradeJournal(user_id=uid)
                try:
                    temp_journal.load_journal(str(journal_file))
                    symbol_trades = [
                        t for t in temp_journal.trades
                        if t.symbol == symbol.upper()
                    ]
                except Exception as e:
                    console.print(f"[yellow]Could not load journal for {date}: {e}[/yellow]")
            else:
                journal = get_journal(uid)
                symbol_trades = [
                    t for t in journal.trades
                    if t.symbol == symbol.upper() and t.exit_time.startswith(date)
                ]

        def _trade_to_dict(t):
            def _calc_hold(entry, exit_):
                if not entry or not exit_:
                    return None
                try:
                    et = datetime.fromisoformat(entry)
                    xt = datetime.fromisoformat(exit_)
                    if et.tzinfo is None:
                        et = et.replace(tzinfo=config.IST)
                    if xt.tzinfo is None:
                        xt = xt.replace(tzinfo=config.IST)
                    return int((xt - et).total_seconds() / 60)
                except (ValueError, TypeError):
                    return None

            if isinstance(t, dict):
                return {
                    "trade_id": t.get("trade_id", ""),
                    "symbol": t.get("symbol", ""),
                    "side": t.get("side", ""),
                    "quantity": t.get("quantity", 0),
                    "entry_price": t.get("entry_price", 0),
                    "exit_price": t.get("exit_price"),
                    "entry_time": t.get("entry_time", ""),
                    "exit_time": t.get("exit_time", ""),
                    "pnl": t.get("pnl", 0),
                    "pnl_pct": t.get("pnl_pct", 0),
                    "exit_reason": t.get("exit_reason", ""),
                    "costs": t.get("costs", 0),
                    "net_pnl": t.get("net_pnl", 0),
                    "sl_price": t.get("stop_loss", 0),
                    "tp_price": t.get("take_profit", 0),
                    "peak_price": t.get("peak_price", 0),
                    "low_price": t.get("low_price", 0),
                    "hold_duration_minutes": _calc_hold(t.get("entry_time"), t.get("exit_time")),
                    "strategy_id": t.get("strategy_id", 0),
                    "strategy_name": t.get("strategy_name", ""),
                    "reason": t.get("reason", ""),
                    "notes": t.get("notes", ""),
                    "bot_id": t.get("bot_id"),
                    "bot_name": t.get("bot_name"),
                    "strategy_type": t.get("strategy_type", ""),
                }
            return {
                "trade_id": t.trade_id,
                "symbol": t.symbol,
                "side": t.side,
                "quantity": t.quantity,
                "entry_price": t.entry_price,
                "exit_price": t.exit_price,
                "entry_time": t.entry_time,
                "exit_time": t.exit_time,
                "pnl": t.pnl,
                "pnl_pct": t.pnl_pct,
                "exit_reason": t.exit_reason,
                "costs": t.costs,
                "net_pnl": t.net_pnl,
                "sl_price": t.sl_price,
                "tp_price": t.tp_price,
                "peak_price": getattr(t, 'peak_price', 0),
                "low_price": getattr(t, 'low_price', 0),
                "hold_duration_minutes": _calc_hold(t.entry_time, t.exit_time),
                "strategy_id": t.strategy_id,
                "strategy_name": t.strategy_name,
                "reason": getattr(t, 'reason', ''),
                "notes": getattr(t, 'notes', ''),
                "bot_id": getattr(t, 'bot_id', None),
                "bot_name": getattr(t, 'bot_name', None),
                "strategy_type": getattr(t, 'strategy_type', ''),
            }

        trades_data = [_trade_to_dict(t) for t in symbol_trades]

        current_position = None
        snap = _load_fresh_bot_snapshot()
        if snap:
            snap_positions = snap.get("positions") or snap.get("open_positions_data") or []
            for pos in snap_positions:
                if pos.get("symbol", "").upper() == symbol.upper():
                    current_position = pos
                    break

        if not current_position:
            trader = get_paper_trader()
            if symbol.upper() in trader.positions:
                pos = trader.positions[symbol.upper()]
                current_position = {
                    "symbol": pos.symbol,
                    "side": pos.side.value,
                    "quantity": pos.quantity,
                    "entry_price": pos.entry_price,
                    "current_price": pos.current_price,
                    "entry_time": pos.entry_time.isoformat(),
                    "stop_loss": pos.stop_loss,
                    "take_profit": pos.take_profit,
                    "pnl": pos.pnl,
                    "pnl_pct": pos.pnl_pct,
                    "margin_used": pos.margin_used,
                    "order_id": pos.order_id,
                }

        return {
            "symbol": symbol.upper(),
            "date": date,
            "timeframe": timeframe,
            "candles": candles,
            "trades": trades_data,
            "orb_levels": orb_levels,
            "week52_levels": week52_levels,
            "pivot_levels": pivot_levels,
            "ema_series": ema_series,
            "current_position": current_position,
            "cached": cached,
        }

    except Exception as e:
        console.print(f"[red]Error fetching chart data: {e}[/red]")
        return {"error": str(e), "symbol": symbol, "date": date}


@router.get("/config")
async def get_strategy_config_endpoint(
    name: Optional[str] = None,
    strategy_id: Optional[int] = None,
):
    """Get strategy configuration from database."""
    try:
        from trading.config_loader import get_strategy_config, get_strategy_by_id

        if strategy_id:
            config_data = get_strategy_by_id(strategy_id)
            if not config_data:
                raise HTTPException(status_code=404, detail=f"Strategy {strategy_id} not found")
        else:
            config_data = get_strategy_config(name)

        return {
            "status": "success",
            "config": config_data.to_dict(),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load config: {e}")


@router.put("/config")
async def update_strategy_config_endpoint(
    request: StrategyConfigUpdate,
    name: str = "orb_default",
    user: "User" = Depends(get_current_user),
):
    """Update strategy configuration in database."""
    try:
        with SessionLocal() as db:
            config_data = db.query(StrategyConfig).filter(
                StrategyConfig.name == name
            ).first()

            if not config_data:
                config_data = StrategyConfig(name=name, strategy_type="ORB", is_default=(name == "orb_default"))
                db.add(config_data)

            update_data = request.model_dump(exclude_unset=True)
            for key, value in update_data.items():
                if value is not None and hasattr(config_data, key):
                    setattr(config_data, key, value)

            db.commit()
            db.refresh(config_data)

            return {
                "status": "success",
                "message": f"Config '{name}' updated",
                "config": config_data.to_dict(),
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update config: {e}")


@router.post("/config/reset")
async def reset_strategy_config_endpoint(name: str = "orb_default", user: "User" = Depends(get_current_user)):
    """Reset strategy configuration to defaults."""
    try:
        with SessionLocal() as db:
            config_data = db.query(StrategyConfig).filter(
                StrategyConfig.name == name
            ).first()

            if not config_data:
                raise HTTPException(status_code=404, detail=f"Config '{name}' not found")

            config_data.or_minutes = 45
            config_data.sl_pct = 0.4
            config_data.tp_pct = 1.2
            config_data.min_or_range_pct = 0.5
            config_data.max_or_range_pct = 3.0
            config_data.max_positions = 5
            config_data.max_capital_per_trade_pct = 0.10
            config_data.max_daily_loss_pct = 0.02
            config_data.max_total_exposure_pct = 0.50
            config_data.risk_per_trade_pct = 0.01
            config_data.min_trade_value = 5000
            config_data.max_trade_value = 100000
            config_data.cooldown_minutes = 30
            config_data.max_distance_from_or_pct = 1.5
            config_data.brokerage_pct = 0.0003
            config_data.min_brokerage = 20
            config_data.stt_pct = 0.00025
            config_data.exchange_pct = 0.0000297
            config_data.sebi_pct = 0.000001
            config_data.stamp_pct = 0.00003
            config_data.gst_pct = 0.18

            db.commit()
            db.refresh(config_data)

            return {
                "status": "success",
                "message": f"Config '{name}' reset to defaults",
                "config": config_data.to_dict(),
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reset config: {e}")
