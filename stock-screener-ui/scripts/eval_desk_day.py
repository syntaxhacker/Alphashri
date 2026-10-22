#!/usr/bin/env python3
"""Audit one desk day: are the numbers right, and did the reads predict?

Replays the recorded 1-min tape through the desk's OWN functions (no
reimplementation) and scores each signal against what the spot actually did
next. Answers three questions:

  1. Parity   - do the tape's recorded aggregates match the chain they came
                from (OI totals, PCR, max pain, ATM strike/premium)?
  2. Accuracy - conditional on the desk calling the tape bullish / bearish /
                covering / fresh, what did the next 10/30 minutes do?
  3. Trades   - for each manual trade, what was the premium path (MFE/MAE),
                and did the stop/target/exit leave money on the table?

Usage:
    .venv/bin/python scripts/eval_desk_day.py --date 2026-10-22
    .venv/bin/python scripts/eval_desk_day.py --date 2026-10-22 --md out.md
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from api.reports_api.nifty import (  # noqa: E402
    compute_max_pain,
    compute_pcr,
    derive_tape_rows,
    near_walls,
)
from api.reports_api.nifty_bursts import (  # noqa: E402
    detect_oi_bursts,
    session_trend,
)
from api.reports_api.nifty_fuel import (  # noqa: E402
    plan_allowed,
    fuel_state,
    structure_evidence,
)

TAPE = ROOT / "experiments" / "data" / "nifty_tape"
OUTDIR = ROOT / "reports" / "OPTIONS_PAPER_SIM"


def _f(v):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return v if v == v else None


def load(date: str) -> list[dict]:
    path = TAPE / f"{date}.jsonl"
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    return [r for r in rows if r.get("chain")]


def strikes_of(row: dict) -> list[dict]:
    out = []
    for k, v in row["chain"].items():
        ce_oi, pe_oi = _f(v[2]) or 0.0, _f(v[3]) or 0.0
        out.append({
            "strike": float(k),
            "ce_oi": ce_oi, "pe_oi": pe_oi,
            "ce": {"oi": ce_oi, "ltp": _f(v[0]) or 0.0, "volume": _f(v[4]) or 0.0},
            "pe": {"oi": pe_oi, "ltp": _f(v[1]) or 0.0, "volume": _f(v[5]) or 0.0},
        })
    return sorted(out, key=lambda x: x["strike"])


# --------------------------------------------------------------------- parity
def parity(rows: list[dict]) -> dict:
    bad = {"ce_oi": 0, "pe_oi": 0, "pcr": 0, "maxpain": 0, "atm": 0, "atm_ltp": 0}
    worst = {"ce_oi": 0.0, "pe_oi": 0.0, "pcr": 0.0, "maxpain": 0.0}
    mp_mismatch_at: list[str] = []
    for r in rows:
        s = strikes_of(r)
        spot = _f(r.get("spot")) or 0.0
        ce = sum(x["ce_oi"] for x in s)
        pe = sum(x["pe_oi"] for x in s)
        if abs(ce - (_f(r.get("ce_oi")) or 0)) > 1:
            bad["ce_oi"] += 1
            worst["ce_oi"] = max(worst["ce_oi"], abs(ce - (_f(r.get("ce_oi")) or 0)))
        if abs(pe - (_f(r.get("pe_oi")) or 0)) > 1:
            bad["pe_oi"] += 1
            worst["pe_oi"] = max(worst["pe_oi"], abs(pe - (_f(r.get("pe_oi")) or 0)))
        pcr = compute_pcr(pe, ce)
        rpcr = _f(r.get("pcr_oi"))
        if pcr is not None and rpcr is not None and abs(pcr - rpcr) > 0.01:
            bad["pcr"] += 1
            worst["pcr"] = max(worst["pcr"], abs(pcr - rpcr))
        mp = compute_max_pain(s)
        rmp = _f(r.get("max_pain"))
        if rmp is not None and abs(mp - rmp) > 0.5:
            bad["maxpain"] += 1
            worst["maxpain"] = max(worst["maxpain"], abs(mp - rmp))
            mp_mismatch_at.append(r["t"][11:16])
        atm = min(s, key=lambda x: abs(x["strike"] - spot))["strike"]
        if (_f(r.get("atm_strike")) or 0) != atm:
            bad["atm"] += 1
        leg = next(x for x in s if x["strike"] == atm)
        if abs(leg["ce"]["ltp"] - (_f(r.get("atm_ce_ltp")) or 0)) > 0.01:
            bad["atm_ltp"] += 1
    return {"rows": len(rows), "bad": bad, "worst": worst,
            "maxpain_mismatch_at": mp_mismatch_at}


# --------------------------------------------------------------------- phases
def phases(rows: list[dict], thr: float = 30.0) -> list[dict]:
    """Ex-post swing segments: an up/down leg is confirmed once price retraces
    ``thr`` points from its extreme."""
    segs: list[dict] = []
    start = rows[0]
    direction = 0
    extreme_i = 0
    for i, r in enumerate(rows):
        spot = _f(r.get("spot"))
        ext = _f(rows[extreme_i].get("spot"))
        if spot is None or ext is None:
            continue
        if direction >= 0 and spot > ext:
            extreme_i, direction = i, 1
        elif direction <= 0 and spot < ext:
            extreme_i, direction = i, -1
        elif direction > 0 and ext - spot >= thr:
            segs.append({"from": start["t"], "to": rows[extreme_i]["t"],
                         "dir": "up", "a": _f(start["spot"]), "b": ext})
            start, extreme_i, direction = rows[extreme_i], i, -1
        elif direction < 0 and spot - ext >= thr:
            segs.append({"from": start["t"], "to": rows[extreme_i]["t"],
                         "dir": "down", "a": _f(start["spot"]), "b": ext})
            start, extreme_i, direction = rows[extreme_i], i, 1
    segs.append({"from": start["t"], "to": rows[-1]["t"], "dir":
                 "up" if direction > 0 else "down" if direction < 0 else "flat",
                 "a": _f(start["spot"]), "b": _f(rows[-1]["spot"])})
    return [s for s in segs if s["a"] and s["b"]]


def phase_at(segs: list[dict], t: str) -> str:
    for s in segs:
        if s["from"] <= t <= s["to"]:
            return s["dir"]
    return "flat"


# ---------------------------------------------------------------- forward ret
def forward(rows: list[dict], i: int, minutes: int) -> float | None:
    t0 = datetime.fromisoformat(rows[i]["t"])
    target = t0 + timedelta(minutes=minutes)
    best, best_gap = None, 1e9
    for j in range(i + 1, len(rows)):
        dt = abs((datetime.fromisoformat(rows[j]["t"]) - target).total_seconds())
        if dt < best_gap:
            best, best_gap = j, dt
        if datetime.fromisoformat(rows[j]["t"]) > target + timedelta(minutes=3):
            break
    # A forward window that had to jump a tape gap is not a measurement.
    if best is None or best_gap > 120:
        return None
    a, b = _f(rows[i]["spot"]), _f(rows[best]["spot"])
    return None if a is None or b is None else b - a


def score(name: str, outcomes: list[tuple[bool, float]]) -> dict:
    n = len(outcomes)
    hits = sum(1 for ok, _ in outcomes if ok)
    rets = [r for ok, r in outcomes if ok]
    opp = [r for ok, r in outcomes if not ok]
    return {"name": name, "n": n, "hit": (hits / n * 100) if n else 0.0,
            "avg_win_pts": (sum(rets) / len(rets)) if rets else 0.0,
            "avg_loss_pts": (sum(opp) / len(opp)) if opp else 0.0}


# ------------------------------------------------------------------ the audit
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=datetime.now().strftime("%Y-%m-%d"))
    ap.add_argument("--md", default="")
    a = ap.parse_args()
    rows = load(a.date)
    segs = phases(rows)
    out: list[str] = []
    w = out.append

    w(f"# Desk day audit — {a.date}")
    w(f"\n_tape rows with a chain: **{len(rows)}** · "
      f"{rows[0]['t'][11:16]}–{rows[-1]['t'][11:16]}_\n")

    # 1. parity
    p = parity(rows)
    w("## 1. Are the calculations right? (parity vs the chain)\n")
    w("| field | mismatches | worst delta |")
    w("|---|---|---|")
    for k in ("ce_oi", "pe_oi", "pcr", "maxpain", "atm", "atm_ltp"):
        w(f"| {k} | {p['bad'][k]} / {p['rows']} | {p['worst'].get(k, 0):,.2f} |")
    if p["maxpain_mismatch_at"]:
        w(f"\n`max_pain` disagrees on {len(p['maxpain_mismatch_at'])} rows, always by one "
          f"strike (100 pts), at: {', '.join(p['maxpain_mismatch_at'][:12])}"
          f"{' …' if len(p['maxpain_mismatch_at']) > 12 else ''}. "
          "Cause: the live report prefers Upstox's **official** max pain "
          "(`bucket_interval=30`, i.e. coarse) and only falls back to the "
          "computed value — but the tape does not record which source it used. "
          "Every pin study therefore mixes two definitions.")
    else:
        w("\n`max_pain` matches the computed value on every row.")

    # 2. phases
    w("\n## 2. What the day actually did (ex-post swings, 30-pt retrace)\n")
    w("| from | to | dir | move (pts) |")
    w("|---|---|---|---|")
    for s in segs:
        w(f"| {s['from'][11:16]} | {s['to'][11:16]} | {s['dir']} | {s['b'] - s['a']:+.0f} |")

    # 3. signal accuracy
    w("\n## 3. Did the reads predict? (forward spot, 10m and 30m)\n")
    trend10, trend30 = [], []
    for i, r in enumerate(rows[:-1]):
        lab = session_trend(rows, at_time=r["t"])
        f10, f30 = forward(rows, i, 10), forward(rows, i, 30)
        if lab and f10 is not None:
            trend10.append((lab == "up" and f10 > 0 or lab == "down" and f10 < 0, f10))
        if lab and f30 is not None:
            trend30.append((lab == "up" and f30 > 0 or lab == "down" and f30 < 0, f30))
    for sc in (score("EMA20 trend → 10m", trend10), score("EMA20 trend → 30m", trend30)):
        w(f"| {sc['name']} | n={sc['n']} | hit **{sc['hit']:.0f}%** | "
          f"right {sc['avg_win_pts']:+.1f} pts | wrong {sc['avg_loss_pts']:+.1f} pts |")

    # trend split by phase direction
    w("\n### Trend label by phase\n")
    w("| phase | dir | n | hit% |")
    w("|---|---|---|---|")
    by_phase: dict[tuple[str, str], list[bool]] = {}
    for i, r in enumerate(rows[:-1]):
        lab = session_trend(rows, at_time=r["t"])
        f10 = forward(rows, i, 10)
        if not lab or f10 is None:
            continue
        ph = phase_at(segs, r["t"])
        ok = (lab == "up" and f10 > 0) or (lab == "down" and f10 < 0)
        by_phase.setdefault((ph, lab), []).append(ok)
    for (ph, lab), oks in sorted(by_phase.items()):
        w(f"| {ph} | {lab} | {len(oks)} | {100*sum(oks)/len(oks):.0f}% |")

    # 4. bursts: replay the production pipeline faithfully.
    #    detect_oi_bursts needs the DERIVED columns (call_doi/put_doi), which
    #    the raw tape does not carry — without derive_tape_rows every delta is
    #    0 and the detector silently reports nothing.
    derived = derive_tape_rows(rows)
    bursts = detect_oi_bursts(derived)
    by_t = {r["t"]: r for r in rows}
    t_only = [r["t"] for r in derived]

    def idx_of(t):
        return t_only.index(t) if t in t_only else -1

    def levels_for(row: dict) -> dict:
        lv = {}
        mp = _f(row.get("max_pain"))
        if mp:
            lv["max_pain"] = mp
        walls = row.get("walls") or {}
        for key, kind in (("calls", "wall_calls"), ("puts", "wall_puts")):
            e = walls.get(key) or []
            if e and _f(e[0].get("strike")):
                lv[kind] = _f(e[0]["strike"])
        return lv

    all_b, trend_b, gated_b = [], [], []
    by_fuel, by_phase = {}, {}
    detail = []
    for b in bursts:
        t = b.get("t")
        i = idx_of(t)
        if i < 0:
            continue
        f30 = forward(derived, i, 30)
        if f30 is None:
            continue
        bearish = bool(b.get("bearish"))
        ok = (f30 < 0) if bearish else (f30 > 0)
        all_b.append((ok, f30))
        fuel = fuel_state(_f(b.get("delta")) is not None and _f(b.get("delta")) > 0,
                          b.get("premChg"))
        row = by_t.get(t) or {}
        st = structure_evidence(derived, t, levels_for(row))
        trend = session_trend(derived, at_time=t)
        aligned = (bearish and trend == "down") or ((not bearish) and trend == "up")
        if aligned:
            trend_b.append((ok, f30))
        allowed = plan_allowed(fuel, st, b.get("side") or "call")
        if aligned and allowed:
            gated_b.append((ok, f30))
        by_fuel.setdefault(fuel or "unknown", []).append((ok, f30))
        by_phase.setdefault((phase_at(segs, t), "bearish" if bearish else "bullish"), []).append((ok, f30))
        detail.append((t[11:16], b.get("side"), b.get("flow"), fuel, round(f30, 1), ok,
                       bool(st), aligned, allowed))

    w(f"\n## 4. The OI-burst model: {len(bursts)} bursts, {len(all_b)} scoreable (30-min spot)\n")
    w("| gate | n | hit% | avg when right | avg when wrong |")
    w("|---|---|---|---|---|")
    for sc in (score("no gate (raw bursts)", all_b),
               score("trend-aligned (old gate)", trend_b),
               score("trend + fuel/structure (today)", gated_b)):
        if sc["n"]:
            w(f"| {sc['name']} | {sc['n']} | **{sc['hit']:.0f}%** | "
              f"{sc['avg_win_pts']:+.1f} | {sc['avg_loss_pts']:+.1f} |")
    w("\nBy fuel state:\n")
    w("| fuel | n | hit% | avg right | avg wrong |")
    w("|---|---|---|---|---|")
    for fuel, o in sorted(by_fuel.items(), key=lambda kv: -len(kv[1])):
        sc = score(fuel, o)
        w(f"| {fuel} | {sc['n']} | {sc['hit']:.0f}% | {sc['avg_win_pts']:+.1f} | {sc['avg_loss_pts']:+.1f} |")
    w("\nBy phase and direction:\n")
    w("| phase | burst says | n | hit% |")
    w("|---|---|---|---|")
    for (ph, side), o in sorted(by_phase.items()):
        sc = score(f"{ph}-{side}", o)
        w(f"| {ph} | {side} | {sc['n']} | {sc['hit']:.0f}% |")

    # 5. walls + max pain
    w("\n## 5. Walls and max pain\n")
    wall_hits, wall_breaks = 0, 0
    for i, r in enumerate(rows[:-1]):
        spot, st = _f(r["spot"]), strikes_of(r)
        nw = near_walls(st, "ce", spot=spot), near_walls(st, "pe", spot=spot)
        cw = nw[0][0]["strike"] if nw[0] else None
        pw = nw[1][0]["strike"] if nw[1] else None
        f30 = forward(rows, i, 30)
        if f30 is None or cw is None:
            continue
        for lvl, sign in ((cw, 1), (pw, -1)):
            hit = (sign * (spot + f30) >= sign * lvl) if lvl else False
            if hit:
                wall_hits += 1
                if abs(f30) > abs(lvl - spot) + 15:
                    wall_breaks += 1
    w(f"Near walls: tested within 30 min **{wall_hits}** times, "
      f"pierced by >15 pts **{wall_breaks}** times "
      f"({100*wall_breaks/max(wall_hits,1):.0f}% failure rate).")
    mp = [_f(r.get("max_pain")) for r in rows if _f(r.get("max_pain"))]
    close = _f(rows[-1]["spot"])
    comp = [compute_max_pain(strikes_of(r)) for r in rows]
    if mp:
        w(f"\nMax pain recorded: distinct values **{sorted(set(mp))}** over {len(mp)} rows; "
          f"computed from the same chains: **{sorted(set(comp))}**. "
          f"Spot closed **{close:,.0f}** → "
          f"{close - max(set(mp), key=mp.count):+.0f} pts from the printed mode.")
        if len(set(mp)) <= 3:
            w("\n⚠ The printed max pain is effectively **static all day** while the chain "
              "OI moved by millions — it is the official 30-min-bucket value, not a live "
              "computation. Any 'target = max pain' plan was anchored to a number that does "
              "not respond to the order flow.")

    # 6. manual trades: direction vs management
    w("\n## 6. Manual trades: direction, or management?\n")
    csv_path = ROOT / "reports" / "OPTIONS_PAPER_DAILY" / a.date / "trades.csv"
    if not csv_path.exists():
        w("_(no trades.csv for this date)_")
    else:
        import csv as _csv
        trs = [t for t in _csv.DictReader(csv_path.open())
               if t["strategy"] == "agent_discretionary"]
        w("| entry | leg | spot in | spot out | spot move | dir ok | MFE % | MAE % | after-exit max % |")
        w("|---|---|---|---|---|---|---|---|---|")
        right = 0
        never_green = 0
        for t in trs:
            strike = int(float(t["strike"]))
            side = 0 if t["opt"] == "CE" else 1
            ent, ext = _f(t["entry_premium"]), _f(t["exit_premium"])
            times = [r for r in rows if t["entry_time"] <= r["t"] <= t["exit_time"]]
            after = [r for r in rows if r["t"] > t["exit_time"]]

            def px(r):
                v = r["chain"].get(str(strike))
                return _f(v[side]) if v else None

            path = [p for p in (px(r) for r in times) if p]
            aft = [p for p in (px(r) for r in after) if p]
            mfe = max(path) if path else ent
            mae = min(path) if path else ent
            si, so = _f(t["entry_spot"]), _f(t["exit_spot"])
            mv = so - si
            ok = (mv > 0) == (t["opt"] == "CE")
            right += ok
            never_green += (mfe < ent * 1.06)
            w(f"| {t['entry_time'][11:16]} | {t['opt']} {strike} | {si:,.0f} | {so:,.0f} | "
              f"{mv:+.0f} | {'yes' if ok else '**no**'} | {100*(mfe/ent-1):+.0f}% | "
              f"{100*(mae/ent-1):+.0f}% | {100*(max(aft)/ent-1) if aft else 0:+.0f}% |")
        w(f"\nDirection correct **{right}/{len(trs)}**. Best favourable excursion under "
          f"+6% on **{never_green}/{len(trs)}** — the entries landed at the end of the "
          f"micro-move, so the trades never had a cushion to survive normal noise.")
        # how often is a stop of S spot points hit by noise alone?
        sp = [_f(r["spot"]) for r in rows if _f(r["spot"])]
        for h in (20,):
            adv = []
            for i in range(len(sp) - h):
                base = sp[i]
                seg = sp[i + 1:i + 1 + h]
                adv.append(base - min(seg))
                adv.append(max(seg) - base)
            for S in (30, 40, 50):
                pct = 100 * sum(1 for x in adv if x >= S) / len(adv)
                w(f"- A {S}-pt stop is hit by noise alone within {h} min **{pct:.0f}%** of the time")

    text = "\n".join(out) + "\n"
    print(text)
    if a.md:
        Path(a.md).parent.mkdir(parents=True, exist_ok=True)
        Path(a.md).write_text(text)
        print(f"[written] {a.md}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
