"""Propose news-symbol alias candidates (READ-ONLY).

Scans distinct ``news_symbol_mentions`` keys (the coalesced
``COALESCE(trading_symbol, symbol_code)`` join key the catalyst/event
pipelines use) against NSE_EQ ``instruments`` and classifies each key that
fails an exact match:

  COVERED    - already in data/symbol_aliases.json (target verified present)
  PROPOSED   - exactly one candidate (normalize / digit-strip / rename table)
  AMBIGUOUS  - multiple candidates or structural (demerger, short code):
               left unmapped on purpose, needs a human
  MANUAL     - opaque moneycontrol-style code, company_name shown as hint
  JUNK       - extractor noise (people, sectors, sponsors): never map

Prints a report to stdout. Writes nothing, never touches the DB beyond a
read-only SELECT. Exit 0 always (report-only tool).
"""

from __future__ import annotations

import os
import re
import sqlite3
import sys
from collections import Counter, defaultdict

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(REPO, "db", "alphashri.db")

sys.path.insert(0, REPO)

from trading.symbol_aliases import alias_map  # noqa: E402

try:
    from api.symbols import normalize_tv_symbol  # noqa: E402
except Exception:  # pragma: no cover - fallback when API deps missing
    def normalize_tv_symbol(raw):  # type: ignore[misc]
        return ("" if raw is None else str(raw)).upper().strip()

# Hand rename watchlist: stale/news name -> current NSE_EQ symbol.
RENAMES = {
    "ZOMATO": "ETERNAL",
    "TATAMOTORS": None,  # demerger: TMPV + TMCV, structurally ambiguous
    "TATAMOTOR": None,
    "MM": None,  # ET short code: M&M vs M&MFIN unclear
}

MC_CODE = re.compile(r"^[A-Z]{1,4}\d{2}[A-Z0-9]*$")
DIGIT_SUFFIX = re.compile(r"^([A-Z&.\- ]+?)(\d{2,})$")
GENERIC_NAMES = {"company", "stock", "insurer", "hospital", "shares",
                 "the company", "company's", "screener", "screener.in",
                 "source: screener", "source: screener.in"}


def _looks_like_person(code: str) -> bool:
    return bool(re.match(r"^[A-Za-z]+ [A-Za-z]+( [A-Za-z]+)?$", code or ""))


def main() -> int:
    try:
        con = sqlite3.connect(f"file:{os.path.abspath(DB_PATH)}?mode=ro", uri=True)
    except Exception as exc:
        print(f"cannot open DB read-only: {exc}")
        return 0
    try:
        try:
            inst_rows = con.execute(
                "SELECT UPPER(trading_symbol) FROM instruments "
                "WHERE segment='NSE_EQ'").fetchall()
        except Exception as exc:
            print(f"instrument read failed: {exc}")
            return 0
        instruments = {r[0] for r in inst_rows if r and r[0]}
        stripped_index: dict[str, set] = defaultdict(set)
        for sym in instruments:
            stripped_index[re.sub(r"[^A-Z0-9]", "", sym)].add(sym)
        try:
            mentions = con.execute(
                "SELECT UPPER(COALESCE(NULLIF(trading_symbol,''), symbol_code)), "
                "symbol_code, company_name FROM news_symbol_mentions").fetchall()
        except Exception as exc:
            print(f"mentions read failed: {exc}")
            return 0
    finally:
        try:
            con.close()
        except Exception:
            pass

    counts: Counter = Counter()
    example: dict = {}
    for raw, code, name in mentions:
        if not raw:
            continue
        counts[raw] += 1
        example.setdefault(raw, (code, name))

    aliases = alias_map()
    buckets: dict[str, list] = {k: [] for k in
                                ("COVERED", "RESOLVABLE", "PROPOSED",
                                 "AMBIGUOUS", "MANUAL", "JUNK")}
    for raw in sorted(counts):
        code, name = example[raw]
        n = counts[raw]
        norm = normalize_tv_symbol(raw)
        if raw in instruments:
            buckets["RESOLVABLE"].append((raw, n, "exact instrument hit"))
            continue
        if norm in aliases:
            target = aliases[norm]
            flag = "" if target in instruments else " !! target missing from instruments"
            buckets["COVERED"].append((raw, n, f"-> {target}{flag}"))
            continue
        lname = str(name or "").strip().lower()
        if (raw in ("SCREENER.IN", "SCREENER", "SOURCE:SCREENER",
                    "SOURCE:SCREENER.IN") or lname in GENERIC_NAMES
                or _looks_like_person(code or "")):
            buckets["JUNK"].append((raw, n, f"code={code!r} name={name!r}"))
            continue
        if norm in instruments and norm != raw:
            buckets["PROPOSED"].append((raw, n, f"normalize -> {norm}"))
            continue
        if raw in RENAMES:
            target = RENAMES[raw]
            if target and target in instruments:
                buckets["PROPOSED"].append((raw, n, f"rename -> {target}"))
            else:
                buckets["AMBIGUOUS"].append((raw, n, "rename needs human (demerger/short-code)"))
            continue
        m = DIGIT_SUFFIX.match(raw)
        if m and len(m.group(1).strip()) >= 3:
            base = normalize_tv_symbol(m.group(1))
            if base in instruments:
                buckets["PROPOSED"].append((raw, n, f"digit-strip -> {base}"))
                continue
        stripped = re.sub(r"[^A-Z0-9]", "", raw)
        cands = stripped_index.get(stripped, set()) if len(stripped) >= 3 else set()
        if len(cands) == 1:
            buckets["PROPOSED"].append((raw, n, f"separator-variant -> {sorted(cands)[0]}"))
            continue
        if len(cands) > 1:
            buckets["AMBIGUOUS"].append((raw, n, f"separator-variant x{len(cands)}: {sorted(cands)[:4]}"))
            continue
        starts = [s for s in instruments if s.startswith(raw)] if len(raw) >= 3 else []
        if len(starts) == 1:
            buckets["PROPOSED"].append((raw, n, f"unique prefix-of -> {starts[0]}"))
            continue
        if len(starts) > 1:
            buckets["AMBIGUOUS"].append((raw, n, f"prefix of x{len(starts)}"))
            continue
        if MC_CODE.match(raw or ""):
            buckets["MANUAL"].append((raw, n, f"code={code!r} name={name!r}"))
            continue
        buckets["MANUAL"].append((raw, n, f"code={code!r} name={name!r}"))
    for bucket, rows in buckets.items():
        print(f"== {bucket} ({len(rows)} distinct, {sum(n for _, n, _ in rows)} rows) ==")
        for raw, n, why in rows[:60]:
            print(f"  {raw!r:32} n={n:<4} {why}")
        if len(rows) > 60:
            print(f"  ... +{len(rows) - 60} more")
    total_missing = sum(len(v) for k, v in buckets.items() if k != "RESOLVABLE")
    print(f"\ninstruments={len(instruments)} distinct_raw={len(counts)} "
          f"missing={total_missing} aliases_curated={len(aliases)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
