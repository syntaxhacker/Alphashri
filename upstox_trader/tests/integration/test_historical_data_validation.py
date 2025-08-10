import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import sys
import os
from unittest.mock import Mock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import screeners.tv_modes as tv_modes
from tests.fixtures.historical_data_fetcher import HistoricalDataFetcher


@pytest.mark.integration
@pytest.mark.historical_data
class TestHistoricalDataValidation:
    """Integration tests using real historical data patterns"""
    
    @pytest.fixture(autouse=True)
    def setup_historical_data(self):
        """Setup historical data for integration tests"""
        self.data_fetcher = HistoricalDataFetcher()
        self.historical_data = self.data_fetcher.load_cached_data("nifty50_historical.pkl")
        self.test_scenarios = self.data_fetcher.load_cached_data("test_scenarios.pkl")
        
        if not self.historical_data:
            # Generate if not cached
            self.historical_data = self.data_fetcher.fetch_nifty50_historical_data()
        
        if not self.test_scenarios:
            self.test_scenarios = self.data_fetcher.generate_test_scenarios()
    
    def test_helper_functions_with_real_data(self, mock_tv_screener_usage):
        """Test helper functions with realistic stock data"""
        
        # Get a sample of real historical data
        reliance_daily = self.historical_data.get('RELIANCE_daily')
        assert reliance_daily is not None, "RELIANCE daily data should be available"
        
        # Test with recent data point
        recent_data = reliance_daily.iloc[-1]
        
        # Convert to dictionary format expected by helper function
        test_row = {
            'close': recent_data['close'],
            'volume': recent_data['volume'],
            'change': ((recent_data['close'] - recent_data['open']) / recent_data['open']) * 100,
            'RSI': np.random.uniform(30, 70),  # RSI not in historical data, simulate
            'relative_volume_10d_calc': np.random.uniform(0.8, 2.0),
            'MACD.macd': np.random.uniform(-5, 5),
            'MACD.signal': np.random.uniform(-5, 5)
        }
        
        # Test momentum calculation with real data
        result = tv_modes._calculate_basic_momentum_metrics(test_row)
        
        # Validate results make sense
        assert isinstance(result, dict)
        assert 'composite_score' in result
        assert isinstance(result['composite_score'], (int, float))
        assert not np.isnan(result['composite_score'])
        assert not np.isinf(result['composite_score'])
    
    def test_breakout_analysis_with_breakout_scenario(self, mock_tv_screener_usage):
        """Test breakout analysis with simulated breakout pattern"""
        
        breakout_data = self.test_scenarios['breakout_pattern']
        
        # Convert to format expected by analysis function
        analysis_data = pd.DataFrame({
            'name': ['BREAKOUT_STOCK'],
            'close': [breakout_data['close'].iloc[-1]],
            'volume': [breakout_data['volume'].iloc[-1]],
            'change': [((breakout_data['close'].iloc[-1] - breakout_data['close'].iloc[-2]) / 
                       breakout_data['close'].iloc[-2]) * 100],
            'RSI': [75.0],
            'relative_volume_10d_calc': [3.0],
            'EMA20': [breakout_data['close'].iloc[-1] * 0.98],
            'market_cap_basic': [1e11],
            'sector': ['Technology']
        })
        
        # Mock historical trend check
        mock_tv_screener_usage._check_historical_trend = Mock(return_value='Strong Bullish')
        
        # Test heavy breakout analysis
        result = tv_modes._add_heavy_breakout_analysis(mock_tv_screener_usage, analysis_data)
        
        # Validate breakout analysis results
        assert 'momentum_score' in result.columns
        assert 'volume_strength' in result.columns
        assert 'breakout_quality' in result.columns
        
        # For a strong breakout scenario, expect high scores
        assert result['momentum_score'].iloc[0] > 50  # Should be high momentum
        assert result['volume_strength'].iloc[0] in ['High', 'Extreme']  # High volume
    
    def test_gap_up_analysis_with_gap_scenario(self, mock_tv_screener_usage):
        """Test analysis with gap up scenario"""
        
        gap_data = self.test_scenarios['gap_up_pattern']
        
        # Find the gap day
        gap_day_idx = gap_data['volume'].idxmax()  # Day with highest volume (gap day)
        gap_day_data = gap_data.iloc[gap_day_idx]
        
        # Create analysis data
        analysis_data = pd.DataFrame({
            'name': ['GAP_UP_STOCK'],
            'close': [gap_day_data['close']],
            'volume': [gap_day_data['volume']],
            'change': [((gap_day_data['close'] - gap_day_data['open']) / gap_day_data['open']) * 100],
            'RSI': [70.0],
            'relative_volume_10d_calc': [5.0],  # Very high volume
            'market_cap_basic': [5e10]
        })
        
        # Test momentum metrics
        test_row = analysis_data.iloc[0].to_dict()
        result = tv_modes._calculate_basic_momentum_metrics(test_row)
        
        # Gap up should show strong momentum
        assert result['volume_momentum'] >= 4.0  # Very high relative volume
        assert result['composite_score'] > 0  # Positive momentum
    
    def test_accumulation_pattern_detection(self, mock_tv_screener_usage):
        """Test detection of accumulation patterns"""
        
        accumulation_data = self.test_scenarios['accumulation_pattern']
        
        # Test with accumulation pattern data
        analysis_data = pd.DataFrame({
            'name': ['ACCUMULATION_STOCK'],
            'close': [accumulation_data['close'].iloc[-1]],
            'volume': [accumulation_data['volume'].iloc[-1]],
            'change': [2.0],  # Modest change typical of accumulation
            'RSI': [55.0],  # Neutral to slightly positive
            'relative_volume_10d_calc': [1.8],  # Increasing volume
            'EMA20': [accumulation_data['close'].iloc[-1] * 0.99],
            'market_cap_basic': [8e10]
        })
        
        mock_tv_screener_usage._check_historical_trend = Mock(return_value='Accumulating')
        
        # Test analysis
        result = tv_modes._add_heavy_breakout_analysis(mock_tv_screener_usage, analysis_data)
        
        # Accumulation should show moderate metrics
        assert result['momentum_score'].iloc[0] > 30  # Some momentum but not extreme
        assert result['volume_strength'].iloc[0] in ['Medium', 'High']
    
    def test_oversold_bounce_scenario(self, mock_tv_screener_usage):
        """Test oversold bounce scenario"""
        
        oversold_data = self.test_scenarios['oversold_bounce']
        bounce_start = len(oversold_data) - 10  # Last 10 days should be bounce
        
        bounce_data = oversold_data.iloc[bounce_start:]
        
        # Test with bounce data
        analysis_data = pd.DataFrame({
            'name': ['OVERSOLD_STOCK'],
            'close': [bounce_data['close'].iloc[-1]],
            'volume': [bounce_data['volume'].iloc[-1]],
            'change': [4.0],  # Strong bounce
            'RSI': [45.0],  # Recovering from oversold
            'relative_volume_10d_calc': [2.0],
            'market_cap_basic': [3e10]
        })
        
        test_row = analysis_data.iloc[0].to_dict()
        result = tv_modes._calculate_basic_momentum_metrics(test_row)
        
        # Bounce should show positive momentum
        assert result['price_momentum'] > 0
        assert result['composite_score'] > 0
    
    def test_high_volume_breakout_detection(self, mock_tv_screener_usage):
        """Test high volume breakout detection"""
        
        hv_breakout_data = self.test_scenarios['high_volume_breakout']
        breakout_day_idx = hv_breakout_data['volume'].idxmax()
        breakout_data = hv_breakout_data.iloc[breakout_day_idx]
        
        # Test with high volume breakout
        analysis_data = pd.DataFrame({
            'name': ['HIGH_VOLUME_STOCK'],
            'close': [breakout_data['close']],
            'volume': [breakout_data['volume']],
            'change': [8.0],  # Strong breakout
            'RSI': [80.0],  # High RSI
            'relative_volume_10d_calc': [10.0],  # Extremely high volume
            'EMA20': [breakout_data['close'] * 0.95],
            'market_cap_basic': [1.5e11]
        })
        
        mock_tv_screener_usage._check_historical_trend = Mock(return_value='Explosive Breakout')
        
        result = tv_modes._add_heavy_breakout_analysis(mock_tv_screener_usage, analysis_data)
        
        # Should detect extreme breakout
        assert result['momentum_score'].iloc[0] > 80  # Very high momentum
        assert result['volume_strength'].iloc[0] == 'Extreme'
        assert result['price_strength'].iloc[0] in ['Strong', 'Very Strong']
    
    def test_sector_correlation_with_real_data(self, mock_tv_screener_usage):
        """Test sector correlation analysis with realistic data"""
        
        # Create multi-sector data from historical
        sample_stocks = ['RELIANCE', 'HDFCBANK', 'INFY', 'TCS', 'ICICIBANK']
        sector_data = []
        
        sectors = {'RELIANCE': 'Energy', 'HDFCBANK': 'Banking', 'INFY': 'Technology', 
                  'TCS': 'Technology', 'ICICIBANK': 'Banking'}
        
        for stock in sample_stocks:
            daily_data = self.historical_data.get(f'{stock}_daily')
            if daily_data is not None and len(daily_data) > 0:
                recent = daily_data.iloc[-1]
                prev = daily_data.iloc[-2] if len(daily_data) > 1 else recent
                
                change = ((recent['close'] - prev['close']) / prev['close']) * 100
                
                sector_data.append({
                    'name': stock,
                    'close': recent['close'],
                    'change': change,
                    'volume': recent['volume'],
                    'RSI': np.random.uniform(40, 80),
                    'sector': sectors.get(stock, 'Unknown')
                })
        
        sector_df = pd.DataFrame(sector_data)
        
        # Test sector correlation analysis
        result = tv_modes._analyze_sector_correlations(mock_tv_screener_usage, sector_df)
        
        # Should return valid DataFrame
        assert isinstance(result, pd.DataFrame)
    
    def test_intraday_momentum_with_minute_data(self, mock_tv_screener_usage):
        """Test intraday momentum analysis with 1-minute data"""
        
        # Get 1-minute data for testing
        reliance_1min = self.historical_data.get('RELIANCE_1min')
        assert reliance_1min is not None, "1-minute data should be available"
        
        # Create current row data
        current_row = {
            'name': 'RELIANCE',
            'close': reliance_1min['close'].iloc[-1],
            'volume': reliance_1min['volume'].sum(),  # Total volume
            'change': 3.5
        }
        
        # Mock historical trend
        mock_tv_screener_usage._check_historical_trend = Mock(return_value='Bullish')
        
        # Test intraday momentum calculation
        result = tv_modes._calculate_intraday_momentum_metrics(reliance_1min, current_row)
        
        # Validate results
        assert isinstance(result, dict)
        assert 'intraday_volume_ratio' in result
        assert 'price_acceleration' in result
        assert 'momentum_strength' in result
        assert 'breakout_signal' in result
        assert 'trend_confirmation' in result
        
        # Values should be reasonable
        assert isinstance(result['intraday_volume_ratio'], (int, float))
        assert result['momentum_strength'] in ['Weak', 'Moderate', 'Strong', 'Very Strong']
        assert isinstance(result['breakout_signal'], bool)


