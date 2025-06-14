import os
import sys
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import f1_score, accuracy_score, confusion_matrix, classification_report
import joblib
from scipy.fft import fft
from tqdm import tqdm
import matplotlib
matplotlib.use('Agg')
matplotlib.style.use('default')
# Set device
DEVICE = 'cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu'
os.makedirs("plots", exist_ok=True)

# ---------------------------
# Data Loading & Preparation
# ---------------------------

def load_data(csv_path):
    """Load and preprocess market data"""
    df = pd.read_csv(csv_path, parse_dates=['timestamp'], index_col='timestamp')
    df = df.resample('15min').last().ffill()
    return df

# ---------------------------
# Advanced Feature Engineering
# ---------------------------

def triple_barrier_labels(prices, barrier=0.02, time_step=16):
    """Generate triple barrier labels for a given price series"""
    labels = np.zeros(len(prices) - time_step)
    for i in range(len(prices) - time_step):
        future_prices = prices[i+1:i+time_step+1]
        current_price = prices[i]
        
        # Upper and lower barriers
        upper_barrier = current_price * (1 + barrier)
        lower_barrier = current_price * (1 - barrier)
        
        # Check if price hits barriers
        hits_upper = future_prices >= upper_barrier
        hits_lower = future_prices <= lower_barrier
        
        if hits_upper.any():
            if not hits_lower.any() or np.where(hits_upper)[0][0] < np.where(hits_lower)[0][0]:
                labels[i] = 1
        elif hits_lower.any():
            labels[i] = 0
        else:
            # If no barrier is hit, use the final price movement
            labels[i] = 1 if future_prices[-1] > current_price else 0
            
    return labels

def create_features(df):
    """Create technical features with mathematical transforms"""
    print(f"Initial data shape: {df.shape}")
    df = df.copy()
    
    # Price transforms
    df = df.assign(
        returns_1h = df['close'].pct_change(4),
        returns_4h = df['close'].pct_change(16),
        returns_24h = df['close'].pct_change(96),
        sma_20 = df['close'].rolling(20).mean(),
        sma_50 = df['close'].rolling(50).mean(),
        ema_20 = df['close'].ewm(span=20).mean(),
        ema_50 = df['close'].ewm(span=50).mean(),
        momentum_4h = df['close'].pct_change(16),
        rsi_14 = 100 - (100 / (1 + (df['close'].diff().clip(lower=0).rolling(14).mean() / 
                                  df['close'].diff().clip(upper=0).abs().rolling(14).mean()))),
        volume_ma_20 = df['volume'].rolling(20).mean(),
        volatility_4h = df['close'].pct_change().rolling(16).std(),
        overnight_gap = df['open'] / df['close'].shift(1) - 1
    )
    
    # Handle NaN values in features
    df = df.ffill().bfill()
    
    # Fourier features - fixed implementation
    def safe_fft(x, idx):
        if len(x) < 2:
            return 0
        fft_vals = np.abs(fft(x))
        return fft_vals[min(idx + 1, len(fft_vals) - 1)] if len(fft_vals) > 1 else 0
    
    for i in range(5):
        df[f'fft_{i}'] = df['close'].rolling(100, min_periods=2).apply(
            lambda x: safe_fft(x, i),
            raw=True
        )
    
    # Advanced features with error handling
    df['hurst'] = df['close'].rolling(100, min_periods=4).apply(
        lambda x: np.polyfit(np.log(range(2,min(50, len(x)))), 
                           np.log([np.std(x[lag:] - x[:-lag]) + 1e-10 for lag in range(2,min(50, len(x)))]), 1)[0] \
                           if len(x) >= 4 else 0,
        raw=True
    )
    
    feature_cols = [
        'returns_1h', 'returns_4h', 'returns_24h',
        'sma_20', 'sma_50', 'ema_20', 'ema_50',
        'momentum_4h', 'rsi_14', 'volume_ma_20',
        'volatility_4h', 'overnight_gap', 'hurst'
    ] + [f'fft_{i}' for i in range(5)]
    
    # Handle any remaining NaN values
    df = df.ffill().fillna(0)
    
    print(f"Feature columns: {feature_cols}")
    print(f"Data shape before scaling: {df.shape}")
    print(f"NaN values in features: {df[feature_cols].isna().sum().sum()}")
    
    # Normalization with error handling
    scaler = StandardScaler()
    df[feature_cols] = scaler.fit_transform(df[feature_cols])
    joblib.dump(scaler, "plots/scaler.pkl")
    
    # Create target after cleaning features
    targets = triple_barrier_labels(df['close'].values)
    # Ensure target length matches DataFrame length
    df = df.iloc[:len(targets)].copy()
    df['target'] = targets
    
    # Final cleanup
    df = df.dropna(subset=['target'] + feature_cols)
    
    print(f"Final data shape: {df.shape}")
    print(f"Target distribution: {df['target'].value_counts(normalize=True)}")
    
    if len(df) < 100:
        raise ValueError("Not enough valid data points after preprocessing")
        
    return df, feature_cols

