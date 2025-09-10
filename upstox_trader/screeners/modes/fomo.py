"""
FOMO Trading Strategy Module
============================

This module contains various FOMO-based trading strategies.
"""

from rich.panel import Panel
from rich.console import Console
from tradingview_screener import Query, col

console = Console()

def _detect_alerts(self, current_data, previous_data, volume_threshold, price_threshold):
    """Detect volume spikes and price movements with cooldown protection"""
    alerts = []
    
    if previous_data.empty:
        return alerts
        
    for _, row in current_data.iterrows():
        ticker = row['ticker']
        
        # Volume spike alert
        if row['relative_volume_10d_calc'] > volume_threshold:
            prev_vol = previous_data[previous_data['ticker'] == ticker]['relative_volume_10d_calc'].values
            if len(prev_vol) > 0 and row['relative_volume_10d_calc'] > prev_vol[0] * 1.2:
                
                # Check cooldown
                should_skip, time_diff, skip_reason = self._should_skip_alert(ticker, 'VOLUME_SPIKE')
                if should_skip:
                    if "STOP_LOSS_COOLDOWN" in skip_reason:
                        console.print(f"[dim red]⏳ Skipping {ticker} VOLUME_SPIKE - {skip_reason}[/dim red]")
                    else:
                        console.print(f"[dim]⏳ Skipping {ticker} VOLUME_SPIKE (cooldown: {self.alert_cooldown - time_diff:.0f}s left)[/dim]")
                    continue
                
                # Calculate confidence
                confidence = self._calculate_alert_confidence('VOLUME_SPIKE', row['relative_volume_10d_calc'], row['change'], row.get('RSI', None))
                
                # Only send if confidence is high enough (relaxed for FOMO mode)
                if confidence >= 0.3:  # 30% minimum confidence
                    alert = {
                        'type': 'VOLUME_SPIKE',
                        'ticker': ticker,
                        'name': row['name'],
                        'current_volume_ratio': row['relative_volume_10d_calc'],
                        'previous_volume_ratio': prev_vol[0] if len(prev_vol) > 0 else 0,
                        'price': row['close'],
                        'change': row['change'],
                        'confidence': confidence
                    }
                    alerts.append(alert)
                    
                    # Record alert time to prevent spam
                    self.last_alert_time[f"{ticker}_VOLUME_SPIKE"] = datetime.now()
                else:
                    console.print(f"[yellow]⚠️ Alert confidence too low ({confidence:.0%}) - skipping {ticker}[/yellow]")
        
        # Price movement alert
        if abs(row['change']) > price_threshold:
            prev_change = previous_data[previous_data['ticker'] == ticker]['change'].values
            if len(prev_change) > 0 and abs(row['change']) > abs(prev_change[0]) * 1.1:
                
                # Check cooldown
                should_skip, time_diff, skip_reason = self._should_skip_alert(ticker, 'PRICE_MOVE')
                if should_skip:
                    if "STOP_LOSS_COOLDOWN" in skip_reason:
                        console.print(f"[dim red]⏳ Skipping {ticker} PRICE_MOVE - {skip_reason}[/dim red]")
                    else:
                        console.print(f"[dim]⏳ Skipping {ticker} PRICE_MOVE (cooldown: {self.alert_cooldown - time_diff:.0f}s left)[/dim]")
                    continue
                
                # Calculate confidence
                confidence = self._calculate_alert_confidence('PRICE_MOVE', row['relative_volume_10d_calc'], row['change'], row.get('RSI', None))
                
                # Only send if confidence is high enough (relaxed for FOMO mode)
                if confidence >= 0.3:  # 30% minimum confidence
                    alert = {
                        'type': 'PRICE_MOVE',
                        'ticker': ticker,
                        'name': row['name'],
                        'current_change': row['change'],
                        'previous_change': prev_change[0] if len(prev_change) > 0 else 0,
                        'price': row['close'],
                        'volume_ratio': row['relative_volume_10d_calc'],
                        'confidence': confidence
                    }
                    alerts.append(alert)
                    
                    # Record alert time to prevent spam
                    self.last_alert_time[f"{ticker}_PRICE_MOVE"] = datetime.now()
                else:
                    console.print(f"[yellow]⚠️ Alert confidence too low ({confidence:.0%}) - skipping {ticker}[/yellow]")
        
        # Enhanced Smart FOMO alert - IMPROVED TIMING for better entries
        watch_mode = getattr(self, 'watch_mode', 'PREBREAKOUT')
        
        # IMPROVED TIMING: Check for different entry opportunities based on timing
        pre_breakout_detected = self._detect_pre_breakout_volume(ticker, row)
        pullback_entry_detected = self._detect_pullback_entry(ticker, row)
        momentum_cooled = self._check_momentum_cooling(ticker, row)
        
        # Original FOMO conditions (now as fallback for existing strong signals)
        original_fomo = (row['relative_volume_10d_calc'] > max(volume_threshold, 2.0) and  
                       (row['change'] > 1 or row['change'] < -1) and
                       self._check_not_buying_at_top(ticker, row))
        
        # SMART_FOMO triggers on ANY of these improved timing conditions
        smart_fomo_trigger = (
            pre_breakout_detected or           # BEST: Early volume building
            pullback_entry_detected or         # GOOD: Pullback to support  
            momentum_cooled or                 # SAFE: Momentum has cooled
            (original_fomo and self._check_historical_upside(ticker, row['close']))  # FALLBACK: Original logic
        )
        
        if (smart_fomo_trigger and  
            self._check_momentum_divergence(ticker, row, previous_data)):  # Quality check
            
            # Check cooldown - REMOVED: No restrictions for SMART_FOMO
            # should_skip, time_diff, skip_reason = self._should_skip_alert(ticker, 'SMART_FOMO')
            # if should_skip:
            #     if "STOP_LOSS_COOLDOWN" in skip_reason:
            #         console.print(f"[dim red]⏳ Skipping {ticker} SMART_FOMO - {skip_reason}[/dim red]")
            #     else:
            #         console.print(f"[dim]⏳ Skipping {ticker} SMART_FOMO (cooldown: {self.alert_cooldown - time_diff:.0f}s left)[/dim]")
            #     continue
            
            # Determine which timing condition triggered for better tracking
            timing_type = "ORIGINAL"
            if pre_breakout_detected:
                timing_type = "PRE_BREAKOUT"
                confidence = self._calculate_alert_confidence('SMART_FOMO', row['relative_volume_10d_calc'], row['change'], row.get('RSI', None)) + 0.15  # Bonus for early entry
            elif pullback_entry_detected:
                timing_type = "PULLBACK"
                confidence = self._calculate_alert_confidence('SMART_FOMO', row['relative_volume_10d_calc'], row['change'], row.get('RSI', None)) + 0.10  # Bonus for pullback
            elif momentum_cooled:
                timing_type = "COOLED"
                confidence = self._calculate_alert_confidence('SMART_FOMO', row['relative_volume_10d_calc'], row['change'], row.get('RSI', None)) + 0.05  # Small bonus for cooled
            else:
                confidence = self._calculate_alert_confidence('SMART_FOMO', row['relative_volume_10d_calc'], row['change'], row.get('RSI', None))
            
            # Cap confidence at 95%
            confidence = min(confidence, 0.95)
            
            # Adjust minimum confidence based on timing quality (from config)
            min_confidence = (self.config.signal_filtering.min_confidence_prebreak_pullback 
                            if timing_type in ["PRE_BREAKOUT", "PULLBACK"] 
                            else self.config.signal_filtering.min_confidence_regular)
            
            if confidence >= min_confidence:
                alert = {
                    'type': 'SMART_FOMO',
                    'ticker': ticker,
                    'name': row['name'],
                    'volume_ratio': row['relative_volume_10d_calc'],
                    'price': row['close'],
                    'change': row['change'],
                    'upside_potential': f'Validated-{timing_type}',
                    'confidence': confidence,
                    'timing_type': timing_type
                }
                alerts.append(alert)
                
                # Record alert time to prevent spam - REMOVED: No restrictions for SMART_FOMO
                # self.last_alert_time[f"{ticker}_SMART_FOMO"] = datetime.now()
            else:
                console.print(f"[yellow]⚠️ Alert confidence too low ({confidence:.0%}) - skipping {ticker}[/yellow]")
        
        # Mode-specific alerts - each mode has its own logic matching its purpose
        if watch_mode == 'MOMENTUM':
            # Early momentum: RSI improving + small moves before big ones
            rsi_current = row.get('RSI', 50)
            rsi_prev = row.get('RSI[1]', 50)
            macd = row.get('MACD.macd', 0)
            macd_signal = row.get('MACD.signal', 0)
            
            if (0.5 <= row['change'] <= 4 and  # Small positive moves (before FOMO)
                1.1 <= row['relative_volume_10d_calc'] <= 2.5 and  # Slightly elevated volume
                35 <= rsi_current <= 70 and  # RSI sweet spot
                rsi_current > rsi_prev and  # RSI improving
                macd > macd_signal):  # MACD bullish
                
                should_skip, time_diff, skip_reason = self._should_skip_alert(ticker, 'EARLY_MOMENTUM')
                if not should_skip:
                    confidence = self._calculate_alert_confidence('EARLY_MOMENTUM', row['relative_volume_10d_calc'], row['change'], rsi_current)
                    if confidence >= 0.25:
                        alert = {
                            'type': 'EARLY_MOMENTUM',
                            'ticker': ticker,
                            'name': row['name'],
                            'volume_ratio': row['relative_volume_10d_calc'],
                            'price': row['close'],
                            'change': row['change'],
                            'rsi': rsi_current,
                            'rsi_trend': 'Improving' if rsi_current > rsi_prev else 'Stable',
                            'confidence': confidence
                        }
                        alerts.append(alert)
                        self.last_alert_time[f"{ticker}_EARLY_MOMENTUM"] = datetime.now()
        
        elif watch_mode == 'ACCUMULATION':
            # Accumulation: Normal volume, controlled price, building strength
            if (0.8 <= row['relative_volume_10d_calc'] <= 1.8 and  # Normal volume (accumulation)
                -2 <= row['change'] <= 3 and  # Controlled price movement
                40 <= row.get('RSI', 50) <= 65 and  # Building strength
                row['close'] > row.get('EMA20', row['close'])):  # Above trend
                
                should_skip, time_diff, skip_reason = self._should_skip_alert(ticker, 'ACCUMULATION')
                if not should_skip:
                    confidence = self._calculate_alert_confidence('ACCUMULATION', row['relative_volume_10d_calc'], row['change'], row.get('RSI', None))
                    if confidence >= 0.25:
                        alert = {
                            'type': 'ACCUMULATION',
                            'ticker': ticker,
                            'name': row['name'],
                            'volume_ratio': row['relative_volume_10d_calc'],
                            'price': row['close'],
                            'change': row['change'],
                            'rsi': row.get('RSI', 0),
                            'trend': 'Above EMA20',
                            'confidence': confidence
                        }
                        alerts.append(alert)
                        self.last_alert_time[f"{ticker}_ACCUMULATION"] = datetime.now()
        
        elif watch_mode == 'PREBREAKOUT':
            # Pre-breakout: High RSI, building volume, testing resistance
            if (1.2 <= row['relative_volume_10d_calc'] <= 3.0 and  # Building volume
                1 <= row['change'] <= 5 and  # Moderate positive moves
                65 <= row.get('RSI', 50) <= 85):  # High RSI (pre-breakout)
                
                should_skip, time_diff, skip_reason = self._should_skip_alert(ticker, 'PREBREAKOUT')
                if not should_skip:
                    confidence = self._calculate_alert_confidence('PREBREAKOUT', row['relative_volume_10d_calc'], row['change'], row.get('RSI', None))
                    if confidence >= 0.25:
                        alert = {
                            'type': 'PREBREAKOUT',
                            'ticker': ticker,
                            'name': row['name'],
                            'volume_ratio': row['relative_volume_10d_calc'],
                            'price': row['close'],
                            'change': row['change'],
                            'rsi': row.get('RSI', 0),
                            'status': 'Testing Resistance',
                            'confidence': confidence
                        }
                        alerts.append(alert)
                        self.last_alert_time[f"{ticker}_PREBREAKOUT"] = datetime.now()
        
        elif watch_mode == 'OPTIMIZED_GAP':
            # Gap strategy: Quality gaps with momentum continuation
            week_high = row.get('price_52_week_high', row['close'] * 2)
            distance_from_high = (week_high - row['close']) / week_high * 100
            
            if (1 <= row['change'] <= 15 and  # Quality gap range
                row['relative_volume_10d_calc'] > 1.5 and  # Volume confirmation
                distance_from_high > 20 and  # Not at 52-week high
                row.get('Volatility.D', 0) < 0.08):  # Not too volatile
                
                should_skip, time_diff, skip_reason = self._should_skip_alert(ticker, 'GAP_BREAKOUT')
                if not should_skip:
                    confidence = self._calculate_alert_confidence('GAP_BREAKOUT', row['relative_volume_10d_calc'], row['change'], row.get('RSI', None))
                    if confidence >= 0.25:
                        alert = {
                            'type': 'GAP_BREAKOUT',
                            'ticker': ticker,
                            'name': row['name'],
                            'volume_ratio': row['relative_volume_10d_calc'],
                            'price': row['close'],
                            'change': row['change'],
                            'gap_quality': 'Quality Gap',
                            'confidence': confidence
                        }
                        alerts.append(alert)
                        self.last_alert_time[f"{ticker}_GAP_BREAKOUT"] = datetime.now()
        
        elif watch_mode == 'HEAVY_BREAKOUT':
            # Heavy Breakout: Real-time channel analysis with support/resistance levels
            breakout_score = row.get('breakout_score', 0)
            active_channels = row.get('active_channels', 0)
            recent_breakouts = row.get('recent_breakouts', 0)
            support_level = row.get('support_level')
            resistance_level = row.get('resistance_level')
            breakout_type = row.get('breakout_type')
            breakout_strength = row.get('breakout_strength', 0)
            
            # Enhanced criteria using real-time channel analysis
            if (breakout_score > 40 and  # High breakout potential from channel analysis
                (recent_breakouts > 0 or active_channels > 0) and  # Has patterns
                row['relative_volume_10d_calc'] > 1.2 and  # Volume confirmation
                abs(row['change']) >= 1):  # Meaningful price movement
                
                should_skip, time_diff, skip_reason = self._should_skip_alert(ticker, 'HEAVY_BREAKOUT')
                if not should_skip:
                    # Calculate enhanced confidence based on channel analysis
                    confidence = min(0.95, (breakout_score / 100) + 0.3)
                    
                    # Determine trade direction and levels
                    if recent_breakouts > 0 and breakout_type:
                        if breakout_type == 'bullish':
                            trade_direction = 'LONG'
                            entry_level = resistance_level
                            stop_loss = support_level
                            target = resistance_level + ((resistance_level - support_level) * 1.5) if support_level and resistance_level else None
                        else:  # bearish
                            trade_direction = 'SHORT'
                            entry_level = support_level
                            stop_loss = resistance_level
                            target = support_level - ((resistance_level - support_level) * 1.5) if support_level and resistance_level else None
                    else:
                        # Active channel - wait for breakout
                        trade_direction = 'WATCH'
                        entry_level = row['close']
                        stop_loss = None
                        target = None
                    
                    alert = {
                        'type': 'HEAVY_BREAKOUT',
                        'ticker': ticker,
                        'name': row['name'],
                        'volume_ratio': row['relative_volume_10d_calc'],
                        'price': row['close'],
                        'change': row['change'],
                        'breakout_score': breakout_score,
                        'pattern': f"{breakout_type.title()} Breakout" if breakout_type else "Channel Setup",
                        'confidence': confidence,
                        # Trading levels
                        'trade_direction': trade_direction,
                        'support_level': support_level,
                        'resistance_level': resistance_level,
                        'entry_level': entry_level,
                        'stop_loss': stop_loss,
                        'target': target,
                        'breakout_strength': breakout_strength,
                        'active_channels': active_channels,
                        'recent_breakouts': recent_breakouts
                    }
                    alerts.append(alert)
                    self.last_alert_time[f"{ticker}_HEAVY_BREAKOUT"] = datetime.now()
        
        elif watch_mode == 'FOMO_MOMENTUM':
            # FOMO Momentum: Directional momentum trading on 0.8-6% moves
            change_pct = row['change']
            volume_ratio = row['relative_volume_10d_calc']
            rsi_current = row.get('RSI', 50)
            
            # Check if this matches our momentum criteria (same as mode definition)
            if ((0.8 <= change_pct <= 6.0) or (-6.0 <= change_pct <= -0.8)) and \
               volume_ratio > 1.3 and \
               35 <= rsi_current <= 75 and \
               row.get('Volatility.D', 0) > 0.02:
                
                should_skip, time_diff, skip_reason = self._should_skip_alert(ticker, 'FOMO_MOMENTUM')
                if not should_skip:
                    # Determine direction and calculate confidence
                    direction = 'LONG' if change_pct > 0 else 'SHORT'
                    
                    # Enhanced confidence based on momentum strength and volume
                    base_confidence = min(abs(change_pct) / 6.0, 1.0)  # Stronger moves = higher confidence
                    volume_boost = min((volume_ratio - 1.3) / 2.0, 0.3)  # Volume adds up to 30% confidence
                    rsi_factor = 1.0 if 45 <= rsi_current <= 65 else 0.8  # Optimal RSI range
                    
                    confidence = min(0.95, (base_confidence + volume_boost) * rsi_factor)
                    
                    if confidence >= 0.3:  # Relaxed confidence threshold for momentum trades
                        alert = {
                            'type': 'FOMO_MOMENTUM',
                            'ticker': ticker,
                            'name': row['name'],
                            'volume_ratio': volume_ratio,
                            'price': row['close'],
                            'change': change_pct,
                            'direction': direction,
                            'rsi': rsi_current,
                            'volatility': row.get('Volatility.D', 0) * 100,
                            'confidence': confidence
                        }
                        alerts.append(alert)
                        self.last_alert_time[f"{ticker}_FOMO_MOMENTUM"] = datetime.now()
        
        elif watch_mode == 'REALTIME_MOMENTUM':
            # REALTIME Momentum: Continuous price action detection on short intervals
            if hasattr(self, 'momentum_signals') and ticker in self.momentum_signals:
                signal_info = self.momentum_signals[ticker]
                
                # Check if we have a valid momentum signal
                if (signal_info['consecutive_count'] >= 3 and  # Minimum consecutive moves
                    signal_info['direction'] != 'NEUTRAL' and  # Clear direction
                    signal_info['last_signal_time'] and
                    (datetime.now() - signal_info['last_signal_time']).total_seconds() < 300):  # Signal is recent (5 min)
                    
                    should_skip, time_diff, skip_reason = self._should_skip_alert(ticker, 'REALTIME_MOMENTUM')
                    if not should_skip:
                        # Calculate momentum strength from recent data
                        history = self.momentum_history.get(ticker, [])
                        momentum_strength = 0.0
                        if len(history) >= 2:
                            # Calculate average price change over recent intervals
                            recent_moves = []
                            for i in range(1, min(len(history), 5)):
                                prev_price = history[i-1][1]
                                curr_price = history[i][1]
                                move_pct = abs((curr_price - prev_price) / prev_price) * 100
                                recent_moves.append(move_pct)
                            momentum_strength = sum(recent_moves) / len(recent_moves) if recent_moves else 0.0
                        
                        # Enhanced confidence based on consecutive count and momentum strength
                        base_confidence = min(signal_info['consecutive_count'] / 5.0, 0.8)  # Up to 80% from consecutive moves
                        strength_boost = min(momentum_strength / 2.0, 0.15)  # Up to 15% from momentum strength
                        volume_factor = min(row['relative_volume_10d_calc'] / 2.0, 0.05)  # Small volume boost
                        
                        confidence = min(0.95, base_confidence + strength_boost + volume_factor)
                        
                        if confidence >= 0.35:  # Relaxed confidence threshold for real-time momentum
                            alert = {
                                'type': 'REALTIME_MOMENTUM',
                                'ticker': ticker,
                                'name': row['name'],
                                'volume_ratio': row['relative_volume_10d_calc'],
                                'price': row['close'],
                                'change': row['change'],
                                'direction': signal_info['direction'],
                                'consecutive_moves': signal_info['consecutive_count'],
                                'momentum_strength': momentum_strength,
                                'confidence': confidence
                            }
                            alerts.append(alert)
                            self.last_alert_time[f"{ticker}_REALTIME_MOMENTUM"] = datetime.now()
        
        elif watch_mode == 'SR_LEVELS_BREAK':
            # SR Levels Break: Detect aggressive breakouts of support/resistance levels
            current_price = row['close']
            volume_ratio = row.get('relative_volume_10d_calc', 1.0)
            change_pct = row.get('change', 0)
            
            # Get S/R levels for the symbol
            sr_analysis = self._detect_support_resistance_levels(ticker, lookback_days=30)
            
            if sr_analysis['levels']:
                for level_info in sr_analysis['levels']:
                    level_price = level_info['price']
                    level_type = level_info['type']
                    distance_from_level_pct = ((current_price - level_price) / level_price) * 100
                    
                    # Aggressive breakout criteria
                    # Price has moved significantly past the level AND high volume
                    aggressive_break_threshold_pct = 0.5  # 0.5% break beyond the level
                    min_volume_for_break = 2.0 # Minimum 2x relative volume for a break
                    
                    should_trigger = False
                    action_type = None
                    
                    if level_type == 'resistance' and distance_from_level_pct >= aggressive_break_threshold_pct:
                        # Aggressive long: Price breaks resistance and stays above
                        if volume_ratio >= min_volume_for_break:
                            should_trigger = True
                            action_type = 'LONG'
                            console.print(f"[green]📈 {ticker}: AGGRESSIVE LONG - Broke Resistance at ₹{level_price:.2f}[/green]")
                    elif level_type == 'support' and distance_from_level_pct <= -aggressive_break_threshold_pct:
                        # Aggressive short: Price breaks support and stays below
                        if volume_ratio >= min_volume_for_break:
                            should_trigger = True
                            action_type = 'SHORT'
                            console.print(f"[red]📉 {ticker}: AGGRESSIVE SHORT - Broke Support at ₹{level_price:.2f}[/red]")
                    
                    if should_trigger:
                        should_skip, time_diff, skip_reason = self._should_skip_alert(ticker, 'SR_LEVELS_BREAK')
                        if not should_skip:
                            confidence = self._calculate_alert_confidence(
                                'SR_LEVELS_BREAK', volume_ratio, change_pct, row.get('RSI', None)
                            )
                            # Boost confidence for aggressive breaks
                            confidence = min(0.95, confidence + 0.15)
                            
                            if confidence >= 0.6: # High confidence required for aggressive trades
                                alert = {
                                    'type': 'SR_LEVELS_BREAK',
                                    'ticker': ticker,
                                    'name': row['name'],
                                    'price': current_price,
                                    'change': change_pct,
                                    'volume_ratio': volume_ratio,
                                    'level_broken': level_price,
                                    'level_type': level_type,
                                    'action_type': action_type,
                                    'confidence': confidence
                                }
                                alerts.append(alert)
                                self.last_alert_time[f"{ticker}_SR_LEVELS_BREAK"] = datetime.now()
                            else:
                                console.print(f"[yellow]⚠️ {ticker}: SR Levels Break signal confidence too low ({confidence:.0%})[/yellow]")
    
    # Universal overbought short detection - available in all modes
    for _, row in current_data.iterrows():
        ticker = row['ticker']
        rsi = row.get('RSI', 50)
        change_pct = row.get('change', 0)
        volume_ratio = row.get('relative_volume_10d_calc', 1.0)
        
        # Check for overbought short opportunities with confirmed downtrend (from config)
        if (rsi >= self.config.signal_filtering.overbought_rsi_threshold and  # Overbought RSI
            volume_ratio >= self.config.signal_filtering.min_volume_ratio and  # Decent volume  
            change_pct > self.config.signal_filtering.min_change_overbought):  # Stock has moved up (potential reversal)
            
            # RELAXED downtrend requirement for FOMO mode
            confirmed_downtrend = self._check_confirmed_downtrend_for_short(ticker, row)
            if not confirmed_downtrend and rsi < 85:  # Only require confirmation for less extreme RSI
                console.print(f"[yellow]⚠️ {ticker}: Overbought but no confirmed downtrend - skipping short[/yellow]")
                continue
            
            should_skip, time_diff, skip_reason = self._should_skip_alert(ticker, 'OVERBOUGHT_SHORT')
            if not should_skip:
                # Get 15min RSI for intraday confirmation
                rsi_15min = self._get_15min_rsi(ticker)
                
                # Use overextended check for additional confirmation
                is_overextended = self._is_overextended_for_short(ticker)
                
                # Enhanced logic: Require 15min RSI confirmation if available
                rsi_confirmed = True  # Default to allow signal
                if rsi_15min is not None:
                    # 15min RSI should also be overbought for strong confirmation (from config)
                    rsi_confirmed = rsi_15min >= self.config.signal_filtering.min_15_rsi_confirmation
                    console.print(f"[dim yellow]📊 {ticker}: Daily RSI {rsi:.1f}, 15min RSI {rsi_15min:.1f}[/dim yellow]")
                
                if rsi_confirmed:
                    # Calculate confidence for short signal (boost if 15min confirms)
                    confidence = self._calculate_short_confidence(rsi, change_pct, volume_ratio, is_overextended)
                    if rsi_15min is not None and rsi_15min >= self.config.signal_filtering.strong_15_rsi_threshold:
                        confidence += self.config.signal_filtering.confidence_bonus  # Bonus for strong 15min confirmation
                    
                    if confidence >= self.config.signal_filtering.min_confidence_short:
                        alert = {
                            'type': 'OVERBOUGHT_SHORT',
                            'ticker': ticker,
                            'name': row['name'],
                            'volume_ratio': volume_ratio,
                            'price': row['close'],
                            'change': change_pct,
                            'rsi': rsi,
                            'rsi_15min': rsi_15min,
                            'reason': '15min RSI Confirmed' if rsi_15min else 'Daily RSI Only',
                            'confidence': confidence,
                            'is_overextended': is_overextended
                        }
                        alerts.append(alert)
                        self.last_alert_time[f"{ticker}_OVERBOUGHT_SHORT"] = datetime.now()
                        
                        # Enhanced logging with both RSI values
                        rsi_str = f"Daily {rsi:.1f}"
                        if rsi_15min:
                            rsi_str += f", 15min {rsi_15min:.1f}"
                        console.print(f"[red]🔴 {ticker}: OVERBOUGHT SHORT - {rsi_str}, +{change_pct:.1f}%, {volume_ratio:.1f}x vol[/red]")
                    else:
                        console.print(f"[yellow]⚠️ {ticker}: Overbought but confidence too low ({confidence:.0%})[/yellow]")
                else:
                    console.print(f"[yellow]⚠️ {ticker}: Daily RSI {rsi:.1f} overbought but 15min RSI {rsi_15min:.1f} not confirmed[/yellow]")
    
    return alerts

