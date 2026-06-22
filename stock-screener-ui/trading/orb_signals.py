"""
ORB Signal Generator - Generate live trading signals for ORB strategy.

This module generates real-time trading signals based on:
1. ORB stock scanner results
2. Live 5-minute candle data
3. Opening range breakout detection
"""

import sys
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from dataclasses import dataclass

import config
from enum import Enum

from rich.console import Console
from rich.table import Table

# Import config loader
try:
    from trading.config_loader import get_strategy_config
    _config_available = True
except ImportError:
    _config_available = False

# Import shared ORB utilities (single source of truth for OR calculations)
from trading.orb_utils import calculate_or_levels as utils_calculate_or_levels

console = Console()


class SignalType(Enum):
    LONG_ENTRY = "LONG_ENTRY"
    SHORT_ENTRY = "SHORT_ENTRY"
    LONG_EXIT = "LONG_EXIT"
    SHORT_EXIT = "SHORT_EXIT"


@dataclass
class ORBSignal:
    """ORB trading signal."""
    symbol: str
    signal_type: SignalType
    price: float
    stop_loss: float
    take_profit: float
    or_high: float
    or_low: float
    or_range: float
    or_range_pct: float
    timestamp: datetime
    atr_pct: float = 0.0
    adx: float = 0.0
    rsi: float = 0.0
    score: float = 0.0
    notes: str = ""


