import subprocess

from .config import ALERT_LEAD_SECONDS, SYMBOLS

_BINARY = "notify-send"
_SUBPROCESS_TIMEOUT = 5
_DISPLAY_MS = "10000"
_LEAD_MINUTES = ALERT_LEAD_SECONDS // 60


def notification_title(tf_label: str, labels=None) -> str:
    names = ", ".join(label for label, _ in (labels if labels is not None else SYMBOLS))
    return f"{tf_label} candle closes in {_LEAD_MINUTES} min - {names}"


def notify(title: str, body: str) -> bool:
    argv = [_BINARY, "-u", "normal", "-t", _DISPLAY_MS, title, body]
    try:
        result = subprocess.run(argv, timeout=_SUBPROCESS_TIMEOUT, capture_output=True)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0
