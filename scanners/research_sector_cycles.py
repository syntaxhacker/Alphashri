#!/usr/bin/env python3
"""
Sector Cycle Research - Understanding Actual Patterns

This script:
1. Loads the historical data we have
2. Analyzes what patterns actually exist
3. Combines Upstox data with TradingView metrics
4. Identifies actionable signals
"""

import json
import pandas as pd
import numpy as np
from pathlib import Path
from datetime import datetime
import warnings
warnings.filterwarnings('ignore')

print("=" * 70)
print("SECTOR CYCLE RESEARCH - Understanding Actual Patterns")
print("=" * 70)

# Load data
data_file = Path('historical_sector_cycles/dashboard_data.json')
with open(data_file) as f:
    data = json.load(f)

print(f"\n📊 Data Loaded:")
print(f"  - Period: {data['metadata']['analysis_period_years']} years")
print(f"  - Sectors: {data['metadata']['total_sectors']}")
print(f"  - Generated: {data['metadata']['generated_at']}")

# Convert to DataFrames for analysis
sectors_info = []
returns_data = []

for sector in data['sectors']:
    name = sector['name']
    current_phase = sector['current_phase']
    current_return = sector['current_return']

    # Get returns as DataFrame
    df = pd.DataFrame(sector['returns'])
    df['date'] = pd.to_datetime(df['date'])
    df.set_index('date', inplace=True)

    # Calculate metrics
    total_return = df['value'].iloc[-1]
    volatility = df['value'].pct_change().std() * np.sqrt(252) * 100
    max_drawdown = ((df['value'].cummax() - df['value']) / df['value'].cummax() * 100).max()
    sharpe = (df['value'].pct_change().mean() * 252) / (df['value'].pct_change().std() * np.sqrt(252)) if df['value'].pct_change().std() > 0 else 0

    # Monthly returns
    monthly = df.resample('M').last()
    monthly_returns = monthly['value'].pct_change().dropna() * 100

    # Best/worst months
    monthly_by_month = {}
    for i in range(12):
        month_data = monthly_returns[monthly_returns.index.month == i + 1]
        if len(month_data) > 0:
            monthly_by_month[i + 1] = month_data.mean()

    best_month = max(monthly_by_month, key=monthly_by_month.get) if monthly_by_month else None
    worst_month = min(monthly_by_month, key=monthly_by_month.get) if monthly_by_month else None

    sectors_info.append({
        'sector': name,
        'current_return': current_return,
        'volatility': volatility,
        'max_drawdown': max_drawdown,
        'sharpe': sharpe,
        'data_points': len(df),
        'best_month': best_month,
        'worst_month': worst_month,
        'monthly_avg': monthly_returns.mean(),
        'monthly_std': monthly_returns.std(),
        'current_phase': current_phase
    })

    # Store for correlation analysis
    df_monthly = monthly['value'].pct_change().dropna()
    df_monthly.name = name
    returns_data.append(df_monthly)

print(f"\n🔍 Analyzing patterns...")

# Create DataFrame
sectors_df = pd.DataFrame(sectors_info)
sectors_df = sectors_df.sort_values('current_return', ascending=False)

print(f"\n{'='*70}")
print(f"SECTOR PERFORMANCE RANKING (3 Years)")
print(f"{'='*70}")
print(f"{'Rank':<5} {'Sector':<20} {'Return':>10} {'Vol':>8} {'DD':>8} {'Sharpe':>8} {'Phase':<15}")
print(f"-"*70)

for i, row in sectors_df.iterrows():
    rank = sectors_df.index.get_loc(i) + 1
    print(f"{rank:<5} {row['sector']:<20} {row['current_return']:>9.1f}% {row['volatility']:>7.1f}% {row['max_drawdown']:>7.1f}% {row['sharpe']:>8.2f} {row['current_phase']:<15}")

# Monthly seasonality analysis
print(f"\n{'='*70}")
print(f"MONTHLY SEASONALITY (Which months are strong/weak for each sector)")
print(f"{'='*70}")

monthly_seasonality = pd.DataFrame([s['monthly_by_month'] for s in sectors_info if 'monthly_by_month' in sectors_info])
monthly_seasonality.index = [s['sector'] for s in sectors_info if 'monthly_by_month' in s]
monthly_seasonality = monthly_seasonality.T
monthly_seasonality.columns = monthly_seasonality.columns.str[:15]
monthly_seasonality.index = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

