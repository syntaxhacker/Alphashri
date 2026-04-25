from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from tradingview_screener import Query, col
from datetime import datetime, timedelta
import pandas as pd
import time as time_module
import os

console = Console()


class ScannersMixin:

    def intraday_high_volume_breakouts(self):
        console.print(Panel.fit("🚀 INTRADAY: High Volume Breakouts", style="bold blue"))

        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                       'RSI', 'Volatility.D', 'market_cap_basic', 'update_mode')
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

            console.print("\n[bold yellow]💡 Trading Strategy:[/bold yellow]")
            console.print("• Entry: On breakout above resistance with high volume")
            console.print("• Stop Loss: Below recent support (2-3%)")
            console.print("• Target: 1:2 risk-reward ratio")
            console.print("• Time Frame: 5-15 minute charts")

        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")

    def intraday_gap_up_stocks(self):
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
            console.print("• Stop Loss: Below gap fill level")
            console.print("• Target: Previous resistance or 5-8% gain")
            console.print("• Time Frame: 15-30 minute charts")

        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")

    def intraday_oversold_bounce(self):
        console.print(Panel.fit("🔄 INTRADAY: Oversold Bounce", style="bold cyan"))

        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'RSI', 'MACD.macd',
                       'MACD.signal', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 75,
                    col('change') < -2,
                    col('RSI') < 35,
                    col('volume') > 750000,
                    col('market_cap_basic') > 1e9,
                    col('MACD.macd') > col('MACD.signal')
                )
                .order_by('RSI', ascending=True)
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )

            self.display_table(df, "Oversold Bounce Candidates")

            console.print("\n[bold yellow]💡 Trading Strategy:[/bold yellow]")
            console.print("• Entry: On RSI reversal above 30 with volume")
            console.print("• Stop Loss: Below recent low (1-2%)")
            console.print("• Target: Previous support turned resistance")
            console.print("• Time Frame: 15-30 minute charts")

        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")

    def intraday_news_momentum(self):
        console.print(Panel.fit("📰 INTRADAY: News-Driven Momentum", style="bold magenta"))

        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                       'Volatility.D', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 25,
                    col('relative_volume_10d_calc') > 3,
                    col('Volatility.D') > 0.05,
                    col('volume') > 2000000,
                    col('market_cap_basic') > 2e8
                )
                .order_by('relative_volume_10d_calc', ascending=False)
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )

            self.display_table(df, "News-Driven Momentum Stocks")

            console.print("\n[bold yellow]💡 Trading Strategy:[/bold yellow]")
            console.print("• Research: Check news/announcements immediately")
            console.print("• Entry: On pullback or momentum continuation")
            console.print("• Stop Loss: Tight stops (1-2%) due to volatility")
            console.print("• Target: Quick profits, trail stops")

        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")

    def intraday_early_breakout_setup(self):
        console.print(Panel.fit("🎯 INTRADAY: Early Breakout Setup (Pre-Breakout)", style="bold red"))

        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                       'RSI', 'MACD.macd', 'MACD.signal', 'BB.upper', 'BB.lower',
                       'Volatility.D', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 50,
                    col('change').between(-1, 2),
                    col('relative_volume_10d_calc') > 1.3,
                    col('RSI').between(45, 65),
                    col('MACD.macd') > col('MACD.signal'),
                    col('Volatility.D') < 0.04,
                    col('volume') > 500000,
                    col('market_cap_basic') > 5e8
                )
                .order_by('relative_volume_10d_calc', ascending=False)
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )

            self.display_table(df, "Early Breakout Setup - Pre-Breakout Detection")

            console.print("\n[bold yellow]💡 Early Detection Strategy:[/bold yellow]")
            console.print("• Entry: These stocks are BUILDING momentum (not broken out yet)")
            console.print("• Watch: For volume surge + breakout above recent resistance")
            console.print("• Advantage: Get in BEFORE the big move starts")
            console.print("• Stop Loss: Below recent consolidation low (1-2%)")
            console.print("• Target: Measured move from consolidation breakout")
            console.print("• Time Frame: 5-15 minute charts for entry timing")

        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")

    def intraday_volume_accumulation(self):
        console.print(Panel.fit("📊 INTRADAY: Volume Accumulation (Smart Money)", style="bold cyan"))

        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                       'RSI', 'price_52_week_high', 'price_52_week_low', 'BB.upper',
                       'BB.lower', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 75,
                    col('change').between(-1.5, 1.5),
                    col('relative_volume_10d_calc') > 2.0,
                    col('RSI').between(40, 60),
                    col('volume') > 1000000,
                    col('market_cap_basic') > 1e9,
                    col('close') > col('price_52_week_low'),
                    col('close') < col('price_52_week_high')
                )
                .order_by('relative_volume_10d_calc', ascending=False)
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )

            self.display_table(df, "Volume Accumulation - Smart Money Building")

            console.print("\n[bold yellow]💡 Volume Accumulation Strategy:[/bold yellow]")
            console.print("• Pattern: High volume + small price moves = Smart money buying")
            console.print("• Entry: On breakout above accumulation range with volume")
            console.print("• Logic: Big players accumulating before major move")
            console.print("• Stop Loss: Below accumulation support")
            console.print("• Target: Previous resistance levels")
            console.print("• Time Frame: Can hold 1-3 days for bigger moves")

        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")

    def intraday_compression_coiling(self):
        console.print(Panel.fit("🌪️ INTRADAY: Compression/Coiling Stocks", style="bold yellow"))

        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                       'RSI', 'BB.upper', 'BB.lower', 'Volatility.D', 'ATR',
                       'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 100,
                    col('Volatility.D') < 0.025,
                    col('change').between(-0.8, 0.8),
                    col('RSI').between(35, 65),
                    col('relative_volume_10d_calc') > 0.8,
                    col('volume') > 300000,
                    col('market_cap_basic') > 5e8,
                    col('BB.upper') > col('BB.lower')
                )
                .order_by('Volatility.D', ascending=True)
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )

            self.display_table(df, "Compression/Coiling Stocks - Pre-Explosion")

            console.print("\n[bold yellow]💡 Compression Strategy:[/bold yellow]")
            console.print("• Pattern: Very low volatility = Energy building for big move")
            console.print("• Entry: Wait for volume spike + breakout from range")
            console.print("• Logic: Coiled spring effect - explosive moves follow compression")
            console.print("• Direction: Can break either way - follow the breakout")
            console.print("• Stop Loss: Opposite side of compression range")
            console.print("• Target: Measured move = Range height projected")

        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")

    def swing_bullish_reversal(self):
        console.print(Panel.fit("🔄 SWING: Bullish Reversal Patterns", style="bold blue"))

        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'RSI', 'MACD.macd',
                       'MACD.signal', 'EMA20', 'EMA50', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 100,
                    col('RSI').between(30, 50),
                    col('MACD.macd') > col('MACD.signal'),
                    col('close') > col('EMA20'),
                    col('volume') > 300000,
                    col('market_cap_basic') > 5e8
                )
                .order_by('RSI', ascending=True)
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )

            self.display_table(df, "Bullish Reversal Patterns")

            console.print("\n[bold yellow]💡 Trading Strategy:[/bold yellow]")
            console.print("• Entry: On breakout above EMA50 with volume")
            console.print("• Stop Loss: Below EMA20 (3-5%)")
            console.print("• Target: Previous resistance levels")
            console.print("• Time Frame: Daily charts, hold 1-4 weeks")

        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")

    def swing_breakout_consolidation(self):
        console.print(Panel.fit("📊 SWING: Breakout from Consolidation", style="bold green"))

        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                       'price_52_week_high', 'price_52_week_low', 'RSI', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 200,
                    col('change') > 1,
                    col('relative_volume_10d_calc') > 1.3,
                    col('RSI').between(45, 70),
                    col('price_52_week_low') < col('close'),
                    col('price_52_week_high') > col('close'),
                    col('volume') > 200000
                )
                .order_by('relative_volume_10d_calc', ascending=False)
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )

            self.display_table(df, "Consolidation Breakouts")

            console.print("\n[bold yellow]💡 Trading Strategy:[/bold yellow]")
            console.print("• Entry: On volume breakout above consolidation")
            console.print("• Stop Loss: Below consolidation support")
            console.print("• Target: Measured move (consolidation height)")
            console.print("• Time Frame: Daily/Weekly charts")

        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")

    def swing_sector_rotation(self):
        console.print(Panel.fit("🔄 SWING: Sector Rotation Play", style="bold cyan"))

        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'price_earnings_ttm',
                       'return_on_equity', 'EMA20', 'EMA50', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 150,
                    col('price_earnings_ttm') < 25,
                    col('return_on_equity') > 15,
                    col('close') > col('EMA20'),
                    col('EMA20') > col('EMA50'),
                    col('volume') > 150000,
                    col('market_cap_basic') > 1e9
                )
                .order_by('return_on_equity', ascending=False)
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )

            self.display_table(df, "Sector Leaders")

            console.print("\n[bold yellow]💡 Trading Strategy:[/bold yellow]")
            console.print("• Entry: On pullback to EMA20 support")
            console.print("• Stop Loss: Below EMA50")
            console.print("• Target: Sector relative strength")
            console.print("• Time Frame: Weekly charts, hold 2-8 weeks")

        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")

    def invest_quality_growth(self):
        console.print(Panel.fit("🌱 INVEST: Quality Growth Stocks", style="bold green"))

        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'price_earnings_ttm', 'return_on_equity',
                       'total_revenue_yoy_growth_ttm', 'earnings_per_share_diluted_yoy_growth_ttm',
                       'debt_to_equity', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 100,
                    col('price_earnings_ttm').between(10, 30),
                    col('return_on_equity') > 18,
                    col('total_revenue_yoy_growth_ttm') > 10,
                    col('earnings_per_share_diluted_yoy_growth_ttm') > 15,
                    col('debt_to_equity') < 1,
                    col('market_cap_basic') > 5e9
                )
                .order_by('return_on_equity', ascending=False)
                .limit(15)
                .get_scanner_data(cookies=self.cookies)
            )

            self.display_table(df, "Quality Growth Stocks")

            console.print("\n[bold yellow]💡 Investment Strategy:[/bold yellow]")
            console.print("• Entry: On market corrections or pullbacks")
            console.print("• Stop Loss: Not applicable (buy more on dips)")
            console.print("• Target: Long-term wealth creation")
            console.print("• Time Frame: Hold 3-5 years minimum")

        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")

    def invest_dividend_aristocrats(self):
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
            console.print("• Stop Loss: Only on fundamental deterioration")
            console.print("• Target: Consistent dividend income + growth")
            console.print("• Time Frame: Hold for decades")

        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")

    def invest_undervalued_gems(self):
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
            console.print("• Stop Loss: On business deterioration")
            console.print("• Target: Fair value realization")
            console.print("• Time Frame: Patient holding 2-5 years")

        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")

    def research_sector_leaders(self):
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

    def research_market_sentiment(self):
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

    def research_earnings_calendar(self):
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

    def research_sector_performance(self):
        console.print(Panel.fit("🏢 RESEARCH: Sector Performance Analysis", style="bold green"))

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
                    col('sector') != ''
                )
                .order_by('market_cap_basic', ascending=False)
                .limit(100)
                .get_scanner_data(cookies=self.cookies)
            )

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

                self._display_sector_table(sector_stats, "Sector Performance Analysis")

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

    def research_sector_stocks(self, sector_name=None, limit=20):
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
                    col('sector') != ''
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

                console.print("\n[bold yellow]💡 Sector Analysis Tips:[/bold yellow]")
                console.print("• Compare stocks within the same sector")
                console.print("• Look for sector leaders vs laggards")
                console.print("• Monitor sector-specific catalysts")
                console.print("• Track relative performance trends")
            else:
                console.print(f"[red]No stocks found for sector: {sector_name}[/red]")

        except Exception as e:
            console.print(f"[red]Error: {e}[/red]")

    def wait_until_market_open(self):
        target_time = datetime.now().replace(hour=9, minute=15, second=0, microsecond=0)
        current_time = datetime.now()

        if current_time >= target_time:
            console.print("[green]✅ Market open time reached - starting active monitoring[/green]")
            return

        wait_seconds = (target_time - current_time).total_seconds()
        wait_minutes = int(wait_seconds // 60)
        wait_secs = int(wait_seconds % 60)

        console.print(f"[yellow]⏰ Waiting until time to start active monitoring...[/yellow]")
        console.print(f"[blue]Current time: {current_time.strftime('%H:%M:%S')}[/blue]")
        console.print(f"[blue]Target time: 9:15:00[/blue]")
        console.print(f"[yellow]Time remaining: {wait_minutes}m {wait_secs}s[/yellow]")
        console.print()

        while datetime.now() < target_time:
            remaining = (target_time - datetime.now()).total_seconds()
            if remaining <= 0:
                break

            mins = int(remaining // 60)
            secs = int(remaining % 60)

            if int(remaining) % 30 == 0:
                os.system('clear' if os.name == 'posix' else 'cls')
                console.print("[bold yellow]⏰ WAITING FOR MARKET OPEN[/bold yellow]")
                console.print(f"[dim]Current time: {datetime.now().strftime('%H:%M:%S')}[/dim]")
                console.print(f"[blue]🕘 {mins}m {secs}s until active monitoring starts (9:20 AM)[/blue]")
                console.print("[dim]Press Ctrl+C to stop[/dim]")

            time_module.sleep(1)

        os.system('clear' if os.name == 'posix' else 'cls')
        console.print("[green]🚀 9:20 AM reached - starting active monitoring mode![/green]")
        time_module.sleep(2)

    def intraday_watch_mode(self, refresh_interval=30, volume_threshold=2.0, price_threshold=3.0):
        console.print(Panel.fit("📊 INTRADAY WATCH MODE - Live Market Monitoring", style="bold red"))

        console.print(f"[yellow]⚙️  Configuration:[/yellow]")
        console.print(f"• Refresh interval: {refresh_interval} seconds")
        console.print(f"• Volume threshold: {volume_threshold}x normal volume")
        console.print(f"• Price change threshold: {price_threshold}%")
        console.print(f"• Paper trading: {'🟢 ENABLED (₹20,000 per trade)' if self.paper_trading_enabled else '🔴 DISABLED'}")
        if self.paper_trading_enabled:
            console.print(f"• Live risk management: 🟢 ENABLED (2% SL | 4% TP | 1.5% TSL | 2sec checks)")
        console.print(f"• Trade journal: 📝 {self.journal_file}")
        console.print(f"• Trend analysis: 🎯 ENABLED (15-day lookback | SELL in bearish trends)")
        console.print(f"• Press Ctrl+C to stop monitoring")
        console.print()

        self.wait_until_market_open()

        previous_data = pd.DataFrame()
        alert_count = 0

        self._start_time = datetime.now()
        self.start_background_monitoring()

        try:
            while True:
                start_time = time_module.time()

                os.system('clear' if os.name == 'posix' else 'cls')

                current_time = datetime.now().strftime("%H:%M:%S")
                console.print(f"[bold blue]📊 INTRADAY WATCH MODE - {current_time}[/bold blue]")
                console.print(f"[dim]Refresh: {refresh_interval}s | Vol: {volume_threshold}x | Price: {price_threshold}%[/dim]")
                console.print()

                current_data = self._get_watch_data()

                if not current_data.empty:
                    alerts = self._detect_alerts(current_data, previous_data, volume_threshold, price_threshold)

                    if alerts:
                        alert_count += len(alerts)
                        console.print(f"[bold red]🚨 ALERTS ({len(alerts)} new, {alert_count} total)[/bold red]")
                        self._display_alerts(alerts)
                        console.print()

                    self._display_watch_data(current_data, alerts)
                    self._display_performance_metrics()

                    previous_data = current_data.copy()
                else:
                    console.print("[red]❌ No data received - checking connection...[/red]")

                elapsed = time_module.time() - start_time
                sleep_time = max(0, refresh_interval - elapsed)

                if sleep_time > 0:
                    console.print(f"[dim]Next refresh in {sleep_time:.1f}s... (Ctrl+C to stop)[/dim]")
                    time_module.sleep(sleep_time)

        except KeyboardInterrupt:
            console.print("\n[yellow]👋 Watch mode stopped by user[/yellow]")
            console.print(f"[green]Total alerts generated: {alert_count}[/green]")

            end_time = datetime.now()
            if hasattr(self, '_start_time'):
                duration = end_time - self._start_time
                hours, remainder = divmod(duration.total_seconds(), 3600)
                minutes, seconds = divmod(remainder, 60)
                console.print(f"[blue]Execution time: {int(hours)}h:{int(minutes):02d}m:{int(seconds):02d}s[/blue]")
        finally:
            self.stop_background_monitoring()

    def _get_watch_data(self):
        try:
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                       'RSI', 'Volatility.D', 'market_cap_basic', 'update_mode')
                .set_markets(self.market)
                .where(
                    col('close') > 50,
                    col('volume') > 500000,
                    col('market_cap_basic') > 1e9,
                    col('relative_volume_10d_calc') > 0.5,
                    col('exchange') == 'NSE'
                )
                .order_by('relative_volume_10d_calc', ascending=False)
                .limit(25)
                .get_scanner_data(cookies=self.cookies)
            )

            df['volatility_pct'] = df['Volatility.D'] * 100
            df['market_cap_cr'] = df['market_cap_basic'] / 1e7

            return df

        except Exception as e:
            console.print(f"[red]Error fetching watch data: {e}[/red]")
            return pd.DataFrame()

    def _detect_alerts(self, current_data, previous_data, volume_threshold, price_threshold):
        alerts = []

        if previous_data.empty:
            return alerts

        for _, row in current_data.iterrows():
            ticker = row['name']

            if row['relative_volume_10d_calc'] > volume_threshold:
                prev_vol = previous_data[previous_data['name'] == ticker]['relative_volume_10d_calc'].values
                if len(prev_vol) > 0 and row['relative_volume_10d_calc'] > prev_vol[0] * 1.2:
                    alerts.append({
                        'type': 'VOLUME_SPIKE',
                        'ticker': ticker,
                        'name': row['name'],
                        'current_volume_ratio': row['relative_volume_10d_calc'],
                        'previous_volume_ratio': prev_vol[0] if len(prev_vol) > 0 else 0,
                        'price': row['close'],
                        'change': row['change']
                    })

            if abs(row['change']) > price_threshold:
                prev_change = previous_data[previous_data['name'] == ticker]['change'].values
                if len(prev_change) > 0 and abs(row['change']) > abs(prev_change[0]) * 1.1:
                    alerts.append({
                        'type': 'PRICE_MOVE',
                        'ticker': ticker,
                        'name': row['name'],
                        'current_change': row['change'],
                        'previous_change': prev_change[0] if len(prev_change) > 0 else 0,
                        'price': row['close'],
                        'volume_ratio': row['relative_volume_10d_calc']
                    })

        return alerts
