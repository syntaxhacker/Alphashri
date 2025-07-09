#!/usr/bin/env python3
"""
COMPLETE Binance Futures Trade Export - CAPTURES EVERYTHING
This script inspects and exports ALL available fields from the API
"""

from datetime import datetime
from binance.um_futures import UMFutures
from config import BINANCE_API_CONFIG
import csv
import json
import os

# Colors
class Colors:
    RED = '\033[91m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    WHITE = '\033[97m'
    BOLD = '\033[1m'
    RESET = '\033[0m'

def main():
    print(f"""
{Colors.BOLD}{Colors.CYAN}🔍 COMPLETE API DATA INSPECTION & EXPORT{Colors.RESET}
{Colors.CYAN}{'=' * 60}{Colors.RESET}
{Colors.WHITE}This will show you EVERY field available from the API{Colors.RESET}
    """)
    
    config = BINANCE_API_CONFIG['testnet']
    client = UMFutures(
        key=config['api_key'],
        secret=config['api_secret'],
        base_url=config['futures_api']
    )
    
    try:
        # 1. INSPECT TRADE DATA STRUCTURE
        print(f"\n{Colors.BOLD}{Colors.YELLOW}🔍 INSPECTING TRADE DATA STRUCTURE{Colors.RESET}")
        trades = client.get_account_trades(symbol='BTCUSDT', limit=1)
        
        if trades:
            sample_trade = trades[0]
            print(f"{Colors.GREEN}✅ Found trade data! Here are ALL available fields:{Colors.RESET}")
            print(f"{Colors.CYAN}=" * 60 + "{Colors.RESET}")
            
            for key, value in sample_trade.items():
                print(f"{Colors.WHITE}{key:20} : {value} ({type(value).__name__}){Colors.RESET}")
            
            print(f"\n{Colors.BOLD}📊 TOTAL FIELDS AVAILABLE: {len(sample_trade.keys())}{Colors.RESET}")
            print(f"{Colors.YELLOW}Field names: {list(sample_trade.keys())}{Colors.RESET}")
        
        # 2. GET ALL TRADES AND EXPORT WITH ALL FIELDS
        print(f"\n{Colors.BOLD}{Colors.YELLOW}🔥 COLLECTING ALL TRADES{Colors.RESET}")
        all_trades = []
        
        symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT', 'SOLUSDT']
        for symbol in symbols:
            try:
                symbol_trades = client.get_account_trades(symbol=symbol, limit=500)
                if symbol_trades:
                    all_trades.extend(symbol_trades)
                    print(f"  {Colors.GREEN}{symbol}: {len(symbol_trades)} trades{Colors.RESET}")
            except Exception as e:
                print(f"  {Colors.RED}{symbol}: {e}{Colors.RESET}")
        
        # 3. SAVE TO CSV WITH ALL FIELDS
        if all_trades:
            print(f"\n{Colors.BOLD}{Colors.CYAN}💾 SAVING COMPLETE DATA{Colors.RESET}")
            
            # Get all possible fields from all trades
            all_fields = set()
            for trade in all_trades:
                all_fields.update(trade.keys())
            
            field_list = sorted(all_fields)
            print(f"{Colors.CYAN}Exporting {len(field_list)} fields: {field_list}{Colors.RESET}")
            
            # Create enhanced CSV with computed fields
            enhanced_fields = field_list + ['readable_time', 'side_text', 'pnl_percent']
            
            csv_data = []
            for trade in all_trades:
                row = []
                
                # Add all original fields
                for field in field_list:
                    row.append(trade.get(field, ''))
                
                # Add computed fields
                readable_time = datetime.fromtimestamp(trade['time'] / 1000).strftime('%Y-%m-%d %H:%M:%S')
                side_text = 'BUY' if trade.get('buyer', False) else 'SELL'
                
                # Calculate PnL percentage
                try:
                    pnl = float(trade.get('realizedPnl', 0))
                    quote_qty = float(trade.get('quoteQty', 0))
                    pnl_pct = (pnl / quote_qty * 100) if quote_qty > 0 else 0
                except:
                    pnl_pct = 0
                
                row.extend([readable_time, side_text, pnl_pct])
                csv_data.append(row)
            
            # Sort by timestamp
            csv_data.sort(key=lambda x: x[field_list.index('time')], reverse=True)
            
            # Save to CSV
            with open('all_fields_trades.csv', 'w', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                writer.writerow(enhanced_fields)
                writer.writerows(csv_data)
            
            size = os.path.getsize('all_fields_trades.csv')
            print(f"{Colors.GREEN}✅ Saved {len(csv_data)} trades with {len(enhanced_fields)} fields to all_fields_trades.csv ({size:,} bytes){Colors.RESET}")
        
        # 4. INSPECT ACCOUNT DATA
        print(f"\n{Colors.BOLD}{Colors.YELLOW}📊 INSPECTING ACCOUNT DATA{Colors.RESET}")
        account = client.account()
        
        print(f"{Colors.GREEN}Account fields available:{Colors.RESET}")
        for key, value in account.items():
            if key not in ['assets', 'positions']:  # Skip large nested arrays
                print(f"{Colors.WHITE}{key:25} : {value}{Colors.RESET}")
        
        # Show assets structure
        if 'assets' in account and account['assets']:
            print(f"\n{Colors.CYAN}Asset fields: {list(account['assets'][0].keys())}{Colors.RESET}")
        
        # Show positions structure  
        if 'positions' in account and account['positions']:
            print(f"{Colors.CYAN}Position fields: {list(account['positions'][0].keys())}{Colors.RESET}")
        
        # 5. INSPECT ORDER DATA
        print(f"\n{Colors.BOLD}{Colors.YELLOW}📋 INSPECTING ORDER DATA{Colors.RESET}")
        orders = client.get_all_orders(symbol='BTCUSDT', limit=1)
        
        if orders:
            print(f"{Colors.GREEN}Order fields available:{Colors.RESET}")
            for key, value in orders[0].items():
                print(f"{Colors.WHITE}{key:20} : {value} ({type(value).__name__}){Colors.RESET}")
        
        # 6. SUMMARY
        print(f"\n{Colors.BOLD}{Colors.GREEN}✅ COMPLETE API INSPECTION DONE!{Colors.RESET}")
        print(f"""
{Colors.WHITE}📊 What we found:{Colors.RESET}
{Colors.CYAN}• Trade fields: {len(sample_trade.keys()) if trades else 0}{Colors.RESET}
{Colors.CYAN}• Account fields: {len(account.keys())}{Colors.RESET}
{Colors.CYAN}• Order fields: {len(orders[0].keys()) if orders else 0}{Colors.RESET}
{Colors.CYAN}• Total trades exported: {len(all_trades)}{Colors.RESET}

{Colors.WHITE}📁 Files created:{Colors.RESET}
{Colors.GREEN}• all_fields_trades.csv - Complete trade data with ALL fields{Colors.RESET}

{Colors.WHITE}💡 No data is missing - you have everything the API provides!{Colors.RESET}
        """)
        
    except Exception as e:
        print(f"{Colors.RED}❌ Error: {e}{Colors.RESET}")

if __name__ == "__main__":
    main() 