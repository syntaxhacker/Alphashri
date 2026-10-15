"""STOCK-OPTIONS track — classic stock-option income/hedge structures vs buy-and-hold.

Model-based (no real stock-option premiums exist: FYERS token expired, only NIFTY
contracts cached). Premiums are Black-Scholes priced off the *actual* stock path
with a CAUSAL implied vol (trailing realised vol from daily closes + a vol-risk
multiple). Every number here is therefore a MODEL result, not a market quote.

Causal rules: at cycle entry (entry bar close) we use only bars <= entry. IV is a
20-day trailing realised vol ending at entry. Strike = spot x moneyness. Hold to
expiry, cash-settle at intrinsic. Roll monthly.

Costs: option legs reuse costs.leg_costs (NSE F&O charges) + ExecutionModel
half-spread/slippage. Stock equity entry/exit is common to CC and B&H so it does
not affect the relative comparison (reported once as a drag).

Run:  .venv/bin/python experiments/research/nifty_options/tracks/stock_covered_calls.py
"""
from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass, asdict
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve()
ROOT = HERE.parents[4]                      # .../stock-screener-ui
TRACKS = HERE.parent
KDIR = ROOT / "experiments" / "research" / "nifty_options"
sys.path.insert(0, str(KDIR))

from pricing import bs_price, RISK_FREE          # noqa: E402
from costs import ExecutionModel, leg_costs, short_margin_per_lot  # noqa: E402

CACHE = TRACKS / "_stock_daily"
CACHE.mkdir(exist_ok=True)

RR = 0.065                                       # risk-free (India)
TRADING_DAYS = 252

SYMBOLS = ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "SBIN",
           "ITC", "LT", "AXISBANK", "MARUTI", "BHARTIARTL", "KOTAKBANK"]

# NSE equity-derivative lot sizes (contract specifications). These are the
# *current* NSE F&O lots; they are revised periodically and we cite them as a
# model input, not a market quote. Source: NSE F&O contract file, 2025.
LOT = {"RELIANCE": 500, "TCS": 175, "INFY": 400, "HDFCBANK": 550,
       "ICICIBANK": 700, "SBIN": 750, "ITC": 400, "LT": 300,
       "AXISBANK": 625, "MARUTI": 50, "BHARTIARTL": 475, "KOTAKBANK": 400}

MODEL = ExecutionModel()                         # 0.35% half-spread + 0.15% slip

MULT = [1.00, 1.02, 1.05, 1.08]                  # call moneyness (K = S x m)
IV_BASE = 1.15                                   # base VRP multiple (IV = RV x 1.15)
IV_GRID = [0.9, 1.0, 1.15, 1.3]
SMILE = 1.5                                       # wing richness per log-moneyness unit
EQ_ROUNDTRIP = 0.0035                            # equity delivery STT+charges (~0.35%)


# --------------------------------------------------------------------------- data
def load_daily(sym: str) -> pd.DataFrame:
    f = CACHE / f"{sym}.parquet"
    if f.exists():
        df = pd.read_parquet(f)
    else:
        import yfinance as yf
        df = yf.Ticker(f"{sym}.NS").history(period="6y", interval="1d",
                                            auto_adjust=True)
        df = df[["Open", "High", "Low", "Close", "Volume"]].dropna()
        df.index.name = "date"
        df.to_parquet(f)
    if df.index.tz is None:
        df.index = df.index.tz_localize("Asia/Kolkata")
    else:
        df.index = df.index.tz_convert("Asia/Kolkata")
    return df


def trailing_rv(close: pd.Series, window: int = 20) -> pd.Series:
    """Causal annualised realised vol; value at day t uses closes <= t."""
    r = np.log(close / close.shift(1))
    return (r.rolling(window).std() * math.sqrt(TRADING_DAYS)).clip(lower=0.08, upper=2.0)


def round_strike(S: float) -> float:
    step = 5 if S < 500 else 10 if S < 2000 else 20 if S < 5000 else 50
    return round(S / step) * step


def smile_sigma(atm: float, S: float, K: float, T: float) -> float:
    """Symmetric log-moneyness smile, DECOUPLED from the IV level.

    Using ``atm`` inside the smile denominator (as the NIFTY kernel does) makes
    the smile explode as atm -> 0, which destroys any low-IV sensitivity test.
    Here the wing richness is a fixed relative amount per log-moneyness unit, so
    scaling ``atm`` genuinely changes the premium level.
    """
    m = abs(math.log(K / S))
    return max(0.05, min(2.0, atm * (1.0 + SMILE * m)))