class ORBSignalGenerator:
    """
    Generate live ORB trading signals.

    Workflow:
    1. Get ORB-ready stocks from screener
    2. Fetch 5-minute data for each stock
    3. Calculate opening range (9:15-10:00)
    4. Detect breakouts above/below OR
    5. Generate signals with SL/TP
    """

    # Market timings (IST)
    MARKET_OPEN = (9, 15)
    OR_END = (10, 0)
    MARKET_CLOSE = (15, 30)
    FORCE_EXIT = (14, 45)

    def __init__(
        self,
        or_minutes: int = None,
        sl_pct: float = None,
        tp_pct: float = None,
        min_or_range_pct: float = None,
        max_or_range_pct: float = None,
        breakout_buffer_pct: float = None,
        config_name: str = None,
    ):
        """
        Initialize signal generator.

        Args:
            or_minutes: Opening range duration in minutes (overrides config)
            sl_pct: Stop loss percentage (overrides config)
            tp_pct: Take profit percentage (overrides config)
            min_or_range_pct: Minimum OR range % for valid signal (overrides config)
            max_or_range_pct: Maximum OR range % for valid signal (overrides config)
            config_name: Name of config to load from database
        """
        # Load from config if available
        if _config_available:
            config = get_strategy_config(config_name)
            self.or_minutes = or_minutes if or_minutes is not None else config.or_minutes
            self.sl_pct = sl_pct if sl_pct is not None else config.sl_pct
            self.tp_pct = tp_pct if tp_pct is not None else config.tp_pct
            self.min_or_range_pct = min_or_range_pct if min_or_range_pct is not None else config.min_or_range_pct
            self.max_or_range_pct = max_or_range_pct if max_or_range_pct is not None else config.max_or_range_pct
            self.breakout_buffer_pct = breakout_buffer_pct if breakout_buffer_pct is not None else config.breakout_buffer_pct
            self.enable_shorts = config.enable_shorts
            self.FORCE_EXIT = (config.eod_exit_hour, config.eod_exit_minute)
        else:
            self.or_minutes = or_minutes if or_minutes is not None else 45
            self.sl_pct = sl_pct if sl_pct is not None else 1.0
            self.tp_pct = tp_pct if tp_pct is not None else 1.5
            self.min_or_range_pct = min_or_range_pct if min_or_range_pct is not None else 0.5
            self.max_or_range_pct = max_or_range_pct if max_or_range_pct is not None else 3.0
            self.breakout_buffer_pct = breakout_buffer_pct if breakout_buffer_pct is not None else 0.3
            self.enable_shorts = False

        # OR levels cache
        self.or_levels: Dict[str, dict] = {}
        self.active_signals: Dict[str, ORBSignal] = {}

    def calculate_or_levels(self, candles: List[dict], symbol: str = None) -> Optional[dict]:
        """
        Calculate opening range levels from candles.
        Uses shared utility from trading.orb_utils (single source of truth).

        Args:
            candles: List of 5-min candles with 'time', 'high', 'low', 'close'
            symbol: Optional symbol for caching OR levels per symbol

        Returns:
            Dict with OR levels or None if insufficient data
        """
        if not candles:
            return None

        # Use shared utility for OR calculation (single source of truth)
        result = utils_calculate_or_levels(
            candles=candles,
            or_minutes=self.or_minutes,
            market_open=self.MARKET_OPEN,
        )

        # Cache the result if valid (OR levels should be fixed after OR period)
        if result and symbol:
            self.or_levels[symbol] = result

        return result

    def get_cached_or_levels(self, symbol: str) -> Optional[dict]:
        """
        Get cached OR levels for a symbol.

        Args:
            symbol: Stock symbol

        Returns:
            Cached OR levels or None if not cached
        """
        return self.or_levels.get(symbol)

    def check_breakout(
        self,
        symbol: str,
        current_price: float,
        or_levels: dict,
        atr_pct: float = 0.0,
        adx: float = 0.0,
        rsi: float = 0.0,
        score: float = 0.0,
    ) -> Optional[ORBSignal]:
        """
        Check for ORB breakout and generate signal.

        Args:
            symbol: Stock symbol
            current_price: Current price
            or_levels: OR levels dict
            atr_pct: ATR percentage
            adx: ADX value
            rsi: RSI value
            score: Screener score

        Returns:
            ORBSignal if breakout detected, None otherwise
        """
        or_high = or_levels['or_high']
        or_low = or_levels['or_low']
        or_range = or_levels['or_range']
        or_range_pct = or_levels['or_range_pct']

        buffer = self.breakout_buffer_pct / 100

        # Validate OR range
        if or_range_pct < self.min_or_range_pct or or_range_pct > self.max_or_range_pct:
            return None

        # Check for long breakout (above OR high)
        if current_price > or_high * (1 + buffer):
            # Calculate SL and TP
            sl = current_price * (1 - self.sl_pct / 100)
            tp = current_price * (1 + self.tp_pct / 100)

            return ORBSignal(
                symbol=symbol,
                signal_type=SignalType.LONG_ENTRY,
                price=current_price,
                stop_loss=round(sl, 2),
                take_profit=round(tp, 2),
                or_high=or_high,
                or_low=or_low,
                or_range=or_range,
                or_range_pct=round(or_range_pct, 2),
                timestamp=datetime.now(config.IST),
                atr_pct=atr_pct,
                adx=adx,
                rsi=rsi,
                score=score,
                notes=f"Breakout above OR high ₹{or_high:.2f} | OR ₹{or_low:.2f}-₹{or_high:.2f} ({or_range_pct:.2f}%) | SL {self.sl_pct}% TP {self.tp_pct}% | ATR {atr_pct:.1f}% ADX {adx:.0f} RSI {rsi:.0f}",
            )

        # Check for short breakout (below OR low)
        if not self.enable_shorts:
            pass
        elif current_price < or_low * (1 - buffer):
            # Calculate SL and TP for short
            sl = current_price * (1 + self.sl_pct / 100)
            tp = current_price * (1 - self.tp_pct / 100)

            return ORBSignal(
                symbol=symbol,
                signal_type=SignalType.SHORT_ENTRY,
                price=current_price,
                stop_loss=round(sl, 2),
                take_profit=round(tp, 2),
                or_high=or_high,
                or_low=or_low,
                or_range=or_range,
                or_range_pct=round(or_range_pct, 2),
                timestamp=datetime.now(config.IST),
                adx=adx,
                rsi=rsi,
                score=score,
                notes=f"Breakdown below OR low ₹{or_low:.2f} | OR ₹{or_low:.2f}-₹{or_high:.2f} ({or_range_pct:.2f}%) | SL {self.sl_pct}% TP {self.tp_pct}% | ADX {adx:.0f} RSI {rsi:.0f}",
            )

        return None

    def check_exit(
        self,
        symbol: str,
        position_side: str,
        entry_price: float,
        stop_loss: float,
        take_profit: float,
        current_price: float,
        **kwargs,
    ) -> Optional[ORBSignal]:
        """
        Check if position should be exited.

        Args:
            symbol: Stock symbol
            position_side: 'BUY' or 'SELL'
            entry_price: Entry price
            stop_loss: Stop loss price
            take_profit: Take profit price
            current_price: Current price
            **kwargs: accepts 'timestamp' for replay mode

        Returns:
            ORBSignal for exit if triggered, None otherwise
        """
        now = kwargs.get("timestamp", datetime.now(config.IST))

        # Check force exit time (14:45)
        if now.hour >= self.FORCE_EXIT[0] and now.minute >= self.FORCE_EXIT[1]:
            pnl_pct = ((current_price - entry_price) / entry_price) * 100 if entry_price else 0
            return ORBSignal(
                symbol=symbol,
                signal_type=SignalType.LONG_EXIT if position_side == "BUY" else SignalType.SHORT_EXIT,
                price=current_price,
                stop_loss=stop_loss,
                take_profit=take_profit,
                or_high=0,
                or_low=0,
                or_range=0,
                or_range_pct=0,
                timestamp=now,
                notes=f"EOD force exit ({self.FORCE_EXIT[0]}:{self.FORCE_EXIT[1]:02d}) (PnL: {pnl_pct:+.2f}%)",
            )

        # Check SL/TP for long position
        if position_side == "BUY":
            pnl_pct = ((current_price - entry_price) / entry_price) * 100 if entry_price else 0
            if current_price <= stop_loss:
                return ORBSignal(
                    symbol=symbol,
                    signal_type=SignalType.LONG_EXIT,
                    price=current_price,
                    stop_loss=stop_loss,
                    take_profit=take_profit,
                    or_high=0,
                    or_low=0,
                    or_range=0,
                    or_range_pct=0,
                    timestamp=now,
                    notes=f"Stop loss hit ₹{stop_loss:.2f} (PnL: {pnl_pct:+.2f}%)",
                )
            if current_price >= take_profit:
                return ORBSignal(
                    symbol=symbol,
                    signal_type=SignalType.LONG_EXIT,
                    price=current_price,
                    stop_loss=stop_loss,
                    take_profit=take_profit,
                    or_high=0,
                    or_low=0,
                    or_range=0,
                    or_range_pct=0,
                    timestamp=now,
                    notes=f"Take profit hit ₹{take_profit:.2f} (PnL: {pnl_pct:+.2f}%)",
                )

        # Check SL/TP for short position
        if position_side == "SELL":
            pnl_pct = ((entry_price - current_price) / entry_price) * 100 if entry_price else 0
            if current_price >= stop_loss:
                return ORBSignal(
                    symbol=symbol,
                    signal_type=SignalType.SHORT_EXIT,
                    price=current_price,
                    stop_loss=stop_loss,
                    take_profit=take_profit,
                    or_high=0,
                    or_low=0,
                    or_range=0,
                    or_range_pct=0,
                    timestamp=now,
                    notes=f"Stop loss hit ₹{stop_loss:.2f} (PnL: {pnl_pct:+.2f}%)",
                )
            if current_price <= take_profit:
                return ORBSignal(
                    symbol=symbol,
                    signal_type=SignalType.SHORT_EXIT,
                    price=current_price,
                    stop_loss=stop_loss,
                    take_profit=take_profit,
                    or_high=0,
                    or_low=0,
                    or_range=0,
                    or_range_pct=0,
                    timestamp=now,
                    notes=f"Take profit hit ₹{take_profit:.2f} (PnL: {pnl_pct:+.2f}%)",
                )

        return None

    def display_signals(self, signals: List[ORBSignal]):
        """Display signals in a table."""
        if not signals:
            console.print("[yellow]No signals to display[/yellow]")
            return

        console.print(f"\n[bold cyan]═══ ORB Signals ({len(signals)}) ═══[/bold cyan]")

        table = Table()
        table.add_column("Symbol", style="cyan")
        table.add_column("Type", style="yellow")
        table.add_column("Price", justify="right")
        table.add_column("SL", justify="right")
        table.add_column("TP", justify="right")
        table.add_column("OR Range%", justify="right")
        table.add_column("Notes")

        for signal in signals:
            signal_color = "green" if "LONG" in signal.signal_type.value else "red"
            table.add_row(
                signal.symbol,
                f"[{signal_color}]{signal.signal_type.value}[/{signal_color}]",
                f"₹{signal.price:.2f}",
                f"₹{signal.stop_loss:.2f}",
                f"₹{signal.take_profit:.2f}",
                f"{signal.or_range_pct:.2f}%",
                signal.notes[:30],
            )

        console.print(table)


