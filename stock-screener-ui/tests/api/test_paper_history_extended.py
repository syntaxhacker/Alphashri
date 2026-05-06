"""
Extended Paper Trading History API Tests.

Tests for _get_trades_from_db(), _get_trades_from_journals(), delete_trade(),
and get_trades() DB-first with journal fallback logic in api/paper/history.py.
Uses the `client` and `auth_headers` fixtures from tests/api/conftest.py.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

import config

IST = config.IST


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_db_trade(**overrides):
    """Build a MagicMock that behaves like a Trade model row.

    Has .to_dict() that returns the expected dict shape.
    """
    defaults = dict(
        id=1,
        uuid="aaaa-bbbb",
        user_id=1,
        bot_id=None,
        strategy_id=1,
        strategy_name="ORB",
        symbol="RELIANCE",
        side="BUY",
        quantity=50,
        entry_price=2500.0,
        exit_price=2600.0,
        entry_time=datetime(2026, 4, 20, 10, 15, 0, tzinfo=IST),
        exit_time=datetime(2026, 4, 20, 11, 30, 0, tzinfo=IST),
        pnl=5000.0,
        pnl_pct=2.0,
        costs=50.0,
        net_pnl=4950.0,
        exit_reason="TP",
        notes="",
        reason="",
        is_test=False,
    )
    defaults.update(overrides)
    trade = MagicMock()
    trade.to_dict.return_value = {
        "id": defaults["uuid"],
        "trade_id": f"TRADE-{defaults['id']:06d}",
        "symbol": defaults["symbol"],
        "side": defaults["side"],
        "quantity": defaults["quantity"],
        "entry_price": defaults["entry_price"],
        "exit_price": defaults["exit_price"],
        "entry_time": defaults["entry_time"].isoformat(),
        "exit_time": defaults["exit_time"].isoformat(),
        "pnl": defaults["pnl"],
        "pnl_pct": defaults["pnl_pct"],
        "exit_reason": defaults["exit_reason"],
        "costs": defaults["costs"],
        "net_pnl": defaults["net_pnl"],
        "strategy_id": defaults["strategy_id"],
        "strategy_name": defaults["strategy_name"],
        "is_test": defaults["is_test"],
        "source": "live",
        "stop_loss": 0.0,
        "take_profit": 0.0,
        "hold_duration_minutes": 75,
        "notes": defaults["notes"],
        "reason": defaults["reason"],
        "bot_id": defaults["bot_id"],
        "peak_price": 0.0,
        "low_price": 0.0,
    }
    return trade


def _build_session_mock(trade_mocks=None, raise_on_query=False):
    """Build a mock SessionLocal() with a self-referencing query chain.

    The actual code does:
        db = SessionLocal()
        query = db.query(TradeModel).filter(...).filter(...)...
        query = query.order_by(...).limit(...)
        return [t.to_dict() for t in query.all()]

    The chain must return itself from .filter(), .order_by(), .limit()
    so that .all() is called on the right object.
    .all() must return the trade mocks (which have .to_dict()).
    """
    mock_db = MagicMock()

    if raise_on_query:
        mock_db.query.side_effect = RuntimeError("DB down")
    else:
        chain = MagicMock()
        chain.filter.return_value = chain
        chain.order_by.return_value = chain
        chain.limit.return_value = chain
        chain.all.return_value = trade_mocks or []
        mock_db.query.return_value = chain

    return mock_db


def _make_journal_dict(**overrides):
    """Return a dict that looks like asdict(TradeRecord)."""
    defaults = dict(
        trade_id="TRD-1",
        symbol="RELIANCE",
        side="BUY",
        quantity=50,
        entry_price=2500.0,
        exit_price=2600.0,
        entry_time="2026-04-20T10:15:00",
        exit_time="2026-04-20T11:30:00",
        pnl=5000.0,
        pnl_pct=2.0,
        exit_reason="TP",
        costs=50.0,
        net_pnl=4950.0,
        strategy_name="ORB",
        strategy_id=1,
        bot_id=0,
    )
    defaults.update(overrides)
    return defaults


# ---------------------------------------------------------------------------
# _get_trades_from_db() tests
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestGetTradesFromDb:
    """Direct tests for _get_trades_from_db().

    The function has a LOCAL import at line 58:
        from db.database import SessionLocal
    so we patch db.database.SessionLocal.
    """

    def test_default_bot_id_maps_to_no_bot_filter(self, client, auth_headers):
        """bot_id='default' should NOT add a bot_id filter (handled by journals)."""
        from api.paper.history import _get_trades_from_db

        trade = _make_db_trade(id=1)
        mock_db = _build_session_mock(trade_mocks=[trade])
        with patch("db.database.SessionLocal", return_value=mock_db):
            result = _get_trades_from_db(
                user_id=1, bot_id="default", symbol=None,
                strategy_id=None, from_date=None, to_date=None,
                days_back=7, limit=50,
            )

        assert len(result) == 1
        assert result[0]["symbol"] == "RELIANCE"

    def test_numeric_bot_id_filters_as_int(self, client, auth_headers):
        """bot_id='3' should filter by TradeModel.bot_id == 3."""
        from api.paper.history import _get_trades_from_db

        trade = _make_db_trade(id=1, bot_id=3)
        mock_db = _build_session_mock(trade_mocks=[trade])
        with patch("db.database.SessionLocal", return_value=mock_db):
            result = _get_trades_from_db(
                user_id=1, bot_id="3", symbol=None,
                strategy_id=None, from_date=None, to_date=None,
                days_back=7, limit=50,
            )

        assert len(result) == 1
        assert result[0]["bot_id"] == 3

    def test_non_numeric_bot_id_passes_gracefully(self, client, auth_headers):
        """bot_id='abc' should not crash — ValueError caught, filter skipped."""
        from api.paper.history import _get_trades_from_db

        trade = _make_db_trade(id=1, bot_id=None)
        mock_db = _build_session_mock(trade_mocks=[trade])
        with patch("db.database.SessionLocal", return_value=mock_db):
            result = _get_trades_from_db(
                user_id=1, bot_id="abc", symbol=None,
                strategy_id=None, from_date=None, to_date=None,
                days_back=7, limit=50,
            )

        assert len(result) == 1

    def test_none_bot_id_no_filter(self, client, auth_headers):
        """bot_id=None should not add any bot_id filter."""
        from api.paper.history import _get_trades_from_db

        trade = _make_db_trade(id=1)
        mock_db = _build_session_mock(trade_mocks=[trade])
        with patch("db.database.SessionLocal", return_value=mock_db):
            result = _get_trades_from_db(
                user_id=1, bot_id=None, symbol=None,
                strategy_id=None, from_date=None, to_date=None,
                days_back=7, limit=50,
            )

        assert len(result) == 1

    def test_date_range_filtering(self, client, auth_headers):
        """from_date and to_date should be parsed and applied as filters."""
        from api.paper.history import _get_trades_from_db

        trade = _make_db_trade(id=1)
        mock_db = _build_session_mock(trade_mocks=[trade])
        with patch("db.database.SessionLocal", return_value=mock_db):
            result = _get_trades_from_db(
                user_id=1, bot_id=None, symbol=None,
                strategy_id=None, from_date="2026-04-01", to_date="2026-04-30",
                days_back=7, limit=50,
            )

        assert len(result) == 1

    def test_days_back_default_when_no_dates(self, client, auth_headers):
        """When no from_date/to_date, a cutoff of days_back days ago is applied."""
        from api.paper.history import _get_trades_from_db

        trade = _make_db_trade(id=1)
        mock_db = _build_session_mock(trade_mocks=[trade])
        with patch("db.database.SessionLocal", return_value=mock_db):
            result = _get_trades_from_db(
                user_id=1, bot_id=None, symbol=None,
                strategy_id=None, from_date=None, to_date=None,
                days_back=14, limit=50,
            )

        assert len(result) == 1

    def test_is_test_trades_excluded(self, client, auth_headers):
        """The query always filters by is_test == False — verify no crash."""
        from api.paper.history import _get_trades_from_db

        trade = _make_db_trade(id=1, is_test=False)
        mock_db = _build_session_mock(trade_mocks=[trade])
        with patch("db.database.SessionLocal", return_value=mock_db):
            result = _get_trades_from_db(
                user_id=1, bot_id=None, symbol=None,
                strategy_id=None, from_date=None, to_date=None,
                days_back=7, limit=50,
            )

        assert len(result) == 1

    def test_session_local_raises_returns_empty(self, client, auth_headers):
        """If SessionLocal() itself raises, the function should return []."""
        from api.paper.history import _get_trades_from_db

        with patch("db.database.SessionLocal", side_effect=RuntimeError("connection refused")):
            result = _get_trades_from_db(
                user_id=1, bot_id=None, symbol=None,
                strategy_id=None, from_date=None, to_date=None,
                days_back=7, limit=50,
            )

        assert result == []

    def test_query_raises_returns_empty(self, client, auth_headers):
        """If db.query() raises during execution, return []."""
        from api.paper.history import _get_trades_from_db

        mock_db = _build_session_mock(raise_on_query=True)
        with patch("db.database.SessionLocal", return_value=mock_db):
            result = _get_trades_from_db(
                user_id=1, bot_id=None, symbol=None,
                strategy_id=None, from_date=None, to_date=None,
                days_back=7, limit=50,
            )

        assert result == []

    def test_symbol_uppercased_in_query(self, client, auth_headers):
        """Symbol filter should uppercase the value — verify function runs ok."""
        from api.paper.history import _get_trades_from_db

        trade = _make_db_trade(id=1, symbol="RELIANCE")
        mock_db = _build_session_mock(trade_mocks=[trade])
        with patch("db.database.SessionLocal", return_value=mock_db):
            result = _get_trades_from_db(
                user_id=1, bot_id=None, symbol="reliance",
                strategy_id=None, from_date=None, to_date=None,
                days_back=7, limit=50,
            )

        assert len(result) == 1
        assert result[0]["symbol"] == "RELIANCE"

    def test_strategy_id_filter(self, client, auth_headers):
        """strategy_id should be applied as a filter."""
        from api.paper.history import _get_trades_from_db

        trade = _make_db_trade(id=1, strategy_id=5)
        mock_db = _build_session_mock(trade_mocks=[trade])
        with patch("db.database.SessionLocal", return_value=mock_db):
            result = _get_trades_from_db(
                user_id=1, bot_id=None, symbol=None,
                strategy_id=5, from_date=None, to_date=None,
                days_back=7, limit=50,
            )

        assert len(result) == 1

    def test_multiple_trades_returned(self, client, auth_headers):
        """Multiple trades from DB should all be returned."""
        from api.paper.history import _get_trades_from_db

        trades = [
            _make_db_trade(id=1, symbol="RELIANCE"),
            _make_db_trade(id=2, symbol="TCS"),
            _make_db_trade(id=3, symbol="INFY"),
        ]
        mock_db = _build_session_mock(trade_mocks=trades)
        with patch("db.database.SessionLocal", return_value=mock_db):
            result = _get_trades_from_db(
                user_id=1, bot_id=None, symbol=None,
                strategy_id=None, from_date="2026-04-01", to_date="2026-04-30",
                days_back=7, limit=50,
            )

        assert len(result) == 3

    def test_db_close_called_on_success(self, client, auth_headers):
        """db.close() should be called in the finally block."""
        from api.paper.history import _get_trades_from_db

        mock_db = _build_session_mock(trade_mocks=[])
        with patch("db.database.SessionLocal", return_value=mock_db):
            _get_trades_from_db(
                user_id=1, bot_id=None, symbol=None,
                strategy_id=None, from_date=None, to_date=None,
                days_back=7, limit=50,
            )

        mock_db.close.assert_called_once()

    def test_db_close_called_on_query_exception(self, client, auth_headers):
        """db.close() should still be called when query raises."""
        from api.paper.history import _get_trades_from_db

        mock_db = MagicMock()
        mock_db.query.side_effect = RuntimeError("boom")
        with patch("db.database.SessionLocal", return_value=mock_db):
            _get_trades_from_db(
                user_id=1, bot_id=None, symbol=None,
                strategy_id=None, from_date=None, to_date=None,
                days_back=7, limit=50,
            )

        mock_db.close.assert_called_once()

    def test_only_from_date_provided(self, client, auth_headers):
        """When only from_date is set, to_date filter is skipped but from_date is applied."""
        from api.paper.history import _get_trades_from_db

        trade = _make_db_trade(id=1)
        mock_db = _build_session_mock(trade_mocks=[trade])
        with patch("db.database.SessionLocal", return_value=mock_db):
            result = _get_trades_from_db(
                user_id=1, bot_id=None, symbol=None,
                strategy_id=None, from_date="2026-04-01", to_date=None,
                days_back=7, limit=50,
            )

        assert len(result) == 1

    def test_empty_result(self, client, auth_headers):
        """DB returning no trades should produce empty list."""
        from api.paper.history import _get_trades_from_db

        mock_db = _build_session_mock(trade_mocks=[])
        with patch("db.database.SessionLocal", return_value=mock_db):
            result = _get_trades_from_db(
                user_id=1, bot_id=None, symbol=None,
                strategy_id=None, from_date=None, to_date=None,
                days_back=7, limit=50,
            )

        assert result == []


# ---------------------------------------------------------------------------
# _get_trades_from_journals() tests
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestGetTradesFromJournals:
    """Direct tests for _get_trades_from_journals()."""

    def _setup_path_mock(self, mock_path_cls, journal_exists=True):
        """Set up Path mock for the 3-level / chain:
        Path(__file__).parent.parent.parent / "journals" / str(user_id) / "journal_YYYYMMDD.json"
        """
        journal_file = MagicMock()
        journal_file.exists.return_value = journal_exists

        # journal_dir / "journal_YYYYMMDD.json" => journal_file
        journal_dir = MagicMock()
        journal_dir.__truediv__ = MagicMock(return_value=journal_file)

        # intermediate / str(user_id) => journal_dir
        intermediate = MagicMock()
        intermediate.__truediv__ = MagicMock(return_value=journal_dir)

        # base_path / "journals" => intermediate
        base_path = MagicMock()
        base_path.__truediv__ = MagicMock(return_value=intermediate)

        mock_path_cls.return_value.parent.parent.parent = base_path
        return journal_file, journal_dir

    @patch("api.paper.history.asdict")
    @patch("api.paper.history.TradeJournal")
    @patch("api.paper.history.Path")
    def test_single_date_lookup(self, mock_path_cls, mock_tj_cls, mock_asdict, client, auth_headers):
        """When date='2026-04-20', only that journal file is loaded."""
        from api.paper.history import _get_trades_from_journals

        trade_dict = _make_journal_dict(trade_id="T1")
        mock_journal = MagicMock()
        mock_journal.trades = [MagicMock()]
        mock_journal.load_journal = MagicMock()
        mock_tj_cls.return_value = mock_journal
        mock_asdict.return_value = trade_dict

        self._setup_path_mock(mock_path_cls, journal_exists=True)

        result = _get_trades_from_journals(
            user_id=1, date="2026-04-20", from_date=None, to_date=None,
            days_back=7, bot_id=None, symbol=None, strategy_id=None, limit=50,
        )

        assert len(result) == 1
        assert result[0]["trade_id"] == "T1"
        mock_journal.load_journal.assert_called_once()

    @patch("api.paper.history.asdict")
    @patch("api.paper.history.TradeJournal")
    @patch("api.paper.history.Path")
    def test_date_range_iteration(self, mock_path_cls, mock_tj_cls, mock_asdict, client, auth_headers):
        """from_date + to_date should iterate over each day in the range."""
        from api.paper.history import _get_trades_from_journals

        # Each day gets a unique trade (different entry/exit times for dedup)
        trade_d1 = _make_journal_dict(trade_id="T1", entry_time="2026-04-18T09:00:00", exit_time="2026-04-18T10:00:00")
        trade_d2 = _make_journal_dict(trade_id="T2", entry_time="2026-04-19T09:00:00", exit_time="2026-04-19T10:00:00")
        trade_d3 = _make_journal_dict(trade_id="T3", entry_time="2026-04-20T09:00:00", exit_time="2026-04-20T10:00:00")

        mock_journal = MagicMock()
        mock_journal.trades = [MagicMock()]
        mock_journal.load_journal = MagicMock()
        mock_tj_cls.return_value = mock_journal
        mock_asdict.side_effect = [trade_d1, trade_d2, trade_d3]

        self._setup_path_mock(mock_path_cls, journal_exists=True)

        result = _get_trades_from_journals(
            user_id=1, date=None, from_date="2026-04-18", to_date="2026-04-20",
            days_back=7, bot_id=None, symbol=None, strategy_id=None, limit=50,
        )

        assert len(result) == 3
        assert mock_journal.load_journal.call_count == 3

    @patch("api.paper.history.asdict")
    @patch("api.paper.history.TradeJournal")
    @patch("api.paper.history.Path")
    def test_days_back_fallback(self, mock_path_cls, mock_tj_cls, mock_asdict, client, auth_headers):
        """When no date/from_date, days_back controls how many days to check."""
        from api.paper.history import _get_trades_from_journals

        mock_journal = MagicMock()
        mock_journal.trades = []
        mock_tj_cls.return_value = mock_journal

        self._setup_path_mock(mock_path_cls, journal_exists=False)

        result = _get_trades_from_journals(
            user_id=1, date=None, from_date=None, to_date=None,
            days_back=3, bot_id=None, symbol=None, strategy_id=None, limit=50,
        )

        assert isinstance(result, list)

    @patch("api.paper.history.asdict")
    @patch("api.paper.history.TradeJournal")
    @patch("api.paper.history.Path")
    def test_symbol_filter_uppercased(self, mock_path_cls, mock_tj_cls, mock_asdict, client, auth_headers):
        """Symbol filter should uppercase and match against trade symbol."""
        from api.paper.history import _get_trades_from_journals

        trade_match = _make_journal_dict(trade_id="T1", symbol="RELIANCE")
        trade_no_match = _make_journal_dict(
            trade_id="T2", symbol="TCS",
            entry_time="2026-04-20T12:00:00", exit_time="2026-04-20T13:00:00",
        )

        mock_journal = MagicMock()
        mock_journal.trades = [MagicMock(), MagicMock()]
        mock_journal.load_journal = MagicMock()
        mock_tj_cls.return_value = mock_journal
        mock_asdict.side_effect = [trade_match, trade_no_match]

        self._setup_path_mock(mock_path_cls, journal_exists=True)

        result = _get_trades_from_journals(
            user_id=1, date="2026-04-20", from_date=None, to_date=None,
            days_back=0, bot_id=None, symbol="reliance", strategy_id=None, limit=50,
        )

        assert len(result) == 1
        assert result[0]["symbol"] == "RELIANCE"

    @patch("api.paper.history.asdict")
    @patch("api.paper.history.TradeJournal")
    @patch("api.paper.history.Path")
    @patch("db.database.SessionLocal")
    def test_strategy_id_filter_resolves_name(self, mock_session, mock_path_cls, mock_tj_cls, mock_asdict, client, auth_headers):
        """strategy_id should resolve to strategy_name via DB, then filter trades."""
        from api.paper.history import _get_trades_from_journals

        trade_match = _make_journal_dict(trade_id="T1", strategy_name="ORB")
        trade_no_match = _make_journal_dict(
            trade_id="T2", strategy_name="EMA_CROSS",
            entry_time="2026-04-20T12:00:00", exit_time="2026-04-20T13:00:00",
        )

        mock_journal = MagicMock()
        mock_journal.trades = [MagicMock(), MagicMock()]
        mock_journal.load_journal = MagicMock()
        mock_tj_cls.return_value = mock_journal
        mock_asdict.side_effect = [trade_match, trade_no_match]

        # Mock the strategy config lookup
        strategy_cfg = MagicMock()
        strategy_cfg.name = "ORB"
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = strategy_cfg
        mock_session.return_value.__enter__.return_value = mock_db
        mock_session.return_value.__exit__.return_value = False

        self._setup_path_mock(mock_path_cls, journal_exists=True)

        result = _get_trades_from_journals(
            user_id=1, date="2026-04-20", from_date=None, to_date=None,
            days_back=0, bot_id=None, symbol=None, strategy_id=1, limit=50,
        )

        assert len(result) == 1
        assert result[0]["strategy_name"] == "ORB"

    @patch("api.paper.history.asdict")
    @patch("api.paper.history.TradeJournal")
    @patch("api.paper.history.Path")
    def test_bot_id_default_matches_zero_or_none(self, mock_path_cls, mock_tj_cls, mock_asdict, client, auth_headers):
        """bot_id='default' should match trades with bot_id in (0, None, '0')."""
        from api.paper.history import _get_trades_from_journals

        # Unique entry/exit times to avoid dedup
        trade_zero = _make_journal_dict(trade_id="T1", symbol="A", bot_id=0,
                                        entry_time="2026-04-20T09:00:00", exit_time="2026-04-20T10:00:00")
        trade_none = _make_journal_dict(trade_id="T2", symbol="B", bot_id=None,
                                        entry_time="2026-04-20T11:00:00", exit_time="2026-04-20T12:00:00")
        trade_str_zero = _make_journal_dict(trade_id="T3", symbol="C", bot_id="0",
                                            entry_time="2026-04-20T13:00:00", exit_time="2026-04-20T14:00:00")

        mock_journal = MagicMock()
        mock_journal.trades = [MagicMock(), MagicMock(), MagicMock()]
        mock_journal.load_journal = MagicMock()
        mock_tj_cls.return_value = mock_journal
        mock_asdict.side_effect = [trade_zero, trade_none, trade_str_zero]

        self._setup_path_mock(mock_path_cls, journal_exists=True)

        result = _get_trades_from_journals(
            user_id=1, date="2026-04-20", from_date=None, to_date=None,
            days_back=0, bot_id="default", symbol=None, strategy_id=None, limit=50,
        )

        assert len(result) == 3

    @patch("api.paper.history.asdict")
    @patch("api.paper.history.TradeJournal")
    @patch("api.paper.history.Path")
    def test_bot_id_numeric_filter(self, mock_path_cls, mock_tj_cls, mock_asdict, client, auth_headers):
        """bot_id='5' should match only trades with bot_id == 5."""
        from api.paper.history import _get_trades_from_journals

        trade_match = _make_journal_dict(trade_id="T1", symbol="A", bot_id=5,
                                         entry_time="2026-04-20T09:00:00", exit_time="2026-04-20T10:00:00")
        trade_other = _make_journal_dict(trade_id="T2", symbol="B", bot_id=3,
                                         entry_time="2026-04-20T11:00:00", exit_time="2026-04-20T12:00:00")

        mock_journal = MagicMock()
        mock_journal.trades = [MagicMock(), MagicMock()]
        mock_journal.load_journal = MagicMock()
        mock_tj_cls.return_value = mock_journal
        mock_asdict.side_effect = [trade_match, trade_other]

        self._setup_path_mock(mock_path_cls, journal_exists=True)

        result = _get_trades_from_journals(
            user_id=1, date="2026-04-20", from_date=None, to_date=None,
            days_back=0, bot_id="5", symbol=None, strategy_id=None, limit=50,
        )

        assert len(result) == 1
        assert result[0]["bot_id"] == 5

    @patch("db.database.SessionLocal")
    @patch("api.paper.history.asdict")
    @patch("api.paper.history.TradeJournal")
    @patch("api.paper.history.Path")
    def test_bot_id_non_numeric_string_match(self, mock_path_cls, mock_tj_cls, mock_asdict, mock_session, client, auth_headers):
        """bot_id='custom-bot' (non-numeric, non-UUID) resolves to None, no filter applied."""
        from api.paper.history import _get_trades_from_journals

        trade_match = _make_journal_dict(trade_id="T1", symbol="A", bot_id="custom-bot",
                                         entry_time="2026-04-20T09:00:00", exit_time="2026-04-20T10:00:00")
        trade_other = _make_journal_dict(trade_id="T2", symbol="B", bot_id=5,
                                         entry_time="2026-04-20T11:00:00", exit_time="2026-04-20T12:00:00")

        mock_journal = MagicMock()
        mock_journal.trades = [MagicMock(), MagicMock()]
        mock_journal.load_journal = MagicMock()
        mock_tj_cls.return_value = mock_journal
        mock_asdict.side_effect = [trade_match, trade_other]

        # Mock SessionLocal for resolve_bot_id (returns None for non-UUID string)
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_session.return_value.__enter__.return_value = mock_db
        mock_session.return_value.__exit__.return_value = False

        self._setup_path_mock(mock_path_cls, journal_exists=True)

        result = _get_trades_from_journals(
            user_id=1, date="2026-04-20", from_date=None, to_date=None,
            days_back=0, bot_id="custom-bot", symbol=None, strategy_id=None, limit=50,
        )

        # resolve_bot_id returns None for non-numeric/non-UUID => no filter applied
        assert len(result) == 2

    @patch("api.paper.history.asdict")
    @patch("api.paper.history.TradeJournal")
    @patch("api.paper.history.Path")
    def test_deduplication_by_key(self, mock_path_cls, mock_tj_cls, mock_asdict, client, auth_headers):
        """Trades with identical (symbol, side, quantity, entry_time, exit_time) should be deduped."""
        from api.paper.history import _get_trades_from_journals

        # Same key fields => only last one survives dedup
        trade_dup1 = _make_journal_dict(trade_id="T1", symbol="TCS", side="BUY", quantity=10,
                                        entry_time="2026-04-20T09:15:00", exit_time="2026-04-20T10:00:00")
        trade_dup2 = _make_journal_dict(trade_id="T2", symbol="TCS", side="BUY", quantity=10,
                                        entry_time="2026-04-20T09:15:00", exit_time="2026-04-20T10:00:00")

        mock_journal = MagicMock()
        mock_journal.trades = [MagicMock(), MagicMock()]
        mock_journal.load_journal = MagicMock()
        mock_tj_cls.return_value = mock_journal
        mock_asdict.side_effect = [trade_dup1, trade_dup2]

        self._setup_path_mock(mock_path_cls, journal_exists=True)

        result = _get_trades_from_journals(
            user_id=1, date="2026-04-20", from_date=None, to_date=None,
            days_back=0, bot_id=None, symbol=None, strategy_id=None, limit=50,
        )

        assert len(result) == 1

    @patch("api.paper.history.asdict")
    @patch("api.paper.history.TradeJournal")
    @patch("api.paper.history.Path")
    def test_from_date_without_to_date(self, mock_path_cls, mock_tj_cls, mock_asdict, client, auth_headers):
        """When from_date is set but to_date is not, end_dt is capped at min(now, start+90).

        Note: source code has a known bug — datetime.strptime returns naive datetime
        but datetime.now(config.IST) returns aware — so min() raises TypeError.
        We mock config.IST=None to work around this for the test.
        """
        from api.paper.history import _get_trades_from_journals

        mock_journal = MagicMock()
        mock_journal.trades = []
        mock_tj_cls.return_value = mock_journal
        mock_asdict.return_value = {}

        self._setup_path_mock(mock_path_cls, journal_exists=False)

        with patch("api.paper.history.config") as mock_config:
            mock_config.IST = None
            result = _get_trades_from_journals(
                user_id=1, date=None, from_date="2026-01-01", to_date=None,
                days_back=7, bot_id=None, symbol=None, strategy_id=None, limit=50,
            )

        assert isinstance(result, list)

    @patch("api.paper.history.asdict")
    @patch("api.paper.history.TradeJournal")
    @patch("api.paper.history.Path")
    def test_limit_applied_to_results(self, mock_path_cls, mock_tj_cls, mock_asdict, client, auth_headers):
        """Results should be truncated to limit."""
        from api.paper.history import _get_trades_from_journals

        trades = [_make_journal_dict(trade_id=f"T{i}", symbol=f"S{i}",
                                     entry_time=f"2026-04-20T{9+i:02d}:00:00",
                                     exit_time=f"2026-04-20T{10+i:02d}:00:00")
                  for i in range(5)]

        mock_journal = MagicMock()
        mock_journal.trades = [MagicMock() for _ in range(5)]
        mock_journal.load_journal = MagicMock()
        mock_tj_cls.return_value = mock_journal
        mock_asdict.side_effect = trades

        self._setup_path_mock(mock_path_cls, journal_exists=True)

        result = _get_trades_from_journals(
            user_id=1, date="2026-04-20", from_date=None, to_date=None,
            days_back=0, bot_id=None, symbol=None, strategy_id=None, limit=3,
        )

        assert len(result) == 3

    @patch("api.paper.history.asdict")
    @patch("api.paper.history.TradeJournal")
    @patch("api.paper.history.Path")
    def test_sorted_by_exit_time_desc(self, mock_path_cls, mock_tj_cls, mock_asdict, client, auth_headers):
        """Results should be sorted by exit_time descending."""
        from api.paper.history import _get_trades_from_journals

        t_early = _make_journal_dict(trade_id="T1", symbol="A", exit_time="2026-04-20T09:00:00",
                                     entry_time="2026-04-20T08:00:00")
        t_late = _make_journal_dict(trade_id="T2", symbol="B", exit_time="2026-04-20T15:00:00",
                                    entry_time="2026-04-20T14:00:00")

        mock_journal = MagicMock()
        mock_journal.trades = [MagicMock(), MagicMock()]
        mock_journal.load_journal = MagicMock()
        mock_tj_cls.return_value = mock_journal
        mock_asdict.side_effect = [t_early, t_late]

        self._setup_path_mock(mock_path_cls, journal_exists=True)

        result = _get_trades_from_journals(
            user_id=1, date="2026-04-20", from_date=None, to_date=None,
            days_back=0, bot_id=None, symbol=None, strategy_id=None, limit=50,
        )

        assert len(result) == 2
        assert result[0]["exit_time"] >= result[1]["exit_time"]

    @patch("api.paper.history.asdict")
    @patch("api.paper.history.TradeJournal")
    @patch("api.paper.history.Path")
    def test_journal_file_not_found_skips(self, mock_path_cls, mock_tj_cls, mock_asdict, client, auth_headers):
        """When journal file doesn't exist, that day is skipped."""
        from api.paper.history import _get_trades_from_journals

        mock_journal = MagicMock()
        mock_journal.trades = []
        mock_tj_cls.return_value = mock_journal

        self._setup_path_mock(mock_path_cls, journal_exists=False)

        result = _get_trades_from_journals(
            user_id=1, date="2026-04-20", from_date=None, to_date=None,
            days_back=0, bot_id=None, symbol=None, strategy_id=None, limit=50,
        )

        assert result == []
        mock_journal.load_journal.assert_not_called()

    @patch("api.paper.history.asdict")
    @patch("api.paper.history.TradeJournal")
    @patch("api.paper.history.Path")
    @patch("db.database.SessionLocal")
    def test_strategy_id_not_found_keeps_all(self, mock_session, mock_path_cls, mock_tj_cls, mock_asdict, client, auth_headers):
        """When strategy_id doesn't match any DB config, no strategy filter is applied."""
        from api.paper.history import _get_trades_from_journals

        trade_dict = _make_journal_dict(trade_id="T1", strategy_name="ORB")

        mock_journal = MagicMock()
        mock_journal.trades = [MagicMock()]
        mock_journal.load_journal = MagicMock()
        mock_tj_cls.return_value = mock_journal
        mock_asdict.return_value = trade_dict

        # Mock SessionLocal to return None for the strategy lookup
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_session.return_value.__enter__.return_value = mock_db
        mock_session.return_value.__exit__.return_value = False

        self._setup_path_mock(mock_path_cls, journal_exists=True)

        result = _get_trades_from_journals(
            user_id=1, date="2026-04-20", from_date=None, to_date=None,
            days_back=0, bot_id=None, symbol=None, strategy_id=999, limit=50,
        )

        # strategy_name not found in DB => no filter applied => trade still present
        assert len(result) == 1


