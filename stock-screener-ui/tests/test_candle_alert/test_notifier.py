import subprocess
from unittest.mock import patch

from candle_alert import notifier

ARGV = ["notify-send", "-u", "normal", "-t", "10000", "Title", "Body"]


def test_notification_title_uses_tf_label_and_symbols():
    assert notifier.notification_title("1H") == "1H candle closes in 1 min - GOLD, NQ, OIL"
    assert notifier.notification_title("4H") == "4H candle closes in 1 min - GOLD, NQ, OIL"
    assert notifier.notification_title("1H", labels=(("X", "X=F"),)) == (
        "1H candle closes in 1 min - X"
    )


@patch("candle_alert.notifier.subprocess.run")
def test_notify_uses_expected_argv_and_dispatch_options(mock_run):
    mock_run.return_value.returncode = 0

    assert notifier.notify("Title", "Body") is True
    mock_run.assert_called_once_with(ARGV, timeout=5, capture_output=True)


@patch("candle_alert.notifier.subprocess.run")
def test_notify_returns_false_on_nonzero_exit(mock_run):
    mock_run.return_value.returncode = 1

    assert notifier.notify("Title", "Body") is False


@patch("candle_alert.notifier.subprocess.run", side_effect=FileNotFoundError)
def test_notify_returns_false_when_binary_missing(mock_run):
    assert notifier.notify("Title", "Body") is False


@patch(
    "candle_alert.notifier.subprocess.run",
    side_effect=subprocess.TimeoutExpired(cmd="notify-send", timeout=5),
)
def test_notify_returns_false_on_timeout(mock_run):
    assert notifier.notify("Title", "Body") is False
