# Amazon Scraper

A Python-based Amazon product scraper that uses browser cookies for session management, similar to the TV screener approach.

## Features

- **Cookie-based Authentication**: Uses `rookiepy` to extract cookies from your browser
- **Product Search**: Search for products across multiple pages
- **Price Analysis**: Automatic price range analysis and statistics
- **Rich Display**: Beautiful terminal output with colored tables
- **CSV Export**: Save results to CSV files with timestamps
- **Rate Limiting**: Built-in delays and retry logic to avoid blocking
- **User Agent Rotation**: Rotates user agents to appear more human-like

## Installation

```bash
pip install -r requirements.txt
```

## Usage

### Basic Search
```bash
python amazon_scraper.py "laptop"
```

### Advanced Options
```bash
# Search with more pages
python amazon_scraper.py "smartphone" --pages 5

# Use different Amazon domain
python amazon_scraper.py "books" --domain amazon.com

# Get detailed product information
python amazon_scraper.py "headphones" --details

# Custom output filename
python amazon_scraper.py "watches" --output my_search
```

## Features

### Cookie Management
The scraper automatically extracts cookies from your browser (Chrome/Firefox) to maintain session state, similar to how the TV screener works.

### Price Analysis
Automatically analyzes price distributions:
- Min/Max/Average prices
- Price range categorization
- Product count statistics

### Rate Limiting
Built-in protections:
- Random delays between requests (1-3 seconds)
- User agent rotation
- Retry logic for failed requests
- CAPTCHA detection

## Output

Results are displayed in a rich table format and saved to CSV files with timestamps.

## Dependencies

- `rookiepy`: Browser cookie extraction
- `requests`: HTTP requests
- `beautifulsoup4`: HTML parsing
- `pandas`: Data manipulation
- `rich`: Terminal formatting
- `lxml`: XML/HTML parser