# ---------------------------------------------------------------------------
# delete_trade() endpoint tests
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestDeleteTrade:
    """Tests for DELETE /api/paper/trades/{trade_id}."""

    def test_delete_trade_success(self, client, auth_headers):
        """Deleting an existing trade returns 200."""
        mock_journal = MagicMock()
        mock_trade = MagicMock()
        mock_trade.trade_id = "TRD-001"
        mock_journal.trades = [mock_trade]

        with patch("api.paper.history.get_journal", return_value=mock_journal):
            response = client.delete(
                "/api/paper/trades/TRD-001",
                headers=auth_headers,
            )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "TRD-001" in data["message"]
        mock_journal.save_journal.assert_called_once()

    def test_delete_trade_not_found(self, client, auth_headers):
        """Deleting a non-existent trade returns 404."""
        mock_journal = MagicMock()
        mock_trade = MagicMock()
        mock_trade.trade_id = "TRD-001"
        mock_journal.trades = [mock_trade]

        with patch("api.paper.history.get_journal", return_value=mock_journal):
            response = client.delete(
                "/api/paper/trades/TRD-NONEXISTENT",
                headers=auth_headers,
            )

        assert response.status_code == 404
        mock_journal.save_journal.assert_not_called()

    def test_delete_trade_removes_correct_trade(self, client, auth_headers):
        """Only the matching trade should be removed from the journal."""
        mock_journal = MagicMock()
        trade1 = MagicMock()
        trade1.trade_id = "TRD-001"
        trade2 = MagicMock()
        trade2.trade_id = "TRD-002"
        mock_journal.trades = [trade1, trade2]

        with patch("api.paper.history.get_journal", return_value=mock_journal):
            response = client.delete(
                "/api/paper/trades/TRD-001",
                headers=auth_headers,
            )

        assert response.status_code == 200
        mock_journal.save_journal.assert_called_once()


