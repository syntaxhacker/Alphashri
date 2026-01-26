#!/usr/bin/env python3
"""
Enhanced Sector Rotation Analyzer

Features:
- Fetches 5 years of historical data from Upstox
- Shows sector rotation by month/quarter
- Time range filters (1Y, 3Y, 5Y, YTD, Custom)
- Sector ranking changes over time
- Correlation analysis
- Export for interactive D3 dashboard
"""

import sys
import os
from pathlib import Path
from datetime import datetime, timedelta
import json
import warnings

import pandas as pd
import numpy as np

# Add project root
_script_dir = Path(__file__).parent
_project_root = _script_dir.parent
sys.path.insert(0, str(_project_root))

from upstox_trader.config_and_utils.free_indian_apis import TradingAPIFactory

warnings.filterwarnings('ignore')

# Sector representatives
SECTOR_REPRESENTATIVES = {
    'Finance': ['HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK', 'KOTAKBANK'],
    'Technology': ['TCS', 'INFY', 'HCLTECH', 'WIPRO', 'LTIM'],
    'Energy': ['RELIANCE', 'ONGC', 'NTPC', 'POWERGRID', 'TATAPOWER'],
    'Automotive': ['TATAMOTORS', 'MARUTI', 'M&M', 'BAJAJ-AUTO', 'EICHERMOT'],
    'Pharma': ['SUNPHARMA', 'DRREDDY', 'CIPLA', 'AUROPHARMA', 'DIVISLAB'],
    'Consumer': ['TITAN', 'WHIRLPOOL', 'VOLTAS', 'BLUESTAR', 'HAVELLS'],
    'Infrastructure': ['LT', 'DLF', 'ADANIPORTS', 'BHARTIARTL', 'ABB'],
    'Metals': ['TATASTEEL', 'HINDALCO', 'JSWSTEEL', 'COALINDIA', 'NMDC'],
    'FMCG': ['HINDUNILVR', 'ITC', 'NESTLEIND', 'BRITANNIA', 'DABUR'],
    'Healthcare': ['APOLLOHOSP', 'MAXHEALTH', 'FORTIS', 'GLENMARK'],
    'Telecom': ['RELIANCE', 'BHARTIARTL', 'VODAFONEIDEA'],
    'Chemicals': ['PIIND', 'SRF', 'DEEPAKNTR', 'TATACHEM'],
    'OilGas': ['RELIANCE', 'ONGC', 'GAIL', 'BPCL', 'IOC'],
    'Power': ['NTPC', 'POWERGRID', 'TATAPOWER', 'ADANIPOWER', 'JSWENERGY'],
    'RealEstate': ['DLF', 'GODREJPROP', 'BRIGADE', 'OBEROIRLTY', 'PHOENIXLTD']
}


def fetch_sector_data(api, years=5):
    """Fetch historical data for all sectors."""
    print(f"📊 Fetching {years} years of historical data from Upstox...")

    to_date = datetime.now()
    from_date = to_date - timedelta(days=years * 365)
    from_date_str = from_date.strftime('%Y-%m-%d')
    to_date_str = to_date.strftime('%Y-%m-%d')

    sector_data = {}

    for sector, symbols in SECTOR_REPRESENTATIVES.items():
        print(f"  📈 {sector}...", end=' ')
        dfs = []

        for symbol in symbols:
            try:
                df = api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='days',
                    interval=1,
                    from_date=from_date_str,
                    to_date=to_date_str
                )

                if df is not None and not df.empty and len(df) > 100:
                    df = df[['close']].copy()
                    df['return'] = df['close'].pct_change() * 100
                    df['cum_return'] = ((df['close'] / df['close'].iloc[0]) - 1) * 100
                    dfs.append(df)
            except:
                pass

        if dfs:
            # Combine sector data - average the returns across stocks
            # First get common index
            common_index = dfs[0].index
            for df in dfs[1:]:
                common_index = common_index.intersection(df.index)

            if len(common_index) < 50:
                continue

            # Calculate average returns
            returns_list = []
            cum_returns_list = []
            for df in dfs:
                aligned = df.reindex(common_index)
                returns_list.append(aligned['return'])
                cum_returns_list.append(aligned['cum_return'])

            sector_avg = pd.DataFrame({
                'daily_return': pd.concat(returns_list, axis=1).mean(axis=1),
                'cumulative_return': pd.concat(cum_returns_list, axis=1).mean(axis=1)
            })
            sector_data[sector] = sector_avg
            print(f"✅ {len(dfs)} stocks, {len(sector_avg)} days")
        else:
            print("❌ No data")

    return sector_data


def calculate_monthly_returns(sector_data):
    """Calculate monthly returns for each sector."""
    monthly_data = {}

    for sector, df in sector_data.items():
        # Resample to monthly
        monthly = df.resample('ME').last()
        monthly_returns = monthly['cumulative_return'].pct_change() * 100
        monthly_returns = monthly_returns.dropna()
        monthly_data[sector] = monthly_returns

    return monthly_data


