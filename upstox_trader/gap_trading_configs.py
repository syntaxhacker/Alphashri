#!/usr/bin/env python3
"""
Gap Trading Strategy Configurations - Easy Testing
==================================================

This file contains pre-defined configurations for testing different gap trading scenarios.
Simply import and use these configs to test specific strategies.

Usage:
    from gap_trading_configs import GAP_UP_ONLY, GAP_DOWN_ONLY, LONG_ONLY, etc.
    tester = ExpandedTimeframeTest(config=GAP_UP_ONLY)
"""

# 🎯 DIRECTIONAL TESTING CONFIGS

GAP_UP_ONLY = {
    'gap_up_enabled': True,      # ✅ Test only gap up trades
    'gap_down_enabled': False,   # ❌ Disable gap down trades
    'long_trades_enabled': True,
    'short_trades_enabled': True,
}

GAP_DOWN_ONLY = {
    'gap_up_enabled': False,     # ❌ Disable gap up trades  
    'gap_down_enabled': True,    # ✅ Test only gap down trades
    'long_trades_enabled': True,
    'short_trades_enabled': True,
}

LONG_ONLY = {
    'gap_up_enabled': True,
    'gap_down_enabled': False,   # Only gap ups can generate longs
    'long_trades_enabled': True, # ✅ Test only long trades
    'short_trades_enabled': False, # ❌ Disable short trades
}

SHORT_ONLY = {
    'gap_up_enabled': False,     # Only gap downs can generate shorts
    'gap_down_enabled': True,
    'long_trades_enabled': False, # ❌ Disable long trades
    'short_trades_enabled': True, # ✅ Test only short trades
}

# 🔧 FEATURE TESTING CONFIGS

BASIC_STRATEGY = {
    # Disable all advanced features - test basic gap trading
    'volume_validation_enabled': False,
    'time_filters_enabled': False,
    'dynamic_risk_enabled': False,
    'candle_strength_required': False,
    'direction_confirmation_required': True,  # Keep basic confirmation
}

VOLUME_ONLY = {
    # Test only volume validation
    'volume_validation_enabled': True,
    'time_filters_enabled': False,
    'dynamic_risk_enabled': False,
    'candle_strength_required': False,
}

TIME_FILTERS_ONLY = {
    # Test only time-based filters
    'volume_validation_enabled': False,
    'time_filters_enabled': True,
    'dynamic_risk_enabled': False,
    'candle_strength_required': False,
}

CANDLE_STRENGTH_ONLY = {
    # Test only candle strength requirement
    'volume_validation_enabled': False,
    'time_filters_enabled': False,
    'dynamic_risk_enabled': False,
    'candle_strength_required': True,
}

DYNAMIC_RISK_ONLY = {
    # Test only dynamic risk management
    'volume_validation_enabled': False,
    'time_filters_enabled': False,
    'dynamic_risk_enabled': True,
    'candle_strength_required': False,
}

# 📊 RISK PROFILE CONFIGS

CONSERVATIVE = {
    'gap_threshold': 1.0,        # Higher gap threshold
    'max_gap_threshold': 3.0,    # Lower max gap (avoid big moves)
    'stop_loss_pct': -0.5,       # Tight stop loss
    'target_pct': 1.5,           # Conservative target
    'min_volume_multiplier': 1.5, # Higher volume requirement
    'volume_validation_enabled': True,
    'time_filters_enabled': True,
    'candle_strength_required': True,
}

AGGRESSIVE = {
    'gap_threshold': 0.3,        # Lower gap threshold
    'max_gap_threshold': 8.0,    # Higher max gap (allow big moves)
    'stop_loss_pct': -2.0,       # Wider stop loss
    'target_pct': 4.0,           # Aggressive target
    'min_volume_multiplier': 1.0, # Lower volume requirement
    'volume_validation_enabled': False,
    'time_filters_enabled': False,
    'candle_strength_required': False,
}

BALANCED = {
    # Default balanced approach (same as default config)
    'gap_threshold': 0.5,
    'max_gap_threshold': 5.0,
    'stop_loss_pct': -1.0,
    'target_pct': 2.5,
    'min_volume_multiplier': 1.2,
}

# 🧪 RESEARCH CONFIGS

NO_CONFIRMATIONS = {
    # Test raw gap trading without any confirmations
    'direction_confirmation_required': False,
    'candle_strength_required': False,
    'volume_validation_enabled': False,
    'time_filters_enabled': False,
    'dynamic_risk_enabled': False,
}

