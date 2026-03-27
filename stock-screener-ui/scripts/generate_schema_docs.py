"""
Auto-generate docs/schema.md from SQLAlchemy models.

Usage:
    python scripts/generate_schema_docs.py

This script introspects Base.metadata to produce a Mermaid ERD
and per-table column reference. No external dependencies required.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from db.database import Base
from db.models import (
    User, UserSession, StrategyConfig, BotConfig, BacktestResult,
    BrokerConnection, LLMRun, NewsArticle, NewsSymbolMention, Instrument,
    bot_strategies,
)

OUTPUT_PATH = Path(__file__).resolve().parent.parent / "docs" / "schema.md"

TYPE_MAP = {
    "INTEGER": "Integer",
    "VARCHAR": "String",
    "TEXT": "Text",
    "FLOAT": "Float",
    "BOOLEAN": "Boolean",
    "DATETIME": "DateTime",
    "DATE": "Date",
    "CHAR": "String",
    "BIGINT": "BigInt",
    "SMALLINT": "SmallInt",
    "NUMERIC": "Numeric",
    "CLOB": "Text",
    "BLOB": "Binary",
    "TIMESTAMP": "DateTime",
}

WIDTH_THRESHOLD = 15


def clean_type(col_type_str):
    s = col_type_str.split("(")[0].strip().upper()
    return TYPE_MAP.get(s, s.title())


def is_pk_column(table, col_name):
    return any(pk.name == col_name for pk in table.primary_key.columns)


def is_fk_column(col):
    return len(col.foreign_keys) > 0


def get_fk_target(col):
    for fk in col.foreign_keys:
        return fk.target_fullname
    return None


def mermaid_safe_name(name):
    return name.replace("_", "")


def build_erd(metadata):
    lines = ["erDiagram"]

    sorted_tables = sorted(metadata.tables.values(), key=lambda t: t.name)

    for table in sorted_tables:
        pk_cols = [c.name for c in table.primary_key.columns]
        fk_cols = [c.name for c in table.columns if is_fk_column(c)]
        key_cols = list(dict.fromkeys(pk_cols + fk_cols))

        if len(table.columns) <= WIDTH_THRESHOLD:
            display_cols = [c for c in table.columns]
        else:
            display_cols = [c for c in table.columns if c.name in key_cols]

        entity = mermaid_safe_name(table.name)
        lines.append(f"    {entity} {{")
        for col in display_cols:
            col_type = clean_type(str(col.type))
            suffix = ""
            if is_pk_column(table, col.name):
                suffix = " PK"
            elif is_fk_column(col):
                suffix = " FK"
            safe_col = col.name
            lines.append(f"        {col_type} {safe_col}{suffix}")
        lines.append("    }")

    lines.append("")

    seen = set()
    for table in sorted_tables:
        for col in table.columns:
            if not col.foreign_keys:
                continue
            for fk in col.foreign_keys:
                parts = fk.target_fullname.split(".")
                ref_table = parts[0]
                if ref_table == table.name:
                    cardinality = "||--o|"
                    label = "parent"
                else:
                    cardinality = "||--o{"
                    label = col.name
                key = tuple(sorted([table.name, ref_table, label]))
                if key in seen:
                    continue
                seen.add(key)
                from_entity = mermaid_safe_name(table.name)
                to_entity = mermaid_safe_name(ref_table)
                lines.append(f"    {from_entity} {cardinality} {to_entity} : \"{label}\"")

    return "\n".join(lines)


def build_table_reference(metadata):
    sections = []

    sorted_tables = sorted(metadata.tables.values(), key=lambda t: t.name)

    for table in sorted_tables:
        header = f"### {table.name}"
        sections.append(header)
        sections.append("")
        sections.append("| Column | Type | Nullable | Key |")
        sections.append("|--------|------|----------|-----|")

        pk_col_names = {pk.name for pk in table.primary_key.columns}

        for col in table.columns:
            col_type = clean_type(str(col.type))
            nullable = "Yes" if col.nullable else "No"
            keys = []
            if col.name in pk_col_names:
                keys.append("PK")
            if col.unique:
                keys.append("UNIQUE")
            fk_target = get_fk_target(col)
            if fk_target:
                keys.append(f"FK -> {fk_target}")
            key_str = " ".join(keys) if keys else "-"
            sections.append(f"| {col.name} | {col_type} | {nullable} | {key_str} |")

        extra_rows = []

        for idx in table.indexes:
            if idx.name and not any(
                c.name in pk_col_names for c in idx.columns
            ):
                if not idx.unique:
                    cols = ", ".join(sorted(c.name for c in idx.columns))
                    extra_rows.append((idx.name, f"| *(Index: `{idx.name}` on {cols})* | | | |"))

        for constraint in table.constraints:
            cname = getattr(constraint, "name", "")
            if cname and "uq_" in cname:
                cols = ", ".join(sorted(c.name for c in constraint.columns))
                extra_rows.append((cname, f"| *(Unique: `{cname}` on {cols})* | | | |"))

        for _, row in sorted(extra_rows):
            sections.append(row)

        sections.append("")

    return "\n".join(sections)


def generate():
    metadata = Base.metadata
    erd = build_erd(metadata)
    table_ref = build_table_reference(metadata)

    output = f"""# Database Schema

> Auto-generated from `db/models.py`. Do not edit manually.
> Regenerate with: `python scripts/generate_schema_docs.py`

## Entity Relationship Diagram

```mermaid
{erd}
```

## Table Reference

{table_ref}
"""

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(output)
    print(f"Generated {OUTPUT_PATH}")


if __name__ == "__main__":
    generate()
