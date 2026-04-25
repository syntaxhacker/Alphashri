#!/usr/bin/env python3
"""
Gap Detection Logic
"""

import pandas as pd
from datetime import datetime, timedelta
from rich.console import Console

console = Console()


class GapDetector:
    """Gap detection and analysis methods"""

    def __init__(self, parent_instance):
        self.parent = parent_instance

    def analyze_gap_fill_probability(self, symbol, current_gap_size, gap_direction, lookback_days=90):
        """Analyze historical gap-fill patterns to predict current gap-fill probability"""
        try:
            if not hasattr(self.parent, 'upstox_api') or not self.parent.upstox_api:
                return {'probability': 50.0, 'historical_data': 'unavailable'}
            
            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=lookback_days)).strftime('%Y-%m-%d')
            
            try:
                df = self.parent.upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='days',
                    interval=1,
                    to_date=to_date,
                    from_date=from_date
                )
            except:
                df = self.parent.upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='days', 
                    interval=1,
                    to_date=to_date,
                    from_date=(datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
                )
            
            if df is None or df.empty or len(df) < 10:
                return {'probability': 50.0, 'historical_data': 'insufficient'}
            
            if isinstance(df, list):
                columns = ['timestamp', 'open', 'high', 'low', 'close', 'volume', 'oi']
                df = pd.DataFrame(df, columns=columns)
                df['timestamp'] = pd.to_datetime(df['timestamp'])
                df = df.sort_values('timestamp').reset_index(drop=True)
            else:
                timestamp_col = None
                for col in ['timestamp', 'datetime', 'date', 'time']:
                    if col in df.columns:
                        timestamp_col = col
                        break
                if timestamp_col:
                    df = df.sort_values(timestamp_col).reset_index(drop=True)
                else:
                    df = df.reset_index(drop=True)
            
            df['prev_close'] = df['close'].shift(1)
            df['gap_size'] = ((df['open'] - df['prev_close']) / df['prev_close'] * 100).round(2)
            df['gap_direction'] = df['gap_size'].apply(lambda x: 'UP' if x > 0.5 else 'DOWN' if x < -0.5 else 'NO_GAP')
            
            df['gap_filled'] = False
            df['fill_percentage'] = 0.0
            
            for i in range(1, len(df)):
                if pd.notna(df.loc[i, 'gap_size']) and df.loc[i, 'gap_direction'] != 'NO_GAP':
                    prev_close = df.loc[i-1, 'close']
                    current_open = df.loc[i, 'open']
                    current_high = df.loc[i, 'high']
                    current_low = df.loc[i, 'low']
                    
                    if df.loc[i, 'gap_direction'] == 'UP':
                        if current_low <= prev_close:
                            df.loc[i, 'gap_filled'] = True
                            df.loc[i, 'fill_percentage'] = 100.0
                        else:
                            gap_size_points = current_open - prev_close
                            filled_points = current_open - current_low
                            df.loc[i, 'fill_percentage'] = (filled_points / gap_size_points * 100) if gap_size_points > 0 else 0
                    
                    elif df.loc[i, 'gap_direction'] == 'DOWN':
                        if current_high >= prev_close:
                            df.loc[i, 'gap_filled'] = True
                            df.loc[i, 'fill_percentage'] = 100.0
                        else:
                            gap_size_points = prev_close - current_open
                            filled_points = current_high - current_open
                            df.loc[i, 'fill_percentage'] = (filled_points / gap_size_points * 100) if gap_size_points > 0 else 0
            
            similar_gaps = df[
                (df['gap_direction'] == gap_direction) & 
                (df['gap_direction'] != 'NO_GAP') &
                (abs(df['gap_size']) >= abs(current_gap_size) * 0.5) &
                (abs(df['gap_size']) <= abs(current_gap_size) * 2.0)
            ].copy()
            
            if similar_gaps.empty:
                similar_gaps = df[df['gap_direction'] == gap_direction].copy()
            
            if similar_gaps.empty:
                return {'probability': 50.0, 'historical_data': 'no_similar_gaps'}
            
            total_gaps = len(similar_gaps)
            filled_gaps = similar_gaps['gap_filled'].sum()
            fill_rate = (filled_gaps / total_gaps * 100) if total_gaps > 0 else 50.0
            avg_fill_percentage = similar_gaps['fill_percentage'].mean()
            
            size_multiplier = 1.0
            if abs(current_gap_size) > 5:
                size_multiplier = 0.8
            elif abs(current_gap_size) > 3:
                size_multiplier = 0.9
            elif abs(current_gap_size) < 1:
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

    def detect_gap_reversal_signals(self, symbol, gap_direction, current_price, gap_size):
        """Detect if a gap is showing reversal/exhaustion signals for safe counter-trend trading"""
        try:
            if not hasattr(self.parent, 'upstox_api') or not self.parent.upstox_api:
                return {'reversal_strength': 0, 'signals': [], 'recommendation': 'SKIP'}
            
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
                df_5min = self.parent.upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='minutes',
                    interval=15,
                    to_date=today,
                    from_date=today
                )
            
            if df_5min is None or df_5min.empty or len(df_5min) < 5:
                return {'reversal_strength': 0, 'signals': ['no_intraday_data'], 'recommendation': 'SKIP'}
            
            signals = []
            reversal_strength = 0
            
            recent_data = df_5min.tail(5).reset_index(drop=True)
            latest_candle = recent_data.iloc[-1]
            prev_candle = recent_data.iloc[-2] if len(recent_data) > 1 else latest_candle
            
            if len(recent_data) >= 3:
                recent_volume = recent_data['volume'].tail(3).mean()
                earlier_volume = recent_data['volume'].head(2).mean() if len(recent_data) >= 5 else recent_volume
                
                if recent_volume < earlier_volume * 0.7:
                    signals.append('volume_exhaustion')
                    reversal_strength += 2
            
            open_price = latest_candle['open']
            high_price = latest_candle['high'] 
            low_price = latest_candle['low']
            close_price = latest_candle['close']
            
            body_size = abs(close_price - open_price)
            upper_wick = high_price - max(open_price, close_price)
            lower_wick = min(open_price, close_price) - low_price
            candle_range = high_price - low_price
            
            if gap_direction == 'UP':
                if upper_wick > body_size * 2 and body_size < candle_range * 0.3:
                    signals.append('shooting_star_doji')
                    reversal_strength += 3
                
                if close_price < open_price:
                    signals.append('failed_to_hold_highs')
                    reversal_strength += 2
                
                if len(recent_data) >= 2 and high_price < prev_candle['high']:
                    signals.append('lower_high')
                    reversal_strength += 1
                
                if latest_candle['volume'] > recent_data['volume'].mean() * 1.5 and close_price < high_price * 0.98:
                    signals.append('volume_rejection')
                    reversal_strength += 2
                    
            elif gap_direction == 'DOWN':
                if lower_wick > body_size * 2 and body_size < candle_range * 0.3:
                    signals.append('hammer_doji')
                    reversal_strength += 3
                
                if close_price > open_price:
                    signals.append('failed_to_hold_lows')
                    reversal_strength += 2
                
                if len(recent_data) >= 2 and low_price > prev_candle['low']:
                    signals.append('higher_low')
                    reversal_strength += 1
                
                if latest_candle['volume'] > recent_data['volume'].mean() * 1.5 and close_price > low_price * 1.02:
                    signals.append('volume_bounce')
                    reversal_strength += 2
            
            if len(recent_data) >= 4:
                day_open = recent_data.iloc[0]['open']
                current_move = abs(close_price - day_open) / day_open * 100
                
                if current_move > abs(gap_size) * 1.5:
                    signals.append('overextended_move')
                    reversal_strength += 1
            
            if len(df_5min) > 12:
                current_hour = datetime.now().hour
                if current_hour >= 11:
                    if gap_size > 5:
                        signals.append('time_exhaustion')
                        reversal_strength += 1
            
            if reversal_strength >= 5:
                recommendation = 'STRONG_COUNTER_TRADE'
            elif reversal_strength >= 3:
                recommendation = 'MODERATE_COUNTER_TRADE'
            elif reversal_strength >= 1:
                recommendation = 'WEAK_COUNTER_TRADE'
            else:
                recommendation = 'SKIP'
            
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

    def get_volume_movers_with_gaps(self):
        """Get current volume movers that have significant gaps"""
        try:
            from tradingview_screener import Query, col
            total_rows, df = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                       'RSI', 'market_cap_basic', 'update_mode')
                .set_markets(self.parent.market)
                .where(
                    col('close') > 30,
                    col('volume') > 500000,
                    col('relative_volume_10d_calc') > 1.5,
                    col('market_cap_basic') > 5e7,
                    col('exchange') == 'NSE'
                )
                .order_by('relative_volume_10d_calc', ascending=False)
                .limit(10)
                .get_scanner_data(cookies=self.parent.cookies)
            )
            
            if not df.empty:
                df = df[df['change'].abs() >= 0.8].copy()
            
            return df
            
        except Exception as e:
            console.print(f"[red]Error fetching volume movers: {e}[/red]")
            return pd.DataFrame()

    def get_enhanced_gap_opportunities(self):
        """Enhanced gap screening with multiple criteria beyond just volume movers"""
        all_opportunities = []
        
        try:
            console.print("[dim]🔍 Scanning high volume gap stocks...[/dim]")
            volume_gaps = self.get_volume_movers_with_gaps()
            if not volume_gaps.empty:
                volume_gaps['source'] = 'volume_mover'
                all_opportunities.append(volume_gaps)
            
            console.print("[dim]🔍 Scanning large-cap liquid gaps...[/dim]")
            from tradingview_screener import Query, col
            total_rows, largecap_gaps = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                       'RSI', 'market_cap_basic', 'update_mode')
                .set_markets(self.parent.market)
                .where(
                    col('close') > 50,
                    col('market_cap_basic') > 1e9,
                    col('volume') > 1000000,
                    (col('change') > 1.2) | (col('change') < -1.2),
                    col('exchange') == 'NSE'
                )
                .order_by('market_cap_basic', ascending=False)
                .limit(8)
                .get_scanner_data(cookies=self.parent.cookies)
            )
            
            if not largecap_gaps.empty:
                largecap_gaps['source'] = 'large_cap_gap'
                existing_names = volume_gaps['name'].tolist() if not volume_gaps.empty else []
                largecap_gaps = largecap_gaps[~largecap_gaps['name'].isin(existing_names)]
                if not largecap_gaps.empty:
                    all_opportunities.append(largecap_gaps)
            
            console.print("[dim]🔍 Scanning momentum continuation gaps...[/dim]")
            total_rows, momentum_gaps = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                       'RSI', 'market_cap_basic', 'update_mode')
                .set_markets(self.parent.market)
                .where(
                    col('close') > 40,
                    col('market_cap_basic') > 2e8,
                    col('volume') > 300000,
                    (col('change') > 2.0) | (col('change') < -2.0),
                    col('RSI') > 70,
                    col('exchange') == 'NSE'
                )
                .order_by('change', ascending=False)
                .limit(5)
                .get_scanner_data(cookies=self.parent.cookies)
            )
            
            if not momentum_gaps.empty:
                momentum_gaps['source'] = 'momentum_gap'
                existing_names = []
                for opp in all_opportunities:
                    existing_names.extend(opp['name'].tolist())
                momentum_gaps = momentum_gaps[~momentum_gaps['name'].isin(existing_names)]
                if not momentum_gaps.empty:
                    all_opportunities.append(momentum_gaps)
            
            console.print("[dim]🔍 Scanning oversold bounce opportunities...[/dim]")
            total_rows, oversold_gaps = (
                Query()
                .select('name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                       'RSI', 'market_cap_basic', 'update_mode')
                .set_markets(self.parent.market)
                .where(
                    col('close') > 40,
                    col('market_cap_basic') > 5e8,
                    col('volume') > 500000,
                    col('change') < -1.5,
                    col('RSI') < 40,
                    col('exchange') == 'NSE'
                )
                .order_by('change', ascending=True)
                .limit(5)
                .get_scanner_data(cookies=self.parent.cookies)
            )
            
            if not oversold_gaps.empty:
                oversold_gaps['source'] = 'oversold_bounce'
                existing_names = []
                for opp in all_opportunities:
                    existing_names.extend(opp['name'].tolist())
                oversold_gaps = oversold_gaps[~oversold_gaps['name'].isin(existing_names)]
                if not oversold_gaps.empty:
                    all_opportunities.append(oversold_gaps)
            
            if all_opportunities:
                combined_df = pd.concat(all_opportunities, ignore_index=True)
                combined_df['gap_quality_score'] = self.calculate_gap_quality_score(combined_df)
                combined_df = combined_df.sort_values('gap_quality_score', ascending=False)
                return combined_df.head(15)
            else:
                return pd.DataFrame()
                
        except Exception as e:
            console.print(f"[red]Error in enhanced gap screening: {e}[/red]")
            return self.get_volume_movers_with_gaps()

    def calculate_gap_quality_score(self, df):
        """Calculate a quality score for gap opportunities"""
        scores = []
        
        for _, row in df.iterrows():
            score = 0
            
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
            
            vol_ratio = row.get('relative_volume_10d_calc', 1)
            if vol_ratio >= 3:
                score += 3
            elif vol_ratio >= 2:
                score += 2
            elif vol_ratio >= 1.5:
                score += 1
            
            market_cap = row.get('market_cap_basic', 0)
            if market_cap >= 5e9:
                score += 3
            elif market_cap >= 1e9:
                score += 2
            elif market_cap >= 5e8:
                score += 1
            
            price = row.get('close', 0)
            if price >= 100:
                score += 2
            elif price >= 50:
                score += 1
            
            source = row.get('source', '')
            if source == 'large_cap_gap':
                score += 1
            elif source == 'momentum_gap':
                score += 1
            
            scores.append(score)
        
        return scores
