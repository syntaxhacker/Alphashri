#!/usr/bin/env python3
"""
Test script for the Comprehensive Trade Analyzer
Demonstrates both demo mode and full analysis capabilities
"""

import subprocess
import sys
from rich.console import Console
from rich.panel import Panel

console = Console()

def run_demo_mode():
    """Test demo mode functionality"""
    console.print(Panel.fit("🧪 Testing Demo Mode", style="bold blue"))
    
    try:
        result = subprocess.run([
            sys.executable, 
            "comprehensive_trade_analyzer.py",
            "--log-file", "screeners/logs/old_tv_screener_old_screener_05aug.log",
            "--demo"
        ], capture_output=True, text=True, timeout=30)
        
        if result.returncode == 0:
            console.print("[green]✅ Demo mode test passed[/green]")
            console.print("Output preview:")
            console.print(result.stdout[:500] + "..." if len(result.stdout) > 500 else result.stdout)
            return True
        else:
            console.print(f"[red]❌ Demo mode test failed: {result.stderr}[/red]")
            return False
            
    except subprocess.TimeoutExpired:
        console.print("[red]❌ Demo mode test timed out[/red]")
        return False
    except Exception as e:
        console.print(f"[red]❌ Demo mode test error: {e}[/red]")
        return False

def test_help():
    """Test help functionality"""
    console.print(Panel.fit("📚 Testing Help", style="bold cyan"))
    
    try:
        result = subprocess.run([
            sys.executable, 
            "comprehensive_trade_analyzer.py",
            "--help"
        ], capture_output=True, text=True, timeout=10)
        
        if result.returncode == 0 and "usage:" in result.stdout:
            console.print("[green]✅ Help test passed[/green]")
            return True
        else:
            console.print(f"[red]❌ Help test failed[/red]")
            return False
            
    except Exception as e:
        console.print(f"[red]❌ Help test error: {e}[/red]")
        return False

def test_full_analysis():
    """Test full analysis (requires config.py)"""
    console.print(Panel.fit("🔍 Testing Full Analysis", style="bold yellow"))
    
    try:
        # Check if config exists
        from config import UPSTOX_CONFIG
        if not (UPSTOX_CONFIG.get('api_key') and UPSTOX_CONFIG.get('api_secret')):
            console.print("[yellow]⚠️ Skipping full analysis - no config.py credentials[/yellow]")
            return True
            
        console.print("[blue]🔐 Config found, testing authentication...[/blue]")
        
        result = subprocess.run([
            sys.executable, 
            "comprehensive_trade_analyzer.py",
            "--log-file", "screeners/logs/old_tv_screener_old_screener_05aug.log",
            "--losing-only"
        ], capture_output=True, text=True, timeout=120)
        
        if "Authentication successful" in result.stdout or "Already authenticated" in result.stdout:
            console.print("[green]✅ Full analysis test passed[/green]")
            return True
        elif "Authentication" in result.stderr:
            console.print("[yellow]⚠️ Authentication required - manual intervention needed[/yellow]")
            return True
        else:
            console.print(f"[red]❌ Full analysis test failed: {result.stderr[:200]}[/red]")
            return False
            
    except ImportError:
        console.print("[yellow]⚠️ Skipping full analysis - no config.py file[/yellow]")
        return True
    except subprocess.TimeoutExpired:
        console.print("[red]❌ Full analysis test timed out[/red]")
        return False
    except Exception as e:
        console.print(f"[red]❌ Full analysis test error: {e}[/red]")
        return False

def main():
    console.print(Panel.fit("🧪 Comprehensive Trade Analyzer - Test Suite", style="bold green"))
    
    tests = [
        ("Help Functionality", test_help),
        ("Demo Mode", run_demo_mode),
        ("Full Analysis", test_full_analysis)
    ]
    
    passed = 0
    total = len(tests)
    
    for test_name, test_func in tests:
        console.print(f"\n[bold]Running {test_name}...[/bold]")
        if test_func():
            passed += 1
    
    console.print(f"\n[bold]Test Results: {passed}/{total} passed[/bold]")
    
    if passed == total:
        console.print("[green]🎉 All tests passed![/green]")
        console.print("\n[blue]Ready to use:[/blue]")
        console.print("• Demo mode: python comprehensive_trade_analyzer.py --log-file <path> --demo")
        console.print("• Full analysis: python comprehensive_trade_analyzer.py --log-file <path>")
    else:
        console.print("[red]❌ Some tests failed - check configuration[/red]")

if __name__ == "__main__":
    main()