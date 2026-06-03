"""
Utilities for backtest strategies.
"""
import os
from typing import Optional, Tuple


def _get_api_credentials() -> Tuple[Optional[str], Optional[str]]:
    key = os.getenv("UPSTOX_API_KEY") or os.getenv("UPSTOX_CLIENT_ID")
    secret = os.getenv("UPSTOX_API_SECRET") or os.getenv("UPSTOX_CLIENT_SECRET")
    if not key or not secret:
        return None, "UPSTOX_API_KEY and UPSTOX_API_SECRET environment variables are not set"
    return key, secret


def get_upstox_client_from_db(quiet: bool = True):
    from upstox_trader.config_and_utils.free_indian_apis import UpstoxAPI

    _api_key, _error = _get_api_credentials()
    if not _api_key:
        return None, _error

    _api_secret = os.getenv("UPSTOX_API_SECRET") or os.getenv("UPSTOX_CLIENT_SECRET")
    if not _api_secret:
        return None, "UPSTOX_API_SECRET environment variable is not set"

    try:
        from db.models import get_shared_broker_token
        token_data = get_shared_broker_token('upstox')

        if not token_data or not token_data.get('access_token'):
            return None, "No active Upstox broker connection. Please connect your broker in Settings."

        client = UpstoxAPI(api_key=_api_key, api_secret=_api_secret, quiet=quiet)
        client.auth_handler.access_token = token_data['access_token']

        return client, None

    except Exception as e:
        return None, f"Failed to initialize Upstox client: {str(e)}"


def get_upstox_client_with_token(access_token: str, quiet: bool = True):
    from upstox_trader.config_and_utils.free_indian_apis import UpstoxAPI

    _api_key, _error = _get_api_credentials()
    if not _api_key:
        return None, _error

    _api_secret = os.getenv("UPSTOX_API_SECRET") or os.getenv("UPSTOX_CLIENT_SECRET")
    if not _api_secret:
        return None, "UPSTOX_API_SECRET environment variable is not set"

    if not access_token:
        return None, "No access token provided and no broker connection found"

    try:
        client = UpstoxAPI(api_key=_api_key, api_secret=_api_secret, quiet=quiet)
        client.auth_handler.access_token = access_token

        return client, None

    except Exception as e:
        return None, f"Failed to initialize Upstox client: {str(e)}"


# =============================================================================
# Shared helpers to DRY the duplicated run_single_stock_* logic in
# backtest/strategies/week52_chaser.py and week52_target.py (and potentially others)
# =============================================================================

from typing import Optional, Dict, Any, Tuple
from datetime import datetime, timedelta
import pandas as pd

import config as root_config
IST = root_config.IST

# Nautilus imports are done inside the functions that need them, so that
# "import backtest.utils" (for its get_upstox_client_*) never requires nautilus.


def get_52w_backtest_dates(days: int) -> Tuple[str, str, int]:
    """Return (to_date, from_date, fetch_days) for data fetch."""
    today = datetime.now(IST)
    to_date = today.strftime('%Y-%m-%d')
    fetch_days = max(days + 400, 500)
    from_date = (today - timedelta(days=fetch_days)).strftime('%Y-%m-%d')
    return to_date, from_date, fetch_days


