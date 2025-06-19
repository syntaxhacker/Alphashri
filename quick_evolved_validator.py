#!/usr/bin/env python3
"""
Quick Evolved Strategy Validator
Demonstrates backtesting and walk-forward testing of the evolved strategy
"""

import json
import numpy as np
import pandas as pd
from datetime import datetime

def load_evolved_strategy():
    """Load the evolved strategy parameters"""
    with open('adaptive_learning_journey_20250618_154525.json', 'r') as f:
        data = json.load(f)
    
    final_strategy = data['final_strategy']
    improvement = data['total_improvement']
    generations = len(data['generation_history'])
    
    print("🧬 EVOLVED STRATEGY LOADED:")
    print(f"   Generations: {generations}")
    print(f"   Learning Improvement: +{improvement:.1f}% win rate")
    print(f"   Final Parameters:")
    for param, value in final_strategy.items():
        print(f"     {param}: {value:.4f}")
    
    return final_strategy

def generate_test_data():
    """Generate realistic test market data"""
    print("\n📊 Generating test market data...")
    
    # 60 days of 15-minute data
    dates = pd.date_range('2024-01-01', periods=5760, freq='15min')
    
    # Realistic price movements
    base_price = 2800.0
    volatility = 0.018
    
    # Generate correlated returns
    returns = []
    prev_return = 0
    
    for i in range(len(dates)):
        momentum = prev_return * 0.12
        shock = np.random.normal(0, volatility)
        
        # Occasional breakouts
        if np.random.random() < 0.015:
            shock *= 2.5
        
        new_return = momentum + shock
        returns.append(new_return)
        prev_return = new_return
    
    # Calculate OHLCV
    prices = base_price * np.exp(np.cumsum(returns))
    highs = prices * (1 + np.abs(np.random.normal(0, 0.003, len(prices))))
    lows = prices * (1 - np.abs(np.random.normal(0, 0.003, len(prices))))
    opens = np.roll(prices, 1)
    opens[0] = prices[0]
    
    volumes = 200000 * np.random.lognormal(0, 0.4, len(prices))
    
    df = pd.DataFrame({
        'timestamp': dates,
        'open': opens,
        'high': highs,
        'low': lows,
        'close': prices,
        'volume': volumes
    })
    
    print(f"   ✅ Generated {len(df)} bars (${df['close'].min():.0f}-${df['close'].max():.0f})")
    return df

