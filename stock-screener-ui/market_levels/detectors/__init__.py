"""Adapter lanes for the market-levels contract.

``ADAPTER_MODULES`` names the optional detector modules imported lazily by
``market_levels.service._ensure_adapters``. Nothing is imported eagerly so the
foundation remains usable before every lane exists.
"""

ADAPTER_MODULES = ("price_action", "pivot", "gex", "walls")
