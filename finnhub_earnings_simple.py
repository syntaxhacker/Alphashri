#!/usr/bin/env python3
import finnhub
from rich.console import Console
from rich.table import Table
import pandas as pd
from datetime import datetime, timedelta
import os
try:
    from zoneinfo import ZoneInfo
except ImportError:
    import pytz

# Initialize the client with your Finnhub API key
finnhub_client = finnhub.Client(api_key="d3mkpb1r01qmso349jk0d3mkpb1r01qmso349jkg")
console = Console()

def format_date_readable(date_str: str) -> str:
    """Convert YYYY-MM-DD to readable format"""
    try:
        date_obj = datetime.strptime(date_str, '%Y-%m-%d')
        return date_obj.strftime('%b %d, %Y')
    except (ValueError, TypeError):
        return date_str

def get_relative_date_text(target_date: str) -> str:
    """Convert days until date to human text"""
    try:
        target_dt = datetime.strptime(target_date, '%Y-%m-%d')
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        target_day = target_dt.replace(hour=0, minute=0, second=0, microsecond=0)
        days_diff = (target_day - today).days

        if days_diff == 0:
            return "Today"
        elif days_diff == 1:
            return "Tomorrow"
        elif days_diff == -1:
            return "Yesterday"
        elif days_diff > 1 and days_diff <= 7:
            return f"In {days_diff} days"
        elif days_diff < -1 and days_diff >= -7:
            return f"{abs(days_diff)} days ago"
        else:
            return format_date_readable(target_date)
    except (ValueError, TypeError):
        return target_date

def format_market_time(time_str: str) -> str:
    """Format trading hours with market context"""
    if not time_str or time_str.upper() in ['TBD', 'N/A', 'NA', 'NULL', '']:
        return '⏰ Time TBD'
    
    time_upper = str(time_str).upper()
    if time_upper in ['BMO', 'PRE']:
        return '🌅 Pre-Market'
    elif time_upper in ['AMC', 'AFTER']:
        return '🌙 After-Hours'
    elif time_upper == 'TAS':
        return '⏰ Time Not Specified'
    else:
        return f'🕒 {time_upper} ET'

def get_dynamic_date_range(days_ahead: int = 10) -> tuple:
    """Generate date ranges dynamically"""
    from_date = datetime.now()
    to_date = from_date + timedelta(days=days_ahead)
    return (from_date.strftime('%Y-%m-%d'), to_date.strftime('%Y-%m-%d'))

def get_historical_earnings_reaction(symbol, earnings_date):
    """Get stock's reaction on earnings day"""
    try:
        import time
        
        # Convert earnings date to datetime
        earnings_dt = datetime.strptime(earnings_date, '%Y-%m-%d')
        prev_day = earnings_dt - timedelta(days=1)
        
        # Get UNIX timestamps using mktime
        prev_start_ts = int(time.mktime(prev_day.timetuple()))
        earnings_end_ts = int(time.mktime((earnings_dt + timedelta(days=1)).timetuple()))
        
        # Get candle data for the period
        candles = finnhub_client.stock_candles(symbol, 'D', prev_start_ts, earnings_end_ts)
        
        if candles and candles['s'] == 'ok' and len(candles['c']) >= 2:
            # Get the two most recent closes
            prev_close = candles['c'][0]  # Previous day close
            curr_close = candles['c'][1]  # Earnings day close
            curr_open = candles['o'][1]   # Earnings day open
            curr_volume = candles['v'][1]  # Earnings day volume
            
            # Calculate metrics
            day_change = ((curr_close - prev_close) / prev_close) * 100
            
            # Get average volume
            avg_volume = sum(candles['v']) / len(candles['v'])
            volume_ratio = curr_volume / avg_volume if avg_volume > 0 else 1
            
            return {
                'day_change': day_change,
                'volume_ratio': volume_ratio,
                'close': curr_close,
                'volume': curr_volume
            }
        else:
            return None
    except Exception:
        return None

