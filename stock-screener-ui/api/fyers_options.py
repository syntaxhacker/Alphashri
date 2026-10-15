"""
Fyers option-symbol resolver.

The Order Flow tab's option chain is Upstox-native (``NSE_FO|...`` instrument
keys), but the Fyers feeds cannot resolve those keys — subscribing with one
yields a silent dead feed. Options mode therefore asks here for the
Fyers-native contract symbol (e.g. ``NSE:NIFTY26SEP23400CE``) before
subscribing.

Resolution is a read-only call to the Fyers v3 ``optionchain`` REST endpoint.
Anything unexpected — missing token/SDK, API error, unknown expiry/strike —
returns ``None`` so callers degrade to a clear, actionable error instead of a
feed that connects but never ticks.
"""

import time
from datetime import datetime
from typing import Optional

#: Short TTL so repeated "Use contract" clicks don't hammer Fyers, while a
#: re-picked contract still sees a fresh chain within half a minute.
CHAIN_TTL_SEC = 30.0

#: How many strikes each side of ATM to request. Wide enough that a far
#: OTM/ITM pick still resolves; Fyers caps this server-side if too large.
_STRIKECOUNT = 25

#: App-level underlying -> the Fyers option-chain symbol for that index.
_FYERS_UNDERLYINGS = {
    "NIFTY": "NSE:NIFTY50-INDEX",
    "BANKNIFTY": "NSE:NIFTYBANK-INDEX",
    "FINNIFTY": "NSE:FINNIFTY-INDEX",
    "MIDCPNIFTY": "NSE:MIDCPNIFTY-INDEX",
    "SENSEX": "BSE:SENSEX-INDEX",
}

#: (underlying, expiry YYYY-MM-DD) -> (expires_at_monotonic, chain payload).
_CHAIN_CACHE: dict[tuple[str, str], tuple[float, dict]] = {}


def clear_fyers_chain_cache() -> None:
    """Drop the cached chains (tests / manual refresh)."""
    _CHAIN_CACHE.clear()


def fyers_underlying_symbol(underlying: Optional[str]) -> Optional[str]:
    """Map an app-level underlying to its Fyers option-chain symbol."""
    text = (underlying or "").strip().upper()
    if not text:
        return None
    if ":" in text:
        # Already qualified (``NSE:NIFTY50-INDEX``) — pass through untouched.
        return text
    return _FYERS_UNDERLYINGS.get(text)


def _fetch_option_chain(fyers_symbol: str) -> Optional[dict]:
    """Call the Fyers v3 ``optionchain`` endpoint; ``None`` on any failure.

    ``FyersModel`` needs ``client_id`` and ``token`` as separate arguments —
    the combined ``"APP_ID:TOKEN"`` form is only for the data socket.
    """
    try:
        from api.orderflow_recorder import recorder_token

        combined = recorder_token("fyers_tbt")
        if not combined:
            return None
        app_id, sep, access_token = combined.partition(":")
        if not sep or not app_id.strip() or not access_token.strip():
            return None

        from fyers_apiv3.fyersModel import FyersModel

        model = FyersModel(client_id=app_id.strip(), token=access_token.strip())
        resp = model.optionchain(
            data={"symbol": fyers_symbol, "strikecount": _STRIKECOUNT}
        )
    except Exception:
        return None
    try:
        if not isinstance(resp, dict):
            return None
        if str(resp.get("s", "")).lower() != "ok":
            return None
        data = resp.get("data")
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _get_cached_chain(cache_key: tuple[str, str]) -> Optional[dict]:
    entry = _CHAIN_CACHE.get(cache_key)
    if not entry:
        return None
    expires_at, payload = entry
    if time.monotonic() >= expires_at:
        _CHAIN_CACHE.pop(cache_key, None)
        return None
    return payload


def resolve_fyers_option_symbol(
    underlying: Optional[str],
    expiry: Optional[str],
    strike,
    option_type: Optional[str],
) -> Optional[dict]:
    """Map (underlying, expiry YYYY-MM-DD, strike, CE/PE) -> Fyers contract.

    Returns ``{"symbol", "fyToken", "oi", "oich"}`` or ``None`` when the
    contract cannot be resolved. Never raises.
    """
    try:
        opt = (option_type or "").strip().upper()
        if opt not in ("CE", "PE"):
            return None
        try:
            strike_num = float(strike)
        except (TypeError, ValueError):
            return None
        if strike_num != strike_num or strike_num in (float("inf"), float("-inf")):
            return None
        try:
            expiry_ddmmyyyy = datetime.strptime(
                (expiry or "").strip(), "%Y-%m-%d"
            ).strftime("%d-%m-%Y")
        except ValueError:
            return None

        fyers_underlying = fyers_underlying_symbol(underlying)
        if not fyers_underlying:
            return None

        cache_key = ((underlying or "").strip().upper(), (expiry or "").strip())
        chain = _get_cached_chain(cache_key)
        if chain is None:
            chain = _fetch_option_chain(fyers_underlying)
            if chain is None:
                return None
            _CHAIN_CACHE[cache_key] = (time.monotonic() + CHAIN_TTL_SEC, chain)

        # The requested expiry must be one Fyers actually lists. When Fyers
        # omits expiryData entirely we fall through to the leg match rather
        # than failing a chain that may still carry the contract.
        expiry_rows = chain.get("expiryData")
        if isinstance(expiry_rows, list) and expiry_rows:
            if not any(
                isinstance(row, dict) and row.get("date") == expiry_ddmmyyyy
                for row in expiry_rows
            ):
                return None

        legs = chain.get("optionsChain")
        if not isinstance(legs, list):
            return None
        for leg in legs:
            if not isinstance(leg, dict):
                continue
            try:
                leg_strike = float(leg.get("strike_price"))
            except (TypeError, ValueError):
                continue
            if leg_strike != strike_num:
                continue
            if str(leg.get("option_type", "")).strip().upper() != opt:
                continue
            symbol = leg.get("symbol")
            if not symbol:
                return None
            return {
                "symbol": symbol,
                "fyToken": leg.get("fyToken", leg.get("fy_token")),
                "oi": leg.get("oi"),
                "oich": leg.get("oich"),
            }
        return None
    except Exception:
        return None
