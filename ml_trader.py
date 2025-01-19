import pandas as pd
import numpy as np
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
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import TensorDataset, DataLoader
import argparse
from sklearn.metrics import f1_score, accuracy_score
import torch.nn.functional as F
from torchviz import make_dot

# Initialize Rich console
console = Console()

# Check for MPS (Metal) availability
if torch.backends.mps.is_available():
    DEVICE = torch.device("mps")
    console.print("[green]MPS (Metal) device is available for GPU acceleration![/green]")
else:
    DEVICE = torch.device("cpu")
    console.print("[yellow]MPS device not available, using CPU...[/yellow]")

class TradingModel(nn.Module):
    def __init__(self, input_dim):
        super().__init__()
        self.network = nn.Sequential(
            nn.Linear(input_dim, 128),
            nn.BatchNorm1d(128),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(128, 64),
            nn.BatchNorm1d(64),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(64, 32),
            nn.BatchNorm1d(32),
            nn.ReLU(),
            nn.Linear(32, 1)
        )
    
    def forward(self, x):
        return self.network(x)

class MLTrader:
    def __init__(self, symbol, initial_balance=1000):
        """Initialize ML trader"""
        self.symbol = symbol
        self.initial_balance = initial_balance
        self.model = None
        self.data = None
        self.scaler = StandardScaler()
        
        # Initialize feature columns (removed the new features from here)
        self.feature_columns = [
            'sma_20', 'sma_50', 'ema_12', 'ema_26',
            'macd', 'macd_signal', 'macd_hist',
            'rsi', 'mom', 'roc',
            'bb_upper', 'bb_middle', 'bb_lower',
            'volume_ma', 'volume_std', 'volume_change',
            'price_change', 'price_change_2', 'price_change_5',
            'atr', 'volatility',
            'high_low_ratio', 'close_open_ratio', 'volume_price_ratio'
        ]
        
        # Check for GPU
        if torch.backends.mps.is_available():
            console.print("[green]MPS (Metal) device is available for GPU acceleration![/green]")
            console.print("Initializing ML trader with M1/M2 GPU acceleration...")
        else:
            console.print("[yellow]GPU not available, using CPU[/yellow]")
        
    def setup_logging(self):
        """Setup logging configuration"""
        try:
            log_dir = Path('logs')
            log_dir.mkdir(exist_ok=True)
            
            logging.basicConfig(
                level=logging.INFO,
                format='%(asctime)s - %(levelname)s - %(message)s',
                handlers=[
                    logging.FileHandler(log_dir / f'ml_trader_{datetime.now().strftime("%Y%m%d")}.log'),
                    logging.StreamHandler()
                ]
            )
        except Exception as e:
            console.print(f"[red]Error setting up logging: {str(e)}[/red]")
            raise
    
    def prepare_features(self, df):
        """Prepare feature set for ML model"""
        try:
            # Create a copy at the start
            df = df.copy()
            
            # Calculate indicators one by one
            # RSI
            df['rsi'] = df.ta.rsi(length=14)
            
            # MACD
            macd = df.ta.macd(fast=12, slow=26, signal=9)
            df['macd'] = macd[f'MACD_{12}_{26}_{9}']
            df['macd_signal'] = macd[f'MACDs_{12}_{26}_{9}']
            df['macd_hist'] = macd[f'MACDh_{12}_{26}_{9}']
            
            # Moving Averages
            df['sma_20'] = df.ta.sma(length=20)
            df['sma_50'] = df.ta.sma(length=50)
            df['ema_12'] = df.ta.ema(length=12)
            df['ema_26'] = df.ta.ema(length=26)
            
            # Bollinger Bands
            bb = df.ta.bbands(length=20)
            df['bb_lower'] = bb['BBL_20_2.0']
            df['bb_middle'] = bb['BBM_20_2.0']
            df['bb_upper'] = bb['BBU_20_2.0']
            
            # Price changes
            df['price_change'] = df['close'].pct_change()
            df['price_change_2'] = df['close'].pct_change(2)
            df['price_change_5'] = df['close'].pct_change(5)
            
            # Volume indicators
            df['volume_change'] = df['volume'].pct_change()
            df['volume_ma'] = df.ta.sma(close=df['volume'], length=20)
            df['volume_std'] = df['volume'].rolling(window=20).std()
            
            # Momentum
            df['mom'] = df.ta.mom(length=10)
            df['roc'] = df.ta.roc(length=10)
            
            # Volatility
            df['atr'] = df.ta.atr(length=14)
            df['volatility'] = df['close'].rolling(window=20).std()
            
            # Additional features
            df['high_low_ratio'] = df['high'] / df['low']
            df['close_open_ratio'] = df['close'] / df['open']
            df['volume_price_ratio'] = df['volume'] / df['close']
            
            # Drop NaN values
            df = df.dropna()
            
            return df.copy()  # Return a copy to ensure we don't have a view
            
        except Exception as e:
            console.print(f"[red]Error preparing features: {str(e)}[/red]")
            logging.error(f"Error preparing features: {str(e)}")
            raise
    
    def create_features(self, df):
        """Create feature matrix for ML model"""
        try:
            # Select features
            feature_columns = [
                'sma_20', 'sma_50', 'ema_12', 'ema_26',
                'macd', 'macd_signal', 'macd_hist',
                'rsi', 'mom', 'roc',
                'bb_upper', 'bb_middle', 'bb_lower',
                'volume_ma', 'volume_std', 'volume_change',
                'price_change', 'price_change_2', 'price_change_5',
                'atr', 'volatility',
                'high_low_ratio', 'close_open_ratio', 'volume_price_ratio'
            ]
            
            # Ensure all required columns exist
            missing_columns = [col for col in feature_columns if col not in df.columns]
            if missing_columns:
                raise ValueError(f"Missing columns in DataFrame: {missing_columns}")
            
            X = df[feature_columns].values
            y = df['target'].values
            
            return X, y
            
        except Exception as e:
            console.print(f"[red]Error creating features: {str(e)}[/red]")
            logging.error(f"Error creating features: {str(e)}")
            raise
    
    def create_model(self):
        """Create an improved neural network model"""
        try:
            input_dim = len(self.feature_columns)
            
            class ImprovedModel(nn.Module):
                def __init__(self, input_dim):
                    super().__init__()
                    # First layer with batch normalization
                    self.layer1 = nn.Linear(input_dim, 128)
                    self.bn1 = nn.BatchNorm1d(128)
                    self.dropout1 = nn.Dropout(0.3)
                    
                    # Second layer with batch normalization
                    self.layer2 = nn.Linear(128, 64)
                    self.bn2 = nn.BatchNorm1d(64)
                    self.dropout2 = nn.Dropout(0.3)
                    
                    # Third layer with batch normalization
                    self.layer3 = nn.Linear(64, 32)
                    self.bn3 = nn.BatchNorm1d(32)
                    self.dropout3 = nn.Dropout(0.3)
                    
                    # Output layer
                    self.output = nn.Linear(32, 1)
                
                def forward(self, x):
                    # Layer 1
                    x = self.layer1(x)
                    x = self.bn1(x)
                    x = F.leaky_relu(x, negative_slope=0.1)
                    x = self.dropout1(x)
                    
                    # Layer 2
                    x = self.layer2(x)
                    x = self.bn2(x)
                    x = F.leaky_relu(x, negative_slope=0.1)
                    x = self.dropout2(x)
                    
                    # Layer 3
                    x = self.layer3(x)
                    x = self.bn3(x)
                    x = F.leaky_relu(x, negative_slope=0.1)
                    x = self.dropout3(x)
                    
                    # Output
                    return self.output(x)
            
            # Initialize model
            model = ImprovedModel(input_dim)
            
            # Move model to GPU if available
            if torch.backends.mps.is_available():
                model = model.to('mps')
            
            return model
            
        except Exception as e:
            console.print(f"[red]Error creating model: {str(e)}[/red]")
            logging.error(f"Error creating model: {str(e)}")
            raise

    def visualize_model(self):
        """Visualize the neural network architecture"""
        try:
            # Create a sample input
            x = torch.randn(1, len(self.feature_columns)).to(DEVICE)
            
            # Get the output
            y = self.model(x)
            
            # Create the dot graph
            dot = make_dot(y, params=dict(self.model.named_parameters()))
            
            # Save the graph
            dot.render("model_architecture", format="png", cleanup=True)
            console.print("[green]Model architecture saved as 'model_architecture.png'[/green]")
            
        except Exception as e:
            console.print(f"[red]Error visualizing model: {str(e)}[/red]")
            console.print("[yellow]To visualize the model, please install graphviz and torchviz:[/yellow]")
            console.print("pip install torchviz")
            console.print("brew install graphviz  # For MacOS")

    def train_model(self, df, epochs=150, batch_size=32, learning_rate=0.001):
        """Train the neural network model with improved training process"""
        try:
            # Store the data
            self.data = df.copy()
            
            # Initialize lists to store training metrics
            self.training_metrics = {
                'train_loss': [],
                'test_loss': [],
                'train_f1': [],
                'test_f1': [],
                'train_acc': [],
                'test_acc': [],
                'learning_rates': []
            }
            
            console.print("[cyan]Preparing features...[/cyan]")
            # Get a fresh copy with features
            df = self.prepare_features(df).copy()  # Ensure we have a copy
            
            # Calculate returns for different timeframes
            df = df.assign(
                returns_1h=df['close'].pct_change(4).shift(-4),  # 4 periods of 15min = 1h
                returns_4h=df['close'].pct_change(16).shift(-16),  # 16 periods = 4h
                returns_24h=df['close'].pct_change(96).shift(-96),  # 96 periods = 24h
                target=0  # Initialize target column
            )
            
            # Strong buy signals (1) with more selective thresholds
            buy_signal = (
                (df['returns_1h'] > 0.001) &    # Increased from 0.0008 to 0.1%
                ((df['returns_4h'] > 0.002) |    # Increased from 0.0015 to 0.2%
                 (df['returns_24h'] > 0.004))    # Increased from 0.003 to 0.4%
            )
            
            # Strong sell signals (0) with more selective thresholds
            sell_signal = (
                (df['returns_1h'] < -0.001) &
                ((df['returns_4h'] < -0.002) |
                 (df['returns_24h'] < -0.004))
            )
            
            # Apply signals
            df = df.copy()  # Get a fresh copy
            df.loc[buy_signal, 'target'] = 1
            df.loc[sell_signal, 'target'] = 0
            
            # Keep only strong signals and drop NaN values
            df = df[buy_signal | sell_signal].copy()
            df = df.dropna()
            
            console.print(f"[cyan]Training samples: {len(df)}[/cyan]")
            console.print(f"[cyan]Positive samples: {df['target'].sum()} ({df['target'].mean()*100:.1f}%)[/cyan]")
            
            # Create features
            X, y = self.create_features(df)
            
            # Split data chronologically
            split_idx = int(len(X) * 0.8)
            X_train, X_test = X[:split_idx], X[split_idx:]
            y_train, y_test = y[:split_idx], y[split_idx:]
            
            # Store for later use
            self.X_train = X_train
            self.X_test = X_test
            self.y_train = y_train
            self.y_test = y_test
            
            # Scale features
            self.scaler = StandardScaler()
            X_train = self.scaler.fit_transform(X_train)
            X_test = self.scaler.transform(X_test)
            
            # Convert to PyTorch tensors
            X_train = torch.FloatTensor(X_train).to(dtype=torch.float32).to(DEVICE)
            y_train = torch.FloatTensor(y_train).to(dtype=torch.float32).to(DEVICE)
            X_test = torch.FloatTensor(X_test).to(dtype=torch.float32).to(DEVICE)
            y_test = torch.FloatTensor(y_test).to(dtype=torch.float32).to(DEVICE)
            
            # Create data loaders with balanced sampling
            train_dataset = TensorDataset(X_train, y_train)
            train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True)
            
            # Initialize model
            self.model = self.create_model()
            
            # Visualize the model architecture
            self.visualize_model()
            
            # Use AdamW optimizer with weight decay
            optimizer = torch.optim.AdamW(self.model.parameters(), lr=learning_rate, weight_decay=0.01)
            
            # Use OneCycleLR scheduler for better convergence
            scheduler = torch.optim.lr_scheduler.OneCycleLR(
                optimizer,
                max_lr=learning_rate,
                epochs=epochs,
                steps_per_epoch=len(train_loader),
                pct_start=0.3,
                anneal_strategy='cos'
            )
            
            # Use BCEWithLogitsLoss with class weights
            pos_weight = torch.tensor([1.0 if y_train.mean() > 0.5 else 1.5])
            if torch.backends.mps.is_available():
                pos_weight = pos_weight.to('mps')
            criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
            
            # Early stopping parameters
            patience = 25  # Increased from 20
            min_delta = 0.001  # Minimum improvement required
            patience_counter = 0
            best_val_f1 = 0
            best_model_state = None
            
            console.print("[cyan]Training neural network model...[/cyan]")
            
            for epoch in range(epochs):
                self.model.train()
                total_loss = 0
                train_preds = []
                train_targets = []
                
                # Training loop
                for batch_X, batch_y in train_loader:
                    optimizer.zero_grad()
                    outputs = self.model(batch_X).squeeze()
                    loss = criterion(outputs, batch_y)
                    
                    loss.backward()
                    
                    # Gradient clipping with lower threshold
                    torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=0.5)
                    
                    optimizer.step()
                    scheduler.step()
                    
                    total_loss += loss.item()
                    train_preds.extend((torch.sigmoid(outputs) >= 0.5).float().cpu().numpy())
                    train_targets.extend(batch_y.cpu().numpy())
                
                # Validation
                self.model.eval()
                with torch.no_grad():
                    test_outputs = self.model(X_test).squeeze()
                    test_loss = criterion(test_outputs, y_test)
                    test_preds = (torch.sigmoid(test_outputs) >= 0.5).float().cpu().numpy()
                    test_targets = y_test.cpu().numpy()
                
                # Calculate metrics
                train_f1 = f1_score(train_targets, train_preds)
                test_f1 = f1_score(test_targets, test_preds)
                train_acc = accuracy_score(train_targets, train_preds) * 100
                test_acc = accuracy_score(test_targets, test_preds) * 100
                
                avg_loss = total_loss / len(train_loader)
                
                # Store metrics for plotting
                self.training_metrics['train_loss'].append(avg_loss)
                self.training_metrics['test_loss'].append(float(test_loss))
                self.training_metrics['train_f1'].append(train_f1)
                self.training_metrics['test_f1'].append(test_f1)
                self.training_metrics['train_acc'].append(train_acc)
                self.training_metrics['test_acc'].append(test_acc)
                self.training_metrics['learning_rates'].append(float(scheduler.get_last_lr()[0]))
                
                # Print progress every 10 epochs
                if (epoch + 1) % 10 == 0:
                    console.print(f"Epoch {epoch + 1}/{epochs}")
                    console.print(f"Train Loss: {avg_loss:.4f}, Test Loss: {test_loss:.4f}")
                    console.print(f"Train F1: {train_f1:.4f}, Test F1: {test_f1:.4f}")
                    console.print(f"Train Accuracy: {train_acc:.2f}%, Test Accuracy: {test_acc:.2f}%")
                    console.print(f"Learning Rate: {scheduler.get_last_lr()[0]:.6f}")
                
                # Early stopping check with min_delta threshold
                if test_f1 > best_val_f1 + min_delta:
                    best_val_f1 = test_f1
                    patience_counter = 0
                    best_model_state = self.model.state_dict()
                else:
                    patience_counter += 1
                
                if patience_counter >= patience:
                    console.print(f"[yellow]Early stopping triggered! Best validation F1: {best_val_f1:.4f}[/yellow]")
                    break
                
                # Stop if performance is too poor
                if epoch >= 30 and test_f1 < 0.52:
                    console.print("[red]Model performance is not improving. Consider adjusting hyperparameters or feature engineering.[/red]")
                    return False
            
            # Load best model state
            if best_model_state is not None:
                self.model.load_state_dict(best_model_state)
                console.print(f"[green]Loaded best model with validation F1: {best_val_f1:.4f}[/green]")
            
            # Save the model
            model_dir = Path('models')
            model_dir.mkdir(exist_ok=True)
            model_path = model_dir / f'pytorch_model_{self.symbol}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.pth'
            torch.save({
                'model_state_dict': self.model.state_dict(),
                'scaler_state': self.scaler,
                'feature_columns': self.feature_columns,
                'best_val_f1': best_val_f1
            }, model_path)
            console.print(f"[green]Model saved to: {model_path}[/green]")
            
            return True
            
        except Exception as e:
            console.print(f"[red]Error training model: {str(e)}[/red]")
            logging.error(f"Error training model: {str(e)}")
            return False
    
    def detect_market_regime(self, df):
        """Detect market regime based on volatility and trend"""
        try:
            df = df.copy()  # Create a copy to avoid warnings
            
            # Calculate volatility
            df.loc[:, 'volatility'] = df['close'].pct_change().rolling(window=20).std()
            
            # Calculate trend strength using ADX
            df.loc[:, 'plus_dm'] = df['high'].diff()
            df.loc[:, 'minus_dm'] = df['low'].diff()
            df.loc[:, 'plus_dm'] = df['plus_dm'].where(
                (df['plus_dm'] > 0) & (df['plus_dm'] > df['minus_dm'].abs()),
                0.0
            )
            df.loc[:, 'minus_dm'] = df['minus_dm'].abs().where(
                (df['minus_dm'] < 0) & (df['minus_dm'].abs() > df['plus_dm']),
                0.0
            )
            
            # Calculate True Range
            df.loc[:, 'tr'] = pd.DataFrame({
                'hl': df['high'] - df['low'],
                'hc': (df['high'] - df['close'].shift()).abs(),
                'lc': (df['low'] - df['close'].shift()).abs()
            }).max(axis=1)
            
            # Smooth the indicators
            smoothing_period = 14
            df.loc[:, 'smoothed_plus_dm'] = df['plus_dm'].rolling(window=smoothing_period).mean()
            df.loc[:, 'smoothed_minus_dm'] = df['minus_dm'].rolling(window=smoothing_period).mean()
            df.loc[:, 'smoothed_tr'] = df['tr'].rolling(window=smoothing_period).mean()
            
            # Calculate DI+ and DI-
            df.loc[:, 'plus_di'] = 100 * df['smoothed_plus_dm'] / df['smoothed_tr']
            df.loc[:, 'minus_di'] = 100 * df['smoothed_minus_dm'] / df['smoothed_tr']
            
            # Calculate ADX
            df.loc[:, 'dx'] = 100 * (df['plus_di'] - df['minus_di']).abs() / (df['plus_di'] + df['minus_di'])
            df.loc[:, 'adx'] = df['dx'].rolling(window=smoothing_period).mean()
            
            # Define regime thresholds
            volatility_threshold = df['volatility'].quantile(0.7)
            trend_threshold = 25  # ADX above 25 indicates trend
            
            # Classify market regimes
            conditions = [
                (df['adx'] >= trend_threshold) & (df['volatility'] >= volatility_threshold),
                (df['adx'] >= trend_threshold) & (df['volatility'] < volatility_threshold),
                (df['adx'] < trend_threshold) & (df['volatility'] >= volatility_threshold),
                (df['adx'] < trend_threshold) & (df['volatility'] < volatility_threshold)
            ]
            choices = ['STRONG_TREND', 'WEAK_TREND', 'VOLATILE_RANGE', 'QUIET_RANGE']
            df.loc[:, 'regime'] = np.select(conditions, choices, default='WEAK_TREND')
            
            # Clean up intermediate columns
            columns_to_drop = [
                'plus_dm', 'minus_dm', 'tr', 'smoothed_plus_dm',
                'smoothed_minus_dm', 'smoothed_tr', 'plus_di',
                'minus_di', 'dx', 'adx'
            ]
            df = df.drop(columns=columns_to_drop)
            
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
                'position_size': 0.95,
                'cooldown': 1  # 1 hour cooldown in strong trends - trade more frequently
            },
            'WEAK_TREND': {
                'confidence': 0.70,
                'stop_loss': 0.025,
                'take_profit': 0.05,
                'position_size': 0.80,
                'cooldown': 3  # 3 hour cooldown in weak trends
            },
            'VOLATILE_RANGE': {
                'confidence': 0.80,
                'stop_loss': 0.02,
                'take_profit': 0.04,
                'position_size': 0.60,
                'cooldown': 6  # 6 hour cooldown in volatile ranges - be more cautious
            },
            'QUIET_RANGE': {
                'confidence': 0.75,
                'stop_loss': 0.015,
                'take_profit': 0.03,
                'position_size': 0.70,
                'cooldown': 4  # 4 hour cooldown in quiet ranges
            }
        }
        return thresholds.get(regime, thresholds['WEAK_TREND'])

    def backtest(self, df, base_stop_loss=0.02, base_take_profit=0.04, min_confidence=0.7):
        """Backtest the ML model with adaptive parameters"""
        try:
            if self.model is None:
                console.print("[red]Model not trained! Please train the model first.[/red]")
                return None
            
            # Prepare features and detect market regime
            df = self.prepare_features(df.copy())
            df = self.detect_market_regime(df)
            
            # Create feature matrix
            X = df[self.feature_columns].values
            X = self.scaler.transform(X)
            X_tensor = torch.FloatTensor(X).to(dtype=torch.float32).to(DEVICE)
            
            # Get predictions with model in eval mode
            self.model.eval()
            with torch.no_grad():
                logits = self.model(X_tensor)
                probabilities = torch.sigmoid(logits).cpu().numpy().squeeze()
                
                # Store raw probabilities (0-1 range)
                df['prediction'] = probabilities
                df['signal'] = 0
            
            # Generate signals with dynamic confidence threshold
            for i in range(len(df)):
                current_regime = df['regime'].iloc[i]
                prediction = probabilities[i]
                
                # Adjust confidence threshold based on regime
                regime_thresholds = self.get_adaptive_thresholds(current_regime)
                adjusted_confidence = min_confidence * regime_thresholds['confidence']
                
                # Only generate signals for high-confidence predictions
                if prediction >= adjusted_confidence:
                    df.iloc[i, df.columns.get_loc('signal')] = 1
            
            # Initialize tracking variables
            balance = self.initial_balance
            position = False
            entry_price = 0
            trades = []
            last_trade_time = None
            cooldown_periods = 4  # 1-hour cooldown (4 * 15min)
            
            # Run backtest
            for i in range(len(df)-1):
                current_price = df['close'].iloc[i]
                current_time = df.index[i]
                current_regime = df['regime'].iloc[i]
                prediction = df['prediction'].iloc[i]
                signal = df['signal'].iloc[i]
                
                # Check if we're in cooldown
                if last_trade_time is not None:
                    periods_since_last_trade = (current_time - last_trade_time).total_seconds() / (15 * 60)
                    if periods_since_last_trade < cooldown_periods:
                        continue
                
                if not position and signal == 1:
                    # Get regime-specific parameters
                    regime_thresholds = self.get_adaptive_thresholds(current_regime)
                    
                    # Enter position with regime-adjusted position size
                    position = True
                    entry_price = current_price
                    position_size = balance * regime_thresholds['position_size']
                    units = position_size / current_price
                    
                    trades.append({
                        'timestamp': df.index[i],
                        'action': 'BUY',
                        'price': current_price,
                        'units': units,
                        'balance': balance,
                        'confidence': float(f"{prediction * 100:.1f}"),  # Convert to percentage with 1 decimal
                        'regime': current_regime
                    })
                    last_trade_time = current_time
                
                elif position:
                    # Calculate returns
                    returns = (current_price - entry_price) / entry_price
                    
                    # Get regime-specific thresholds
                    regime_thresholds = self.get_adaptive_thresholds(current_regime)
                    
                    # Adjust stop loss and take profit based on regime and confidence
                    confidence_factor = min(prediction / min_confidence, 1.5)
                    adjusted_stop_loss = base_stop_loss * regime_thresholds['stop_loss']
                    adjusted_take_profit = base_take_profit * regime_thresholds['take_profit']
                    
                    # Exit conditions
                    stop_loss_hit = returns <= -adjusted_stop_loss
                    take_profit_hit = returns >= adjusted_take_profit
                    
                    if stop_loss_hit or take_profit_hit:
                        pnl = (current_price - entry_price) * units
                        balance += pnl
                        
                        exit_reason = 'Stop Loss' if stop_loss_hit else 'Take Profit'
                        
                        trades.append({
                            'timestamp': df.index[i],
                            'action': 'SELL',
                            'price': current_price,
                            'units': units,
                            'balance': balance,
                            'pnl': pnl,
                            'return': returns * 100,
                            'reason': exit_reason,
                            'confidence': float(f"{prediction * 100:.1f}"),  # Convert to percentage with 1 decimal
                            'regime': current_regime
                        })
                        
                        position = False
                        entry_price = 0
                        last_trade_time = current_time
            
            # Close any open position at the end
            if position:
                current_price = df['close'].iloc[-1]
                pnl = (current_price - entry_price) * units
                balance += pnl
                
                trades.append({
                    'timestamp': df.index[-1],
                    'action': 'SELL',
                    'price': current_price,
                    'units': units,
                    'balance': balance,
                    'pnl': pnl,
                    'return': (pnl / (entry_price * units)) * 100,
                    'reason': 'End of Period',
                    'confidence': float(f"{prediction * 100:.1f}"),  # Convert to percentage with 1 decimal
                    'regime': df['regime'].iloc[-1]
                })
            
            return pd.DataFrame(trades) if trades else None
            
        except Exception as e:
            console.print(f"[red]Error in backtest: {str(e)}[/red]")
            logging.error(f"Error in backtest: {str(e)}")
            raise
    
    def calculate_accuracy(self, X, y):
        """Calculate accuracy for PyTorch model"""
        self.model.eval()
        with torch.no_grad():
            X_tensor = torch.FloatTensor(X).to(DEVICE)
            y_tensor = torch.FloatTensor(y).to(DEVICE)
            predictions = (self.model(X_tensor) >= 0.5).float().squeeze()
            accuracy = (predictions == y_tensor).float().mean().item()
        return accuracy

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
            
            # Calculate model accuracy
            train_accuracy = self.calculate_accuracy(self.X_train, self.y_train)
            test_accuracy = self.calculate_accuracy(self.X_test, self.y_test)
            
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
                    'confidence': float(trade['confidence']),  # Already in percentage
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
            
            # Get feature importance scores
            importance_scores = self.get_feature_importance()
            
            # Create DataFrame with all features (including those with zero importance)
            feature_importance = pd.DataFrame(
                [(feat, importance_scores.get(feat, 0.0)) for feat in self.feature_columns],
                columns=['feature', 'importance']
            )
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
                'train_accuracy': f"{train_accuracy * 100:.2f}",
                'test_accuracy': f"{test_accuracy * 100:.2f}",
                'features': self.feature_columns,
                'trades': trades_list,
                'chart_data': chart_data,
                'feature_importance_data': feature_importance_data,
                'regime_stats': regime_stats_flat,
                'training_metrics': self.training_metrics  # Add training metrics
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

    def optimize_parameters(self, df):
        """Optimize trading parameters using walk-forward optimization"""
        try:
            console.print("\n[cyan]Optimizing trading parameters using walk-forward analysis...[/cyan]")
            
            # Use only validation data (last 20% of data)
            split_idx = int(len(df) * 0.8)
            df_val = df[split_idx:].copy()
            
            # Initialize tracking variables
            best_params = None
            best_score = -np.inf
            best_trades = None
            
            # Grid search parameters with more granular confidence thresholds
            param_grid = {
                'min_confidence': [0.55, 0.60, 0.65, 0.70, 0.75],  # Lower minimum confidence
                'stop_loss': [0.005, 0.01, 0.015, 0.02, 0.025],    # Tighter stop losses
                'take_profit': [0.01, 0.015, 0.02, 0.025, 0.03]    # More realistic take profits
            }
            
            total_combinations = len(param_grid['min_confidence']) * len(param_grid['stop_loss']) * len(param_grid['take_profit'])
            
            # Create results table
            results_table = Table(
                title="Parameter Optimization Results",
                show_header=True,
                header_style="bold magenta"
            )
            results_table.add_column("Confidence", justify="center")
            results_table.add_column("Stop Loss", justify="center")
            results_table.add_column("Take Profit", justify="center")
            results_table.add_column("Win Rate", justify="center")
            results_table.add_column("Profit Factor", justify="center")
            results_table.add_column("Sharpe Ratio", justify="center")
            results_table.add_column("Total Return", justify="center")
            
            with Progress() as progress:
                task = progress.add_task("[cyan]Optimizing parameters...", total=total_combinations)
                
                for min_conf in param_grid['min_confidence']:
                    for stop_loss in param_grid['stop_loss']:
                        for take_profit in param_grid['take_profit']:
                            # Run backtest
                            trades_df = self.backtest(
                                df_val,
                                base_stop_loss=stop_loss,
                                base_take_profit=take_profit,
                                min_confidence=min_conf
                            )
                            
                            if trades_df is not None and len(trades_df) > 0:
                                sell_trades = trades_df[trades_df['action'] == 'SELL']
                                if len(sell_trades) >= 5:  # Minimum number of trades
                                    # Calculate metrics
                                    returns = sell_trades['return'].values
                                    win_rate = len(sell_trades[sell_trades['pnl'] > 0]) / len(sell_trades) * 100
                                    
                                    # Calculate profit factor
                                    winning_trades = sell_trades[sell_trades['pnl'] > 0]['pnl'].sum()
                                    losing_trades = abs(sell_trades[sell_trades['pnl'] < 0]['pnl'].sum())
                                    profit_factor = winning_trades / losing_trades if losing_trades != 0 else winning_trades
                                    
                                    # Calculate Sharpe ratio (annualized)
                                    returns_mean = np.mean(returns)
                                    returns_std = np.std(returns) + 1e-6
                                    sharpe_ratio = returns_mean / returns_std * np.sqrt(365 * 24 / 4)
                                    
                                    # Calculate total return
                                    total_return = (trades_df.iloc[-1]['balance'] - self.initial_balance) / self.initial_balance * 100
                                    
                                    # Calculate trades per day
                                    days = (df_val.index[-1] - df_val.index[0]).days
                                    trades_per_day = len(sell_trades) / max(days, 1)
                                    
                                    # Add row to results table
                                    results_table.add_row(
                                        f"{min_conf:.2f}",
                                        f"{stop_loss:.3f}",
                                        f"{take_profit:.3f}",
                                        f"{win_rate:.1f}%",
                                        f"{profit_factor:.2f}",
                                        f"{sharpe_ratio:.2f}",
                                        f"{total_return:.1f}%"
                                    )
                                    
                                    # Calculate score
                                    score = (
                                        sharpe_ratio * 0.3 +
                                        (win_rate/100) * 0.3 +
                                        profit_factor * 0.2 +
                                        (total_return/100) * 0.2
                                    )
                                    
                                    if score > best_score:
                                        best_score = score
                                        best_params = {
                                            'min_confidence': min_conf,
                                            'stop_loss': stop_loss,
                                            'take_profit': take_profit,
                                            'metrics': {
                                                'win_rate': win_rate,
                                                'profit_factor': profit_factor,
                                                'sharpe_ratio': sharpe_ratio,
                                                'total_return': total_return,
                                                'score': score,
                                                'trades_per_day': trades_per_day
                                            }
                                        }
                                        best_trades = trades_df.copy()
                            
                            progress.update(task, advance=1)
            
            # Display results
            console.print("\n")
            console.print(results_table)
            
            if best_params:
                console.print("\n[bold green]🎯 Best Parameters Found:[/bold green]")
                console.print(f"Minimum confidence: {best_params['min_confidence']:.2f}")
                console.print(f"Stop Loss: {best_params['stop_loss']:.3f}")
                console.print(f"Take Profit: {best_params['take_profit']:.3f}")
                
                console.print("\n[bold yellow]📈 Performance Metrics:[/bold yellow]")
                console.print(f"Win Rate: {best_params['metrics']['win_rate']:.2f}%")
                console.print(f"Profit Factor: {best_params['metrics']['profit_factor']:.2f}")
                console.print(f"Sharpe Ratio: {best_params['metrics']['sharpe_ratio']:.2f}")
                console.print(f"Total Return: {best_params['metrics']['total_return']:.2f}%")
                console.print(f"Trades per Day: {best_params['metrics']['trades_per_day']:.2f}")
                console.print(f"Overall Score: {best_params['metrics']['score']:.2f}")
                
                if best_trades is not None and len(best_trades) > 0:
                    sell_trades = best_trades[best_trades['action'] == 'SELL']
                    regime_stats = sell_trades.groupby('regime').agg({
                        'pnl': ['count', 'mean', 'sum'],
                        'return': 'mean'
                    }).round(2)
                    
                    console.print("\n[bold magenta]📊 Trade Statistics by Market Regime:[/bold magenta]")
                    console.print(regime_stats)
                
                return best_params
            
            return None
            
        except Exception as e:
            console.print(f"[red]Error optimizing parameters: {str(e)}[/red]")
            logging.error(f"Error optimizing parameters: {str(e)}")
            raise

    def get_feature_importance(self):
        """Calculate feature importance using gradient-based approach"""
        try:
            if self.model is None:
                return None

            # Use both training and test data
            X = np.vstack([self.X_train, self.X_test])
            y = np.hstack([self.y_train, self.y_test])
            
            # Scale features
            X_scaled = self.scaler.transform(X)
            X_tensor = torch.FloatTensor(X_scaled).to(dtype=torch.float32).to(DEVICE)
            y_tensor = torch.FloatTensor(y).to(dtype=torch.float32).to(DEVICE)
            
            importance_scores = np.zeros(X.shape[1])
            self.model.train()  # Set to train mode to enable gradient computation
            
            # Calculate importance for each feature using gradients
            for i in range(X.shape[1]):
                X_temp = X_tensor.clone()
                X_temp.requires_grad = True
                
                # Forward pass
                output = self.model(X_temp)
                loss = nn.BCELoss()(output.squeeze(), y_tensor)
                
                # Backward pass
                loss.backward()
                
                # Use gradients as importance
                importance_scores[i] = torch.abs(X_temp.grad[:, i]).mean().item()
            
            # Normalize importance scores
            importance_scores = np.abs(importance_scores)
            importance_scores = importance_scores / importance_scores.sum()
            
            # Create feature importance dictionary
            feature_importance = {
                feat: float(imp)
                for feat, imp in zip(self.feature_columns, importance_scores)
            }
            
            # Sort by importance
            feature_importance = dict(
                sorted(feature_importance.items(), key=lambda x: x[1], reverse=True)
            )
            
            return feature_importance
            
        except Exception as e:
            console.print(f"[red]Error calculating feature importance: {str(e)}[/red]")
            logging.error(f"Error calculating feature importance: {str(e)}")
            raise

    def fetch_data(self, days=100):
        """Fetch historical data from Binance"""
        try:
            console.print("[cyan]Fetching historical data for {}...[/cyan]".format(self.symbol))
            
            # Calculate date range
            end_date = datetime.now()
            start_date = end_date - timedelta(days=days)
            
            # Initialize Binance client
            client = Client(None, None)
            
            # Fetch historical klines/candlestick data
            klines = client.get_historical_klines(
                self.symbol,
                Client.KLINE_INTERVAL_15MINUTE,
                start_str=str(int(start_date.timestamp() * 1000)),
                end_str=str(int(end_date.timestamp() * 1000))
            )
            
            # Convert to DataFrame
            df = pd.DataFrame(klines, columns=[
                'timestamp', 'open', 'high', 'low', 'close', 'volume',
                'close_time', 'quote_asset_volume', 'number_of_trades',
                'taker_buy_base_asset_volume', 'taker_buy_quote_asset_volume', 'ignore'
            ])
            
            # Convert timestamp to datetime
            df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
            df.set_index('timestamp', inplace=True)
            
            # Convert numeric columns
            numeric_columns = ['open', 'high', 'low', 'close', 'volume']
            df[numeric_columns] = df[numeric_columns].astype(float)
            
            return df
            
        except Exception as e:
            console.print(f"[red]Error fetching data: {str(e)}[/red]")
            logging.error(f"Error fetching data: {str(e)}")
            raise

    def get_cached_data_path(self, symbol, start_date, end_date):
        """Get path for cached data file"""
        data_dir = Path('historical_data')
        data_dir.mkdir(exist_ok=True)
        return data_dir / f'{symbol}_data_{start_date.strftime("%Y%m%d")}_{end_date.strftime("%Y%m%d")}.csv'

    def load_or_fetch_data(self, days=100):
        """Load data from cache or fetch from Binance if not available"""
        try:
            # Calculate date range
            end_date = datetime.now()
            start_date = end_date - timedelta(days=days)
            
            # Get cached data path
            cache_path = self.get_cached_data_path(self.symbol, start_date, end_date)
            
            # Check if cached data exists and is from today
            if cache_path.exists():
                df = pd.read_csv(cache_path, index_col='timestamp', parse_dates=True)
                cache_end_date = df.index[-1]
                
                # If cache is from today and has enough data, use it
                if cache_end_date.date() == end_date.date() and len(df) >= days * 96:  # 96 15-min intervals per day
                    console.print(f"[green]Using cached data from: {cache_path}[/green]")
                    return df
            
            # Fetch new data if cache doesn't exist or is outdated
            console.print("[cyan]Fetching new historical data...[/cyan]")
            df = self.fetch_data(days=days)
            
            # Save to cache
            df.to_csv(cache_path)
            console.print(f"[green]Data cached to: {cache_path}[/green]")
            
            return df
            
        except Exception as e:
            console.print(f"[red]Error loading/fetching data: {str(e)}[/red]")
            logging.error(f"Error loading/fetching data: {str(e)}")
            raise