def calculate_sector_rankings(monthly_data):
    """
    Calculate sector rankings for each month.
    Returns DataFrame with rankings over time.
    """
    # Combine all sectors
    all_months = sorted(set().union(*[set(m.index) for m in monthly_data.values()]))

    rankings = []

    for month in all_months:
        month_returns = {}
        for sector, data in monthly_data.items():
            if month in data.index:
                month_returns[sector] = data[month]

        if month_returns:
            # Rank sectors by return (1 = best)
            ranked = sorted(month_returns.items(), key=lambda x: x[1], reverse=True)
            for rank, (sector, ret) in enumerate(ranked, 1):
                rankings.append({
                    'date': month,
                    'sector': sector,
                    'rank': rank,
                    'return': ret
                })

    return pd.DataFrame(rankings)


def calculate_quarterly_returns(sector_data):
    """Calculate quarterly returns for rotation analysis."""
    quarterly_data = {}

    for sector, df in sector_data.items():
        quarterly = df.resample('QE').last()
        quarterly_returns = quarterly['cumulative_return'].pct_change() * 100
        quarterly_returns = quarterly_returns.dropna()
        quarterly_data[sector] = quarterly_returns

    return quarterly_data


def create_rotation_heatmap_data(rankings):
    """
    Create data for rotation heatmap.
    Shows sectors ranked by performance over time.
    """
    # Pivot to get sectors as rows, dates as columns, ranks as values
    pivot = rankings.pivot(index='sector', columns='date', values='rank')

    # Transpose for visualization (dates as rows, sectors as columns)
    return pivot.T


def create_dashboard_data(sector_data, rankings, quarterly_data):
    """Create comprehensive data for D3 dashboard."""

    # 1. Time series data for each sector
    time_series = []
    for sector, df in sector_data.items():
        df_reset = df.reset_index()
        df_reset.columns = ['date', 'daily_return', 'cumulative_return']
        for _, row in df_reset.iterrows():
            time_series.append({
                'date': row['date'].strftime('%Y-%m-%d'),
                'sector': sector,
                'cumulative_return': round(row['cumulative_return'], 2),
                'daily_return': round(row['daily_return'], 2) if not pd.isna(row['daily_return']) else 0
            })

    # 2. Monthly rankings heatmap
    rankings_pivot = rankings.pivot(index='sector', columns='date', values='rank')
    rankings_heatmap = []
    for sector in rankings_pivot.index:
        for date in rankings_pivot.columns:
            rankings_heatmap.append({
                'date': date.strftime('%Y-%m'),
                'sector': sector,
                'rank': int(rankings_pivot.loc[sector, date]) if not pd.isna(rankings_pivot.loc[sector, date]) else None
            })

    # 3. Quarterly returns for rotation analysis
    quarterly_list = []
    quarterly_pivot = pd.DataFrame(quarterly_data).T
    for quarter in quarterly_pivot.columns:
        for sector in quarterly_pivot.index:
            value = quarterly_pivot.loc[sector, quarter]
            if not pd.isna(value):
                # Format quarter as YYYY-Q1, YYYY-Q2, etc.
                q_num = (quarter.month - 1) // 3 + 1
                quarterly_list.append({
                    'quarter': f"{quarter.year}-Q{q_num}",
                    'sector': sector,
                    'return': round(value, 2)
                })

    # 4. Correlation matrix (using monthly returns)
    # Create a DataFrame with sectors as columns
    monthly_returns_for_corr = {}
    for sector, df in sector_data.items():
        # Resample to monthly and calculate monthly returns
        monthly = df.resample('ME').last()
        monthly_returns = monthly['cumulative_return'].pct_change().dropna() * 100
        monthly_returns_for_corr[sector] = monthly_returns

    # Align all sectors to common months
    all_months = sorted(set().union(*[set(m.index) for m in monthly_returns_for_corr.values()]))
    aligned_data = {}
    for sector, monthly_ret in monthly_returns_for_corr.items():
        aligned_data[sector] = [monthly_ret.get(month, np.nan) for month in all_months]

    corr_df = pd.DataFrame(aligned_data, index=all_months)
    correlation = corr_df.corr()
    correlation_list = []
    for i, s1 in enumerate(correlation.columns):
        for j, s2 in enumerate(correlation.columns):
            if i <= j:
                correlation_list.append({
                    'sector1': s1,
                    'sector2': s2,
                    'correlation': round(correlation.iloc[i, j], 3)
                })

    # 5. Current statistics
    current_stats = []
    for sector, df in sector_data.items():
        latest_return = df['cumulative_return'].iloc[-1]

        # Calculate different period returns
        m1_return = df['cumulative_return'].iloc[-1] - df['cumulative_return'].iloc[-22] if len(df) >= 22 else 0
        m3_return = df['cumulative_return'].iloc[-1] - df['cumulative_return'].iloc[-66] if len(df) >= 66 else 0
        m6_return = df['cumulative_return'].iloc[-1] - df['cumulative_return'].iloc[-132] if len(df) >= 132 else 0
        y1_return = df['cumulative_return'].iloc[-1] - df['cumulative_return'].iloc[-252] if len(df) >= 252 else 0

        current_stats.append({
            'sector': sector,
            'total_return': round(latest_return, 2),
            'm1_return': round(m1_return, 2),
            'm3_return': round(m3_return, 2),
            'm6_return': round(m6_return, 2),
            'y1_return': round(y1_return, 2),
            'volatility': round(df['daily_return'].std() * np.sqrt(252), 2),
            'data_points': len(df)
        })

    dashboard_data = {
        'metadata': {
            'generated_at': datetime.now().isoformat(),
            'data_start': min([df.index.min() for df in sector_data.values()]).strftime('%Y-%m-%d'),
            'data_end': max([df.index.max() for df in sector_data.values()]).strftime('%Y-%m-%d'),
            'sectors': len(sector_data),
            'total_days': len(list(sector_data.values())[0])
        },
        'time_series': time_series,
        'rankings_heatmap': rankings_heatmap,
        'quarterly_returns': quarterly_list,
        'correlations': correlation_list,
        'current_stats': current_stats
    }

    return dashboard_data


