#!/usr/bin/env python3
"""
Gap Trading Signal Generation
"""

import pandas as pd
from datetime import datetime
from rich.console import Console
from rich.table import Table

console = Console()


class GapTrader:
    """Gap trading signal generation and execution methods"""

    def __init__(self, parent_instance):
        self.parent = parent_instance

    def process_gap_fill_paper_trading(self, df):
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
                
                has_position, existing_ticker = self.parent._has_existing_position(symbol)
                if has_position:
                    console.print(f"[dim yellow]⚠️ Already have position in {symbol} - skipping[/dim yellow]")
                    continue
                
                gap_direction = 'UP' if gap_size > 0 else 'DOWN'
                
                reversal_analysis = None
                if abs(gap_size) >= 0.8:
                    reversal_analysis = self.parent.gap_detector.detect_gap_reversal_signals(
                        symbol=symbol,
                        gap_direction=gap_direction,
                        current_price=current_price,
                        gap_size=abs(gap_size)
                    )
                
                sr_analysis = self.parent._detect_support_resistance_levels(symbol, lookback_days=45)
                
                trade_signal = self.evaluate_gap_fill_trade_signal(
                    symbol=symbol,
                    gap_size=gap_size,
                    gap_direction=gap_direction,
                    reversal_analysis=reversal_analysis,
                    sr_analysis=sr_analysis,
                    current_price=current_price
                )
                
                if trade_signal['action'] in ['STRONG_SHORT', 'STRONG_LONG', 'MODERATE_SHORT', 'MODERATE_LONG']:
                    success = self.execute_gap_fill_trade(
                        symbol=symbol,
                        signal=trade_signal,
                        current_price=current_price,
                        gap_size=gap_size,
                        vol_ratio=vol_ratio,
                        reversal_analysis=reversal_analysis
                    )
                    
                    if success:
                        trades_executed += 1
                        if trades_executed >= 3:
                            console.print("[dim]🚫 Max gap-fill trades limit reached (3)[/dim]")
                            break
                            
            except Exception as e:
                console.print(f"[dim red]❌ Error processing {symbol}: {e}[/dim red]")
                continue
        
        if trades_executed > 0:
            console.print(f"[green]✅ {trades_executed} gap-fill paper trades executed[/green]")

    def evaluate_gap_fill_trade_signal(self, symbol, gap_size, gap_direction, reversal_analysis, sr_analysis, current_price):
        """Evaluate if gap-fill trade signal is strong enough for execution"""
        
        gap_fill_prob = 50.0
        try:
            gap_analysis = self.parent.gap_detector.analyze_gap_fill_probability(
                symbol=symbol,
                current_gap_size=abs(gap_size),
                gap_direction=gap_direction,
                lookback_days=60
            )
            gap_fill_prob = gap_analysis['probability']
        except:
            pass
        
        next_sr_level = None
        sr_probability = 0
        if sr_analysis['levels']:
            for level_info in sr_analysis['levels'][:3]:
                if level_info['strength'] in ['strong', 'moderate']:
                    next_sr_level = level_info
                    break
            if not next_sr_level and sr_analysis['levels']:
                next_sr_level = sr_analysis['levels'][0]
        
        if next_sr_level:
            sr_probability = self.parent._calculate_trend_target_probability(
                current_price=current_price,
                target_price=next_sr_level['price'],
                trend_strength='neutral',
                gap_direction=gap_direction
            )
        
        action = 'SKIP'
        confidence = 0
        reason = ""
        
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

    def execute_gap_fill_trade(self, symbol, signal, current_price, gap_size, vol_ratio, reversal_analysis):
        """Execute gap-fill paper trade"""
        try:
            if not self.parent._is_trading_hours():
                console.print(f"[yellow]⏰ TRADE BLOCKED: {symbol} - Outside trading hours[/yellow]")
                return False
            
            if signal['action'] in ['STRONG_SHORT', 'MODERATE_SHORT', 'WEAK_SHORT']:
                trade_side = 'SELL'
                target_side = 'SHORT'
            elif signal['action'] in ['STRONG_LONG', 'MODERATE_LONG', 'WEAK_LONG']:
                trade_side = 'BUY'
                target_side = 'LONG'
            else:
                return False
            
            live_price = self.parent._get_live_price_from_upstox(symbol)
            if live_price and abs(live_price - current_price) / current_price > 0.02:
                console.print(f"[yellow]⚠️ Price moved too much for {symbol}: ₹{current_price:.2f} → ₹{live_price:.2f}[/yellow]")
                return False
            
            execution_price = live_price if live_price else current_price
            quantity = max(1, int(20000 / execution_price))
            
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
                
                gap_emoji = "📈" if gap_size > 0 else "📉"
                console.print(f"[green]🎯 GAP-FILL TRADE: {trade_side} {quantity} {symbol} @ ₹{execution_price:.2f} {gap_emoji} ({signal['reason']})[/green]")
                
                return True
                
        except Exception as e:
            console.print(f"[red]❌ Gap-fill trade execution failed for {symbol}: {e}[/red]")
            return False
        
        return False

    def display_gap_fill_trading_status(self):
        """Display gap-fill specific paper trading status"""
        try:
            gap_fill_trades = [trade for trade in self.parent.live_trades if trade.get('alert_type') == 'GAP_FILL']
            
            if gap_fill_trades or self.parent.closed_trades:
                console.print(f"\n[bold blue]📊 GAP-FILL PAPER TRADING STATUS:[/bold blue]")
                
                if gap_fill_trades:
                    console.print(f"[green]🟢 Active Gap-Fill Positions: {len(gap_fill_trades)}[/green]")
                    for trade in gap_fill_trades[-3:]:
                        side_emoji = "📉" if trade['side'] == 'SELL' else "📈"
                        gap_size = trade.get('gap_size', 0)
                        reason = trade.get('reason', 'Gap trade')
                        console.print(f"  • {side_emoji} {trade['symbol']}: {trade['quantity']} @ ₹{trade['price']:.2f} ({gap_size:+.1f}% gap)")
                        console.print(f"    [dim]{reason}[/dim]")
                
                total_gap_trades = len([t for t in self.parent.closed_trades if t.get('alert_type') == 'GAP_FILL'])
                if total_gap_trades > 0:
                    gap_pnl = sum([t.get('pnl_amount', 0) for t in self.parent.closed_trades if t.get('alert_type') == 'GAP_FILL'])
                    win_rate = len([t for t in self.parent.closed_trades if t.get('alert_type') == 'GAP_FILL' and t.get('pnl_amount', 0) > 0]) / total_gap_trades * 100
                    console.print(f"[cyan]📈 Gap-Fill Stats: {total_gap_trades} trades | {win_rate:.1f}% win rate | ₹{gap_pnl:,.0f} P&L[/cyan]")
                
                console.print(f"[dim]💼 Position Limit: {len(gap_fill_trades)}/3 gap-fill trades | ₹20,000 per position[/dim]")
                
        except Exception as e:
            console.print(f"[dim red]Error displaying trading status: {e}[/dim red]")

    def display_live_gap_sr_analysis(self, df):
        """Display live gap-fill analysis with S/R levels"""
        if df.empty:
            return
        
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
            
            gap_direction = 'UP' if gap_size > 0 else 'DOWN'
            
            change = row.get('change', 0)
            rsi = row.get('RSI', 50)
            
            if change > 2 and rsi > 60:
                trend_strength = 'bullish'
            elif change < -2 and rsi < 40:
                trend_strength = 'bearish'
            else:
                trend_strength = 'neutral'
            
            console.print(f"[dim]Analyzing S/R for {symbol}...[/dim]")
            sr_analysis = self.parent._detect_support_resistance_levels(symbol, lookback_days=45)
            console.print(f"[dim]S/R result for {symbol}: {sr_analysis['data_quality']} - {len(sr_analysis['levels'])} levels found[/dim]")
            
            gap_fill_prob = 50.0
            try:
                gap_analysis = self.parent.gap_detector.analyze_gap_fill_probability(
                    symbol=symbol,
                    current_gap_size=abs(gap_size),
                    gap_direction=gap_direction,
                    lookback_days=60
                )
                gap_fill_prob = gap_analysis['probability']
            except:
                pass
            
            next_sr_level = None
            sr_probability = 0
            sr_type = ""
            
            if sr_analysis['levels']:
                for level_info in sr_analysis['levels'][:3]:
                    if level_info['strength'] in ['strong', 'moderate']:
                        next_sr_level = level_info
                        break
                
                if not next_sr_level and sr_analysis['levels']:
                    next_sr_level = sr_analysis['levels'][0]
                
                if next_sr_level:
                    sr_probability = self.parent._calculate_trend_target_probability(
                        current_price=current_price,
                        target_price=next_sr_level['price'],
                        trend_strength=trend_strength,
                        gap_direction=gap_direction
                    )
                    sr_type = next_sr_level['type']
            
            price_display = f"₹{current_price:,.2f}"
            gap_color = "green" if gap_size > 0 else "red"
            gap_display = f"[{gap_color}]{gap_size:+.2f}%[/{gap_color}]"
            vol_display = f"{vol_ratio:.1f}x"
            
            if trend_strength == 'bullish':
                trend_display = "[green]📈 Bull[/green]"
            elif trend_strength == 'bearish':
                trend_display = "[red]📉 Bear[/red]"
            else:
                trend_display = "[yellow]➡️ Neutral[/yellow]"
            
            fill_color = "green" if gap_fill_prob >= 60 else "yellow" if gap_fill_prob >= 40 else "red"
            fill_display = f"[{fill_color}]{gap_fill_prob:.0f}%[/{fill_color}]"
            
            if next_sr_level:
                sr_emoji = "🔴" if sr_type == "resistance" else "🟢"
                sr_display = f"{sr_emoji} ₹{next_sr_level['price']:.1f} ({next_sr_level['distance_pct']:.1f}%)"
                prob_color = "green" if sr_probability >= 60 else "yellow" if sr_probability >= 40 else "red"
                prob_display = f"[{prob_color}]{sr_probability:.0f}%[/{prob_color}]"
            else:
                sr_display = "[dim]No clear level[/dim]"
                prob_display = "[dim]N/A[/dim]"
            
            reversal_analysis = None
            if abs(gap_size) >= 0.8:
                console.print(f"[dim]Checking reversal signals for {symbol}...[/dim]")
                reversal_analysis = self.parent.gap_detector.detect_gap_reversal_signals(
                    symbol=symbol,
                    gap_direction=gap_direction,
                    current_price=current_price,
                    gap_size=abs(gap_size)
                )
            
            signal = "[dim]❌ SKIP[/dim]"
            signal_reason = ""
            
            if gap_fill_prob >= 60 and reversal_analysis:
                reversal_strength = reversal_analysis['reversal_strength']
                reversal_recommendation = reversal_analysis['recommendation']
                
                if reversal_recommendation in ['STRONG_COUNTER_TRADE', 'MODERATE_COUNTER_TRADE']:
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
                    if gap_direction == 'UP':
                        signal = "[dim red]📉 WEAK SHORT[/dim red]"
                    else:
                        signal = "[dim green]📈 WEAK LONG[/dim green]"
                    signal_reason = f"Weak reversal, high gap-fill prob"
                else:
                    signal = "[yellow]⚠️ NO REVERSAL[/yellow]"
                    signal_reason = f"Gap continues ({', '.join(reversal_analysis['signals'][:2])})"
            
            elif sr_probability >= 70 and next_sr_level:
                if sr_type == 'resistance' and gap_direction == 'UP':
                    if not reversal_analysis or reversal_analysis['reversal_strength'] < 3:
                        signal = "[green]📈 LONG to R[/green]"
                        signal_reason = "Trend continuation"
                elif sr_type == 'support' and gap_direction == 'DOWN':
                    if not reversal_analysis or reversal_analysis['reversal_strength'] < 3:
                        signal = "[red]📉 SHORT to S[/red]"
                        signal_reason = "Trend continuation"
            
            if reversal_analysis and reversal_analysis['signals']:
                top_signals = reversal_analysis['signals'][:2]
                signal_details = ', '.join(top_signals).replace('_', ' ').title()
                if signal_reason:
                    signal_reason += f" | {signal_details}"
                else:
                    signal_reason = signal_details
            
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
        
        if self.parent.paper_trading_enabled:
            self.display_gap_fill_trading_status()
        
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
