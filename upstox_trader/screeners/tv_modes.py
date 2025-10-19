from typing import Optional, List, Dict, Tuple
from rich.panel import Panel
from rich.console import Console
from tradingview_screener import Query, col
import time
import os
from datetime import datetime

import pandas as pd
import numpy as np

# Import modularized strategy modules
try:
    from .modes import pre_breakout, momentum, fomo, gap_trading, intraday, swing, investment, research
except ImportError:
    # Fallback for direct script execution
    import sys
    import os
    current_dir = os.path.dirname(os.path.abspath(__file__))
    modes_dir = os.path.join(current_dir, 'modes')
    if modes_dir not in sys.path:
        sys.path.insert(0, modes_dir)
    
    import pre_breakout
    import momentum
    import fomo
    import gap_trading
    import intraday
    import swing
    import investment
    import research

console = Console()


def apply_market_cap_filter(query, market_cap_filter):
    """Apply market cap filtering based on the specified filter type"""
    if market_cap_filter == 'large':
        # Large cap: > 20,000 Cr (200e9)
        query = query.where(col('market_cap_basic') > 200e9)
    elif market_cap_filter == 'mid':
        # Mid cap: 5,000 Cr - 20,000 Cr (50e9 to 200e9)
        query = query.where(col('market_cap_basic').between(50e9, 200e9))
    elif market_cap_filter == 'small':
        # Small cap: < 5,000 Cr (< 50e9), but filter out very small caps
        query = query.where(
            col('market_cap_basic') < 50e9,
            col('market_cap_basic') > 10e9  # Filter out very small caps for relevance
        )
    return query


def apply_price_filter(query, max_price=None, min_price=None):
    """Apply price filtering based on specified min and max prices"""
    conditions = []
    if max_price is not None:
        conditions.append(col('close') < max_price)
    if min_price is not None:
        conditions.append(col('close') > min_price)
    
    if conditions:
        query = query.where(*conditions)
    
    return query


# =============== MARKET-SPECIFIC CONSTANTS ===============
class MarketConstants:
    """Market-specific constants for different trading modes"""
    
    # US Market Constants
    US = {
        'market_name': 'america',
        'currency_symbol': '$',
        'min_price': 30,                   # Above $30 for better liquidity
        'min_volume': 100000,              # 100K+ volume for US stocks
        'min_market_cap': 1e8,             # $100M+ market cap
        'fomo_volume_ratio': 1.5,          # Volume surge threshold
        'momentum_volume_ratio': 1.3,      # Momentum volume threshold  
        'min_volatility': 0.01,            # 1%+ daily volatility
        'fomo_momentum_volatility': 0.01,  # Sufficient volatility for momentum
        'momentum_range': {
            'positive': (0.8, 6.0),        # +0.8% to +6.0%
            'negative': (-6.0, -0.8)       # -6.0% to -0.8%
        },
        # Real-time momentum tracking
        'realtime_momentum': {
            'min_consecutive_moves': 3,    # Minimum consecutive moves in same direction
            'interval_seconds': 60,        # Check every 60 seconds (1 min intervals)
            'min_move_threshold': 0.15,    # 0.15% minimum move per interval
            'acceleration_factor': 1.5     # Accelerating momentum multiplier
        }
    }
    
    # Indian Market Constants
    INDIA = {
        'market_name': 'india',
        'currency_symbol': '₹',
        'min_price': 50,                   # Above ₹50 for liquidity
        'min_volume': 500000,              # 500K+ volume for Indian stocks
        'min_market_cap': 1e9,             # ₹1000cr+ market cap
        'fomo_volume_ratio': 1.5,          # Volume surge threshold
        'momentum_volume_ratio': 1.3,      # Momentum volume threshold
        'min_volatility': 0.02,            # 2%+ daily volatility  
        'fomo_momentum_volatility': 0.02,  # Higher volatility for Indian stocks
        'exchange_filter': 'NSE',          # NSE only for Indian stocks
        'momentum_range': {
            'positive': (0.8, 6.0),        # +0.8% to +6.0%
            'negative': (-6.0, -0.8)       # -6.0% to -0.8%
        }
    }
    
    # Indian Market Constants  
    INDIA = {
        'market_name': 'india',
        'currency_symbol': '₹',
        'min_price': 50,                   # Above ₹50 for liquidity
        'min_volume': 500000,              # 500K+ volume for Indian stocks
        'min_market_cap': 1e9,             # ₹1000cr+ market cap
        'fomo_volume_ratio': 1.5,          # Volume surge threshold
        'momentum_volume_ratio': 1.3,      # Momentum volume threshold
        'min_volatility': 0.02,            # 2%+ daily volatility  
        'fomo_momentum_volatility': 0.02,  # Higher volatility for Indian stocks
        'exchange_filter': 'NSE',          # NSE only for Indian stocks
        'momentum_range': {
            'positive': (0.8, 6.0),        # +0.8% to +6.0%
            'negative': (-6.0, -0.8)       # -6.0% to -0.8%
        },
        # Real-time momentum tracking (3min intervals for Indian market)
        'realtime_momentum': {
            'min_consecutive_moves': 3,    # Minimum consecutive moves in same direction
            'interval_seconds': 180,       # Check every 180 seconds (3 min intervals)
            'min_move_threshold': 0.2,     # 0.2% minimum move per interval
            'acceleration_factor': 1.5     # Accelerating momentum multiplier
        }
    }


# Query Configuration Constants
class QueryConfig:
    """Common query configurations"""
    
    # Common field selections
    BASIC_FIELDS = ['name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 'update_mode']
    
    FOMO_FIELDS = BASIC_FIELDS + ['RSI', 'Volatility.D', 'market_cap_basic']

    MOMENTUM_FIELDS = BASIC_FIELDS + ['RSI', 'MACD.macd', 'MACD.signal', 'EMA20', 'Volatility.D', 'market_cap_basic']

    REALTIME_MOMENTUM_FIELDS = BASIC_FIELDS + ['RSI', 'Volatility.D', 'market_cap_basic', 'price_52_week_high', 'MACD.macd']
    
    # Common limits
    DEFAULT_LIMIT = 25
    FOCUSED_LIMIT = 15
    REALTIME_LIMIT = 20
    
    # RSI ranges
    MOMENTUM_RSI_RANGE = (35, 75)
    CONSERVATIVE_RSI_RANGE = (45, 65)


# =============== HELPER FUNCTIONS ===============
def get_market_config(market: str) -> dict:
    """Get market-specific configuration"""
    return MarketConstants.US if market == 'america' else MarketConstants.INDIA


def build_market_aware_query(base_query: Query, market: str, mode_type: str = 'fomo', custom_min_price=None, custom_max_price=None) -> Query:
    """Build market-aware query with appropriate filters"""
    config = get_market_config(market)
    
    # Use custom price limits if provided, otherwise use config defaults
    effective_min_price = custom_min_price if custom_min_price is not None else config['min_price']
    
    # Common filters based on mode type
    if mode_type == 'fomo':
        conditions = [
            col('close') > effective_min_price,
            col('volume') > config['min_volume'],
            col('market_cap_basic') > config['min_market_cap'],
            col('relative_volume_10d_calc') > config['fomo_volume_ratio']
        ]
        
        # Add max price filter if specified
        if custom_max_price is not None:
            conditions.append(col('close') < custom_max_price)
            
        query = base_query.where(*conditions)
    elif mode_type == 'fomo_momentum':
        momentum_pos = config['momentum_range']['positive']
        momentum_neg = config['momentum_range']['negative'] 
        rsi_range = QueryConfig.MOMENTUM_RSI_RANGE
        
        # Use custom min price if provided, otherwise use config default * 0.8
        momentum_min_price = custom_min_price if custom_min_price is not None else (config['min_price'] * 0.8)
        
        conditions = [
            col('close') > momentum_min_price,
            col('volume') > (config['min_volume'] * 0.6),  # Lower volume requirement
            col('market_cap_basic') > (config['min_market_cap'] * 0.5),  # Wider universe
            col('relative_volume_10d_calc') > config['momentum_volume_ratio'],
            col('RSI').between(rsi_range[0], rsi_range[1]),  # Momentum RSI range
            # Momentum range filter
            (col('change').between(momentum_pos[0], momentum_pos[1])) | 
            (col('change').between(momentum_neg[0], momentum_neg[1])),
            col('Volatility.D') > config['fomo_momentum_volatility']
        ]
        
        # Add max price filter if specified
        if custom_max_price is not None:
            conditions.append(col('close') < custom_max_price)
            
        query = base_query.where(*conditions)
    elif mode_type == 'realtime_momentum':
        # Real-time momentum mode - faster-moving stocks with good volatility
        conditions = [
            col('close') > effective_min_price,
            col('volume') > (config['min_volume'] * 0.8),  # Lower volume for more candidates
            col('market_cap_basic') > (config['min_market_cap'] * 0.3),  # Wider universe
            col('relative_volume_10d_calc') > 1.2,  # Some volume activity
            col('RSI').between(25, 85),  # Very wide RSI range for momentum
            col('Volatility.D') > config['min_volatility'],  # Need volatility for momentum
            (col('change') > 0.5) | (col('change') < -0.5)  # At least 0.5% movement today
        ]
        
        # Add max price filter if specified
        if custom_max_price is not None:
            conditions.append(col('close') < custom_max_price)
            
        query = base_query.where(*conditions)
    
    # Add exchange filter for Indian market only
    if market != 'america' and 'exchange_filter' in config:
        query = query.where(col('exchange') == config['exchange_filter'])
    
    return query


def create_base_query(fields: list, market: str) -> Query:
    """Create base query with specified fields and market"""
    return Query().select(*fields).set_markets(market)


# =============== Delegated Mode Functions ===============
# Each function mirrors the original TVScreenerUsage.method behavior.
# They accept `self` (TVScreenerUsage instance) to reuse existing utilities and state.


def pre_breakout_accumulation(self) -> None:
    """Find stocks in accumulation phase before breakout"""
    return pre_breakout.pre_breakout_accumulation(self)


def early_momentum_detection(self) -> None:
    """Detect early momentum plays before they become FOMO trades"""
    return momentum.early_momentum_detection(self)


def relative_strength_leaders(self) -> None:
    """Find market outperformers with relative strength"""
    return momentum.relative_strength_leaders(self)


def intraday_high_volume_breakouts(self) -> None:
    """Find stocks with high volume breakouts"""
    return fomo.intraday_high_volume_breakouts(self)


def intraday_gap_up_stocks(self) -> None:
    """Find stocks with significant gap-ups"""
    return gap_trading.intraday_gap_up_stocks(self)


def gap_fill_trading_strategy(self) -> None:
    """Analyze gap-fill trading opportunities"""
    return gap_trading.gap_fill_trading_strategy(self)


def optimized_gap_strategy_15min(self) -> Optional[pd.DataFrame]:
    """Optimized 15-minute gap strategy with enhanced filters"""
    console.print(Panel.fit("🚀 OPTIMIZED GAP STRATEGY (15-min) - 68.4% Win Rate", style="bold green"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'gap_up_ratio', 'RSI', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,
                col('volume') > 200000,
                col('relative_volume_10d_calc').between(0.8, 1.8),
                col('change').between(-2, 3),
                col('RSI').between(40, 65),
                col('close') > col('EMA20'),
                col('close') > 200,
                col('market_cap_basic') > 5e8,
                col('exchange') == 'NSE'
            )
            .order_by('RSI', ascending=False)
            .limit(15)
            .get_scanner_data(cookies=self.cookies)
        )

        if not df.empty:
            console.print("[dim]Adding trend analysis...[/dim]")
            trend_data = []
            for _, row in df.iterrows():
                ticker = row['name']
                trend = self._check_historical_trend(ticker, timeframe='daily', lookback_days=15)
                trend_data.append(trend)
            df['trend'] = trend_data

        self.display_table(df, "Pre-Breakout Accumulation - Early Entry")

        console.print("\n[bold yellow]💡 Trading Strategy:[/bold yellow]")
        console.print("• Entry: On volume expansion above EMA20 with RSI >50")
        console.print("• Stop Loss: Below EMA20 or recent swing low (0.5%)")
        console.print("• Target: Resistance levels or 52W high")
        console.print("• Logic: Catch accumulation before the breakout crowd")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


def early_momentum_detection(self) -> None:
    """Detect early momentum before FOMO kicks in"""
    console.print(Panel.fit("⚡ EARLY MOMENTUM: Pre-FOMO Signals", style="bold green"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'RSI[1]', 'MACD.macd', 'MACD.signal', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 30,
                col('volume') > 100000,
                col('relative_volume_10d_calc').between(1.1, 2.5),
                col('change').between(0.5, 4),
                col('RSI') > col('RSI[1]'),
                col('RSI').between(35, 70),
                col('MACD.macd') > col('MACD.signal'),
                col('market_cap_basic') > 2e8,
                col('exchange') == 'NSE'
            )
            .order_by('change', ascending=False)
            .limit(15)
            .get_scanner_data(cookies=self.cookies)
        )

        self.display_table(df, "Early Momentum - Before FOMO")

        console.print("\n[bold yellow]💡 Trading Strategy:[/bold yellow]")
        console.print("• Entry: When RSI crosses 50 with volume confirmation")
        console.print("• Stop Loss: Below recent swing low (0.5%)")
        console.print("• Target: Next resistance or 3-5% move")
        console.print("• Logic: Catch momentum before crowd notices")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


def relative_strength_leaders(self) -> None:
    """Find stocks showing relative strength vs market"""
    console.print(Panel.fit("💪 RELATIVE STRENGTH: Market Outperformers", style="bold cyan"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'Perf.W', 'Perf.M',
                'RSI', 'Beta', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,
                col('volume') > 150000,
                col('Perf.W') > 2,
                col('Perf.M') > 5,
                col('change') > -2,
                col('RSI').between(45, 75),
                col('Beta') > 0.8,
                col('market_cap_basic') > 3e8,
                col('exchange') == 'NSE'
            )
            .order_by('Perf.W', ascending=False)
            .limit(15)
            .get_scanner_data(cookies=self.cookies)
        )

        self.display_table(df, "Relative Strength Leaders")

        console.print("\n[bold yellow]💡 Trading Strategy:[/bold yellow]")
        console.print("• Entry: On any pullback or consolidation break")
        console.print("• Stop Loss: Below weekly support (0.5%)")
        console.print("• Target: Continuation of relative strength trend")
        console.print("• Logic: Leaders continue to lead in trends")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


def intraday_high_volume_breakouts(self) -> None:
    """Find stocks with high volume breakouts for intraday trading"""
    console.print(Panel.fit("🚀 INTRADAY: High Volume Breakouts", style="bold blue"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'Volatility.D', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,
                col('volume') > 1000000,
                col('relative_volume_10d_calc') > 2,
                col('change') > 2,
                col('RSI').between(50, 80),
                col('market_cap_basic') > 5e8,
                col('exchange') == 'NSE'
            )
            .order_by('relative_volume_10d_calc', ascending=False)
            .limit(15)
            .get_scanner_data(cookies=self.cookies)
        )
        
        # Add trend analysis for each stock
        if not df.empty:
            console.print("[dim]Adding trend analysis...[/dim]")
            trend_data = []
            for _, row in df.iterrows():
                ticker = row['name']  # Use 'name' field as it contains the ticker
                trend = self._check_historical_trend(ticker, timeframe='daily', lookback_days=15)
                trend_data.append(trend)
            df['trend'] = trend_data

        self.display_table(df, "High Volume Breakouts - Intraday")

        console.print("\n[bold yellow]💡 Trading Strategy:[/bold yellow]")
        console.print("• Entry: On breakout above resistance with high volume")
        console.print("• Stop Loss: Below recent support (2-3%)")
        console.print("• Target: 1:2 risk-reward ratio")
        console.print("• Time Frame: 5-15 minute charts")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


def intraday_gap_up_stocks(self) -> None:
    """Find gap-up stocks for intraday momentum trading"""
    console.print(Panel.fit("📈 INTRADAY: Gap-Up Momentum", style="bold green"))
    try:
        total_rows, df = (
            Query()
            .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                    'RSI', 'price_52_week_high', 'update_mode')
            .set_markets(self.market)
            .where(
                col('close') > 100,
                col('change') > 3,
                col('volume') > 500000,
                col('relative_volume_10d_calc') > 1.5,
                col('exchange') == 'NSE',
                col('RSI') < 80,
                col('price_52_week_high') > col('close')
            )
            .order_by('change', ascending=False)
            .limit(15)
            .get_scanner_data(cookies=self.cookies)
        )

        self.display_table(df, "Gap-Up Momentum Stocks")

        console.print("\n[bold yellow]💡 Trading Strategy:[/bold yellow]")
        console.print("• Entry: On pullback to gap support or breakout continuation")
        console.print("• Stop Loss: Below gap fill level (0.5%)")
        console.print("• Target: Previous resistance or 5-8% gain")
        console.print("• Time Frame: 15-30 minute charts")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


