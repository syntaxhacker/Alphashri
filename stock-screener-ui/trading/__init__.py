"""
Trading Module - Paper trading and live trading infrastructure.

Components:
- paper_trader: Simulated trading with virtual money
- orb_signals: Live ORB signal generation
- risk_manager: Position sizing and risk controls
- journal: Trade logging and analysis
"""

from .paper_trader import PaperTrader
from .orb_signals import ORBSignalGenerator
from .risk_manager import RiskManager
__all__ = [
    'PaperTrader',
    'ORBSignalGenerator',
    'RiskManager',
]
