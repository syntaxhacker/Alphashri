#!/usr/bin/env python3
"""Get latest news from moneycontrol.com using Scrapling"""

from scrapling.fetchers import Fetcher

print("Fetching latest news from moneycontrol.com...\n")
print("=" * 80)

page = Fetcher.get('https://www.moneycontrol.com/news/', impersonate='chrome')

print(f"Page: {page.css('title::text').get()}")
print("=" * 80)

# Get all anchor tags with news article URLs
print("\n📰 LATEST NEWS HEADLINES\n")

all_links = page.css('a')
seen_urls = set()
news_items = []

for link in all_links:
    href = link.css('::attr(href)').get()
    text = link.css('::text').get()

    # Filter for actual news articles - must have .html extension and article ID pattern
    if href and text:
        href_str = str(href)
        text_str = text.strip()

        # News articles have pattern like -13843286.html
        is_article = '.html' in href_str and '-' in href_str and href_str.split('-')[-1].replace('.html', '').isdigit()

        if is_article and len(text_str) > 25 and href not in seen_urls:
            seen_urls.add(href)
            news_items.append({
                'title': text_str,
                'url': href
            })

# Print results
count = 0
for item in news_items[:25]:
    count += 1
    print(f"{count}. {item['title']}")
    print(f"   🔗 {item['url']}")
    print()

print("=" * 80)
print(f"📰 Total news articles found: {count}")
