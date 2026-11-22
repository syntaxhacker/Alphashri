
from datetime import timezone

SYMBOLS = (
    ("GOLD", "GC=F"),
    ("NQ", "NQ=F"),
    ("OIL", "CL=F"),
    ("NIFTY", "^NSEI"),
    ("SENSEX", "^BSESN"),
    ("BANKNIFTY", "^NSEBANK"),
)
IST_SYMBOLS = frozenset({"NIFTY", "SENSEX", "BANKNIFTY"})
TIMEFRAMES = (60, 240)
ALERT_LEAD_SECONDS = 60
DEFAULT_INTERVAL_SECONDS = 1
DEFAULT_QUOTE_TTL_SECONDS = 30
UTC = timezone.utc

_TF_LABELS = {60: "1H", 240: "4H"}


def tf_label(minutes: int) -> str:
    return _TF_LABELS.get(minutes, f"{minutes}M")


def is_ist(label: str) -> bool:
    return label in IST_SYMBOLS
