"""
Centralized Trading Configuration for TradingView Screener

This module contains all configurable parameters for the trading system,
organized by functionality. Only affects tv_screen_usage.py - old_tv_screen.py remains unchanged.
"""

from dataclasses import dataclass
from typing import Dict, Any, Optional


@dataclass
class RiskManagementConfig:
    """Risk management parameters"""
    # Stop Loss & Take Profit
    regular_stop_loss_pct: float = -0.5      # Regular stop loss: -0.5%
    take_profit_pct: float = 0.8             # Take profit threshold: 0.8%
    quick_exit_pct: float = 0.7              # Quick exit threshold: 0.7%
    
    # ATR-based parameters for volatile stocks
    atr_multiplier: float = 2.0              # ATR multiplier for stop calculation
    high_vol_threshold: float = 0.03         # 3% daily volatility threshold
    high_range_threshold: float = 4.0        # 4% average daily range threshold
    atr_max_stop_pct: float = -5.0           # Maximum ATR stop loss: -5%
    atr_fallback_stop_pct: float = -2.0      # ATR fallback stop: -2%
    
    # Trade limits
    max_total_trades: int = 30               # Maximum total trades per day
    max_daily_entries_per_stock: int = 2     # Max entries per stock per day
    alert_cooldown_seconds: int = 300        # 5 minutes between alerts per symbol
    stop_loss_cooldown_seconds: int = 1800   # 30 minutes after stop loss
    loss_cooldown_seconds: int = 1800        # 30 minutes after any loss


@dataclass
class TrailingStopsConfig:
    """Trailing stop configuration"""
    # Ultra-quick trailing activation thresholds
    ultra_quick_3min_pct: float = 0.8        # 0.8% profit in 3 minutes
    ultra_quick_5min_pct: float = 1.0        # 1.0% profit in 5 minutes  
    ultra_quick_10min_pct: float = 1.5       # 1.5% profit in 10 minutes
    
    # Regular trailing buffers (profit_pct -> buffer_pct)
    trailing_buffers: Dict[float, float] = None
    
    # Ultra-quick trailing buffers (tighter than regular)
    ultra_quick_buffers: Dict[float, float] = None
    
    def __post_init__(self):
        if self.trailing_buffers is None:
            self.trailing_buffers = {
                2.0: 0.2,    # 2%+ profit: 0.2% buffer (lock in 90%)
                1.5: 0.25,   # 1.5%+ profit: 0.25% buffer (lock in 85%)
                1.0: 0.3,    # 1%+ profit: 0.3% buffer (lock in 80%)
                0.8: 0.35,   # 0.8%+ profit: 0.35% buffer (lock in 75%)
                0.6: 0.4,    # 0.6%+ profit: 0.4% buffer (lock in 65%)
                0.4: 0.45,   # 0.4%+ profit: 0.45% buffer (lock in 50%)
                0.0: 0.5     # <0.4% profit: 0.5% initial buffer
            }
        
        if self.ultra_quick_buffers is None:
            self.ultra_quick_buffers = {
                2.0: 0.1,    # 2%+ profit: 0.1% buffer (lock in 95%)
                1.5: 0.15,   # 1.5%+ profit: 0.15% buffer (lock in 92%)
                1.0: 0.2,    # 1%+ profit: 0.2% buffer (lock in 88%)
                0.8: 0.25,   # 0.8%+ profit: 0.25% buffer (lock in 85%)
                0.0: 0.3     # <0.8% profit: 0.3% tight initial buffer
            }


@dataclass
class TradingHoursConfig:
    """Trading time configuration"""
    trading_start_time: str = "09:17"        # Start trading at 9:17 AM
    trading_end_time: str = "13:00"          # Stop trading at 10:00 AM


@dataclass
class PositionSizingConfig:
    """Position sizing parameters"""
    default_position_size: int = 20000       # Default ₹20,000 position size
    min_quantity: int = 1                    # Minimum quantity to trade


@dataclass
class DowntrendConfig:
    """Confirmed downtrend requirements for shorts"""
    min_volume_ratio_bearish: float = 1.2    # Min volume ratio for bearish confirmation
    max_change_bearish: float = 1.0          # Max change % for bearish volume confirmation
    

