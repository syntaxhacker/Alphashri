"""Broker access-token resolution shared by the hub's consumers."""

from typing import Optional


def recorder_token(broker: str) -> Optional[str]:
    """Resolve the access token for the recorder's broker.

    Upstox uses the OAuth token directly; Fyers APIs need
    ``"<APP_ID>:<ACCESS_TOKEN>"``. Returns ``None`` for a broker we do not know,
    so an unknown name can never fall through and spend another broker's
    credentials.
    """
    broker = (broker or "upstox").strip().lower()

    from api.broker_hub.adapters import get_adapter
    from api.broker_hub.symbols import is_fyers_broker

    if get_adapter(broker) is None:
        return None

    if broker == "upstox":
        from api.paper.live_stream import _get_upstox_token

        return _get_upstox_token()

    if not is_fyers_broker(broker):
        return None

    import config
    from db.models import get_shared_broker_token

    token = (get_shared_broker_token("fyers") or {}).get("access_token")
    if not token:
        return None
    if config.FYERS_CLIENT_ID:
        return f"{config.FYERS_CLIENT_ID}:{token}"
    return token