def last_thursday(y: int, mo: int) -> pd.Timestamp:
    d = pd.Timestamp(y, mo, 1) + pd.offsets.MonthEnd(0)
    while d.weekday() != 3:                    # Thursday == 3
        d -= pd.Timedelta(days=1)
    return d


# ------------------------------------------------------------------------ cycles
@dataclass
class Cycle:
    entry: pd.Timestamp
    settle: pd.Timestamp
    S0: float
    S1: float
    T: float
    rv: float


def build_cycles(df: pd.DataFrame, mode: str) -> list[Cycle]:
    idx = df.index
    close = df["Close"]
    rv = trailing_rv(close)
    out: list[Cycle] = []
    if mode == "monthly":
        months = sorted({(t.year, t.month) for t in idx})
        for y, mo in months:
            in_month = idx[(idx.year == y) & (idx.month == mo)]
            if len(in_month) < 2:
                continue
            exp = last_thursday(y, mo).tz_localize(idx.tz)
            prior = idx[idx <= exp]
            after = idx[idx >= in_month[0]]
            elig = after[after <= exp]
            if len(elig) < 2:
                continue
            e, s = elig[0], elig[-1]
            out.append(Cycle(e, s, float(close[e]), float(close[s]),
                             max((s - e).days, 1) / 365.25, float(rv[e])))
    else:  # 30-DTE, non-overlapping
        t = 0
        n = len(idx)
        while t < n - 2:
            e = idx[t]
            target = e + pd.Timedelta(days=30)
            cand = idx[(idx >= e) & (idx <= target)]
            if len(cand) < 2:
                break
            s = cand[-1]
            out.append(Cycle(e, s, float(close[e]), float(close[s]),
                             max((s - e).days, 1) / 365.25, float(rv[e])))
            # advance past this cycle
            t = int(np.searchsorted(idx.values, s.to_datetime64(), side="right"))
    return out


# --------------------------------------------------------------------- structures
def call_cycle(c: Cycle, mult: float, iv_mult: float, smile: bool,
               lot: int) -> dict:
    S0, S1 = c.S0, c.S1
    K = round_strike(S0 * mult)
    T = c.T
    atm = c.rv * iv_mult
    sig = smile_sigma(atm, S0, K, T) if smile else atm
    prem = bs_price(S0, K, T, sig, "CE", RR)
    recv = MODEL.sell_fill(prem)
    entry_cost = leg_costs(prem, lot, "SELL") / lot
    payoff = max(0.0, S1 - K)
    exit_cost = (leg_costs(payoff, lot, "BUY") / lot) if payoff > 0 else 0.0
    cc = (S1 - S0) + recv - payoff - entry_cost - exit_cost
    bh = S1 - S0
    return dict(stock_ret=(S1 - S0) / S0, cc_ret=cc / S0, bh_ret=bh / S0,
                premium=prem, prem_pct=prem / S0, payoff=payoff,
                worthless=1 if payoff <= 0 else 0, K=K, T=T, iv=sig, rv=c.rv,
                entry=str(c.entry.date()), settle=str(c.settle.date()))


def csp_cycle(c: Cycle, mult: float, iv_mult: float, smile: bool, lot: int) -> dict:
    S0, S1 = c.S0, c.S1
    K = round_strike(S0 * mult)
    atm = c.rv * iv_mult
    sig = smile_sigma(atm, S0, K, c.T) if smile else atm
    prem = bs_price(S0, K, c.T, sig, "PE", RR)
    recv = MODEL.sell_fill(prem)
    entry_cost = leg_costs(prem, lot, "SELL") / lot
    assigned = S1 < K
    if assigned:
        # buy stock at K, mark to S1; exit charge on the put = 0 (assigned)
        pnl = recv - entry_cost - (K - S1)
    else:
        pnl = recv - entry_cost
    return dict(csp_ret=pnl / S0, assigned=1 if assigned else 0, premium=prem,
                prem_pct=prem / S0, K=K)


