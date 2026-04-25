from typing import Optional, List, Dict, Tuple
from rich.console import Console
import pandas as pd
import numpy as np

console = Console()


def _add_intraday_momentum_analysis(self, df: pd.DataFrame) -> pd.DataFrame:
    """Add real-time intraday momentum analysis with 1-min delta detection"""
    import concurrent.futures
    from datetime import datetime, timedelta
    from threading import Lock
    
    console.print(f"[dim cyan]🔍 Starting intraday momentum analysis for {len(df)} stocks...[/dim cyan]")
    
    momentum_results = {}
    results_lock = Lock()
    
    def analyze_intraday_momentum(row):
        """Analyze intraday momentum with price/volume deltas"""
        symbol = row['name']
        try:
            if hasattr(self, 'upstox_data_fetcher') and self.upstox_data_fetcher:
                df_1min = self.upstox_data_fetcher.fetch_data(
                    symbol=symbol, 
                    days=1, 
                    timeframe='1min'
                )
                
                if df_1min is not None and len(df_1min) >= 10:
                    momentum_analysis = _calculate_intraday_momentum_metrics(self, df_1min, row)
                    
                    with results_lock:
                        momentum_results[symbol] = momentum_analysis
                else:
                    with results_lock:
                        momentum_results[symbol] = _calculate_basic_momentum_metrics(self, row)
            else:
                with results_lock:
                    momentum_results[symbol] = _calculate_basic_momentum_metrics(self, row)
                
        except Exception as e:
            console.print(f"[dim red]Error analyzing momentum for {symbol}: {str(e)[:50]}[/dim red]")
            with results_lock:
                momentum_results[symbol] = {
                    'momentum_score': 0,
                    'price_delta_1min': 0,
                    'volume_delta_1min': 0,
                    'momentum_direction': 'NEUTRAL',
                    'entry_signal': False,
                    'momentum_strength': 'WEAK'
                }
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = []
        for _, row in df.iterrows():
            future = executor.submit(analyze_intraday_momentum, row)
            futures.append(future)
        
        completed = 0
        for future in concurrent.futures.as_completed(futures):
            completed += 1
            if completed % 3 == 0:
                console.print(f"[dim]Momentum analysis: {completed}/{len(df)} stocks[/dim]")
    
    df['momentum_score'] = df['name'].map(lambda x: momentum_results.get(x, {}).get('momentum_score', 0))
    df['price_delta_1min'] = df['name'].map(lambda x: momentum_results.get(x, {}).get('price_delta_1min', 0))
    df['volume_delta_1min'] = df['name'].map(lambda x: momentum_results.get(x, {}).get('volume_delta_1min', 0))
    df['momentum_direction'] = df['name'].map(lambda x: momentum_results.get(x, {}).get('momentum_direction', 'NEUTRAL'))
    df['entry_signal'] = df['name'].map(lambda x: momentum_results.get(x, {}).get('entry_signal', False))
    df['momentum_strength'] = df['name'].map(lambda x: momentum_results.get(x, {}).get('momentum_strength', 'WEAK'))
    
    df = df.sort_values('momentum_score', ascending=False)
    df = df[df['momentum_score'] > 30]
    
    console.print(f"[dim green]✅ Completed intraday momentum analysis. {len(df)} stocks with strong momentum.[/dim green]")
    
    return df


def _calculate_intraday_momentum_metrics(self, df_1min: pd.DataFrame, current_row) -> dict:
    """Calculate detailed momentum metrics from 1-minute intraday data"""
    try:
        df_1min = df_1min.sort_values('timestamp')
        
        recent_candles = df_1min.tail(10)
        
        if len(recent_candles) < 5:
            return _calculate_basic_momentum_metrics(self, current_row)
        
        recent_candles['price_delta'] = recent_candles['close'].diff()
        recent_candles['volume_delta'] = recent_candles['volume'].diff()
        
        price_changes = recent_candles['price_delta'].dropna()
        avg_price_delta = price_changes.mean()
        last_3_price_delta = price_changes.tail(3).mean()
        
        volume_changes = recent_candles['volume_delta'].dropna()
        avg_volume_delta = volume_changes.mean()
        
        positive_moves = len(price_changes[price_changes > 0])
        negative_moves = len(price_changes[price_changes < 0])
        
        if positive_moves > negative_moves and last_3_price_delta > 0:
            direction = 'BULLISH'
        elif negative_moves > positive_moves and last_3_price_delta < 0:
            direction = 'BEARISH'
        else:
            direction = 'NEUTRAL'
        
        consistency_score = max(positive_moves, negative_moves) / len(price_changes) * 100
        magnitude_score = abs(last_3_price_delta) / current_row['ATR'] * 100 if current_row['ATR'] > 0 else 0
        
        momentum_score = (consistency_score + magnitude_score) / 2
        
        entry_signal = (
            momentum_score > 40 and
            direction in ['BULLISH', 'BEARISH'] and
            abs(last_3_price_delta) > current_row['close'] * 0.0005
        )
        
        if momentum_score > 70:
            strength = 'VERY_STRONG'
        elif momentum_score > 50:
            strength = 'STRONG'
        elif momentum_score > 30:
            strength = 'MODERATE'
        else:
            strength = 'WEAK'
        
        return {
            'momentum_score': momentum_score,
            'price_delta_1min': last_3_price_delta,
            'volume_delta_1min': avg_volume_delta,
            'momentum_direction': direction,
            'entry_signal': entry_signal,
            'momentum_strength': strength,
            'consistency_score': consistency_score,
            'magnitude_score': magnitude_score
        }
        
    except Exception as e:
        console.print(f"[dim red]Error in momentum calculation: {str(e)[:30]}[/dim red]")
        return _calculate_basic_momentum_metrics(self, current_row)


