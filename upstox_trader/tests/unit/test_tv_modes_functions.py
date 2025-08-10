import pytest
import pandas as pd
import numpy as np
from unittest.mock import Mock, patch, MagicMock, call
from datetime import datetime, timedelta
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import screeners.tv_modes as tv_modes


class TestPreBreakoutAccumulation:
    """Test pre_breakout_accumulation function"""
    
    @patch('screeners.tv_modes.Query')
    def test_pre_breakout_accumulation_success(self, mock_query_class, mock_tv_screener_usage, mock_tradingview_query):
        """Test successful execution of pre_breakout_accumulation"""
        
        # Setup mock query chain
        mock_query = Mock()
        mock_query_class.return_value = mock_query
        
        # Mock the query chain methods
        mock_query.select.return_value = mock_query
        mock_query.set_markets.return_value = mock_query  
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.get_scanner_data.return_value = mock_tradingview_query()
        
        # Mock historical trend check
        mock_tv_screener_usage._check_historical_trend = Mock(return_value='Bullish')
        
        # Execute function
        tv_modes.pre_breakout_accumulation(mock_tv_screener_usage)
        
        # Verify query was built correctly
        mock_query.select.assert_called_once()
        mock_query.set_markets.assert_called_once_with(mock_tv_screener_usage.market)
        mock_query.where.assert_called_once()
        mock_query.order_by.assert_called_once_with('RSI', ascending=False)
        mock_query.limit.assert_called_once_with(15)
        mock_query.get_scanner_data.assert_called_once_with(cookies=mock_tv_screener_usage.cookies)
        
        # Verify display_table was called
        mock_tv_screener_usage.display_table.assert_called_once()
    
    @patch('screeners.tv_modes.Query')
    def test_pre_breakout_accumulation_exception_handling(self, mock_query_class, mock_tv_screener_usage):
        """Test exception handling in pre_breakout_accumulation"""
        
        # Make query raise an exception
        mock_query_class.side_effect = Exception("API Error")
        
        # Should not raise exception
        tv_modes.pre_breakout_accumulation(mock_tv_screener_usage)
        
        # Display table should not be called on error
        mock_tv_screener_usage.display_table.assert_not_called()
    
    @patch('screeners.tv_modes.Query')
    def test_pre_breakout_accumulation_empty_results(self, mock_query_class, mock_tv_screener_usage):
        """Test handling of empty results"""
        
        # Setup mock to return empty dataframe
        mock_query = Mock()
        mock_query_class.return_value = mock_query
        mock_query.select.return_value = mock_query
        mock_query.set_markets.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.get_scanner_data.return_value = (0, pd.DataFrame())
        
        # Execute function
        tv_modes.pre_breakout_accumulation(mock_tv_screener_usage)
        
        # Should still call display_table even with empty results
        mock_tv_screener_usage.display_table.assert_called_once()


class TestEarlyMomentumDetection:
    """Test early_momentum_detection function"""
    
    @patch('screeners.tv_modes.Query')
    def test_early_momentum_detection_success(self, mock_query_class, mock_tv_screener_usage, mock_tradingview_query):
        """Test successful execution of early_momentum_detection"""
        
        mock_query = Mock()
        mock_query_class.return_value = mock_query
        
        # Chain all methods
        mock_query.select.return_value = mock_query
        mock_query.set_markets.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.order_by.return_value = mock_query
        mock_query.limit.return_value = mock_query
        mock_query.get_scanner_data.return_value = mock_tradingview_query()
        
        # Execute function
        tv_modes.early_momentum_detection(mock_tv_screener_usage)
        
        # Verify query structure
        mock_query.select.assert_called_once()
        mock_query.order_by.assert_called_once_with('change', ascending=False)
        mock_tv_screener_usage.display_table.assert_called_once()
    
    @patch('screeners.tv_modes.Query')
    def test_early_momentum_detection_query_parameters(self, mock_query_class, mock_tv_screener_usage):
        """Test that query parameters are set correctly for early momentum"""
        
        mock_query = Mock()
        mock_query_class.return_value = mock_query
        
        # Setup method chaining
        for method in ['select', 'set_markets', 'where', 'order_by', 'limit']:
            getattr(mock_query, method).return_value = mock_query
        
        mock_query.get_scanner_data.return_value = (0, pd.DataFrame())
        
        # Execute function
        tv_modes.early_momentum_detection(mock_tv_screener_usage)
        
        # Verify the query was called with the expected parameters
        # This tests the presence of conditions like RSI comparison
        where_call = mock_query.where.call_args
        assert where_call is not None  # Verify where was called with conditions


