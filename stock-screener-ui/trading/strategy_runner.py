"""
StrategyRunner dataclass for single strategy configuration within MultiStrategyRunner.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional

from rich.console import Console

console = Console()

INTRADAY_STRATEGY_TYPES = {"ORB", "SR_BREAKOUT", "EMA_CROSS"}
SWING_STRATEGY_TYPES = {"52W_CHASER", "52W_TARGET"}


@dataclass
class StrategyRunner:
    """Configuration for a single strategy within the multi-strategy runner."""
    strategy_id: int
    strategy_name: str
    strategy_type: str
    config: dict
    max_positions: int
    capital_allocation_pct: float
    signal_generator: Optional[object] = None
    status: str = "pending"
    last_scan_time: Optional[datetime] = None
    last_scan_items: List = field(default_factory=list)
    signals_generated: int = 0
    trades_executed: int = 0

    def __post_init__(self):
        """Initialize signal generator based on strategy type."""
        if self.signal_generator is not None:
            return

        if self.strategy_type == "ORB":
            from trading.orb_signals import ORBSignalGenerator
            self.signal_generator = ORBSignalGenerator(
                or_minutes=self.config.get('or_minutes', 45),
                sl_pct=self.config.get('sl_pct'),
                tp_pct=self.config.get('tp_pct'),
                min_or_range_pct=self.config.get('min_or_range_pct', 0.5),
                max_or_range_pct=self.config.get('max_or_range_pct', 3.0),
                breakout_buffer_pct=self.config.get('breakout_buffer_pct', 0.3),
            )
        elif self.strategy_type == "SR_BREAKOUT":
            from trading.sr_breakout_signals import SRBreakoutSignalGenerator
            self.signal_generator = SRBreakoutSignalGenerator(self.config)
        elif self.strategy_type == "52W_CHASER":
            from trading.week52_chaser_signals import Week52ChaserSignalGenerator
            self.signal_generator = Week52ChaserSignalGenerator(self.config)
        elif self.strategy_type == "52W_TARGET":
            from trading.week52_target_signals import Week52TargetSignalGenerator
            self.signal_generator = Week52TargetSignalGenerator(self.config)
        elif self.strategy_type == "EMA_CROSS":
            from trading.ema_cross_signals import EMACrossSignalGenerator
            self.signal_generator = EMACrossSignalGenerator(self.config)
        else:
            from trading.orb_signals import ORBSignalGenerator
            console.print(f"[yellow]Unknown strategy type '{self.strategy_type}', using ORB generator as fallback[/yellow]")
            self.signal_generator = ORBSignalGenerator()
