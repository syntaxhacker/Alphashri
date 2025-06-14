#!/usr/bin/env python3
"""
Simple runner for BarUpDn parameter optimization
"""

from bar_updn_optimization import run_complete_optimization
from rich.console import Console

console = Console()

# Binance API keys (using the ones from your README)
API_KEY = "d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3"
API_SECRET = "7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"

def main():
    """Run the complete optimization process"""
    
    console.print("[bold blue]🚀 BarUpDn Strategy - Parameter Optimization & Visualization[/bold blue]\n")
    
    # Configuration
    symbols = ["BTCUSDT"]
    days_back = 20  # Start with 2 days for quick testing
    
    console.print(f"[cyan]Configuration:[/cyan]")
    console.print(f"Symbols: {', '.join(symbols)}")
    console.print(f"Historical Period: {days_back} days")
    console.print(f"API: Binance (1-minute data)")
    console.print()
    
    try:
        # Run complete optimization
        results = run_complete_optimization(
            symbols=symbols,
            api_key=API_KEY,
            api_secret=API_SECRET,
            days_back=days_back
        )
        
        console.print("\n[bold green]🎉 Optimization Complete![/bold green]")
        console.print("\n[yellow]📋 What was generated:[/yellow]")
        console.print("✅ Parameter optimization results")
        console.print("✅ Interactive HTML chart (bar_updn_analysis.html)")
        console.print("✅ JSON results file")
        console.print("✅ Console performance summary")
        
        console.print("\n[bold cyan]📊 Next Steps:[/bold cyan]")
        console.print("1. Open 'bar_updn_analysis.html' in your browser")
        console.print("2. Review the optimized parameters")
        console.print("3. Analyze individual symbol performance")
        console.print("4. Check trade-by-trade details")
        
        return results
        
    except Exception as e:
        console.print(f"[red]❌ Error during optimization: {str(e)}[/red]")
        return None

if __name__ == "__main__":
    main() 