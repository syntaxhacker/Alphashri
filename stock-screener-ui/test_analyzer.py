import sys
import json
import time

# Ensure we can import from the correct directory
sys.path.insert(0, '/Users/developer/Documents/algos/personal/earner/stock-screener-ui')
from llm_analyzer import article_analyzer

# Import fetch_news to get a live URL
sys.path.insert(0, '/Users/developer/Documents/algos/personal/earner/moneycontrol-scraper')
from news_api import fetch_news, fetch_article_content

print("1. Fetching a live news article...")
news_items = fetch_news(source='moneycontrol', limit=1)
if not news_items:
    print("Failed to fetch news. Exiting.")
    sys.exit(1)

article_url = news_items[0]['sourceUrl']
print(f"URL: {article_url}\n")

print("2. Fetching full content...")
article_data = fetch_article_content(article_url)
headline = article_data.get('headline', '')
content = article_data.get('description', '')

print(f"Headline: {headline}")
print(f"Content Length: {len(content)} characters\n")

print("3. Running AI Analysis (OpenRouter - z-ai/glm-4.5-air:free)...")
start_time = time.time()
analysis = article_analyzer.analyze_article(article_url, headline, content)
duration = time.time() - start_time

print(f"\\nAnalysis completed in {duration:.2f} seconds.")
print("-" * 40)
print(json.dumps(analysis, indent=2))
print("-" * 40)

print("\n4. Testing Cache (should be instant)...")
start_time = time.time()
cached_analysis = article_analyzer.analyze_article(article_url, headline, content)
cache_duration = time.time() - start_time
print(f"Cache retrieved in {cache_duration:.4f} seconds.")

print("\n✅ Verification Complete!")
