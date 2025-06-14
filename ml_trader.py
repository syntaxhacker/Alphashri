import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, TensorDataset
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import f1_score, accuracy_score
import talib as ta
from binance.client import Client
from datetime import datetime, timedelta
from pathlib import Path
import logging
import wandb
from rich.console import Console
from rich.progress import Progress
from jinja2 import Template
import matplotlib.pyplot as plt
from sklearn.model_selection import train_test_split
import pandas_ta as ta_pd
import os
import joblib
from concurrent.futures import ThreadPoolExecutor
import platform
import matplotlib
matplotlib.use('Agg')  # Set the backend to Agg before importing pyplot
import argparse
import optuna
from optuna.trial import TrialState
import shap
from sklearn.cluster import AgglomerativeClustering
import time
import random
from torch.backends import cudnn
from sklearn.random_projection import GaussianRandomProjection

# Initialize console
console = Console()

# Set device
DEVICE = 'mps' if torch.backends.mps.is_available() else 'cpu'
console.print(f"Using device: {DEVICE}")

def set_seeds(seed=42):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    cudnn.deterministic = True
    cudnn.benchmark = False

# Call this before any random operations
set_seeds(int(time.time()))  # Different seed each run

class EarlyStopping:
    def __init__(self, patience=10, min_delta=0.001, mode='max'):
        self.patience = patience
        self.min_delta = min_delta
        self.mode = mode
        self.counter = 0
        self.best_score = float('-inf') if mode == 'max' else float('inf')
        
    def __call__(self, score):
        if self.mode == 'max':
            if score > self.best_score + self.min_delta:
                self.best_score = score
                self.counter = 0
                return False
        else:
            if score < self.best_score - self.min_delta:
                self.best_score = score
                self.counter = 0
                return False
                
        self.counter += 1
        return self.counter >= self.patience

class AdvancedModel(nn.Module):
    def __init__(self, input_dim, n_layers=3, first_layer=448, layer_shrink=0.565, dropout=0.4, device='cpu'):
        super().__init__()
        self.device = device
        
        # Add architecture randomization
        self.architecture_seed = int(time.time() * 1000) % 10000
        torch.manual_seed(self.architecture_seed)
        
        # Randomize architecture parameters
        n_layers = np.random.randint(2, 5)  # Random number of layers
        first_layer = np.random.randint(256, 512)  # Random first layer size
        layer_shrink = np.random.uniform(0.4, 0.7)  # Random shrink factor
        dropout = np.random.uniform(0.2, 0.5)  # Random dropout
        
        # Initialize layers list with diverse activation functions
        layers = []
        current_dim = input_dim
        next_dim = first_layer
        
        # List of possible activation functions
        activations = [
            nn.GELU(),
            nn.LeakyReLU(negative_slope=np.random.uniform(0.01, 0.2)),
            nn.ELU(alpha=np.random.uniform(0.1, 1.0)),
            nn.ReLU()
        ]
        
        # Add layers with decreasing size and random activations
        for i in range(n_layers):
            # Random layer size adjustment
            size_noise = np.random.uniform(0.9, 1.1)
            next_dim = int(next_dim * size_noise)
            
            # Add main layer
            layers.extend([
                nn.Linear(current_dim, next_dim),
                nn.LayerNorm(next_dim),
                np.random.choice(activations),  # Random activation
                nn.Dropout(dropout * np.random.uniform(0.8, 1.2))  # Varying dropout
            ])
            
            # Randomly add residual connections
            if i > 0 and current_dim == next_dim and np.random.random() > 0.5:
                layers.append(nn.Identity())  # Residual connection
            
            current_dim = next_dim
            next_dim = int(next_dim * layer_shrink)
        
        # Output layer with normalized initialization
        layers.extend([
            nn.Linear(current_dim, 1),
            nn.LayerNorm(1)
        ])
        
        # Combine all layers
        self.network = nn.Sequential(*layers)
        
        # Initialize weights with diversity
        self._init_weights_with_diversity()
    
    def _init_weights_with_diversity(self):
        """Initialize weights with controlled randomness"""
        for m in self.modules():
            if isinstance(m, nn.Linear):
                # Random initialization method
                init_method = np.random.choice([
                    'kaiming_normal',
                    'kaiming_uniform',
                    'xavier_normal',
                    'xavier_uniform'
                ])
                
                # Random initialization parameters
                gain = np.random.uniform(0.8, 1.2)
                fan_mode = np.random.choice(['fan_in', 'fan_out'])
                
                if init_method == 'kaiming_normal':
                    nn.init.kaiming_normal_(
                        m.weight,
                        mode=fan_mode,
                        nonlinearity='linear'
                    )
                elif init_method == 'kaiming_uniform':
                    nn.init.kaiming_uniform_(
                        m.weight,
                        mode=fan_mode,
                        nonlinearity='linear'
                    )
                elif init_method == 'xavier_normal':
                    nn.init.xavier_normal_(m.weight, gain=gain)
                else:
                    nn.init.xavier_uniform_(m.weight, gain=gain)
                
                if m.bias is not None:
                    # Initialize bias with small random values
                    nn.init.uniform_(m.bias, -0.1, 0.1)
    
    def forward(self, x):
        return self.network(x)
        
    def reset_architecture(self):
        """Reset architecture with new random parameters"""
        self.__init__(
            input_dim=self.network[0].in_features,
            device=self.device
        )