def backtest_evolved_strategy(df, strategy_params):
    """Backtest the evolved strategy"""
    print("\n📈 BACKTESTING EVOLVED STRATEGY...")
    
    # Calculate indicators
    df['volume_ma'] = df['volume'].rolling(20).mean()
    df['volume_ratio'] = df['volume'] / df['volume_ma']
    df['high_max'] = df['high'].rolling(14).max().shift(1)
    df['momentum'] = df['close'].pct_change(5)
    df['rsi'] = calculate_rsi(df['close'])
    
    # Generate signals
    df['signal'] = 'HOLD'
    df['confidence'] = 0.0
    
    signals = 0
    for i in range(50, len(df)):
        row = df.iloc[i]
        
        if pd.isna(row['high_max']) or pd.isna(row['rsi']):
            continue
        
        # Apply evolved strategy logic
        breakout = row['close'] > row['high_max'] * (1 + strategy_params['breakout_threshold']/100)
        volume_ok = row['volume_ratio'] > strategy_params['volume_multiplier']
        momentum_ok = row['momentum'] > strategy_params['momentum_min']
        rsi_ok = 30 < row['rsi'] < strategy_params['rsi_limit']
        
        confidence = 0.0
        if breakout: confidence += 0.40
        if volume_ok: confidence += 0.25
        if momentum_ok: confidence += 0.20
        if rsi_ok: confidence += 0.15
        
        if confidence >= strategy_params['confidence_threshold']:
            df.iloc[i, df.columns.get_loc('signal')] = 'LONG'
            df.iloc[i, df.columns.get_loc('confidence')] = confidence
            signals += 1
    
    print(f"   🎯 Generated {signals} trading signals")
    
    # Execute backtest
    portfolio_value = 10000.0
    positions = []
    trades = []
    
    for i, row in df.iterrows():
        # Exit management
        for pos_idx in range(len(positions) - 1, -1, -1):
            position = positions[pos_idx]
            exit_decision = check_exit_conditions(position, row, strategy_params)
            
            if exit_decision['should_exit']:
                entry_price = position['entry_price']
                exit_price = row['close']
                return_pct = (exit_price - entry_price) / entry_price * 100
                pnl = position['shares'] * (exit_price - entry_price)
                
                trades.append({
                    'entry_price': entry_price,
                    'exit_price': exit_price,
                    'return_pct': return_pct,
                    'pnl': pnl,
                    'exit_reason': exit_decision['reason']
                })
                
                portfolio_value += pnl
                positions.pop(pos_idx)
        
        # Entry management
        if row['signal'] == 'LONG' and len(positions) == 0:
            position_value = portfolio_value * strategy_params['position_size'] / 100
            
            positions.append({
                'entry_price': row['close'],
                'shares': position_value / row['close'],
                'highest_price': row['close']
            })
    
    # Calculate performance
    if trades:
        winning_trades = [t for t in trades if t['pnl'] > 0]
        win_rate = len(winning_trades) / len(trades) * 100
        total_return = (portfolio_value - 10000) / 10000 * 100
        avg_return = np.mean([t['return_pct'] for t in trades])
        
        print(f"   📊 BACKTEST RESULTS:")
        print(f"      Win Rate: {win_rate:.1f}%")
        print(f"      Total Return: {total_return:.2f}%")
        print(f"      Average Trade: {avg_return:.2f}%")
        print(f"      Total Trades: {len(trades)}")
        print(f"      Winning Trades: {len(winning_trades)}")
        
        return {
            'win_rate': win_rate,
            'total_return': total_return,
            'total_trades': len(trades),
            'trades': trades
        }
    
    return {'win_rate': 0, 'total_return': 0, 'total_trades': 0}

def walk_forward_test(df, strategy_params):
    """Run walk-forward validation"""
    print("\n🔄 WALK-FORWARD VALIDATION...")
    
    # Split into 4 windows
    window_size = len(df) // 4
    results = []
    
    for i in range(1, 4):  # Test on windows 2, 3, 4
        start_idx = i * window_size
        end_idx = min((i + 1) * window_size, len(df))
        
        window_data = df.iloc[start_idx:end_idx]
        window_result = backtest_evolved_strategy(window_data, strategy_params)
        
        results.append({
            'window': i + 1,
            'win_rate': window_result['win_rate'],
            'total_return': window_result['total_return'],
            'trades': window_result['total_trades']
        })
        
        print(f"   📊 Window {i + 1}: {window_result['win_rate']:.1f}% win rate, "
              f"{window_result['total_return']:.2f}% return")
    
    # Summary
    if results:
        avg_win_rate = np.mean([r['win_rate'] for r in results if r['trades'] > 0])
        profitable_windows = len([r for r in results if r['total_return'] > 0])
        
        print(f"\n   🎯 WALK-FORWARD SUMMARY:")
        print(f"      Average Win Rate: {avg_win_rate:.1f}%")
        print(f"      Profitable Windows: {profitable_windows}/{len(results)}")
        print(f"      Success Rate: {profitable_windows/len(results)*100:.0f}%")
    
    return results

def check_exit_conditions(position, row, strategy_params):
    """Check exit conditions"""
    current_price = row['close']
    entry_price = position['entry_price']
    return_pct = (current_price - entry_price) / entry_price * 100
    
    if current_price > position['highest_price']:
        position['highest_price'] = current_price
    
    # Stop loss (evolved)
    if return_pct <= -strategy_params['stop_loss']:
        return {'should_exit': True, 'reason': 'STOP_LOSS'}
    
    # Take profit (evolved)
    if return_pct >= strategy_params['take_profit']:
        return {'should_exit': True, 'reason': 'TAKE_PROFIT'}
    
    # Trailing stop (evolved)
    if return_pct > 1.0:
        trailing_threshold = position['highest_price'] * (1 - strategy_params['trailing_stop']/100)
        if current_price <= trailing_threshold:
            return {'should_exit': True, 'reason': 'TRAILING_STOP'}
    
    return {'should_exit': False, 'reason': None}

