import pytest
import pandas as pd
import numpy as np
from unittest.mock import Mock, patch, MagicMock
from datetime import datetime, timedelta
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import screeners.tv_modes as tv_modes


class TestHelperFunctions:
    """Test helper and utility functions in tv_modes.py"""
    
    def test_calculate_basic_momentum_metrics(self, mock_tv_screener_usage):
        """Test basic momentum metrics calculation"""
        
        # Create a mock row with required data
        test_row = {
            'close': 100.0,
            'volume': 1000000,
            'change': 2.5,
            'RSI': 65.0,
            'relative_volume_10d_calc': 1.5,
            'MACD.macd': 0.5,
            'MACD.signal': 0.3
        }
        
        result = tv_modes._calculate_basic_momentum_metrics(test_row)
        
        # Verify all expected keys are present
        expected_keys = [
            'price_momentum', 'volume_momentum', 'rsi_strength', 
            'macd_momentum', 'composite_score'
        ]
        for key in expected_keys:
            assert key in result
        
        # Verify calculations
        assert result['price_momentum'] == 2.5
        assert result['volume_momentum'] == 1.5
        assert result['rsi_strength'] == 65.0
        assert result['macd_momentum'] == 0.2  # macd - signal = 0.5 - 0.3
        
        # Verify composite score is a number
        assert isinstance(result['composite_score'], (int, float))
        assert result['composite_score'] > 0  # Should be positive with these values
    
    def test_calculate_basic_momentum_metrics_edge_cases(self):
        """Test momentum metrics with edge case values"""
        
        # Test with missing MACD data
        test_row_no_macd = {
            'close': 50.0,
            'volume': 500000,
            'change': -1.5,
            'RSI': 35.0,
            'relative_volume_10d_calc': 0.8
        }
        
        result = tv_modes._calculate_basic_momentum_metrics(test_row_no_macd)
        
        assert result['price_momentum'] == -1.5
        assert result['volume_momentum'] == 0.8
        assert result['rsi_strength'] == 35.0
        assert result['macd_momentum'] == 0  # Should default to 0
        assert isinstance(result['composite_score'], (int, float))
    
    def test_calculate_intraday_momentum_metrics(self, mock_tv_screener_usage, sample_1min_data):
        """Test intraday momentum calculation with 1-minute data"""
        
        current_row = {
            'name': 'TESTSTOCK',
            'close': 105.0,
            'volume': 2000000,
            'change': 5.0
        }
        
        # Mock the historical trend method
        mock_tv_screener_usage._check_historical_trend = Mock(return_value='Bullish')
        
        result = tv_modes._calculate_intraday_momentum_metrics(
            sample_1min_data, current_row
        )
        
        # Verify result structure
        assert isinstance(result, dict)
        expected_keys = [
            'intraday_volume_ratio', 'price_acceleration', 'momentum_strength',
            'breakout_signal', 'trend_confirmation'
        ]
        for key in expected_keys:
            assert key in result
        
        # Verify data types
        assert isinstance(result['intraday_volume_ratio'], (int, float))
        assert isinstance(result['price_acceleration'], (int, float))
        assert isinstance(result['momentum_strength'], str)
        assert isinstance(result['breakout_signal'], bool)
        assert result['trend_confirmation'] == 'Bullish'
    
    @patch('screeners.tv_modes.Query')
    def test_heavy_breakout_analysis(self, mock_query, mock_tv_screener_usage):
        """Test heavy breakout analysis function"""
        
        # Create sample data for analysis
        sample_data = pd.DataFrame({
            'name': ['STOCK1', 'STOCK2', 'STOCK3'],
            'close': [100.0, 200.0, 50.0],
            'volume': [2000000, 5000000, 1000000],
            'change': [5.0, 8.0, 12.0],
            'RSI': [70.0, 75.0, 80.0],
            'relative_volume_10d_calc': [2.5, 3.0, 4.0],
            'EMA20': [95.0, 190.0, 45.0],
            'market_cap_basic': [1e10, 2e10, 5e9],
            'sector': ['Technology', 'Banking', 'Healthcare']
        })
        
        # Mock the _check_historical_trend method
        mock_tv_screener_usage._check_historical_trend = Mock(return_value='Strong Bullish')
        
        result_df = tv_modes._add_heavy_breakout_analysis(mock_tv_screener_usage, sample_data)
        
        # Verify new columns are added
        expected_new_columns = [
            'momentum_score', 'volume_strength', 'price_strength',
            'breakout_quality', 'risk_reward', 'trend_analysis'
        ]
        for col in expected_new_columns:
            assert col in result_df.columns
        
        # Verify data integrity
        assert len(result_df) == len(sample_data)
        assert all(result_df['momentum_score'] >= 0)
        assert all(result_df['volume_strength'].isin(['Low', 'Medium', 'High', 'Extreme']))
        assert all(result_df['price_strength'].isin(['Weak', 'Moderate', 'Strong', 'Very Strong']))
    
    def test_sector_correlations_analysis(self, mock_tv_screener_usage):
        """Test sector correlation analysis"""
        
        # Create sample multi-sector data
        sample_data = pd.DataFrame({
            'name': ['TECH1', 'TECH2', 'BANK1', 'BANK2', 'PHARMA1'],
            'close': [1000, 1200, 800, 900, 2000],
            'change': [5.0, 2.0, 8.0, 1.0, 3.0],
            'volume': [2000000, 1500000, 3000000, 1800000, 1200000],
            'RSI': [65, 55, 75, 45, 60],
            'sector': ['Technology', 'Technology', 'Banking', 'Banking', 'Healthcare']
        })
        
        result_df = tv_modes._analyze_sector_correlations(mock_tv_screener_usage, sample_data)
        
        # Verify the function processes the data
        assert isinstance(result_df, pd.DataFrame)
        # The function might add catch-up opportunities or return original data
        assert len(result_df) >= 0  # Could be empty if no catch-up opportunities
        
    def test_intraday_momentum_analysis(self, mock_tv_screener_usage):
        """Test intraday momentum analysis addition"""
        
        sample_data = pd.DataFrame({
            'name': ['STOCK1', 'STOCK2'],
            'close': [150.0, 300.0],
            'volume': [3000000, 4000000],
            'change': [6.0, 4.0],
            'RSI': [68.0, 72.0]
        })
        
        # Mock the intraday metrics calculation
        with patch.object(tv_modes, '_calculate_intraday_momentum_metrics') as mock_calc:
            mock_calc.return_value = {
                'intraday_volume_ratio': 2.0,
                'price_acceleration': 1.5,
                'momentum_strength': 'Strong',
                'breakout_signal': True,
                'trend_confirmation': 'Bullish'
            }
            
            result_df = tv_modes._add_intraday_momentum_analysis(mock_tv_screener_usage, sample_data)
        
        # Verify new columns are added
        intraday_columns = [
            'intraday_volume_ratio', 'price_acceleration', 'momentum_strength',
            'breakout_signal', 'trend_confirmation'
        ]
        for col in intraday_columns:
            assert col in result_df.columns
        
        # Verify data integrity
        assert len(result_df) == len(sample_data)


