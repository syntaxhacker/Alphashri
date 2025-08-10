#!/usr/bin/env python3
"""
Test runner script for TV Modes testing

This script runs comprehensive tests for the screeners/tv_modes.py module,
including unit tests, integration tests, and validation with historical data.
"""

import sys
import os
import argparse
import subprocess
import time
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

def run_command(command, description):
    """Run a command and track execution time"""
    print(f"\n{'='*60}")
    print(f"Running: {description}")
    print(f"Command: {command}")
    print('='*60)
    
    start_time = time.time()
    result = subprocess.run(command, shell=True, capture_output=True, text=True)
    end_time = time.time()
    
    print(f"Duration: {end_time - start_time:.2f} seconds")
    
    if result.returncode == 0:
        print("✅ PASSED")
        if result.stdout:
            print(result.stdout)
    else:
        print("❌ FAILED")
        if result.stderr:
            print("STDERR:", result.stderr)
        if result.stdout:
            print("STDOUT:", result.stdout)
    
    return result.returncode == 0


def install_dependencies():
    """Install test dependencies"""
    print("Installing test dependencies...")
    requirements_file = project_root / "tests" / "requirements.txt"
    
    if requirements_file.exists():
        success = run_command(
            f"pip install -r {requirements_file}",
            "Installing test requirements"
        )
        if not success:
            print("⚠️ Failed to install some dependencies, but continuing...")
    else:
        print("No test requirements file found, installing basic dependencies...")
        run_command(
            "pip install pytest pytest-mock pytest-cov pandas numpy",
            "Installing basic test dependencies"
        )


def run_unit_tests():
    """Run unit tests"""
    return run_command(
        "python -m pytest tests/unit/ -v --tb=short",
        "Unit Tests"
    )


def run_integration_tests():
    """Run integration tests (slower, uses historical data)"""
    return run_command(
        "python -m pytest tests/integration/ -v --tb=short -m 'not slow'",
        "Integration Tests (Fast)"
    )


def run_slow_integration_tests():
    """Run slow integration tests"""
    return run_command(
        "python -m pytest tests/integration/ -v --tb=short -m slow",
        "Integration Tests (Slow)"
    )


def run_performance_tests():
    """Run performance tests"""
    return run_command(
        "python -m pytest tests/integration/ -v --tb=short -m performance",
        "Performance Tests"
    )


def run_all_tests():
    """Run all tests with coverage"""
    return run_command(
        "python -m pytest tests/ -v --cov=screeners --cov-report=html --cov-report=term",
        "All Tests with Coverage"
    )


def validate_historical_data():
    """Validate that historical data is available and correct"""
    print("\n" + "="*60)
    print("Validating Historical Data")
    print("="*60)
    
    try:
        from tests.fixtures.historical_data_fetcher import HistoricalDataFetcher
        
        fetcher = HistoricalDataFetcher()
        
        # Check if cached data exists
        nifty_data = fetcher.load_cached_data("nifty50_historical.pkl")
        scenarios_data = fetcher.load_cached_data("test_scenarios.pkl")
        
        if nifty_data is None:
            print("❌ Nifty 50 historical data not found, generating...")
            nifty_data = fetcher.fetch_nifty50_historical_data()
        else:
            print(f"✅ Nifty 50 data loaded: {len(nifty_data)} datasets")
        
        if scenarios_data is None:
            print("❌ Test scenarios not found, generating...")
            scenarios_data = fetcher.generate_test_scenarios()
            fetcher._cache_data(scenarios_data, "test_scenarios.pkl")
        else:
            print(f"✅ Test scenarios loaded: {len(scenarios_data)} scenarios")
        
        # Validate data quality
        sample_stocks = fetcher.get_sample_stocks_for_testing()
        valid_count = 0
        
        for stock in sample_stocks:
            daily_key = f"{stock}_daily"
            if daily_key in nifty_data:
                df = nifty_data[daily_key]
                if len(df) > 100:  # At least 100 days of data
                    valid_count += 1
        
        print(f"✅ Data validation: {valid_count}/{len(sample_stocks)} stocks have sufficient data")
        return True
        
    except Exception as e:
        print(f"❌ Historical data validation failed: {e}")
        return False


def generate_test_report():
    """Generate a comprehensive test report"""
    print("\n" + "="*60)
    print("Generating Test Report")
    print("="*60)
    
    report_file = project_root / "test_report.txt"
    
    with open(report_file, 'w') as f:
        f.write("TV Modes Test Report\n")
        f.write("=" * 50 + "\n")
        f.write(f"Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n")
        
        # Test structure summary
        f.write("Test Structure:\n")
        f.write("-" * 20 + "\n")
        
        test_dir = project_root / "tests"
        for root, dirs, files in os.walk(test_dir):
            for file in files:
                if file.startswith('test_') and file.endswith('.py'):
                    rel_path = os.path.relpath(os.path.join(root, file), test_dir)
                    f.write(f"  {rel_path}\n")
        
        f.write(f"\nTotal test files: {len([f for f in os.listdir(test_dir) if f.startswith('test_')])}\n")
    
    print(f"✅ Test report generated: {report_file}")


def main():
    parser = argparse.ArgumentParser(description="Run TV Modes tests")
    parser.add_argument("--install", action="store_true", help="Install test dependencies")
    parser.add_argument("--unit", action="store_true", help="Run unit tests only")
    parser.add_argument("--integration", action="store_true", help="Run integration tests only")
    parser.add_argument("--slow", action="store_true", help="Include slow tests")
    parser.add_argument("--performance", action="store_true", help="Run performance tests")
    parser.add_argument("--all", action="store_true", help="Run all tests")
    parser.add_argument("--validate", action="store_true", help="Validate historical data")
    parser.add_argument("--report", action="store_true", help="Generate test report")
    parser.add_argument("--quick", action="store_true", help="Quick test run (unit + fast integration)")
    
    args = parser.parse_args()
    
    # Change to project directory
    os.chdir(project_root)
    
    success_count = 0
    total_count = 0
    
    if args.install or not any([args.unit, args.integration, args.slow, args.performance, 
                               args.all, args.validate, args.report, args.quick]):
        install_dependencies()
    
    if args.validate or args.all:
        total_count += 1
        if validate_historical_data():
            success_count += 1
    
    if args.unit or args.all or args.quick:
        total_count += 1
        if run_unit_tests():
            success_count += 1
    
    if args.integration or args.all or args.quick:
        total_count += 1
        if run_integration_tests():
            success_count += 1
    
    if args.slow or args.all:
        total_count += 1
        if run_slow_integration_tests():
            success_count += 1
    
    if args.performance or args.all:
        total_count += 1
        if run_performance_tests():
            success_count += 1
    
    if args.report:
        generate_test_report()
    
    if args.all and not any([args.unit, args.integration, args.slow, args.performance]):
        total_count += 1
        if run_all_tests():
            success_count += 1
    
    # Default behavior if no specific flags
    if not any(vars(args).values()):
        print("Running default test suite (quick validation)...")
        
        # Install dependencies
        install_dependencies()
        
        # Validate data
        total_count += 1
        if validate_historical_data():
            success_count += 1
        
        # Run unit tests
        total_count += 1
        if run_unit_tests():
            success_count += 1
        
        # Run fast integration tests
        total_count += 1
        if run_integration_tests():
            success_count += 1
    
    # Summary
    print("\n" + "="*60)
    print("TEST SUMMARY")
    print("="*60)
    print(f"Passed: {success_count}/{total_count}")
    
    if success_count == total_count:
        print("🎉 All tests passed!")
        return 0
    else:
        print("❌ Some tests failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())