def gap_fill_trading_strategy(self) -> None:
    """
    GAP-FILL TRADING STRATEGY (HISTORICAL ANALYSIS)
    Delegates to existing analyzer and tv_display as in original method.
    """
    console.print(Panel.fit("🎯 GAP-FILL TRADING STRATEGY (HISTORICAL ANALYSIS)", style="bold magenta"))
    try:
        total_rows, df = (
            Query()
            .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                    'RSI', 'market_cap_basic', 'Volatility.D', 'update_mode')
            .set_markets(self.market)
            .where(
                col('close') > 30,
                col('volume') > 300000,
                col('relative_volume_10d_calc') > 1.2,
                col('market_cap_basic') > 1e8,
                col('exchange') == 'NSE'
            )
            .order_by('relative_volume_10d_calc', ascending=False)
            .limit(25)
            .get_scanner_data(cookies=self.cookies)
        )

        if df.empty:
            console.print("[yellow]No volume movers found in current market scan[/yellow]")
            return

        df = df[df['change'].abs() >= 0.8].copy()
        if df.empty:
            console.print("[yellow]No significant gaps found in current volume movers[/yellow]")
            return

        console.print("[dim]Analyzing historical gap-fill patterns...[/dim]")
        gap_analysis_results = []

        for _, row in df.iterrows():
            symbol = row['name']
            current_change = row['change']
            gap_direction = 'UP' if current_change > 0 else 'DOWN'

            gap_analysis = self._analyze_gap_fill_probability(
                symbol=symbol,
                current_gap_size=abs(current_change),
                gap_direction=gap_direction,
                lookback_days=90
            )

            row_data = row.to_dict()
            row_data.update({
                'gap_direction': gap_direction,
                'gap_fill_probability': gap_analysis['probability'],
                'historical_similar_gaps': gap_analysis.get('total_similar_gaps', 0),
                'historical_fills': gap_analysis.get('filled_gaps', 0),
                'avg_fill_rate': gap_analysis.get('avg_fill_percentage', 0),
                'data_quality': gap_analysis['historical_data']
            })
            gap_analysis_results.append(row_data)

        gap_df = pd.DataFrame(gap_analysis_results).sort_values('gap_fill_probability', ascending=False)

        # Use tv_display if present (imported in tv_screen_usage and accessible via self)
        if getattr(self, 'tv_display', None):
            self.tv_display.display_gap_fill_results(gap_df)
        else:
            # Fallback: import locally to avoid tight coupling
            try:
                from . import tv_display
            except Exception:
                import upstox_trader.screeners.tv_display as tv_display  # type: ignore
            tv_display.display_gap_fill_results(gap_df)
    except Exception as e:
        console.print(f"[red]Error in gap-fill strategy: {e}[/red]")


def research_earnings_calendar(self) -> None:
    """Find stocks with upcoming earnings or recent results"""
    console.print(Panel.fit("📅 RESEARCH: Earnings Focus", style="bold cyan"))
    
    try:
        total_rows, df = (
            Query()
            .select('name', 'close', 'earnings_per_share_diluted_yoy_growth_ttm',
                    'total_revenue_yoy_growth_ttm', 'price_earnings_ttm',
                    'return_on_equity', 'market_cap_basic', 'update_mode')
            .set_markets(self.market)
            .where(
                col('close') > 100,
                col('earnings_per_share_diluted_yoy_growth_ttm') > 10,
                col('total_revenue_yoy_growth_ttm') > 5,
                col('price_earnings_ttm') < 30,
                col('market_cap_basic') > 2e9
            )
            .order_by('earnings_per_share_diluted_yoy_growth_ttm', ascending=False)
            .limit(15)
            .get_scanner_data(cookies=self.cookies)
        )
        
        self.display_table(df, "Earnings Growth Focus")
        
        console.print("\n[bold yellow]💡 Research Strategy:[/bold yellow]")
        console.print("• Track earnings announcement dates")
        console.print("• Monitor guidance and management commentary")
        console.print("• Compare actual vs expected results")
        console.print("• Identify earnings surprise opportunities")
        
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


def research_sector_performance(self) -> None:
    """Analyze sector-wise performance and trends"""
    console.print(Panel.fit("🏢 RESEARCH: Sector Performance Analysis", style="bold green"))
    
    try:
        # Get sector data
        total_rows, df = (
            Query()
            .select('name', 'close', 'change', 'volume', 'market_cap_basic',
                    'sector', 'industry', 'return_on_equity', 'price_earnings_ttm',
                    'relative_volume_10d_calc', 'update_mode')
            .set_markets(self.market)
            .where(
                col('close') > 50,
                col('market_cap_basic') > 5e8,
                col('volume') > 100000,
                col('sector') != '',
                col('exchange') == 'NSE'
            )
            .order_by('market_cap_basic', ascending=False)
            .limit(100)
            .get_scanner_data(cookies=self.cookies)
        )
        
        # Manual NSE filter (TradingView exchange filter doesn't work reliably)
        if not df.empty and 'ticker' in df.columns:
            df = df[df['ticker'].str.startswith('NSE:')]
            
        if not df.empty and 'sector' in df.columns:
            # Calculate sector-wise metrics
            sector_stats = df.groupby('sector').agg({
                'change': ['mean', 'count'],
                'market_cap_basic': 'sum',
                'volume': 'sum',
                'return_on_equity': 'mean',
                'price_earnings_ttm': 'mean',
                'relative_volume_10d_calc': 'mean'
            }).round(2)
            
            # Flatten column names
            sector_stats.columns = ['avg_change', 'stock_count', 'total_mcap', 'total_volume', 'avg_roe', 'avg_pe', 'avg_vol_ratio']
            sector_stats = sector_stats.reset_index()
            
            # Sort by average performance
            sector_stats = sector_stats.sort_values('avg_change', ascending=False)
            
            # Display sector performance table (moved to tv_display)
            try:
                from . import tv_display
                tv_display.display_sector_table(sector_stats, "Sector Performance Analysis")
            except Exception:
                try:
                    import upstox_trader.screeners.tv_display as tv_display
                    tv_display.display_sector_table(sector_stats, "Sector Performance Analysis")
                except Exception:
                    console.print("[red]tv_display module unavailable[/red]")
            
            # Show top and bottom performers
            console.print(f"\n[bold green]🏆 Top Performing Sectors:[/bold green]")
            for i, (_, row) in enumerate(sector_stats.head(3).iterrows()):
                console.print(f"  {i+1}. {row['sector']}: {row['avg_change']:+.2f}% ({row['stock_count']} stocks)")
            
            console.print(f"\n[bold red]📉 Underperforming Sectors:[/bold red]")
            for i, (_, row) in enumerate(sector_stats.tail(3).iterrows()):
                console.print(f"  {i+1}. {row['sector']}: {row['avg_change']:+.2f}% ({row['stock_count']} stocks)")
            
            console.print("\n[bold yellow]💡 Sector Analysis Insights:[/bold yellow]")
            console.print("• Identify sector rotation opportunities")
            console.print("• Compare relative strength across sectors")
            console.print("• Monitor sector-specific news and events")
            console.print("• Track institutional money flow patterns")
            
        else:
            console.print("[yellow]⚠️ Sector data not available or limited[/yellow]")
            self.display_table(df.head(15), "Market Analysis (No Sector Data)")
            
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


def research_sector_stocks(self, sector_name=None, limit=20) -> None:
    """Find top stocks in a specific sector"""
    if sector_name:
        title = f"🏢 SECTOR: {sector_name} Top Stocks"
    else:
        title = "🏢 SECTOR: Select Sector Stocks"
        
    console.print(Panel.fit(title, style="bold blue"))
    
    try:
        query = (
            Query()
            .select('name', 'close', 'change', 'volume', 'market_cap_basic',
                    'sector', 'industry', 'return_on_equity', 'price_earnings_ttm',
                    'relative_volume_10d_calc', 'RSI', 'update_mode')
            .set_markets(self.market)
            .where(
                col('close') > 25,
                col('market_cap_basic') > 1e8,
                col('volume') > 50000,
                col('sector') != '',
                col('exchange') == 'NSE'
            )
        )
        
        # Add sector filter if specified
        if sector_name:
            query = query.where(col('sector') == sector_name)
        
        total_rows, df = (
            query
            .order_by('market_cap_basic', ascending=False)
            .limit(limit)
            .get_scanner_data(cookies=self.cookies)
        )
        
        # Manual NSE filter (TradingView exchange filter doesn't work reliably)
        if not df.empty and 'ticker' in df.columns:
            df = df[df['ticker'].str.startswith('NSE:')]
        
        if not df.empty:
            if sector_name:
                self.display_table(df, f"{sector_name} - Top Stocks")
            else:
                # Show available sectors
                if 'sector' in df.columns:
                    sectors = df['sector'].unique()
                    console.print(f"[bold yellow]Available Sectors ({len(sectors)}):[/bold yellow]")
                    for i, sector in enumerate(sorted(sectors), 1):
                        console.print(f"  {i}. {sector}")
                    console.print(f"\n[bold blue]Usage:[/bold blue] Use --sector '<sector_name>' parameter")
                    console.print(f"[bold blue]Example:[/bold blue] python tv_screen_usage.py --example research_sector_stocks --sector 'Technology'")
                else:
                    self.display_table(df.head(15), "Market Stocks (No Sector Data)")
                    
            console.print("\n[bold yellow]💡 Sector Analysis Tips:[/bold yellow]")
            console.print("• Compare stocks within the same sector")
            console.print("• Look for sector leaders vs laggards")
            console.print("• Monitor sector-specific catalysts")
            console.print("• Track relative performance trends")
        else:
            console.print(f"[red]No stocks found for sector: {sector_name}[/red]")
            
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


