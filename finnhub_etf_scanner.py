#!/usr/bin/env python3
"""
Finnhub ETF Scanner - Minerals & High Momentum ETFs
Find ETFs focused on minerals/metals and high momentum opportunities

Usage:
    python finnhub_etf_scanner.py                    # Scan all ETF types
    python finnhub_etf_scanner.py --type minerals    # Only minerals ETFs
    python finnhub_etf_scanner.py --type momentum    # Only momentum ETFs
    python finnhub_etf_scanner.py --export-only      # Export to CSV only

Examples:
    python finnhub_etf_scanner.py --type minerals
    python finnhub_etf_scanner.py --type momentum --export-only
"""

import finnhub
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich import box
from rich.progress import Progress, BarColumn, TextColumn
import pandas as pd
from datetime import datetime, timedelta
import argparse
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from queue import Queue
import sys

# Initialize Finnhub client
finnhub_client = finnhub.Client(api_key="d3mkpb1r01qmso349jk0d3mkpb1r01qmso349jkg")

console = Console()

# Rate limiting and thread safety
api_lock = threading.Lock()
api_call_queue = Queue()
last_api_call = 0
MIN_API_INTERVAL = 0.1  # 100ms between API calls

def rate_limited_api_call(func, *args, **kwargs):
    """Rate limited API call with thread safety"""
    global last_api_call
    
    with api_lock:
        current_time = time.time()
        time_since_last = current_time - last_api_call
        
        if time_since_last < MIN_API_INTERVAL:
            time.sleep(MIN_API_INTERVAL - time_since_last)
        
        try:
            result = func(*args, **kwargs)
            last_api_call = time.time()
            return result
        except Exception as e:
            last_api_call = time.time()
            raise e

# Minerals/Metals related ETF symbols
MINERALS_ETFS = [
    'GLD',      # SPDR Gold Shares
    'IAU',      # iShares Gold Trust
    'SLV',      # iShares Silver Trust
    'GDX',      # VanEck Gold Miners ETF
    'GDXJ',     # VanEck Junior Gold Miners ETF
    'SIL',      # iShares MSCI Global Silver Metals Miners ETF
    'COPX',     # Global X Copper Miners ETF
    'PICK',     # iShares MSCI Global Select Metals & Mining Producers ETF
    'XME',      # SPDR S&P Metals and Mining ETF
    'REM',      # iShares MSCI Global Gold Miners ETF
    'USLV',     # ProShares Ultra Silver
    'UGL',      # ProShares Ultra Gold
    'GLDM',     # SPDR Gold MiniShares Trust
    'BAR',      # GraniteShares Gold Trust
    'SGOL',     # Aberdeen Standard Physical Gold Shares ETF
    'SIVR',     # Aberdeen Standard Physical Silver Shares ETF
    'PPLT',     # Aberdeen Standard Physical Platinum Shares ETF
    'PALL',     # Aberdeen Standard Physical Palladium Shares ETF
    'SLVO',     # ProShares Ultra Silver
    'AGQ',      # ProShares Ultra Gold
    'DGP',      # DB Gold Double Long ETN
    'DUST',     # VelocityShares 3x Inverse Gold ETN
    'JDST',     # Daily Junior Gold Miners Index Bear 3X ETF
    'JNUG',     # Daily Junior Gold Miners Index Bull 3X ETF
    'NUGT',     # Daily Gold Miners Index Bull 3X ETF
    'GUSH',     # Daily S&P Oil & Gas Exploration & Production Bull 3X ETF
    'DRIP',     # Daily S&P Oil & Gas Exploration & Production Bear 3X ETF
]

# High momentum ETF keywords for filtering
MOMENTUM_KEYWORDS = [
    'momentum', 'momentum factor', 'mtum',
    'growth', 'aggressive growth', 'tech', 'technology',
    'innovation', 'disruptive', 'breakthrough',
    'cybersecurity', 'cloud', 'artificial intelligence', 'ai',
    'biotechnology', 'genomics', 'clean energy', 'solar',
    'electric vehicle', 'ev', 'battery', 'lithium',
    'semiconductor', 'chip', 'fintech', 'digital payments'
]

