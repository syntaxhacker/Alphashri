"""
Investment Strategy Module
==========================

This module contains functions for long-term investment strategies.
"""

from rich.panel import Panel
from rich.console import Console
from tradingview_screener import Query, col

console = Console()

def invest_quality_growth(self) -> None:
    """Find quality growth stocks for long-term investment"""
    console.print(Panel.fit("📈 QUALITY GROWTH: Long-term Compounders", style="bold green"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'market_cap_basic', 'update_mode',
                'earnings_per_share', 'price_earnings_ttm', 'dividend_yield_recent',
                'return_on_equity', 'debt_to_equity', 'revenue_growth_5y'
            )
            .set_markets(self.market)
            .where(
                col('close') > 100,  # Higher price quality companies
                col('market_cap_basic') > 5000000000,  # 500 Cr minimum market cap
                col('price_earnings_ttm').between(10, 30),  # Reasonable PE
                col('return_on_equity') > 15,  # Strong ROE
                col('debt_to_equity') < 1,  # Manageable debt
                col('revenue_growth_5y') > 10,  # Strong revenue growth
                col('dividend_yield_recent') > 0.5  # Some dividend yield
            )
            .orderby(col('return_on_equity'), ascending=False)
            .limit(25)
            .get()
        )
        
        if not df.empty:
            # Add quality score
            df['quality_score'] = (
                df['return_on_equity'] * 0.3 + 
                df['revenue_growth_5y'] * 0.3 + 
                (20 - df['price_earnings_ttm']) * 2 +  # Lower PE is better
                df['dividend_yield_recent'] * 5
            )
            
            # Sort by quality score
            df = df.sort_values('quality_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "📈 QUALITY GROWTH Stocks")
            else:
                console.print("[green]Found quality growth stocks:[/green]")
                console.print(df[['name', 'close', 'price_earnings_ttm', 'return_on_equity', 'revenue_growth_5y', 'quality_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching quality growth criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in quality growth analysis: {e}[/red]")

def invest_dividend_aristocrats(self) -> None:
    """Find dividend aristocrat stocks"""
    console.print(Panel.fit("💰 DIVIDEND ARISTOCRATS: Income Generators", style="bold yellow"))
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'market_cap_basic', 'update_mode',
                'dividend_yield_recent', 'dividend_yield_5y_avg', 
                'dividend_paid_years', 'dividend_growth_rate_annual'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,  # Minimum price
                col('market_cap_basic') > 2000000000,  # 200 Cr minimum market cap
                col('dividend_yield_recent') > 1.0,  # Decent yield
                col('dividend_paid_years') > 5,  # Consistent dividend payer
                col('dividend_growth_rate_annual') > 2  # Growing dividends
            )
            .orderby(col('dividend_yield_recent'), ascending=False)
            .limit(25)
            .get()
        )
        
        if not df.empty:
            # Add dividend quality score
            df['dividend_score'] = (
                df['dividend_yield_recent'] * 3 + 
                df['dividend_paid_years'] * 0.5 + 
                df['dividend_growth_rate_annual'] * 2
            )
            
            # Sort by dividend quality score
            df = df.sort_values('dividend_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "💰 DIVIDEND ARISTOCRATS")
            else:
                console.print("[green]Found dividend aristocrats:[/green]")
                console.print(df[['name', 'close', 'dividend_yield_recent', 'dividend_paid_years', 'dividend_growth_rate_annual', 'dividend_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching dividend aristocrat criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in dividend aristocrat analysis: {e}[/red]")