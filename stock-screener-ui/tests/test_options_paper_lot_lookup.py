"""Lot lookup must tolerate spaced instrument-master names (LAURUS LABS LIMITED)."""
from __future__ import annotations

import sqlite3
from unittest.mock import MagicMock

from options_paper import spec


def test_master_lot_lookup_is_space_insensitive(monkeypatch):
    con = MagicMock()
    con.execute.return_value.fetchone.return_value = (850,)
    monkeypatch.setattr(sqlite3, "connect", lambda *args, **kwargs: con)

    assert spec._lookup_master_lot("LAURUSLABS") == 850
    sql = con.execute.call_args[0][0]
    assert "replace(upper(name)" in sql
    assert "%LAURUSLABS%" in con.execute.call_args[0][1]


def test_master_hint_takes_precedence_when_present(monkeypatch):
    con = MagicMock()
    con.execute.return_value.fetchone.return_value = None
    monkeypatch.setattr(sqlite3, "connect", lambda *args, **kwargs: con)
    assert spec._lookup_master_lot("BHARTIARTL") is None
    assert "%BHARTIAIRTEL%" in con.execute.call_args[0][1]
