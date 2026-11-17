"""Single source of truth for candle-alert symbols, timeframes and limits."""

from datetime import timezone

SYMBOLS = (("GOLD", "GC=F"), ("NQ", "NQ=F"), ("OIL", "CL=F"))
TIMEFRAMES = (60, 240)
ALERT_LEAD_SECONDS = 60
DEFAULT_INTERVAL_SECONDS = 1
DEFAULT_QUOTE_TTL_SECONDS = 30
UTC = timezone.utc

_TF_LABELS = {60: "1H", 240: "4H"}


def tf_label(minutes: int) -> str:
    return _TF_LABELS.get(minutes, f"{minutes}M")
