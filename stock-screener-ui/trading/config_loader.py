"""
Config Loader - Load strategy configurations from database.

This module provides a centralized way to access strategy parameters
stored in the database.
"""

from typing import Optional, List
from dataclasses import dataclass, field
import logging

logger = logging.getLogger(__name__)


@dataclass
class StrategyConfigData:
    """Dataclass for strategy config with defaults (fallback when DB unavailable)."""
    # Identity
    id: int = 0
    name: str = "orb_default"
    strategy_type: str = "ORB"
    parent_id: Optional[int] = None
    is_template: bool = False
    is_active: bool = True
    is_default: bool = True
    description: str = ""

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

    # 52W Chaser Parameters
    entry_threshold_pct: float = 3.0
    enable_trailing_stop: bool = False
    trailing_stop_pct: float = 3.0
    trailing_activation_pct: float = 2.0
    max_holding_days: int = 30
    cooldown_days: int = 30
    enable_filters: bool = False

    # EMA Crossover Parameters
    ema_fast_period: int = 9
    ema_slow_period: int = 21

    # S/R Breakout Parameters
    pivot_type: str = "classic"
    breakout_buffer_pct: float = 0.3

    enable_shorts: bool = False
    eod_exit_hour: int = 14
    eod_exit_minute: int = 45
    min_rr_ratio: float = 2.0

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
            id=model.id,
            name=model.name,
            strategy_type=model.strategy_type,
            parent_id=model.parent_id,
            is_template=model.is_template,
            is_active=model.is_active,
            is_default=model.is_default,
            description=model.description or "",
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
            entry_threshold_pct=model.entry_threshold_pct,
            enable_trailing_stop=model.enable_trailing_stop,
            trailing_stop_pct=model.trailing_stop_pct,
            trailing_activation_pct=model.trailing_activation_pct,
            max_holding_days=model.max_holding_days,
            cooldown_days=model.cooldown_days,
            enable_filters=model.enable_filters,
            pivot_type=model.pivot_type,
            breakout_buffer_pct=model.breakout_buffer_pct,
            enable_shorts=model.enable_shorts,
            eod_exit_hour=model.eod_exit_hour,
            eod_exit_minute=model.eod_exit_minute,
            min_rr_ratio=model.min_rr_ratio,
            ema_fast_period=model.ema_fast_period,
            ema_slow_period=model.ema_slow_period,
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
            "id": self.id,
            "name": self.name,
            "strategy_type": self.strategy_type,
            "parent_id": self.parent_id,
            "is_template": self.is_template,
            "is_active": self.is_active,
            "is_default": self.is_default,
            "description": self.description,
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
            "entry_threshold_pct": self.entry_threshold_pct,
            "enable_trailing_stop": self.enable_trailing_stop,
            "trailing_stop_pct": self.trailing_stop_pct,
            "trailing_activation_pct": self.trailing_activation_pct,
            "max_holding_days": self.max_holding_days,
            "cooldown_days": self.cooldown_days,
            "enable_filters": self.enable_filters,
            "pivot_type": self.pivot_type,
            "breakout_buffer_pct": self.breakout_buffer_pct,
            "enable_shorts": self.enable_shorts,
            "eod_exit_hour": self.eod_exit_hour,
            "eod_exit_minute": self.eod_exit_minute,
            "min_rr_ratio": self.min_rr_ratio,
            "ema_fast_period": self.ema_fast_period,
            "ema_slow_period": self.ema_slow_period,
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
                        StrategyConfig.is_active == True,
                        StrategyConfig.is_template == False,
                    ).first()

            if config:
                return StrategyConfigData.from_db_model(config)

    except Exception as e:
        logger.warning(f"Could not load config from database: {e}")

    # Return defaults if DB unavailable or no config found
    return StrategyConfigData()