def create_entry_signal(
    symbol: str,
    price: float,
    or_high: float,
    or_low: float,
    sl_pct: float = 1.0,
    tp_pct: float = 1.5,
    side: str = "LONG",
) -> ORBSignal:
    """
    Convenience function to create an entry signal.

    Args:
        symbol: Stock symbol
        price: Entry price
        or_high: Opening range high
        or_low: Opening range low
        sl_pct: Stop loss percentage
        tp_pct: Take profit percentage
        side: 'LONG' or 'SHORT'

    Returns:
        ORBSignal
    """
    or_range = or_high - or_low
    or_range_pct = (or_range / price) * 100

    if side == "LONG":
        signal_type = SignalType.LONG_ENTRY
        sl = price * (1 - sl_pct / 100)
        tp = price * (1 + tp_pct / 100)
    else:
        signal_type = SignalType.SHORT_ENTRY
        sl = price * (1 + sl_pct / 100)
        tp = price * (1 - tp_pct / 100)

    return ORBSignal(
        symbol=symbol,
        signal_type=signal_type,
        price=price,
        stop_loss=round(sl, 2),
        take_profit=round(tp, 2),
        or_high=or_high,
        or_low=or_low,
        or_range=or_range,
        or_range_pct=round(or_range_pct, 2),
        timestamp=datetime.now(config.IST),
    )


