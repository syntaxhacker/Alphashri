"""Retention tool: inventory, dry-run plan, verified gzip round-trip."""

from __future__ import annotations

import gzip
import io
import json
from datetime import date, datetime
from pathlib import Path

import pytest

from scripts import compact_nifty_data as compact

TODAY = date(2026, 11, 18)
NOW = datetime(2026, 11, 18, 16, 0)


@pytest.fixture()
def data_dir(tmp_path):
    root = tmp_path / "experiments" / "data"
    for name in compact.DIRS:
        (root / name).mkdir(parents=True, exist_ok=True)
    return root


def _write(path: Path, payload: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(payload)
    return path


def test_inventory_reports_size_and_age_per_directory(data_dir):
    _write(data_dir / "nifty_snapshots" / "2026-11-05.jsonl", "x" * 100)
    _write(data_dir / "nifty_snapshots" / "2026-11-17.jsonl", "y" * 50)
    _write(data_dir / "nifty_snapshots" / "2026-11-17.gaps.jsonl", "{}")
    _write(data_dir / "nifty_chain10s" / "2026-11-17.jsonl", "z" * 10)
    _write(data_dir / "nifty_chain10s" / "2026-11-04.jsonl.gz", "packed")

    inv = {row["dir"]: row for row in compact.inventory(data_dir, today=TODAY)}
    snaps = inv["nifty_snapshots"]
    assert snaps["files"] == 2
    assert snaps["bytes"] == 150
    assert snaps["gap_files"] == 1
    assert snaps["oldest"] == "2026-11-05"
    assert snaps["oldest_age_days"] == 13
    chain = inv["nifty_chain10s"]
    assert chain["gz_files"] == 1 and chain["files"] == 2
    assert inv["nifty_ticks"]["exists"] is True
    assert inv["nifty_ticks"]["files"] == 0


def test_dry_run_plans_compression_but_writes_nothing(data_dir):
    old = _write(data_dir / "nifty_snapshots" / "2026-11-01.jsonl", "a" * 100)
    fresh = _write(data_dir / "nifty_snapshots" / "2026-11-17.jsonl", "b" * 100)
    gaps = _write(data_dir / "nifty_snapshots" / "2026-11-01.gaps.jsonl", "{}")

    report = compact.run(data_dir, ("nifty_snapshots",), days=7,
                         apply=False, now=NOW)

    actions = {Path(p["path"]).name: p["action"] for p in report.plan}
    assert actions["2026-11-01.jsonl"] == "compress"
    assert actions["2026-11-17.jsonl"] == "keep"
    assert "2026-11-01.gaps.jsonl" not in actions  # gap journals are never touched
    assert old.exists() and fresh.exists() and gaps.exists()
    assert not (data_dir / compact.MANIFEST_NAME).exists()
    assert report.results == []


def test_apply_compresses_old_files_and_removes_the_source(data_dir):
    payload = json.dumps({"t": "2026-11-01T09:15:00+05:30", "spot": 22500}) + "\n"
    old = _write(data_dir / "nifty_snapshots" / "2026-11-01.jsonl", payload)
    fresh = _write(data_dir / "nifty_snapshots" / "2026-11-17.jsonl", payload)

    report = compact.run(data_dir, ("nifty_snapshots",), days=7,
                         apply=True, now=NOW)

    assert report.errors == []
    gz = data_dir / "nifty_snapshots" / "2026-11-01.jsonl.gz"
    assert gz.exists()
    assert not old.exists()
    assert fresh.exists()  # inside the retention window
    with gzip.open(gz, "rt") as fh:
        assert fh.read() == payload

    manifest = json.loads((data_dir / compact.MANIFEST_NAME).read_text())
    assert manifest["version"] == 1
    assert len(manifest["entries"]) == 1
    entry = manifest["entries"][0]
    assert entry["file"] == "2026-11-01.jsonl"
    assert entry["gz"] == "2026-11-01.jsonl.gz"
    assert entry["bytes_before"] == len(payload.encode())
    assert len(entry["sha256"]) == 64


def test_apply_never_touches_other_directories_without_the_flag(data_dir):
    chain_old = _write(data_dir / "nifty_chain10s" / "2026-10-01.jsonl", "c" * 20)
    tape_old = _write(data_dir / "nifty_tape" / "2026-10-01.jsonl", "t" * 20)
    snap_old = _write(data_dir / "nifty_snapshots" / "2026-10-01.jsonl", "s" * 20)

    compact.run(data_dir, ("nifty_snapshots",), days=7, apply=True, now=NOW)

    assert chain_old.exists() and tape_old.exists()
    assert not snap_old.exists()


def test_apply_includes_chain10s_only_when_asked(data_dir):
    chain_old = _write(data_dir / "nifty_chain10s" / "2026-10-01.jsonl", "c" * 20)

    compact.run(data_dir, ("nifty_chain10s",), days=7, apply=True, now=NOW)

    assert not chain_old.exists()
    assert (data_dir / "nifty_chain10s" / "2026-10-01.jsonl.gz").exists()


def test_apply_skips_a_file_whose_archive_already_exists(data_dir):
    _write(data_dir / "nifty_snapshots" / "2026-10-01.jsonl", "new")
    gz = _write(data_dir / "nifty_snapshots" / "2026-10-01.jsonl.gz", "already here")

    report = compact.run(data_dir, ("nifty_snapshots",), days=7,
                         apply=True, now=NOW)

    assert report.results == []
    action = next(p for p in report.plan
                  if Path(p["path"]).name == "2026-10-01.jsonl")
    assert action["action"] == "skip"
    assert "archive already exists" in action["skipped"]
    assert gz.read_text() == "already here"


def test_manifest_is_preserved_across_runs(data_dir):
    _write(data_dir / "nifty_snapshots" / "2026-10-01.jsonl", "a" * 40)
    compact.run(data_dir, ("nifty_snapshots",), days=7, apply=True, now=NOW)
    _write(data_dir / "nifty_snapshots" / "2026-10-02.jsonl", "b" * 40)
    compact.run(data_dir, ("nifty_snapshots",), days=7, apply=True, now=NOW)

    manifest = json.loads((data_dir / compact.MANIFEST_NAME).read_text())
    assert [e["file"] for e in manifest["entries"]] == [
        "2026-10-01.jsonl", "2026-10-02.jsonl"]


def test_round_trip_mismatch_keeps_the_source(data_dir, monkeypatch):
    source = _write(data_dir / "nifty_snapshots" / "2026-10-01.jsonl", "payload" * 5)
    real_open = gzip.open

    def corrupting_open(path, mode="rb", *args, **kwargs):
        if mode == "rb":
            return io.BytesIO(b"corrupted")
        return real_open(path, mode, *args, **kwargs)

    monkeypatch.setattr(compact.gzip, "open", corrupting_open)
    with pytest.raises(RuntimeError, match="round-trip mismatch"):
        compact.compress_file(source)

    assert source.exists()
    assert source.read_text() == "payload" * 5
    assert not (data_dir / "nifty_snapshots" / "2026-10-01.jsonl.gz").exists()
    assert not (data_dir / "nifty_snapshots" / "2026-10-01.jsonl.gz.part").exists()


def test_gap_journals_are_never_compressed_or_deleted(data_dir):
    gap = _write(data_dir / "nifty_snapshots" / "2026-10-01.gaps.jsonl", "{}\n")
    compact.run(data_dir, ("nifty_snapshots",), days=0, apply=True, now=NOW)
    assert gap.exists()
    assert gap.read_text() == "{}\n"


def test_cli_rejects_an_unknown_directory(data_dir, capsys):
    with pytest.raises(SystemExit) as exc:
        compact.main(["--data-dir", str(data_dir), "--include", "nifty_typo"])
    assert exc.value.code == 2


def test_cli_dry_run_is_the_default(data_dir, capsys):
    _write(data_dir / "nifty_snapshots" / "2026-10-01.jsonl", "x" * 30)
    assert compact.main(["--data-dir", str(data_dir), "--days", "7"]) == 0
    out = capsys.readouterr().out
    assert "DRY-RUN" in out
    assert "compress 2026-10-01.jsonl" in out
    assert (data_dir / "nifty_snapshots" / "2026-10-01.jsonl").exists()


class TestGenericSymbolDirs:
    """SENSEX artefacts use the same day-file layout, one dir deeper."""

    GENERIC_DIRS = ("options_snapshots", "options_chain10s",
                    "options_chain10s_greeks", "options_tape")

    def test_dirs_are_registered_but_not_compacted_by_default(self):
        for name in self.GENERIC_DIRS:
            assert f"{name}/SENSEX" in compact.DIRS
        assert compact.DEFAULT_TARGETS == ("nifty_snapshots",)

    def test_inventory_covers_sensex_dirs(self, data_dir):
        _write(data_dir / "options_tape" / "SENSEX" / "2026-11-05.jsonl", "t" * 30)
        _write(data_dir / "options_tape" / "SENSEX" /
               "2026-11-05.gaps.jsonl", "{}")
        _write(data_dir / "options_snapshots" / "SENSEX" /
               "2026-11-17.jsonl", "s" * 10)

        inv = {row["dir"]: row for row in compact.inventory(data_dir, today=TODAY)}
        tape = inv["options_tape/SENSEX"]
        assert tape["exists"] is True
        assert tape["files"] == 1
        assert tape["bytes"] == 30
        assert tape["gap_files"] == 1
        assert tape["oldest"] == "2026-11-05"
        assert inv["options_snapshots/SENSEX"]["files"] == 1
        assert inv["options_chain10s_greeks/SENSEX"]["exists"] is True
        assert inv["options_chain10s_greeks/SENSEX"]["files"] == 0

    def test_default_apply_leaves_the_generic_dirs_alone(self, data_dir):
        old = _write(data_dir / "options_tape" / "SENSEX" /
                     "2026-10-01.jsonl", "t" * 20)
        compact.run(data_dir, compact.DEFAULT_TARGETS, days=7, apply=True, now=NOW)
        assert old.exists()
        assert not (data_dir / "options_tape" / "SENSEX" /
                    "2026-10-01.jsonl.gz").exists()

    def test_apply_compacts_only_the_included_sensex_dir(self, data_dir):
        tape = _write(data_dir / "options_tape" / "SENSEX" /
                      "2026-10-01.jsonl", "t" * 40)
        chain = _write(data_dir / "options_chain10s" / "SENSEX" /
                       "2026-10-01.jsonl", "c" * 40)
        gaps = _write(data_dir / "options_tape" / "SENSEX" /
                      "2026-10-01.gaps.jsonl", "{}\n")

        report = compact.run(data_dir, ("options_tape/SENSEX",), days=7,
                             apply=True, now=NOW)

        assert report.errors == []
        gz = data_dir / "options_tape" / "SENSEX" / "2026-10-01.jsonl.gz"
        assert gz.exists() and not tape.exists()
        assert chain.exists()          # not included
        assert gaps.exists()           # gap journals are never touched
        with gzip.open(gz, "rt") as fh:
            assert fh.read() == "t" * 40
        manifest = json.loads((data_dir / compact.MANIFEST_NAME).read_text())
        assert manifest["entries"][0]["dir"] == "options_tape/SENSEX"

    def test_greeks_dir_is_a_first_class_target(self, data_dir):
        old = _write(data_dir / "options_chain10s_greeks" / "SENSEX" /
                     "2026-10-01.jsonl", "g" * 20)
        compact.run(data_dir, ("options_chain10s_greeks/SENSEX",), days=7,
                    apply=True, now=NOW)
        assert not old.exists()
        assert (data_dir / "options_chain10s_greeks" / "SENSEX" /
                "2026-10-01.jsonl.gz").exists()

    def test_cli_accepts_a_symbol_scoped_dir(self, data_dir, capsys):
        _write(data_dir / "options_snapshots" / "SENSEX" /
               "2026-10-01.jsonl", "x" * 30)
        code = compact.main(["--data-dir", str(data_dir), "--days", "7",
                             "--include", "options_snapshots/SENSEX"])
        assert code == 0
        assert "options_snapshots/SENSEX" in capsys.readouterr().out

