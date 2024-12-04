import yfinance as yf
import pandas as pd
import requests
from bs4 import BeautifulSoup
import numpy as np
from datetime import datetime
import time
import logging
import sys
import os
import traceback
from urllib.parse import urlparse
import io

class EndpointLogger:
    def __init__(self):
        self.endpoints = {}
        
    def log_request(self, url, success, error=None):
        parsed = urlparse(url)
        endpoint = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
        
        if endpoint not in self.endpoints:
            self.endpoints[endpoint] = {'success': 0, 'failures': 0, 'errors': []}
            
        if success:
            self.endpoints[endpoint]['success'] += 1
        else:
            self.endpoints[endpoint]['failures'] += 1
            if error:
                self.endpoints[endpoint]['errors'].append(str(error))
                
    def get_summary(self):
        return self.endpoints

def setup_logging():
    """Setup logging with single log file that clears on startup"""
    if not os.path.exists('logs'):
        os.makedirs('logs')
    
    log_filename = 'logs/stock_screening.log'
    
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

class IndianStockScreener:
    def __init__(self):
        self.nse_base_url = "https://nsearchives.nseindia.com"
        self.nifty500_url = f"{self.nse_base_url}/content/indices/ind_nifty500list.csv"
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive',
        }
        self.start_time = None
        self.processed_count = 0
        self.endpoint_logger = EndpointLogger()
        self.failed_stocks = []
        
    def log_progress(self, total_stocks):
        """Log progress periodically"""
        self.processed_count += 1
        if self.processed_count % 10 == 0:
            elapsed_time = time.time() - self.start_time
            progress = (self.processed_count / total_stocks) * 100
            avg_time_per_stock = elapsed_time / self.processed_count
            estimated_remaining = avg_time_per_stock * (total_stocks - self.processed_count)
            
            logging.info(f"Progress: {progress:.1f}% ({self.processed_count}/{total_stocks} stocks processed)")
            logging.info(f"Average time per stock: {avg_time_per_stock:.2f} seconds")
            logging.info(f"Estimated time remaining: {estimated_remaining/60:.1f} minutes")
            if self.failed_stocks:
                logging.warning(f"Failed stocks so far: {', '.join(self.failed_stocks)}")
    
    def fetch_url_with_retry(self, url, max_retries=3):
        """Fetch URL with retry logic"""
        for attempt in range(max_retries):
            try:
                logging.debug(f"Attempting to fetch URL: {url} (Attempt {attempt + 1}/{max_retries})")
                response = requests.get(url, headers=self.headers, timeout=10)
                response.raise_for_status()
                self.endpoint_logger.log_request(url, True)
                return response
            except requests.exceptions.RequestException as e:
                error_msg = f"Attempt {attempt + 1}/{max_retries} failed: {str(e)}"
                logging.error(error_msg)
                self.endpoint_logger.log_request(url, False, error_msg)
                if attempt == max_retries - 1:
                    raise
                time.sleep(2 ** attempt)  # Exponential backoff
    
    def get_nifty_500_symbols(self):
        """Get list of Nifty 500 companies"""
        logging.info(f"Fetching Nifty 500 symbols from {self.nifty500_url}")
        try:
            response = self.fetch_url_with_retry(self.nifty500_url)
            
            # Read CSV content directly from response
            csv_content = response.content.decode('utf-8')
            df = pd.read_csv(io.StringIO(csv_content))
            
            # Log the first few rows for debugging
            logging.debug("First few rows of Nifty 500 data:")
            logging.debug(df.head().to_string())
            
            symbols = df['Symbol'].tolist()
            
            # Log some basic statistics about the data
            logging.info(f"Successfully fetched {len(symbols)} symbols from Nifty 500")
            logging.info(f"Sample of companies: {', '.join(symbols[:5])}")
            
            # Log industries distribution
            if 'Industry' in df.columns:
                industry_counts = df['Industry'].value_counts()
                logging.info("\nIndustry Distribution:")
                for industry, count in industry_counts.head().items():
                    logging.info(f"{industry}: {count} companies")
            
            return symbols
            
        except Exception as e:
            error_msg = f"Error fetching Nifty 500 symbols: {str(e)}\n{traceback.format_exc()}"
            logging.error(error_msg)
            return []

    def get_stock_fundamentals(self, symbol):
        """Get fundamental data for a given stock"""
        try:
            logging.debug(f"Fetching data for {symbol}")
            stock = yf.Ticker(f"{symbol}.NS")
            
            # Log the API request
            self.endpoint_logger.log_request(f"yahoo_finance_api/{symbol}.NS", True)
            
            info = stock.info
            
            metrics = {
                'symbol': symbol,
                'name': info.get('longName', ''),
                'market_cap': info.get('marketCap', 0),
                'pe_ratio': info.get('trailingPE', 0),
                'pb_ratio': info.get('priceToBook', 0),
                'dividend_yield': info.get('dividendYield', 0) if info.get('dividendYield') else 0,
                'current_price': info.get('currentPrice', 0),
                'sector': info.get('sector', ''),
                'industry': info.get('industry', ''),
                'website': info.get('website', ''),
                'beta': info.get('beta', 0),
            }
            
            # Enhanced logging for successful stock data
            logging.debug(
                f"Metrics for {symbol}:\n"
                f"Name: {metrics['name']}\n"
                f"Price: ₹{metrics['current_price']:,.2f}\n"
                f"P/E: {metrics['pe_ratio']:.2f}\n"
                f"P/B: {metrics['pb_ratio']:.2f}\n"
                f"Yield: {metrics['dividend_yield']*100:.2f}%\n"
                f"Beta: {metrics['beta']:.2f}"
            )
            
            return metrics
            
        except Exception as e:
            error_msg = f"Error fetching data for {symbol}: {str(e)}"
            logging.error(error_msg)
            self.endpoint_logger.log_request(f"yahoo_finance_api/{symbol}.NS", False, error_msg)
            self.failed_stocks.append(symbol)
            return None

    def is_undervalued(self, metrics):
        """Check if a stock is undervalued based on various metrics"""
        if not metrics:
            return False
            
        criteria = {
            'pe_ratio': lambda x: 0 < x < 15,
            'pb_ratio': lambda x: 0 < x < 1.5,
            'dividend_yield': lambda x: x > 0.02,  # Convert from decimal to percentage
        }
        
        met_criteria = sum(1 for key, check in criteria.items() 
                         if check(metrics.get(key, 0)))
        
        if met_criteria >= 2:
            logging.info(
                f"\nFound undervalued stock: {metrics['symbol']} ({metrics['name']})"
                f"\n  Current Price: ₹{metrics['current_price']:,.2f}"
                f"\n  P/E Ratio: {metrics['pe_ratio']:.2f}"
                f"\n  P/B Ratio: {metrics['pb_ratio']:.2f}"
                f"\n  Dividend Yield: {metrics['dividend_yield']*100:.2f}%"
                f"\n  Sector: {metrics['sector']}"
                f"\n  Beta: {metrics['beta']:.2f}"
            )
        
        return met_criteria >= 2

    def analyze_stocks(self, symbols):
        """
        Analyze a list of stock symbols and provide valuation insights
        Args:
            symbols (list): List of stock symbols to analyze
        Returns:
            dict: Dictionary containing analysis results for each stock
        """
        analysis_results = {}
        
        for symbol in symbols:
            try:
                # Get stock data using yfinance
                stock = yf.Ticker(symbol)
                info = stock.info
                
                # Get key metrics
                pe_ratio = info.get('trailingPE', float('nan'))
                pb_ratio = info.get('priceToBook', float('nan'))
                current_price = info.get('currentPrice', float('nan'))
                target_price = info.get('targetMeanPrice', float('nan'))
                dividend_yield = info.get('dividendYield', 0)
                if dividend_yield:
                    dividend_yield = dividend_yield * 100
                
                # Get historical data for 52-week range
                hist = stock.history(period="1y")
                fifty_two_week_high = hist['High'].max()
                fifty_two_week_low = hist['Low'].min()
                
                # Calculate valuation metrics
                price_to_target = (target_price - current_price) / current_price * 100 if target_price and current_price else float('nan')
                distance_from_high = (fifty_two_week_high - current_price) / fifty_two_week_high * 100
                
                # Determine recommendation
                recommendation = "HOLD"
                reasons = []
                
                if not np.isnan(pe_ratio):
                    if pe_ratio < 15:
                        reasons.append("Low P/E ratio")
                    elif pe_ratio > 30:
                        reasons.append("High P/E ratio")
                
                if not np.isnan(pb_ratio):
                    if pb_ratio < 1.5:
                        reasons.append("Low P/B ratio")
                    elif pb_ratio > 4:
                        reasons.append("High P/B ratio")
                
                if not np.isnan(price_to_target):
                    if price_to_target > 20:
                        recommendation = "BUY"
                        reasons.append(f"Price {price_to_target:.1f}% below target")
                    elif price_to_target < -10:
                        recommendation = "SELL"
                        reasons.append(f"Price {abs(price_to_target):.1f}% above target")
                
                if distance_from_high < 10:
                    reasons.append("Near 52-week high")
                elif distance_from_high > 40:
                    reasons.append("Significantly below 52-week high")
                
                analysis_results[symbol] = {
                    'current_price': current_price,
                    'target_price': target_price,
                    'price_to_target_pct': price_to_target,
                    'pe_ratio': pe_ratio,
                    'pb_ratio': pb_ratio,
                    'dividend_yield': dividend_yield,
                    '52w_high': fifty_two_week_high,
                    '52w_low': fifty_two_week_low,
                    'distance_from_high_pct': distance_from_high,
                    'recommendation': recommendation,
                    'reasons': reasons
                }
                
            except Exception as e:
                logging.error(f"Error analyzing {symbol}: {str(e)}")
                analysis_results[symbol] = {'error': str(e)}
        
        return analysis_results

    def screen_stocks(self):
        """Main function to screen stocks"""
        self.start_time = time.time()
        logging.info("Starting stock screening process...")
        logging.info("This process may take some time. Detailed progress will be logged every 10 stocks.")
        
        symbols = self.get_nifty_500_symbols()
        total_stocks = len(symbols)
        undervalued_stocks = []
        self.processed_count = 0
        
        if not symbols:
            logging.error("No symbols found to analyze. Exiting...")
            return pd.DataFrame()
        
        logging.info(f"Beginning analysis of {total_stocks} stocks...")
        
        for symbol in symbols:
            metrics = self.get_stock_fundamentals(symbol)
            
            if metrics and self.is_undervalued(metrics):
                undervalued_stocks.append(metrics)
            
            self.log_progress(total_stocks)
            time.sleep(1)  # Rate limiting
        
        # Create DataFrame and save results
        if undervalued_stocks:
            df = pd.DataFrame(undervalued_stocks)
            df = df.sort_values('market_cap', ascending=False)
            
            # Round all numeric columns to 2 decimal places
            numeric_columns = df.select_dtypes(include=[np.number]).columns
            df[numeric_columns] = df[numeric_columns].round(2)
            
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"undervalued_stocks_{timestamp}.csv"
            df.to_csv(filename, index=False)
            
            total_time = time.time() - self.start_time
            logging.info(f"\nScreening Summary:")
            logging.info(f"Total time: {total_time/60:.1f} minutes")
            logging.info(f"Stocks analyzed: {total_stocks}")
            logging.info(f"Undervalued stocks found: {len(undervalued_stocks)}")
            logging.info(f"Results saved to: {filename}")
            
            # Log endpoint statistics
            logging.info("\nEndpoint Statistics:")
            for endpoint, stats in self.endpoint_logger.get_summary().items():
                logging.info(f"\nEndpoint: {endpoint}")
                logging.info(f"Successful requests: {stats['success']}")
                logging.info(f"Failed requests: {stats['failures']}")
                if stats['errors']:
                    logging.info("Recent errors:")
                    for error in stats['errors'][-5:]:  # Show last 5 errors
                        logging.info(f"  - {error}")
            
            # Log failed stocks summary
            if self.failed_stocks:
                logging.warning(f"\nFailed to process {len(self.failed_stocks)} stocks:")
                logging.warning(", ".join(self.failed_stocks))
            
            return df
        else:
            logging.info("No undervalued stocks found")
            return pd.DataFrame()

