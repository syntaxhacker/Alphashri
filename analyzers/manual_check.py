
import sys
import os
from datetime import datetime, timedelta
import traceback

# Ensure we can import from current directory
sys.path.append(os.getcwd())

try:
    from upstox_trader.config_and_utils.free_indian_apis import UpstoxAPI
    from upstox_trader.config import UPSTOX_CONFIG
except ImportError as e:
    print(f"Import Error: {e}")
    # Try alternative import if running from inside upstox_trader (unlikely but possible)
    sys.exit(1)

def check_stocks():
    print("Initializing Upstox API...")
    try:
        api_key = UPSTOX_CONFIG.get('api_key')
        api_secret = UPSTOX_CONFIG.get('api_secret')
        # Set quiet=False to see auth errors
        upstox_api = UpstoxAPI(api_key, api_secret, quiet=False)
        
        print(f"Auth Token Present: {bool(upstox_api.auth_handler.access_token)}")
        if not upstox_api.auth_handler.access_token:
            print("Attempting to authenticate...")
            upstox_api.auth_handler.authenticate()
        print("API Initialized.")
        # print(f"Methods: {[m for m in dir(upstox_api) if not m.startswith('_')]}")
    except Exception as e:
        print(f"Failed to initialize API: {e}")
        traceback.print_exc()
        return

    targets = {
        'LTF': 315.25,
        'KARURVYSYA': 258.50,
        'AUBANK': 967.00,
        'INDUSTOWER': 429.90,
        'CHOLAFIN': 1780.90,
        'GPPL': 198.80,
        'PRIVISCL': 3433.00,
        'KIRLOSENG': 1196.25,
        'MEDPLUS': 1052.05,
        'LTIM': 6764.80,
        'TCS': 4494.00,
        'MPHASIS': 3239.55,
        'LTTS': 5647.35,
        'TRITURBINE': 842.00,
        'BSOFT': 624.10,
        'AUROPHARMA': 1364.95,
        'WIPRO': 324.55,
        'INFY': 2006.80
    }

    print(f"\n{'Symbol':<15} {'Target 52W':<12} {'Today High':<12} {'Touched?':<10}")
    print("-" * 50)

    for symbol, target in targets.items():
        try:
            # Get instrument key
            if not hasattr(upstox_api, 'get_instrument_key'):
                print(f"Error: upstox_api object missing get_instrument_key method")
                break
                
            instrument_key = upstox_api.get_instrument_key(symbol)
            if not instrument_key:
                print(f"{symbol:<15} {'Not Found':<12} {'-':<12} {'-':<10}")
                continue

            # Try getting real-time quote using direct API call
            try:
                # Get instrument key first
                instrument_key = upstox_api.get_instrument_key(symbol)
                if not instrument_key:
                    print(f"{symbol:<15} {'Not Found':<12} {'-':<12} {'-':<10}")
                    continue

                # Upstox V2 Market Quote API
                url = "https://api.upstox.com/v2/market-quote/quotes"
                params = {'instrument_key': instrument_key}
                headers = upstox_api._get_headers()
                headers['Accept'] = 'application/json'
                
                import requests
                response = requests.get(url, params=params, headers=headers)
                
                # print(f"Status: {response.status_code}")
                # print(f"Response: {response.text[:200]}...") # Print first 200 chars
                
                day_high = 0
                if response.status_code == 200:
                    data = response.json()
                    # Structure: { 'status': 'success', 'data': { 'NSE_EQ:SYMBOL': { 'ohlc': { ... }, ... } } }
                    if data.get('status') == 'success' and 'data' in data:
                        # The key in data might be the instrument_key or symbol
                        # Usually it's the instrument_key (e.g. NSE_EQ|INE...)
                        
                        # Let's find the data for our instrument
                        # It returns a dict where keys are instrument keys
                        # We can just iterate values if we requested only one
                        for key, val in data['data'].items():
                             if 'ohlc' in val:
                                 day_high = val['ohlc']['high']
                                 break
                             elif 'dhigh' in val:
                                 day_high = val['dhigh']
                                 break
                        
                if day_high > 0:
                    touched = "✅ YES" if day_high >= target else "No"
                    print(f"{symbol:<15} {target:<12.2f} {day_high:<12.2f} {touched:<10}")
                    continue # Success
                else:
                    print(f"{symbol:<15} {target:<12.2f} {'No Quote':<12} {'-':<10}")
                    # print(f"Full Response for {symbol}: {response.text}")

            except Exception as e:
                print(f"Quote fetch failed for {symbol}: {e}")

            # Fallback to intraday/historical if quote fails
            # Fetch intraday 1-minute data for today to get the high
            # Using V3 API for true today-only data
            df = upstox_api.fetch_intraday_data_v3(
                symbol=symbol,
                interval='1'
            )
            
            if df is not None and not df.empty:
                day_high = df['high'].max()
                
                touched = "✅ YES" if day_high >= target else "No"
                
                print(f"{symbol:<15} {target:<12.2f} {day_high:<12.2f} {touched:<10}")
            else:
                # Fallback: Try fetching last 5 days of 1-minute data using v3 if intraday fails
                # This handles cases where "today" might be a holiday or data is slightly delayed
                df_hist = upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='minutes',
                    interval=1,
                    to_date=datetime.now().strftime('%Y-%m-%d'),
                    from_date=(datetime.now() - timedelta(days=3)).strftime('%Y-%m-%d')
                )
                if df_hist is not None and not df_hist.empty:
                    # Check the latest date in the data
                    latest_date = df_hist.index[-1].date()
                    today_date = datetime.now().date()
                    
                    if latest_date == today_date:
                        # Filter for today only
                        df_today = df_hist[df_hist.index.date == today_date]
                        if not df_today.empty:
                            day_high = df_today['high'].max()
                            touched = "✅ YES" if day_high >= target else "No"
                            print(f"{symbol:<15} {target:<12.2f} {day_high:<12.2f} {touched:<10}")
                        else:
                             print(f"{symbol:<15} {target:<12.2f} {'No Today Data':<12} {'-':<10}")
                    else:
                        print(f"{symbol:<15} {target:<12.2f} {'Old Data':<12} {'-':<10}")
                else:
                    print(f"{symbol:<15} {target:<12.2f} {'No Data':<12} {'-':<10}")

        except Exception as e:
            print(f"{symbol:<15} {target:<12.2f} {'Error':<12} {str(e)}")
            # traceback.print_exc()

if __name__ == "__main__":
    check_stocks()
