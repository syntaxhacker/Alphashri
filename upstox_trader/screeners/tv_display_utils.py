#!/usr/bin/env python3
"""
Display & UI Functions
Extracted from TVScreenerUsage class
"""

import pandas as pd
from datetime import datetime, timedelta
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.columns import Columns
import re

console = Console()


# ANSI Color codes for terminal
class Colors:
    RED = '\033[91m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    MAGENTA = '\033[95m'
    CYAN = '\033[96m'
    WHITE = '\033[97m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'
    RESET = '\033[0m'
    BG_RED = '\033[101m'
    BG_GREEN = '\033[102m'
    BG_YELLOW = '\033[103m'


def strip_ansi_codes(text):
    """Removes ANSI color codes from a string."""
    return re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', text)

class DisplayUtils:
    """Display and formatting utilities for tables and UI"""
    
    def __init__(self, parent_instance):
        self.parent = parent_instance
    
    def display_table(self, df, title, max_rows=15):
        """Display pandas DataFrame as Rich table"""
        if df.empty:
            console.print(f"📊 {title}: No data available", style="yellow")
            return
        
        # Limit rows
        display_df = df.head(max_rows)
        
        table = Table(title=title)
        
        # Add columns
        for column in display_df.columns:
            table.add_column(column, overflow="fold")
        
        # Add rows
        for _, row in display_df.iterrows():
            table.add_row(*[str(value) for value in row])
        
        console.print(table)
    
    def _display_gap_fill_results(self, gap_df):
        """Display gap fill analysis results"""
        if gap_df.empty:
            console.print("📊 No gap opportunities found", style="yellow")
            return
        
        self.display_table(gap_df, "🎯 Gap Fill Opportunities", max_rows=20)
    
    def _display_gap_fill_trading_status(self):
        """Display current gap fill trading status"""
        if not hasattr(self.parent, 'paper_trading_bot') or not self.parent.paper_trading_bot:
            console.print("📊 Paper trading not available", style="yellow")
            return
        
        # Get positions
        positions = self.parent.paper_trading_bot.get_positions()
        gap_positions = {k: v for k, v in positions.items() if 'GAP' in v.get('alert_type', '')}
        
        if not gap_positions:
            console.print("📊 No active gap positions", style="dim")
            return
        
        table = Table(title="🎯 Gap Fill Trading Status")
        table.add_column("Symbol", style="cyan")
        table.add_column("Side", justify="center")
        table.add_column("Entry", justify="right")
        table.add_column("Current", justify="right")
        table.add_column("P&L", justify="right")
        table.add_column("Gap Type", justify="center")
        table.add_column("Duration", justify="center")
        
        for symbol, position in gap_positions.items():
            current_price = self.parent.live_data._get_live_price_from_upstox(symbol)
            if not current_price:
                continue
            
            # Calculate P&L
            entry_price = position['entry_price']
            if position['side'] == 'BUY':
                pnl_pct = ((current_price - entry_price) / entry_price) * 100
            else:
                pnl_pct = ((entry_price - current_price) / entry_price) * 100
            
            # Duration
            entry_time = datetime.fromisoformat(position['timestamp'].replace('Z', '+00:00'))
            duration = datetime.now() - entry_time.replace(tzinfo=None)
            duration_str = f"{int(duration.total_seconds() // 3600)}h {int((duration.total_seconds() % 3600) // 60)}m"
            
            # Colors
            pnl_color = "green" if pnl_pct > 0 else "red"
            side_color = "green" if position['side'] == 'BUY' else "red"
            
            table.add_row(
                symbol.replace('NSE:', ''),
                f"[{side_color}]{position['side']}[/]",
                f"₹{entry_price:.1f}",
                f"₹{current_price:.1f}",
                f"[{pnl_color}]{pnl_pct:+.1f}%[/]",
                position.get('alert_type', 'GAP'),
                duration_str
            )
        
        console.print(table)
    
    def _display_sector_table(self, sector_df, title):
        """Display sector-wise analysis table"""
        if sector_df.empty:
            console.print(f"📊 {title}: No sector data available", style="yellow")
            return
        
        table = Table(title=title)
        table.add_column("Sector", style="cyan")
        table.add_column("Stocks", justify="right")
        table.add_column("Avg Change %", justify="right")
        table.add_column("Strong Stocks", justify="right")
        table.add_column("Performance", justify="center")
        
        for _, row in sector_df.head(15).iterrows():
            avg_change = row.get('avg_change', 0)
            performance = "🔥" if avg_change > 2 else "📈" if avg_change > 0 else "📉" if avg_change > -2 else "❄️"
            change_color = "green" if avg_change > 0 else "red"
            
            table.add_row(
                str(row.get('sector', 'Unknown')),
                str(row.get('stock_count', 0)),
                f"[{change_color}]{avg_change:+.1f}%[/]",
                str(row.get('strong_stocks', 0)),
                performance
            )
        
        console.print(table)
    
    def _display_alerts(self, alerts):
        """Display trading alerts in a formatted table"""
        if not alerts:
            console.print("📊 No alerts generated", style="dim")
            return
        
        # Group alerts by type for better organization
        alert_groups = {}
        for alert in alerts:
            alert_type = alert.get('type', 'UNKNOWN')
            if alert_type not in alert_groups:
                alert_groups[alert_type] = []
            alert_groups[alert_type].append(alert)
        
        for alert_type, type_alerts in alert_groups.items():
            table = Table(title=f"🚨 {alert_type} Alerts")
            table.add_column("Symbol", style="cyan")
            table.add_column("Price", justify="right")
            table.add_column("Change %", justify="right")
            table.add_column("Volume", justify="right")
            table.add_column("Signal", justify="center")
            table.add_column("Confidence", justify="center")
            table.add_column("Action", justify="center")
            
            for alert in type_alerts[:10]:  # Limit to 10 per type
                symbol = alert.get('symbol', 'N/A')
                price = alert.get('price', 0)
                change = alert.get('change_pct', 0)
                volume_ratio = alert.get('volume_ratio', 1)
                confidence = alert.get('confidence', 0)
                action = alert.get('action', 'WATCH')
                
                # Color coding
                change_color = "green" if change > 0 else "red"
                confidence_color = "green" if confidence > 70 else "yellow" if confidence > 50 else "red"
                
                # Signal indicator
                signal = "🔥" if confidence > 80 else "⚡" if confidence > 60 else "📊"
                
                table.add_row(
                    symbol.replace('NSE:', ''),
                    f"₹{price:.1f}",
                    f"[{change_color}]{change:+.1f}%[/]",
                    f"{volume_ratio:.1f}x",
                    signal,
                    f"[{confidence_color}]{confidence:.0f}%[/]",
                    action
                )
            
            console.print(table)
    
    def format_price(self, price: float) -> str:
        """Format price for display"""
        if price >= 1000:
            return f"₹{price:,.0f}"
        elif price >= 100:
            return f"₹{price:.0f}"
        else:
            return f"₹{price:.1f}"
    
    def _add_momentum_score_analysis(self, df):
        """Add momentum score analysis columns to DataFrame"""
        if df.empty:
            return df
        
        df = df.copy()
        
        # Add momentum signals
        df['momentum_score'] = 0
        df['momentum_signal'] = 'NEUTRAL'
        
        for idx, row in df.iterrows():
            score = 0
            signals = []
            
            # Volume momentum
            volume_ratio = row.get('relative_volume_10d_calc', 1)
            if volume_ratio > 2:
                score += 3
                signals.append('HIGH_VOL')
            elif volume_ratio > 1.5:
                score += 2
                signals.append('MED_VOL')
            
            # Price momentum
            change = row.get('change', 0)
            if abs(change) > 3:
                score += 2
                signals.append('BIG_MOVE')
            elif abs(change) > 1.5:
                score += 1
                signals.append('MOVE')
            
            # Technical momentum
            rsi = row.get('RSI', 50)
            if change > 0 and 50 < rsi < 70:
                score += 2
                signals.append('BULL_RSI')
            elif change < 0 and 30 < rsi < 50:
                score += 1
                signals.append('BEAR_RSI')
            
            # Market cap filter (liquidity)
            market_cap = row.get('market_cap_basic', 0)
            if market_cap > 1000000000:  # > 1000 Cr
                score += 1
                signals.append('LIQUID')
            
            df.loc[idx, 'momentum_score'] = score
            
            # Determine signal
            if score >= 6:
                df.loc[idx, 'momentum_signal'] = 'STRONG_BUY'
            elif score >= 4:
                df.loc[idx, 'momentum_signal'] = 'BUY'
            elif score >= 3:
                df.loc[idx, 'momentum_signal'] = 'WEAK_BUY'
            elif score <= -3:
                df.loc[idx, 'momentum_signal'] = 'SELL'
            
            df.loc[idx, 'signals'] = ','.join(signals)
        
        return df.sort_values('momentum_score', ascending=False)
    
    def _calculate_momentum_signal(self, history, min_threshold):
        """Calculate momentum signal based on historical data"""
        if not history or len(history) < 2:
            return {'signal': 'INSUFFICIENT_DATA', 'strength': 0}
        
        try:
            df = pd.DataFrame(history)
            df.columns = ['timestamp', 'open', 'high', 'low', 'close', 'volume']
            df = df.sort_values('timestamp')
            
            # Calculate momentum indicators
            df['price_change'] = df['close'].pct_change() * 100
            df['volume_ma'] = df['volume'].rolling(window=5).mean()
            df['volume_ratio'] = df['volume'] / df['volume_ma']
            
            recent_data = df.tail(3)
            
            # Momentum criteria
            avg_price_change = recent_data['price_change'].mean()
            avg_volume_ratio = recent_data['volume_ratio'].mean()
            
            momentum_score = 0
            
            # Price momentum
            if avg_price_change > min_threshold:
                momentum_score += 2
            elif avg_price_change > min_threshold / 2:
                momentum_score += 1
            
            # Volume confirmation
            if avg_volume_ratio > 1.3:
                momentum_score += 2
            elif avg_volume_ratio > 1.1:
                momentum_score += 1
            
            # Consistency check
            consistent_direction = all(change > 0 for change in recent_data['price_change'].dropna()) or \
                                 all(change < 0 for change in recent_data['price_change'].dropna())
            if consistent_direction:
                momentum_score += 1
            
            # Determine signal
            if momentum_score >= 4:
                signal = 'STRONG'
            elif momentum_score >= 3:
                signal = 'MODERATE'
            elif momentum_score >= 2:
                signal = 'WEAK'
            else:
                signal = 'NONE'
            
            return {
                'signal': signal,
                'strength': momentum_score,
                'price_momentum': avg_price_change,
                'volume_confirmation': avg_volume_ratio,
                'consistent': consistent_direction
            }
            
        except Exception as e:
            console.print(f"⚠️ Error calculating momentum signal: {e}", style="yellow")
            return {'signal': 'ERROR', 'strength': 0}
    
    def _display_watch_data(self, df, alerts=[]):
        """Display watch data with alerts integration"""
        if df.empty:
            console.print("📊 No watch data available", style="yellow")
            return
        
        # Add momentum analysis
        df_with_momentum = self._add_momentum_score_analysis(df)
        
        table = Table(title="👀 Market Watch")
        table.add_column("Symbol", style="cyan")
        table.add_column("Price", justify="right")
        table.add_column("Change %", justify="right")
        table.add_column("Volume", justify="right")
        table.add_column("RSI", justify="right")
        table.add_column("Momentum", justify="center")
        table.add_column("Alerts", justify="center")
        
        # Create alert lookup
        alert_symbols = {alert.get('symbol', ''): alert.get('type', '') for alert in alerts}
        
        for _, row in df_with_momentum.head(20).iterrows():
            symbol = row.get('name', 'N/A')
            price = row.get('close', 0)
            change = row.get('change', 0)
            volume_ratio = row.get('relative_volume_10d_calc', 1)
            rsi = row.get('RSI', 50)
            momentum_signal = row.get('momentum_signal', 'NEUTRAL')
            
            # Colors
            change_color = "green" if change > 0 else "red"
            momentum_color = "green" if "BUY" in momentum_signal else "red" if "SELL" in momentum_signal else "yellow"
            
            # Alert indicator
            alert_indicator = "🚨" if symbol in alert_symbols else ""
            
            table.add_row(
                symbol.replace('NSE:', ''),
                self.format_price(price),
                f"[{change_color}]{change:+.1f}%[/]",
                f"{volume_ratio:.1f}x",
                f"{rsi:.0f}",
                f"[{momentum_color}]{momentum_signal}[/]",
                alert_indicator
            )
        
        console.print(table)
        
        # Display summary statistics
        total_stocks = len(df_with_momentum)
        strong_signals = len(df_with_momentum[df_with_momentum['momentum_signal'].isin(['STRONG_BUY', 'BUY'])])
        active_alerts = len(alerts)
        
        summary = f"📊 {total_stocks} stocks • {strong_signals} strong signals • {active_alerts} alerts"
        console.print(Panel(summary, style="dim"))