#!/usr/bin/env python3
"""
Daily ORB Trading Runner - Execute paper trades based on ORB signals.

This script:
1. Gets ORB-ready stocks from screener
2. Fetches live 5-min data
3. Calculates opening range
4. Detects breakouts and generates signals
5. Executes paper trades
6. Monitors positions and exits

Usage:
    python3 run_daily_trading.py           # Normal run
    python3 run_daily_trading.py --test    # Test mode (no real trades)
    python3 run_daily_trading.py --status  # Just show current status
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent / 'scanners'))

from scripts.daily import main

if __name__ == '__main__':
    main()
