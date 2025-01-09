import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
import pandas_ta as ta
from datetime import datetime, timedelta
from binance.client import Client
import logging
from rich.console import Console
from rich.progress import Progress
from rich.table import Table
from pathlib import Path
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import os
import joblib
from concurrent.futures import ThreadPoolExecutor
import platform
from jinja2 import Template
import json

# Initialize Rich console
console = Console()

class MLTrader:
    def __init__(self, symbol="BTCUSDT", initial_balance=10000):
        self.symbol = symbol
        self.initial_balance = initial_balance
        self.model = None
        self.scaler = StandardScaler()
        self.setup_logging()
        self.n_jobs = -1  # Use all CPU cores
        
    def setup_logging(self):
        """Setup logging configuration"""
        if not os.path.exists('logs'):
            os.makedirs('logs')
            
        log_filename = 'logs/ml_trading.log'
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler(log_filename),
                logging.StreamHandler()
            ]
        )
    
    def prepare_features(self, df):
        """Prepare feature set for ML model using parallel processing"""
        try:
            with ThreadPoolExecutor() as executor:
                # Technical indicators
                futures = []
                futures.append(executor.submit(lambda: ta.rsi(df['close'], length=14)))
                futures.append(executor.submit(lambda: ta.macd(df['close'])))
                futures.append(executor.submit(lambda: ta.sma(df['close'], length=20)))
                futures.append(executor.submit(lambda: ta.sma(df['close'], length=50)))
                futures.append(executor.submit(lambda: ta.ema(df['close'], length=12)))
                futures.append(executor.submit(lambda: ta.ema(df['close'], length=26)))
                futures.append(executor.submit(lambda: ta.bbands(df['close'], length=20)))
                
                # Get results
                df['rsi'] = futures[0].result()
                macd = futures[1].result()
                df['macd'] = macd['MACD_12_26_9']
                df['macd_signal'] = macd['MACDs_12_26_9']
                df['macd_hist'] = macd['MACDh_12_26_9']
                df['sma_20'] = futures[2].result()
                df['sma_50'] = futures[3].result()
                df['ema_12'] = futures[4].result()
                df['ema_26'] = futures[5].result()
                bb = futures[6].result()
                df['bb_upper'] = bb['BBU_20_2.0']
                df['bb_middle'] = bb['BBM_20_2.0']
                df['bb_lower'] = bb['BBL_20_2.0']
            
            # Price changes and other features
            df['price_change'] = df['close'].pct_change()
            df['price_change_2'] = df['close'].pct_change(2)
            df['price_change_5'] = df['close'].pct_change(5)
            df['volume_change'] = df['volume'].pct_change()
            df['volume_ma'] = ta.sma(df['volume'], length=20)
            df['volume_std'] = df['volume'].rolling(window=20).std()
            df['atr'] = ta.atr(df['high'], df['low'], df['close'], length=14)
            df['volatility'] = df['close'].rolling(window=20).std()
            df['mom'] = ta.mom(df['close'], length=10)
            df['roc'] = ta.roc(df['close'], length=10)
            
            # Create target variable (1 for price increase, 0 for decrease)
            df['target'] = (df['close'].shift(-1) > df['close']).astype(int)
            
            # Drop NaN values
            df.dropna(inplace=True)
            
            return df
        except Exception as e:
            console.print(f"[red]Error preparing features: {str(e)}[/red]")
            logging.error(f"Error preparing features: {str(e)}")
            raise
    
    def create_features(self, df):
        """Create feature matrix X and target vector y"""
        try:
            self.feature_columns = [
                'rsi', 'macd', 'macd_signal', 'macd_hist',
                'sma_20', 'sma_50', 'ema_12', 'ema_26',
                'bb_upper', 'bb_middle', 'bb_lower',
                'price_change', 'price_change_2', 'price_change_5',
                'volume_change', 'volume_ma', 'volume_std',
                'atr', 'volatility', 'mom', 'roc'
            ]
            
            X = df[self.feature_columns].values
            y = df['target'].values
            
            # Scale features
            X = self.scaler.fit_transform(X)
            
            return X, y
        except Exception as e:
            console.print(f"[red]Error creating features: {str(e)}[/red]")
            logging.error(f"Error creating features: {str(e)}")
            raise
    
    def train_model(self, df):
        """Train the ML model"""
        try:
            console.print("[cyan]Preparing features...[/cyan]")
            df = self.prepare_features(df)
            
            console.print("[cyan]Creating feature matrix...[/cyan]")
            X, y = self.create_features(df)
            
            # Split data and store for later use
            self.X_train, self.X_test, self.y_train, self.y_test = train_test_split(
                X, y, test_size=0.2, shuffle=False
            )
            
            console.print("[cyan]Training Random Forest model...[/cyan]")
            self.model = RandomForestClassifier(
                n_estimators=100,
                max_depth=10,
                min_samples_split=10,
                min_samples_leaf=5,
                random_state=42,
                n_jobs=self.n_jobs,
                verbose=1
            )
            
            self.model.fit(self.X_train, self.y_train)
            
            # Calculate accuracy
            train_accuracy = self.model.score(self.X_train, self.y_train)
            test_accuracy = self.model.score(self.X_test, self.y_test)
            
            console.print(f"[green]Training accuracy: {train_accuracy:.2%}[/green]")
            console.print(f"[green]Testing accuracy: {test_accuracy:.2%}[/green]")
            
            # Save the model
            model_dir = Path('models')
            model_dir.mkdir(exist_ok=True)
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            model_file = model_dir / f'rf_model_{self.symbol}_{timestamp}.joblib'
            joblib.dump(self.model, model_file)
            console.print(f"[green]Model saved to: {model_file}[/green]")
            
            return test_accuracy
        except Exception as e:
            console.print(f"[red]Error training model: {str(e)}[/red]")
            logging.error(f"Error training model: {str(e)}")
            raise
    
    def backtest(self, df, stop_loss=0.02, take_profit=0.04):
        """Backtest the ML model"""
        try:
            if self.model is None:
                console.print("[red]Model not trained! Please train the model first.[/red]")
                return None
            
            # Prepare features
            df = self.prepare_features(df.copy())
            X, _ = self.create_features(df)
            
            # Get predictions
            predictions = self.model.predict(X)
            probabilities = self.model.predict_proba(X)
            
            # Initialize tracking variables
            balance = self.initial_balance
            position = False
            entry_price = 0
            trades = []
            
            # Run backtest
            for i in range(len(df)-1):
                current_price = df['close'].iloc[i]
                next_price = df['close'].iloc[i+1]
                
                if not position:
                    # Check for buy signal (high probability of price increase)
                    if predictions[i] == 1 and probabilities[i][1] > 0.7:
                        position = True
                        entry_price = current_price
                        position_size = balance * 0.95  # Use 95% of balance
                        units = position_size / current_price
                        
                        trades.append({
                            'timestamp': df.index[i],
                            'action': 'BUY',
                            'price': current_price,
                            'units': units,
                            'balance': balance,
                            'confidence': float(probabilities[i][1])
                        })
                
                elif position:
                    # Calculate returns
                    returns = (current_price - entry_price) / entry_price
                    
                    # Check exit conditions
                    exit_signal = False
                    exit_reason = None
                    
                    # Stop loss
                    if returns <= -stop_loss:
                        exit_signal = True
                        exit_reason = 'Stop Loss'
                    
                    # Take profit
                    elif returns >= take_profit:
                        exit_signal = True
                        exit_reason = 'Take Profit'
                    
                    # Model predicts price decrease with high probability
                    elif predictions[i] == 0 and probabilities[i][0] > 0.7:
                        exit_signal = True
                        exit_reason = 'ML Signal'
                    
                    if exit_signal:
                        pnl = (current_price - entry_price) * units
                        balance += pnl
                        
                        trades.append({
                            'timestamp': df.index[i],
                            'action': 'SELL',
                            'price': current_price,
                            'units': units,
                            'balance': balance,
                            'pnl': pnl,
                            'return': (pnl / self.initial_balance) * 100,
                            'reason': exit_reason,
                            'confidence': float(probabilities[i][0])
                        })
                        
                        position = False
                        entry_price = 0
            
            # Create trades DataFrame
            if trades:
                trades_df = pd.DataFrame(trades)
                self.plot_results(df, trades_df)
                return trades_df
            
            return None
        except Exception as e:
            console.print(f"[red]Error in backtest: {str(e)}[/red]")
            logging.error(f"Error in backtest: {str(e)}")
            raise
    
    def plot_results(self, df, trades_df):
        """Plot backtest results using the template"""
        try:
            # Read template
            with open('templates/ml_trader_template.html', 'r') as f:
                template = Template(f.read())
            
            # Prepare chart data
            chart_data = {
                'data': [
                    {
                        'type': 'candlestick',
                        'x': [d.strftime('%Y-%m-%d %H:%M:%S') for d in df.index],
                        'open': df['open'].tolist(),
                        'high': df['high'].tolist(),
                        'low': df['low'].tolist(),
                        'close': df['close'].tolist(),
                        'name': 'OHLC'
                    },
                    {
                        'type': 'scatter',
                        'x': [d.strftime('%Y-%m-%d %H:%M:%S') for d in trades_df[trades_df['action'] == 'BUY']['timestamp']],
                        'y': trades_df[trades_df['action'] == 'BUY']['price'].tolist(),
                        'mode': 'markers',
                        'name': 'Buy',
                        'marker': {
                            'symbol': 'triangle-up',
                            'size': 15,
                            'color': '#22c55e'
                        }
                    },
                    {
                        'type': 'scatter',
                        'x': [d.strftime('%Y-%m-%d %H:%M:%S') for d in trades_df[trades_df['action'] == 'SELL']['timestamp']],
                        'y': trades_df[trades_df['action'] == 'SELL']['price'].tolist(),
                        'mode': 'markers',
                        'name': 'Sell',
                        'marker': {
                            'symbol': 'triangle-down',
                            'size': 15,
                            'color': '#ef4444'
                        }
                    }
                ],
                'layout': {
                    'title': 'Trading Activity',
                    'xaxis': {'title': 'Date'},
                    'yaxis': {'title': 'Price'},
                    'height': 600
                }
            }
            
            # Prepare feature importance data
            feature_importance = pd.DataFrame({
                'feature': self.feature_columns,
                'importance': self.model.feature_importances_
            }).sort_values('importance', ascending=True)
            
            feature_importance_data = {
                'data': [{
                    'type': 'bar',
                    'x': feature_importance['importance'].tolist(),
                    'y': feature_importance['feature'].tolist(),
                    'orientation': 'h',
                    'marker': {
                        'color': '#2563eb'
                    }
                }],
                'layout': {
                    'title': 'Feature Importance',
                    'xaxis': {'title': 'Importance'},
                    'yaxis': {'title': 'Feature'},
                    'height': 400,
                    'margin': {'l': 200}
                }
            }
            
            # Calculate template variables
            total_trades = len(trades_df[trades_df['action'] == 'SELL'])
            profitable_trades = len(trades_df[trades_df['pnl'] > 0])
            win_rate = profitable_trades / total_trades * 100 if total_trades > 0 else 0
            final_balance = float(trades_df['balance'].iloc[-1]) if not trades_df.empty else float(self.initial_balance)
            total_return = (final_balance - float(self.initial_balance)) / float(self.initial_balance) * 100
            
            # Format trades data
            trades_list = []
            for _, trade in trades_df.iterrows():
                trade_dict = {
                    'timestamp': trade['timestamp'].strftime('%Y-%m-%d %H:%M:%S'),
                    'action': trade['action'],
                    'price': float(trade['price']),
                    'units': float(trade['units']),
                    'balance': float(trade['balance']),
                    'confidence': float(trade['confidence'])
                }
                if 'pnl' in trade:
                    trade_dict['pnl'] = float(trade['pnl'])
                if 'return' in trade:
                    trade_dict['return'] = float(trade['return'])
                if 'reason' in trade:
                    trade_dict['reason'] = trade['reason']
                trades_list.append(trade_dict)
            
            # Prepare template variables
            template_vars = {
                'symbol': self.symbol,
                'start_date': df.index[0].strftime('%Y-%m-%d %H:%M'),
                'end_date': df.index[-1].strftime('%Y-%m-%d %H:%M'),
                'total_trades': total_trades,
                'win_rate': f"{win_rate:.2f}",
                'total_return': f"{total_return:.2f}",
                'final_balance': f"{final_balance:.2f}",
                'initial_balance': float(self.initial_balance),
                'train_accuracy': f"{self.model.score(self.X_train, self.y_train) * 100:.2f}",
                'test_accuracy': f"{self.model.score(self.X_test, self.y_test) * 100:.2f}",
                'features': self.feature_columns,
                'trades': trades_list,
                'chart_data': chart_data,
                'feature_importance_data': feature_importance_data
            }
            
            # Render template
            html_content = template.render(**template_vars)
            
            # Save to file
            results_dir = Path('backtest_results')
            results_dir.mkdir(exist_ok=True)
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            result_file = results_dir / f'ml_trading_results_{self.symbol}_{timestamp}.html'
            
            with open(result_file, 'w') as f:
                f.write(html_content)
            
            console.print(f"\n[green]Results saved to: {result_file}[/green]")
            
        except Exception as e:
            console.print(f"[red]Error plotting results: {str(e)}[/red]")
            logging.error(f"Error plotting results: {str(e)}")
            raise