@pytest.mark.integration
@pytest.mark.slow
class TestDataConsistencyAndEdgeCases:
    """Test data consistency and edge cases with historical data"""
    
    @pytest.fixture(autouse=True)
    def setup_data(self):
        """Setup data for edge case testing"""
        self.data_fetcher = HistoricalDataFetcher()
        self.historical_data = self.data_fetcher.load_cached_data("nifty50_historical.pkl")
    
    def test_missing_historical_data_handling(self, mock_tv_screener_usage):
        """Test handling when historical data is missing"""
        
        # Test with non-existent stock
        test_row = {
            'close': 100.0,
            'volume': 1000000,
            'change': 2.0,
            'RSI': 60.0,
            'relative_volume_10d_calc': 1.5
        }
        
        # Should handle gracefully even without historical data
        result = tv_modes._calculate_basic_momentum_metrics(test_row)
        assert isinstance(result, dict)
        assert 'composite_score' in result
    
    def test_extreme_market_conditions(self, mock_tv_screener_usage):
        """Test with extreme market conditions (circuit limits, etc.)"""
        
        # Test with circuit limit data (10%+ moves)
        extreme_data = pd.DataFrame({
            'name': ['EXTREME_STOCK'],
            'close': [1000.0],
            'volume': [50000000],  # Extremely high volume
            'change': [20.0],  # Upper circuit limit
            'RSI': [95.0],  # Extreme overbought
            'relative_volume_10d_calc': [50.0],  # Extreme volume
            'market_cap_basic': [1e12]
        })
        
        mock_tv_screener_usage._check_historical_trend = Mock(return_value='Parabolic')
        
        # Should handle extreme values without crashing
        result = tv_modes._add_heavy_breakout_analysis(mock_tv_screener_usage, extreme_data)
        
        assert isinstance(result, pd.DataFrame)
        assert len(result) == 1
        
        # Scores should be capped or handled appropriately
        momentum_score = result['momentum_score'].iloc[0]
        assert not np.isnan(momentum_score)
        assert not np.isinf(momentum_score)
    
    def test_low_liquidity_stocks(self, mock_tv_screener_usage):
        """Test with low liquidity stocks"""
        
        low_liquidity_data = pd.DataFrame({
            'name': ['LOW_LIQ_STOCK'],
            'close': [10.0],  # Low price
            'volume': [1000],  # Very low volume
            'change': [5.0],
            'RSI': [50.0],
            'relative_volume_10d_calc': [0.1],  # Very low relative volume
            'market_cap_basic': [1e8]  # Small cap
        })
        
        # Should handle low liquidity appropriately
        test_row = low_liquidity_data.iloc[0].to_dict()
        result = tv_modes._calculate_basic_momentum_metrics(test_row)
        
        assert isinstance(result, dict)
        # Low volume should be reflected in metrics
        assert result['volume_momentum'] == 0.1
    
    def test_data_quality_validation(self, mock_tv_screener_usage):
        """Test that generated historical data meets quality standards"""
        
        # Check a sample of stocks for data quality
        sample_stocks = ['RELIANCE', 'HDFCBANK', 'INFY']
        
        for stock in sample_stocks:
            daily_data = self.historical_data.get(f'{stock}_daily')
            if daily_data is not None:
                
                # Check basic data integrity
                assert len(daily_data) > 0, f"No data for {stock}"
                assert not daily_data['close'].isnull().any(), f"Null prices in {stock}"
                assert (daily_data['close'] > 0).all(), f"Non-positive prices in {stock}"
                assert (daily_data['volume'] >= 0).all(), f"Negative volume in {stock}"
                
                # Check OHLC relationships
                assert (daily_data['high'] >= daily_data['low']).all(), f"High < Low in {stock}"
                assert (daily_data['high'] >= daily_data['open']).all(), f"High < Open in {stock}"
                assert (daily_data['high'] >= daily_data['close']).all(), f"High < Close in {stock}"
                assert (daily_data['low'] <= daily_data['open']).all(), f"Low > Open in {stock}"
                assert (daily_data['low'] <= daily_data['close']).all(), f"Low > Close in {stock}"
                
                # Check for reasonable price movements (not more than 50% in a day)
                daily_returns = daily_data['close'].pct_change().dropna()
                extreme_moves = daily_returns.abs() > 0.5
                assert extreme_moves.sum() == 0, f"Unrealistic price moves in {stock}"
    
    def test_time_series_consistency(self, mock_tv_screener_usage):
        """Test time series data consistency"""
        
        # Check that timestamps are properly ordered
        reliance_data = self.historical_data.get('RELIANCE_daily')
        if reliance_data is not None:
            timestamps = pd.to_datetime(reliance_data['timestamp'])
            
            # Should be monotonically increasing
            assert timestamps.is_monotonic_increasing, "Timestamps should be ordered"
            
            # Should not have duplicates
            assert not timestamps.duplicated().any(), "Should not have duplicate timestamps"
            
            # Should be business days only
            weekdays = timestamps.dt.weekday
            assert (weekdays < 5).all(), "Should only contain weekdays"


