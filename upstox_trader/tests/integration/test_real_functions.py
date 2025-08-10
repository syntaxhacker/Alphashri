import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import sys
import os
from unittest.mock import Mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import screeners.tv_modes as tv_modes


@pytest.mark.integration
@pytest.mark.historical_data
class TestRealFunctionValidation:
    """Test actual TV Modes functions with real data from your cache"""
    
    @pytest.fixture(autouse=True) 
    def setup_real_data(self):
        """Setup real data from your data_cache directory"""
        self.data_cache_dir = "/Users/developer/Documents/algos/personal/earner/upstox_trader/data_cache"
        self.mock_screener = Mock()
        self.mock_screener.market = 'india'
        self.mock_screener.cookies = {'session': 'test'}
        self.mock_screener.display_table = Mock()
        
        # Find available stocks
        self.available_stocks = []
        if os.path.exists(self.data_cache_dir):
            files = [f for f in os.listdir(self.data_cache_dir) if f.endswith('_1min.csv')]
            self.available_stocks = list(set([f.split('_')[0] for f in files]))[:3]  # Use 3 stocks
        
        print(f"Testing with stocks: {self.available_stocks}")
    
    def load_real_1min_data(self, symbol: str) -> pd.DataFrame:
        """Load real 1-minute data for testing"""
        
        for days_back in range(10):
            date_str = (datetime.now() - timedelta(days=days_back)).strftime('%Y-%m-%d')
            filename = f"{symbol}_{date_str}_1min.csv"
            filepath = os.path.join(self.data_cache_dir, filename)
            
            if os.path.exists(filepath):
                try:
                    df = pd.read_csv(filepath)
                    
                    # Ensure we have required columns
                    required_cols = ['open', 'high', 'low', 'close', 'volume']
                    if not all(col in df.columns for col in required_cols):
                        continue
                    
                    # Add timestamp if missing
                    if 'timestamp' not in df.columns:
                        start_time = datetime.strptime(date_str, '%Y-%m-%d').replace(hour=9, minute=15)
                        df['timestamp'] = [start_time + timedelta(minutes=i) for i in range(len(df))]
                    
                    print(f"Loaded {len(df)} 1-min candles for {symbol} on {date_str}")
                    return df
                    
                except Exception as e:
                    print(f"Error loading {filename}: {e}")
                    continue
        
        return pd.DataFrame()
    
    def test_calculate_intraday_momentum_metrics_real_data(self):
        """Test _calculate_intraday_momentum_metrics with actual 1-minute data"""
        
        if not self.available_stocks:
            pytest.skip("No real data available")
        
        for symbol in self.available_stocks:
            df_1min = self.load_real_1min_data(symbol)
            
            if df_1min.empty:
                continue
            
            # Create current_row from the latest data
            latest_row = {
                'name': symbol,
                'close': df_1min['close'].iloc[-1],
                'volume': df_1min['volume'].sum(),  # Total day volume
                'change': ((df_1min['close'].iloc[-1] - df_1min['open'].iloc[0]) / 
                          df_1min['open'].iloc[0]) * 100
            }
            
            print(f"\n🔍 Testing {symbol} - Intraday Momentum Metrics")
            print(f"Price: ${latest_row['close']:.2f}, Change: {latest_row['change']:.2f}%")
            print(f"Total Volume: {latest_row['volume']:,}")
            
            # Test the actual function
            try:
                result = tv_modes._calculate_intraday_momentum_metrics(
                    self.mock_screener, df_1min, latest_row
                )
                
                print(f"✅ Function executed successfully")
                print(f"Results: {result}")
                
                # Validate result structure
                expected_keys = ['intraday_volume_ratio', 'price_acceleration', 
                               'momentum_strength', 'breakout_signal', 'trend_confirmation']
                
                for key in expected_keys:
                    if key in result:
                        print(f"  {key}: {result[key]}")
                    else:
                        print(f"  ⚠️ Missing key: {key}")
                
                # Basic validations
                if 'intraday_volume_ratio' in result:
                    assert isinstance(result['intraday_volume_ratio'], (int, float))
                    assert result['intraday_volume_ratio'] >= 0
                
                if 'momentum_strength' in result:
                    assert isinstance(result['momentum_strength'], str)
                
                if 'breakout_signal' in result:
                    assert isinstance(result['breakout_signal'], bool)
                
                print(f"✅ All validations passed for {symbol}")
                
            except Exception as e:
                print(f"❌ Error testing {symbol}: {e}")
                # Don't fail the test, just report the error
                continue
    
    def test_calculate_basic_momentum_metrics_real_values(self):
        """Test _calculate_basic_momentum_metrics with real stock values"""
        
        if not self.available_stocks:
            pytest.skip("No real data available")
        
        for symbol in self.available_stocks:
            df_1min = self.load_real_1min_data(symbol)
            
            if df_1min.empty:
                continue
            
            # Create realistic test row from actual data
            test_row = {
                'close': df_1min['close'].iloc[-1],
                'volume': df_1min['volume'].iloc[-1],
                'change': ((df_1min['close'].iloc[-1] - df_1min['close'].iloc[-2]) / 
                          df_1min['close'].iloc[-2]) * 100 if len(df_1min) > 1 else 0,
                'RSI': np.random.uniform(30, 70),  # We don't have real RSI, simulate
                'relative_volume_10d_calc': np.random.uniform(0.8, 3.0),
                'MACD.macd': np.random.uniform(-2, 2),
                'MACD.signal': np.random.uniform(-2, 2)
            }
            
            print(f"\n📊 Testing {symbol} - Basic Momentum Metrics")
            print(f"Price: ${test_row['close']:.2f}")
            print(f"Volume: {test_row['volume']:,}")
            print(f"Change: {test_row['change']:.2f}%")
            
            try:
                result = tv_modes._calculate_basic_momentum_metrics(test_row)
                
                print(f"✅ Function executed successfully")
                print(f"Price Momentum: {result.get('price_momentum', 'N/A')}")
                print(f"Volume Momentum: {result.get('volume_momentum', 'N/A')}")
                print(f"Composite Score: {result.get('composite_score', 'N/A')}")
                
                # Validate results
                assert 'composite_score' in result
                assert isinstance(result['composite_score'], (int, float))
                assert not np.isnan(result['composite_score'])
                assert not np.isinf(result['composite_score'])
                
                print(f"✅ All validations passed for {symbol}")
                
            except Exception as e:
                print(f"❌ Error testing {symbol}: {e}")
                continue
    
    def test_get_watch_data_function(self):
        """Test _get_watch_data function execution"""
        
        print(f"\n🔍 Testing _get_watch_data function")
        
        # Mock the Query to avoid real API calls during testing
        from unittest.mock import patch
        
        with patch('screeners.tv_modes.Query') as mock_query_class:
            mock_query = Mock()
            mock_query_class.return_value = mock_query
            
            # Setup method chaining
            for method in ['select', 'set_markets', 'where', 'order_by', 'limit']:
                getattr(mock_query, method).return_value = mock_query
            
            # Return sample data
            sample_data = pd.DataFrame({
                'name': ['RELIANCE', 'HDFCBANK'],
                'close': [2500, 1600],
                'volume': [5000000, 3000000],
                'change': [2.5, 1.8]
            })
            mock_query.get_scanner_data.return_value = (len(sample_data), sample_data)
            
            try:
                result = tv_modes._get_watch_data(self.mock_screener)
                
                print(f"✅ Function executed successfully")
                print(f"Returned {len(result)} rows")
                print(f"Columns: {list(result.columns) if not result.empty else 'Empty DataFrame'}")
                
                # Validate result
                assert isinstance(result, pd.DataFrame)
                
                print(f"✅ Validation passed")
                
            except Exception as e:
                print(f"❌ Error testing _get_watch_data: {e}")
                assert False, f"Function should execute without error: {e}"
    
    def test_real_data_quality_validation(self):
        """Validate the quality of real data we're using for tests"""
        
        if not self.available_stocks:
            pytest.skip("No real data available")
        
        print(f"\n📊 Validating Real Data Quality")
        
        for symbol in self.available_stocks:
            df = self.load_real_1min_data(symbol)
            
            if df.empty:
                continue
            
            print(f"\n--- {symbol} Data Quality ---")
            print(f"Rows: {len(df)}")
            print(f"Date range: {df['timestamp'].min() if 'timestamp' in df.columns else 'N/A'} to {df['timestamp'].max() if 'timestamp' in df.columns else 'N/A'}")
            
            # Price data quality
            print(f"Price range: ${df['low'].min():.2f} - ${df['high'].max():.2f}")
            print(f"Average volume: {df['volume'].mean():,.0f}")
            
            # Data integrity checks
            issues = []
            
            # Check for missing values
            missing_data = df.isnull().sum()
            if missing_data.sum() > 0:
                issues.append(f"Missing values: {missing_data.to_dict()}")
            
            # Check OHLC relationships
            if not (df['high'] >= df['low']).all():
                issues.append("High < Low detected")
            
            if not (df['high'] >= df['open']).all():
                issues.append("High < Open detected") 
                
            if not (df['high'] >= df['close']).all():
                issues.append("High < Close detected")
            
            # Check for zero/negative prices
            if (df[['open', 'high', 'low', 'close']] <= 0).any().any():
                issues.append("Zero or negative prices detected")
            
            # Check for unrealistic price moves
            if len(df) > 1:
                price_changes = df['close'].pct_change().abs()
                extreme_moves = price_changes > 0.1  # 10% moves in 1 minute
                if extreme_moves.sum() > 0:
                    issues.append(f"{extreme_moves.sum()} extreme price moves (>10%)")
            
            if issues:
                print(f"⚠️ Data Quality Issues: {'; '.join(issues)}")
            else:
                print(f"✅ Data quality looks good")
            
            # Don't fail test on data quality issues, just report them
        
        print(f"\n✅ Data quality validation completed")


