#!/usr/bin/env python3
"""
Base Strategy Class
All trading strategies inherit from this class for consistency
"""

import pandas as pd
import numpy as np
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Dict, Any, Optional


@dataclass
class TradeResult:
    """Unified trade result for all strategies"""
    entry_time: datetime
    exit_time: datetime
    entry_price: float
    exit_price: float
    side: str  # 'LONG' or 'SHORT'
    quantity: float
    pnl: float
    pnl_percent: float
    exit_reason: str
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None


@dataclass
class StrategyResult:
    """Unified strategy backtest result for all strategies"""
    strategy_name: str = ""
    symbol: str = ""
    timeframe: str = "15m"
    start_date: datetime = None
    end_date: datetime = None
    initial_capital: float = 10000.0
    final_capital: float = 10000.0
    total_return: float = 0.0
    total_return_percent: float = 0.0
    total_trades: int = 0
    winning_trades: int = 0
    losing_trades: int = 0
    win_rate: float = 0.0
    avg_win: float = 0.0
    avg_loss: float = 0.0
    max_drawdown: float = 0.0
    max_drawdown_percent: float = 0.0
    sharpe_ratio: float = 0.0
    profit_factor: float = 0.0
    trades: List[TradeResult] = field(default_factory=list)
    equity_curve: pd.DataFrame = field(default_factory=pd.DataFrame)
    daily_returns: pd.Series = field(default_factory=pd.Series)
    parameters: Dict[str, Any] = field(default_factory=dict)
    raw_data: pd.DataFrame = field(default_factory=pd.DataFrame)


class BaseStrategy(ABC):
    """Base class for all trading strategies"""
    
    def __init__(self, name: str, **kwargs):
        self.name = name
        self.parameters = kwargs
        
    @abstractmethod
    def generate_signals(self, df: pd.DataFrame) -> pd.DataFrame:
        """Generate trading signals from OHLCV data"""
        pass
    
    @abstractmethod
    def get_parameter_space(self) -> Dict:
        """Return the parameter space for optimization"""
        pass
    
    def get_display_name(self) -> str:
        """Return display name for the strategy"""
        return self.name
    
    def get_parameters(self) -> Dict[str, Any]:
        """Return current parameters"""
        return self.parameters.copy()
    
    def set_parameters(self, **kwargs):
        """Update strategy parameters"""
        self.parameters.update(kwargs)
    
    def validate_data(self, df: pd.DataFrame) -> bool:
        """Validate input data format"""
        required_columns = ['open', 'high', 'low', 'close', 'volume']
        return all(col in df.columns for col in required_columns)
    
    def preprocess_data(self, df: pd.DataFrame) -> pd.DataFrame:
        """Preprocess data before signal generation"""
        df = df.copy()
        
        # Ensure required columns
        if not self.validate_data(df):
            raise ValueError(f"Data must contain columns: {['open', 'high', 'low', 'close', 'volume']}")
        
        # Remove any NaN values
        df = df.dropna()
        
        # Ensure datetime index
        if not isinstance(df.index, pd.DatetimeIndex):
            df.index = pd.to_datetime(df.index)
        
        return df 