def get_etf_details(symbol):
    """Get detailed information about an ETF with rate limiting"""
    try:
        # Get company profile with rate limiting
        profile = rate_limited_api_call(finnhub_client.company_profile2, symbol=symbol)
        
        # Get current quote with rate limiting
        quote = rate_limited_api_call(finnhub_client.quote, symbol)
        
        # Get basic financials with rate limiting
        financials = rate_limited_api_call(finnhub_client.company_basic_financials, symbol, 'all')
        
        # Get peers/sector info with rate limiting (optional, skip if fails)
        try:
            peers = rate_limited_api_call(finnhub_client.company_peers, symbol)
        except:
            peers = None
        
        return {
            'profile': profile,
            'quote': quote,
            'financials': financials,
            'peers': peers
        }
    except Exception as e:
        return None

def calculate_momentum_score(quote_data, financial_data):
    """Calculate momentum score based on various factors"""
    score = 0
    
    if not quote_data or quote_data.get('c', 0) <= 0:
        return 0
    
    current_price = quote_data['c']
    change_pct = quote_data.get('dp', 0)
    
    # Get volume from financials (not from quote data)
    volume = 0
    if financial_data and financial_data.get('metric'):
        metrics = financial_data['metric']
        # Try different volume metrics
        volume = metrics.get('10DayAverageTradingVolume', 0) or \
                metrics.get('3MonthAverageTradingVolume', 0) or \
                metrics.get('currentVolume', 0) or 0
    
    # Price change momentum (35% weight)
    if change_pct > 0:
        score += min(change_pct * 3, 35)
    elif change_pct > -2:  # Small negative change still gets some points
        score += max(change_pct, 0) * 1.5
    
    # Volume momentum (25% weight) - using financials volume data
    if volume > 0:
        # Convert volume to daily shares (these are likely in millions)
        daily_volume = volume * 1000000  # Convert to actual shares
        if daily_volume > 1000000:  # 1M+ shares
            score += min(daily_volume / 10000000, 25)  # Cap at 25
        elif daily_volume > 100000:  # 100K+ shares
            score += min(daily_volume / 500000, 15)
    
    # Price level momentum (20% weight)
    if current_price > 100:  # Higher price often indicates strength
        score += min(current_price / 20, 20)
    elif current_price > 50:
        score += min(current_price / 25, 15)
    elif current_price > 20:
        score += min(current_price / 30, 10)
    
    # Financial metrics momentum (20% weight)
    if financial_data and financial_data.get('metric'):
        metrics = financial_data['metric']
        
        # Market cap bonus
        market_cap = metrics.get('marketCapitalization', 0)
        if market_cap > 10000000000:  # $10B+
            score += 10
        elif market_cap > 1000000000:  # $1B+
            score += 7
        
        # Performance metrics
        if metrics.get('52WeekPriceReturnDaily', 0) > 20:  # 20%+ annual return
            score += 5
        elif metrics.get('52WeekPriceReturnDaily', 0) > 10:
            score += 3
        
        # Recent performance
        if metrics.get('13WeekPriceReturnDaily', 0) > 10:
            score += 3
        elif metrics.get('13WeekPriceReturnDaily', 0) > 5:
            score += 2
    
    return min(score, 100)  # Cap at 100

def is_minerals_etf(profile_data, symbol):
    """Check if ETF is related to minerals/metals"""
    if not profile_data:
        return symbol in MINERALS_ETFS
    
    name = profile_data.get('name', '').lower()
    description = profile_data.get('description', '').lower()
    
    minerals_keywords = [
        'gold', 'silver', 'platinum', 'palladium', 'copper',
        'metal', 'mineral', 'mining', 'miner', 'precious',
        'commodities', 'iron', 'lithium', 'uranium', 'aluminum'
    ]
    
    # Check symbol first
    if symbol in MINERALS_ETFS:
        return True
    
    # Check name and description
    text_to_check = name + ' ' + description
    return any(keyword in text_to_check for keyword in minerals_keywords)

def is_momentum_etf(profile_data, symbol):
    """Check if ETF is focused on momentum/growth"""
    if not profile_data:
        return False
    
    name = profile_data.get('name', '').lower()
    description = profile_data.get('description', '').lower()
    
    text_to_check = name + ' ' + description
    return any(keyword in text_to_check for keyword in MOMENTUM_KEYWORDS)

