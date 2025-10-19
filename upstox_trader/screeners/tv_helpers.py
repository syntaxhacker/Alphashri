import rookiepy
from tradingview_screener import Query, col  # noqa: F401 (col imported for potential external callers)
from rich.console import Console
from rich.table import Table
from datetime import datetime

import pandas as pd

console = Console()


def get_tradingview_cookies(quiet: bool = False):
    """Get TradingView cookies from browser with Chrome then Firefox fallback."""
    try:
        # Try Chrome first
        cookies_raw = rookiepy.chrome(['.tradingview.com'])
        cookies = rookiepy.to_cookiejar(cookies_raw)
        if not quiet:
            console.print("[green]Successfully loaded cookies from Chrome[/green]")

        # Check if we have valid cookies
        if cookies_raw:
            if not quiet:
                console.print("[green]✅ Found TradingView cookies - expecting live data[/green]")
        else:
            if not quiet:
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

            if cookies_raw:
                if not quiet:
                    console.print("[green]✅ Found TradingView cookies - expecting live data[/green]")
            else:
                if not quiet:
                    console.print("[yellow]⚠️  No cookies found[/yellow]")

            return cookies
        except Exception:
            if not quiet:
                console.print("[red]Could not load cookies from any browser.[/red]")
                console.print("[yellow]💡 Make sure you're logged into TradingView in your browser[/yellow]")
                console.print("[yellow]💡 Try refreshing the TradingView page and run script again[/yellow]")
            return None


# Currency-aware formatters
def get_currency_price_formatter(currency_symbol='₹'):
    """Get a price formatter for the specified currency"""
    return lambda x: f"{currency_symbol}{x:,.2f}"

# Column configuration to eliminate DRY code
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


def display_table(df: pd.DataFrame, title: str, max_rows: int = 15, currency_symbol: str = '₹'):
    """Display a generic dataframe in a formatted table, tailored for TradingView screener columns."""
    if df.empty:
        console.print(f"[red]No results found for {title}[/red]")
        return

    # Create a copy of COLUMN_CONFIG with currency-aware price formatter
    column_config = COLUMN_CONFIG.copy()
    if 'close' in df.columns:
        column_config['close'] = column_config['close'].copy()
        column_config['close']['formatter'] = get_currency_price_formatter(currency_symbol)

    table = Table(title=title, show_header=True, header_style="bold magenta")

    # Add columns dynamically based on dataframe using configuration
    for col_name in df.columns:
        config = column_config.get(col_name, {})
        display_name = config.get('display_name', col_name)
        
        # Build column properties
        column_props = {
            'style': config.get('style'),
            'justify': config.get('justify'),
            'no_wrap': config.get('no_wrap', False),
            'max_width': config.get('max_width')
        }
        
        # Filter out None values
        column_props = {k: v for k, v in column_props.items() if v is not None}
        
        table.add_column(display_name, **column_props)

    # Add rows with formatting using configuration
    for _, row in df.head(max_rows).iterrows():
        row_data = []
        for col_name in df.columns:
            config = column_config.get(col_name, {})
            value = row[col_name]
            
            # Use formatter if available, otherwise convert to string
            formatter = config.get('formatter')
            if formatter:
                formatted_value = formatter(value)
            else:
                formatted_value = str(value)
            
            row_data.append(formatted_value)

        table.add_row(*row_data)

    console.print(table)
    console.print(f"[dim]Showing {min(len(df), max_rows)} of {len(df)} results[/dim]")


def save_results(df: pd.DataFrame, filename_prefix: str):
    """Save results to CSV with timestamp suffix, no-op if empty dataframe."""
    if df.empty:
        return
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{filename_prefix}_{timestamp}.csv"
    df.to_csv(filename, index=False)
    console.print(f"[green]Results saved to: {filename}[/green]")