def _calculate_basic_momentum_metrics(self, row) -> dict:
    """Calculate basic momentum metrics when intraday data is unavailable"""
    try:
        rsi = row.get('RSI', 50)
        rsi_prev = row.get('RSI[1]', 50) 
        macd = row.get('MACD.macd', 0)
        macd_signal = row.get('MACD.signal', 0)
        mom = row.get('Mom', 0)
        change = row.get('change', 0)
        
        rsi_momentum = (rsi - rsi_prev) * 2
        macd_momentum = (macd - macd_signal) * 10
        price_momentum = abs(change) * 5
        
        momentum_score = max(0, min(100, 
            50 + rsi_momentum + macd_momentum + price_momentum
        ))
        
        if change > 0.5 and macd > macd_signal and rsi > rsi_prev:
            direction = 'BULLISH'
        elif change < -0.5 and macd < macd_signal and rsi < rsi_prev:
            direction = 'BEARISH'  
        else:
            direction = 'NEUTRAL'
        
        entry_signal = (
            momentum_score > 35 and
            direction in ['BULLISH', 'BEARISH'] and
            abs(change) > 0.5
        )
        
        if momentum_score > 60:
            strength = 'STRONG'
        elif momentum_score > 40:
            strength = 'MODERATE'
        else:
            strength = 'WEAK'
        
        return {
            'momentum_score': momentum_score,
            'price_delta_1min': change,
            'volume_delta_1min': 0,
            'momentum_direction': direction,
            'entry_signal': entry_signal,
            'momentum_strength': strength
        }
        
    except Exception as e:
        return {
            'momentum_score': 0,
            'price_delta_1min': 0,
            'volume_delta_1min': 0,
            'momentum_direction': 'NEUTRAL',
            'entry_signal': False,
            'momentum_strength': 'WEAK'
        }


def _analyze_sector_correlations(self, df: pd.DataFrame) -> pd.DataFrame:
    """Analyze sector correlations to find catch-up trade opportunities"""
    from collections import defaultdict
    import numpy as np
    
    console.print(f"[dim cyan]📊 Analyzing {len(df)} stocks across sectors...[/dim cyan]")
    
    sector_groups = defaultdict(list)
    for _, row in df.iterrows():
        sector = row.get('sector', 'Unknown')
        if sector and sector != 'Unknown':
            sector_groups[sector].append(row.to_dict())
    
    console.print(f"[dim]Found {len(sector_groups)} sectors with active stocks[/dim]")
    
    catch_up_opportunities = []
    
    for sector, stocks in sector_groups.items():
        if len(stocks) < 2:
            continue
            
        stocks_sorted = sorted(stocks, key=lambda x: abs(x['change']), reverse=True)
        
        leader = stocks_sorted[0]
        leader_change = leader['change']
        
        if abs(leader_change) < 1.0:
            continue
            
        for i in range(1, min(4, len(stocks_sorted))):
            candidate = stocks_sorted[i]
            candidate_change = candidate['change']
            
            change_gap = abs(leader_change) - abs(candidate_change)
            
            if (abs(leader_change) > 2.0 and
                abs(candidate_change) < 1.0 and
                change_gap > 1.5 and
                candidate['relative_volume_10d_calc'] > 0.8 and
                30 < candidate.get('RSI', 50) < 80):
                
                expected_move = leader_change * 0.6
                current_gap = expected_move - candidate_change
                
                if leader_change > 0:
                    direction = 'LONG'
                    signal_strength = min(change_gap * 20, 100)
                else:
                    direction = 'SHORT'  
                    signal_strength = min(change_gap * 20, 100)
                
                volume_ratio = candidate['relative_volume_10d_calc']
                if volume_ratio > 1.5:
                    urgency = 'HIGH'
                elif volume_ratio > 1.0:
                    urgency = 'MEDIUM'
                else:
                    urgency = 'LOW'
                
                opportunity = candidate.copy()
                opportunity.update({
                    'sector_leader': leader['name'],
                    'leader_change': leader_change,
                    'change_gap': change_gap,
                    'expected_move': expected_move,
                    'catch_up_potential': current_gap,
                    'trade_direction': direction,
                    'signal_strength': signal_strength,
                    'entry_urgency': urgency,
                    'correlation_score': min(90, change_gap * 25),
                    'sector': sector
                })
                
                catch_up_opportunities.append(opportunity)
    
    if not catch_up_opportunities:
        console.print(f"[yellow]⚠️ No sector catch-up opportunities found[/yellow]")
        return pd.DataFrame()
    
    df_opportunities = pd.DataFrame(catch_up_opportunities)
    df_opportunities = df_opportunities.sort_values('correlation_score', ascending=False)
    
    df_opportunities = df_opportunities[df_opportunities['correlation_score'] > 30]
    df_opportunities = df_opportunities.head(15)
    
    console.print(f"[dim green]✅ Found {len(df_opportunities)} sector catch-up opportunities[/dim green]")
    
    for idx, row in df_opportunities.iterrows():
        leader = row['sector_leader']
        gap = row['change_gap']
        direction = row['trade_direction']
        console.print(f"[dim]  {row['name'][:10]:10} | Leader: {leader[:8]:8} | Gap: {gap:+.1f}% | {direction}[/dim]")
    
    return df_opportunities