def calculate_rsi(prices, period=14):
    """Calculate RSI"""
    delta = prices.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    rs = gain / loss
    return 100 - (100 / (1 + rs))

def assess_deployment_readiness(backtest_results, wf_results):
    """Assess if strategy is ready for deployment"""
    print("\n🚀 DEPLOYMENT READINESS ASSESSMENT:")
    
    criteria = {
        'min_win_rate': 55.0,
        'min_trades': 20,
        'min_wf_success': 60.0
    }
    
    checks = {}
    
    # Check backtest performance
    checks['win_rate'] = {
        'value': backtest_results['win_rate'],
        'threshold': criteria['min_win_rate'],
        'passed': backtest_results['win_rate'] >= criteria['min_win_rate']
    }
    
    checks['trade_count'] = {
        'value': backtest_results['total_trades'],
        'threshold': criteria['min_trades'],
        'passed': backtest_results['total_trades'] >= criteria['min_trades']
    }
    
    # Check walk-forward
    profitable_windows = len([r for r in wf_results if r['total_return'] > 0])
    wf_success_rate = profitable_windows / len(wf_results) * 100
    
    checks['wf_success'] = {
        'value': wf_success_rate,
        'threshold': criteria['min_wf_success'],
        'passed': wf_success_rate >= criteria['min_wf_success']
    }
    
    # Display assessment
    passed_checks = sum([1 for check in checks.values() if check['passed']])
    overall_score = passed_checks / len(checks) * 100
    
    for check_name, check_data in checks.items():
        status = "✅" if check_data['passed'] else "❌"
        print(f"   {status} {check_name}: {check_data['value']:.1f} (req: {check_data['threshold']})")
    
    print(f"\n   📊 Overall Score: {overall_score:.0f}/100")
    
    if overall_score >= 80:
        print(f"   🎯 RECOMMENDATION: DEPLOY STRATEGY ✅")
        return 'DEPLOY'
    elif overall_score >= 60:
        print(f"   ⚠️ RECOMMENDATION: IMPROVE BEFORE DEPLOYMENT")
        return 'IMPROVE'
    else:
        print(f"   ❌ RECOMMENDATION: NOT READY FOR DEPLOYMENT")
        return 'NOT_READY'

def main():
    """Main validation function"""
    print("=" * 70)
    print("🧪 EVOLVED STRATEGY COMPREHENSIVE VALIDATION")
    print("=" * 70)
    print("Demonstrating backtesting and walk-forward testing")
    print("of the evolved strategy from adaptive learning")
    print("=" * 70)
    
    # Load evolved strategy
    evolved_strategy = load_evolved_strategy()
    
    # Generate test data
    test_data = generate_test_data()
    
    # Run backtesting
    backtest_results = backtest_evolved_strategy(test_data, evolved_strategy)
    
    # Run walk-forward validation
    wf_results = walk_forward_test(test_data, evolved_strategy)
    
    # Assess deployment readiness
    deployment_status = assess_deployment_readiness(backtest_results, wf_results)
    
    print(f"\n" + "=" * 70)
    print("✅ VALIDATION COMPLETE!")
    print(f"🎯 The evolved strategy CAN be:")
    print(f"   📈 Backtested ✅")
    print(f"   🔄 Walk-forward validated ✅")
    print(f"   📊 Performance analyzed ✅")
    print(f"   🚀 Assessed for deployment ✅")
    print(f"\nDeployment Status: {deployment_status}")
    print("=" * 70)

if __name__ == "__main__":
    np.random.seed(42)  # For consistent results
    main() 