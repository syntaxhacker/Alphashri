#!/usr/bin/env python3
"""
Remove debug print() statements from Python files using AST.

Targets prints that:
- Contain DEBUG, [CORR], [SECTOR], [BOT], [REPLAY] prefixes
- Write to file=sys.stderr

After removal, fixes any blocks that become empty by inserting `pass`.

Usage:
  python remove-debug-prints.py [--dry-run] [file1.py file2.py ...]

If no files given, processes all .py files under api/ and trading/.
"""

import ast
import re
import argparse
from pathlib import Path


DEBUG_PATTERNS = ("DEBUG", "[CORR]", "[SECTOR]", "[BOT]", "[REPLAY]")


def is_debug_print(node: ast.Call) -> bool:
    """Check if a Call node is a debug print() statement."""
    if not isinstance(node.func, ast.Name) or node.func.id != "print":
        return False

    # Check for file=sys.stderr keyword
    for kw in node.keywords:
        if kw.arg == "file" and isinstance(kw.value, ast.Attribute):
            if isinstance(kw.value.value, ast.Name) and kw.value.value.id == "sys" and kw.value.attr == "stderr":
                return True

    # Check string args for debug patterns
    for arg in node.args:
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            if any(pat in arg.value for pat in DEBUG_PATTERNS):
                return True
        elif isinstance(arg, ast.JoinedStr):
            for val in arg.values:
                if isinstance(val, ast.Constant) and isinstance(val.value, str):
                    if any(pat in val.value for pat in DEBUG_PATTERNS):
                        return True

    return False


def _get_indent(line: str) -> int:
    """Get the indentation level of a line."""
    return len(line) - len(line.lstrip())


def _fix_empty_blocks(lines: list[str]) -> list[str]:
    """Insert `pass` into blocks that became empty after line removal.

    Detects patterns like:
        else:
    <non-indented-or-same-indent>   (i.e., the block body is missing)
    """
    result = []
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.rstrip()

        # Check if this line is a block header with no body
        if stripped.endswith(":") and not stripped.startswith("#"):
            indent = _get_indent(line)
            # Look at next non-empty line
            j = i + 1
            while j < len(lines) and lines[j].strip() == "":
                j += 1

            if j >= len(lines):
                # Block at end of file with no body
                result.append(line)
                result.append(" " * (indent + 4) + "pass\n")
                i += 1
                continue

            next_indent = _get_indent(lines[j])
            if next_indent <= indent:
                # Next non-empty line is at same or lower indent → empty block
                result.append(line)
                result.append(" " * (indent + 4) + "pass\n")
                i += 1
                continue

        result.append(line)
        i += 1

    return result


def remove_debug_prints(source: str) -> tuple[str, int]:
    """Remove debug print statements from source code. Returns (new_source, count)."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return source, 0

    lines_to_remove: set[int] = set()
    removed = 0

    for node in ast.walk(tree):
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            if is_debug_print(node.value):
                lines_to_remove.add(node.lineno)
                removed += 1

    if removed == 0:
        return source, 0

    source_lines = source.splitlines(keepends=True)
    new_lines = [line for i, line in enumerate(source_lines, start=1) if i not in lines_to_remove]

    # Fix any blocks that became empty
    new_lines = _fix_empty_blocks(new_lines)

    return "".join(new_lines), removed


def process_file(filepath: str, dry_run: bool = False) -> int:
    """Process a single Python file. Returns number of prints removed."""
    try:
        with open(filepath, "r") as f:
            source = f.read()
    except (OSError, UnicodeDecodeError):
        return 0

    new_source, count = remove_debug_prints(source)

    if count > 0 and not dry_run:
        # Verify the result parses before writing
        try:
            ast.parse(new_source)
        except SyntaxError:
            print(f"  WARNING: Skipping {filepath} — result has syntax errors")
            return 0
        with open(filepath, "w") as f:
            f.write(new_source)

    return count


def find_python_files(paths: list[str]) -> list[str]:
    """Expand directories into .py file lists."""
    files = []
    for p in paths:
        path = Path(p)
        if path.is_file() and path.suffix == ".py":
            files.append(str(path))
        elif path.is_dir():
            for f in path.rglob("*.py"):
                if "node_modules" not in str(f) and ".venv" not in str(f) and "__pycache__" not in str(f):
                    files.append(str(f))
    return files


def main():
    parser = argparse.ArgumentParser(description="Remove debug print statements from Python files")
    parser.add_argument("--dry-run", action="store_true", help="Don't write changes, just report")
    parser.add_argument("files", nargs="*", help="Files or directories to process")
    args = parser.parse_args()

    if args.files:
        targets = find_python_files(args.files)
    else:
        root = Path(__file__).parent
        default_dirs = [root / "api", root / "trading"]
        targets = find_python_files([str(d) for d in default_dirs if d.exists()])

    total_removed = 0
    files_changed = 0

    for filepath in targets:
        count = process_file(filepath, dry_run=args.dry_run)
        if count > 0:
            total_removed += count
            files_changed += 1
            if args.dry_run:
                print(f"  Would remove {count} debug print(s) from {filepath}")
            else:
                print(f"  Removed {count} debug print(s) from {filepath}")

    if total_removed > 0 and not args.dry_run:
        print(f"Removed {total_removed} debug print statement(s) from {files_changed} file(s).")


if __name__ == "__main__":
    main()
