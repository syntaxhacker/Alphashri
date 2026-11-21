"""Drop-in pure-Python shim for the small ``nautilus_trader`` slice used by backtests.

Call :func:`install` once before importing ``backtest.strategies.*``.  The shim
registers a complete set of ``nautilus_trader*`` modules in ``sys.modules``, so
no strategy file needs to change.  :func:`uninstall` restores the real package.
"""

from __future__ import annotations

import sys
from types import ModuleType
from typing import Any, Dict

__all__ = ["install", "uninstall", "is_installed"]

_STATE: Dict[str, Any] = {
    "installed": False,
    "saved": {},
    "injected": set(),
    "modules": {},
}


def _module(name: str, *, package: bool = False, **attrs: Any) -> ModuleType:
    module = ModuleType(name)
    module.__dict__.update(attrs)
    module.__dict__["_SIM_SHIM"] = True
    if package:
        module.__dict__["__path__"] = []
    return module


def _build_modules() -> Dict[str, ModuleType]:
    from . import engine as engine_mod
    from . import model as model_mod
    from . import strategy as strategy_mod
    from .engine import Bar, BarDataWrangler, BacktestEngine, BacktestEngineConfig
    from .model import (
        INR,
        AccountType,
        BarType,
        Currency,
        Equity,
        InstrumentId,
        Money,
        OmsType,
        OrderSide,
        Price,
        Quantity,
        Symbol,
        TraderId,
        Venue,
    )
    from .strategy import Strategy, StrategyConfig

    for internal in (engine_mod, model_mod, strategy_mod):
        internal.__dict__["_SIM_SHIM"] = True

    currencies_mod = _module("nautilus_trader.model.currencies", INR=INR, Currency=Currency)
    enums_mod = _module(
        "nautilus_trader.model.enums",
        OrderSide=OrderSide,
        AccountType=AccountType,
        OmsType=OmsType,
    )
    instruments_mod = _module("nautilus_trader.model.instruments", Equity=Equity)
    objects_mod = _module("nautilus_trader.model.objects", Price=Price, Quantity=Quantity, Money=Money)
    data_mod = _module("nautilus_trader.model.data", BarType=BarType, Bar=Bar)
    identifiers_mod = _module(
        "nautilus_trader.model.identifiers",
        InstrumentId=InstrumentId,
        Symbol=Symbol,
        Venue=Venue,
        TraderId=TraderId,
    )

    for name, module in (
        ("currencies", currencies_mod),
        ("enums", enums_mod),
        ("instruments", instruments_mod),
        ("objects", objects_mod),
        ("data", data_mod),
        ("identifiers", identifiers_mod),
    ):
        setattr(model_mod, name, module)
    for name, value in (
        ("BarType", BarType),
        ("InstrumentId", InstrumentId),
        ("Money", Money),
        ("Symbol", Symbol),
        ("TraderId", TraderId),
        ("Venue", Venue),
        ("Bar", Bar),
        ("Price", Price),
        ("Quantity", Quantity),
    ):
        setattr(model_mod, name, value)

    backtest_mod = _module(
        "nautilus_trader.backtest", package=True, config=engine_mod, engine=engine_mod
    )
    persistence_mod = _module("nautilus_trader.persistence", package=True, wranglers=engine_mod)
    trading_mod = _module("nautilus_trader.trading", package=True, strategy=strategy_mod)

    parent = _module(
        "nautilus_trader",
        package=True,
        __version__="0.0.0+sim",
        BacktestEngine=BacktestEngine,
        BacktestEngineConfig=BacktestEngineConfig,
        BarDataWrangler=BarDataWrangler,
        Strategy=Strategy,
        StrategyConfig=StrategyConfig,
    )

    mapping: Dict[str, ModuleType] = {
        "nautilus_trader": parent,
        "nautilus_trader.backtest": backtest_mod,
        "nautilus_trader.backtest.config": engine_mod,
        "nautilus_trader.backtest.engine": engine_mod,
        "nautilus_trader.config": strategy_mod,
        "nautilus_trader.model": model_mod,
        "nautilus_trader.model.currencies": currencies_mod,
        "nautilus_trader.model.enums": enums_mod,
        "nautilus_trader.model.instruments": instruments_mod,
        "nautilus_trader.model.objects": objects_mod,
        "nautilus_trader.model.data": data_mod,
        "nautilus_trader.model.identifiers": identifiers_mod,
        "nautilus_trader.persistence": persistence_mod,
        "nautilus_trader.persistence.wranglers": engine_mod,
        "nautilus_trader.trading": trading_mod,
        "nautilus_trader.trading.strategy": strategy_mod,
    }
    for name, module in mapping.items():
        if "." not in name:
            continue
        parent_name, leaf = name.rsplit(".", 1)
        container = mapping.get(parent_name)
        if container is not None and not getattr(container, leaf, None):
            setattr(container, leaf, module)
    return mapping


def is_installed() -> bool:
    if not _STATE["installed"]:
        return False
    return sys.modules.get("nautilus_trader") is _STATE["modules"].get("nautilus_trader")


def install(force: bool = True) -> ModuleType:
    """Register the shim modules, replacing the real package in ``sys.modules``."""
    if is_installed():
        if not force:
            return _STATE["modules"]["nautilus_trader"]
        uninstall()

    saved = {
        name: module
        for name, module in list(sys.modules.items())
        if name == "nautilus_trader" or name.startswith("nautilus_trader.")
    }
    for name in saved:
        sys.modules.pop(name, None)

    mapping = _build_modules()
    sys.modules.update(mapping)
    _STATE["installed"] = True
    _STATE["saved"] = saved
    _STATE["injected"] = set(mapping)
    _STATE["modules"] = mapping
    return mapping["nautilus_trader"]


def uninstall() -> None:
    """Remove exactly the modules installed here and restore any previous ones."""
    if not _STATE["installed"]:
        return

    for name in _STATE["injected"]:
        if sys.modules.get(name) is _STATE["modules"].get(name):
            del sys.modules[name]
    sys.modules.update(_STATE["saved"])
    _STATE["installed"] = False
    _STATE["saved"] = {}
    _STATE["injected"] = set()
    _STATE["modules"] = {}