def is_valid_etf(profile_data, symbol):
    """Validate that the symbol is likely an ETF and not an individual stock"""
    if not profile_data:
        # If no profile data, use symbol-based validation for known ETFs
        known_etf_patterns = ['QQQ', 'SPY', 'IWM', 'EFA', 'VTI', 'VOO', 'GLD', 'SLV', 'XLF']
        return symbol in known_etf_patterns
    
    name = profile_data.get('name', '').lower()
    description = profile_data.get('description', '').lower()
    
    # Strong ETF indicators in name or description
    etf_keywords = [
        'etf', 'exchange traded fund', 'trust', 'fund', 'index',
        'vanguard', 'ishares', 'spdr', 'invesco', 'proshares', 
        'direxion', 'global x', 'first trust', 'ark', 'van eck'
    ]
    
    # Check if name/description contains ETF indicators
    text_to_check = name + ' ' + description
    has_etf_keywords = any(keyword in text_to_check for keyword in etf_keywords)
    
    # Clear stock indicators (strong negative signals)
    strong_stock_indicators = ['inc', 'corporation', 'corp', 'ltd', 'company']
    has_strong_stock_indicators = any(keyword in name for keyword in strong_stock_indicators)
    
    # Known individual stocks to exclude
    excluded_stocks = {
        'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'AMD', 
        'NFLX', 'DIS', 'BA', 'JPM', 'JNJ', 'WMT', 'PG', 'MA', 'V', 'HD',
        'UNH', 'PYPL', 'INTC', 'CSCO', 'PFE', 'KO', 'PEP', 'T', 'VZ',
        'ADBE', 'CRM', 'MRK', 'NFLX', 'COST', 'ABT', 'ACN', 'TMO', 'LIN'
    }
    
    if symbol in excluded_stocks:
        return False
    
    # If it has ETF indicators, it's likely an ETF
    if has_etf_keywords:
        return True
    
    # If it has strong stock indicators, it's likely a stock
    if has_strong_stock_indicators:
        return False
    
    # Default to True for borderline cases to avoid false negatives
    return True

def process_etf_symbol(symbol, etf_type="minerals"):
    """Worker function to process a single ETF symbol"""
    try:
        etf_data = get_etf_details(symbol)
        
        if etf_data and etf_data['quote'] and etf_data['quote']['c'] > 0:
            quote = etf_data['quote']
            profile = etf_data['profile']
            financials = etf_data['financials']
            
            # Skip ETF validation for curated lists to avoid API limitations
            # All symbols in our lists are confirmed ETFs
            
            momentum_score = calculate_momentum_score(quote, financials)
            
            # Get market cap safely
            market_cap = 0
            if financials and financials.get('metric'):
                market_cap = financials['metric'].get('marketCapitalization', 0)
            
            # Get volume from financials data
            volume = 0
            if financials and financials.get('metric'):
                metrics = financials['metric']
                volume = metrics.get('10DayAverageTradingVolume', 0) or \
                        metrics.get('3MonthAverageTradingVolume', 0) or 0
            
            return {
                'symbol': symbol,
                'name': profile.get('name', symbol) if profile else symbol,
                'price': quote['c'],
                'change': quote.get('d', 0),
                'change_pct': quote.get('dp', 0),
                'volume': volume,
                'momentum_score': momentum_score,
                'market_cap': market_cap,
                'description': profile.get('description', '')[:200] + '...' if profile and profile.get('description') else 'N/A'
            }
        else:
            return None
            
    except Exception as e:
        return None

def scan_minerals_etfs():
    """Scan for minerals/metals related ETFs using parallel processing"""
    console.print(Panel.fit('⛏️ MINERALS & METALS ETF SCANNER', style='bold yellow'))
    
    minerals_data = []
    
    console.print('[cyan]🔍 Scanning minerals ETFs with parallel workers...[/cyan]')
    
    # Use ThreadPoolExecutor for parallel processing
    max_workers = min(5, len(MINERALS_ETFS))  # Limit to 5 workers to respect API limits
    
    with Progress(
        TextColumn("[bold blue]🔄 Processing:"),
        BarColumn(),
        TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
        TextColumn("({task.completed}/{task.total})"),
        console=console
    ) as progress:
        
        task = progress.add_task("Scanning minerals ETFs...", total=len(MINERALS_ETFS))
        
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all tasks
            future_to_symbol = {
                executor.submit(process_etf_symbol, symbol, "minerals"): symbol 
                for symbol in MINERALS_ETFS
            }
            
            # Process completed tasks
            for future in as_completed(future_to_symbol):
                symbol = future_to_symbol[future]
                progress.advance(task)
                
                try:
                    result = future.result()
                    if result:
                        minerals_data.append(result)
                except Exception as e:
                    pass  # Silent error handling to avoid cluttering output
    
    if minerals_data:
        # Sort by momentum score
        minerals_data.sort(key=lambda x: x['momentum_score'], reverse=True)
        
        display_etf_results(minerals_data, 'MINERALS & METALS ETFs', 'yellow')
        export_to_csv(minerals_data, 'minerals_etfs')
    else:
        console.print('[yellow]⚠️ No minerals ETF data found[/yellow]')

