# Moneycontrol.com Website Structure Analysis

> Scraped and analyzed using Scrapling library on 2026-02-25

---

## Overview

Moneycontrol.com is India's leading financial news and stock market portal. It provides real-time stock prices, market news, portfolio management tools, and financial analysis.

---

## Site Architecture

### Main Sections

| Section | URL Pattern | Description |
|---------|-------------|-------------|
| Homepage | `https://www.moneycontrol.com/` | Main landing page with market summary and top news |
| News | `https://www.moneycontrol.com/news/` | Latest business and market news |
| Markets | `https://www.moneycontrol.com/stocksmarketsindia/` | Stock market data and analysis |
| Indian Indices | `https://www.moneycontrol.com/markets/indian-indices/` | Nifty, Sensex, and other indices |
| Stocks | `https://www.moneycontrol.com/india/stockpricequote/` | Individual stock pages |
| IPO | `https://www.moneycontrol.com/ipo/` | IPO news and analysis |
| Mutual Funds | `https://www.moneycontrol.com/mutual-funds/` | MF data and news |
| Commodities | `https://www.moneycontrol.com/commodity/` | Commodity market data |
| Forex | `https://www.moneycontrol.com/forex/` | Currency exchange rates |
| Personal Finance | `https://www.moneycontrol.com/personal-finance/` | Personal finance articles |

### Language Versions

| Language | URL |
|----------|-----|
| English | `https://www.moneycontrol.com/` |
| Hindi | `https://hindi.moneycontrol.com/` |
| Gujarati | `https://gujarati.moneycontrol.com/` |

---

## URL Patterns

### News Articles

```
https://www.moneycontrol.com/news/{category}/{subcategory}/{slug}-{article_id}.html
```

**Examples:**
- `/news/business/markets/sensex-falls-200-pts-13842597.html`
- `/news/india/mumbai-bmc-budget-13843286.html`
- `/news/business/stocks/vedanta-ncds-13842791.html`

**Article ID Pattern:** `-{7-8 digit number}.html` (e.g., `-13843286.html`)

### Stock Pages

```
https://www.moneycontrol.com/india/stockpricequote/{sector}/{companyname}/{ticker}
```

**Examples:**
- `/india/stockpricequote/banks-private-sector/idfcfirstbank/IDF01`
- `/india/stockpricequote/computers-software/infosys/IT`
- `/india/stockpricequote/computers-software/tataconsultancyservices/TCS`

### Category Pages

```
https://www.moneycontrol.com/news/{category}/
https://www.moneycontrol.com/news/{category}/{subcategory}/
```

**Main Categories:**
- `/news/business/` - Business news
- `/news/business/markets/` - Market news
- `/news/business/stocks/` - Stock-specific news
- `/news/business/economy/` - Economy news
- `/news/business/companies/` - Company news
- `/news/india/` - India news
- `/news/world/` - World news
- `/news/politics/` - Politics news

### Special Sections

| Section | URL |
|---------|-----|
| AI News | `/artificial-intelligence/` |
| Web Stories | `/web-stories/` |
| Photos/Gallery | `/news/photogallery/` |
| Videos | `/news/videos/` |
| Podcasts | `/news/podcast/` |
| Infographics | `/news/infographic/` |

---

## Page Structure

### Homepage Structure

```
├── Header
│   ├── Logo
│   ├── Language Switcher (EN/HI/GU)
│   ├── Search
│   ├── Login/Signup
│   └── Navigation Menu
│       ├── PRO
│       ├── Markets
│       ├── News
│       ├── IPO
│       ├── Mutual Funds
│       └── More...
│
├── Market Summary Section
│   ├── Sensex/Nifty Prices
│   ├── Top Gainers/Losers
│   └── Market Stats
│
├── News Sections
│   ├── Top News (h3 headlines)
│   ├── Trending News
│   ├── Market News
│   └── Sector News
│
├── Stock Quick Links
│   └── Popular stocks (IDFC, Infosys, TCS, etc.)
│
├── Sidebar
│   ├── Advertisements
│   ├── Market Watch
│   └── Trending Topics
│
└── Footer
    ├── Sitemap Links
    ├── Social Media
    └── Copyright
```

### News Article Page Structure

