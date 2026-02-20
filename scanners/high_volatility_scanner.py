"""
High Volatility Scanner
Fetches stocks with high ATR% for volatility-based trading
"""
from tradingview_screener import Query, Column
from rich.console import Console
import pandas as pd

console = Console()


def fetch_volatile_stocks(limit=20):
    """
    Fetch stocks with high volatility (ATR as % of price).

    Args:
        limit: Maximum number of stocks to return

    Returns:
        DataFrame with columns: name, close, ATR, atr_pct, change, volume, sector
    """
    fetch_limit = max(limit * 3, 60)

    query = (
        Query()
        .select(
            'name', 'close', 'ATR', 'change', 'volume',
            'sector', 'market_cap_basic'
        )
        .set_markets('india')
        .where(
            Column('close') >= 10,
            Column('market_cap_basic') >= 1_000_000_000,
            Column('volume') > 100_000,
            Column('ATR') > 0,
        )
        .order_by('ATR', ascending=False)
        .limit(fetch_limit)
    )

    _, df = query.get_scanner_data()

    if df.empty:
        return df

    # Calculate ATR as percentage of price
    df['atr_pct'] = (df['ATR'] / df['close']) * 100

    # Sort by ATR% and take top limit
    df = df.sort_values('atr_pct', ascending=False).head(limit)

    return df


if __name__ == "__main__":
    df = fetch_volatile_stocks(limit=20)
    if not df.empty:
        console.print(df[['name', 'close', 'ATR', 'atr_pct', 'change', 'sector']])
    else:
        console.print("[red]No volatile stocks found[/red]")
