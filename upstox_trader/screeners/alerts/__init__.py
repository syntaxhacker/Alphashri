#!/usr/bin/env python3
"""
TV Alerts Package - Modular TradingView Webhook Handler
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
)

from upstox_trader.screeners.alerts.tv_alerts_display import (
    display_status,
)

__all__ = [
    'TVAlertsOnly',
    'UPSTOX_AVAILABLE',
    'UPSTOX_SDK_AVAILABLE',
    'FLASK_AVAILABLE',
    'console',
    'start_live_price_monitoring',
    'start_live_dashboard',
    'display_status',
]