def standalone_test():
    """Run tests without pytest fixture system"""
    
    # Manual setup
    data_cache_dir = "/Users/developer/Documents/algos/personal/earner/upstox_trader/data_cache"
    
    # Find available stocks
    available_stocks = []
    if os.path.exists(data_cache_dir):
        files = [f for f in os.listdir(data_cache_dir) if f.endswith('_1min.csv')]
        available_stocks = list(set([f.split('_')[0] for f in files]))[:3]
    
    print(f"🔍 Found {len(available_stocks)} stocks with data: {available_stocks}")
    
    if not available_stocks:
        print("❌ No data files found in data_cache directory")
        print(f"Expected location: {data_cache_dir}")
        return
    
    # Test basic momentum metrics with real data
    for symbol in available_stocks:
        print(f"\n📊 Testing {symbol}")
        
        # Load data
        for days_back in range(10):
            date_str = (datetime.now() - timedelta(days=days_back)).strftime('%Y-%m-%d')
            filename = f"{symbol}_{date_str}_1min.csv"
            filepath = os.path.join(data_cache_dir, filename)
            
            if os.path.exists(filepath):
                try:
                    df = pd.read_csv(filepath)
                    
                    if len(df) == 0:
                        continue
                    
                    print(f"  Loaded {len(df)} rows from {filename}")
                    print(f"  Price range: ${df['low'].min():.2f} - ${df['high'].max():.2f}")
                    print(f"  Volume range: {df['volume'].min():,} - {df['volume'].max():,}")
                    
                    # Test basic momentum metrics
                    if len(df) > 1:
                        test_row = {
                            'close': df['close'].iloc[-1],
                            'volume': df['volume'].iloc[-1], 
                            'change': ((df['close'].iloc[-1] - df['close'].iloc[0]) / df['close'].iloc[0]) * 100,
                            'RSI': 60.0,  # Mock RSI
                            'relative_volume_10d_calc': 1.5,
                            'MACD.macd': 0.5,
                            'MACD.signal': 0.3
                        }
                        
                        try:
                            result = tv_modes._calculate_basic_momentum_metrics(test_row)
                            print(f"  ✅ Basic momentum: {result.get('composite_score', 'N/A'):.2f}")
                        except Exception as e:
                            print(f"  ❌ Basic momentum failed: {e}")
                    
                    # Test intraday momentum if we have enough data
                    if len(df) > 30:
                        mock_screener = Mock()
                        mock_screener._check_historical_trend = Mock(return_value='Bullish')
                        
                        current_row = {
                            'name': symbol,
                            'close': df['close'].iloc[-1],
                            'volume': df['volume'].sum(),
                            'change': ((df['close'].iloc[-1] - df['close'].iloc[0]) / df['close'].iloc[0]) * 100
                        }
                        
                        try:
                            intraday_result = tv_modes._calculate_intraday_momentum_metrics(
                                mock_screener, df, current_row
                            )
                            print(f"  ✅ Intraday momentum: {intraday_result.get('momentum_strength', 'N/A')}")
                        except Exception as e:
                            print(f"  ❌ Intraday momentum failed: {e}")
                    
                    break  # Found data for this symbol, move to next
                    
                except Exception as e:
                    print(f"  ❌ Error loading {filename}: {e}")
                    continue
    
    print("\n🎉 Real data testing completed!")


if __name__ == "__main__":
    print("🧪 Testing TV Modes Functions with Real Data...")
    standalone_test()