"""
Global Risk Manager - Cross-strategy risk coordination for multi-strategy trading.

This module provides:
- Global position limits across all strategies
- Global capital limits
- Per-symbol max exposure checks
- Strategy-specific risk validation
"""

from typing import Dict, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime

from rich.console import Console

console = Console()


@dataclass
class GlobalRiskConfig:
    """Global risk management configuration."""
    max_total_positions: int = 10       # Max positions across all strategies
    max_total_capital_pct: float = 0.80  # Max 80% total capital usage
    max_symbol_exposure_pct: float = 0.20  # Max 20% exposure to single symbol
    max_daily_loss_pct: float = 0.03    # Max 3% daily loss


class GlobalRiskManager:
    """
    Cross-strategy risk management.

    Coordinates risk checks across multiple strategies running in parallel.
    Prevents over-exposure to single symbols and enforces global limits.
    """

    def __init__(
        self,
        config: Optional[GlobalRiskConfig] = None,
        max_total_positions: int = 10,
        max_total_capital_pct: float = 0.80,
        max_symbol_exposure_pct: float = 0.20,
    ):
        """
        Initialize global risk manager.

        Args:
            config: GlobalRiskConfig to use
            max_total_positions: Override config max positions
            max_total_capital_pct: Override config max capital %
            max_symbol_exposure_pct: Override config max symbol exposure %
        """
        if config is not None:
            self.config = config
        else:
            self.config = GlobalRiskConfig(
                max_total_positions=max_total_positions,
                max_total_capital_pct=max_total_capital_pct,
                max_symbol_exposure_pct=max_symbol_exposure_pct,
            )

        # Track daily P&L for daily loss limit
        self.daily_pnl = 0.0
        self.daily_start_loss_limit_hit = False

        # Track symbol exposure
        self._symbol_exposure: Dict[str, float] = {}

    def check_strategy_limits(
        self,
        strategy_id: int,
        strategy_name: str,
        strategy_max_positions: int,
        strategy_allocation_pct: float,
        current_strategy_positions: int,
        current_strategy_capital_used: float,
        allocated_capital: float,
        trade_value: float,
    ) -> Tuple[bool, str]:
        """
        Check if a trade is within strategy-specific limits.

        Args:
            strategy_id: Strategy ID
            strategy_name: Strategy name
            strategy_max_positions: Max positions for this strategy
            strategy_allocation_pct: Capital allocation percentage
            current_strategy_positions: Current position count
            current_strategy_capital_used: Current capital used
            allocated_capital: Total allocated capital for this strategy
            trade_value: Value of proposed trade

        Returns:
            (allowed: bool, reason: str)
        """
        # Check position limit
        if current_strategy_positions >= strategy_max_positions:
            return False, f"Strategy '{strategy_name}' max positions ({strategy_max_positions}) reached"

        # Check capital limit
        if current_strategy_capital_used + trade_value > allocated_capital:
            available = allocated_capital - current_strategy_capital_used
            return False, f"Strategy '{strategy_name}' capital limit exceeded (available: ₹{available:,.0f})"

        return True, "OK"

    def check_global_limits(
        self,
        total_capital: float,
        current_total_positions: int,
        current_total_capital_used: float,
        trade_value: float,
    ) -> Tuple[bool, str]:
        """
        Check if a trade is within global limits.

        Args:
            total_capital: Total portfolio capital
            current_total_positions: Current total positions
            current_total_capital_used: Current capital used
            trade_value: Value of proposed trade

        Returns:
            (allowed: bool, reason: str)
        """
        # Check total positions
        if current_total_positions >= self.config.max_total_positions:
            return False, f"Global position limit ({self.config.max_total_positions}) reached"

        # Check total capital
        max_total_capital = total_capital * self.config.max_total_capital_pct
        if current_total_capital_used + trade_value > max_total_capital:
            used_pct = (current_total_capital_used + trade_value) / total_capital * 100
            return False, f"Global capital limit ({self.config.max_total_capital_pct:.0%}) would be exceeded (current: {used_pct:.1f}%)"

        return True, "OK"

    def check_symbol_exposure(
        self,
        symbol: str,
        total_capital: float,
        current_symbol_exposure: float,
        trade_value: float,
    ) -> Tuple[bool, str]:
        """
        Check if trade would exceed per-symbol exposure limit.

        Multiple strategies CAN trade the same symbol - this just limits
        total exposure to prevent over-concentration.

        Args:
            symbol: Stock symbol
            total_capital: Total portfolio capital
            current_symbol_exposure: Current exposure to this symbol
            trade_value: Value of proposed trade

        Returns:
            (allowed: bool, reason: str)
        """
        max_exposure = total_capital * self.config.max_symbol_exposure_pct
        new_exposure = current_symbol_exposure + trade_value

        if new_exposure > max_exposure:
            exposure_pct = new_exposure / total_capital * 100
            return False, f"Symbol {symbol} exposure limit ({self.config.max_symbol_exposure_pct:.0%}) would be exceeded (would be: {exposure_pct:.1f}%)"

        return True, "OK"

    def check_daily_loss_limit(
        self,
        total_capital: float,
        daily_pnl: float,
    ) -> Tuple[bool, str]:
        """
        Check if daily loss limit has been exceeded.

        Args:
            total_capital: Total portfolio capital
            daily_pnl: Today's P&L

        Returns:
            (within_limit: bool, reason: str)
        """
        if daily_pnl < 0:
            loss_pct = abs(daily_pnl) / total_capital
            if loss_pct >= self.config.max_daily_loss_pct:
                self.daily_start_loss_limit_hit = True
                return False, f"Daily loss limit ({self.config.max_daily_loss_pct:.0%}) exceeded"

        return True, "OK"

    def can_trade(
        self,
        strategy_id: int,
        strategy_name: str,
        symbol: str,
        trade_value: float,
        # Portfolio state
        total_capital: float,
        cash_available: float,
        # Global state
        current_total_positions: int,
        current_total_capital_used: float,
        # Strategy state
        strategy_max_positions: int,
        strategy_allocation_pct: float,
        current_strategy_positions: int,
        current_strategy_capital_used: float,
        # Symbol state
        current_symbol_exposure: float = 0.0,
        # Daily P&L
        daily_pnl: float = 0.0,
    ) -> Tuple[bool, str]:
        """
        Comprehensive check if a trade is allowed.

        This is the main entry point for risk checks. It validates:
        1. Strategy-specific limits (positions, capital)
        2. Global limits (total positions, total capital)
        3. Symbol exposure limits
        4. Daily loss limits
        5. Cash availability

        Note: Multiple strategies CAN trade the same symbol - this is intentional
        to allow signal validation across strategies.

        Args:
            strategy_id: Strategy ID
            strategy_name: Strategy name
            symbol: Stock symbol
            trade_value: Value of proposed trade
            total_capital: Total portfolio capital
            cash_available: Available cash
            current_total_positions: Current total positions
            current_total_capital_used: Current capital used globally
            strategy_max_positions: Max positions for this strategy
            strategy_allocation_pct: Capital allocation percentage
            current_strategy_positions: Current positions for this strategy
            current_strategy_capital_used: Current capital used by this strategy
            current_symbol_exposure: Current exposure to this symbol
            daily_pnl: Today's P&L

        Returns:
            (allowed: bool, reason: str)
        """
        # Check cash availability
        if trade_value > cash_available:
            return False, f"Insufficient cash (need ₹{trade_value:,.0f}, have ₹{cash_available:,.0f})"

        # Check daily loss limit
        within_limit, reason = self.check_daily_loss_limit(total_capital, daily_pnl)
        if not within_limit:
            return False, reason

        # Check if daily loss limit already hit
        if self.daily_start_loss_limit_hit:
            return False, "Daily loss limit reached - trading halted"

        # Calculate allocated capital for this strategy
        allocated_capital = total_capital * strategy_allocation_pct

        # Check strategy limits
        allowed, reason = self.check_strategy_limits(
            strategy_id=strategy_id,
            strategy_name=strategy_name,
            strategy_max_positions=strategy_max_positions,
            strategy_allocation_pct=strategy_allocation_pct,
            current_strategy_positions=current_strategy_positions,
            current_strategy_capital_used=current_strategy_capital_used,
            allocated_capital=allocated_capital,
            trade_value=trade_value,
        )
        if not allowed:
            return False, reason

        # Check global limits
        allowed, reason = self.check_global_limits(
            total_capital=total_capital,
            current_total_positions=current_total_positions,
            current_total_capital_used=current_total_capital_used,
            trade_value=trade_value,
        )
        if not allowed:
            return False, reason

        # Check symbol exposure
        allowed, reason = self.check_symbol_exposure(
            symbol=symbol,
            total_capital=total_capital,
            current_symbol_exposure=current_symbol_exposure,
            trade_value=trade_value,
        )
        if not allowed:
            return False, reason

        return True, "OK"

    def validate_trade(
        self,
        strategy_id: int,
        strategy_name: str,
        symbol: str,
        entry_price: float,
        stop_loss: float,
        take_profit: float,
        side: str,
        # Portfolio state
        total_capital: float,
        cash_available: float,
        # Global state
        current_total_positions: int,
        current_total_capital_used: float,
        # Strategy state
        strategy_max_positions: int,
        strategy_allocation_pct: float,
        current_strategy_positions: int,
        current_strategy_capital_used: float,
        # Symbol state
        current_symbol_exposure: float = 0.0,
        # Daily P&L
        daily_pnl: float = 0.0,
        # Strategy risk params
        risk_per_trade_pct: float = 0.01,
        max_capital_per_trade_pct: float = 0.10,
        min_trade_value: float = 5000,
        max_trade_value: float = 100000,
        min_rr_ratio: float = 2.0,
    ) -> dict:
        """
        Validate a trade request with full risk checks and position sizing.

        Args:
            strategy_id: Strategy ID
            strategy_name: Strategy name
            symbol: Stock symbol
            entry_price: Entry price
            stop_loss: Stop loss price
            take_profit: Take profit price
            side: 'BUY' or 'SELL'
            total_capital: Total portfolio capital
            cash_available: Available cash
            current_total_positions: Current total positions
            current_total_capital_used: Current capital used globally
            strategy_max_positions: Max positions for this strategy
            strategy_allocation_pct: Capital allocation percentage
            current_strategy_positions: Current positions for this strategy
            current_strategy_capital_used: Current capital used by this strategy
            current_symbol_exposure: Current exposure to this symbol
            daily_pnl: Today's P&L
            risk_per_trade_pct: Risk per trade as % of capital
            max_capital_per_trade_pct: Max capital per trade as %
            min_trade_value: Minimum trade value
            max_trade_value: Maximum trade value

        Returns:
            Dict with validation result and calculated values
        """
        result = {
            'valid': False,
            'shares': 0,
            'trade_value': 0,
            'risk_amount': 0,
            'risk_pct': 0,
            'reward_amount': 0,
            'reward_pct': 0,
            'rr_ratio': 0,
            'reason': '',
        }

        # Calculate risk/reward
        if side == "BUY":
            risk = abs(entry_price - stop_loss)
            reward = abs(take_profit - entry_price)
        else:
            risk = abs(stop_loss - entry_price)
            reward = abs(entry_price - take_profit)

        if entry_price <= 0:
            result['reason'] = "Invalid entry price"
            return result

        risk_pct = risk / entry_price * 100
        reward_pct = reward / entry_price * 100
        rr_ratio = reward / risk if risk > 0 else 0

        result['risk_pct'] = round(risk_pct, 2)
        result['reward_pct'] = round(reward_pct, 2)
        result['rr_ratio'] = round(rr_ratio, 2)

        # Check risk/reward ratio (use rounded value to avoid float precision rejections)
        if result['rr_ratio'] < min_rr_ratio:
            result['reason'] = f"Risk/reward ratio ({rr_ratio:.1f}) too low. Minimum 1:{min_rr_ratio:.1f} required."
            return result

        # Calculate position size using strategy's allocated capital
        allocated_capital = total_capital * strategy_allocation_pct

        # Method 1: Risk-based sizing (based on allocated capital)
        max_risk = allocated_capital * risk_per_trade_pct
        shares_by_risk = int(max_risk / risk) if risk > 0 else 0

        # Method 2: Max capital allocation (based on allocated capital)
        max_capital = allocated_capital * max_capital_per_trade_pct
        shares_by_capital = int(max_capital / entry_price)

        # Take the smaller
        shares = min(shares_by_risk, shares_by_capital)

        # Check min/max trade value
        trade_value = shares * entry_price
        if trade_value < min_trade_value:
            shares = int(min_trade_value / entry_price)
            trade_value = shares * entry_price
            if risk > 0 and shares * risk > max_risk:
                result['reason'] = "Min trade value exceeds risk limit"
                return result
        elif trade_value > max_trade_value:
            shares = int(max_trade_value / entry_price)
            trade_value = shares * entry_price

        if shares <= 0:
            result['reason'] = "Insufficient capital for minimum trade size"
            return result

        result['shares'] = shares
        result['trade_value'] = round(trade_value, 2)
        result['risk_amount'] = round(shares * risk, 2)


        # Now check if we can trade
        allowed, reason = self.can_trade(
            strategy_id=strategy_id,
            strategy_name=strategy_name,
            symbol=symbol,
            trade_value=trade_value,
            total_capital=total_capital,
            cash_available=cash_available,
            current_total_positions=current_total_positions,
            current_total_capital_used=current_total_capital_used,
            strategy_max_positions=strategy_max_positions,
            strategy_allocation_pct=strategy_allocation_pct,
            current_strategy_positions=current_strategy_positions,
            current_strategy_capital_used=current_strategy_capital_used,
            current_symbol_exposure=current_symbol_exposure,
            daily_pnl=daily_pnl,
        )

        if not allowed:
            result['reason'] = reason
            return result

        result['valid'] = True
        result['reason'] = "Trade validated successfully"
        return result

    def update_symbol_exposure(self, symbol: str, exposure: float):
        """Update tracked exposure for a symbol."""
        self._symbol_exposure[symbol] = exposure

    def reset_daily(self):
        """Reset daily tracking."""
        self.daily_pnl = 0.0
        self.daily_start_loss_limit_hit = False

    def get_config(self) -> dict:
        """Get current configuration."""
        return {
            'max_total_positions': self.config.max_total_positions,
            'max_total_capital': f"{self.config.max_total_capital_pct:.0%}",
            'max_symbol_exposure': f"{self.config.max_symbol_exposure_pct:.0%}",
            'max_daily_loss': f"{self.config.max_daily_loss_pct:.0%}",
        }


if __name__ == '__main__':
    # Demo
    rm = GlobalRiskManager(
        max_total_positions=10,
        max_total_capital_pct=0.80,
        max_symbol_exposure_pct=0.20,
    )

    print("Global Risk Configuration:")
    for k, v in rm.get_config().items():
        print(f"  {k}: {v}")

    # Test validation
    result = rm.validate_trade(
        strategy_id=1,
        strategy_name="ORB Conservative",
        symbol="RELIANCE",
        entry_price=2500,
        stop_loss=2400,
        take_profit=2800,
        side="BUY",
        total_capital=1_000_000,
        cash_available=800_000,
        current_total_positions=3,
        current_total_capital_used=300_000,
        strategy_max_positions=3,
        strategy_allocation_pct=0.40,
        current_strategy_positions=1,
        current_strategy_capital_used=100_000,
        current_symbol_exposure=0,
        daily_pnl=0,
    )

    print(f"\nTrade Validation:")
    print(f"  Valid: {result['valid']}")
    print(f"  Reason: {result['reason']}")
    print(f"  Shares: {result['shares']}")
    print(f"  Trade Value: ₹{result['trade_value']:,.0f}")
    print(f"  R:R Ratio: 1:{result['rr_ratio']:.1f}")
