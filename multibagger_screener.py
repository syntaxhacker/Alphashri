import yfinance as yf
import pandas as pd
import requests
import numpy as np
from datetime import datetime, timedelta
import time
import logging
import sys
import os
import traceback
from urllib.parse import urlparse
import io

def setup_logging():
    """Setup logging with single log file that clears on startup"""
    if not os.path.exists('logs'):
        os.makedirs('logs')
    
    log_filename = 'logs/multibagger_screening.log'
    
    # Clear existing log file
    with open(log_filename, 'w') as f:
        f.write('')
    
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - [%(filename)s:%(lineno)d] - %(message)s',
        handlers=[
            logging.FileHandler(log_filename),
            logging.StreamHandler(sys.stdout)
        ]
    )
    return log_filename

class MultibaggerFinder:
    def __init__(self):
        self.failed_stocks = []
        self.processed_count = 0
        self.start_time = time.time()

    def get_historical_data(self, symbol, period="2y"):
        """Get historical price data for analysis"""
        try:
            stock = yf.Ticker(f"{symbol}.NS")
            hist = stock.history(period=period)
            return hist if not hist.empty else None
        except Exception as e:
            logging.error(f"Error fetching historical data for {symbol}: {str(e)}")
            return None

    def get_quarterly_growth(self, symbol):
        """Calculate quarterly revenue growth"""
        try:
            stock = yf.Ticker(f"{symbol}.NS")
            quarterly = stock.quarterly_financials
            if quarterly.empty:
                return 0
            
            if 'Total Revenue' in quarterly.index:
                recent_quarters = quarterly.columns[:4]
                latest_revenue = quarterly.loc['Total Revenue', recent_quarters[0]]
                year_ago_revenue = quarterly.loc['Total Revenue', recent_quarters[-1]]
                growth = ((latest_revenue / year_ago_revenue) - 1) * 100
                return growth
            return 0
        except:
            return 0

    def calculate_momentum_signals(self, hist_data):
        """Calculate momentum and technical indicators"""
        if hist_data is None or len(hist_data) < 200:
            return None
        
        try:
            current_price = hist_data['Close'][-1]
            
            # Calculate moving averages
            sma_50 = hist_data['Close'].rolling(window=50).mean().iloc[-1]
            sma_200 = hist_data['Close'].rolling(window=200).mean().iloc[-1]
            
            # Calculate returns
            returns_6m = ((current_price / hist_data['Close'][-126]) - 1) * 100 if len(hist_data) >= 126 else 0
            returns_1y = ((current_price / hist_data['Close'][-252]) - 1) * 100 if len(hist_data) >= 252 else 0
            
            # Volume analysis
            recent_volume = hist_data['Volume'][-20:].mean()
            avg_volume = hist_data['Volume'].mean()
            volume_trend = ((recent_volume / avg_volume) - 1) * 100
            
            return {
                'above_50ma': current_price > sma_50,
                'above_200ma': current_price > sma_200,
                'returns_6m': returns_6m,
                'returns_1y': returns_1y,
                'volume_trend': volume_trend
            }
        except Exception as e:
            logging.error(f"Error calculating momentum signals: {str(e)}")
            return None

    def get_fundamental_metrics(self, symbol):
        """Get fundamental metrics for analysis"""
        try:
            stock = yf.Ticker(f"{symbol}.NS")
            info = stock.info
            
            return {
                'market_cap': info.get('marketCap', 0),
                'profit_margin': info.get('profitMargins', 0) * 100 if info.get('profitMargins') else 0,
                'roe': info.get('returnOnEquity', 0) * 100 if info.get('returnOnEquity') else 0,
                'debt_to_equity': info.get('debtToEquity', 0),
                'current_ratio': info.get('currentRatio', 0),
                'price_to_book': info.get('priceToBook', 0),
                'beta': info.get('beta', 0)
            }
        except Exception as e:
            logging.error(f"Error fetching fundamental metrics for {symbol}: {str(e)}")
            return None

    def is_potential_multibagger(self, symbol):
        """Check if a stock has multibagger potential"""
        try:
            # Get all required data
            hist_data = self.get_historical_data(symbol)
            momentum = self.calculate_momentum_signals(hist_data)
            fundamentals = self.get_fundamental_metrics(symbol)
            revenue_growth = self.get_quarterly_growth(symbol)
            
            if not all([momentum, fundamentals]):
                return False, None
            
            # Define criteria
            criteria_met = []
            
            # Size criteria (₹100 Cr to ₹10000 Cr)
            if 1000000000 <= fundamentals['market_cap'] <= 100000000000:
                criteria_met.append('Optimal Market Cap')
            
            # Profitability
            if fundamentals['profit_margin'] > 10:
                criteria_met.append('Good Profit Margins')
            
            # Growth
            if revenue_growth > 20:
                criteria_met.append('Strong Revenue Growth')
            
            # Returns
            if fundamentals['roe'] > 15:
                criteria_met.append('High ROE')
            
            # Momentum
            if momentum['above_50ma'] and momentum['above_200ma']:
                criteria_met.append('Strong Price Trend')
            
            if momentum['returns_6m'] > 0 and momentum['returns_1y'] > 0:
                criteria_met.append('Positive Returns')
            
            # Volume
            if momentum['volume_trend'] > 0:
                criteria_met.append('Increasing Volume')
            
            # Financial health
            if 0 < fundamentals['debt_to_equity'] < 1:
                criteria_met.append('Low Debt')
            
            # Combine all metrics
            metrics = {
                'symbol': symbol,
                'market_cap_cr': fundamentals['market_cap']/10000000,
                'profit_margin': fundamentals['profit_margin'],
                'roe': fundamentals['roe'],
                'revenue_growth': revenue_growth,
                'returns_6m': momentum['returns_6m'],
                'returns_1y': momentum['returns_1y'],
                'volume_trend': momentum['volume_trend'],
                'debt_to_equity': fundamentals['debt_to_equity'],
                'criteria_met': ', '.join(criteria_met),
                'criteria_count': len(criteria_met)
            }
            
            # Stock must meet at least 6 criteria to be considered
            return len(criteria_met) >= 6, metrics
            
        except Exception as e:
            logging.error(f"Error analyzing {symbol}: {str(e)}")
            return False, None

    def screen_for_multibaggers(self, symbols):
        """Screen stocks for multibagger potential"""
        potential_multibaggers = []
        total_stocks = len(symbols)
        
        logging.info(f"Starting multibagger screening for {total_stocks} stocks...")
        
        for symbol in symbols:
            self.processed_count += 1
            
            # Log progress every 10 stocks
            if self.processed_count % 10 == 0:
                progress = (self.processed_count / total_stocks) * 100
                elapsed_time = time.time() - self.start_time
                avg_time = elapsed_time / self.processed_count
                remaining_time = (total_stocks - self.processed_count) * avg_time
                
                logging.info(f"Progress: {progress:.1f}% ({self.processed_count}/{total_stocks})")
                logging.info(f"Estimated time remaining: {remaining_time/60:.1f} minutes")
            
            is_potential, metrics = self.is_potential_multibagger(symbol)
            
            if is_potential and metrics:
                logging.info(f"\nPotential Multibagger Found: {symbol}")
                logging.info(f"Market Cap: ₹{metrics['market_cap_cr']:.1f} Cr")
                logging.info(f"Profit Margin: {metrics['profit_margin']:.1f}%")
                logging.info(f"ROE: {metrics['roe']:.1f}%")
                logging.info(f"Revenue Growth: {metrics['revenue_growth']:.1f}%")
                logging.info(f"6-Month Return: {metrics['returns_6m']:.1f}%")
                logging.info(f"Criteria Met: {metrics['criteria_met']}")
                
                potential_multibaggers.append(metrics)
            
            time.sleep(1)  # Rate limiting
        
        return potential_multibaggers

