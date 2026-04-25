"""
Shared helper utilities for upstox_trader/screeners.

Provides common initialization and utility functions to eliminate
code duplication across screener modules.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import rookiepy
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from rich.console import Console
from rich.table import Table

console = Console()

__all__ = [
    'init_telegram',
    'init_upstox_api',
    'display_table',
    'get_tradingview_cookies',
    'check_historical_trend',
    'COLUMN_CONFIG',
    'console',
]


def init_telegram(quiet=False):
    """Initialize Telegram configuration.

    Returns:
        tuple: (telegram_enabled, bot_token, chat_id)
    """
    try:
        import requests as _req
    except ImportError:
        if not quiet:
            console.print("[yellow]⚠️ 'requests' not installed - Telegram alerts disabled[/yellow]")
        return False, None, None

    try:
        from config import TELEGRAM_CONFIG
    except ImportError:
        if not quiet:
            console.print("[yellow]⚠️ TELEGRAM_CONFIG not found - Telegram alerts disabled[/yellow]")
        return False, None, None

    bot_token = TELEGRAM_CONFIG.get('bot_token')
    chat_id = TELEGRAM_CONFIG.get('chat_id')
    telegram_enabled = bool(bot_token)

    if telegram_enabled:
        if not quiet:
            console.print("[green]✅ Telegram alerts enabled[/green]")
    else:
        if not quiet:
            console.print("[yellow]⚠️ Telegram alerts disabled - configure TELEGRAM_CONFIG[/yellow]")

    return telegram_enabled, bot_token, chat_id


def init_upstox_api(quiet=False):
    """Initialize Upstox API from UPSTOX_CONFIG.

    Returns:
        UpstoxAPI instance, or None if initialization fails.
    """
    try:
        from config import UPSTOX_CONFIG
    except ImportError:
        if not quiet:
            console.print("[yellow]⚠️ UPSTOX_CONFIG not found[/yellow]")
        return None

    try:
        from upstox_trader.config_and_utils.free_indian_apis import UpstoxAPI
    except ImportError:
        if not quiet:
            console.print("[yellow]⚠️ Upstox API module not available[/yellow]")
        return None

    api_key = UPSTOX_CONFIG.get('api_key')
    api_secret = UPSTOX_CONFIG.get('api_secret')

    if not api_key or not api_secret:
        if not quiet:
            console.print("[red]⚠️ UPSTOX_CONFIG missing api_key or api_secret[/red]")
        return None

    try:
        upstox_api = UpstoxAPI(api_key=api_key, api_secret=api_secret)

        if not upstox_api.auth_handler.access_token:
            if not quiet:
                console.print("[yellow]🔑 No cached token - authenticating (browser will open)...[/yellow]")
            if not upstox_api.auth_handler.authenticate():
                if not quiet:
                    console.print("[red]❌ Upstox authentication failed[/red]")
                    console.print("[red]💡 Please check your UPSTOX_CONFIG credentials[/red]")
                return None
            else:
                if not quiet:
                    console.print("[green]✅ Upstox authentication successful[/green]")
        else:
            if not quiet:
                console.print("[green]✅ Upstox authentication loaded from cache[/green]")

        return upstox_api

    except Exception as e:
        if not quiet:
            console.print(f"[red]❌ Upstox API initialization failed: {e}[/red]")
        return None


COLUMN_CONFIG = {
    'ticker': {
        'display_name': 'Ticker',
        'style': 'cyan',
        'no_wrap': True,
        'formatter': lambda x: str(x)
    },
    'name': {
        'display_name': 'Name',
        'style': 'green',
        'max_width': 12,
        'formatter': lambda x: str(x)[:12]
    },
    'close': {
        'display_name': 'Price',
        'justify': 'right',
        'style': 'yellow',
        'formatter': lambda x: f"₹{x:,.2f}"
    },
    'volume': {
        'display_name': 'Volume',
        'justify': 'right',
        'style': 'blue',
        'formatter': lambda x: f"{x:,.0f}"
    },
    'change': {
        'display_name': 'Change %',
        'justify': 'right',
        'style': 'magenta',
        'formatter': lambda x: f"[green]{x:+.2f}%[/green]" if x > 0 else f"[red]{x:+.2f}%[/red]"
    },
    'RSI': {
        'display_name': 'RSI',
        'justify': 'right',
        'style': 'cyan',
        'formatter': lambda x: f"[red]{x:.1f}[/red]" if x > 70 else f"[green]{x:.1f}[/green]" if x < 30 else f"{x:.1f}"
    },
    'relative_volume_10d_calc': {
        'display_name': 'Vol Ratio',
        'justify': 'right',
        'style': 'blue',
        'formatter': lambda x: f"{x:.2f}x"
    },
    'Volatility.D': {
        'display_name': 'Volatility %',
        'justify': 'right',
        'style': 'red',
        'formatter': lambda x: f"{x*100:.1f}%"
    },
    'market_cap_basic': {
        'display_name': 'MCap (₹Cr)',
        'justify': 'right',
        'style': 'green',
        'formatter': lambda x: f"₹{x/1e7:,.0f}"
    },
    'price_earnings_ttm': {
        'display_name': 'PE',
        'justify': 'right',
        'style': 'yellow',
        'formatter': lambda x: "N/A" if pd.isna(x) else f"{x:.1f}"
    },
    'return_on_equity': {
        'display_name': 'ROE %',
        'justify': 'right',
        'style': 'green',
        'formatter': lambda x: "N/A" if pd.isna(x) else f"{x:.1f}%"
    },
    'dividends_yield_current': {
        'display_name': 'Div Yield',
        'justify': 'right',
        'style': 'blue',
        'formatter': lambda x: "N/A" if pd.isna(x) else f"{x:.2f}%"
    },
    'debt_to_equity': {
        'display_name': 'D/E',
        'justify': 'right',
        'style': 'red',
        'formatter': lambda x: "N/A" if pd.isna(x) else f"{x:.2f}"
    },
    'update_mode': {
        'display_name': 'Data',
        'style': 'dim',
        'formatter': lambda x: str(x)
    },
    'trend': {
        'display_name': 'Trend',
        'style': 'bold',
        'justify': 'center',
        'formatter': lambda x: {
            'strong_bullish': "[bold green]🚀 Strong Bull[/bold green]",
            'bullish': "[green]📈 Bullish[/green]",
            'neutral': "[yellow]➡️ Neutral[/yellow]",
            'bearish': "[red]📉 Bearish[/red]",
            'strong_bearish': "[bold red]💥 Strong Bear[/bold red]"
        }.get(x, f"[dim]{x}[/dim]")
    }
}


def _get_currency_price_formatter(currency_symbol='₹'):
    return lambda x: f"{currency_symbol}{x:,.2f}"


def display_table(df, title, max_rows=15, currency_symbol='₹'):
    """Display a dataframe in a formatted Rich table.

    Args:
        df: pandas DataFrame to display.
        title: Table title string.
        max_rows: Maximum number of rows to render.
        currency_symbol: Currency symbol for price formatting.
    """
    if df.empty:
        console.print(f"[red]No results found for {title}[/red]")
        return

    column_config = COLUMN_CONFIG.copy()
    if 'close' in df.columns:
        column_config['close'] = column_config['close'].copy()
        column_config['close']['formatter'] = _get_currency_price_formatter(currency_symbol)

    table = Table(title=title, show_header=True, header_style="bold magenta")

    for col_name in df.columns:
        config = column_config.get(col_name, {})
        display_name = config.get('display_name', col_name)
        column_props = {
            'style': config.get('style'),
            'justify': config.get('justify'),
            'no_wrap': config.get('no_wrap', False),
            'max_width': config.get('max_width')
        }
        column_props = {k: v for k, v in column_props.items() if v is not None}
        table.add_column(display_name, **column_props)

    for _, row in df.head(max_rows).iterrows():
        row_data = []
        for col_name in df.columns:
            config = column_config.get(col_name, {})
            value = row[col_name]
            formatter = config.get('formatter')
            row_data.append(formatter(value) if formatter else str(value))
        table.add_row(*row_data)

    console.print(table)
    console.print(f"[dim]Showing {min(len(df), max_rows)} of {len(df)} results[/dim]")


def get_tradingview_cookies(quiet=False):
    """Get TradingView cookies from browser with Chrome then Firefox fallback.

    Args:
        quiet: Suppress console output.

    Returns:
        cookiejar object, or None if no cookies found.
    """
    try:
        cookies_raw = rookiepy.chrome(['.tradingview.com'])
        cookies = rookiepy.to_cookiejar(cookies_raw)
        if not quiet:
            console.print("[green]Successfully loaded cookies from Chrome[/green]")
        if cookies_raw and not quiet:
            console.print("[green]✅ Found TradingView cookies - expecting live data[/green]")
        elif not cookies_raw and not quiet:
            console.print("[yellow]⚠️  No cookies found[/yellow]")
        return cookies
    except Exception:
        if not quiet:
            console.print("[yellow]Chrome cookies failed, trying Firefox...[/yellow]")
        try:
            cookies_raw = rookiepy.firefox(['.tradingview.com'])
            cookies = rookiepy.to_cookiejar(cookies_raw)
            if not quiet:
                console.print("[green]Successfully loaded cookies from Firefox[/green]")
            if cookies_raw and not quiet:
                console.print("[green]✅ Found TradingView cookies - expecting live data[/green]")
            elif not cookies_raw and not quiet:
                console.print("[yellow]⚠️  No cookies found[/yellow]")
            return cookies
        except Exception:
            if not quiet:
                console.print("[red]Could not load cookies from any browser.[/red]")
                console.print("[yellow]💡 Make sure you're logged into TradingView in your browser[/yellow]")
                console.print("[yellow]💡 Try refreshing the TradingView page and run script again[/yellow]")
            return None


def check_historical_trend(symbol, timeframe='daily', lookback_days=20, upstox_api=None):
    """Analyze historical trend using multiple indicators.

    Args:
        symbol: Instrument symbol (e.g. 'NSE_RELIANCE').
        timeframe: 'daily' or 'hourly'.
        lookback_days: Number of days to look back.
        upstox_api: UpstoxAPI instance. If None, returns 'neutral'.

    Returns:
        One of: 'strong_bullish', 'bullish', 'neutral', 'bearish', 'strong_bearish'
    """
    if upstox_api is None:
        return 'neutral'

    try:
        to_date = datetime.now().strftime('%Y-%m-%d')

        if timeframe == 'daily':
            from_date = (datetime.now() - timedelta(days=lookback_days)).strftime('%Y-%m-%d')
            df = upstox_api.fetch_historical_data_v3(
                symbol=symbol,
                unit='days',
                interval=1,
                to_date=to_date,
                from_date=from_date
            )
        else:
            hourly_lookback = min(lookback_days, 90)
            hourly_from_date = (datetime.now() - timedelta(days=hourly_lookback)).strftime('%Y-%m-%d')
            df = upstox_api.fetch_historical_data_v3(
                symbol=symbol,
                unit='hours',
                interval=1,
                to_date=to_date,
                from_date=hourly_from_date
            )

        if df is None or df.empty or len(df) < 10:
            return 'neutral'

        timestamp_col = None
        for col in ['timestamp', 'datetime', 'date', 'time']:
            if col in df.columns:
                timestamp_col = col
                break

        if timestamp_col:
            df = df.sort_values(timestamp_col).reset_index(drop=True)
        else:
            df = df.reset_index(drop=True)

        df['sma_5'] = df['close'].rolling(5).mean()
        df['sma_10'] = df['close'].rolling(10).mean()
        df['sma_20'] = df['close'].rolling(20).mean() if len(df) >= 20 else df['close'].rolling(len(df) // 2).mean()

        current_price = df['close'].iloc[-1]
        sma_5 = df['sma_5'].iloc[-1]
        sma_10 = df['sma_10'].iloc[-1]
        sma_20 = df['sma_20'].iloc[-1]

        sma_5_slope = (df['sma_5'].iloc[-1] - df['sma_5'].iloc[-3]) / 3 if len(df) >= 3 else 0
        sma_10_slope = (df['sma_10'].iloc[-1] - df['sma_10'].iloc[-5]) / 5 if len(df) >= 5 else 0

        avg_volume = df['volume'].rolling(10).mean().iloc[-1] if len(df) >= 10 else df['volume'].mean()
        recent_volume = df['volume'].iloc[-3:].mean()
        volume_strength = recent_volume / avg_volume if avg_volume > 0 else 1

        price_change_5d = (current_price - df['close'].iloc[-6]) / df['close'].iloc[-6] * 100 if len(df) >= 6 else 0
        price_change_10d = (current_price - df['close'].iloc[-11]) / df['close'].iloc[-11] * 100 if len(df) >= 11 else 0

        trend_score = 0

        if current_price > sma_5 > sma_10 > sma_20:
            trend_score += 40
        elif current_price > sma_5 > sma_10:
            trend_score += 25
        elif current_price > sma_5:
            trend_score += 10
        elif current_price < sma_5 < sma_10 < sma_20:
            trend_score -= 40
        elif current_price < sma_5 < sma_10:
            trend_score -= 25
        elif current_price < sma_5:
            trend_score -= 10

        if sma_5_slope > 0 and sma_10_slope > 0:
            trend_score += 20
        elif sma_5_slope > 0:
            trend_score += 10
        elif sma_5_slope < 0 and sma_10_slope < 0:
            trend_score -= 20
        elif sma_5_slope < 0:
            trend_score -= 10

        if price_change_5d > 2 and price_change_10d > 1:
            trend_score += 20
        elif price_change_5d > 1:
            trend_score += 10
        elif price_change_5d < -2 and price_change_10d < -1:
            trend_score -= 20
        elif price_change_5d < -1:
            trend_score -= 10

        if volume_strength > 1.2:
            trend_score += 20
        elif volume_strength > 1.0:
            trend_score += 10
        elif volume_strength < 0.8:
            trend_score -= 10

        if trend_score >= 40:
            return 'strong_bullish'
        elif trend_score >= 20:
            return 'bullish'
        elif trend_score >= -20:
            return 'neutral'
        elif trend_score >= -40:
            return 'bearish'
        else:
            return 'strong_bearish'

    except Exception:
        return 'neutral'
