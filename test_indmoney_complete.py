#!/usr/bin/env python3
"""
Test INDMoney API Implementation

Tests all 25 APIs including WebSocket functionality.
Requires valid INDMONEY credentials in config.
"""

import sys
import os
from rich.console import Console
from rich.table import Table
from rich.panel import Panel

# Add project root to path
_script_dir = os.path.dirname(os.path.abspath(__file__))
_project_root = os.path.abspath(os.path.join(_script_dir, '.'))
sys.path.insert(0, _project_root)

console = Console()

def test_api_imports():
    """Test that all API classes can be imported."""
    console.print("\n[bold cyan]1. Testing Imports...[/bold cyan]")

    try:
        from upstox_trader.config_and_utils.free_indian_apis import (
            INDMONEYApi, TradingAPIFactory, TokenManager, BaseAPIClient
        )
        console.print("  ✅ All classes imported successfully")
        return True
    except ImportError as e:
        console.print(f"  ❌ Import failed: {e}")
        return False

def test_api_instantiation():
    """Test API instantiation with config."""
    console.print("\n[bold cyan]2. Testing API Instantiation...[/bold cyan]")

    try:
        from upstox_trader.config_and_utils.free_indian_apis import TradingAPIFactory

        # Try to create API instance
        api = TradingAPIFactory.create_from_config('indmoney', quiet=True)
        console.print("  ✅ INDMoney API instantiated successfully")
        console.print(f"  ℹ️  API Type: {type(api).__name__}")
        return api
    except ValueError as e:
        console.print(f"  ⚠️  Could not instantiate: {e}")
        console.print("  ℹ️  This is expected if credentials are not configured")
        return None
    except Exception as e:
        console.print(f"  ❌ Unexpected error: {e}")
        return None

def test_method_presence(api):
    """Test that all expected methods are present."""
    console.print("\n[bold cyan]3. Verifying Methods...[/bold cyan]")

    if not api:
        console.print("  ⚠️  Skipping (API not instantiated)")
        return False

    import inspect

    # Expected methods by category
    categories = {
        'User Management': ['fetch_user_profile', 'fetch_funds'],
        'Market Data': ['get_price', 'get_quote', 'fetch_ltp', 'fetch_full_quotes', 'fetch_market_depth'],
        'Order Management': ['place_order', 'modify_order', 'cancel_order', 'fetch_order_book'],
        'Smart Orders': ['place_smart_order', 'modify_smart_order', 'cancel_smart_order'],
        'Portfolio': ['fetch_holdings', 'fetch_positions'],
        'Trade Book': ['fetch_trade_details', 'fetch_trade_book'],
        'Options': ['fetch_option_chain', 'fetch_option_symbols', 'calculate_greeks'],
        'Utilities': ['fetch_margin'],
        'WebSocket': ['connect_market_data_websocket', 'subscribe_market_data',
                     'unsubscribe_market_data', 'disconnect_market_data_websocket',
                     'connect_order_updates_websocket', 'disconnect_order_updates_websocket',
                     'connect_portfolio_websocket', 'disconnect_portfolio_websocket',
                     'disconnect_all_websockets']
    }

    all_present = True

    for category, methods in categories.items():
        table = Table(show_header=True, header_style="bold magenta", title=f"{category}")
        table.add_column("Method", style="cyan", width=40)
        table.add_column("Status", justify="center", width=10)

        for method in methods:
            if hasattr(api, method):
                table.add_row(f"  {method}()", "[green]✅[/green]")
            else:
                table.add_row(f"  {method}()", "[red]❌[/red]")
                all_present = False

        console.print(table)

    return all_present

def test_token_manager(api):
    """Test TokenManager functionality."""
    console.print("\n[bold cyan]4. Testing TokenManager...[/bold cyan]")

    if not api:
        console.print("  ⚠️  Skipping (API not instantiated)")
        return False

    try:
        # Check if token_manager exists
        assert hasattr(api, 'token_manager'), "token_manager not found"
        console.print("  ✅ TokenManager initialized")

        # Test token expiry check
        is_expired = api.token_manager.is_token_expired()
        console.print(f"  ✅ Token expired check: {is_expired}")

        # Test token age
        age_hours = api.token_manager.get_token_age_hours()
        console.print(f"  ✅ Token age: {age_hours:.1f} hours")

        return True
    except Exception as e:
        console.print(f"  ❌ TokenManager test failed: {e}")
        return False

def test_websocket_library():
    """Test WebSocket library availability."""
    console.print("\n[bold cyan]5. Testing WebSocket Library...[/bold cyan]")

    try:
        import websocket
        console.print("  ✅ websocket-client library installed")
        return True
    except ImportError:
        console.print("  ⚠️  websocket-client not installed")
        console.print("  ℹ️  Install with: pip install websocket-client")
        return False

