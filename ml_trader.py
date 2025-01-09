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

# Initialize Rich console
console = Console()

class MLTrader:
    def __init__(self, symbol: str = "BTCUSDT", initial_balance: float = 10000):
        self.symbol = symbol
        self.initial_balance = initial_balance
        self.model = None
        self.scaler = StandardScaler()
        self.setup_logging()
        
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
    
    def prepare_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Prepare feature set for ML model"""
        # Technical indicators
        df['rsi'] = ta.rsi(df['close'], length=14)
        df['macd'] = ta.macd(df['close'])['MACD_12_26_9']
        df['macd_signal'] = ta.macd(df['close'])['MACDs_12_26_9']
        df['macd_hist'] = ta.macd(df['close'])['MACDh_12_26_9']
        
        # Moving averages
        df['sma_20'] = ta.sma(df['close'], length=20)
        df['sma_50'] = ta.sma(df['close'], length=50)
        df['ema_12'] = ta.ema(df['close'], length=12)
        df['ema_26'] = ta.ema(df['close'], length=26)
        
        # Bollinger Bands
        bb = ta.bbands(df['close'], length=20)
        df['bb_upper'] = bb['BBU_20_2.0']
        df['bb_middle'] = bb['BBM_20_2.0']
        df['bb_lower'] = bb['BBL_20_2.0']
        
        # Price changes
        df['price_change'] = df['close'].pct_change()
        df['price_change_2'] = df['close'].pct_change(2)
        df['price_change_5'] = df['close'].pct_change(5)
        
        # Volume indicators
        df['volume_change'] = df['volume'].pct_change()
        df['volume_ma'] = ta.sma(df['volume'], length=20)
        df['volume_std'] = df['volume'].rolling(window=20).std()
        
        # Volatility
        df['atr'] = ta.atr(df['high'], df['low'], df['close'], length=14)
        df['volatility'] = df['close'].rolling(window=20).std()
        
        # Momentum
        df['mom'] = ta.mom(df['close'], length=10)
        df['roc'] = ta.roc(df['close'], length=10)
        
        # Create target variable (1 for price increase, 0 for decrease)
        df['target'] = (df['close'].shift(-1) > df['close']).astype(int)
        
        # Drop NaN values
        df.dropna(inplace=True)
        
        return df
    
    def create_features(self, df: pd.DataFrame) -> tuple:
        """Create feature matrix X and target vector y"""
        feature_columns = [
            'rsi', 'macd', 'macd_signal', 'macd_hist',
            'sma_20', 'sma_50', 'ema_12', 'ema_26',
            'bb_upper', 'bb_middle', 'bb_lower',
            'price_change', 'price_change_2', 'price_change_5',
            'volume_change', 'volume_ma', 'volume_std',
            'atr', 'volatility', 'mom', 'roc'
        ]
        
        X = df[feature_columns].values
        y = df['target'].values
        
        # Scale features
        X = self.scaler.fit_transform(X)
        
        return X, y
    
    def train_model(self, df: pd.DataFrame):
        """Train the ML model"""
        console.print("[cyan]Preparing features...[/cyan]")
        df = self.prepare_features(df)
        
        console.print("[cyan]Creating feature matrix...[/cyan]")
        X, y = self.create_features(df)
        
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, shuffle=False
        )
        
        console.print("[cyan]Training Random Forest model...[/cyan]")
        self.model = RandomForestClassifier(
            n_estimators=100,
            max_depth=10,
            min_samples_split=10,
            min_samples_leaf=5,
            random_state=42
        )
        
        self.model.fit(X_train, y_train)
        
        # Calculate accuracy
        train_accuracy = self.model.score(X_train, y_train)
        test_accuracy = self.model.score(X_test, y_test)
        
        console.print(f"[green]Training accuracy: {train_accuracy:.2%}[/green]")
        console.print(f"[green]Testing accuracy: {test_accuracy:.2%}[/green]")
        
        return test_accuracy
    
    def backtest(self, df: pd.DataFrame, stop_loss: float = 0.02, take_profit: float = 0.04):
        """Backtest the ML model"""
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
        for i in range(len(df)-1):  # -1 because we need next day's price for exit
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
                        'balance': balance
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
                        'reason': exit_reason
                    })
                    
                    position = False
                    entry_price = 0
        
        # Create trades DataFrame
        if trades:
            trades_df = pd.DataFrame(trades)
            self.plot_results(df, trades_df)
            return trades_df
        
        return None
    
    def plot_results(self, df: pd.DataFrame, trades_df: pd.DataFrame):
        """Plot backtest results"""
        fig = make_subplots(
            rows=3, cols=1,
            shared_xaxes=True,
            vertical_spacing=0.05,
            subplot_titles=('Price & Trades', 'Balance', 'ML Predictions'),
            row_heights=[0.5, 0.25, 0.25]
        )
        
        # Add candlestick chart
        fig.add_trace(
            go.Candlestick(
                x=df.index,
                open=df['open'],
                high=df['high'],
                low=df['low'],
                close=df['close'],
                name='OHLC'
            ),
            row=1, col=1
        )
        
        # Add buy/sell markers
        buys = trades_df[trades_df['action'] == 'BUY']
        sells = trades_df[trades_df['action'] == 'SELL']
        
        fig.add_trace(
            go.Scatter(
                x=buys['timestamp'],
                y=buys['price'],
                mode='markers',
                name='Buy',
                marker=dict(
                    symbol='triangle-up',
                    size=15,
                    color='green',
                )
            ),
            row=1, col=1
        )
        
        fig.add_trace(
            go.Scatter(
                x=sells['timestamp'],
                y=sells['price'],
                mode='markers',
                name='Sell',
                marker=dict(
                    symbol='triangle-down',
                    size=15,
                    color='red',
                )
            ),
            row=1, col=1
        )
        
        # Add balance chart
        fig.add_trace(
            go.Scatter(
                x=trades_df['timestamp'],
                y=trades_df['balance'],
                name='Balance',
                line=dict(color='blue')
            ),
            row=2, col=1
        )
        
        # Add ML predictions
        X, _ = self.create_features(df)
        probabilities = self.model.predict_proba(X)
        
        fig.add_trace(
            go.Scatter(
                x=df.index,
                y=probabilities[:, 1],
                name='Buy Probability',
                line=dict(color='green')
            ),
            row=3, col=1
        )
        
        # Update layout
        fig.update_layout(
            title='ML Trading Results',
            yaxis_title='Price',
            yaxis2_title='Balance',
            yaxis3_title='Probability',
            xaxis_rangeslider_visible=False,
            height=1200
        )
        
        # Save plot
        results_dir = Path('backtest_results')
        results_dir.mkdir(exist_ok=True)
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        plot_file = results_dir / f'ml_trading_results_{timestamp}.html'
        
        fig.write_html(str(plot_file))
        console.print(f"\n[green]Results plot saved to: {plot_file}[/green]")

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
                win_rate = profitable_trades / total_trades * 100
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