def main():
    try:
        # Setup logging
        setup_logging()
        logging.info("Stock Screener Starting...")
        logging.info(f"Python Version: {sys.version}")
        logging.info(f"Operating System: {sys.platform}")
        
        # Parse command line arguments
        import argparse
        parser = argparse.ArgumentParser(description='Indian Stock Market Screener and Analyzer')
        parser.add_argument('--mode', choices=['screen', 'analyze'], default='screen',
                          help='Mode of operation: screen (find undervalued stocks) or analyze (analyze specific stocks)')
        parser.add_argument('--symbols', nargs='+', help='List of stock symbols to analyze (required for analyze mode)')
        args = parser.parse_args()
        
        screener = IndianStockScreener()
        
        if args.mode == 'screen':
            results = screener.screen_stocks()
            if not results.empty:
                logging.info("\nUndervalued Stocks Summary:")
                logging.info(results.to_string())
                
                # Save results to CSV
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                csv_file = f"undervalued_stocks_{timestamp}.csv"
                results.to_csv(csv_file, index=False)
                logging.info(f"\nResults saved to {csv_file}")
            else:
                logging.info("No stocks met the screening criteria.")
                
        elif args.mode == 'analyze':
            if not args.symbols:
                logging.error("Please provide stock symbols to analyze using --symbols")
                sys.exit(1)
            
            results = screener.analyze_stocks(args.symbols)
            logging.info("\nStock Analysis Results:")
            for symbol, analysis in results.items():
                if 'error' in analysis:
                    logging.error(f"\n{symbol}: Error - {analysis['error']}")
                    continue
                    
                logging.info(f"\n{symbol}:")
                logging.info(f"Current Price: ₹{analysis['current_price']:.2f}")
                logging.info(f"Target Price: ₹{analysis['target_price']:.2f}")
                logging.info(f"Price to Target: {analysis['price_to_target_pct']:.1f}%")
                logging.info(f"P/E Ratio: {analysis['pe_ratio']:.2f}")
                logging.info(f"P/B Ratio: {analysis['pb_ratio']:.2f}")
                logging.info(f"Dividend Yield: {analysis['dividend_yield']:.2f}%")
                logging.info(f"52W High: ₹{analysis['52w_high']:.2f}")
                logging.info(f"52W Low: ₹{analysis['52w_low']:.2f}")
                logging.info(f"Distance from High: {analysis['distance_from_high_pct']:.1f}%")
                logging.info(f"Recommendation: {analysis['recommendation']}")
                if analysis['reasons']:
                    logging.info("Reasons:")
                    for reason in analysis['reasons']:
                        logging.info(f"  - {reason}")
                
    except Exception as e:
        logging.error(f"An error occurred: {str(e)}")
        logging.error(traceback.format_exc())
        sys.exit(1)

if __name__ == "__main__":
    main()