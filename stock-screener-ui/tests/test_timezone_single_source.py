"""Guard: app layers have a single IST timezone source, ``config.IST``.

AST-scans the app layers (``api/``, ``trading/``, ``chart_patterns/``,
``cache/``) for locally constructed ``ZoneInfo("Asia/Kolkata")``. A second,
narrower scan covers the consolidated fork files and the audit-B1 residual
consumer files for the spellings that evade that check: zone literals passed
to ``tz_convert``/``tz_localize``, ``+05:30`` strings and
``timedelta(hours=5, ...)``. ``config.py`` defines the canonical timezone and
``trading/timezone.py`` defines the canonical IANA zone name plus its
import-failure fallback; both are checked as single-source definitions rather
than scanned for clones. Research scripts, ``india_board/`` and tests are out
of scope.

``frame_last_date()`` and ``fmt_date()`` are the canonical IST display
helpers in ``chart_patterns/``; this guard also prevents a second copy.
"""

from __future__ import annotations

import ast
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
APP_LAYERS = ("api", "trading", "chart_patterns", "cache")
KOLKATA = "Asia/Kolkata"

# Explicit allowlist: none. Standalone scripts (scripts/, india_board/) are
# outside the scanned app layers and are intentionally not migrated here.
ALLOWLIST: frozenset[str] = frozenset()

CANONICAL_DISPLAY_HELPERS = {
    "frame_last_date": "chart_patterns/candles.py",
    "fmt_date": "chart_patterns/detectors/common.py",
}

# The original scan only saw ZoneInfo("Asia/Kolkata"). The session-date lane's
# leftover forks spelled the same zone as a tz_convert/tz_localize argument or
# as an offset literal, which that scan could not see. These are the files that
# lane consolidated.
EVASIVE_SCAN_FILES = (
    "chart_patterns/candles.py",
    "api/chart_patterns.py",
    "trading/calendar.py",
)

# Audit B1 residual: the last app-layer consumers that still spelled the zone
# itself. Conversion sites must take config.IST; registry sites must take the
# canonical IANA name from trading.timezone.TZ_IST. Docstring examples are
# documentation, not executable sources, and are skipped by the detector.
RESIDUAL_SCAN_FILES = (
    "api/backtest_routes.py",
    "chart_patterns/watch.py",
    "chart_patterns/indicators.py",
)


def _app_modules():
    for layer in APP_LAYERS:
        root = REPO / layer
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*.py")):
            yield path