def _should_skip_alert(self, ticker, alert_type):
    """Check if we should skip this alert due to cooldown"""
    current_time = datetime.now()
    alert_key = f"{ticker}_{alert_type}"
    
    # First check if symbol hit stop loss recently (30-minute cooldown)
    if ticker in self.stop_loss_cooldown:
        stop_loss_time_diff = (current_time - self.stop_loss_cooldown[ticker]).total_seconds()
        if stop_loss_time_diff < self.stop_loss_cooldown_duration:
            cooldown_left = self.stop_loss_cooldown_duration - stop_loss_time_diff
            return True, stop_loss_time_diff, f"STOP_LOSS_COOLDOWN ({cooldown_left/60:.0f}m left)"
    
    # Check if this exact alert was sent recently
    if alert_key in self.last_alert_time:
        time_diff = (current_time - self.last_alert_time[alert_key]).total_seconds()
        if time_diff < self.alert_cooldown:
            return True, time_diff, "ALERT_COOLDOWN"
    
    return False, 0, ""

def _calculate_alert_confidence(self, alert_type, volume_ratio, change_pct, rsi=None):
    """Calculate confidence score using shared tv_utils to avoid duplication"""
    if tv_utils is None:
        # Fallback confidence calculation for FOMO mode (much more aggressive)
        confidence = 0.5  # Base confidence boosted from 0.2 to 0.5
        
        # Volume factor
        if volume_ratio >= 10.0:
            confidence += 0.3
        elif volume_ratio >= 5.0:
            confidence += 0.2
        elif volume_ratio >= 2.0:
            confidence += 0.1
        
        # Price change factor
        if abs(change_pct) >= 5.0:
            confidence += 0.2
        elif abs(change_pct) >= 2.0:
            confidence += 0.1
        
        # RSI factor (if available)
        if rsi is not None:
            if 40 <= rsi <= 70:  # Good RSI range
                confidence += 0.1
        
        return min(confidence, 0.95)
    return tv_utils.calculate_alert_confidence(alert_type, volume_ratio, change_pct, rsi)

