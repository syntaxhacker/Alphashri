"""Contract tests for the shared Index Report JSONL readers / symbol guard."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import HTTPException

from api.reports_api.report_io import read_jsonl, read_jsonl_tail, symbol_or_400


def _write_lines(path: Path, lines: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _dump(rows: list[dict]) -> list[str]:
    return [json.dumps(row, separators=(",", ":")) for row in rows]


# --- read_jsonl ---------------------------------------------------------------

def test_read_jsonl_missing_file_returns_empty(tmp_path):
    assert read_jsonl(tmp_path / "missing.jsonl") == []


def test_read_jsonl_unreadable_path_returns_empty(tmp_path):
    # A directory cannot be opened as a text file; that is an I/O error, not a 500.
    assert read_jsonl(tmp_path) == []


def test_read_jsonl_skips_blank_malformed_and_non_dict_lines(tmp_path):
    path = tmp_path / "mixed.jsonl"
    first = {"t": "09:00", "spot": 100}
    last = {"t": "09:03", "spot": 103}
    _write_lines(path, [
        "",
        "   ",
        "{not json}",
        json.dumps([1, 2, 3]),
        json.dumps("a string"),
        json.dumps(42),
        json.dumps(first),
        "truncated {",
        json.dumps(last),
    ])
    assert read_jsonl(path) == [first, last]


def test_read_jsonl_predicate_and_order(tmp_path):
    path = tmp_path / "rows.jsonl"
    rows = [
        {"t": "09:00", "spot": 100},
        {"t": "09:01"},
        {"t": "09:02", "spot": 0},
        {"t": "09:03", "spot": 103},
    ]
    _write_lines(path, _dump(rows))

    # Order is preserved and every dict row is returned without a predicate.
    assert [row["t"] for row in read_jsonl(path)] == [
        "09:00", "09:01", "09:02", "09:03",
    ]
    # bool(row.get(...)) drops both the missing key and the falsy zero.
    assert read_jsonl(path, predicate=lambda row: bool(row.get("spot"))) == [
        rows[0], rows[3],
    ]


# --- read_jsonl_tail ----------------------------------------------------------

def test_read_jsonl_tail_missing_file_returns_empty(tmp_path):
    assert read_jsonl_tail(tmp_path / "missing.jsonl") == []


def test_read_jsonl_tail_small_file_returns_all_rows(tmp_path):
    path = tmp_path / "small.jsonl"
    rows = [{"t": f"09:0{i}"} for i in range(3)]
    _write_lines(path, _dump(rows))

    assert read_jsonl_tail(path, max_bytes=100_000) == rows


def test_read_jsonl_tail_drops_partial_first_line(tmp_path):
    path = tmp_path / "tail.jsonl"
    rows = [{"t": f"row-{i}", "blob": "x" * 100} for i in range(10)]
    _write_lines(path, _dump(rows))

    # 250 bytes starts the read in the middle of a record: the partial line is
    # discarded, every complete line after it still parses, in original order.
    out = read_jsonl_tail(path, max_bytes=250)
    assert out, "tail read returned nothing"
    assert out[-1] == rows[-1]
    assert all(row in rows for row in out)
    assert len(out) < len(rows)


def test_read_jsonl_tail_predicate(tmp_path):
    path = tmp_path / "tail_pred.jsonl"
    rows = [
        {"t": f"09:0{i}", "keep": i % 2 == 0, "blob": "y" * 80}
        for i in range(8)
    ]
    _write_lines(path, _dump(rows))

    assert read_jsonl_tail(
        path, max_bytes=100_000, predicate=lambda row: bool(row.get("keep"))
    ) == [row for row in rows if row["keep"]]


# --- symbol_or_400 ------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("nifty", "NIFTY"),
    ("  reliance  ", "RELIANCE"),
    ("M&M", "M&M"),
    ("BAJAJ-AUTO", "BAJAJ-AUTO"),
])
def test_symbol_or_400_valid_is_uppercase_and_stripped(raw, expected):
    assert symbol_or_400(raw) == expected


@pytest.mark.parametrize("bad", [
    "../X",
    "../../etc/passwd",
    "A/B",
    "",
    "BAD SYMBOL",
    "X" * 25,
])
def test_symbol_or_400_invalid_has_exact_noun_message(bad):
    for noun in ("symbol", "underlying"):
        with pytest.raises(HTTPException) as exc:
            symbol_or_400(bad, noun=noun)
        assert exc.value.status_code == 400
        assert exc.value.detail == (
            f"bad {noun}: {bad!r}, want a symbol like NIFTY/RELIANCE"
        )


def test_symbol_or_400_defaults_to_symbol_noun():
    with pytest.raises(HTTPException) as exc:
        symbol_or_400("../X")
    assert exc.value.detail == "bad symbol: '../X', want a symbol like NIFTY/RELIANCE"
