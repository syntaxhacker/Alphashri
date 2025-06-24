#!/usr/bin/env python3
"""
🚀 Stock Backtesting API Server
FastAPI backend for the React frontend
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware  
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import pandas as pd
import numpy as np
import asyncio
from datetime import datetime, timedelta
import sys
import os
import glob
import json
import yfinance as yf
import warnings
warnings.filterwarnings('ignore')

# Add parent directory to path for imports
sys.path.append('..')

# NSE data directory and symbols file
NSE_DATA_DIR = "/Users/developer/Documents/NSE-stock-datafeed-main/Datafeed"
NSE_SYMBOLS_FILE = "/Users/developer/Documents/NSE-stock-datafeed-main/nsesymbol.csv"

# Timeframe mapping
TIMEFRAME_DIRS = {
    "1m": "1-minute",
    "5m": "5-minute",
    "15m": "15-minute",
    "45m": "45-minute",
    "2h": "2-hour",
    "1d": "daily",
    "1w": "weekly",
    "1M": "monthly",
    '1d': '1d', '2h': '2h', '45m': '45m', '15m': '15m', 
    '5m': '5m', '1w': '1wk', '1M': '1mo'
}

app = FastAPI(title="Stock Backtesting API", version="1.0.0")

# Enable CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic models
class StockInfo(BaseModel):
    symbol: str
    name: str
    exchange: str
    files: List[str] = []

class BacktestRequest(BaseModel):
    symbol: str
    timeframe: str = "1d"
    days: int = 730
    momentum_candles: int = 3
    min_momentum_pct: float = 0.5
    engulf_ratio: float = 1.1

class BacktestResult(BaseModel):
    """Backtest result model"""
    total_return: float
    win_rate: float
    total_trades: int
    sharpe_ratio: float
    max_drawdown: float
    chart_data: Dict[str, List[Dict[str, Any]]]

def load_nse_symbols() -> Dict[str, Dict[str, str]]:
    """Load NSE symbols from CSV file"""
    try:
        # Get list of available data files
        daily_dir = os.path.join(NSE_DATA_DIR, "daily")
        if not os.path.exists(daily_dir):
            print(f"Error: NSE data directory not found at {daily_dir}")
            return {}
            
        if not os.path.exists(NSE_SYMBOLS_FILE):
            print(f"Error: NSE symbols file not found at {NSE_SYMBOLS_FILE}")
            return {}
            
        # Get list of actual data files
        available_files = [f for f in glob.glob(os.path.join(daily_dir, "*.csv"))
                         if os.path.getsize(f) > 0]  # Skip empty files
        available_symbols = {os.path.splitext(os.path.basename(f))[0] for f in available_files}
        
        print(f"Found {len(available_symbols)} data files in {daily_dir}")
        
        # Read symbols file
        df = pd.read_csv(NSE_SYMBOLS_FILE)
        symbols = {}
        
        for _, row in df.iterrows():
            symbol = row['s'].replace('NSE:', '')
            # Only add symbols that have valid data files
            if symbol in available_symbols:
                name = row['d__010']  # Full company name column
                symbols[f"{symbol}.NS"] = {
                    "name": name,
                    "exchange": "NSE"
                }
                
        print(f"Loaded {len(symbols)} valid NSE symbols with data files")
        return symbols
        
    except Exception as e:
        print(f"Error loading NSE symbols: {e}")
        return {}

# Load NSE symbols
INDIAN_STOCKS = load_nse_symbols()

@app.get("/")
async def root():
    return {
        "message": "🚀 Stock Backtesting API Server",
        "version": "1.0.0",
        "endpoints": {
            "stocks": "/stocks",
            "search": "/stocks/search/{query}",
            "backtest": "/backtest",
            "status": "/status"
        }
    }

@app.get("/stocks", response_model=List[StockInfo])
async def get_available_stocks():
    """Get list of available stocks with file analysis"""
    stocks = []
    
    # Add all NSE stocks that have data files
    for symbol, info in INDIAN_STOCKS.items():
        # Clean symbol for file matching
        stock_code = symbol.split('.')[0]
        
        # Check if data file exists for this symbol
        data_file = os.path.join(NSE_DATA_DIR, "daily", f"{stock_code}.csv")
        if os.path.exists(data_file):
            # Get list of analysis files for this stock
            analysis_files = []
            for file in glob.glob(f"../*{stock_code}*.py"):
                if os.path.basename(file) not in ["backend_api.py", "__init__.py"]:
                    analysis_files.append(os.path.basename(file))
            
            stocks.append(StockInfo(
                symbol=symbol,
                name=info["name"],
                exchange=info["exchange"],
                files=sorted(analysis_files)
            ))
    
    return sorted(stocks, key=lambda x: x.symbol)

@app.get("/stocks/search/{query}")
async def search_stocks(query: str):
    """Search stocks by symbol or name"""
    query_lower = query.lower()
    
    # Search directly in INDIAN_STOCKS dictionary
    filtered = [
        StockInfo(
            symbol=symbol,
            name=info["name"],
            exchange=info["exchange"]
        )
        for symbol, info in INDIAN_STOCKS.items()
        if (query_lower in symbol.lower() or 
            query_lower in info["name"].lower())
    ]
    
    # Sort by relevance (exact matches first)
    filtered.sort(key=lambda x: (
        not x.symbol.lower().startswith(query_lower),
        not x.name.lower().startswith(query_lower),
        x.symbol
    ))
    
    return filtered[:10]

def calculate_golden_cross_signals(df, short_ma=50, long_ma=200, volume_threshold=1.2):
    """
    Golden Cross Strategy:
    - Buy when short MA crosses above long MA with volume confirmation
    - Sell on stop loss (5%), take profit (15%), or death cross
    """
    signals = []
    positions = []
    
    # Calculate moving averages
    df[f'MA_{short_ma}'] = df['Close'].rolling(window=short_ma).mean()
    df[f'MA_{long_ma}'] = df['Close'].rolling(window=long_ma).mean()
    df['Volume_MA'] = df['Volume'].rolling(window=20).mean()
    
    position = None
    entry_price = 0
    entry_date = None
    
    for i in range(long_ma, len(df)):
        current_row = df.iloc[i]
        prev_row = df.iloc[i-1]
        
        date = current_row.name.strftime('%Y-%m-%d')
        price = current_row['Close']
        
        # Check for Golden Cross (entry)
        if (position is None and 
            prev_row[f'MA_{short_ma}'] <= prev_row[f'MA_{long_ma}'] and 
            current_row[f'MA_{short_ma}'] > current_row[f'MA_{long_ma}'] and
            current_row['Volume'] > volume_threshold * current_row['Volume_MA']):
            
            position = 'long'
            entry_price = price
            entry_date = date
            
            signals.append({
                'date': date,
                'type': 'entry',
                'price': price,
                'signal': f'Golden Cross: MA{short_ma} crossed above MA{long_ma}',
                'volume_ratio': round(current_row['Volume'] / current_row['Volume_MA'], 2)
            })
            
        # Check for exit conditions
        elif position == 'long':
            exit_reason = None
            
            # Stop Loss (5%)
            if price <= entry_price * 0.95:
                exit_reason = 'Stop Loss (5%)'
            
            # Take Profit (15%)
            elif price >= entry_price * 1.15:
                exit_reason = 'Take Profit (15%)'
            
            # Death Cross
            elif (prev_row[f'MA_{short_ma}'] >= prev_row[f'MA_{long_ma}'] and 
                  current_row[f'MA_{short_ma}'] < current_row[f'MA_{long_ma}']):
                exit_reason = 'Death Cross'
            
            # Maximum hold period (60 days)
            elif i - df.index.get_loc(pd.to_datetime(entry_date)) >= 60:
                exit_reason = 'Max Hold (60 days)'
            
            if exit_reason:
                pnl_pct = ((price - entry_price) / entry_price) * 100
                
                signals.append({
                    'date': date,
                    'type': 'exit',
                    'price': price,
                    'signal': exit_reason,
                    'pnl_pct': round(pnl_pct, 2)
                })
                
                positions.append({
                    'entry_date': entry_date,
                    'exit_date': date,
                    'entry_price': entry_price,
                    'exit_price': price,
                    'pnl_pct': round(pnl_pct, 2),
                    'exit_reason': exit_reason,
                    'days_held': i - df.index.get_loc(pd.to_datetime(entry_date))
                })
                
                position = None
                entry_price = 0
                entry_date = None
    
    # Handle open position at end
    if position == 'long':
        final_price = df.iloc[-1]['Close']
        final_date = df.index[-1].strftime('%Y-%m-%d')
        pnl_pct = ((final_price - entry_price) / entry_price) * 100
        
        signals.append({
            'date': final_date,
            'type': 'exit',
            'price': final_price,
            'signal': 'End of Data',
            'pnl_pct': round(pnl_pct, 2)
        })
        
        positions.append({
            'entry_date': entry_date,
            'exit_date': final_date,
            'entry_price': entry_price,
            'exit_price': final_price,
            'pnl_pct': round(pnl_pct, 2),
            'exit_reason': 'End of Data',
            'days_held': len(df) - df.index.get_loc(pd.to_datetime(entry_date)) - 1
        })
    
    return signals, positions

def calculate_engulfing_signals(df, momentum_candles=3, min_momentum_pct=0.5, engulf_ratio=1.1):
    """Engulfing Pattern Strategy"""
    signals = []
    positions = []
    
    position = None
    entry_price = 0
    entry_date = None
    
    for i in range(momentum_candles + 1, len(df)):
        current_row = df.iloc[i]
        prev_row = df.iloc[i-1]
        
        date = current_row.name.strftime('%Y-%m-%d')
        price = current_row['Close']
        
        # Check for entry conditions
        if position is None:
            # Check momentum (consecutive red candles)
            momentum_period = df.iloc[i-momentum_candles:i]
            red_candles = (momentum_period['Close'] < momentum_period['Open']).sum()
            
            if red_candles == momentum_candles:
                # Calculate momentum decline percentage
                momentum_start_price = df.iloc[i-momentum_candles]['Open']
                momentum_end_price = df.iloc[i-1]['Close']
                momentum_decline = ((momentum_start_price - momentum_end_price) / momentum_start_price) * 100
                
                if momentum_decline >= min_momentum_pct:
                    # Check for bullish engulfing pattern
                    prev_bearish = prev_row['Close'] < prev_row['Open']
                    current_bullish = current_row['Close'] > current_row['Open']
                    
                    prev_body = abs(prev_row['Close'] - prev_row['Open'])
                    current_body = abs(current_row['Close'] - current_row['Open'])
                    
                    engulfs_body = (current_body / prev_body) >= engulf_ratio if prev_body > 0 else False
                    engulfs_range = (current_row['Open'] <= prev_row['Close'] and 
                                   current_row['Close'] >= prev_row['Open'])
                    
                    if (prev_bearish and current_bullish and engulfs_body and engulfs_range):
                        position = 'long'
                        entry_price = price
                        entry_date = date
                        
                        signals.append({
                            'date': date,
                            'type': 'entry',
                            'price': price,
                            'signal': f'Bullish Engulfing after {momentum_candles} red candles',
                            'momentum_decline': round(momentum_decline, 2),
                            'engulf_ratio': round(current_body / prev_body, 2) if prev_body > 0 else 0
                        })
        
        # Check for exit conditions
        elif position == 'long':
            exit_reason = None
            
            if price <= entry_price * 0.95:
                exit_reason = 'Stop Loss (5%)'
            elif price >= entry_price * 1.10:
                exit_reason = 'Take Profit (10%)'
            elif (prev_row['Close'] > prev_row['Open'] and current_row['Close'] < current_row['Open'] and
                  abs(current_row['Close'] - current_row['Open']) / abs(prev_row['Close'] - prev_row['Open']) >= 1.1):
                exit_reason = 'Bearish Engulfing'
            elif i - df.index.get_loc(pd.to_datetime(entry_date)) >= 20:
                exit_reason = 'Max Hold (20 days)'
            
            if exit_reason:
                pnl_pct = ((price - entry_price) / entry_price) * 100
                
                signals.append({
                    'date': date,
                    'type': 'exit',
                    'price': price,
                    'signal': exit_reason,
                    'pnl_pct': round(pnl_pct, 2)
                })
                
                positions.append({
                    'entry_date': entry_date,
                    'exit_date': date,
                    'entry_price': entry_price,
                    'exit_price': price,
                    'pnl_pct': round(pnl_pct, 2),
                    'exit_reason': exit_reason,
                    'days_held': i - df.index.get_loc(pd.to_datetime(entry_date))
                })
                
                position = None
                entry_price = 0
                entry_date = None
    
    # Handle open position at end
    if position == 'long':
        final_price = df.iloc[-1]['Close']
        final_date = df.index[-1].strftime('%Y-%m-%d')
        pnl_pct = ((final_price - entry_price) / entry_price) * 100
        
        signals.append({
            'date': final_date,
            'type': 'exit',
            'price': final_price,
            'signal': 'End of Data',
            'pnl_pct': round(pnl_pct, 2)
        })
        
        positions.append({
            'entry_date': entry_date,
            'exit_date': final_date,
            'entry_price': entry_price,
            'exit_price': final_price,
            'pnl_pct': round(pnl_pct, 2),
            'exit_reason': 'End of Data',
            'days_held': len(df) - df.index.get_loc(pd.to_datetime(entry_date)) - 1
        })
    
    return signals, positions

@app.post("/backtest", response_model=BacktestResult)
async def run_backtest(request: BacktestRequest):
    """Run backtest simulation"""
    try:
        # Clean symbol for file matching
        symbol = request.symbol.split('.')[0]
        
        # Load data
        data = read_nse_data(symbol, request.timeframe, request.days)
        if data.empty:
            raise HTTPException(status_code=404, detail=f"No data found for {symbol}")
            
        # Run simulation
        strategy = 'golden_cross' if request.momentum_candles == 0 else 'engulfing'
        if strategy == 'golden_cross':
            signals, positions = calculate_golden_cross_signals(data)
        else:
            signals, positions = calculate_engulfing_signals(data)
        
        # Calculate performance metrics
        total_trades = len(positions)
        winning_trades = len([p for p in positions if p['pnl_pct'] > 0])
        win_rate = (winning_trades / total_trades * 100) if total_trades > 0 else 0
        total_return = sum([p['pnl_pct'] for p in positions])
        avg_return = total_return / total_trades if total_trades > 0 else 0
        
        # Prepare chart data
        chart_data = []
        for idx, row in data.iterrows():
            chart_data.append([
                idx.strftime('%Y-%m-%d'),
                float(row['Open']),
                float(row['Close']),
                float(row['Low']),
                float(row['High']),
                int(row['Volume'])
            ])
        
        # Response
        response = {
            'success': True,
            'data': {
                'chart_data': chart_data,
                'signals': signals,
                'trades': positions,
                'metrics': {
                    'total_trades': total_trades,
                    'winning_trades': winning_trades,
                    'win_rate': round(win_rate, 2),
                    'total_return': round(total_return, 2),
                    'avg_return': round(avg_return, 2),
                    'data_points': len(data)
                },
                'meta': {
                    'symbol': symbol,
                    'strategy': strategy,
                    'timeframe': request.timeframe,
                    'days': request.days,
                    'period': f"{data.index.min()} to {data.index.max()}",
                    'parameters': {
                        'momentum_candles': request.momentum_candles,
                        'min_momentum_pct': request.min_momentum_pct,
                        'engulf_ratio': request.engulf_ratio
                    }
                }
            }
        }
        
        return BacktestResult(**response['data']['metrics'])
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/status")
async def get_status():
    """Get API status and health check"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "available_stocks": len(INDIAN_STOCKS),
        "features": [
            "Stock search",
            "Engulfing strategy analysis", 
            "Chart data generation",
            "Performance metrics"
        ]
    }

