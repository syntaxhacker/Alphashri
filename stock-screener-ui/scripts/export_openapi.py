"""
Export the live FastAPI OpenAPI schema to the checked-in openapi.yaml.

Usage:
    python scripts/export_openapi.py            # write openapi.yaml and print a summary
    python scripts/export_openapi.py --check    # drift check; exit 1 if out of date
    python scripts/export_openapi.py --output PATH   # write/check PATH instead of SPEC_PATH

The export is deterministic (yaml.safe_dump with sort_keys=True), so repeated
exports produce byte-identical output. The drift check compares parsed YAML
structures, not raw bytes.
"""

import argparse
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
SPEC_PATH = ROOT / "openapi.yaml"

_HTTP_METHODS = frozenset({"get", "put", "post", "delete", "options", "head", "patch", "trace"})


def build_schema() -> dict:
    """Import the FastAPI app and return its OpenAPI schema."""
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    try:
        from api_server_fastapi import app
    except Exception as exc:
        raise ImportError(
            "scripts/export_openapi.py: failed to import the FastAPI app from "
            "api_server_fastapi. Run from the repo root, or ensure the repo root "
            "is on sys.path and the app's dependencies are installed."
        ) from exc
    return app.openapi()


def render_yaml(schema: dict) -> str:
    """Serialize deterministically so repeated exports produce byte-identical output."""
    return yaml.safe_dump(
        schema,
        sort_keys=True,
        allow_unicode=True,
        width=1000,
        default_flow_style=False,
    )


def write_spec(schema: dict | None = None) -> Path:
    """Write SPEC_PATH. Returns the path."""
    if schema is None:
        schema = build_schema()
    SPEC_PATH.write_text(render_yaml(schema), encoding="utf-8")
    return SPEC_PATH


def check_spec() -> bool:
    """Return True when the checked-in file matches the generated schema."""
    return _file_matches_schema(SPEC_PATH, build_schema())


def main(argv: list[str] | None = None) -> int:
    """argparse entry point. --check compares, default writes."""
    parser = argparse.ArgumentParser(
        description="Export the live FastAPI OpenAPI schema to openapi.yaml."
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Compare the checked-in spec against the live schema without writing; exit 1 on drift.",
    )
    parser.add_argument(
        "--output",
        metavar="PATH",
        default=None,
        help="Write/check this path instead of SPEC_PATH (useful for CI artifacts).",
    )
    args = parser.parse_args(argv)

    target: Path = Path(args.output) if args.output else SPEC_PATH
    schema = build_schema()
    paths = schema.get("paths") or {}
    n_paths = len(paths)
    n_ops = _count_operations(paths)

    if args.check:
        if _file_matches_schema(target, schema):
            print(f"{target.name} is up to date ({n_paths} paths)")
            return 0
        detail = _drift_detail(target, schema)
        print(f"{target.name} is out of date. Run: python scripts/export_openapi.py", file=sys.stderr)
        if detail:
            print(detail, file=sys.stderr)
        return 1

    target.write_text(render_yaml(schema), encoding="utf-8")
    print(f"Wrote {target} ({n_paths} paths, {n_ops} operations)")
    return 0


def _count_operations(paths: dict) -> int:
    """Count HTTP method operations across all path items."""
    return sum(
        1
        for path_item in paths.values()
        if isinstance(path_item, dict)
        for method in path_item
        if method in _HTTP_METHODS
    )


def _file_matches_schema(target: Path, schema: dict) -> bool:
    """Compare parsed YAML of target against schema (structure, not bytes)."""
    try:
        text = target.read_text(encoding="utf-8")
    except OSError:
        return False
    try:
        file_schema = yaml.safe_load(text)
    except yaml.YAMLError:
        return False
    return file_schema == schema


def _drift_detail(target: Path, schema: dict) -> str:
    """Short summary of path-level drift between file and schema."""
    try:
        file_schema = yaml.safe_load(target.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError):
        return f"could not read or parse {target}"
    file_paths = set((file_schema.get("paths") or {}).keys())
    schema_paths = set((schema.get("paths") or {}).keys())
    parts: list[str] = []
    only_in_file = sorted(file_paths - schema_paths)
    only_in_schema = sorted(schema_paths - file_paths)
    if only_in_file:
        parts.append(f"paths only in file: {', '.join(only_in_file)}")
    if only_in_schema:
        parts.append(f"paths only in schema: {', '.join(only_in_schema)}")
    if len(file_paths) != len(schema_paths):
        parts.append(f"path count mismatch: file={len(file_paths)}, schema={len(schema_paths)}")
    return "; ".join(parts)


if __name__ == "__main__":
    raise SystemExit(main())