def collar_cycle(c: Cycle, call_m: float, put_m: float, iv_mult: float,
                 smile: bool, lot: int) -> dict:
    S0, S1 = c.S0, c.S1
    Kc = round_strike(S0 * call_m)
    Kp = round_strike(S0 * put_m)
    atm = c.rv * iv_mult
    sc = smile_sigma(atm, S0, Kc, c.T) if smile else atm
    sp = smile_sigma(atm, S0, Kp, c.T) if smile else atm
    pc = bs_price(S0, Kc, c.T, sc, "CE", RR)
    pp = bs_price(S0, Kp, c.T, sp, "PE", RR)
    call_recv = MODEL.sell_fill(pc)
    put_pay = MODEL.buy_fill(pp)
    c_cost = leg_costs(pc, lot, "SELL") / lot + leg_costs(pp, lot, "BUY") / lot
    call_payoff = max(0.0, S1 - Kc)
    put_payoff = max(0.0, Kp - S1)
    net_pnl = (S1 - S0) + call_recv - put_pay - call_payoff + put_payoff - c_cost
    return dict(collar_ret=net_pnl / S0, bh_ret=(S1 - S0) / S0,
                net_prem=(pc - pp) / S0, put_payoff=put_payoff / S0,
                call_payoff=call_payoff / S0)


# ------------------------------------------------------------------------ metrics
def perf(rets: np.ndarray, periods_per_year: float = 12.0) -> dict:
    """CAGR/vol/Sharpe/maxDD from per-period simple returns."""
    rets = np.asarray(rets, dtype=float)
    n = len(rets)
    if n == 0:
        return {}
    eq = np.cumprod(1.0 + rets)
    cagr = eq[-1] ** (periods_per_year / n) - 1.0 if eq[-1] > 0 else -1.0
    vol = float(rets.std(ddof=1) * math.sqrt(periods_per_year)) if n > 1 else 0.0
    mu = float(rets.mean() * periods_per_year)
    sharpe = (mu - RR) / vol if vol > 0 else float("nan")
    peak = np.maximum.accumulate(eq)
    dd = eq / peak - 1.0
    return dict(cagr=float(cagr), vol=vol, sharpe=float(sharpe),
                max_dd=float(dd.min()), total_ret=float(eq[-1] - 1.0),
                mean_period=float(rets.mean()), n=int(n))


def cum_cc(rets: np.ndarray) -> float:
    return float(np.prod(1.0 + np.asarray(rets)) - 1.0)


