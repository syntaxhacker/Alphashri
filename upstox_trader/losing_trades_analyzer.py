#!/usr/bin/env python3
"""
Losing Trades Analyzer
Analyzes why trades resulted in losses and why stop losses didn't trigger at expected -0.5% level
"""

import pandas as pd
from datetime import datetime, timedelta
import sys
import os
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich import print as rprint

# Add the project root to Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

console = Console()

class LosingTradesAnalyzer:
    def __init__(self):
        self.losing_trades = [
            {
                'symbol': 'NSE:DBL',
                'side': 'BUY',
                'entry_price': 485.85,
                'exit_price': 483.35,
                'qty': 41,
                'pnl_pct': -0.51,
                'pnl_amount': -103,
                'hold_time': '30m',
                'reason': 'STOP LOSS: -0.5',
                'expected_sl': -0.5,
                'actual_sl': -0.51
            },
            {
                'symbol': 'NSE:AGARWALEYE',
                'side': 'BUY',
                'entry_price': 456.05,
                'exit_price': 452.50,
                'qty': 43,
                'pnl_pct': -0.78,
                'pnl_amount': -153,
                'hold_time': '1m',
                'reason': 'STOP LOSS: -0.7',
                'expected_sl': -0.5,
                'actual_sl': -0.78
            },
            {
                'symbol': 'NSE:IOLCP',
                'side': 'BUY',
                'entry_price': 100.45,
                'exit_price': 99.76,
                'qty': 199,
                'pnl_pct': -0.69,
                'pnl_amount': -137,
                'hold_time': '41m',
                'reason': 'STOP LOSS: -0.6',
                'expected_sl': -0.5,
                'actual_sl': -0.69
            },
            {
                'symbol': 'NSE:GREAVESCOT',
                'side': 'BUY',
                'entry_price': 213.48,
                'exit_price': 211.50,
                'qty': 93,
                'pnl_pct': -0.93,
                'pnl_amount': -184,
                'hold_time': '0m',
                'reason': 'STOP LOSS: -0.9',
                'expected_sl': -0.5,
                'actual_sl': -0.93
            },
            {
                'symbol': 'NSE:NESCO',
                'side': 'BUY',
                'entry_price': 1265.70,
                'exit_price': 1256.30,
                'qty': 15,
                'pnl_pct': -0.74,
                'pnl_amount': -141,
                'hold_time': '14m',
                'reason': 'STOP LOSS: -0.7',
                'expected_sl': -0.5,
                'actual_sl': -0.74
            },
            {
                'symbol': 'NSE:VISHNU',
                'side': 'BUY',
                'entry_price': 578.00,
                'exit_price': 573.20,
                'qty': 34,
                'pnl_pct': -0.83,
                'pnl_amount': -163,
                'hold_time': '22m',
                'reason': 'STOP LOSS: -0.8',
                'expected_sl': -0.5,
                'actual_sl': -0.83
            },
            {
                'symbol': 'NSE:MADRASFERT',
                'side': 'BUY',
                'entry_price': 96.30,
                'exit_price': 95.81,
                'qty': 207,
                'pnl_pct': -0.51,
                'pnl_amount': -101,
                'hold_time': '11m',
                'reason': 'STOP LOSS: -0.5',
                'expected_sl': -0.5,
                'actual_sl': -0.51
            },
            {
                'symbol': 'NSE:GATEWAY',
                'side': 'BUY',
                'entry_price': 72.95,
                'exit_price': 72.41,
                'qty': 274,
                'pnl_pct': -0.74,
                'pnl_amount': -148,
                'hold_time': '38m',
                'reason': 'STOP LOSS: -0.7',
                'expected_sl': -0.5,
                'actual_sl': -0.74
            }
        ]
        
    def analyze_stop_loss_slippage(self):
        """Analyze why stop losses didn't trigger at expected -0.5% level"""
        console.print(Panel.fit("🔍 STOP LOSS SLIPPAGE ANALYSIS", style="bold red"))
        
        slippage_table = Table(title="Stop Loss Slippage Analysis")
        slippage_table.add_column("Symbol", style="cyan")
        slippage_table.add_column("Expected SL", justify="right", style="green")
        slippage_table.add_column("Actual SL", justify="right", style="red")
        slippage_table.add_column("Slippage", justify="right", style="yellow")
        slippage_table.add_column("Hold Time", justify="center")
        slippage_table.add_column("Likely Cause", style="dim")
        
        total_slippage = 0
        severe_slippage_count = 0
        
        for trade in self.losing_trades:
            slippage = abs(trade['actual_sl']) - abs(trade['expected_sl'])
            total_slippage += slippage
            
            # Categorize likely cause based on slippage and hold time
            if slippage > 0.4:  # > 0.4% slippage
                cause = "🚨 GAP DOWN / ILLIQUID"
                severe_slippage_count += 1
            elif slippage > 0.2:  # > 0.2% slippage
                cause = "⚠️ FAST DECLINE"
            elif trade['hold_time'] == '0m' or trade['hold_time'] == '1m':
                cause = "⚡ IMMEDIATE REVERSAL"
            else:
                cause = "📉 GRADUAL DECLINE"
            
            slippage_table.add_row(
                trade['symbol'].replace('NSE:', ''),
                f"-{trade['expected_sl']:.1f}%",
                f"{trade['actual_sl']:.2f}%",
                f"+{slippage:.2f}%",
                trade['hold_time'],
                cause
            )
        
        console.print(slippage_table)
        
        avg_slippage = total_slippage / len(self.losing_trades)
        console.print(f"\n📊 [bold]Average Slippage:[/bold] +{avg_slippage:.2f}%")
        console.print(f"🚨 [bold]Severe Slippage (>0.4%):[/bold] {severe_slippage_count}/{len(self.losing_trades)} trades")
        
        return avg_slippage, severe_slippage_count
    
    def analyze_entry_timing(self):
        """Analyze if trades were entered at bad timing"""
        console.print(Panel.fit("⏰ ENTRY TIMING ANALYSIS", style="bold blue"))
        
        timing_table = Table(title="Entry Timing Issues")
        timing_table.add_column("Symbol", style="cyan")
        timing_table.add_column("Hold Time", justify="center")
        timing_table.add_column("Loss %", justify="right", style="red")
        timing_table.add_column("Timing Issue", style="yellow")
        timing_table.add_column("Recommendation", style="green")
        
        immediate_reversals = 0
        
        for trade in self.losing_trades:
            hold_minutes = 0
            if 'm' in trade['hold_time']:
                hold_minutes = int(trade['hold_time'].replace('m', ''))
            
            if hold_minutes <= 1:
                timing_issue = "🚨 IMMEDIATE REVERSAL"
                recommendation = "Wait for confirmation"
                immediate_reversals += 1
            elif hold_minutes <= 15:
                timing_issue = "⚠️ QUICK REVERSAL"
                recommendation = "Better entry signals"
            else:
                timing_issue = "📉 TREND REVERSAL"
                recommendation = "Earlier exit signals"
            
            timing_table.add_row(
                trade['symbol'].replace('NSE:', ''),
                trade['hold_time'],
                f"{trade['pnl_pct']:.2f}%",
                timing_issue,
                recommendation
            )
        
        console.print(timing_table)
        console.print(f"\n⚡ [bold]Immediate Reversals (≤1min):[/bold] {immediate_reversals}/{len(self.losing_trades)} trades")
        
        return immediate_reversals
    
    def analyze_price_action_patterns(self):
        """Analyze price action patterns in losing trades"""
        console.print(Panel.fit("📈 PRICE ACTION ANALYSIS", style="bold magenta"))
        
        # Calculate price drops
        price_drops = []
        for trade in self.losing_trades:
            drop = trade['entry_price'] - trade['exit_price']
            drop_pct = (drop / trade['entry_price']) * 100
            price_drops.append({
                'symbol': trade['symbol'],
                'drop_amount': drop,
                'drop_pct': drop_pct,
                'entry_price': trade['entry_price']
            })
        
        # Sort by drop percentage
        price_drops.sort(key=lambda x: x['drop_pct'], reverse=True)
        
        pattern_table = Table(title="Price Drop Analysis")
        pattern_table.add_column("Symbol", style="cyan")
        pattern_table.add_column("Entry Price", justify="right")
        pattern_table.add_column("Price Drop ₹", justify="right", style="red")
        pattern_table.add_column("Drop %", justify="right", style="red")
        pattern_table.add_column("Pattern Type", style="yellow")
        
        for drop in price_drops:
            if drop['drop_pct'] > 0.8:
                pattern = "🚨 HEAVY SELLING"
            elif drop['drop_pct'] > 0.6:
                pattern = "📉 STRONG DECLINE"
            else:
                pattern = "📊 NORMAL DECLINE"
            
            pattern_table.add_row(
                drop['symbol'].replace('NSE:', ''),
                f"₹{drop['entry_price']:.2f}",
                f"₹{drop['drop_amount']:.2f}",
                f"{drop['drop_pct']:.2f}%",
                pattern
            )
        
        console.print(pattern_table)
    
    def generate_recommendations(self):
        """Generate recommendations to improve stop loss system"""
        console.print(Panel.fit("💡 RECOMMENDATIONS", style="bold green"))
        
        recommendations = [
            "🎯 **Tighter Initial Stop Loss**: Consider -0.3% instead of -0.5% for faster exits",
            "⚡ **Pre-market Gap Filter**: Avoid trades that gap down immediately after entry",
            "🔄 **Dynamic Stop Loss**: Use ATR-based stops for volatile stocks",
            "⏰ **Entry Confirmation**: Wait 2-3 minutes after signal before entering",
            "📊 **Volume Confirmation**: Ensure adequate volume before entry",
            "🚨 **Quick Exit Logic**: Exit if price drops >0.3% within first 5 minutes",
            "💹 **Liquidity Filter**: Avoid stocks with wide bid-ask spreads",
            "🎲 **Position Sizing**: Reduce size for stocks with high volatility"
        ]
        
        for i, rec in enumerate(recommendations, 1):
            console.print(f"{i}. {rec}")
    
    def run_analysis(self):
        """Run complete losing trades analysis"""
        console.print(Panel.fit("🔍 LOSING TRADES ANALYSIS REPORT", style="bold white on red"))
        
        total_losses = sum(trade['pnl_amount'] for trade in self.losing_trades)
        console.print(f"\n📊 [bold]Total Analyzed Trades:[/bold] {len(self.losing_trades)}")
        console.print(f"💰 [bold]Total Losses:[/bold] ₹{total_losses:,.0f}")
        console.print(f"📉 [bold]Average Loss per Trade:[/bold] ₹{total_losses/len(self.losing_trades):,.0f}")
        
        print("\n" + "="*80 + "\n")
        
        # Run analyses
        avg_slippage, severe_slippage = self.analyze_stop_loss_slippage()
        print("\n" + "="*80 + "\n")
        
        immediate_reversals = self.analyze_entry_timing()
        print("\n" + "="*80 + "\n")
        
        self.analyze_price_action_patterns()
        print("\n" + "="*80 + "\n")
        
        self.generate_recommendations()
        
        # Summary insights
        console.print(Panel.fit("🎯 KEY INSIGHTS", style="bold yellow"))
        console.print(f"• Average stop loss slippage: +{avg_slippage:.2f}%")
        console.print(f"• {severe_slippage}/{len(self.losing_trades)} trades had severe slippage (>0.4%)")
        console.print(f"• {immediate_reversals}/{len(self.losing_trades)} trades reversed immediately (<2min)")
        console.print("• Most losses due to gap downs or fast price movements")
        console.print("• Current -0.5% stop loss may be too loose for volatile conditions")

if __name__ == "__main__":
    analyzer = LosingTradesAnalyzer()
    analyzer.run_analysis()