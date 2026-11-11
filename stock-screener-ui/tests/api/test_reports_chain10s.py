"""10s chain snapshots + 1s tick tape: pure shaping and endpoint contracts."""

from __future__ import annotations

import json

import pytest

from api.reports_api import chain10s, ticks


@pytest.fixture()
def tmp_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(chain10s, "_dir", lambda: tmp_path)
    monkeypatch.setattr(ticks, "_dir", lambda: tmp_path)
    return tmp_path


def test_slim_rows_keeps_only_the_atm_window_and_sorts():
    rows = [
        {"strike": 22700, "ce": {"ltp": 10, "oi": 100, "volume": 5}, "pe": {"ltp": 20, "oi": 200, "volume": 6}},
        {"strike": 21000, "ce": {"ltp": 1, "oi": 1, "volume": 1}, "pe": {"ltp": 2, "oi": 2, "volume": 2}},
        {"strike": 22600, "ce": {"ltp": 30, "oi": 300}, "pe": {"ltp": 40, "oi": 400}},
    ]
    out = chain10s.slim_rows(rows, spot=22650, window=100)
    assert [r[0] for r in out] == [22600.0, 22700.0]
    # missing volume/ltp legs are 0, never None
    assert out[0] == [22600.0, 30.0, 300.0, 0.0, 40.0, 400.0, 0.0]


def test_slim_rows_skips_bad_strikes():
    out = chain10s.slim_rows(
        [{"strike": None}, {"strike": "bad"}, {"strike": 22500, "ce": {}, "pe": {}}],
        spot=22500,
    )
    assert [r[0] for r in out] == [22500.0]


def test_chain10s_endpoint_windows_and_limits(tmp_dir):
    path = tmp_dir / "2026-10-23.jsonl"
    for hm in ("13:30", "13:31", "13:32", "13:33"):
        path.write_text(path.read_text() + json.dumps({"t": f"2026-10-23T{hm}:00+05:30", "spot": 22500, "rows": []}) + "\n" if path.exists() else json.dumps({"t": f"2026-10-23T{hm}:00+05:30", "spot": 22500, "rows": []}) + "\n")
    out = chain10s.get_chain10s(date="2026-10-23", start="13:31", end="13:32", limit=10)
    assert out["count"] == 2
    assert [r["t"][11:16] for r in out["rows"]] == ["13:31", "13:32"]
    # limit keeps the newest
    out = chain10s.get_chain10s(date="2026-10-23", limit=2)
    assert [r["t"][11:16] for r in out["rows"]] == ["13:32", "13:33"]


def test_chain10s_summary_aggregates_both_legs(tmp_dir):
    path = tmp_dir / "2026-10-23.jsonl"
    snap = {
        "t": "2026-10-23T13:30:00+05:30",
        "spot": 22500,
        "rows": [
            [22500, 100, 10, 1, 90, 20, 2],
            [22600, 50, 5, 3, 120, 7, 4],
        ],
    }
    path.write_text(json.dumps(snap) + "\n")
    out = chain10s.get_chain10s(date="2026-10-23", limit=10, summary=True)
    assert "rows" not in out
    row = out["summary"][0]
    assert {k: row[k] for k in ("t", "spot", "ce_oi", "pe_oi", "ce_vol", "pe_vol")} == {
        "t": "2026-10-23T13:30:00+05:30",
        "spot": 22500,
        "ce_oi": 15,
        "pe_oi": 27,
        "ce_vol": 4,
        "pe_vol": 6,
    }
    # ATM premium: nearest strike to the 22,500 spot.
    assert row["atm_strike"] == 22500
    assert row["ce_prem"] == 100
    assert row["pe_prem"] == 90


def test_chain10s_summary_is_stable_when_the_strike_window_shifts(tmp_dir):
    """The poller's ±30 window rolls on a 50-pt boundary; the summary must not
    read the dropped/added strike as a multi-million OI blast."""
    path = tmp_dir / "2026-10-23.jsonl"
    a = {
        "t": "2026-10-23T12:24:02+05:30",
        "spot": 22599.25,
        "rows": [
            [22500, 100, 10, 1, 90, 30, 2],
            [22600, 100, 20, 1, 90, 40, 2],
        ],
    }
    b = {
        "t": "2026-10-23T12:24:12+05:30",
        "spot": 22607.1,
        "rows": [
            [22600, 100, 20, 1, 90, 40, 2],
            [22700, 100, 50, 1, 90, 60, 2],  # the added strike
        ],
    }
    path.write_text(json.dumps(a) + "\n" + json.dumps(b) + "\n")
    out = chain10s.get_chain10s(date="2026-10-23", limit=10, summary=True)
    assert [p["ce_oi"] for p in out["summary"]] == [20, 20]
    assert [p["pe_oi"] for p in out["summary"]] == [40, 40]


