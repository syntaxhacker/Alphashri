"""``options_paper.manual enter`` — the ratchet parameters are per position.

A 20% giveback cut a winner on 2026-10-22 that then ran 40 more points, so
the trail and the breakeven trigger are now CLI flags that travel WITH the
position (the runner's ratchet reads them off the ledger).
"""

from __future__ import annotations

import json

import pytest

from options_paper import manual
from options_paper.tape import Tick


def _tick() -> Tick:
    return Tick(t=__import__("datetime").datetime(2026, 10, 22, 11, 0),
                spot=22_700.0, atm_strike=22_700.0, ce_ltp=180.0, pe_ltp=150.0,
                ce_iv=12.0, pe_iv=13.0, expiry="2026-10-27",
                chain={22_700: (180.0, 150.0)})


@pytest.fixture()
def _ledger(tmp_path, monkeypatch):
    ledger = tmp_path / "agent_positions.json"
    monkeypatch.setattr(manual, "LEDGER", ledger)
    monkeypatch.setattr(manual, "_last_tick", lambda: _tick())
    return ledger


def _args(*extra: str):
    return manual.main([
        "enter", "--opt", "CE", "--strike", "22700", "--premium", "180",
        "--stop", "135", "--target", "270", *extra,
    ])


class TestFlagParsing:
    def test_defaults_are_unchanged(self, _ledger):
        assert _args() == 0
        pos = json.loads(_ledger.read_text())["positions"][0]
        assert pos["be_trigger"] == 0.08
        assert pos["trail_pct"] == 0.20

    def test_the_flags_are_parsed_and_stored(self, _ledger):
        assert _args("--trail-pct", "0.35", "--be-trigger", "0.05") == 0
        pos = json.loads(_ledger.read_text())["positions"][0]
        assert pos["trail_pct"] == 0.35
        assert pos["be_trigger"] == 0.05

    def test_a_looser_trail_is_allowed(self, _ledger):
        assert _args("--trail-pct", "0.6") == 0
        pos = json.loads(_ledger.read_text())["positions"][0]
        assert pos["trail_pct"] == 0.6


class TestRangeValidation:
    @pytest.mark.parametrize("bad", ["0.95", "1.5", "-0.1"])
    def test_an_out_of_range_trail_is_refused(self, _ledger, bad, capsys):
        assert _args("--trail-pct", bad) == 2
        assert "--trail-pct" in capsys.readouterr().out
        assert not _ledger.exists(), "a refused position must not be stored"

    def test_a_negative_be_trigger_is_refused(self, _ledger, capsys):
        assert _args("--be-trigger", "-0.01") == 2
        assert "--be-trigger" in capsys.readouterr().out
        assert not _ledger.exists()

    def test_zero_is_allowed_for_both(self, _ledger):
        """0 disables the ratchet — a valid choice, not an error."""
        assert _args("--trail-pct", "0", "--be-trigger", "0") == 0
        pos = json.loads(_ledger.read_text())["positions"][0]
        assert pos["trail_pct"] == 0
        assert pos["be_trigger"] == 0


class TestTheRatchetUsesTheStoredValues:
    def test_a_tighter_trail_keeps_more_of_the_profit(self, _ledger, monkeypatch):
        """The stored trail_pct is what the ratchet uses.

        Entry 100, best 120 (+20%): a 20% trail gives back 20% of the profit
        → stop 116; a 50% trail → stop 110.
        """
        ledger = _ledger
        ledger.write_text(json.dumps({"positions": [{
            "opt": "CE", "strike": 22_700, "direction": "LONG", "lots": 1,
            "qty": 65, "entry_premium": 100.0,
            "entry_time": "2026-10-22T11:00:00+05:30", "entry_spot": 22_700.0,
            "expiry": "2026-10-27", "stop": 80.0, "target": 200.0, "best": 100.0,
            "be_trigger": 0.05, "trail_pct": 0.5,
            "reason": "test",
        }]}))
        monkeypatch.setattr(manual, "_load_triggers", lambda: [])
        monkeypatch.setattr(manual, "_save_triggers", lambda ts: None)
        tk = Tick(t=__import__("datetime").datetime(2026, 10, 22, 11, 10),
                  spot=22_700.0, atm_strike=22_700.0, ce_ltp=0.0, pe_ltp=0.0,
                  ce_iv=12.0, pe_iv=12.0, expiry="2026-10-27",
                  chain={22_700: (120.0, 0.0)})
        manual.auto_manage(tk)
        pos = json.loads(ledger.read_text())["positions"][0]
        # best 120, entry 100 → profit 20 → 50% trail keeps half: stop 110.
        assert 109.0 <= pos["stop"] <= 111.0