def main():
    # Parse command line arguments
    import argparse
    parser = argparse.ArgumentParser(description='ML-based Trading Strategy')
    parser.add_argument('--symbol', type=str, default='BTCUSDT', help='Trading pair symbol')
    parser.add_argument('--days', type=int, default=60, help='Number of days of historical data')
    parser.add_argument('--balance', type=float, default=10000, help='Initial balance')
    args = parser.parse_args()
    
    try:
        # Initialize Binance client
        client = Client("", "")
        
        # Calculate date range
        end_date = datetime.now()
        start_date = end_date - timedelta(days=args.days)
        
        # Fetch historical data
        console.print(f"[cyan]Fetching historical data for {args.symbol}...[/cyan]")
        klines = client.get_historical_klines(
            symbol=args.symbol,
            interval=Client.KLINE_INTERVAL_15MINUTE,
            start_str=str(int(start_date.timestamp() * 1000)),
            end_str=str(int(end_date.timestamp() * 1000))
        )
        
        # Convert to DataFrame
        df = pd.DataFrame(klines, columns=[
            'timestamp', 'open', 'high', 'low', 'close', 'volume',
            'close_time', 'quote_volume', 'trades', 'buy_base_volume',
            'buy_quote_volume', 'ignore'
        ])
        
        # Convert timestamp to datetime
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        df.set_index('timestamp', inplace=True)
        
        # Convert string values to float
        for col in ['open', 'high', 'low', 'close', 'volume']:
            df[col] = df[col].astype(float)
        
        # Initialize and train ML trader
        ml_trader = MLTrader(args.symbol, args.balance)
        accuracy = ml_trader.train_model(df)
        
        if accuracy > 0.5:  # Only backtest if model is better than random
            console.print("\n[cyan]Running backtest...[/cyan]")
            trades_df = ml_trader.backtest(df)
            
            if trades_df is not None:
                # Calculate statistics
                total_trades = len(trades_df[trades_df['action'] == 'SELL'])
                profitable_trades = len(trades_df[trades_df['pnl'] > 0])
                win_rate = profitable_trades / total_trades * 100 if total_trades > 0 else 0
                final_balance = trades_df['balance'].iloc[-1]
                total_return = (final_balance - args.balance) / args.balance * 100
                
                # Display results
                console.print("\n[bold cyan]Trading Results:[/bold cyan]")
                console.print(f"Total Trades: {total_trades}")
                console.print(f"Profitable Trades: {profitable_trades}")
                console.print(f"Win Rate: {win_rate:.2f}%")
                console.print(f"Final Balance: ${final_balance:.2f}")
                console.print(f"Total Return: {total_return:.2f}%")
                
                # Save trades to CSV
                results_dir = Path('backtest_results')
                results_dir.mkdir(exist_ok=True)
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                trades_file = results_dir / f'ml_trades_{args.symbol}_{timestamp}.csv'
                trades_df.to_csv(trades_file)
                console.print(f"\n[green]Trades saved to: {trades_file}[/green]")
        
        else:
            console.print("[red]Model accuracy too low. Try adjusting parameters or using more training data.[/red]")
    
    except Exception as e:
        console.print(f"[red]Error: {str(e)}[/red]")
        logging.error(f"Error in main: {str(e)}")
        return 1
    
    return 0

if __name__ == "__main__":
    import os
    exit(main()) 