class MLTrader:
    def __init__(self, symbol, initial_balance=1000, random_state=42):
        """Initialize ML trader"""
        self.symbol = symbol
        self.initial_balance = initial_balance
        self.model = None
        self.data = None
        self.scaler = StandardScaler()
        self.feature_columns = []  # Will be populated in create_features
        self.random_state = random_state
        
        # Set random seeds for reproducibility
        np.random.seed(self.random_state)
        torch.manual_seed(self.random_state)
        if torch.backends.mps.is_available():
            torch.mps.manual_seed(self.random_state)
        
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
        """Prepare features with strict backward-looking calculations"""
        try:
            # Change from shift(-4) to shift(4) for backward-looking returns
            df = df.assign(
                returns_1h=df['close'].shift(4).pct_change(4, fill_method=None),  # Look back 1 hour
                returns_4h=df['close'].shift(16).pct_change(16, fill_method=None),  # Look back 4 hours
                returns_24h=df['close'].shift(96).pct_change(96, fill_method=None)  # Look back 24 hours
            )
            
            # Keep only rows where all returns are available
            df = df.dropna(subset=['returns_1h', 'returns_4h', 'returns_24h'])
            
            # Add multi-level empty validation
            if df.empty or len(df) < 100:
                console.print(f"[red]Insufficient data: {len(df)} rows[/red]")
                logging.error(f"Data check failed - rows: {len(df)}, cols: {len(df.columns)}")
                raise ValueError("Insufficient input data for feature engineering")

            df = df.copy()
            
            # Add feature validation before processing
            required_columns = {'open', 'high', 'low', 'close', 'volume'}
            missing = required_columns - set(df.columns)
            if missing:
                console.print(f"[red]Missing required columns: {missing}[/red]")
                raise KeyError(f"Missing price data columns: {missing}")
            
            # Initialize feature columns list
            self.feature_columns = [
                # Price-based features
                'sma_20', 'sma_50', 'sma_100',
                'ema_20', 'ema_50', 'ema_100',
                'ma_cross_20', 'ma_cross_50',
                
                # MACD features
                'macd_12_26', 'macd_signal_12_26', 'macd_hist_12_26',
                'macd_5_35', 'macd_signal_5_35', 'macd_hist_5_35',
                
                # RSI and momentum
                'rsi_14', 'rsi_21', 'rsi_50',
                'mom_14', 'mom_21', 'mom_50',
                'roc_14', 'roc_21', 'roc_50',
                'willr_14', 'willr_21', 'willr_50',
                
                # Bollinger Bands
                'bb_lower_20', 'bb_middle_20', 'bb_upper_20',
                'bb_width_20', 'bb_percent_20',
                
                # Volatility
                'volatility_14', 'volatility_21', 'volatility_50',
                'atr_14', 'atr_21', 'atr_50',
                
                # Volume
                'volume_ma_20', 'volume_std_20', 'volume_change_20',
                'vpt_20', 'volume_intensity',
                
                # Price changes
                'price_change_1', 'price_change_2', 'price_change_5',
                'price_vol_1', 'price_vol_5',
                
                # Price patterns
                'high_low_ratio', 'close_open_ratio', 'body_size',
                'upper_shadow', 'lower_shadow',
                
                # Market regime
                'trend_strength', 'volatility_regime'
            ]
            
            # Price-based features
            for period in [20, 50, 100]:
                df[f'sma_{period}'] = ta.SMA(df['close'], timeperiod=period)
                df[f'ema_{period}'] = ta.EMA(df['close'], timeperiod=period)
            
            # MA Crossovers (using past data only)
            df['ma_cross_20'] = df['sma_20'] - df['sma_50']
            df['ma_cross_50'] = df['sma_50'] - df['sma_100']
            
            # MACD features
            macd, signal, hist = ta.MACD(df['close'], fastperiod=12, slowperiod=26, signalperiod=9)
            df['macd_12_26'] = macd
            df['macd_signal_12_26'] = signal
            df['macd_hist_12_26'] = hist
            
            # Additional MACD with different periods
            macd, signal, hist = ta.MACD(df['close'], fastperiod=5, slowperiod=35, signalperiod=5)
            df['macd_5_35'] = macd
            df['macd_signal_5_35'] = signal
            df['macd_hist_5_35'] = hist
            
            # RSI and momentum
            for period in [14, 21, 50]:
                df[f'rsi_{period}'] = ta.RSI(df['close'], timeperiod=period)
                df[f'mom_{period}'] = ta.MOM(df['close'], timeperiod=period)
                df[f'roc_{period}'] = ta.ROC(df['close'], timeperiod=period)
                df[f'willr_{period}'] = ta.WILLR(df['high'], df['low'], df['close'], timeperiod=period)
            
            # Bollinger Bands
            upper, middle, lower = ta.BBANDS(df['close'], timeperiod=20)
            df['bb_upper_20'] = upper
            df['bb_middle_20'] = middle
            df['bb_lower_20'] = lower
            df['bb_width_20'] = (upper - lower) / middle
            df['bb_percent_20'] = (df['close'] - lower) / (upper - lower)
            
            # Volatility
            for period in [14, 21, 50]:
                df[f'volatility_{period}'] = df['close'].pct_change().rolling(window=period).std()
                df[f'atr_{period}'] = ta.ATR(df['high'], df['low'], df['close'], timeperiod=period)
            
            # Volume
            df['volume_ma_20'] = ta.SMA(df['volume'], timeperiod=20)
            df['volume_std_20'] = df['volume'].rolling(window=20).std()
            df['volume_change_20'] = df['volume'].pct_change(20)
            df['vpt_20'] = ta.SMA(df['volume'] * df['close'].pct_change(), timeperiod=20)
            df['volume_intensity'] = (df['volume'] / df['volume'].rolling(window=20).mean()) * df['close'].pct_change()
            
            # Price changes (using past data only)
            df['price_change_1'] = df['close'].pct_change(1)
            df['price_change_2'] = df['close'].pct_change(2)
            df['price_change_5'] = df['close'].pct_change(5)
            df['price_vol_1'] = df['price_change_1'] * (df['volume'] / df['volume'].rolling(window=20).mean())
            df['price_vol_5'] = df['price_change_5'] * (df['volume'] / df['volume'].rolling(window=20).mean())
            
            # Price patterns
            df['high_low_ratio'] = (df['high'] - df['low']) / df['low']
            df['close_open_ratio'] = (df['close'] - df['open']) / df['open']
            df['body_size'] = abs(df['close'] - df['open'])
            df['upper_shadow'] = df['high'] - df[['open', 'close']].max(axis=1)
            df['lower_shadow'] = df[['open', 'close']].min(axis=1) - df['low']
            
            # Market regime features
            df['trend_strength'] = abs(ta.LINEARREG_SLOPE(df['close'], timeperiod=20))
            df['volatility_regime'] = df['volatility_21'].rolling(window=20).mean()
            
            # Drop rows with NaN values
            df = df.dropna()
            
            # Add safe feature normalization
            for col in self.feature_columns:
                if df[col].nunique() < 2:  # Prevent division by zero
                    df[col] = np.random.normal(0, 0.1, size=len(df))
            
            # Add random noise to features
            noise_level = 0.0001  # Adjust based on feature scale
            for col in self.feature_columns:
                df[col] += np.random.normal(0, noise_level, size=len(df))
            
            # Add random rotation of features
            rotation_matrix = np.random.randn(len(self.feature_columns), len(self.feature_columns))
            Q, _ = np.linalg.qr(rotation_matrix)
            df[self.feature_columns] = df[self.feature_columns].values.dot(Q)
            
            # Add stochastic feature interactions
            for _ in range(3):  # Create 3 random interaction terms
                col1, col2 = np.random.choice(self.feature_columns, 2, replace=False)
                df[f'{col1}_x_{col2}'] = df[col1] * df[col2] * np.random.uniform(0.8, 1.2)
            
            # Add random Fourier features
            n_components = 5
            transformer = GaussianRandomProjection(n_components=n_components)
            rff = transformer.fit_transform(df[self.feature_columns])
            for i in range(n_components):
                df[f'rff_{i}'] = rff[:, i]
            
            # Final validation before return
            if df.empty or len(df) < 50:
                console.print(f"[red]Feature engineering failed - final df: {len(df)} rows[/red]")
                raise ValueError("Feature pipeline produced empty dataset")

            return df
            
        except Exception as e:
            console.print(f"[red]Critical error in feature preparation: {str(e)}[/red]")
            logging.exception("Feature preparation failure")
            raise
    
    def create_features(self, df):
        """Create feature matrix for ML model"""
        try:
            # Select features from the enhanced feature set
            feature_columns = [
                # Price-based features
                'sma_20', 'sma_50', 'sma_100',
                'ema_20', 'ema_50', 'ema_100',
                'ma_cross_20', 'ma_cross_50',
                
                # MACD features
                'macd_12_26', 'macd_signal_12_26', 'macd_hist_12_26',
                'macd_5_35', 'macd_signal_5_35', 'macd_hist_5_35',
                
                # RSI and momentum
                'rsi_14', 'rsi_21', 'rsi_50',
                'mom_14', 'mom_21', 'mom_50',  # Changed periods to match
                'roc_14', 'roc_21', 'roc_50',  # Changed periods to match
                'willr_14', 'willr_21', 'willr_50',  # Changed periods to match
                
                # Bollinger Bands
                'bb_lower_20', 'bb_middle_20', 'bb_upper_20',
                'bb_width_20', 'bb_percent_20',
                
                # Volatility
                'volatility_14', 'volatility_21', 'volatility_50',
                'atr_14', 'atr_21', 'atr_50',
                
                # Volume
                'volume_ma_20', 'volume_std_20', 'volume_change_20',
                'vpt_20', 'volume_intensity',
                
                # Price changes
                'price_change_1', 'price_change_2', 'price_change_5',
                'price_vol_1', 'price_vol_5',
                
                # Price patterns
                'high_low_ratio', 'close_open_ratio', 'body_size',
                'upper_shadow', 'lower_shadow',
                
                # Market regime
                'trend_strength', 'volatility_regime'
            ]
            
            # Ensure all required columns exist
            missing_columns = [col for col in feature_columns if col not in df.columns]
            if missing_columns:
                raise ValueError(f"Missing columns in DataFrame: {missing_columns}")
            
            # Update feature columns
            self.feature_columns = feature_columns
            
            X = df[feature_columns].values
            y = df['target'].values
            
            return X, y
            
        except Exception as e:
            console.print(f"[red]Error creating features: {str(e)}[/red]")
            logging.error(f"Error creating features: {str(e)}")
            raise
    
    def create_model(self):
        """Create an improved neural network model with advanced architecture"""
        try:
            input_dim = len(self.feature_columns)
            
            # Initialize model with default parameters
            model = AdvancedModel(input_dim).to(DEVICE)
            
            return model
            
        except Exception as e:
            console.print(f"[red]Error creating model: {str(e)}[/red]")
            logging.error(f"Error creating model: {str(e)}")
            raise

    def visualize_model(self):
        """Visualize the neural network architecture"""
        try:
            # Create a sample batch input (using 2 samples to satisfy BatchNorm)
            x = torch.randn(32, len(self.feature_columns)).to(DEVICE)
            
            # Set model to eval mode to avoid BatchNorm issues
            self.model.eval()
            
            # Get the output
            y = self.model(x)
            
            # Create the dot graph
            dot = make_dot(y.mean(), params=dict(self.model.named_parameters()))
            
            # Save the graph
            dot.render("model_architecture", format="png", cleanup=True)
            console.print("[green]Model architecture saved as 'model_architecture.png'[/green]")
            
        except Exception as e:
            console.print(f"[red]Error visualizing model: {str(e)}[/red]")
            console.print("[yellow]To visualize the model, please install graphviz and torchviz:[/yellow]")
            console.print("pip install torchviz")
            console.print("brew install graphviz  # For MacOS")

    def train_model(self, df, epochs=200, batch_size=128, learning_rate=0.0003):
        """Train the neural network model with optimized hyperparameters and adaptive thresholds"""
        try:
            # Initialize wandb
            wandb.init(project="crypto-trader")
            
            # First, optimize hyperparameters
            console.print("[cyan]Optimizing model hyperparameters...[/cyan]")
            best_params = self.optimize_model_hyperparameters(df)
            
            if best_params is None:
                console.print("[red]Hyperparameter optimization failed. Using default parameters.[/red]")
            else:
                # Update parameters with optimized values
                batch_size = best_params.get("batch_size", batch_size)
                learning_rate = best_params.get("learning_rate", learning_rate)
                
                # Update wandb config
                wandb.config.update(best_params)
            
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

            # Print initial data size
            console.print(f"[cyan]Initial data size: {len(df)} samples[/cyan]")
            
            console.print("[cyan]Preparing features...[/cyan]")
            df = self.prepare_features(df).copy()
            console.print(f"[cyan]After feature preparation: {len(df)} samples[/cyan]")
            
            if len(df) < 100:
                raise ValueError("Not enough samples after data preparation")
            
            # Generate signals with adaptive thresholds
            df = df.assign(
                returns_1h=df['close'].shift(-4).pct_change(4, fill_method=None),
                returns_4h=df['close'].shift(-16).pct_change(16, fill_method=None),
                returns_24h=df['close'].shift(-96).pct_change(96, fill_method=None),
                target=0
            )
            
            # Calculate volatility and trend
            volatility = df['close'].pct_change().rolling(window=20).std()
            trend = abs(df['close'].pct_change(20)).rolling(window=20).mean()
            
            # Dynamic thresholds
            vol_threshold = volatility.rolling(window=20).mean() * 2.0
            
            # Generate signals
            buy_signal = (
                (df['returns_1h'] > vol_threshold) &
                ((df['returns_4h'] > vol_threshold * 0.8) |
                 (df['returns_24h'] > vol_threshold * 0.6))
            )
            
            sell_signal = (
                (df['returns_1h'] < -vol_threshold) &
                ((df['returns_4h'] < -vol_threshold * 0.8) |
                 (df['returns_24h'] < -vol_threshold * 0.6))
            )
            
            # Apply signals
            df.loc[buy_signal, 'target'] = 1
            df.loc[sell_signal, 'target'] = 0
            
            # Keep only strong signals and drop NaN values
            df = df[buy_signal | sell_signal].copy()
            df = df.dropna()
            
            if len(df) < 100:
                raise ValueError("Not enough samples after signal generation")
            
            # Print signal distribution
            positive_samples = df['target'].sum()
            total_samples = len(df)
            console.print(f"[cyan]Training samples after filtering: {total_samples}[/cyan]")
            console.print(f"[cyan]Positive samples: {positive_samples} ({positive_samples/total_samples*100:.1f}%)[/cyan]")
            
            # Replace static split with randomized validation window
            val_start = np.random.choice(df.index[int(len(df)*0.6):int(len(df)*0.9)])
            df_val = df.loc[val_start:].copy()
            
            # Create splits
            train_size = int(len(df) * 0.7)
            val_size = int(len(df) * 0.15)
            
            # Create splits
            train_idx = list(range(train_size))
            val_idx = list(range(train_size, train_size + val_size))
            test_idx = list(range(train_size + val_size, len(df)))
            
            # Prepare features and targets
            X = df[self.feature_columns].values
            y = df['target'].values
            
            X_train = X[train_idx]
            y_train = y[train_idx]
            X_val = X[val_idx]
            y_val = y[val_idx]
            X_test = X[test_idx]
            y_test = y[test_idx]
            
            # Scale features
            self.scaler = StandardScaler()
            X_train = self.scaler.fit_transform(X_train)
            X_val = self.scaler.transform(X_val)
            X_test = self.scaler.transform(X_test)
            
            # Store training data as class attributes
            self.X_train = X_train
            self.y_train = y_train
            self.X_test = X_test
            self.y_test = y_test
            
            # Convert to PyTorch tensors
            X_train = torch.FloatTensor(X_train).to(DEVICE)
            y_train = torch.FloatTensor(y_train).to(DEVICE)
            X_val = torch.FloatTensor(X_val).to(DEVICE)
            y_val = torch.FloatTensor(y_val).to(DEVICE)
            X_test = torch.FloatTensor(X_test).to(DEVICE)
            y_test = torch.FloatTensor(y_test).to(DEVICE)
            
            # Create data loaders with balanced sampling
            train_dataset = TensorDataset(X_train, y_train)
            train_loader = DataLoader(
                train_dataset,
                batch_size=batch_size,
                shuffle=True,
                num_workers=0
            )
            
            # Initialize model with diversity
            self.model = AdvancedModel(
                input_dim=len(self.feature_columns),
                device=DEVICE
            ).to(DEVICE)
            
            # Initialize optimizer with cosine annealing
            optimizer = torch.optim.AdamW(
                self.model.parameters(),
                lr=learning_rate,
                weight_decay=0.01
            )
            
            # Cosine annealing scheduler
            scheduler = torch.optim.lr_scheduler.CosineAnnealingWarmRestarts(
                optimizer,
                T_0=20,
                T_mult=2,
                eta_min=1e-6
            )
            
            # Early stopping with patience
            early_stopping = EarlyStopping(patience=15, min_delta=0.0005, mode='max')
            
            # Use BCEWithLogitsLoss for better numerical stability
            criterion = nn.BCEWithLogitsLoss()
            
            console.print("[cyan]Training neural network model...[/cyan]")
            
            best_val_f1 = 0
            best_model_state = None
            
            for epoch in range(epochs):
                self.model.train()
                total_loss = 0
                train_preds = []
                train_targets = []
                
                # Training loop with progress bar
                with Progress() as progress:
                    task = progress.add_task("[cyan]Training...", total=len(train_loader))
                    
                    for batch_X, batch_y in train_loader:
                        optimizer.zero_grad()
                        
                        # Forward pass
                        outputs = self.model(batch_X).squeeze()
                        
                        # Handle dimension mismatch
                        if outputs.dim() == 0:
                            outputs = outputs.unsqueeze(0)
                        
                        # Calculate loss
                        try:
                            loss = criterion(outputs, batch_y)
                        except RuntimeError as e:
                            console.print(f"[red]Error in loss calculation: {str(e)}[/red]")
                            console.print(f"Outputs shape: {outputs.shape}, Targets shape: {batch_y.shape}")
                            raise
                        
                        # Backward pass
                        loss.backward()
                        
                        # Gradient clipping
                        torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=0.5)
                        
                        optimizer.step()
                        
                        total_loss += loss.item()
                        train_preds.extend((torch.sigmoid(outputs) >= 0.5).float().cpu().numpy())
                        train_targets.extend(batch_y.cpu().numpy())
                        
                        progress.update(task, advance=1)
                
                # Step the scheduler
                scheduler.step()
                
                # Validation phase
                self.model.eval()
                val_preds = []
                val_targets = []
                val_loss = 0
                
                with torch.no_grad():
                    outputs = self.model(X_val).squeeze()
                    
                    # Handle dimension mismatch
                    if outputs.dim() == 0:
                        outputs = outputs.unsqueeze(0)
                    
                    val_loss = criterion(outputs, y_val).item()
                    val_preds = (torch.sigmoid(outputs) >= 0.5).float().cpu().numpy()
                    val_targets = y_val.cpu().numpy()
                
                # Calculate metrics
                train_f1 = f1_score(train_targets, train_preds)
                val_f1 = f1_score(val_targets, val_preds)
                train_acc = accuracy_score(train_targets, train_preds) * 100
                val_acc = accuracy_score(val_targets, val_preds) * 100
                
                # Store metrics
                self.training_metrics['train_loss'].append(total_loss / len(train_loader))
                self.training_metrics['test_loss'].append(val_loss)
                self.training_metrics['train_f1'].append(train_f1)
                self.training_metrics['test_f1'].append(val_f1)
                self.training_metrics['train_acc'].append(train_acc)
                self.training_metrics['test_acc'].append(val_acc)
                self.training_metrics['learning_rates'].append(optimizer.param_groups[0]['lr'])
                
                # Log metrics to wandb
                wandb.log({
                    "train_loss": total_loss / len(train_loader),
                    "val_loss": val_loss,
                    "train_f1": train_f1,
                    "val_f1": val_f1,
                    "train_accuracy": train_acc,
                    "val_accuracy": val_acc,
                    "learning_rate": optimizer.param_groups[0]['lr']
                })
                
                # Save best model
                if val_f1 > best_val_f1:
                    best_val_f1 = val_f1
                    best_model_state = self.model.state_dict()
                
                # Print progress every 10 epochs
                if (epoch + 1) % 10 == 0:
                    console.print(f"Epoch {epoch + 1}/{epochs}")
                    console.print(f"Train Loss: {total_loss/len(train_loader):.4f}, Val Loss: {val_loss:.4f}")
                    console.print(f"Train F1: {train_f1:.4f}, Val F1: {val_f1:.4f}")
                    console.print(f"Train Accuracy: {train_acc:.2f}%, Val Accuracy: {val_acc:.2f}%")
                    console.print(f"Learning Rate: {optimizer.param_groups[0]['lr']:.6f}")
                
                # Early stopping check
                if early_stopping(val_f1):
                    console.print(f"[yellow]Early stopping triggered! Best validation F1: {best_val_f1:.4f}[/yellow]")
                    break
            
            # Load best model
            if best_model_state is not None:
                self.model.load_state_dict(best_model_state)
            
            # Final evaluation on test set
            self.model.eval()
            with torch.no_grad():
                test_outputs = self.model(X_test).squeeze()
                
                # Handle dimension mismatch
                if test_outputs.dim() == 0:
                    test_outputs = test_outputs.unsqueeze(0)
                
                test_preds = (torch.sigmoid(test_outputs) >= 0.5).float().cpu().numpy()
                test_f1 = f1_score(y_test.cpu().numpy(), test_preds)
                test_acc = accuracy_score(y_test.cpu().numpy(), test_preds) * 100
            
            console.print(f"[green]Final Test F1: {test_f1:.4f}[/green]")
            console.print(f"[green]Final Test Accuracy: {test_acc:.2f}%[/green]")
            
            # Save the model
            model_dir = Path('models')
            model_dir.mkdir(exist_ok=True)
            model_path = model_dir / f'pytorch_model_{self.symbol}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.pth'
            torch.save({
                'model_state_dict': self.model.state_dict(),
                'scaler_state': self.scaler,
                'feature_columns': self.feature_columns,
                'best_val_f1': best_val_f1,
                'test_f1': test_f1,
                'test_accuracy': test_acc
            }, model_path)
            console.print(f"[green]Model saved to: {model_path}[/green]")
            
            # Finish wandb run
            wandb.finish()
            return True
            
        except Exception as e:
            console.print(f"[red]Error training model: {str(e)}[/red]")
            logging.error(f"Error training model: {str(e)}")
            wandb.finish()
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
                'confidence': 1.03,  # Reduced from 1.05
                'stop_loss': 1.2,   
                'take_profit': 1.5  
            },
            'WEAK_TREND': {
                'confidence': 1.01,   # Reduced from 1.02
                'stop_loss': 1.1,    
                'take_profit': 1.3   
            },
            'VOLATILE_RANGE': {
                'confidence': 1.05,    # Reduced from 1.08
                'stop_loss': 0.9,     # Reduced from 1.0
                'take_profit': 1.2    
            },
            'QUIET_RANGE': {
                'confidence': 0.98,    # Reduced from 1.0
                'stop_loss': 0.9,     # Reduced from 1.0
                'take_profit': 1.2    
            }
        }
        
        default_thresholds = {
            'confidence': 1.0,
            'stop_loss': 1.0,
            'take_profit': 1.0
        }
        
        # Get thresholds for the current regime or use defaults
        regime_thresholds = thresholds.get(regime, default_thresholds)
        
        # Convert values to float to ensure they're scalar
        return {
            'confidence': float(regime_thresholds['confidence']),
            'stop_loss': float(regime_thresholds['stop_loss']),
            'take_profit': float(regime_thresholds['take_profit'])
        }

    def backtest(self, df, base_stop_loss=0.02, base_take_profit=0.04, min_confidence=0.7):
        """Backtest with improved position sizing"""
        try:
            # Add ATR-based position sizing
            df['atr'] = ta.ATR(df['high'], df['low'], df['close'], timeperiod=14)
            
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
                prediction = float(probabilities[i])  # Convert to scalar
                
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
            cooldown_periods = 2  # Reduced from 4 to 2 (30min cooldown)
            
            # Run backtest
            for i in range(len(df)-1):
                current_price = float(df['close'].iloc[i])  # Convert to scalar
                current_time = df.index[i]
                current_regime = df['regime'].iloc[i]
                prediction = float(df['prediction'].iloc[i])  # Convert to scalar
                signal = df['signal'].iloc[i]
                
                # Check if we're in cooldown
                if last_trade_time is not None:
                    periods_since_last_trade = (current_time - last_trade_time).total_seconds() / (15 * 60)
                    if periods_since_last_trade < cooldown_periods:
                        continue
                
                if not position and signal == 1:
                    # Get regime-specific parameters
                    regime_thresholds = self.get_adaptive_thresholds(current_regime)
                    
                    # Risk-adjusted position sizing with fixed risk per trade
                    max_risk = 0.03  # Risk 3% of balance per trade
                    
                    # Dynamic position sizing factors
                    confidence_factor = float(min(prediction / min_confidence, 1.5))  # Scale up to 50% more for high confidence
                    
                    # Regime-based position sizing multiplier
                    regime_position_multipliers = {
                        'STRONG_TREND': 1.2,
                        'WEAK_TREND': 1.0,
                        'VOLATILE_RANGE': 0.8,
                        'QUIET_RANGE': 1.0
                    }
                    regime_multiplier = regime_position_multipliers.get(current_regime, 1.0)
                    
                    # Volatility adjustment using ATR
                    atr = float(df['atr'].iloc[i])
                    volatility_factor = 1.0
                    if atr > 0:
                        avg_atr = df['atr'].rolling(14).mean().iloc[i]
                        if avg_atr > 0:
                            volatility_factor = min(avg_atr / atr, 1.2)  # Reduce size in high volatility, up to 20% reduction
                    
                    # Calculate final position size with all factors
                    position_size = (max_risk * balance * confidence_factor * regime_multiplier * volatility_factor) / base_stop_loss
                    position_size = min(position_size, balance * 0.2)  # Cap at 20% of balance
                    units = position_size / current_price
                    
                    # Track entry index for maximum holding period
                    entry_index = i
                    position = True
                    entry_price = current_price
                    
                    trades.append({
                        'timestamp': df.index[i],
                        'action': 'BUY',
                        'price': current_price,
                        'units': units,
                        'balance': balance,
                        'confidence': float(f"{prediction * 100:.1f}"),  # Convert to percentage with 1 decimal
                        'regime': current_regime,
                        'position_size_pct': float(f"{(position_size / balance) * 100:.1f}"),  # Add position size percentage
                        'pnl': 0.0,
                        'return': 0.0,
                        'entry_index': entry_index
                    })
                    last_trade_time = current_time
                
                elif position:
                    # Calculate returns
                    returns = (current_price - entry_price) / entry_price
                    
                    # Get regime-specific thresholds
                    regime_thresholds = self.get_adaptive_thresholds(current_regime)
                    
                    # Dynamic risk/reward based on confidence and regime
                    confidence_factor = float(min(prediction / min_confidence, 1.5))
                    base_risk_reward = 1.5  # Base risk/reward ratio
                    
                    # Adjust risk/reward ratio based on regime
                    regime_rr_multipliers = {
                        'STRONG_TREND': 2.0,  # Higher targets in strong trends
                        'WEAK_TREND': 1.5,
                        'VOLATILE_RANGE': 1.2,
                        'QUIET_RANGE': 1.3
                    }
                    rr_multiplier = regime_rr_multipliers.get(current_regime, 1.0)
                    
                    # Calculate adjusted stop loss and take profit
                    adjusted_stop_loss = float(base_stop_loss) * float(regime_thresholds['stop_loss'])
                    adjusted_take_profit = adjusted_stop_loss * base_risk_reward * rr_multiplier * confidence_factor
                    
                    # Add maximum holding period (48 periods = 12 hours for 15min data)
                    periods_held = i - entry_index
                    max_holding_period = 48
                    
                    # Exit conditions
                    stop_loss_hit = returns <= -adjusted_stop_loss
                    take_profit_hit = returns >= adjusted_take_profit
                    max_period_hit = periods_held >= max_holding_period
                    
                    # Debug logging
                    if i % 100 == 0:  # Log every 100 periods to avoid excessive output
                        logging.info(f"Position check - Price: {current_price:.2f}, Entry: {entry_price:.2f}, Returns: {returns*100:.2f}%")
                        stop_loss_pct = float(-adjusted_stop_loss * 100)
                        take_profit_pct = float(adjusted_take_profit * 100)
                        logging.info(f"Thresholds - Stop Loss: {stop_loss_pct:.2f}%, Take Profit: {take_profit_pct:.2f}%")
                        logging.info(f"Periods held: {periods_held}")
                    
                    # Check if any exit condition is met
                    if isinstance(stop_loss_hit, np.ndarray):
                        stop_loss_hit = stop_loss_hit.any()
                    if isinstance(take_profit_hit, np.ndarray):
                        take_profit_hit = take_profit_hit.any()
                    
                    if stop_loss_hit or take_profit_hit or max_period_hit:
                        pnl = (current_price - entry_price) * units
                        balance += pnl
                        
                        exit_reason = 'Stop Loss' if stop_loss_hit else ('Take Profit' if take_profit_hit else 'Max Period')
                        
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
                            'regime': current_regime,
                            'entry_index': entry_index
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
                    'regime': df['regime'].iloc[-1],
                    'entry_index': entry_index
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
            # First move tensors to CPU if they're on MPS
            if isinstance(X, torch.Tensor):
                X = X.cpu()
            if isinstance(y, torch.Tensor):
                y = y.cpu()
            
            # Convert to tensor if they're numpy arrays
            if isinstance(X, np.ndarray):
                X_tensor = torch.FloatTensor(X)
            else:
                X_tensor = X
            
            if isinstance(y, np.ndarray):
                y_tensor = torch.FloatTensor(y)
            else:
                y_tensor = y
            
            # Move to correct device
            X_tensor = X_tensor.to(DEVICE)
            y_tensor = y_tensor.to(DEVICE)
            
            # Get predictions
            predictions = (self.model(X_tensor) >= 0.5).float().squeeze()
            accuracy = (predictions == y_tensor).float().mean().item()
        return accuracy

    def plot_results(self, df, trades_df):
        """Plot backtest results using the template"""
        try:
            # Calculate accuracies if training data is available
            train_accuracy = (
                self.calculate_accuracy(self.X_train, self.y_train) 
                if hasattr(self, 'X_train') and hasattr(self, 'y_train') 
                else None
            )
            test_accuracy = (
                self.calculate_accuracy(self.X_test, self.y_test)
                if hasattr(self, 'X_test') and hasattr(self, 'y_test')
                else None
            )
            
            # Calculate trading metrics
            sell_trades = trades_df[trades_df['action'] == 'SELL']
            total_trades = len(sell_trades)
            profitable_trades = len(sell_trades[sell_trades['pnl'] > 0])
            win_rate = float((profitable_trades / total_trades * 100) if total_trades > 0 else 0)
            final_balance = float(trades_df.iloc[-1]['balance'] if not trades_df.empty else self.initial_balance)
            total_return = float(((final_balance - self.initial_balance) / self.initial_balance * 100) if not trades_df.empty else 0)
            
            # Prepare trades list for template
            trades_list = []
            if not trades_df.empty:
                for _, trade in trades_df.iterrows():
                    trades_list.append({
                        'timestamp': trade['timestamp'].strftime('%Y-%m-%d %H:%M'),
                        'action': trade['action'],
                        'price': float(trade['price']),
                        'units': float(trade['units']) if 'units' in trade else 0,
                        'balance': float(trade['balance']),
                        'pnl': float(trade['pnl']) if 'pnl' in trade else 0,
                        'return': float(trade['return']) if 'return' in trade else 0,
                        'confidence': float(trade['confidence']) if 'confidence' in trade else 0,
                        'regime': trade['regime'] if 'regime' in trade else 'UNKNOWN'
                    })
            
            # Prepare chart data
            chart_data = []
            for timestamp, row in df.iterrows():
                chart_data.append({
                    'timestamp': timestamp.strftime('%Y-%m-%d %H:%M'),
                    'open': float(row['open']),
                    'high': float(row['high']),
                    'low': float(row['low']),
                    'close': float(row['close']),
                    'volume': float(row['volume'])
                })
            
            # Get feature importance analysis
            feature_importance_data = []
            try:
                feature_analysis = self.analyze_feature_importance()
                if isinstance(feature_analysis, dict) and 'feature_importance' in feature_analysis:
                    for feature, importance in feature_analysis['feature_importance'].items():
                        feature_importance_data.append({
                            'feature': str(feature),
                            'importance': float(importance)
                        })
            except Exception as e:
                logging.error(f"Error in feature importance calculation: {str(e)}")
                feature_importance_data = []
            
            # Ensure training metrics are numeric
            training_metrics = {}
            if hasattr(self, 'training_metrics'):
                for key, values in self.training_metrics.items():
                    training_metrics[key] = [float(v) if isinstance(v, (int, float, np.number)) else v for v in values]
            
            # Calculate regime statistics
            if not trades_df.empty:
                sell_trades = trades_df[trades_df['action'] == 'SELL']
                regime_stats = sell_trades.groupby('regime').agg({
                    'pnl': ['count', 'mean', 'sum', 'std'],
                    'return': ['mean', 'std']
                }).round(4)
                
                # Convert regime stats to a more template-friendly format
                regime_stats_dict = {}
                for regime in regime_stats.index:
                    regime_stats_dict[regime] = {
                        'count': int(regime_stats.loc[regime, ('pnl', 'count')]),
                        'avg_pnl': float(regime_stats.loc[regime, ('pnl', 'mean')]),  # Changed from mean_pnl to avg_pnl
                        'total_pnl': float(regime_stats.loc[regime, ('pnl', 'sum')]),
                        'std_pnl': float(regime_stats.loc[regime, ('pnl', 'std')]),
                        'avg_return': float(regime_stats.loc[regime, ('return', 'mean')]),  # Changed from mean_return
                        'std_return': float(regime_stats.loc[regime, ('return', 'std')])
                    }
            else:
                regime_stats_dict = {}

            # Template variables with explicit type conversion
            template_vars = {
                'symbol': str(self.symbol),
                'start_date': df.index[0].strftime('%Y-%m-%d %H:%M'),
                'end_date': df.index[-1].strftime('%Y-%m-%d %H:%M'),
                'total_trades': int(total_trades),
                'win_rate': float(win_rate),
                'total_return': float(total_return),
                'final_balance': float(final_balance),
                'initial_balance': float(self.initial_balance),
                'train_accuracy': float(train_accuracy * 100) if train_accuracy is not None else None,
                'test_accuracy': float(test_accuracy * 100) if test_accuracy is not None else None,
                'features': list(self.feature_columns),
                'trades': trades_list,
                'chart_data': chart_data,
                'feature_importance_data': feature_importance_data,
                'training_metrics': training_metrics,
                'regime_stats': regime_stats_dict
            }
            
            # Read template
            with open('templates/ml_trader_template.html', 'r') as f:
                template = Template(f.read())
            
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
        """Optimize trading parameters using walk-forward analysis"""
        try:
            console.print("\nOptimizing trading parameters using walk-forward analysis...")
            
            # Define parameter ranges for optimization
            param_ranges = {
                'stop_loss': (0.01, 0.03),      # Tighter range for stop loss
                'take_profit': (0.02, 0.06),    # Tighter range for take profit
                'min_confidence': (0.5, 0.7)     # Lower range for confidence
            }
            
            # Function to evaluate a set of parameters
            def objective(trial):
                try:
                    # Get parameters for this trial
                    params = {
                        'stop_loss': float(trial.suggest_float('stop_loss', *param_ranges['stop_loss'])),
                        'take_profit': float(trial.suggest_float('take_profit', *param_ranges['take_profit'])),
                        'min_confidence': float(trial.suggest_float('min_confidence', *param_ranges['min_confidence']))
                    }
                    
                    # Run backtest with these parameters
                    trades_df = self.backtest(
                        df,
                        base_stop_loss=params['stop_loss'],
                        base_take_profit=params['take_profit'],
                        min_confidence=params['min_confidence']
                    )
                    
                    if trades_df is None or len(trades_df) == 0:
                        return 0.0
                    
                    # Calculate metrics
                    sell_trades = trades_df[trades_df['action'] == 'SELL']
                    if len(sell_trades) == 0:
                        return 0.0
                    
                    profitable_trades = len(sell_trades[sell_trades['pnl'] > 0])
                    total_trades = len(sell_trades)
                    win_rate = profitable_trades / total_trades
                    
                    return win_rate
                    
                except Exception as e:
                    logging.error(f"Error in trial: {str(e)}")
                    return 0.0
            
            # Create and run optimization study
            study = optuna.create_study(direction='maximize')
            study.optimize(objective, n_trials=20, show_progress_bar=True)
            
            # Get best parameters
            best_params = {
                'stop_loss': float(study.best_params['stop_loss']),
                'take_profit': float(study.best_params['take_profit']),
                'min_confidence': float(study.best_params['min_confidence'])
            }
            
            console.print(f"\nBest parameters found:")
            console.print(f"Stop Loss: {best_params['stop_loss']:.3f}")
            console.print(f"Take Profit: {best_params['take_profit']:.3f}")
            console.print(f"Min Confidence: {best_params['min_confidence']:.3f}")
            console.print(f"Best Win Rate: {study.best_value:.3f}")
            
            return best_params
            
        except Exception as e:
            console.print(f"[red]Error optimizing parameters: {str(e)}[/red]")
            logging.error(f"Error optimizing parameters: {str(e)}")
            return None

    def analyze_feature_importance(self):
        """Add SHAP values for better feature importance"""
        try:
            import shap  # Add to top of file if possible
            
            if self.model is None:
                return None
                
            if not hasattr(self, 'X_train') or not hasattr(self, 'y_train'):
                console.print("[yellow]Training data not available for feature importance analysis[/yellow]")
                return {'feature_importance': {}}

            # Move model to CPU for feature importance calculation
            self.model = self.model.cpu()
            
            # Use both training and test data if available
            if hasattr(self, 'X_test') and hasattr(self, 'y_test'):
                X = np.vstack([self.X_train, self.X_test])
                y = np.hstack([self.y_train, self.y_test])
            else:
                X = self.X_train
                y = self.y_train
            
            # Convert to tensors if needed
            if isinstance(X, torch.Tensor):
                X = X.cpu().numpy()
            if isinstance(y, torch.Tensor):
                y = y.cpu().numpy()
            
            # Scale features if not already scaled
            if not hasattr(self, 'scaler'):
                self.scaler = StandardScaler()
                X_scaled = self.scaler.fit_transform(X)
            else:
                X_scaled = self.scaler.transform(X)
            
            X_tensor = torch.FloatTensor(X_scaled)
            y_tensor = torch.FloatTensor(y)
            
            try:
                # SHAP analysis
                explainer = shap.DeepExplainer(self.model, X_tensor[:1000])  # Use subset
                shap_values = explainer.shap_values(X_tensor[:1000])
                
                # Get mean absolute SHAP values
                shap_importance = np.abs(shap_values).mean(0)
                feature_importance = {
                    feat: float(imp.item()) if hasattr(imp, 'item') else float(imp)
                    for feat, imp in zip(self.feature_columns, shap_importance)
                }
                
                # Move model back to original device
                self.model = self.model.to(DEVICE)
                
                return {
                    'feature_importance': feature_importance,
                    'shap_values': shap_values  # Optional for plotting
                }
            
            except ImportError:
                console.print("[yellow]SHAP not installed, using gradient method[/yellow]")
                # Fall back to gradient method
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
                
                # Move model back to original device
                self.model = self.model.to(DEVICE)
                
                # Normalize importance scores
                importance_scores = np.abs(importance_scores)
                importance_scores = importance_scores / importance_scores.sum()
                
                # Create feature importance dictionary
                feature_importance = {
                    feat: float(imp.item()) if hasattr(imp, 'item') else float(imp)
                    for feat, imp in zip(self.feature_columns, importance_scores)
                }
            
            # Sort by importance
            feature_importance = dict(
                sorted(feature_importance.items(), key=lambda x: x[1], reverse=True)
            )
            
            return {'feature_importance': feature_importance}
            
        except Exception as e:
            console.print(f"[red]Error calculating feature importance: {str(e)}[/red]")
            logging.error(f"Error calculating feature importance: {str(e)}")
            return {'feature_importance': {}}

    def optimize_model_hyperparameters(self, df, n_trials=50):
        try:
            # Add initial data check
            if len(df) < 1000:
                raise ValueError(f"Need ≥1000 samples, got {len(df)}")
                
            # Generate targets first
            df = df.assign(
                returns_1h=df['close'].shift(-4).pct_change(4, fill_method=None),
                returns_4h=df['close'].shift(-16).pct_change(16, fill_method=None),
                returns_24h=df['close'].shift(-96).pct_change(96, fill_method=None),
                target=0
            )
            
            # Calculate volatility and trend indicators
            volatility = df['close'].pct_change().rolling(window=20).std()
            vol_threshold = volatility.rolling(window=20).mean()  # Removed multiplier
            
            # Add trend indicators
            df['sma_20'] = ta.SMA(df['close'], timeperiod=20)
            df['sma_50'] = ta.SMA(df['close'], timeperiod=50)
            df['trend_strength'] = abs(df['sma_20'] - df['sma_50']) / df['sma_50']
            
            # Volume conditions - even more lenient
            df['volume_ma'] = df['volume'].rolling(window=20).mean()
            volume_condition = df['volume'] > df['volume_ma']  # Just above average
            
            # Simple trend conditions
            uptrend = df['close'] > df['sma_20']
            downtrend = df['close'] < df['sma_20']
            
            # Generate signals with basic conditions
            buy_signal = (
                (df['returns_1h'] > 0) &  # Just positive returns
                ((df['returns_4h'] > 0) |  # Either 4h or 24h positive
                 (df['returns_24h'] > 0)) &
                uptrend &  # Price above SMA20
                volume_condition  # Above average volume
            )
            
            sell_signal = (
                (df['returns_1h'] < 0) &  # Just negative returns
                ((df['returns_4h'] < 0) |  # Either 4h or 24h negative
                 (df['returns_24h'] < 0)) &
                downtrend &  # Price below SMA20
                volume_condition  # Above average volume
            )
            
            # Apply signals
            df.loc[buy_signal, 'target'] = 1
            df.loc[sell_signal, 'target'] = 0
            
            # Keep only strong signals and drop NaN values
            df = df[buy_signal | sell_signal].copy()
            df = df.dropna()
            
            # Add minimum sample check with more informative message
            if len(df) < 100:
                console.print(f"[red]Insufficient samples after signal generation: {len(df)} samples[/red]")
                console.print("[yellow]Consider adjusting signal thresholds or increasing input data size[/yellow]")
                raise ValueError("Not enough samples after signal generation")
                
            # Print signal statistics
            total_signals = len(df)
            buy_signals = buy_signal.sum()
            sell_signals = sell_signal.sum()
            console.print(f"[cyan]Generated {total_signals} total signals:[/cyan]")
            console.print(f"[green]Buy signals: {buy_signals}[/green]")
            console.print(f"[red]Sell signals: {sell_signals}[/red]")
            
            # Now prepare features
            try:
                df_prepared = self.prepare_features(df.copy())
            except ValueError as e:
                console.print(f"[red]Skipping optimization: {str(e)}[/red]")
                return None
                
            # Add post-preparation check
            if 'target' not in df_prepared.columns:
                df_prepared['target'] = df['target']  # Copy targets from original df
            
            if df_prepared['target'].nunique() < 2:
                console.print("[red]No valid targets generated[/red]")
                return None

            console.print("[cyan]Starting hyperparameter optimization...[/cyan]")
            set_seeds()
            
            # Rest of the optimization code...

            # Add try-except around signal generation
            try:
                df_prepared = self.prepare_features(df.copy())
            except ValueError as e:
                console.print(f"[red]Skipping optimization: {str(e)}[/red]")
                return None
                
            # Add post-preparation check
            if 'target' not in df_prepared.columns or df_prepared['target'].nunique() < 2:
                console.print("[red]No valid targets generated[/red]")
                return None

            console.print("[cyan]Starting hyperparameter optimization...[/cyan]")
            set_seeds()
            
            # Add validation before processing
            if len(df) < 1000:  # Minimum data requirement
                raise ValueError(f"Need at least 1000 samples, got {len(df)}")

            # Modified data preparation with safeguards
            df_prepared = self.prepare_features(df.copy())
            
            # Add NaN check for returns calculation
            required_columns = ['returns_1h', 'returns_4h', 'returns_24h']
            df_prepared = df_prepared.dropna(subset=required_columns, how='any')
            
            # Add empty check after signal generation
            buy_mask = (
                (df_prepared['returns_1h'] > 0) & 
                (df_prepared['returns_4h'] > 0) &
                (df_prepared['returns_24h'] > 0)
            )
            sell_mask = (
                (df_prepared['returns_1h'] < 0) & 
                (df_prepared['returns_4h'] < 0) &
                (df_prepared['returns_24h'] < 0)
            )
            
            if buy_mask.sum() + sell_mask.sum() < 100:
                console.print("[red]Insufficient signals for optimization[/red]")
                return None

            # Prepare data first, outside the objective function
            df_prepared = self.prepare_features(df.copy())
            
            # Calculate returns with conservative thresholds
            df_prepared = df_prepared.assign(
                returns_1h=df_prepared['close'].shift(-4).pct_change(4, fill_method=None),
                returns_4h=df_prepared['close'].shift(-16).pct_change(16, fill_method=None),
                returns_24h=df_prepared['close'].shift(-96).pct_change(96, fill_method=None),
                target=0
            )
            
            # Generate signals with dynamic thresholds
            volatility = df_prepared['close'].pct_change().rolling(window=20).std()
            vol_adjusted_threshold = volatility.rolling(window=20).mean() * 2.0
            
            buy_signal = (
                (df_prepared['returns_1h'] > vol_adjusted_threshold) &
                ((df_prepared['returns_4h'] > vol_adjusted_threshold * 1.1) |
                (df_prepared['returns_24h'] > vol_adjusted_threshold * 1.3))
            )
            
            sell_signal = (
                (df_prepared['returns_1h'] < -vol_adjusted_threshold) &
                ((df_prepared['returns_4h'] < -vol_adjusted_threshold * 1.1) |
                (df_prepared['returns_24h'] < -vol_adjusted_threshold * 1.3))
            )
            
            # Apply signals
            df_prepared.loc[buy_signal, 'target'] = 1
            df_prepared.loc[sell_signal, 'target'] = 0
            
            # Keep only strong signals and drop NaN values
            df_prepared = df_prepared[buy_signal | sell_signal].copy()
            df_prepared = df_prepared.dropna()
            
            if len(df_prepared) < 100:
                raise ValueError("Not enough samples after data preparation")
            
            # Modify the Optuna study creation:
            sampler = optuna.samplers.RandomSampler(seed=42)  # Add sampler
            study_name = f"study_{int(time.time())}"  # Unique study name
            study = optuna.create_study(
                direction="maximize",
                sampler=sampler,  # Add this line
                storage=None,  # Force in-memory only
                study_name=study_name
            )
            
            def objective(trial):
                set_seeds()  # Reset seeds for each trial
                torch.mps.empty_cache()  # Clear GPU cache
                
                # Shuffle the prepared data
                shuffled_df = df_prepared.sample(frac=1, random_state=42).reset_index(drop=True)
                
                try:
                    # Architecture hyperparameters
                    n_layers = trial.suggest_int("n_layers", 2, 4)
                    first_layer = trial.suggest_int("first_layer", 64, 512, step=64)
                    layer_shrink = trial.suggest_float("layer_shrink", 0.3, 0.7)
                    dropout = trial.suggest_float("dropout", 0.1, 0.5)
                    
                    # Training hyperparameters
                    batch_size = trial.suggest_int("batch_size", 32, 256, step=32)
                    learning_rate = trial.suggest_float("learning_rate", 1e-4, 1e-2, log=True)
                    weight_decay = trial.suggest_float("weight_decay", 1e-4, 1e-2, log=True)
                    
                    # Create features
                    X, y = self.create_features(shuffled_df)
                    
                    # Model architecture definition
                    class OptimizedModel(nn.Module):
                        def __init__(self, input_dim, n_layers, first_layer, layer_shrink, dropout):
                            super().__init__()
                            layers = []
                            current_dim = input_dim
                            next_dim = first_layer
                            
                            for i in range(n_layers):
                                layers.extend([
                                    nn.Linear(current_dim, next_dim),
                                    nn.LayerNorm(next_dim),
                                    nn.GELU(),
                                    nn.Dropout(dropout)
                                ])
                                current_dim = next_dim
                                next_dim = max(32, int(next_dim * layer_shrink))
                            
                            layers.append(nn.Linear(current_dim, 1))
                            self.network = nn.Sequential(*layers)
                            
                            # Initialize weights
                            for m in self.modules():
                                if isinstance(m, nn.Linear):
                                    nn.init.kaiming_normal_(m.weight, mode='fan_in', nonlinearity='linear')
                                    if m.bias is not None:
                                        nn.init.zeros_(m.bias)
                        
                        def forward(self, x):
                            return self.network(x)
                    
                    # Split data
                    train_size = int(len(shuffled_df) * 0.7)
                    val_size = int(len(shuffled_df) * 0.15)
                    
                    X_train = X[:train_size]
                    y_train = y[:train_size]
                    X_val = X[train_size:train_size+val_size]
                    y_val = y[train_size:train_size+val_size]
                    X_test = X[train_size+val_size:]
                    y_test = y[train_size+val_size:]
                    
                    # Scale features
                    scaler = StandardScaler()
                    X_train = scaler.fit_transform(X_train)
                    X_val = scaler.transform(X_val)
                    X_test = scaler.transform(X_test)
                    
                    # Convert to tensors
                    X_train = torch.FloatTensor(X_train).to(DEVICE)
                    y_train = torch.FloatTensor(y_train).to(DEVICE)
                    X_val = torch.FloatTensor(X_val).to(DEVICE)
                    y_val = torch.FloatTensor(y_val).to(DEVICE)
                    X_test = torch.FloatTensor(X_test).to(DEVICE)
                    y_test = torch.FloatTensor(y_test).to(DEVICE)
                    
                    # Initialize model
                    model = OptimizedModel(
                        input_dim=len(self.feature_columns),
                        n_layers=n_layers,
                        first_layer=first_layer,
                        layer_shrink=layer_shrink,
                        dropout=dropout
                    ).to(DEVICE)
                    
                    # Training setup
                    optimizer = torch.optim.AdamW(
                        model.parameters(),
                        lr=learning_rate,
                        weight_decay=weight_decay
                    )
                    
                    scheduler = torch.optim.lr_scheduler.OneCycleLR(
                        optimizer,
                        max_lr=learning_rate,
                        epochs=30,  # Reduced epochs for faster optimization
                        steps_per_epoch=len(X_train) // batch_size + 1,
                        pct_start=0.3
                    )
                    
                    criterion = nn.BCEWithLogitsLoss()
                    
                    # Training loop
                    best_val_f1 = 0
                    patience = 5  # Reduced patience for faster optimization
                    patience_counter = 0
                    
                    for epoch in range(30):  # Reduced epochs
                        model.train()
                        total_loss = 0
                        train_preds = []
                        train_targets = []
                        
                        # Training
                        for i in range(0, len(X_train), batch_size):
                            batch_X = X_train[i:i+batch_size]
                            batch_y = y_train[i:i+batch_size]
                            
                            optimizer.zero_grad()
                            outputs = model(batch_X).squeeze()
                            loss = criterion(outputs, batch_y)
                            
                            loss.backward()
                            torch.nn.utils.clip_grad_norm_(model.parameters(), 0.5)
                            optimizer.step()
                            scheduler.step()
                            
                            total_loss += loss.item()
                            train_preds.extend((torch.sigmoid(outputs) >= 0.5).float().cpu().numpy())
                            train_targets.extend(batch_y.cpu().numpy())
                        
                        # Validation
                        model.eval()
                        with torch.no_grad():
                            val_outputs = model(X_val).squeeze()
                            val_preds = (torch.sigmoid(val_outputs) >= 0.5).float().cpu().numpy()
                            val_targets = y_val.cpu().numpy()
                            val_f1 = f1_score(val_targets, val_preds)
                        
                        # Early stopping check
                        if val_f1 > best_val_f1:
                            best_val_f1 = val_f1
                            patience_counter = 0
                        else:
                            patience_counter += 1
                        
                        if patience_counter >= patience:
                            break
                        
                        # Report intermediate value
                        trial.report(val_f1, epoch)
                        
                        # Handle pruning based on the intermediate value
                        if trial.should_prune():
                            raise optuna.exceptions.TrialPruned()
                    
                    return best_val_f1
                    
                except Exception as e:
                    logging.error(f"Error in trial: {str(e)}")
                    return 0.0  # Return worst possible score on error
            
            # Optimize with reduced trials and timeout
            study.optimize(
                objective, 
                n_trials=20,  # Reduced from 50 to 20
                timeout=600,  # 10 minute timeout
                show_progress_bar=True,
                catch=(Exception,)
            )
            
            # Get best parameters
            if study.best_trial is not None and study.best_trial.value > 0:
                best_params = study.best_params
                console.print("\n[green]Best hyperparameters found:[/green]")
                for param, value in best_params.items():
                    console.print(f"{param}: {value}")
                
                console.print(f"\n[green]Best validation F1: {study.best_value:.4f}[/green]")
                
                # Plot optimization history if available
                try:
                    plots_dir = Path('plots')
                    plots_dir.mkdir(exist_ok=True)
                    
                    optuna.visualization.matplotlib.plot_optimization_history(study)
                    plt.savefig(plots_dir / 'optuna_history.png', dpi=300, bbox_inches='tight')
                    plt.close()
                    
                    optuna.visualization.matplotlib.plot_param_importances(study)
                    plt.savefig(plots_dir / 'optuna_importance.png', dpi=300, bbox_inches='tight')
                    plt.close()
                except Exception as e:
                    console.print(f"[yellow]Could not save optimization plots: {str(e)}[/yellow]")
                
                return best_params
            else:
                console.print("[yellow]No successful trials found during optimization[/yellow]")
                return None
            
        except Exception as e:
            console.print(f"[red]Error in hyperparameter optimization: {str(e)}[/red]")
            logging.error(f"Error in hyperparameter optimization: {str(e)}")
            raise

    def load_or_fetch_data(self, days=100, offset_days=0):
        """Load cached data or fetch new data if needed"""
        try:
            data_dir = Path('data')
            data_dir.mkdir(exist_ok=True)
            file_path = data_dir / f'{self.symbol}_data.feather'
            
            if file_path.exists():
                # Load cached data
                console.print(f"[green]Loading cached data for {self.symbol}[/green]")
                df = pd.read_feather(file_path)
                df.set_index('timestamp', inplace=True)
            else:
                # Fetch new data
                console.print(f"[yellow]No cached data found, fetching new data[/yellow]")
                df = self.fetch_data(days + offset_days)
                df.reset_index().to_feather(file_path)
                console.print(f"[green]Saved new data to {file_path}[/green]")
            
            # Ensure we have enough data
            if len(df) < days:
                raise ValueError(f"Not enough data. Requested {days} days, got {len(df)}")
            
            return df.iloc[-days:]  # Return most recent 'days' of data
            
        except Exception as e:
            console.print(f"[red]Error loading/fetching data: {str(e)}[/red]")
            logging.error(f"Error loading/fetching data: {str(e)}")
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
            trades_df = None
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
                else:
                    console.print("\n[yellow]Optimization failed, running backtest with default parameters...[/yellow]")
                    trades_df = ml_trader.backtest(df)
            else:
                # Run backtest with default parameters
                console.print("\n[cyan]Running backtest with default parameters...[/cyan]")
                trades_df = ml_trader.backtest(df)
            
            if trades_df is not None and len(trades_df) > 0:
                try:
                    # Calculate final statistics
                    sell_trades = trades_df[trades_df['action'] == 'SELL']
                    total_trades = len(sell_trades)
                    
                    if total_trades == 0:
                        console.print("[yellow]Warning: No SELL trades found in backtest results[/yellow]")
                        return
                        
                    if 'pnl' not in sell_trades.columns:
                        console.print("[red]Error: PnL column missing from trades DataFrame[/red]")
                        return
                        
                    profitable_trades = len(sell_trades[sell_trades['pnl'] > 0])
                    win_rate = profitable_trades / total_trades * 100
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
                    console.print(f"[red]Error processing backtest results: {str(e)}[/red]")
                    logging.error(f"Error processing backtest results: {str(e)}")
            else:
                console.print("[yellow]No trades generated during backtest[/yellow]")
                
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