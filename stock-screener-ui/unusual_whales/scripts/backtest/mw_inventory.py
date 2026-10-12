#!/usr/bin/env python3
"""Inventory of the local MotiveWave historical-data store.

Reads only headers of tick files (never the 1.5 GB payload) and fully decodes
the small bar files.  Emits machine-readable JSON to /tmp/opencode and a
markdown inventory to stdout.

Read-only: this script never writes into ~/.motivewave.
"""
from __future__ import annotations

import json
import os
import struct
import sys
import zipfile
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mw_decode import decode_file, BarFile, TickFile  # noqa: E402

ROOT = Path(os.environ.get("MOTIVEWAVE_DATA_DIR", "~/.motivewave/historical_data")).expanduser()
IST = timezone(timedelta(hours=5, minutes=30))

TICK_MAGICS = {0x3281BB96: "a", 0x3281BB97: "b", 0x3281BB98: "c"}


def _dt(ms: int, tz=timezone.utc) -> str:
    if not ms:
        return ""
    try:
        return datetime.fromtimestamp(ms / 1000, tz).strftime("%Y-%m-%d %H:%M:%S")
    except (OverflowError, OSError, ValueError):
        return str(ms)


def tick_header(path: Path) -> dict | None:
    """Header-only read of a .tick_data / .tick_data.zip file."""
    try:
        if path.name.endswith(".zip"):
            with zipfile.ZipFile(path) as z:
                name = z.namelist()[0]
                with z.open(name) as fh:
                    data = fh.read(300)
        else:
            with open(path, "rb") as fh:
                data = fh.read(300)
    except (OSError, zipfile.BadZipFile, IndexError):
        return None
    if len(data) < 41:
        return None
    magic, = struct.unpack_from(">i", data, 0)
    name = TICK_MAGICS.get(magic)
    if name is None:
        return {"magic": f"0x{magic:08X}", "count": 0, "block_start": 0,
                "block_end": 0, "first_ts": 0, "last_ts": 0, "empty": True,
                "unknown": True}
    if name in ("a", "b"):
        # legacy: header ts fields are the only trustworthy ones
        count, = struct.unpack_from(">i", data, 8)
        t0, = struct.unpack_from(">q", data, 12)
        t1, = struct.unpack_from(">q", data, 20)
        return {"magic": name, "count": count, "block_start": t0,
                "block_end": t1, "first_ts": t0, "last_ts": t1,
                "empty": count == 0, "legacy": True}
    count, = struct.unpack_from(">i", data, 5)
    t0, t1, first, last = struct.unpack_from(">qqqq", data, 9)
    return {"magic": name, "count": count, "block_start": t0,
            "block_end": t1, "first_ts": first, "last_ts": last,
            "empty": count == 0}


def bar_summary(path: Path) -> list[dict]:
    """Decode a bar file; return one summary row per (bar size) present."""
    try:
        bf = decode_file(str(path))
    except Exception as exc:  # noqa: BLE001
        return [{"file": path.name, "error": f"{type(exc).__name__}: {exc}"}]
    if not isinstance(bf, BarFile) or not bf.rows:
        return []
    ts = [r.get("ts", 0) for r in bf.rows if r.get("ts")]
    if not ts:
        return []
    return [{
        "file": path.name,
        "magic": bf.magic,
        "minutes": bf.fmt_minutes,
        "count": bf.count,
        "rows": len(bf.rows),
        "first_ts": min(ts),
        "last_ts": max(ts),
        "size": path.stat().st_size,
    }]


def mnq_tick_coverage() -> dict:
    """Per-day block density for every MNQ tick contract present."""
    from collections import Counter
    per_contract = {}
    for src in ("RITHMIC", "CQG"):
        base = ROOT / src
        if not base.is_dir():
            continue
        for d in base.iterdir():
            if not (d.is_dir() and d.name.split(".")[0].startswith("MNQ")):
                continue
            files = sorted(p for p in d.glob("*.tick_data*"))
            if not files:
                continue
            days: Counter = Counter()
            total = 0
            first = last = None
            for f in files:
                h = tick_header(f)
                if not h or h.get("count", 0) == 0:
                    continue
                total += h["count"]
                day = datetime.fromtimestamp(h["block_start"] / 1000, timezone.utc).date()
                days[day] += 1
                if first is None or h["block_start"] < first:
                    first = h["block_start"]
                if last is None or h["block_end"] > last:
                    last = h["block_end"]
            if days:
                per_contract[f"{src}/{d.name}"] = {
                    "ticks": total,
                    "days": {str(k): v for k, v in sorted(days.items())},
                    "n_days": len(days),
                    "first_utc": _dt(first), "last_utc": _dt(last),
                }
    return per_contract


