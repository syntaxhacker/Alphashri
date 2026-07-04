#!/usr/bin/env python3
"""
Comprehensive test for all news scrapers
"""

from news_api import fetch_news, fetch_article_content, _aggregator

def test_all_scrapers():
    """Test all news scrapers"""
    print("=" * 80)
    print("TESTING ALL NEWS SCRAPERS")
    print("=" * 80)

    for source_id in _aggregator.scrapers.keys():
        print(f"\nTesting {source_id} ({_aggregator.scrapers[source_id].source_name})...")
        try:
            news = fetch_news(source=source_id, limit=2)
            print(f"  ✓ Found {len(news)} articles")
            if news:
                print(f"  Sample headline: {news[0]['headline'][:80]}...")
        except Exception as e:
            print(f"  ✗ Error: {str(e)}")

    print("\n" + "=" * 80)
    print("TESTING FETCH FROM ALL SOURCES")
    print("=" * 80)

    try:
        all_news = fetch_news(source='all', limit=10)
        print(f"✓ Total articles from all sources: {len(all_news)}")
        
        if all_news:
            print(f"\nFirst 3 articles:")
            for i, news in enumerate(all_news[:3], 1):
                print(f"  {i}. [{news['source'].upper()}] {news['headline'][:80]}...")
    except Exception as e:
        print(f"✗ Error: {str(e)}")

    print("\n" + "=" * 80)
    print("TESTING ARTICLE CONTENT EXTRACTION")
    print("=" * 80)

    if all_news:
        first_url = all_news[0]['sourceUrl']
        print(f"\nTesting article content for: {first_url}")
        article = fetch_article_content(first_url)
        print(f"  ✓ Headline: {article['headline']}")
        print(f"  ✓ Content length: {len(article['description'])} chars")
        print(f"  ✓ Source: {article['source']}")
        print(f"  ✓ Symbols: {len(article.get('symbols', []))}")
    else:
        print("  ⚠ No articles found for content extraction test")

    print("\n" + "=" * 80)
    print("TEST COMPLETED")
    print("=" * 80)

if __name__ == "__main__":
    test_all_scrapers()