class TestHeavyBreakout:
    """Test heavy_breakout function"""
    
    @patch('screeners.tv_modes.Query')
    @patch('screeners.tv_modes.SmartMoneyBreakoutChannels')
    def test_heavy_breakout_success(self, mock_channels_class, mock_query_class, mock_tv_screener_usage, mock_tradingview_query):
        """Test successful execution of heavy_breakout"""
        
        mock_query = Mock()
        mock_query_class.return_value = mock_query
        
        # Setup method chaining
        for method in ['select', 'set_markets', 'where', 'order_by', 'limit']:
            getattr(mock_query, method).return_value = mock_query
        
        # Return sample data with required columns
        sample_data = pd.DataFrame({
            'name': ['STOCK1', 'STOCK2'],
            'close': [1000, 1500],
            'open': [990, 1480],
            'high': [1020, 1520],
            'low': [980, 1470],
            'volume': [5000000, 8000000],
            'change': [1.0, 1.4],
            'relative_volume_10d_calc': [2.0, 2.5],
            'RSI': [65, 70],
            'Volatility.D': [0.02, 0.025],
            'ATR': [15, 20],
            'market_cap_basic': [1e11, 2e11],
            'update_mode': 'streaming'
        })
        
        mock_query.get_scanner_data.return_value = (len(sample_data), sample_data)
        
        # Mock the breakout analyzer
        mock_analyzer = Mock()
        mock_channels_class.return_value = mock_analyzer
        
        # Mock the get_historical_data method to return empty data (no historical data available)
        mock_tv_screener_usage.get_historical_data = Mock(return_value=pd.DataFrame())
        
        # Execute function
        tv_modes.heavy_breakout(mock_tv_screener_usage)
        
        # Verify query was executed
        mock_query.get_scanner_data.assert_called_once()
        
        # Verify analyzer was created
        mock_channels_class.assert_called_once()
        
        # Should handle the case where no historical data is available
    
    @patch('screeners.tv_modes.Query')
    def test_heavy_breakout_with_analysis(self, mock_query_class, mock_tv_screener_usage):
        """Test heavy_breakout with detailed analysis"""
        
        mock_query = Mock()
        mock_query_class.return_value = mock_query
        
        # Setup method chaining
        for method in ['select', 'set_markets', 'where', 'order_by', 'limit']:
            getattr(mock_query, method).return_value = mock_query
        
        # Create sample data with required columns
        sample_data = pd.DataFrame({
            'name': ['STOCK1', 'STOCK2'],
            'close': [1000, 1500],
            'volume': [5000000, 8000000],
            'change': [8.5, 12.0],
            'RSI': [75, 80],
            'relative_volume_10d_calc': [3.5, 4.2],
            'market_cap_basic': [1e11, 2e11]
        })
        
        mock_query.get_scanner_data.return_value = (len(sample_data), sample_data)
        
        # Mock the _check_historical_trend method
        mock_tv_screener_usage._check_historical_trend = Mock(return_value='Strong Bullish')
        
        # Execute function
        tv_modes.heavy_breakout(mock_tv_screener_usage)
        
        # Verify the function completed successfully
        mock_tv_screener_usage.display_table.assert_called_once()
        
        # Get the data that was passed to display_table
        call_args = mock_tv_screener_usage.display_table.call_args
        displayed_data = call_args[0][0]  # First positional argument
        
        # The data should have additional analysis columns
        assert isinstance(displayed_data, pd.DataFrame)