def scan_momentum_etfs():
    """Scan for high momentum ETFs using parallel processing"""
    console.print(Panel.fit('🚀 HIGH MOMENTUM ETF SCANNER', style='bold green'))
    
    # Confirmed high momentum ETFs (curated list to avoid individual stocks)
    momentum_symbols = [
        # Core Momentum & Growth ETFs
        'MTUM',     # iShares MSCI USA Momentum Factor ETF
        'QQQ',      # Invesco QQQ Trust (Nasdaq 100)
        'VUG',      # Vanguard Growth ETF
        'IWF',      # iShares Russell 1000 Growth ETF
        'SPYG',     # SPDR Portfolio S&P 500 Growth ETF
        'IWD',      # iShares Russell 1000 Value ETF
        'VTV',      # Vanguard Value ETF
        
        # Technology ETFs
        'VGT',      # Vanguard Information Technology ETF
        'XLK',      # Technology Select Sector SPDR Fund
        'IYW',      # iShares U.S. Technology ETF
        'FTEC',     # Fidelity MSCI Information Technology Index ETF
        'SOXX',     # iShares Semiconductor ETF
        'SMH',      # VanEck Semiconductor ETF
        'IGV',      # iShares North American Tech-Software ETF
        
        # ARK Innovation ETFs
        'ARKK',     # ARK Innovation ETF
        'ARKG',     # ARK Genomic Revolution ETF
        'ARKW',     # ARK Next Generation Internet ETF
        'ARKF',     # ARK Fintech Innovation ETF
        'ARKQ',     # ARK Autonomous Technology & Robotics ETF
        
        # Thematic Technology ETFs
        'CLOU',     # Global X Cloud Computing ETF
        'SKYY',     # First Trust Cloud Computing ETF
        'HACK',     # First Trust NASDAQ Cybersecurity ETF
        'BOTZ',     # Global X Robotics & Artificial Intelligence ETF
        'ROBO',     # ROBO Global Robotics and Automation Index ETF
        'THNQ',     # ROBO Global Artificial Intelligence ETF
        'AIQ',      # Global X Artificial Intelligence & Technology ETF
        
        # Clean Energy ETFs
        'ICLN',     # iShares Global Clean Energy ETF
        'TAN',      # Invesco Solar ETF
        'PBW',      # Invesco WilderHill Clean Energy ETF
        
        # Biotechnology ETFs
        'IBB',      # iShares NASDAQ Biotechnology ETF
        'XBI',      # SPDR S&P Biotech ETF
        'FBT',      # First Trust NYSE Arca Biotechnology Index Fund
        
        # Consumer ETFs
        'IBUY',     # Amplify Online Retail ETF
        'XLY',      # Consumer Discretionary Select Sector SPDR Fund
        'VCR',      # Vanguard Consumer Discretionary ETF
        
        # Leveraged ETFs (3x Bull)
        'TECL',     # Direxion Daily Technology Bull 3X ETF
        'SOXL',     # Direxion Daily Semiconductor Bull 3X ETF
        'FAS',      # Direxion Daily Financial Bull 3X ETF
        'TQQQ',     # ProShares UltraPro QQQ
        'UPRO',     # ProShares UltraPro S&P500
        'LABU',     # Direxion Daily S&P Biotech Bull 3X Shares
        
        # Commodity & Energy ETFs
        'USO',      # United States Oil Fund
        'XLE',      # Energy Select Sector SPDR Fund
        'XOP',      # SPDR S&P Oil & Gas Exploration & Production ETF
        
        # Additional Popular ETFs
        'SPY',      # SPDR S&P 500 ETF Trust
        'IVV',      # iShares Core S&P 500 ETF
        'VOO',      # Vanguard S&P 500 ETF
        'VTI',      # Vanguard Total Stock Market ETF
        'IWM',      # iShares Russell 2000 ETF
        'EFA',      # iShares MSCI EAFE ETF
        'EEM',      # iShares MSCI Emerging Markets ETF
        'XLF',      # Financial Select Sector SPDR Fund
        'XLV',      # Health Care Select Sector SPDR Fund
        'XLI',      # Industrial Select Sector SPDR Fund
        'XLU',      # Utilities Select Sector SPDR Fund
        'XLRE',     # Real Estate Select Sector SPDR Fund
    ]
    
    momentum_data = []
    
    console.print('[cyan]🔍 Scanning momentum ETFs with parallel workers...[/cyan]')
    
    # Use ThreadPoolExecutor for parallel processing
    max_workers = min(5, len(momentum_symbols))  # Limit to 5 workers to respect API limits
    
    with Progress(
        TextColumn("[bold blue]🔄 Processing:"),
        BarColumn(),
        TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
        TextColumn("({task.completed}/{task.total})"),
        console=console
    ) as progress:
        
        task = progress.add_task("Scanning momentum ETFs...", total=len(momentum_symbols))
        
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all tasks
            future_to_symbol = {
                executor.submit(process_etf_symbol, symbol, "momentum"): symbol 
                for symbol in momentum_symbols
            }
            
            # Process completed tasks
            for future in as_completed(future_to_symbol):
                symbol = future_to_symbol[future]
                progress.advance(task)
                
                try:
                    result = future.result()
                    if result:
                        momentum_data.append(result)
                except Exception as e:
                    pass  # Silent error handling to avoid cluttering output
    
    if momentum_data:
        # Sort by momentum score and change percentage
        momentum_data.sort(key=lambda x: (x['momentum_score'], x['change_pct']), reverse=True)
        
        display_etf_results(momentum_data, 'HIGH MOMENTUM ETFs', 'green')
        export_to_csv(momentum_data, 'momentum_etfs')
    else:
        console.print('[yellow]⚠️ No momentum ETF data found[/yellow]')

