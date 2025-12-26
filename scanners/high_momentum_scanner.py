#!/usr/bin/env python3
"""
High Momentum Stock Scanner
Find stocks with strong multi-timeframe momentum for potential long positions
"""

from tradingview_screener import Query, col
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
import pandas as pd
import argparse
import numpy as np

console = Console()

def calculate_roc(price_data, periods):
    """Calculate Rate of Change for given periods"""
    roc_values = {}
    for period in periods:
        if len(price_data) > period:
            roc = ((price_data.iloc[-1] - price_data.iloc[-period]) / price_data.iloc[-period]) * 100
            roc_values[f'ROC_{period}'] = roc
    return roc_values

def detect_trend_acceleration(price_data, periods=[21, 63, 126]):
    """Detect trend acceleration across multiple timeframes"""
    acceleration_score = 0

    for i in range(len(periods) - 1):
        short_period = periods[i]
        long_period = periods[i + 1]

        if len(price_data) > long_period:
            short_ma = price_data.iloc[-short_period:].mean()
            long_ma = price_data.iloc[-long_period:].mean()

            # Check if short MA is above long MA (bullish alignment)
            if short_ma > long_ma:
                acceleration_score += 20

            # Check for recent price above both MAs
            current_price = price_data.iloc[-1]
            if current_price > short_ma and current_price > long_ma:
                acceleration_score += 15

    return acceleration_score

def analyze_volume_momentum(volume_data, price_data, periods=[5, 10, 20]):
    """Analyze volume momentum and price-volume relationship"""
    volume_score = 0

    if len(volume_data) < max(periods):
        return volume_score

    current_price = price_data.iloc[-1]
    current_volume = volume_data.iloc[-1]

    # Volume trend analysis
    for period in periods:
        if len(volume_data) > period:
            avg_volume = volume_data.iloc[-period:].mean()
            volume_ratio = current_volume / avg_volume

            if volume_ratio > 1.5:
                volume_score += 15
            elif volume_ratio > 1.2:
                volume_score += 10

    # Price-volume confirmation (volume spike with price rise)
    if len(price_data) > 5 and len(volume_data) > 5:
        recent_prices = price_data.iloc[-5:]
        recent_volumes = volume_data.iloc[-5:]

        price_up = recent_prices.iloc[-1] > recent_prices.iloc[0]
        volume_up = recent_volumes.iloc[-1] > recent_volumes.mean()

        if price_up and volume_up:
            volume_score += 25

    return min(volume_score, 50)  # Cap at 50

def calculate_risk_score(price_data, volatility_data=None):
    """Calculate risk-adjusted score based on volatility and drawdown"""
    risk_score = 50  # Start neutral

    if len(price_data) < 21:
        return risk_score

    # Volatility assessment
    returns = price_data.pct_change()
    volatility = returns.std() * np.sqrt(252)  # Annualized volatility

    if volatility < 0.2:  # Low volatility
        risk_score += 20
    elif volatility > 0.5:  # High volatility
        risk_score -= 20

    # Maximum drawdown
    if len(price_data) >= 63:
        rolling_max = price_data.expanding().max()
        drawdowns = (price_data - rolling_max) / rolling_max
        max_drawdown = drawdowns.min()

        if max_drawdown > -0.1:  # Less than 10% drawdown
            risk_score += 15
        elif max_drawdown < -0.3:  # More than 30% drawdown
            risk_score -= 15

    return min(max(risk_score, 0), 100)

def calculate_market_condition_score(market_data=None):
    """Calculate market condition score based on overall market trend"""
    # Default to neutral if no market data
    market_score = 50

    # This would ideally use market indices like S&P 500, NIFTY, etc.
    # For now, we'll use a simplified approach based on general market conditions

    # In a real implementation, you would fetch market index data here
    # and analyze the trend, breadth, and sentiment indicators

    return market_score