```
├── Article Header
│   ├── Category Breadcrumb
│   ├── H1 Title
│   ├── Author Name (class: article_author)
│   ├── Publish Date
│   └── Social Share Buttons
│
├── Article Body
│   ├── Lead Image (optional)
│   ├── Article Content (paragraphs in <p> tags)
│   ├── Key Highlights (optional)
│   └── Related Links
│
├── Sidebar
│   ├── Related Articles
│   ├── Market Data Widget
│   └── Advertisements
│
└── Comments Section (if enabled)
```

---

## HTML Selectors for Scraping

### Using Scrapling/Scrapy CSS Selectors

```python
from scrapling.fetchers import Fetcher

page = Fetcher.get('https://www.moneycontrol.com/', impersonate='chrome')

# Page title
title = page.css('title::text').get()

# News headlines (h3 links)
headlines = page.css('h3 a')

# Article title
article_title = page.css('h1::text').get()

# Article content paragraphs
paragraphs = page.css('.article_content p::text').getall()
# or
paragraphs = page.css('article p::text').getall()

# Links with URLs
links = page.css('a::attr(href)').getall()

# Stock links (specific pattern)
stock_links = page.css('a[href*="stockpricequote"]')

# News article links (pattern: .html with numeric ID)
news_links = page.css('a[href$=".html"]')

# Navigation items
nav_items = page.css('nav a, .nav a')

# Meta description
meta_desc = page.css('meta[name="description"]::attr(content)').get()

# Meta keywords
meta_keywords = page.css('meta[name="keywords"]::attr(content)').get()
```

### XPath Selectors

```python
# All links
links = page.xpath('//a/@href').getall()

# Article paragraphs
paragraphs = page.xpath('//article//p/text()').getall()

# Links containing specific text
market_links = page.xpath('//a[contains(@href, "markets")]/@href').getall()

# News articles (URL contains article ID pattern)
news = page.xpath('//a[contains(@href, ".html") and contains(@href, "-13")]/@href').getall()
```

### BeautifulSoup-style Selection

```python
# Find all divs with class
divs = page.find_all('div', class_='clearfix')

# Find by multiple classes
items = page.find_all('div', class_='news_item')

# Find specific tags
headlines = page.find_all(['h2', 'h3'])
```

---

## Key CSS Classes

| Class | Purpose |
|-------|---------|
| `.article_author` | Article author name |
| `.article_date` | Publication date |
| `.article_content` | Main article body |
| `.news_item` | News item container |
| `.clearfix` | Common container class |
| `.market_indices` | Market index display |
| `.stock_list` | Stock listing |
| `.trending` | Trending section |
| `.nav_link` | Navigation links |
| `.top_news` | Top news section |

---

## Filtering News Articles

### Identifying News Articles vs Category Pages

```python
def is_news_article(url):
    """Check if URL is a news article (not category page)"""
    if not url or 'javascript:' in url:
        return False

    # News articles have .html extension
    if not url.endswith('.html'):
        return False

    # Extract the article ID (7-8 digit number before .html)
    import re
    match = re.search(r'-(\d{7,8})\.html$', url)

    return bool(match)

# Usage
for link in page.css('a'):
    href = link.css('::attr(href)').get()
    if is_news_article(href):
        # This is a news article
        pass
```

### Extracting Article ID

```python
import re

url = 'https://www.moneycontrol.com/news/india/mumbai-bmc-budget-13843286.html'

# Extract article ID
match = re.search(r'-(\d+)\.html$', url)
if match:
    article_id = match.group(1)  # '13843286'
```

---

## Scraping Examples

### Get Latest News Headlines

```python
from scrapling.fetchers import Fetcher

page = Fetcher.get('https://www.moneycontrol.com/news/', impersonate='chrome')

seen_urls = set()
news_items = []

for link in page.css('a'):
    href = link.css('::attr(href)').get()
    text = link.css('::text').get()

    if href and text:
        # Check if it's a news article
        if '.html' in href and '-' in href:
            parts = href.split('-')
            if parts[-1].replace('.html', '').isdigit():
                if href not in seen_urls and len(text.strip()) > 25:
                    seen_urls.add(href)
                    news_items.append({
                        'title': text.strip(),
                        'url': href
                    })

for item in news_items[:20]:
    print(f"- {item['title']}")
    print(f"  {item['url']}")
```

### Get Full Article Content

