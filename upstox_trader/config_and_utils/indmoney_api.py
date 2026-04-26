"""
API client for INDMoney (INDstocks) integration.

Backward-compatible wrapper – delegates to the modular package at indmoney/.
"""

from .indmoney import INDMONEYApi  # noqa: F401

__all__ = ["INDMONEYApi"]
