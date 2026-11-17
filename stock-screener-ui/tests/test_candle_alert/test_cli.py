from datetime import datetime
from unittest.mock import patch

import pytest

import candle_close_alert as cli
from candle_alert.config import UTC
from candle_alert.quotes import Quote, QuoteFetchError


@pytest.fixture
def quotes():
    return {
        "GOLD": Quote("GOLD", 3325.8, 3321.4, 3318.1),
        "NQ": Quote("NQ", 19842.5, 19790.0, 19760.0),
        "OIL": Quote("OIL", 71.32, 71.05, 70.40),
    }


def test_parse_args_defaults():
    args = cli.parse_args([])
    assert args.once is False
    assert args.preview is None
    assert args.no_notify is False
    assert args.interval == 1
    assert args.quote_ttl == 30


def test_main_once_prints_all_symbols(quotes, capsys):
    with patch.object(cli, "cached_quotes", return_value=quotes):
        assert cli.main(["--once"]) == 0

    out = capsys.readouterr().out
    assert "CANDLE CLOSE BOARD" in out
    for label in ("GOLD", "NQ", "OIL"):
        assert label in out
    assert out.count("closes ") == 6


def test_main_preview_prints_notification_body(quotes, capsys):
    with patch.object(cli, "cached_quotes", return_value=quotes):
        assert cli.main(["--preview", "4H"]) == 0

    out = capsys.readouterr().out
    assert "closes at" in out
    assert "GOLD" in out and "NQ" in out and "OIL" in out


def test_main_quote_failure_returns_error(quotes, capsys):
    with patch.object(cli, "cached_quotes", side_effect=QuoteFetchError("GC=F down")):
        assert cli.main(["--once"]) == 1
    assert "GC=F down" in capsys.readouterr().err


def test_tick_fires_once_per_close(quotes):
    now = datetime(2026, 11, 17, 14, 59, 30, tzinfo=UTC)
    fired = set()
    with patch.object(cli, "in_alert_window", return_value=True), \
         patch.object(cli, "close_epoch", return_value=1234567), \
         patch.object(cli, "notify") as send:
        first = cli.tick(now, quotes, fired)
        second = cli.tick(now, quotes, fired)

    assert len(first) == 2
    assert second == []
    assert send.call_count == 2
    assert "closes at" in first[0][1]


def test_tick_without_notify_still_returns_alerts(quotes):
    now = datetime(2026, 11, 17, 3, 59, 30, tzinfo=UTC)
    with patch.object(cli, "in_alert_window", return_value=True), \
         patch.object(cli, "close_epoch", return_value=7654321), \
         patch.object(cli, "notify") as send:
        alerts = cli.tick(now, quotes, set(), emit=False)

    assert len(alerts) == 2
    send.assert_not_called()
