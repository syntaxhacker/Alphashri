"""
CLI entry point for MultiStrategyRunner.

Provides command-line interface for running the multi-strategy trading bot.
"""

import argparse

from trading.runner_core import create_multi_strategy_runner


def main():
    """CLI entry point for multi-strategy trading runner."""
    parser = argparse.ArgumentParser(description='Multi-Strategy Trading Runner')
    parser.add_argument('--bot-id', type=int, required=True, help='Bot configuration ID')
    parser.add_argument('--user-id', type=int, help='User ID for multi-user support')
    parser.add_argument('--test', action='store_true', help='Test mode (no real trades)')
    parser.add_argument('--interval', type=int, default=30, help='Scan interval in seconds')

    args = parser.parse_args()

    runner = create_multi_strategy_runner(
        bot_id=args.bot_id,
        user_id=args.user_id,
        test_mode=args.test,
    )

    runner.run(interval=args.interval)


if __name__ == '__main__':
    main()
