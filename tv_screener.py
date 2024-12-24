from tradingview_screener import Query
from rich.console import Console
from rich.table import Table
from datetime import datetime
import pandas as pd
import argparse

console = Console()

# TradingView headers from your browser
HEADERS = {
    'authority': 'scanner.tradingview.com',
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'accept-encoding': 'gzip, deflate, br, zstd',
    'accept-language': 'en-US,en;q=0.9,te;q=0.8',
    'cache-control': 'no-cache',
    'dnt': '1',
    'pragma': 'no-cache',
    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
}

# TradingView cookies from your browser
COOKIES = {
    'cookiePrivacyPreferenceBannerProduction': 'notApplicable',
    'cookiesSettings': '{"analytics":true,"advertising":true}',
    'device_t': 'NnVGSkFROjA.RWMlOQqXeLpM4RrG0aIqJKgDFjOS_MKHhzau4s7XDdg',
    'sessionid': '98trlrspuzm3rs8bck9jf5fnlikb391p',
    'sessionid_sign': 'v3:Zu/xnZDuILf9B5cwMZtx4QIa1fPqSlZLNT9fFHcVr6o=',
    'tv_ecuid': 'ad96aa2f-9741-4c1c-adfc-e3441279ba4c',
    'ext_name': 'ojplmecpdpgccookcobabopnaifgidhf',
    '_sp_ses.cf1a': '*',
    '_sp_id.cf1a': '370ff04e-e2ac-4777-86bd-7197e5666124.1731561180.38.1735034367.1735024955.e053ab11-b7bd-41c0-87e4-2155705be7fd.77df16ff-d68a-4a78-b411-2d8642328a88.2f9f1c3e-8c9f-4e14-af49-306c5667233c.1735034330497.9'
}