def check_liveness(wait: float = 10.0) -> dict:
    """Sample the newest MNQ tick block twice to see whether it is still writing."""
    import time as _t
    base = ROOT / "RITHMIC"
    inst = None
    best = None
    for d in base.iterdir() if base.is_dir() else []:
        if not (d.is_dir() and d.name.split(".")[0].startswith("MNQ")):
            continue
        blocks = [p for p in d.glob("*.tick_data*")]
        if not blocks:
            continue
        newest = max(blocks, key=lambda p: int(p.name.split(".")[0]) if p.name.split(".")[0].isdigit() else 0)
        key = int(newest.name.split(".")[0]) if newest.name.split(".")[0].isdigit() else 0
        if best is None or key > best:
            best, inst, nf = key, d, newest
    if inst is None:
        return {"live": None, "reason": "no MNQ blocks"}
    h1 = tick_header(nf)
    time1 = _t.time()
    _t.sleep(wait)
    h2 = tick_header(nf)
    grew = bool(h1 and h2 and h2.get("count", 0) >= h1.get("count", 0))
    changed = bool(h1 and h2 and (h2.get("count") != h1.get("count") or
                                  h2.get("last_ts") != h1.get("last_ts")))
    return {"instrument": inst.name, "block": nf.name,
            "count_t0": h1.get("count") if h1 else None,
            "count_t1": h2.get("count") if h2 else None,
            "last_ts_t0": _dt(h1["last_ts"]) if h1 else None,
            "last_ts_t1": _dt(h2["last_ts"]) if h2 else None,
            "changed_over_%ss" % wait: changed,
            "file_mtime_age_s": round(time1 - nf.stat().st_mtime, 1)}


