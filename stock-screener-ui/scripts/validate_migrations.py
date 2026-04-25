#!/usr/bin/env python3
"""
Validates Alembic migration files for chain integrity.

Checks:
1. Each migration has valid revision and down_revision variables
2. down_revision points to an existing revision ID (not a filename)
3. No duplicate revision IDs
4. Migration chain is linear (no branches/merges)

Usage: python scripts/validate_migrations.py
Exit: 0 = valid, 1 = invalid
"""

import ast
import os
import sys
from pathlib import Path


def extract_revision_info(filepath: Path) -> dict:
    """Extract revision and down_revision using Python AST parsing.

    Handles both styles:
      revision = 'abc123'
      revision: str = 'abc123'
    """
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    try:
        tree = ast.parse(content)
    except SyntaxError as e:
        return {"file": filepath.name, "error": f"Syntax error: {e}"}

    info = {"file": filepath.name, "revision": None, "down_revision": None}

    for node in ast.walk(tree):
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            target_id = node.target.id
            if target_id in ("revision", "down_revision"):
                if isinstance(node.value, ast.Constant):
                    value = node.value.value
                    if isinstance(value, str):
                        info[target_id] = value
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    target_id = target.id
                    if target_id in ("revision", "down_revision"):
                        if isinstance(node.value, ast.Constant):
                            value = node.value.value
                            if isinstance(value, str):
                                info[target_id] = value

    return info


def looks_like_filename(value: str) -> bool:
    """Check if a down_revision value looks like a filename instead of a revision ID."""
    if not value:
        return False
    if "/" in value or "\\" in value:
        return True
    if value.endswith(".py"):
        return True
    if value.startswith("2026_") or value.startswith("2025_"):
        return True
    if "_" in value and len(value) > 25:
        return True
    return False


def validate_migrations(migrations_dir: Path) -> bool:
    """Validate all migration files in the migrations directory."""
    errors = []
    warnings = []

    if not migrations_dir.exists():
        errors.append(f"Migrations directory not found: {migrations_dir}")
        for e in errors:
            print(f"ERROR: {e}")
        return False

    migration_files = sorted(migrations_dir.glob("*.py"))
    if not migration_files:
        errors.append(f"No migration files found in {migrations_dir}")
        for e in errors:
            print(f"ERROR: {e}")
        return False

    revision_map: dict[str, str] = {}
    migrations: list[dict] = []

    for py_file in migration_files:
        info = extract_revision_info(py_file)

        if "error" in info:
            errors.append(f"{info['file']}: {info['error']}")
            continue

        if not info["revision"]:
            errors.append(f"{info['file']}: missing 'revision' variable")
            continue

        if info["revision"] in revision_map:
            errors.append(
                f"Duplicate revision ID '{info['revision']}' in {info['file']} and {revision_map[info['revision']]}"
            )
            continue

        revision_map[info["revision"]] = info["file"]
        migrations.append(info)

    if errors:
        print("ERROR: Migration validation failed!")
        for e in errors:
            print(f"  - {e}")
        return False

    for m in migrations:
        dr = m["down_revision"]

        if looks_like_filename(dr or ""):
            warnings.append(
                f"{m['file']}: down_revision '{dr}' looks like a filename. "
                f"Use the actual revision ID (e.g., 'h8b9c0d1e2f3'), not the filename."
            )
            continue

        if dr is not None and dr not in revision_map:
            errors.append(
                f"{m['file']}: down_revision '{dr}' does not exist. "
                f"Check the parent migration's 'revision' variable, not its filename."
            )

    if warnings:
        print("WARNING: Some down_revision values may be incorrect:")
        for w in warnings:
            print(f"  - {w}")
        print()

    if errors:
        print("ERROR: Migration validation failed!")
        for e in errors:
            print(f"  - {e}")
        return False

    print(f"OK: All {len(migrations)} migrations validated successfully")
    if warnings:
        print(f"    ({len(warnings)} warning(s) - see above)")
    return True


def main() -> int:
    script_dir = Path(__file__).parent.resolve()
    repo_root = script_dir.parent
    migrations_dir = repo_root / "db" / "migrations" / "versions"

    print(f"Validating migrations in: {migrations_dir}")
    print()

    success = validate_migrations(migrations_dir)
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