def get_strategy_by_id(strategy_id: int) -> Optional[StrategyConfigData]:
    """
    Load strategy configuration by ID.

    Args:
        strategy_id: The database ID of the strategy.

    Returns:
        StrategyConfigData or None if not found.
    """
    try:
        from db.database import SessionLocal
        from db.models import StrategyConfig

        with SessionLocal() as db:
            config = db.query(StrategyConfig).filter(
                StrategyConfig.id == strategy_id
            ).first()

            if config:
                return StrategyConfigData.from_db_model(config)

    except Exception as e:
        logger.warning(f"Could not load config by ID: {e}")

    return None


def get_all_strategies(include_templates: bool = False) -> List[StrategyConfigData]:
    """
    Get all strategy configurations.

    Args:
        include_templates: If True, include template strategies.

    Returns:
        List of StrategyConfigData.
    """
    try:
        from db.database import SessionLocal
        from db.models import StrategyConfig

        with SessionLocal() as db:
            query = db.query(StrategyConfig).filter(
                StrategyConfig.is_active == True
            )

            if not include_templates:
                query = query.filter(StrategyConfig.is_template == False)

            configs = query.order_by(StrategyConfig.strategy_type, StrategyConfig.name).all()

            return [StrategyConfigData.from_db_model(c) for c in configs]

    except Exception as e:
        logger.warning(f"Could not load all strategies: {e}")
        return []


def get_template_strategies() -> List[StrategyConfigData]:
    """
    Get all template strategies.

    Returns:
        List of template StrategyConfigData.
    """
    try:
        from db.database import SessionLocal
        from db.models import StrategyConfig

        with SessionLocal() as db:
            configs = db.query(StrategyConfig).filter(
                StrategyConfig.is_template == True,
                StrategyConfig.is_active == True
            ).order_by(StrategyConfig.name).all()

            return [StrategyConfigData.from_db_model(c) for c in configs]

    except Exception as e:
        logger.warning(f"Could not load templates: {e}")
        return []


def get_strategy_variations(parent_id: int) -> List[StrategyConfigData]:
    """
    Get all variations of a parent strategy.

    Args:
        parent_id: The ID of the parent/template strategy.

    Returns:
        List of child StrategyConfigData.
    """
    try:
        from db.database import SessionLocal
        from db.models import StrategyConfig

        with SessionLocal() as db:
            configs = db.query(StrategyConfig).filter(
                StrategyConfig.parent_id == parent_id,
                StrategyConfig.is_active == True
            ).order_by(StrategyConfig.name).all()

            return [StrategyConfigData.from_db_model(c) for c in configs]

    except Exception as e:
        logger.warning(f"Could not load variations: {e}")
        return []


def get_strategies_by_type(strategy_type: str) -> List[StrategyConfigData]:
    """
    Get all strategies of a specific type.

    Args:
        strategy_type: The strategy type (e.g., "ORB", "EMA_CROSS").

    Returns:
        List of StrategyConfigData.
    """
    try:
        from db.database import SessionLocal
        from db.models import StrategyConfig

        with SessionLocal() as db:
            configs = db.query(StrategyConfig).filter(
                StrategyConfig.strategy_type == strategy_type,
                StrategyConfig.is_active == True,
                StrategyConfig.is_template == False,
            ).order_by(StrategyConfig.name).all()

            return [StrategyConfigData.from_db_model(c) for c in configs]

    except Exception as e:
        logger.warning(f"Could not load strategies by type: {e}")
        return []


if __name__ == "__main__":
    # Demo
    print("=== Template Strategies ===")
    templates = get_template_strategies()
    for t in templates:
        print(f"  {t.id}: {t.name} ({t.strategy_type})")

    print("\n=== All Strategies (excluding templates) ===")
    strategies = get_all_strategies()
    for s in strategies:
        print(f"  {s.id}: {s.name} ({s.strategy_type}) - parent: {s.parent_id}")

    print("\n=== ORB Variations ===")
    orb_template = next((t for t in templates if t.strategy_type == "ORB"), None)
    if orb_template:
        variations = get_strategy_variations(orb_template.id)
        for v in variations:
            print(f"  {v.id}: {v.name} - SL: {v.sl_pct}%, TP: {v.tp_pct}%")

