#!/usr/bin/env python3
"""
SCALPER CONFIGURATION PRESETS
Easy-to-modify trading parameter presets for different trading styles
"""

from aggressive_profit_scalper import ScalperConfig

def get_conservative_config():
    """Conservative scalping - Higher profits, smaller positions, less risk"""
    config = ScalperConfig()
    
    # Risk Management - CONSERVATIVE
    config.min_profit_pct = 0.50         # Wait for 0.50% profit
    config.max_loss_pct = 0.75           # Tight 0.75% stop loss
    config.trailing_stop_pct = 0.15      # Tight trailing stop
    
    # Position Sizing - SMALLER
    config.base_position_size = 0.300    # Smaller base size
    config.min_position_size = 0.200     # Minimum 0.2 BTC
    config.max_position_size = 0.800     # Maximum 0.8 BTC
    
    # Trading Frequency - SLOWER
    config.trade_delay_seconds = 15.0    # 15 seconds between trades
    config.min_confidence = 0.40         # Need 40% confidence
    
    # Signal Sensitivity - HIGHER QUALITY
    config.signal_confidence_threshold = 0.30  # 30% signal threshold
    config.trend_sensitivity = 0.010     # 0.01% trend sensitivity
    
    return config

def get_aggressive_config():
    """Aggressive scalping - Fast trades, bigger positions, more risk"""
    config = ScalperConfig()
    
    # Risk Management - AGGRESSIVE  
    config.min_profit_pct = 0.20         # Quick 0.20% profit
    config.max_loss_pct = 1.25           # Wider 1.25% stop loss
    config.trailing_stop_pct = 0.25      # Wider trailing stop
    
    # Position Sizing - BIGGER
    config.base_position_size = 1.500    # Bigger base size
    config.min_position_size = 0.800     # Minimum 0.8 BTC
    config.max_position_size = 4.000     # Maximum 4.0 BTC
    
    # Trading Frequency - FASTER
    config.trade_delay_seconds = 1.0     # 1 second between trades
    config.min_confidence = 0.20         # Only need 20% confidence
    
    # Signal Sensitivity - LOWER QUALITY
    config.signal_confidence_threshold = 0.15  # 15% signal threshold
    config.trend_sensitivity = 0.003     # 0.003% trend sensitivity
    
    return config

def get_balanced_config():
    """Balanced scalping - Default settings, good for most conditions"""
    config = ScalperConfig()  # Uses all defaults
    
    # This is the standard configuration - modify as needed
    # config.min_profit_pct = 0.30        # Already set
    # config.max_loss_pct = 1.00          # Already set
    # config.base_position_size = 1.000   # Already set
    
    return config

def get_high_frequency_config():
    """High frequency trading - Very fast, small profits, many trades"""
    config = ScalperConfig()
    
    # Risk Management - QUICK PROFITS
    config.min_profit_pct = 0.10         # Very quick 0.10% profit
    config.max_loss_pct = 0.80           # Tight stop loss
    config.trailing_stop_pct = 0.08      # Very tight trailing
    
    # Position Sizing - MODERATE
    config.base_position_size = 0.600    # Moderate size
    config.min_position_size = 0.400     # Minimum 0.4 BTC
    config.max_position_size = 1.500     # Maximum 1.5 BTC
    
    # Trading Frequency - ULTRA FAST
    config.trade_delay_seconds = 0.5     # 0.5 seconds between trades
    config.min_confidence = 0.15         # Very low confidence needed
    config.position_log_interval = 2.0   # Log every 2 seconds
    
    # Signal Sensitivity - VERY SENSITIVE
    config.signal_confidence_threshold = 0.10  # 10% signal threshold
    config.trend_sensitivity = 0.001     # 0.001% trend sensitivity
    
    return config

def get_whale_config():
    """Whale trading - Big positions, patient, high profits"""
    config = ScalperConfig()
    
    # Risk Management - PATIENT
    config.min_profit_pct = 0.80         # Wait for 0.80% profit
    config.max_loss_pct = 1.50           # Wide 1.50% stop loss
    config.trailing_stop_pct = 0.30      # Wide trailing stop
    config.position_timeout = 600        # 10 minutes max hold
    
    # Position Sizing - WHALE SIZE
    config.base_position_size = 3.000    # Big base size
    config.min_position_size = 2.000     # Minimum 2.0 BTC
    config.max_position_size = 8.000     # Maximum 8.0 BTC
    
    # Trading Frequency - PATIENT
    config.trade_delay_seconds = 30.0    # 30 seconds between trades
    config.min_confidence = 0.50         # Need 50% confidence
    
    # Signal Sensitivity - HIGH QUALITY ONLY
    config.signal_confidence_threshold = 0.40  # 40% signal threshold
    config.trend_sensitivity = 0.020     # 0.02% trend sensitivity
    
    return config

# USAGE EXAMPLES:
def show_config_comparison():
    """Show comparison of different configurations"""
    configs = {
        'Conservative': get_conservative_config(),
        'Balanced': get_balanced_config(), 
        'Aggressive': get_aggressive_config(),
        'High Frequency': get_high_frequency_config(),
        'Whale': get_whale_config()
    }
    
    print("\n🎯 CONFIGURATION COMPARISON:")
    print("=" * 60)
    print(f"{'Config':<15} {'Profit%':<8} {'Stop%':<8} {'Size':<8} {'Delay':<8} {'Conf%':<8}")
    print("-" * 60)
    
    for name, config in configs.items():
        print(f"{name:<15} {config.min_profit_pct:<8.2f} {config.max_loss_pct:<8.2f} "
              f"{config.base_position_size:<8.1f} {config.trade_delay_seconds:<8.1f} "
              f"{config.min_confidence*100:<8.0f}")

if __name__ == "__main__":
    show_config_comparison() 