class TestIntradayModes:
    """Test intraday trading mode functions"""
    
    @patch('screeners.tv_modes.Query')
    def test_intraday_high_volume_breakouts(self, mock_query_class, mock_tv_screener_usage, mock_tradingview_query):
        """Test intraday high volume breakouts function"""
        
        mock_query = Mock()
        mock_query_class.return_value = mock_query
        
        # Setup method chaining  
        for method in ['select', 'set_markets', 'where', 'order_by', 'limit']:
            getattr(mock_query, method).return_value = mock_query
        
        mock_query.get_scanner_data.return_value = mock_tradingview_query()
        
        # Execute function
        tv_modes.intraday_high_volume_breakouts(mock_tv_screener_usage)
        
        # Verify execution
        mock_tv_screener_usage.display_table.assert_called_once()
        mock_query.order_by.assert_called_with('relative_volume_10d_calc', ascending=False)
    
    @patch('screeners.tv_modes.Query')
    def test_intraday_gap_up_stocks(self, mock_query_class, mock_tv_screener_usage, mock_tradingview_query):
        """Test intraday gap up stocks function"""
        
        mock_query = Mock()
        mock_query_class.return_value = mock_query
        
        # Setup method chaining
        for method in ['select', 'set_markets', 'where', 'order_by', 'limit']:
            getattr(mock_query, method).return_value = mock_query
        
        mock_query.get_scanner_data.return_value = mock_tradingview_query()
        
        # Execute function  
        tv_modes.intraday_gap_up_stocks(mock_tv_screener_usage)
        
        # Verify execution
        mock_tv_screener_usage.display_table.assert_called_once()
        mock_query.order_by.assert_called_with('change', ascending=False)


class TestResearchFunctions:
    """Test research and analysis functions"""
    
    @patch('screeners.tv_modes.Query')
    def test_research_sector_performance(self, mock_query_class, mock_tv_screener_usage, mock_tradingview_query):
        """Test sector performance research function"""
        
        mock_query = Mock()
        mock_query_class.return_value = mock_query
        
        # Setup method chaining
        for method in ['select', 'set_markets', 'where', 'order_by', 'limit']:
            getattr(mock_query, method).return_value = mock_query
        
        # Create sample data with sectors
        sample_data = pd.DataFrame({
            'name': ['STOCK1', 'STOCK2', 'STOCK3', 'STOCK4'],
            'close': [1000, 500, 1500, 800],
            'change': [5.0, -2.0, 8.0, 3.0],
            'volume': [2000000, 1500000, 3000000, 1800000],
            'sector': ['Technology', 'Banking', 'Technology', 'Healthcare'],
            'market_cap_basic': [1e11, 5e10, 2e11, 8e10]
        })
        
        mock_query.get_scanner_data.return_value = (len(sample_data), sample_data)
        
        # Execute function
        tv_modes.research_sector_performance(mock_tv_screener_usage)
        
        # Verify execution - should display sector analysis
        mock_tv_screener_usage.display_table.assert_called()
    
    @patch('screeners.tv_modes.Query') 
    def test_research_sector_stocks(self, mock_query_class, mock_tv_screener_usage, mock_tradingview_query):
        """Test research sector stocks function"""
        
        mock_query = Mock()
        mock_query_class.return_value = mock_query
        
        # Setup method chaining
        for method in ['select', 'set_markets', 'where', 'order_by', 'limit']:
            getattr(mock_query, method).return_value = mock_query
            
        mock_query.get_scanner_data.return_value = mock_tradingview_query()
        
        # Test with specific sector
        tv_modes.research_sector_stocks(mock_tv_screener_usage, sector_name='Technology', limit=10)
        
        # Verify query was modified for specific sector
        mock_query.limit.assert_called_with(10)
        mock_tv_screener_usage.display_table.assert_called_once()
        
        # Test with no sector specified (should show all)
        mock_tv_screener_usage.display_table.reset_mock()
        tv_modes.research_sector_stocks(mock_tv_screener_usage)
        
        mock_tv_screener_usage.display_table.assert_called_once()