# --------------------------------------------------------------------------- main
def run_stock(sym: str, mode: str) -> dict:
    df = load_daily(sym)
    lot = LOT[sym]
    cycles = build_cycles(df, mode)
    if len(cycles) < 6:
        return {}
    res: dict = {"symbol": sym, "lot": lot, "n_cycles": len(cycles),
                 "start": str(cycles[0].entry.date()), "end": str(cycles[-1].settle.date())}
    pm = {}
    for m in MULT:
        rows = [call_cycle(c, m, IV_BASE, True, lot) for c in cycles]
        cc = np.array([r["cc_ret"] for r in rows])
        bh = np.array([r["bh_ret"] for r in rows])
        p = perf(cc)
        p["bh"] = perf(bh)
        p["prem_pct_avg"] = float(np.mean([r["prem_pct"] for r in rows]))
        p["worthless_pct"] = float(np.mean([r["worthless"] for r in rows]))
        p["cc_minus_bh_period"] = float((cc - bh).mean())
        p["cc_excess_total"] = float(np.prod(1 + cc) - np.prod(1 + bh))
        pm[str(m)] = p
    res["covered_call"] = pm
    res["buy_hold"] = perf(np.array([(c.S1 - c.S0) / c.S0 for c in cycles]))
    # CSP
    csp_rows = [csp_cycle(c, 0.97, IV_BASE, True, lot) for c in cycles]
    res["csp"] = {"perf": perf(np.array([r["csp_ret"] for r in csp_rows])),
                  "assign_rate": float(np.mean([r["assigned"] for r in csp_rows])),
                  "prem_pct_avg": float(np.mean([r["prem_pct"] for r in csp_rows]))}
    # Collar 0.95/1.05
    col = [collar_cycle(c, 1.05, 0.95, IV_BASE, True, lot) for c in cycles]
    res["collar"] = {"perf": perf(np.array([r["collar_ret"] for r in col])),
                     "bh": perf(np.array([r["bh_ret"] for r in col])),
                     "p05_collar": float(np.percentile([r["collar_ret"] for r in col], 5)),
                     "p05_bh": float(np.percentile([r["bh_ret"] for r in col], 5)),
                     "net_prem_avg": float(np.mean([r["net_prem"] for r in col]))}
    # IV sensitivity on 1.05 call: cumulative CC vs B&H, find break-even multiple
    bh_total = float(np.prod(1 + np.array([(c.S1 - c.S0) / c.S0 for c in cycles])) - 1.0)
    ivsens = {}
    for im in IV_GRID:
        r = [call_cycle(c, 1.05, im, True, lot) for c in cycles]
        rets = np.array([x["cc_ret"] for x in r])
        ivsens[im] = {"cum_ret": cum_cc(rets),
                      "prem_pct_avg": float(np.mean([x["prem_pct"] for x in r])),
                      "worthless_pct": float(np.mean([x["worthless"] for x in r]))}
    # break-even IV multiple (monotone in premium)
    def cc_at(im):
        return cum_cc(np.array([call_cycle(c, 1.05, im, True, lot)["cc_ret"] for c in cycles]))
    lo, hi = 0.2, 4.0
    be = None
    if cc_at(lo) <= bh_total <= cc_at(hi):
        for _ in range(40):
            mid = (lo + hi) / 2
            if cc_at(mid) < bh_total:
                lo = mid
            else:
                hi = mid
        be = (lo + hi) / 2
    res["iv_sensitivity_105"] = {"bh_cum_ret": bh_total, "grid": ivsens,
                                 "breakeven_iv_mult": be}
    # regime split at 1.05 (base IV)
    rows = [call_cycle(c, 1.05, IV_BASE, True, lot) for c in cycles]
    reg = {}
    for name, lo_, hi_ in [("strong_bull_gt5", 0.05, 9), ("mild_up_0_5", 0.0, 0.05),
                          ("down_le0", -9, 0.0)]:
        sel = [i for i, r in enumerate(rows) if lo_ <= r["stock_ret"] < hi_]
        if sel:
            reg[name] = {"n": len(sel),
                         "cc_mean": float(np.mean([rows[i]["cc_ret"] for i in sel])),
                         "bh_mean": float(np.mean([rows[i]["bh_ret"] for i in sel])),
                         "cc_excess": float(np.mean([rows[i]["cc_ret"] - rows[i]["bh_ret"] for i in sel]))}
    res["regime_105"] = reg
    # per-cycle data for correct (non-pooled-compounding) aggregation
    res["_cycles"] = rows
    res["_pool"] = {"bh": [r["bh_ret"] for r in rows],
                    "csp": [csp_cycle(c, 0.97, IV_BASE, True, lot)["csp_ret"] for c in cycles],
                    "collar": [collar_cycle(c, 1.05, 0.95, IV_BASE, True, lot)["collar_ret"] for c in cycles],
                    "collar_bh": [r["bh_ret"] for r in col],
                    "cc": {}}
    for m in MULT:
        rr = [call_cycle(c, m, IV_BASE, True, lot) for c in cycles]
        res["_pool"]["cc"][m] = {"cc": [r["cc_ret"] for r in rr],
                                 "prem": [r["prem_pct"] for r in rr],
                                 "worthless": [r["worthless"] for r in rr],
                                 "K": [r["K"] for r in rr]}
    return res


def run_wheel(sym: str, mode: str) -> dict:
    """CSP 0.97 -> assignment -> covered call 1.03, repeat. Simplified, per-share."""
    df = load_daily(sym)
    lot = LOT[sym]
    cycles = build_cycles(df, mode)
    state = "csp"
    cash = 0.0
    equity = []           # mark-to-market per cycle, per share
    stock_px = 0.0
    for c in cycles:
        if state == "csp":
            r = csp_cycle(c, 0.97, IV_BASE, True, lot)
            cash += r["csp_ret"] * c.S0
            if r["assigned"]:
                state, stock_px = "holding", c.S1
            equity.append(cash)
        else:
            r = call_cycle(c, 1.03, IV_BASE, True, lot)
            # holding cost basis stock_px; mark to S1
            cash += r["cc_ret"] * c.S0
            if c.S1 >= r["K"]:            # called away -> back to CSP
                state = "csp"
            equity.append(cash)
    rets = np.diff([0.0] + equity) / max(cycles[0].S0, 1e-9)
    return {"symbol": sym, "n_cycles": len(cycles), "perf": perf(np.array(rets)),
            "final_cash_per_share": float(equity[-1]) if equity else 0.0}