ALL_CONFIRMATIONS = {
    # Test with all possible confirmations enabled
    'direction_confirmation_required': True,
    'candle_strength_required': True,
    'volume_validation_enabled': True,
    'time_filters_enabled': True,
    'dynamic_risk_enabled': True,
    'gap_size_scaling': True,
    'time_based_scaling': True,
}

# 📈 QUICK TEST CONFIGS

QUICK_GAP_UP_TEST = {
    **GAP_UP_ONLY,
    'gap_threshold': 0.3,        # Catch more gaps
    'max_gap_threshold': 3.0,    # Avoid huge gaps
}

QUICK_GAP_DOWN_TEST = {
    **GAP_DOWN_ONLY,
    'gap_threshold': 0.3,        # Catch more gaps
    'max_gap_threshold': 3.0,    # Avoid huge gaps
}

# 🎯 COMPARISON CONFIGS

CONFIG_COMPARISON_SET = {
    'basic': BASIC_STRATEGY,
    'conservative': CONSERVATIVE,
    'aggressive': AGGRESSIVE,
    'gap_up_only': GAP_UP_ONLY,
    'gap_down_only': GAP_DOWN_ONLY,
    'long_only': LONG_ONLY,
    'short_only': SHORT_ONLY,
}

def print_config_summary(config_name: str, config: dict):
    """Print a summary of a configuration"""
    print(f"\n📋 {config_name.upper()} CONFIGURATION:")
    print("-" * 50)
    
    # Direction controls
    gap_up = config.get('gap_up_enabled', True)
    gap_down = config.get('gap_down_enabled', True)
    long_trades = config.get('long_trades_enabled', True)
    short_trades = config.get('short_trades_enabled', True)
    
    print(f"🎯 Gap Up: {'✅' if gap_up else '❌'} | Gap Down: {'✅' if gap_down else '❌'}")
    print(f"📈 Long: {'✅' if long_trades else '❌'} | Short: {'✅' if short_trades else '❌'}")
    
    # Risk parameters
    gap_min = config.get('gap_threshold', 0.5)
    gap_max = config.get('max_gap_threshold', 5.0)
    stop = config.get('stop_loss_pct', -1.0)
    target = config.get('target_pct', 2.5)
    
    print(f"📊 Gap Range: {gap_min}% - {gap_max}%")
    print(f"💰 Risk: {stop}% stop | {target}% target")
    
    # Validation features
    volume_val = config.get('volume_validation_enabled', True)
    time_filters = config.get('time_filters_enabled', True)
    candle_strength = config.get('candle_strength_required', True)
    dynamic_risk = config.get('dynamic_risk_enabled', True)
    
    print(f"🔧 Features: Vol{'✅' if volume_val else '❌'} | Time{'✅' if time_filters else '❌'} | Candle{'✅' if candle_strength else '❌'} | Dynamic{'✅' if dynamic_risk else '❌'}")

def show_all_configs():
    """Show all available configurations"""
    print("🎯 AVAILABLE GAP TRADING CONFIGURATIONS")
    print("="*60)
    
    configs = {
        'GAP_UP_ONLY': GAP_UP_ONLY,
        'GAP_DOWN_ONLY': GAP_DOWN_ONLY,
        'LONG_ONLY': LONG_ONLY,
        'SHORT_ONLY': SHORT_ONLY,
        'CONSERVATIVE': CONSERVATIVE,
        'AGGRESSIVE': AGGRESSIVE,
        'BASIC_STRATEGY': BASIC_STRATEGY,
        'ALL_CONFIRMATIONS': ALL_CONFIRMATIONS,
    }
    
    for name, config in configs.items():
        print_config_summary(name, config)

if __name__ == "__main__":
    show_all_configs()
    
    print(f"\n💡 USAGE EXAMPLES:")
    print("="*40)
    print("# Test only gap up trades")
    print("from gap_trading_configs import GAP_UP_ONLY")
    print("tester = ExpandedTimeframeTest(config=GAP_UP_ONLY)")
    print("")
    print("# Test conservative strategy")
    print("from gap_trading_configs import CONSERVATIVE")
    print("tester = ExpandedTimeframeTest(config=CONSERVATIVE)")
    print("")
    print("# Test basic strategy without advanced features")
    print("from gap_trading_configs import BASIC_STRATEGY")
    print("tester = ExpandedTimeframeTest(config=BASIC_STRATEGY)")