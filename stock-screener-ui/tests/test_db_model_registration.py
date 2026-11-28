"""Guard: every declarative model must be re-exported by ``db.models``.

``tests/conftest.py`` builds its schema from ``Base.metadata``. A model whose
module is never imported by ``db/models/__init__.py`` stays invisible there, so
tables silently disappear from every test database. This test derives the set
of models from the source files instead of from a hand-maintained list.
"""

from __future__ import annotations

import ast
from pathlib import Path

import db.models as db_models
from db.database import Base

MODELS_DIR = Path(__file__).resolve().parents[1] / "db" / "models"

# class name -> (module file stem, __tablename__)
ModelInfo = tuple[str, str]


def _base_name(expr: ast.expr) -> str | None:
    if isinstance(expr, ast.Name):
        return expr.id
    if isinstance(expr, ast.Attribute):
        return expr.attr
    return None


def _literal_attr(node: ast.ClassDef, attr: str) -> str | None:
    for stmt in node.body:
        if not isinstance(stmt, ast.Assign):
            continue
        if not any(isinstance(t, ast.Name) and t.id == attr for t in stmt.targets):
            continue
        if isinstance(stmt.value, ast.Constant) and isinstance(stmt.value.value, str):
            return stmt.value.value
    return None


def _is_abstract(node: ast.ClassDef) -> bool:
    for stmt in node.body:
        if not isinstance(stmt, ast.Assign):
            continue
        if any(isinstance(t, ast.Name) and t.id == "__abstract__" for t in stmt.targets):
            return stmt.value is True if isinstance(stmt.value, ast.Constant) else False
    return False


def _discover(models_dir: Path) -> tuple[dict[str, ModelInfo], set[str]]:
    """Parse every model module and return declarative classes + raw ``Table`` names."""
    models: dict[str, ModelInfo] = {}
    association_tables: set[str] = set()

    for path in sorted(models_dir.rglob("*.py")):
        if path.name == "__init__.py":
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in tree.body:
            if isinstance(node, ast.ClassDef) and any(
                (name or "").endswith("Base") for name in map(_base_name, node.bases)
            ):
                if _is_abstract(node):
                    continue
                table = _literal_attr(node, "__tablename__")
                assert table is not None, (
                    f"{path.name}:{node.lineno} {node.name} subclasses Base but has no "
                    "literal __tablename__"
                )
                assert node.name not in models, f"duplicate model class {node.name}"
                models[node.name] = (path.stem, table)
            elif isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
                call = node.value
                callee_name = _base_name(call.func)
                if callee_name == "Table" and call.args:
                    first = call.args[0]
                    if isinstance(first, ast.Constant) and isinstance(first.value, str):
                        association_tables.add(first.value)

    assert models, f"no Base subclasses discovered under {models_dir}"
    return models, association_tables


def assert_registered(models_dir: Path, models_module, base) -> None:
    """Shared check, also used by the failing-first proof against a scratch package."""
    models, association_tables = _discover(models_dir)
    failures: list[str] = []

    for class_name, (_module, table_name) in models.items():
        model_cls = getattr(models_module, class_name, None)
        if model_cls is None:
            failures.append(f"{class_name} ({table_name}) is not re-exported by db.models")
            continue
        registered = base.metadata.tables.get(table_name)
        if registered is None:
            failures.append(f"{table_name} ({class_name}) is missing from Base.metadata.tables")
        elif getattr(model_cls, "__table__", None) is not registered:
            failures.append(f"{class_name}.__table__ is not the table registered as {table_name}")

    expected_tables = {table for _module, table in models.values()} | association_tables
    actual_tables = set(base.metadata.tables)
    expected_count = len(models) + len(association_tables)
    if len(actual_tables) != expected_count:
        failures.append(
            f"Base.metadata has {len(actual_tables)} tables, expected {expected_count} "
            f"({len(models)} model classes + {len(association_tables)} association table(s))"
        )
    if actual_tables != expected_tables:
        failures.append(
            f"table names differ: missing={sorted(expected_tables - actual_tables)}, "
            f"unexpected={sorted(actual_tables - expected_tables)}"
        )

    declared_tables = {table for _module, table in models.values()}
    mapped_tables = {mapper.local_table.name for mapper in base.registry.mappers}
    if mapped_tables != declared_tables:
        failures.append(
            f"mapped tables differ: missing={sorted(declared_tables - mapped_tables)}, "
            f"extra={sorted(mapped_tables - declared_tables)}"
        )

    assert not failures, "db model registration guard failed:\n- " + "\n- ".join(failures)


def test_every_discovered_model_is_registered_and_reexported():
    assert_registered(MODELS_DIR, db_models, Base)


def assert_init_imports_every_model_module(models_dir: Path) -> None:
    tree = ast.parse((models_dir / "__init__.py").read_text(encoding="utf-8"))
    imported_modules = {
        node.module
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.level == 1 and node.module
    }
    models, _ = _discover(models_dir)
    expected_modules = {module for module, _table in models.values()}
    missing = expected_modules - imported_modules
    assert not missing, f"db/models/__init__.py never imports {sorted(missing)}"


def test_init_imports_every_model_module():
    assert_init_imports_every_model_module(MODELS_DIR)
