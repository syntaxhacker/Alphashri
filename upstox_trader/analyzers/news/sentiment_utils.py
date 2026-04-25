#!/usr/bin/env python3
"""
Sentiment Utils - Utility functions for news sentiment analysis
"""

import os
import csv
import time
import logging
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd


def load_nse_stocks(debug_mode=False, logger=None):
    """Load NSE stocks from CSV file"""
    try:
        csv_files = [
            'nse_stocks_20250714_124836.csv',
        ]

        for csv_file in csv_files:
            try:
                if os.path.exists(csv_file):
                    df = pd.read_csv(csv_file)
                    symbols = df['symbol'].tolist()
                    symbols = [s for s in symbols if s and s != 'NIFTY 50' and not s.startswith('NIFTY')]
                    if debug_mode:
                        logger.info(f"📊 Loaded {len(symbols)} stocks from {csv_file}")
                    return symbols
            except Exception as e:
                if logger:
                    logger.debug(f"Error reading {csv_file}: {e}")
                continue

        fallback_symbols = [
            'ADANIENT', 'ADANIPORTS', 'APOLLOHOSP', 'ASIANPAINT', 'AXISBANK',
            'BAJAJ-AUTO', 'BAJAJFINSV', 'BAJFINANCE', 'BEL', 'BHARTIARTL',
            'CIPLA', 'COALINDIA', 'DRREDDY', 'EICHERMOT', 'ETERNAL',
            'GRASIM', 'HCLTECH', 'HDFCBANK', 'HDFCLIFE', 'HEROMOTOCO',
            'HINDALCO', 'HINDUNILVR', 'ICICIBANK', 'INDUSINDBK', 'INFY',
            'ITC', 'JIOFIN', 'JSWSTEEL', 'KOTAKBANK', 'LT',
            'M&M', 'MARUTI', 'NESTLEIND', 'NTPC', 'ONGC',
            'POWERGRID', 'RELIANCE', 'SBILIFE', 'SBIN', 'SHRIRAMFIN',
            'SUNPHARMA', 'TATACONSUM', 'TATAMOTORS', 'TATASTEEL', 'TCS',
            'TECHM', 'TITAN', 'TRENT', 'ULTRACEMCO', 'WIPRO'
        ]
        if debug_mode:
            logger.info(f"📊 Using fallback list of {len(fallback_symbols)} NSE stocks")
        return fallback_symbols

    except Exception as e:
        if logger:
            logger.error(f"❌ Error loading NSE stocks: {e}")
        return ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'WIPRO']


def setup_news_logging(debug_mode=False, logger=None):
    """Setup news logging directories and files"""
    try:
        news_dir = Path("news")
        news_dir.mkdir(exist_ok=True)

        today = datetime.now().strftime('%Y%m%d')
        daily_log_file = news_dir / f"{today}_news.csv"
        session_log_file = news_dir / f"{today}_{datetime.now().strftime('%H%M%S')}_session.csv"

        csv_headers = [
            'timestamp', 'symbol', 'source', 'headline', 'url',
            'scan_time', 'session_id', 'news_count'
        ]

        for log_file in [daily_log_file, session_log_file]:
            if not log_file.exists():
                with open(log_file, 'w', newline='', encoding='utf-8') as f:
                    writer = csv.writer(f)
                    writer.writerow(csv_headers)

        session_id = datetime.now().strftime('%H%M%S')

        if debug_mode:
            logger.info(f"📁 News logging setup: {news_dir}")
            logger.info(f"📄 Daily log: {daily_log_file.name}")
            logger.info(f"📄 Session log: {session_log_file.name}")

        return {
            'news_dir': news_dir,
            'daily_log_file': daily_log_file,
            'session_log_file': session_log_file,
            'csv_headers': csv_headers,
            'session_id': session_id
        }

    except Exception as e:
        if logger:
            logger.error(f"❌ Error setting up news logging: {e}")
        return {
            'news_dir': None,
            'daily_log_file': None,
            'session_log_file': None,
            'csv_headers': [],
            'session_id': None
        }


def save_news_to_csv(symbol, news_items, scan_time, daily_log_file, session_log_file, session_id, logger=None):
    """Save news items to CSV files"""
    if not daily_log_file or not news_items:
        return

    try:
        current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        rows = []
        for news in news_items:
            row = [
                current_time,
                symbol,
                news.get('source', ''),
                news.get('headline', '').replace('\n', ' ').replace('\r', ''),
                news.get('link', ''),
                f"{scan_time:.1f}s",
                session_id,
                len(news_items)
            ]
            rows.append(row)

        for log_file in [daily_log_file, session_log_file]:
            try:
                with open(log_file, 'a', newline='', encoding='utf-8') as f:
                    writer = csv.writer(f)
                    writer.writerows(rows)
            except Exception as e:
                if logger:
                    logger.debug(f"Error writing to {log_file}: {e}")

    except Exception as e:
        if logger:
            logger.error(f"❌ Error saving news to CSV: {e}")