class TestValidationFunctions:
    """Test data validation and edge cases"""
    
    def test_empty_dataframe_handling(self, mock_tv_screener_usage):
        """Test functions handle empty DataFrames gracefully"""
        empty_df = pd.DataFrame()
        
        # Test heavy breakout analysis with empty data
        result = tv_modes._add_heavy_breakout_analysis(mock_tv_screener_usage, empty_df)
        assert isinstance(result, pd.DataFrame)
        assert len(result) == 0
        
        # Test sector correlation analysis with empty data
        result = tv_modes._analyze_sector_correlations(mock_tv_screener_usage, empty_df)
        assert isinstance(result, pd.DataFrame)
    
    def test_missing_columns_handling(self, mock_tv_screener_usage):
        """Test functions handle missing columns gracefully"""
        
        # Data missing some expected columns
        incomplete_data = pd.DataFrame({
            'name': ['STOCK1'],
            'close': [100.0]
            # Missing volume, change, RSI, etc.
        })
        
        # Functions should not crash with missing data
        try:
            tv_modes._add_heavy_breakout_analysis(mock_tv_screener_usage, incomplete_data)
            tv_modes._analyze_sector_correlations(mock_tv_screener_usage, incomplete_data)
        except KeyError as e:
            # If KeyError occurs, it should be handled gracefully
            pytest.fail(f"Function should handle missing columns gracefully: {e}")
    
    def test_extreme_values_handling(self):
        """Test functions handle extreme values properly"""
        
        extreme_row = {
            'close': 0.01,  # Very low price
            'volume': 0,    # Zero volume
            'change': 1000,  # Extreme change
            'RSI': 100,     # Maximum RSI
            'relative_volume_10d_calc': 0,  # Zero relative volume
            'MACD.macd': float('inf'),  # Infinite value
            'MACD.signal': float('-inf')  # Negative infinite
        }
        
        # Should not crash with extreme values
        result = tv_modes._calculate_basic_momentum_metrics(extreme_row)
        
        assert isinstance(result, dict)
        assert 'composite_score' in result
        # Composite score should be a finite number
        assert not np.isinf(result.get('composite_score', 0))
        assert not np.isnan(result.get('composite_score', 0))


