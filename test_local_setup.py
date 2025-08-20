#!/usr/bin/env python3
"""
Local Setup Test Script

This script tests the basic functionality before running the full Flask app.
"""

import os
import sys
from pathlib import Path

def test_imports():
    """Test if all required modules can be imported"""
    print("🧪 Testing imports...")
    
    try:
        import flask
        print("✅ Flask imported successfully")
    except ImportError as e:
        print(f"❌ Flask import failed: {e}")
        return False
    
    try:
        import rookiepy
        print("✅ rookiepy imported successfully")
    except ImportError as e:
        print(f"❌ rookiepy import failed: {e}")
        return False
    
    try:
        from tradingview_screener import Query, col
        print("✅ tradingview-screener imported successfully")
    except ImportError as e:
        print(f"❌ tradingview-screener import failed: {e}")
        return False
    
    try:
        from rich.console import Console
        print("✅ Rich imported successfully")
    except ImportError as e:
        print(f"❌ Rich import failed: {e}")
        return False
        
    return True

def test_config_system():
    """Test the centralized config system"""
    print("\n🔧 Testing config system...")
    
    try:
        sys.path.insert(0, str(Path(__file__).parent / "upstox_trader" / "screeners"))
        from tv_configs import TVTradingConfig, get_config, AGGRESSIVE_CONFIG, CONSERVATIVE_CONFIG
        
        # Test default config
        config = get_config()
        print(f"✅ Default config loaded - Stop loss: {config.risk_management.regular_stop_loss_pct}%")
        
        # Test config methods
        buffer = config.get_trailing_buffer(1.0, is_ultra_quick=False)
        print(f"✅ Trailing buffer calculation: 1.0% profit -> {buffer}% buffer")
        
        # Test ultra-quick trigger
        is_trigger = config.is_ultra_quick_trigger(2.5, 0.8)
        print(f"✅ Ultra-quick trigger: 0.8% in 2.5min -> {is_trigger}")
        
        # Test presets
        print(f"✅ Aggressive config - Stop loss: {AGGRESSIVE_CONFIG.risk_management.regular_stop_loss_pct}%")
        print(f"✅ Conservative config - Stop loss: {CONSERVATIVE_CONFIG.risk_management.regular_stop_loss_pct}%")
        
        return True
    except Exception as e:
        print(f"❌ Config system test failed: {e}")
        return False

def test_trading_screener():
    """Test basic trading screener functionality"""
    print("\n📊 Testing trading screener...")
    
    try:
        sys.path.insert(0, str(Path(__file__).parent / "upstox_trader" / "screeners"))
        from tv_screen_usage import TVScreenerUsage
        
        # Initialize screener with paper trading
        screener = TVScreenerUsage(market='in', enable_paper_trading=True)
        print("✅ TVScreenerUsage initialized successfully")
        
        # Test config integration
        config = screener.config
        print(f"✅ Config integration - Take profit: {config.risk_management.take_profit_pct}%")
        
        # Test basic methods exist
        if hasattr(screener, '_get_tighter_trailing_buffer'):
            buffer = screener._get_tighter_trailing_buffer(1.0, is_ultra_quick=True)
            print(f"✅ Ultra-quick trailing buffer: {buffer}%")
        
        return True
    except Exception as e:
        print(f"❌ Trading screener test failed: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_environment():
    """Test environment configuration"""
    print("\n🌍 Testing environment...")
    
    # Load environment variables
    try:
        from dotenv import load_dotenv
        load_dotenv('.env.local')
        
        paper_trading = os.getenv('PAPER_TRADING_ENABLED', 'true').lower() == 'true'
        market = os.getenv('MARKET', 'in')
        trading_mode = os.getenv('TRADING_MODE', 'volume_spike_monitor')
        
        print(f"✅ Environment loaded:")
        print(f"   📄 Paper Trading: {paper_trading}")
        print(f"   🌍 Market: {market}")
        print(f"   ⚡ Trading Mode: {trading_mode}")
        
        return True
    except Exception as e:
        print(f"❌ Environment test failed: {e}")
        return False

def main():
    """Run all tests"""
    print("🚀 Local Setup Testing")
    print("=" * 50)
    
    tests = [
        ("Import Test", test_imports),
        ("Config System Test", test_config_system), 
        ("Trading Screener Test", test_trading_screener),
        ("Environment Test", test_environment)
    ]
    
    passed = 0
    total = len(tests)
    
    for test_name, test_func in tests:
        print(f"\n🔍 Running {test_name}...")
        if test_func():
            print(f"✅ {test_name} PASSED")
            passed += 1
        else:
            print(f"❌ {test_name} FAILED")
    
    print("\n" + "=" * 50)
    print(f"📊 Test Results: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All tests passed! Ready to run Flask app.")
        return True
    else:
        print("⚠️  Some tests failed. Please fix issues before proceeding.")
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)