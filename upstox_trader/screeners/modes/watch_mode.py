from typing import Optional
from rich.panel import Panel
from rich.console import Console
import time
import os
from datetime import datetime

import pandas as pd

from .queries import (
    get_watch_data_fomo,
    get_watch_data_accumulation,
    get_watch_data_smart_fomo,
    get_watch_data_momentum,
    get_watch_data_optimized_gap,
    get_watch_data_heavy_breakout,
    get_watch_data_scalping,
    get_watch_data_momentum_scalper,
    get_watch_data_sector_scalper,
    get_watch_data_short_squeeze,
    get_watch_data_breakout_failure,
    get_watch_data_exhaustion_reversal,
    get_watch_data_morning_fade,
    get_watch_data_reversal,
    get_watch_data_volume_surge,
    get_watch_data_channel_play,
    get_watch_data_sector_momentum,
    get_watch_data_quick_profit,
    get_watch_data_fomo_momentum,
    get_watch_data_realtime_momentum,
    get_watch_data_prebreakout,
)
from .analysis import (
    _add_intraday_momentum_analysis,
    _analyze_sector_correlations,
)

console = Console()


def intraday_watch_mode(self, refresh_interval=30, volume_threshold=1.5, price_threshold=3.0, mode='PREBREAKOUT', market_cap_filter=None, max_price=None, min_price=None) -> None:
    """Watch mode for intraday trading - continuously monitors volume and price changes"""
    self.market_cap_filter = market_cap_filter
    self.max_price = max_price
    self.min_price = min_price
    
    mode_titles = {
        'PREBREAKOUT': ("\U0001f4ca PRE-BREAKOUT MODE - Early Entry Signals", "bold blue"),
        'FOMO': ("\U0001f525 FOMO MODE - High Volume Breakouts", "bold red"), 
        'SMART_FOMO': ("\U0001f9e0 SMART FOMO MODE - Historical Analysis + FOMO", "bold yellow"),
        'ACCUMULATION': ("\U0001f4c8 ACCUMULATION MODE - Smart Money Tracking", "bold green"),
        'MOMENTUM': ("\u26a1 MOMENTUM MODE - Early Momentum Detection", "bold cyan"),
        'OPTIMIZED_GAP': ("\U0001f680 OPTIMIZED GAP MODE - 15-Min Gap Strategy (68.4% Win Rate)", "bold green"),
        'GAP_FILL_SR': ("\U0001f3af GAP-FILL S/R MODE - Live Gap Analysis with Support/Resistance", "bold magenta"),
        'SCALPING': ("\u26a1 SCALPING MODE - Ultra-Fast 1-3% Moves", "bold white"),
        'MOMENTUM_SCALPER': ("\U0001f680 MOMENTUM SCALPER - Second-Level Delta Trading", "bold bright_white"),
        'SECTOR_SCALPER': ("\U0001f3ed SECTOR SCALPER - Correlation Catch-Up Trades", "bold bright_cyan"),
        'SHORT_SQUEEZE': ("\U0001f34b SHORT SQUEEZE - Over-Shorted Explosion Hunter", "bold bright_magenta"),
        'BREAKOUT_FAILURE': ("\U0001f4c9 BREAKOUT FAILURE - Failed Breakout Shorting", "bold red"),
        'EXHAUSTION_REVERSAL': ("\U0001f635 EXHAUSTION REVERSAL - Momentum Exhaustion Shorts", "bold bright_red"),
        'MORNING_FADE': ("\U0001f305 MORNING FADE - Gap-Up Failure Shorting", "bold yellow"),
        'REVERSAL': ("\U0001f504 REVERSAL MODE - Counter-Trend Opportunities", "bold purple"),
        'VOLUME_SURGE': ("\U0001f4ca VOLUME SURGE MODE - Unusual Activity Detector", "bold bright_blue"),
        'CHANNEL_PLAY': ("\U0001f4c8 CHANNEL PLAY MODE - Range-Bound Trading", "bold bright_green"),
        'SECTOR_MOMENTUM': ("\U0001f3ed SECTOR MOMENTUM MODE - Industry Group Moves", "bold bright_yellow"),
        'QUICK_PROFIT': ("\U0001f4b0 QUICK PROFIT MODE - 1-2% Fast Scalps", "bold bright_red"),
        'FOMO_MOMENTUM': ("\U0001f3af FOMO MOMENTUM MODE - Gap & Intraday 0.8-6% Momentum", "bold magenta"),
        'REALTIME_MOMENTUM': ("\u26a1 REALTIME MOMENTUM MODE - Live 1min/3min Price Action", "bold bright_red")
    }
    title, style = mode_titles.get(mode, ("\U0001f4ca WATCH MODE", "bold blue"))
    console.print(Panel.fit(title, style=style))
    
    self.watch_mode = mode
    
    if hasattr(self, 'journal_file'):
        self.setup_trade_journal()
    
    console.print(f"[yellow]\u2699\ufe0f  Configuration:[/yellow]")
    console.print(f"\u2022 Mode: {mode}")
    console.print(f"\u2022 Refresh interval: {refresh_interval} seconds")
    console.print(f"\u2022 Volume threshold: {volume_threshold}x normal volume")
    console.print(f"\u2022 Price change threshold: {price_threshold}%")
    paper_status = '\U0001f7e2 ENABLED (\u20b920,000 per trade)' if getattr(self, 'paper_trading_enabled', False) else '\U0001f534 DISABLED'
    console.print(f"\u2022 Paper trading: {paper_status}")
    if getattr(self, 'paper_trading_enabled', False):
        console.print(f"\u2022 Live risk management: \U0001f7e2 ENABLED (0.5% SL | 1% TP | 1.0% TSL | 2sec checks)")
    console.print(f"\u2022 Trade journal: \U0001f4dd {getattr(self, 'journal_file', 'Not configured')}")
    console.print(f"\u2022 Trend analysis: \U0001f3af ENABLED (15-day lookback | SELL in bearish trends)")
    console.print(f"\u2022 Logging: \U0001f507 Minimal (reduced console spam)")
    console.print(f"\u2022 Press Ctrl+C to stop monitoring")
    console.print()
    
    if mode == 'GAP_FILL_SR':
        console.print(f"[yellow]\U0001f504 Redirecting to live gap-fill monitor...[/yellow]")
        time.sleep(1)
        if hasattr(self, 'live_gap_fill_monitor_with_sr'):
            return self.live_gap_fill_monitor_with_sr()
        else:
            console.print("[red]Error: live_gap_fill_monitor_with_sr method not available[/red]")
            return
    
    if hasattr(self, 'wait_until_market_open'):
        self.wait_until_market_open()
    
    previous_data = pd.DataFrame()
    alert_count = 0
    
    self._start_time = datetime.now()
    if hasattr(self, 'start_background_monitoring'):
        self.start_background_monitoring()
    
    try:
        while True:
            start_time = time.time()
            
            os.system('clear' if os.name == 'posix' else 'cls')
            
            current_time = datetime.now().strftime("%H:%M:%S")
            console.print(f"[bold blue]\U0001f4ca INTRADAY WATCH MODE - {current_time}[/bold blue]")
            console.print(f"[dim]Refresh: {refresh_interval}s | Vol: {volume_threshold}x | Price: {price_threshold}%[/dim]")
            console.print()
            
            if hasattr(self, '_is_market_closed') and self._is_market_closed():
                if hasattr(self, '_exit_all_positions'):
                    self._exit_all_positions("MARKET_CLOSED")
                console.print("[bold red]\U0001f4f4 Market closed - All positions exited. Script will continue monitoring.[/bold red]")
                time.sleep(refresh_interval)
                continue
            
            current_data = _get_watch_data(self, market_cap_filter, max_price, min_price)
            
            if not current_data.empty:
                alerts = []
                if hasattr(self, '_detect_alerts'):
                    alerts = self._detect_alerts(current_data, previous_data, volume_threshold, price_threshold)
                
                if alerts:
                    alert_count += len(alerts)
                    console.print(f"[bold red]\U0001f6a8 ALERTS ({len(alerts)} new, {alert_count} total)[/bold red]")
                    if hasattr(self, '_display_alerts'):
                        self._display_alerts(alerts)
                    console.print()
                
                if hasattr(self, '_display_watch_data'):
                    self._display_watch_data(current_data, alerts)
                else:
                    self.display_table(current_data.head(15), f"Watch Mode - {mode}")
                
                previous_data = current_data.copy()
            else:
                console.print("[red]\u274c No data received - checking connection...[/red]")
            
            elapsed = time.time() - start_time
            sleep_time = max(0, refresh_interval - elapsed)
            
            if sleep_time > 0:
                console.print(f"[dim]Next refresh in {sleep_time:.1f}s... (Ctrl+C to stop)[/dim]")
                time.sleep(sleep_time)
                
    except KeyboardInterrupt:
        console.print("\n[yellow]\U0001f44b Watch mode stopped by user[/yellow]")
        console.print(f"[green]Total alerts generated: {alert_count}[/green]")
        
        end_time = datetime.now()
        if hasattr(self, '_start_time'):
            duration = end_time - self._start_time
            hours, remainder = divmod(duration.total_seconds(), 3600)
            minutes, seconds = divmod(remainder, 60)
            console.print(f"[blue]Execution time: {int(hours)}h:{int(minutes):02d}m:{int(seconds):02d}s[/blue]")
    finally:
        if hasattr(self, 'stop_background_monitoring'):
            self.stop_background_monitoring()


