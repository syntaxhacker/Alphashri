#!/usr/bin/env python3
"""Detailed test of Scrapling on moneycontrol.com"""

from scrapling.fetchers import Fetcher

# Fetch moneycontrol.com homepage
print("Fetching moneycontrol.com with detailed extraction...")
page = Fetcher.get('https://www.moneycontrol.com/', impersonate='chrome')

print(f"\n{'='*60}")
print(f"Page Title: {page.css('title::text').get()}")
print(f"{'='*60}")

# Get the raw HTML structure to understand the page better
print("\n=== Looking for news sections ===")

# Try various selectors for news content
news_selectors = [
    '.mc_module_news h2 a',
    '.news_list li a',
    '.top_news_section a',
    'h3 a',
    'h2 a',
    '.article_link',
    '.headline',
]

for selector in news_selectors:
    items = page.css(selector)
    if items:
        print(f"\nFound {len(items)} items with '{selector}':")
        for i, item in enumerate(items[:5], 1):
            text = item.css('::text').get()
            href = item.css('::attr(href)').get()
            if text and text.strip():
                print(f"  {i}. {text.strip()[:80]}")
                if href:
                    print(f"     URL: {href}")

# Get Sensex/Nifty data
print("\n=== Market Data ===")
market_selectors = [
    '.market_data',
    '.indices_data',
    '.stock_price',
    '.bse_nifty',
    '.market_block',
]

for selector in market_selectors:
    items = page.css(selector)
    if items:
        print(f"\nFound {len(items)} items with '{selector}'")

# Get stock prices from the page
print("\n=== Stock Prices (from page) ===")
stock_items = page.css('.stock_item, .price_item, .market_list li')
for item in stock_items[:10]:
    text = item.css('::text').getall()
    if text:
        cleaned = ' '.join(t.strip() for t in text if t.strip())
        if cleaned:
            print(f"  - {cleaned[:100]}")

# Get main navigation
print("\n=== Main Navigation ===")
nav_items = page.css('nav a, .nav a, .menu a')
for item in nav_items[:10]:
    text = item.css('::text').get()
    if text and text.strip():
        print(f"  - {text.strip()}")

# Find all h1, h2, h3 headings
print("\n=== Page Headings ===")
for tag in ['h1', 'h2', 'h3']:
    headings = page.css(f'{tag}::text').getall()[:5]
    if headings:
        print(f"\n{tag.upper()} tags:")
        for h in headings:
            if h.strip():
                print(f"  - {h.strip()[:80]}")

# Extract meta information
print("\n=== Meta Information ===")
meta_desc = page.css('meta[name="description"]::attr(content)').get()
if meta_desc:
    print(f"Description: {meta_desc[:200]}")

meta_keywords = page.css('meta[name="keywords"]::attr(content)').get()
if meta_keywords:
    print(f"Keywords: {meta_keywords[:200]}")

print("\n=== Done ===")