def main() -> None:
    instruments: dict[str, dict] = defaultdict(lambda: {
        "ticks": {"plain": 0, "zip": 0, "count": 0, "empty": 0,
                  "first_ts": None, "last_ts": None,
                  "block_start": None, "block_end": None,
                  "legacy": 0, "unknown": 0, "bytes": 0},
        "bars": defaultdict(lambda: {"files": 0, "count": 0, "rows": 0,
                                     "first_ts": None, "last_ts": None,
                                     "bytes": 0, "magic": set()}),
        "sources": set(),
        "dirs": [],
    })

    all_files = [p for p in ROOT.rglob("*") if p.is_file()]
    total_bytes = sum(p.stat().st_size for p in all_files)

    for path in all_files:
        fname = path.name
        rel = path.relative_to(ROOT)
        source = rel.parts[0]
        inst = rel.parts[1] if len(rel.parts) > 2 else "(root)"
        key = f"{source}/{inst}"
        e = instruments[key]
        e["sources"].add(source)
        marks = f"{source.lower()}"
        if e["dirs"] and e["dirs"][-1] != str(rel.parent):
            e["dirs"].append(str(rel.parent))
        elif not e["dirs"]:
            e["dirs"].append(str(rel.parent))

        if ".tick_data" in fname:
            h = tick_header(path)
            t = e["ticks"]
            t["bytes"] += path.stat().st_size
            if fname.endswith(".zip"):
                t["zip"] += 1
            else:
                t["plain"] += 1
            if not h:
                continue
            if h.get("unknown"):
                t["unknown"] += 1
                continue
            if h.get("legacy"):
                t["legacy"] += 1
            c = h["count"] or 0
            t["count"] += c
            if c == 0:
                t["empty"] += 1
            f, l = h["first_ts"], h["last_ts"]
            if f and (t["first_ts"] is None or f < t["first_ts"]):
                t["first_ts"] = f
            if l and (t["last_ts"] is None or l > t["last_ts"]):
                t["last_ts"] = l
            bs, be = h["block_start"], h["block_end"]
            if bs and (t["block_start"] is None or bs < t["block_start"]):
                t["block_start"] = bs
            if be and (t["block_end"] is None or be > t["block_end"]):
                t["block_end"] = be
        elif ".bar_data" in fname:
            try:
                mins = int(fname.split("bar_data")[1].split(".")[0])
            except (IndexError, ValueError):
                continue
            b = e["bars"][mins]
            b["files"] += 1
            b["bytes"] += path.stat().st_size
            summ = bar_summary(path)
            for s in summ:
                if "error" in s:
                    continue
                b["count"] += s["count"]
                b["rows"] += s["rows"]
                b["magic"].add(s["magic"])
                if b["first_ts"] is None or s["first_ts"] < b["first_ts"]:
                    b["first_ts"] = s["first_ts"]
                if b["last_ts"] is None or s["last_ts"] > b["last_ts"]:
                    b["last_ts"] = s["last_ts"]

    # normalise sets -> lists
    out = {}
    for k, e in instruments.items():
        e["sources"] = sorted(e["sources"])
        bars = {}
        for mins, b in sorted(e["bars"].items()):
            b["magic"] = sorted(b["magic"])
            bars[str(mins)] = b
        e["bars"] = bars
        out[k] = e

    payload = {
        "root": str(ROOT),
        "generated_utc": _dt(int(datetime.now(timezone.utc).timestamp() * 1000)),
        "total_bytes": total_bytes,
        "total_bytes_human": f"{total_bytes/1e9:.2f} GB",
        "total_files": len(all_files),
        "instruments": out,
    }
    (Path("/tmp/opencode") / "mw_inventory.json").write_text(json.dumps(payload, indent=2, default=str))

    # ---------------- markdown ----------------
    lines = ["# MotiveWave local data inventory", "",
             f"Root: `{ROOT}`  ", f"Total on disk: **{total_bytes/1e9:.2f} GB** across {len(all_files)} files  ",
             f"Generated (UTC): {payload['generated_utc']}", "",
             "## Ticks", "",
             "| source/instrument | plain | zip | blocks | ticks | empty | first tick (UTC) | last tick (UTC) | span |",
             "|---|---:|---:|---:|---:|---:|---|---|---|"]

    grand = {"blocks": 0, "ticks": 0, "empty": 0, "bytes": 0, "zip": 0, "plain": 0}
    for k in sorted(out):
        e = out[k]
        t = e["ticks"]
        blocks = t["plain"] + t["zip"]
        if not blocks:
            continue
        grand["blocks"] += blocks
        grand["ticks"] += t["count"]
        grand["empty"] += t["empty"]
        grand["bytes"] += t["bytes"]
        grand["zip"] += t["zip"]
        grand["plain"] += t["plain"]
        span = ""
        if t["first_ts"] and t["last_ts"]:
            span = str(timedelta(milliseconds=t["last_ts"] - t["first_ts"]))
        lines.append(
            f"| {k} | {t['plain']} | {t['zip']} | {blocks} | {t['count']:,} | "
            f"{t['empty']} | {_dt(t['first_ts'])} | {_dt(t['last_ts'])} | {span} |")

    lines += ["", f"**Tick totals:** {grand['ticks']:,} ticks in {grand['blocks']:,} blocks "
                  f"({grand['plain']:,} plain / {grand['zip']:,} zip), "
                  f"{grand['empty']:,} empty blocks, {grand['bytes']/1e9:.2f} GB.", "",
              "## Bars", "",
              "| source/instrument | bar size | files | bars | first (UTC) | last (UTC) | span |",
              "|---|---:|---:|---:|---|---|---|"]
    bar_tot = defaultdict(lambda: {"files": 0, "bars": 0})
    for k in sorted(out):
        for mins, b in out[k]["bars"].items():
            span = ""
            if b["first_ts"] and b["last_ts"]:
                span = str(timedelta(milliseconds=b["last_ts"] - b["first_ts"]))
            bar_tot[mins]["files"] += b["files"]
            bar_tot[mins]["bars"] += b["count"]
            lines.append(
                f"| {k} | {mins}m | {b['files']} | {b['count']:,} | "
                f"{_dt(b['first_ts'])} | {_dt(b['last_ts'])} | {span} |")
    lines += ["", "**Bar totals:** " + ", ".join(
        f"{m}m: {v['files']} files / {v['bars']:,} bars" for m, v in sorted(bar_tot.items(), key=lambda x: int(x[0])))]

    # ---------------- MNQ tick focus ----------------
    cov = mnq_tick_coverage()
    lines += ["", "## MNQ tick-data coverage (what the user trades)", ""]
    if not cov:
        lines.append("No MNQ tick files found.")
    else:
        lines += ["| source/contract | ticks | distinct UTC days | first (UTC) | last (UTC) |",
                  "|---|---:|---:|---|---|"]
        for k, v in sorted(cov.items()):
            lines.append(f"| {k} | {v['ticks']:,} | {v['n_days']} | {v['first_utc']} | {v['last_utc']} |")
        # combined per-day density
        combo = {}
        for k, v in cov.items():
            for day, nb in v["days"].items():
                combo[day] = combo.get(day, 0) + nb
        lines += ["", f"Combined MNQ days with any tick block: **{len(combo)}**. "
                      "Hourly blocks per day (a full MNQ session is ~23 blocks):", "",
                  "| day (UTC) | blocks | day (UTC) | blocks |",
                  "|---|---:|---|---:|"]
        days_sorted = sorted(combo)
        half = (len(days_sorted) + 1) // 2
        for i in range(half):
            a = days_sorted[i]
            b = days_sorted[i + half] if i + half < len(days_sorted) else ""
            lines.append(f"| {a} | {combo[a]} | {b} | {combo[b] if b else ''} |")
        full = [d for d, n in combo.items() if n >= 15]
        lines += ["", f"Days with a near-complete session (>=15 hourly blocks): **{len(full)}** -> {full}", ""]

    live = check_liveness()
    lines += ["## Live-capture status (RITHMIC newest MNQ block)", "",
              "```json", json.dumps(live, indent=2), "```"]

    report = "\n".join(lines)
    (Path("/tmp/opencode") / "mw_inventory.md").write_text(report)
    print(report)


if __name__ == "__main__":
    main()
