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
                    to_date=end_date.strftime('%Y-%m-%d'),
                    exchange='NSE_EQ',
                    instrument_type='EQ'
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
                sr_analysis = self.parent.technical_analysis._detect_support_resistance_levels(symbol, lookback_days=45)
                
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
            gap_fill_prob = gap_analysis[0] # Probability is the first element
        except Exception as e:
            console.print(f"[dim red]⚠️ Error getting gap fill probability for {symbol}: {e}[/dim red]")
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
            live_price = self.parent.live_data._get_live_price_from_upstox(symbol)
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
            sr_analysis = self.parent.technical_analysis._detect_support_resistance_levels(symbol, lookback_days=45)
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
                gap_fill_prob = gap_analysis[0] # Probability is the first element
            except Exception as e:
                console.print(f"[dim red]⚠️ Error getting gap fill probability for {symbol}: {e}[/dim red]")
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