def intraday_watch_mode(self, refresh_interval=30, volume_threshold=1.5, price_threshold=3.0, mode='PREBREAKOUT', market_cap_filter=None, max_price=None, min_price=None) -> None:
    """Watch mode for intraday trading - continuously monitors volume and price changes"""
    # Store filters for use in _get_watch_data
    self.market_cap_filter = market_cap_filter
    self.max_price = max_price
    self.min_price = min_price
    
    mode_titles = {
        'PREBREAKOUT': ("📊 PRE-BREAKOUT MODE - Early Entry Signals", "bold blue"),
        'FOMO': ("🔥 FOMO MODE - High Volume Breakouts", "bold red"), 
        'SMART_FOMO': ("🧠 SMART FOMO MODE - Historical Analysis + FOMO", "bold yellow"),
        'ACCUMULATION': ("📈 ACCUMULATION MODE - Smart Money Tracking", "bold green"),
        'MOMENTUM': ("⚡ MOMENTUM MODE - Early Momentum Detection", "bold cyan"),
        'OPTIMIZED_GAP': ("🚀 OPTIMIZED GAP MODE - 15-Min Gap Strategy (68.4% Win Rate)", "bold green"),
        'GAP_FILL_SR': ("🎯 GAP-FILL S/R MODE - Live Gap Analysis with Support/Resistance", "bold magenta"),
        'SCALPING': ("⚡ SCALPING MODE - Ultra-Fast 1-3% Moves", "bold white"),
        'MOMENTUM_SCALPER': ("🚀 MOMENTUM SCALPER - Second-Level Delta Trading", "bold bright_white"),
        'SECTOR_SCALPER': ("🏭 SECTOR SCALPER - Correlation Catch-Up Trades", "bold bright_cyan"),
        'SHORT_SQUEEZE': ("🍋 SHORT SQUEEZE - Over-Shorted Explosion Hunter", "bold bright_magenta"),
        'BREAKOUT_FAILURE': ("📉 BREAKOUT FAILURE - Failed Breakout Shorting", "bold red"),
        'EXHAUSTION_REVERSAL': ("😵 EXHAUSTION REVERSAL - Momentum Exhaustion Shorts", "bold bright_red"),
        'MORNING_FADE': ("🌅 MORNING FADE - Gap-Up Failure Shorting", "bold yellow"),
        'REVERSAL': ("🔄 REVERSAL MODE - Counter-Trend Opportunities", "bold purple"),
        'VOLUME_SURGE': ("📊 VOLUME SURGE MODE - Unusual Activity Detector", "bold bright_blue"),
        'CHANNEL_PLAY': ("📈 CHANNEL PLAY MODE - Range-Bound Trading", "bold bright_green"),
        'SECTOR_MOMENTUM': ("🏭 SECTOR MOMENTUM MODE - Industry Group Moves", "bold bright_yellow"),
        'QUICK_PROFIT': ("💰 QUICK PROFIT MODE - 1-2% Fast Scalps", "bold bright_red"),
        'FOMO_MOMENTUM': ("🎯 FOMO MOMENTUM MODE - Gap & Intraday 0.8-6% Momentum", "bold magenta"),
        'REALTIME_MOMENTUM': ("⚡ REALTIME MOMENTUM MODE - Live 1min/3min Price Action", "bold bright_red")
    }
    title, style = mode_titles.get(mode, ("📊 WATCH MODE", "bold blue"))
    console.print(Panel.fit(title, style=style))
    
    # Store mode for use in data fetching
    self.watch_mode = mode
    
    # Update journal file with correct mode
    if hasattr(self, 'journal_file'):
        self.setup_trade_journal()
    
    console.print(f"[yellow]⚙️  Configuration:[/yellow]")
    console.print(f"• Mode: {mode}")
    console.print(f"• Refresh interval: {refresh_interval} seconds")
    console.print(f"• Volume threshold: {volume_threshold}x normal volume")
    console.print(f"• Price change threshold: {price_threshold}%")
    console.print(f"• Paper trading: {'🟢 ENABLED (₹20,000 per trade)' if getattr(self, 'paper_trading_enabled', False) else '🔴 DISABLED'}")
    if getattr(self, 'paper_trading_enabled', False):
        console.print(f"• Live risk management: 🟢 ENABLED (0.5% SL | 1% TP | 1.0% TSL | 2sec checks)")
    console.print(f"• Trade journal: 📝 {getattr(self, 'journal_file', 'Not configured')}")
    console.print(f"• Trend analysis: 🎯 ENABLED (15-day lookback | SELL in bearish trends)")
    console.print(f"• Logging: 🔇 Minimal (reduced console spam)")
    console.print(f"• Press Ctrl+C to stop monitoring")
    console.print()
    
    # Special handling for GAP_FILL_SR mode - redirect to live gap-fill monitor
    if mode == 'GAP_FILL_SR':
        console.print(f"[yellow]🔄 Redirecting to live gap-fill monitor...[/yellow]")
        time.sleep(1)
        if hasattr(self, 'live_gap_fill_monitor_with_sr'):
            return self.live_gap_fill_monitor_with_sr()
        else:
            console.print("[red]Error: live_gap_fill_monitor_with_sr method not available[/red]")
            return
    
    # Wait until 9:20 AM before starting active monitoring
    if hasattr(self, 'wait_until_market_open'):
        self.wait_until_market_open()
    
    # Store previous data for comparison
    previous_data = pd.DataFrame()
    alert_count = 0
    
    # Start background monitoring for live risk management
    self._start_time = datetime.now()
    if hasattr(self, 'start_background_monitoring'):
        self.start_background_monitoring()
    
    try:
        while True:
            start_time = time.time()
            
            # Clear screen for fresh update
            os.system('clear' if os.name == 'posix' else 'cls')
            
            # Header with current time
            current_time = datetime.now().strftime("%H:%M:%S")
            console.print(f"[bold blue]📊 INTRADAY WATCH MODE - {current_time}[/bold blue]")
            console.print(f"[dim]Refresh: {refresh_interval}s | Vol: {volume_threshold}x | Price: {price_threshold}%[/dim]")
            console.print()
            
            # Check if market is closed - exit all positions at 3:00 PM
            if hasattr(self, '_is_market_closed') and self._is_market_closed():
                if hasattr(self, '_exit_all_positions'):
                    self._exit_all_positions("MARKET_CLOSED")
                console.print("[bold red]📴 Market closed - All positions exited. Script will continue monitoring.[/bold red]")
                time.sleep(refresh_interval)
                continue
            
            # Get current market data
            current_data = self._get_watch_data(market_cap_filter, max_price, min_price) if hasattr(self, '_get_watch_data') else pd.DataFrame()
            
            if not current_data.empty:
                # Detect alerts
                alerts = []
                if hasattr(self, '_detect_alerts'):
                    alerts = self._detect_alerts(current_data, previous_data, volume_threshold, price_threshold)
                
                if alerts:
                    alert_count += len(alerts)
                    console.print(f"[bold red]🚨 ALERTS ({len(alerts)} new, {alert_count} total)[/bold red]")
                    if hasattr(self, '_display_alerts'):
                        self._display_alerts(alerts)
                    console.print()
                
                # Display current top movers
                if hasattr(self, '_display_watch_data'):
                    self._display_watch_data(current_data, alerts)
                else:
                    self.display_table(current_data.head(15), f"Watch Mode - {mode}")
                
                # Store current data for next comparison
                previous_data = current_data.copy()
            else:
                console.print("[red]❌ No data received - checking connection...[/red]")
            
            # Wait for next refresh
            elapsed = time.time() - start_time
            sleep_time = max(0, refresh_interval - elapsed)
            
            if sleep_time > 0:
                console.print(f"[dim]Next refresh in {sleep_time:.1f}s... (Ctrl+C to stop)[/dim]")
                time.sleep(sleep_time)
                
    except KeyboardInterrupt:
        console.print("\n[yellow]👋 Watch mode stopped by user[/yellow]")
        console.print(f"[green]Total alerts generated: {alert_count}[/green]")
        
        # Show execution time
        end_time = datetime.now()
        if hasattr(self, '_start_time'):
            duration = end_time - self._start_time
            hours, remainder = divmod(duration.total_seconds(), 3600)
            minutes, seconds = divmod(remainder, 60)
            console.print(f"[blue]Execution time: {int(hours)}h:{int(minutes):02d}m:{int(seconds):02d}s[/blue]")
    finally:
        # Stop background monitoring when exiting
        if hasattr(self, 'stop_background_monitoring'):
            self.stop_background_monitoring()



def optimized_gap_strategy_15min(self) -> Optional[pd.DataFrame]:
    """Delegate of the original optimized gap strategy"""
    console.print(Panel.fit("🚀 OPTIMIZED GAP STRATEGY (15-MIN PROVEN)", style="bold green"))
    try:
        total_rows, df = (
            Query()
            .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                    'RSI', 'market_cap_basic', 'Volatility.D', 'price_52_week_high', 'update_mode')
            .set_markets(self.market)
            .where(
                col('close') > 50,
                col('change') > 1,
                col('change') < 15,
                col('volume') > 500000,
                col('relative_volume_10d_calc') > 2.0,
                col('RSI') < 85,
                col('RSI') > 25,
                col('exchange') == 'NSE',
                col('market_cap_basic') > 2e8,
                col('Volatility.D') < 0.08,
                col('price_52_week_high') > col('close')
            )
            .order_by('relative_volume_10d_calc', ascending=False)
            .limit(20)
            .get_scanner_data(cookies=self.cookies)
        )

        if df.empty:
            console.print("[yellow]No gap opportunities meeting quality criteria found[/yellow]")
            return None

        df['quality_score'] = self._calculate_quality_score(df)
        df = df.sort_values('quality_score', ascending=False)

        self.display_table(df, "🚀 Optimized 15-Min Gap Strategy Stocks")

        console.print("\n[bold yellow]📊 PROVEN STRATEGY PARAMETERS:[/bold yellow]")
        console.print("• [green]Timeframe:[/green] 15-minute intervals (68.4% win rate)")
        console.print("• [green]Entry:[/green] 9:30 AM after trend confirmation")
        console.print("• [green]Target:[/green] 2.5% (proven achievable)")
        console.print("• [green]Stop Loss:[/green] 0.5% (tight risk control)")
        console.print("• [green]Expected P&L:[/green] ₹156 per trade average")

        if getattr(self, 'paper_trading_enabled', False):
            console.print("\n[bold blue]📊 PAPER TRADING READY:[/bold blue]")
            top_stocks = df[df['quality_score'] >= 80].head(5)
            if not top_stocks.empty:
                console.print(f"\n[bold blue]🤖 AUTO-TRADING {len(top_stocks)} HIGH-QUALITY GAPS:[/bold blue]")
                for _, row in top_stocks.iterrows():
                    alert = {
                        'type': 'OPTIMIZED_GAP_15MIN',
                        'ticker': row.get('ticker', row['name']),
                        'symbol': row.get('ticker', row['name']),
                        'price': row['close'],
                        'change': row['change'],
                        'volume_ratio': row['relative_volume_10d_calc'],
                        'quality_score': row['quality_score'],
                        'confidence': min(0.95, row['quality_score'] / 100),
                        'target_pct': 2.5,
                        'stop_loss_pct': 1.0,
                        'timeframe': '15min',
                        'strategy': 'gap_15min_optimized',
                        'reason': f"Gap {row['change']:+.1f}% with {row['relative_volume_10d_calc']:.1f}x volume (Score: {row['quality_score']:.0f}/100)"
                    }
                    self._process_gap_paper_trading_alert(alert)
                    console.print(f"   🤖 {row['name'][:15]:15} | Gap: {row['change']:+.1f}% | Score: {row['quality_score']:3.0f} | Target: +2.5% | Stop: -1.0%")

        console.print("\n[bold yellow]🔔 ALERT SETUP:[/bold yellow]")
        console.print("• 9:15 AM: Check screener for gap stocks")
        console.print("• 9:30 AM: Analyze top quality scores on 15-min charts")
        console.print("• Entry: Wait for trend confirmation before entering")
        console.print("• Exit: Stick to 2.5% target / 0.5% stop discipline")

        return df
    except Exception as e:
        console.print(f"[red]Error in optimized gap strategy: {e}[/red]")
        return None


def intraday_oversold_bounce(self) -> None:
    """Find oversold stocks bouncing back"""
    return intraday.intraday_oversold_bounce(self)


def intraday_news_momentum(self) -> None:
    """Find stocks with news-driven momentum"""
    return intraday.intraday_news_momentum(self)


