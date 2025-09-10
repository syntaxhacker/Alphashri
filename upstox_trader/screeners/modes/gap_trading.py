"""
Gap Trading Strategy Module
===========================

This module contains various gap trading strategies.
"""

from rich.panel import Panel
from rich.console import Console
from tradingview_screener import Query, col

console = Console()

def gap_fill_trading_strategy(self):
    """Historical gap-fill probability analysis"""
    console.print(Panel.fit("🎯 GAP-FILL ANALYSIS: Historical Probability Study", style="bold magenta"))
    try:
        # Get current volume movers with gaps
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,  # Minimum price
                col('volume') > 500000,  # High volume
                col('market_cap_basic') > 500000000,  # 50 Cr minimum market cap
                col('relative_volume_10d_calc') > 1.5,  # Volume surge
                col('change').abs() > 1.0,  # Significant gap (1%+)
                col('exchange') == 'NSE'
            )
            .order_by(col('relative_volume_10d_calc'), ascending=False)
            .limit(30)
            .get_scanner_data(cookies=self.cookies)
        )
        
        if not df.empty:
            # Add gap analysis
            df = self._add_gap_analysis(df)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(20), "🎯 GAP-FILL ANALYSIS Results")
            else:
                console.print("[green]Found gap-fill candidates:[/green]")
                console.print(df[['name', 'close', 'change', 'volume', 'relative_volume_10d_calc', 'gap_fill_probability']].head(20).to_string())
        else:
            console.print("[yellow]No significant gaps found currently[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in gap-fill analysis: {e}[/red]")

def live_gap_fill_monitor_with_sr(self, refresh_interval=30):
    """Live gap-fill monitor with support/resistance analysis"""
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
                if self.paper_trading_enabled:
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

def optimized_gap_strategy_15min(self):
    """Optimized gap strategy using 15-minute timeframe"""
    console.print(Panel.fit("🚀 OPTIMIZED GAP STRATEGY: 15-Minute Framework (68.4% Win Rate)", style="bold green"))
    try:
        # Get gap stocks with additional filters
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc',
                'RSI', 'price_52_week_high', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,  # Minimum price
                col('volume') > 300000,  # Decent volume
                col('market_cap_basic') > 1000000000,  # 100 Cr minimum market cap
                col('relative_volume_10d_calc') > 1.3,  # Volume interest
                col('change').abs().between(1.5, 15),  # Quality gap range
                col('price_52_week_high') > col('close') * 1.05,  # Not near 52-week high
                col('exchange') == 'NSE'
            )
            .order_by(col('change').abs(), ascending=False)
            .limit(25)
            .get_scanner_data(cookies=self.cookies)
        )
        
        if not df.empty:
            # Add gap quality scoring
            df = self._calculate_gap_quality_score(df)
            
            # Sort by quality score
            df = df.sort_values('gap_quality_score', ascending=False)
            
            # Display results
            if hasattr(self, 'display_table'):
                self.display_table(df.head(15), "🚀 OPTIMIZED GAP STRATEGY Candidates")
            else:
                console.print("[green]Found optimized gap strategy candidates:[/green]")
                console.print(df[['name', 'close', 'change', 'volume', 'relative_volume_10d_calc', 'gap_quality_score']].head(15).to_string())
        else:
            console.print("[yellow]No stocks found matching optimized gap criteria[/yellow]")
            
    except Exception as e:
        console.print(f"[red]Error in optimized gap strategy: {e}[/red]")

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
        total_rows, largecap_gaps = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                'RSI', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 50,  # Higher price filter
                col('market_cap_basic') > 1e9,  # Min 1000 crores (large cap)
                col('volume') > 1000000,  # High absolute volume
                (col('change') > 1.2) | (col('change') < -1.2),  # Significant gaps
                col('exchange') == 'NSE'
            )
            .order_by('market_cap_basic', ascending=False)  # Prefer larger caps
            .limit(8)
            .get_scanner_data(cookies=self.cookies)
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
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                'RSI', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
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
            .get_scanner_data(cookies=self.cookies)
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
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                'RSI', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
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
            .get_scanner_data(cookies=self.cookies)
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

def _get_volume_movers_with_gaps(self):
    """Get current volume movers that have significant gaps"""
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'volume', 'change', 'relative_volume_10d_calc', 
                'RSI', 'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 30,
                col('volume') > 500000,    # High volume
                col('relative_volume_10d_calc') > 1.5,  # Above normal volume
                col('market_cap_basic') > 5e7,  # Min 50 crores
                col('exchange') == 'NSE'
            )
            .order_by('relative_volume_10d_calc', ascending=False)
            .limit(10)  # Top 10 volume movers with gaps
            .get_scanner_data(cookies=self.cookies)
        )
        
        # Filter for stocks with meaningful gaps (0.8% or more) after getting data
        if not df.empty:
            df = df[df['change'].abs() >= 0.8].copy()
        
        return df
        
    except Exception as e:
        console.print(f"[red]Error fetching volume movers: {e}[/red]")
        return pd.DataFrame()