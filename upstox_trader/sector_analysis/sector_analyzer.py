#!/usr/bin/env python3
"""
Sector Analyzer Module - Core analysis logic for sector correlation calculations,
stock predictions, and covariance matrix computation.
"""

import numpy as np
import pandas as pd
from typing import Dict, List, Tuple, Optional

from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn

console = Console()


class SectorAnalyzer:
    def __init__(self, lookback_days: int = 365, min_correlation: float = 0.3):
        self.lookback_days = lookback_days
        self.min_correlation = min_correlation
        self.sector_data = {}
        self.correlation_matrix = None
        self.sector_returns = None
        
        console.print(f"[blue]📊 Initialized Sector Analyzer[/blue]")
        console.print(f"[dim]Lookback: {lookback_days} days | Min Correlation: {min_correlation}[/dim]")
    
    def calculate_sector_returns(self, sector_stocks: Dict[str, List[Dict]], 
                                 fetch_historical_func) -> pd.DataFrame:
        """Calculate daily sector returns from constituent stocks"""
        console.print(Panel.fit("📈 Calculating Sector Returns", style="bold green"))
        
        sector_returns = {}
        
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console
        ) as progress:
            task = progress.add_task("Processing sectors...", total=len(sector_stocks))
            
            for sector, stocks in sector_stocks.items():
                progress.update(task, description=f"Processing {sector}...")
                
                sector_price_data = []
                top_stocks = sorted(stocks, key=lambda x: x.get('market_cap', 0), reverse=True)[:10]
                
                successful_stocks = 0
                for stock in top_stocks:
                    symbol = stock['symbol']
                    if symbol:
                        df = fetch_historical_func(symbol, self.lookback_days)
                        if not df.empty:
                            df['returns'] = df['close'].pct_change()
                            df['weight'] = stock.get('market_cap', 1)
                            df['symbol'] = symbol
                            sector_price_data.append(df[['timestamp', 'returns', 'weight', 'symbol']])
                            successful_stocks += 1
                        else:
                            console.print(f"[yellow]⚠️ No data for {symbol} - skipping[/yellow]")
                
                if successful_stocks > 0:
                    console.print(f"[green]✅ Got data for {successful_stocks}/{len(top_stocks)} stocks in {sector}[/green]")
                else:
                    console.print(f"[red]❌ No data available for any stocks in {sector}[/red]")
                
                if sector_price_data:
                    combined_df = pd.concat(sector_price_data)
                    
                    daily_sector_returns = []
                    for date in combined_df['timestamp'].unique():
                        date_data = combined_df[combined_df['timestamp'] == date]
                        if not date_data.empty:
                            weights = date_data['weight'] / date_data['weight'].sum()
                            weighted_return = (date_data['returns'] * weights).sum()
                            daily_sector_returns.append({
                                'date': date,
                                'return': weighted_return
                            })
                    
                    if daily_sector_returns:
                        sector_df = pd.DataFrame(daily_sector_returns)
                        sector_returns[sector] = sector_df.set_index('date')['return']
                
                progress.advance(task)
        
        if sector_returns:
            returns_df = pd.DataFrame(sector_returns).fillna(0)
            
            if len(returns_df.columns) < 3:
                console.print(f"[red]❌ Insufficient sectors ({len(returns_df.columns)}) - need at least 3 for correlation analysis[/red]")
                return pd.DataFrame()
            
            if len(returns_df) < 30:
                console.print(f"[red]❌ Insufficient historical data ({len(returns_df)} days) - need at least 30 days[/red]")
                return pd.DataFrame()
            
            console.print(f"[green]✅ Calculated returns for {len(returns_df.columns)} sectors over {len(returns_df)} days[/green]")
            return returns_df
        else:
            console.print("[red]❌ No sector return data calculated - Check Upstox API configuration and access token[/red]")
            return pd.DataFrame()
    
    def calculate_correlation_matrix(self, returns_df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame]:
        """Calculate correlation and covariance matrices"""
        console.print(Panel.fit("🔢 Calculating Correlation Matrix", style="bold yellow"))
        
        rolling_corr = returns_df.rolling(window=30).corr()
        correlation_matrix = returns_df.corr()
        covariance_matrix = returns_df.cov()
        
        mask = np.abs(correlation_matrix) >= self.min_correlation
        significant_corr = correlation_matrix.where(mask)
        
        console.print(f"[green]✅ Correlation matrix calculated[/green]")
        console.print(f"[dim]Found {(np.abs(correlation_matrix) >= self.min_correlation).sum().sum()} significant correlations[/dim]")
        
        return correlation_matrix, covariance_matrix
    
    def identify_lead_lag_relationships(self, returns_df: pd.DataFrame) -> Dict[str, Dict]:
        """Identify which sectors lead or lag others"""
        console.print(Panel.fit("⏱️ Identifying Lead-Lag Relationships", style="bold cyan"))
        
        lead_lag_results = {}
        sectors = returns_df.columns.tolist()
        
        for sector1 in sectors:
            lead_lag_results[sector1] = {}
            
            for sector2 in sectors:
                if sector1 != sector2:
                    max_lag = 5
                    correlations = []
                    
                    for lag in range(-max_lag, max_lag + 1):
                        if lag == 0:
                            corr = returns_df[sector1].corr(returns_df[sector2])
                        elif lag > 0:
                            s1_data = returns_df[sector1].iloc[:-lag]
                            s2_data = returns_df[sector2].iloc[lag:]
                            corr = s1_data.corr(s2_data)
                        else:
                            s1_data = returns_df[sector1].iloc[-lag:]
                            s2_data = returns_df[sector2].iloc[:lag]
                            corr = s1_data.corr(s2_data)
                        
                        correlations.append((lag, corr))
                    
                    best_lag, best_corr = max(correlations, key=lambda x: abs(x[1]) if not np.isnan(x[1]) else 0)
                    
                    if abs(best_corr) >= self.min_correlation:
                        lead_lag_results[sector1][sector2] = {
                            'correlation': best_corr,
                            'lag': best_lag,
                            'relationship': 'leads' if best_lag > 0 else 'lags' if best_lag < 0 else 'concurrent'
                        }
        
        return lead_lag_results
    
    def find_correlated_sectors(self, trigger_sector: str, correlation_matrix: pd.DataFrame) -> List[Tuple[str, float]]:
        """Find sectors most correlated with the trigger sector"""
        if trigger_sector not in correlation_matrix.columns:
            available_sectors = list(correlation_matrix.columns)
            console.print(f"[red]Sector '{trigger_sector}' not found[/red]")
            console.print(f"[yellow]Available sectors: {available_sectors}[/yellow]")
            return []
        
        correlations = correlation_matrix[trigger_sector].abs().sort_values(ascending=False)
        correlations = correlations[correlations >= self.min_correlation]
        correlations = correlations[correlations.index != trigger_sector]
        
        return [(sector, corr) for sector, corr in correlations.items()]
    
    def predict_sector_movement(self, trigger_sector: str, trigger_movement: float, 
                              correlation_matrix: pd.DataFrame) -> Dict[str, Dict]:
        """Predict movement in correlated sectors"""
        console.print(Panel.fit(f"🎯 Predicting Movement | Trigger: {trigger_sector} ({trigger_movement:+.2f}%)", style="bold magenta"))
        
        correlated_sectors = self.find_correlated_sectors(trigger_sector, correlation_matrix)
        predictions = {}
        
        if not correlated_sectors:
            console.print("[yellow]No significant correlations found[/yellow]")
            return predictions
        
        for sector, correlation in correlated_sectors:
            predicted_movement = trigger_movement * correlation
            confidence = abs(correlation)
            
            predictions[sector] = {
                'predicted_movement': predicted_movement,
                'correlation': correlation,
                'confidence': confidence,
                'direction': 'positive' if predicted_movement > 0 else 'negative'
            }
        
        return predictions
    
    def get_sector_stock_candidates(self, sector: str, sector_stocks: Dict[str, List[Dict]], 
                                  predicted_direction: str) -> List[Dict]:
        """Get best stock candidates from predicted sector"""
        if sector not in sector_stocks:
            return []
        
        stocks = sector_stocks[sector]
        
        scored_stocks = []
        for stock in stocks:
            score = 0
            
            if stock.get('market_cap', 0) > 5_000_000_000:
                score += 3
            elif stock.get('market_cap', 0) > 1_000_000_000:
                score += 2
            else:
                score += 1
            
            if stock.get('volume', 0) > 1_000_000:
                score += 2
            elif stock.get('volume', 0) > 500_000:
                score += 1
            
            if predicted_direction == 'positive':
                if stock.get('perf_w', 0) > 0:
                    score += 2
                if stock.get('rsi', 50) < 70:
                    score += 1
            else:
                if stock.get('perf_w', 0) < 0:
                    score += 2
                if stock.get('rsi', 50) > 30:
                    score += 1
            
            beta = stock.get('beta', 1)
            if beta > 1.2:
                score += 2
            elif beta > 1.0:
                score += 1
            
            stock['prediction_score'] = score
            scored_stocks.append(stock)
        
        scored_stocks.sort(key=lambda x: x['prediction_score'], reverse=True)
        return scored_stocks[:10]
    
    def calculate_intra_sector_correlations(self, sector_stocks: Dict[str, List[Dict]],
                                           fetch_historical_func) -> Dict[str, pd.DataFrame]:
        """Calculate correlations between stocks within each sector"""
        console.print(Panel.fit("🔗 Calculating Intra-Sector Stock Correlations", style="bold cyan"))
        
        sector_correlations = {}
        
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console
        ) as progress:
            task = progress.add_task("Processing sectors...", total=len(sector_stocks))
            
            for sector, stocks in sector_stocks.items():
                progress.update(task, description=f"Processing {sector}...")
                
                stock_returns = {}
                top_stocks = sorted(stocks, key=lambda x: x.get('market_cap', 0), reverse=True)[:15]
                
                for stock in top_stocks:
                    symbol = stock['symbol']
                    if symbol:
                        df = fetch_historical_func(symbol, min(self.lookback_days, 90))
                        if not df.empty and len(df) > 20:
                            returns = df['close'].pct_change().dropna()
                            if len(returns) > 15:
                                stock_returns[symbol] = returns
                
                if len(stock_returns) >= 3:
                    returns_df = pd.DataFrame(stock_returns).fillna(0)
                    corr_matrix = returns_df.corr()
                    sector_correlations[sector] = corr_matrix
                
                progress.advance(task)
        
        console.print(f"[green]✅ Calculated correlations for {len(sector_correlations)} sectors[/green]")
        return sector_correlations
    
    def detect_sector_movements(self, previous: Dict, current: Dict, 
                               threshold: float, min_corr: float,
                               correlation_matrix: pd.DataFrame) -> List[Dict]:
        """Detect significant sector movements and generate correlation alerts"""
        alerts = []
        
        for sector in current.keys():
            if sector not in previous:
                continue
                
            current_change = current[sector]['change']
            previous_change = previous[sector].get('change', 0)
            movement_delta = current_change - previous_change
            
            if abs(movement_delta) >= threshold:
                if sector in correlation_matrix.index:
                    correlations = correlation_matrix[sector].abs()
                    significant_corr = correlations[correlations >= min_corr]
                    significant_corr = significant_corr[significant_corr.index != sector]
                    
                    if len(significant_corr) > 0:
                        alert = {
                            'trigger_sector': sector,
                            'movement': movement_delta,
                            'current_change': current_change,
                            'volume_ratio': current[sector]['volume_ratio'],
                            'correlated_sectors': [],
                            'timestamp': pd.Timestamp.now(),
                            'signal_type': 'BULLISH' if movement_delta > 0 else 'BEARISH'
                        }
                        
                        for corr_sector, correlation in significant_corr.items():
                            predicted_move = movement_delta * correlation
                            alert['correlated_sectors'].append({
                                'sector': corr_sector,
                                'correlation': correlation,
                                'predicted_move': predicted_move,
                                'current_change': current.get(corr_sector, {}).get('change', 0)
                            })
                        
                        alert['correlated_sectors'].sort(key=lambda x: abs(x['correlation']), reverse=True)
                        alerts.append(alert)
        
        return alerts
    
    def get_top_correlations(self, correlation_matrix: pd.DataFrame, 
                            min_corr: Optional[float] = None) -> List[Tuple[str, str, float]]:
        """Extract top correlation pairs from matrix"""
        if min_corr is None:
            min_corr = self.min_correlation
            
        corr_pairs = []
        for i, sector1 in enumerate(correlation_matrix.columns):
            for j, sector2 in enumerate(correlation_matrix.columns):
                if i < j:
                    corr_val = correlation_matrix.loc[sector1, sector2]
                    if not pd.isna(corr_val) and abs(corr_val) >= min_corr:
                        corr_pairs.append((sector1, sector2, corr_val))
        
        corr_pairs.sort(key=lambda x: abs(x[2]), reverse=True)
        return corr_pairs
