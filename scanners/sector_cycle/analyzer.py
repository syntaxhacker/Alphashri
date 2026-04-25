from typing import Dict, List, Optional

import pandas as pd
import numpy as np
from scipy import signal
from scipy.fft import fft, fftfreq


def aggregate_sector_returns(dataframes: List[pd.DataFrame]) -> Optional[pd.Series]:
    if not dataframes:
        return None

    common_index = dataframes[0].index
    for df in dataframes[1:]:
        common_index = common_index.intersection(df.index)

    if len(common_index) < 100:
        return None

    returns_list = []
    for df in dataframes:
        aligned_df = df.reindex(common_index)
        aligned_df['cum_return'] = ((aligned_df['close'] / aligned_df['close'].iloc[0]) - 1) * 100
        returns_list.append(aligned_df['cum_return'])

    avg_returns = pd.concat(returns_list, axis=1).mean(axis=1)
    return avg_returns


def detect_cycles(returns: pd.Series) -> Dict:
    clean_returns = returns.dropna()
    n = len(clean_returns)

    if n < 100:
        return {}

    cycle_info = {}

    # FFT Analysis
    fft_values = fft(clean_returns.values)
    fft_freq = fftfreq(n, d=1)

    positive_freq_idx = fft_freq > 0
    positive_freq = fft_freq[positive_freq_idx]
    positive_power = np.abs(fft_values[positive_freq_idx])

    top_5_idx = np.argsort(positive_power)[-5:][::-1]

    dominant_cycles = []
    for idx in top_5_idx:
        freq = positive_freq[idx]
        if freq > 0:
            period_days = 1 / freq
            period_months = period_days / 21

            if 21 <= period_days <= 500:
                dominant_cycles.append({
                    'period_days': period_days,
                    'period_months': period_months,
                    'power': positive_power[idx]
                })

    cycle_info['fft_cycles'] = dominant_cycles[:3]

    # Autocorrelation Analysis
    autocorr = [clean_returns.autocorr(lag=lag) for lag in range(1, 253)]
    autocorr_series = pd.Series(autocorr, index=range(1, 253))

    peaks, _ = signal.find_peaks(autocorr_series, height=0.1)

    significant_lags = []
    for peak in peaks:
        if peak >= 20:
            significant_lags.append({
                'lag_days': peak,
                'lag_months': peak / 21,
                'correlation': autocorr_series[peak]
            })

    cycle_info['autocorr_peaks'] = significant_lags[:3]

    # Seasonal Decomposition
    monthly_returns = clean_returns.resample('M').last()
    monthly_changes = monthly_returns.pct_change().dropna()

    if len(monthly_changes) >= 12:
        monthly_returns_by_month = {}
        for i in range(12):
            month_data = monthly_changes[monthly_changes.index.month == i + 1]
            if len(month_data) > 0:
                monthly_returns_by_month[i + 1] = month_data.mean()

        cycle_info['seasonal_pattern'] = monthly_returns_by_month

    return cycle_info


def calculate_sector_phases(returns: pd.Series) -> Dict:
    current_return = returns.iloc[-1]
    recent_trend = returns.iloc[-63:] - returns.iloc[-126:-63] if len(returns) >= 126 else returns.iloc[-20:] - returns.iloc[-40:-20]

    volatility = returns.pct_change().dropna().std() * np.sqrt(252)

    if current_return > 20 and recent_trend.mean() > 5:
        phase = 'DISTRIBUTION'
        action = 'TAKE PROFITS'
    elif current_return > 0 and recent_trend.mean() > 0:
        phase = 'MARKUP'
        action = 'HOLD'
    elif current_return < -10:
        phase = 'MARKDOWN'
        action = 'ACCUMULATE'
    else:
        phase = 'ACCUMULATION'
        action = 'BUY'

    return {
        'current_phase': phase,
        'action': action,
        'current_return': current_return,
        'recent_trend': recent_trend.mean(),
        'volatility': volatility
    }


def calculate_sector_stats(stats_list: List[Dict], returns: pd.Series) -> Dict:
    return {
        'avg_total_return': np.mean([s['total_return'] for s in stats_list]),
        'best_performer': max(stats_list, key=lambda x: x['total_return']),
        'worst_performer': min(stats_list, key=lambda x: x['total_return']),
        'avg_volatility': np.mean([s['volatility'] for s in stats_list]),
        'avg_sharpe': np.mean([s['sharpe'] for s in stats_list]),
        'current_sector_return': returns.iloc[-1]
    }


def analyze_sector_cycles(sector_data: Dict) -> Dict:
    print("\n🔄 Analyzing cyclical patterns...")

    cycle_patterns = {}

    for sector, data in sector_data.items():
        print(f"  🔍 {sector}...")

        sector_returns = aggregate_sector_returns(data['dataframes'])

        if sector_returns is None or len(sector_returns) < 252:
            continue

        cycle_info = detect_cycles(sector_returns)
        phases = calculate_sector_phases(sector_returns)

        cycle_patterns[sector] = {
            'returns': sector_returns,
            'cycle_info': cycle_info,
            'phases': phases,
            'stats': calculate_sector_stats(data['stats'], sector_returns)
        }

    print(f"✅ Analyzed {len(cycle_patterns)} sectors for cycles")
    return cycle_patterns


def predict_next_cycles(cycle_patterns: Dict) -> Dict:
    print("\n🔮 Predicting next cycle timing...")

    predictions = {}

    for sector, pattern in cycle_patterns.items():
        cycle_info = pattern['cycle_info']
        current_phase = pattern['phases']['current_phase']
        current_return = pattern['phases']['current_return']

        prediction = {
            'sector': sector,
            'current_phase': current_phase,
            'current_return': current_return
        }

        if 'fft_cycles' in cycle_info and cycle_info['fft_cycles']:
            dominant_cycle = cycle_info['fft_cycles'][0]
            cycle_period_days = dominant_cycle['period_days']

            returns = pattern['returns']
            peaks, _ = signal.find_peaks(returns, distance=int(cycle_period_days * 0.8))

            if len(peaks) > 0:
                last_peak_date = returns.index[peaks[-1]]
                days_since_peak = (returns.index[-1] - last_peak_date).days

                next_peak_estimate = cycle_period_days - days_since_peak

                prediction['dominant_cycle'] = {
                    'period_days': cycle_period_days,
                    'period_months': cycle_period_days / 21,
                    'last_peak': last_peak_date.strftime('%Y-%m-%d'),
                    'days_since_peak': days_since_peak,
                    'days_to_next_peak': int(next_peak_estimate)
                }

        if current_phase == 'DISTRIBUTION':
            prediction['next_phase'] = 'MARKDOWN'
            prediction['timeframe'] = '1-3 months'
            prediction['confidence'] = 'HIGH'
        elif current_phase == 'MARKUP':
            prediction['next_phase'] = 'DISTRIBUTION'
            prediction['timeframe'] = '2-4 months'
            prediction['confidence'] = 'MEDIUM'
        elif current_phase == 'MARKDOWN':
            prediction['next_phase'] = 'ACCUMULATION'
            prediction['timeframe'] = '2-6 months'
            prediction['confidence'] = 'HIGH'
        else:
            prediction['next_phase'] = 'MARKUP'
            prediction['timeframe'] = '1-4 months'
            prediction['confidence'] = 'MEDIUM-HIGH'

        predictions[sector] = prediction

    print(f"✅ Generated predictions for {len(predictions)} sectors")
    return predictions