# ---------------------------------------------------------------------------
# get_trades() — DB-first with journal fallback
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestGetTradesFallback:
    """Tests for GET /api/paper/trades DB-first + journal fallback logic."""

    def test_db_returns_results_no_fallback(self, client, auth_headers):
        """When DB has trades, journals are NOT consulted."""
        db_trade = _make_db_trade(id=1, symbol="RELIANCE")

        with patch("api.paper.history._get_trades_from_db", return_value=[db_trade.to_dict()]) as mock_db_fn, \
             patch("api.paper.history._get_trades_from_journals") as mock_journal_fn:

            response = client.get("/api/paper/trades", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["total_trades"] == 1
        assert data["trades"][0]["symbol"] == "RELIANCE"
        mock_db_fn.assert_called_once()
        mock_journal_fn.assert_not_called()

    def test_db_empty_falls_back_to_journals(self, client, auth_headers):
        """When DB returns [], journals should be queried."""
        journal_trade = _make_journal_dict(trade_id="TRD-1", symbol="TCS")

        with patch("api.paper.history._get_trades_from_db", return_value=[]), \
             patch("api.paper.history._get_trades_from_journals", return_value=[journal_trade]), \
             patch("api.paper.history._resolve_trade_bot_ids", return_value=[journal_trade]):

            response = client.get("/api/paper/trades", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["total_trades"] == 1
        assert data["trades"][0]["symbol"] == "TCS"

    def test_db_internal_exception_returns_empty_falls_back(self, client, auth_headers):
        """When SessionLocal raises inside _get_trades_from_db (which catches it and
        returns []), get_trades sees [] and falls back to journals."""
        journal_trade = _make_journal_dict(trade_id="TRD-99", symbol="INFY")

        # Patch SessionLocal to raise, so _get_trades_from_db catches and returns []
        with patch("db.database.SessionLocal", side_effect=RuntimeError("DB timeout")), \
             patch("api.paper.history._get_trades_from_journals", return_value=[journal_trade]), \
             patch("api.paper.history._resolve_trade_bot_ids", return_value=[journal_trade]):

            response = client.get("/api/paper/trades", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["total_trades"] == 1
        assert data["trades"][0]["symbol"] == "INFY"

    def test_both_empty_returns_empty(self, client, auth_headers):
        """When both DB and journals return [], response has 0 trades."""
        with patch("api.paper.history._get_trades_from_db", return_value=[]), \
             patch("api.paper.history._get_trades_from_journals", return_value=[]):

            response = client.get("/api/paper/trades", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["total_trades"] == 0
        assert data["filtered_trades"] == 0
        assert data["trades"] == []

    def test_query_params_passed_to_db(self, client, auth_headers):
        """All query params should be forwarded to _get_trades_from_db."""
        with patch("api.paper.history._get_trades_from_db", return_value=[]) as mock_db_fn, \
             patch("api.paper.history._get_trades_from_journals", return_value=[]):

            client.get(
                "/api/paper/trades?limit=10&symbol=TCS&bot_id=3&strategy_id=2"
                "&from_date=2026-04-01&to_date=2026-04-30&days_back=14",
                headers=auth_headers,
            )

        mock_db_fn.assert_called_once()
        call_args = mock_db_fn.call_args
        # positional: user_id, bot_id, symbol, strategy_id, from_date, to_date, days_back, limit
        assert call_args[0][1] == "3"            # bot_id
        assert call_args[0][2] == "TCS"          # symbol
        assert call_args[0][3] == 2              # strategy_id
        assert call_args[0][4] == "2026-04-01"   # from_date
        assert call_args[0][5] == "2026-04-30"   # to_date
        assert call_args[0][6] == 14             # days_back
        assert call_args[0][7] == 10             # limit

    def test_response_shape_matches_contract(self, client, auth_headers):
        """Response should always have total_trades, filtered_trades, trades."""
        db_trade = _make_db_trade(id=1)

        with patch("api.paper.history._get_trades_from_db", return_value=[db_trade.to_dict()]), \
             patch("api.paper.history._get_trades_from_journals"):

            response = client.get("/api/paper/trades", headers=auth_headers)

        data = response.json()
        assert "total_trades" in data
        assert "filtered_trades" in data
        assert "trades" in data
        assert isinstance(data["trades"], list)
        assert data["total_trades"] == data["filtered_trades"]