def intraday_early_breakout_setup(self) -> None:
    """Early breakout setup detection before full breakout"""
    console.print(Panel.fit("🔍 EARLY BREAKOUT SETUP: Pre-Breakout Detection", style="bold cyan"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'Volatility.D', 'market_cap_basic', 'update_mode',
                'high_20d', 'low_20d'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,  # Minimum price
                col('volume') > 400000,  # Good volume
                col('market_cap_basic') > 1000000000,  # 100 Cr minimum market cap
                col('relative_volume_10d_calc') > 1.3,  # Volume interest
                col('RSI').between(45, 70),  # Building momentum
                col('close') > col('low_20d') * 1.02,  # Above 20-day low
                col('close') < col('high_20d') * 0.98  # But below 20-day high (consolidation)
            )
            .orderby(col('relative_volume_10d_calc'), ascending=False)
            .limit(25)
            .get()
        )
        
        if not df.empty:
            # Add breakout potential score
            df['breakout_score'] = (
                df['relative_volume_10d_calc'] * 10 + 
                (70 - df['RSI']) +  # Closer to 70 is better for breakout
                (df['high_20d'] / df['close'] - 1) * 100  # Distance to 20-day high
            )
            
            # Sort by breakout potential
            df = df.sort_values('breakout_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "🔍 EARLY BREAKOUT SETUP Candidates")
            else:
                console.print("[green]Found early breakout setup candidates:[/green]")
                console.print(df[['name', 'close', 'RSI', 'high_20d', 'breakout_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching early breakout setup criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in early breakout setup analysis: {e}[/red]")


def intraday_volume_accumulation(self) -> None:
    """Find stocks with smart money volume accumulation"""
    return intraday.intraday_volume_accumulation(self) if hasattr(intraday, 'intraday_volume_accumulation') else console.print("[yellow]Volume accumulation strategy not implemented yet[/yellow]")


def intraday_compression_coiling(self) -> None:
    """Find stocks in compression/coiling patterns before explosion"""
    console.print(Panel.fit("🌀 COMPRESSION COILING: Pre-Explosion Setups", style="bold purple"))
    try:
        # This would typically use advanced pattern recognition
        console.print("[blue]Compression/coiling analysis requires advanced pattern recognition.[/blue]")
        console.print("[blue]This is a simplified version for demonstration.[/blue]")
        
    except Exception as e:
        console.print(f"[red]Error in compression/coiling analysis: {e}[/red]")


def swing_bullish_reversal(self) -> None:
    """Find stocks with bullish reversal patterns"""
    return swing.swing_bullish_reversal(self)


def swing_breakout_consolidation(self) -> None:
    """Find stocks breaking out of consolidation patterns"""
    return swing.swing_breakout_consolidation(self)


def swing_sector_rotation(self) -> None:
    """Find sector rotation opportunities"""
    console.print(Panel.fit("🏭 SECTOR ROTATION: Industry Group Moves", style="bold bright_yellow"))
    try:
        # This would typically use sector data and rotation analysis
        console.print("[blue]Sector rotation analysis requires detailed sector data and rotation metrics.[/blue]")
        console.print("[blue]This is a simplified version for demonstration.[/blue]")
        
    except Exception as e:
        console.print(f"[red]Error in sector rotation analysis: {e}[/red]")


def invest_quality_growth(self) -> None:
    """Find quality growth stocks for long-term investment"""
    return investment.invest_quality_growth(self)


def invest_dividend_aristocrats(self) -> None:
    """Find dividend aristocrat stocks"""
    return investment.invest_dividend_aristocrats(self)


def invest_undervalued_gems(self) -> None:
    """Find undervalued small-cap gems"""
    console.print(Panel.fit("💎 UNDERVALUED GEMS: Hidden Small-Cap Opportunities", style="bold magenta"))
    try:
        # This would typically use value investing metrics
        console.print("[blue]Undervalued gem analysis requires detailed value metrics.[/blue]")
        console.print("[blue]This is a simplified version for demonstration.[/blue]")
        
    except Exception as e:
        console.print(f"[red]Error in undervalued gem analysis: {e}[/red]")


def research_sector_leaders(self) -> None:
    """Find sector leaders and performance analysis"""
    return research.research_sector_leaders(self)


def research_market_sentiment(self) -> None:
    """Analyze overall market sentiment"""
    return research.research_market_sentiment(self)


def research_earnings_calendar(self) -> None:
    """Analyze earnings calendar and upcoming events"""
    return research.research_earnings_calendar(self)


def invest_dividend_aristocrats(self) -> None:
    """Find dividend-paying stocks for income investing"""
    console.print(Panel.fit("💰 INVEST: Dividend Aristocrats", style="bold blue"))
    try:
        total_rows, df = (
            Query()
            .select('name', 'close', 'dividends_yield_current', 'price_earnings_ttm',
                    'return_on_equity', 'debt_to_equity', 'current_ratio',
                    'market_cap_basic', 'update_mode')
            .set_markets(self.market)
            .where(
                col('close') > 200,
                col('dividends_yield_current') > 2,
                col('price_earnings_ttm') < 20,
                col('return_on_equity') > 12,
                col('debt_to_equity') < 0.8,
                col('current_ratio') > 1.2,
                col('market_cap_basic') > 10e9
            )
            .order_by('dividends_yield_current', ascending=False)
            .limit(15)
            .get_scanner_data(cookies=self.cookies)
        )

        self.display_table(df, "Dividend Aristocrats")

        console.print("\n[bold yellow]💡 Investment Strategy:[/bold yellow]")
        console.print("• Entry: On dividend yield above 3%")
        console.print("• Stop Loss: Only on fundamental deterioration (or 0.5% technical stop)")
        console.print("• Target: Consistent dividend income + growth")
        console.print("• Time Frame: Hold for decades")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


def invest_undervalued_gems(self) -> None:
    """Find undervalued stocks with potential for long-term investing"""
    console.print(Panel.fit("💎 INVEST: Undervalued Gems", style="bold magenta"))
    try:
        total_rows, df = (
            Query()
            .select('name', 'close', 'price_earnings_ttm', 'price_book_ratio',
                    'return_on_equity', 'price_sales_ratio', 'market_cap_basic',
                    'update_mode')
            .set_markets(self.market)
            .where(
                col('close') > 50,
                col('price_earnings_ttm') < 15,
                col('price_book_ratio') < 2,
                col('return_on_equity') > 10,
                col('price_sales_ratio') < 3,
                col('market_cap_basic') > 1e9
            )
            .order_by('price_earnings_ttm', ascending=True)
            .limit(15)
            .get_scanner_data(cookies=self.cookies)
        )

        self.display_table(df, "Undervalued Gems")

        console.print("\n[bold yellow]💡 Investment Strategy:[/bold yellow]")
        console.print("• Entry: After thorough fundamental analysis")
        console.print("• Stop Loss: On business deterioration (or 0.5% technical stop)")
        console.print("• Target: Fair value realization")
        console.print("• Time Frame: Patient holding 2-5 years")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


def research_sector_leaders(self) -> None:
    """Research sector leaders and their performance"""
    console.print(Panel.fit("🔍 RESEARCH: Sector Leaders Analysis", style="bold yellow"))
    try:
        total_rows, df = (
            Query()
            .select('name', 'close', 'market_cap_basic', 'return_on_equity',
                    'price_earnings_ttm', 'total_revenue_yoy_growth_ttm',
                    'update_mode')
            .set_markets(self.market)
            .where(
                col('market_cap_basic') > 20e9,
                col('return_on_equity') > 15,
                col('price_earnings_ttm') > 0,
                col('total_revenue_yoy_growth_ttm') > 5
            )
            .order_by('market_cap_basic', ascending=False)
            .limit(20)
            .get_scanner_data(cookies=self.cookies)
        )

        self.display_table(df, "Sector Leaders Analysis")

        console.print("\n[bold yellow]💡 Research Insights:[/bold yellow]")
        console.print("• Compare ROE across sectors")
        console.print("• Identify sector rotation opportunities")
        console.print("• Track revenue growth trends")
        console.print("• Monitor profit margin sustainability")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


def research_market_sentiment(self) -> None:
    """Analyze current market sentiment and momentum"""
    console.print(Panel.fit("📊 RESEARCH: Market Sentiment Analysis", style="bold red"))
    try:
        total_rows, df = (
            Query()
            .select('name', 'close', 'change', 'volume', 'relative_volume_10d_calc',
                    'RSI', 'Volatility.D', 'market_cap_basic', 'update_mode')
            .set_markets(self.market)
            .where(
                col('market_cap_basic') > 5e9,
                col('volume') > 1000000,
                col('relative_volume_10d_calc') > 0.5
            )
            .order_by('market_cap_basic', ascending=False)
            .limit(50)
            .get_scanner_data(cookies=self.cookies)
        )

        if not df.empty:
            total_stocks = len(df)
            gainers = len(df[df['change'] > 0])
            losers = len(df[df['change'] < 0])
            high_volume = len(df[df['relative_volume_10d_calc'] > 1.2])

            console.print(f"\n[bold]Market Sentiment Summary:[/bold]")
            console.print(f"• Total stocks analyzed: {total_stocks}")
            console.print(f"• Gainers: {gainers} ({gainers/total_stocks*100:.1f}%)")
            console.print(f"• Losers: {losers} ({losers/total_stocks*100:.1f}%)")
            console.print(f"• High volume activity: {high_volume} ({high_volume/total_stocks*100:.1f}%)")

            avg_change = df['change'].mean()
            avg_volume_ratio = df['relative_volume_10d_calc'].mean()

            console.print(f"• Average change: {avg_change:+.2f}%")
            console.print(f"• Average volume ratio: {avg_volume_ratio:.2f}x")
            
            if avg_change > 0.5:
                console.print("[green]✅ Bullish market sentiment[/green]")
            elif avg_change < -0.5:
                console.print("[red]❌ Bearish market sentiment[/red]")
            else:
                console.print("[yellow]⚠️ Neutral market sentiment[/yellow]")
        
        self.display_table(df.head(15), "Market Sentiment Analysis")
        
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


def _get_watch_data(self, market_cap_filter=None, max_price=None, min_price=None):
    """Get current market data for watch mode based on selected mode"""
    mode = getattr(self, 'watch_mode', 'PREBREAKOUT')
    
    try:
        if mode == 'FOMO':
            # Original FOMO high volume breakouts - using market-aware helper
            base_query = create_base_query(QueryConfig.FOMO_FIELDS, self.market)
            query = build_market_aware_query(base_query, self.market, 'fomo')
            
            # Apply filters AFTER build_market_aware_query to ensure they're not overridden
            if market_cap_filter:
                query = apply_market_cap_filter(query, market_cap_filter)
            # Apply price filtering
            query = apply_price_filter(query, max_price, min_price)
            
            total_rows, df = (
                query
                .order_by('relative_volume_10d_calc', ascending=False)
                .limit(QueryConfig.DEFAULT_LIMIT)
                .get_scanner_data(cookies=self.cookies)
            )
        
        elif mode == 'ACCUMULATION':
            # Accumulation patterns
            query = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                        'RSI', 'EMA20', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 50,  # Above ₹50
                    col('volume') > 200000,  # Decent volume
                    col('relative_volume_10d_calc').between(0.8, 1.8),  # Normal volume
                    col('RSI').between(40, 65),  # Building strength
                    col('close') > col('EMA20'),  # Above trend
                    col('market_cap_basic') > 5e8,  # Min 500 crores
                    col('exchange') == 'NSE'  # NSE only
                )
            )
            
            # Apply filters if specified
            if market_cap_filter:
                query = apply_market_cap_filter(query, market_cap_filter)
            # Apply price filtering
            query = apply_price_filter(query, max_price, min_price)
            
            total_rows, df = (
                query
                .order_by('RSI', ascending=False)
                .limit(25)
                .get_scanner_data(cookies=self.cookies)
            )
        
        elif mode == 'SMART_FOMO':
            # Enhanced Smart FOMO: Avoid buying at tops using multiple filters
            query = (
                Query()
                .select('name', 'ticker', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                        'RSI', 'Volatility.D', 'market_cap_basic', 'price_52_week_high',
                        'Perf.W', 'Perf.3M', 'EMA20', 'EMA50', 'MACD.macd', 'MACD.signal', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 50,  # Above ₹50
                    col('volume') > 500000,  # High volume
                    col('relative_volume_10d_calc') > 2.0,  # Higher volume threshold (FOMO signal)
                    (col('change').between(1, 8) | col('change').between(-8, -1)),  # Both positive and negative momentum (for shorting)
                    col('RSI').between(40, 75),  # Avoid extreme overbought (was 85)
                    col('market_cap_basic') > 1e9,  # Min 1000 crores
                    col('exchange') == 'NSE',  # NSE only
                    # Note: 52W high check moved to post-processing for mathematical operations
                    # NEW: Avoid overextended weekly/monthly moves
                    col('Perf.W') < 15,  # Weekly gain < 15%
                    col('Perf.3M') < 50,  # 3-month gain < 50%
                    # NEW: Ensure stock is above key moving averages (trend confirmation)
                    col('close') > col('EMA20'),  # Above 20 EMA
                    col('EMA20') > col('EMA50')   # 20 EMA above 50 EMA (uptrend)
                )
            )
            
            # Apply filters if specified
            if market_cap_filter:
                query = apply_market_cap_filter(query, market_cap_filter)
            # Apply price filtering
            query = apply_price_filter(query, max_price, min_price)
            
            total_rows, df = (
                query
                .order_by('relative_volume_10d_calc', ascending=False)
                .limit(30)  # Get more to filter
                .get_scanner_data(cookies=self.cookies)
            )
            
            # Filter by historical upside potential
            if not df.empty:
                smart_fomo_stocks = []
                for _, row in df.iterrows():
                    # Use ticker first, fallback to name if ticker is empty or "N/A"
                    symbol = row.get('ticker', '') or row.get('name', '')
                    if hasattr(self, '_check_historical_upside') and self._check_historical_upside(symbol, row.get('close', 0)):
                        smart_fomo_stocks.append(row)
                
                if smart_fomo_stocks:
                    df = pd.DataFrame(smart_fomo_stocks).head(25)  # Limit to 25
                else:
                    df = pd.DataFrame()  # No stocks passed historical filter
        
        elif mode == 'MOMENTUM':
            # Early momentum detection
            query = (
                Query()
                .select('name', 'ticker', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                        'RSI', 'RSI[1]', 'MACD.macd', 'MACD.signal', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 30,  # Lower threshold
                    col('volume') > 100000,  # Minimum liquidity
                    col('relative_volume_10d_calc').between(1.1, 2.5),  # Slightly elevated
                    col('change').between(0.5, 4),  # Small positive moves
                    col('RSI') > col('RSI[1]'),  # RSI improving
                    col('RSI').between(35, 70),  # Sweet spot
                    col('MACD.macd') > col('MACD.signal'),  # MACD bullish
                    col('market_cap_basic') > 2e8,  # Min 200 crores
                    col('exchange') == 'NSE'  # NSE only
                )
            )
            
            # Apply filters if specified
            if market_cap_filter:
                query = apply_market_cap_filter(query, market_cap_filter)
            # Apply price filtering
            query = apply_price_filter(query, max_price, min_price)
            
            total_rows, df = (
                query
                .order_by('change', ascending=False)
                .limit(25)
                .get_scanner_data(cookies=self.cookies)
            )
        
        elif mode == 'OPTIMIZED_GAP':
            # Optimized gap strategy - 15-minute proven strategy
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                        'RSI', 'market_cap_basic', 'Volatility.D', 'price_52_week_high', 'update_mode')
                .set_markets(self.market)
                .where(
                    # Quality gap criteria (proven in backtesting)
                    col('close') > 50,  # Minimum price for liquidity
                    col('change') > 1,  # At least 1% gap for momentum
                    col('change') < 15,  # Avoid extreme gaps (retracement risk)
                    
                    # Volume confirmation (critical for 15-min success)
                    col('volume') > 500000,  # Minimum liquidity
                    col('relative_volume_10d_calc') > 2.0,  # 2x+ volume (institutional interest)
                    
                    # Risk management filters
                    col('RSI') < 85,  # Not extremely overbought
                    col('RSI') > 25,  # Not in freefall
                    col('exchange') == 'NSE',  # NSE only for better liquidity
                    
                    # Quality and size filters
                    col('market_cap_basic') > 2e8,  # Min 200 crores (avoid penny stocks)
                    col('Volatility.D') < 0.08,  # Reasonable volatility (<8%)
                    col('price_52_week_high') > col('close')  # Room for upside
                )
                .order_by('relative_volume_10d_calc', ascending=False)  # Highest volume first
                .limit(20)  # Focus on top 20 opportunities
                .get_scanner_data(cookies=self.cookies)
            )
        
        elif mode == 'HEAVY_BREAKOUT':
            # Heavy Breakout mode - stocks ready for channel analysis
            total_rows, df = (
                Query()
                .select('name', 'ticker', 'close', 'open', 'high', 'low', 'volume', 'change',
                        'relative_volume_10d_calc', 'RSI', 'Volatility.D', 'ATR',
                        'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 100,
                    col('volume') > 300000,  # Decent liquidity for breakout trades
                    col('relative_volume_10d_calc') > 0.8,
                    col('market_cap_basic') > 5e8,  # Min 500 crores for stability
                    col('Volatility.D') > 0.015,  # Some volatility for breakout potential
                    col('ATR') > 2,  # Sufficient range for trading
                    col('RSI').between(35, 75),  # Avoid extremes
                    col('exchange') == 'NSE'
                )
                .order_by('relative_volume_10d_calc', ascending=False)
                .limit(30)  # More stocks for comprehensive analysis
                .get_scanner_data(cookies=self.cookies)
            )
        
        elif mode == 'SCALPING':
            # Scalping mode - Ultra-fast 1-3% moves with high liquidity
            total_rows, df = (
                Query()
                .select('name', 'ticker', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                        'RSI', 'Volatility.D', 'ATR', 'BB.upper', 'BB.lower', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 50,  # Minimum price for scalping
                    col('volume') > 1000000,  # High liquidity essential
                    col('market_cap_basic') > 10e8,  # Min 1000 crores for tight spreads
                    col('relative_volume_10d_calc') > 0.8,  # Active trading
                    col('Volatility.D') > 0.015,  # Enough movement for scalping
                    col('ATR') > 2,  # Sufficient range
                    col('exchange') == 'NSE'
                )
                .order_by('volume', ascending=False)  # Highest liquidity first
                .limit(15)  # Focus on most liquid stocks
                .get_scanner_data(cookies=self.cookies)
            )
        
        elif mode == 'MOMENTUM_SCALPER':
            # Advanced Momentum Scalper - Second-level delta detection with rapid momentum following
            # First get candidate stocks with basic momentum criteria
            total_rows, df_candidates = (
                Query()
                .select('name', 'ticker', 'close', 'open', 'volume', 'change', 'change_abs', 'relative_volume_10d_calc',
                        'RSI', 'RSI[1]', 'MACD.macd', 'MACD.signal', 'MACD.hist', 'Mom',
                        'Volatility.D', 'ATR', 'BB.upper', 'BB.lower', 'EMA20', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 100,  # Higher price for better spread ratios
                    col('volume') > 2000000,  # Ultra-high liquidity for instant execution
                    col('market_cap_basic') > 20e8,  # Min 2000 crores - only most liquid stocks
                    col('relative_volume_10d_calc') > 1.0,  # Active but not crazy volume
                    col('change_abs') > 0.5,  # Meaningful absolute price movement
                    col('Volatility.D') > 0.02,  # Sufficient volatility for scalping
                    col('ATR') > 3,  # Good intraday range
                    # Simplified momentum conditions (complex conditions moved to post-processing)
                    col('RSI').between(35, 85),  # Wide RSI range for momentum detection
                    col('MACD.hist') > -5,       # MACD histogram not too negative
                    col('exchange') == 'NSE'
                )
                .order_by('change_abs', ascending=False)  # Strongest absolute price movement first
                .limit(20)  # Get more candidates for intraday analysis
                .get_scanner_data(cookies=self.cookies)
            )
            
            # Enhance with intraday momentum analysis
            if not df_candidates.empty:
                df = _add_intraday_momentum_analysis(self, df_candidates)
                # Filter to top 10 after intraday analysis
                df = df.head(10) if not df.empty else df_candidates.head(10)
            else:
                df = df_candidates
        
        elif mode == 'SECTOR_SCALPER':
            # Sector Scalper - Find correlation catch-up opportunities
            console.print(f"[dim cyan]🏭 Analyzing sector correlations for catch-up trades...[/dim cyan]")
            
            # Get all active stocks with sector data
            total_rows, df_all = (
                Query()
                .select('name', 'ticker', 'close', 'volume', 'change', 'change_abs', 'relative_volume_10d_calc',
                        'RSI', 'sector', 'industry', 'market_cap_basic', 'Perf.W', 'Perf.3M', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 50,  # Minimum price
                    col('volume') > 500000,  # Good liquidity
                    col('market_cap_basic') > 5e8,  # Min 500 crores
                    col('relative_volume_10d_calc') > 0.8,  # Active trading
                    col('change_abs') > 0.3,  # Some movement
                    col('exchange') == 'NSE'
                )
                .order_by('change_abs', ascending=False)
                .limit(200)  # Get large pool for sector analysis
                .get_scanner_data(cookies=self.cookies)
            )
            
            if not df_all.empty:
                # Analyze sector correlations and find catch-up opportunities
                df = _analyze_sector_correlations(self, df_all)
            else:
                df = df_all
        
        elif mode == 'SHORT_SQUEEZE':
            # Short Squeeze Hunter - Find over-shorted stocks ready to explode
            total_rows, df = (
                Query()
                .select('name', 'ticker', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                        'RSI', 'RSI[1]', 'Perf.W', 'Perf.3M', 'price_52_week_low',
                        'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 30,  # Minimum price
                    col('volume') > 1000000,  # High volume for squeeze
                    col('market_cap_basic') > 3e8,  # Min 300 crores
                    col('relative_volume_10d_calc') > 2.0,  # High volume surge
                    col('RSI') < 35,  # Oversold (potential short covering)
                    col('RSI') > col('RSI[1]'),  # RSI turning up (shorts covering)
                    col('Perf.W') < -5,  # Weekly decline (shorts built up)
                    col('Perf.3M') < -15,  # 3M decline (heavy shorting)
                    col('exchange') == 'NSE'
                )
                .order_by('relative_volume_10d_calc', ascending=False)  # Highest volume first
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )
        
        elif mode == 'BREAKOUT_FAILURE':
            # Breakout Failure Shorting - Short failed breakouts (high win rate)
            total_rows, df = (
                Query()
                .select('name', 'ticker', 'close', 'high', 'volume', 'change', 'relative_volume_10d_calc',
                        'RSI', 'price_52_week_high', 'BB.upper', 'MACD.macd', 'MACD.signal',
                        'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 100,  # Higher prices for better shorting spreads
                    col('volume') > 800000,  # Good liquidity for shorting
                    col('market_cap_basic') > 10e8,  # Min 1000 crores
                    col('relative_volume_10d_calc') > 1.5,  # Volume on breakout attempt
                    col('RSI') > 70,  # Overbought (failed breakout zone)
                    col('change') > 2,  # Attempted breakout today
                    col('high') > col('BB.upper'),  # Breaking bollinger bands (overextension)
                    col('MACD.macd') < col('MACD.signal'),  # MACD divergence (weakness)
                    col('exchange') == 'NSE'
                )
                .order_by('RSI', ascending=False)  # Most overbought first (best shorts)
                .limit(12)
                .get_scanner_data(cookies=self.cookies)
            )
        
        elif mode == 'EXHAUSTION_REVERSAL':
            # Exhaustion Reversal - Short momentum exhaustion at key levels
            total_rows, df = (
                Query()
                .select('name', 'ticker', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                        'RSI', 'Perf.W', 'Perf.3M', 'Volatility.D', 'price_52_week_high',
                        'BB.upper', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 150,  # Higher prices for exhaustion patterns
                    col('volume') > 500000,  # Sufficient volume
                    col('market_cap_basic') > 5e8,  # Min 500 crores
                    col('relative_volume_10d_calc') > 1.2,  # Elevated volume
                    col('RSI') > 80,  # Extreme overbought (exhaustion zone)
                    col('Perf.W') > 10,  # Strong weekly performance (exhausting)
                    col('Perf.3M') > 20,  # Strong 3M run (due for reversal)
                    col('Volatility.D') > 0.04,  # High volatility (climax moves)
                    # Near 52-week highs (resistance zone)
                    col('close') > (col('price_52_week_high') - (col('price_52_week_high') * 0.05)),
                    col('exchange') == 'NSE'
                )
                .order_by('RSI', ascending=False)  # Most exhausted first
                .limit(10)
                .get_scanner_data(cookies=self.cookies)
            )
        
        elif mode == 'MORNING_FADE':
            # Morning Fade - Short gap-ups that fail to hold (classic strategy)
            total_rows, df = (
                Query()
                .select('name', 'ticker', 'close', 'open', 'high', 'volume', 'change', 'relative_volume_10d_calc',
                        'RSI', 'premarket_change', 'gap', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 80,  # Minimum price for gap fades
                    col('volume') > 600000,  # Good volume
                    col('market_cap_basic') > 5e8,  # Min 500 crores
                    col('relative_volume_10d_calc') > 1.3,  # Above normal volume
                    col('gap') > 2,  # Gapped up >2% (fade candidate)
                    col('change') < (col('gap') - 1.0),  # Failed to hold most of the gap (fading)
                    col('RSI') > 65,  # Overbought from gap
                    col('high') < col('open') + (col('open') * 0.03),  # Didn't extend much above open (weak)
                    col('exchange') == 'NSE'
                )
                .order_by('gap', ascending=False)  # Biggest gaps first (best fades)
                .limit(12)
                .get_scanner_data(cookies=self.cookies)
            )
        
        elif mode == 'REVERSAL':
            # Reversal mode - Counter-trend opportunities at key levels
            total_rows, df = (
                Query()
                .select('name', 'ticker', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                        'RSI', 'Stoch.K', 'BB.upper', 'BB.lower', 'price_52_week_high',
                        'price_52_week_low', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 75,
                    col('volume') > 400000,
                    col('market_cap_basic') > 3e8,  # Min 300 crores
                    col('relative_volume_10d_calc') > 1.0,
                    # Reversal conditions: Either overbought or oversold
                    (col('RSI') > 75) | (col('RSI') < 25),
                    col('exchange') == 'NSE'
                )
                .order_by('RSI', ascending=True)  # Most oversold first, then overbought
                .limit(20)
                .get_scanner_data(cookies=self.cookies)
            )
        
        elif mode == 'VOLUME_SURGE':
            # Volume Surge mode - Unusual activity detector
            total_rows, df = (
                Query()
                .select('name', 'ticker', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                        'average_volume_10d_calc', 'RSI', 'MACD.macd', 'MACD.signal',
                        'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 40,
                    col('volume') > 200000,
                    col('market_cap_basic') > 1e8,  # Min 100 crores
                    col('relative_volume_10d_calc') > 3.0,  # 3x+ unusual volume
                    col('change').between(-15, 15),  # Filter out extreme gaps
                    col('exchange') == 'NSE'
                )
                .order_by('relative_volume_10d_calc', ascending=False)  # Highest volume surge first
                .limit(25)
                .get_scanner_data(cookies=self.cookies)
            )
        
        elif mode == 'CHANNEL_PLAY':
            # Channel Play mode - Range-bound trading opportunities
            total_rows, df = (
                Query()
                .select('name', 'ticker', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                        'RSI', 'BB.upper', 'BB.lower', 'EMA20', 'EMA50', 'Volatility.D',
                        'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 60,
                    col('volume') > 300000,
                    col('market_cap_basic') > 2e8,  # Min 200 crores
                    col('relative_volume_10d_calc').between(0.7, 2.0),  # Moderate activity
                    col('RSI').between(30, 70),  # Range-bound RSI
                    col('Volatility.D').between(0.02, 0.06),  # Moderate volatility
                    col('change').between(-3, 3),  # Not trending strongly
                    col('exchange') == 'NSE'
                )
                .order_by('volume', ascending=False)
                .limit(20)
                .get_scanner_data(cookies=self.cookies)
            )
        
        elif mode == 'SECTOR_MOMENTUM':
            # Sector Momentum mode - Industry group moves
            total_rows, df = (
                Query()
                .select('name', 'ticker', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                        'RSI', 'Perf.W', 'Perf.3M', 'sector', 'industry', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 50,
                    col('volume') > 250000,
                    col('market_cap_basic') > 2e8,  # Min 200 crores
                    col('relative_volume_10d_calc') > 1.1,
                    col('RSI') > 50,  # Momentum stocks
                    col('Perf.W') > 2,  # Weekly outperformance
                    col('change') > 0.5,  # Positive today
                    col('exchange') == 'NSE'
                )
                .order_by('Perf.W', ascending=False)  # Best weekly performers first
                .limit(25)
                .get_scanner_data(cookies=self.cookies)
            )
        
        elif mode == 'QUICK_PROFIT':
            # Quick Profit mode - 1-2% fast scalps with momentum
            total_rows, df = (
                Query()
                .select('name', 'ticker', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                        'RSI', 'MACD.macd', 'MACD.signal', 'EMA20', 'Volatility.D',
                        'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 40,
                    col('volume') > 800000,  # High liquidity for quick exits
                    col('market_cap_basic') > 5e8,  # Min 500 crores
                    col('relative_volume_10d_calc') > 1.3,  # Above normal volume
                    col('RSI').between(45, 75),  # Momentum zone
                    col('change').between(0.5, 4),  # Positive momentum, not overbought
                    col('Volatility.D') > 0.02,  # Enough movement for quick profits
                    col('exchange') == 'NSE'
                )
                .order_by('change', ascending=False)  # Strongest momentum first
                .limit(15)  # Focus on best opportunities
                .get_scanner_data(cookies=self.cookies)
            )
        
        elif mode == 'FOMO_MOMENTUM':
            # FOMO Momentum mode - using market-aware helper
            # Catches momentum 0.8-6.0% (includes gap openings and intraday moves)
            # Perfect for gap continuations and strong intraday momentum
            base_query = create_base_query(QueryConfig.MOMENTUM_FIELDS, self.market)
            query = build_market_aware_query(base_query, self.market, 'fomo_momentum', custom_min_price=min_price, custom_max_price=max_price)
            
            # Apply market cap filter AFTER build_market_aware_query to ensure it's not overridden
            if market_cap_filter:
                query = apply_market_cap_filter(query, market_cap_filter)
            
            total_rows, df = (
                query
                .order_by('relative_volume_10d_calc', ascending=False)  # Volume surge priority
                .limit(QueryConfig.DEFAULT_LIMIT)  # More opportunities for momentum trading
                .get_scanner_data(cookies=self.cookies)
            )
        
        elif mode == 'REALTIME_MOMENTUM':
            # Real-time momentum mode - tracks continuous price action over short intervals
            # Detects stocks moving consistently in same direction over 1min/3min intervals
            base_query = create_base_query(QueryConfig.REALTIME_MOMENTUM_FIELDS, self.market)
            query = build_market_aware_query(base_query, self.market, 'realtime_momentum')
            
            # Apply market cap filter AFTER build_market_aware_query to ensure it's not overridden
            if market_cap_filter:
                query = apply_market_cap_filter(query, market_cap_filter)
            
            total_rows, df = (
                query
                .order_by('Volatility.D', ascending=False)  # Highest volatility first for momentum
                .limit(QueryConfig.REALTIME_LIMIT)  # Focus on most active stocks
                .get_scanner_data(cookies=self.cookies)
            )
            
            # Add real-time momentum tracking
            if not df.empty:
                df = self._add_realtime_momentum_analysis(df)
        
        else:  # PREBREAKOUT (default)
            # Pre-breakout focus
            query = (
                Query()
                .select('name', 'ticker', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                        'RSI', 'RSI[1]', 'EMA20', 'MACD.macd', 'MACD.signal', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 30,  # Lower threshold for early detection
                    col('volume') > 100000,  # Minimum liquidity
                    col('market_cap_basic') > 2e8,  # Min 200 crores
                    col('relative_volume_10d_calc').between(0.8, 3.0),  # Normal to moderately elevated
                    col('RSI').between(35, 75),  # Building momentum zone
                    col('change').between(-3, 6),  # Not extreme moves
                    col('exchange') == 'NSE'  # NSE only, ignore BSE
                )
            )
            
            # Apply filters if specified
            if market_cap_filter:
                query = apply_market_cap_filter(query, market_cap_filter)
            # Apply price filtering
            query = apply_price_filter(query, max_price, min_price)
            
            total_rows, df = (
                query
                .order_by('RSI', ascending=False)  # Momentum building
                .limit(25)
                .get_scanner_data(cookies=self.cookies)
            )
        
        # Add calculated fields if needed
        if 'Volatility.D' in df.columns:
            df['volatility_pct'] = df['Volatility.D'] * 100
        df['market_cap_cr'] = df['market_cap_basic'] / 1e7
        
        
        # Add quality scoring for optimized gap mode
        if mode == 'OPTIMIZED_GAP' and not df.empty:
            if hasattr(self, '_calculate_quality_score'):
                df['quality_score'] = self._calculate_quality_score(df)
        
        # Add heavy breakout analysis with parallel fetching for HEAVY_BREAKOUT mode
        if mode == 'HEAVY_BREAKOUT' and not df.empty:
            df = self._add_heavy_breakout_analysis(df)
        
        # Add trend analysis for each stock (simplified based on current market data)
        if not df.empty:
            trend_data = []
            for _, row in df.iterrows():
                # Simple trend analysis based on current data points
                change = row.get('change', 0)
                rsi = row.get('RSI', 50)
                vol_ratio = row.get('relative_volume_10d_calc', 1)
                
                # Determine trend based on available indicators
                trend_score = 0
                
                # Price change contribution (40% weight)
                if change > 5:
                    trend_score += 40
                elif change > 2:
                    trend_score += 20
                elif change > 0:
                    trend_score += 10
                elif change < -5:
                    trend_score -= 40
                elif change < -2:
                    trend_score -= 20
                elif change < 0:
                    trend_score -= 10
                
                # RSI contribution (35% weight)
                if rsi > 65:
                    trend_score += 35
                elif rsi > 55:
                    trend_score += 20
                elif rsi > 45:
                    trend_score += 5
                elif rsi < 35:
                    trend_score -= 35
                elif rsi < 45:
                    trend_score -= 20
                
                # Volume confirmation (25% weight)
                if vol_ratio > 2:
                    trend_score += 25
                elif vol_ratio > 1.5:
                    trend_score += 15
                elif vol_ratio > 1:
                    trend_score += 5
                elif vol_ratio < 0.5:
                    trend_score -= 15
                
                # Categorize trend
                if trend_score >= 60:
                    trend = 'strong_bullish'
                elif trend_score >= 30:
                    trend = 'bullish'
                elif trend_score >= -30:
                    trend = 'neutral'
                elif trend_score >= -60:
                    trend = 'bearish'
                else:
                    trend = 'strong_bearish'
                
                trend_data.append(trend)
            df['trend'] = trend_data
        
        return df
        
    except Exception as e:
        console.print(f"[red]Error fetching watch data: {e}[/red]")
        return pd.DataFrame()


