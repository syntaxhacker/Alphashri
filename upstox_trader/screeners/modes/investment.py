"""
Investment Strategy Module
============================

This module contains various long-term investment strategies.
"""

from rich.panel import Panel
from rich.console import Console
from tradingview_screener import Query, col

console = Console()

def invest_quality_growth(self):
    """Find quality growth stocks for long-term investment"""
    console.print(Panel.fit("📈 QUALITY GROWTH: Fundamental Compounders", style="bold bright_green"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'market_cap_basic', 'update_mode', 'Perf.Y', 'Perf.3Y', 'EPS.this.Y', 'EPS.next.Y', 'P/E', 'PEG', 'Dividend_yield'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,  # Minimum price
                col('volume') > 100000,  # Decent liquidity
                col('market_cap_basic') > 1000000000,  # 100 Cr minimum market cap
                col('Perf.Y') > 15,  # Annual performance > 15%
                col('Perf.3Y') > 10,  # 3-year performance > 10%
                col('EPS.this.Y') > 10,  # EPS growth > 10%
                col('P/E').between(10, 30),  # Reasonable P/E ratio
                col('PEG').between(0.5, 1.5),  # Reasonable PEG ratio
                col('exchange') == 'NSE'
            )
            .order_by('Perf.3Y', ascending=False)
            .limit(25)
            .get_scanner_data(cookies=self.cookies)
        )
        
        if not df.empty:
            # Add growth quality score
            df['growth_score'] = (
                df['Perf.Y'] * 0.3 +  # Annual performance weight
                df['Perf.3Y'] * 0.4 +  # 3-year performance weight
                df['EPS.this.Y'] * 0.2 +  # EPS growth weight
                (40 - abs(df['P/E'] - 20)) * 0.1  # P/E around 20 is ideal
            )
            
            # Sort by growth quality
            df = df.sort_values('growth_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "📈 QUALITY GROWTH Candidates")
            else:
                console.print("[green]Found quality growth candidates:[/green]")
                console.print(df[['name', 'close', 'Perf.Y', 'Perf.3Y', 'EPS.this.Y', 'P/E', 'PEG', 'growth_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching quality growth criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in quality growth analysis: {e}[/red]")

def invest_dividend_aristocrats(self):
    """Find dividend aristocrat stocks with consistent dividend growth"""
    console.print(Panel.fit("💰 DIVIDEND ARISTOCRATS: Income Compounders", style="bold yellow"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'market_cap_basic', 'update_mode', 'Dividend_yield', 'Dividend_paid', 'Payout_ratio', 'EPS.this.Y', 'P/E'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,  # Minimum price
                col('volume') > 50000,  # Basic liquidity
                col('market_cap_basic') > 500000000,  # 50 Cr minimum market cap
                col('Dividend_yield') > 2,  # Minimum 2% dividend yield
                col('Dividend_paid') > 5,  # Dividend paid for > 5 years
                col('Payout_ratio').between(20, 60),  # Sustainable payout ratio
                col('EPS.this.Y') > 5,  # EPS growth > 5%
                col('exchange') == 'NSE'
            )
            .order_by('Dividend_yield', ascending=False)
            .limit(25)
            .get_scanner_data(cookies=self.cookies)
        )
        
        if not df.empty:
            # Add dividend quality score
            df['dividend_score'] = (
                df['Dividend_yield'] * 0.4 +  # Yield weight
                df['Dividend_paid'] * 0.2 +  # Dividend consistency weight
                (60 - df['Payout_ratio']) * 0.2 +  # Lower payout ratio is better
                df['EPS.this.Y'] * 0.2  # EPS growth weight
            )
            
            # Sort by dividend quality
            df = df.sort_values('dividend_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "💰 DIVIDEND ARISTOCRATS Candidates")
            else:
                console.print("[green]Found dividend aristocrat candidates:[/green]")
                console.print(df[['name', 'close', 'Dividend_yield', 'Dividend_paid', 'Payout_ratio', 'EPS.this.Y', 'dividend_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching dividend aristocrat criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in dividend aristocrat analysis: {e}[/red]")

def invest_undervalued_gems(self):
    """Find undervalued stocks with strong fundamentals"""
    console.print(Panel.fit("💎 UNDVALUED GEMS: Value Opportunities", style="bold bright_cyan"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'market_cap_basic', 'update_mode', 'P/E', 'P/B', 'P/S', 'PEG', 'EPS.this.Y', 'ROE', 'Debt/Equity'
            )
            .set_markets(self.market)
            .where(
                col('close') > 30,  # Minimum price
                col('volume') > 100000,  # Decent liquidity
                col('market_cap_basic') > 200000000,  # 20 Cr minimum market cap
                col('P/E').between(5, 20),  # Low P/E ratio
                col('P/B').between(0.5, 3),  # Low P/B ratio
                col('EPS.this.Y') > 5,  # EPS growth > 5%
                col('ROE') > 10,  # ROE > 10%
                col('Debt/Equity') < 0.5,  # Low debt-to-equity
                col('exchange') == 'NSE'
            )
            .order_by('P/E', ascending=True)
            .limit(25)
            .get_scanner_data(cookies=self.cookies)
        )
        
        if not df.empty:
            # Add value score
            df['value_score'] = (
                (30 - df['P/E']) * 0.3 +  # Lower P/E is better
                (5 - df['P/B']) * 0.2 +  # Lower P/B is better
                (25 - df['P/S']) * 0.2 +  # Lower P/S is better
                df['EPS.this.Y'] * 0.15 +  # EPS growth
                df['ROE'] * 0.1 +  # ROE
                (50 - df['Debt/Equity'] * 100) * 0.05  # Lower debt is better
            )
            
            # Sort by value score
            df = df.sort_values('value_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "💎 UNDVALUED GEMS Candidates")
            else:
                console.print("[green]Found undervalued gem candidates:[/green]")
                console.print(df[['name', 'close', 'P/E', 'P/B', 'P/S', 'EPS.this.Y', 'ROE', 'value_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching undervalued gem criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in undervalued gem analysis: {e}[/red]")