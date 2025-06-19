#!/usr/bin/env python3
"""
Test script for walk-forward enhanced optimization
"""

from adaptive_learning_engine import AdaptiveLearningEngine, AdvancedMLParameterOptimizer
import json

def test_walkforward_optimization():
    """Test the walk-forward optimization improvements"""
    print("🚀 Testing Walk-Forward Enhanced Optimization...")
    print("="*60)
    
    # Initialize with walk-forward focus
    engine = AdaptiveLearningEngine(
        target_return=4.0,
        target_win_rate=70.0, 
        target_wf_success=65.0
    )
    
    print(f"🎯 Target WF Success: 65.0%")
    print(f"📊 Current baseline: 38.9%")
    print(f"🔧 Improvement needed: +26.1%")
    
    # Test the enhanced Bayesian optimization
    print("\n🧠 Running Enhanced Bayesian Optimization...")
    optimizer = AdvancedMLParameterOptimizer()
    
    # Run 5 iterations to test improvements
    best_params = None
    best_score = -float('inf')
    
    for i in range(5):
        print(f"\n🔄 Iteration {i+1}/5")
        
        # Get optimized parameters
        params = optimizer._bayesian_optimization()
        
        # Calculate enhanced score with walk-forward penalties
        wf_score = optimizer._simulate_with_walkforward_penalty(params)
        
        print(f"   📊 WF-Adjusted Score: {wf_score:.3f}")
        
        if wf_score > best_score:
            best_score = wf_score
            best_params = params
            print(f"   ✅ NEW BEST SCORE!")
    
    print(f"\n🏆 OPTIMIZATION RESULTS:")
    print("="*50)
    print(f"Best WF-Adjusted Score: {best_score:.3f}")
    print(f"\n🧬 Best Parameters:")
    for param, value in best_params.items():
        print(f"   {param}: {value:.4f}")
    
    # Save results
    results = {
        'optimization_type': 'walk_forward_enhanced_test',
        'best_score': best_score,
        'best_parameters': best_params,
        'improvement_focus': 'walk_forward_consistency'
    }
    
    with open('wf_optimization_test_results.json', 'w') as f:
        json.dump(results, f, indent=2)
    
    print(f"\n💾 Results saved to: wf_optimization_test_results.json")
    
    # Recommendations based on results
    print(f"\n📋 RECOMMENDATIONS:")
    print("="*50)
    
    if best_score > 0.7:
        print("✅ Excellent WF-adjusted score! Parameters show strong stability potential")
    elif best_score > 0.5:
        print("📈 Good WF-adjusted score. Further refinement recommended")
    else:
        print("⚠️ WF score needs improvement. Consider more conservative parameters")
    
    # Key insights for walk-forward improvement
    print(f"\n🔍 KEY INSIGHTS FOR WF IMPROVEMENT:")
    print("-" * 40)
    
    position_size = best_params.get('position_size', 10)
    stop_loss = best_params.get('stop_loss', 5)
    take_profit = best_params.get('take_profit', 15)
    confidence = best_params.get('confidence_threshold', 0.5)
    
    if position_size > 20:
        print("⚠️ Position size may be too aggressive for WF consistency")
    if stop_loss < 3:
        print("⚠️ Stop loss may be too tight, causing whipsaws")
    if take_profit / stop_loss > 8:
        print("⚠️ Risk/reward ratio may be unrealistic")
    if confidence < 0.2:
        print("⚠️ Confidence threshold may be too low, causing overtrading")
    
    print("\n🎯 Next Steps:")
    print("1. Test these parameters on real market data")
    print("2. Run actual walk-forward validation")
    print("3. Compare against historical 38.9% WF success rate")
    print("4. If successful, proceed to deployment testing")
    
    return results

if __name__ == "__main__":
    test_walkforward_optimization() 