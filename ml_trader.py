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
    
    def detect_market_regime(self, df, window=20):
        """Detect market regime (trend/range) using ADX and volatility"""
        try:
            # Calculate ADX
            adx = ta.adx(df['high'], df['low'], df['close'], length=14)
            df['adx'] = adx['ADX_14']
            
            # Calculate volatility
            df['volatility'] = df['close'].pct_change().rolling(window=window).std()
            
            # Calculate trend strength
            df['trend_strength'] = pd.Series(index=df.index, dtype=float)
            
            # Determine market regime
            df['regime'] = pd.Series(index=df.index, dtype=str)
            
            for i in range(len(df)):
                adx_value = df['adx'].iloc[i]
                vol = df['volatility'].iloc[i]
                
                if adx_value > 25:  # Strong trend
                    if vol > vol.mean():
                        df.loc[df.index[i], 'regime'] = 'STRONG_TREND'
                        df.loc[df.index[i], 'trend_strength'] = 1.0
                    else:
                        df.loc[df.index[i], 'regime'] = 'WEAK_TREND'
                        df.loc[df.index[i], 'trend_strength'] = 0.7
                else:  # Range/Choppy
                    if vol > vol.mean():
                        df.loc[df.index[i], 'regime'] = 'VOLATILE_RANGE'
                        df.loc[df.index[i], 'trend_strength'] = 0.3
                    else:
                        df.loc[df.index[i], 'regime'] = 'QUIET_RANGE'
                        df.loc[df.index[i], 'trend_strength'] = 0.5
            
            return df
            
        except Exception as e:
            console.print(f"[red]Error detecting market regime: {str(e)}[/red]")
            logging.error(f"Error detecting market regime: {str(e)}")
            raise

    def get_adaptive_thresholds(self, regime):
        """Get adaptive thresholds based on market regime"""
        thresholds = {
            'STRONG_TREND': {
                'confidence': 0.65,
                'stop_loss': 0.03,
                'take_profit': 0.06,
                'position_size': 0.95
            },
            'WEAK_TREND': {
                'confidence': 0.70,
                'stop_loss': 0.025,
                'take_profit': 0.05,
                'position_size': 0.80
            },
            'VOLATILE_RANGE': {
                'confidence': 0.80,
                'stop_loss': 0.02,
                'take_profit': 0.04,
                'position_size': 0.60
            },
            'QUIET_RANGE': {
                'confidence': 0.75,
                'stop_loss': 0.015,
                'take_profit': 0.03,
                'position_size': 0.70
            }
        }
        return thresholds.get(regime, thresholds['WEAK_TREND'])

    def backtest(self, df, base_stop_loss=0.02, base_take_profit=0.04, min_confidence=0.7, 
                cooldown_periods=12, max_trades_per_day=3):
        """Backtest the ML model with adaptive parameters"""
        try:
            if self.model is None:
                console.print("[red]Model not trained! Please train the model first.[/red]")
                return None
            
            # Prepare features and detect market regime
            df = self.prepare_features(df.copy())
            df = self.detect_market_regime(df)
            X, _ = self.create_features(df)
            
            # Get predictions
            predictions = self.model.predict(X)
            probabilities = self.model.predict_proba(X)
            
            # Initialize tracking variables
            balance = self.initial_balance
            position = False
            entry_price = 0
            trades = []
            last_trade_time = None
            trades_today = 0
            current_day = None
            
            # Run backtest
            for i in range(len(df)-1):
                current_price = df['close'].iloc[i]
                current_time = df.index[i]
                
                # Reset daily trade counter
                if current_day != current_time.date():
                    current_day = current_time.date()
                    trades_today = 0
                
                # Get adaptive thresholds based on market regime
                thresholds = self.get_adaptive_thresholds(df['regime'].iloc[i])
                
                if not position:
                    # Check cooldown period
                    if last_trade_time is not None:
                        time_since_last_trade = (current_time - last_trade_time).total_seconds() / 3600
                        if time_since_last_trade < cooldown_periods:
                            continue
                    
                    # Check daily trade limit
                    if trades_today >= max_trades_per_day:
                        continue
                    
                    # Check for buy signal with adaptive confidence
                    required_confidence = max(min_confidence, thresholds['confidence'])
                    if predictions[i] == 1 and probabilities[i][1] > required_confidence:
                        position = True
                        entry_price = current_price
                        position_size = balance * thresholds['position_size']
                        units = position_size / current_price
                        
                        trades.append({
                            'timestamp': df.index[i],
                            'action': 'BUY',
                            'price': current_price,
                            'units': units,
                            'balance': balance,
                            'confidence': float(probabilities[i][1]),
                            'regime': df['regime'].iloc[i]
                        })
                        
                        trades_today += 1
                
                elif position:
                    # Calculate returns
                    returns = (current_price - entry_price) / entry_price
                    
                    # Get adaptive stop loss and take profit
                    stop_loss = base_stop_loss * (1 / thresholds['confidence'])
                    take_profit = base_take_profit * thresholds['confidence']
                    
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
                    elif predictions[i] == 0 and probabilities[i][0] > thresholds['confidence']:
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
                            'confidence': float(probabilities[i][0]),
                            'regime': df['regime'].iloc[i]
                        })
                        
                        position = False
                        entry_price = 0
                        last_trade_time = current_time
            
            # Create trades DataFrame
            if trades:
                trades_df = pd.DataFrame(trades)
                
                # Calculate trade statistics by regime
                regime_stats = trades_df[trades_df['action'] == 'SELL'].groupby('regime').agg({
                    'pnl': ['count', 'mean', 'sum'],
                    'return': 'mean'
                }).round(2)
                
                console.print("\n[bold cyan]Trade Statistics by Market Regime:[/bold cyan]")
                console.print(regime_stats)
                
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
            
            # Calculate trade statistics by regime first
            regime_stats = trades_df[trades_df['action'] == 'SELL'].groupby('regime').agg({
                'pnl': ['count', 'mean', 'sum'],
                'return': 'mean'
            }).round(2)
            
            # Convert MultiIndex DataFrame to regular dict
            regime_stats_flat = {}
            for regime in regime_stats.index:
                regime_stats_flat[regime] = {
                    'trade_count': int(regime_stats.loc[regime, ('pnl', 'count')]),
                    'avg_pnl': float(regime_stats.loc[regime, ('pnl', 'mean')]),
                    'total_pnl': float(regime_stats.loc[regime, ('pnl', 'sum')]),
                    'avg_return': float(regime_stats.loc[regime, ('return', 'mean')])
                }
            
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
                    'height': 600,
                    'plot_bgcolor': '#1f2937',
                    'paper_bgcolor': '#1f2937',
                    'font': {'color': '#f3f4f6'}
                }
            }
            
            # Format trades data
            trades_list = []
            for _, trade in trades_df.iterrows():
                trade_dict = {
                    'timestamp': trade['timestamp'].strftime('%Y-%m-%d %H:%M:%S'),
                    'action': trade['action'],
                    'price': float(trade['price']),
                    'units': float(trade['units']),
                    'balance': float(trade['balance']),
                    'confidence': float(trade['confidence']),
                    'regime': trade['regime']
                }
                if 'pnl' in trade:
                    trade_dict['pnl'] = float(trade['pnl'])
                if 'return' in trade:
                    trade_dict['return'] = float(trade['return'])
                if 'reason' in trade:
                    trade_dict['reason'] = trade['reason']
                trades_list.append(trade_dict)

            # Create feature importance visualization
            console.print("\n[cyan]Creating feature importance visualization...[/cyan]")
            
            # Sort features by importance
            feature_importance = pd.DataFrame({
                'feature': self.feature_columns,
                'importance': self.model.feature_importances_
            })
            feature_importance = feature_importance.sort_values('importance', ascending=True)
            
            # Create the feature importance plot data
            feature_importance_data = {
                'data': [{
                    'type': 'bar',
                    'x': feature_importance['importance'].round(4).tolist(),
                    'y': feature_importance['feature'].tolist(),
                    'orientation': 'h',
                    'name': 'Feature Importance',
                    'marker': {
                        'color': '#3b82f6',
                        'line': {
                            'color': '#2563eb',
                            'width': 1
                        }
                    },
                    'hovertemplate': '<b>%{y}</b><br>Importance: %{x:.4f}<extra></extra>'
                }],
                'layout': {
                    'title': {
                        'text': '<b>Feature Importance Ranking</b>',
                        'x': 0.5,
                        'xanchor': 'center',
                        'font': {'size': 20, 'color': '#f3f4f6'}
                    },
                    'width': 800,
                    'height': 600,
                    'margin': {
                        'l': 200,
                        'r': 30,
                        't': 50,
                        'b': 50
                    },
                    'xaxis': {
                        'title': 'Importance Score',
                        'titlefont': {'size': 14, 'color': '#f3f4f6'},
                        'tickfont': {'size': 12, 'color': '#f3f4f6'},
                        'showgrid': True,
                        'gridcolor': '#374151',
                        'gridwidth': 1
                    },
                    'yaxis': {
                        'title': '',
                        'tickfont': {'size': 12, 'color': '#f3f4f6'},
                        'showgrid': True,
                        'gridcolor': '#374151',
                        'gridwidth': 1
                    },
                    'plot_bgcolor': '#1f2937',
                    'paper_bgcolor': '#1f2937',
                    'showlegend': False,
                    'bargap': 0.15
                }
            }
            
            # Log feature importance data for debugging
            console.print(f"\nFeature importance values:")
            for feat, imp in zip(feature_importance['feature'], feature_importance['importance']):
                console.print(f"{feat}: {imp:.4f}")
            
            # Calculate template variables
            total_trades = len(trades_df[trades_df['action'] == 'SELL'])
            profitable_trades = len(trades_df[trades_df['pnl'] > 0])
            win_rate = profitable_trades / total_trades * 100 if total_trades > 0 else 0
            final_balance = float(trades_df['balance'].iloc[-1]) if not trades_df.empty else float(self.initial_balance)
            total_return = (final_balance - float(self.initial_balance)) / float(self.initial_balance) * 100
            
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
                'feature_importance_data': feature_importance_data,
                'regime_stats': regime_stats_flat
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