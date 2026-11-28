"""AST/source helpers shared by the single-source structural guards.

The guards parse production files instead of importing them so a second
implementation can be detected without executing app code. Keeping the parser
and the project root in one place stops each guard from growing its own copy.
"""
from __future__ import annotations

import ast
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def source(rel: str) -> str:
    return (PROJECT_ROOT / rel).read_text(encoding="utf-8")


def tree(rel: str) -> ast.Module:
    return ast.parse(source(rel), filename=rel)


def definitions(node: ast.AST) -> dict[str, ast.FunctionDef | ast.AsyncFunctionDef]:
    return {
        item.name: item
        for item in ast.walk(node)
        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