def _calculate_short_confidence(self, rsi, change_pct, volume_ratio, is_overextended):
    """Calculate confidence for short signals based on overbought conditions"""
    confidence = 0.4  # Base confidence for short signals
    
    # RSI factor (higher RSI = higher short confidence)
    if rsi >= 80:
        confidence += 0.3  # Very overbought
    elif rsi >= 75:
        confidence += 0.2  # Overbought
    elif rsi >= 70:
        confidence += 0.1  # Slightly overbought
    
    # Price move factor (larger moves = higher reversal probability)
    if change_pct >= 8:
        confidence += 0.25  # Large move
    elif change_pct >= 5:
        confidence += 0.15  # Medium move  
    elif change_pct >= 3:
        confidence += 0.1   # Small move
    
    # Volume confirmation
    if volume_ratio >= 4.0:
        confidence += 0.2  # High volume
    elif volume_ratio >= 2.5:
        confidence += 0.15  # Medium volume
    elif volume_ratio >= 1.5:
        confidence += 0.1   # Elevated volume
    
    # Overextended bonus
    if is_overextended:
        confidence += 0.15
    
    return min(confidence, 0.95)  # Cap at 95%

def _get_15min_rsi(self, symbol):
    """Get 15min RSI from Upstox for intraday confirmation"""
    try:
        import talib
        
        # Fetch 15min data for last 3 days (enough for RSI calculation)
        to_date = datetime.now().strftime('%Y-%m-%d')
        from_date = (datetime.now() - timedelta(days=3)).strftime('%Y-%m-%d')
        
        # Use the existing Upstox API
        if hasattr(self, 'upstox_api') and self.upstox_api:
            df = self.upstox_api.fetch_historical_data_v3(
                symbol=symbol,
                unit='minutes',
                interval=15,
                to_date=to_date,
                from_date=from_date
            )
            
            if df is not None and len(df) >= 14:  # Need at least 14 periods for RSI
                # Calculate 15min RSI
                rsi = talib.RSI(df['close'], timeperiod=14)
                current_15min_rsi = rsi.iloc[-1]  # Latest RSI value
                
                return current_15min_rsi
        
        return None  # Return None if data unavailable
        
    except Exception as e:
        # Fallback silently - don't break the main flow
        return None

