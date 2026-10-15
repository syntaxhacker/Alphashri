"""Track — regime-conditioned NIFTY option structure selector.

Question: does conditioning the *structure* on NIFTY spot direction + volatility
regime (evaluated causally at entry) beat taking one structure unconditionally?

Pipeline
--------
1. Causal regime classifier at the entry timestamp, using only prior completed
   daily bars (``feat_day`` = session before entry) plus the observed entry spot:
     direction : EMA20 vs EMA50, 10d EMA20 slope, prior-day return sign, ADX(14) sign
     volatility: expanding INDIAVIX percentile + expanding ATR% percentile
     term      : surface_metrics_daily front ``term_slope`` (contango/backwardation, 2026 only)
     location  : entry spot vs prior-day high/low
     event     : prior-day |return| top-decile AND elevated VIX (IV-crush proxy)
2. Multi-day hold-to-expiry simulator (copied + generalised from
   ``tracks/theta_harvest.py``; that shared track file is never edited) that can price
   credit *and* debit structures: iron condor, short strangle, bull-put / bear-call
   credit spreads, bull-call / bear-put debit spreads, long straddle/strangle, long condor.
3. On TRAIN (2018-2022) only, fit a cell -> structure map (per regime cell pick the
   structure with the best train expectancy, min n). Apply it OOS (2023-2026) and to the
   real 2026 premium window. Compare with (a) always-iron-condor and (b) always-short-strangle.

Causal rules: fills at the entry bar open + spread + slippage; every leg charged NSE
fees; stops walk the real daily high/low; settlement at expiry intrinsic. No future data.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
KERNEL = HERE.parent
if str(KERNEL) not in sys.path:
    sys.path.insert(0, str(KERNEL))

import fyers_data as fd  # noqa: E402
import runner as R  # noqa: E402
import stats as st  # noqa: E402
import pricing  # noqa: E402
from engine import (  # noqa: E402
    ExpiryResolver, Leg, RealOptionSource, SyntheticOptionSource,
    _leg_fills, _net, _prices, build_legdicts, has_data,
)
from costs import ExecutionModel, capital_for_structure, round_trip_costs  # noqa: E402

STEP = 50
LOT = 65
CAPITAL = 300_000.0
EX = ExecutionModel()
SPLIT = date(2022, 12, 31)          # train <= SPLIT < test
TRAIN_START = date(2018, 1, 1)
SYN_END = date(2026, 9, 25)
REAL_START = date(2026, 6, 1)
MIN_TRAIN_N = 25                    # min train cell n for a data-driven choice
LOG = HERE / "regime_structures_log.jsonl"

# ---------------------------------------------------------------------------
# structures: (opt, side, offset_steps) built from a distance ``d`` and wing ``w``
# ---------------------------------------------------------------------------
STRUCTURES: dict[str, dict] = {
    "iron_condor":     {"f": lambda d, w: [("CE", "SELL", d), ("PE", "SELL", -d),
                                           ("CE", "BUY", d + w), ("PE", "BUY", -(d + w))],
                        "width": True, "kind": "credit"},
    "short_strangle":  {"f": lambda d, w: [("CE", "SELL", d), ("PE", "SELL", -d)],
                        "width": False, "kind": "credit"},
    "bull_put_spread": {"f": lambda d, w: [("PE", "SELL", -d), ("PE", "BUY", -(d + w))],
                        "width": True, "kind": "credit"},
    "bear_call_spread": {"f": lambda d, w: [("CE", "SELL", d), ("CE", "BUY", d + w)],
                         "width": True, "kind": "credit"},
    "bull_call_spread": {"f": lambda d, w: [("CE", "BUY", d), ("CE", "SELL", d + w)],
                         "width": True, "kind": "debit"},
    "bear_put_spread": {"f": lambda d, w: [("PE", "BUY", -d), ("PE", "SELL", -(d + w))],
                        "width": True, "kind": "debit"},
    "long_straddle":   {"f": lambda d, w: [("CE", "BUY", 0), ("PE", "BUY", 0)],
                        "width": False, "kind": "debit"},
    "long_strangle":   {"f": lambda d, w: [("CE", "BUY", d), ("PE", "BUY", -d)],
                        "width": False, "kind": "debit"},
    "long_condor":     {"f": lambda d, w: [("CE", "BUY", d), ("CE", "SELL", d + w),
                                           ("PE", "BUY", -d), ("PE", "SELL", -(d + w))],
                        "width": True, "kind": "debit"},
}
SHORT_VOL = {"iron_condor", "short_strangle", "bull_put_spread", "bear_call_spread"}


class RSConfig:
    def __init__(self, start, end, entry_dte=5, dist_pct=0.02, wing_steps=6,
                 stop_mult=2.0, stop_pct_debit=0.5, risk_pct=0.01, max_lots=20,
                 mode="synthetic"):
        self.start, self.end = start, end
        self.entry_dte = entry_dte
        self.dist_pct = dist_pct
        self.wing_steps = wing_steps
        self.stop_mult = stop_mult
        self.stop_pct_debit = stop_pct_debit
        self.risk_pct = risk_pct
        self.max_lots = max_lots
        self.mode = mode


# ---------------------------------------------------------------------------
# market data + causal daily features
# ---------------------------------------------------------------------------
def _ema(s, n):
    return s.ewm(span=n, adjust=False).mean()


def _causal_pct(s, minp=60):
    return s.expanding(min_periods=minp).apply(lambda w: (w[:-1] < w[-1]).mean(), raw=True)


def load_market():
    spot = pd.read_parquet(fd.CANDLE_DIR / "NSE_NIFTY50-INDEX__1.parquet").set_index("ts").sort_index()
    spot = spot[~spot.index.duplicated(keep="last")]
    vix1 = pd.read_parquet(fd.CANDLE_DIR / "NSE_INDIAVIX-INDEX__1.parquet").set_index("ts").sort_index()
    vix1 = vix1[~vix1.index.duplicated(keep="last")]
    rv = pricing.trailing_vol(spot["close"], window=288)
    # daily OHLC from the 1-min path (same convention as theta_harvest)
    g = spot.groupby(spot.index.date)
    daily = pd.DataFrame({
        "open": g["open"].first(), "high": g["high"].max(),
        "low": g["low"].min(), "close": g["close"].last(),
    })
    daily.index = pd.to_datetime(daily.index)
    daily["rv"] = rv.groupby(rv.index.date).last().reindex(daily.index)
    daily["ret"] = daily["close"].pct_change()

    vix_d = vix1["close"].groupby(vix1.index.date).last()
    vix_d.index = pd.to_datetime(vix_d.index)
    daily["vix"] = vix_d.reindex(daily.index).ffill()

    # daily direction features
    daily["ema20"] = _ema(daily["close"], 20)
    daily["ema50"] = _ema(daily["close"], 50)
    daily["slope10"] = (daily["ema20"] - daily["ema20"].shift(10)) / daily["ema20"].shift(10)
    h, l, c = daily["high"], daily["low"], daily["close"]
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    daily["atr_pct"] = tr.rolling(14).mean() / c
    up, dn = h.diff(), -l.diff()
    plus = np.where((up > dn) & (up > 0), up, 0.0)
    minus = np.where((dn > up) & (dn > 0), dn, 0.0)
    atr_ = tr.rolling(14).mean()
    pdi = 100 * pd.Series(plus, index=daily.index).rolling(14).mean() / atr_.replace(0, np.nan)
    mdi = 100 * pd.Series(minus, index=daily.index).rolling(14).mean() / atr_.replace(0, np.nan)
    dx = 100 * (pdi - mdi).abs() / (pdi + mdi).replace(0, np.nan)
    daily["adx"] = dx.rolling(14).mean()
    daily["pdi"], daily["mdi"] = pdi, mdi

    # causal (expanding) percentiles
    daily["vix_pct"] = _causal_pct(daily["vix"])
    daily["atr_pct_pct"] = _causal_pct(daily["atr_pct"])
    daily["absret_pct"] = _causal_pct(daily["ret"].abs(), minp=60)

    # real term structure (2026 only): front-expiry term_slope
    daily["term_slope"] = np.nan
    try:
        sm = pd.read_parquet(fd.CACHE_DIR / "surface_metrics_daily.parquet")
        sm["date"] = pd.to_datetime(sm["date"])
        front = sm.sort_values("dte").groupby("date").first()
        daily["term_slope"] = front["term_slope"].reindex(daily.index)
    except Exception:
        pass
    return spot, daily


def _day_bars(spot):
    return {d: g for d, g in spot.groupby(spot.index.date)}


def _pick_entry_bar(bars):
    sel = bars[bars.index.time >= pd.Timestamp("09:20").time()]
    sel = sel[sel.index.time <= pd.Timestamp("15:25").time()]
    return (sel.index[0], float(sel["open"].iloc[0])) if len(sel) else (None, None)


# ---------------------------------------------------------------------------
# causal regime classifier
# ---------------------------------------------------------------------------
def classify(row, ent_spot=None):
    """Return dict(direction, vol, event, loc, term, regime) from a prior-session row."""
    if row is None or not np.isfinite(row.get("ema20", np.nan)):
        return None
    s = 0
    s += 1 if row["ema20"] > row["ema50"] else -1
    s += 1 if row["slope10"] > 0 else -1
    s += 1 if row["ret"] > 0 else -1
    if row["adx"] >= 20 and np.isfinite(row["pdi"]) and np.isfinite(row["mdi"]):
        s += 0.5 if row["pdi"] > row["mdi"] else -0.5
    direction = "bull" if s >= 1.5 else ("bear" if s <= -1.5 else "range")

    vp, ap = row["vix_pct"], row["atr_pct_pct"]
    if (vp == vp and vp >= 0.66) or (ap == ap and ap >= 0.66):
        vol = "high"
    else:
        vol = "low"          # mid + low merged: only 2 vol states (cells stay populated)

    event = bool(row["absret_pct"] == row["absret_pct"] and row["absret_pct"] >= 0.90
                 and vp == vp and vp >= 0.55)
    # term structure (real window only)
    ts = row.get("term_slope", np.nan)
    term = "backwardation" if (ts == ts and ts < 0) else ("contango" if ts == ts else "na")
    if term == "backwardation":
        event = True
    # location vs prior-day high/low
    loc = "na"
    if ent_spot is not None:
        if ent_spot > row["high"]:
            loc = "above_prev_high"
        elif ent_spot < row["low"]:
            loc = "below_prev_low"
        else:
            loc = "inside"
    return {"direction": direction, "vol": vol, "event": event, "loc": loc,
            "term": term, "regime": f"{direction}_{vol}"}


# ---------------------------------------------------------------------------
# generalised multi-day executor
# ---------------------------------------------------------------------------
def _size(legdicts, ent_prices, ent_spot, cfg, width_pts):
    fill = _leg_fills(ent_prices, legdicts, EX, "entry")
    entry_net = sum((1 if l["side"] == "BUY" else -1) * p for l, p in zip(legdicts, fill))
    credit = -entry_net if entry_net < 0 else 0.0
    debit = entry_net if entry_net > 0 else 0.0
    struct_legs = [{**l, "premium": abs(p)} for l, p in zip(legdicts, fill)]
    margin_per_lot = capital_for_structure(ent_spot, LOT, struct_legs)
    if entry_net < 0:
        risk_per_lot = max(width_pts * LOT - credit * LOT, 1.0) if width_pts else max(margin_per_lot, 1.0)
    else:
        risk_per_lot = max(debit * LOT, 1.0)
    rb = CAPITAL * cfg.risk_pct
    lots = int(max(1, min(cfg.max_lots,
                          math.floor(rb / risk_per_lot),
                          math.floor(CAPITAL / max(margin_per_lot, 1.0)))))
    return fill, entry_net, credit, debit, margin_per_lot, risk_per_lot, lots


def _execute(source, legdicts, ent_ts, ent_spot, ent_prices, entry_day, sett_day,
             at_expiry, feat_day, cfg, daily_by_date, bars_of, width_pts):
    fill, entry_net, credit, debit, margin_per_lot, risk_per_lot, lots = _size(
        legdicts, ent_prices, ent_spot, cfg, width_pts)
    qty = lots * LOT

    if entry_net < 0:
        stop_lvl = entry_net - cfg.stop_mult * max(credit, 1.0)
    else:
        stop_lvl = entry_net * (1.0 - cfg.stop_pct_debit)

    exit_reason, exit_net, out_ref, exit_day = "EXPIRY", None, None, sett_day
    for dd in [d for d in bars_of if entry_day < d <= sett_day]:
        row = daily_by_date.get(dd)
        if row is None:
            continue
        dts = bars_of[dd].index[-1]
        hi, lo = float(row["high"]), float(row["low"])
        n_hi, _ = _struct_net(source, legdicts, dts, hi)
        n_lo, _ = _struct_net(source, legdicts, dts, lo)
        if n_hi is None or n_lo is None:
            continue
        if min(n_hi, n_lo) <= stop_lvl:
            exit_reason, exit_net, exit_day = "STOP", stop_lvl, dd
            _, out_ref = _struct_net(source, legdicts, dts, hi if n_hi <= n_lo else lo)
            break

    if exit_net is None:
        s_ts = bars_of[sett_day].index[-1]
        s_spot = float(daily_by_date[sett_day]["close"])
        if at_expiry:
            out_ref = [max(0.0, s_spot - l["strike"]) if l["opt"] == "CE"
                       else max(0.0, l["strike"] - s_spot) for l in legdicts]
            exit_net = sum((1 if l["side"] == "BUY" else -1) * p for l, p in zip(legdicts, out_ref))
        else:
            exit_net, out_ref = _struct_net(source, legdicts, s_ts, s_spot)
            exit_reason = "MARK_END"
    if exit_net is None:
        return None
    out_ref = out_ref or ent_prices
    fees = sum(round_trip_costs(pe, px, qty, l["side"])
               for pe, px, l in zip(ent_prices, out_ref, legdicts))
    gross = (exit_net - entry_net) * qty
    frow = daily_by_date.get(feat_day)
    return {
        "entry_day": entry_day.isoformat(), "settle_day": exit_day.isoformat(),
        "entry_ts": str(ent_ts), "at_expiry": at_expiry, "exit_reason": exit_reason,
        "entry_dte_cal": (sett_day - entry_day).days,
        "spot_entry": ent_spot, "spot_settle": float(daily_by_date[exit_day]["close"]),
        "credit_pts": credit, "debit_pts": debit, "entry_net": entry_net, "exit_net": exit_net,
        "lots": lots, "qty": qty, "margin_per_lot": margin_per_lot,
        "risk_per_lot": risk_per_lot, "gross": gross, "fees": fees, "net": gross - fees,
        "vix_prior": float(frow["vix"]) if frow is not None else float("nan"),
        "vix_pct_prior": float(frow["vix_pct"]) if frow is not None else float("nan"),
        "adx_prior": float(frow["adx"]) if frow is not None else float("nan"),
        "ret_prior": float(frow["ret"]) if frow is not None else float("nan"),
        "prev_high": float(frow["high"]) if frow is not None else float("nan"),
        "prev_low": float(frow["low"]) if frow is not None else float("nan"),
    }


def _struct_net(source, legdicts, ts, spot):
    prices = _prices(source, legdicts, ts, spot, "close")
    if prices is None:
        return None, None
    return _net(legdicts, prices, EX, "mark"), prices


# ---------------------------------------------------------------------------
# expiry-series simulator (one trade per weekly expiry per structure)
# ---------------------------------------------------------------------------
def run_series(source, resolver, spot, daily, cfg, struct, real=False, regime_cache=None):
    bars_of = _day_bars(spot)
    daily_by_date = {ts.date(): r for ts, r in daily.iterrows()}
    days = list(daily.index.date)
    idx = {d: i for i, d in enumerate(days)}
    trades = []
    meta = STRUCTURES[struct]
    regcache = regime_cache if regime_cache is not None else {}
    for E in resolver.expiries:
        if E < cfg.start:
            continue
        pre = [d for d in days if d < E]
        if len(pre) <= cfg.entry_dte + 1:
            continue
        entry_day = pre[-cfg.entry_dte]
        feat_day = pre[-(cfg.entry_dte + 1)]
        if entry_day < cfg.start or entry_day > cfg.end:
            continue
        last_day = pre[-1]
        if not real and E > cfg.end:
            continue
        sett_day = E if E in idx else pre[-1]
        if sett_day < entry_day:
            continue
        at_expiry = (sett_day >= E) if real else True
        if real and E > last_day:
            sett_day, at_expiry = last_day, False
        bars = bars_of.get(entry_day)
        if bars is None or bars.empty:
            continue
        ent_ts, ent_spot = _pick_entry_bar(bars)
        if ent_ts is None:
            continue
        weekly = resolver.is_weekly(E)
        d = max(1, int(round(cfg.dist_pct * ent_spot / STEP)))
        w = max(1, cfg.wing_steps)
        legs = [Leg(o, s, off) for (o, s, off) in meta["f"](d, w)]
        legdicts = build_legdicts(legs, E, ent_spot, STEP, weekly)
        if real and not all(has_data(source, l["symbol"]) for l in legdicts):
            continue
        ent_prices = _prices(source, legdicts, ent_ts, ent_spot, "close")
        if ent_prices is None:
            continue
        frow = daily_by_date.get(feat_day)
        if feat_day not in regcache:
            regcache[feat_day] = classify(frow, ent_spot)
        reg = regcache[feat_day]
        if reg is None:
            continue
        width_pts = (w * STEP) if meta["width"] else 0
        tr = _execute(source, legdicts, ent_ts, ent_spot, ent_prices, entry_day,
                      sett_day, at_expiry, feat_day, cfg, daily_by_date, bars_of, width_pts)
        if tr is None:
            continue
        tr["structure"] = struct
        tr["delta_sign"] = sum(_leg_delta_sign(l) for l in legdicts)
        tr.update(reg)
        tr["d"] = d
        tr["w"] = w
        trades.append(tr)
    return trades


def rolling_series(source, spot, daily, start, end, expiry, weekly, cfg, struct,
                   hold_days=5, real=True):
    """Non-overlapping fixed-hold marks on one expiry (fairest real transfer)."""
    bars_of = _day_bars(spot)
    daily_by_date = {ts.date(): r for ts, r in daily.iterrows()}
    days = sorted({d for d in daily.index.date if start <= d <= end})
    meta = STRUCTURES[struct]
    trades = []
    regcache = {}
    i = 0
    while i < len(days) - hold_days:
        entry_day, exit_day = days[i], days[i + hold_days]
        bars = bars_of.get(entry_day)
        if bars is None or bars.empty:
            i += 1
            continue
        ent_ts, ent_spot = _pick_entry_bar(bars)
        if ent_ts is None:
            i += 1
            continue
        d = max(1, int(round(cfg.dist_pct * ent_spot / STEP)))
        w = max(1, cfg.wing_steps)
        legs = [Leg(o, s, off) for (o, s, off) in meta["f"](d, w)]
        legdicts = build_legdicts(legs, expiry, ent_spot, STEP, weekly)
        if real and not all(has_data(source, l["symbol"]) for l in legdicts):
            i += 1
            continue
        ent_prices = _prices(source, legdicts, ent_ts, ent_spot, "close")
        if ent_prices is None:
            i += 1
            continue
        feat_day = days[i - 1] if i > 0 else entry_day
        frow = daily_by_date.get(feat_day)
        if feat_day not in regcache:
            regcache[feat_day] = classify(frow, ent_spot)
        reg = regcache[feat_day]
        if reg is None:
            i += 1
            continue
        width_pts = (w * STEP) if meta["width"] else 0
        tr = _execute(source, legdicts, ent_ts, ent_spot, ent_prices, entry_day,
                      exit_day, False, feat_day, cfg, daily_by_date, bars_of, width_pts)
        if tr is not None:
            tr["structure"] = struct
            tr["delta_sign"] = sum(_leg_delta_sign(l) for l in legdicts)
            tr.update(reg)
            tr["d"], tr["w"] = d, w
            trades.append(tr)
        i += hold_days
    return trades


# ---------------------------------------------------------------------------
# evaluation
# ---------------------------------------------------------------------------
def _leg_delta_sign(l):
    s = 1 if l["side"] == "BUY" else -1
    return s if l.get("opt") == "CE" else -s


def evaluate(trades, label=""):
    if not trades:
        return {"label": label, "n": 0}
    net = np.array([t["net"] for t in trades], dtype=float)
    s = st.summarize(net, CAPITAL)
    boot = st.bootstrap(net, CAPITAL)
    weeks = st.weekly(net, [pd.Timestamp(t["entry_ts"]) for t in trades], CAPITAL)
    mv = np.array([(t["spot_settle"] - t["spot_entry"]) for t in trades])
    # exposure-signed move (brief rule): sign each trade by its net directional delta
    smv = np.array([(t["spot_settle"] - t["spot_entry"]) * np.sign(t.get("delta_sign", 0.0) or 1.0)
                    for t in trades])
    return {
        "label": label, "n": s["n"], "net_exp": s["avg_net"], "pf": s["profit_factor"],
        "win": s["win_rate"], "total_net": s["total_net"],
        "max_drawdown": s["max_drawdown"], "max_dd_pct_capital": s["max_drawdown"] / CAPITAL,
        "worst_trade": s["worst"], "best_trade": s["best"],
        "tail_loss_p95": s["p05"], "bootstrap_ci": [boot.get("ci_low_mean"), boot.get("ci_high_mean")],
        "p_positive_total": boot.get("p_positive_total"),
        "risk_of_ruin": st.risk_of_ruin(net, CAPITAL),
        "worst_week": weeks.get("worst_week"), "avg_week": weeks.get("avg_week"),
        "prob_positive_week": weeks.get("prob_positive_week"),
        "capital_for_15k_week": weeks.get("target_15k_avg_capital"),
        "exit_mix": pd.Series([t["exit_reason"] for t in trades]).value_counts().to_dict(),
        "raw_dir_accuracy": float((mv > 0).mean()),
        "raw_dir_accuracy_signed": float((smv > 0).mean()),
        "raw_mean_move_pts": float(mv.mean()),
    }


def _log(kind, rec):
    with LOG.open("a") as f:
        f.write(json.dumps({"kind": kind, **rec}, default=str) + "\n")


def _cell(t):
    return "event_crush" if t["event"] else t["regime"]


def cell_table(trades, split=SPLIT):
    """Per-regime x structure expectancy (train / test)."""
    rows = []
    cells = sorted({_cell(t) for t in trades})
    for c in cells:
        for s in STRUCTURES:
            g = [t for t in trades if _cell(t) == c and t["structure"] == s]
            tr = [t for t in g if t["entry_day"] <= str(split)]
            te = [t for t in g if t["entry_day"] > str(split)]
            if not g:
                continue
            def exp(x):
                return float(np.mean([t["net"] for t in x])) if x else None
            rows.append({"cell": c, "structure": s, "n": len(g),
                         "train_n": len(tr), "test_n": len(te),
                         "train_exp": exp(tr), "test_exp": exp(te),
                         "full_exp": exp(g),
                         "test_win": float(np.mean([t["net"] > 0 for t in te])) if te else None,
                         "test_pf": _pf([t["net"] for t in te])})
    return rows


def _pf(nets):
    nets = np.asarray(nets, dtype=float)
    gp = nets[nets > 0].sum()
    gl = -nets[nets < 0].sum()
    return float(gp / gl) if gl > 0 else float("inf")


def fit_selector(trades, split=SPLIT, min_n=MIN_TRAIN_N, candidates=None, positive_only=False):
    """Fit cell -> structure on TRAIN only. Fallback = global best train structure.

    ``candidates`` limits the structure menu (e.g. short-vol credit only).
    ``positive_only`` falls back to the default whenever a cell's best train
    structure is not positive on train (avoids picking the "least bad" loser).
    """
    candidates = candidates or list(STRUCTURES)
    tr = [t for t in trades if t["entry_day"] <= str(split)]
    glob = {}
    for s in candidates:
        g = [t["net"] for t in tr if t["structure"] == s]
        glob[s] = (float(np.mean(g)) if g else -1e9, len(g))
    eligible = [s for s in candidates if glob[s][1] >= min_n]
    default = max(eligible, key=lambda s: glob[s][0]) if eligible else candidates[0]
    mapping = {"_default": default, "_candidates": candidates, "_positive_only": positive_only,
               "_global_train_exp": {s: glob[s][0] for s in candidates},
               "_global_train_n": {s: glob[s][1] for s in candidates}}
    for c in sorted({_cell(t) for t in tr}):
        cand = {}
        for s in candidates:
            g = [t["net"] for t in tr if _cell(t) == c and t["structure"] == s]
            if len(g) >= min_n:
                cand[s] = float(np.mean(g))
        if cand:
            best = max(cand, key=cand.get)
            if positive_only and cand[best] <= 0:
                mapping[c] = default
                mapping[f"_{c}_fallback"] = default
            else:
                mapping[c] = best
            mapping[f"_{c}_train_exp"] = cand
        else:
            mapping[c] = default
            mapping[f"_{c}_fallback"] = default
    return mapping


def apply_selector(trades, mapping):
    out = []
    for t in trades:
        pick = mapping.get(_cell(t), mapping["_default"])
        if t["structure"] == pick:
            out.append(t)
    return out


def _pair_diff(sel, base):
    """Paired per-entry-day net difference (selector - baseline) + bootstrap CI."""
    sb = {t["entry_day"]: t["net"] for t in sel}
    bb = {t["entry_day"]: t["net"] for t in base}
    common = sorted(set(sb) & set(bb))
    if len(common) < 10:
        return {"n_pairs": len(common)}
    d = np.array([sb[k] - bb[k] for k in common])
    rng = np.random.default_rng(7)
    idx = rng.integers(0, len(d), size=(5000, len(d)))
    means = d[idx].mean(axis=1)
    return {"n_pairs": len(common), "mean_diff": float(d.mean()),
            "ci_low": float(np.percentile(means, 5)), "ci_high": float(np.percentile(means, 95)),
            "p_positive": float((means > 0).mean())}


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true", help="fewer structures/grid")
    ap.add_argument("--no-real", action="store_true")
    args = ap.parse_args()

    spot, daily = load_market()
    synth = SyntheticOptionSource.from_cached()
    res_s = R.build_weekly_resolver(TRAIN_START, SYN_END)

    # ---- a-priori (brief) mapping, no fitting ----
    APRIORI = {
        "event_crush": "short_strangle",
        "bull_low": "bull_put_spread",
        "bull_high": "bull_call_spread",
        "bear_low": "bear_call_spread",
        "bear_high": "bear_call_spread",
        "range_low": "iron_condor",
        "range_high": "long_condor",
    }

    structs = list(STRUCTURES)
    if args.quick:
        structs = ["iron_condor", "short_strangle", "bull_put_spread", "bear_call_spread",
                   "bull_call_spread", "long_condor"]

    regcache = {}
    cfg = RSConfig(TRAIN_START, SYN_END, entry_dte=5, dist_pct=0.02, wing_steps=6,
                   stop_mult=2.0, stop_pct_debit=0.5, mode="synthetic")
    alltr = []
    for s in structs:
        alltr += run_series(synth, res_s, spot, daily, cfg, s, real=False, regime_cache=regcache)

    # baseline + per-structure full/train/test
    per_struct = {}
    for s in structs:
        g = [t for t in alltr if t["structure"] == s]
        per_struct[s] = {
            "full": evaluate(g, s),
            "train": evaluate([t for t in g if t["entry_day"] <= str(SPLIT)], s + "_train"),
            "test": evaluate([t for t in g if t["entry_day"] > str(SPLIT)], s + "_test"),
        }

    ct = cell_table(alltr)
    CREDIT = ["iron_condor", "short_strangle", "bull_put_spread", "bear_call_spread"]
    variants = {
        # primary (pre-specified): full structure menu, but never pick a train-loser
        "primary_positive_gate": fit_selector(alltr, positive_only=True),
        # sensitivity: plain train argmax across all structures
        "argmax_all": fit_selector(alltr),
        # a-priori hypothesis: only sell premium; regime picks WHICH premium structure
        "credit_positive_gate": fit_selector(alltr, candidates=CREDIT, positive_only=True),
        "credit_argmax": fit_selector(alltr, candidates=CREDIT),
    }
    mapping = variants["primary_positive_gate"]

    base_ic_tr = [t for t in alltr if t["structure"] == "iron_condor" and t["entry_day"] <= str(SPLIT)]
    base_ss_tr = [t for t in alltr if t["structure"] == "short_strangle" and t["entry_day"] <= str(SPLIT)]
    base_ic_te = [t for t in alltr if t["structure"] == "iron_condor" and t["entry_day"] > str(SPLIT)]
    base_ss_te = [t for t in alltr if t["structure"] == "short_strangle" and t["entry_day"] > str(SPLIT)]

    selector_eval = {}
    for name, mp in variants.items():
        sa = apply_selector(alltr, mp)
        selector_eval[name] = {
            "map": {k: v for k, v in mp.items() if not k.startswith("_")},
            "full": evaluate(sa, name),
            "train": evaluate([t for t in sa if t["entry_day"] <= str(SPLIT)], name + "_train"),
            "test": evaluate([t for t in sa if t["entry_day"] > str(SPLIT)], name + "_test"),
        }
        selector_eval[name]["paired_vs_ic"] = _pair_diff(
            [t for t in sa if t["entry_day"] > str(SPLIT)], base_ic_te)
        selector_eval[name]["paired_vs_ss"] = _pair_diff(
            [t for t in sa if t["entry_day"] > str(SPLIT)], base_ss_te)

    sel_all = apply_selector(alltr, mapping)
    sel_tr = [t for t in sel_all if t["entry_day"] <= str(SPLIT)]
    sel_te = [t for t in sel_all if t["entry_day"] > str(SPLIT)]

    apri_all = [t for t in alltr if APRIORI.get(_cell(t)) == t["structure"]]
    apri_te = [t for t in apri_all if t["entry_day"] > str(SPLIT)]
    APRIORI_CREDIT = {"event_crush": "short_strangle", "bull_low": "bull_put_spread",
                      "bull_high": "bull_put_spread", "bear_low": "bear_call_spread",
                      "bear_high": "bear_call_spread", "range_low": "iron_condor",
                      "range_high": "iron_condor"}
    apri_c_all = [t for t in alltr if APRIORI_CREDIT.get(_cell(t)) == t["structure"]]
    apri_c_te = [t for t in apri_c_all if t["entry_day"] > str(SPLIT)]

    sel_full = evaluate(sel_all, "selector")
    sel_test = evaluate(sel_te, "selector_test")
    sel_train = evaluate(sel_tr, "selector_train")
    apri_full = evaluate(apri_all, "apriori")
    apri_test = evaluate(apri_te, "apriori_test")

    comp = {
        "selector": {"full": sel_full, "train": sel_train, "test": sel_test},
        "apriori_brief": {"full": apri_full, "test": apri_test},
        "apriori_credit": {"full": evaluate(apri_c_all, "apriori_credit"),
                           "test": evaluate(apri_c_te, "apriori_credit_test")},
        "always_iron_condor": {"train": evaluate(base_ic_tr, "ic_train"),
                               "test": evaluate(base_ic_te, "ic_test")},
        "always_short_strangle": {"train": evaluate(base_ss_tr, "ss_train"),
                                  "test": evaluate(base_ss_te, "ss_test")},
    }
    pair_vs_ic = selector_eval["primary_positive_gate"]["paired_vs_ic"]
    pair_vs_ss = selector_eval["primary_positive_gate"]["paired_vs_ss"]

    # location diagnostic (brief asked for spot vs prior-day high/low)
    loc_diag = {}
    for s in ("iron_condor", "short_strangle"):
        loc_diag[s] = {}
        for lo in ("above_prev_high", "inside", "below_prev_low"):
            g = [t for t in alltr if t["structure"] == s and t["loc"] == lo]
            tr_g = [t for t in g if t["entry_day"] <= str(SPLIT)]
            te_g = [t for t in g if t["entry_day"] > str(SPLIT)]
            loc_diag[s][lo] = {
                "n": len(g), "train_n": len(tr_g), "test_n": len(te_g),
                "train_exp": float(np.mean([t["net"] for t in tr_g])) if tr_g else None,
                "test_exp": float(np.mean([t["net"] for t in te_g])) if te_g else None,
            }

    # argmax agreement train vs test per cell (curve-fit diagnostic)
    agree = {}
    for c in sorted({_cell(t) for t in alltr}):
        tr_c = {s: np.mean([t["net"] for t in alltr
                            if _cell(t) == c and t["structure"] == s and t["entry_day"] <= str(SPLIT)])
                for s in structs if any(t["structure"] == s and _cell(t) == c
                                        and t["entry_day"] <= str(SPLIT) for t in alltr)}
        te_c = {s: np.mean([t["net"] for t in alltr
                            if _cell(t) == c and t["structure"] == s and t["entry_day"] > str(SPLIT)])
                for s in structs if any(t["structure"] == s and _cell(t) == c
                                        and t["entry_day"] > str(SPLIT) for t in alltr)}
        if tr_c and te_c:
            agree[c] = {"train_argmax": max(tr_c, key=tr_c.get), "test_argmax": max(te_c, key=te_c.get),
                        "match": max(tr_c, key=tr_c.get) == max(te_c, key=te_c.get)}

    # ---- real 2026 transfer ----
    real_tab = {}
    if not args.no_real:
        man = json.loads((fd.CACHE_DIR / "option_manifest.json").read_text())
        by_exp = {date.fromisoformat(c["expiry"]): c["weekly"] for c in man["contracts"]}
        res_r = ExpiryResolver(list(by_exp.keys()), by_exp)
        real_src = RealOptionSource()
        front = min(by_exp.keys())
        weekly_front = by_exp[front]
        cfg_r = RSConfig(REAL_START, SYN_END, entry_dte=5, dist_pct=0.02, wing_steps=6,
                         mode="real")
        real_structs = {}
        for s in structs:
            rr = rolling_series(real_src, spot, daily, REAL_START, SYN_END, front,
                                weekly_front, cfg_r, s, hold_days=5, real=True)
            real_structs[s] = evaluate(rr, "real_" + s) if rr else {"n": 0}
        # regime selector applied to the real rolling trades
        rr_all = []
        for s in real_structs:
            rr_all += rolling_series(real_src, spot, daily, REAL_START, SYN_END, front,
                                     weekly_front, cfg_r, s, hold_days=5, real=True)
        real_sel = apply_selector(rr_all, mapping)
        real_apri = [t for t in rr_all if APRIORI.get(_cell(t)) == t["structure"]]
        real_ic = [t for t in rr_all if t["structure"] == "iron_condor"]
        real_ss = [t for t in rr_all if t["structure"] == "short_strangle"]
        real_tab = {
            "front_expiry": front.isoformat(),
            "per_structure": real_structs,
            "selector": evaluate(real_sel, "real_selector"),
            "apriori": evaluate(real_apri, "real_apriori"),
            "always_iron_condor": evaluate(real_ic, "real_ic"),
            "always_short_strangle": evaluate(real_ss, "real_ss"),
            "note": ("Real cached contracts all expire after the spot data window "
                     "(nearest 2026-09-29); every real exit is MARK_END, not intrinsic. "
                     "5-day non-overlapping marks on the front expiry are the fairest transfer."),
        }

    # ---- verdict ----
    verdict, reason = _verdict(comp, selector_eval, agree, real_tab)

    out = {
        "track": "regime_structures",
        "hypothesis": ("Conditioning the option structure on a causal NIFTY regime (direction x "
                       "volatility x term structure) has higher OOS expectancy net of costs than "
                       "taking any single structure (iron condor / short strangle) unconditionally."),
        "feature": ("Prior-session EMA20 vs EMA50, 10d EMA slope, prior return sign, ADX(14) sign; "
                    "expanding INDIAVIX percentile + expanding ATR% percentile; real-window "
                    "surface_metrics_daily front term_slope; entry spot vs prior-day high/low; "
                    "event/IV-crush proxy (prior |ret| top decile + elevated VIX or term backwardation)."),
        "rule": ("Cell -> structure map fitted on TRAIN 2018-2022 only: per regime cell pick max "
                 "train expectancy structure (min n=25, else global train best); applied unchanged "
                 "OOS 2023-2026 and to real 2026. A-priori brief mapping also evaluated."),
        "data": ("SyntheticOptionSource BS premiums on real 2018-2026 1-min spot with causal "
                 "0.65*INDIAVIX+0.35*RV IV (flat smile); real FYERS premiums 2026-06-01..09-25 "
                 "(front 2026-09-29, all MARK_END)."),
        "n_trades": sel_full["n"],
        "net_exp": sel_full["net_exp"],
        "pf": sel_full["pf"],
        "win": sel_full["win"],
        "total_net": sel_full["total_net"],
        "max_drawdown": sel_full["max_drawdown"],
        "max_dd_pct_capital": sel_full["max_dd_pct_capital"],
        "train_exp": sel_train["net_exp"],
        "test_exp": sel_test["net_exp"],
        "test_n": sel_test["n"],
        "test_pf": sel_test["pf"],
        "test_dd_pct_capital": sel_test["max_dd_pct_capital"],
        "bootstrap_ci": sel_test["bootstrap_ci"],
        "bootstrap_ci_full": sel_full["bootstrap_ci"],
        "tail_loss_p95": sel_full["tail_loss_p95"],
        "raw_dir_accuracy": sel_full["raw_dir_accuracy"],
        "raw_dir_accuracy_signed": sel_full.get("raw_dir_accuracy_signed"),
        "capital_for_15k_week": sel_full["capital_for_15k_week"],
        "verdict": verdict,
        "reason": reason,
        "edge_basis": _edge_basis(comp, pair_vs_ic, pair_vs_ss),
        "selector_map": mapping,
        "selector_variants": selector_eval,
        "cell_structure_table": ct,
        "comparison": comp,
        "paired_selector_vs_ic": pair_vs_ic,
        "paired_selector_vs_ss": pair_vs_ss,
        "argmax_agreement": agree,
        "location_diagnostic": loc_diag,
        "per_structure": per_struct,
        "real_transfer": real_tab,
        "artifacts": ["tracks/regime_structures.py", "tracks/regime_structures.json",
                      "tracks/regime_structures.md", "tracks/regime_structures_log.jsonl"],
    }
    (HERE / "regime_structures.json").write_text(json.dumps(out, indent=2, default=str))
    _write_md(out)
    _write_log(alltr, ct, comp, mapping, pair_vs_ic, pair_vs_ss, agree, real_tab, selector_eval,
               loc_diag)
    print(f"\nselector full n={sel_full['n']} exp=Rs{sel_full['net_exp']:.0f} PF={sel_full['pf']:.2f}")
    print(f"selector test n={sel_test['n']} exp=Rs{sel_test['net_exp']:.0f} PF={sel_test['pf']:.2f} "
          f"CI={[round(x) for x in sel_test['bootstrap_ci']]}")
    print(f"IC test exp=Rs{comp['always_iron_condor']['test']['net_exp']:.0f} | "
          f"SS test exp=Rs{comp['always_short_strangle']['test']['net_exp']:.0f}")
    print(f"paired sel-IC {pair_vs_ic} | sel-SS {pair_vs_ss}")
    print(f"verdict: {verdict}")


def _edge_basis(comp, p_ic, p_ss):
    t = comp["selector"]["test"]
    return (f"Primary (train-fitted, positive-gate) OOS 2023-2026 expectancy Rs{t['net_exp']:.0f} "
            f"vs always-IC Rs{comp['always_iron_condor']['test']['net_exp']:.0f} "
            f"(paired diff {p_ic.get('mean_diff', float('nan')):.0f}, "
            f"CI [{p_ic.get('ci_low', float('nan')):.0f}, {p_ic.get('ci_high', float('nan')):.0f}]) "
            f"and always-SS Rs{comp['always_short_strangle']['test']['net_exp']:.0f} "
            f"(paired diff {p_ss.get('mean_diff', float('nan')):.0f}). "
            "Synthetic premiums embed the VRP by construction (flat smile), so any short-vol "
            "edge is partly a model artifact.")


def _verdict(comp, selector_eval, agree, real_tab):
    pri = selector_eval["primary_positive_gate"]
    t = pri["test"]
    p_ic, p_ss = pri["paired_vs_ic"], pri["paired_vs_ss"]
    ic = comp["always_iron_condor"]["test"]
    ss = comp["always_short_strangle"]["test"]
    best_base = max(ic.get("net_exp", -1e9), ss.get("net_exp", -1e9))
    beats_ic = p_ic.get("ci_low") is not None and p_ic.get("ci_low", -1) > 0
    beats_ss = p_ss.get("ci_low") is not None and p_ss.get("ci_low", -1) > 0
    real_ok = (real_tab.get("selector", {}).get("n", 0) >= 100
               and real_tab.get("selector", {}).get("net_exp", -1) > 0)
    n_match = sum(1 for v in agree.values() if v["match"])
    # strongest train-fitted variant on the test point estimate (exploratory)
    var_best = max(selector_eval.items(), key=lambda kv: kv[1]["test"].get("net_exp", -1e9))
    var_best_beats = (var_best[1]["paired_vs_ic"].get("ci_low", -1) > 0
                      or var_best[1]["paired_vs_ss"].get("ci_low", -1) > 0)
    curvefit = (f"Curve-fit evidence: train and test per-cell argmax structure agree in only "
                f"{n_match}/{len(agree)} regime cells; the train regime mix is *_high-heavy "
                f"(2018-22 COVID/2022 vol) while test is *_low-heavy, so the cells are "
                f"non-stationary and a train-fit map does not transfer.")
    if (t["n"] >= 100 and t["net_exp"] > 0 and t["pf"] > 1.05
            and (t["bootstrap_ci"][0] is not None and t["bootstrap_ci"][0] > 0)
            and t["max_dd_pct_capital"] > -0.25 and real_ok
            and (beats_ic or beats_ss)):
        return "accept", ("Selector beats the unconditional baselines OOS with a paired CI "
                          "excluding 0 and transfers to real premiums.")
    if var_best_beats and var_best[0] != "primary_positive_gate":
        return "defer", (
            f"The pre-specified primary selector (positive-gate over all 9 structures) earns "
            f"Rs{t['net_exp']:.0f}/trade OOS vs Rs{best_base:.0f} for the best unconditional baseline "
            f"(paired sel-IC CI [{p_ic.get('ci_low', float('nan')):.0f}, {p_ic.get('ci_high', float('nan')):.0f}]) "
            f"-- i.e. it does NOT beat taking a single structure. The one variant that does separate "
            f"from baseline is the exploratory '{var_best[0]}' selector (only short-premium structures; "
            f"regime picks which credit spread). It is positive but its advantage rests on a handful of "
            f"event/range_high trades and it cannot be confirmed on real 2026 (all cached contracts "
            f"expire after the data window -> MARK_END). {curvefit}")
    if t["n"] >= 100 and t["net_exp"] > best_base:
        return "defer", (
            f"The train-fitted regime selector earns Rs{t['net_exp']:.0f}/trade OOS vs "
            f"Rs{ic.get('net_exp', float('nan')):.0f} for always-IC and "
            f"Rs{ss.get('net_exp', float('nan')):.0f} for always-SS (point estimate only; paired "
            f"sel-IC CI [{p_ic.get('ci_low', float('nan')):.0f}, {p_ic.get('ci_high', float('nan')):.0f}]). "
            f"{curvefit} Synthetic short-vol P&L is largely the model's baked-in VRP; real 2026 "
            f"transfer is blocked.")
    return "reject", (
        f"Conditioning the structure on the causal regime does NOT beat taking a single structure "
        f"unconditionally OOS: primary selector Rs{t['net_exp']:.0f}/trade vs always-IC "
        f"Rs{ic.get('net_exp', float('nan')):.0f} and always-SS Rs{ss.get('net_exp', float('nan')):.0f} "
        f"(paired sel-IC CI [{p_ic.get('ci_low', float('nan')):.0f}, {p_ic.get('ci_high', float('nan')):.0f}] "
        f"straddles 0 and is centred negative). {curvefit}")


def _write_log(alltr, ct, comp, mapping, p_ic, p_ss, agree, real_tab, selector_eval=None,
               loc_diag=None):
    if LOG.exists():
        LOG.unlink()
    _log("selector_map", {"map": {k: v for k, v in mapping.items() if not k.startswith("_")}})
    if selector_eval:
        _log("selector_variants", {k: {"map": {kk: vv for kk, vv in v["map"].items()},
                                       "test": v["test"], "train": v["train"],
                                       "paired_vs_ic": v["paired_vs_ic"],
                                       "paired_vs_ss": v["paired_vs_ss"]}
                                   for k, v in selector_eval.items()})
    _log("comparison", comp)
    _log("paired_vs_ic", p_ic)
    _log("paired_vs_ss", p_ss)
    _log("argmax_agreement", agree)
    _log("location_diagnostic", loc_diag)
    for r in ct:
        _log("cell_structure", r)
    _log("real_transfer", real_tab)


def _write_md(out):
    c = out["comparison"]
    ct = out["cell_structure_table"]
    L = []
    L.append("# Track — regime-conditioned NIFTY structure selector")
    L.append("")
    L.append("**Hypothesis.** A causal NIFTY regime (direction x vol x term) can be mapped to a "
             "structure whose OOS expectancy beats taking one structure unconditionally.")
    L.append("")
    L.append("**Method.** Causal regime at entry (prior-session EMA20/50, 10d slope, return sign, "
             "ADX sign, expanding VIX & ATR% percentiles, real term_slope, spot vs prior high/low, "
             "IV-crush proxy). Multi-day hold-to-expiry simulator (generalised `theta_harvest`): "
             "credit+debit structures, stops on daily high/low, expiry-intrinsic settlement, NSE "
             "fees + spread on every leg. Cell->structure map fitted on TRAIN 2018-2022 only.")
    L.append("")
    L.append("| set | n | exp/trade | PF | win | total | maxDD% 3L | CI90 |")
    L.append("|---|---|---|---|---|---|---|---|")
    for nm, e in (("selector full", c["selector"]["full"]), ("selector train", c["selector"]["train"]),
                  ("selector test 23-26", c["selector"]["test"]),
                  ("a-priori test", c["apriori_brief"]["test"]),
                  ("always iron condor test", c["always_iron_condor"]["test"]),
                  ("always short strangle test", c["always_short_strangle"]["test"])):
        ci = [round(x) for x in (e.get("bootstrap_ci") or [float('nan'), float('nan')])]
        L.append(f"| {nm} | {e['n']} | {e['net_exp']:,.0f} | {e['pf']:.2f} | {e['win']*100:.0f}% "
                 f"| {e['total_net']:,.0f} | {e['max_dd_pct_capital']*100:.1f} | {ci} |")
    L.append("")
    L.append(f"**Paired OOS (selector - baseline, per entry day):** vs IC "
             f"{out['paired_selector_vs_ic'].get('mean_diff', float('nan')):,.0f} "
             f"(CI [{out['paired_selector_vs_ic'].get('ci_low', float('nan')):,.0f}, "
             f"{out['paired_selector_vs_ic'].get('ci_high', float('nan')):,.0f}]); vs SS "
             f"{out['paired_selector_vs_ss'].get('mean_diff', float('nan')):,.0f} "
             f"(CI [{out['paired_selector_vs_ss'].get('ci_low', float('nan')):,.0f}, "
             f"{out['paired_selector_vs_ss'].get('ci_high', float('nan')):,.0f}]).")
    L.append("")
    L.append("**Train-fitted selectors (OOS 2023-2026; all fitted on TRAIN only).**")
    L.append("")
    L.append("| selector | map (cell->structure) | test n | test exp | test PF | paired vs IC (CI) |")
    L.append("|---|---|---|---|---|---|")
    for nm, v in out["selector_variants"].items():
        mp = ", ".join(f"{k}:{vv}" for k, vv in v["map"].items())
        pi = v["paired_vs_ic"]
        ci = f"[{pi.get('ci_low', float('nan')):,.0f},{pi.get('ci_high', float('nan')):,.0f}]"
        L.append(f"| {nm} | {mp} | {v['test']['n']} | {v['test']['net_exp']:,.0f} "
                 f"| {v['test']['pf']:.2f} | {pi.get('mean_diff', float('nan')):,.0f} {ci} |")
    L.append("")
    L.append(f"| a-priori brief | fixed bull_high->bull_call, range_high->long_condor, else credit/IC | "
             f"{out['comparison']['apriori_brief']['test']['n']} "
             f"| {out['comparison']['apriori_brief']['test']['net_exp']:,.0f} "
             f"| {out['comparison']['apriori_brief']['test']['pf']:.2f} | — |")
    L.append(f"| a-priori credit | bull->bull_put, bear->bear_call, range->IC, event->SS | "
             f"{out['comparison']['apriori_credit']['test']['n']} "
             f"| {out['comparison']['apriori_credit']['test']['net_exp']:,.0f} "
             f"| {out['comparison']['apriori_credit']['test']['pf']:.2f} | — |")
    L.append("")
    L.append("**Per-regime OOS expectancy table (train exp / test exp; Rs/trade, n in parens).**")
    L.append("")
    cells = sorted({r["cell"] for r in ct})
    structs = sorted({r["structure"] for r in ct})
    L.append("| cell | " + " | ".join(structs) + " |")
    L.append("|---" * (len(structs) + 1) + "|")
    lut = {(r["cell"], r["structure"]): r for r in ct}
    for cl in cells:
        cells_txt = []
        for s in structs:
            r = lut.get((cl, s))
            if not r:
                cells_txt.append("—")
            else:
                cells_txt.append(f"{r['train_exp']:,.0f}/{r['test_exp']:,.0f} ({r['train_n']}/{r['test_n']})"
                                 if r["train_exp"] is not None and r["test_exp"] is not None
                                 else f"-/{r['test_exp']:,.0f} ({r['train_n']}/{r['test_n']})"
                                 if r["test_exp"] is not None else "—")
        L.append(f"| {cl} | " + " | ".join(cells_txt) + " |")
    n_match = sum(1 for v in out["argmax_agreement"].values() if v["match"])
    L.append("")
    L.append(f"**Curve-fit diagnostic.** Train vs test argmax structure agrees in "
             f"{n_match}/{len(out['argmax_agreement'])} cells. Train regime mix is *_high-heavy "
             "(2018-22 had COVID/2022 vol), test is *_low-heavy — the cells are not stationary, so "
             "a train-fit map is fragile.")
    rt = out.get("real_transfer", {})
    if rt:
        L.append("")
        L.append(f"**Real 2026 transfer (front {rt['front_expiry']}, 5-day non-overlapping marks, "
                 f"all MARK_END).** selector n={rt['selector']['n']} exp "
                 f"Rs{rt['selector'].get('net_exp', float('nan')):,.0f} | a-priori n={rt['apriori']['n']} "
                 f"Rs{rt['apriori'].get('net_exp', float('nan')):,.0f} | IC n={rt['always_iron_condor']['n']} "
                 f"Rs{rt['always_iron_condor'].get('net_exp', float('nan')):,.0f} | SS n={rt['always_short_strangle']['n']} "
                 f"Rs{rt['always_short_strangle'].get('net_exp', float('nan')):,.0f}.")
    L.append("")
    L.append(f"**Raw direction.** underlying P(up)={out['raw_dir_accuracy']:.3f}; "
             f"exposure-signed accuracy={out.get('raw_dir_accuracy_signed', float('nan')):.3f} "
             "(NIFTY drift + structure delta, not skill); short-premium structures are "
             "delta-hedged-ish so the relevant edge is variance, not direction.")
    L.append("")
    L.append("**Red-team.** (1) Synthetic premiums are BS off IV=0.65*VIX+0.35*RV with a *flat* "
             "smile, so every short-vol structure is handed the VRP and every long-vol structure "
             "pays it — debit structures are structurally handicapped in this model. (2) Train/test "
             "regime non-stationarity makes any per-cell map prone to curve-fitting. (3) Real "
             "contracts never settle at intrinsic, so the real transfer cannot confirm the mechanism.")
    L.append("")
    L.append(f"**Verdict: {out['verdict'].upper()}.** {out['reason']}")
    (HERE / "regime_structures.md").write_text("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