print("\nAverage Monthly Returns by Sector (%):")
print(monthly_seasonality.round(1).to_string())

# Correlation analysis
print(f"\n{'='*70}")
print(f"SECTOR CORRELATION MATRIX (Do sectors move together?)")
print(f"{'='*70}")

if len(returns_data) > 1:
    # Align all
    corr_df = pd.concat(returns_data, axis=1).dropna()
    correlation = corr_df.corr()

    # Find highly correlated pairs
    high_corr = []
    for i in range(len(correlation.columns)):
        for j in range(i+1, len(correlation.columns)):
            corr_val = correlation.iloc[i, j]
            if abs(corr_val) > 0.7:
                high_corr.append((correlation.columns[i], correlation.columns[j], corr_val))

    print("\nHighly Correlated Sector Pairs (|corr| > 0.7):")
    if high_corr:
        for s1, s2, corr in sorted(high_corr, key=lambda x: abs(x[2]), reverse=True):
            print(f"  {s1:<15} <-> {s2:<15}: {corr:6.3f}")
    else:
        print("  No highly correlated pairs found")

    # Find inversely correlated (rotation opportunities)
    low_corr = []
    for i in range(len(correlation.columns)):
        for j in range(i+1, len(correlation.columns)):
            corr_val = correlation.iloc[i, j]
            if corr_val < -0.3:
                low_corr.append((correlation.columns[i], correlation.columns[j], corr_val))

    print("\nInversely Correlated Pairs (Rotation opportunities):")
    if low_corr:
        for s1, s2, corr in sorted(low_corr, key=lambda x: x[2]):
            print(f"  {s1:<15} <-> {s2:<15}: {corr:6.3f}")
    else:
        print("  No inverse correlations found")

# Momentum analysis
print(f"\n{'='*70}")
print(f"MOMENTUM ANALYSIS (Which sectors are trending now?)")
print(f"{'='*70}")

# Get recent 3-month performance
recent_performance = []
for sector in data['sectors']:
    df = pd.DataFrame(sector['returns'])
    df['date'] = pd.to_datetime(df['date'])
    df.set_index('date', inplace=True)

    # Recent 1 month, 3 month, 6 month
    one_month = df['value'].iloc[-1] - df['value'].iloc[-22] if len(df) >= 22 else df['value'].iloc[-1]
    three_month = df['value'].iloc[-1] - df['value'].iloc[-66] if len(df) >= 66 else df['value'].iloc[-1]
    six_month = df['value'].iloc[-1] - df['value'].iloc[-132] if len(df) >= 132 else df['value'].iloc[-1]

    recent_performance.append({
        'sector': sector['name'],
        '1M': one_month,
        '3M': three_month,
        '6M': six_month,
        'Total': df['value'].iloc[-1]
    })

momentum_df = pd.DataFrame(recent_performance)
momentum_df = momentum_df.sort_values('3M', ascending=False)

print(f"\n{'Sector':<20} {'1M':>8} {'3M':>8} {'6M':>8} {'Total':>8} {'Trend':<15}")
print("-"*70)
for _, row in momentum_df.iterrows():
    # Determine trend
    if row['1M'] > 0 and row['3M'] > 0 and row['6M'] > 0:
        trend = "STRONG UPTREND"
    elif row['1M'] > 5 and row['3M'] < 0:
        trend = "RECENT BREAKOUT"
    elif row['1M'] < 0 and row['3M'] < 0:
        trend = "DOWNTREND"
    elif row['6M'] > 0 and row['1M'] < 0:
        trend = "CONSOLIDATING"
    else:
        trend = "MIXED"

    print(f"{row['sector']:<20} {row['1M']:>7.1f}% {row['3M']:>7.1f}% {row['6M']:>7.1f}% {row['Total']:>7.1f}% {trend:<15}")

# Identify actionable signals
print(f"\n{'='*70}")
print(f"ACTIONABLE SIGNALS (Based on actual data patterns)")
print(f"{'='*70}")

buy_signals = []
sell_signals = []
hold_signals = []