# ---------------------------
# Visualization Functions
# ---------------------------

def plot_feature_distributions(df, feature_cols):
    """Visualize feature distributions and correlations"""
    # Set style - using default matplotlib style instead of seaborn
    plt.style.use('default')  # Changed from 'seaborn' to 'default'
    
    # Plot feature distributions
    fig = plt.figure(figsize=(20, 15))
    for i, col in enumerate(feature_cols, 1):
        ax = fig.add_subplot((len(feature_cols)-1)//4 + 1, 4, i)
        sns.histplot(data=df[col], bins=50, ax=ax)
        ax.set_title(f'Distribution of {col}')
        ax.tick_params(labelrotation=45)
    plt.tight_layout()
    plt.savefig("plots/feature_distributions.png", dpi=300, bbox_inches='tight')
    plt.close()
    
    # Correlation matrix
    plt.figure(figsize=(20, 16))
    corr = df[feature_cols].corr()
    mask = np.triu(np.ones_like(corr, dtype=bool))
    sns.heatmap(corr, mask=mask, annot=True, fmt='.2f', 
                cmap='coolwarm', center=0, square=True)
    plt.title('Feature Correlations', pad=20)
    plt.xticks(rotation=90)
    plt.yticks(rotation=0)
    plt.tight_layout()
    plt.savefig("plots/feature_correlations.png", dpi=300, bbox_inches='tight')
    plt.close()

def plot_predictions(y_true, y_pred, model_name):
    """Visualize prediction performance"""
    # Create subplots
    fig = make_subplots(
        rows=2, cols=2,
        subplot_titles=('Confusion Matrix', 'ROC Curve', 
                       'Precision-Recall Curve', 'Prediction Distribution'),
        specs=[[{'type': 'heatmap'}, {'type': 'scatter'}],
               [{'type': 'scatter'}, {'type': 'histogram'}]]
    )
    
    # Confusion Matrix
    cm = confusion_matrix(y_true, y_pred)
    fig.add_trace(
        go.Heatmap(z=cm, x=['Sell', 'Buy'], y=['Sell', 'Buy'],
                   text=cm, texttemplate="%{text}", colorscale='Blues'),
        row=1, col=1
    )
    
    # ROC Curve
    from sklearn.metrics import roc_curve, auc
    fpr, tpr, _ = roc_curve(y_true, y_pred)
    fig.add_trace(
        go.Scatter(x=fpr, y=tpr, name=f'ROC (AUC = {auc(fpr, tpr):.2f})'),
        row=1, col=2
    )
    fig.add_trace(
        go.Scatter(x=[0, 1], y=[0, 1], line=dict(dash='dash'), 
                   showlegend=False, line_color='gray'),
        row=1, col=2
    )
    
    # Precision-Recall Curve
    from sklearn.metrics import precision_recall_curve
    precision, recall, _ = precision_recall_curve(y_true, y_pred)
    fig.add_trace(
        go.Scatter(x=recall, y=precision, name='Precision-Recall'),
        row=2, col=1
    )
    
    # Prediction Distribution
    fig.add_trace(
        go.Histogram(x=y_pred, nbinsx=50, name='Predictions'),
        row=2, col=2
    )
    
    # Update layout
    fig.update_layout(
        title_text=f"{model_name} Performance",
        height=800,
        showlegend=True
    )
    
    # Save plot
    fig.write_image(f"plots/{model_name}_performance.png", scale=2)
    fig.write_html(f"plots/{model_name}_performance.html")

def plot_backtest_results(df, predictions):
    """Plot backtest results and calculate metrics"""
    df = df.iloc[-len(predictions):].copy()
    df['pred'] = predictions
    df['returns'] = df['close'].pct_change()
    df['strategy'] = df['pred'].shift(1) * df['returns']
    
    # Equity curve
    plt.figure(figsize=(12,6))
    df[['returns', 'strategy']].cumsum().apply(np.exp).plot()
    plt.title('Strategy vs Buy & Hold')
    plt.grid(True)
    plt.legend(['Buy & Hold', 'Strategy'])
    plt.savefig("plots/equity_curve.png")
    plt.close()
    
    # Trade distribution
    plt.figure(figsize=(10,6))
    sns.histplot(df['strategy'].dropna(), bins=50, kde=True)
    plt.title('Strategy Return Distribution')
    plt.grid(True)
    plt.savefig("plots/return_distribution.png")
    plt.close()
    
    # Monthly returns heatmap
    monthly = df['strategy'].resample('M').sum()
    monthly_df = monthly.to_frame(name='strategy')
    monthly_df['year'] = monthly_df.index.year
    monthly_df['month'] = monthly_df.index.strftime('%b')
    pivot = monthly_df.pivot(index='year', columns='month', values='strategy')
    plt.figure(figsize=(15, 8))
    sns.heatmap(pivot, annot=True, fmt='.2f', cmap='RdYlGn')
    plt.title('Monthly Returns Heatmap')
    plt.tight_layout()
    plt.savefig("plots/monthly_returns.png")
    plt.close()
    
    # Calculate metrics
    metrics = backtest_metrics(df, predictions)
    print("\nBacktest Metrics:")
    print(f"Sharpe Ratio: {metrics['sharpe']:.2f}")
    print(f"Max Drawdown: {metrics['max_drawdown']:.2%}")
    print(f"Win Rate: {metrics['win_rate']:.2%}")
    
    return metrics

# ---------------------------
# Data Preparation
# ---------------------------

class MarketDataset(Dataset):
    def __init__(self, df, feature_cols, lookback=96):
        self.features = torch.tensor(df[feature_cols].values, dtype=torch.float32)
        self.targets = torch.tensor(df['target'].values, dtype=torch.float32)
        self.returns = torch.tensor(df['close'].pct_change().values[1:], dtype=torch.float32)  # Convert to tensor with float32
        self.lookback = lookback
        
    def __len__(self):
        return len(self.features) - self.lookback
    
    def __getitem__(self, idx):
        return (
            self.features[idx:idx+self.lookback],
            self.targets[idx+self.lookback-1]
        )

# ---------------------------
# Model Architecture
# ---------------------------

class MarketTransformer(nn.Module):
    def __init__(self, input_dim):
        super().__init__()
        # Deeper CNN for feature extraction
        self.conv = nn.Sequential(
            nn.Conv1d(input_dim, 64, 3, padding=1),
            nn.BatchNorm1d(64),
            nn.GELU(),
            nn.Conv1d(64, 128, 3, padding=1),
            nn.BatchNorm1d(128),
            nn.GELU(),
            nn.Conv1d(128, 128, 3, padding=1),
            nn.BatchNorm1d(128),
            nn.GELU(),
        )
        
        # Bidirectional GRU instead of LSTM
        self.gru = nn.GRU(128, 128, num_layers=2, dropout=0.2, 
                         bidirectional=True, batch_first=True)
        
        # Multi-head attention with more heads
        self.attention = nn.MultiheadAttention(256, 8, dropout=0.1, batch_first=True)
        
        # Deeper FC layers with skip connection
        self.fc1 = nn.Sequential(
            nn.Linear(256, 128),
            nn.LayerNorm(128),
            nn.GELU(),
            nn.Dropout(0.2)
        )
        self.fc2 = nn.Sequential(
            nn.Linear(128, 64),
            nn.LayerNorm(64),
            nn.GELU(),
            nn.Dropout(0.2)
        )
        self.out = nn.Linear(64 + 128, 1)  # Skip connection
        
    def forward(self, x):
        # Ensure input is [batch, seq_len, features]
        if x.dim() == 2:
            x = x.unsqueeze(1)
        
        # CNN feature extraction
        x = x.permute(0, 2, 1)
        conv_out = self.conv(x)
        
        # GRU processing
        gru_in = conv_out.permute(0, 2, 1)
        gru_out, _ = self.gru(gru_in)
        
        # Self-attention
        attn_out, _ = self.attention(gru_out, gru_out, gru_out)
        
        # FC with skip connection
        fc1_out = self.fc1(attn_out[:,-1,:])
        fc2_out = self.fc2(fc1_out)
        
        # Concatenate skip connection
        combined = torch.cat([fc2_out, fc1_out], dim=1)
        return self.out(combined)

# ---------------------------
# Training & Evaluation
# ---------------------------

class BalancedBatchSampler(torch.utils.data.Sampler):
    def __init__(self, dataset, batch_size=32):
        self.dataset = dataset
        self.batch_size = batch_size
        
        # Get targets from dataset
        if hasattr(dataset, 'targets'):
            targets = dataset.targets
        else:  # Handle Subset case
            targets = dataset.dataset.targets[dataset.indices]
            
        self.indices_0 = (targets == 0).nonzero().squeeze()
        self.indices_1 = (targets == 1).nonzero().squeeze()
        
        # Calculate number of full batches
        n_samples = min(len(self.indices_0), len(self.indices_1)) * 2
        self.n_batches = n_samples // batch_size
        
    def __iter__(self):
        indices = []
        for _ in range(self.n_batches):
            # Sample equal from both classes
            batch_0 = np.random.choice(self.indices_0, self.batch_size//2, replace=True)
            batch_1 = np.random.choice(self.indices_1, self.batch_size//2, replace=True)
            indices.extend(np.concatenate([batch_0, batch_1]))
        return iter(indices)
    
    def __len__(self):
        return self.n_batches * self.batch_size

class TradingLoss(nn.Module):
    def __init__(self, gamma=2, pos_weight=None):
        super().__init__()
        self.gamma = gamma
        self.bce = nn.BCEWithLogitsLoss(pos_weight=pos_weight, reduction='none')
        
    def forward(self, pred, target, returns=None):
        # Binary classification loss with softer margin
        pred_probs = torch.sigmoid(pred)
        
        # Entropy regularization to prevent overconfidence
        entropy = -(pred_probs * torch.log(pred_probs + 1e-7) + (1 - pred_probs) * torch.log(1 - pred_probs + 1e-7))
        entropy_loss = -0.1 * entropy.mean()  # Encourage some uncertainty
        
        # Standard focal loss
        bce_loss = self.bce(pred, target)
        pt = torch.exp(-bce_loss)
        focal_loss = ((1 - pt) ** self.gamma * bce_loss)
        
        if returns is not None:
            # Trading loss components with gentler penalties
            correct_direction = ((pred_probs > 0.5).float() == target).float()
            return_magnitude = torch.abs(returns)
            
            # Scale rewards/penalties by return magnitude
            confidence_reward = torch.abs(pred_probs - 0.5) * correct_direction * return_magnitude
            confidence_penalty = torch.abs(pred_probs - 0.5) * (1 - correct_direction) * return_magnitude
            
            # Combine components with balanced weights
            total_loss = (
                focal_loss.mean() + 
                entropy_loss +  # Add entropy regularization
                0.5 * confidence_penalty.mean() -  # Gentler penalty
                0.5 * confidence_reward.mean()  # Balanced reward
            )
            return total_loss
        
        return focal_loss.mean() + entropy_loss

def train_model(model, train_loader, val_loader, epochs=50):
    """Train model with trading-aware loss"""
    if hasattr(train_loader.dataset, 'targets'):
        targets = train_loader.dataset.targets
        returns = train_loader.dataset.returns
    else:  # Handle Subset case
        targets = train_loader.dataset.dataset.targets[train_loader.dataset.indices]
        returns = train_loader.dataset.dataset.returns[train_loader.dataset.indices]
    
    pos_weight = torch.tensor([(targets == 0).sum() / (targets == 1).sum()], dtype=torch.float32).to(DEVICE)
    
    criterion = TradingLoss(gamma=2, pos_weight=pos_weight)
    optimizer = optim.AdamW(model.parameters(), lr=5e-5, weight_decay=0.01)  # Lower learning rate, higher weight decay
    
    # Cosine annealing with warm restarts
    scheduler = optim.lr_scheduler.CosineAnnealingWarmRestarts(
        optimizer,
        T_0=10,  # Initial restart period
        T_mult=2,  # Double period after each restart
        eta_min=1e-6  # Minimum learning rate
    )
    
    best_metric = float('-inf')
    patience = 10  # Reduced patience
    no_improve = 0
    model.to(DEVICE)
    
    metrics_history = []
    best_model_state = None
    
    for epoch in range(epochs):
        model.train()
        total_loss = 0
        progress = tqdm(train_loader, desc=f'Epoch {epoch+1}')
        
        for batch_idx, (X, y) in enumerate(progress):
            X, y = X.to(DEVICE), y.to(DEVICE)
            optimizer.zero_grad()
            outputs = model(X).squeeze()
            
            # Calculate returns for the batch
            start_idx = batch_idx * train_loader.batch_size
            end_idx = start_idx + train_loader.batch_size
            batch_returns = returns[start_idx:end_idx].to(DEVICE)
            
            loss = criterion(outputs, y, batch_returns)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)  # Reduced gradient clipping
            optimizer.step()
            total_loss += loss.item()
            progress.set_postfix(loss=loss.item())
        
        scheduler.step()
        
        model.eval()
        val_probs, val_true = [], []
        val_loss = 0
        with torch.no_grad():
            for X, y in val_loader:
                X = X.to(DEVICE)
                outputs = model(X).squeeze()
                probs = torch.sigmoid(outputs).cpu().numpy()
                val_probs.extend(probs)
                val_true.extend(y.numpy())
                val_loss += criterion(outputs, y.to(DEVICE)).item()
        
        val_probs = np.array(val_probs)
        val_true = np.array(val_true)
        
        # Apply dynamic confidence threshold
        confidence_threshold = min(0.1 + epoch * 0.01, 0.3)  # Gradually increase threshold
        confident_mask = np.abs(val_probs - 0.5) > confidence_threshold
        val_preds = (val_probs > 0.5).astype(np.float32)
        val_returns = val_loader.dataset.dataset.returns[val_loader.dataset.indices][-len(val_preds):].cpu().numpy()
        
        # Apply confident mask to predictions and returns
        confident_preds = val_preds[confident_mask]
        confident_returns = val_returns[confident_mask]
        confident_true = val_true[confident_mask]
        
        if len(confident_preds) > 0:
            strategy_returns = confident_preds * confident_returns
            sharpe = strategy_returns.mean() / (strategy_returns.std() + 1e-6) * np.sqrt(252*24*4)
            s = pd.Series(strategy_returns).cumsum()
            max_dd = (s.expanding().max() - s).max()
            win_rate = (strategy_returns > 0).mean()
            f1 = f1_score(confident_true, confident_preds)
        else:
            sharpe, max_dd, win_rate, f1 = 0, 0, 0, 0
        
        metrics_history.append({
            'epoch': epoch,
            'train_loss': total_loss/len(train_loader),
            'val_loss': val_loss/len(val_loader),
            'sharpe': float(sharpe),
            'max_dd': float(max_dd),
            'win_rate': float(win_rate),
            'f1': float(f1),
            'confidence_rate': float(confident_mask.mean()),
            'confidence_threshold': confidence_threshold
        })
        
        print(f"Epoch {epoch+1}: Train Loss {total_loss/len(train_loader):.4f}, "
              f"Val Loss {val_loss/len(val_loader):.4f}, Sharpe: {sharpe:.2f}, "
              f"MaxDD: {max_dd:.2%}, WR: {win_rate:.2%}, F1: {f1:.4f}")
        print(f"Learning rate: {optimizer.param_groups[0]['lr']:.6f}, "
              f"Confidence Rate: {confident_mask.mean():.2%}, "
              f"Threshold: {confidence_threshold:.3f}")
        
        # Use combined metric for early stopping
        current_metric = sharpe * (1 + win_rate) * confident_mask.mean()
        
        if current_metric > best_metric and confident_mask.mean() > 0.1:
            best_metric = current_metric
            no_improve = 0
            best_model_state = model.state_dict().copy()
            torch.save({
                'model_state_dict': model.state_dict(),
                'metrics_history': metrics_history,
                'best_metric': best_metric
            }, "plots/best_model.pth")
        else:
            no_improve += 1
            if no_improve >= patience:
                print(f"Early stopping triggered after {epoch+1} epochs")
                if best_model_state is not None:
                    model.load_state_dict(best_model_state)  # Restore best model
                break

# ---------------------------
# Backtesting & Analysis
# ---------------------------

def backtest_metrics(df, predictions):
    """Generate trading performance visualizations"""
    df = df.iloc[-len(predictions):].copy()
    df['pred'] = predictions
    df['returns'] = df['close'].pct_change()
    df['strategy'] = df['pred'].shift(1) * df['returns']
    
    # Equity curve
    plt.figure(figsize=(12,6))
    df[['returns', 'strategy']].cumsum().apply(np.exp).plot()
    plt.title('Strategy vs Buy & Hold')
    plt.grid(True)
    plt.legend(['Buy & Hold', 'Strategy'])
    plt.savefig("plots/equity_curve.png")
    plt.close()
    
    # Trade distribution
    plt.figure(figsize=(10,6))
    sns.histplot(df['strategy'].dropna(), bins=50, kde=True)
    plt.title('Strategy Return Distribution')
    plt.grid(True)
    plt.savefig("plots/return_distribution.png")
    plt.close()
    
    # Monthly returns heatmap
    monthly = df['strategy'].resample('M').sum()
    monthly_df = monthly.to_frame(name='strategy')
    monthly_df['year'] = monthly_df.index.year
    monthly_df['month'] = monthly_df.index.strftime('%b')
    pivot = monthly_df.pivot(index='year', columns='month', values='strategy')
    plt.figure(figsize=(15, 8))
    sns.heatmap(pivot, annot=True, fmt='.2f', cmap='RdYlGn')
    plt.title('Monthly Returns Heatmap')
    plt.tight_layout()
    plt.savefig("plots/monthly_returns.png")
    plt.close()
    
    # Calculate metrics
    sharpe = df['strategy'].mean() / df['strategy'].std() * np.sqrt(252*24*4)
    s = pd.Series(df['strategy']).cumsum()
    max_dd = (s.expanding().max() - s).max()
    win_rate = (df['strategy'] > 0).mean()
    
    return {
        'sharpe': sharpe,
        'max_drawdown': max_dd,
        'win_rate': win_rate
    }

# ---------------------------
# Main Execution
# ---------------------------

def generate_predictions(model, df, feature_cols):
    """Generate predictions with dynamic confidence thresholding"""
    model.eval()
    with torch.no_grad():
        batch_size = 512
        predictions = []
        confidences = []
        
        for i in range(0, len(df), batch_size):
            batch_features = torch.tensor(
                df[feature_cols].iloc[i:i+batch_size].values, 
                dtype=torch.float32
            ).to(DEVICE)
            batch_logits = model(batch_features).squeeze().cpu().numpy()
            batch_probs = 1 / (1 + np.exp(-batch_logits))  # Sigmoid
            
            # Dynamic confidence threshold based on probability distribution
            threshold = np.percentile(np.abs(batch_probs - 0.5), 70)  # Adapt threshold to top 30% confident predictions
            threshold = max(0.1, min(0.3, threshold))  # Keep threshold between 0.1 and 0.3
            
            # Apply confidence threshold
            batch_conf = np.abs(batch_probs - 0.5) > threshold
            batch_preds = np.where(batch_conf, 
                                 (batch_probs > 0.5).astype(float),
                                 np.nan)
            
            predictions.extend(batch_preds)
            confidences.extend(batch_conf)
        
        predictions = np.array(predictions)
        confidences = np.array(confidences)
        
        # Create prediction series with proper handling of unconfident predictions
        predictions_series = pd.Series(predictions, index=df.index)
        predictions_series = predictions_series.fillna(method='ffill')  # First try to forward fill
        predictions_series = predictions_series.fillna(0.5)  # Then fill remaining NaNs with neutral position
        
        return predictions_series

if __name__ == "__main__":
    try:
        # Load and prepare data
        print("Loading data...")
        df = load_data(sys.argv[1] if len(sys.argv) > 1 else "data.csv")
        print("Creating features...")
        df, feature_cols = create_features(df)
        
        # Create dataset with error checking
        print("Preparing dataset...")
        dataset = MarketDataset(df, feature_cols)
        if len(dataset) == 0:
            raise ValueError("Dataset is empty after preprocessing")
            
        train_size = int(0.8 * len(dataset))
        if train_size == 0:
            raise ValueError("Not enough data for training split")
            
        train_dataset, val_dataset = torch.utils.data.random_split(
            dataset, [train_size, len(dataset)-train_size]
        )
        
        print(f"Training samples: {len(train_dataset)}")
        print(f"Validation samples: {len(val_dataset)}")
        
        # Plot initial data analysis
        print("Generating initial visualizations...")
        plot_feature_distributions(df, feature_cols)
        
        # Initialize and train model
        print("Initializing model...")
        model = MarketTransformer(len(feature_cols))
        
        # Use balanced sampler for training
        train_loader = DataLoader(
            train_dataset,
            batch_size=64,
            sampler=BalancedBatchSampler(train_dataset, batch_size=64),
            drop_last=True
        )
        val_loader = DataLoader(val_dataset, batch_size=256)
        
        print("Training model...")
        train_model(model, train_loader, val_loader, epochs=50)
        
        # Generate final predictions
        print("Generating final predictions...")
        predictions_series = generate_predictions(model, df, feature_cols)
        plot_backtest_results(df, predictions_series)
        
        print("Training complete! Visualizations saved in 'plots' directory")
        
    except Exception as e:
        print(f"Error: {str(e)}")
        sys.exit(1)
    