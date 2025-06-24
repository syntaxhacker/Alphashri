#!/usr/bin/env python3
"""
CONFIGURATION VERIFICATION SCRIPT
Verify that the new ScalperConfig defaults match the original hardcoded values
"""

from aggressive_profit_scalper import ScalperConfig

def verify_original_values():
    """Verify that ScalperConfig defaults match original hardcoded values"""
    
    config = ScalperConfig()
    
    print("🔍 CONFIGURATION VERIFICATION")
    print("=" * 50)
    print("Comparing NEW ScalperConfig defaults vs ORIGINAL hardcoded values:")
    print()
    
    # CORE TRADING SETTINGS - ORIGINAL VALUES
    original_values = {
        'leverage': 100,
        'min_profit_pct': 0.30,
        'max_loss_pct': 1.00, 
        'trailing_stop_pct': 0.20,
        'position_timeout': 300,
        
        # POSITION SIZING - ORIGINAL VALUES  
        'base_position_size': 1.000,
        'min_position_size': 0.500,
        'max_position_size': 3.000,
        'confidence_multiplier_max': 3.0,
        
        # SIGNAL THRESHOLDS - ORIGINAL VALUES
        'min_confidence': 0.25,
        'signal_confidence_threshold': 0.2,
        
        # TIMING CONTROLS - ORIGINAL VALUES
        'trade_delay_seconds': 3.0,
        'position_log_interval': 5.0,
        'trend_analysis_window': 30,
        'trend_sensitivity': 0.005,
        
        # TRAILING STOP SETTINGS - ORIGINAL VALUES
        'trailing_activation_profit': 0.05,
        'trailing_tightness_factor': 0.5,
    }
    
    # SIGNAL WEIGHTS - ORIGINAL VALUES
    original_signal_weights = {
        'volume': 0.35,
        'momentum': 0.25,
        'order_flow': 0.20,
        'spread': 0.10,
        'contrarian': 0.08,
        'random': 0.02
    }
    
    # MARKET SIGNAL THRESHOLDS - ORIGINAL VALUES
    original_thresholds = {
        'volume_imbalance_threshold': 0.1,
        'order_flow_threshold': 0.05,
        'large_trade_min_count': 2,
        'spread_compression_threshold': 0.05,
        'depth_imbalance_threshold': 0.1,
        'momentum_threshold': 0.0001,
    }
    
    # VERIFICATION
    all_match = True
    
    print("📊 CORE TRADING SETTINGS:")
    print("-" * 30)
    for key, original in original_values.items():
        current = getattr(config, key)
        match = "✅" if current == original else "❌"
        if current != original:
            all_match = False
        print(f"{match} {key}: {current} (original: {original})")
    
    print("\n📊 SIGNAL WEIGHTS:")
    print("-" * 30)
    for key, original in original_signal_weights.items():
        current = config.signal_weights.get(key)
        match = "✅" if current == original else "❌"
        if current != original:
            all_match = False
        print(f"{match} {key}: {current} (original: {original})")
    
    print("\n📊 MARKET SIGNAL THRESHOLDS:")
    print("-" * 30)
    for key, original in original_thresholds.items():
        current = getattr(config, key)
        match = "✅" if current == original else "❌"
        if current != original:
            all_match = False
        print(f"{match} {key}: {current} (original: {original})")
    
    print("\n" + "=" * 50)
    if all_match:
        print("🎉 VERIFICATION PASSED: All values match exactly!")
        print("✅ No existing behavior has been changed.")
        print("✅ Only configuration system has been added.")
    else:
        print("❌ VERIFICATION FAILED: Some values don't match!")
        print("⚠️  Existing behavior may have changed.")
    
    print("=" * 50)
    
    return all_match

if __name__ == "__main__":
    verify_original_values() 