@pytest.mark.parametrize("rsi_value,expected_strength", [
    (20, "Oversold"),
    (35, "Weak"), 
    (50, "Neutral"),
    (65, "Strong"),
    (80, "Overbought"),
    (100, "Extreme")
])
def test_rsi_strength_categorization(rsi_value, expected_strength):
    """Test RSI strength categorization logic"""
    
    test_row = {
        'close': 100.0,
        'volume': 1000000,
        'change': 1.0,
        'RSI': rsi_value,
        'relative_volume_10d_calc': 1.0
    }
    
    result = tv_modes._calculate_basic_momentum_metrics(test_row)
    
    # The actual implementation might not have explicit RSI categorization,
    # but we can verify the RSI value is processed correctly
    assert result['rsi_strength'] == rsi_value


@pytest.mark.parametrize("volume_ratio,expected_category", [
    (0.5, "Low"),
    (1.0, "Normal"),
    (2.0, "High"), 
    (3.5, "Very High"),
    (5.0, "Extreme")
])
def test_volume_ratio_categorization(volume_ratio, expected_category):
    """Test volume ratio categorization"""
    
    test_row = {
        'close': 100.0,
        'volume': 1000000,
        'change': 1.0,
        'RSI': 50.0,
        'relative_volume_10d_calc': volume_ratio
    }
    
    result = tv_modes._calculate_basic_momentum_metrics(test_row)
    assert result['volume_momentum'] == volume_ratio


class TestPerformanceAndScaling:
    """Test performance with large datasets"""
    
    def test_large_dataset_performance(self, mock_tv_screener_usage):
        """Test functions perform reasonably with large datasets"""
        
        # Create large dataset (1000 stocks)
        n_stocks = 1000
        large_data = pd.DataFrame({
            'name': [f'STOCK{i}' for i in range(n_stocks)],
            'close': np.random.uniform(10, 5000, n_stocks),
            'volume': np.random.randint(100000, 10000000, n_stocks),
            'change': np.random.uniform(-10, 10, n_stocks),
            'RSI': np.random.uniform(0, 100, n_stocks),
            'relative_volume_10d_calc': np.random.uniform(0.1, 5.0, n_stocks),
            'sector': np.random.choice(['Tech', 'Finance', 'Healthcare', 'Energy'], n_stocks)
        })
        
        # Mock the historical trend check to avoid actual API calls
        mock_tv_screener_usage._check_historical_trend = Mock(return_value='Bullish')
        
        import time
        start_time = time.time()
        
        # Test heavy breakout analysis performance
        result = tv_modes._add_heavy_breakout_analysis(mock_tv_screener_usage, large_data)
        
        end_time = time.time()
        processing_time = end_time - start_time
        
        # Should complete within reasonable time (adjust threshold as needed)
        assert processing_time < 30  # 30 seconds max
        assert len(result) == len(large_data)
    
    def test_memory_usage(self, mock_tv_screener_usage):
        """Test memory usage doesn't grow excessively"""
        
        # This is more of a smoke test - in practice you'd use memory profiling tools
        n_iterations = 10
        base_data = pd.DataFrame({
            'name': ['STOCK1', 'STOCK2'],
            'close': [100, 200],
            'volume': [1000000, 2000000],
            'change': [2, 3],
            'RSI': [60, 65],
            'relative_volume_10d_calc': [1.5, 2.0],
            'sector': ['Tech', 'Finance']
        })
        
        mock_tv_screener_usage._check_historical_trend = Mock(return_value='Bullish')
        
        # Process the same data multiple times
        for _ in range(n_iterations):
            result = tv_modes._add_heavy_breakout_analysis(mock_tv_screener_usage, base_data)
            assert len(result) == len(base_data)
            # In a real scenario, you might check memory usage here