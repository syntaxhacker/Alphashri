import sys
from scrapling.fetchers import Fetcher

sources = {
    'economictimes': 'https://economictimes.indiatimes.com/markets/stocks/news',
    'livemint': 'https://www.livemint.com/market/stock-market-news',
    'financialexpress': 'https://www.financialexpress.com/market/',
    'business_standard': 'https://www.business-standard.com/markets/stock-market',
    'cnbctv18': 'https://www.cnbctv18.com/market/',
    'zeebusiness': 'https://www.zeebiz.com/business/news',
    'ndtvprofit': 'https://www.ndtvprofit.com/markets',
    'thehindu_bl': 'https://www.thehindubusinessline.com/markets/stock-market-news',
    'calcutta_financial_daily': 'https://www.caldaily.com/finance/news',
    'equitymaster': 'https://www.equitymaster.com/news',
    'goodreturns': 'https://www.goodreturns.in/investment-news'
}

for name, url in sources.items():
    print(f"\\n--- {name} ---")
    try:
        page = Fetcher.get(url, impersonate='chrome')
        # Print top 5 links with their text to understand the DOM
        links = page.css('a')
        count = 0
        for link in links:
            href = link.css('::attr(href)').get()
            text = link.css('::text').get()
            if text and len(text.strip()) > 20 and href:
                print(f"[{href}] {text.strip()[:60]}...")
                count += 1
                if count >= 10:
                    break
    except Exception as e:
        print(f"Failed to fetch {name}: {e}")
