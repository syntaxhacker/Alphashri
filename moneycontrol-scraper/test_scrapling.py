#!/usr/bin/env python3
"""Test Scrapling library on moneycontrol.com"""

from scrapling.fetchers import Fetcher

# Fetch moneycontrol.com homepage
print("Fetching moneycontrol.com...")
page = Fetcher.get('https://www.moneycontrol.com/', impersonate='chrome')

print(f"\nPage Title: {page.css('title::text').get()}")

# Get top news headlines
print("\n=== Top News Headlines ===")
headlines = page.css('.news_item h2 a::text, .clearfix a::text, .top_news a::text').getall()[:10]
for i, headline in enumerate(headlines, 1):
    if headline and headline.strip():
        print(f"{i}. {headline.strip()}")

# Get stock market data if available
print("\n=== Market Indices ===")
indices = page.css('.market_indices li, .market_block li, .stock_list li')
for idx in indices[:5]:
    name = idx.css('::text').get()
    if name and name.strip():
        print(f"- {name.strip()}")

# Get all links (sample)
print("\n=== Sample Links ===")
links = page.css('a::attr(href)').getall()[:10]
for link in links:
    if link:
        print(f"- {link}")

# Search for trending/trending topics
print("\n=== Trending Topics ===")
trending = page.css('.trending a::text, .tags a::text, .trending_tags a::text').getall()[:10]
for topic in trending:
    if topic and topic.strip():
        print(f"- {topic.strip()}")

print("\n=== Page Stats ===")
print(f"Total links found: {len(page.css('a'))}")
print(f"Total images found: {len(page.css('img'))}")
print(f"Total divs found: {len(page.css('div'))}")
