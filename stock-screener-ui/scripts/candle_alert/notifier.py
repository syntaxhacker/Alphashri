import subprocess

from .config import ALERT_LEAD_SECONDS, SYMBOLS

_BINARY = "notify-send"
_SOUND_BINARY = "canberra-gtk-play"
_SOUND_EVENT = "message-new-instant"
_SUBPROCESS_TIMEOUT = 5
_DISPLAY_MS = "10000"
_LEAD_MINUTES = ALERT_LEAD_SECONDS // 60


def notification_title(tf_label: str, labels=None) -> str:
    names = ", ".join(label for label, _ in (labels if labels is not None else SYMBOLS))
    return f"{tf_label} candle closes in {_LEAD_MINUTES} min - {names}"


def _play_sound():
    # GNOME only sounds critical-urgency popups; play the theme's notification
    # event explicitly so a normal-urgency alert still has its default sound.
    try:
        subprocess.run(
            [_SOUND_BINARY, "-i", _SOUND_EVENT],
            timeout=_SUBPROCESS_TIMEOUT,
            capture_output=True,
        )
    except (OSError, subprocess.TimeoutExpired):
        pass


def notify(title: str, body: str) -> bool:
    argv = [_BINARY, "-u", "normal", "-t", _DISPLAY_MS, title, body]
    try:
        result = subprocess.run(argv, timeout=_SUBPROCESS_TIMEOUT, capture_output=True)
    except (OSError, subprocess.TimeoutExpired):
        return False
    if result.returncode != 0:
        return False
    _play_sound()
    return True
