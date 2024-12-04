# Indian Stock Market Screener

This Python script automatically screens Indian stock market companies to find undervalued stocks based on fundamental analysis.

## Features

- Scrapes data from Nifty 500 companies
- Analyzes fundamental metrics including:
  - P/E Ratio
  - P/B Ratio
  - Dividend Yield
  - Market Cap
- Automatically identifies undervalued stocks based on predefined criteria
- Saves results to CSV file with timestamp
- Includes logging for tracking progress and debugging

## Installation

1. Clone this repository
2. Install required packages:
```bash
pip install -r requirements.txt
```

## Usage

Simply run the script:
```bash
python stock_screener.py
```

The script will:
1. Fetch the list of Nifty 500 companies
2. Analyze each company's fundamentals
3. Identify undervalued stocks based on criteria
4. Save results to a CSV file
5. Display results in the console

## Undervalued Criteria

A stock is considered undervalued if it meets at least 2 of these criteria:
- P/E ratio below 15
- P/B ratio below 1.5
- Dividend yield above 2%

## Output

Results are saved in CSV format with the following columns:
- Symbol
- Company Name
- Market Cap
- P/E Ratio
- P/B Ratio
- Dividend Yield
- Current Price
- Sector

## Note

- The script includes delays to respect API rate limits
- Internet connection is required
- Some data might not be available for all companies 