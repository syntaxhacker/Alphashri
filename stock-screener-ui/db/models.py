"""
Database models for Alphashri
"""

import json
import uuid
from datetime import date
from typing import Optional
from sqlalchemy import Column, Integer, String, Text, DateTime, Float, Boolean, ForeignKey, Table, UniqueConstraint, Index, Date
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base


# Association table for bot-strategy many-to-many relationship
bot_strategies = Table(
    'bot_strategies',
    Base.metadata,
    Column('bot_id', Integer, ForeignKey('bot_configs.id'), primary_key=True),
    Column('strategy_id', Integer, ForeignKey('strategy_configs.id'), primary_key=True),
    Column('max_positions', Integer, default=3),  # Max positions for this strategy in bot
    Column('capital_allocation_pct', Float, default=0.20),  # % of capital for this strategy
)


class User(Base):
    """User model for authentication and user-specific data."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    uuid = Column(String(36), unique=True, index=True, default=lambda: str(uuid.uuid4()))
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    display_name = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    is_active = Column(Boolean, default=True)
    is_admin = Column(Boolean, default=False)

    # Paper trading settings per user
    initial_capital = Column(Float, default=1000000.0)  # 10 Lakhs default

    # Relationship to sessions
    sessions = relationship("UserSession", back_populates="user", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<User(id={self.id}, uuid='{self.uuid}', email='{self.email}', display_name='{self.display_name}')>"


class UserSession(Base):
    """Session model for JWT token management."""
    __tablename__ = "sessions"

    id = Column(String, primary_key=True)  # JWT jti (unique token identifier)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now())
    expires_at = Column(DateTime, nullable=False)
    revoked = Column(Boolean, default=False)

    # Relationship to user
    user = relationship("User", back_populates="sessions")

    def __repr__(self):
        return f"<UserSession(id='{self.id}', user_id={self.user_id}, expires_at='{self.expires_at}')>"


class StrategyConfig(Base):
    """Strategy configuration parameters for paper trading.

    Supports strategy variations through parent-child relationships.
    Templates are predefined strategies (is_template=True).
    Variations are user-created children of templates.
    """
    __tablename__ = "strategy_configs"

    id = Column(Integer, primary_key=True)
    uuid = Column(String(36), unique=True, index=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, unique=True, nullable=False)  # e.g., "orb_default"
    strategy_type = Column(String, nullable=False)  # e.g., "ORB", "EMA_CROSS", "52W_CHASER"

    # Parent-child relationship for variations
    parent_id = Column(Integer, ForeignKey("strategy_configs.id"), nullable=True)
    is_template = Column(Boolean, default=False)  # True for predefined templates

    # Status
    is_active = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)

    # User-facing metadata
    description = Column(String, nullable=True)  # User notes about this variation

    # ORB Strategy Parameters
    or_minutes = Column(Integer, default=45)  # Opening range duration in minutes
    sl_pct = Column(Float, default=0.4)  # Stop loss percentage
    tp_pct = Column(Float, default=1.2)  # Take profit percentage
    min_or_range_pct = Column(Float, default=0.5)  # Minimum OR range % for valid signal
    max_or_range_pct = Column(Float, default=3.0)  # Maximum OR range % for valid signal

    # Risk Management Parameters
    max_positions = Column(Integer, default=5)  # Max concurrent positions
    max_capital_per_trade_pct = Column(Float, default=0.10)  # 10% of capital per trade
    max_daily_loss_pct = Column(Float, default=0.02)  # 2% daily loss limit
    max_total_exposure_pct = Column(Float, default=0.50)  # 50% total capital usage
    risk_per_trade_pct = Column(Float, default=0.01)  # 1% risk per trade
    min_trade_value = Column(Float, default=5000)  # Minimum trade value
    max_trade_value = Column(Float, default=100000)  # Maximum trade value

    # Trading Runner Parameters
    cooldown_minutes = Column(Integer, default=30)  # Cooldown after position closes
    max_distance_from_or_pct = Column(Float, default=1.5)  # Max distance from OR levels

    # 52W Chaser Parameters
    entry_threshold_pct = Column(Float, default=3.0)  # Entry threshold from 52W high
    enable_trailing_stop = Column(Boolean, default=False)  # Enable trailing stop
    trailing_stop_pct = Column(Float, default=3.0)  # Trailing stop percentage
    trailing_activation_pct = Column(Float, default=2.0)  # Trailing activation percentage
    max_holding_days = Column(Integer, default=30)  # Max holding days for swing trades
    cooldown_days = Column(Integer, default=30)  # Cooldown days after exit
    enable_filters = Column(Boolean, default=False)  # Enable trend/momentum filters

    # EMA Crossover Parameters
    ema_fast_period = Column(Integer, default=9)  # Fast EMA period
    ema_slow_period = Column(Integer, default=21)  # Slow EMA period

    # S/R Breakout Parameters
    pivot_type = Column(String, default='classic')  # Pivot type: classic, fibonacci, camarilla
    breakout_buffer_pct = Column(Float, default=0.1)  # Breakout buffer percentage

    # Cost Parameters (brokerage, taxes)
    brokerage_pct = Column(Float, default=0.0003)  # 0.03%
    min_brokerage = Column(Float, default=20)
    stt_pct = Column(Float, default=0.00025)  # 0.025% (sell side)
    exchange_pct = Column(Float, default=0.0000297)
    sebi_pct = Column(Float, default=0.000001)
    stamp_pct = Column(Float, default=0.00003)  # 0.003% (buy side)
    gst_pct = Column(Float, default=0.18)

    # Metadata
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relationships
    parent = relationship("StrategyConfig", remote_side=[id], backref="variations")
    bots = relationship("BotConfig", secondary=bot_strategies, back_populates="strategies")

    def __repr__(self):
        return f"<StrategyConfig(id={self.id}, uuid='{self.uuid}', name='{self.name}', type='{self.strategy_type}')>"

    def to_dict(self) -> dict:
        """Convert config to dictionary for easy access."""
        return {
            # Identity
            "id": self.uuid,  # Expose UUID as id externally
            "internal_id": self.id,  # Keep internal ID for reference
            "name": self.name,
            "strategy_type": self.strategy_type,
            "parent_id": self.parent_id,
            "is_template": self.is_template,
            "is_active": self.is_active,
            "is_default": self.is_default,
            "description": self.description,
            # ORB Parameters
            "or_minutes": self.or_minutes,
            "sl_pct": self.sl_pct,
            "tp_pct": self.tp_pct,
            "min_or_range_pct": self.min_or_range_pct,
            "max_or_range_pct": self.max_or_range_pct,
            # Risk Parameters
            "max_positions": self.max_positions,
            "max_capital_per_trade_pct": self.max_capital_per_trade_pct,
            "max_daily_loss_pct": self.max_daily_loss_pct,
            "max_total_exposure_pct": self.max_total_exposure_pct,
            "risk_per_trade_pct": self.risk_per_trade_pct,
            "min_trade_value": self.min_trade_value,
            "max_trade_value": self.max_trade_value,
            # Runner Parameters
            "cooldown_minutes": self.cooldown_minutes,
            "max_distance_from_or_pct": self.max_distance_from_or_pct,
            # 52W Chaser Parameters
            "entry_threshold_pct": self.entry_threshold_pct,
            "enable_trailing_stop": self.enable_trailing_stop,
            "trailing_stop_pct": self.trailing_stop_pct,
            "trailing_activation_pct": self.trailing_activation_pct,
            "max_holding_days": self.max_holding_days,
            "cooldown_days": self.cooldown_days,
            "enable_filters": self.enable_filters,
            # EMA Crossover Parameters
            "ema_fast_period": self.ema_fast_period,
            "ema_slow_period": self.ema_slow_period,
            # S/R Breakout Parameters
            "pivot_type": self.pivot_type,
            "breakout_buffer_pct": self.breakout_buffer_pct,
            # Cost Parameters
            "brokerage_pct": self.brokerage_pct,
            "min_brokerage": self.min_brokerage,
            "stt_pct": self.stt_pct,
            "exchange_pct": self.exchange_pct,
            "sebi_pct": self.sebi_pct,
            "stamp_pct": self.stamp_pct,
            "gst_pct": self.gst_pct,
            # Metadata
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
            "id": self.uuid,  # Expose UUID as id externally
            "internal_id": self.id,  # Keep internal ID for reference
            "user_id": self.user_id,
            "name": self.name,
            "is_active": self.is_active,
            "max_total_positions": self.max_total_positions,
            "max_total_capital_pct": self.max_total_capital_pct,
            "strategies": [
                {
                    "id": s.uuid,  # Expose strategy UUID
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

    strategy_id = Column(String, nullable=False)  # e.g., "orb"
    strategy_name = Column(String, nullable=False)  # User-friendly name
    variation_id = Column(String, nullable=True)   # ID of the strategy variation used

    # Parameters and configuration
    parameters = Column(String, nullable=False)  # JSON serialized dict
    symbols = Column(String, nullable=False)     # JSON serialized list

    # Summary metrics
    total_pnl = Column(Float, default=0.0)
    total_pnl_pct = Column(Float, default=0.0)
    win_rate = Column(Float, default=0.0)
    total_trades = Column(Integer, default=0)
    sharpe_ratio = Column(Float, nullable=True)
    max_drawdown_pct = Column(Float, nullable=True)

    # Detailed results
    results_json = Column(String, nullable=False)  # JSON serialized detailed results per symbol
    totals_json = Column(String, nullable=False)   # JSON serialized totals
    chart_data_json = Column(String, nullable=True) # JSON serialized chart data (candles, trades, visuals)

    created_at = Column(DateTime, server_default=func.now())

    # Relationship
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


class BrokerConnection(Base):
    """Broker connection tokens for OAuth integrations.

    Stores broker access tokens for trading APIs.
    user_id=NULL indicates a shared token for all users.
    """
    __tablename__ = "broker_connections"

    id = Column(Integer, primary_key=True)
    broker_name = Column(String(50), nullable=False, index=True)
    access_token = Column(Text, nullable=False)
    token_timestamp = Column(DateTime, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    user = relationship("User", backref="broker_connections")

    def __repr__(self):
        return f"<BrokerConnection(id={self.id}, broker='{self.broker_name}', user_id={self.user_id})>"

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "broker_name": self.broker_name,
            "access_token": self.access_token,
            "token_timestamp": self.token_timestamp.isoformat() if self.token_timestamp else None,
            "user_id": self.user_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


def get_shared_broker_token(broker_name: str) -> Optional[dict]:
    """Returns token data for shared (user_id=NULL) broker connection."""
    from .database import SessionLocal
    db = SessionLocal()
    try:
        connection = db.query(BrokerConnection).filter(
            BrokerConnection.broker_name == broker_name,
            BrokerConnection.user_id.is_(None)
        ).first()
        return connection.to_dict() if connection else None
    finally:
        db.close()


def save_broker_token(broker_name: str, access_token: str, user_id: Optional[int] = None) -> BrokerConnection:
    """Save or update a broker token. Returns the BrokerConnection instance."""
    from datetime import datetime
    from .database import SessionLocal
    db = SessionLocal()
    try:
        connection = db.query(BrokerConnection).filter(
            BrokerConnection.broker_name == broker_name,
            BrokerConnection.user_id == user_id
        ).first()
        if connection:
            connection.access_token = access_token
            connection.token_timestamp = datetime.utcnow()
        else:
            connection = BrokerConnection(
                broker_name=broker_name,
                access_token=access_token,
                token_timestamp=datetime.utcnow(),
                user_id=user_id
            )
            db.add(connection)
        db.commit()
        db.refresh(connection)
        return connection
    finally:
        db.close()


def delete_broker_token(broker_name: str, user_id: Optional[int] = None) -> bool:
    """Delete a broker token. Returns True if deleted, False if not found."""
    from .database import SessionLocal
    db = SessionLocal()
    try:
        connection = db.query(BrokerConnection).filter(
            BrokerConnection.broker_name == broker_name,
            BrokerConnection.user_id == user_id
        ).first()
        if connection:
            db.delete(connection)
            db.commit()
            return True
        return False
    finally:
        db.close()


class LLMRun(Base):
    """LLM API call tracking for cost and usage analytics."""
    __tablename__ = "llm_runs"

    id = Column(Integer, primary_key=True)
    uuid = Column(String(36), unique=True, index=True, default=lambda: str(uuid.uuid4()))
    
    model = Column(String(100), nullable=False, index=True)
    provider = Column(String(50), nullable=True)
    
    prompt_tokens = Column(Integer, default=0)
    completion_tokens = Column(Integer, default=0)
    total_tokens = Column(Integer, default=0)
    
    cost_usd = Column(Float, default=0.0)
    response_time_ms = Column(Integer, nullable=True)
    
    status = Column(String(20), default='pending', index=True)
    error_message = Column(Text, nullable=True)
    
    url = Column(String(2048), nullable=True)
    headline = Column(String(500), nullable=True)
    request_json = Column(Text, nullable=True)
    response_json = Column(Text, nullable=True)
    
    created_at = Column(DateTime, server_default=func.now(), index=True)

    def __repr__(self):
        return f"<LLMRun(id={self.id}, model='{self.model}', tokens={self.total_tokens}, cost={self.cost_usd})>"

    def to_dict(self) -> dict:
        return {
            "id": self.uuid,
            "model": self.model,
            "provider": self.provider,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
            "cost_usd": self.cost_usd,
            "response_time_ms": self.response_time_ms,
            "status": self.status,
            "error_message": self.error_message,
            "url": self.url,
            "headline": self.headline,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class NewsArticle(Base):
    """Stored news articles for symbol tracking and historical analysis."""
    __tablename__ = "news_articles"

    id = Column(Integer, primary_key=True)
    url = Column(String(2048), unique=True, index=True, nullable=False)
    headline = Column(String(500), nullable=False)
    content = Column(Text, nullable=True)
    source = Column(String(50), nullable=False, index=True)
    source_url = Column(String(2048), nullable=True)
    published_at = Column(DateTime, nullable=True, index=True)
    fetched_at = Column(DateTime, server_default=func.now(), index=True)
    
    sentiment = Column(String(20), nullable=True)
    impact_score = Column(Integer, nullable=True)
    analysis_json = Column(Text, nullable=True)

    symbols = relationship("NewsSymbolMention", back_populates="article", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<NewsArticle(id={self.id}, headline='{self.headline[:50]}...', source='{self.source}')>"

    def to_dict(self) -> dict:
        analysis = None
        if self.analysis_json:
            try:
                analysis = json.loads(self.analysis_json)
            except:
                pass
        
        return {
            "id": self.id,
            "url": self.url,
            "headline": self.headline,
            "content": self.content,
            "source": self.source,
            "source_url": self.source_url,
            "published_at": self.published_at.isoformat() if self.published_at else None,
            "fetched_at": self.fetched_at.isoformat() if self.fetched_at else None,
            "sentiment": self.sentiment,
            "impact_score": self.impact_score,
            "summary": analysis.get("summary") if analysis else None,
            "key_points": analysis.get("key_points") if analysis else None,
            "key_entities": analysis.get("key_entities") if analysis else None,
            "trade_ideas": analysis.get("trade_ideas") if analysis else None,
            "symbols": [s.to_dict() for s in self.symbols] if self.symbols else []
        }


class NewsSymbolMention(Base):
    """Symbols mentioned in news articles, mapped to Upstox instruments."""
    __tablename__ = "news_symbol_mentions"

    id = Column(Integer, primary_key=True)
    article_id = Column(Integer, ForeignKey("news_articles.id"), nullable=False, index=True)
    
    symbol_code = Column(String(50), nullable=False)
    trading_symbol = Column(String(50), nullable=True)
    instrument_key = Column(String(100), nullable=True)
    company_name = Column(String(200), nullable=True)
    match_confidence = Column(Float, nullable=True)
    match_method = Column(String(20), nullable=True)

    article = relationship("NewsArticle", back_populates="symbols")

    __table_args__ = (
        Index('ix_news_symbol_mentions_instrument_key', 'instrument_key'),
        Index('ix_news_symbol_mentions_trading_symbol', 'trading_symbol'),
    )

    def __repr__(self):
        return f"<NewsSymbolMention(symbol_code='{self.symbol_code}', trading_symbol='{self.trading_symbol}')>"

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "symbol_code": self.symbol_code,
            "trading_symbol": self.trading_symbol,
            "instrument_key": self.instrument_key,
            "company_name": self.company_name,
            "match_confidence": self.match_confidence,
            "match_method": self.match_method
        }


class Instrument(Base):
    """NSE instrument data for symbol search and trading."""
    __tablename__ = "instruments"

    instrument_key = Column(String(100), primary_key=True)
    trading_symbol = Column(String(50), nullable=False, index=True)
    name = Column(String(200), nullable=True)
    exchange = Column(String(20), nullable=False)
    segment = Column(String(20), nullable=False)
    lot_size = Column(Integer, default=1)
    tick_size = Column(Float, default=0.05)
    expiry = Column(Date, nullable=True)
    strike_price = Column(Float, nullable=True)
    qty_multiplier = Column(Float, nullable=True)
    isin = Column(String(20), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    def __repr__(self):
        return f"<Instrument({self.trading_symbol})>"

    def to_dict(self) -> dict:
        return {
            "instrument_key": self.instrument_key,
            "trading_symbol": self.trading_symbol,
            "name": self.name,
            "exchange": self.exchange,
            "segment": self.segment,
            "lot_size": self.lot_size,
            "tick_size": self.tick_size,
            "expiry": self.expiry.isoformat() if self.expiry else None,
            "strike_price": self.strike_price,
            "qty_multiplier": self.qty_multiplier,
            "isin": self.isin,
        }

