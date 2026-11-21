import subprocess
from types import SimpleNamespace
from unittest.mock import call, patch

from candle_alert import notifier

ARGV = ["notify-send", "-u", "normal", "-t", "10000", "Title", "Body"]


def test_notification_title_uses_tf_label_and_symbols():
    all_names = "GOLD, NQ, OIL, NIFTY, SENSEX, BANKNIFTY"
    assert notifier.notification_title("1H") == f"1H candle closes in 1 min - {all_names}"
    assert notifier.notification_title("4H") == f"4H candle closes in 1 min - {all_names}"
    assert notifier.notification_title("1H", labels=(("X", "X=F"),)) == (
        "1H candle closes in 1 min - X"
    )


@patch("candle_alert.notifier.subprocess.run")
def test_notify_uses_expected_argv_and_dispatch_options(mock_run):
    mock_run.return_value.returncode = 0

    assert notifier.notify("Title", "Body") is True
    assert mock_run.call_args_list == [
        call(ARGV, timeout=5, capture_output=True),
        call(["canberra-gtk-play", "-i", "message-new-instant"],
             timeout=5, capture_output=True),
    ]


@patch("candle_alert.notifier.subprocess.run")
def test_notify_returns_false_on_nonzero_exit(mock_run):
    mock_run.return_value.returncode = 1

    assert notifier.notify("Title", "Body") is False
    assert mock_run.call_count == 1  # no sound when the popup failed


@patch("candle_alert.notifier.subprocess.run", side_effect=FileNotFoundError)
def test_notify_returns_false_when_binary_missing(mock_run):
    assert notifier.notify("Title", "Body") is False


@patch(
    "candle_alert.notifier.subprocess.run",
    side_effect=subprocess.TimeoutExpired(cmd="notify-send", timeout=5),
)
def test_notify_returns_false_on_timeout(mock_run):
    assert notifier.notify("Title", "Body") is False


@patch(
    "candle_alert.notifier.subprocess.run",
    side_effect=[SimpleNamespace(returncode=0), FileNotFoundError],
)
def test_sound_failure_does_not_fail_notification(mock_run):
    assert notifier.notify("Title", "Body") is True
    assert mock_run.call_count == 2