def normalize_df_for_nautilus(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize raw Upstox daily df for Nautilus (UTC tz, required cols)."""
    df_copy = df[['open', 'high', 'low', 'close', 'volume']].copy()
    if not isinstance(df_copy.index, pd.DatetimeIndex):
        df_copy.index = pd.to_datetime(df_copy.index)
    if df_copy.index.tz is None:
        df_copy.index = df_copy.index.tz_localize('UTC')
    else:
        df_copy.index = df_copy.index.tz_convert('UTC')
    df_copy = df_copy.sort_index()
    return df_copy


def filter_df_to_requested_range(df_utc: pd.DataFrame, days: int) -> Tuple[pd.DataFrame, Any]:
    """Return (df_for_backtest, cutoff_date) for the 'days' window."""
    today = datetime.now(IST)
    cutoff_date = (today - timedelta(days=days)).date()
    df_for = df_utc[df_utc.index.date >= cutoff_date].copy()
    return df_for, cutoff_date


def build_nautilus_equity_instrument(symbol: str, venue_name: str = "SIMULATED") -> Tuple[Any, Any, Any]:
    """Create venue/instrument/ for simulated backtest."""
    # local to avoid requiring nautilus on utils import
    from nautilus_trader.model import InstrumentId, Symbol, Venue
    from nautilus_trader.model.currencies import INR
    from nautilus_trader.model.instruments import Equity
    from nautilus_trader.model.objects import Price, Quantity
    venue = Venue(venue_name)
    instrument_id = InstrumentId.from_str(f"{symbol}.{venue}")
    instrument = Equity(
        instrument_id=instrument_id,
        raw_symbol=Symbol(symbol),
        currency=INR,
        price_precision=2,
        price_increment=Price.from_str("0.01"),
        lot_size=Quantity.from_str("1"),
        ts_event=0,
        ts_init=0,
        isin=None,
    )
    return venue, instrument_id, instrument


def create_daily_bar_type(instrument_id: Any) -> Any:
    from nautilus_trader.model import BarType, InstrumentId
    return BarType.from_str(f"{instrument_id}-1-DAY-LAST-EXTERNAL")


def wrangle_bars(bar_type: Any, instrument: Any, df_utc: pd.DataFrame):
    """Return list of Nautilus bars from full (warmup incl) df."""
    from nautilus_trader.persistence.wranglers import BarDataWrangler
    wrangler = BarDataWrangler(bar_type=bar_type, instrument=instrument)
    return wrangler.process(df_utc)


def make_backtest_engine(trader_id: Optional[str] = None) -> Any:
    """Create a fresh BacktestEngine. Pass trader_id for chaser-style."""
    from nautilus_trader.backtest.config import BacktestEngineConfig
    from nautilus_trader.backtest.engine import BacktestEngine
    from nautilus_trader.model import TraderId
    if trader_id:
        cfg = BacktestEngineConfig(trader_id=TraderId(trader_id))
    else:
        cfg = BacktestEngineConfig()
    return BacktestEngine(config=cfg)


def setup_venue_and_instrument(engine: Any, venue: Any, instrument: Any, starting_cash: int = 1_000_000) -> None:
    from nautilus_trader.model import Money
    from nautilus_trader.model.currencies import INR
    from nautilus_trader.model.enums import AccountType, OmsType
    engine.add_venue(
        venue=venue,
        oms_type=OmsType.NETTING,
        account_type=AccountType.CASH,
        base_currency=INR,
        starting_balances=[Money(starting_cash, INR)],
    )
    engine.add_instrument(instrument)


def add_bars_and_strategy(engine: Any, bars: list, strategy) -> None:
    engine.add_data(bars)
    engine.add_strategy(strategy=strategy)


def filter_trades_by_cutoff(trades: list, cutoff_date: Any) -> list:
    """Filter trades whose entry_time (iso) >= cutoff in IST date."""
    if not trades:
        return trades
    filtered = []
    for t in trades:
        if t.get('entry_time'):
            try:
                entry_dt = datetime.fromisoformat(t['entry_time'].replace('Z', '+00:00'))
                if entry_dt.astimezone(IST).date() >= cutoff_date:
                    filtered.append(t)
            except Exception:
                # if parse fails keep or skip; prior code kept only parsable
                pass
    return filtered


def build_candle_data(df: pd.DataFrame) -> Dict[str, list]:
    """Build the candles dict shape expected by callers."""
    idx = df.index
    return {
        'index': [i.strftime('%Y-%m-%d') if hasattr(i, 'strftime') else str(i)[:10] for i in idx],
        'open': df['open'].tolist(),
        'high': df['high'].tolist(),
        'low': df['low'].tolist(),
        'close': df['close'].tolist(),
        'volume': df['volume'].tolist() if 'volume' in df.columns else [0] * len(df),
    }


def compute_52w_result_metrics(trades: list, include_costs: bool = True, strategy_kind: str = 'generic') -> Dict[str, Any]:
    """
    Common aggregation for the 'result' subdict + top counts.
    strategy_kind can be 'chaser' or 'target' to include appropriate exit buckets (harmless extra ok).
    """
    if not trades:
        return {}
    gross_pnl = sum(t['gross_pnl'] for t in trades)
    total_costs = sum(t['trading_costs'] for t in trades) if include_costs else 0
    net_pnl = gross_pnl - total_costs

    wins = sum(1 for t in trades if t['net_pnl'] > 0)
    losses = sum(1 for t in trades if t['net_pnl'] < 0)
    total_trades = wins + losses
    win_rate = (wins / total_trades * 100) if total_trades > 0 else 0

    gross_profits = sum(t['net_pnl'] for t in trades if t['net_pnl'] > 0)
    gross_losses = abs(sum(t['net_pnl'] for t in trades if t['net_pnl'] < 0))
    profit_factor = gross_profits / gross_losses if gross_losses > 0 else (float('inf') if gross_profits > 0 else 0)

    res = {
        'trades': total_trades,
        'wins': wins,
        'losses': losses,
        'win_rate': round(win_rate, 1 if strategy_kind == 'chaser' else 2),
        'gross_pnl': round(gross_pnl, 2),
        'total_costs': round(total_costs, 2),
        'net_pnl': round(net_pnl, 2),
        'pf': round(profit_factor, 2),
    }

    # exit buckets (both strategies emit some; include what we can detect)
    for reason, key in [('TP', 'tp_exits'), ('SL', 'sl_exits'), ('TRAILING_STOP', 'trailing_exits'), ('MAX_HOLDING', 'max_hold_exits'), ('NEW_52W_HIGH', 'new_52w_exits')]:
        cnt = sum(1 for t in trades if t.get('exit_reason') == reason)
        if cnt or key in ('tp_exits', 'sl_exits', 'trailing_exits', 'max_hold_exits'):  # always emit common ones
            res[key] = cnt

    return res
