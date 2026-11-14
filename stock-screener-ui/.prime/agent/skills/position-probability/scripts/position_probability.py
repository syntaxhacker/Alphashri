#!/usr/bin/env python
"""Probabilistic pre-position brief for an NSE symbol.

Answers three questions before taking a position:

  1. Where is the stock in its own momentum/trend cycle?
  2. What does the market (option chains) imply for the next N sessions?
  3. What is the probability distribution of the close on the target date?

Usage (run from the repo root):

    .venv/bin/python .prime/agent/skills/position-probability/scripts/position_probability.py \
        --symbol IRFC --target 2026-11-23

    # power-grid style symbol with an explicit horizon
    .venv/bin/python .../position_probability.py --symbol POWERGRID --target 2026-11-23 \
        --indexes NIFTY,MIDCPNIFTY,BANKNIFTY,NIFTYPSE

    # quick check, no files written
    .venv/bin/python .../position_probability.py --symbol IRFC --target 2026-11-23 --print-only

Output: reports/position_probability/<SYMBOL>/position_probability_<target>.md (+ CSVs).
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import fetch_market_data as fmd  # noqa: E402
import lib_probability as lp  # noqa: E402

REPO_ROOT = fmd.REPO_ROOT


# --------------------------------------------------------------------------
# calendar
# --------------------------------------------------------------------------

def trading_sessions(start: date, end: date) -> list[date]:
    """Weekday sessions between two dates, minus NSE trading holidays.

    Falls back to weekdays only if the holiday table is unavailable.
    """
    try:
        from trading.utils import is_trading_holiday
    except Exception:
        is_trading_holiday = None
    out = []
    d = start
    while d <= end:
        if d.weekday() < 5 and not (is_trading_holiday and is_trading_holiday(d)):
            out.append(d)
        d += timedelta(days=1)
    return out


def horizon_to(target: str, last_session: date) -> int:
    """Number of trading sessions from `last_session` (exclusive) to `target`."""
    t = date.fromisoformat(target)
    if t <= last_session:
        return 0
    return len(trading_sessions(last_session + timedelta(days=1), t))


# --------------------------------------------------------------------------
# report helpers
# --------------------------------------------------------------------------

def pct(x: float) -> str:
    return f"{x * 100:+.1f}%"


def md_table(rows: list[dict], cols: list[str], headers: list[str], fmt=None) -> str:
    fmt = fmt or {}
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join(["---"] * len(headers)) + "|"]
    for r in rows:
        cells = []
        for c in cols:
            v = r.get(c)
            f = fmt.get(c)
            cells.append(f(v, r) if f else ("" if v is None else str(v)))
        out.append("| " + " | ".join(cells) + " |")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--symbol", required=True, help="NSE symbol, e.g. IRFC")
    ap.add_argument("--target", required=True, help="target date YYYY-MM-DD")
    ap.add_argument("--indexes", default=",".join(fmd.DEFAULT_INDEXES),
                    help="comma separated index ids for beta/correlation")
    ap.add_argument("--from-date", default="2020-06-01")
    ap.add_argument("--out", default=None, help="output dir (default reports/position_probability/<SYM>)")
    ap.add_argument("--print-only", action="store_true")
    ap.add_argument("--no-chain", action="store_true", help="skip option-chain (market-implied) leg")
    ap.add_argument("--no-yf", action="store_true", help="skip yfinance valuation snapshot")
    ap.add_argument("--seed", type=int, default=20261111)
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed)
    symbol = args.symbol.upper()
    index_ids = [i.strip().upper() for i in args.indexes.split(",") if i.strip()]

    client = fmd.upstox_client()

    # ---------- data ----------
    px = fmd.upstox_daily(symbol, from_date=args.from_date, client=client)
    if px is None or px.empty:
        print(f"no Upstox data for {symbol}", file=sys.stderr)
        return 2
    session = fmd.upstox_intraday_session(symbol, client=client)
    if session:
        px = fmd.append_session(px, session)
    spot = float(px["close"].iloc[-1])
    last_session = px.index[-1].date()
    H = horizon_to(args.target, last_session)
    if H <= 0:
        print(f"target {args.target} is not after the last session {last_session}", file=sys.stderr)
        return 2

    idx_px = {}
    for iid in index_ids:
        d = fmd.upstox_daily(iid, is_index=True, from_date=args.from_date, client=client)
        if d is not None and not d.empty:
            idx_px[iid] = d

    # ---------- features / state ----------
    f = lp.build_features(px)
    state = lp.describe_state(f)
    r_sym = px["close"].pct_change().dropna()

    # ---------- correlation / beta ----------
    corr_rows = []
    for iid, d in idx_px.items():
        r_idx = d["close"].pct_change().dropna()
        row = {"index": iid}
        for w in (60, 252):
            df_ = pd.concat([r_sym, r_idx], axis=1, sort=True).dropna().tail(w)
            if len(df_) < 30:
                row[f"b{w}"] = row[f"c{w}"] = None
                continue
            row[f"b{w}"] = df_.iloc[:, 0].cov(df_.iloc[:, 1]) / df_.iloc[:, 1].var()
            row[f"c{w}"] = df_.corr().iloc[0, 1]
        corr_rows.append(row)

    # ---------- cycle structure ----------
    legs = lp.swing_legs(lp.zigzag(px["close"], 30), px["close"])
    dd_eps = lp.drawdown_episodes(px["close"], 0.30)
    dd_rows = []
    for ep in dd_eps:
        i = px["close"].index.get_loc(ep["date"])
        row = {"date": str(ep["date"]), "price": round(ep["price"], 2), "dd": pct(ep["dd"])}
        for h, lab in ((63, "3m"), (126, "6m"), (252, "12m")):
            j = i + h
            row[lab] = pct(px["close"].iloc[j] / ep["price"] - 1) if j < len(px) else None
        dd_rows.append(row)

    # ---------- conditional sets ----------
    fwd = lp.forward_returns(px["close"], H)
    base = pd.DataFrame({"fwd": fwd, "rsi": f["rsi"], "ret10": f["ret10"], "ret20": f["ret20"],
                         "ret60": f["ret60"], "d200": f["d200"], "d50": f["d50"],
                         "slope": f["slope200"], "volr": f["volr"], "sig60": f["sig60"]}).dropna()

    def cond_row(label, mask):
        eps = lp.non_overlapping_episodes(mask, H)
        v = base.loc[eps, "fwd"] if eps else pd.Series(dtype=float)
        pooled = base.loc[mask, "fwd"]
        return {
            "set": label,
            "n_ep": len(eps),
            "mean": pct(v.mean()) if len(v) else None,
            "median": pct(v.median()) if len(v) else None,
            "p_up": f"{(v > 0).mean() * 100:.0f}%" if len(v) else None,
            "p_up10": f"{(v > 0.10).mean() * 100:.0f}%" if len(v) else None,
            "p_dn5": f"{(v < -0.05).mean() * 100:.0f}%" if len(v) else None,
            "n_pool": len(pooled),
        }

    cond_rows = [
        cond_row("unconditional", pd.Series(True, index=base.index)),
        cond_row("below 200-DMA", base.d200 < 0),
        cond_row("above 200-DMA", base.d200 > 0),
        cond_row("RSI>70 (stretched)", base.rsi > 70),
        cond_row("RSI 45-65 & below 200-DMA", base.rsi.between(45, 65) & (base.d200 < 0)),
    ]

    # matched analog: current momentum/trend state, mirrored
    rules = {"d200": (None, 0.0) if state["d200"] < 0 else (0.0, None),
             "rsi": (max(0, state["rsi"] - 10), min(100, state["rsi"] + 10)),
             "ret10": (max(-0.05, state["ret10"] - 0.05), state["ret10"] + 0.05)}
    analog = lp.matched_analog(base, rules)
    if len(analog) < 8:  # widen the RSI band rather than report a 3-sample answer
        rules["rsi"] = (40, 70)
        analog = lp.matched_analog(base, rules)

    decay = lp.rsi_peak_decay(base)

    # ---------- market-implied leg (Upstox option chains) ----------
    chains = []
    token = None
    if not args.no_chain:
        token = fmd.api_token()
        for iid, underlying in fmd.CHAIN_UNDERLYINGS.items():
            if iid not in idx_px:
                continue
            expiries = fmd.option_expiries(underlying, token)
            cands = [e for e in expiries if e >= args.target]
            if not cands:
                continue
            expiry = cands[0]
            chain = fmd.option_chain(underlying, expiry, token)
            if not chain:
                continue
            view = fmd.chain_view(chain)
            if view:
                chains.append(view)

    # ---------- probability models ----------
    sig252 = float(r_sym.tail(252).std() * np.sqrt(252))
    sig60 = float(r_sym.tail(60).std() * np.sqrt(252))

    models: dict[str, np.ndarray] = {}
    models["V1 bootstrap 2Y"] = lp.mc_bootstrap(r_sym.values, spot, H, 300_000, rng)
    models["V2 bootstrap 60d"] = lp.mc_bootstrap(r_sym.tail(60).values, spot, H, 300_000, rng)
    models["V3 lognormal (realised vol, zero drift)"] = lp.mc_lognormal(spot, H, sig252, 0.0, 300_000, rng)
    models["V4 lognormal (risk-neutral drift)"] = lp.mc_lognormal(
        spot, H, sig252, 0.055 - 0.03, 300_000, rng)

    # market-implied leg: regress the symbol on the indices that have chains
    if chains:
        chain_ids = [c.underlying for c in chains]
        use_ids = [i for i in chain_ids if i in idx_px]
        if len(use_ids) >= 1:
            betas, mkt_sigs, sigs, corrs = [], [], [], []
            for iid in use_ids:
                r_idx = idx_px[iid]["close"].pct_change().dropna()
                df_ = pd.concat([r_sym, r_idx], axis=1, sort=True).dropna().tail(252)
                betas.append(df_.iloc[:, 0].cov(df_.iloc[:, 1]) / df_.iloc[:, 1].var())
                sigs.append(float(r_idx.tail(252).std() * np.sqrt(252)))
                corrs.append(df_.corr().iloc[0, 1])
            for iid in use_ids:
                cv = next(c for c in chains if c.underlying == iid)
                mkt_sigs.append(cv.sigma)
            hist_corr = np.eye(len(use_ids))
            for a in range(len(use_ids)):
                for b in range(len(use_ids)):
                    if a != b:
                        ra = idx_px[use_ids[a]]["close"].pct_change().dropna()
                        rb = idx_px[use_ids[b]]["close"].pct_change().dropna()
                        hist_corr[a, b] = float(pd.concat([ra, rb], axis=1, sort=True).dropna().corr().iloc[0, 1])
            var_resid = max(sig252 ** 2 - sum((b ** 2) * (s ** 2) for b, s in zip(betas, sigs)), 1e-8)
            models["V5 market-implied (option chains)"] = lp.mc_market_implied(
                spot, H, betas, mkt_sigs, float(np.sqrt(var_resid)), hist_corr, 300_000, rng)

    vol_term = np.concatenate(list(models.values()))

    mom_models = {}
    if len(analog) >= 5:
        mu_analog = float(analog.median())
        mom_models["M1 drift-shifted lognormal"] = lp.mc_lognormal(spot, H, sig252, mu_analog, 300_000, rng)
        mom_models["M2 empirical analog bootstrap"] = spot * (1 + rng.choice(np.asarray(analog.values), size=(300_000,)))
        mom_models["M3 low-vol variant"] = lp.mc_lognormal(spot, H, sig60, mu_analog * 0.8, 300_000, rng)
    mom_term = np.concatenate(list(mom_models.values())) if mom_models else vol_term
    blend = np.concatenate([mom_term, vol_term])

    def buckets_for(sp: float) -> list[tuple[float, float, str]]:
        step = round(sp * 0.02, 1)
        return [(0, sp - 2 * step, f"<{sp - 2 * step:.0f}"),
                (sp - 2 * step, sp - step, f"{sp - 2 * step:.0f}-{sp - step:.0f}"),
                (sp - step, sp, f"{sp - step:.0f}-{sp:.0f}"),
                (sp, sp + step, f"{sp:.0f}-{sp + step:.0f}"),
                (sp + step, sp + 2 * step, f"{sp + step:.0f}-{sp + 2 * step:.0f}"),
                (sp + 2 * step, sp + 3 * step, f"{sp + 2 * step:.0f}-{sp + 3 * step:.0f}"),
                (sp + 3 * step, 1e9, f">{sp + 3 * step:.0f}")]

    bk = buckets_for(spot)
    tbl_vol = lp.bucket_table(vol_term, bk)
    tbl_mom = lp.bucket_table(mom_term, bk)
    tbl_blend = lp.bucket_table(blend, bk)

    levels = [spot * 0.92, spot * 0.95, spot * 0.98, state["dma50"], state["dma200"],
              spot * 1.05, spot * 1.10]
    levels = sorted({round(float(x), 2) for x in levels if x and x > 0})
    kl_vol = lp.key_levels(vol_term, levels, spot)
    kl_blend = lp.key_levels(blend, levels, spot)

    # ---------- valuation snapshot (yfinance, optional) ----------
    valuation = None
    if not args.no_yf:
        try:
            import yfinance as yf
            info = yf.Ticker(f"{symbol}.NS").info
            valuation = {k: info.get(k) for k in
                         ("trailingPE", "forwardPE", "priceToBook", "dividendYield",
                          "returnOnEquity", "marketCap", "trailingEps", "beta")}
        except Exception:
            valuation = None

    # ---------- write report ----------
    out_dir = Path(args.out) if args.out else REPO_ROOT / "reports" / "position_probability" / symbol
    report = render_report(symbol, spot, last_session, args.target, H, state, corr_rows,
                           legs, dd_rows, cond_rows, analog, rules, decay, chains,
                           models, tbl_vol, tbl_mom, tbl_blend, kl_vol, kl_blend,
                           lp.summarise(vol_term), lp.summarise(mom_term),
                           lp.summarise(blend), valuation, sig252, sig60)

    if not args.print_only:
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"position_probability_{args.target}.md").write_text(report)
        px.to_csv(out_dir / f"{symbol}_daily_upstox.csv")
        for iid, d in idx_px.items():
            d.to_csv(out_dir / f"{iid}_daily_upstox.csv")
    print(report)
    return 0


def render_report(symbol, spot, last_session, target, H, state, corr_rows, legs, dd_rows,
                  cond_rows, analog, rules, decay, chains, models, tbl_vol, tbl_mom,
                  tbl_blend, kl_vol, kl_blend, s_vol, s_mom, s_blend, valuation,
                  sig252, sig60) -> str:
    L = []
    A = L.append
    A(f"# {symbol} — probabilistic pre-position brief")
    A("")
    A(f"*Generated from Upstox data on {last_session} (close ₹{spot:,.2f}) for a "
      f"target close on **{target}** — {H} trading sessions.*")
    A("")
    A("## 1. Where the stock is")
    A("")
    A(md_table([{
        "price": f"₹{spot:,.2f}", "rsi": f"{state['rsi']:.1f}",
        "m10": pct(state["ret10"]), "m20": pct(state["ret20"]), "m60": pct(state["ret60"]),
        "d200": pct(state["d200"]), "slope": pct(state["slope200"]),
        "volr": f"{state['volr']:.1f}x", "vol": f"{sig252 * 100:.0f}%",
        "trend": f"{state['trend']} / 200-DMA {state['slope']}",
        "pos52": f"{state['pos52'] * 100:.0f}%",
    }], ["price", "rsi", "m10", "m20", "m60", "d200", "slope", "volr", "vol", "trend", "pos52"],
        ["Close", "RSI14", "10d", "20d", "60d", "vs 200DMA", "200DMA slope(20d)",
         "vol ratio", "vol (ann)", "trend", "52w pos"]))
    A("")
    if state["counter_trend"]:
        A(f"> **Counter-trend**: price is {abs(state['d200']) * 100:.1f}% below a "
          f"{state['slope']} 200-DMA. Momentum is real but the trend is not repaired; "
          f"reclaiming ₹{state['dma200']:,.2f} is the trigger that flips the setup.")
        A("")
    A("## 2. Correlation / beta vs indices")
    A("")
    A(md_table(corr_rows, ["index", "b60", "c60", "b252", "c252"],
               ["Index", "beta 60d", "corr 60d", "beta 252d", "corr 252d"],
               {"b60": lambda v, r: f"{v:.2f}" if v is not None else "",
                "c60": lambda v, r: f"{v:+.2f}" if v is not None else "",
                "b252": lambda v, r: f"{v:.2f}" if v is not None else "",
                "c252": lambda v, r: f"{v:+.2f}" if v is not None else ""}))
    A("")
    A("## 3. Cycle structure")
    A("")
    A(md_table([{"type": l["type"], "start": str(l["start"].date()), "end": str(l["end"].date()),
                 "from": f"{l['from']:,.2f}", "to": f"{l['to']:,.2f}", "pct": pct(l["pct"] / 100),
                 "days": l["days"]} for l in legs],
               ["type", "start", "end", "from", "to", "pct", "days"],
               ["Leg", "From", "To", "From ₹", "To ₹", "Move", "Days"]))
    A("")
    A(f"Forward returns after a ≥30% drawdown trough:")
    A("")
    A(md_table(dd_rows, ["date", "price", "dd", "3m", "6m", "12m"],
               ["Trough", "Price", "Drawdown", "+3M", "+6M", "+12M"]))
    A("")
    A("## 4. Conditional behaviour (momentum / trend)")
    A("")
    A(md_table(cond_rows, ["set", "n_ep", "mean", "median", "p_up", "p_up10", "p_dn5", "n_pool"],
               ["State", "Episodes", "Mean", "Median", "P(up)", "P(+10%)", "P(-5%)", "Pooled days"]))
    A("")
    if decay:
        A("**Momentum decay** — forward return by sessions since a 21-session RSI peak:")
        A("")
        A(md_table(decay, ["bin", "n", "median", "p_up", "p_up10", "p_dn5"],
                   ["Sessions since RSI peak", "n", "Median fwd", "P(up)", "P(+10%)", "P(-5%)"],
                   {"median": lambda v, r: pct(v), "p_up": lambda v, r: f"{v * 100:.0f}%",
                    "p_up10": lambda v, r: f"{v * 100:.0f}%", "p_dn5": lambda v, r: f"{v * 100:.0f}%"}))
        A("")
    if len(analog):
        A(f"**Matched-state analog** (current state mirrored, n={len(analog)} days): "
          f"mean {pct(analog.mean())}, median {pct(analog.median())}, "
          f"P(up) {(analog > 0).mean() * 100:.0f}%, "
          f"P(+10%) {(analog > 0.10).mean() * 100:.0f}%, "
          f"P(-5%) {(analog < -0.05).mean() * 100:.0f}%")
        A("")
        A(f"Rules used: `{rules}`")
        A("")
    A("## 5. Market-implied (Upstox option chains)")
    A("")
    if chains:
        A(md_table([{"u": c.underlying, "exp": c.expiry, "spot": f"{c.spot:,.1f}",
                     "iv": f"{c.atm_iv:.2f}%", "strad": f"{c.atm_straddle:,.1f}",
                     "sig": f"{c.sigma * 100:.2f}%", "pain": f"{c.max_pain:,.0f}",
                     "pcr": f"{c.pcr:.2f}", "skew": f"{c.put_skew:+.2f}"} for c in chains],
                   ["u", "exp", "spot", "iv", "strad", "sig", "pain", "pcr", "skew"],
                   ["Underlying", "Expiry", "Spot", "ATM IV", "ATM straddle", "1σ move",
                    "Max pain", "PCR", "put−call IV"]))
        A("")
        A("> The API's `expected_move` field is a 0.61×straddle convention, **not** a 1σ move. "
          "The `1σ move` column above is derived from the ATM straddle (÷0.7979÷spot).")
        A("")
    else:
        A("_No chain available (API down, or `--no-chain`). Market-implied leg skipped._")
        A("")
    A("## 6. Probability of the close on the target date")
    A("")
    A(md_table([{"b": a["bucket"], "v": f"{a['p'] * 100:.1f}%",
                 "m": f"{b['p'] * 100:.1f}%", "bl": f"{c['p'] * 100:.1f}%"}
                for a, b, c in zip(tbl_vol, tbl_mom, tbl_blend)],
               ["b", "v", "m", "bl"],
               ["Bucket", "Vol-only + market-implied", "Momentum/trend-adjusted", "Blended 50/50"]))
    A("")
    A(md_table([{"lv": f"{r['level']:,.2f}", "side": r["side"],
                 "v": f"{r2['p'] * 100:.1f}%", "bl": f"{r3['p'] * 100:.1f}%"}
                for r, r2, r3 in zip(kl_vol, kl_vol, kl_blend)],
               ["lv", "side", "v", "bl"],
               ["Level", "Side", "Vol-only", "Blended"]))
    A("")
    A(md_table([{"k": "vol-only", **{k: f"{v:,.2f}" for k, v in s_vol.items()}},
                {"k": "momentum-adjusted", **{k: f"{v:,.2f}" for k, v in s_mom.items()}},
                {"k": "blended", **{k: f"{v:,.2f}" for k, v in s_blend.items()}}],
               ["k", "median", "p10", "p25", "p75", "p90", "mean", "sd"],
               ["Ensemble", "Median", "p10", "p25", "p75", "p90", "Mean", "SD"]))
    A("")
    if valuation:
        A("## 7. Valuation snapshot (yfinance)")
        A("")
        A(md_table([{k: (f"{v:,.2f}" if isinstance(v, float) else v)
                     for k, v in valuation.items()}],
                   list(valuation.keys()), [k.replace("trailing", "trailing ") for k in valuation]))
        A("")
    A("## How to read this brief")
    A("")
    A("- **Vol-only / market-implied** answers: *where could it be?* It assumes no edge from "
      "the current tape and uses the option market's own implied range.")
    A("- **Momentum/trend-adjusted** answers: *what does this specific setup usually do next?* "
      "It re-weights the distribution using the matched-state analog and the RSI-peak decay.")
    A("- **Blended** is the number to act on when the two disagree by more than ~5pp.")
    A("- Act on the **asymmetry**: compare the probability of reaching your target against "
      "the probability of the invalidation level, not the median.")
    A("- The distribution answers *where*, never *whether*. Sizing and stop placement stay a "
      "separate decision.")
    A("")
    A("## Provenance & caveats")
    A("")
    A("- Prices/volume: Upstox V3 daily + 1-minute intraday (current session appended manually "
      "— the daily endpoint omits today).")
    A("- Option chains: local `/api/options/chain` (Upstox-native NSE_FO keys) via a QA token.")
    A("- Analog samples are small (n in the tables). Episode counts are the honest sample; "
      "pooled overlapping days flatter the signal.")
    A("- The next session's own market data will invalidate every number here; this brief is a "
      "pre-position snapshot, not a forecast.")
    return "\n".join(L)


if __name__ == "__main__":
    raise SystemExit(main())
