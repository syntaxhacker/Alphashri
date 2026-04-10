import uuid
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Table, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from .base import Base


bot_strategies = Table(
    'bot_strategies',
    Base.metadata,
    Column('bot_id', Integer, ForeignKey('bot_configs.id'), primary_key=True),
    Column('strategy_id', Integer, ForeignKey('strategy_configs.id'), primary_key=True),
    Column('max_positions', Integer, default=3),
    Column('capital_allocation_pct', Float, default=0.20),
)


class StrategyConfig(Base):
    """Strategy configuration parameters for paper trading.

    Supports strategy variations through parent-child relationships.
    Templates are predefined strategies (is_template=True).
    Variations are user-created children of templates.
    """
    __tablename__ = "strategy_configs"

    id = Column(Integer, primary_key=True)
    uuid = Column(String(36), unique=True, index=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, unique=True, nullable=False)
    strategy_type = Column(String, nullable=False)

    parent_id = Column(Integer, ForeignKey("strategy_configs.id"), nullable=True)
    is_template = Column(Boolean, default=False)

    is_active = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)

    description = Column(String, nullable=True)

    or_minutes = Column(Integer, default=45)
    sl_pct = Column(Float, default=0.4)
    tp_pct = Column(Float, default=1.2)
    min_or_range_pct = Column(Float, default=0.5)
    max_or_range_pct = Column(Float, default=3.0)

    max_positions = Column(Integer, default=5)
    max_capital_per_trade_pct = Column(Float, default=0.10)
    max_daily_loss_pct = Column(Float, default=0.02)
    max_total_exposure_pct = Column(Float, default=0.50)
    risk_per_trade_pct = Column(Float, default=0.01)
    min_trade_value = Column(Float, default=5000)
    max_trade_value = Column(Float, default=100000)

    cooldown_minutes = Column(Integer, default=30)
    max_distance_from_or_pct = Column(Float, default=1.5)

    entry_threshold_pct = Column(Float, default=3.0)
    enable_trailing_stop = Column(Boolean, default=False)
    trailing_stop_pct = Column(Float, default=3.0)
    trailing_activation_pct = Column(Float, default=2.0)
    max_holding_days = Column(Integer, default=30)
    cooldown_days = Column(Integer, default=30)
    enable_filters = Column(Boolean, default=False)

    ema_fast_period = Column(Integer, default=9)
    ema_slow_period = Column(Integer, default=21)

    pivot_type = Column(String, default='classic')
    breakout_buffer_pct = Column(Float, default=0.3)

    enable_shorts = Column(Boolean, default=False)
    eod_exit_hour = Column(Integer, default=14)
    eod_exit_minute = Column(Integer, default=45)
    min_rr_ratio = Column(Float, default=2.0)

    brokerage_pct = Column(Float, default=0.0003)
    min_brokerage = Column(Float, default=20)
    stt_pct = Column(Float, default=0.00025)
    exchange_pct = Column(Float, default=0.0000297)
    sebi_pct = Column(Float, default=0.000001)
    stamp_pct = Column(Float, default=0.00003)
    gst_pct = Column(Float, default=0.18)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    parent = relationship("StrategyConfig", remote_side=[id], backref="variations")
    bots = relationship("BotConfig", secondary=bot_strategies, back_populates="strategies")

    def __repr__(self):
        return f"<StrategyConfig(id={self.id}, uuid='{self.uuid}', name='{self.name}', type='{self.strategy_type}')>"

    def to_dict(self) -> dict:
        return {
            "id": self.uuid,
            "internal_id": self.id,
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
            "ema_fast_period": self.ema_fast_period,
            "ema_slow_period": self.ema_slow_period,
            "pivot_type": self.pivot_type,
            "breakout_buffer_pct": self.breakout_buffer_pct,
            "enable_shorts": self.enable_shorts,
            "eod_exit_hour": self.eod_exit_hour,
            "eod_exit_minute": self.eod_exit_minute,
            "min_rr_ratio": self.min_rr_ratio,
            "brokerage_pct": self.brokerage_pct,
            "min_brokerage": self.min_brokerage,
            "stt_pct": self.stt_pct,
            "exchange_pct": self.exchange_pct,
            "sebi_pct": self.sebi_pct,
            "stamp_pct": self.stamp_pct,
            "gst_pct": self.gst_pct,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class BotConfig(Base):
    """Configuration for a trading bot instance.

    A bot can run multiple strategies simultaneously.
    Each strategy has its own allocation within the bot.
    Bots are user-specific for multi-tenancy.
    """
    __tablename__ = "bot_configs"

    id = Column(Integer, primary_key=True)
    uuid = Column(String(36), unique=True, index=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)

    max_total_positions = Column(Integer, default=10)
    max_total_capital_pct = Column(Float, default=0.80)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    strategies = relationship("StrategyConfig", secondary=bot_strategies, back_populates="bots")
    user = relationship("User", backref="bots")

    __table_args__ = (
        UniqueConstraint('user_id', 'name', name='uq_bot_name_per_user'),
    )

    def __repr__(self):
        return f"<BotConfig(id={self.id}, uuid='{self.uuid}', name='{self.name}', user_id={self.user_id})>"

    def to_dict(self) -> dict:
        return {
            "id": self.uuid,
            "internal_id": self.id,
            "user_id": self.user_id,
            "name": self.name,
            "is_active": self.is_active,
            "max_total_positions": self.max_total_positions,
            "max_total_capital_pct": self.max_total_capital_pct,
            "strategies": [
                {
                    "id": s.uuid,
                    "name": s.name,
                    "strategy_type": s.strategy_type,
                }
                for s in self.strategies
            ],
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class BacktestResult(Base):
    """Stored results of a backtest run.

    Allows users to view history of backtests and compare results.
    """
    __tablename__ = "backtest_results"

    id = Column(Integer, primary_key=True)
    uuid = Column(String(36), unique=True, index=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    strategy_id = Column(String, nullable=False)
    strategy_name = Column(String, nullable=False)
    variation_id = Column(String, nullable=True)

    parameters = Column(String, nullable=False)
    symbols = Column(String, nullable=False)

    total_pnl = Column(Float, default=0.0)
    total_pnl_pct = Column(Float, default=0.0)
    win_rate = Column(Float, default=0.0)
    total_trades = Column(Integer, default=0)
    sharpe_ratio = Column(Float, nullable=True)
    max_drawdown_pct = Column(Float, nullable=True)

    results_json = Column(String, nullable=False)
    totals_json = Column(String, nullable=False)
    chart_data_json = Column(String, nullable=True)

    created_at = Column(DateTime, server_default=func.now())

    user = relationship("User", backref="backtest_results")

    def __repr__(self):
        return f"<BacktestResult(id={self.id}, uuid='{self.uuid}', strategy='{self.strategy_id}', pnl={self.total_pnl})>"

    def to_dict(self, include_details=False) -> dict:
        import json
        data = {
            "id": self.uuid,
            "user_id": self.user_id,
            "strategy_id": self.strategy_id,
            "strategy_name": self.strategy_name,
            "variation_id": self.variation_id,
            "parameters": json.loads(self.parameters),
            "symbols": json.loads(self.symbols),
            "metrics": {
                "total_pnl": self.total_pnl,
                "total_pnl_pct": self.total_pnl_pct,
                "win_rate": self.win_rate,
                "total_trades": self.total_trades,
                "sharpe_ratio": self.sharpe_ratio,
                "max_drawdown_pct": self.max_drawdown_pct,
            },
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

        if include_details:
            data["results"] = json.loads(self.results_json)
            data["totals"] = json.loads(self.totals_json)
            if self.chart_data_json:
                data["chart_data"] = json.loads(self.chart_data_json)

        return data