```python
from scrapling.fetchers import Fetcher

url = 'https://www.moneycontrol.com/news/...html'
page = Fetcher.get(url, impersonate='chrome')

# Get title
title = page.css('h1::text').get()

# Get article content
content_selectors = [
    '.article_content p::text',
    'article p::text',
    '.content p::text',
]

article_text = None
for selector in content_selectors:
    paragraphs = page.css(selector).getall()
    if paragraphs:
        article_text = '\n\n'.join(p.strip() for p in paragraphs if p.strip())
        break

# Fallback: get all long paragraphs
if not article_text:
    all_paragraphs = page.css('p::text').getall()
    article_paragraphs = [p.strip() for p in all_paragraphs if len(p.strip()) > 50]
    article_text = '\n\n'.join(article_paragraphs)

print(f"TITLE: {title}")
print(f"CONTENT:\n{article_text}")
```

### Get Stock Information

```python
from scrapling.fetchers import Fetcher

# Homepage has quick stock links
page = Fetcher.get('https://www.moneycontrol.com/', impersonate='chrome')

stock_links = page.css('a[href*="stockpricequote"]')

for stock in stock_links[:10]:
    name = stock.css('::text').get()
    url = stock.css('::attr(href)').get()
    if name and name.strip():
        print(f"{name.strip()}: {url}")
```

### Get Market Navigation

```python
from scrapling.fetchers import Fetcher

page = Fetcher.get('https://www.moneycontrol.com/markets/indian-indices/', impersonate='chrome')

# Market stats navigation
nav_items = page.css('nav a, .nav_link a')

for item in nav_items:
    text = item.css('::text').get()
    href = item.css('::attr(href)').get()
    if text and text.strip():
        print(f"- {text.strip()}: {href}")
```

---

## Statistics (from actual scrape)

| Metric | Count |
|--------|-------|
| Total Links | 1,790 |
| Total Images | 395 |
| Total Divs | 1,224 |
| Total Paragraphs | 493 |
| Total Scripts | 169 |
| Total Forms | 9 |

---

## Anti-Bot Considerations

Moneycontrol.com generally allows scraping with proper headers. Key points:

1. **Use Browser Impersonation:**
   ```python
   page = Fetcher.get(url, impersonate='chrome')
   ```

2. **Stealthy Headers:**
   ```python
   page = session.get(url, stealthy_headers=True)
   ```

3. **Rate Limiting:** Add delays between requests to avoid being blocked

4. **For Protected Pages:** Use `StealthyFetcher`:
   ```python
   from scrapling.fetchers import StealthyFetcher
   page = StealthyFetcher.fetch(url, headless=True)
   ```

---

## Content Categories

### News Categories

| Category | Description |
|----------|-------------|
| Business | Corporate and business news |
| Markets | Stock market updates |
| Stocks | Individual stock news |
| Economy | Economic policy and data |
| Companies | Company-specific news |
| India | National news |
| World | International news |
| Politics | Political news |

### Stock Sectors (in URLs)

| Sector | Example URL Segment |
|--------|---------------------|
| Banks - Private Sector | `banks-private-sector` |
| Computers - Software | `computers-software` |
| Auto Ancillaries | `auto-ancillaries-brakes` |
| Online Services | `online-services` |
| Finance | `finance` |
| Pharmaceuticals | `pharmaceuticals` |

---

## Common Scraping Tasks

| Task | Best Approach |
|------|---------------|
| Latest News | Scrape `/news/` page, filter `.html` links |
| Article Content | Get `h1` title + `p` paragraphs |
| Stock Links | Filter `a[href*="stockpricequote"]` |
| Navigation | Parse `nav` elements |
| Market Data | Check market-specific pages |
| Full Text | Combine all `p::text` with length filter |

---

## Files Created During Testing

| File | Purpose |
|------|---------|
| `/tmp/test_scrapling.py` | Basic test |
| `/tmp/test_scrapling_detailed.py` | Detailed extraction |
| `/tmp/test_scrapling_comprehensive.py` | Full demo |
| `/tmp/get_latest_news.py` | News headlines scraper |
| `/tmp/scrape_article.py` | Article content scraper |
| `/tmp/moneycontrol_data.json` | Extracted data in JSON |
| `/tmp/moneycontrol_structure.md` | This documentation |

---

## Notes

- Article IDs are sequential (latest articles have higher IDs)
- Article URLs contain slug with keywords for SEO
- Site uses responsive design (same HTML for mobile/desktop)
- Some content is loaded via JavaScript (use DynamicFetcher if needed)
- Meta tags contain good summary information

---

*Generated using Scrapling library - https://github.com/d4vinci/scrapling*
