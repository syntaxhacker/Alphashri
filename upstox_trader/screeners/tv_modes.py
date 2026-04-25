from typing import Optional, List, Dict, Tuple
from rich.panel import Panel
from rich.console import Console
from tradingview_screener import Query, col
import time
import os
from datetime import datetime

import pandas as pd
import numpy as np

from .modes import (
    MarketConstants,
    QueryConfig,
    apply_market_cap_filter,
    apply_price_filter,
    get_market_config,
    build_market_aware_query,
    create_base_query,
    _add_intraday_momentum_analysis,
    _analyze_sector_correlations,
    _calculate_intraday_momentum_metrics,
    _calculate_basic_momentum_metrics,
    get_watch_data_fomo,
    get_watch_data_accumulation,
    get_watch_data_smart_fomo,
    get_watch_data_momentum,
    get_watch_data_optimized_gap,
    get_watch_data_heavy_breakout,
    get_watch_data_scalping,
    get_watch_data_momentum_scalper,
    get_watch_data_sector_scalper,
    get_watch_data_short_squeeze,
    get_watch_data_breakout_failure,
    get_watch_data_exhaustion_reversal,
    get_watch_data_morning_fade,
    get_watch_data_reversal,
    get_watch_data_volume_surge,
    get_watch_data_channel_play,
    get_watch_data_sector_momentum,
    get_watch_data_quick_profit,
    get_watch_data_fomo_momentum,
    get_watch_data_realtime_momentum,
    get_watch_data_prebreakout,
    SmartMoneyBreakoutChannels,
    heavy_breakout,
    _add_heavy_breakout_analysis,
    intraday_watch_mode,
    _get_watch_data,
)

try:
    from .modes import pre_breakout, momentum, fomo, gap_trading, intraday, swing, investment, research
except ImportError:
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
    """Optimized gap strategy - 15-minute proven strategy"""
    console.print(Panel.fit("\U0001f680 OPTIMIZED GAP STRATEGY (15-MIN PROVEN)", style="bold green"))
    try:
        total_rows, df = get_watch_data_optimized_gap(self)

        if df.empty:
            console.print("[yellow]No gap opportunities meeting quality criteria found[/yellow]")
            return None

        df['quality_score'] = self._calculate_quality_score(df)
        df = df.sort_values('quality_score', ascending=False)

        self.display_table(df, "\U0001f680 Optimized 15-Min Gap Strategy Stocks")

        console.print("\n[bold yellow]\U0001f4ca PROVEN STRATEGY PARAMETERS:[/bold yellow]")
        console.print("\u2022 [green]Timeframe:[/green] 15-minute intervals (68.4% win rate)")
        console.print("\u2022 [green]Entry:[/green] 9:30 AM after trend confirmation")
        console.print("\u2022 [green]Target:[/green] 2.5% (proven achievable)")
        console.print("\u2022 [green]Stop Loss:[/green] 0.5% (tight risk control)")
        console.print("\u2022 [green]Expected P&L:[/green] \u20b9156 per trade average")

        if getattr(self, 'paper_trading_enabled', False):
            console.print("\n[bold blue]\U0001f4ca PAPER TRADING READY:[/bold blue]")
            top_stocks = df[df['quality_score'] >= 80].head(5)
            if not top_stocks.empty:
                console.print(f"\n[bold blue]\U0001f916 AUTO-TRADING {len(top_stocks)} HIGH-QUALITY GAPS:[/bold blue]")
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
                    console.print(f"   \U0001f916 {row['name'][:15]:15} | Gap: {row['change']:+.1f}% | Score: {row['quality_score']:3.0f} | Target: +2.5% | Stop: -1.0%")

        console.print("\n[bold yellow]\U0001f514 ALERT SETUP:[/bold yellow]")
        console.print("\u2022 9:15 AM: Check screener for gap stocks")
        console.print("\u2022 9:30 AM: Analyze top quality scores on 15-min charts")
        console.print("\u2022 Entry: Wait for trend confirmation before entering")
        console.print("\u2022 Exit: Stick to 2.5% target / 0.5% stop discipline")

        return df
    except Exception as e:
        console.print(f"[red]Error in optimized gap strategy: {e}[/red]")
        return None