class TVScreener:
    def __init__(self):
        self.query = Query()
        
    def test_connection(self):
        """Simple test to verify API connection"""
        try:
            console.print("[yellow]Testing API connection...[/yellow]")
            total_rows, df = (
                self.query
                .select(
                    'name',
                    'close',
                    'volume',
                    'market_cap_basic'
                )
                .set_markets('india')
                .limit(5)
                .get_scanner_data(headers=HEADERS, cookies=COOKIES)
            )
            
            console.print("[green]API connection successful![/green]")
            console.print(f"Total rows available: {total_rows}")
            self.display_results(df, "Test Results")
            return True
            
        except Exception as e:
            console.print("[red]API connection failed![/red]")
            console.print_exception()
            return False
    
    def get_undervalued_stocks(self):
        """Screen for undervalued stocks with good fundamentals"""
        try:
            total_rows, df = (
                self.query
                .select(
                    'name',
                    'close',
                    'volume',
                    'market_cap_basic',
                    'price_earnings_ttm',          # P/E ratio
                    'price_book_fq',               # P/B ratio (MRQ)
                    'dividend_yield_recent',       # Current dividend yield
                    'return_on_equity',            # ROE
                    'debt_to_equity',              # D/E ratio
                    'current_ratio',               # Liquidity
                    'net_margin'                   # Net profit margin
                )
                .where(
                    {'left': 'market_cap_basic', 'operation': 'in_range', 'right': [5e9, 5e11]},     # Market cap between ₹500 Cr to ₹50,000 Cr
                    {'left': 'price_earnings_ttm', 'operation': 'less', 'right': 15},                 # P/E ratio less than 15
                    {'left': 'return_on_equity', 'operation': 'greater', 'right': 15},                # ROE > 15%
                    {'left': 'current_ratio', 'operation': 'greater', 'right': 1.5},                  # Current ratio > 1.5
                    {'left': 'volume', 'operation': 'greater', 'right': 100000}                       # Minimum volume
                )
                .order_by('market_cap_basic', ascending=False)
                .set_markets('india')
                .limit(50)
                .get_scanner_data(headers=HEADERS, cookies=COOKIES)
            )
            
            console.print("[green]Successfully fetched undervalued stocks[/green]")
            return df
            
        except Exception as e:
            console.print(f"[red]Error in get_undervalued_stocks: {str(e)}[/red]")
            return pd.DataFrame()  # Return empty DataFrame on error
    
    def get_multibagger_stocks(self):
        """Screen for potential multibagger stocks"""
        try:
            total_rows, df = (
                self.query
                .select(
                    'name',
                    'close',
                    'volume',
                    'market_cap_basic',
                    'change',                          # Daily change
                    'Recommend.All',                   # Overall recommendation
                    'RSI',                            # RSI(14)
                    'total_revenue_yoy_growth_ttm',    # Revenue growth YoY
                    'earnings_per_share_diluted_yoy_growth_ttm',  # EPS growth
                    'return_on_equity',                # ROE
                    'debt_to_equity'                   # D/E ratio
                )
                .where(
                    {'left': 'market_cap_basic', 'operation': 'in_range', 'right': [1e9, 1e11]},     # Market cap between ₹100 Cr to ₹10,000 Cr
                    {'left': 'RSI', 'operation': 'less', 'right': 60},                               # RSI < 60 (not overbought)
                    {'left': 'total_revenue_yoy_growth_ttm', 'operation': 'greater', 'right': 20},    # Revenue growth > 20%
                    {'left': 'return_on_equity', 'operation': 'greater', 'right': 15},                # ROE > 15%
                    {'left': 'volume', 'operation': 'greater', 'right': 100000}                       # Minimum volume
                )
                .order_by('total_revenue_yoy_growth_ttm', ascending=False)
                .set_markets('india')
                .limit(50)
                .get_scanner_data(headers=HEADERS, cookies=COOKIES)
            )
            
            console.print("[green]Successfully fetched multibagger stocks[/green]")
            return df
            
        except Exception as e:
            console.print(f"[red]Error in get_multibagger_stocks: {str(e)}[/red]")
            return pd.DataFrame()  # Return empty DataFrame on error
    
    def calculate_stock_score(self, row):
        """Calculate a composite score for a stock based on multiple criteria"""
        score = 0
        
        # Valuation Score (0-30 points)
        if 'price_earnings_ttm' in row and row['price_earnings_ttm'] > 0:
            pe_score = max(0, 30 - (row['price_earnings_ttm'] * 1.5))  # Lower P/E is better
            score += pe_score
            
        # Growth Score (0-20 points)
        if 'total_revenue_yoy_growth_ttm' in row:
            growth_score = min(20, row['total_revenue_yoy_growth_ttm'] / 2)  # 2% growth = 1 point
            score += growth_score
            
        # Quality Score (0-30 points)
        if 'return_on_equity' in row:
            roe_score = min(15, row['return_on_equity'] / 2)  # 2% ROE = 1 point
            score += roe_score
            
        if 'net_margin' in row and row['net_margin'] > 0:
            margin_score = min(15, row['net_margin'] / 2)  # 2% margin = 1 point
            score += margin_score
            
        # Technical Score (0-20 points)
        if 'RSI' in row:
            rsi_score = 10 - abs(50 - row['RSI']) / 5  # Closer to 50 is better
            score += max(0, rsi_score)
            
        if 'relative_volume_10d_calc' in row:
            volume_score = min(10, row['relative_volume_10d_calc'])  # Higher relative volume is better
            score += volume_score
            
        return round(score, 2)
    
    def display_results(self, df: pd.DataFrame, title: str):
        """Display results in a rich table with colored values and scores"""
        if df.empty:
            console.print(f"\n[yellow]No stocks found matching {title} criteria[/yellow]")
            return
        
        # Calculate scores for each stock
        df['score'] = df.apply(self.calculate_stock_score, axis=1)
        
        # Sort by score if it exists
        if 'score' in df.columns:
            df = df.sort_values('score', ascending=False)
            
        table = Table(title=title, show_header=True, header_style="bold cyan", border_style="blue")
        
        # Add columns with score first
        if 'score' in df.columns:
            table.add_column("Score", justify="right")
        
        # Add other columns
        for col in df.columns:
            if col != 'score':
                table.add_column(col, justify="right" if col not in ['ticker', 'name'] else "left")
        
        # Add rows with colored values
        for _, row in df.iterrows():
            formatted_row = []
            
            # Format score first if it exists
            if 'score' in row:
                score_val = row['score']
                if score_val >= 80:
                    formatted_row.append(f"[bold green]{score_val:.1f}[/bold green]")
                elif score_val >= 60:
                    formatted_row.append(f"[green]{score_val:.1f}[/green]")
                elif score_val >= 40:
                    formatted_row.append(f"[yellow]{score_val:.1f}[/yellow]")
                else:
                    formatted_row.append(f"[red]{score_val:.1f}[/red]")
            
            # Format other columns
            for col, val in row.items():
                if col == 'score':
                    continue
                    
                if isinstance(val, float):
                    # Format numbers with commas and 2 decimal places
                    formatted_val = f"{val:,.2f}"
                    
                    # Color based on column type
                    if 'change' in col.lower():
                        # Color price changes
                        color = "green" if val > 0 else "red" if val < 0 else "white"
                        formatted_val = f"[{color}]{formatted_val}%[/{color}]"
                    elif 'volume' in col.lower():
                        # Color high volume
                        if val > 1000000:  # More than 1M
                            formatted_val = f"[bold green]{formatted_val}[/bold green]"
                        elif val > 500000:  # More than 500K
                            formatted_val = f"[green]{formatted_val}[/green]"
                    elif 'price_earnings' in col.lower():
                        # Color P/E ratio
                        if val < 10:
                            formatted_val = f"[bold green]{formatted_val}[/bold green]"
                        elif val < 15:
                            formatted_val = f"[green]{formatted_val}[/green]"
                        elif val > 30:
                            formatted_val = f"[red]{formatted_val}[/red]"
                    elif 'market_cap' in col.lower():
                        # Format market cap in billions/crores
                        val_cr = val / 10000000  # Convert to crores
                        if val_cr >= 1000:
                            formatted_val = f"₹{val_cr/100:,.2f}B"  # Convert to billions
                        else:
                            formatted_val = f"₹{val_cr:,.2f}Cr"
                else:
                    formatted_val = str(val)
                    # Color ticker symbols
                    if col == 'ticker':
                        formatted_val = f"[cyan]{formatted_val}[/cyan]"
                    elif col == 'name':
                        formatted_val = f"[yellow]{formatted_val}[/yellow]"
                        
                formatted_row.append(formatted_val)
            
            table.add_row(*formatted_row)
        
        console.print(table)
        
        # Save to CSV
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{title.lower().replace(' ', '_')}_{timestamp}.csv"
        df.to_csv(filename, index=False)
        console.print(f"\n[green]Results saved to: {filename}[/green]")