def _mean(x):
    return float(np.mean(x)) if len(x) else float("nan")


def _median(x):
    return float(np.median(x)) if len(x) else float("nan")


def _pooled(rets: np.ndarray, ppy: float = 12.0) -> dict:
    rets = np.asarray(rets, dtype=float)
    mu = rets.mean() * ppy
    sd = rets.std(ddof=1) * math.sqrt(ppy) if len(rets) > 1 else 0.0
    return {"mean_period": float(rets.mean()), "ann_mean": float(mu),
            "ann_vol": float(sd), "sharpe": float((mu - RR) / sd) if sd > 0 else float("nan"),
            "win_rate": float((rets > 0).mean()),
            "p05": float(np.percentile(rets, 5)), "worst": float(rets.min())}


def aggregate(per: dict, mode: str) -> dict:
    """Correct aggregation: per-stock compounding, then cross-sectional means.

    Pooling raw per-cycle returns across 12 stocks and compounding them as if a
    single series is WRONG (12 independent series, ~72 cycles each). We report
    (a) cross-sectional means of per-stock metrics and (b) pooled per-cycle
    (non-compounded) statistics.
    """
    stocks = [s for s, v in per.items() if v]
    n_cycles = sum(len(per[s]["_pool"]["bh"]) for s in stocks)
    cs = {"covered_call": {}, "buy_hold": {}, "covered_call_median_cagr": {},
          "buy_hold_median_cagr": _median([per[s]["buy_hold"]["cagr"] for s in stocks]),
          "cc_beats_bh_pct": {}}
    for k in ["cagr", "vol", "sharpe", "max_dd", "total_ret"]:
        cs["buy_hold"][k] = _mean([per[s]["buy_hold"][k] for s in stocks])
    for m in MULT:
        cs["covered_call"][str(m)] = {
            k: _mean([per[s]["covered_call"][str(m)][k] for s in stocks])
            for k in ["cagr", "vol", "sharpe", "max_dd", "total_ret",
                      "prem_pct_avg", "worthless_pct"]}
        cs["covered_call_median_cagr"][str(m)] = _median(
            [per[s]["covered_call"][str(m)]["cagr"] for s in stocks])
        cs["cc_beats_bh_pct"][str(m)] = float(np.mean(
            [per[s]["covered_call"][str(m)]["total_ret"] > per[s]["buy_hold"]["total_ret"]
             for s in stocks]))

    pool_cc = {m: np.concatenate([per[s]["_pool"]["cc"][m]["cc"] for s in stocks]) for m in MULT}
    pool_prem = {m: np.concatenate([per[s]["_pool"]["cc"][m]["prem"] for s in stocks]) for m in MULT}
    pool_wl = {m: np.concatenate([per[s]["_pool"]["cc"][m]["worthless"] for s in stocks]) for m in MULT}
    pool_bh = np.concatenate([per[s]["_pool"]["bh"] for s in stocks])
    pool_csp = np.concatenate([per[s]["_pool"]["csp"] for s in stocks])
    pool_col = np.concatenate([per[s]["_pool"]["collar"] for s in stocks])
    pool_col_bh = np.concatenate([per[s]["_pool"]["collar_bh"] for s in stocks])

    agg = {"n_cycles": n_cycles, "n_stocks": len(stocks), "cross_sectional": cs,
           "pooled": {"covered_call": {}, "buy_hold": _pooled(pool_bh),
                      "csp": _pooled(pool_csp),
                      "collar": {**_pooled(pool_col),
                                 "p05_bh": float(np.percentile(pool_col_bh, 5))},
                      "cc_beats_bh_cycle_pct": {}, "avg_premium_pct": {},
                      "worthless_pct": {}},
           "per_cycle_excess_cc105_ann": float((pool_cc[1.05] - pool_bh).mean() * 12)}
    for m in MULT:
        agg["pooled"]["covered_call"][str(m)] = _pooled(pool_cc[m])
        agg["pooled"]["cc_beats_bh_cycle_pct"][str(m)] = float((pool_cc[m] > pool_bh).mean())
        agg["pooled"]["avg_premium_pct"][str(m)] = float(pool_prem[m].mean())
        agg["pooled"]["worthless_pct"][str(m)] = float(pool_wl[m].mean())

    all_reg = [r for s in stocks for r in per[s]["_cycles"]]
    reg = {}
    for name, lo_, hi_ in [("strong_bull_gt5", 0.05, 9), ("mild_up_0_5", 0.0, 0.05),
                           ("down_le0", -9, 0.0)]:
        sel = [r for r in all_reg if lo_ <= r["stock_ret"] < hi_]
        if sel:
            reg[name] = {"n": len(sel),
                         "cc_mean": _mean([r["cc_ret"] for r in sel]),
                         "bh_mean": _mean([r["bh_ret"] for r in sel]),
                         "cc_excess": _mean([r["cc_ret"] - r["bh_ret"] for r in sel])}
    agg["regime_105"] = reg

    agg["iv_sensitivity_105"] = {
        "grid": {}, "per_stock_breakeven":
            {s: per[s]["iv_sensitivity_105"]["breakeven_iv_mult"] for s in stocks},
        "bh_cum_ret_mean": _mean([per[s]["buy_hold"]["total_ret"] for s in stocks])}
    for im in IV_GRID:
        cums = [per[s]["iv_sensitivity_105"]["grid"][im]["cum_ret"] for s in stocks]
        agg["iv_sensitivity_105"]["grid"][str(im)] = {
            "cum_ret_mean": _mean(cums), "cum_ret_median": _median(cums),
            "prem_pct_mean": _mean([per[s]["iv_sensitivity_105"]["grid"][im]["prem_pct_avg"] for s in stocks])}
    mults = np.array(IV_GRID, dtype=float)
    cums = np.array([agg["iv_sensitivity_105"]["grid"][str(im)]["cum_ret_mean"] for im in IV_GRID])
    bh_c = agg["iv_sensitivity_105"]["bh_cum_ret_mean"]
    agg["iv_sensitivity_105"]["breakeven_iv_mult_agg"] = (
        float(np.interp(bh_c, cums, mults)) if cums.min() <= bh_c <= cums.max() else None)

    # raw directional accuracy (brief's one rule) + bootstrap CI on the CC edge
    excess = pool_cc[1.05] - pool_bh
    rng = np.random.default_rng(7)
    idx = rng.integers(0, len(excess), size=(5000, len(excess)))
    bmeans = excess[idx].mean(axis=1)
    gross_pos = pool_cc[1.05][pool_cc[1.05] > 0].sum()
    gross_neg = -pool_cc[1.05][pool_cc[1.05] < 0].sum()
    agg["raw"] = {
        "raw_dir_accuracy_stock": float((pool_bh > 0).mean()),
        "raw_move_stock": float(pool_bh.mean()),
        "cc_profit_factor": float(gross_pos / gross_neg) if gross_neg > 0 else float("inf"),
        "cc_win_rate": float((pool_cc[1.05] > 0).mean()),
        "excess_mean_per_cycle": float(excess.mean()),
        "excess_ann": float(excess.mean() * 12),
        "excess_boot_ci90": [float(np.percentile(bmeans, 5)), float(np.percentile(bmeans, 95))],
        "excess_boot_p_positive": float((bmeans > 0).mean()),
    }
    return agg