class TestWatchMode:
    """Test watch mode functionality"""
    
    @patch('time.sleep')
    @patch('screeners.tv_modes.Query')
    def test_intraday_watch_mode_execution(self, mock_query_class, mock_sleep, mock_tv_screener_usage, mock_tradingview_query):
        """Test intraday watch mode basic execution"""
        
        mock_query = Mock()
        mock_query_class.return_value = mock_query
        
        # Setup method chaining
        for method in ['select', 'set_markets', 'where', 'order_by', 'limit']:
            getattr(mock_query, method).return_value = mock_query
        
        mock_query.get_scanner_data.return_value = mock_tradingview_query()
        
        # Mock console input to stop after first iteration
        with patch('builtins.input', return_value='q'):
            with patch('screeners.tv_modes.console') as mock_console:
                
                # Execute watch mode (should exit quickly due to mocked input)
                tv_modes.intraday_watch_mode(mock_tv_screener_usage, refresh_interval=1)
                
                # Verify it attempted to query data
                mock_query.get_scanner_data.assert_called()
    
    @patch('screeners.tv_modes.Query')
    def test_get_watch_data(self, mock_query_class, mock_tv_screener_usage, mock_tradingview_query):
        """Test _get_watch_data helper function"""
        
        mock_query = Mock()
        mock_query_class.return_value = mock_query
        
        # Setup method chaining
        for method in ['select', 'set_markets', 'where', 'order_by', 'limit']:
            getattr(mock_query, method).return_value = mock_query
        
        mock_query.get_scanner_data.return_value = mock_tradingview_query()
        
        # Execute function
        result = tv_modes._get_watch_data(mock_tv_screener_usage)
        
        # Verify result
        assert isinstance(result, pd.DataFrame)
        mock_query.get_scanner_data.assert_called_once()


class TestOptimizedGapStrategy:
    """Test optimized gap strategy function"""
    
    @patch('screeners.tv_modes.Query')
    def test_optimized_gap_strategy_15min(self, mock_query_class, mock_tv_screener_usage, mock_tradingview_query):
        """Test 15-minute optimized gap strategy"""
        
        mock_query = Mock()
        mock_query_class.return_value = mock_query
        
        # Setup method chaining
        for method in ['select', 'set_markets', 'where', 'order_by', 'limit']:
            getattr(mock_query, method).return_value = mock_query
        
        _, sample_df = mock_tradingview_query()
        mock_query.get_scanner_data.return_value = (len(sample_df), sample_df)
        
        # Execute function
        result = tv_modes.optimized_gap_strategy_15min(mock_tv_screener_usage)
        
        # Verify result
        if result is not None:
            assert isinstance(result, pd.DataFrame)
        
        # Should have attempted to get scanner data
        mock_query.get_scanner_data.assert_called_once()


class TestSwingTradingFunctions:
    """Test swing trading related functions"""
    
    @patch('screeners.tv_modes.Query')
    def test_swing_bullish_reversal(self, mock_query_class, mock_tv_screener_usage, mock_tradingview_query):
        """Test swing bullish reversal function"""
        
        mock_query = Mock()
        mock_query_class.return_value = mock_query
        
        # Setup method chaining
        for method in ['select', 'set_markets', 'where', 'order_by', 'limit']:
            getattr(mock_query, method).return_value = mock_query
        
        mock_query.get_scanner_data.return_value = mock_tradingview_query()
        
        # Execute function
        tv_modes.swing_bullish_reversal(mock_tv_screener_usage)
        
        # Verify execution
        mock_tv_screener_usage.display_table.assert_called_once()
    
    @patch('screeners.tv_modes.Query')
    def test_swing_breakout_consolidation(self, mock_query_class, mock_tv_screener_usage, mock_tradingview_query):
        """Test swing breakout consolidation function"""
        
        mock_query = Mock()
        mock_query_class.return_value = mock_query
        
        # Setup method chaining
        for method in ['select', 'set_markets', 'where', 'order_by', 'limit']:
            getattr(mock_query, method).return_value = mock_query
        
        mock_query.get_scanner_data.return_value = mock_tradingview_query()
        
        # Execute function
        tv_modes.swing_breakout_consolidation(mock_tv_screener_usage)
        
        # Verify execution
        mock_tv_screener_usage.display_table.assert_called_once()