def display_etf_results(etf_data, title, color):
    """Display ETF results in a formatted table"""
    console.print()
    console.print(Panel.fit(f'📊 {title.upper()}', style=f'bold {color}'))
    
    # Create main results table
    table = Table(title=f'🔥 TOP {title}', show_header=True, header_style='bold cyan', box=box.ROUNDED)
    table.add_column('Symbol', style='bold yellow', width=8)
    table.add_column('Name', style='white', width=25)
    table.add_column('Price $', style='bold white', width=10)
    table.add_column('Change $', style='green', width=10)
    table.add_column('Change %', style='bold green', width=10)
    table.add_column('Volume', style='blue', width=12)
    table.add_column('Momentum Score', style='bold red', width=14)
    table.add_column('Action', style='bold green', width=10)
    
    for etf in etf_data[:20]:  # Top 20
        symbol = etf['symbol']
        name = etf['name'][:24]
        price = etf['price']
        change = etf['change']
        change_pct = etf['change_pct']
        volume = etf['volume']
        momentum_score = etf['momentum_score']
        
        # Format volume (these are already in millions from financials)
        if volume >= 1000:
            volume_str = f'{volume/1000:.1f}B'  # Billions
        elif volume >= 1:
            volume_str = f'{volume:.1f}M'      # Millions
        else:
            volume_str = f'{volume*1000:.0f}K' # Thousands
        
        # Action based on momentum score
        if momentum_score >= 80:
            action = '[bold green]STRONG BUY[/bold green]'
            emoji = '🚀'
        elif momentum_score >= 60:
            action = '[bold yellow]BUY[/bold yellow]'
            emoji = '📈'
        elif momentum_score >= 40:
            action = '[cyan]WATCH[/cyan]'
            emoji = '👀'
        else:
            action = '[red]AVOID[/red]'
            emoji = '⚠️'
        
        # Color coding for change
        change_color = 'green' if change >= 0 else 'red'
        change_prefix = '+' if change >= 0 else ''
        
        # Momentum score color
        if momentum_score >= 80:
            score_color = 'bright_green'
        elif momentum_score >= 60:
            score_color = 'yellow'
        elif momentum_score >= 40:
            score_color = 'orange1'
        else:
            score_color = 'red'
        
        table.add_row(
            symbol,
            name,
            f'${price:.2f}',
            f'[{change_color}]{change_prefix}{change:.2f}[/{change_color}]',
            f'[{change_color}]{change_prefix}{change_pct:.2f}%[/{change_color}]',
            volume_str,
            f'{emoji} [{score_color}]{momentum_score:.0f}[/{score_color}]',
            action
        )
    
    console.print(table)
    
    # Top 5 recommendations
    top_5 = etf_data[:5]
    if top_5:
        console.print()
        console.print(Panel.fit(
            f'🏆 [bold]TOP 5 RECOMMENDATIONS:[/bold]\n' +
            '\n'.join([
                f'• {etf["symbol"]} ({etf["name"][:30]}): ${etf["price"]:.2f} ({etf["change_pct"]:+.1f}%) - Score: {etf["momentum_score"]:.0f}'
                for etf in top_5
            ]),
            style=color
        ))
    
    # Summary statistics
    avg_score = sum(etf['momentum_score'] for etf in etf_data) / len(etf_data)
    positive_changes = len([etf for etf in etf_data if etf['change_pct'] > 0])
    high_score = len([etf for etf in etf_data if etf['momentum_score'] >= 60])
    
    console.print()
    console.print(Panel.fit(
        f'[bold]📈 ANALYSIS SUMMARY:[/bold]\n'
        f'• Total ETFs Analyzed: [cyan]{len(etf_data)}[/cyan]\n'
        f'• Average Momentum Score: [yellow]{avg_score:.1f}[/yellow]\n'
        f'• Positive Performance: [green]{positive_changes}/{len(etf_data)}[/green] ({positive_changes/len(etf_data)*100:.1f}%)\n'
        f'• High Momentum (60+): [bold green]{high_score}[/bold green] ETFs',
        style='blue'
    ))
    
    # Trading strategy
    console.print()
    console.print(Panel.fit(
        f'💡 [bold green]TRADING STRATEGY FOR {title.upper()}:[/bold green]\n'
        '🎯 HIGH MOMENTUM (80+): Consider immediate entry with tight stops\n'
        '📈 BUY ZONE (60-79): Strong candidates for swing trading\n'
        '👀 WATCH LIST (40-59): Monitor for pullback entries\n'
        '⚠️ AVOID (under 40): Stay away until momentum improves\n'
        '\n[bold red]RISK MANAGEMENT:[/bold red]\n'
        '• Use stop-loss 3-5% below entry\n'
        '• Position size: 1-2% per trade\n'
        '• Take partial profits at 10-15% gains\n'
        '• Watch for market correlation risk',
        style='green'
    ))