def _check_confirmed_downtrend_for_short(self, symbol, row):
    """Check if confirmed downtrend exists before allowing short (price < VWAP + bearish volume)"""
    try:
        current_price = row['close']
        
        # Get VWAP if available, otherwise estimate using volume-weighted price
        vwap = row.get('VWAP', current_price)  # Fallback to current price if no VWAP
        
        # Check if price is below VWAP (bearish condition)
        price_below_vwap = current_price < vwap
        
        # Check for bearish volume (volume above average with negative price action)
        volume_ratio = row.get('relative_volume_10d_calc', 1.0)
        change = row.get('change', 0)
        
        # Bearish volume: elevated volume with negative or weak positive move (from config)
        bearish_volume = (volume_ratio > self.config.downtrend.min_volume_ratio_bearish and 
                         change < self.config.downtrend.max_change_bearish)
        
        # Additional trend confirmation
        ema20 = row.get('EMA20', current_price)
        ema50 = row.get('EMA50', current_price)
        
        # Stronger confirmation: price below moving averages
        below_ema20 = current_price < ema20
        ema_bearish = ema20 < ema50  # 20 EMA below 50 EMA
        
        # Relaxed downtrend confirmation for FOMO mode
        confirmed_downtrend = price_below_vwap or bearish_volume or (below_ema20 and ema_bearish)  # OR instead of AND
        
        if confirmed_downtrend:
            console.print(f"[dim green]✅ {symbol}: Confirmed downtrend for short - Price<VWAP: {price_below_vwap}, Bearish Vol: {bearish_volume}[/dim green]")
        else:
            console.print(f"[dim yellow]⚠️ {symbol}: No confirmed downtrend - Price<VWAP: {price_below_vwap}, Bearish Vol: {bearish_volume}[/dim yellow]")
        
        return confirmed_downtrend
        
    except Exception as e:
        console.print(f"[dim red]⚠️ Error checking downtrend for {symbol}: {e}[/dim red]")
        return False  # Conservative approach - don't short if can't confirm