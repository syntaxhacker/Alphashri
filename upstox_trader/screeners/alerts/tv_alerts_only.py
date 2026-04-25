#!/usr/bin/env python3
"""
TV ALERTS ONLY - Pure TradingView Webhook Handler
===============================================

This script handles ONLY TradingView webhook alerts and manages positions.
- No continuous scanning/refreshing
- Receives alerts via webhook and creates positions
- Live bulk price updates for existing positions
- Clean and focused on alert processing only

This file is backward-compatible - imports from modular alerts/ package.
"""

from upstox_trader.screeners.alerts.tv_alerts_core import (
    TVAlertsOnly,
    UPSTOX_AVAILABLE,
    UPSTOX_SDK_AVAILABLE,
    FLASK_AVAILABLE,
    console,
)

from upstox_trader.screeners.alerts.tv_alerts_scanner import (
    start_live_price_monitoring,
    start_live_dashboard,
    _monitor_positions_loop,
    _get_batch_live_prices,
    _check_position_exit,
    _exit_position,
    _exit_all_positions,
)

from upstox_trader.screeners.alerts.tv_alerts_display import (
    display_status,
)

TVAlertsOnly.start_live_price_monitoring = start_live_price_monitoring
TVAlertsOnly.start_live_dashboard = start_live_dashboard
TVAlertsOnly.display_status = display_status
TVAlertsOnly._monitor_positions_loop = _monitor_positions_loop
TVAlertsOnly._get_batch_live_prices = _get_batch_live_prices
TVAlertsOnly._check_position_exit = _check_position_exit
TVAlertsOnly._exit_position = _exit_position
TVAlertsOnly._exit_all_positions = _exit_all_positions


def main():
    """Main function"""
    console.print("[bold green]🚀 TV ALERTS ONLY - Starting...[/bold green]")
    console.print("[dim]Pure TradingView webhook handler - no scanning, only alerts[/dim]")

    import argparse
    import time as time_module
    parser = argparse.ArgumentParser(description='TV Alerts Only - Pure webhook handler')
    parser.add_argument('--port', type=int, default=5001, help='Webhook server port (default: 5001)')
    parser.add_argument('--trading', action='store_true', help='Enable position management and exits')
    parser.add_argument('--position-size', type=float, default=20000, help='Position size in rupees (default: 20000)')
    parser.add_argument('--test-streaming', action='store_true', help='Test Upstox streaming connection and exit')
    parser.add_argument('--dashboard', action='store_true', help='Start live dashboard with auto-refresh')
    parser.add_argument('--refresh', type=int, default=10, help='Dashboard refresh interval in seconds (default: 10)')
    parser.add_argument('--status', action='store_true', help='Show current status and exit')

    args = parser.parse_args()

    if args.test_streaming:
        console.print("[bold blue]🧪 Testing Upstox Streaming Connection...[/bold blue]")
        tv_handler = TVAlertsOnly(port=args.port, enable_trading=args.trading, position_size=args.position_size)
        success = tv_handler.test_streaming_connection()
        if success:
            console.print("[green]✅ Streaming test passed![/green]")
            console.print("[dim]Streaming is working correctly![/dim]")
        else:
            console.print("[red]❌ Streaming test failed![/red]")
            console.print("[red]💡 Check credentials and network connection[/red]")

        TVAlertsOnly.shutdown_flag = True

        console.print("[yellow]👋 Test complete - shutting down...[/yellow]")
        try:
            tv_handler._cleanup_on_exit()
        except:
            pass

        import sys
        sys.exit(0)

    tv_handler = TVAlertsOnly(
        port=args.port,
        enable_trading=args.trading,
        position_size=args.position_size
    )

    if args.status:
        tv_handler.display_status()
        import sys
        sys.exit(0)

    if args.trading:
        tv_handler.start_live_price_monitoring()

    if args.dashboard:
        tv_handler.start_live_dashboard(refresh_interval=args.refresh)
    else:
        tv_handler.display_status()

    try:
        while not TVAlertsOnly.shutdown_flag:
            time_module.sleep(1)
    except KeyboardInterrupt:
        console.print("\n[yellow]👋 Goodbye![/yellow]")
    
    import os
    os._exit(0)


if __name__ == "__main__":
    main()
