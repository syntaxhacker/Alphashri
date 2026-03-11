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
        """Analyze historical gap-fill patterns to predict current gap-fill probability"""
        try:
            if not hasattr(self.parent, 'upstox_api') or not self.parent.upstox_api:
                return {'probability': 50.0, 'historical_data': 'unavailable'}
            
            from datetime import datetime, timedelta
            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=lookback_days)).strftime('%Y-%m-%d')
            
            # Fetch historical data for gap analysis
            try:
                df = self.parent.upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='days',
                    interval=1,
                    to_date=to_date,
                    from_date=from_date
                )
            except:
                # Fallback to shorter period if API fails
                df = self.parent.upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='days', 
                    interval=1,
                    to_date=to_date,
                    from_date=(datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
                )
            
            if df is None or df.empty or len(df) < 10:
                return {'probability': 50.0, 'historical_data': 'insufficient'}
            
            # Handle different possible column structures from V3 API
            if isinstance(df, list):
                # V3 API returns array format: [timestamp, open, high, low, close, volume, oi]
                columns = ['timestamp', 'open', 'high', 'low', 'close', 'volume', 'oi']
                df = pd.DataFrame(df, columns=columns)
                df['timestamp'] = pd.to_datetime(df['timestamp'])
                df = df.sort_values('timestamp').reset_index(drop=True)
            else:
                # Already DataFrame format
                timestamp_col = None
                for col in ['timestamp', 'datetime', 'date', 'time']:
                    if col in df.columns:
                        timestamp_col = col
                        break
                if timestamp_col:
                    df = df.sort_values(timestamp_col).reset_index(drop=True)
                else:
                    df = df.reset_index(drop=True)
            
            # Calculate gaps between consecutive days
            df['prev_close'] = df['close'].shift(1)
            df['gap_size'] = ((df['open'] - df['prev_close']) / df['prev_close'] * 100).round(2)
            df['gap_direction'] = df['gap_size'].apply(lambda x: 'UP' if x > 0.5 else 'DOWN' if x < -0.5 else 'NO_GAP')
            
            # Calculate if gaps get filled during the day
            df['gap_filled'] = False
            df['fill_percentage'] = 0.0
            
            for i in range(1, len(df)):
                if pd.notna(df.loc[i, 'gap_size']) and df.loc[i, 'gap_direction'] != 'NO_GAP':
                    prev_close = df.loc[i-1, 'close']
                    current_open = df.loc[i, 'open']
                    current_high = df.loc[i, 'high']
                    current_low = df.loc[i, 'low']
                    
                    if df.loc[i, 'gap_direction'] == 'UP':
                        # Gap up - filled if price goes back down to previous close
                        if current_low <= prev_close:
                            df.loc[i, 'gap_filled'] = True
                            df.loc[i, 'fill_percentage'] = 100.0
                        else:
                            # Partial fill calculation
                            gap_size_points = current_open - prev_close
                            filled_points = current_open - current_low
                            df.loc[i, 'fill_percentage'] = (filled_points / gap_size_points * 100) if gap_size_points > 0 else 0
                    
                    elif df.loc[i, 'gap_direction'] == 'DOWN':
                        # Gap down - filled if price goes back up to previous close
                        if current_high >= prev_close:
                            df.loc[i, 'gap_filled'] = True
                            df.loc[i, 'fill_percentage'] = 100.0
                        else:
                            # Partial fill calculation
                            gap_size_points = prev_close - current_open
                            filled_points = current_high - current_open
                            df.loc[i, 'fill_percentage'] = (filled_points / gap_size_points * 100) if gap_size_points > 0 else 0
            
            # Filter for similar gaps (within 1% of current gap size)
            similar_gaps = df[
                (df['gap_direction'] == gap_direction) & 
                (df['gap_direction'] != 'NO_GAP') &
                (abs(df['gap_size']) >= abs(current_gap_size) * 0.5) &  # At least 50% of current gap size
                (abs(df['gap_size']) <= abs(current_gap_size) * 2.0)    # No more than 200% of current gap size
            ].copy()
            
            if similar_gaps.empty:
                # No similar gaps found, use all gaps of same direction
                similar_gaps = df[df['gap_direction'] == gap_direction].copy()
            
            if similar_gaps.empty:
                return {'probability': 50.0, 'historical_data': 'no_similar_gaps'}
            
            # Calculate statistics
            total_gaps = len(similar_gaps)
            filled_gaps = similar_gaps['gap_filled'].sum()
            fill_rate = (filled_gaps / total_gaps * 100) if total_gaps > 0 else 50.0
            avg_fill_percentage = similar_gaps['fill_percentage'].mean()
            
            # Adjust probability based on current gap size
            size_multiplier = 1.0
            if abs(current_gap_size) > 5:  # Large gaps less likely to fill completely
                size_multiplier = 0.8
            elif abs(current_gap_size) > 3:
                size_multiplier = 0.9
            elif abs(current_gap_size) < 1:  # Small gaps more likely to fill
                size_multiplier = 1.1
            
            adjusted_probability = min(95.0, fill_rate * size_multiplier)
            
            return {
                'probability': round(adjusted_probability, 1),
                'total_similar_gaps': total_gaps,
                'filled_gaps': filled_gaps,
                'avg_fill_percentage': round(avg_fill_percentage, 1),
                'historical_data': 'available',
                'lookback_days': lookback_days
            }
            
        except Exception as e:
            console.print(f"[dim red]⚠️ Gap analysis failed for {symbol}: {e}[/dim red]")
            return {'probability': 50.0, 'historical_data': 'error'}

    def _detect_gap_reversal_signals(self, symbol, gap_direction, current_price, gap_size):
        """Detect if a gap is showing reversal/exhaustion signals for safe counter-trend trading"""
        try:
            # Get intraday data to check for reversal patterns
            from datetime import datetime, timedelta
            
            if not hasattr(self.parent, 'upstox_api') or not self.parent.upstox_api:
                return {'reversal_strength': 0, 'signals': [], 'recommendation': 'SKIP'}
            
            # Fetch 5-minute intraday data for current day
            today = datetime.now().strftime('%Y-%m-%d')
            
            try:
                df_5min = self.parent.upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='minutes',
                    interval=5,
                    to_date=today,
                    from_date=today
                )
            except:
                # Fallback to 15-minute if 5-minute fails
                df_5min = self.parent.upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='minutes',
                    interval=15,
                    to_date=today,
                    from_date=today
                )
            
            if df_5min is None or df_5min.empty or len(df_5min) < 5:
                return {'reversal_strength': 0, 'signals': ['no_intraday_data'], 'recommendation': 'SKIP'}
            
            # Analyze reversal patterns
            signals = []
            reversal_strength = 0
            
            # Get recent candles (last 5 periods)
            recent_data = df_5min.tail(5).reset_index(drop=True)
            latest_candle = recent_data.iloc[-1]
            prev_candle = recent_data.iloc[-2] if len(recent_data) > 1 else latest_candle
            
            # 1. Volume Exhaustion Check
            if len(recent_data) >= 3:
                recent_volume = recent_data['volume'].tail(3).mean()
                earlier_volume = recent_data['volume'].head(2).mean() if len(recent_data) >= 5 else recent_volume
                
                if recent_volume < earlier_volume * 0.7:  # Volume declining
                    signals.append('volume_exhaustion')
                    reversal_strength += 2
            
            # 2. Price Action Reversal Patterns
            open_price = latest_candle['open']
            high_price = latest_candle['high'] 
            low_price = latest_candle['low']
            close_price = latest_candle['close']
            
            # Calculate candle characteristics
            body_size = abs(close_price - open_price)
            upper_wick = high_price - max(open_price, close_price)
            lower_wick = min(open_price, close_price) - low_price
            candle_range = high_price - low_price
            
            if gap_direction == 'UP':
                # For gap up, look for bearish reversal signals
                
                # Shooting Star / Doji at top
                if upper_wick > body_size * 2 and body_size < candle_range * 0.3:
                    signals.append('shooting_star_doji')
                    reversal_strength += 3
                
                # Failed to hold highs (close < open after gap up)
                if close_price < open_price:
                    signals.append('failed_to_hold_highs')
                    reversal_strength += 2
                
                # Lower high formation
                if len(recent_data) >= 2 and high_price < prev_candle['high']:
                    signals.append('lower_high')
                    reversal_strength += 1
                
                # High volume rejection at resistance
                if latest_candle['volume'] > recent_data['volume'].mean() * 1.5 and close_price < high_price * 0.98:
                    signals.append('volume_rejection')
                    reversal_strength += 2
                    
            elif gap_direction == 'DOWN':
                # For gap down, look for bullish reversal signals
                
                # Hammer / Doji at bottom
                if lower_wick > body_size * 2 and body_size < candle_range * 0.3:
                    signals.append('hammer_doji')
                    reversal_strength += 3
                
                # Failed to hold lows (close > open after gap down)
                if close_price > open_price:
                    signals.append('failed_to_hold_lows')
                    reversal_strength += 2
                
                # Higher low formation
                if len(recent_data) >= 2 and low_price > prev_candle['low']:
                    signals.append('higher_low')
                    reversal_strength += 1
                
                # High volume bounce from support
                if latest_candle['volume'] > recent_data['volume'].mean() * 1.5 and close_price > low_price * 1.02:
                    signals.append('volume_bounce')
                    reversal_strength += 2
            
            # 3. Overbought/Oversold Conditions (simple momentum check)
            if len(recent_data) >= 4:
                # Check if price has extended too far from opening range
                day_open = recent_data.iloc[0]['open']
                current_move = abs(close_price - day_open) / day_open * 100
                
                if current_move > abs(gap_size) * 1.5:  # Extended beyond 1.5x gap size
                    signals.append('overextended_move')
                    reversal_strength += 1
            
            # 4. Time-based exhaustion (gaps typically fill within first few hours)
            if len(df_5min) > 12:  # More than 1 hour of trading (12 x 5min candles)
                current_hour = datetime.now().hour
                if current_hour >= 11:  # After 11 AM, gap-fill probability decreases
                    if gap_size > 5:  # Only for significant gaps
                        signals.append('time_exhaustion')
                        reversal_strength += 1
            
            # Generate recommendation based on reversal strength
            if reversal_strength >= 5:
                recommendation = 'STRONG_COUNTER_TRADE'
            elif reversal_strength >= 3:
                recommendation = 'MODERATE_COUNTER_TRADE'
            elif reversal_strength >= 1:
                recommendation = 'WEAK_COUNTER_TRADE'
            else:
                recommendation = 'SKIP'  # No clear reversal signals
            
            return {
                'reversal_strength': reversal_strength,
                'signals': signals,
                'recommendation': recommendation,
                'latest_candle': {
                    'open': open_price,
                    'high': high_price, 
                    'low': low_price,
                    'close': close_price,
                    'volume': latest_candle['volume']
                },
                'analysis_time': datetime.now().strftime('%H:%M:%S')
            }
            
        except Exception as e:
            console.print(f"[dim red]Reversal analysis failed for {symbol}: {e}[/dim red]")
            return {'reversal_strength': 0, 'signals': ['error'], 'recommendation': 'SKIP'}

    def _get_volume_movers_with_gaps(self):
        """Get current volume movers that have significant gaps"""
        try:
            from tradingview_screener import Query, col
            # Use existing volume mover logic
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                       'RSI', 'market_cap_basic', 'update_mode')
                .set_markets(self.parent.market)
                .where(
                    col('close') > 30,
                    col('volume') > 500000,    # High volume
                    col('relative_volume_10d_calc') > 1.5,  # Above normal volume
                    col('market_cap_basic') > 5e7,  # Min 50 crores
                    col('exchange') == 'NSE'
                )
                .order_by('relative_volume_10d_calc', ascending=False)
                .limit(10)  # Top 10 volume movers with gaps
                .get_scanner_data(cookies=self.parent.cookies)
            )
            
            # Filter for stocks with meaningful gaps (0.8% or more) after getting data
            if not df.empty:
                df = df[df['change'].abs() >= 0.8].copy()
            
            return df
            
        except Exception as e:
            console.print(f"[red]Error fetching volume movers: {e}[/red]")
            return pd.DataFrame()

    def _get_enhanced_gap_opportunities(self):
        """Enhanced gap screening with multiple criteria beyond just volume movers"""
        all_opportunities = []
        
        try:
            # 1. HIGH VOLUME GAP STOCKS (Current approach)
            console.print("[dim]🔍 Scanning high volume gap stocks...[/dim]")
            volume_gaps = self._get_volume_movers_with_gaps()
            if not volume_gaps.empty:
                volume_gaps['source'] = 'volume_mover'
                all_opportunities.append(volume_gaps)
            
            # 2. LIQUID LARGE-CAP GAPS (Better quality, may have lower volume %)
            console.print("[dim]🔍 Scanning large-cap liquid gaps...[/dim]")
            from tradingview_screener import Query, col
            total_rows, largecap_gaps = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                       'RSI', 'market_cap_basic', 'update_mode')
                .set_markets(self.parent.market)
                .where(
                    col('close') > 50,  # Higher price filter
                    col('market_cap_basic') > 1e9,  # Min 1000 crores (large cap)
                    col('volume') > 1000000,  # High absolute volume
                    (col('change') > 1.2) | (col('change') < -1.2),  # Significant gaps
                    col('exchange') == 'NSE'
                )
                .order_by('market_cap_basic', ascending=False)  # Prefer larger caps
                .limit(8)
                .get_scanner_data(cookies=self.parent.cookies)
            )
            
            if not largecap_gaps.empty:
                largecap_gaps['source'] = 'large_cap_gap'
                # Remove duplicates already found in volume movers
                existing_names = volume_gaps['name'].tolist() if not volume_gaps.empty else []
                largecap_gaps = largecap_gaps[~largecap_gaps['name'].isin(existing_names)]
                if not largecap_gaps.empty:
                    all_opportunities.append(largecap_gaps)
            
            # 3. MOMENTUM CONTINUATION GAPS (Strong trending stocks)
            console.print("[dim]🔍 Scanning momentum continuation gaps...[/dim]")
            total_rows, momentum_gaps = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                       'RSI', 'market_cap_basic', 'update_mode')
                .set_markets(self.parent.market)
                .where(
                    col('close') > 40,
                    col('market_cap_basic') > 2e8,  # Min 200 crores
                    col('volume') > 300000,
                    (col('change') > 2.0) | (col('change') < -2.0),  # Strong moves
                    col('RSI') > 70,  # Overbought (for gap downs) or strong momentum (gap ups)
                    col('exchange') == 'NSE'
                )
                .order_by('change', ascending=False)  # Strongest moves first
                .limit(5)
                .get_scanner_data(cookies=self.parent.cookies)
            )
            
            if not momentum_gaps.empty:
                momentum_gaps['source'] = 'momentum_gap'
                # Remove duplicates
                existing_names = []
                for opp in all_opportunities:
                    existing_names.extend(opp['name'].tolist())
                momentum_gaps = momentum_gaps[~momentum_gaps['name'].isin(existing_names)]
                if not momentum_gaps.empty:
                    all_opportunities.append(momentum_gaps)
            
            # 4. OVERSOLD BOUNCE GAPS (Gap downs in strong stocks)
            console.print("[dim]🔍 Scanning oversold bounce opportunities...[/dim]")
            total_rows, oversold_gaps = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                       'RSI', 'market_cap_basic', 'update_mode')
                .set_markets(self.parent.market)
                .where(
                    col('close') > 40,
                    col('market_cap_basic') > 5e8,  # Min 500 crores (quality stocks)
                    col('volume') > 500000,
                    col('change') < -1.5,  # Gap downs
                    col('RSI') < 40,  # Oversold condition
                    col('exchange') == 'NSE'
                )
                .order_by('change', ascending=True)  # Biggest gap downs first
                .limit(5)
                .get_scanner_data(cookies=self.parent.cookies)
            )
            
            if not oversold_gaps.empty:
                oversold_gaps['source'] = 'oversold_bounce'
                # Remove duplicates
                existing_names = []
                for opp in all_opportunities:
                    existing_names.extend(opp['name'].tolist())
                oversold_gaps = oversold_gaps[~oversold_gaps['name'].isin(existing_names)]
                if not oversold_gaps.empty:
                    all_opportunities.append(oversold_gaps)
            
            # Combine all opportunities
            if all_opportunities:
                combined_df = pd.concat(all_opportunities, ignore_index=True)
                
                # Add gap quality scoring
                combined_df['gap_quality_score'] = self._calculate_gap_quality_score(combined_df)
                
                # Sort by gap quality score (best opportunities first)
                combined_df = combined_df.sort_values('gap_quality_score', ascending=False)
                
                # Limit to top 15 best opportunities
                return combined_df.head(15)
            else:
                return pd.DataFrame()
                
        except Exception as e:
            console.print(f"[red]Error in enhanced gap screening: {e}[/red]")
            # Fallback to simple volume mover approach
            return self._get_volume_movers_with_gaps()

    def _calculate_gap_quality_score(self, df):
        """Calculate a quality score for gap opportunities"""
        scores = []
        
        for _, row in df.iterrows():
            score = 0
            
            # Gap size factor (bigger gaps = higher score, but diminishing returns)
            gap_size = abs(row['change'])
            if gap_size >= 5:
                score += 5
            elif gap_size >= 3:
                score += 4
            elif gap_size >= 2:
                score += 3
            elif gap_size >= 1:
                score += 2
            else:
                score += 1
            
            # Volume factor (but not overweighted)
            vol_ratio = row.get('relative_volume_10d_calc', 1)
            if vol_ratio >= 3:
                score += 3
            elif vol_ratio >= 2:
                score += 2
            elif vol_ratio >= 1.5:
                score += 1
            
            # Market cap factor (prefer liquid stocks)
            market_cap = row.get('market_cap_basic', 0)
            if market_cap >= 5e9:  # 5000+ crores
                score += 3
            elif market_cap >= 1e9:  # 1000+ crores
                score += 2
            elif market_cap >= 5e8:  # 500+ crores
                score += 1
            
            # Price factor (avoid penny stocks)
            price = row.get('close', 0)
            if price >= 100:
                score += 2
            elif price >= 50:
                score += 1
            
            # Source bonus
            source = row.get('source', '')
            if source == 'large_cap_gap':
                score += 1  # Bonus for quality
            elif source == 'momentum_gap':
                score += 1  # Bonus for strong momentum
            
            scores.append(score)
        
        return scores

    def live_gap_fill_monitor_with_sr(self, refresh_interval=30):
        """
        🎯 LIVE GAP-FILL MONITOR WITH SUPPORT/RESISTANCE ANALYSIS
        ========================================================
        
        Real-time monitoring that combines:
        - TV screener volume movers with gap analysis
        - Support/resistance level detection
        - Trend-based probability for reaching S/R levels
        - Live price tracking with entry/exit signals
        """
        console.print(Panel.fit("🎯 LIVE GAP-FILL MONITOR WITH S/R ANALYSIS", style="bold cyan"))
        
        try:
            iteration = 0
            while True:
                iteration += 1
                start_time = time.time()
                
                # Clear screen for fresh update
                os.system('clear' if os.name == 'posix' else 'cls')
                
                # Header with current time
                current_time = datetime.now().strftime("%H:%M:%S")
                console.print(f"[bold cyan]🎯 LIVE GAP-FILL MONITOR WITH S/R LEVELS - {current_time}[/bold cyan]")
                console.print(f"[dim]Iteration: {iteration} | Refresh: {refresh_interval}s | Press Ctrl+C to stop[/dim]")
                console.print()
                
                # Get enhanced gap opportunities (multiple criteria)
                volume_movers = self._get_enhanced_gap_opportunities()
                
                if not volume_movers.empty:
                    # Analyze each stock for gap-fill and S/R levels
                    console.print("[dim]Analyzing gap-fill probabilities and S/R levels...[/dim]")
                    self._display_live_gap_sr_analysis(volume_movers)
                    
                    # Process paper trading opportunities if enabled
                    if self.parent.paper_trading_enabled:
                        self._process_gap_fill_paper_trading(volume_movers)
                else:
                    console.print("[yellow]No significant volume movers with gaps found[/yellow]")
                
                # Wait for next refresh
                elapsed = time.time() - start_time
                sleep_time = max(0, refresh_interval - elapsed)
                
                if sleep_time > 0:
                    console.print(f"[dim]Next refresh in {sleep_time:.1f}s...[/dim]")
                    time.sleep(sleep_time)
                    
        except KeyboardInterrupt:
            console.print("\n[yellow]👋 Live gap-fill monitor stopped by user[/yellow]")
        except Exception as e:
            console.print(f"[red]Error in live monitor: {e}[/red]")

    def _process_gap_fill_paper_trading(self, df):
        """Process gap-fill trading opportunities for paper trading"""
        if not self.parent.paper_trading_enabled or df.empty:
            return
        
        console.print("\n[dim]🤖 Evaluating paper trading opportunities...[/dim]")
        trades_executed = 0
        
        for _, row in df.iterrows():
            try:
                symbol = row['name']
                current_price = row['close']
                gap_size = row['change']
                vol_ratio = row['relative_volume_10d_calc']
                
                # Skip if we already have a position in this symbol
                has_position, existing_ticker = self.parent._has_existing_position(symbol)
                if has_position:
                    console.print(f"[dim yellow]⚠️ Already have position in {symbol} - skipping[/dim yellow]")
                    continue
                
                # Determine gap direction
                gap_direction = 'UP' if gap_size > 0 else 'DOWN'
                
                # Get reversal analysis for significant gaps
                reversal_analysis = None
                if abs(gap_size) >= 0.8:
                    reversal_analysis = self._detect_gap_reversal_signals(
                        symbol=symbol,
                        gap_direction=gap_direction,
                        current_price=current_price,
                        gap_size=abs(gap_size)
                    )
                
                # Get S/R analysis
                sr_analysis = self.parent._detect_support_resistance_levels(symbol, lookback_days=45)
                
                # Generate trading signal based on analysis
                trade_signal = self._evaluate_gap_fill_trade_signal(
                    symbol=symbol,
                    gap_size=gap_size,
                    gap_direction=gap_direction,
                    reversal_analysis=reversal_analysis,
                    sr_analysis=sr_analysis,
                    current_price=current_price
                )
                
                # Execute trade if signal is strong enough
                if trade_signal['action'] in ['STRONG_SHORT', 'STRONG_LONG', 'MODERATE_SHORT', 'MODERATE_LONG']:
                    success = self._execute_gap_fill_trade(
                        symbol=symbol,
                        signal=trade_signal,
                        current_price=current_price,
                        gap_size=gap_size,
                        vol_ratio=vol_ratio,
                        reversal_analysis=reversal_analysis
                    )
                    
                    if success:
                        trades_executed += 1
                        if trades_executed >= 3:  # Limit to 3 concurrent gap-fill trades
                            console.print("[dim]🚫 Max gap-fill trades limit reached (3)[/dim]")
                            break
                            
            except Exception as e:
                console.print(f"[dim red]❌ Error processing {symbol}: {e}[/dim red]")
                continue
        
        if trades_executed > 0:
            console.print(f"[green]✅ {trades_executed} gap-fill paper trades executed[/green]")

    def _evaluate_gap_fill_trade_signal(self, symbol, gap_size, gap_direction, reversal_analysis, sr_analysis, current_price):
        """Evaluate if gap-fill trade signal is strong enough for execution"""
        
        # Get gap fill probability
        gap_fill_prob = 50.0  # Default
        try:
            gap_analysis = self._analyze_gap_fill_probability(
                symbol=symbol,
                current_gap_size=abs(gap_size),
                gap_direction=gap_direction,
                lookback_days=60
            )
            gap_fill_prob = gap_analysis['probability']
        except:
            pass
        
        # Find next S/R level
        next_sr_level = None
        sr_probability = 0
        if sr_analysis['levels']:
            for level_info in sr_analysis['levels'][:3]:
                if level_info['strength'] in ['strong', 'moderate']:
                    next_sr_level = level_info
                    break
            if not next_sr_level and sr_analysis['levels']:
                next_sr_level = sr_analysis['levels'][0]
        
        # Calculate S/R probability if level exists
        if next_sr_level:
            sr_probability = self.parent._calculate_trend_target_probability(
                current_price=current_price,
                target_price=next_sr_level['price'],
                trend_strength='neutral',
                gap_direction=gap_direction
            )
        
        # Decision logic with multiple criteria
        action = 'SKIP'
        confidence = 0
        reason = ""
        
        # Strong reversal signals for gap-fill trades
        if reversal_analysis and gap_fill_prob >= 60:
            reversal_strength = reversal_analysis['reversal_strength']
            reversal_recommendation = reversal_analysis['recommendation']
            
            if reversal_recommendation == 'STRONG_COUNTER_TRADE' and reversal_strength >= 5:
                action = 'STRONG_SHORT' if gap_direction == 'UP' else 'STRONG_LONG'
                confidence = min(0.85, (gap_fill_prob + reversal_strength * 10) / 100)
                reason = f"Strong reversal + {gap_fill_prob:.0f}% gap-fill prob"
                
            elif reversal_recommendation == 'MODERATE_COUNTER_TRADE' and reversal_strength >= 3:
                action = 'MODERATE_SHORT' if gap_direction == 'UP' else 'MODERATE_LONG'
                confidence = min(0.75, (gap_fill_prob + reversal_strength * 8) / 100)
                reason = f"Moderate reversal + {gap_fill_prob:.0f}% gap-fill prob"
                
            elif gap_fill_prob >= 75 and reversal_strength >= 2:
                action = 'WEAK_SHORT' if gap_direction == 'UP' else 'WEAK_LONG'
                confidence = min(0.65, gap_fill_prob / 100)
                reason = f"High gap-fill prob ({gap_fill_prob:.0f}%) + weak reversal"
        
        # S/R continuation trades (following gap direction) - only if no strong reversal
        elif sr_probability >= 75 and next_sr_level and (not reversal_analysis or reversal_analysis['reversal_strength'] < 3):
            sr_type = next_sr_level['type']
            if (gap_direction == 'UP' and sr_type == 'resistance') or (gap_direction == 'DOWN' and sr_type == 'support'):
                action = 'MODERATE_LONG' if gap_direction == 'UP' else 'MODERATE_SHORT'
                confidence = min(0.70, sr_probability / 100)
                reason = f"Trend continuation to {sr_type} ({sr_probability:.0f}% prob)"
        
        return {
            'action': action,
            'confidence': confidence,
            'reason': reason,
            'gap_fill_prob': gap_fill_prob,
            'sr_probability': sr_probability,
            'reversal_strength': reversal_analysis['reversal_strength'] if reversal_analysis else 0
        }

    def _execute_gap_fill_trade(self, symbol, signal, current_price, gap_size, vol_ratio, reversal_analysis):
        """Execute gap-fill paper trade"""
        try:
            # Check trading hours
            if not self.parent._is_trading_hours():
                console.print(f"[yellow]⏰ TRADE BLOCKED: {symbol} - Outside trading hours[/yellow]")
                return False
            
            # Determine trade side
            if signal['action'] in ['STRONG_SHORT', 'MODERATE_SHORT', 'WEAK_SHORT']:
                trade_side = 'SELL'
                target_side = 'SHORT'
            elif signal['action'] in ['STRONG_LONG', 'MODERATE_LONG', 'WEAK_LONG']:
                trade_side = 'BUY'
                target_side = 'LONG'
            else:
                return False
            
            # Get live price validation
            live_price = self.parent._get_live_price_from_upstox(symbol)
            if live_price and abs(live_price - current_price) / current_price > 0.02:
                console.print(f"[yellow]⚠️ Price moved too much for {symbol}: ₹{current_price:.2f} → ₹{live_price:.2f}[/yellow]")
                return False
            
            # Use live price if available, otherwise use current price
            execution_price = live_price if live_price else current_price
            
            # Calculate position size for ₹20,000
            quantity = max(1, int(20000 / execution_price))
            
            # Create alert-like structure for existing trading system
            gap_alert = {
                'ticker': symbol,
                'name': symbol,
                'price': execution_price,
                'change': gap_size,
                'type': 'GAP_FILL_TRADE',
                'confidence': signal['confidence'],
                'gap_direction': 'UP' if gap_size > 0 else 'DOWN',
                'reversal_strength': signal['reversal_strength'],
                'reason': signal['reason']
            }
            
            # Execute through existing paper trading system
            success = self.parent._execute_screener_trade(
                symbol=symbol,
                side=trade_side,
                alert=gap_alert,
                price=execution_price,
                quantity=quantity,
                confidence=signal['confidence'],
                trend='gap_fill_' + target_side.lower()
            )
            
            if success:
                # Add to display with gap-specific info
                trade_info = {
                    'timestamp': datetime.now(),
                    'symbol': symbol,
                    'side': trade_side,
                    'price': execution_price,
                    'quantity': quantity,
                    'amount': quantity * execution_price,
                    'alert_type': 'GAP_FILL',
                    'confidence': signal['confidence'],
                    'gap_size': gap_size,
                    'reason': signal['reason']
                }
                
                self.parent.live_trades.append(trade_info)
                if len(self.parent.live_trades) > 10:
                    self.parent.live_trades.pop(0)
                
                # Display execution
                gap_emoji = "📈" if gap_size > 0 else "📉"
                console.print(f"[green]🎯 GAP-FILL TRADE: {trade_side} {quantity} {symbol} @ ₹{execution_price:.2f} {gap_emoji} ({signal['reason']})[/green]")
                
                return True
                
        except Exception as e:
            console.print(f"[red]❌ Gap-fill trade execution failed for {symbol}: {e}[/red]")
            return False
        
        return False

    def _display_gap_fill_trading_status(self):
        """Display gap-fill specific paper trading status"""
        try:
            # Filter for gap-fill trades only
            gap_fill_trades = [trade for trade in self.parent.live_trades if trade.get('alert_type') == 'GAP_FILL']
            
            if gap_fill_trades or self.parent.closed_trades:
                console.print(f"\n[bold blue]📊 GAP-FILL PAPER TRADING STATUS:[/bold blue]")
                
                # Active gap-fill positions
                if gap_fill_trades:
                    console.print(f"[green]🟢 Active Gap-Fill Positions: {len(gap_fill_trades)}[/green]")
                    for trade in gap_fill_trades[-3:]:  # Show last 3
                        side_emoji = "📉" if trade['side'] == 'SELL' else "📈"
                        gap_size = trade.get('gap_size', 0)
                        reason = trade.get('reason', 'Gap trade')
                        console.print(f"  • {side_emoji} {trade['symbol']}: {trade['quantity']} @ ₹{trade['price']:.2f} ({gap_size:+.1f}% gap)")
                        console.print(f"    [dim]{reason}[/dim]")
                
                # Gap-fill specific stats
                total_gap_trades = len([t for t in self.parent.closed_trades if t.get('alert_type') == 'GAP_FILL'])
                if total_gap_trades > 0:
                    gap_pnl = sum([t.get('pnl_amount', 0) for t in self.parent.closed_trades if t.get('alert_type') == 'GAP_FILL'])
                    win_rate = len([t for t in self.parent.closed_trades if t.get('alert_type') == 'GAP_FILL' and t.get('pnl_amount', 0) > 0]) / total_gap_trades * 100
                    console.print(f"[cyan]📈 Gap-Fill Stats: {total_gap_trades} trades | {win_rate:.1f}% win rate | ₹{gap_pnl:,.0f} P&L[/cyan]")
                
                # Trading limits
                console.print(f"[dim]💼 Position Limit: {len(gap_fill_trades)}/3 gap-fill trades | ₹20,000 per position[/dim]")
                
        except Exception as e:
            console.print(f"[dim red]Error displaying trading status: {e}[/dim red]")

    def _display_live_gap_sr_analysis(self, df):
        """Display live gap-fill analysis with S/R levels"""
        if df.empty:
            return
        
        # Create main table
        table = Table(title="🎯 Live Gap-Fill Opportunities with S/R Analysis", show_header=True, header_style="bold cyan")
        table.add_column("Symbol", style="cyan", no_wrap=True)
        table.add_column("Price", justify="right", style="yellow")
        table.add_column("Gap", justify="right", style="bold")
        table.add_column("Volume", justify="right", style="red")
        table.add_column("Trend", justify="center", style="green")
        table.add_column("Gap Fill", justify="right", style="magenta")
        table.add_column("Next S/R", justify="right", style="blue")
        table.add_column("S/R Prob", justify="right", style="green")
        table.add_column("Signal", justify="center", style="bold")
        
        detailed_analysis = []
        
        for _, row in df.iterrows():
            symbol = row['name']
            current_price = row['close']
            gap_size = row['change']
            vol_ratio = row['relative_volume_10d_calc']
            
            # Determine gap direction
            gap_direction = 'UP' if gap_size > 0 else 'DOWN'
            
            # Get trend analysis (simplified for live monitoring)
            change = row.get('change', 0)
            rsi = row.get('RSI', 50)
            trend_score = 0
            
            if change > 2 and rsi > 60:
                trend_strength = 'bullish'
            elif change < -2 and rsi < 40:
                trend_strength = 'bearish'
            else:
                trend_strength = 'neutral'
            
            # Get S/R levels
            console.print(f"[dim]Analyzing S/R for {symbol}...[/dim]")
            sr_analysis = self.parent._detect_support_resistance_levels(symbol, lookback_days=45)
            console.print(f"[dim]S/R result for {symbol}: {sr_analysis['data_quality']} - {len(sr_analysis['levels'])} levels found[/dim]")
            
            # Get gap fill probability (quick version for live monitoring)
            gap_fill_prob = 50.0  # Default
            try:
                gap_analysis = self._analyze_gap_fill_probability(
                    symbol=symbol,
                    current_gap_size=abs(gap_size),
                    gap_direction=gap_direction,
                    lookback_days=60  # Shorter for speed
                )
                gap_fill_prob = gap_analysis['probability']
            except:
                pass
            
            # Find next significant S/R level
            next_sr_level = None
            sr_probability = 0
            sr_type = ""
            
            if sr_analysis['levels']:
                # Find the closest significant level
                for level_info in sr_analysis['levels'][:3]:  # Check top 3 closest levels
                    if level_info['strength'] in ['strong', 'moderate']:
                        next_sr_level = level_info
                        break
                
                if not next_sr_level and sr_analysis['levels']:
                    next_sr_level = sr_analysis['levels'][0]  # Take closest even if weak
                
                if next_sr_level:
                    sr_probability = self.parent._calculate_trend_target_probability(
                        current_price=current_price,
                        target_price=next_sr_level['price'],
                        trend_strength=trend_strength,
                        gap_direction=gap_direction
                    )
                    sr_type = next_sr_level['type']
            
            # Format display values
            price_display = f"₹{current_price:,.2f}"
            gap_color = "green" if gap_size > 0 else "red"
            gap_display = f"[{gap_color}]{gap_size:+.2f}%[/{gap_color}]"
            vol_display = f"{vol_ratio:.1f}x"
            
            # Trend display
            if trend_strength == 'bullish':
                trend_display = "[green]📈 Bull[/green]"
            elif trend_strength == 'bearish':
                trend_display = "[red]📉 Bear[/red]"
            else:
                trend_display = "[yellow]➡️ Neutral[/yellow]"
            
            # Gap fill probability
            fill_color = "green" if gap_fill_prob >= 60 else "yellow" if gap_fill_prob >= 40 else "red"
            fill_display = f"[{fill_color}]{gap_fill_prob:.0f}%[/{fill_color}]"
            
            # S/R level display
            if next_sr_level:
                sr_emoji = "🔴" if sr_type == "resistance" else "🟢"
                sr_display = f"{sr_emoji} ₹{next_sr_level['price']:.1f} ({next_sr_level['distance_pct']:.1f}%)"
                prob_color = "green" if sr_probability >= 60 else "yellow" if sr_probability >= 40 else "red"
                prob_display = f"[{prob_color}]{sr_probability:.0f}%[/{prob_color}]"
            else:
                sr_display = "[dim]No clear level[/dim]"
                prob_display = "[dim]N/A[/dim]"
            
            # Get reversal analysis for gap-fill trades
            reversal_analysis = None
            if abs(gap_size) >= 0.8:  # Only analyze significant gaps
                console.print(f"[dim]Checking reversal signals for {symbol}...[/dim]")
                reversal_analysis = self._detect_gap_reversal_signals(
                    symbol=symbol,
                    gap_direction=gap_direction,
                    current_price=current_price,
                    gap_size=abs(gap_size)
                )
            
            # Enhanced Trading signal with reversal confirmation
            signal = "[dim]❌ SKIP[/dim]"
            signal_reason = ""
            
            # For gap-fill trades, require reversal confirmation
            if gap_fill_prob >= 60 and reversal_analysis:
                reversal_strength = reversal_analysis['reversal_strength']
                reversal_recommendation = reversal_analysis['recommendation']
                
                if reversal_recommendation in ['STRONG_COUNTER_TRADE', 'MODERATE_COUNTER_TRADE']:
                    # Strong reversal signals detected - safe to counter-trade
                    if gap_direction == 'UP' and sr_type == 'support':
                        signal = f"[bold red]📉 SHORT[/bold red]"
                        signal_reason = f"Reversal confirmed ({reversal_strength} signals)"
                    elif gap_direction == 'DOWN' and sr_type == 'resistance':
                        signal = f"[bold green]📈 LONG[/bold green]"
                        signal_reason = f"Reversal confirmed ({reversal_strength} signals)"
                    elif gap_fill_prob >= 70 and reversal_strength >= 3:
                        if gap_direction == 'UP':
                            signal = "[red]📉 SHORT (Gap Fill + Reversal)[/red]"
                        else:
                            signal = "[green]📈 LONG (Gap Fill + Reversal)[/green]"
                        signal_reason = f"Gap fill + reversal ({reversal_strength} signals)"
                elif reversal_recommendation == 'WEAK_COUNTER_TRADE' and gap_fill_prob >= 75:
                    # Weak reversal but high gap-fill probability
                    if gap_direction == 'UP':
                        signal = "[dim red]📉 WEAK SHORT[/dim red]"
                    else:
                        signal = "[dim green]📈 WEAK LONG[/dim green]"
                    signal_reason = f"Weak reversal, high gap-fill prob"
                else:
                    # No clear reversal - avoid counter-trend trade
                    signal = "[yellow]⚠️ NO REVERSAL[/yellow]"
                    signal_reason = f"Gap continues ({', '.join(reversal_analysis['signals'][:2])})"
            
            # For trend continuation trades (following the gap direction)
            elif sr_probability >= 70 and next_sr_level:
                if sr_type == 'resistance' and gap_direction == 'UP':
                    # Gap up heading to resistance - momentum trade
                    if not reversal_analysis or reversal_analysis['reversal_strength'] < 3:
                        signal = "[green]📈 LONG to R[/green]"
                        signal_reason = "Trend continuation"
                elif sr_type == 'support' and gap_direction == 'DOWN':
                    # Gap down heading to support - momentum trade  
                    if not reversal_analysis or reversal_analysis['reversal_strength'] < 3:
                        signal = "[red]📉 SHORT to S[/red]"
                        signal_reason = "Trend continuation"
            
            # Add reversal signals info to the signal display
            if reversal_analysis and reversal_analysis['signals']:
                top_signals = reversal_analysis['signals'][:2]  # Show top 2 signals
                signal_details = ', '.join(top_signals).replace('_', ' ').title()
                if signal_reason:
                    signal_reason += f" | {signal_details}"
                else:
                    signal_reason = signal_details
            
            # Combine signal and reason for display
            if signal_reason and len(signal_reason) < 50:
                signal_with_reason = f"{signal}\n[dim]{signal_reason}[/dim]"
            else:
                signal_with_reason = signal
            
            table.add_row(
                symbol[:12],
                price_display,
                gap_display,
                vol_display,
                trend_display,
                fill_display,
                sr_display,
                prob_display,
                signal_with_reason
            )
            
            # Store for detailed analysis
            detailed_analysis.append({
                'symbol': symbol,
                'current_price': current_price,
                'gap_size': gap_size,
                'gap_direction': gap_direction,
                'trend': trend_strength,
                'gap_fill_prob': gap_fill_prob,
                'sr_level': next_sr_level,
                'sr_probability': sr_probability,
                'reversal_analysis': reversal_analysis,
                'signal': signal,
                'signal_reason': signal_reason
            })
        
        console.print(table)
        
        # Display paper trading summary if enabled
        if self.parent.paper_trading_enabled:
            self._display_gap_fill_trading_status()
        
        # Display top recommendations
        high_prob_trades = [item for item in detailed_analysis if item['gap_fill_prob'] >= 60 or item['sr_probability'] >= 70]
        
        if high_prob_trades:
            console.print(f"\n[bold yellow]🏆 TOP LIVE RECOMMENDATIONS:[/bold yellow]")
            for i, trade in enumerate(high_prob_trades[:3], 1):
                symbol = trade['symbol']
                gap_size = trade['gap_size']
                gap_prob = trade['gap_fill_prob']
                sr_prob = trade['sr_probability']
                
                if gap_prob >= 60:
                    direction = "SHORT" if trade['gap_direction'] == 'UP' else "LONG"
                    console.print(f"{i}. [cyan]{symbol}[/cyan]: {direction} gap-fill ({gap_size:+.2f}% gap, {gap_prob:.0f}% probability)")
                elif sr_prob >= 70 and trade['sr_level']:
                    sr_type = trade['sr_level']['type']
                    sr_price = trade['sr_level']['price']
                    direction = "LONG" if sr_type == 'resistance' else "SHORT"
                    console.print(f"{i}. [cyan]{symbol}[/cyan]: {direction} to {sr_type} ₹{sr_price:.1f} ({sr_prob:.0f}% probability)")
        
        console.print(f"\n[bold yellow]📊 LEGEND:[/bold yellow]")
        console.print("• [green]Gap Fill:[/green] Probability of gap closing today")
        console.print("• [blue]Next S/R:[/blue] 🔴 Resistance (above) | 🟢 Support (below)")
        console.print("• [green]S/R Prob:[/green] Probability of reaching next S/R level")
        console.print("• [bold]Signal:[/bold] Trading recommendation based on analysis")