"""Bind refresh workflow asset/tag names to the sync helpers the watcher uses.

PyYAML is not installed in the task venv, so the workflows are read as text and
their ``run:`` blocks are parsed with anchored regexes.  A rename of a payload,
manifest or monthly tag in either workflow must fail here instead of silently
starving the release-sync watcher.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
UI_ROOT = Path(__file__).resolve().parents[1]
if str(UI_ROOT) not in sys.path:
    sys.path.insert(0, str(UI_ROOT))

from scripts import sync_refresh_assets as sync  # noqa: E402

pytestmark = [pytest.mark.unit, pytest.mark.contract]

SAMPLE_DATE = "2026-11-27"
EXPECTED_MONTH = "data-2026-11"

WORKFLOWS = {
    "52w": ROOT / ".github" / "workflows" / "refresh-52w.yml",
    "agri": ROOT / ".github" / "workflows" / "refresh-agri.yml",
}

_ASSIGNMENT_RE_TEMPLATE = r'^\s*{name}="([^"]+)"'
_BASH_DATE_RE = re.compile(r"\$\{DATE(?::(-?\d+)(?::(-?\d+))?)?\}")
_TAG_TEMPLATE_RE = re.compile(r"data-\$\{DATE(?::\d+(?::\d+)?)?\}")
_PY_TAG_SLICE_RE = re.compile(r'data-\{match\.group\(1\)\[:(\d+)\]\}')


def _workflow_text(kind: str) -> str:
    path = WORKFLOWS[kind]
    assert path.is_file(), f"missing workflow: {path}"
    return path.read_text(encoding="utf-8")


def _assigned_template(text: str, name: str) -> str:
    match = re.search(_ASSIGNMENT_RE_TEMPLATE.format(name=name), text, re.MULTILINE)
    assert match, f"workflow no longer assigns {name}=..."
    return match.group(1)


def _expand_bash(template: str, date: str) -> str:
    """Expand ``${DATE}`` / ``${DATE:0:7}`` the way the workflow shell does."""

    def replace(match: re.Match[str]) -> str:
        start, length = match.group(1), match.group(2)
        if start is None:
            return date
        begin = int(start)
        return date[begin:] if length is None else date[begin : begin + int(length)]

    return _BASH_DATE_RE.sub(replace, template)


def _workflow_basename(kind: str, variable: str) -> tuple[str, str]:
    template = _assigned_template(_workflow_text(kind), variable)
    return Path(_expand_bash(template, SAMPLE_DATE)).name, template


def _assert_same(actual: str, expected: str, label: str) -> None:
    assert actual == expected, f"{label}: workflow {actual!r} != sync helper {expected!r}"


def test_52w_asset_basename_matches_python_helper() -> None:
    basename, template = _workflow_basename("52w", "ASSET")
    _assert_same(basename, Path(sync.asset_name("52w", SAMPLE_DATE)).name, "52W asset")
    assert sync.asset_date(basename) == SAMPLE_DATE, template
    assert sync.asset_kind(basename) == "52w", template


def test_52w_manifest_basename_matches_python_helper() -> None:
    basename, template = _workflow_basename("52w", "MANIFEST")
    _assert_same(basename, Path(sync.manifest_name("52w", SAMPLE_DATE)).name, "52W manifest")
    assert sync.asset_date(basename) == SAMPLE_DATE, template
    assert sync.asset_kind(basename) == "52w", template


def test_52w_tag_matches_release_tag_re() -> None:
    templates = _TAG_TEMPLATE_RE.findall(_workflow_text("52w"))
    assert templates, "52W workflow no longer publishes a data-${DATE...} tag"
    for template in templates:
        tag = _expand_bash(template, SAMPLE_DATE)
        assert tag == EXPECTED_MONTH, f"{template!r} expanded to {tag!r}"
        assert sync.RELEASE_TAG_RE.fullmatch(tag), tag


def test_52w_date_formatting_matches_release_tag_shape() -> None:
    text = _workflow_text("52w")
    assert "DATE:0:7" in text, "52W workflow lost the ${DATE:0:7} month slice"
    assert EXPECTED_MONTH == "data-" + SAMPLE_DATE[:7]
    assert sync.RELEASE_TAG_RE.fullmatch(EXPECTED_MONTH)
    assert sync.RELEASE_TAG_RE.fullmatch("data-" + SAMPLE_DATE[:7])


def test_agri_asset_basename_matches_python_helper() -> None:
    basename, template = _workflow_basename("agri", "ASSET")
    _assert_same(basename, Path(sync.asset_name("agri", SAMPLE_DATE)).name, "agri asset")
    assert sync.asset_date(basename) == SAMPLE_DATE, template
    assert sync.asset_kind(basename) == "agri", template


def test_agri_manifest_basename_matches_python_helper() -> None:
    basename, template = _workflow_basename("agri", "MANIFEST")
    _assert_same(basename, Path(sync.manifest_name("agri", SAMPLE_DATE)).name, "agri manifest")
    assert sync.asset_date(basename) == SAMPLE_DATE, template
    assert sync.asset_kind(basename) == "agri", template


def test_agri_tag_matches_release_tag_re() -> None:
    match = _PY_TAG_SLICE_RE.search(_workflow_text("agri"))
    assert match, "agri workflow no longer derives data-YYYY-MM from the asset date"
    tag = "data-" + SAMPLE_DATE[: int(match.group(1))]
    assert tag == EXPECTED_MONTH, tag
    assert sync.RELEASE_TAG_RE.fullmatch(tag), tag


def test_both_workflows_emit_the_same_monthly_tag_shape() -> None:
    month_52w = _expand_bash(_TAG_TEMPLATE_RE.findall(_workflow_text("52w"))[0], SAMPLE_DATE)
    agri_slice = _PY_TAG_SLICE_RE.search(_workflow_text("agri"))
    assert agri_slice is not None
    month_agri = "data-" + SAMPLE_DATE[: int(agri_slice.group(1))]
    assert month_52w == month_agri == EXPECTED_MONTH
    assert sync.RELEASE_TAG_RE.fullmatch(month_52w)
    assert sync.RELEASE_TAG_RE.fullmatch(month_agri)


def test_changed_name_would_fail_comparison() -> None:
    """The comparison is sensitive: a renamed workflow asset cannot pass."""
    basename, _ = _workflow_basename("52w", "MANIFEST")
    expected = Path(sync.manifest_name("52w", SAMPLE_DATE)).name
    _assert_same(basename, expected, "unchanged 52W manifest")

    renamed = basename.replace("52w-", "52w-daily-", 1)
    assert renamed != expected, "mutated name must differ from the Python manifest"
    with pytest.raises(AssertionError, match="renamed 52W manifest"):
        _assert_same(renamed, expected, "renamed 52W manifest")