def display_upcoming_earnings_calendar(days_ahead=10):
    """Display upcoming earnings calendar for popular stocks"""
    # Popular stocks to monitor
    symbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA', 'META', 'TSM', 'AMD', 'NFLX', 
               'BABA', 'UBER', 'DIS', 'INTC', 'PYPL', 'ADBE', 'CRM', 'EBAY', 'SQ', 'SNAP', 
               'ZM', 'ROKU', 'SHOP', 'BA', 'CAT', 'JPM', 'WMT', 'HD', 'KO', 'PEP']
    
    console.print(f'📅 [bold cyan]UPCOMING EARNINGS CALENDAR (Next {days_ahead} Days)[/bold cyan]')
    console.print()
    
    from_date, to_date = get_dynamic_date_range(days_ahead)
    all_upcoming = []
    
    for symbol in symbols:
        try:
            calendar = finnhub_client.earnings_calendar(_from=from_date, to=to_date, symbol=symbol, international=False)
            
            if calendar.get('earningsCalendar'):
                for event in calendar['earningsCalendar']:
                    days_until = (datetime.strptime(event['date'], '%Y-%m-%d') - datetime.now()).days
                    
                    if 0 <= days_until <= days_ahead:
                        all_upcoming.append({
                            'symbol': symbol,
                            'date': event['date'],
                            'time': event['hour'].upper() if event['hour'] else 'TBD',
                            'quarter': f"Q{event['quarter']} {event['year']}",
                            'eps_estimate': f"${event['epsEstimate']:.2f}" if event['epsEstimate'] else 'N/A',
                            'revenue_estimate': f"${event['revenueEstimate']/1000000000:.1f}B" if event['revenueEstimate'] else 'N/A',
                            'days_until': days_until
                        })
        except Exception as e:
            continue  # Skip symbols that fail
    
    if all_upcoming:
        # Remove duplicates (same symbol and date)
        unique_upcoming = []
        seen = set()
        for event in all_upcoming:
            key = (event['symbol'], event['date'])
            if key not in seen:
                seen.add(key)
                unique_upcoming.append(event)
        
        # Sort by days until earnings
        unique_upcoming.sort(key=lambda x: x['days_until'])
        
        # Create upcoming earnings table
        upcoming_table = Table(title=f'🔔 EARNINGS SCHEDULE', show_header=True, header_style='bold cyan', box=None)
        upcoming_table.add_column('Days Until', style='magenta', width=10)
        upcoming_table.add_column('Date', style='cyan', width=12)
        upcoming_table.add_column('Symbol', style='bold yellow', width=8)
        upcoming_table.add_column('Time', style='white', width=8)
        upcoming_table.add_column('Quarter', style='green', width=10)
        upcoming_table.add_column('EPS Est.', style='green', width=10)
        upcoming_table.add_column('Revenue Est.', style='orange1', width=12)
        upcoming_table.add_column('Priority', style='bold', width=12)
        
        for event in unique_upcoming:
            days_until = event['days_until']
            
            # Priority based on days until
            if days_until <= 1:
                priority = '[bold red]🔥 CRITICAL[/bold red]'
            elif days_until <= 3:
                priority = '[bold orange1]⚠️ URGENT[/bold orange1]'
            elif days_until <= 7:
                priority = '[bold yellow]👀 SOON[/bold yellow]'
            else:
                priority = '[green]📅 PLAN[/green]'
            
            # Enhanced time formatting
            formatted_time = format_market_time(event['time'])
            formatted_date = format_date_readable(event['date'])
            
            upcoming_table.add_row(
                get_relative_date_text(event['date']),
                formatted_date,
                event['symbol'],
                formatted_time,
                event['quarter'],
                event['eps_estimate'],
                event['revenue_estimate'],
                priority
            )
        
        console.print(upcoming_table)
        
        # Summary
        this_week = len([e for e in unique_upcoming if e['days_until'] <= 7])
        today = len([e for e in unique_upcoming if e['days_until'] == 0])
        tomorrow = len([e for e in unique_upcoming if e['days_until'] == 1])
        
        console.print()
        console.print(f'📊 [bold]EARNINGS SUMMARY:[/bold]')
        console.print(f'• Today: [red]{today}[/red] stocks reporting')
        console.print(f'• Tomorrow: [orange1]{tomorrow}[/orange1] stocks reporting')
        console.print(f'• This Week: [yellow]{this_week}[/yellow] stocks reporting')
        console.print(f'• Total in {days_ahead} days: [cyan]{len(unique_upcoming)}[/cyan] stocks')
        
    else:
        console.print('[yellow]⚠️ No upcoming earnings found in the next 10 days[/yellow]')