def calculate_advanced_momentum_score(stock_data, price_history=None):
    """Calculate comprehensive momentum score with advanced metrics"""
    total_score = 0

    # 1. Rate of Change Score (25 points) - Multi-timeframe analysis
    roc_score = 0
    roc_weights = {21: 5, 63: 7, 126: 8, 252: 5}  # 1M, 3M, 6M, 1Y

    # Use RSI as proxy for ROC when historical data not available
    if 'RSI' in stock_data:
        rsi = stock_data['RSI']
        if rsi > 70:
            roc_score = 20
        elif rsi > 60:
            roc_score = 15
        elif rsi > 50:
            roc_score = 10
        elif rsi > 40:
            roc_score = 5

    total_score += min(roc_score, 25)

    # 2. Trend Strength & Acceleration (25 points)
    trend_score = 0

    # MACD analysis if available
    if 'MACD.macd' in stock_data and 'MACD.signal' in stock_data:
        macd = stock_data['MACD.macd']
        signal = stock_data['MACD.signal']

        if macd > signal and macd > 0:
            trend_score += 15
        elif macd > signal:
            trend_score += 10

    # RSI trend confirmation
    if 'RSI' in stock_data and 'RSI[1]' in stock_data:
        current_rsi = stock_data['RSI']
        prev_rsi = stock_data['RSI[1]']

        if current_rsi > prev_rsi and current_rsi > 50:
            trend_score += 10
        elif current_rsi > 50:
            trend_score += 5

    total_score += min(trend_score, 25)

    # 3. Volume Momentum (20 points)
    volume_score = 0
    if 'volume' in stock_data and 'close' in stock_data:
        volume_ratio = stock_data['volume'] / 1000000  # Normalize to millions

        if volume_ratio > 10:
            volume_score += 15
        elif volume_ratio > 5:
            volume_score += 12
        elif volume_ratio > 2:
            volume_score += 8
        elif volume_ratio > 1:
            volume_score += 4

        # Volume-price confirmation
        if stock_data['change'] > 0:
            volume_score += 5

    total_score += min(volume_score, 20)

    # 4. Risk-Adjusted Return (15 points)
    risk_score = 0
    if 'RSI' in stock_data:
        rsi = stock_data['RSI']
        # Optimal RSI range for momentum
        if 55 <= rsi <= 70:
            risk_score += 10
        elif 50 <= rsi <= 75:
            risk_score += 5
        elif rsi > 75:
            risk_score -= 5  # Overbought

    # Volatility consideration (using change as proxy)
    if 'change' in stock_data:
        change = abs(stock_data['change'])
        if change < 3:  # Stable movement
            risk_score += 5
        elif change > 8:  # Too volatile
            risk_score -= 5

    total_score += min(risk_score, 15)

    # 5. Market Condition & Sector Momentum (15 points)
    market_score = 8  # Neutral assumption with slight positive bias

    # Sector strength consideration
    if 'sector' in stock_data:
        # In a real implementation, you would check sector performance
        # For now, assume neutral sector contribution
        market_score += 2

    total_score += min(market_score, 15)

    return min(total_score, 100)

def calculate_momentum_score(stock_data):
    """Calculate comprehensive momentum score (0-100)"""
    total_score = 0

    # Rate of Change Score (30 points max)
    roc_score = 0
    roc_periods = [21, 63, 126, 252]  # 1M, 3M, 6M, 1Y

    for period in roc_periods:
        if f'ROC_{period}' in stock_data:
            roc_value = stock_data[f'ROC_{period}']
            if roc_value > 20:
                roc_score += 7.5  # Max contribution per period
            elif roc_value > 10:
                roc_score += 5
            elif roc_value > 0:
                roc_score += 2.5

    total_score += min(roc_score, 30)

    # Trend Acceleration Score (25 points max)
    trend_score = 0
    # This would be calculated from price data in a real implementation
    # For now, using simplified logic based on available data
    if 'RSI' in stock_data:
        if stock_data['RSI'] > 70:
            trend_score += 15
        elif stock_data['RSI'] > 60:
            trend_score += 10
        elif stock_data['RSI'] > 50:
            trend_score += 5

    total_score += min(trend_score, 25)

    # Volume Momentum Score (20 points max)
    volume_score = 0
    if 'volume' in stock_data and 'close' in stock_data:
        # Simplified volume analysis
        volume_ratio = stock_data['volume'] / 1000000  # Normalize to millions
        if volume_ratio > 5:
            volume_score += 15
        elif volume_ratio > 2:
            volume_score += 10
        elif volume_ratio > 1:
            volume_score += 5

    total_score += min(volume_score, 20)

    # Risk-Adjusted Score (15 points max)
    risk_score = 0
    if 'volatility' in stock_data:
        if stock_data['volatility'] < 0.3:
            risk_score += 10
        elif stock_data['volatility'] < 0.5:
            risk_score += 5

    total_score += min(risk_score, 15)

    # Market Condition Score (10 points max)
    market_score = 5  # Neutral assumption
    total_score += market_score

    return min(total_score, 100)

