"""
StrategyRunner dataclass for single strategy configuration within MultiStrategyRunner.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional

from rich.console import Console

import importlib

SIGNAL_GENERATOR_REGISTRY: dict[str, tuple[str, str]] = {
    "ORB": ("trading.orb_signals", "ORBSignalGenerator"),
    "SR_BREAKOUT": ("trading.sr_breakout_signals", "SRBreakoutSignalGenerator"),
    "52W_CHASER": ("trading.week52_chaser_signals", "Week52ChaserSignalGenerator"),
    "52W_TARGET": ("trading.week52_target_signals", "Week52TargetSignalGenerator"),
    "BLIND_52W": ("trading.blind_52w_signals", "Blind52WSignalGenerator"),
    "EMA_CROSS": ("trading.ema_cross_signals", "EMACrossSignalGenerator"),
    "SHORT_52W_FAILED": ("trading.short_52w_failed_signals", "Short52WFailedSignalGenerator"),
    "ADX_TREND": ("trading.adx_trend_signals", "ADXTrendSignalGenerator"),
    "VOLUME_SURGE": ("trading.volume_surge_signals", "VolumeSurgeSignalGenerator"),
}

console = Console()

INTRADAY_STRATEGY_TYPES = {"ORB", "SR_BREAKOUT", "EMA_CROSS"}
SWING_STRATEGY_TYPES = {"52W_CHASER", "52W_TARGET", "BLIND_52W", "ADX_TREND", "SHORT_52W_FAILED", "VOLUME_SURGE"}


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

        if self.strategy_type in SIGNAL_GENERATOR_REGISTRY:
            module_path, class_name = SIGNAL_GENERATOR_REGISTRY[self.strategy_type]
            module = importlib.import_module(module_path)
            cls = getattr(module, class_name)
            if self.strategy_type == "ORB":
                self.signal_generator = cls(
                    or_minutes=self.config.get('or_minutes', 45),
                    sl_pct=self.config.get('sl_pct'),
                    tp_pct=self.config.get('tp_pct'),
                    min_or_range_pct=self.config.get('min_or_range_pct', 0.5),
                    max_or_range_pct=self.config.get('max_or_range_pct', 3.0),
                    breakout_buffer_pct=self.config.get('breakout_buffer_pct', 0.3),
                    config_name=self.strategy_name,
                )
            else:
                self.signal_generator = cls(self.config)
        else:
            raise ValueError(f"Unknown strategy type '{self.strategy_type}' — not in SIGNAL_GENERATOR_REGISTRY")

        # Apply config-level overrides that all generators share
        cutoff = self.config.get('eod_entry_cutoff_minutes')
        if cutoff is not None:
            self.signal_generator.eod_entry_cutoff_minutes = int(cutoff)
