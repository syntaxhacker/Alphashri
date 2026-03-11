#!/usr/bin/env python3
"""
Example usage of centralized TV Trading Configuration

This demonstrates how to use different configuration presets and create custom configurations.
"""

from tv_configs import (
    TVTradingConfig, get_config, create_custom_config,
    AGGRESSIVE_CONFIG, CONSERVATIVE_CONFIG,
    RiskManagementConfig, TrailingStopsConfig
)
from tv_screen_usage import TVScreenerUsage

def demo_default_config():
    """Demo using default configuration"""
    print("=== DEFAULT CONFIGURATION ===")
    
    # Use default config
    screener = TVScreenerUsage(enable_paper_trading=True)
    
    config = screener.config
    print(f"Stop Loss: {config.risk_management.regular_stop_loss_pct}%")
    print(f"Take Profit: {config.risk_management.take_profit_pct}%")
    print(f"Max Daily Entries: {config.risk_management.max_daily_entries_per_stock}")
    print(f"Ultra-Quick 3min: {config.trailing_stops.ultra_quick_3min_pct}%")
    print(f"Trading Hours: {config.trading_hours.trading_start_time} - {config.trading_hours.trading_end_time}")


def demo_aggressive_config():
    """Demo using aggressive configuration preset"""
    print("\n=== AGGRESSIVE CONFIGURATION ===")
    
    # Use aggressive preset
    screener = TVScreenerUsage(enable_paper_trading=True, config=AGGRESSIVE_CONFIG)
    
    config = screener.config
    print(f"Stop Loss: {config.risk_management.regular_stop_loss_pct}%")
    print(f"Take Profit: {config.risk_management.take_profit_pct}%")
    print(f"Max Daily Entries: {config.risk_management.max_daily_entries_per_stock}")
    print(f"Ultra-Quick 3min: {config.trailing_stops.ultra_quick_3min_pct}%")


def demo_conservative_config():
    """Demo using conservative configuration preset"""
    print("\n=== CONSERVATIVE CONFIGURATION ===")
    
    # Use conservative preset  
    screener = TVScreenerUsage(enable_paper_trading=True, config=CONSERVATIVE_CONFIG)
    
    config = screener.config
    print(f"Stop Loss: {config.risk_management.regular_stop_loss_pct}%")
    print(f"Take Profit: {config.risk_management.take_profit_pct}%")
    print(f"Max Daily Entries: {config.risk_management.max_daily_entries_per_stock}")
    print(f"Ultra-Quick 3min: {config.trailing_stops.ultra_quick_3min_pct}%")


def demo_custom_config():
    """Demo creating a custom configuration"""
    print("\n=== CUSTOM CONFIGURATION ===")
    
    # Create custom configuration with specific overrides
    custom_config = TVTradingConfig(
        risk_management=RiskManagementConfig(
            regular_stop_loss_pct=-0.8,  # Wider stop loss
            take_profit_pct=0.2,         # Lower take profit  
            max_daily_entries_per_stock=5  # Allow more entries
        ),
        trailing_stops=TrailingStopsConfig(
            ultra_quick_3min_pct=0.5,    # Even faster ultra-quick
            ultra_quick_5min_pct=0.7,    # Even faster quick
            ultra_quick_10min_pct=1.0    # Even faster fast
        )
    )
    
    screener = TVScreenerUsage(enable_paper_trading=True, config=custom_config)
    
    config = screener.config
    print(f"Stop Loss: {config.risk_management.regular_stop_loss_pct}%")
    print(f"Take Profit: {config.risk_management.take_profit_pct}%") 
    print(f"Max Daily Entries: {config.risk_management.max_daily_entries_per_stock}")
    print(f"Ultra-Quick 3min: {config.trailing_stops.ultra_quick_3min_pct}%")


def demo_config_methods():
    """Demo using config helper methods"""
    print("\n=== CONFIGURATION METHODS ===")
    
    config = get_config()
    
    # Demo trailing buffer calculation
    print("Trailing Buffers (Regular):")
    for profit in [0.5, 1.0, 1.5, 2.0]:
        buffer = config.get_trailing_buffer(profit, is_ultra_quick=False)
        print(f"  {profit}% profit -> {buffer}% buffer")
        
    print("\nTrailing Buffers (Ultra-Quick):")
    for profit in [0.8, 1.0, 1.5, 2.0]:
        buffer = config.get_trailing_buffer(profit, is_ultra_quick=True)
        print(f"  {profit}% profit -> {buffer}% buffer")
        
    # Demo ultra-quick trigger detection
    print("\nUltra-Quick Trigger Tests:")
    test_cases = [
        (2.5, 0.8),  # 0.8% in 2.5min -> True
        (3.5, 0.8),  # 0.8% in 3.5min -> False
        (4.5, 1.0),  # 1.0% in 4.5min -> True
        (9.5, 1.5),  # 1.5% in 9.5min -> True
        (11.0, 1.5), # 1.5% in 11min -> False
    ]
    
    for minutes, profit in test_cases:
        is_trigger = config.is_ultra_quick_trigger(minutes, profit)
        print(f"  {profit}% in {minutes}min -> {is_trigger}")
        
    # Demo overextension check
    print("\nOverextension Tests:")
    test_cases = [
        (7.0, 8.0, 25.0, 2.0),   # Too high daily change
        (3.0, 15.0, 25.0, 2.0),  # Too high weekly 
        (3.0, 8.0, 45.0, 2.0),   # Too high monthly
        (1.8, 8.0, 25.0, 6.0),   # High volume with weak price action
        (3.0, 8.0, 25.0, 2.0),   # Normal - should pass
    ]
    
    for daily, weekly, monthly, vol_ratio in test_cases:
        is_extended, reason = config.is_overextended(daily, weekly, monthly, vol_ratio)
        print(f"  D:{daily}% W:{weekly}% M:{monthly}% V:{vol_ratio}x -> {is_extended} {reason}")


if __name__ == "__main__":
    demo_default_config()
    demo_aggressive_config()  
    demo_conservative_config()
    demo_custom_config()
    demo_config_methods()