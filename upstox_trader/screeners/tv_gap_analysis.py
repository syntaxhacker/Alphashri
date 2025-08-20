#!/usr/bin/env python3
"""
Gap Analysis & Gap Fill Trading Functions
Extracted from TVScreenerUsage class
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from rich.console import Console
from rich.table import Table
from rich.panel import Panel

console = Console()

class GapAnalysis:
    """Gap analysis and gap fill trading functionality"""
    
    def __init__(self, parent_instance):
        self.parent = parent_instance
    
    def _analyze_gap_fill_probability(self, symbol, current_gap_size, gap_direction, lookback_days=90):
        """Analyze probability of gap fill based on historical data"""
        try:
            # Get historical data from Upstox
            if hasattr(self.parent, 'upstox_client') and self.parent.upstox_client:
                end_date = datetime.now()
                start_date = end_date - timedelta(days=lookback_days)
                
                # Get historical data
                historical_data = self.parent.upstox_client.fetch_historical_data_v3(
                    symbol=symbol.replace('NSE:', ''),
                    unit='days',
                    interval=1,
                    from_date=start_date.strftime('%Y-%m-%d'),
                    to_date=end_date.strftime('%Y-%m-%d')
                )
                
                if not historical_data or len(historical_data) < 10:
                    return 50.0, "INSUFFICIENT_DATA", {}
                
                # Convert to DataFrame
                df = pd.DataFrame(historical_data)
                df.columns = ['timestamp', 'open', 'high', 'low', 'close', 'volume']
                df = df.sort_values('timestamp')
                
                # Calculate gaps
                df['prev_close'] = df['close'].shift(1)
                df['gap_size'] = ((df['open'] - df['prev_close']) / df['prev_close'] * 100).abs()
                df['gap_direction'] = np.where(df['open'] > df['prev_close'], 'UP', 'DOWN')
                
                # Filter significant gaps (>1%)
                gap_df = df[df['gap_size'] > 1.0].copy()
                
                if len(gap_df) < 5:
                    return 50.0, "INSUFFICIENT_GAPS", {}
                
                # Analyze gap fill patterns
                gap_df['gap_filled'] = False
                gap_df['fill_time'] = 0
                gap_df['max_fill_pct'] = 0.0
                
                for idx, row in gap_df.iterrows():
                    gap_open = row['open']
                    prev_close = row['prev_close']
                    
                    # Look at next 5 days for gap fill
                    future_data = df[df.index > idx].head(5)
                    
                    max_fill = 0.0
                    filled = False
                    fill_days = 0
                    
                    for f_idx, f_row in future_data.iterrows():
                        if row['gap_direction'] == 'UP':
                            # Gap up - filled if price goes back to prev_close
                            if f_row['low'] <= prev_close:
                                filled = True
                                fill_days = f_idx - idx
                                max_fill = 100.0
                                break
                            else:
                                # Partial fill calculation
                                fill_pct = max(0, (gap_open - f_row['low']) / (gap_open - prev_close) * 100)
                                max_fill = max(max_fill, fill_pct)
                        else:
                            # Gap down - filled if price goes back to prev_close
                            if f_row['high'] >= prev_close:
                                filled = True
                                fill_days = f_idx - idx
                                max_fill = 100.0
                                break
                            else:
                                # Partial fill calculation
                                fill_pct = max(0, (f_row['high'] - gap_open) / (prev_close - gap_open) * 100)
                                max_fill = max(max_fill, fill_pct)
                    
                    gap_df.loc[idx, 'gap_filled'] = filled
                    gap_df.loc[idx, 'fill_time'] = fill_days
                    gap_df.loc[idx, 'max_fill_pct'] = max_fill
                
                # Filter gaps similar to current one
                similar_gaps = gap_df[
                    (gap_df['gap_direction'] == gap_direction) & 
                    (gap_df['gap_size'].between(current_gap_size * 0.7, current_gap_size * 1.5))
                ]
                
                if len(similar_gaps) < 3:
                    # Broaden criteria
                    similar_gaps = gap_df[gap_df['gap_direction'] == gap_direction]
                
                if len(similar_gaps) == 0:
                    return 50.0, "NO_SIMILAR_GAPS", {}
                
                # Calculate statistics
                fill_rate = (similar_gaps['gap_filled'].sum() / len(similar_gaps)) * 100
                avg_fill_time = similar_gaps[similar_gaps['gap_filled']]['fill_time'].mean()
                avg_max_fill = similar_gaps['max_fill_pct'].mean()
                
                analysis = {
                    'total_similar_gaps': len(similar_gaps),
                    'gaps_filled': similar_gaps['gap_filled'].sum(),
                    'fill_rate': fill_rate,
                    'avg_fill_time_days': avg_fill_time if not pd.isna(avg_fill_time) else 0,
                    'avg_max_fill_pct': avg_max_fill,
                    'current_gap_size': current_gap_size,
                    'gap_direction': gap_direction
                }
                
                return fill_rate, "SUCCESS", analysis
                
        except Exception as e:
            console.print(f"⚠️ Error in gap analysis for {symbol}: {e}", style="yellow")
            return 50.0, "ERROR", {}
    
    def _detect_gap_reversal_signals(self, symbol, gap_direction, current_price, gap_size):
        """Detect reversal signals for gap trading"""
        signals = {
            'volume_confirmation': False,
            'momentum_divergence': False,
            'support_resistance': False,
            'overall_strength': 'WEAK'
        }
        
        try:
            # Volume analysis
            volume_data = self._get_volume_analysis(symbol)
            if volume_data and volume_data.get('volume_ratio', 0) > 1.5:
                signals['volume_confirmation'] = True
            
            # Check for momentum divergence
            momentum_data = self._check_momentum_divergence_for_gaps(symbol, gap_direction)
            if momentum_data:
                signals['momentum_divergence'] = True
            
            # Support/Resistance levels
            sr_levels = self.parent.technical_analysis._detect_support_resistance_levels(symbol)
            if sr_levels:
                signals['support_resistance'] = self._check_gap_sr_interaction(
                    current_price, gap_direction, sr_levels
                )
            
            # Overall signal strength
            signal_count = sum([signals[k] for k in signals if k != 'overall_strength'])
            if signal_count >= 2:
                signals['overall_strength'] = 'STRONG'
            elif signal_count == 1:
                signals['overall_strength'] = 'MODERATE'
            
        except Exception as e:
            console.print(f"⚠️ Error detecting gap reversal signals: {e}", style="yellow")
        
        return signals
    
    def _get_volume_analysis(self, symbol):
        """Get volume analysis for gap trading"""
        try:
            if hasattr(self.parent, 'upstox_client') and self.parent.upstox_client:
                # Get last 10 days of data
                end_date = datetime.now()
                start_date = end_date - timedelta(days=15)
                
                historical_data = self.parent.upstox_client.fetch_historical_data_v3(
                    symbol=symbol.replace('NSE:', ''),
                    unit='days',
                    interval=1,
                    from_date=start_date.strftime('%Y-%m-%d'),
                    to_date=end_date.strftime('%Y-%m-%d')
                )
                
                if historical_data and len(historical_data) >= 2:
                    df = pd.DataFrame(historical_data)
                    df.columns = ['timestamp', 'open', 'high', 'low', 'close', 'volume']
                    df = df.sort_values('timestamp')
                    
                    current_volume = df.iloc[-1]['volume']
                    avg_volume = df.iloc[-10:-1]['volume'].mean()
                    
                    return {
                        'current_volume': current_volume,
                        'avg_volume': avg_volume,
                        'volume_ratio': current_volume / avg_volume if avg_volume > 0 else 1.0
                    }
        except Exception as e:
            console.print(f"⚠️ Error getting volume analysis: {e}", style="yellow")
        
        return None
    
    def _check_momentum_divergence_for_gaps(self, symbol, gap_direction):
        """Check for momentum divergence in gap scenarios"""
        try:
            # Get recent price action
            rsi = self.parent.technical_analysis._get_15min_rsi(symbol)
            
            if gap_direction == 'UP' and rsi and rsi > 70:
                return True  # Overbought gap up - reversal likely
            elif gap_direction == 'DOWN' and rsi and rsi < 30:
                return True  # Oversold gap down - bounce likely
            
        except Exception as e:
            console.print(f"⚠️ Error checking momentum divergence: {e}", style="yellow")
        
        return False
    
    def _check_gap_sr_interaction(self, current_price, gap_direction, sr_levels):
        """Check how gap interacts with support/resistance levels"""
        try:
            if not sr_levels:
                return False
            
            # Check if gap brought price near key levels
            for level in sr_levels:
                level_price = level.get('price', 0)
                distance_pct = abs(current_price - level_price) / current_price * 100
                
                if distance_pct < 1.0:  # Within 1% of key level
                    if gap_direction == 'DOWN' and level.get('type') == 'support':
                        return True  # Gap down to support
                    elif gap_direction == 'UP' and level.get('type') == 'resistance':
                        return True  # Gap up to resistance
            
        except Exception as e:
            console.print(f"⚠️ Error checking gap S/R interaction: {e}", style="yellow")
        
        return False
    
    def _get_volume_movers_with_gaps(self):
        """Get stocks with high volume and gaps"""
        try:
            from tradingview_screener import Query, col
            
            # Screen for high volume stocks with gaps
            query = (Query()
                .select('name', 'close', 'change', 'change_abs', 'volume', 'relative_volume_10d_calc', 
                       'gap', 'price_earnings_ttm', 'market_cap_basic')
                .where(
                    col('market_cap_basic') > 1000000000,  # Market cap > 1000 Cr
                    col('relative_volume_10d_calc') > 1.5,  # Volume > 1.5x average
                    col('gap').isnull(False),  # Has gap data
                    abs(col('gap')) > 1.0,  # Gap > 1%
                    col('volume') > 100000  # Minimum volume
                )
                .order_by('relative_volume_10d_calc', ascending=False)
                .limit(20))
            
            return query.get_scanner_data()[1]
            
        except Exception as e:
            console.print(f"⚠️ Error getting volume movers with gaps: {e}", style="yellow")
            return pd.DataFrame()
    
    def _get_enhanced_gap_opportunities(self):
        """Get enhanced gap opportunities with multiple filters"""
        try:
            from tradingview_screener import Query, col
            
            # Get gap stocks with technical filters
            query = (Query()
                .select('name', 'close', 'change', 'volume', 'relative_volume_10d_calc',
                       'gap', 'RSI', 'price_earnings_ttm', 'market_cap_basic',
                       'ADR', 'ATR', 'BB.upper', 'BB.lower')
                .where(
                    col('market_cap_basic') > 500000000,  # Market cap > 500 Cr
                    col('gap').isnull(False),
                    abs(col('gap')) > 1.5,  # Significant gap
                    col('relative_volume_10d_calc') > 1.2,
                    col('volume') > 50000,
                    col('RSI').isnull(False)
                )
                .order_by('gap', ascending=False)
                .limit(30))
            
            df = query.get_scanner_data()[1]
            
            if not df.empty:
                # Add gap analysis
                df = self._calculate_gap_quality_score(df)
            
            return df
            
        except Exception as e:
            console.print(f"⚠️ Error getting enhanced gap opportunities: {e}", style="yellow")
            return pd.DataFrame()
    
    def _calculate_gap_quality_score(self, df):
        """Calculate quality score for gap trading opportunities"""
        if df.empty:
            return df
        
        df = df.copy()
        df['gap_quality_score'] = 0
        
        for idx, row in df.iterrows():
            score = 0
            
            # Gap size score (optimal 2-5%)
            gap_size = abs(row.get('gap', 0))
            if 2 <= gap_size <= 5:
                score += 3
            elif 1.5 <= gap_size < 2 or 5 < gap_size <= 7:
                score += 2
            elif gap_size > 7:
                score += 1
            
            # Volume score
            vol_ratio = row.get('relative_volume_10d_calc', 1)
            if vol_ratio > 2:
                score += 3
            elif vol_ratio > 1.5:
                score += 2
            elif vol_ratio > 1.2:
                score += 1
            
            # RSI score (mean reversion opportunity)
            rsi = row.get('RSI', 50)
            gap = row.get('gap', 0)
            if gap > 0 and rsi > 70:  # Gap up + overbought
                score += 2
            elif gap < 0 and rsi < 30:  # Gap down + oversold
                score += 2
            elif 30 <= rsi <= 70:  # Neutral RSI
                score += 1
            
            # Market cap score (liquidity)
            market_cap = row.get('market_cap_basic', 0)
            if market_cap > 10000000000:  # > 10,000 Cr
                score += 2
            elif market_cap > 1000000000:  # > 1,000 Cr
                score += 1
            
            df.loc[idx, 'gap_quality_score'] = score
        
        return df.sort_values('gap_quality_score', ascending=False)
    
    def live_gap_fill_monitor_with_sr(self, refresh_interval=30):
        """Live monitor for gap fill opportunities with S/R analysis"""
        console.print("🎯 Starting Live Gap Fill Monitor with S/R Analysis", style="bold green")
        
        try:
            while True:
                # Get gap opportunities
                gap_df = self._get_enhanced_gap_opportunities()
                
                if not gap_df.empty:
                    # Display gap analysis
                    self._display_live_gap_sr_analysis(gap_df)
                    
                    # Process paper trading if enabled
                    if hasattr(self.parent, 'enable_paper_trading') and self.parent.enable_paper_trading:
                        self._process_gap_fill_paper_trading(gap_df)
                
                console.print(f"⏰ Next refresh in {refresh_interval} seconds...", style="dim")
                time.sleep(refresh_interval)
                
        except KeyboardInterrupt:
            console.print("🛑 Gap fill monitor stopped", style="bold red")
    
    def _display_live_gap_sr_analysis(self, df):
        """Display live gap analysis with S/R levels"""
        if df.empty:
            console.print("📊 No gap opportunities found", style="yellow")
            return
        
        table = Table(title="🎯 Gap Fill Opportunities with S/R Analysis")
        table.add_column("Symbol", style="cyan")
        table.add_column("Gap %", justify="right")
        table.add_column("Price", justify="right")
        table.add_column("Volume", justify="right")
        table.add_column("RSI", justify="right")
        table.add_column("Quality", justify="center")
        table.add_column("Signal", justify="center")
        
        for _, row in df.head(15).iterrows():
            symbol = row.get('name', 'N/A')
            gap = row.get('gap', 0)
            price = row.get('close', 0)
            volume_ratio = row.get('relative_volume_10d_calc', 1)
            rsi = row.get('RSI', 50)
            quality_score = row.get('gap_quality_score', 0)
            
            # Generate signal
            signal = "⚡" if quality_score >= 7 else "📈" if quality_score >= 5 else "⚠️"
            
            # Color coding
            gap_color = "red" if gap < 0 else "green"
            quality_color = "green" if quality_score >= 7 else "yellow" if quality_score >= 5 else "red"
            
            table.add_row(
                symbol,
                f"[{gap_color}]{gap:.1f}%[/]",
                f"₹{price:.1f}",
                f"{volume_ratio:.1f}x",
                f"{rsi:.1f}",
                f"[{quality_color}]{quality_score}/10[/]",
                signal
            )
        
        console.print(table)