"""
Research Strategy Module
==========================

This module contains various research and analysis functions.
"""

from rich.panel import Panel
from rich.console import Console
from tradingview_screener import Query, col

console = Console()

def research_sector_leaders(self):
    """Find sector leaders for analysis"""
    console.print(Panel.fit("🏆 SECTOR LEADERS: Industry Champions", style="bold bright_blue"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'market_cap_basic', 'update_mode', 'Perf.W', 'Perf.3M', 'Perf.6M', 'Perf.Y', 'sector'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,  # Minimum price
                col('volume') > 200000,  # Decent volume
                col('market_cap_basic') > 500000000,  # 50 Cr minimum market cap
                col('Perf.W') > 5,  # Weekly outperformance
                col('Perf.3M') > 10,  # 3-month outperformance
                col('exchange') == 'NSE'
            )
            .order_by('Perf.W', ascending=False)
            .limit(25)
            .get_scanner_data(cookies=self.cookies)
        )
        
        if not df.empty:
            # Add leadership score
            df['leadership_score'] = (
                df['Perf.W'] * 3 +  # Weekly performance weight
                df['Perf.3M'] * 2 +  # 3-month performance weight
                df['Perf.6M'] +  # 6-month performance weight
                df['Perf.Y'] * 0.5 +  # Yearly performance weight
                df['relative_volume_10d_calc'] * 2  # Volume confirmation
            )
            
            # Sort by leadership score
            df = df.sort_values('leadership_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "🏆 SECTOR LEADERS")
            else:
                console.print("[green]Found sector leaders:[/green]")
                console.print(df[['name', 'close', 'Perf.W', 'Perf.3M', 'Perf.6M', 'leadership_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching sector leader criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in sector leader analysis: {e}[/red]")

def research_market_sentiment(self):
    """Analyze market sentiment"""
    console.print(Panel.fit("📊 MARKET SENTIMENT: Breadth & Rotation Analysis", style="bold magenta"))
    try:
        # This would typically integrate with broader market data
        # For now, we'll show a simplified version based on advance/decline data
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'market_cap_basic', 'update_mode', 'Perf.W', 'Perf.3M'
            )
            .set_markets(self.market)
            .where(
                col('close') > 30,  # Minimum price
                col('volume') > 100000,  # Decent volume
                col('market_cap_basic') > 100000000,  # 10 Cr minimum market cap
                col('Perf.W').abs() > 2,  # Significant weekly moves
                col('exchange') == 'NSE'
            )
            .order_by('change', ascending=False)
            .limit(50)  # Larger sample for sentiment analysis
            .get_scanner_data(cookies=self.cookies)
        )
        
        if not df.empty:
            # Calculate sentiment indicators
            advancing = len(df[df['change'] > 0])
            declining = len(df[df['change'] < 0])
            unchanged = len(df[df['change'] == 0])
            total = len(df)
            
            # Sentiment ratios
            advance_decline_ratio = advancing / declining if declining > 0 else float('inf')
            advance_decline_line = advancing - declining
            breadth_percentage = (advancing / total) * 100 if total > 0 else 0
            
            # Display sentiment summary
            console.print(f"[bold cyan]Market Sentiment Summary:[/bold cyan]")
            console.print(f"  Advancing: {advancing} | Declining: {declining} | Unchanged: {unchanged}")
            console.print(f"  A/D Ratio: {advance_decline_ratio:.2f} | A/D Line: {advance_decline_line:+d}")
            console.print(f"  Breadth: {breadth_percentage:.1f}%")
            
            # Add sentiment score
            df['sentiment_score'] = (
                df['change'] * 10 +  # Price change contribution
                df['Perf.W'] * 2 +  # Weekly performance
                df['relative_volume_10d_calc'] * 5  # Volume confirmation
            )
            
            # Sort by sentiment score
            df = df.sort_values('sentiment_score', ascending=False)
            
            # Display top advancers and decliners
            console.print(f"\n[bold green]📈 TOP ADVANCERS:[/bold green]")
            if hasattr(self, 'display_table'):
                self.display_table(df.head(10), "Top Advancers")
            else:
                console.print(df[['name', 'close', 'change', 'Perf.W', 'sentiment_score']].head(10).to_string())
                
            console.print(f"\n[bold red]📉 TOP DECLINERS:[/bold red]")
            if hasattr(self, 'display_table'):
                self.display_table(df.tail(10), "Top Decliners")
            else:
                console.print(df[['name', 'close', 'change', 'Perf.W', 'sentiment_score']].tail(10).to_string())
        else:
            console.print("[yellow]No stocks found for market sentiment analysis[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in market sentiment analysis: {e}[/red]")

def research_earnings_calendar(self):
    """Analyze earnings calendar impact"""
    console.print(Panel.fit("📅 EARNINGS CALENDAR: Event-Driven Analysis", style="bold yellow"))
    try:
        # This would typically integrate with earnings calendar data
        # For now, we'll show a simplified version based on volume and price action
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'market_cap_basic', 'update_mode', 'Perf.W'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,  # Minimum price
                col('volume') > 1000000,  # Very high volume (suggests earnings)
                col('market_cap_basic') > 1000000000,  # 100 Cr minimum market cap
                col('relative_volume_10d_calc') > 2.0,  # Significant volume surge
                col('change').abs() > 5,  # Significant move
                col('exchange') == 'NSE'
            )
            .order_by('relative_volume_10d_calc', ascending=False)
            .limit(25)
            .get_scanner_data(cookies=self.cookies)
        )
        
        if not df.empty:
            # Add earnings impact score
            df['earnings_score'] = (
                df['relative_volume_10d_calc'] * 10 +  # Volume surge importance
                df['change'].abs() * 2 +  # Price move significance
                df['volume'] / 1000000 +  # Absolute volume
                df['Perf.W'].abs()  # Weekly performance impact
            )
            
            # Sort by earnings impact score
            df = df.sort_values('earnings_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "📅 EARNINGS CALENDAR Impact")
            else:
                console.print("[green]Found potential earnings impact candidates:[/green]")
                console.print(df[['name', 'close', 'change', 'volume', 'relative_volume_10d_calc', 'earnings_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching earnings calendar criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in earnings calendar analysis: {e}[/red]")

def research_sector_performance(self):
    """Analyze sector performance"""
    console.print(Panel.fit("🏭 SECTOR PERFORMANCE: Industry Group Analysis", style="bold bright_yellow"))
    try:
        # This would typically integrate with sector data
        # For now, we'll show a simplified version
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'market_cap_basic', 'update_mode', 'Perf.W', 'Perf.3M', 'Perf.6M', 'sector'
            )
            .set_markets(self.market)
            .where(
                col('close') > 30,  # Minimum price
                col('volume') > 100000,  # Decent volume
                col('market_cap_basic') > 100000000,  # 10 Cr minimum market cap
                col('Perf.W').abs() > 3,  # Significant weekly moves
                col('exchange') == 'NSE'
            )
            .order_by('Perf.W', ascending=False)
            .limit(50)
            .get_scanner_data(cookies=self.cookies)
        )
        
        if not df.empty:
            # Group by sector and calculate performance
            sector_performance = df.groupby('sector').agg({
                'Perf.W': 'mean',
                'Perf.3M': 'mean',
                'Perf.6M': 'mean',
                'change': 'mean',
                'volume': 'sum',
                'relative_volume_10d_calc': 'mean'
            }).round(2)
            
            # Add sector strength score
            sector_performance['sector_score'] = (
                sector_performance['Perf.W'] * 3 +
                sector_performance['Perf.3M'] * 2 +
                sector_performance['Perf.6M'] +
                sector_performance['change'] * 2 +
                sector_performance['relative_volume_10d_calc']
            )
            
            # Sort by sector strength
            sector_performance = sector_performance.sort_values('sector_score', ascending=False)
            
            # Display sector performance
            console.print("[bold cyan]Sector Performance Rankings:[/bold cyan]")
            console.print(sector_performance[['Perf.W', 'Perf.3M', 'Perf.6M', 'sector_score']].head(10).to_string())
            
            # Display top performing stocks by sector
            console.print(f"\n[bold green]Top Performing Stocks by Sector:[/bold green]")
            for sector in sector_performance.head(5).index:
                sector_stocks = df[df['sector'] == sector].sort_values('Perf.W', ascending=False)
                console.print(f"\n[bold]{sector}[/bold] (Score: {sector_performance.loc[sector, 'sector_score']:.1f}):")
                console.print(sector_stocks[['name', 'close', 'Perf.W', 'Perf.3M']].head(3).to_string(index=False))
        else:
            console.print("[yellow]No stocks found for sector performance analysis[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in sector performance analysis: {e}[/red]")

def research_sector_stocks(self, sector_name=None, limit=20):
    """Find stocks in specific sectors"""
    console.print(Panel.fit(f"🏭 SECTOR STOCKS: {sector_name or 'All Sectors'} Analysis", style="bold bright_yellow"))
    try:
        # Build query with sector filter if specified
        query = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'market_cap_basic', 'update_mode', 'Perf.W', 'Perf.3M', 'sector'
            )
            .set_markets(self.market)
            .where(
                col('close') > 30,  # Minimum price
                col('volume') > 50000,  # Minimum volume
                col('market_cap_basic') > 50000000,  # 5 Cr minimum market cap
                col('exchange') == 'NSE'
            )
            .order_by('Perf.W', ascending=False)
            .limit(limit * 2)  # Get more to filter later
        )
        
        # Add sector filter if specified
        if sector_name:
            query = query.where(col('sector').str.contains(sector_name, case=False))
        
        total_rows, df = query.get_scanner_data(cookies=self.cookies)
        
        if not df.empty:
            # Add sector strength score
            df['sector_strength'] = (
                df['Perf.W'] * 3 +  # Weekly performance weight
                df['Perf.3M'] * 2 +  # 3-month performance weight
                df['change'] * 2 +  # Daily change weight
                df['relative_volume_10d_calc']  # Volume confirmation
            )
            
            # Sort by sector strength
            df = df.sort_values('sector_strength', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(limit), f"🏭 {sector_name or 'All Sectors'} Stocks")
            else:
                console.print(f"[green]Found {len(df.head(limit))} stocks in {sector_name or 'all sectors'}:[/green]")
                console.print(df[['name', 'close', 'change', 'Perf.W', 'Perf.3M', 'sector_strength']].head(limit).to_string())
        else:
            console.print(f"[yellow]No stocks found in {sector_name or 'specified sectors'}[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in sector stocks analysis: {e}[/red]")