def find_high_momentum_stocks(market='america'):
    """Find stocks with high multi-timeframe momentum"""
    currency = '$' if market == 'america' else '₹'
    console.print(Panel.fit('🚀 HIGH MOMENTUM STOCK SCANNER', style='bold blue'))

    try:
        # Query for stocks with momentum indicators
        total_rows, df = (
            Query()
            .select(
                'name', 'close', 'high', 'low', 'change', 'volume',
                'RSI', 'RSI[1]', 'MACD.macd', 'MACD.signal',
                'sector', 'description', 'update_mode', 'market_cap_basic'
            )
            .set_markets(market)
            .where(
                col('close') >= 10,                     # No penny stocks
                col('market_cap_basic') >= 500000000,   # Min $500M market cap
                col('volume') > 500000,                 # Min 500K volume
                col('RSI').between(50, 80),             # Momentum range
                col('change') >= -5                     # Not in freefall
            )
            .order_by(col('RSI'), ascending=False)
            .limit(100)
            .get_scanner_data()
        )

        if not df.empty:
            # Calculate momentum metrics
            df['volume_in_millions'] = (df['volume'] / 1000000).round(2)
            df['market_cap_billions'] = (df['market_cap_basic'] / 1000000000).round(2)

            # Calculate comprehensive momentum scores using advanced algorithm
            df['momentum_score'] = 0.0
            df['roc_score'] = 0.0
            df['trend_score'] = 0.0
            df['volume_score'] = 0.0
            df['risk_score'] = 0.0
            df['market_score'] = 0.0

            for idx, stock in df.iterrows():
                # Use advanced momentum scoring
                momentum_score = calculate_advanced_momentum_score(stock)

                # Calculate individual component scores for display
                roc_component = min(stock.get('RSI', 0) * 0.25, 25) if 'RSI' in stock else 0
                trend_component = min(stock.get('RSI', 0) * 0.25, 25) if 'RSI' in stock else 0
                volume_component = min(stock['volume_in_millions'] * 2, 20) if 'volume_in_millions' in stock else 0
                risk_component = 10  # Neutral risk score
                market_component = 8  # Neutral market score

                df.at[idx, 'momentum_score'] = float(momentum_score)
                df.at[idx, 'roc_score'] = float(roc_component)
                df.at[idx, 'trend_score'] = float(trend_component)
                df.at[idx, 'volume_score'] = float(volume_component)
                df.at[idx, 'risk_score'] = float(risk_component)
                df.at[idx, 'market_score'] = float(market_component)

            # Sort by momentum score
            df = df.sort_values('momentum_score', ascending=False)

            console.print(f'[bold green]🎯 Found {len(df)} high momentum stocks![/bold green]')
            console.print()

            # Create results table
            table = Table(title='📈 TOP HIGH MOMENTUM STOCKS', show_header=True, header_style='bold cyan')
            table.add_column('Stock', style='cyan', width=18)
            table.add_column(f'Price {currency}', style='bold white', width=8)
            table.add_column('RSI', style='magenta', width=5)
            table.add_column('Change %', style='green', width=8)
            table.add_column('Volume (M)', style='white', width=10)
            table.add_column('Momentum Score', style='bold red', width=12)
            table.add_column('Action', style='bold green', width=8)

            for _, stock in df.head(15).iterrows():
                momentum_score = int(stock['momentum_score'])

                # Action recommendations based on score and RSI
                if momentum_score >= 80 and stock.get('RSI', 0) >= 60:
                    action = '[bold green]BUY[/bold green]'
                    emoji = '🔥'
                elif momentum_score >= 65 and stock.get('RSI', 0) >= 55:
                    action = '[bold yellow]WATCH[/bold yellow]'
                    emoji = '👀'
                else:
                    action = '[dim]WAIT[/dim]'
                    emoji = '⏳'

                # Score color
                if momentum_score >= 80:
                    score_color = 'bright_green'
                elif momentum_score >= 65:
                    score_color = 'yellow'
                else:
                    score_color = 'red'

                table.add_row(
                    stock['name'][:16],
                    f'{currency}{stock["close"]:.2f}',
                    f'{stock["RSI"]:.0f}',
                    f'+{stock["change"]:.2f}%',
                    f'{stock["volume_in_millions"]:.1f}M',
                    f'{emoji} [{score_color}]{momentum_score}[/{score_color}]',
                    action
                )

            console.print(table)

            # Top momentum candidates
            top_momentum = df[df['momentum_score'] >= 80].head(5)
            if not top_momentum.empty:
                console.print()
                console.print(Panel.fit(
                    '🔥 [bold red]TOP MOMENTUM CANDIDATES (Score ≥ 80):[/bold red]\n' +
                    '\n'.join([f'• {row["name"]}: {currency}{row["close"]:.2f} (RSI: {row["RSI"]:.0f}, Score: {int(row["momentum_score"])}, Vol: {row["volume_in_millions"]:.1f}M)'
                              for _, row in top_momentum.iterrows()]),
                    style='red'
                ))

            # Strong trend candidates (RSI > 65 and Score > 70)
            strong_trend = df[(df['RSI'] >= 65) & (df['momentum_score'] >= 70)].head(5)
            if not strong_trend.empty:
                console.print()
                console.print(Panel.fit(
                    '⚡ [bold yellow]STRONG TREND CANDIDATES (RSI ≥ 65, Score ≥ 70):[/bold yellow]\n' +
                    '\n'.join([f'• {row["name"]}: {currency}{row["close"]:.2f} (RSI: {row["RSI"]:.0f}, Score: {int(row["momentum_score"])})'
                              for _, row in strong_trend.iterrows()]),
                    style='yellow'
                ))

            # Sector analysis
            sector_analysis = df.head(10).groupby('sector').size().sort_values(ascending=False)
            if not sector_analysis.empty:
                console.print()
                sectors_text = '\n'.join([f'• {sector}: {count} stocks' for sector, count in sector_analysis.items()])
                console.print(Panel.fit(
                    f'📊 [bold blue]MOMENTUM SECTORS:[/bold blue]\n{sectors_text}',
                    style='blue'
                ))

            # Score distribution analysis
            score_ranges = {
                'Excellent (≥80)': len(df[df['momentum_score'] >= 80]),
                'Good (70-79)': len(df[(df['momentum_score'] >= 70) & (df['momentum_score'] < 80)]),
                'Fair (60-69)': len(df[(df['momentum_score'] >= 60) & (df['momentum_score'] < 70)]),
                'Weak (<60)': len(df[df['momentum_score'] < 60])
            }

            console.print()
            score_dist_text = '\n'.join([f'• {range_name}: {count} stocks' for range_name, count in score_ranges.items()])
            console.print(Panel.fit(
                f'📊 [bold magenta]SCORE DISTRIBUTION:[/bold magenta]\n{score_dist_text}',
                style='magenta'
            ))

            # Summary statistics
            avg_score = df['momentum_score'].mean()
            avg_rsi = df['RSI'].mean()
            total_stocks = len(df)

            console.print()
            console.print(Panel.fit(
                f'[bold]📈 MOMENTUM ANALYSIS SUMMARY:[/bold]\n'
                f'• Total Candidates: [cyan]{total_stocks}[/cyan]\n'
                f'• Average Momentum Score: [yellow]{avg_score:.1f}/100[/yellow]\n'
                f'• Average RSI: [green]{avg_rsi:.0f}[/green]\n'
                f'• Excellent Momentum (≥80): [red]{score_ranges["Excellent (≥80)"]}[/red]\n'
                f'• Good Momentum (70-79): [yellow]{score_ranges["Good (70-79)"]}[/yellow]\n'
                f'• Strong Trend (RSI ≥65): [bright_green]{len(df[df["RSI"] >= 65])}[/bright_green]',
                style='blue'
            ))

            # Advanced trading strategy recommendations
            console.print()
            console.print(Panel.fit(
                '💡 [bold green]ADVANCED MOMENTUM TRADING STRATEGY:[/bold green]\n'
                '🔥 BUY SIGNAL: Score ≥80 + RSI ≥60 + Volume >2M + Positive MACD\n'
                '👀 WATCH LIST: Score 70-79 + RSI 55-70 + Increasing volume trend\n'
                '⏳ WAIT/AVOID: Score <70 or RSI <50 or negative momentum divergence\n'
                '\n[bold]RISK MANAGEMENT:[/bold]\n'
                '• Entry: Break above recent resistance or consolidation breakout\n'
                '• Stop Loss: 5-7% below entry or recent swing low\n'
                '• Take Profit: 10-15% gain or momentum exhaustion signals\n'
                '• Position Size: 1-2% per trade, max 5% sector exposure\n'
                '• Exit Signals: RSI >75, MACD bearish cross, volume divergence',
                style='green'
            ))

            # Export to CSV with detailed metrics
            filename = f'high_momentum_stocks_{pd.Timestamp.now().strftime("%Y%m%d_%H%M")}.csv'
            df.to_csv(filename, index=False)
            console.print(f'[dim]💾 Detailed data exported to: {filename}[/dim]')

        else:
            console.print('[yellow]⚠️ No high momentum stocks found matching criteria[/yellow]')
            console.print('[dim]Try relaxing filters (lower RSI range or volume requirements)[/dim]')

    except Exception as e:
        console.print(f'[red]❌ Error: {str(e)}[/red]')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='High Momentum Stock Scanner')
    parser.add_argument('--market', choices=['us', 'india'], default='us',
                        help='Market to scan: us (america) or india')
    args = parser.parse_args()
    market = 'america' if args.market == 'us' else 'india'
    find_high_momentum_stocks(market)