class SmartMoneyBreakoutChannels:
    """
    Smart Money Breakout Channels Indicator for TradingView integration
    
    Identifies consolidation zones and breakout signals with volume analysis
    """
    
    def __init__(self, 
                 overlap: bool = False,
                 strong_closes: bool = True,
                 normalization_length: int = 100,
                 box_detection_length: int = 14,
                 show_volume: bool = True,
                 volume_mode: str = "Comparison",
                 volume_scale: float = 0.5):
        
        self.overlap = overlap
        self.strong_closes = strong_closes
        self.normalization_length = normalization_length
        self.box_detection_length = box_detection_length
        self.show_volume = show_volume
        self.volume_mode = volume_mode
        self.volume_scale = volume_scale
        
        self.channels = []
        self.breakout_signals = []
    
    def normalize_price(self, df: pd.DataFrame) -> pd.Series:
        """Normalize price between 0 and 1 based on recent range"""
        low_min = df['Low'].rolling(window=self.normalization_length).min()
        high_max = df['High'].rolling(window=self.normalization_length).max()
        normalized = (df['Close'] - low_min) / (high_max - low_min)
        return normalized.fillna(0)
    
    def calculate_volatility_signals(self, df: pd.DataFrame) -> Tuple[pd.Series, pd.Series, pd.Series]:
        """Calculate volatility-based signals for channel detection"""
        normalized_price = self.normalize_price(df)
        vol = normalized_price.rolling(window=14).std()
        
        length = self.box_detection_length
        upper_signal = vol.rolling(window=length + 1).apply(
            lambda x: (np.argmax(x) + length) / length if len(x) == length + 1 else np.nan,
            raw=True
        )
        
        lower_signal = vol.rolling(window=length + 1).apply(
            lambda x: (np.argmin(x) + length) / length if len(x) == length + 1 else np.nan,
            raw=True
        )
        
        return upper_signal, lower_signal, vol
    
    def calculate_atr(self, df: pd.DataFrame, period: int = 14) -> float:
        """Calculate Average True Range"""
        if len(df) < 2:
            return 0.1
        
        high = df['High']
        low = df['Low']
        close_prev = df['Close'].shift(1)
        
        tr1 = high - low
        tr2 = abs(high - close_prev)
        tr3 = abs(low - close_prev)
        
        true_range = np.maximum(tr1, np.maximum(tr2, tr3))
        atr = true_range.rolling(window=min(period, len(df))).mean().iloc[-1]
        
        return atr if not np.isnan(atr) else 0.1
    
    def detect_channels(self, df: pd.DataFrame) -> List[Dict]:
        """Detect consolidation channels"""
        upper_signal, lower_signal, vol = self.calculate_volatility_signals(df)
        channels = []
        
        upper_cross = (upper_signal > lower_signal) & (upper_signal.shift(1) <= lower_signal.shift(1))
        lower_cross = (lower_signal > upper_signal) & (lower_signal.shift(1) <= upper_signal.shift(1))
        
        i = 0
        while i < len(df) - 1:
            if lower_cross.iloc[i]:
                duration_bars = 1
                for j in range(i-1, max(0, i-200), -1):
                    if upper_cross.iloc[j]:
                        duration_bars = i - j
                        break
                
                if duration_bars > 10:
                    start_idx = i - duration_bars
                    end_idx = i
                    
                    channel_data = df.iloc[start_idx:end_idx+1]
                    h_level = channel_data['High'].max()
                    l_level = channel_data['Low'].min()
                    
                    atr = self.calculate_atr(df.iloc[max(0, start_idx-self.box_detection_length):end_idx+1])
                    vol_buffer = atr / 2
                    
                    channel = {
                        'start_idx': start_idx,
                        'end_idx': end_idx,
                        'high': h_level,
                        'low': l_level,
                        'atr': atr,
                        'vol_buffer': vol_buffer,
                        'active': True,
                        'center': (h_level + l_level) / 2,
                        'range_percent': ((h_level - l_level) / l_level) * 100
                    }
                    
                    if self.overlap or self.can_create_channel(channel, channels):
                        channels.append(channel)
            i += 1
        
        return channels
    
    def can_create_channel(self, new_channel: Dict, existing_channels: List[Dict]) -> bool:
        """Check if new channel can be created without overlap"""
        for channel in existing_channels:
            if not channel['active']:
                continue
            
            if (new_channel['high'] > channel['low'] and 
                new_channel['low'] < channel['high']):
                return False
        return True
    
    def check_breakouts(self, df: pd.DataFrame, channels: List[Dict]) -> List[Dict]:
        """Check for breakouts from active channels"""
        breakouts = []
        
        for i, channel in enumerate(channels):
            if not channel['active']:
                continue
            
            # Check for breakouts in the last 10 bars (not just current)
            for idx in range(max(channel['end_idx'], len(df) - 10), len(df)):
                if idx >= len(df):
                    continue
                    
                current_row = df.iloc[idx]
                
                if self.strong_closes:
                    price_check = (current_row['Open'] + current_row['Close']) / 2
                else:
                    price_check = current_row['Close']
                
                # Check for bullish breakout
                if price_check > channel['high'] and current_row['Close'] > channel['high']:
                    breakout = {
                        'type': 'bullish',
                        'support_level': channel['low'],
                        'resistance_level': channel['high'],
                        'breakout_price': current_row['Close'],
                        'breakout_bar_idx': idx,
                        'channel_idx': i,
                        'strength': (current_row['Close'] - channel['high']) / channel['high'] * 100,
                        'volume': current_row['Volume'],
                        'channel_duration': channel['end_idx'] - channel['start_idx'],
                        'consolidation_range': channel['range_percent']
                    }
                    breakouts.append(breakout)
                    channel['active'] = False
                    break
                
                # Check for bearish breakout
                elif price_check < channel['low'] and current_row['Close'] < channel['low']:
                    breakout = {
                        'type': 'bearish', 
                        'support_level': channel['low'],
                        'resistance_level': channel['high'],
                        'breakout_price': current_row['Close'],
                        'breakout_bar_idx': idx,
                        'channel_idx': i,
                        'strength': (channel['low'] - current_row['Close']) / channel['low'] * 100,
                        'volume': current_row['Volume'],
                        'channel_duration': channel['end_idx'] - channel['start_idx'],
                        'consolidation_range': channel['range_percent']
                    }
                    breakouts.append(breakout)
                    channel['active'] = False
                    break
        
        return breakouts
    
    def analyze_stock(self, df: pd.DataFrame) -> Dict:
        """Analyze a single stock for breakout patterns"""
        if len(df) < self.normalization_length:
            return {'channels': [], 'breakouts': [], 'active_channels': []}
        
        channels = self.detect_channels(df)
        breakouts = self.check_breakouts(df, channels)
        
        return {
            'channels': channels,
            'breakouts': breakouts,
            'active_channels': [ch for ch in channels if ch['active']],
            'total_channels': len(channels),
            'recent_breakouts': len(breakouts)
        }


