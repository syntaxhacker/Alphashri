import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime
import time
import logging
import sys
import os
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass
from colorama import init, Fore, Back, Style
from tabulate import tabulate
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TimeElapsedColumn
from rich.table import Table
import ta
import pandas_ta as pta

# Initialize colorama and rich console
init(autoreset=True)
console = Console()

@dataclass
class ScreeningCriteria:
    """Screening criteria configuration"""
    pe_ratio_max: float = 15.0
    pb_ratio_max: float = 1.5
    dividend_yield_min: float = 2.0
    market_cap_min_cr: float = 100  # in crores
    market_cap_max_cr: float = 10000
    roe_min: float = 15.0
    profit_margin_min: float = 10.0
    revenue_growth_min: float = 20.0
    debt_to_equity_max: float = 1.0

class IntegratedScreener:
    def __init__(self, criteria: Optional[ScreeningCriteria] = None):
        self.criteria = criteria or ScreeningCriteria()
        self.failed_stocks = []
        
    def get_stock_data(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Get comprehensive stock data including fundamentals and technicals"""
        try:
            yahoo_symbol = f"{symbol}.NS" if not symbol.endswith('.NS') else symbol
            stock = yf.Ticker(yahoo_symbol)
            info = stock.info
            
            # Get historical data for technical analysis
            hist = stock.history(period="2y")
            if hist.empty:
                return None
                
            # Calculate technical indicators
            hist['SMA50'] = hist['Close'].rolling(window=50).mean()
            hist['SMA200'] = hist['Close'].rolling(window=200).mean()
            
            # Add momentum indicators
            hist['RSI'] = ta.momentum.rsi(hist['Close'])
            hist['MACD'] = ta.trend.macd_diff(hist['Close'])
            
            # Calculate returns
            current_price = hist['Close'].iloc[-1]
            returns_6m = ((current_price / hist['Close'].iloc[-126]) - 1) * 100 if len(hist) >= 126 else 0
            returns_1y = ((current_price / hist['Close'].iloc[-252]) - 1) * 100 if len(hist) >= 252 else 0
            
            # Get quarterly financials
            quarterly = stock.quarterly_financials
            revenue_growth = 0
            if not quarterly.empty and 'Total Revenue' in quarterly.index:
                recent_quarters = quarterly.columns[:4]
                latest_revenue = quarterly.loc['Total Revenue', recent_quarters[0]]
                year_ago_revenue = quarterly.loc['Total Revenue', recent_quarters[-1]]
                revenue_growth = ((latest_revenue / year_ago_revenue) - 1) * 100
            
            return {
                'symbol': symbol,
                'name': info.get('longName', ''),
                'sector': info.get('sector', ''),
                'industry': info.get('industry', ''),
                'market_cap': info.get('marketCap', 0),
                'current_price': info.get('currentPrice', 0),
                'target_price': info.get('targetMeanPrice', 0),
                'pe_ratio': info.get('trailingPE', float('nan')),
                'pb_ratio': info.get('priceToBook', float('nan')),
                'dividend_yield': info.get('dividendYield', 0) * 100,
                'profit_margin': info.get('profitMargins', 0) * 100,
                'roe': info.get('returnOnEquity', 0) * 100,
                'debt_to_equity': info.get('debtToEquity', 0),
                'revenue_growth': revenue_growth,
                'returns_6m': returns_6m,
                'returns_1y': returns_1y,
                'rsi': hist['RSI'].iloc[-1],
                'macd': hist['MACD'].iloc[-1],
                'above_50ma': current_price > hist['SMA50'].iloc[-1],
                'above_200ma': current_price > hist['SMA200'].iloc[-1]
            }
            
        except Exception as e:
            logging.error(f"Error fetching data for {symbol}: {str(e)}")
            self.failed_stocks.append(symbol)
            return None
    
    def analyze_stock(self, data: Dict[str, Any]) -> Tuple[List[str], List[str]]:
        """Analyze stock data and return strengths and weaknesses"""
        strengths = []
        weaknesses = []
        
        # Valuation metrics
        if data['pe_ratio'] < self.criteria.pe_ratio_max:
            strengths.append(f"Low P/E ratio ({data['pe_ratio']:.1f})")
        elif not np.isnan(data['pe_ratio']):
            weaknesses.append(f"High P/E ratio ({data['pe_ratio']:.1f})")
            
        if data['pb_ratio'] < self.criteria.pb_ratio_max:
            strengths.append(f"Low P/B ratio ({data['pb_ratio']:.1f})")
        elif not np.isnan(data['pb_ratio']):
            weaknesses.append(f"High P/B ratio ({data['pb_ratio']:.1f})")
            
        # Growth and profitability
        if data['revenue_growth'] > self.criteria.revenue_growth_min:
            strengths.append(f"Strong revenue growth ({data['revenue_growth']:.1f}%)")
        else:
            weaknesses.append(f"Weak revenue growth ({data['revenue_growth']:.1f}%)")
            
        if data['roe'] > self.criteria.roe_min:
            strengths.append(f"High ROE ({data['roe']:.1f}%)")
        else:
            weaknesses.append(f"Low ROE ({data['roe']:.1f}%)")
            
        # Technical indicators
        if data['above_50ma'] and data['above_200ma']:
            strengths.append("Strong uptrend (Above 50 & 200 MA)")
        elif not data['above_50ma'] and not data['above_200ma']:
            weaknesses.append("Weak trend (Below 50 & 200 MA)")
            
        if 30 <= data['rsi'] <= 70:
            strengths.append(f"Healthy RSI ({data['rsi']:.1f})")
        elif data['rsi'] > 70:
            weaknesses.append(f"Overbought RSI ({data['rsi']:.1f})")
        else:
            weaknesses.append(f"Oversold RSI ({data['rsi']:.1f})")
            
        return strengths, weaknesses
    
    def is_undervalued(self, data: Dict[str, Any]) -> bool:
        """Check if stock is undervalued"""
        criteria_met = 0
        total_criteria = 3
        
        if data['pe_ratio'] < self.criteria.pe_ratio_max:
            criteria_met += 1
        if data['pb_ratio'] < self.criteria.pb_ratio_max:
            criteria_met += 1
        if data['dividend_yield'] > self.criteria.dividend_yield_min:
            criteria_met += 1
            
        return criteria_met >= 2
    
    def is_potential_multibagger(self, data: Dict[str, Any]) -> bool:
        """Check if stock has multibagger potential"""
        criteria_met = 0
        total_criteria = 6
        
        market_cap_cr = data['market_cap'] / 10000000  # Convert to crores
        if self.criteria.market_cap_min_cr <= market_cap_cr <= self.criteria.market_cap_max_cr:
            criteria_met += 1
        if data['profit_margin'] > self.criteria.profit_margin_min:
            criteria_met += 1
        if data['revenue_growth'] > self.criteria.revenue_growth_min:
            criteria_met += 1
        if data['roe'] > self.criteria.roe_min:
            criteria_met += 1
        if data['above_50ma'] and data['above_200ma']:
            criteria_met += 1
        if data['debt_to_equity'] < self.criteria.debt_to_equity_max:
            criteria_met += 1
            
        return criteria_met >= 4
    
    def format_table_row(self, data: Dict[str, Any]) -> Dict[str, str]:
        """Format stock data for table display"""
        market_cap_cr = data['market_cap'] / 10000000
        
        return {
            'Symbol': f"{Fore.CYAN}{data['symbol']}{Style.RESET_ALL}",
            'Price': f"₹{data['current_price']:.1f}",
            'M.Cap(Cr)': f"₹{market_cap_cr:.1f}",
            'P/E': f"{data['pe_ratio']:.1f}",
            'P/B': f"{data['pb_ratio']:.1f}",
            'ROE%': f"{data['roe']:.1f}",
            'Growth%': f"{data['revenue_growth']:.1f}",
            'Type': self.get_stock_type(data)
        }
    
    def get_stock_type(self, data: Dict[str, Any]) -> str:
        """Determine stock type based on analysis"""
        is_uv = self.is_undervalued(data)
        is_mb = self.is_potential_multibagger(data)
        
        if is_uv and is_mb:
            return f"{Fore.GREEN}UV+MB{Style.RESET_ALL}"
        elif is_uv:
            return f"{Fore.YELLOW}UV{Style.RESET_ALL}"
        elif is_mb:
            return f"{Fore.BLUE}MB{Style.RESET_ALL}"
        return f"{Fore.WHITE}--{Style.RESET_ALL}"
    
    def screen_stocks(self, symbols: List[str]) -> pd.DataFrame:
        """Screen stocks and return analysis results"""
        results = []
        
        with Progress(
            SpinnerColumn(),
            *Progress.get_default_columns(),
            TimeElapsedColumn(),
            console=console
        ) as progress:
            task = progress.add_task("[cyan]Screening stocks...", total=len(symbols))
            
            for symbol in symbols:
                data = self.get_stock_data(symbol)
                if data:
                    strengths, weaknesses = self.analyze_stock(data)
                    data['strengths'] = strengths
                    data['weaknesses'] = weaknesses
                    results.append(data)
                progress.update(task, advance=1)
        
        if not results:
            return pd.DataFrame()
        
        df = pd.DataFrame(results)
        return df.sort_values('market_cap', ascending=False)

def main():
    try:
        console.print("[cyan]Integrated Stock Screener Starting...[/cyan]")
        
        # Get symbols (you'll need to implement this)
        symbols = ["TATAMOTORS", "RELIANCE", "INFY"]  # Example symbols
        
        # Initialize screener with custom criteria if needed
        screener = IntegratedScreener(ScreeningCriteria(
            pe_ratio_max=20.0,  # More relaxed PE ratio
            pb_ratio_max=3.0,   # More relaxed PB ratio
            market_cap_min_cr=500  # Minimum market cap 500cr
        ))
        
        # Screen stocks
        results_df = screener.screen_stocks(symbols)
        
        if not results_df.empty:
            # Format results for display
            table_data = [screener.format_table_row(row) for _, row in results_df.iterrows()]
            
            # Display results table
            print(f"\n{Fore.CYAN}Stock Screening Results:{Style.RESET_ALL}")
            print(tabulate(table_data, headers='keys', tablefmt='pretty', stralign='right'))
            
            # Display detailed analysis
            print(f"\n{Fore.CYAN}Detailed Analysis:{Style.RESET_ALL}")
            for _, row in results_df.iterrows():
                print(f"\n{Fore.CYAN}{row['symbol']}:{Style.RESET_ALL}")
                print("Strengths:")
                for strength in row['strengths']:
                    print(f"  • {Fore.GREEN}{strength}{Style.RESET_ALL}")
                print("Weaknesses:")
                for weakness in row['weaknesses']:
                    print(f"  • {Fore.RED}{weakness}{Style.RESET_ALL}")
            
            # Save results
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"stock_analysis_{timestamp}.csv"
            results_df.to_csv(filename, index=False)
            print(f"\n{Fore.GREEN}Results saved to: {filename}{Style.RESET_ALL}")
            
        else:
            print(f"{Fore.YELLOW}No stocks found matching criteria.{Style.RESET_ALL}")
            
    except Exception as e:
        console.print_exception()
        sys.exit(1)

if __name__ == "__main__":
    main() 