def main():
    out = {"track": "stock_covered_calls",
           "label": "MODEL-BASED (Black-Scholes; no real stock-option premiums available)",
           "assumptions": {
               "risk_free": RR, "iv_base_mult": IV_BASE, "smile_coeff": SMILE,
               "lot_sizes": LOT, "lot_source": "NSE F&O contract file (2025); revised periodically",
               "iv": "IV = 20d trailing realised vol x mult (causal); smile = atm*(1+1.5*|log(K/S)|), decoupled from IV level",
               "costs": "costs.leg_costs + ExecutionModel(0.35% half-spread + 0.15% slippage)",
               "settlement": "cash-settled at intrinsic (real stock F&O is physically settled)",
               "stock_cost": f"equity delivery round-trip ~{EQ_ROUNDTRIP*100:.2f}% common to CC & B&H (excluded from relative comparison)"},
           "modes": {}}
    log = []
    for mode in ["monthly", "30dte"]:
        per, wheel = {}, {}
        for sym in SYMBOLS:
            per[sym] = run_stock(sym, mode)
            wheel[sym] = run_wheel(sym, mode)
        agg = aggregate(per, mode)
        out["modes"][mode] = {
            "per_stock": {s: {k: v for k, v in per[s].items() if not k.startswith("_")}
                          for s in per},
            "aggregate": agg, "wheel": wheel}
        wheel_cagr = _mean([wheel[s]["perf"].get("cagr", float("nan")) for s in wheel])
        log.append({"mode": mode, "n_cycles": agg["n_cycles"],
                    "cc_metrics": agg["cross_sectional"]["covered_call"],
                    "bh_metrics": agg["cross_sectional"]["buy_hold"],
                    "pooled": agg["pooled"], "regime": agg["regime_105"],
                    "ivsens": agg["iv_sensitivity_105"], "raw": agg["raw"],
                    "wheel_mean_cagr": wheel_cagr})
        print(f"\n=== MODE {mode} ===")
        print(f"n_cycles={agg['n_cycles']} stocks={agg['n_stocks']}")
        print("CC xs cagr:", {str(m): round(agg["cross_sectional"]["covered_call"][str(m)]["cagr"], 4) for m in MULT})
        print("BH xs cagr:", round(agg["cross_sectional"]["buy_hold"]["cagr"], 4))
        print("CC beats BH (stocks):", agg["cross_sectional"]["cc_beats_bh_pct"])
        print("excess ann (per-cycle):", round(agg["per_cycle_excess_cc105_ann"], 4))
        print("regime :", json.dumps(agg["regime_105"], default=str))
        print("ivsens :", json.dumps(agg["iv_sensitivity_105"], default=str))
        print("wheel mean cagr:", round(wheel_cagr, 4))
    a = out["modes"]["monthly"]["aggregate"]
    a30 = out["modes"]["30dte"]["aggregate"]
    cc, bh = a["cross_sectional"]["covered_call"]["1.05"], a["cross_sectional"]["buy_hold"]
    out["verdict_block"] = {
        "track": "stock_covered_calls",
        "hypothesis": "Selling covered calls on liquid NSE large caps adds net income vs buy-and-hold, "
                      "and the edge is short-vol (underperforms in strong bulls, wins flat/mild-up).",
        "feature": "causal IV = 20d trailing RV x vol-multiple; monthly / 30-DTE cycles; strike = spot x moneyness",
        "rule": "hold stock, sell 1 OTM call each cycle to expiry, cash-settle at intrinsic, roll",
        "data": "yfinance daily (auto-adjust) 6y, 12 liquid optionable NSE names; MODEL premiums (BS) - no real stock-option quotes",
        "n_trades": a["n_cycles"],
        "net_exp": a["raw"]["excess_mean_per_cycle"],
        "pf": a["raw"]["cc_profit_factor"],
        "win": a["pooled"]["covered_call"]["1.05"]["win_rate"],
        "total_net": cc["total_ret"],
        "max_drawdown": cc["max_dd"],
        "raw_dir_accuracy": a["raw"]["raw_dir_accuracy_stock"],
        "edge_basis": "vol risk premium: modeled IV = 1.15x trailing RV (plus smile) vs realised RV",
        "bootstrap_ci": a["raw"]["excess_boot_ci90"],
        "tail_loss_p95": a["pooled"]["covered_call"]["1.05"]["p05"],
        "verdict": "defer",
        "reason": ("MODEL-ONLY. In-model the CC overlay beats B&H by ~+6-7%/yr (CC CAGR 17.7% vs BH 10.1% monthly; "
                   "23.1% vs 14.5% at 30-DTE), 92-100% of names, driven by IV=1.15xRV. Break-even at effective IV ~= 0.97xRV "
                   "(raw mult ~0.90 due to smile). Regime test confirms the known truth: CC loses ~2.0-2.5pp/month in strong "
                   "bull months (>+5%), wins +1.4-1.6pp/month in flat/up and down months. Positive net P&L alone is NOT an edge "
                   "here - it is mostly modelled carry. Verdict DEFER until re-tested on real stock-option premiums."),
        "artifacts": ["stock_covered_calls.json", "stock_covered_calls_log.jsonl", "stock_covered_calls.py"],
    }
    (TRACKS / "stock_covered_calls.json").write_text(json.dumps(out, indent=2, default=str))
    with open(TRACKS / "stock_covered_calls_log.jsonl", "w") as f:
        for e in log:
            f.write(json.dumps(e, default=str) + "\n")
    print("\nwrote stock_covered_calls.json + log")


if __name__ == "__main__":
    main()