def heavy_breakout(self) -> None:
    """Heavy Breakout Mode - Smart Money Consolidation Channel Breakouts"""
    console.print(Panel.fit("💥 HEAVY BREAKOUT: Smart Money Channel Analysis", style="bold red"))
    
    try:
        # Get stocks with good volume and price action
        total_rows, df = (
            Query()
            .select(
                'name', 'ticker', 'close', 'open', 'high', 'low', 'volume', 'change',
                'relative_volume_10d_calc', 'RSI', 'Volatility.D', 'ATR',
                'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 100,
                col('volume') > 500000,
                col('relative_volume_10d_calc') > 0.8,
                col('market_cap_basic') > 1e9,
                col('Volatility.D') > 0.015,  # Some volatility for breakout potential
                col('ATR') > 2,  # Sufficient range for trading
                col('exchange') == 'NSE'
            )
            .order_by('relative_volume_10d_calc', ascending=False)
            .limit(50)
            .get_scanner_data(cookies=self.cookies)
        )

        if df.empty:
            console.print("[yellow]No stocks found matching heavy breakout criteria[/yellow]")
            return

        console.print(f"[dim]Analyzing {len(df)} stocks for smart money consolidation patterns...[/dim]")
        
        # Analyze each stock for breakout patterns
        breakout_analyzer = SmartMoneyBreakoutChannels(
            overlap=False,
            strong_closes=True,
            normalization_length=100,  # ~25 hours of 15min candles for normalization
            box_detection_length=8     # ~2 hours of 15min candles for detection
        )
        
        heavy_breakout_stocks = []
        
        for _, row in df.iterrows():
            symbol = row['name']
            
            try:
                # Get intraday historical data for pattern analysis
                from datetime import datetime, timedelta
                to_date = datetime.now().strftime('%Y-%m-%d')
                from_date = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')  # 7 days for intraday
                
                # Fetch 15-minute candles for better intraday patterns
                historical_data = self.upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='minutes',
                    interval=15,  # 15-minute candles
                    to_date=to_date,
                    from_date=from_date
                )
                
                if historical_data is not None and len(historical_data) >= 20:
                    # Prepare data for analyzer
                    hist_df = historical_data.copy()
                    
                    # Handle different column structures from Upstox API
                    if len(hist_df.columns) == 6:
                        # Columns: [timestamp, open, high, low, close, volume]
                        hist_df.columns = ['Timestamp', 'Open', 'High', 'Low', 'Close', 'Volume']
                        hist_df = hist_df[['Open', 'High', 'Low', 'Close', 'Volume']]
                    elif len(hist_df.columns) == 5:
                        # Columns: [open, high, low, close, volume]
                        hist_df.columns = ['Open', 'High', 'Low', 'Close', 'Volume']
                    else:
                        console.print(f"[dim red]Unexpected column structure for {symbol}: {list(hist_df.columns)}[/dim red]")
                        continue
                    
                    # Ensure numeric data types for analysis
                    numeric_columns = ['Open', 'High', 'Low', 'Close', 'Volume']
                    for column_name in numeric_columns:
                        hist_df[column_name] = pd.to_numeric(hist_df[column_name], errors='coerce')
                    
                    # Remove any rows with NaN values after conversion
                    hist_df = hist_df.dropna()
                    
                    if len(hist_df) < 20:
                        console.print(f"[dim red]Insufficient clean data for {symbol} after conversion[/dim red]")
                        continue
                    
                    # Debug: Check data types before analysis
                    try:
                        # Analyze for breakout patterns
                        analysis = breakout_analyzer.analyze_stock(hist_df)
                    except Exception as analyze_error:
                        console.print(f"[dim red]Analysis error for {symbol}: {analyze_error}[/dim red]")
                        console.print(f"[dim red]Data types: {hist_df.dtypes.to_dict()}[/dim red]")
                        console.print(f"[dim red]Sample data: {hist_df.head(2).to_dict()}[/dim red]")
                        continue
                    
                    # Score the breakout potential
                    breakout_score = 0
                    
                    # Active consolidation channels (high score)
                    active_channels = len(analysis['active_channels'])
                    if active_channels > 0:
                        breakout_score += active_channels * 30
                        
                        # Check channel quality for intraday patterns
                        for channel in analysis['active_channels']:
                            # Reward tight intraday ranges (0.5-3% range)
                            if 0.5 <= channel['range_percent'] <= 3:
                                breakout_score += 25
                            elif 3 < channel['range_percent'] <= 5:
                                breakout_score += 15  # Wider but still tradeable
                            # Duration bonus for longer consolidation (in 15min bars)
                            duration = channel['end_idx'] - channel['start_idx']
                            if duration > 8:  # >2 hours of consolidation
                                breakout_score += 15
                            elif duration > 4:  # >1 hour of consolidation
                                breakout_score += 10
                    
                    # Recent breakouts (moderate score)
                    recent_breakouts = len(analysis['breakouts'])
                    if recent_breakouts > 0:
                        breakout_score += recent_breakouts * 20
                        
                        # Bonus for strong breakouts
                        for breakout in analysis['breakouts']:
                            if breakout.get('strength', 0) > 2:
                                breakout_score += 15
                    
                    # Volume and volatility factors
                    vol_ratio = row.get('relative_volume_10d_calc', 1)
                    if vol_ratio > 1.5:
                        breakout_score += 20
                    elif vol_ratio > 1.2:
                        breakout_score += 10
                    
                    # Volatility sweet spot
                    volatility = row.get('Volatility.D', 0)
                    if 0.02 <= volatility <= 0.05:
                        breakout_score += 15
                    
                    # RSI positioning
                    rsi = row.get('RSI', 50)
                    if 45 <= rsi <= 65:  # Neutral zone good for breakouts
                        breakout_score += 10
                    
                    # Only include stocks with significant breakout potential
                    if breakout_score >= 40:
                        stock_data = {
                            'symbol': symbol,
                            'price': row['close'],
                            'change': row.get('change', 0),
                            'volume': row['volume'],
                            'rel_volume': vol_ratio,
                            'rsi': rsi,
                            'volatility': volatility,
                            'breakout_score': breakout_score,
                            'active_channels': active_channels,
                            'recent_breakouts': recent_breakouts,
                            'analysis': analysis
                        }
                        heavy_breakout_stocks.append(stock_data)
                        
            except Exception as e:
                console.print(f"[dim red]Error analyzing {symbol}: {e}[/dim red]")
                continue
        
        # Sort by breakout score
        heavy_breakout_stocks.sort(key=lambda x: x['breakout_score'], reverse=True)
        
        if heavy_breakout_stocks:
            # Create display dataframe
            display_data = []
            for stock in heavy_breakout_stocks[:15]:  # Top 15
                display_data.append({
                    'Symbol': stock['symbol'],
                    'Price': f"₹{stock['price']:.2f}",
                    'Change%': f"{stock['change']:.2f}%",
                    'Vol Ratio': f"{stock['rel_volume']:.2f}x",
                    'RSI': float(stock['rsi']) if stock['rsi'] is not None else 50.0,  # Keep as float for formatter
                    'Volatility': f"{stock['volatility']:.3f}",
                    'Score': f"{stock['breakout_score']:.0f}",
                    'Channels': stock['active_channels'],
                    'Breakouts': stock['recent_breakouts']
                })
            
            display_df = pd.DataFrame(display_data)
            self.display_table(display_df, "Heavy Breakout Candidates - Smart Money Analysis")
            
            # Show top 3 detailed analysis
            console.print(f"\n[bold cyan]🎯 TOP 3 DETAILED ANALYSIS WITH LEVELS:[/bold cyan]")
            for i, stock in enumerate(heavy_breakout_stocks[:3]):
                console.print(f"\n[bold yellow]{i+1}. {stock['symbol']} (Score: {stock['breakout_score']:.0f}) - Current: ₹{stock['price']:.2f}[/bold yellow]")
                
                analysis = stock['analysis']
                console.print(f"   📊 Active Consolidation Channels: {len(analysis['active_channels'])}")
                console.print(f"   🚀 Recent Breakout Events: {len(analysis['breakouts'])}")
                console.print(f"   📈 Volume: {stock['rel_volume']:.2f}x average")
                console.print(f"   📉 Current RSI: {stock['rsi']:.1f}")
                
                # Show active channel details with S/R levels
                for j, channel in enumerate(analysis['active_channels'][:2]):
                    range_pct = channel['range_percent']
                    duration = channel['end_idx'] - channel['start_idx']
                    hours = duration * 0.25  # 15min bars to hours
                    console.print(f"   🏗️  Active Channel {j+1}:")
                    console.print(f"      • Support: ₹{channel['low']:.2f}")
                    console.print(f"      • Resistance: ₹{channel['high']:.2f}")
                    console.print(f"      • Range: {range_pct:.2f}% ({hours:.1f} hours)")
                
                # Show recent breakouts with detailed levels and timing
                for j, breakout in enumerate(analysis['breakouts'][-2:]):
                    strength = breakout.get('strength', 0)
                    breakout_type = breakout['type'].upper()
                    
                    # Calculate breakout timing (approximate)
                    bars_ago = len(analysis['breakouts']) - breakout['breakout_bar_idx'] if 'breakout_bar_idx' in breakout else 0
                    time_ago = bars_ago * 15  # 15 min bars
                    
                    console.print(f"   🚨 Recent {breakout_type} Breakout:")
                    console.print(f"      • Support Level: ₹{breakout.get('support_level', 'N/A')}")
                    console.print(f"      • Resistance Level: ₹{breakout.get('resistance_level', 'N/A')}")
                    console.print(f"      • Breakout Price: ₹{breakout.get('breakout_price', 'N/A')}")
                    console.print(f"      • Strength: {strength:.2f}%")
                    console.print(f"      • Consolidation Range: {breakout.get('consolidation_range', 'N/A'):.2f}%")
                    if time_ago < 480:  # Less than 8 hours
                        console.print(f"      • Timing: ~{time_ago:.0f} minutes ago")
                    else:
                        console.print(f"      • Timing: Recent (within session)")
                
                # Add historical data validation call
                console.print(f"   🔍 [dim]Fetching live data for validation...[/dim]")
                
                # Validate with fresh Upstox data
                try:
                    # Get latest 5-minute data for validation
                    validation_data = self.upstox_api.fetch_historical_data_v3(
                        symbol=stock['symbol'],
                        unit='minutes',
                        interval=5,  # 5-minute for more recent validation
                        to_date=datetime.now().strftime('%Y-%m-%d'),
                        from_date=(datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
                    )
                    
                    if validation_data is not None and len(validation_data) > 0:
                        # Get latest price data
                        latest_data = validation_data.tail(3)  # Last 3 bars (15 mins)
                        
                        if len(latest_data.columns) == 6:
                            latest_data.columns = ['Timestamp', 'Open', 'High', 'Low', 'Close', 'Volume']
                            latest_data = latest_data[['Open', 'High', 'Low', 'Close', 'Volume']]
                        elif len(latest_data.columns) == 5:
                            latest_data.columns = ['Open', 'High', 'Low', 'Close', 'Volume']
                        
                        # Convert to numeric
                        for col_name in ['Open', 'High', 'Low', 'Close', 'Volume']:
                            latest_data[col_name] = pd.to_numeric(latest_data[col_name], errors='coerce')
                        
                        current_price = latest_data['Close'].iloc[-1]
                        recent_high = latest_data['High'].max()
                        recent_low = latest_data['Low'].min()
                        avg_volume = latest_data['Volume'].mean()
                        
                        console.print(f"   ✅ VALIDATION (Last 15 mins):")
                        console.print(f"      • Current Price: ₹{current_price:.2f}")
                        console.print(f"      • Recent High: ₹{recent_high:.2f}")
                        console.print(f"      • Recent Low: ₹{recent_low:.2f}")
                        console.print(f"      • Avg Volume: {avg_volume:,.0f}")
                        
                        # Validate breakout levels
                        if len(analysis['breakouts']) > 0:
                            last_breakout = analysis['breakouts'][-1]
                            resistance = last_breakout.get('resistance_level', 0)
                            support = last_breakout.get('support_level', 0)
                            
                            if last_breakout['type'] == 'bullish' and current_price > resistance:
                                console.print(f"      • ✅ BULLISH BREAKOUT CONFIRMED: Current (₹{current_price:.2f}) > Resistance (₹{resistance:.2f})")
                            elif last_breakout['type'] == 'bearish' and current_price < support:
                                console.print(f"      • ✅ BEARISH BREAKOUT CONFIRMED: Current (₹{current_price:.2f}) < Support (₹{support:.2f})")
                            else:
                                console.print(f"      • ⚠️  BREAKOUT STATUS: Price testing levels (S: ₹{support:.2f}, R: ₹{resistance:.2f})")
                    
                except Exception as validation_error:
                    console.print(f"      • ❌ Validation failed: {validation_error}")
                
                console.print("")  # Add spacing
        
        else:
            console.print("[yellow]No stocks currently showing heavy breakout patterns[/yellow]")

        console.print("\n[bold yellow]💡 Heavy Breakout Strategy (Intraday 15min):[/bold yellow]")
        console.print("• Pattern: Smart money consolidation channels with breakout potential")
        console.print("• Entry: On volume breakout above/below consolidation range")
        console.print("• Logic: Institutional accumulation followed by directional move")
        console.print("• Stop Loss: Opposite side of consolidation channel")
        console.print("• Target: Measured move = Channel height projected")
        console.print("• Time Frame: Intraday 15min - hold for 1-4 hours typically")
        console.print("• Best Setup: 0.5-3% consolidation range with 1-2+ hour duration")
        console.print("• Data: 15-minute candles from last 7 days for pattern analysis")
        
    except Exception as e:
        console.print(f"[red]Error in heavy breakout analysis: {e}[/red]")
        import traceback
        console.print(f"[dim red]Full traceback: {traceback.format_exc()}[/dim red]")


def _add_heavy_breakout_analysis(self, df: pd.DataFrame) -> pd.DataFrame:
    """Add real-time heavy breakout analysis with parallel intraday data fetching"""
    import concurrent.futures
    from threading import Lock
    
    console.print(f"[dim cyan]🚀 Fetching 15min data for {len(df)} stocks in parallel...[/dim cyan]")
    
    # Initialize breakout analyzer
    breakout_analyzer = SmartMoneyBreakoutChannels(
        overlap=False,
        strong_closes=True,
        normalization_length=100,
        box_detection_length=8
    )
    
    # Results storage with thread safety
    breakout_results = {}
    results_lock = Lock()
    
    def analyze_single_stock(row):
        """Analyze a single stock for breakout patterns"""
        symbol = row['name']
        try:
            # Get intraday data
            from datetime import datetime, timedelta
            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=5)).strftime('%Y-%m-%d')  # 5 days for faster fetch
            
            historical_data = self.upstox_api.fetch_historical_data_v3(
                symbol=symbol,
                unit='minutes',
                interval=15,
                to_date=to_date,
                from_date=from_date
            )
            
            if historical_data is not None and len(historical_data) >= 20:
                # Prepare data
                hist_df = historical_data.copy()
                
                # Handle columns
                if len(hist_df.columns) == 6:
                    hist_df.columns = ['Timestamp', 'Open', 'High', 'Low', 'Close', 'Volume']
                    hist_df = hist_df[['Open', 'High', 'Low', 'Close', 'Volume']]
                elif len(hist_df.columns) == 5:
                    hist_df.columns = ['Open', 'High', 'Low', 'Close', 'Volume']
                
                # Convert to numeric
                for column_name in ['Open', 'High', 'Low', 'Close', 'Volume']:
                    hist_df[column_name] = pd.to_numeric(hist_df[column_name], errors='coerce')
                
                hist_df = hist_df.dropna()
                
                if len(hist_df) >= 20:
                    # Analyze patterns
                    analysis = breakout_analyzer.analyze_stock(hist_df)
                    
                    # Calculate breakout score
                    breakout_score = 0
                    active_channels = len(analysis['active_channels'])
                    recent_breakouts = len(analysis['breakouts'])
                    
                    # Scoring logic
                    if active_channels > 0:
                        breakout_score += active_channels * 25
                        for channel in analysis['active_channels']:
                            if 0.5 <= channel['range_percent'] <= 3:
                                breakout_score += 20
                    
                    if recent_breakouts > 0:
                        breakout_score += recent_breakouts * 15
                        for breakout in analysis['breakouts']:
                            if breakout.get('strength', 0) > 1:
                                breakout_score += 10
                    
                    # Volume and technical factors
                    vol_ratio = row.get('relative_volume_10d_calc', 1)
                    if vol_ratio > 1.5:
                        breakout_score += 15
                    elif vol_ratio > 1.2:
                        breakout_score += 8
                    
                    # Store results
                    with results_lock:
                        breakout_results[symbol] = {
                            'breakout_score': breakout_score,
                            'active_channels': active_channels,
                            'recent_breakouts': recent_breakouts,
                            'analysis': analysis,
                            'support_level': analysis['breakouts'][-1]['support_level'] if analysis['breakouts'] else None,
                            'resistance_level': analysis['breakouts'][-1]['resistance_level'] if analysis['breakouts'] else None,
                            'breakout_type': analysis['breakouts'][-1]['type'] if analysis['breakouts'] else None,
                            'breakout_strength': analysis['breakouts'][-1]['strength'] if analysis['breakouts'] else 0
                        }
                
        except Exception as e:
            console.print(f"[dim red]Error analyzing {symbol}: {str(e)[:50]}[/dim red]")
            with results_lock:
                breakout_results[symbol] = {
                    'breakout_score': 0,
                    'active_channels': 0,
                    'recent_breakouts': 0,
                    'analysis': None,
                    'support_level': None,
                    'resistance_level': None,
                    'breakout_type': None,
                    'breakout_strength': 0
                }
    
    # Execute parallel analysis
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        # Submit all stocks for analysis
        futures = []
        for _, row in df.iterrows():
            future = executor.submit(analyze_single_stock, row)
            futures.append(future)
        
        # Wait for completion with progress
        completed = 0
        for future in concurrent.futures.as_completed(futures):
            completed += 1
            if completed % 5 == 0:
                console.print(f"[dim]Completed: {completed}/{len(df)} stocks[/dim]")
    
    # Add results to dataframe
    df['breakout_score'] = df['name'].map(lambda x: breakout_results.get(x, {}).get('breakout_score', 0))
    df['active_channels'] = df['name'].map(lambda x: breakout_results.get(x, {}).get('active_channels', 0))
    df['recent_breakouts'] = df['name'].map(lambda x: breakout_results.get(x, {}).get('recent_breakouts', 0))
    df['support_level'] = df['name'].map(lambda x: breakout_results.get(x, {}).get('support_level'))
    df['resistance_level'] = df['name'].map(lambda x: breakout_results.get(x, {}).get('resistance_level'))
    df['breakout_type'] = df['name'].map(lambda x: breakout_results.get(x, {}).get('breakout_type'))
    df['breakout_strength'] = df['name'].map(lambda x: breakout_results.get(x, {}).get('breakout_strength', 0))
    
    # Store full analysis for detailed alerts
    df['full_analysis'] = df['name'].map(lambda x: breakout_results.get(x, {}).get('analysis'))
    
    console.print(f"[dim green]✅ Completed parallel analysis for {len(df)} stocks[/dim green]")
    
    return df