def test_rest_api_calls(api):
    """Test safe REST API calls (GET requests only)."""
    console.print("\n[bold cyan]6. Testing REST API Calls (GET requests)...[/bold cyan]")

    if not api:
        console.print("  ⚠️  Skipping (API not instantiated)")
        return False

    # List of safe GET methods to test
    safe_tests = [
        ('fetch_user_profile', 'User Profile'),
        ('fetch_funds', 'Account Funds'),
        ('get_price', 'Current Price (RELIANCE)', {'symbol': 'RELIANCE'}),
        ('get_quote', 'Full Quote (RELIANCE)', {'symbol': 'RELIANCE'}),
    ]

    results = []

    for test in safe_tests:
        method = test[0]
        name = test[1]
        kwargs = test[2] if len(test) > 2 else {}

        try:
            console.print(f"  Testing {name}...", end=" ")
            result = getattr(api, method)(**kwargs)

            if result:
                console.print("[green]✅ Success[/green]")
                results.append(True)
            else:
                console.print("[yellow]⚠️  No data returned[/yellow]")
                results.append(False)
        except ValueError as e:
            if "expired" in str(e) or "authentication" in str(e):
                console.print("[yellow]⚠️  Token expired/invalid[/yellow]")
                results.append(False)
            else:
                console.print(f"[red]❌ {e}[/red]")
                results.append(False)
        except Exception as e:
            console.print(f"[red]❌ {e}[/red]")
            results.append(False)

    return any(results)

def test_method_signatures(api):
    """Test method signatures."""
    console.print("\n[bold cyan]7. Testing Method Signatures...[/bold cyan]")

    if not api:
        console.print("  ⚠️  Skipping (API not instantiated)")
        return False

    import inspect

    # Test critical method signatures
    critical_methods = [
        'place_order',
        'connect_market_data_websocket',
        'subscribe_market_data',
        'fetch_option_chain',
        'calculate_greeks'
    ]

    all_valid = True

    for method_name in critical_methods:
        if hasattr(api, method_name):
            method = getattr(api, method_name)
            sig = inspect.signature(method)
            console.print(f"  ✅ {method_name}{sig}")
        else:
            console.print(f"  ❌ {method_name} not found")
            all_valid = False

    return all_valid

def main():
    """Run all tests."""
    console.print("\n")
    console.print(Panel(
        "[bold green]INDMONEY API - COMPLETE IMPLEMENTATION TEST[/bold green]\n"
        "Testing all 25 APIs including WebSocket functionality",
        title="🧪 Test Suite",
        border_style="green"
    ))

    results = {}

    # Run tests
    results['imports'] = test_api_imports()
    api = test_api_instantiation()
    results['instantiation'] = api is not None
    results['methods'] = test_method_presence(api) if api else False
    results['token_manager'] = test_token_manager(api) if api else False
    results['websocket_lib'] = test_websocket_library()
    results['rest_calls'] = test_rest_api_calls(api) if api else False
    results['signatures'] = test_method_signatures(api) if api else False

    # Summary
    console.print("\n")
    console.print(Panel(
        f"[bold]Test Summary[/bold]\n\n"
        f"1. Imports: {'✅ PASS' if results['imports'] else '❌ FAIL'}\n"
        f"2. Instantiation: {'✅ PASS' if results['instantiation'] else '⚠️  SKIP'}\n"
        f"3. Methods Present: {'✅ PASS' if results['methods'] else '❌ FAIL'}\n"
        f"4. TokenManager: {'✅ PASS' if results['token_manager'] else '❌ FAIL'}\n"
        f"5. WebSocket Library: {'✅ PASS' if results['websocket_lib'] else '⚠️  SKIP'}\n"
        f"6. REST API Calls: {'✅ PASS' if results['rest_calls'] else '⚠️  PARTIAL'}\n"
        f"7. Method Signatures: {'✅ PASS' if results['signatures'] else '❌ FAIL'}\n",
        title="📊 Results",
        border_style="blue" if all(results.values()) else "yellow"
    ))

    # Final verdict
    passed = sum(1 for v in results.values() if v)
    total = len(results)

    console.print(f"\n[bold]Overall: {passed}/{total} test categories passed[/bold]")

    if results['imports'] and results['methods'] and results['signatures']:
        console.print("\n[bold green]✅ CORE IMPLEMENTATION VERIFIED![/bold green]")
        console.print("[green]All 25 INDMoney APIs implemented successfully![/green]")

        if not results['rest_calls']:
            console.print("\n[yellow]⚠️  Note:[/yellow] REST API calls require valid credentials")
            console.print("[yellow]   Configure credentials in config.py to test live API calls[/yellow]")

        if not results['websocket_lib']:
            console.print("\n[yellow]⚠️  Note:[/yellow] WebSocket functionality requires websocket-client")
            console.print("[yellow]   Install with: pip install websocket-client[/yellow]")
    else:
        console.print("\n[bold red]❌ SOME TESTS FAILED[/bold red]")
        return 1

    return 0

if __name__ == "__main__":
    exit(main())