def export_to_csv(etf_data, filename_prefix):
    """Export ETF data to CSV"""
    if not etf_data:
        return
    
    df = pd.DataFrame(etf_data)
    filename = f'{filename_prefix}_scan_{datetime.now().strftime("%Y%m%d_%H%M")}.csv'
    
    # Select columns for export
    export_columns = [
        'symbol', 'name', 'price', 'change', 'change_pct',
        'volume', 'momentum_score', 'market_cap', 'description'
    ]
    
    df[export_columns].to_csv(filename, index=False)
    console.print(f'[dim]💾 Data saved to: {filename}[/dim]')

def main():
    parser = argparse.ArgumentParser(description='Finnhub ETF Scanner for Minerals & Momentum ETFs')
    parser.add_argument('--type', choices=['minerals', 'momentum', 'all'], default='all',
                        help='Type of ETFs to scan: minerals, momentum, or all')
    parser.add_argument('--export-only', action='store_true',
                        help='Only export to CSV without display')
    
    args = parser.parse_args()
    
    console.print(Panel.fit('🏦 FINNHUB ETF SCANNER', style='bold blue'))
    console.print(Panel.fit('⛏️ Minerals & Metals | 🚀 High Momentum ETFs', style='cyan'))
    
    try:
        if args.type in ['minerals', 'all']:
            scan_minerals_etfs()
            if args.type != 'all':
                console.print()
        
        if args.type in ['momentum', 'all']:
            scan_momentum_etfs()
        
        # Final summary
        console.print()
        console.print(Panel.fit(
            '✅ [bold green]SCAN COMPLETE![/bold green]\n'
            '📊 Check CSV files for detailed data\n'
            '🔄 Run again for latest market data\n'
            '⚠️ Remember: ETF trading carries market risk',
            style='green'
        ))
        
    except Exception as e:
        console.print(f'[red]❌ Scan failed: {str(e)}[/red]')

if __name__ == '__main__':
    main()