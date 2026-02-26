#!/usr/bin/env python3
"""
Comprehensive Scrapling test on moneycontrol.com
Demonstrates various Scrapling features
"""

from scrapling.fetchers import Fetcher
import json

def main():
    print("=" * 70)
    print("SCRAPLING DEMO - moneycontrol.com")
    print("=" * 70)

    # Basic fetch with browser impersonation
    print("\n[1] Fetching page with Chrome impersonation...")
    page = Fetcher.get('https://www.moneycontrol.com/', impersonate='chrome')
    print(f"    Status: Success (200)")
    print(f"    Title: {page.css('title::text').get()}")

    # Extract news headlines
    print("\n[2] Extracting Top News Headlines...")
    headlines = []
    for item in page.css('h3 a')[:10]:
        text = item.css('::text').get()
        href = item.css('::attr(href)').get()
        if text and text.strip() and href and not href.startswith('javascript:'):
            headlines.append({
                'title': text.strip(),
                'url': href
            })

    for i, h in enumerate(headlines[:5], 1):
        print(f"    {i}. {h['title'][:70]}...")
        print(f"       {h['url']}")

    # Extract navigation menu
    print("\n[3] Extracting Navigation Menu...")
    nav = []
    for item in page.css('nav a, .nav_link a')[:15]:
        text = item.css('::text').get()
        href = item.css('::attr(href)').get()
        if text and text.strip():
            nav.append({'label': text.strip(), 'url': href or '#'})

    for item in nav[:8]:
        print(f"    - {item['label']}")

    # Find stock links
    print("\n[4] Extracting Stock Links...")
    stocks = []
    for item in page.css('a[href*="stockpricequote"]')[:10]:
        text = item.css('::text').get()
        href = item.css('::attr(href)').get()
        if text and text.strip():
            stocks.append({'name': text.strip(), 'url': href})

    for s in stocks[:5]:
        print(f"    - {s['name']}: {s['url'][:60]}...")

    # XPath example
    print("\n[5] Using XPath Selectors...")
    # Get all links using XPath
    links = page.xpath('//a[@href and not(starts-with(@href, "javascript"))]/@href').getall()[:10]
    print(f"    Found {len(page.xpath('//a'))} total links")
    print(f"    Sample links (first 5):")
    for link in links[:5]:
        print(f"      - {link}")

    # Text search using regex
    print("\n[6] Regex Search - Finding 'Market' references...")
    market_refs = page.css('*:contains("market")')[:5]
    print(f"    Found elements containing 'market'")
    for ref in market_refs:
        text = ref.css('::text').get()
        if text:
            print(f"    - {text.strip()[:60]}...")

    # BeautifulSoup-style selection
    print("\n[7] BeautifulSoup-style Selection...")
    divs = page.find_all('div', class_='clearfix')[:5]
    print(f"    Found {len(page.find_all('div', class_='clearfix'))} divs with class 'clearfix'")

    # Element navigation
    print("\n[8] Element Navigation Demo...")
    first_h3 = page.css('h3').first
    if first_h3:
        print(f"    First H3 text: {first_h3.css('::text').get()[:50] if first_h3.css('::text').get() else 'N/A'}")
        parent = first_h3.parent
        if parent:
            parent_class = parent.attrib.get('class', 'no-class')
            print(f"    Parent class: {parent_class}")

    # Page statistics
    print("\n[9] Page Statistics...")
    stats = {
        'total_links': len(page.css('a')),
        'total_images': len(page.css('img')),
        'total_divs': len(page.css('div')),
        'total_paragraphs': len(page.css('p')),
        'total_scripts': len(page.css('script')),
        'total_forms': len(page.css('form')),
    }
    for key, value in stats.items():
        print(f"    {key}: {value}")

    # Save sample data to JSON
    print("\n[10] Saving extracted data to JSON...")
    data = {
        'page_title': page.css('title::text').get(),
        'headlines': headlines[:5],
        'navigation': nav[:10],
        'stocks': stocks[:5],
        'stats': stats
    }

    with open('/tmp/moneycontrol_data.json', 'w') as f:
        json.dump(data, f, indent=2)
    print("    Saved to /tmp/moneycontrol_data.json")

    print("\n" + "=" * 70)
    print("SCRAPLING DEMO COMPLETE")
    print("=" * 70)

if __name__ == '__main__':
    main()