def _parse(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def _kolkata_zoneinfo_lines(tree: ast.Module) -> list[int]:
    names = {"ZoneInfo", "zoneinfo"}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == "zoneinfo":
            names.update(a.asname or a.name for a in node.names if a.name == "ZoneInfo")
        elif isinstance(node, ast.Import):
            names.update(a.asname or "zoneinfo" for a in node.names if a.name == "zoneinfo")

    lines = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not node.args:
            continue
        func = node.func
        is_zoneinfo = (isinstance(func, ast.Name) and func.id in names) or (
            isinstance(func, ast.Attribute) and func.attr == "ZoneInfo"
        )
        arg = node.args[0]
        if is_zoneinfo and isinstance(arg, ast.Constant) and arg.value == KOLKATA:
            lines.append(node.lineno)
    return lines


def test_app_layers_do_not_construct_kolkata_zoneinfo():
    violations = []
    for path in _app_modules():
        rel = path.relative_to(REPO).as_posix()
        if rel in ALLOWLIST:
            continue
        for lineno in _kolkata_zoneinfo_lines(_parse(path)):
            violations.append(f"{rel}:{lineno}")
    assert not violations, (
        "Local ZoneInfo('Asia/Kolkata') in an app layer — use config.IST:\n"
        + "\n".join(violations)
    )


def _docstring_constant_ids(tree: ast.Module) -> set[int]:
    """Docstring constants document a payload; they are not executable tz sources."""
    ids: set[int] = set()
    for owner in ast.walk(tree):
        if not isinstance(
            owner, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
        ):
            continue
        body = owner.body
        if not body:
            continue
        first = body[0]
        if (
            isinstance(first, ast.Expr)
            and isinstance(first.value, ast.Constant)
            and isinstance(first.value.value, str)
        ):
            ids.add(id(first.value))
    return ids


def _hardcoded_ist_lines(tree: ast.Module) -> list[tuple[int, str]]:
    """IST spellings that evade the ZoneInfo-only scan above."""
    docstrings = _docstring_constant_ids(tree)
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and id(node) not in docstrings:
            if isinstance(node.value, str):
                if node.value == KOLKATA:
                    found.append((node.lineno, "hardcoded zone literal"))
                elif "+05:30" in node.value:
                    found.append((node.lineno, "hardcoded +05:30 offset"))
        if isinstance(node, ast.Call):
            func = node.func
            name = func.id if isinstance(func, ast.Name) else getattr(func, "attr", None)
            if name == "timedelta" and any(
                kw.arg == "hours"
                and isinstance(kw.value, ast.Constant)
                and kw.value.value == 5
                for kw in node.keywords
            ):
                found.append((node.lineno, "IST offset as timedelta(hours=5, ...)"))
    return sorted(found)


def test_consolidated_forks_do_not_hardcode_an_ist_zone():
    violations = []
    for rel in EVASIVE_SCAN_FILES:
        for lineno, why in _hardcoded_ist_lines(_parse(REPO / rel)):
            violations.append(f"{rel}:{lineno} ({why})")
    assert not violations, (
        "Hardcoded IST zone/offset in a consolidated fork — use config.IST:\n"
        + "\n".join(violations)
    )


def test_residual_consumers_do_not_hardcode_an_ist_zone():
    violations = []
    for rel in RESIDUAL_SCAN_FILES:
        for lineno, why in _hardcoded_ist_lines(_parse(REPO / rel)):
            violations.append(f"{rel}:{lineno} ({why})")
    assert not violations, (
        "Hardcoded IST zone/offset in an audit-B1 consumer — use config.IST "
        "for conversions and trading.timezone.TZ_IST for registries:\n"
        + "\n".join(violations)
    )


def test_canonical_tz_name_and_offset_fallback_are_single_source():
    tree = _parse(REPO / "trading/timezone.py")
    zone_constants = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and node.value == KOLKATA
    ]
    assert len(zone_constants) == 1, (
        "trading/timezone.py must hold the only IANA IST name in app layers:\n"
        + "\n".join(f"line {n.lineno}" for n in zone_constants)
    )
    assert any(
        isinstance(node, ast.Assign)
        and any(
            isinstance(t, ast.Name) and t.id == "TZ_IST" for t in node.targets
        )
        and isinstance(node.value, ast.Constant)
        and node.value.value == KOLKATA
        for node in tree.body
    ), "the canonical TZ_IST assignment must define the IANA IST name"

    fallback = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "timedelta"
        and any(
            kw.arg == "hours"
            and isinstance(kw.value, ast.Constant)
            and kw.value.value == 5
            for kw in node.keywords
        )
    ]
    assert len(fallback) == 1, (
        "Only the import-failure fallback may restate the IST offset:\n"
        + "\n".join(f"line {n.lineno}" for n in fallback)
    )

    import config

    offset_seconds = int(config.IST.utcoffset(None).total_seconds())
    expected_hours, remainder = divmod(offset_seconds, 3600)
    kwargs = {
        kw.arg: kw.value.value
        for kw in fallback[0].keywords
        if isinstance(kw.value, ast.Constant)
    }
    assert kwargs.get("hours") == expected_hours
    assert kwargs.get("minutes") == remainder // 60


def test_evasive_spelling_detector_catches_every_form():
    sample = ast.parse('''
import pandas as pd
from datetime import timedelta
from zoneinfo import ZoneInfo

def clone(ts):
    a = ts.tz_convert("Asia/Kolkata")
    b = ts.tz_localize("Asia/Kolkata")
    c = pd.Timestamp.now(tz="Asia/Kolkata")
    d = timedelta(hours=5, minutes=30)
    e = "2026-11-05T10:30:00+05:30"
    return ZoneInfo("Asia/Kolkata")
''')
    assert len(_hardcoded_ist_lines(sample)) == 6


def test_config_is_the_canonical_ist_source():
    tree = _parse(REPO / "config.py")
    assert any(
        isinstance(node, ast.Assign)
        and any(isinstance(t, ast.Name) and t.id == "IST" for t in node.targets)
        for node in tree.body
    ), "config.py must define the canonical IST timezone"


def test_display_date_helpers_are_canonical_in_chart_patterns():
    # frame_last_date() (IST session date of a frame's last bar) and fmt_date()
    # (IST display date) live in chart_patterns/. Do not duplicate or move them.
    for name, rel in CANONICAL_DISPLAY_HELPERS.items():
        tree = _parse(REPO / rel)
        assert any(
            isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name
            for node in tree.body
        ), f"canonical display helper {name} missing from {rel}"

    duplicates = []
    for path in _app_modules():
        rel = path.relative_to(REPO).as_posix()
        if rel in CANONICAL_DISPLAY_HELPERS.values():
            continue
        for node in ast.walk(_parse(path)):
            if (
                isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                and node.name in CANONICAL_DISPLAY_HELPERS
            ):
                duplicates.append(f"{rel}:{node.lineno} ({node.name})")
    assert not duplicates, (
        "Duplicate canonical display helper — import from chart_patterns/:\n"
        + "\n".join(duplicates)
    )