def main():
    try:
        # Parse command line arguments
        parser = argparse.ArgumentParser(description='ML-based Trading Strategy')
        parser.add_argument('--symbol', type=str, default='BTCUSDT', help='Trading pair symbol')
        parser.add_argument('--days', type=int, default=60, help='Number of days of historical data')
        parser.add_argument('--balance', type=float, default=10000, help='Initial balance')
        parser.add_argument('--optimize', action='store_true', help='Optimize trading parameters')
        args = parser.parse_args()
        
        # Initialize ML trader
        ml_trader = MLTrader(args.symbol, args.balance)
        
        # Load or fetch historical data
        df = ml_trader.load_or_fetch_data(days=args.days)
        
        # Train model
        if ml_trader.train_model(df):
            if args.optimize:
                # Optimize parameters
                best_params = ml_trader.optimize_parameters(df)
                if best_params:
                    # Run backtest with optimized parameters
                    console.print("\n[cyan]Running backtest with optimized parameters...[/cyan]")
                    trades_df = ml_trader.backtest(
                        df,
                        base_stop_loss=best_params['stop_loss'],
                        base_take_profit=best_params['take_profit'],
                        min_confidence=best_params['min_confidence']
                    )
                    
                    if trades_df is not None and len(trades_df) > 0:
                        # Calculate final statistics
                        total_trades = len(trades_df[trades_df['action'] == 'SELL'])
                        profitable_trades = len(trades_df[trades_df['pnl'] > 0])
                        win_rate = profitable_trades / total_trades * 100 if total_trades > 0 else 0
                        final_balance = trades_df.iloc[-1]['balance']
                        total_return = (final_balance - args.balance) / args.balance * 100
                        
                        console.print("\n[bold green]Trading Results:[/bold green]")
                        console.print(f"Total Trades: {total_trades}")
                        console.print(f"Trades per Day: {total_trades/args.days:.2f}")
                        console.print(f"Profitable Trades: {profitable_trades}")
                        console.print(f"Win Rate: {win_rate:.2f}%")
                        console.print(f"Final Balance: ${final_balance:.2f}")
                        console.print(f"Total Return: {total_return:.2f}%")
                        
                        # Plot results
                        ml_trader.plot_results(df, trades_df)
                        
                        # Save trades to CSV
                        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                        trades_file = f"backtest_results/ml_trades_{args.symbol}_{timestamp}.csv"
                        os.makedirs("backtest_results", exist_ok=True)
                        trades_df.to_csv(trades_file)
                        console.print(f"\nTrades saved to: {trades_file}")
                        
    except Exception as e:
        console.print(f"[red]Error: {str(e)}[/red]")
        logging.error(f"Error in main: {str(e)}")
        raise

if __name__ == "__main__":
    start_time = datetime.now()
    main()
    execution_time = datetime.now() - start_time
    hours = execution_time.seconds // 3600
    minutes = (execution_time.seconds % 3600) // 60
    seconds = execution_time.seconds % 60
    console.print(f"Execution time: {hours}h:{minutes:02d}m:{seconds:02d}s sec") 