#!/usr/bin/env python3
"""
News Sentiment Analyzer - Early Signal Detection
Beat the volume spike by catching news 10-15 minutes early

This module provides backward compatibility. New code should import from
upstox_trader.analyzers.news instead.
"""

from upstox_trader.analyzers.news import (
    POSITIVE_KEYWORDS,
    NEGATIVE_KEYWORDS,
    HIGH_IMPACT_KEYWORDS,
    NEWS_SOURCES,
    SentimentResult,
    VolumePrediction,
    NewsItem,
    TradingAlert,
    NewsSentimentAnalyzer,
    NewsAnalyzer,
    get_tv_cookies,
    get_headers,
    scrape_moneycontrol_news,
    scrape_google_news,
    search_web_news,
    parse_relative_time,
    load_nse_stocks,
    setup_news_logging,
    save_news_to_csv,
    save_scan_summary,
    parallel_news_scan,
    run_watch_mode,
)

__all__ = [
    'POSITIVE_KEYWORDS',
    'NEGATIVE_KEYWORDS',
    'HIGH_IMPACT_KEYWORDS',
    'NEWS_SOURCES',
    'SentimentResult',
    'VolumePrediction',
    'NewsItem',
    'TradingAlert',
    'NewsSentimentAnalyzer',
    'NewsAnalyzer',
    'get_tv_cookies',
    'get_headers',
    'scrape_moneycontrol_news',
    'scrape_google_news',
    'search_web_news',
    'parse_relative_time',
    'load_nse_stocks',
    'setup_news_logging',
    'save_news_to_csv',
    'save_scan_summary',
    'parallel_news_scan',
    'run_watch_mode',
]


def main():
    """Start the news analyzer in watch mode"""
    from upstox_trader.analyzers.news.sentiment_analyzer import NewsSentimentAnalyzer
    from upstox_trader.analyzers.news.sentiment_utils import run_watch_mode, load_nse_stocks

    print("📰 News Monitor - Latest News Watch Mode")
    print("=" * 60)

    import sys
    debug_mode = '--debug' in sys.argv or '-d' in sys.argv

    analyzer = NewsSentimentAnalyzer(debug=debug_mode)

    if debug_mode:
        print("🐛 Debug mode enabled - verbose logging active")

    nse_stocks = load_nse_stocks(debug_mode, analyzer.logger)
    default_symbols = nse_stocks[:10]

    print("🎯 Available options:")
    print(f"   1. Start watch mode with ALL {len(nse_stocks)} NSE stocks (parallel)")
    print("   2. Enter custom symbols")
    print("   3. Quick test with single symbol")
    print(f"   4. Preview mode (first 10 stocks: {', '.join(default_symbols)})")
    print("   5. Configure parallel workers")
    if debug_mode:
        print("   🐛 Debug mode: Verbose logging enabled")

    try:
        choice = input(f"\nEnter choice (1-5) or press Enter for ALL {len(nse_stocks)} stocks: ").strip()

        if choice == '2':
            symbols_input = input("Enter symbols separated by commas: ").strip()
            symbols = [s.strip().upper() for s in symbols_input.split(',') if s.strip()]
            if not symbols:
                symbols = nse_stocks
        elif choice == '3':
            symbol = input("Enter symbol to test: ").strip().upper()
            if symbol:
                print(f"\n🔍 Testing {symbol}...")
                news_items = analyzer.scan_stock_news(symbol, hours_back=24)
                if news_items:
                    print(f"\n📰 Found {len(news_items)} news items for {symbol}:")
                    for i, news in enumerate(news_items[:5], 1):
                        print(f"   {i}. {news['headline'][:100]}...")
                        print(f"      📅 {news['timestamp'].strftime('%H:%M')} | 🔗 {news['source']}")
                else:
                    print(f"📰 No recent news found for {symbol}")
                return
            else:
                symbols = nse_stocks
        elif choice == '4':
            symbols = default_symbols
        elif choice == '5':
            symbols = nse_stocks
            try:
                workers = int(input("Enter number of parallel workers (default 10): ").strip() or "10")
                refresh = int(input("Enter refresh interval in seconds (default 60): ").strip() or "60")
                print(f"\n🚀 Starting with {workers} workers, {refresh}s refresh...")
                run_watch_mode(analyzer, symbols, refresh_interval=refresh, max_workers=workers)
                return
            except ValueError:
                print("Invalid input, using defaults...")
        else:
            symbols = nse_stocks

        run_watch_mode(analyzer, symbols, refresh_interval=60, max_workers=10)

    except KeyboardInterrupt:
        print("\n👋 Goodbye!")
    except Exception as e:
        print(f"\n❌ Error: {e}")


if __name__ == "__main__":
    main()
