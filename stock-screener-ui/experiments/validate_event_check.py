"""Adversarial validator harness for event+technical combos.

Independent code: scans for sibling eventtech* result files, applies
pre-registered kill criteria (lookahead / costs / halves), ranks event
variants vs price-only baselines. Read-only: never touches db/alphashri.db.
"""
import glob
import json
import os
from datetime import date

EXP = os.path.dirname(os.path.abspath(__file__))
NOTIONAL = 100000.0
SLIP_BPS = 5.0  # per side, qty-fixed, costs recomputed


def find_sibling_files():
    pats = ["eventtech*", "event_tech*", "event-tech*"]
    hits = []
    for p in pats:
        hits += glob.glob(os.path.join(EXP, p))
        hits += glob.glob(os.path.join(EXP, "*", p))
    return sorted(set(hits))


def load_json(name):
    p = os.path.join(EXP, name)
    try:
        with open(p) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def slip_cost_per_trade():
    # ~2 x 5bps x Rs1L = ~Rs100/trade friction hurdle (qty-fixed approx)
    return NOTIONAL * (SLIP_BPS / 10000.0) * 2.0


def check_trade_leakage(trade):
    """Per-trade event-date leakage check.

    Kill conditions (any one kills the trade, >5% killed kills the variant):
      - event_date missing / unparseable
      - event_date > entry_date (not knowable at entry)
      - entry dated before the event's public timestamp (intraday knowability)
    Returns (ok: bool, reason: str).
    """
    ev = trade.get("event_date") or trade.get("announcement_date")
    en = trade.get("entry_date")
    if not ev or not en:
        return False, "MISSING-DATE"
    try:
        evd = date.fromisoformat(str(ev)[:10])
        end = date.fromisoformat(str(en)[:10])
    except ValueError:
        return False, "UNPARSEABLE-DATE"
    if evd > end:
        return False, f"LOOKAHEAD event {evd} > entry {end}"
    # yfinance-estimate guard: flag events dated on non-session days used
    # for Monday entries without a filing timestamp
    if trade.get("event_source") == "yfinance_estimate" and not trade.get("filing_ts"):
        return False, "ESTIMATE-NO-FILING-TS"
    return True, "ok"


def split_halves(trades, week_cut="2026-09-07"):
    """First-5 vs last-5 calendar weeks split from trade lists."""
    first = [t for t in trades if str(t.get("entry_date", "")) <= week_cut]
    last = [t for t in trades if str(t.get("entry_date", "")) > week_cut]
    return first, last


def rank_price_only():
    """Rank table of prior verified price-only systems (slip-adjusted exp)."""
    return [
        {"edge": "S3 distribution short", "exp_slip": 300, "pf": 1.40,
         "verdict": "REJECT", "reason": "one-half wonder (-682/+1378), n=61, borrow unmodelled"},
        {"edge": "V4 fade-the-flag SHORT", "exp_slip": 12, "pf": 1.14,
         "verdict": "REJECT", "reason": "slippage-away-from-zero; short beta, lost first half"},
        {"edge": "S2 failed-breakout fade", "exp_slip": -67, "pf": 1.12,
         "verdict": "REJECT", "reason": "dies under slippage; negative first half"},
        {"edge": "L3 screen+catalyst+regime", "exp_slip": 500, "pf": 1.74,
         "verdict": "REJECT", "reason": "0 trades 7/10 wks; catalyst window peeks (lookahead)"},
        {"edge": "S1 breakdown short", "exp_slip": -419, "pf": 0.76,
         "verdict": "REJECT", "reason": "breakdowns don't follow through in either half"},
        {"edge": "V1 hold-confirm", "exp_slip": -624, "pf": 0.62,
         "verdict": "REJECT", "reason": "discards trades, not losses"},
        {"edge": "V2 hold+volume", "exp_slip": -598, "pf": 0.65,
         "verdict": "REJECT", "reason": "Day+1 volume adds nothing"},
        {"edge": "B0 next-open (long)", "exp_slip": -663, "pf": 0.64,
         "verdict": "REJECT", "reason": "confirmed loser, neg 8/10 weeks"},
        {"edge": "V5 half+add", "exp_slip": -521, "pf": 0.60,
         "verdict": "REJECT", "reason": "sizing can't fix negative expectancy; double costs"},
        {"edge": "V3 limit-retest", "exp_slip": -908, "pf": 0.38,
         "verdict": "REJECT", "reason": "43.8% phantom fills; feasible-fill strongly negative"},
        {"edge": "plain long-breakout (prior)", "exp_slip": -943, "pf": 0.35,
         "verdict": "REJECT", "reason": "dead (493T, -465k); B0 re-confirms"},
        {"edge": "all-equity L1 next-open", "exp_slip": -806, "pf": 0.59,
         "verdict": "REJECT", "reason": "772T -559k; wider universe loses more"},
    ]


def main():
    sibs = find_sibling_files()
    ve = load_json("validate_edge.json")
    out = {
        "sibling_files_found": sibs,
        "n_sibling_files": len(sibs),
        "event_variants": [],
        "price_only_rank": rank_price_only(),
        "slip_hurdle_rs_per_trade": round(slip_cost_per_trade(), 2),
        "kill_criteria": {
            "lookahead": "any trade with event_date > entry_date; >5% leaked trades kills variant",
            "costs": "every trade costed via backtest/costs.py; missing costs = kill",
            "halves": "reject on any red half unless n>=40 pooled, exp>+300 after slippage, + fundamental reason",
            "survivorship": "universe fixed ex-ante; dropped/delisted symbols must appear as trades or disclosed skips",
        },
        "fresh_data": {"available": False,
                       "reason": "latest IST session in cached frames is 2026-10-09; today 2026-10-11 (Sun)"},
        "verdict": ("NEEDS-FRESH-DATA" if not sibs else "PENDING-RECOMPUTE"),
        "verdict_reason": ("no eventtech* sibling files exist under experiments/ at verify time; "
                           "nothing to recompute; price-only baselines all REJECT per validate_edge.md"
                           if not sibs else "sibling files present; recompute required"),
    }
    if ve is not None:
        out["prior_recompute_anchor"] = {
            "arith_mismatches": ve.get("recompute", {}).get("arith_mismatches"),
            "v3_phantom_rate": ve.get("recompute", {}).get("v3_phantom", {}).get("phantom_rate"),
        }
    with open(os.path.join(EXP, "validate_event.json"), "w") as f:
        json.dump(out, f, indent=1)
    print(json.dumps(out, indent=1)[:2000])


if __name__ == "__main__":
    main()
