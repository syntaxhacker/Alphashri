"""
Momentum Strategy Module
========================

This module contains various momentum-based trading strategies.
"""

from rich.panel import Panel
from rich.console import Console
from tradingview_screener import Query, col

console = Console()

def heavy_breakout(self):
    """Heavy breakout strategy using channel analysis"""
    console.print(Panel.fit("📊 HEAVY BREAKOUT: Smart Money Consolidation Channel Breakouts", style="bold bright_magenta"))
    try:
        # Get stocks with strong channel patterns and volume accumulation
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'market_cap_basic', 'update_mode', 'BB.upper', 'BB.lower', 'EMA20', 'EMA50'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,  # Minimum price
                col('volume') > 500000,  # High volume
                col('market_cap_basic') > 1000000000,  # 100 Cr minimum market cap
                col('relative_volume_10d_calc') > 1.5,  # Volume accumulation
                col('change').between(-3, 5),  # Controlled movement
                col('RSI').between(45, 70),  # Healthy momentum
                col('exchange') == 'NSE'
            )
            .order_by('relative_volume_10d_calc', ascending=False)
            .limit(25)
            .get_scanner_data(cookies=self.cookies)
        )
        
        if not df.empty:
            # Add channel analysis
            df = self._add_channel_analysis(df)
            
            # Add breakout score
            df['breakout_score'] = self._calculate_breakout_score(df)
            
            # Sort by breakout score
            df = df.sort_values('breakout_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "📊 HEAVY BREAKOUT Candidates")
            else:
                console.print("[green]Found heavy breakout candidates:[/green]")
                console.print(df[['name', 'close', 'change', 'volume', 'relative_volume_10d_calc', 'breakout_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching heavy breakout criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in heavy breakout analysis: {e}[/red]")

def _add_channel_analysis(self, df):
    """Add channel analysis to detect consolidation patterns"""
    # Implementation would analyze Bollinger Bands, moving averages, and price action
    # to identify stocks in consolidation channels before breakout
    return df

def _calculate_breakout_score(self, df):
    """Calculate breakout probability score"""
    scores = []
    for _, row in df.iterrows():
        score = 0
        
        # Volume factor
        vol_ratio = row.get('relative_volume_10d_calc', 1)
        if vol_ratio >= 3:
            score += 30
        elif vol_ratio >= 2:
            score += 20
        elif vol_ratio >= 1.5:
            score += 10
        
        # Price action factor
        change = row.get('change', 0)
        if abs(change) >= 3:
            score += 20
        elif abs(change) >= 1:
            score += 10
        
        # RSI factor
        rsi = row.get('RSI', 50)
        if 50 <= rsi <= 70:
            score += 15
        elif 45 <= rsi <= 75:
            score += 10
        
        # Channel factor (using BB width as proxy for consolidation)
        bb_upper = row.get('BB.upper', row['close'])
        bb_lower = row.get('BB.lower', row['close'])
        bb_width = (bb_upper - bb_lower) / row['close'] * 100
        if bb_width <= 5:  # Tight consolidation
            score += 25
        elif bb_width <= 10:  # Moderate consolidation
            score += 15
        elif bb_width <= 15:  # Loose consolidation
            score += 5
        
        scores.append(min(score, 100))  # Cap at 100
    
    return scores