def main():
    try:
        log_file = setup_logging()
        logging.info(f"Starting multibagger screening process. Logs will be saved to: {log_file}")
        
        # Get Nifty 500 symbols (you can modify this to use your existing stock_screener.py)
        from stock_screener import IndianStockScreener
        stock_screener = IndianStockScreener()
        symbols = stock_screener.get_nifty_500_symbols()
        
        if not symbols:
            logging.error("No symbols found to analyze")
            return
        
        # Screen for multibaggers
        finder = MultibaggerFinder()
        results = finder.screen_for_multibaggers(symbols)
        
        if results:
            # Save results to CSV
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"potential_multibaggers_{timestamp}.csv"
            df = pd.DataFrame(results)
            df = df.sort_values('market_cap_cr', ascending=False)
            
            # Round all numeric columns to 2 decimal places
            numeric_columns = df.select_dtypes(include=[np.number]).columns
            df[numeric_columns] = df[numeric_columns].round(2)
            
            df.to_csv(filename, index=False)
            
            logging.info(f"\nScreening Summary:")
            logging.info(f"Total stocks analyzed: {len(symbols)}")
            logging.info(f"Potential multibaggers found: {len(results)}")
            logging.info(f"Results saved to: {filename}")
            
            print("\nTop Potential Multibagger Stocks:")
            print(df.to_string())
        else:
            logging.info("No potential multibagger stocks found")
            
    except Exception as e:
        logging.error(f"An unexpected error occurred: {str(e)}")
        logging.error(traceback.format_exc())
    
    finally:
        logging.info("Multibagger screening completed")

if __name__ == "__main__":
    main() 