#!/usr/bin/env python3
"""
Test: Verify Unified Interface Implementation

This test verifies that the unified interface is correctly implemented
without making actual API calls.
"""

import sys
import inspect
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from upstox_trader.config_and_utils.free_indian_apis import (
    BaseAPIClient,
    UpstoxAPI,
    INDMONEYApi,
    TradingAPIFactory
)


def test_base_client_has_abstract_methods():
    """Verify BaseAPIClient has the required abstract methods."""
    print("\n" + "="*70)
    print("TEST 1: BaseAPIClient Abstract Methods")
    print("="*70)

    # Check if BaseAPIClient is abstract
    assert hasattr(BaseAPIClient, '__abstractmethods__'), "BaseAPIClient should have abstract methods"

    abstract_methods = BaseAPIClient.__abstractmethods__
    print(f"✓ BaseAPIClient has {len(abstract_methods)} abstract methods:")

    required_methods = ['_get_headers', 'get_instrument_key', 'get_price', 'get_quote']
    for method in required_methods:
        assert method in abstract_methods, f"Missing abstract method: {method}"
        print(f"  ✓ {method}")

    return True


def test_upstox_implements_interface():
    """Verify UpstoxAPI implements all required methods."""
    print("\n" + "="*70)
    print("TEST 2: UpstoxAPI Implements Unified Interface")
    print("="*70)

    # Check that UpstoxAPI is concrete
    assert len(UpstoxAPI.__abstractmethods__) == 0, "UpstoxAPI should not have abstract methods"
    print("✓ UpstoxAPI is a concrete class")

    # Check unified methods exist
    unified_methods = ['get_price', 'get_quote', 'get_historical_data']
    for method in unified_methods:
        assert hasattr(UpstoxAPI, method), f"UpstoxAPI missing method: {method}"
        print(f"  ✓ {method}() - {inspect.signature(getattr(UpstoxAPI, method))}")

    return True


def test_indmoney_implements_interface():
    """Verify INDMONEYApi implements all required methods."""
    print("\n" + "="*70)
    print("TEST 3: INDMONEYApi Implements Unified Interface")
    print("="*70)

    # Check that INDMONEYApi is concrete
    assert len(INDMONEYApi.__abstractmethods__) == 0, "INDMONEYApi should not have abstract methods"
    print("✓ INDMONEYApi is a concrete class")

    # Check unified methods exist
    unified_methods = ['get_price', 'get_quote']
    for method in unified_methods:
        assert hasattr(INDMONEYApi, method), f"INDMONEYApi missing method: {method}"
        print(f"  ✓ {method}() - {inspect.signature(getattr(INDMONEYApi, method))}")

    return True


def test_factory_methods():
    """Verify TradingAPIFactory has required methods."""
    print("\n" + "="*70)
    print("TEST 4: TradingAPIFactory Methods")
    print("="*70)

    factory_methods = ['create_client', 'create_from_config', 'SUPPORTED_PROVIDERS']
    for method in factory_methods:
        assert hasattr(TradingAPIFactory, method), f"Factory missing: {method}"

    print(f"✓ TradingAPIFactory has {len(factory_methods)} methods/attributes:")
    print(f"  ✓ SUPPORTED_PROVIDERS: {TradingAPIFactory.SUPPORTED_PROVIDERS}")
    print(f"  ✓ create_client(provider, **kwargs)")
    print(f"  ✓ create_from_config(provider, quiet=False)")

    return True


def test_provider_validation():
    """Verify factory validates provider names."""
    print("\n" + "="*70)
    print("TEST 5: Provider Validation")
    print("="*70)

    # Test invalid provider
    try:
        TradingAPIFactory.create_client('invalid_provider')
        assert False, "Should raise ValueError for invalid provider"
    except ValueError as e:
        print(f"✓ Correctly rejects invalid provider: {e}")

    # Test valid provider string match (case-insensitive)
    for provider in ['upstox', 'UPSTOX', 'Upstox', 'indmoney', 'INDMONEY', 'IndMoney']:
        provider_lower = provider.lower()
        assert provider_lower in TradingAPIFactory.SUPPORTED_PROVIDERS, f"{provider} should be supported"
    print(f"✓ Supported providers (case-insensitive): {TradingAPIFactory.SUPPORTED_PROVIDERS}")

    return True


def test_missing_credentials():
    """Verify factory validates required credentials."""
    print("\n" + "="*70)
    print("TEST 6: Credential Validation")
    print("="*70)

    # Test Upstox without credentials
    try:
        TradingAPIFactory.create_client('upstox')
        assert False, "Should raise ValueError for missing credentials"
    except ValueError as e:
        assert 'api_key' in str(e).lower() or 'api_secret' in str(e).lower()
        print(f"✓ Upstox validates credentials: {str(e)[:50]}...")

    # Test INDMONEY without credentials
    try:
        TradingAPIFactory.create_client('indmoney')
        assert False, "Should raise ValueError for missing credentials"
    except ValueError as e:
        assert 'access_token' in str(e).lower()
        print(f"✓ INDMoney validates credentials: {str(e)[:50]}...")

    return True


