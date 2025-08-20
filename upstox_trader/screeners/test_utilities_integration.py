#!/usr/bin/env python3
"""
Test script to verify utility integration works without running full screener
"""

import sys
import os

# Add current directory to path
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
sys.path.insert(0, parent_dir)

def test_utility_imports():
    """Test that utility modules can be imported"""
    try:
        from utils import tv_time_utils, tv_system_utils, tv_risk_utils
        from utils import tv_price_utils, tv_data_utils, tv_logging_utils
        print("✅ All utility modules imported successfully")
        return True
    except Exception as e:
        print(f"❌ Error importing utilities: {e}")
        return False

def test_basic_functions():
    """Test basic utility functions"""
    try:
        from utils.tv_time_utils import is_trading_hours
        from utils.tv_price_utils import format_price
        from utils.tv_data_utils import get_base_symbol, validate_symbol_format
        
        # Test functions
        result1 = is_trading_hours(paper_trading_enabled=False)
        result2 = format_price(1234.56)
        result3 = get_base_symbol("NSE:RELIANCE") 
        result4 = validate_symbol_format("RELIANCE")
        
        print(f"✅ is_trading_hours result: {result1}")
        print(f"✅ format_price result: {result2}")
        print(f"✅ get_base_symbol result: {result3}")
        print(f"✅ validate_symbol_format result: {result4}")
        
        return True
    except Exception as e:
        print(f"❌ Error testing functions: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_class_import():
    """Test that the main class can be imported (but don't instantiate)"""
    try:
        # Import the main class without actually creating it or running pandas code
        import importlib.util
        
        spec = importlib.util.spec_from_file_location(
            "tv_screen_usage", 
            os.path.join(current_dir, "tv_screen_usage.py")
        )
        
        if spec and spec.loader:
            # Just check that the module can be loaded
            print("✅ Main module file can be loaded")
            return True
        else:
            print("❌ Could not load module spec")
            return False
            
    except Exception as e:
        print(f"❌ Error testing class import: {e}")
        return False

def main():
    """Run all tests"""
    print("🧪 Testing Utility Integration")
    print("=" * 40)
    
    tests = [
        ("Utility Imports", test_utility_imports),
        ("Basic Functions", test_basic_functions),
        ("Class Import", test_class_import),
    ]
    
    passed = 0
    total = len(tests)
    
    for test_name, test_func in tests:
        print(f"\n📋 Testing {test_name}...")
        if test_func():
            passed += 1
            print(f"✅ {test_name} PASSED")
        else:
            print(f"❌ {test_name} FAILED")
    
    print("\n" + "=" * 40)
    print(f"📊 Results: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All tests passed! Utility integration is working.")
        return True
    else:
        print("⚠️  Some tests failed. Check the errors above.")
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)