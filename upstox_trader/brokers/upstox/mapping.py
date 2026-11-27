import json
import threading
from datetime import datetime
from pathlib import Path
from typing import Optional

from ..base import BrokerSymbolMap

INSTRUMENT_CACHE_FILE = (
    Path(__file__).resolve().parent.parent.parent
    / "config_and_utils"
    / "nse_instruments.json"
)

INSTRUMENT_LIST_URL = (
    "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"
)


class UpstoxSymbolMap(BrokerSymbolMap):
    """Upstox symbol/instrument key resolution from cached NSE instrument list."""

    # Class-level so instances built via __new__ in tests still have a lock.
    _INDEX_LOCK = threading.Lock()

    def __init__(self):
        self._instruments: Optional[list[dict]] = None

    def to_canonical(self, broker_symbol: str) -> str:
        return broker_symbol.upper().replace(" ", "")

    def to_broker(self, canonical_symbol: str) -> str:
        return canonical_symbol

    def _load_instruments(self) -> list[dict]:
        if self._instruments is not None:
            return self._instruments

        if INSTRUMENT_CACHE_FILE.exists():
            with open(INSTRUMENT_CACHE_FILE) as f:
                self._instruments = json.load(f)
            return self._instruments

        import gzip

        import requests

        try:
            resp = requests.get(INSTRUMENT_LIST_URL, stream=True, timeout=60)
            resp.raise_for_status()
            with gzip.open(resp.raw, "rt", encoding="utf-8") as gz:
                self._instruments = json.load(gz)
            with open(INSTRUMENT_CACHE_FILE, "w") as f:
                json.dump(self._instruments, f)
        except Exception:
            self._instruments = []
        return self._instruments

    def _instrument_index(self) -> dict[str, list[dict]]:
        """Index the master by trading symbol, preserving row order per symbol."""
        instruments = self._instruments
        cached = getattr(self, "_token_index", None)
        if cached is None or cached[0] is not instruments:
            with self._INDEX_LOCK:
                cached = getattr(self, "_token_index", None)
                if cached is None or cached[0] is not instruments:
                    by_symbol: dict[str, list[dict]] = {}
                    for inst in instruments:
                        try:
                            by_symbol.setdefault(inst.get("trading_symbol"), []).append(inst)
                        except TypeError:
                            # An unhashable symbol can never equal the string lookup key.
                            pass
                    cached = (instruments, by_symbol)
                    self._token_index = cached
        return cached[1]

    def resolve_token(
        self,
        symbol: str,
        exchange: str = "NSE_EQ",
    ) -> Optional[str]:
        """Resolve symbol to Upstox instrument key."""
        self._load_instruments()
        index = self._instrument_index()
        if not index:
            return None

        clean = symbol.upper().strip()
        for suffix in [".E1", ".EQ", "-EQ", "EQ", ".NS", ".BO", "-NS", "-BO"]:
            if clean.endswith(suffix):
                clean = clean[: -len(suffix)]
                break

        candidates = index.get(clean, ())
        for inst in candidates:
            if (
                inst.get("segment") == exchange
                and inst.get("instrument_type") == "EQ"
            ):
                return inst.get("instrument_key")

        for inst in candidates:
            if inst.get("instrument_type") in ("EQ", "INDEX"):
                return inst.get("instrument_key")

        return None
