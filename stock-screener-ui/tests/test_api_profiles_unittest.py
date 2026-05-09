from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import types

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Minimal stub so importing api_server -> scanners/trending_upside succeeds in test env.
if 'tradingview_screener' not in sys.modules:
    stub = types.ModuleType('tradingview_screener')
    stub.Query = object
    stub.Column = object
    sys.modules['tradingview_screener'] = stub

import api_server_fastapi as api_server  # noqa: E402


def _mock_df():
    return pd.DataFrame([
        {
            'name': 'ABC',
            'close': 100.0,
            'change': 2.5,
            'price_52_week_high': 104.0,
            'ADX': 30.0,
            'ATR': 1.2,
            'Perf.W': 3.0,
            'RSI': 62.0,
            'Stoch.K': 78.0,
            'gap': 2.2,
            'premarket_change': 1.1,
            'impact_score': 4.5,
            'market_cap_basic': 200_000_000_000,
            'volume': 5_000_000,
            'sector': 'Finance',
            'reversal_signal': 'BEARISH',
            'swing_score': 82,
        },
        {
            'name': 'XYZ',
            'close': 120.0,
            'change': -0.5,
            'price_52_week_high': 130.0,
            'ADX': 19.0,
            'ATR': 0.8,
            'Perf.W': -0.3,
            'RSI': 48.0,
            'Stoch.K': 22.0,
            'gap': 0.4,
            'premarket_change': -0.1,
            'impact_score': 0.2,
            'market_cap_basic': 40_000_000_000,
            'volume': 500_000,
            'sector': 'IT',
            'reversal_signal': 'BULLISH',
            'swing_score': 55,
        }
    ])


class TestApiProfiles(unittest.TestCase):
    @patch.object(api_server.trending_upside, 'fetch_trending_stocks', side_effect=lambda **_: _mock_df())
    @patch.object(api_server.TradingAPIFactory, 'create_from_config', side_effect=ValueError('no creds'))
    def test_fetch_screener_data_includes_profile_meta_and_summary(self, _mock_factory, _mock_fetch):
        data = api_server.fetch_screener_data(provider='upstox', mode='historical', screener='market_open_gap')

        self.assertIn('profile_meta', data)
        self.assertIn('summary', data)
        self.assertEqual(data['profile_meta']['section_labels']['primary'], '📈 GAP OPEN CANDIDATES')
        self.assertEqual(len(data['approaching']), 2)
        self.assertEqual(len(data['touched']), 0)
        row = data['approaching'][0]
        self.assertIn('gap_pct', row)
        self.assertIn('premarket_change', row)
        self.assertIn('volume_m', row)
        self.assertIn('rationale', row)
        self.assertIn('Gap', row['rationale'])

    @patch.object(api_server.trending_upside, 'fetch_trending_stocks', side_effect=lambda **_: _mock_df())
    @patch.object(api_server.TradingAPIFactory, 'create_from_config', side_effect=ValueError('no creds'))
    def test_non_52w_profiles_do_not_bucket_into_touched(self, _mock_factory, _mock_fetch):
        data = api_server.fetch_screener_data(provider='upstox', mode='historical', screener='nifty_movers')
        self.assertEqual(len(data['approaching']), 2)
        self.assertEqual(len(data['touched']), 0)

    @patch.object(api_server.trending_upside, 'fetch_trending_stocks', side_effect=lambda **_: _mock_df())
    @patch.object(api_server.TradingAPIFactory, 'create_from_config', side_effect=ValueError('no creds'))
    def test_profile_filters_are_applied_server_side(self, _mock_factory, _mock_fetch):
        data = api_server.fetch_screener_data(
            provider='upstox',
            mode='historical',
            screener='market_open_gap',
            profile_filters={'min_gap_pct': '1.0', 'min_volume_m': '1'}
        )
        syms = [r['symbol'] for r in data['approaching']]
        self.assertEqual(syms, ['ABC'])

    @patch.object(api_server.trending_upside, 'fetch_trending_stocks', side_effect=lambda **_: pd.DataFrame())
    @patch.object(api_server.TradingAPIFactory, 'create_from_config', side_effect=ValueError('no creds'))
    def test_handles_empty_dataframe_gracefully(self, _mock_factory, _mock_fetch):
        data = api_server.fetch_screener_data(provider='upstox', mode='historical', screener='market_open_gap')
        self.assertEqual(len(data['approaching']), 0)
        self.assertEqual(len(data['touched']), 0)
        self.assertIn('profile_meta', data)
        self.assertIn('summary', data)

    def test_rationale_formats_by_profile(self):
        row = {
            'gap_pct': 1.2,
            'premarket_change': 0.3,
            'volume_m': 2.0,
            'rsi': 61.2,
            'stoch_k': 77.1,
            'day_change': 1.1,
            'impact_score': 3.2,
            'market_cap_b': 140.0,
            'score': 82,
            'to_52w_high': 1.4,
            'recent_return_5d': 2.3,
            'perf_w': 1.2,
        }
        self.assertIn('Gap', api_server._build_rationale('market_open_gap', row))
        self.assertIn('RSI', api_server._build_rationale('rsi_reversal', row))
        self.assertIn('Impact', api_server._build_rationale('nifty_movers', row))
        self.assertIn('Score', api_server._build_rationale('high_momentum', row))


if __name__ == '__main__':
    unittest.main()