def _add_intraday_momentum_analysis(self, df: pd.DataFrame) -> pd.DataFrame:
    """Add real-time intraday momentum analysis with 1-min delta detection"""
    import concurrent.futures
    from datetime import datetime, timedelta
    from threading import Lock
    
    console.print(f"[dim cyan]🔍 Starting intraday momentum analysis for {len(df)} stocks...[/dim cyan]")
    
    momentum_results = {}
    results_lock = Lock()
    
    def analyze_intraday_momentum(row):
        """Analyze intraday momentum with price/volume deltas"""
        symbol = row['name']
        try:
            # Get symbol from ticker (e.g., NSE:RELIANCE -> RELIANCE)
            if hasattr(self, 'upstox_data_fetcher') and self.upstox_data_fetcher:
                # Fetch 1-minute data for last 30 minutes for delta analysis
                df_1min = self.upstox_data_fetcher.fetch_data(
                    symbol=symbol, 
                    days=1, 
                    timeframe='1min'
                )
                
                if df_1min is not None and len(df_1min) >= 10:
                    # Calculate momentum metrics
                    momentum_analysis = _calculate_intraday_momentum_metrics(self, df_1min, row)
                    
                    with results_lock:
                        momentum_results[symbol] = momentum_analysis
                else:
                    # Fallback to basic momentum calculation from current data
                    with results_lock:
                        momentum_results[symbol] = _calculate_basic_momentum_metrics(self, row)
            else:
                # No intraday data available, use basic momentum
                with results_lock:
                    momentum_results[symbol] = _calculate_basic_momentum_metrics(self, row)
                
        except Exception as e:
            console.print(f"[dim red]Error analyzing momentum for {symbol}: {str(e)[:50]}[/dim red]")
            with results_lock:
                momentum_results[symbol] = {
                    'momentum_score': 0,
                    'price_delta_1min': 0,
                    'volume_delta_1min': 0,
                    'momentum_direction': 'NEUTRAL',
                    'entry_signal': False,
                    'momentum_strength': 'WEAK'
                }
    
    # Execute parallel momentum analysis
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = []
        for _, row in df.iterrows():
            future = executor.submit(analyze_intraday_momentum, row)
            futures.append(future)
        
        # Wait for completion
        completed = 0
        for future in concurrent.futures.as_completed(futures):
            completed += 1
            if completed % 3 == 0:
                console.print(f"[dim]Momentum analysis: {completed}/{len(df)} stocks[/dim]")
    
    # Add momentum results to dataframe
    df['momentum_score'] = df['name'].map(lambda x: momentum_results.get(x, {}).get('momentum_score', 0))
    df['price_delta_1min'] = df['name'].map(lambda x: momentum_results.get(x, {}).get('price_delta_1min', 0))
    df['volume_delta_1min'] = df['name'].map(lambda x: momentum_results.get(x, {}).get('volume_delta_1min', 0))
    df['momentum_direction'] = df['name'].map(lambda x: momentum_results.get(x, {}).get('momentum_direction', 'NEUTRAL'))
    df['entry_signal'] = df['name'].map(lambda x: momentum_results.get(x, {}).get('entry_signal', False))
    df['momentum_strength'] = df['name'].map(lambda x: momentum_results.get(x, {}).get('momentum_strength', 'WEAK'))
    
    # Sort by momentum score (highest first) and filter strong signals
    df = df.sort_values('momentum_score', ascending=False)
    df = df[df['momentum_score'] > 30]  # Only strong momentum stocks
    
    console.print(f"[dim green]✅ Completed intraday momentum analysis. {len(df)} stocks with strong momentum.[/dim green]")
    
    return df


