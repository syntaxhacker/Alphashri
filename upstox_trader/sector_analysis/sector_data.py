#!/usr/bin/env python3
"""
Sector Data Module - Data fetching logic for TradingView, Upstox API, and instrument mapping.
"""

import numpy as np
import pandas as pd
from datetime import datetime, timedelta
import requests
import gzip
import json
from typing import Dict, List, Optional

try:
    import rookiepy
    from tradingview_screener import Query, col
    TV_AVAILABLE = True
except ImportError:
    TV_AVAILABLE = False

try:
    import sys
    import os
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from config import UPSTOX_CONFIG
    from config_and_utils.upstox_auth import UpstoxAuthHandler, TOKEN_FILE
    UPSTOX_AVAILABLE = True
except ImportError:
    UPSTOX_AVAILABLE = False

from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn

console = Console()


class SectorDataFetcher:
    def __init__(self):
        self.cookies = self._get_tv_cookies() if TV_AVAILABLE else None
        self.instrument_mapping = {}
        
    def _get_tv_cookies(self):
        """Get TradingView cookies for live data"""
        try:
            cookies_raw = rookiepy.chrome(['.tradingview.com'])
            cookies = rookiepy.to_cookiejar(cookies_raw)
            if cookies_raw:
                console.print("[green]✅ TradingView cookies loaded[/green]")
            return cookies
        except Exception:
            try:
                cookies_raw = rookiepy.firefox(['.tradingview.com'])
                cookies = rookiepy.to_cookiejar(cookies_raw)
                return cookies
            except Exception:
                console.print("[yellow]⚠️ No TradingView cookies found[/yellow]")
                return None
    
    def fetch_sector_stocks(self) -> Dict[str, List[Dict]]:
        """Fetch stocks grouped by sectors from TradingView"""
        if not TV_AVAILABLE:
            console.print("[red]TradingView screener not available[/red]")
            return {}
        
        console.print(Panel.fit("🔍 Fetching Sector Stock Data", style="bold blue"))
        
        try:
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                console=console
            ) as progress:
                task = progress.add_task("Fetching sector data...", total=None)
                
                query = (Query()
                    .select('name', 'close', 'sector', 'industry', 'market_cap_basic', 
                           'volume', 'Perf.W', 'Perf.3M', 'RSI', 'beta_1_year')
                    .set_markets('india')
                    .where(
                        col('sector') != '',
                        col('market_cap_basic') > 1_000_000_000,
                        col('volume') > 100_000,
                        col('close') > 10
                    )
                    .limit(500))
                
                data = query.get_scanner_data()
                
                df = data[1] if isinstance(data, tuple) else data
                progress.update(task, description="Processing sector data...")
                
                sector_groups = {}
                for _, row in df.iterrows():
                    sector = row.get('sector', 'Unknown')
                    if sector and sector != 'Unknown':
                        if sector not in sector_groups:
                            sector_groups[sector] = []
                        
                        stock_info = {
                            'symbol': row.get('name', ''),
                            'close': row.get('close', 0),
                            'market_cap': row.get('market_cap_basic', 0),
                            'volume': row.get('volume', 0),
                            'perf_w': row.get('Perf.W', 0),
                            'perf_3m': row.get('Perf.3M', 0),
                            'rsi': row.get('RSI', 50),
                            'beta': row.get('beta_1_year', 1),
                            'industry': row.get('industry', '')
                        }
                        sector_groups[sector].append(stock_info)
                
                sector_groups = {k: v for k, v in sector_groups.items() if len(v) >= 3}
                progress.update(task, description="Complete!")
        
        except Exception as e:
            console.print(f"[red]Error fetching sector data: {e}[/red]")
            return {}
        
        console.print(f"[green]✅ Found {len(sector_groups)} sectors with {sum(len(v) for v in sector_groups.values())} stocks[/green]")
        return sector_groups
    
    def _get_upstox_token(self) -> str:
        token = ""
        try:
            auth = UpstoxAuthHandler(
                UPSTOX_CONFIG.get("api_key", ""),
                UPSTOX_CONFIG.get("api_secret", ""),
                quiet=True,
            )
            if auth.load_token():
                token = auth.access_token or ""
        except Exception:
            pass
        if not token:
            token = UPSTOX_CONFIG.get("access_token", "")
        return token

    def fetch_historical_data_upstox(self, symbol: str, days: int = 365) -> pd.DataFrame:
        """Fetch historical data from Upstox V3 API"""
        if not UPSTOX_AVAILABLE:
            console.print(f"[red]❌ Upstox not configured for {symbol}[/red]")
            return pd.DataFrame()
        
        try:
            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
            
            instrument_key = self.get_instrument_key(symbol)
            if not instrument_key:
                console.print(f"[red]❌ No instrument key found for {symbol}[/red]")
                return pd.DataFrame()
            
            access_token = self._get_upstox_token()
            if not access_token:
                console.print(f"[red]❌ No Upstox access token available for {symbol}[/red]")
                return pd.DataFrame()
            
            url = f"https://api.upstox.com/v3/historical-candle/{instrument_key}/days/1/{to_date}/{from_date}"
            headers = {
                "Accept": "application/json",
                "Authorization": f"Bearer {access_token}"
            }
            
            response = requests.get(url, headers=headers, timeout=30)
            if response.status_code == 200:
                data = response.json()
                if data.get('status') == 'success' and data.get('data', {}).get('candles'):
                    candles = data['data']['candles']
                    df = pd.DataFrame(candles, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume', 'oi'])
                    df['timestamp'] = pd.to_datetime(df['timestamp'])
                    return df
                else:
                    console.print(f"[red]❌ No candle data returned for {symbol}[/red]")
                    return pd.DataFrame()
            else:
                console.print(f"[red]❌ API error {response.status_code} for {symbol}: {response.text}[/red]")
                return pd.DataFrame()
        
        except Exception as e:
            console.print(f"[red]❌ Exception fetching {symbol}: {e}[/red]")
            return pd.DataFrame()
    
    def load_instrument_mapping(self):
        """Load instrument mapping from Upstox NSE master data"""
        console.print(Panel.fit("🔄 Loading Instrument Mapping", style="bold blue"))
        
        try:
            url = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"
            response = requests.get(url, timeout=30)
            
            if response.status_code == 200:
                decompressed_data = gzip.decompress(response.content)
                instruments_data = json.loads(decompressed_data.decode('utf-8'))
                
                mapping = {}
                equity_count = 0
                
                console.print(f"[dim]Processing {len(instruments_data)} instruments...[/dim]")
                sample_instruments = instruments_data[:3] if len(instruments_data) > 3 else instruments_data
                console.print(f"[dim]Sample instrument structure: {sample_instruments}[/dim]")
                
                for instrument in instruments_data:
                    segment = (instrument.get('segment') or 
                              instrument.get('exchange') or 
                              instrument.get('exchange_token'))
                    
                    instrument_type = (instrument.get('instrument_type') or 
                                     instrument.get('instrument_token') or
                                     instrument.get('tradingsymbol'))
                    
                    if ('NSE' in str(segment).upper() and 
                        ('EQ' in str(instrument_type).upper() or 
                         str(segment).upper() == 'NSE_EQ')):
                        
                        trading_symbol = (instrument.get('tradingsymbol') or 
                                        instrument.get('trading_symbol') or
                                        instrument.get('symbol', ''))
                        
                        instrument_key = (instrument.get('instrument_key') or 
                                        instrument.get('instrument_token', ''))
                        
                        name = (instrument.get('name') or 
                               instrument.get('company_name', ''))
                        
                        if trading_symbol and instrument_key:
                            mapping[trading_symbol] = {
                                'instrument_key': str(instrument_key),
                                'name': name,
                                'isin': instrument.get('isin', ''),
                                'lot_size': instrument.get('lot_size', 1)
                            }
                            equity_count += 1
                            
                            if equity_count <= 5:
                                console.print(f"[dim]  Mapped: {trading_symbol} → {instrument_key}[/dim]")
                
                self.instrument_mapping = mapping
                console.print(f"[green]✅ Loaded {equity_count} NSE equity instruments[/green]")
                
                console.print("[dim]Sample mappings:[/dim]")
                sample_count = 0
                for symbol, data in mapping.items():
                    if sample_count < 3:
                        console.print(f"[dim]  {symbol} → {data['instrument_key']} ({data['name'][:30]}...)[/dim]")
                        sample_count += 1
                
            else:
                console.print(f"[red]❌ Failed to download instruments: HTTP {response.status_code}[/red]")
                self.instrument_mapping = {}
                
        except Exception as e:
            console.print(f"[red]❌ Error loading instruments: {e}[/red]")
            self.instrument_mapping = {}
    
    def get_instrument_key(self, symbol: str) -> Optional[str]:
        """Get instrument key for a trading symbol"""
        if symbol in self.instrument_mapping:
            return self.instrument_mapping[symbol]['instrument_key']
        
        variations = [
            symbol.replace('&', '_'),
            symbol.replace('-', ''),
            symbol.upper(),
            symbol.replace('.', '')
        ]
        
        for variation in variations:
            if variation in self.instrument_mapping:
                return self.instrument_mapping[variation]['instrument_key']
        
        return None
    
    def get_current_sector_performance(self, sector_data: Dict[str, List[Dict]]) -> Dict[str, Dict]:
        """Get current intraday performance for all sectors"""
        sector_performance = {}
        
        try:
            for sector in sector_data.keys():
                stocks = sector_data[sector][:5]
                
                sector_changes = []
                sector_volumes = []
                
                for stock in stocks:
                    try:
                        change = stock.get('change', 0)
                        volume_ratio = stock.get('relative_volume_10d_calc', 1.0)
                        
                        sector_changes.append(change)
                        sector_volumes.append(volume_ratio)
                    except:
                        continue
                
                if sector_changes:
                    avg_change = sum(sector_changes) / len(sector_changes)
                    avg_volume = sum(sector_volumes) / len(sector_volumes)
                    
                    sector_performance[sector] = {
                        'change': avg_change,
                        'volume_ratio': avg_volume,
                        'strength': abs(avg_change) * avg_volume,
                        'stocks_count': len(sector_changes),
                        'timestamp': datetime.now()
                    }
            
            return sector_performance
            
        except Exception as e:
            console.print(f"[red]❌ Error fetching sector performance: {e}[/red]")
            return {}
    
    def get_mock_sector_performance(self, sector_data: Dict[str, List[Dict]]) -> Dict[str, float]:
        """Get mock current day sector performance for demonstration"""
        mock_movements = {}
        for sector in sector_data.keys() if sector_data else []:
            base_movement = np.random.normal(0, 1.5)
            mock_movements[sector] = base_movement
        
        return mock_movements