def test_spot_blasts_detect_a_fast_move_and_dedupe_it(tmp_dir):
    path = tmp_dir / "2026-10-26.jsonl"
    lines = [
        json.dumps({"t": "2026-10-26T12:28:00+05:30", "spot": 22590.0}),
        json.dumps({"t": "2026-10-26T12:28:05+05:30", "spot": 22595.0}),
        json.dumps({"t": "2026-10-26T12:28:10+05:30", "spot": 22605.0}),
        # Same run, 5 s later — must collapse into the same 30 s bucket.
        json.dumps({"t": "2026-10-26T12:28:15+05:30", "spot": 22607.0}),
    ]
    path.write_text("\n".join(lines) + "\n")
    out = ticks.get_spot_blasts(date="2026-10-26", window=10, min_pts=8, lookback_min=5)
    assert out["count"] == 1
    blast = out["blasts"][0]
    assert blast["direction"] == "up"
    assert blast["delta"] >= 8
    assert blast["from_spot"] == 22590.0


def test_chain_blasts_fire_on_a_real_oi_and_volume_step(tmp_dir, monkeypatch):
    import statistics
    from api.reports_api import chain10s as c10

    monkeypatch.setattr(c10, "_dir", lambda: tmp_dir)
    path = tmp_dir / "2026-10-26.jsonl"
    def snap(hm, ce_oi, ce_vol, pe_oi=100_000_000, pe_vol=50_000_000):
        return {
            "t": f"2026-10-26T{hm}:00+05:30",
            "spot": 22600,
            "rows": [
                [22600, 100, ce_oi, ce_vol, 90, pe_oi, pe_vol],
                [22650, 100, 1_000_000, 1_000_000, 90, 1_000_000, 1_000_000],
            ],
        }
    path.write_text("\n".join(json.dumps(x) for x in [
        snap("12:00:00", 100_000_000, 10_000_000),
        snap("12:00:10", 100_000_000, 10_000_000),
        snap("12:00:20", 105_000_000, 30_000_000),
        snap("12:00:30", 105_000_000, 30_000_000),
    ]) + "\n")

    c10.RECENT.clear()
    out = ticks._chain_blasts("2026-10-26", 10)
    kinds = {(b["kind"], b["side"]) for b in out}
    assert ("oi", "CE") in kinds
    assert ("volume", "CE") in kinds
    oi = next(b for b in out if b["kind"] == "oi")
    assert oi["bias"] == "neutral"  # OI alone cannot tell buyer/writer


def test_tick_endpoint_reads_and_windows(tmp_dir):
    path = tmp_dir / "2026-10-23.jsonl"
    lines = [
        json.dumps({"t": "2026-10-23T13:30:01+05:30", "spot": 22500.1}),
        json.dumps({"t": "2026-10-23T13:30:02+05:30", "spot": 22500.4}),
        json.dumps({"t": "2026-10-23T13:31:00+05:30", "spot": 22510.0}),
    ]
    path.write_text("\n".join(lines) + "\n")
    out = ticks.get_nifty_ticks(date="2026-10-23", start="13:30", end="13:30", limit=50)
    assert out["count"] == 2
    assert out["rows"][-1]["spot"] == 22500.4


def test_poll_once_writes_a_snapshot_and_tracks_last(tmp_dir, monkeypatch):
    async def fake_fetch(_expiry):
        return "2026-10-27", {"data": []}

    def fake_parse(_payload):
        return "2026-10-27", 22500.0, [
            {"strike": 22500, "ce": {"ltp": 100, "oi": 1000, "volume": 10},
             "pe": {"ltp": 90, "oi": 2000, "volume": 20}},
        ]

    monkeypatch.setattr("api.reports_api.nifty._fetch_chain_payload", fake_fetch)
    monkeypatch.setattr("api.reports_api.nifty.parse_chain_payload", fake_parse)
    chain10s._prev_oi = None
    snap = __import__("asyncio").run(chain10s.poll_once())
    assert snap is not None
    assert snap["spot"] == 22500.0
    assert snap["rows"][0][0] == 22500.0
    assert chain10s.LAST["spot"] == 22500.0
    written = (tmp_dir / f"{chain10s._today_ist()}.jsonl").read_text().strip()
    assert json.loads(written)["rows"][0][0] == 22500.0
