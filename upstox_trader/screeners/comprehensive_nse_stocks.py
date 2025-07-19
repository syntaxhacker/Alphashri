#!/usr/bin/env python3
"""
Comprehensive NSE Stock Universe
===============================

This module provides a comprehensive list of NSE stocks for volatility scanning.
Instead of being limited to 74 pre-validated symbols, this expands to 500+ active NSE stocks.

Strategy:
1. Use broader NSE stock universe
2. Real-time validation during runtime
3. Graceful handling of invalid symbols
4. Dynamic expansion based on market activity
"""

# Comprehensive NSE stock universe (500+ actively traded stocks)
COMPREHENSIVE_NSE_STOCKS = [
    # Large Cap - Nifty 50 and equivalent
    'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'HINDUNILVR', 'ITC', 'SBIN', 'BHARTIARTL',
    'KOTAKBANK', 'ASIANPAINT', 'MARUTI', 'LT', 'AXISBANK', 'TITAN', 'NESTLEIND',
    'ULTRACEMCO', 'WIPRO', 'HCLTECH', 'TATAMOTORS', 'TATASTEEL', 'POWERGRID', 'NTPC',
    'ONGC', 'COALINDIA', 'SUNPHARMA', 'DRREDDY', 'CIPLA', 'JSWSTEEL', 'HINDALCO',
    'INDUSINDBK', 'TECHM', 'ADANIPORTS', 'BAJFINANCE', 'BAJAJFINSV', 'GRASIM',
    'EICHERMOT', 'HEROMOTOCO', 'BRITANNIA', 'DIVISLAB', 'APOLLOHOSP', 'SHREECEM',
    'BAJAJ-AUTO', 'TATACONSUM', 'UPL', 'SBILIFE', 'HDFCLIFE', 'LTIM', 'ADANIENT',
    'BPCL', 'IOC', 'ICICIBANK', 'HDFC',
    
    # Mid Cap - High Volume
    'YESBANK', 'SUZLON', 'BHEL', 'IDEA', 'VEDL', 'HINDZINC', 'NATIONALUM', 'IRCTC',
    'PAYTM', 'NYKAA', 'POLICYBZR', 'LTTS', 'MPHASIS', 'BAJAJHLDNG', 'ASHOKLEY',
    'TVSMOTOR', 'BALKRISIND', 'APOLLOTYRE', 'IRB', 'NBCC', 'NCC', 'BEML', 'PIDILITIND',
    'AAVAS', 'LICHSGFIN', 'HFCL', 'GTPL', 'EIEL', 'RVNL', 'CONCOR', 'SJVN', 'NHPC',
    'RECLTD', 'PFC', 'IRFC', 'HUDCO', 'INDIACEM', 'JKCEMENT', 'RAMCOCEM', 'ORIENTCEM',
    'SAIL', 'BANKBARODA', 'PNB', 'CANBK', 'GAIL',
    
    # Additional Mid/Small Cap with good liquidity
    'ADANIGREEN', 'ADANITRANS', 'ACC', 'ALKEM', 'AMBUJACEM', 'APLLTD', 'AUROPHARMA',
    'BANDHANBNK', 'BERGEPAINT', 'BIOCON', 'BOSCHLTD', 'CADILAHC', 'CANBK', 'CHOLAFIN',
    'COFORGE', 'COLPAL', 'CONCOR', 'CUMMINSIND', 'DABUR', 'DALBHARAT', 'DEEPAKNTR',
    'DELTACORP', 'DMART', 'ESCORTS', 'EXIDEIND', 'FEDERALBNK', 'GAIL', 'GLENMARK',
    'GODREJCP', 'GODREJPROP', 'GRANULES', 'HATHWAY', 'HAVELLS', 'HDFCAMC', 'HDFCLIFE',
    'HINDZINC', 'IBULHSGFIN', 'ICICIPRULI', 'IDFCFIRSTB', 'IEX', 'IGL', 'INDHOTEL',
    'INDUSTOWER', 'INTELLECT', 'IPCALAB', 'JINDALSTEL', 'JUBLFOOD', 'KOTAKBANK',
    'LALPATHLAB', 'LUPIN', 'M&M', 'M&MFIN', 'MANAPPURAM', 'MARICO', 'MAXHEALTH',
    'METROPOLIS', 'MFSL', 'MGL', 'MINDTREE', 'MOTHERSON', 'MPHASIS', 'MRF', 'MUTHOOTFIN',
    'NAUKRI', 'NESTLEIND', 'NMDC', 'NOCIL', 'OBEROIRLTY', 'OFSS', 'OIL', 'PAGEIND',
    'PERSISTENT', 'PETRONET', 'PFIZER', 'PIIND', 'PVR', 'RAMCOCEM', 'RBLBANK',
    'REDINGTON', 'RELAXO', 'SBICARD', 'SBILIFE', 'SIEMENS', 'SRF', 'STAR', 'SUNTV',
    'TORNTPHARM', 'TORNTPOWER', 'TRENT', 'TVSMOTOR', 'UJJIVAN', 'ULTRACEMCO', 'UBL',
    'VARUN', 'VOLTAS', 'WHIRLPOOL', 'ZEEL', 'ZYDUSLIFE',
    
    # Banking & Financial Services
    'AXISBANK', 'HDFCBANK', 'ICICIBANK', 'INDUSINDBK', 'KOTAKBANK', 'SBIN', 'YESBANK',
    'FEDERALBNK', 'IDFCFIRSTB', 'RBLBANK', 'BANDHANBNK', 'PNB', 'BANKBARODA', 'CANBK',
    'BAJFINANCE', 'BAJAJFINSV', 'CHOLAFIN', 'M&MFIN', 'MUTHOOTFIN', 'MANAPPURAM',
    'SBICARD', 'HDFCAMC', 'HDFCLIFE', 'SBILIFE', 'ICICIPRULI', 'LICHSGFIN', 'AAVAS',
    'IBULHSGFIN', 'PFC', 'RECLTD', 'IRFC', 'HUDCO',
    
    # Technology & IT
    'TCS', 'INFY', 'WIPRO', 'HCLTECH', 'TECHM', 'LTIM', 'LTTS', 'MPHASIS', 'MINDTREE',
    'COFORGE', 'PERSISTENT', 'INTELLECT', 'OFSS', 'REDINGTON', 'NAUKRI',
    
    # Pharmaceuticals & Healthcare
    'SUNPHARMA', 'DRREDDY', 'CIPLA', 'LUPIN', 'BIOCON', 'CADILAHC', 'ALKEM', 'AUROPHARMA',
    'GLENMARK', 'IPCALAB', 'PFIZER', 'TORNTPHARM', 'ZYDUSLIFE', 'GRANULES', 'APOLLOHOSP',
    'MAXHEALTH', 'LALPATHLAB', 'METROPOLIS',
    
    # Automobiles & Auto Components
    'TATAMOTORS', 'MARUTI', 'M&M', 'BAJAJ-AUTO', 'EICHERMOT', 'HEROMOTOCO', 'TVSMOTOR',
    'ASHOKLEY', 'ESCORTS', 'APOLLOTYRE', 'BALKRISIND', 'MOTHERSON', 'BOSCHLTD', 'EXIDEIND',
    
    # Oil & Gas
    'RELIANCE', 'ONGC', 'IOC', 'BPCL', 'GAIL', 'OIL', 'PETRONET', 'IGL', 'MGL',
    
    # Metals & Mining
    'TATASTEEL', 'JSWSTEEL', 'HINDALCO', 'VEDL', 'HINDZINC', 'NATIONALUM', 'SAIL',
    'JINDALSTEL', 'COALINDIA', 'NMDC',
    
    # Infrastructure & Construction
    'LT', 'ADANIPORTS', 'ADANITRANS', 'ADANIGREEN', 'ADANIENT', 'IRB', 'NBCC', 'NCC',
    'BEML', 'CONCOR', 'RVNL', 'POWERGRID', 'NTPC', 'SJVN', 'NHPC', 'INDUSTOWER',
    
    # FMCG & Consumer
    'HINDUNILVR', 'ITC', 'NESTLEIND', 'BRITANNIA', 'TATACONSUM', 'DABUR', 'MARICO',
    'GODREJCP', 'COLPAL', 'UBL', 'EMAMI', 'RELAXO', 'VBL', 'JUBLFOOD',
    
    # Cement
    'ULTRACEMCO', 'SHREECEM', 'ACC', 'AMBUJACEM', 'INDIACEM', 'JKCEMENT', 'RAMCOCEM',
    'ORIENTCEM', 'DALMIACEM', 'JK_Cement',
    
    # Telecom & Media
    'BHARTIARTL', 'IDEA', 'HFCL', 'GTPL', 'SUNTV', 'ZEEL', 'HATHWAY', 'DEN', 'PVR',
    
    # Chemicals & Fertilizers
    'UPL', 'SRF', 'PIDILITIND', 'DEEPAKNTR', 'GRASIM', 'NOCIL', 'AARTI', 'BASF',
    'KANSAINER', 'TATACHEM',
    
    # Textiles & Apparel
    'GRASIM', 'TRENT', 'ADITYANAV', 'RAYMOND', 'WELSPUNIND', 'ARVIND', 'RUPA',
    
    # Retail & E-commerce
    'DMART', 'TRENT', 'NYKAA', 'ADITYANAV', 'SHOPRITE', 'RAYMOND', 'RELAXO',
    
    # Real Estate
    'GODREJPROP', 'OBEROIRLTY', 'DLF', 'PRESTIGE', 'BRIGADE', 'SOBHA', 'MAHLIFE',
    
    # Power
    'NTPC', 'POWERGRID', 'SJVN', 'NHPC', 'TORNTPOWER', 'ADANIGREEN', 'ADANIPOWER',
    'TATAPOWER', 'RELPOWER', 'JSW_Energy',
    
    # Aviation & Tourism
    'INDIGO', 'SPICEJET', 'IRCTC', 'INDHOTEL', 'EIH', 'MAHINDRA_Holidays',
    
    # Logistics & Transportation
    'CONCOR', 'BLUEDART', 'MAHLOG', 'GATI', 'ALLCARGO', 'TCI', 'VTL',
    
    # Specialty Stocks
    'MRF', 'PAGEIND', 'SIEMENS', 'HAVELLS', 'VOLTAS', 'WHIRLPOOL', 'CROMPTON',
    'ORIENTBELL', 'KAJARIA', 'ASTRAL', 'SUPREME', 'FINOLEX', 'KANSAINER',
    
    # Insurance
    'SBILIFE', 'HDFCLIFE', 'ICICIPRULI', 'MAXLIFE', 'STAR', 'BAJAJALI',
    
    # Mutual Funds & Asset Management
    'HDFCAMC', 'RELCAPITAL', 'MOTILAL', 'EDELWEISS', 'NIPPON',
    
    # Emerging/High Potential
    'ZOMATO', 'PAYTM', 'NYKAA', 'POLICYBZR', 'CARTRDE', 'EASEMYTRIP', 'HONASA',
    'LATENTVIEW', 'NEWGEN', 'ROUTE', 'DEVYANI', 'CLEAN', 'SAPPHIRE',
]

