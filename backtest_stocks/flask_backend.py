import pandas as pd
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
import yfinance as yf
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

app = Flask(__name__)
CORS(app)

# Timeframe mappings for yfinance
TIMEFRAME_DIRS = {
    '1d': '1d', '2h': '2h', '45m': '45m', '15m': '15m', 
    '5m': '5m', '1w': '1wk', '1M': '1mo'
}

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

@app.route('/api/backtest', methods=['POST'])
def backtest():
    try:
        data = request.json
        symbol = data.get('symbol', 'RELIANCE.NS')
        strategy = data.get('strategy', 'golden_cross')
        timeframe = data.get('timeframe', '1d')
        days = data.get('days', 730)
        
        # Strategy-specific parameters
        if strategy == 'golden_cross':
            short_ma = data.get('short_ma', 50)
            long_ma = data.get('long_ma', 200)
            volume_threshold = data.get('volume_threshold', 1.2)
        else:  # engulfing
            momentum_candles = data.get('momentum_candles', 3)
            min_momentum_pct = data.get('min_momentum_pct', 0.5)
            engulf_ratio = data.get('engulf_ratio', 1.1)
        
        # Fetch data
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        
        ticker = yf.Ticker(symbol)
        df = ticker.history(start=start_date, end=end_date, interval=TIMEFRAME_DIRS[timeframe])
        
        if df.empty:
            return jsonify({'error': f'No data found for {symbol}'}), 400
        
        # Clean data
        df = df.dropna()
        df = df[df['Volume'] > 0]
        
        if len(df) < 50:
            return jsonify({'error': f'Insufficient data: only {len(df)} records'}), 400
        
        # Calculate signals based on strategy
        if strategy == 'golden_cross':
            signals, positions = calculate_golden_cross_signals(df, short_ma, long_ma, volume_threshold)
        else:
            signals, positions = calculate_engulfing_signals(df, momentum_candles, min_momentum_pct, engulf_ratio)
        
        # Calculate performance metrics
        total_trades = len(positions)
        winning_trades = len([p for p in positions if p['pnl_pct'] > 0])
        win_rate = (winning_trades / total_trades * 100) if total_trades > 0 else 0
        total_return = sum([p['pnl_pct'] for p in positions])
        avg_return = total_return / total_trades if total_trades > 0 else 0
        
        # Prepare chart data
        chart_data = []
        for idx, row in df.iterrows():
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
                    'data_points': len(df)
                },
                'meta': {
                    'symbol': symbol,
                    'strategy': strategy,
                    'timeframe': timeframe,
                    'days': days,
                    'period': f"{start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}",
                    'parameters': data
                }
            }
        }
        
        return jsonify(response)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'healthy', 'timestamp': datetime.now().isoformat()})

if __name__ == '__main__':
    print("🚀 Starting Flask Stock Backtesting API...")
    print("📊 Available strategies: Golden Cross, Engulfing")
    print("🌐 Server running on http://localhost:8000")
    app.run(debug=True, port=8000) 