def parse_args():
    parser = argparse.ArgumentParser(description='TradingView Stock Screener')
    parser.add_argument('--min-market-cap', type=float, default=5e9, help='Minimum market cap in rupees')
    parser.add_argument('--max-market-cap', type=float, default=5e11, help='Maximum market cap in rupees')
    parser.add_argument('--min-pe', type=float, default=0, help='Minimum P/E ratio')
    parser.add_argument('--max-pe', type=float, default=15, help='Maximum P/E ratio')
    parser.add_argument('--min-roe', type=float, default=15, help='Minimum ROE percentage')
    parser.add_argument('--min-volume', type=int, default=100000, help='Minimum trading volume')
    parser.add_argument('--export-format', choices=['csv', 'excel'], default='csv', help='Export format')
    parser.add_argument('--sort-by', default='market_cap_basic', help='Column to sort results by')
    parser.add_argument('--ascending', action='store_true', help='Sort in ascending order')
    return parser.parse_args()

def export_results(df: pd.DataFrame, title: str, format: str = 'csv'):
    """Export results to file"""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    base_filename = f"{title.lower().replace(' ', '_')}_{timestamp}"
    
    if format == 'excel':
        filename = f"{base_filename}.xlsx"
        df.to_excel(filename, index=False, engine='openpyxl')
    else:
        filename = f"{base_filename}.csv"
        df.to_csv(filename, index=False)
    
    console.print(f"\n[green]Results saved to: {filename}[/green]")

def main():
    try:
        console.print("[cyan]TradingView Stock Screener Starting...[/cyan]")
        start_time = datetime.now()
        
        # Parse command line arguments
        args = parse_args()
        
        screener = TVScreener()
        
        # First test the connection
        if not screener.test_connection():
            console.print("[red]Exiting due to API connection failure[/red]")
            return
        
        # Update screening parameters based on args
        screener.min_market_cap = args.min_market_cap
        screener.max_market_cap = args.max_market_cap
        screener.min_pe = args.min_pe
        screener.max_pe = args.max_pe
        screener.min_roe = args.min_roe
        screener.min_volume = args.min_volume
        
        # Screen for undervalued stocks
        console.print("\n[yellow]Screening for Undervalued Stocks...[/yellow]")
        undervalued_df = screener.get_undervalued_stocks()
        screener.display_results(undervalued_df, "Undervalued Stocks")
        export_results(undervalued_df, "Undervalued Stocks", args.export_format)
        
        # Screen for multibagger potential
        console.print("\n[yellow]Screening for Potential Multibaggers...[/yellow]")
        multibagger_df = screener.get_multibagger_stocks()
        screener.display_results(multibagger_df, "Potential Multibagger Stocks")
        export_results(multibagger_df, "Potential Multibagger Stocks", args.export_format)
        
        # Print execution summary
        end_time = datetime.now()
        duration = end_time - start_time
        hours, remainder = divmod(duration.seconds, 3600)
        minutes, seconds = divmod(remainder, 60)
        console.print(f"\n[cyan]Execution time: {hours}h:{minutes:02d}m:{seconds:02d}s[/cyan]")
        
    except Exception as e:
        console.print_exception()

if __name__ == "__main__":
    main() 