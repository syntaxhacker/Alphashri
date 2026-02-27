"""
Config Loader - Load strategy configurations from database.

This module provides a centralized way to access strategy parameters
stored in the database.
"""

from typing import Optional
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)


@dataclass
class StrategyConfigData:
    """Dataclass for strategy config with defaults (fallback when DB unavailable)."""
    # Identity
    name: str = "orb_default"
    strategy_type: str = "ORB"
    is_active: bool = True
    is_default: bool = True

    # ORB Strategy Parameters
    or_minutes: int = 45
    sl_pct: float = 0.4
    tp_pct: float = 1.2
    min_or_range_pct: float = 0.5
    max_or_range_pct: float = 3.0

    # Risk Management Parameters
    max_positions: int = 5
    max_capital_per_trade_pct: float = 0.10
    max_daily_loss_pct: float = 0.02
    max_total_exposure_pct: float = 0.50
    risk_per_trade_pct: float = 0.01
    min_trade_value: float = 5000
    max_trade_value: float = 100000

    # Trading Runner Parameters
    cooldown_minutes: int = 30
    max_distance_from_or_pct: float = 1.5

    # Cost Parameters
    brokerage_pct: float = 0.0003
    min_brokerage: float = 20
    stt_pct: float = 0.00025
    exchange_pct: float = 0.0000297
    sebi_pct: float = 0.000001
    stamp_pct: float = 0.00003
    gst_pct: float = 0.18

    @classmethod
    def from_db_model(cls, model) -> "StrategyConfigData":
        """Create from SQLAlchemy model."""
        return cls(
            name=model.name,
            strategy_type=model.strategy_type,
            is_active=model.is_active,
            is_default=model.is_default,
            or_minutes=model.or_minutes,
            sl_pct=model.sl_pct,
            tp_pct=model.tp_pct,
            min_or_range_pct=model.min_or_range_pct,
            max_or_range_pct=model.max_or_range_pct,
            max_positions=model.max_positions,
            max_capital_per_trade_pct=model.max_capital_per_trade_pct,
            max_daily_loss_pct=model.max_daily_loss_pct,
            max_total_exposure_pct=model.max_total_exposure_pct,
            risk_per_trade_pct=model.risk_per_trade_pct,
            min_trade_value=model.min_trade_value,
            max_trade_value=model.max_trade_value,
            cooldown_minutes=model.cooldown_minutes,
            max_distance_from_or_pct=model.max_distance_from_or_pct,
            brokerage_pct=model.brokerage_pct,
            min_brokerage=model.min_brokerage,
            stt_pct=model.stt_pct,
            exchange_pct=model.exchange_pct,
            sebi_pct=model.sebi_pct,
            stamp_pct=model.stamp_pct,
            gst_pct=model.gst_pct,
        )

    def to_dict(self) -> dict:
        """Convert to dictionary."""
        return {
            "name": self.name,
            "strategy_type": self.strategy_type,
            "is_active": self.is_active,
            "is_default": self.is_default,
            "or_minutes": self.or_minutes,
            "sl_pct": self.sl_pct,
            "tp_pct": self.tp_pct,
            "min_or_range_pct": self.min_or_range_pct,
            "max_or_range_pct": self.max_or_range_pct,
            "max_positions": self.max_positions,
            "max_capital_per_trade_pct": self.max_capital_per_trade_pct,
            "max_daily_loss_pct": self.max_daily_loss_pct,
            "max_total_exposure_pct": self.max_total_exposure_pct,
            "risk_per_trade_pct": self.risk_per_trade_pct,
            "min_trade_value": self.min_trade_value,
            "max_trade_value": self.max_trade_value,
            "cooldown_minutes": self.cooldown_minutes,
            "max_distance_from_or_pct": self.max_distance_from_or_pct,
            "brokerage_pct": self.brokerage_pct,
            "min_brokerage": self.min_brokerage,
            "stt_pct": self.stt_pct,
            "exchange_pct": self.exchange_pct,
            "sebi_pct": self.sebi_pct,
            "stamp_pct": self.stamp_pct,
            "gst_pct": self.gst_pct,
        }


def get_strategy_config(name: Optional[str] = None) -> StrategyConfigData:
    """
    Load strategy configuration from database.

    Args:
        name: Config name to load. If None, loads the default config.

    Returns:
        StrategyConfigData with loaded values or defaults if DB unavailable.
    """
    try:
        from db.database import SessionLocal
        from db.models import StrategyConfig

        with SessionLocal() as db:
            if name:
                # Load specific config by name
                config = db.query(StrategyConfig).filter(
                    StrategyConfig.name == name,
                    StrategyConfig.is_active == True
                ).first()
            else:
                # Load default config
                config = db.query(StrategyConfig).filter(
                    StrategyConfig.is_default == True,
                    StrategyConfig.is_active == True
                ).first()

                # Fallback to any active config if no default
                if config is None:
                    config = db.query(StrategyConfig).filter(
                        StrategyConfig.is_active == True
                    ).first()

            if config:
                return StrategyConfigData.from_db_model(config)

    except Exception as e:
        logger.warning(f"Could not load config from database: {e}")

    # Return defaults if DB unavailable or no config found
    return StrategyConfigData()


if __name__ == "__main__":
    # Demo
    config = get_strategy_config()
    print("Default Strategy Configuration:")
    print(f"  OR Minutes: {config.or_minutes}")
    print(f"  SL %: {config.sl_pct}")
    print(f"  TP %: {config.tp_pct}")
    print(f"  Max Positions: {config.max_positions}")
    print(f"  Cooldown Minutes: {config.cooldown_minutes}")
