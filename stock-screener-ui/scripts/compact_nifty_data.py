#!/usr/bin/env python3
"""Inventory and compact the Nifty report data directories — dry-run by default.

Why: ``nifty_snapshots`` grows ~60-80 MB per session (a FULL chain every
minute) while ``nifty_chain10s`` / ``nifty_ticks`` / ``nifty_tape`` stay in the
single-digit MB range. Disk pressure arrives from the snapshots first, and the
older sessions are the coldest data we keep. Nothing here deletes "old" data:
it gzips the *uncompressed* day file, verifies the archive byte-for-byte, and
only then removes the original.

Safety rules (all defaults):
  - dry-run unless ``--apply`` is passed;
  - only ``nifty_snapshots`` is compacted unless ``--include`` lists more;
  - only ``*.jsonl`` day files older than ``--days`` (by filename date, mtime
    fallback) are touched — never ``*.gaps.jsonl``, never already-gzipped
    files, never ``reports/``, never the DB;
  - one manifest (``nifty_compaction_manifest.json`` in the data root) is
    rewritten atomically and kept across runs;
  - the uncompressed file is removed only after re-reading the gzip and
    comparing its SHA-256 to the source.

The generic recorder's per-symbol directories are tracked too, but only when
named explicitly: ``--include options_snapshots/SENSEX,options_tape/SENSEX``.
Their layout is identical (one day file per symbol dir), so the same verified
gzip path applies; the default target list is unchanged.

Caveat: the report API reads ``{date}.jsonl`` only, so a compacted day is not
served by the API until it is expanded again (``gunzip -k <file>.jsonl.gz``) —
this is a retention/disk tool, not a transparent filesystem. Nothing is lost:
the archive is byte-identical to the source.

Usage:
    python scripts/compact_nifty_data.py                      # inventory + plan
    python scripts/compact_nifty_data.py --days 7             # plan, 7-day cutoff
    python scripts/compact_nifty_data.py --apply              # compress snapshots
    python scripts/compact_nifty_data.py --apply \
        --include nifty_snapshots,nifty_chain10s
    python scripts/compact_nifty_data.py --apply \
        --include options_snapshots/SENSEX,options_chain10s/SENSEX,options_chain10s_greeks/SENSEX,options_tape/SENSEX
    python scripts/compact_nifty_data.py --json               # machine-readable
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import sys
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

_UI_DIR = Path(__file__).resolve().parent.parent
if str(_UI_DIR) not in sys.path:
    sys.path.insert(0, str(_UI_DIR))

DATA_SUBDIR = Path("experiments") / "data"
DIRS = ("nifty_snapshots", "nifty_chain10s", "nifty_chain10s_greeks",
        "nifty_ticks", "nifty_tape", "nifty_futures",
        # Generic (SENSEX / stock) recorder artefacts — same day-file layout,
        # one directory per symbol. Not compacted unless explicitly included.
        "sensex_futures",
        "options_snapshots/SENSEX", "options_chain10s/SENSEX",
        "options_chain10s_greeks/SENSEX", "options_tape/SENSEX")
DEFAULT_TARGETS = ("nifty_snapshots",)
MANIFEST_NAME = "nifty_compaction_manifest.json"
DEFAULT_MIN_AGE_DAYS = 7
#: Sampling 1 MiB per file keeps ``--dry-run`` instant on a 1.2 GB tree while
#: still giving an honest order-of-magnitude ratio for the plan.
SAMPLE_BYTES = 1024 * 1024
CHUNK = 1024 * 1024


def default_data_dir() -> Path:
    env = os.getenv("NIFTY_DATA_DIR")
    return Path(env).expanduser().resolve() if env else _UI_DIR / DATA_SUBDIR


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def session_date_of(path: Path) -> Optional[date]:
    """Session date encoded in the filename, else ``None``."""
    name = path.name
    stem = name[:-3] if name.endswith(".gz") else name
    head = stem[:10]
    try:
        return datetime.strptime(head, "%Y-%m-%d").date()
    except ValueError:
        return None


def is_gap_journal(path: Path) -> bool:
    return path.name.endswith(".gaps.jsonl") or path.name.endswith(".gaps.jsonl.gz")


def gz_path_for(path: Path) -> Path:
    return path.with_name(path.name + ".gz")


def _file_age_days(path: Path, today: date) -> float:
    session = session_date_of(path)
    if session is not None:
        return float((today - session).days)
    try:
        mtime = datetime.fromtimestamp(path.stat().st_mtime).date()
    except OSError:
        return 0.0
    return float((today - mtime).days)


def inventory(data_dir: Path, today: Optional[date] = None) -> list[dict]:
    """Size/age/count snapshot of every tracked directory. Read-only."""
    today = today or date.today()
    out: list[dict] = []
    for name in DIRS:
        path = data_dir / name
        entry: dict = {
            "dir": name,
            "path": str(path),
            "exists": path.is_dir(),
            "files": 0,
            "bytes": 0,
            "gz_files": 0,
            "gz_bytes": 0,
            "gap_files": 0,
            "oldest": None,
            "newest": None,
            "oldest_age_days": None,
        }
        if not path.is_dir():
            out.append(entry)
            continue
        sessions: list[date] = []
        for f in sorted(path.iterdir()):
            if not f.is_file():
                continue
            try:
                size = f.stat().st_size
            except OSError:
                continue
            if is_gap_journal(f):
                entry["gap_files"] += 1
                continue
            entry["files"] += 1
            entry["bytes"] += size
            if f.name.endswith(".gz"):
                entry["gz_files"] += 1
                entry["gz_bytes"] += size
            session = session_date_of(f)
            if session is not None:
                sessions.append(session)
        if sessions:
            entry["oldest"] = min(sessions).isoformat()
            entry["newest"] = max(sessions).isoformat()
            entry["oldest_age_days"] = (today - min(sessions)).days
        out.append(entry)
    return out


@dataclass
class CompressionPlan:
    """One candidate day file and the reason it will (not) be compressed."""
    path: str
    gz: str
    bytes: int
    age_days: float
    action: str
    skipped: str = ""
    estimated_gz_bytes: Optional[int] = None


@dataclass
class RunReport:
    data_dir: str
    applied: bool
    days: int
    include: list[str]
    inventory: list[dict] = field(default_factory=list)
    plan: list[dict] = field(default_factory=list)
    results: list[dict] = field(default_factory=list)
    manifest: str = ""
    total_before: int = 0
    total_after: int = 0
    errors: list[str] = field(default_factory=list)


def _estimate_gz_bytes(path: Path) -> Optional[int]:
    """Rough gzip size from a 1 MiB sample (None when unreadable/empty)."""
    try:
        with open(path, "rb") as fh:
            sample = fh.read(SAMPLE_BYTES)
    except OSError:
        return None
    if not sample:
        return None
    packed = len(gzip.compress(sample, compresslevel=6))
    try:
        size = path.stat().st_size
    except OSError:
        return None
    if len(sample) >= size:
        return packed
    return int(packed * (size / len(sample)))


def plan_compression(data_dir: Path, include: tuple[str, ...],
                     days: int = DEFAULT_MIN_AGE_DAYS,
                     today: Optional[date] = None) -> list[CompressionPlan]:
    """Candidate files per directory. Pure planning — no writes."""
    today = today or date.today()
    cutoff = today - timedelta(days=days)
    out: list[CompressionPlan] = []
    for name in include:
        path = data_dir / name
        if not path.is_dir():
            continue
        for f in sorted(path.iterdir()):
            if not f.is_file() or is_gap_journal(f):
                continue
            if f.name.endswith(".gz") or f.name.endswith(".part"):
                continue
            try:
                size = f.stat().st_size
            except OSError as exc:
                out.append(CompressionPlan(str(f), str(gz_path_for(f)), 0, 0,
                                           "skip", f"unreadable: {exc}"))
                continue
            age = _file_age_days(f, today)
            session = session_date_of(f)
            if session is not None and session >= cutoff:
                out.append(CompressionPlan(str(f), str(gz_path_for(f)), size, age,
                                           "keep", "within retention window"))
                continue
            if session is None and age < days:
                out.append(CompressionPlan(str(f), str(gz_path_for(f)), size, age,
                                           "keep", "too recent (mtime)"))
                continue
            if gz_path_for(f).exists():
                out.append(CompressionPlan(str(f), str(gz_path_for(f)), size, age,
                                           "skip", "archive already exists"))
                continue
            out.append(CompressionPlan(
                str(f), str(gz_path_for(f)), size, age, "compress",
                estimated_gz_bytes=_estimate_gz_bytes(f),
            ))
    return out


def compress_file(path: Path) -> dict:
    """Gzip ``path``, verify byte equality, then remove the source.

    Writes ``<name>.gz.part`` first so a crash mid-write can never leave a
    truncated archive that looks complete. Raises on any verification
    failure; the source is untouched in that case.
    """
    path = Path(path)
    gz = gz_path_for(path)
    part = gz.with_name(gz.name + ".part")
    before = path.stat().st_size
    digest = hashlib.sha256()
    try:
        with open(path, "rb") as src, gzip.open(part, "wb", compresslevel=9) as dst:
            for chunk in iter(lambda: src.read(CHUNK), b""):
                digest.update(chunk)
                dst.write(chunk)
        with open(part, "rb") as fh:
            os.fsync(fh.fileno())
        # Verify: decompress the archive and compare its digest to the source.
        check = hashlib.sha256()
        with gzip.open(part, "rb") as fh:
            for chunk in iter(lambda: fh.read(CHUNK), b""):
                check.update(chunk)
        if check.hexdigest() != digest.hexdigest():
            raise RuntimeError(f"gzip round-trip mismatch for {path.name}")
        os.replace(part, gz)
        after = gz.stat().st_size
        path.unlink()
    except Exception:
        try:
            if part.exists():
                part.unlink()
        except OSError:
            pass
        raise
    return {"source": str(path), "gz": str(gz), "bytes_before": before,
            "bytes_after": after, "sha256": digest.hexdigest()}


def manifest_path(data_dir: Path) -> Path:
    return data_dir / MANIFEST_NAME


def load_manifest(path: Path) -> dict:
    if not path.exists():
        return {"version": 1, "entries": []}
    try:
        with open(path) as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return {"version": 1, "entries": []}
    if not isinstance(data, dict) or not isinstance(data.get("entries"), list):
        return {"version": 1, "entries": []}
    return data


def save_manifest(path: Path, manifest: dict) -> None:
    """Atomic replace — a crash leaves the previous manifest intact."""
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w") as fh:
        json.dump(manifest, fh, indent=2, sort_keys=True)
        fh.write("\n")
    os.replace(tmp, path)


def run(data_dir: Path, include: tuple[str, ...],
        days: int = DEFAULT_MIN_AGE_DAYS,
        apply: bool = False,
        now: Optional[datetime] = None) -> RunReport:
    now = now or datetime.now()
    report = RunReport(
        data_dir=str(data_dir), applied=bool(apply), days=days,
        include=list(include), manifest=str(manifest_path(data_dir)),
    )
    report.inventory = inventory(data_dir, today=now.date())
    plans = plan_compression(data_dir, include, days=days, today=now.date())
    report.plan = [asdict(p) for p in plans]
    candidates = [p for p in plans if p.action == "compress"]
    report.total_before = sum(p.bytes for p in candidates)
    report.total_after = sum(
        p.estimated_gz_bytes or p.bytes for p in candidates
    )
    if not apply:
        return report
    data_dir.mkdir(parents=True, exist_ok=True)
    mpath = manifest_path(data_dir)
    manifest = load_manifest(mpath)
    stamped = now.isoformat()
    for plan in candidates:
        try:
            result = compress_file(Path(plan.path))
        except Exception as exc:  # keep going: one bad file must not stop the run
            report.errors.append(f"{plan.path}: {type(exc).__name__}: {exc}")
            continue
        report.results.append(result)
        try:
            rel_dir = str(Path(plan.path).parent.relative_to(data_dir))
        except ValueError:
            rel_dir = Path(plan.path).parent.name
        manifest["entries"].append({
            "t": stamped,
            "dir": rel_dir,
            "file": Path(plan.path).name,
            "gz": Path(result["gz"]).name,
            "bytes_before": result["bytes_before"],
            "bytes_after": result["bytes_after"],
            "sha256": result["sha256"],
        })
    if report.results:
        save_manifest(mpath, manifest)
    return report


def _human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1024 or unit == "TB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024
    return f"{n:.1f} TB"


def format_report(report: RunReport) -> str:
    lines = []
    mode = "APPLY" if report.applied else "DRY-RUN"
    lines.append(f"Nifty/options data inventory ({mode}) — {report.data_dir}")
    lines.append("")
    # One column width for every row: the symbol-scoped generic dirs are
    # longer than the NIFTY names, and a fixed 24-column pad would shear the
    # size columns out of line.
    width = max([24] + [len(r["dir"]) + 2 for r in report.inventory])
    head = (f"{'directory':<{width}}{'files':>7}{'size':>12}{'gz':>7}"
            f"{'gz size':>12}{'oldest':>12}{'age(d)':>8}")
    lines.append(head)
    for row in report.inventory:
        if not row["exists"]:
            lines.append(f"{row['dir']:<{width}}{'—':>7}{'missing':>12}")
            continue
        lines.append(
            f"{row['dir']:<{width}}{row['files']:>7}{_human(row['bytes']):>12}"
            f"{row['gz_files']:>7}{_human(row['gz_bytes']):>12}"
            f"{str(row['oldest'] or '—'):>12}{str(row['oldest_age_days'] if row['oldest_age_days'] is not None else '—'):>8}"
        )
    lines.append("")
    to_compress = [p for p in report.plan if p["action"] == "compress"]
    lines.append(
        f"Plan: {len(to_compress)} file(s) older than {report.days} day(s) "
        f"in {', '.join(report.include)}")
    for p in to_compress:
        est = p.get("estimated_gz_bytes")
        tail = f" → ~{_human(est)}" if est else ""
        lines.append(f"  compress {Path(p['path']).name:<24}{_human(p['bytes']):>10}{tail}")
    skipped = [p for p in report.plan if p["action"] == "skip"]
    for p in skipped[:10]:
        lines.append(f"  skip     {Path(p['path']).name:<24}{p['skipped']}")
    if len(skipped) > 10:
        lines.append(f"  … {len(skipped) - 10} more skipped")
    if to_compress:
        saved = max(0, report.total_before - report.total_after)
        pct = (saved / report.total_before * 100) if report.total_before else 0
        lines.append(
            f"Estimated: {_human(report.total_before)} → "
            f"{_human(report.total_after)} (~{pct:.0f}% smaller)")
    if report.applied:
        lines.append("")
        lines.append(f"Compressed {len(report.results)} file(s).")
        for r in report.results:
            lines.append(f"  {Path(r['source']).name} → "
                         f"{Path(r['gz']).name} ({_human(r['bytes_before'])} → "
                         f"{_human(r['bytes_after'])})")
        if report.errors:
            lines.append(f"Errors ({len(report.errors)}):")
            for err in report.errors:
                lines.append(f"  {err}")
        lines.append(f"Manifest: {report.manifest}")
        lines.append("Note: the API reads {date}.jsonl only — a compacted day "
                     "is restored with `gunzip -k <file>.jsonl.gz`.")
    elif to_compress:
        lines.append("")
        lines.append("Nothing changed. Re-run with --apply to compress.")
    return "\n".join(lines)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Inventory and (opt-in) gzip-compact Nifty report data.")
    parser.add_argument("--days", type=int, default=DEFAULT_MIN_AGE_DAYS,
                        help=f"compress day files older than N days "
                             f"(default {DEFAULT_MIN_AGE_DAYS})")
    parser.add_argument("--apply", action="store_true",
                        help="actually compress (default: dry-run)")
    parser.add_argument("--include", default=",".join(DEFAULT_TARGETS),
                        help="comma-separated directories to compact "
                             f"(default {','.join(DEFAULT_TARGETS)}; "
                             f"choices: {', '.join(DIRS)})")
    parser.add_argument("--data-dir", type=Path, default=None,
                        help="data root (default experiments/data)")
    parser.add_argument("--json", action="store_true",
                        help="print the run report as JSON")
    args = parser.parse_args(argv)

    include = tuple(x.strip() for x in args.include.split(",") if x.strip())
    unknown = [x for x in include if x not in DIRS]
    if unknown:
        parser.error(f"unknown directory/directories: {', '.join(unknown)}")
    if args.days < 0:
        parser.error("--days must be >= 0")

    data_dir = (args.data_dir or default_data_dir()).expanduser().resolve()
    report = run(data_dir, include, days=args.days, apply=args.apply)
    if args.json:
        print(json.dumps(asdict(report), indent=2))
    else:
        print(format_report(report))
    return 1 if report.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
