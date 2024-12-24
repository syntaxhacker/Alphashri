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
import argparse
from colorama import init, Fore, Back, Style
from dataclasses import dataclass
from typing import Dict, List, Any, Optional, Tuple
from tabulate import tabulate

# Initialize colorama
init(autoreset=True)

class EndpointLogger:
    """Logger for tracking API endpoint calls"""
    def __init__(self):
        self.endpoints = {}
        
    def log_request(self, url: str, success: bool, error: Optional[str] = None) -> None:
        """Log an API request with its result"""
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
                
    def get_summary(self) -> Dict[str, Dict[str, Any]]:
        """Get summary of all endpoint calls"""
        return self.endpoints

@dataclass
class ThresholdConfig:
    """Configuration for metric thresholds and colors"""
    low: float
    high: float
    low_is_good: bool = True  # If True, low values are good (green), if False, high values are good
    
    def get_color(self, value: float) -> str:
        """Get color based on value and thresholds"""
        if np.isnan(value):
            return Fore.WHITE
        
        if self.low_is_good:
            if value < self.low:
                return Fore.GREEN
            elif value > self.high:
                return Fore.RED
            return Fore.YELLOW
        else:
            if value > self.high:
                return Fore.GREEN
            elif value < self.low:
                return Fore.RED
            return Fore.YELLOW

class StockMetrics:
    """Configuration for stock analysis metrics"""
    THRESHOLDS = {
        'pe_ratio': ThresholdConfig(15, 30),
        'pb_ratio': ThresholdConfig(1.5, 4),
        'dividend_yield': ThresholdConfig(1, 3, False),
        'price_to_target_pct': ThresholdConfig(-10, 20, False),
        'distance_from_high_pct': ThresholdConfig(15, 30)
    }
    
    @staticmethod
    def format_metric(metric_name: str, value: float, prefix: str = '', suffix: str = '') -> str:
        """Format a metric with color based on thresholds"""
        if metric_name not in StockMetrics.THRESHOLDS:
            return f"{prefix}{value:.2f}{suffix}"
            
        color = StockMetrics.THRESHOLDS[metric_name].get_color(value)
        return f"{prefix}{color}{value:.2f}{suffix}{Style.RESET_ALL}"
    
    @staticmethod
    def get_recommendation(metrics: Dict[str, float]) -> Tuple[str, List[str]]:
        """Get recommendation and reasons based on metrics"""
        reasons = []
        score = 0
        
        for metric_name, value in metrics.items():
            if metric_name not in StockMetrics.THRESHOLDS or np.isnan(value):
                continue
                
            threshold = StockMetrics.THRESHOLDS[metric_name]
            if threshold.low_is_good:
                if value < threshold.low:
                    score += 1
                    reasons.append(f"{Fore.GREEN}Low {metric_name.replace('_', ' ')} ({value:.2f}){Style.RESET_ALL}")
                elif value > threshold.high:
                    score -= 1
                    reasons.append(f"{Fore.RED}High {metric_name.replace('_', ' ')} ({value:.2f}){Style.RESET_ALL}")
            else:
                if value > threshold.high:
                    score += 1
                    reasons.append(f"{Fore.GREEN}High {metric_name.replace('_', ' ')} ({value:.2f}){Style.RESET_ALL}")
                elif value < threshold.low:
                    score -= 1
                    reasons.append(f"{Fore.RED}Low {metric_name.replace('_', ' ')} ({value:.2f}){Style.RESET_ALL}")
        
        if score >= 2:
            recommendation = f"{Fore.GREEN}BUY{Style.RESET_ALL}"
        elif score <= -2:
            recommendation = f"{Fore.RED}SELL{Style.RESET_ALL}"
        else:
            recommendation = f"{Fore.YELLOW}HOLD{Style.RESET_ALL}"
            
        return recommendation, reasons

class ColorFormatter(logging.Formatter):
    """Custom formatter for colored log output"""
    COLORS = {
        'WARNING': Fore.YELLOW,
        'ERROR': Fore.RED,
        'DEBUG': Fore.BLUE,
        'INFO': Fore.GREEN,
        'CRITICAL': Fore.RED + Back.WHITE
    }

    def format(self, record):
        format_orig = self._style._fmt
        if record.levelname in self.COLORS:
            record.levelname = f"{self.COLORS[record.levelname]}{record.levelname}{Style.RESET_ALL}"
            record.msg = f"{self.COLORS.get(record.levelname, '')}{record.msg}{Style.RESET_ALL}"
        result = logging.Formatter.format(self, record)
        self._style._fmt = format_orig
        return result