def display_earnings_analysis(symbol):
    """Display only previous and upcoming earnings tables"""
    try:
        # Get company earnings history (last 5 quarters)
        earnings = finnhub_client.company_earnings(symbol, limit=5)
        
        if earnings:
            # Create previous earnings table
            table = Table(title=f'📈 {symbol.upper()} PREVIOUS EARNINGS (Last 5 Quarters)', show_header=True, header_style='bold cyan', box=None)
            table.add_column('Period', style='cyan', width=12)
            table.add_column('Quarter', style='white', width=8)
            table.add_column('Actual', style='bold green', width=10)
            table.add_column('Estimate', style='yellow', width=10)
            table.add_column('Surprise', style='magenta', width=12)
            table.add_column('Surprise %', style='bold red', width=10)
            table.add_column('Day Change', style='bold', width=12)
            table.add_column('Result', style='bold', width=8)
            
            for earning in earnings:
                actual = earning['actual']
                estimate = earning['estimate']
                surprise = earning['surprise']
                surprise_pct = earning['surprisePercent']
                period = earning['period']
                quarter = f"Q{earning['quarter']} {earning['year']}"
                
                # Get historical earnings reaction for this period
                reaction = get_historical_earnings_reaction(symbol, period)
                
                # Determine performance
                if surprise > 0:
                    result = '[bold green]✓ BEAT[/bold green]'
                    surprise_color = 'green'
                elif surprise < 0:
                    result = '[bold red]✗ MISS[/bold red]'
                    surprise_color = 'red'
                else:
                    result = '[yellow]= MEET[/yellow]'
                    surprise_color = 'yellow'
                
                # Format day change
                if reaction:
                    day_change = reaction['day_change']
                    volume_ratio = reaction['volume_ratio']
                    
                    # Color code based on performance
                    if day_change > 5:
                        change_color = 'bright_green'
                        change_emoji = '🚀'
                    elif day_change > 2:
                        change_color = 'green'
                        change_emoji = '📈'
                    elif day_change > 0:
                        change_color = 'yellow'
                        change_emoji = '↑'
                    elif day_change > -2:
                        change_color = 'red'
                        change_emoji = '↓'
                    else:
                        change_color = 'bold red'
                        change_emoji = '📉'
                    
                    # Add volume indicator
                    if volume_ratio > 3:
                        volume_emoji = '🔥'
                    elif volume_ratio > 2:
                        volume_emoji = '⚡'
                    else:
                        volume_emoji = ''
                    
                    day_change_text = f'[{change_color}]{change_emoji}{day_change:+.1f}%{volume_emoji}[/{change_color}]'
                else:
                    day_change_text = '[dim]🔒 Premium[/dim]'
                
                table.add_row(
                    format_date_readable(period),
                    quarter,
                    f'${actual:.2f}',
                    f'${estimate:.2f}',
                    f'[{surprise_color}]{surprise:+.2f}[/{surprise_color}]',
                    f'[{surprise_color}]{surprise_pct:+.2f}%[/{surprise_color}]',
                    day_change_text,
                    result
                )
            
            console.print(table)
            
        else:
            console.print(f'[yellow]⚠️ No previous earnings data available for {symbol.upper()}[/yellow]')
        
        # Get upcoming earnings calendar for this specific stock
        console.print()
        from_date, to_date = get_dynamic_date_range(10)
        calendar = finnhub_client.earnings_calendar(_from=from_date, to=to_date, symbol=symbol, international=False)
        
        if calendar.get('earningsCalendar'):
            earnings_table = Table(title=f'🔔 {symbol.upper()} UPCOMING EARNINGS', show_header=True, header_style='bold cyan', box=None)
            earnings_table.add_column('Date', style='cyan', width=12)
            earnings_table.add_column('Time', style='white', width=8)
            earnings_table.add_column('Quarter', style='yellow', width=10)
            earnings_table.add_column('EPS Estimate', style='green', width=12)
            earnings_table.add_column('Revenue Estimate', style='blue', width=15)
            earnings_table.add_column('Days Until', style='magenta', width=10)
            earnings_table.add_column('Status', style='bold', width=12)
            
            for event in calendar['earningsCalendar']:
                date = event['date']
                time = event['hour'].upper() if event['hour'] else 'TBD'
                quarter = f"Q{event['quarter']} {event['year']}"
                eps_est = f"${event['epsEstimate']:.2f}" if event['epsEstimate'] else 'N/A'
                revenue_est = f"${event['revenueEstimate']/1000000000:.1f}B" if event['revenueEstimate'] else 'N/A'
                
                days_until = (datetime.strptime(date, '%Y-%m-%d') - datetime.now()).days
                if days_until < 0:
                    status = '[dim]📅 PAST[/dim]'
                elif days_until <= 1:
                    status = '[bold red]🔥 TOMORROW[/bold red]'
                elif days_until <= 3:
                    status = '[bold orange1]⚠️ THIS WEEK[/bold orange1]'
                elif days_until <= 7:
                    status = '[bold yellow]👀 NEXT WEEK[/bold yellow]'
                elif days_until <= 30:
                    status = '[green]📅 THIS MONTH[/green]'
                else:
                    status = '[cyan]📆 UPCOMING[/cyan]'
                
                # Enhanced time formatting
                formatted_time = format_market_time(time)
                formatted_date = format_date_readable(date)

                earnings_table.add_row(
                    formatted_date,
                    formatted_time,
                    quarter,
                    eps_est,
                    revenue_est,
                    get_relative_date_text(date),
                    status
                )
            
            console.print(earnings_table)
            
        else:
            console.print('[yellow]⚠️ No upcoming earnings data available[/yellow]')
        
    except Exception as e:
        console.print(f'[red]❌ Error fetching data: {str(e)}[/red]')

if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1:
        if sys.argv[1].lower() == 'calendar':
            # Show upcoming earnings calendar for next 10 days
            display_upcoming_earnings_calendar(10)
        else:
            symbol = sys.argv[1].upper()
            display_earnings_analysis(symbol)
    else:
        # Default: show upcoming earnings calendar for next 10 days
        display_upcoming_earnings_calendar(10)