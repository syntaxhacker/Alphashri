"""
System and Signal Management Utilities for TradingView Screener
==============================================================

This module contains utility functions for handling system signals,
process management, and graceful shutdown procedures.
"""

import signal
import sys
import atexit
from rich.console import Console

console = Console()


def setup_signal_handlers(signal_handler_callback, cleanup_callback):
    """Setup signal handlers for graceful shutdown
    
    Args:
        signal_handler_callback: Function to call when signal is received
        cleanup_callback: Function to call on exit for cleanup
    """
    signal.signal(signal.SIGINT, signal_handler_callback)  # Ctrl+C
    signal.signal(signal.SIGTERM, signal_handler_callback)  # Termination
    atexit.register(cleanup_callback)


def create_signal_handler(exit_positions_callback):
    """Create a signal handler function
    
    Args:
        exit_positions_callback: Function to call to exit all positions
        
    Returns:
        Signal handler function
    """
    def signal_handler(signum=None, frame=None):
        """Handle shutdown signals"""
        console.print(f"\n[bold yellow]🛑 Signal received: {signal.Signals(signum).name if signum else 'EXIT'}[/bold yellow]")
        exit_positions_callback("SCRIPT_STOPPED")
        sys.exit(0)
    
    return signal_handler


def create_cleanup_handler(positions_ref, exit_positions_callback):
    """Create a cleanup handler function for script exit
    
    Args:
        positions_ref: Reference to positions object/dict
        exit_positions_callback: Function to call to exit all positions
        
    Returns:
        Cleanup handler function
    """
    def cleanup_on_exit():
        """Cleanup function called on script exit"""
        if hasattr(positions_ref, '__len__') and len(positions_ref) > 0:
            exit_positions_callback("SCRIPT_EXIT")
        elif positions_ref:  # Handle dict or other truthy objects
            exit_positions_callback("SCRIPT_EXIT")
    
    return cleanup_on_exit