class StockAnalyzer:
    """Base class for stock analysis"""
    def __init__(self):
        self.endpoint_logger = EndpointLogger()
        self.failed_stocks = []
        
    def get_stock_data(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Get stock data from API - to be implemented by subclasses"""
        raise NotImplementedError
        
    def analyze_stock(self, symbol: str) -> Dict[str, Any]:
        """Analyze a single stock"""
        try:
            data = self.get_stock_data(symbol)
            if not data:
                raise ValueError(f"No data available for {symbol}")
                
            metrics = {
                'pe_ratio': data.get('trailingPE', float('nan')),
                'pb_ratio': data.get('priceToBook', float('nan')),
                'current_price': data.get('currentPrice', float('nan')),
                'target_price': data.get('targetMeanPrice', float('nan')),
                'dividend_yield': data.get('dividendYield', 0) * 100,
                'price_to_target_pct': float('nan'),
                'distance_from_high_pct': float('nan')
            }
            
            # Calculate derived metrics
            if not np.isnan(metrics['current_price']) and not np.isnan(metrics['target_price']):
                metrics['price_to_target_pct'] = (metrics['target_price'] - metrics['current_price']) / metrics['current_price'] * 100
            
            recommendation, reasons = StockMetrics.get_recommendation(metrics)
            
            return {
                'metrics': metrics,
                'recommendation': recommendation,
                'reasons': reasons
            }
            
        except Exception as e:
            logging.error(f"Error analyzing {symbol}: {str(e)}")
            return {'error': str(e)}

class YahooFinanceAnalyzer(StockAnalyzer):
    """Yahoo Finance specific implementation"""
    def get_stock_data(self, symbol: str) -> Optional[Dict[str, Any]]:
        yahoo_symbol = f"{symbol}.NS" if not symbol.endswith('.NS') else symbol
        logging.info(f"Fetching data for symbol: {Fore.CYAN}{yahoo_symbol}{Style.RESET_ALL}")
        
        stock = yf.Ticker(yahoo_symbol)
        info = stock.info
        
        # Get historical data for 52-week range
        hist = stock.history(period="1y")
        info['52w_high'] = hist['High'].max()
        info['52w_low'] = hist['Low'].min()
        
        return info

def setup_logging():
    """Setup logging configuration"""
    if not os.path.exists('logs'):
        os.makedirs('logs')
    
    log_filename = 'logs/stock_screening.log'
    with open(log_filename, 'w') as f:
        f.write('')
    
    handlers = [
        (logging.FileHandler(log_filename),
         logging.Formatter('%(asctime)s - %(levelname)s - [%(filename)s:%(lineno)d] - %(message)s')),
        (logging.StreamHandler(sys.stdout),
         ColorFormatter('%(asctime)s - %(levelname)s - %(message)s'))
    ]
    
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    
    for handler, formatter in handlers:
        handler.setFormatter(formatter)
        root_logger.addHandler(handler)
    
    return log_filename

def format_table_row(symbol: str, analysis: Dict[str, Any]) -> Dict[str, str]:
    """Format analysis results into a table row"""
    if 'error' in analysis:
        return {
            'Symbol': symbol,
            'Error': analysis['error']
        }
    
    metrics = analysis['metrics']
    return {
        'Symbol': f"{Fore.CYAN}{symbol}{Style.RESET_ALL}",
        'Price': StockMetrics.format_metric('current_price', metrics['current_price'], '₹'),
        'Target': StockMetrics.format_metric('target_price', metrics['target_price'], '₹'),
        'P/T %': StockMetrics.format_metric('price_to_target_pct', metrics['price_to_target_pct'], suffix='%'),
        'P/E': StockMetrics.format_metric('pe_ratio', metrics['pe_ratio']),
        'P/B': StockMetrics.format_metric('pb_ratio', metrics['pb_ratio']),
        'Div %': StockMetrics.format_metric('dividend_yield', metrics['dividend_yield'], suffix='%'),
        'Rec.': analysis['recommendation']
    }

def main():
    try:
        setup_logging()
        logging.info(f"{Fore.CYAN}Stock Screener Starting...{Style.RESET_ALL}")
        logging.info(f"Python Version: {sys.version}")
        logging.info(f"Operating System: {sys.platform}")
        
        parser = argparse.ArgumentParser(description='Stock Market Screener and Analyzer')
        parser.add_argument('--mode', choices=['analyze'], default='analyze',
                          help='Mode of operation (currently only supports analyze)')
        parser.add_argument('--symbols', nargs='+', help='List of stock symbols to analyze')
        args = parser.parse_args()
        
        if not args.symbols:
            logging.error("Please provide stock symbols to analyze using --symbols")
            sys.exit(1)
        
        analyzer = YahooFinanceAnalyzer()
        results = {symbol: analyzer.analyze_stock(symbol) for symbol in args.symbols}
        
        # Format results into table rows
        table_data = [format_table_row(symbol, analysis) for symbol, analysis in results.items()]
        
        # Display results table
        if table_data:
            print(f"\n{Fore.CYAN}Stock Analysis Results:{Style.RESET_ALL}")
            print(tabulate(table_data, headers='keys', tablefmt='pretty', stralign='right'))
            
            # Display detailed reasons for each stock
            print(f"\n{Fore.CYAN}Analysis Details:{Style.RESET_ALL}")
            for symbol, analysis in results.items():
                if 'error' in analysis:
                    continue
                    
                print(f"\n{Fore.CYAN}{symbol} Reasons:{Style.RESET_ALL}")
                for reason in analysis['reasons']:
                    print(f"  • {reason}")
                
    except Exception as e:
        logging.error(f"An error occurred: {str(e)}")
        logging.error(traceback.format_exc())
        sys.exit(1)

if __name__ == "__main__":
    main()