def save_scan_summary(news_dir, scan_time, stocks_with_news, total_stocks, total_news_items, session_id, logger=None):
    """Save scan summary to a separate summary file"""
    try:
        summary_file = news_dir / f"{datetime.now().strftime('%Y%m%d')}_summary.csv"

        if not summary_file.exists():
            with open(summary_file, 'w', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                writer.writerow(['timestamp', 'scan_time', 'stocks_with_news', 'total_stocks', 'total_news_items', 'session_id'])

        with open(summary_file, 'a', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow([
                datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                f"{scan_time:.1f}s",
                stocks_with_news,
                total_stocks,
                total_news_items,
                session_id
            ])

    except Exception as e:
        if logger:
            logger.debug(f"Error saving scan summary: {e}")


def parallel_news_scan(symbols, scan_func, max_workers=10):
    """Scan news for multiple symbols in parallel"""
    results = []

    def scan_single_stock(symbol):
        try:
            news_items = scan_func(symbol, hours_back=2)
            return symbol, news_items, None
        except Exception as e:
            return symbol, [], str(e)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_symbol = {executor.submit(scan_single_stock, symbol): symbol for symbol in symbols}

        for future in as_completed(future_to_symbol):
            symbol = future_to_symbol[future]
            try:
                result = future.result()
                results.append(result)
            except Exception as e:
                results.append((symbol, [], f"Future error: {e}"))

    results.sort(key=lambda x: x[0])
    return results


def run_watch_mode(analyzer, symbols=None, refresh_interval=60, max_workers=10):
    """Watch mode - continuously monitor latest news for given symbols"""
    if symbols is None:
        symbols = load_nse_stocks(analyzer.debug_mode, analyzer.logger)

    if analyzer.debug_mode:
        analyzer.logger.info("📺 Starting News Watch Mode with Parallel Processing...")
        analyzer.logger.info(f"🎯 Monitoring: {len(symbols)} NSE stocks")
        analyzer.logger.info(f"⚙️ Workers: {max_workers} parallel threads")
        analyzer.logger.info(f"⏱️ Refresh interval: {refresh_interval} seconds")
        analyzer.logger.info("=" * 80)

    try:
        while True:
            start_time = time.time()
            print(f"\n🕒 {datetime.now().strftime('%H:%M:%S')} - Latest News Update (Parallel Scan)")
            print("=" * 80)

            all_results = parallel_news_scan(symbols, analyzer.scan_stock_news, max_workers)

            stocks_with_news = 0
            total_news_items = 0
            news_stocks = []
            no_news_stocks = []
            error_stocks = []

            scan_time = time.time() - start_time

            for symbol, news_items, error in all_results:
                if error:
                    error_stocks.append((symbol, error))
                    continue

                if news_items:
                    stocks_with_news += 1
                    total_news_items += len(news_items)
                    news_stocks.append((symbol, news_items))
                    save_news_to_csv(
                        symbol, news_items, scan_time,
                        analyzer.daily_log_file, analyzer.session_log_file,
                        analyzer.session_id, analyzer.logger
                    )
                else:
                    no_news_stocks.append(symbol)

            os.system('clear' if os.name == 'posix' else 'cls')

            print(f"📰 NSE News Monitor - {datetime.now().strftime('%H:%M:%S')}")
            print("=" * 100)
            print(f"⏱️ Scan: {scan_time:.1f}s | 📈 News: {stocks_with_news}/{len(symbols)} | 📰 Items: {total_news_items} | 🔄 Next: {refresh_interval}s")
            print("=" * 100)

            if news_stocks:
                print(f"\n🔥 STOCKS WITH NEWS ({len(news_stocks)}):")
                print("-" * 100)

                for symbol, news_items in news_stocks:
                    print(f"\n📊 {symbol:<12} | {len(news_items)} items")
                    for i, news in enumerate(news_items[:2], 1):
                        headline = news['headline'][:85] + "..." if len(news['headline']) > 85 else news['headline']
                        time_str = news['timestamp'].strftime('%H:%M')
                        source = news['source'][:15]
                        print(f"   {i}. {headline}")
                        print(f"      ⏰ {time_str} | 📡 {source}")
                    if len(news_items) > 2:
                        print(f"      ... and {len(news_items) - 2} more items")

            if no_news_stocks:
                print(f"\n📭 NO NEWS ({len(no_news_stocks)}):")
                print("-" * 100)
                for i in range(0, len(no_news_stocks), 8):
                    row_stocks = no_news_stocks[i:i+8]
                    print("   " + " | ".join(f"{stock:<10}" for stock in row_stocks))

            if error_stocks:
                print(f"\n❌ ERRORS ({len(error_stocks)}):")
                print("-" * 100)
                for symbol, error in error_stocks:
                    print(f"   {symbol}: {error[:60]}...")

            if analyzer.news_dir:
                save_scan_summary(
                    analyzer.news_dir, scan_time, stocks_with_news,
                    len(symbols), total_news_items, analyzer.session_id,
                    analyzer.logger
                )

            print("\n" + "=" * 100)
            print(f"⏳ Next scan in {refresh_interval} seconds... (Press Ctrl+C to stop)")
            print(f"💾 Saved to: {analyzer.daily_log_file.name} | Session: {analyzer.session_log_file.name}")
            print("=" * 100)
            time.sleep(refresh_interval)

    except KeyboardInterrupt:
        print("\n\n👋 News watch mode stopped by user")
        print("📊 Session complete!")
    except Exception as e:
        analyzer.logger.error(f"❌ Watch mode error: {e}")
        print(f"\n❌ Error: {e}")
        print("🔄 Restarting in 5 seconds...")
        time.sleep(5)