for _, row in momentum_df.iterrows():
    sector = row['sector']
    m1 = row['1M']
    m3 = row['3M']
    m6 = row['6M']

    # BUY signals
    if m6 < 0 and m1 > 0:  # Was down, now turning up
        buy_signals.append((sector, "Reversal - 6M down but 1M up", m1, m3, m6))
    elif m1 > 3 and m3 > 5 and m6 > 10:  # Strong momentum
        buy_signals.append((sector, "Strong Momentum - All timeframes positive", m1, m3, m6))
    elif m1 < -5 and m3 < -10:  # Oversold
        buy_signals.append((sector, "Oversold - Recent dip, potential entry", m1, m3, m6))

    # SELL signals
    if m6 > 20 and m1 < 0:  # Extended run, now slowing
        sell_signals.append((sector, "Profit Taking - 6M run, 1M negative", m1, m3, m6))
    elif m1 > 15 and m3 > 25:  # Parabolic
        sell_signals.append((sector, "Overbought - Parabolic move", m1, m3, m6))

print(f"\n🟢 BUY SIGNALS ({len(buy_signals)}):")
if buy_signals:
    for s, reason, m1, m3, m6 in buy_signals[:5]:
        print(f"  • {s:<15} | 1M:{m1:6.1f}% 3M:{m3:6.1f}% 6M:{m6:6.1f}% | {reason}")
else:
    print("  None")

print(f"\n🔴 SELL/PARTIAL PROFIT SIGNALS ({len(sell_signals)}):")
if sell_signals:
    for s, reason, m1, m3, m6 in sell_signals[:5]:
        print(f"  • {s:<15} | 1M:{m1:6.1f}% 3M:{m3:6.1f}% 6M:{m6:6.1f}% | {reason}")
else:
    print("  None")

print(f"\n{'='*70}")
print(f"KEY FINDINGS")
print(f"{'='*70}")

print(f"""
1. BEST PERFORMING SECTOR: {sectors_df.iloc[0]['sector']} (+{sectors_df.iloc[0]['current_return']:.1f}%)
   Worst: {sectors_df.iloc[-1]['sector']} ({sectors_df.iloc[-1]['current_return']:.1f}%)
   Spread: {sectors_df.iloc[0]['current_return'] - sectors_df.iloc[-1]['current_return']:.1f}%

2. MOST VOLATILE: {sectors_df.loc[sectors_df['volatility'].idxmax(), 'sector']} ({sectors_df['volatility'].max():.1f}%)
   LEAST VOLATILE: {sectors_df.loc[sectors_df['volatility'].idxmin(), 'sector']} ({sectors_df['volatility'].min():.1f}%)

3. BEST RISK-REWARD: {sectors_df.loc[sectors_df['sharpe'].idxmax(), 'sector']} (Sharpe: {sectors_df['sharpe'].max():.2f})

4. SEASONALITY:
   Best month on average: {monthly_seasonality.mean().idxmax()} (+{monthly_seasonality.mean().max():.1f}%)
   Worst month on average: {monthly_seasonality.mean().idxmin()} ({monthly_seasonality.mean().min():.1f}%)

5. CURRENT MARKET PHASE: Based on momentum analysis
   - Strong uptrend sectors: {len(momentum_df[momentum_df['1M'] > 0])}
   - Declining sectors: {len(momentum_df[momentum_df['1M'] < 0])}
   - Reversal candidates (6M down, 1M up): {len(momentum_df[(momentum_df['6M'] < 0) & (momentum_df['1M'] > 0)])}
""")

print(f"\n{'='*70}")
print(f"NEXT STEPS - Combine with TradingView data")
print(f"{'='*70}")
print("""
To improve this analysis, we should:

1. ADD NIFTY/INDEX BENCHMARK:
   - Calculate relative strength vs Nifty
   - Identify sectors outperforming/underperforming market

2. ADD TRADINGVIEW METRICS:
   - RSI, ADX, MACD for current conditions
   - 52-week high/low positioning
   - Volume patterns (rel volume)

3. CREATE ROTATION MODEL:
   - When Sector A peaks → rotate to Sector B
   - Based on historical correlation and seasonality

4. TIMING SIGNALS:
   - Entry: When RS turns positive + RSI < 60
   - Exit: When RS turns negative + RSI > 70

Would you like me to implement this enhanced analysis?
""")

print(f"\n{'='*70}")
