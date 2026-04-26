import sys
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional

import pandas as pd
import numpy as np

_project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(_project_root))

from upstox_trader.config_and_utils.free_indian_apis import TradingAPIFactory

from .models import SECTOR_REPRESENTATIVES


def calculate_max_drawdown(price_series: pd.Series) -> float:
    cumulative = (1 + price_series.pct_change()).cumprod()
    running_max = cumulative.expanding().max()
    drawdown = ((cumulative - running_max) / running_max) * 100
    return drawdown.min()


def calculate_sharpe_ratio(returns: pd.Series, risk_free_rate: float = 0.05) -> float:
    if len(returns) < 2 or returns.std() == 0:
        return 0.0
    excess_returns = returns.mean() - risk_free_rate / 252
    return (excess_returns / returns.std()) * np.sqrt(252)


def initialize_api(provider: str):
    print(f"🔌 Initializing {provider.upper()} API...")
    try:
        api = TradingAPIFactory.create_from_config(provider, quiet=True)
        print(f"✅ {provider.upper()} API initialized")
        return api
    except Exception as e:
        print(f"❌ Failed to initialize API: {e}")
        return None


def fetch_historical_data(api, years: int) -> Dict:
    print(f"\n📊 Fetching {years} years of historical data...")
    print("This may take several minutes...\n")

    to_date = datetime.now()
    from_date = to_date - timedelta(days=years * 365)
    from_date_str = from_date.strftime('%Y-%m-%d')
    to_date_str = to_date.strftime('%Y-%m-%d')

    sector_data = {}
    total_stocks = sum(len(v) for v in SECTOR_REPRESENTATIVES.values())
    fetched_count = 0

    for sector, symbols in SECTOR_REPRESENTATIVES.items():
        print(f"  📈 Processing {sector}...")

        sector_dfs = []
        sector_stats = []

        for symbol in symbols:
            try:
                df = api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='days',
                    interval=1,
                    from_date=from_date_str,
                    to_date=to_date_str
                )

                if df is not None and not df.empty:
                    df = df[['open', 'high', 'low', 'close', 'volume']].copy()
                    df = df.dropna()

                    if len(df) > 100:
                        df['daily_return'] = df['close'].pct_change() * 100
                        df['cumulative_return'] = ((df['close'] / df['close'].iloc[0]) - 1) * 100
                        df['ma_50'] = df['close'].rolling(window=50).mean()
                        df['ma_200'] = df['close'].rolling(window=200).mean()
                        df['volatility_20'] = df['daily_return'].rolling(window=20).std()

                        stats = {
                            'symbol': symbol,
                            'total_return': df['cumulative_return'].iloc[-1],
                            'avg_daily_return': df['daily_return'].mean(),
                            'volatility': df['daily_return'].std(),
                            'max_drawdown': calculate_max_drawdown(df['close']),
                            'sharpe': calculate_sharpe_ratio(df['daily_return']),
                            'data_points': len(df)
                        }

                        sector_dfs.append(df)
                        sector_stats.append(stats)
                        fetched_count += 1

                        if fetched_count % 10 == 0:
                            print(f"    Progress: {fetched_count}/{total_stocks} stocks fetched")

            except Exception as e:
                print(f"    ⚠️  Failed to fetch {symbol}: {e}")
                continue

        if sector_dfs:
            sector_data[sector] = {
                'dataframes': sector_dfs,
                'stats': sector_stats,
                'symbols': [s['symbol'] for s in sector_stats]
            }
            print(f"    ✅ {sector}: {len(sector_dfs)} stocks fetched")
        else:
            print(f"    ❌ {sector}: No data fetched")

    print(f"\n✅ Fetched data for {len(sector_data)} sectors")
    return sector_data
