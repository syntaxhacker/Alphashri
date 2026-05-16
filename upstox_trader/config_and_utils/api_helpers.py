"""
API helper functions and constants.
"""

from pathlib import Path
from typing import Optional

API_VERSION = "3.0"
BASE_URL = "https://api.upstox.com/v3"
ORDER_URL = "https://api-hft.upstox.com/v3/order/place"
ORDER_BOOK_URL = "https://api.upstox.com/v2/order/retrieve-all"
INSTRUMENT_LIST_URL = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"
INSTRUMENT_CACHE_FILE = Path(__file__).parent / "nse_instruments.json"

try:
    from ..screeners.symbol_validator import get_valid_symbol
except ImportError:
    def get_valid_symbol(symbol):
        """Fallback symbol cleaning if validator not available"""
        if not symbol:
            return None
        cleaned = symbol.upper()
        if ':' in cleaned:
            cleaned = cleaned.split(':', 1)[1]
        suffixes_to_remove = ['.E1', '.EQ', '-EQ', 'EQ', '.NS', '.BO', '-NS', '-BO']
        for suffix in suffixes_to_remove:
            if cleaned.endswith(suffix):
                cleaned = cleaned[:-len(suffix)]
                break
        return cleaned.strip()


def _import_upstox_auth():
    """Import upstox_auth module with fallback strategies for different import contexts."""
    try:
        from .upstox_auth import create_upstox_auth
        return create_upstox_auth
    except ImportError:
        try:
            from upstox_trader.config_and_utils.upstox_auth import create_upstox_auth
            return create_upstox_auth
        except ImportError:
            try:
                import upstox_auth
                return upstox_auth.create_upstox_auth
            except ImportError:
                print("⚠️ upstox_auth module not found. Please ensure it's in the same directory.")
                return None


create_upstox_auth = _import_upstox_auth()