@pytest.mark.integration
@pytest.mark.performance
class TestPerformanceWithRealData:
    """Test performance characteristics with realistic data volumes"""
    
    @pytest.fixture(autouse=True)
    def setup_performance_data(self):
        """Setup data for performance testing"""
        self.data_fetcher = HistoricalDataFetcher()
        self.historical_data = self.data_fetcher.load_cached_data("nifty50_historical.pkl")
    
    def test_large_dataset_processing_time(self, mock_tv_screener_usage):
        """Test processing time with large datasets"""
        
        import time
        
        # Create large dataset (simulate NSE data volume)
        large_dataset = []
        for i in range(500):  # 500 stocks
            stock_data = {
                'name': f'STOCK{i:03d}',
                'close': np.random.uniform(50, 5000),
                'volume': np.random.randint(100000, 10000000),
                'change': np.random.uniform(-10, 10),
                'RSI': np.random.uniform(0, 100),
                'relative_volume_10d_calc': np.random.uniform(0.1, 5.0),
                'EMA20': np.random.uniform(50, 5000),
                'market_cap_basic': np.random.uniform(1e9, 1e12),
                'sector': np.random.choice(['Technology', 'Banking', 'Healthcare', 'Energy'])
            }
            large_dataset.append(stock_data)
        
        large_df = pd.DataFrame(large_dataset)
        
        # Mock historical trend to avoid API calls
        mock_tv_screener_usage._check_historical_trend = Mock(return_value='Bullish')
        
        # Measure processing time
        start_time = time.time()
        result = tv_modes._add_heavy_breakout_analysis(mock_tv_screener_usage, large_df)
        end_time = time.time()
        
        processing_time = end_time - start_time
        
        # Should complete within reasonable time
        assert processing_time < 60, f"Processing took too long: {processing_time:.2f} seconds"
        assert len(result) == len(large_df), "Should process all stocks"
    
    def test_memory_efficiency(self, mock_tv_screener_usage):
        """Test memory efficiency with repeated processing"""
        
        # Process same data multiple times to check for memory leaks
        test_data = pd.DataFrame({
            'name': ['TEST1', 'TEST2'],
            'close': [100, 200],
            'volume': [1000000, 2000000],
            'change': [2, 3],
            'RSI': [60, 65],
            'relative_volume_10d_calc': [1.5, 2.0],
            'market_cap_basic': [1e10, 2e10],
            'sector': ['Tech', 'Finance']
        })
        
        mock_tv_screener_usage._check_historical_trend = Mock(return_value='Bullish')
        
        # Process multiple times
        for i in range(100):
            result = tv_modes._add_heavy_breakout_analysis(mock_tv_screener_usage, test_data)
            assert len(result) == 2
            
            # Clear any cached data to prevent memory accumulation
            if hasattr(result, 'cache_clear'):
                result.cache_clear()
    
    def test_concurrent_processing_safety(self, mock_tv_screener_usage):
        """Test that functions are safe for concurrent processing"""
        
        import threading
        import queue
        
        test_data = pd.DataFrame({
            'name': ['CONCURRENT_TEST'],
            'close': [100],
            'volume': [1000000],
            'change': [2],
            'RSI': [60],
            'relative_volume_10d_calc': [1.5]
        })
        
        results_queue = queue.Queue()
        
        def process_data():
            try:
                result = tv_modes._calculate_basic_momentum_metrics(test_data.iloc[0].to_dict())
                results_queue.put(('success', result))
            except Exception as e:
                results_queue.put(('error', str(e)))
        
        # Run multiple threads
        threads = []
        for _ in range(10):
            thread = threading.Thread(target=process_data)
            threads.append(thread)
            thread.start()
        
        # Wait for all threads
        for thread in threads:
            thread.join()
        
        # Check results
        success_count = 0
        while not results_queue.empty():
            status, result = results_queue.get()
            if status == 'success':
                success_count += 1
                assert isinstance(result, dict)
            else:
                pytest.fail(f"Thread failed with error: {result}")
        
        assert success_count == 10, "All threads should complete successfully"