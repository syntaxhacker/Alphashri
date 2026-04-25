from upstox_trader.trading_bots.paper import UpstoxPaperTradingBot, run_upstox_paper_trading_bot
from upstox_trader.trading_bots.paper.bot_core import UPSTOX_SDK_AVAILABLE, paper_trade_logger, console_logger

import argparse


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Upstox Paper Trading Bot")
    parser.add_argument("--symbols", type=str, nargs="+", default=["TATAMOTORS"], help="Stock symbols to trade (e.g., TATAMOTORS RELIANCE INFY).")
    parser.add_argument("--nifty50", action="store_true", help="Use all Nifty 50 stocks (overrides --symbols).")
    parser.add_argument("--timeframe", type=str, default="15min", help="Candlestick timeframe (e.g., '5min', '15min', '1H').")

    args = parser.parse_args()

    if args.nifty50:
        print("⚠️ Nifty 50 functionality has been removed. Please provide custom symbols using --symbols.")
        symbols = args.symbols if args.symbols else ["TATAMOTORS"]
        print(f"🎯 Using default/custom stocks: {', '.join(symbols)}")
    else:
        symbols = args.symbols
        print(f"🎯 Using custom stocks: {', '.join(symbols)}")

    run_upstox_paper_trading_bot(symbols=symbols, timeframe=args.timeframe)