def _calculate_intraday_momentum_metrics(self, df_1min: pd.DataFrame, current_row) -> dict:
    """Calculate detailed momentum metrics from 1-minute intraday data"""
    try:
        # Sort by timestamp to ensure proper order
        df_1min = df_1min.sort_values('timestamp')
        
        # Get last 10 candles for analysis
        recent_candles = df_1min.tail(10)
        
        if len(recent_candles) < 5:
            return _calculate_basic_momentum_metrics(self, current_row)
        
        # Calculate price deltas
        recent_candles['price_delta'] = recent_candles['close'].diff()
        recent_candles['volume_delta'] = recent_candles['volume'].diff()
        
        # Price momentum metrics
        price_changes = recent_candles['price_delta'].dropna()
        avg_price_delta = price_changes.mean()
        last_3_price_delta = price_changes.tail(3).mean()
        
        # Volume momentum metrics  
        volume_changes = recent_candles['volume_delta'].dropna()
        avg_volume_delta = volume_changes.mean()
        
        # Direction detection
        positive_moves = len(price_changes[price_changes > 0])
        negative_moves = len(price_changes[price_changes < 0])
        
        # Momentum direction
        if positive_moves > negative_moves and last_3_price_delta > 0:
            direction = 'BULLISH'
        elif negative_moves > positive_moves and last_3_price_delta < 0:
            direction = 'BEARISH'
        else:
            direction = 'NEUTRAL'
        
        # Momentum strength based on consistency and magnitude
        consistency_score = max(positive_moves, negative_moves) / len(price_changes) * 100
        magnitude_score = abs(last_3_price_delta) / current_row['ATR'] * 100 if current_row['ATR'] > 0 else 0
        
        momentum_score = (consistency_score + magnitude_score) / 2
        
        # Entry signal logic
        entry_signal = (
            momentum_score > 40 and
            direction in ['BULLISH', 'BEARISH'] and
            abs(last_3_price_delta) > current_row['close'] * 0.0005  # 0.05% minimum move
        )
        
        # Strength categorization
        if momentum_score > 70:
            strength = 'VERY_STRONG'
        elif momentum_score > 50:
            strength = 'STRONG'
        elif momentum_score > 30:
            strength = 'MODERATE'
        else:
            strength = 'WEAK'
        
        return {
            'momentum_score': momentum_score,
            'price_delta_1min': last_3_price_delta,
            'volume_delta_1min': avg_volume_delta,
            'momentum_direction': direction,
            'entry_signal': entry_signal,
            'momentum_strength': strength,
            'consistency_score': consistency_score,
            'magnitude_score': magnitude_score
        }
        
    except Exception as e:
        console.print(f"[dim red]Error in momentum calculation: {str(e)[:30]}[/dim red]")
        return _calculate_basic_momentum_metrics(self, current_row)


def _calculate_basic_momentum_metrics(self, row) -> dict:
    """Calculate basic momentum metrics when intraday data is unavailable"""
    try:
        # Use available technical indicators for momentum assessment
        rsi = row.get('RSI', 50)
        rsi_prev = row.get('RSI[1]', 50) 
        macd = row.get('MACD.macd', 0)
        macd_signal = row.get('MACD.signal', 0)
        mom = row.get('Mom', 0)
        change = row.get('change', 0)
        
        # Basic momentum score from technical indicators
        rsi_momentum = (rsi - rsi_prev) * 2  # RSI change weight
        macd_momentum = (macd - macd_signal) * 10  # MACD divergence
        price_momentum = abs(change) * 5  # Price change weight
        
        momentum_score = max(0, min(100, 
            50 + rsi_momentum + macd_momentum + price_momentum
        ))
        
        # Direction from price change and indicators
        if change > 0.5 and macd > macd_signal and rsi > rsi_prev:
            direction = 'BULLISH'
        elif change < -0.5 and macd < macd_signal and rsi < rsi_prev:
            direction = 'BEARISH'  
        else:
            direction = 'NEUTRAL'
        
        # Basic entry signal
        entry_signal = (
            momentum_score > 35 and
            direction in ['BULLISH', 'BEARISH'] and
            abs(change) > 0.5
        )
        
        # Strength from momentum score
        if momentum_score > 60:
            strength = 'STRONG'
        elif momentum_score > 40:
            strength = 'MODERATE'
        else:
            strength = 'WEAK'
        
        return {
            'momentum_score': momentum_score,
            'price_delta_1min': change,
            'volume_delta_1min': 0,  # Not available without intraday data
            'momentum_direction': direction,
            'entry_signal': entry_signal,
            'momentum_strength': strength
        }
        
    except Exception as e:
        return {
            'momentum_score': 0,
            'price_delta_1min': 0,
            'volume_delta_1min': 0,
            'momentum_direction': 'NEUTRAL',
            'entry_signal': False,
            'momentum_strength': 'WEAK'
        }


def _analyze_sector_correlations(self, df: pd.DataFrame) -> pd.DataFrame:
    """Analyze sector correlations to find catch-up trade opportunities"""
    from collections import defaultdict
    import numpy as np
    
    console.print(f"[dim cyan]📊 Analyzing {len(df)} stocks across sectors...[/dim cyan]")
    
    # Group stocks by sector
    sector_groups = defaultdict(list)
    for _, row in df.iterrows():
        sector = row.get('sector', 'Unknown')
        if sector and sector != 'Unknown':
            sector_groups[sector].append(row.to_dict())
    
    console.print(f"[dim]Found {len(sector_groups)} sectors with active stocks[/dim]")
    
    catch_up_opportunities = []
    
    for sector, stocks in sector_groups.items():
        if len(stocks) < 2:  # Need at least 2 stocks for correlation
            continue
            
        # Sort stocks by absolute change (biggest movers first)
        stocks_sorted = sorted(stocks, key=lambda x: abs(x['change']), reverse=True)
        
        # Get top performer (leader)
        leader = stocks_sorted[0]
        leader_change = leader['change']
        
        # Skip if leader move is too small
        if abs(leader_change) < 1.0:
            continue
            
        # Find potential catch-up candidates (stocks 2-4 that haven't moved much)
        for i in range(1, min(4, len(stocks_sorted))):  # Check positions 2-4
            candidate = stocks_sorted[i]
            candidate_change = candidate['change']
            
            # Calculate correlation opportunity
            change_gap = abs(leader_change) - abs(candidate_change)
            
            # Ideal catch-up conditions:
            # 1. Leader moved significantly (>2%) 
            # 2. Candidate hasn't moved much (<1%)
            # 3. Good liquidity in candidate
            # 4. Same direction potential (RSI not extreme)
            
            if (abs(leader_change) > 2.0 and           # Leader moved big
                abs(candidate_change) < 1.0 and       # Candidate lagging
                change_gap > 1.5 and                  # Significant gap
                candidate['relative_volume_10d_calc'] > 0.8 and  # Active
                30 < candidate.get('RSI', 50) < 80):  # Not extreme RSI
                
                # Calculate catch-up potential
                expected_move = leader_change * 0.6  # Expect 60% of leader's move
                current_gap = expected_move - candidate_change
                
                # Direction determination
                if leader_change > 0:
                    direction = 'LONG'  # Expect upside catch-up
                    signal_strength = min(change_gap * 20, 100)  # Up to 100% strength
                else:
                    direction = 'SHORT'  # Expect downside catch-up  
                    signal_strength = min(change_gap * 20, 100)
                
                # Entry urgency based on time and volume
                volume_ratio = candidate['relative_volume_10d_calc']
                if volume_ratio > 1.5:
                    urgency = 'HIGH'
                elif volume_ratio > 1.0:
                    urgency = 'MEDIUM'
                else:
                    urgency = 'LOW'
                
                # Create catch-up opportunity
                opportunity = candidate.copy()
                opportunity.update({
                    'sector_leader': leader['name'],
                    'leader_change': leader_change,
                    'change_gap': change_gap,
                    'expected_move': expected_move,
                    'catch_up_potential': current_gap,
                    'trade_direction': direction,
                    'signal_strength': signal_strength,
                    'entry_urgency': urgency,
                    'correlation_score': min(90, change_gap * 25),  # Scoring system
                    'sector': sector
                })
                
                catch_up_opportunities.append(opportunity)
    
    if not catch_up_opportunities:
        console.print(f"[yellow]⚠️ No sector catch-up opportunities found[/yellow]")
        return pd.DataFrame()
    
    # Convert to DataFrame and sort by correlation score
    df_opportunities = pd.DataFrame(catch_up_opportunities)
    df_opportunities = df_opportunities.sort_values('correlation_score', ascending=False)
    
    # Filter to top opportunities
    df_opportunities = df_opportunities[df_opportunities['correlation_score'] > 30]
    df_opportunities = df_opportunities.head(15)  # Top 15 opportunities
    
    console.print(f"[dim green]✅ Found {len(df_opportunities)} sector catch-up opportunities[/dim green]")
    
    # Add summary info for display
    for idx, row in df_opportunities.iterrows():
        leader = row['sector_leader']
        gap = row['change_gap']
        direction = row['trade_direction']
        console.print(f"[dim]  {row['name'][:10]:10} | Leader: {leader[:8]:8} | Gap: {gap:+.1f}% | {direction}[/dim]")
    
    return df_opportunities

