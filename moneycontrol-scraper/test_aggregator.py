from news_api import _aggregator, fetch_news, fetch_article_content

print("=== Fetching News from All Sources ===")
all_news = _aggregator.fetch_all(limit_per_source=3)

for news in all_news:
    print(f"[{news['source'].upper()}] {news['headline']}")

print("\n=== Fetching Article Content ===")
if all_news:
    # Test fetching the content of the first article
    first_url = all_news[0]['sourceUrl']
    print(f"URL: {first_url}")
    article = fetch_article_content(first_url)
    print(f"Headline: {article['headline']}")
    print(f"Date: {article['publishedAt']}")
    print(f"Description length: {len(article['description'])} chars")
    
    # Let's test grabbing a moneycontrol article with symbols
    mc_news = fetch_news(source='moneycontrol', limit=2)
    if mc_news:
        mc_url = mc_news[0]['sourceUrl']
        print(f"\\nURL: {mc_url}")
        mc_article = fetch_article_content(mc_url)
        print(f"MC Headline: {mc_article['headline']}")
        print(f"Symbols found: {[s['code'] for s in mc_article.get('symbols', [])]}")