def early_momentum_detection(self) -> None:
    """Detect early momentum before FOMO kicks in"""
    console.print(Panel.fit("\u26a1 EARLY MOMENTUM: Pre-FOMO Signals", style="bold green"))
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

        console.print("\n[bold yellow]\U0001f4a1 Trading Strategy:[/bold yellow]")
        console.print("\u2022 Entry: When RSI crosses 50 with volume confirmation")
        console.print("\u2022 Stop Loss: Below recent swing low (0.5%)")
        console.print("\u2022 Target: Next resistance or 3-5% move")
        console.print("\u2022 Logic: Catch momentum before crowd notices")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


def relative_strength_leaders(self) -> None:
    """Find stocks showing relative strength vs market"""
    console.print(Panel.fit("\U0001f4aa RELATIVE STRENGTH: Market Outperformers", style="bold cyan"))
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

        console.print("\n[bold yellow]\U0001f4a1 Trading Strategy:[/bold yellow]")
        console.print("\u2022 Entry: On any pullback or consolidation break")
        console.print("\u2022 Stop Loss: Below weekly support (0.5%)")
        console.print("\u2022 Target: Continuation of relative strength trend")
        console.print("\u2022 Logic: Leaders continue to lead in trends")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


def intraday_high_volume_breakouts(self) -> None:
    """Find stocks with high volume breakouts for intraday trading"""
    console.print(Panel.fit("\U0001f680 INTRADAY: High Volume Breakouts", style="bold blue"))
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
        
        if not df.empty:
            console.print("[dim]Adding trend analysis...[/dim]")
            trend_data = []
            for _, row in df.iterrows():
                ticker = row['name']
                trend = self._check_historical_trend(ticker, timeframe='daily', lookback_days=15)
                trend_data.append(trend)
            df['trend'] = trend_data

        self.display_table(df, "High Volume Breakouts - Intraday")

        console.print("\n[bold yellow]\U0001f4a1 Trading Strategy:[/bold yellow]")
        console.print("\u2022 Entry: On breakout above resistance with high volume")
        console.print("\u2022 Stop Loss: Below recent support (2-3%)")
        console.print("\u2022 Target: 1:2 risk-reward ratio")
        console.print("\u2022 Time Frame: 5-15 minute charts")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


def intraday_gap_up_stocks(self) -> None:
    """Find gap-up stocks for intraday momentum trading"""
    console.print(Panel.fit("\U0001f4c9 INTRADAY: Gap-Up Momentum", style="bold green"))
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

        console.print("\n[bold yellow]\U0001f4a1 Trading Strategy:[/bold yellow]")
        console.print("\u2022 Entry: On pullback to gap support or breakout continuation")
        console.print("\u2022 Stop Loss: Below gap fill level (0.5%)")
        console.print("\u2022 Target: Previous resistance or 5-8% gain")
        console.print("\u2022 Time Frame: 15-30 minute charts")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


def gap_fill_trading_strategy(self) -> None:
    """
    GAP-FILL TRADING STRATEGY (HISTORICAL ANALYSIS)
    Delegates to existing analyzer and tv_display as in original method.
    """
    console.print(Panel.fit("\U0001f3af GAP-FILL TRADING STRATEGY (HISTORICAL ANALYSIS)", style="bold magenta"))
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

        if getattr(self, 'tv_display', None):
            self.tv_display.display_gap_fill_results(gap_df)
        else:
            try:
                from . import tv_display
            except Exception:
                import upstox_trader.screeners.tv_display as tv_display
            tv_display.display_gap_fill_results(gap_df)
    except Exception as e:
        console.print(f"[red]Error in gap-fill strategy: {e}[/red]")


def research_earnings_calendar(self) -> None:
    """Analyze earnings calendar and upcoming events"""
    return research.research_earnings_calendar(self)