def read_nse_data(symbol: str, timeframe: str = "1d", days: int = 30) -> pd.DataFrame:
    """Read NSE stock data from CSV files"""
    try:
        # Clean symbol name
        stock_code = symbol.replace('.NS', '')
        
        # Get data file path
        data_file = os.path.join(NSE_DATA_DIR, TIMEFRAME_DIRS.get(timeframe, "daily"), f"{stock_code}.csv")
        
        if not os.path.exists(data_file):
            print(f"Error: Data file not found at {data_file}")
            return pd.DataFrame()
            
        # Read the CSV file
        df = pd.read_csv(data_file)
        
        # Validate data
        required_columns = ['datetime', 'symbol', 'open', 'high', 'low', 'close', 'volume']
        if not all(col in df.columns for col in required_columns):
            print(f"Error: Missing required columns in {data_file}")
            print(f"Expected: {required_columns}")
            print(f"Found: {df.columns.tolist()}")
            return pd.DataFrame()
            
        # Convert datetime column
        df['datetime'] = pd.to_datetime(df['datetime'])
        
        # Sort by date and get last N days
        df = df.sort_values('datetime', ascending=True)
        if days > 0:
            df = df.tail(days)
            
        # Set datetime as index
        df.set_index('datetime', inplace=True)
        
        # Drop symbol column as it's not needed
        df = df.drop('symbol', axis=1)
        
        # Ensure we have some data
        if df.empty:
            print(f"Error: No data found in {data_file}")
            return df
            
        print(f"Successfully loaded {len(df)} rows from {data_file}")
        print(f"Date range: {df.index.min()} to {df.index.max()}")
        
        return df
        
    except Exception as e:
        print(f"Error reading NSE data: {e}")
        return pd.DataFrame()

if __name__ == "__main__":
    import uvicorn
    print("🚀 Starting Stock Backtesting API Server...")
    print("📊 Available endpoints:")
    print("   GET  /stocks - List available stocks")
    print("   GET  /stocks/search/{query} - Search stocks")
    print("   POST /backtest - Run strategy analysis")
    print("   GET  /status - Server health check")
    print()
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True) 