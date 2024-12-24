from tradingview_screener import Query
from rich.console import Console
from rich.table import Table
from datetime import datetime
import pandas as pd

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
                    'price_earnings_ttm'  # Only keeping P/E ratio for now
                )
                .where(
                    {'left': 'market_cap_basic', 'operation': 'in_range', 'right': [5e9, 5e11]},  # Market cap between ₹500 Cr to ₹50,000 Cr
                    {'left': 'price_earnings_ttm', 'operation': 'less', 'right': 15}  # P/E ratio less than 15
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
                    'change'  # Only keeping basic change for now
                )
                .where(
                    {'left': 'market_cap_basic', 'operation': 'in_range', 'right': [1e9, 1e11]},  # Market cap between ₹100 Cr to ₹10,000 Cr
                    {'left': 'volume', 'operation': 'greater', 'right': 100000}  # Minimum volume
                )
                .order_by('market_cap_basic', ascending=False)
                .set_markets('india')
                .limit(50)
                .get_scanner_data(headers=HEADERS, cookies=COOKIES)
            )
            
            console.print("[green]Successfully fetched multibagger stocks[/green]")
            return df
            
        except Exception as e:
            console.print(f"[red]Error in get_multibagger_stocks: {str(e)}[/red]")
            return pd.DataFrame()  # Return empty DataFrame on error
    
    def display_results(self, df: pd.DataFrame, title: str):
        """Display results in a rich table"""
        if df.empty:
            console.print(f"\n[yellow]No stocks found matching {title} criteria[/yellow]")
            return
            
        table = Table(title=title, show_header=True, header_style="bold cyan")
        
        # Add columns
        for col in df.columns:
            table.add_column(col)
        
        # Add rows
        for _, row in df.iterrows():
            formatted_row = []
            for val in row:
                if isinstance(val, float):
                    formatted_row.append(f"{val:,.2f}")
                else:
                    formatted_row.append(str(val))
            table.add_row(*formatted_row)
        
        console.print(table)
        
        # Save to CSV
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{title.lower().replace(' ', '_')}_{timestamp}.csv"
        df.to_csv(filename, index=False)
        console.print(f"\n[green]Results saved to: {filename}[/green]")

def main():
    try:
        console.print("[cyan]TradingView Stock Screener Starting...[/cyan]")
        
        screener = TVScreener()
        
        # First test the connection
        if not screener.test_connection():
            console.print("[red]Exiting due to API connection failure[/red]")
            return
            
        # Screen for undervalued stocks
        console.print("\n[yellow]Screening for Undervalued Stocks...[/yellow]")
        undervalued_df = screener.get_undervalued_stocks()
        screener.display_results(undervalued_df, "Undervalued Stocks")
        
        # Screen for multibagger potential
        console.print("\n[yellow]Screening for Potential Multibaggers...[/yellow]")
        multibagger_df = screener.get_multibagger_stocks()
        screener.display_results(multibagger_df, "Potential Multibagger Stocks")
        
    except Exception as e:
        console.print_exception()

if __name__ == "__main__":
    main() 