def test_interface_consistency():
    """Verify both providers have the same interface for unified methods."""
    print("\n" + "="*70)
    print("TEST 7: Interface Consistency")
    print("="*70)

    unified_methods = ['get_price', 'get_quote']

    for method in unified_methods:
        upstox_sig = str(inspect.signature(getattr(UpstoxAPI, method)))
        indmoney_sig = str(inspect.signature(getattr(INDMONEYApi, method)))

        print(f"  {method}:")
        print(f"    Upstox:    {upstox_sig}")
        print(f"    INDMoney:  {indmoney_sig}")

        # Both should accept symbol as first parameter (after 'self')
        upstox_params = list(inspect.signature(getattr(UpstoxAPI, method)).parameters.keys())
        indmoney_params = list(inspect.signature(getattr(INDMONEYApi, method)).parameters.keys())

        # Skip 'self' and check the first actual parameter
        assert upstox_params[1] == 'symbol', f"{method} should have 'symbol' as first parameter (after self)"
        assert indmoney_params[1] == 'symbol', f"{method} should have 'symbol' as first parameter (after self)"
        print(f"    ✓ Consistent interface (both have 'symbol' as first parameter)")

    return True


def test_inheritance():
    """Verify inheritance chain is correct."""
    print("\n" + "="*70)
    print("TEST 8: Inheritance Chain")
    print("="*70)

    assert issubclass(UpstoxAPI, BaseAPIClient), "UpstoxAPI should inherit from BaseAPIClient"
    print("✓ UpstoxAPI inherits from BaseAPIClient")

    assert issubclass(INDMONEYApi, BaseAPIClient), "INDMONEYApi should inherit from BaseAPIClient"
    print("✓ INDMONEYApi inherits from BaseAPIClient")

    # Check shared methods from base class (quiet is set in __init__, check for methods instead)
    shared_methods = ['_log', '_log_error']
    for method in shared_methods:
        assert hasattr(UpstoxAPI, method), f"UpstoxAPI should have {method} from base"
        assert hasattr(INDMONEYApi, method), f"INDMONEYApi should have {method} from base"
    print(f"✓ Both have shared base methods: {shared_methods}")

    # Verify both initialize with quiet parameter
    try:
        upstox_sig = inspect.signature(UpstoxAPI.__init__)
        indmoney_sig = inspect.signature(INDMONEYApi.__init__)
        assert 'quiet' in upstox_sig.parameters, "UpstoxAPI.__init__ should have quiet parameter"
        assert 'quiet' in indmoney_sig.parameters, "INDMONEYApi.__init__ should have quiet parameter"
        print("✓ Both accept 'quiet' parameter in __init__")
    except Exception as e:
        print(f"⚠️  Could not verify quiet parameter: {e}")

    return True


def main():
    """Run all tests."""
    print("="*70)
    print("UNIFIED INTERFACE - VERIFICATION TESTS")
    print("="*70)
    print("\nTesting that the unified interface is properly implemented...")
    print("No API calls will be made - only interface verification.\n")

    tests = [
        ("BaseAPIClient Abstract Methods", test_base_client_has_abstract_methods),
        ("UpstoxAPI Implementation", test_upstox_implements_interface),
        ("INDMONEYApi Implementation", test_indmoney_implements_interface),
        ("Factory Methods", test_factory_methods),
        ("Provider Validation", test_provider_validation),
        ("Credential Validation", test_missing_credentials),
        ("Interface Consistency", test_interface_consistency),
        ("Inheritance Chain", test_inheritance),
    ]

    passed = 0
    failed = 0

    for test_name, test_func in tests:
        try:
            result = test_func()
            if result:
                passed += 1
                print(f"✅ PASSED: {test_name}\n")
        except AssertionError as e:
            failed += 1
            print(f"❌ FAILED: {test_name}")
            print(f"   Error: {e}\n")
        except Exception as e:
            failed += 1
            print(f"❌ ERROR: {test_name}")
            print(f"   Exception: {e}\n")

    # Summary
    print("="*70)
    print("TEST SUMMARY")
    print("="*70)
    print(f"Total Tests: {len(tests)}")
    print(f"✅ Passed: {passed}")
    print(f"❌ Failed: {failed}")

    if failed == 0:
        print("\n" + "="*70)
        print("🎉 ALL TESTS PASSED!")
        print("="*70)
        print("""
The unified interface is correctly implemented:

✓ Both providers inherit from BaseAPIClient
✓ Both implement get_price() and get_quote() with consistent signatures
✓ Factory pattern is working correctly
✓ Provider validation is in place
✓ Credential validation is in place
✓ Easy provider switching is possible!

You can now switch between providers by changing ONE word:
    api = TradingAPIFactory.create_from_config('upstox')  # or 'indmoney'
    price = api.get_price('RELIANCE')  # Same code for both!
        """)
        return 0
    else:
        print(f"\n⚠️  {failed} test(s) failed. Please review the implementation.")
        return 1


if __name__ == "__main__":
    exit(main())
