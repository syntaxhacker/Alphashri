"""Guard: app layers have a single IST timezone source, ``config.IST``.

AST-scans the app layers (``api/``, ``trading/``, ``chart_patterns/``,
``cache/``) for locally constructed ``ZoneInfo("Asia/Kolkata")``. ``config.py``
is the canonical definition and is deliberately outside the scan. Research
scripts, ``india_board/`` and tests are out of scope.

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
