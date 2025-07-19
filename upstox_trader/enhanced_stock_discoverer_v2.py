#!/usr/bin/env python3
"""
Enhanced Stock Discoverer V2
===========================

This comprehensive script discovers stocks from multiple sources:
1. NSE website APIs (Nifty 50, 100, 200, 500, MidCap, SmallCap)
2. TradingView screener (backup)
3. Manual comprehensive list
4. Validates with Upstox instrument keys

Creates a comprehensive CSV list of all available NSE stocks.
"""

import pandas as pd
import requests
import time
import json
import csv
from datetime import datetime
from typing import List, Set, Dict, Optional
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('StockDiscoverer')

class ComprehensiveStockDiscoverer:
    """Discover stocks from multiple sources"""
    
    def __init__(self):
        self.all_stocks = set()
        self.stock_details = {}
        
    def discover_from_nse_indices(self) -> Set[str]:
        """Discover stocks from various NSE indices"""
        logger.info("🔍 Discovering stocks from NSE indices...")
        
        # NSE Index endpoints
        nse_indices = [
            'NIFTY%2050',
            'NIFTY%20100', 
            'NIFTY%20200',
            'NIFTY%20500',
            'NIFTY%20MIDCAP%20100',
            'NIFTY%20MIDCAP%20150',
            'NIFTY%20SMALLCAP%20100',
            'NIFTY%20SMALLCAP%20250',
            'NIFTY%20BANK',
            'NIFTY%20IT',
            'NIFTY%20PHARMA',
            'NIFTY%20AUTO',
            'NIFTY%20METAL',
            'NIFTY%20FMCG',
            'NIFTY%20ENERGY',
            'NIFTY%20REALTY'
        ]
        
        nse_stocks = set()
        
        # Session for better connection handling
        session = requests.Session()
        session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.nseindia.com/'
        })
        
        for index in nse_indices:
            try:
                url = f'https://www.nseindia.com/api/equity-stockIndices?index={index}'
                logger.info(f"📊 Fetching {index.replace('%20', ' ').replace('%2050', ' 50')}...")
                
                response = session.get(url, timeout=10)
                
                if response.status_code == 200:
                    data = response.json()
                    if 'data' in data:
                        count_before = len(nse_stocks)
                        for item in data['data']:
                            symbol = item.get('symbol', '').strip()
                            if symbol and symbol != index.replace('%20', ' ').replace('%2050', ' 50'):
                                # Clean the symbol
                                clean_symbol = symbol.replace('&', 'AND').replace('-', '_')
                                nse_stocks.add(clean_symbol)
                                
                                # Store additional details
                                self.stock_details[clean_symbol] = {
                                    'name': item.get('companyName', ''),
                                    'sector': item.get('industry', 'Unknown'),
                                    'last_price': item.get('lastPrice', 0),
                                    'market_cap': item.get('totalTradedValue', 0),
                                    'source': f"NSE_{index.replace('%20', '_').replace('%2050', '_50')}"
                                }
                        
                        new_count = len(nse_stocks) - count_before
                        logger.info(f"   ✅ Added {new_count} new stocks (total: {len(nse_stocks)})")
                        
                else:
                    logger.warning(f"   ⚠️ Failed to fetch {index}: {response.status_code}")
                    
            except Exception as e:
                logger.warning(f"   ❌ Error fetching {index}: {e}")
            
            time.sleep(0.5)  # Be respectful to NSE servers
        
        logger.info(f"✅ NSE Discovery: {len(nse_stocks)} unique stocks")
        return nse_stocks
    
    def discover_from_tradingview_fallback(self) -> Set[str]:
        """Fallback TradingView discovery (if working)"""
        logger.info("🔍 Attempting TradingView fallback discovery...")
        
        try:
            from tradingview_screener import Query, col
            
            # Try a very broad query
            query = Query().select('name').limit(2000)
            results = query.get_scanner_data()
            
            tv_stocks = set()
            
            # Process results similar to previous attempts
            if isinstance(results, tuple) and len(results) == 2:
                columns, data = results
                if hasattr(columns, 'iterrows'):
                    for _, row in columns.iterrows():
                        symbol = str(row.get('name', ''))
                        clean_symbol = self._clean_symbol(symbol)
                        if clean_symbol:
                            tv_stocks.add(clean_symbol)
            
            logger.info(f"✅ TradingView: {len(tv_stocks)} stocks")
            return tv_stocks
            
        except Exception as e:
            logger.warning(f"⚠️ TradingView fallback failed: {e}")
            return set()
    
    def get_manual_comprehensive_list(self) -> Set[str]:
        """Get manually curated comprehensive stock list"""
        logger.info("📚 Loading manual comprehensive stock list...")
        
        # This is our extensive manual list of NSE stocks
        manual_stocks = {
            # Nifty 50 + Large Caps
            'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'HINDUNILVR', 'ITC', 'SBIN', 'BHARTIARTL',
            'KOTAKBANK', 'ASIANPAINT', 'MARUTI', 'LT', 'AXISBANK', 'TITAN', 'NESTLEIND',
            'ULTRACEMCO', 'WIPRO', 'HCLTECH', 'TATAMOTORS', 'TATASTEEL', 'POWERGRID', 'NTPC',
            'ONGC', 'COALINDIA', 'SUNPHARMA', 'DRREDDY', 'CIPLA', 'JSWSTEEL', 'HINDALCO',
            'INDUSINDBK', 'TECHM', 'ADANIPORTS', 'BAJFINANCE', 'BAJAJFINSV', 'GRASIM',
            'EICHERMOT', 'HEROMOTOCO', 'BRITANNIA', 'DIVISLAB', 'APOLLOHOSP', 'SHREECEM',
            'BAJAJ_AUTO', 'TATACONSUM', 'UPL', 'SBILIFE', 'HDFCLIFE', 'LTIM', 'ADANIENT',
            'BPCL', 'IOC', 'ICICIBANK', 'HDFC', 'GODREJCP', 'PIDILITIND',
            
            # Mid/Small Cap High Volume
            'YESBANK', 'SUZLON', 'BHEL', 'IDEA', 'VEDL', 'HINDZINC', 'NATIONALUM', 'IRCTC',
            'PAYTM', 'NYKAA', 'POLICYBZR', 'LTTS', 'MPHASIS', 'BAJAJHLDNG', 'ASHOKLEY',
            'TVSMOTOR', 'BALKRISIND', 'APOLLOTYRE', 'IRB', 'NBCC', 'NCC', 'BEML',
            'AAVAS', 'LICHSGFIN', 'HFCL', 'GTPL', 'EIEL', 'RVNL', 'CONCOR', 'SJVN', 'NHPC',
            'RECLTD', 'PFC', 'IRFC', 'HUDCO', 'INDIACEM', 'JKCEMENT', 'RAMCOCEM', 'ORIENTCEM',
            'SAIL', 'BANKBARODA', 'PNB', 'CANBK', 'GAIL', 'COLPAL', 'DABUR', 'MARICO',
            
            # Banking & Financial
            'FEDERALBNK', 'IDFCFIRSTB', 'RBLBANK', 'BANDHANBNK', 'CHOLAFIN', 'MMFIN',
            'MUTHOOTFIN', 'MANAPPURAM', 'SBICARD', 'HDFCAMC', 'ICICIPRULI', 'IBULHSGFIN',
            
            # Technology
            'COFORGE', 'PERSISTENT', 'INTELLECT', 'OFSS', 'REDINGTON', 'NAUKRI', 'MINDTREE',
            
            # Pharma & Healthcare
            'LUPIN', 'BIOCON', 'CADILAHC', 'ALKEM', 'AUROPHARMA', 'GLENMARK', 'IPCALAB',
            'PFIZER', 'TORNTPHARM', 'ZYDUSLIFE', 'GRANULES', 'MAXHEALTH', 'LALPATHLAB',
            'METROPOLIS',
            
            # Auto & Components
            'MandM', 'ESCORTS', 'EXIDEIND', 'MOTHERSON', 'BOSCHLTD', 'AMARAJABAT',
            
            # Consumer & Retail
            'DMART', 'TRENT', 'ADITYANAV', 'RAYMOND', 'RELAXO', 'VBL', 'JUBLFOOD',
            'EMAMI', 'HONASA', 'SHOPRITE', 'BATAINDIA',
            
            # Infrastructure & Construction
            'DALBHARAT', 'ADANIGREEN', 'ADANITRANS', 'ACC', 'AMBUJACEM', 'SIEMENS',
            'HAVELLS', 'VOLTAS', 'WHIRLPOOL', 'CROMPTON', 'ORIENTBELL', 'KAJARIA',
            
            # Oil & Gas
            'PETRONET', 'IGL', 'MGL', 'OIL',
            
            # Metals & Mining
            'JINDALSTEL', 'NMDC', 'WELSPUNIND', 'HINDZINC', 'RATNAMANI',
            
            # Chemicals & Materials
            'SRF', 'DEEPAKNTR', 'NOCIL', 'AARTI', 'BASF', 'KANSAINER', 'TATACHEM',
            'ASTRAL', 'SUPREME', 'FINOLEX', 'PIIND', 'CHEMANBOI',
            
            # Power & Energy
            'TATAPOWER', 'ADANIPOWER', 'JSW_Energy', 'TORNTPOWER', 'CENTREX',
            
            # Telecom & Media
            'SUNTV', 'ZEEL', 'HATHWAY', 'DEN', 'PVR', 'INOX',
            
            # Real Estate
            'GODREJPROP', 'OBEROIRLTY', 'DLF', 'PRESTIGE', 'BRIGADE', 'SOBHA', 'MAHLIFE',
            
            # Others
            'MRF', 'PAGEIND', 'STAR', 'DELTACORP', 'IEX', 'RUPA', 'RADICO',
            'FINCABLES', 'APOLLOTYRES', 'CEATLTD', 'JKTYRE', 'UFLEX',
            
            # Emerging/New Age
            'ZOMATO', 'CARTRDE', 'EASEMYTRIP', 'DEVYANI', 'CLEAN', 'SAPPHIRE',
            'LATENTVIEW', 'NEWGEN', 'ROUTE', 'METROPOLIS'
        }
        
        logger.info(f"📚 Manual list: {len(manual_stocks)} stocks")
        return manual_stocks
    
    def _clean_symbol(self, symbol: str) -> Optional[str]:
        """Clean and validate symbol"""
        if not symbol or not isinstance(symbol, str):
            return None
            
        # Clean symbol
        clean = symbol.replace('NSE:', '').replace('BSE:', '').strip().upper()
        clean = clean.replace('&', 'AND').replace('-', '_')
        
        # Basic validation
        if len(clean) < 2 or len(clean) > 20:
            return None
            
        # Check if mostly alphanumeric
        if not clean.replace('_', '').replace('AND', '').isalnum():
            return None
            
        return clean
    
    def validate_with_upstox(self, stocks: Set[str]) -> Dict[str, str]:
        """Validate stocks with Upstox and get instrument keys"""
        logger.info(f"🔍 Validating {len(stocks)} stocks with Upstox...")
        
        try:
            from free_indian_apis import UpstoxAPI
            from config import UPSTOX_CONFIG
            
            upstox = UpstoxAPI(
                api_key=UPSTOX_CONFIG['api_key'],
                api_secret=UPSTOX_CONFIG['api_secret']
            )
            
            # Authenticate and load instruments
            if not upstox.access_token:
                upstox.authenticate()
            
            if hasattr(upstox, '_download_and_cache_instruments'):
                upstox._download_and_cache_instruments()
            
            validated_stocks = {}
            
            if upstox.instruments:
                logger.info(f"📊 Loaded {len(upstox.instruments)} Upstox instruments")
                
                for symbol in stocks:
                    for instrument in upstox.instruments:
                        if (instrument.get('trading_symbol') == symbol and 
                            instrument.get('exchange') == 'NSE' and 
                            instrument.get('instrument_type') == 'EQ'):
                            
                            validated_stocks[symbol] = instrument.get('instrument_key', '')
                            break
                
                logger.info(f"✅ Validated {len(validated_stocks)} stocks with Upstox")
            else:
                logger.warning("⚠️ Could not load Upstox instruments")
                
            return validated_stocks
            
        except Exception as e:
            logger.warning(f"⚠️ Upstox validation failed: {e}")
            return {}
    
    def export_comprehensive_results(self, all_stocks: Set[str], validated_stocks: Dict[str, str]):
        """Export comprehensive results to CSV"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Create comprehensive DataFrame
        stock_data = []
        
        for stock in sorted(all_stocks):
            data = {
                'symbol': stock,
                'validated': 'Yes' if stock in validated_stocks else 'No',
                'instrument_key': validated_stocks.get(stock, ''),
                'source': 'Multiple',
                'details': json.dumps(self.stock_details.get(stock, {}))
            }
            stock_data.append(data)
        
        # Export to CSV
        df = pd.DataFrame(stock_data)
        
        # All stocks
        all_file = f"comprehensive_nse_stocks_{timestamp}.csv"
        df.to_csv(all_file, index=False)
        logger.info(f"📄 All stocks saved to: {all_file}")
        
        # Validated stocks only
        validated_df = df[df['validated'] == 'Yes']
        validated_file = f"validated_nse_stocks_{timestamp}.csv"
        validated_df.to_csv(validated_file, index=False)
        logger.info(f"📄 Validated stocks saved to: {validated_file}")
        
        # Summary
        summary = {
            'total_discovered': len(all_stocks),
            'total_validated': len(validated_stocks),
            'validation_rate': f"{len(validated_stocks)/len(all_stocks)*100:.1f}%",
            'discovery_sources': ['NSE_API', 'Manual_List', 'TradingView_Fallback'],
            'timestamp': timestamp
        }
        
        summary_file = f"stock_discovery_summary_{timestamp}.json"
        with open(summary_file, 'w') as f:
            json.dump(summary, f, indent=2)
        logger.info(f"📄 Summary saved to: {summary_file}")
        
        return all_file, validated_file, summary_file
    
    def discover_all_stocks(self):
        """Main discovery method"""
        logger.info("🚀 Starting comprehensive NSE stock discovery...")
        
        # Discover from multiple sources
        nse_stocks = self.discover_from_nse_indices()
        tv_stocks = self.discover_from_tradingview_fallback()
        manual_stocks = self.get_manual_comprehensive_list()
        
        # Combine all sources
        all_stocks = nse_stocks.union(tv_stocks).union(manual_stocks)
        
        logger.info(f"📊 DISCOVERY SUMMARY:")
        logger.info(f"   NSE API: {len(nse_stocks)} stocks")
        logger.info(f"   TradingView: {len(tv_stocks)} stocks")
        logger.info(f"   Manual List: {len(manual_stocks)} stocks")
        logger.info(f"   Total Unique: {len(all_stocks)} stocks")
        
        # Validate with Upstox
        validated_stocks = self.validate_with_upstox(all_stocks)
        
        # Export results
        all_file, validated_file, summary_file = self.export_comprehensive_results(all_stocks, validated_stocks)
        
        logger.info(f"✅ DISCOVERY COMPLETE!")
        logger.info(f"📊 Discovered: {len(all_stocks)} stocks")
        logger.info(f"✅ Validated: {len(validated_stocks)} stocks")
        logger.info(f"📄 Files: {all_file}, {validated_file}")
        
        return all_stocks, validated_stocks

def main():
    """Main function"""
    discoverer = ComprehensiveStockDiscoverer()
    all_stocks, validated_stocks = discoverer.discover_all_stocks()
    
    print(f"\n🎯 FINAL RESULTS:")
    print(f"Total stocks discovered: {len(all_stocks)}")
    print(f"Validated with Upstox: {len(validated_stocks)}")
    print(f"Validation rate: {len(validated_stocks)/len(all_stocks)*100:.1f}%")
    
    if validated_stocks:
        print(f"\n🔝 Top 20 validated stocks:")
        for stock in list(validated_stocks.keys())[:20]:
            print(f"   {stock}")
    
    return all_stocks, validated_stocks

if __name__ == "__main__":
    discovered_stocks, validated_stocks = main()