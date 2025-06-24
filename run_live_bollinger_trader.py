#!/usr/bin/env python3
"""
Simple runner script for Bollinger Bands Live Trading Bot
Run this to start trading your tested strategy on Binance
"""

import os
import argparse
from datetime import datetime
from rich.console import Console
from rich.panel import Panel
from rich.prompt import Prompt, Confirm

from bollinger_bands_live_trader import BollingerBandsLiveTrader

def main():
    console = Console()
    
    # Display welcome message
    console.print(Panel.fit(
        """
🚀 BOLLINGER BANDS LIVE TRADER 🚀

This trader implements the 4-hour Bollinger Bands mean reversion strategy
that was tested and optimized in the walkforward analysis.

⚠️  IMPORTANT SAFETY INFORMATION ⚠️
• Start with TESTNET for safety
• Use small position sizes initially  
• Monitor performance closely
• This is experimental software - trade at your own risk

Strategy Details:
• Timeframe: 4-hour bars
• Mean reversion with Bollinger Bands
• Trailing stops for profit protection
• Volume confirmation required
• RSI filtering for entries
        """,
        title="Live Trading Bot",
        border_style="green"
    ))
    
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Bollinger Bands Live Trader')
    parser.add_argument('--symbol', type=str, default='BTCUSDT', 
                       help='Trading symbol (default: BTCUSDT)')
    parser.add_argument('--balance', type=float, default=10000, 
                       help='Starting balance in USDT (default: 10000)')
    parser.add_argument('--leverage', type=int, default=1, 
                       help='Trading leverage 1-125x (default: 1)')
    parser.add_argument('--testnet', action='store_true', default=True,
                       help='Use Binance testnet (default: True)')
    parser.add_argument('--mainnet', action='store_true', 
                       help='Use Binance mainnet (WARNING: Real money!)')
    
    args = parser.parse_args()
    
    # Safety check for mainnet
    use_testnet = True
    if args.mainnet:
        console.print("[red]⚠️  MAINNET TRADING DETECTED![/red]")
        console.print("[red]This will use REAL MONEY![/red]")
        
        confirm = Confirm.ask(
            "[red]Are you absolutely sure you want to trade on mainnet with real money?[/red]"
        )
        
        if confirm:
            double_confirm = Confirm.ask(
                "[red]Final confirmation: This will execute REAL trades with REAL money. Continue?[/red]"
            )
            if double_confirm:
                use_testnet = False
                console.print("[red]🔴 MAINNET MODE ACTIVATED - TRADING WITH REAL MONEY[/red]")
            else:
                console.print("[green]✅ Staying on testnet for safety[/green]")
        else:
            console.print("[green]✅ Staying on testnet for safety[/green]")
    
    # Get API credentials from config (testnet credentials are already in config.py)
    from config import BINANCE_API_CONFIG
    
    api_config = BINANCE_API_CONFIG['testnet' if use_testnet else 'mainnet']
    
    if use_testnet:
        # Use testnet credentials from config
        api_key = api_config.get('api_key')
        api_secret = api_config.get('api_secret')
        console.print("[cyan]📡 Using testnet credentials from config[/cyan]")
    else:
        # For mainnet, require user to provide credentials
        console.print("[yellow]🔑 Mainnet requires your own API credentials[/yellow]")
        api_key = Prompt.ask("Enter your Binance API Key")
        api_secret = Prompt.ask("Enter your Binance API Secret", password=True)
    
    if not api_key or not api_secret:
        console.print("[red]❌ API credentials are required[/red]")
        return
    
    # Display trading parameters
    console.print(f"\n[cyan]📊 TRADING PARAMETERS[/cyan]")
    console.print(f"Symbol: [green]{args.symbol}[/green]")
    console.print(f"Balance: [green]${args.balance:,.2f}[/green]")
    console.print(f"Leverage: [green]{args.leverage}x[/green]")
    console.print(f"Network: [{'green' if use_testnet else 'red'}]{'TESTNET' if use_testnet else 'MAINNET'}[/{'green' if use_testnet else 'red'}]")
    console.print(f"Strategy: [green]4H Bollinger Bands Mean Reversion[/green]")
    
    # Final confirmation
    console.print(f"\n[yellow]🎯 Ready to start trading?[/yellow]")
    start_confirm = Confirm.ask("Start the live trading bot?")
    
    if not start_confirm:
        console.print("[yellow]👋 Trading cancelled by user[/yellow]")
        return
    
    try:
        # Initialize the trader
        console.print(f"\n[cyan]🔧 Initializing Bollinger Bands trader...[/cyan]")
        
        trader = BollingerBandsLiveTrader(
            api_key=api_key,
            api_secret=api_secret,
            use_testnet=use_testnet,
            leverage=args.leverage
        )
        
        # Start trading
        console.print(f"[green]🚀 Starting live trading![/green]")
        console.print(f"[yellow]Press Ctrl+C to stop trading safely[/yellow]")
        
        trader.run(symbol=args.symbol, balance=args.balance)
        
    except KeyboardInterrupt:
        console.print(f"\n[yellow]🛑 Trading stopped by user[/yellow]")
    except Exception as e:
        console.print(f"\n[red]❌ Error: {str(e)}[/red]")
        console.print(f"[yellow]💡 Check your API credentials and network connection[/yellow]")


if __name__ == "__main__":
    main() 