@dataclass
class SignalFilteringConfig:
    """Signal quality and filtering parameters"""
    # Confidence thresholds
    min_confidence_regular: float = 0.3      # Minimum confidence for regular signals (lowered from 70%)
    min_confidence_prebreak_pullback: float = 0.4   # Minimum threshold for PRE_BREAKOUT/PULLBACK (lowered from 70%)
    min_confidence_short: float = 0.4        # 40% minimum for short signals (lowered from 60%)
    
    # RSI confirmation thresholds
    overbought_rsi_threshold: float = 65      # Daily RSI overbought threshold (lowered from 70)
    min_15_rsi_confirmation: float = 60       # 15-min RSI confirmation threshold (lowered from 65)
    strong_15_rsi_threshold: float = 70       # Strong 15-min RSI threshold for bonus (lowered from 75)
    confidence_bonus: float = 0.15           # Bonus for strong confirmations (increased from 0.1)
    
    # Volume and momentum filters
    min_volume_ratio: float = 1.2             # Minimum volume ratio for signals (lowered from 1.5)
    min_change_overbought: float = 1.0        # Minimum price change for overbought signals (lowered from 2.0)


@dataclass
class OverextensionConfig:
    """Parameters for detecting overextended moves"""
    max_daily_change: float = 6.0            # Max daily change: 6%
    max_weekly_performance: float = 12.0     # Max weekly performance: 12%
    max_monthly_performance: float = 40.0    # Max monthly performance: 40%
    
    # Volume divergence detection
    high_volume_ratio_threshold: float = 5.0  # High volume ratio threshold
    weak_price_action_threshold: float = 2.0  # Weak price action threshold


@dataclass
class DataConfig:
    """Data fetching and caching configuration"""
    # Historical data parameters
    volatility_lookback_days: int = 15       # Days for volatility calculation
    atr_lookback_days: int = 30              # Days for ATR calculation
    atr_period: int = 14                     # ATR calculation period
    
    # Intraday data parameters
    gap_analysis_lookback_days: int = 60     # Days for gap analysis
    reversal_analysis_candles: int = 5       # Candles for reversal analysis
    rsi_15min_lookback_days: int = 3         # Days for 15-min RSI calculation


@dataclass 
class TelegramConfig:
    """Telegram notification configuration"""
    max_daily_notifications: int = 50        # Max notifications per day
    notification_cooldown_seconds: int = 300 # Cooldown between similar notifications


