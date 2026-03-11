#!/usr/bin/env python3
"""
ORB Stock Screener - Filters stocks optimized for Opening Range Breakout strategy.

Based on backtest analysis of 200+ stocks:
- Winners had higher prices (₹904 avg vs ₹450)
- Winners had larger market caps (₹121B avg vs ₹51B)
- RSI 60-70: 52% of winners vs 33% of losers
- ADX 30-40: 44% of winners vs 31% of losers
- ATR% 3-5%: 48% of winners vs 29% of losers
- Rel Volume < 2x: Winners avg 1.07 vs losers 2.63

Recommended filters:
- Price >= ₹150
- RSI: 55-70 (strong momentum, not overbought)
- ADX: 25-40 (trending)
- ATR%: 3-6% (moderate volatility)
- Rel Volume: < 2.0x (avoid hype spikes)
- Perf.W >= 0 (positive weekly trend)
- Market Cap > ₹50B (institutional quality)
"""

import sys
from pathlib import Path

# Add paths
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent))

import pandas as pd
from typing import List, Dict, Optional
from rich.console import Console
from rich.table import Table

console = Console()


class ORBStockScreener:
    """Screener for stocks suitable for Opening Range Breakout strategy."""

    # Default filter criteria based on backtest analysis
    DEFAULT_FILTERS = {
        'min_price': 150,
        'max_price': 10000,
        'min_rsi': 55,
        'max_rsi': 70,
        'min_adx': 25,
        'max_adx': 45,
        'min_atr_pct': 3.0,
        'max_atr_pct': 6.5,
        'max_rel_volume': 2.0,
        'min_perf_w': 0,
        'min_market_cap_b': 10,  # Billions INR
    }

    # Relaxed filters for more candidates
    RELAXED_FILTERS = {
        'min_price': 100,
        'max_price': 20000,
        'min_rsi': 50,
        'max_rsi': 72,
        'min_adx': 20,
        'max_adx': 50,
        'min_atr_pct': 2.5,
        'max_atr_pct': 8.0,
        'max_rel_volume': 3.0,
        'min_perf_w': -2,
        'min_market_cap_b': 5,
    }

    def __init__(self, use_relaxed: bool = False):
        """Initialize screener.

        Args:
            use_relaxed: If True, use relaxed filters for more candidates
        """
        self.filters = self.RELAXED_FILTERS if use_relaxed else self.DEFAULT_FILTERS
        self._trending_module = None

    def _get_trending_module(self):
        """Lazy load trending_upside module."""
        if self._trending_module is None:
            import trending_upside
            self._trending_module = trending_upside
        return self._trending_module

    def _load_nse_symbols(self) -> set:
        """Load valid NSE EQ symbols from instruments file."""
        import json

        nse_file = Path(__file__).parent.parent / 'upstox_trader/config_and_utils/nse_instruments.json'
        if not nse_file.exists():
            return set()

        with open(nse_file, 'r') as f:
            instruments = json.load(f)

        return {
            inst['trading_symbol']
            for inst in instruments
            if inst.get('segment') == 'NSE_EQ' and inst.get('instrument_type') == 'EQ'
        }

    def screen(self, limit: int = 200, verify_nse: bool = True) -> pd.DataFrame:
        """
        Screen for ORB-suitable stocks.

        Args:
            limit: Maximum number of stocks to fetch from TradingView
            verify_nse: If True, only return stocks that exist in NSE

        Returns:
            DataFrame with filtered stocks
        """
        trending = self._get_trending_module()

        # Fetch from multiple profiles
        all_data = []
        profiles = ['volatility_trend', 'high_momentum', 'trending']

        for profile in profiles:
            try:
                df = trending.fetch_trending_stocks(limit=limit, profile=profile)
                if not df.empty:
                    df['source_profile'] = profile
                    all_data.append(df)
            except Exception as e:
                console.print(f"[yellow]Warning: Could not fetch {profile}: {e}[/yellow]")

        if not all_data:
            return pd.DataFrame()

        # Combine and deduplicate
        combined = pd.concat(all_data, ignore_index=True)
        combined = combined.drop_duplicates(subset=['name'])

        # Calculate ATR%
        if 'ATR' in combined.columns and 'close' in combined.columns:
            combined['atr_pct'] = (combined['ATR'] / combined['close'] * 100).round(2)

        # Calculate market cap in billions
        if 'market_cap_basic' in combined.columns:
            combined['market_cap_b'] = combined['market_cap_basic'] / 1_000_000_000

        # Apply filters
        f = self.filters

        filtered = combined[
            (combined['close'] >= f['min_price']) &
            (combined['close'] <= f['max_price']) &
            (combined['RSI'] >= f['min_rsi']) &
            (combined['RSI'] <= f['max_rsi']) &
            (combined['ADX'] >= f['min_adx']) &
            (combined['ADX'] <= f['max_adx']) &
            (combined['atr_pct'] >= f['min_atr_pct']) &
            (combined['atr_pct'] <= f['max_atr_pct']) &
            (combined['relative_volume_10d_calc'] < f['max_rel_volume']) &
            (combined['Perf.W'] >= f['min_perf_w'])
        ].copy()

        # Market cap filter (if available)
        if 'market_cap_b' in filtered.columns:
            filtered = filtered[filtered['market_cap_b'] >= f['min_market_cap_b']]

        # Calculate composite score
        # Higher ADX + moderate ATR% + higher RSI (within range) = better ORB candidate
        filtered['orb_score'] = (
            filtered['ADX'] * 0.4 +
            filtered['atr_pct'] * 10 * 0.3 +
            filtered['RSI'] * 0.3
        ).round(1)

        # Sort by score
        filtered = filtered.sort_values('orb_score', ascending=False)

        # Verify against NSE if requested
        if verify_nse:
            nse_symbols = self._load_nse_symbols()
            filtered = filtered[filtered['name'].isin(nse_symbols)]

        return filtered

    def get_symbols(self, limit: int = 100, verify_nse: bool = True) -> List[str]:
        """
        Get list of ORB-suitable stock symbols.

        Args:
            limit: Maximum number of symbols to return
            verify_nse: If True, only return NSE-verified symbols

        Returns:
            List of stock symbols
        """
        df = self.screen(limit=limit * 2, verify_nse=verify_nse)

        if df.empty:
            return []

        return df['name'].head(limit).tolist()

    def display_results(self, df: pd.DataFrame, top_n: int = 30):
        """Display screener results in a formatted table."""
        if df.empty:
            console.print("[yellow]No stocks found matching ORB criteria[/yellow]")
            return

        console.print(f"\n[bold green]Found {len(df)} ORB-suitable stocks[/bold green]")
        console.print(f"[dim]Filters: Price>={self.filters['min_price']}, RSI {self.filters['min_rsi']}-{self.filters['max_rsi']}, "
                     f"ADX {self.filters['min_adx']}-{self.filters['max_adx']}, ATR% {self.filters['min_atr_pct']}-{self.filters['max_atr_pct']}[/dim]")

        table = Table(title=f"Top {min(top_n, len(df))} ORB Candidates")
        table.add_column("#", width=3)
        table.add_column("Symbol", style="cyan")
        table.add_column("Price", justify="right")
        table.add_column("RSI", justify="right")
        table.add_column("ADX", justify="right")
        table.add_column("ATR%", justify="right")
        table.add_column("RelVol", justify="right")
        table.add_column("Perf.W", justify="right")
        table.add_column("Score", justify="right")

        for i, (_, row) in enumerate(df.head(top_n).iterrows(), 1):
            table.add_row(
                str(i),
                str(row['name']),
                f"{row['close']:.0f}",
                f"{row['RSI']:.1f}",
                f"{row['ADX']:.1f}",
                f"{row.get('atr_pct', 0):.2f}",
                f"{row.get('relative_volume_10d_calc', 0):.2f}",
                f"{row.get('Perf.W', 0):.1f}",
                f"{row.get('orb_score', 0):.1f}"
            )

        console.print(table)


def screen_orb_stocks(limit: int = 100, use_relaxed: bool = True, verify_nse: bool = True) -> List[str]:
    """
    Convenience function to get ORB-suitable stock symbols.

    Args:
        limit: Maximum number of symbols to return
        use_relaxed: If True, use relaxed filters for more candidates
        verify_nse: If True, only return NSE-verified symbols

    Returns:
        List of stock symbols suitable for ORB backtesting
    """
    screener = ORBStockScreener(use_relaxed=use_relaxed)
    return screener.get_symbols(limit=limit, verify_nse=verify_nse)


if __name__ == '__main__':
    # Demo run
    console.print("[bold cyan]ORB Stock Screener[/bold cyan]")
    console.print("Finding stocks optimized for Opening Range Breakout strategy...\n")

    # Run with relaxed filters for more candidates
    screener = ORBStockScreener(use_relaxed=True)
    df = screener.screen(limit=300, verify_nse=True)
    screener.display_results(df, top_n=50)

    # Print symbols for backtesting
    symbols = df['name'].head(100).tolist()
    console.print(f"\n[bold]Symbols for ORB backtest ({len(symbols)}):[/bold]")
    print(f"SYMBOLS = {symbols}")