def research_sector_performance(self) -> None:
    """Analyze sector-wise performance and trends"""
    console.print(Panel.fit("\U0001f3e2 RESEARCH: Sector Performance Analysis", style="bold green"))
    
    try:
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
        
        if not df.empty and 'ticker' in df.columns:
            df = df[df['ticker'].str.startswith('NSE:')]
            
        if not df.empty and 'sector' in df.columns:
            sector_stats = df.groupby('sector').agg({
                'change': ['mean', 'count'],
                'market_cap_basic': 'sum',
                'volume': 'sum',
                'return_on_equity': 'mean',
                'price_earnings_ttm': 'mean',
                'relative_volume_10d_calc': 'mean'
            }).round(2)
            
            sector_stats.columns = ['avg_change', 'stock_count', 'total_mcap', 'total_volume', 'avg_roe', 'avg_pe', 'avg_vol_ratio']
            sector_stats = sector_stats.reset_index()
            sector_stats = sector_stats.sort_values('avg_change', ascending=False)
            
            try:
                from . import tv_display
                tv_display.display_sector_table(sector_stats, "Sector Performance Analysis")
            except Exception:
                try:
                    import upstox_trader.screeners.tv_display as tv_display
                    tv_display.display_sector_table(sector_stats, "Sector Performance Analysis")
                except Exception:
                    console.print("[red]tv_display module unavailable[/red]")
            
            console.print(f"\n[bold green]\U0001f3c6 Top Performing Sectors:[/bold green]")
            for i, (_, row) in enumerate(sector_stats.head(3).iterrows()):
                console.print(f"  {i+1}. {row['sector']}: {row['avg_change']:+.2f}% ({row['stock_count']} stocks)")
            
            console.print(f"\n[bold red]\U0001f4c9 Underperforming Sectors:[/bold red]")
            for i, (_, row) in enumerate(sector_stats.tail(3).iterrows()):
                console.print(f"  {i+1}. {row['sector']}: {row['avg_change']:+.2f}% ({row['stock_count']} stocks)")
            
            console.print("\n[bold yellow]\U0001f4a1 Sector Analysis Insights:[/bold yellow]")
            console.print("\u2022 Identify sector rotation opportunities")
            console.print("\u2022 Compare relative strength across sectors")
            console.print("\u2022 Monitor sector-specific news and events")
            console.print("\u2022 Track institutional money flow patterns")
            
        else:
            console.print("[yellow]\u26a0\ufe0f Sector data not available or limited[/yellow]")
            self.display_table(df.head(15), "Market Analysis (No Sector Data)")
            
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


def research_sector_stocks(self, sector_name=None, limit=20) -> None:
    """Find top stocks in a specific sector"""
    if sector_name:
        title = f"\U0001f3e2 SECTOR: {sector_name} Top Stocks"
    else:
        title = "\U0001f3e2 SECTOR: Select Sector Stocks"
        
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
        
        if sector_name:
            query = query.where(col('sector') == sector_name)
        
        total_rows, df = (
            query
            .order_by('market_cap_basic', ascending=False)
            .limit(limit)
            .get_scanner_data(cookies=self.cookies)
        )
        
        if not df.empty and 'ticker' in df.columns:
            df = df[df['ticker'].str.startswith('NSE:')]
        
        if not df.empty:
            if sector_name:
                self.display_table(df, f"{sector_name} - Top Stocks")
            else:
                if 'sector' in df.columns:
                    sectors = df['sector'].unique()
                    console.print(f"[bold yellow]Available Sectors ({len(sectors)}):[/bold yellow]")
                    for i, sector in enumerate(sorted(sectors), 1):
                        console.print(f"  {i}. {sector}")
                    console.print(f"\n[bold blue]Usage:[/bold blue] Use --sector '<sector_name>' parameter")
                    console.print(f"[bold blue]Example:[/bold blue] python tv_screen_usage.py --example research_sector_stocks --sector 'Technology'")
                else:
                    self.display_table(df.head(15), "Market Stocks (No Sector Data)")
                    
            console.print("\n[bold yellow]\U0001f4a1 Sector Analysis Tips:[/bold yellow]")
            console.print("\u2022 Compare stocks within the same sector")
            console.print("\u2022 Look for sector leaders vs laggards")
            console.print("\u2022 Monitor sector-specific catalysts")
            console.print("\u2022 Track relative performance trends")
        else:
            console.print(f"[red]No stocks found for sector: {sector_name}[/red]")
            
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


def intraday_oversold_bounce(self) -> None:
    """Find oversold stocks bouncing back"""
    return intraday.intraday_oversold_bounce(self)


def intraday_news_momentum(self) -> None:
    """Find stocks with news-driven momentum"""
    return intraday.intraday_news_momentum(self)