class TVTradingConfig:
    """Main configuration class that combines all config sections"""
    
    def __init__(self, 
                 risk_management: Optional[RiskManagementConfig] = None,
                 trailing_stops: Optional[TrailingStopsConfig] = None,
                 trading_hours: Optional[TradingHoursConfig] = None,
                 position_sizing: Optional[PositionSizingConfig] = None,
                 downtrend: Optional[DowntrendConfig] = None,
                 signal_filtering: Optional[SignalFilteringConfig] = None,
                 overextension: Optional[OverextensionConfig] = None,
                 data: Optional[DataConfig] = None,
                 telegram: Optional[TelegramConfig] = None):
        
        self.risk_management = risk_management or RiskManagementConfig()
        self.trailing_stops = trailing_stops or TrailingStopsConfig()
        self.trading_hours = trading_hours or TradingHoursConfig()
        self.position_sizing = position_sizing or PositionSizingConfig()
        self.downtrend = downtrend or DowntrendConfig()
        self.signal_filtering = signal_filtering or SignalFilteringConfig()
        self.overextension = overextension or OverextensionConfig()
        self.data = data or DataConfig()
        self.telegram = telegram or TelegramConfig()
    
    def get_trailing_buffer(self, profit_pct: float, is_ultra_quick: bool = False) -> float:
        """Get trailing buffer based on profit percentage and mode"""
        buffers = (self.trailing_stops.ultra_quick_buffers if is_ultra_quick 
                  else self.trailing_stops.trailing_buffers)
        
        # Find the appropriate buffer tier
        for threshold in sorted(buffers.keys(), reverse=True):
            if profit_pct >= threshold:
                return buffers[threshold]
        
        # Fallback to the lowest tier
        return buffers[0.0]
    
    def is_ultra_quick_trigger(self, trade_duration_minutes: float, profit_pct: float) -> bool:
        """Check if ultra-quick trailing should be activated"""
        if trade_duration_minutes <= 3 and profit_pct >= self.trailing_stops.ultra_quick_3min_pct:
            return True
        elif trade_duration_minutes <= 5 and profit_pct >= self.trailing_stops.ultra_quick_5min_pct:
            return True
        elif trade_duration_minutes <= 10 and profit_pct >= self.trailing_stops.ultra_quick_10min_pct:
            return True
        return False
    
    def is_overextended(self, daily_change: float = 0, weekly_perf: float = 0, 
                       monthly_perf: float = 0, volume_ratio: float = 1.0) -> tuple[bool, str]:
        """Check if stock is overextended"""
        if daily_change > self.overextension.max_daily_change:
            return True, f"daily move too extreme (+{daily_change:.1f}% > {self.overextension.max_daily_change}%)"
        
        if volume_ratio > self.overextension.high_volume_ratio_threshold and daily_change < self.overextension.weak_price_action_threshold:
            return True, f"high volume ({volume_ratio:.1f}x) with weak price action"
        
        if weekly_perf > self.overextension.max_weekly_performance:
            return True, f"weekly move too extended (+{weekly_perf:.1f}% > {self.overextension.max_weekly_performance}%)"
        
        if monthly_perf > self.overextension.max_monthly_performance:
            return True, f"monthly move too extended (+{monthly_perf:.1f}% > {self.overextension.max_monthly_performance}%)"
        
        return False, ""
    
    def should_skip_for_cooldown(self, symbol: str, last_alert_times: Dict[str, Any], 
                                stop_loss_cooldowns: Dict[str, Any], loss_cooldowns: Dict[str, Any]) -> tuple[bool, str]:
        """Check if symbol should be skipped due to cooldown"""
        from datetime import datetime
        current_time = datetime.now()
        
        # Check stop loss cooldown
        if symbol in stop_loss_cooldowns:
            time_diff = (current_time - stop_loss_cooldowns[symbol]).total_seconds()
            if time_diff < self.risk_management.stop_loss_cooldown_seconds:
                cooldown_left = self.risk_management.stop_loss_cooldown_seconds - time_diff
                return True, f"STOP_LOSS_COOLDOWN ({cooldown_left/60:.0f}m left)"
        
        # Check loss cooldown
        if symbol in loss_cooldowns:
            time_diff = (current_time - loss_cooldowns[symbol]).total_seconds()
            if time_diff < self.risk_management.loss_cooldown_seconds:
                cooldown_left = self.risk_management.loss_cooldown_seconds - time_diff
                return True, f"LOSS_COOLDOWN ({cooldown_left/60:.1f}m left)"
        
        return False, ""


# Default configuration instance
DEFAULT_CONFIG = TVTradingConfig()


def get_config() -> TVTradingConfig:
    """Get the default trading configuration"""
    return DEFAULT_CONFIG


def create_custom_config(**overrides) -> TVTradingConfig:
    """Create a custom configuration with specific overrides"""
    return TVTradingConfig(**overrides)


# Configuration presets for different trading styles
AGGRESSIVE_CONFIG = TVTradingConfig(
    risk_management=RiskManagementConfig(
        regular_stop_loss_pct=-0.3,  # Tighter stop: -0.3%
        take_profit_pct=0.3,         # Lower take profit: 0.3%
        max_daily_entries_per_stock=3  # More entries allowed
    ),
    trailing_stops=TrailingStopsConfig(
        ultra_quick_3min_pct=0.6,    # Lower threshold: 0.6%
        ultra_quick_5min_pct=0.8,    # Lower threshold: 0.8%
        ultra_quick_10min_pct=1.2    # Lower threshold: 1.2%
    )
)

CONSERVATIVE_CONFIG = TVTradingConfig(
    risk_management=RiskManagementConfig(
        regular_stop_loss_pct=-0.7,  # Wider stop: -0.7%
        take_profit_pct=0.6,         # Higher take profit: 0.6%
        max_daily_entries_per_stock=1  # Only 1 entry per stock
    ),
    trailing_stops=TrailingStopsConfig(
        ultra_quick_3min_pct=1.2,    # Higher threshold: 1.2%
        ultra_quick_5min_pct=1.5,    # Higher threshold: 1.5%
        ultra_quick_10min_pct=2.0    # Higher threshold: 2.0%
    )
)