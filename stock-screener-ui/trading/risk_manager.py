"""
Risk Manager - Position sizing and risk controls for trading.

Implements risk management rules:
- Max concurrent positions
- Max capital per trade
- Daily loss limit
- Total exposure limit
"""

from typing import Dict, Optional
from dataclasses import dataclass

# Import config loader
try:
    from trading.config_loader import get_strategy_config
    _config_available = True
except ImportError:
    _config_available = False


@dataclass
class RiskConfig:
    """Risk management configuration."""
    max_positions: int = 5              # Max concurrent positions
    max_capital_per_trade: float = 0.10  # 10% of capital per trade
    max_daily_loss: float = 0.02         # 2% daily loss limit
    max_total_exposure: float = 0.50      # 50% total capital usage
    risk_per_trade: float = 0.01          # 1% risk per trade (based on SL)
    min_trade_value: float = 5000         # Minimum ₹5000 per trade
    max_trade_value: float = 100000       # Maximum ₹100,000 per trade


class RiskManager:
    """
    Risk management for trading.

    Features:
    - Position sizing based on risk
    - Exposure limits
    - Daily loss limits
    - Trade validation
    """

    def __init__(self, config: Optional[RiskConfig] = None, config_name: str = None):
        """
        Initialize risk manager.

        Args:
            config: RiskConfig to use (overrides database config)
            config_name: Name of config to load from database
        """
        if config is not None:
            self.config = config
        elif _config_available:
            # Load from database config
            db_config = get_strategy_config(config_name)
            self.config = RiskConfig(
                max_positions=db_config.max_positions,
                max_capital_per_trade=db_config.max_capital_per_trade_pct,
                max_daily_loss=db_config.max_daily_loss_pct,
                max_total_exposure=db_config.max_total_exposure_pct,
                risk_per_trade=db_config.risk_per_trade_pct,
                min_trade_value=db_config.min_trade_value,
                max_trade_value=db_config.max_trade_value,
            )
        else:
            # Fall back to defaults
            self.config = RiskConfig()

        self.daily_pnl = 0.0
        self.daily_start_loss_limit_hit = False

    def calculate_position_size(
        self,
        capital: float,
        entry_price: float,
        stop_loss: float,
    ) -> int:
        """
        Calculate position size based on risk.

        Uses the smaller of:
        1. Risk-based sizing (1% of capital at risk)
        2. Max capital per trade (10% of capital)

        Args:
            capital: Total available capital
            entry_price: Entry price
            stop_loss: Stop loss price

        Returns:
            Number of shares to trade
        """
        if entry_price <= 0 or stop_loss <= 0:
            return 0

        risk_per_share = abs(entry_price - stop_loss)

        if risk_per_share == 0:
            return 0

        # Method 1: Risk-based sizing
        max_risk = capital * self.config.risk_per_trade
        shares_by_risk = int(max_risk / risk_per_share)

        # Method 2: Max capital allocation
        max_capital = capital * self.config.max_capital_per_trade
        shares_by_capital = int(max_capital / entry_price)

        # Take the smaller
        shares = min(shares_by_risk, shares_by_capital)

        if shares <= 0:
            return 0

        # Check min/max trade value
        trade_value = shares * entry_price
        if trade_value < self.config.min_trade_value:
            shares = int(self.config.min_trade_value / entry_price)
            if shares * risk_per_share > max_risk:
                return 0
            if shares * entry_price > max_capital or shares * entry_price > capital:
                return 0
        elif trade_value > self.config.max_trade_value:
            shares = int(self.config.max_trade_value / entry_price)

        return shares

    def can_open_position(
        self,
        capital: float,
        cash: float,
        current_positions: int,
        current_exposure: float,
        trade_value: float,
    ) -> tuple:
        """
        Check if opening a new position is allowed.

        Returns:
            (allowed: bool, reason: str)
        """
        # Check max positions
        if current_positions >= self.config.max_positions:
            return False, f"Max positions ({self.config.max_positions}) reached"

        # Check total exposure
        new_exposure = current_exposure + trade_value
        exposure_pct = new_exposure / capital
        if exposure_pct > self.config.max_total_exposure:
            return False, f"Total exposure ({exposure_pct:.1%}) would exceed limit ({self.config.max_total_exposure:.0%})"

        # Check cash available
        if trade_value > cash:
            return False, f"Insufficient cash (need ₹{trade_value:,.0f}, have ₹{cash:,.0f})"

        # Check daily loss limit
        if self.daily_start_loss_limit_hit:
            return False, "Daily loss limit reached - trading halted"

        return True, "OK"

    def check_daily_loss_limit(self, daily_pnl: float, capital: float) -> bool:
        """
        Check if daily loss limit has been exceeded.

        Args:
            daily_pnl: Today's P&L
            capital: Total capital

        Returns:
            True if within limit, False if exceeded
        """
        loss_pct = abs(min(0, daily_pnl)) / capital

        if loss_pct >= self.config.max_daily_loss:
            self.daily_start_loss_limit_hit = True
            return False

        return True

    def validate_trade(
        self,
        capital: float,
        cash: float,
        current_positions: int,
        current_exposure: float,
        entry_price: float,
        stop_loss: float,
        take_profit: float,
        side: str = "BUY",
        min_rr_ratio: float = 2.0,
    ) -> dict:
        """
        Validate a trade request.

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

        risk_pct = risk / entry_price * 100
        reward_pct = reward / entry_price * 100
        rr_ratio = reward / risk if risk > 0 else 0

        result['risk_pct'] = round(risk_pct, 2)
        result['reward_pct'] = round(reward_pct, 2)
        result['rr_ratio'] = round(rr_ratio, 2)

        # Check risk/reward ratio
        if rr_ratio < min_rr_ratio:
            result['reason'] = f"Risk/reward ratio ({rr_ratio:.1f}) too low. Minimum 1:{min_rr_ratio:.1f} required."
            return result

        # Calculate position size
        shares = self.calculate_position_size(capital, entry_price, stop_loss)
        trade_value = shares * entry_price
        risk_amount = shares * risk

        result['shares'] = shares
        result['trade_value'] = round(trade_value, 2)
        result['risk_amount'] = round(risk_amount, 2)

        if shares <= 0:
            result['reason'] = "Insufficient capital for minimum trade size"
            return result

        # Check if can open position
        can_open, reason = self.can_open_position(
            capital=capital,
            cash=cash,
            current_positions=current_positions,
            current_exposure=current_exposure,
            trade_value=trade_value,
        )

        if not can_open:
            result['reason'] = reason
            return result

        result['valid'] = True
        result['reason'] = "Trade validated successfully"
        return result

    def reset_daily(self):
        """Reset daily tracking."""
        self.daily_pnl = 0.0
        self.daily_start_loss_limit_hit = False

    def get_config(self) -> dict:
        """Get current configuration."""
        return {
            'max_positions': self.config.max_positions,
            'max_capital_per_trade': f"{self.config.max_capital_per_trade:.0%}",
            'max_daily_loss': f"{self.config.max_daily_loss:.0%}",
            'max_total_exposure': f"{self.config.max_total_exposure:.0%}",
            'risk_per_trade': f"{self.config.risk_per_trade:.0%}",
            'min_trade_value': f"₹{self.config.min_trade_value:,.0f}",
            'max_trade_value': f"₹{self.config.max_trade_value:,.0f}",
        }


# Singleton instance
_risk_manager: Optional[RiskManager] = None


def get_risk_manager(config_name: str = None) -> RiskManager:
    """
    Get singleton risk manager instance.

    Args:
        config_name: Name of config to load from database (only used on first call)
    """
    global _risk_manager
    if _risk_manager is None:
        _risk_manager = RiskManager(config_name=config_name)
    elif config_name is not None:
        import logging
        logging.getLogger(__name__).warning(
            "get_risk_manager called with config_name=%s but singleton already initialized", config_name
        )
    return _risk_manager


def reset_risk_manager(config_name: str = None) -> RiskManager:
    """
    Reset risk manager with new config.

    Args:
        config_name: Name of config to load from database
    """
    global _risk_manager
    _risk_manager = RiskManager(config_name=config_name)
    return _risk_manager


if __name__ == '__main__':
    # Demo
    rm = RiskManager()

    print("Risk Configuration:")
    for k, v in rm.get_config().items():
        print(f"  {k}: {v}")

    # Calculate position size
    capital = 1_000_000
    entry = 3500
    sl = 3360  # 4% risk

    shares = rm.calculate_position_size(capital, entry, sl)
    print(f"\nPosition Size Calculation:")
    print(f"  Capital: ₹{capital:,}")
    print(f"  Entry: ₹{entry}")
    print(f"  Stop Loss: ₹{sl} ({(entry-sl)/entry*100:.1f}% risk)")
    print(f"  Shares: {shares}")
    print(f"  Trade Value: ₹{shares * entry:,}")
    print(f"  Risk Amount: ₹{shares * (entry - sl):,}")

    # Validate trade
    validation = rm.validate_trade(
        capital=capital,
        cash=500_000,
        current_positions=2,
        current_exposure=200_000,
        entry_price=3500,
        stop_loss=3360,
        take_profit=3920,  # 1:3 ratio
    )

    print(f"\nTrade Validation:")
    print(f"  Valid: {validation['valid']}")
    print(f"  Reason: {validation['reason']}")
    print(f"  Shares: {validation['shares']}")
    print(f"  Risk: {validation['risk_pct']}%")
    print(f"  Reward: {validation['reward_pct']}%")
    print(f"  R:R Ratio: 1:{validation['rr_ratio']:.1f}")