def _get_watch_data(self, market_cap_filter=None, max_price=None, min_price=None):
    """Get current market data for watch mode based on selected mode"""
    mode = getattr(self, 'watch_mode', 'PREBREAKOUT')
    
    try:
        if mode == 'FOMO':
            df = get_watch_data_fomo(self, market_cap_filter, max_price, min_price)
        
        elif mode == 'ACCUMULATION':
            df = get_watch_data_accumulation(self, market_cap_filter, max_price, min_price)
        
        elif mode == 'SMART_FOMO':
            df = get_watch_data_smart_fomo(self, market_cap_filter, max_price, min_price)
        
        elif mode == 'MOMENTUM':
            df = get_watch_data_momentum(self, market_cap_filter, max_price, min_price)
        
        elif mode == 'OPTIMIZED_GAP':
            df = get_watch_data_optimized_gap(self)
        
        elif mode == 'HEAVY_BREAKOUT':
            df = get_watch_data_heavy_breakout(self)
        
        elif mode == 'SCALPING':
            df = get_watch_data_scalping(self)
        
        elif mode == 'MOMENTUM_SCALPER':
            df_candidates = get_watch_data_momentum_scalper(self)
            if not df_candidates.empty:
                df = _add_intraday_momentum_analysis(self, df_candidates)
                df = df.head(10) if not df.empty else df_candidates.head(10)
            else:
                df = df_candidates
        
        elif mode == 'SECTOR_SCALPER':
            df_all = get_watch_data_sector_scalper(self)
            if not df_all.empty:
                df = _analyze_sector_correlations(self, df_all)
            else:
                df = df_all
        
        elif mode == 'SHORT_SQUEEZE':
            df = get_watch_data_short_squeeze(self)
        
        elif mode == 'BREAKOUT_FAILURE':
            df = get_watch_data_breakout_failure(self)
        
        elif mode == 'EXHAUSTION_REVERSAL':
            df = get_watch_data_exhaustion_reversal(self)
        
        elif mode == 'MORNING_FADE':
            df = get_watch_data_morning_fade(self)
        
        elif mode == 'REVERSAL':
            df = get_watch_data_reversal(self)
        
        elif mode == 'VOLUME_SURGE':
            df = get_watch_data_volume_surge(self)
        
        elif mode == 'CHANNEL_PLAY':
            df = get_watch_data_channel_play(self)
        
        elif mode == 'SECTOR_MOMENTUM':
            df = get_watch_data_sector_momentum(self)
        
        elif mode == 'QUICK_PROFIT':
            df = get_watch_data_quick_profit(self)
        
        elif mode == 'FOMO_MOMENTUM':
            df = get_watch_data_fomo_momentum(self, market_cap_filter, max_price, min_price)
        
        elif mode == 'REALTIME_MOMENTUM':
            df = get_watch_data_realtime_momentum(self, market_cap_filter)
            if not df.empty:
                df = self._add_realtime_momentum_analysis(df)
        
        else:
            df = get_watch_data_prebreakout(self, market_cap_filter, max_price, min_price)
        
        if 'Volatility.D' in df.columns:
            df['volatility_pct'] = df['Volatility.D'] * 100
        df['market_cap_cr'] = df['market_cap_basic'] / 1e7
        
        if mode == 'OPTIMIZED_GAP' and not df.empty:
            if hasattr(self, '_calculate_quality_score'):
                df['quality_score'] = self._calculate_quality_score(df)
        
        if mode == 'HEAVY_BREAKOUT' and not df.empty:
            from .smart_money import _add_heavy_breakout_analysis
            df = _add_heavy_breakout_analysis(self, df)
        
        if not df.empty:
            trend_data = []
            for _, row in df.iterrows():
                change = row.get('change', 0)
                rsi = row.get('RSI', 50)
                vol_ratio = row.get('relative_volume_10d_calc', 1)
                
                trend_score = 0
                
                if change > 5:
                    trend_score += 40
                elif change > 2:
                    trend_score += 20
                elif change > 0:
                    trend_score += 10
                elif change < -5:
                    trend_score -= 40
                elif change < -2:
                    trend_score -= 20
                elif change < 0:
                    trend_score -= 10
                
                if rsi > 65:
                    trend_score += 35
                elif rsi > 55:
                    trend_score += 20
                elif rsi > 45:
                    trend_score += 5
                elif rsi < 35:
                    trend_score -= 35
                elif rsi < 45:
                    trend_score -= 20
                
                if vol_ratio > 2:
                    trend_score += 25
                elif vol_ratio > 1.5:
                    trend_score += 15
                elif vol_ratio > 1:
                    trend_score += 5
                elif vol_ratio < 0.5:
                    trend_score -= 15
                
                if trend_score >= 60:
                    trend = 'strong_bullish'
                elif trend_score >= 30:
                    trend = 'bullish'
                elif trend_score >= -30:
                    trend = 'neutral'
                elif trend_score >= -60:
                    trend = 'bearish'
                else:
                    trend = 'strong_bearish'
                
                trend_data.append(trend)
            df['trend'] = trend_data
        
        return df
        
    except Exception as e:
        console.print(f"[red]Error fetching watch data: {e}[/red]")
        return pd.DataFrame()
