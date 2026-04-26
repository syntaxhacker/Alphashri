#!/usr/bin/env python3
"""
Gap Analysis Main Class
"""

import os
import time
from datetime import datetime
from rich.console import Console
from rich.panel import Panel

from .gap_detector import GapDetector
from .gap_trading import GapTrader

console = Console()


class GapAnalysis:
    """Gap analysis and gap fill trading functionality"""
    
    def __init__(self, parent_instance):
        self.parent = parent_instance
        self.gap_detector = GapDetector(parent_instance)
        self.gap_trader = GapTrader(parent_instance)
    
    def _analyze_gap_fill_probability(self, symbol, current_gap_size, gap_direction, lookback_days=90):
        """Analyze historical gap-fill patterns to predict current gap-fill probability"""
        return self.gap_detector.analyze_gap_fill_probability(symbol, current_gap_size, gap_direction, lookback_days)
    
    def _detect_gap_reversal_signals(self, symbol, gap_direction, current_price, gap_size):
        """Detect if a gap is showing reversal/exhaustion signals for safe counter-trend trading"""
        return self.gap_detector.detect_gap_reversal_signals(symbol, gap_direction, current_price, gap_size)
    
    def _get_volume_movers_with_gaps(self):
        """Get current volume movers that have significant gaps"""
        return self.gap_detector.get_volume_movers_with_gaps()
    
    def _get_enhanced_gap_opportunities(self):
        """Enhanced gap screening with multiple criteria beyond just volume movers"""
        return self.gap_detector.get_enhanced_gap_opportunities()
    
    def _calculate_gap_quality_score(self, df):
        """Calculate a quality score for gap opportunities"""
        return self.gap_detector.calculate_gap_quality_score(df)
    
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
                
                os.system('clear' if os.name == 'posix' else 'cls')
                
                current_time = datetime.now().strftime("%H:%M:%S")
                console.print(f"[bold cyan]🎯 LIVE GAP-FILL MONITOR WITH S/R LEVELS - {current_time}[/bold cyan]")
                console.print(f"[dim]Iteration: {iteration} | Refresh: {refresh_interval}s | Press Ctrl+C to stop[/dim]")
                console.print()
                
                volume_movers = self._get_enhanced_gap_opportunities()
                
                if not volume_movers.empty:
                    console.print("[dim]Analyzing gap-fill probabilities and S/R levels...[/dim]")
                    self.gap_trader.display_live_gap_sr_analysis(volume_movers)
                    
                    if self.parent.paper_trading_enabled:
                        self.gap_trader.process_gap_fill_paper_trading(volume_movers)
                else:
                    console.print("[yellow]No significant volume movers with gaps found[/yellow]")
                
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
        return self.gap_trader.process_gap_fill_paper_trading(df)
    
    def _evaluate_gap_fill_trade_signal(self, symbol, gap_size, gap_direction, reversal_analysis, sr_analysis, current_price):
        """Evaluate if gap-fill trade signal is strong enough for execution"""
        return self.gap_trader.evaluate_gap_fill_trade_signal(symbol, gap_size, gap_direction, reversal_analysis, sr_analysis, current_price)
    
    def _execute_gap_fill_trade(self, symbol, signal, current_price, gap_size, vol_ratio, reversal_analysis):
        """Execute gap-fill paper trade"""
        return self.gap_trader.execute_gap_fill_trade(symbol, signal, current_price, gap_size, vol_ratio, reversal_analysis)
    
    def _display_gap_fill_trading_status(self):
        """Display gap-fill specific paper trading status"""
        return self.gap_trader.display_gap_fill_trading_status()
    
    def _display_live_gap_sr_analysis(self, df):
        """Display live gap-fill analysis with S/R levels"""
        return self.gap_trader.display_live_gap_sr_analysis(df)
