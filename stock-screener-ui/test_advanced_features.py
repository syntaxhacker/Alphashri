import sys
import json
import time

sys.path.insert(0, '/Users/developer/Documents/algos/personal/earner/stock-screener-ui')
sys.path.insert(0, '/Users/developer/Documents/algos/personal/earner/moneycontrol-scraper')
from llm_analyzer import article_analyzer

article_url = "https://www.cnbctv18.com/market/tata-motors-share-price-jlr-sales-q3-results-brokerage-views-19865000.htm"
headline = "Tata Motors shares rise as JLR wholesale jumps 30% in Q3; brokerages bullish"
content = """
Shares of Tata Motors gained on January 10 after its British arm Jaguar Land Rover reported an impressive 30 percent year-on-year growth in wholesale volumes for the third quarter of FY25.
The robust performance was driven by strong demand for Range Rover models. Several international brokerages including Nomura and Goldman Sachs have maintained their 'Buy' rating on Tata Motors, predicting further upside due to improving margins and electric vehicle traction.
"""

print("1. Testing Trade Ideas and Caching...")
print(f"URL: {article_url}\n")

# Run 1 (might be cached if we ran it before, but likely new)
start_time = time.time()
analysis1 = article_analyzer.analyze_article(article_url, headline, content)
duration1 = time.time() - start_time

print(f"Run 1 completed in {duration1:.4f} seconds.")
print(json.dumps(analysis1, indent=2))
print("-" * 40)

# Run 2 (Should definitely hit SQLite cache and be near 0 seconds)
start_time = time.time()
analysis2 = article_analyzer.analyze_article(article_url, headline, content)
duration2 = time.time() - start_time
print(f"Run 2 (Cache) completed in {duration2:.4f} seconds.")

if duration2 < 0.1:
    print("✅ SQLite Caching works perfectly!")
else:
    print("❌ Caching seems slow.")

print("\n✅ Verification Script Complete!")