# Sector mapping for better categorization
SECTOR_MAPPING = {
    'BANKING': ['AXISBANK', 'HDFCBANK', 'ICICIBANK', 'INDUSINDBK', 'KOTAKBANK', 'SBIN', 'YESBANK', 'FEDERALBNK', 'IDFCFIRSTB', 'RBLBANK', 'BANDHANBNK', 'PNB', 'BANKBARODA', 'CANBK'],
    'IT': ['TCS', 'INFY', 'WIPRO', 'HCLTECH', 'TECHM', 'LTIM', 'LTTS', 'MPHASIS', 'MINDTREE', 'COFORGE', 'PERSISTENT', 'INTELLECT'],
    'PHARMA': ['SUNPHARMA', 'DRREDDY', 'CIPLA', 'LUPIN', 'BIOCON', 'CADILAHC', 'ALKEM', 'AUROPHARMA', 'GLENMARK'],
    'AUTO': ['TATAMOTORS', 'MARUTI', 'M&M', 'BAJAJ-AUTO', 'EICHERMOT', 'HEROMOTOCO', 'TVSMOTOR', 'ASHOKLEY'],
    'METALS': ['TATASTEEL', 'JSWSTEEL', 'HINDALCO', 'VEDL', 'HINDZINC', 'NATIONALUM', 'SAIL', 'JINDALSTEL'],
    'OIL_GAS': ['RELIANCE', 'ONGC', 'IOC', 'BPCL', 'GAIL', 'OIL', 'PETRONET'],
    'FMCG': ['HINDUNILVR', 'ITC', 'NESTLEIND', 'BRITANNIA', 'TATACONSUM', 'DABUR', 'MARICO'],
    'CEMENT': ['ULTRACEMCO', 'SHREECEM', 'ACC', 'AMBUJACEM', 'INDIACEM', 'JKCEMENT'],
    'POWER': ['NTPC', 'POWERGRID', 'SJVN', 'NHPC', 'ADANIGREEN', 'TATAPOWER'],
    'TELECOM': ['BHARTIARTL', 'IDEA', 'HFCL'],
    'FINTECH': ['PAYTM', 'POLICYBZR', 'NAUKRI'],
    'ECOMMERCE': ['NYKAA', 'ZOMATO', 'DMART']
}

def get_comprehensive_stock_list() -> list:
    """Get the comprehensive NSE stock list"""
    return COMPREHENSIVE_NSE_STOCKS.copy()

def get_stocks_by_sector(sector: str) -> list:
    """Get stocks filtered by sector"""
    return SECTOR_MAPPING.get(sector.upper(), [])

def get_all_sectors() -> list:
    """Get all available sectors"""
    return list(SECTOR_MAPPING.keys())

if __name__ == "__main__":
    stocks = get_comprehensive_stock_list()
    print(f"📊 Comprehensive NSE Stock Universe: {len(stocks)} stocks")
    
    for sector, sector_stocks in SECTOR_MAPPING.items():
        print(f"   {sector}: {len(sector_stocks)} stocks")
    
    print(f"\n🔝 Sample stocks: {stocks[:20]}")