def intraday_early_breakout_setup(self) -> None:
    """Early breakout setup detection before full breakout"""
    console.print(Panel.fit("\U0001f50d EARLY BREAKOUT SETUP: Pre-Breakout Detection", style="bold cyan"))
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
                col('close') > 50,
                col('volume') > 400000,
                col('market_cap_basic') > 1000000000,
                col('relative_volume_10d_calc') > 1.3,
                col('RSI').between(45, 70),
                col('close') > col('low_20d') * 1.02,
                col('close') < col('high_20d') * 0.98
            )
            .orderby(col('relative_volume_10d_calc'), ascending=False)
            .limit(25)
            .get()
        )
        
        if not df.empty:
            df['breakout_score'] = (
                df['relative_volume_10d_calc'] * 10 + 
                (70 - df['RSI']) +
                (df['high_20d'] / df['close'] - 1) * 100
            )
            
            df = df.sort_values('breakout_score', ascending=False)
            
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "\U0001f50d EARLY BREAKOUT SETUP Candidates")
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
    console.print(Panel.fit("\U0001f300 COMPRESSION COILING: Pre-Explosion Setups", style="bold purple"))
    try:
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
    console.print(Panel.fit("\U0001f3ed SECTOR ROTATION: Industry Group Moves", style="bold bright_yellow"))
    try:
        console.print("[blue]Sector rotation analysis requires detailed sector data and rotation metrics.[/blue]")
        console.print("[blue]This is a simplified version for demonstration.[/blue]")
        
    except Exception as e:
        console.print(f"[red]Error in sector rotation analysis: {e}[/red]")


def invest_quality_growth(self) -> None:
    """Find quality growth stocks for long-term investment"""
    return investment.invest_quality_growth(self)


def invest_dividend_aristocrats(self) -> None:
    """Find dividend-paying stocks for income investing"""
    console.print(Panel.fit("\U0001f4b0 INVEST: Dividend Aristocrats", style="bold blue"))
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

        console.print("\n[bold yellow]\U0001f4a1 Investment Strategy:[/bold yellow]")
        console.print("\u2022 Entry: On dividend yield above 3%")
        console.print("\u2022 Stop Loss: Only on fundamental deterioration (or 0.5% technical stop)")
        console.print("\u2022 Target: Consistent dividend income + growth")
        console.print("\u2022 Time Frame: Hold for decades")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


def invest_undervalued_gems(self) -> None:
    """Find undervalued stocks with potential for long-term investing"""
    console.print(Panel.fit("\U0001f48e INVEST: Undervalued Gems", style="bold magenta"))
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

        console.print("\n[bold yellow]\U0001f4a1 Investment Strategy:[/bold yellow]")
        console.print("\u2022 Entry: After thorough fundamental analysis")
        console.print("\u2022 Stop Loss: On business deterioration (or 0.5% technical stop)")
        console.print("\u2022 Target: Fair value realization")
        console.print("\u2022 Time Frame: Patient holding 2-5 years")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


def research_sector_leaders(self) -> None:
    """Research sector leaders and their performance"""
    console.print(Panel.fit("\U0001f50d RESEARCH: Sector Leaders Analysis", style="bold yellow"))
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

        console.print("\n[bold yellow]\U0001f4a1 Research Insights:[/bold yellow]")
        console.print("\u2022 Compare ROE across sectors")
        console.print("\u2022 Identify sector rotation opportunities")
        console.print("\u2022 Track revenue growth trends")
        console.print("\u2022 Monitor profit margin sustainability")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


def research_market_sentiment(self) -> None:
    """Analyze current market sentiment and momentum"""
    console.print(Panel.fit("\U0001f4ca RESEARCH: Market Sentiment Analysis", style="bold red"))
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
            console.print(f"\u2022 Total stocks analyzed: {total_stocks}")
            console.print(f"\u2022 Gainers: {gainers} ({gainers/total_stocks*100:.1f}%)")
            console.print(f"\u2022 Losers: {losers} ({losers/total_stocks*100:.1f}%)")
            console.print(f"\u2022 High volume activity: {high_volume} ({high_volume/total_stocks*100:.1f}%)")

            avg_change = df['change'].mean()
            avg_volume_ratio = df['relative_volume_10d_calc'].mean()

            console.print(f"\u2022 Average change: {avg_change:+.2f}%")
            console.print(f"\u2022 Average volume ratio: {avg_volume_ratio:.2f}x")
            
            if avg_change > 0.5:
                console.print("[green]\u2705 Bullish market sentiment[/green]")
            elif avg_change < -0.5:
                console.print("[red]\u274c Bearish market sentiment[/red]")
            else:
                console.print("[yellow]\u26a0\ufe0f Neutral market sentiment[/yellow]")
        
        self.display_table(df.head(15), "Market Sentiment Analysis")
        
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