if __name__ == '__main__':
    # Demo
    generator = ORBSignalGenerator()

    # Sample candles for OR calculation
    sample_candles = [
        {'time': '2024-01-15T09:15:00', 'high': 3500, 'low': 3490, 'close': 3495},
        {'time': '2024-01-15T09:20:00', 'high': 3505, 'low': 3492, 'close': 3500},
        {'time': '2024-01-15T09:25:00', 'high': 3510, 'low': 3495, 'close': 3505},
        {'time': '2024-01-15T09:30:00', 'high': 3508, 'low': 3500, 'close': 3503},
        {'time': '2024-01-15T09:35:00', 'high': 3515, 'low': 3505, 'close': 3510},
        {'time': '2024-01-15T09:40:00', 'high': 3520, 'low': 3510, 'close': 3515},
        {'time': '2024-01-15T09:45:00', 'high': 3518, 'low': 3512, 'close': 3515},
        {'time': '2024-01-15T09:50:00', 'high': 3525, 'low': 3515, 'close': 3520},
        {'time': '2024-01-15T09:55:00', 'high': 3522, 'low': 3518, 'close': 3520},
        {'time': '2024-01-15T10:00:00', 'high': 3525, 'low': 3520, 'close': 3522},
    ]

    # Calculate OR levels
    or_levels = generator.calculate_or_levels(sample_candles)
    print(f"OR Levels: {or_levels}")

    # Check for breakout (price above OR high)
    signal = generator.check_breakout(
        symbol="NETWEB",
        current_price=3530,  # Above OR high
        or_levels=or_levels,
        atr_pct=5.0,
        adx=30,
        rsi=65,
        score=50,
    )

    if signal:
        generator.display_signals([signal])

    # Create entry signal manually
    manual_signal = create_entry_signal(
        symbol="APEX",
        price=440,
        or_high=438,
        or_low=430,
        sl_pct=0.4,
        tp_pct=1.2,
        side="LONG",
    )

    generator.display_signals([manual_signal])