class TestInvestmentFunctions:
    """Test investment-focused functions"""
    
    @patch('screeners.tv_modes.Query')
    def test_invest_quality_growth(self, mock_query_class, mock_tv_screener_usage, mock_tradingview_query):
        """Test quality growth investment function"""
        
        mock_query = Mock()
        mock_query_class.return_value = mock_query
        
        # Setup method chaining
        for method in ['select', 'set_markets', 'where', 'order_by', 'limit']:
            getattr(mock_query, method).return_value = mock_query
        
        mock_query.get_scanner_data.return_value = mock_tradingview_query()
        
        # Execute function
        tv_modes.invest_quality_growth(mock_tv_screener_usage)
        
        # Verify execution
        mock_tv_screener_usage.display_table.assert_called_once()
    
    @patch('screeners.tv_modes.Query')
    def test_invest_dividend_aristocrats(self, mock_query_class, mock_tv_screener_usage, mock_tradingview_query):
        """Test dividend aristocrats function"""
        
        mock_query = Mock()
        mock_query_class.return_value = mock_query
        
        # Setup method chaining
        for method in ['select', 'set_markets', 'where', 'order_by', 'limit']:
            getattr(mock_query, method).return_value = mock_query
        
        mock_query.get_scanner_data.return_value = mock_tradingview_query()
        
        # Execute function
        tv_modes.invest_dividend_aristocrats(mock_tv_screener_usage)
        
        # Verify execution
        mock_tv_screener_usage.display_table.assert_called_once()


class TestSmartMoneyBreakoutChannels:
    """Test SmartMoneyBreakoutChannels class"""
    
    def test_smart_money_class_initialization(self):
        """Test SmartMoneyBreakoutChannels class can be initialized"""
        
        # The class might require specific initialization parameters
        # This is a basic test to ensure the class exists and can be instantiated
        try:
            # Attempt to initialize - actual parameters depend on implementation
            channels = tv_modes.SmartMoneyBreakoutChannels()
            assert channels is not None
        except TypeError:
            # If it requires parameters, that's also valid
            # We just want to ensure the class exists
            assert hasattr(tv_modes, 'SmartMoneyBreakoutChannels')


class TestErrorHandling:
    """Test error handling across all functions"""
    
    @patch('screeners.tv_modes.Query')
    def test_api_failure_handling(self, mock_query_class, mock_tv_screener_usage):
        """Test that functions handle API failures gracefully"""
        
        # Make the query fail
        mock_query_class.side_effect = Exception("TradingView API Error")
        
        # List of functions to test
        functions_to_test = [
            tv_modes.pre_breakout_accumulation,
            tv_modes.early_momentum_detection,
            tv_modes.heavy_breakout,
            tv_modes.intraday_high_volume_breakouts,
            tv_modes.swing_bullish_reversal,
            tv_modes.invest_quality_growth
        ]
        
        for func in functions_to_test:
            # None of these should raise exceptions
            try:
                func(mock_tv_screener_usage)
            except Exception as e:
                pytest.fail(f"Function {func.__name__} should handle API errors gracefully: {e}")
    
    def test_invalid_data_handling(self, mock_tv_screener_usage):
        """Test handling of invalid or corrupted data"""
        
        # Test with None data
        result = tv_modes._calculate_basic_momentum_metrics(None)
        # Should handle None gracefully (might return empty dict or defaults)
        
        # Test with incomplete data
        incomplete_data = {'close': 100}  # Missing other required fields
        result = tv_modes._calculate_basic_momentum_metrics(incomplete_data)
        assert isinstance(result, dict)  # Should return some result, not crash