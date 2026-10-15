#!/usr/bin/env python3
"""
Seed script for the curated themes taxonomy.

Reads ``data/themes.json`` (``[{slug, name, category, description,
source, symbols: [...]}]``) and upserts it into the ``themes`` +
``theme_constituents`` tables.

Idempotent: themes are upserted by ``slug`` (metadata updated, version
bumped); each theme's constituents are replaced with the seed list
(delete-then-insert).

Run with: python scripts/seed_themes.py [--file data/themes.json] [--prune] [--dry-run]

NOTE: never run this against the production DB unless explicitly intended.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional, Set

# Add project path (same pattern as scripts/seed_qa_data.py)
sys.path.insert(0, str(Path(__file__).parent.parent))

from db.models.taxonomy import Theme, ThemeConstituent  # noqa: E402


def load_theme_file(path: Path) -> List[dict]:
    """Read and minimally validate the seed JSON file."""
    with open(path, "r", encoding="utf-8") as f:
        items = json.load(f)
    if not isinstance(items, list):
        raise ValueError(f"{path} must contain a JSON list of themes")
    for item in items:
        if not item.get("slug"):
            raise ValueError(f"theme entry missing 'slug': {item}")
    return items


def load_valid_symbols(db=None) -> Set[str]:
    """Return the set of known NSE_EQ trading symbols (uppercased).

    Prefers ``api.symbols._load_instruments()``; falls back to a direct
    ``Instrument`` query when the cache is empty/unavailable.
    """
    try:
        from api.symbols import _load_instruments
        cached = _load_instruments() or []
        symbols = {
            str(i.get("trading_symbol", "")).strip().upper()
            for i in cached
            if i.get("segment") == "NSE_EQ" and i.get("trading_symbol")
        }
        if symbols:
            return symbols
    except Exception as exc:
        print(f"  (instrument cache unavailable: {exc}, falling back to DB query)")

    from db.models import Instrument
    from db.database import SessionLocal

    close = False
    if db is None:
        db = SessionLocal()
        close = True
    try:
        rows = db.query(Instrument.trading_symbol).filter(Instrument.segment == "NSE_EQ").all()
        return {str(r[0]).strip().upper() for r in rows if r[0]}
    finally:
        if close:
            db.close()


def upsert_themes(
    db,
    items: List[dict],
    valid_symbols: Optional[Set[str]] = None,
    prune: bool = False,
    dry_run: bool = False,
) -> Dict:
    """Upsert seed ``items`` into the DB. Returns a summary dict.

    - Theme matched by ``slug``: update name/category/description/source,
      bump ``version``. Create with ``version=1`` when absent.
    - Constituents for each touched theme are replaced (delete-then-insert).
    - Symbols not in ``valid_symbols`` are dropped and reported.
    - ``prune=True`` deactivates DB themes absent from the seed file.
    - ``dry_run=True`` computes everything then rolls back (no writes).
    """
    if valid_symbols is None:
        valid_symbols = load_valid_symbols(db)
    else:
        valid_symbols = {str(s).strip().upper() for s in valid_symbols}

    created = 0
    updated = 0
    constituents_inserted = 0
    unknown_symbols: Set[str] = set()
    seen_slugs: Set[str] = set()

    for item in items:
        slug = str(item["slug"]).strip()
        if not slug:
            continue
        seen_slugs.add(slug)

        theme = db.query(Theme).filter(Theme.slug == slug).first()
        if theme is None:
            theme = Theme(
                slug=slug,
                name=item.get("name") or slug,
                category=item.get("category"),
                description=item.get("description") or "",
                source=item.get("source") or "curated",
                version=1,
                is_active=True,
            )
            db.add(theme)
            db.flush()  # assign id for constituent inserts
            created += 1
        else:
            theme.name = item.get("name") or theme.name
            theme.category = item.get("category")
            theme.description = item.get("description") or ""
            theme.source = item.get("source") or theme.source
            theme.is_active = True
            theme.version = (theme.version or 1) + 1
            updated += 1

        db.query(ThemeConstituent).filter(ThemeConstituent.theme_id == theme.id).delete()

        raw_symbols = item.get("symbols") or []
        clean = sorted({str(s).strip().upper() for s in raw_symbols if str(s).strip()})
        known = [s for s in clean if s in valid_symbols]
        unknown_symbols.update(s for s in clean if s not in valid_symbols)
        for symbol in known:
            db.add(ThemeConstituent(theme_id=theme.id, symbol=symbol))
        constituents_inserted += len(known)

    pruned: List[str] = []
    if prune:
        for theme in db.query(Theme).all():
            if theme.slug not in seen_slugs and theme.is_active:
                theme.is_active = False
                pruned.append(theme.slug)

    summary = {
        "themes_upserted": created + updated,
        "themes_created": created,
        "themes_updated": updated,
        "constituents_inserted": constituents_inserted,
        "unknown_symbols": sorted(unknown_symbols),
        "pruned": sorted(pruned),
        "dry_run": dry_run,
    }

    if dry_run:
        db.rollback()
    else:
        db.commit()
    return summary


def print_summary(summary: Dict) -> None:
    print(f"Themes upserted: {summary['themes_upserted']} "
          f"(created={summary['themes_created']}, updated={summary['themes_updated']})")
    print(f"Constituents inserted: {summary['constituents_inserted']}")
    if summary["unknown_symbols"]:
        print(f"Unknown symbols dropped ({len(summary['unknown_symbols'])}): "
              f"{', '.join(summary['unknown_symbols'])}")
    else:
        print("Unknown symbols dropped: 0")
    if summary["pruned"]:
        print(f"Pruned (deactivated): {', '.join(summary['pruned'])}")
    if summary["dry_run"]:
        print("(dry run — no writes committed)")


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed the curated themes taxonomy")
    parser.add_argument(
        "--file",
        default=str(Path(__file__).parent.parent / "data" / "themes.json"),
        help="Path to the themes seed JSON file",
    )
    parser.add_argument(
        "--prune",
        action="store_true",
        help="Deactivate DB themes absent from the seed file",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and print the summary without writing",
    )
    args = parser.parse_args()

    items = load_theme_file(Path(args.file))

    from db.database import SessionLocal
    db = SessionLocal()
    try:
        valid_symbols = load_valid_symbols(db)
        print(f"Known NSE_EQ symbols: {len(valid_symbols)}")
        summary = upsert_themes(
            db, items,
            valid_symbols=valid_symbols,
            prune=args.prune,
            dry_run=args.dry_run,
        )
        print_summary(summary)
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
