"""
API Module - REST API endpoints for trading operations.
"""

from .paper_trading import router as paper_trading_router

__all__ = ['paper_trading_router']