def main():
    """Main execution."""
    print("=" * 70)
    print("  ENHANCED SECTOR ROTATION ANALYZER")
    print("  Fetching 5 years of data for rotation analysis")
    print("=" * 70)

    # Initialize API
    api = TradingAPIFactory.create_from_config('upstox', quiet=True)

    # Fetch data
    sector_data = fetch_sector_data(api, years=5)

    if not sector_data:
        print("❌ No data fetched")
        return

    print(f"\n✅ Fetched data for {len(sector_data)} sectors")

    # Analysis
    print("\n🔄 Analyzing rotation patterns...")

    monthly_data = calculate_monthly_returns(sector_data)
    rankings = calculate_sector_rankings(monthly_data)
    quarterly_data = calculate_quarterly_returns(sector_data)

    print(f"✅ Monthly data points: {sum(len(m) for m in monthly_data.values())}")
    print(f"✅ Quarterly data points: {sum(len(m) for m in quarterly_data.values())}")
    print(f"✅ Ranking observations: {len(rankings)}")

    # Create dashboard data
    dashboard_data = create_dashboard_data(sector_data, rankings, quarterly_data)

    # Save to file
    output_file = Path('historical_sector_cycles/rotation_dashboard_data.json')
    output_file.parent.mkdir(exist_ok=True)

    with open(output_file, 'w') as f:
        json.dump(dashboard_data, f, indent=2, default=str)

    print(f"\n✅ Dashboard data saved to {output_file}")

    # Print insights
    print("\n" + "=" * 70)
    print("  KEY INSIGHTS")
    print("=" * 70)

    # Current best/worst sectors
    stats_sorted = sorted(dashboard_data['current_stats'], key=lambda x: x['m3_return'], reverse=True)
    print(f"\n📊 Top 5 Sectors (3-Month Return):")
    for s in stats_sorted[:5]:
        print(f"  {s['sector']:<15} 3M: {s['m3_return']:>7.1f}%  Total: {s['total_return']:>7.1f}%")

    print(f"\n📉 Bottom 5 Sectors (3-Month Return):")
    for s in stats_sorted[-5:]:
        print(f"  {s['sector']:<15} 3M: {s['m3_return']:>7.1f}%  Total: {s['total_return']:>7.1f}%")

    # Find rotation pairs
    corr_df = pd.DataFrame([
        (c['sector1'], c['sector2'], c['correlation'])
        for c in dashboard_data['correlations']
    ], columns=['s1', 's2', 'corr']).pivot(index='s1', columns='s2', values='corr')

    print(f"\n🔄 Rotation Opportunities (Inverse Correlation):")
    inverse_pairs = []
    for i in range(len(corr_df.index)):
        for j in range(i+1, len(corr_df.columns)):
            val = corr_df.iloc[i, j]
            if val < -0.4:
                inverse_pairs.append((corr_df.index[i], corr_df.columns[j], val))

    for s1, s2, corr in sorted(inverse_pairs, key=lambda x: x[2])[:5]:
        m1 = next((s['m3_return'] for s in stats_sorted if s['sector'] == s1), 0)
        m2 = next((s['m3_return'] for s in stats_sorted if s['sector'] == s2), 0)
        print(f"  {s1:<15} ↔ {s2:<15}: {corr:>6.2f} | {s1}: {m1:>6.1f}%, {s2}: {m2:>6.1f}%")

    print(f"\n{'='*70}")
    print(f"  Data range: {dashboard_data['metadata']['data_start']} to {dashboard_data['metadata']['data_end']}")
    print(f"  Total trading days: {dashboard_data['metadata']['total_days']}")
    print("=" * 70)


if __name__ == "__main__":
    main()
