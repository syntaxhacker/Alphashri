"""Week-long live-trading *replay* of the paper strategies on recorded prints.

This is a **simulation on real recorded prices** — not a live result and not a
backtest of an edge. It picks one week from the recorded 1-minute option panel,
runs every strategy through the same no-lookahead engine the paper account uses
(:mod:`options_paper.strategies`), attaches greeks and a P&L attribution to
every trade, and emits one self-contained HTML screen.

Honesty notes (identical rules to the research programme)
---------------------------------------------------------
* Signal on the close of a completed bar, fill at the **next** bar's premium.
* No profit exit on the fill bar; stop checked before target.
* No overnight carry; every position flattens at the strategy's EOD cut.
* Every premium is a recorded print; missing prints drop the minute, never
  interpolate.
* The **expiry payoff diagram is shown gross of costs** and assumes a hold to
  expiry, which the strategies do *not* do — it is a picture of the structure,
  clearly labelled, not the realised result.
* OI walls / PCR / dealer gamma are **unavailable** for the 2026 panel (its
  ``oi`` column is empty), so the OI-wall strategy cannot signal here. That is
  reported as a gap, not hidden.
"""

from __future__ import annotations

import json
import random
from dataclasses import dataclass, field
from datetime import date as _date, datetime
from functools import lru_cache
from pathlib import Path

from . import greeks as _gr
from . import panel, spec
from .strategies import REGISTRY, STRATEGY_LABELS, Trade, build
from .tape import Tick

REPORT_DIR = Path(__file__).resolve().parent.parent / "reports" / "OPTIONS_PAPER_SIM"

# Wall-bounce needs OI, which the 2026 panel does not carry.
PANEL_SKIP = {"stock_momentum"}          # needs a live broker chain
PANEL_DEGRADED = {"nifty_wall_bounce"}   # no OI -> cannot signal from this panel

# Scope: intraday **naked buying** = one long leg, no hedge, no overnight.
# The short-straddle control is a premium *seller* and is excluded from it.
NAKED_BUYERS = ("nifty_momentum", "nifty_gap", "nifty_wall_bounce",
                "nifty_iv_delta", "nifty_open_straddle", "nifty_spot_scalp")
SELLERS = ("nifty_vrp",)


# --------------------------------------------------------------------------
# Session discovery
# --------------------------------------------------------------------------
@lru_cache(maxsize=1)
def _day_open_map() -> dict:
    """``{date: first index close of the day}`` — avoids per-session frame masks."""
    idx = panel._index_all()
    g = idx.groupby(idx.index.date)["close"].first()
    return {k: float(v) for k, v in g.items()}


def _atm_available(day: _date) -> bool:
    """Does a real ATM CE+PE contract exist for the day's opening strike?"""
    exp = panel.nearest_expiry(day)
    if exp is None:
        return False
    px = _day_open_map().get(day)
    if not px:
        return False
    atm = int(round(px / 50) * 50)
    ci = panel.contract_index()
    return (exp, atm, "CE") in ci and (exp, atm, "PE") in ci


def _panel_dates() -> list:
    """Dates the option panel actually carries ATM data for.

    The index 1-minute series reaches back to 2017, but the *option* contracts
    only exist from 2026-05 — ``iv_atm_30m.parquet`` (real recorded ATM vol) is
    the honest window, so we take the intersection.
    """
    import pandas as pd
    p = panel.REPO_ROOT / "experiments" / "data" / "nifty_options" / "iv_atm_30m.parquet"
    if not p.exists():
        return []
    iv = pd.read_parquet(p, columns=["date"])
    return sorted({d for d in pd.to_datetime(iv["date"]).dt.date})


@lru_cache(maxsize=1)
def candidate_sessions() -> tuple:
    """Sessions the panel can actually price an ATM contract for."""
    have = set(_panel_dates())
    return tuple(d for d in panel.sessions()
                 if d in have and _atm_available(d))


def _dte(day: _date) -> int:
    """Days to the nearest expiry the panel actually has contracts for."""
    e = panel.nearest_expiry(day)
    return (e - day).days if e else 9999


def choose_week(seed: int | None = None, min_sessions: int = 4,
                max_dte: int | None = None) -> list:
    """A random week with at least ``min_sessions`` priced days.

    ``max_dte`` filters to sessions whose nearest *available* contract is within
    that many days — important because the panel only holds contracts that were
    still listed on the fetch date, so early sessions can only trade a
    30–140 DTE monthly rather than a front weekly.
    """
    weeks: dict = {}
    for d in candidate_sessions():
        if max_dte is not None and max_dte > 0 and _dte(d) > max_dte:
            continue
        iso = d.isocalendar()
        weeks.setdefault((iso[0], iso[1]), []).append(d)
    good = [sorted(v) for _k, v in sorted(weeks.items()) if len(v) >= min_sessions]
    if not good:
        raise RuntimeError("no week with enough priced sessions in the panel")
    return random.Random(seed).choice(good)


def week_of(day, max_dte: int | None = None) -> list:
    """The priced sessions in the ISO week containing ``day``."""
    d = day if isinstance(day, _date) else _date.fromisoformat(str(day))
    iso = d.isocalendar()
    return [x for x in candidate_sessions()
            if x.isocalendar()[:2] == iso[:2]
            and (not max_dte or max_dte <= 0 or _dte(x) <= max_dte)]


# --------------------------------------------------------------------------
# A day
# --------------------------------------------------------------------------
@dataclass
class DayRun:
    date: str
    expiry: str
    dte: int
    coverage_pct: float
    spot_open: float
    spot_close: float
    spot_lo: float
    spot_hi: float
    ticks: list[Tick] = field(default_factory=list)
    trades: list[Trade] = field(default_factory=list)


def run_day(day, strategies: list[str] | None = None, lots: int = 1) -> DayRun | None:
    ticks = panel.build_ticks(day)
    if len(ticks) < 3:
        return None
    d = day if isinstance(day, _date) else _date.fromisoformat(str(day))
    expiry = ticks[0].expiry
    dte = (_date.fromisoformat(expiry) - d).days
    idx = panel._index_all()
    day_idx = idx[idx.index.date == d]
    ctx = {"prev_close": panel.prev_session_close(d)}
    names = strategies if strategies is not None else list(REGISTRY)
    trades: list[Trade] = []
    for name in names:
        if name in PANEL_SKIP:
            continue
        strat = build(name, lots=lots)
        trades.extend(strat.run(list(ticks), dict(ctx)))
    trades.sort(key=lambda t: t.exit_time)
    return DayRun(
        date=d.isoformat(), expiry=expiry, dte=dte,
        coverage_pct=round(100 * len(ticks) / max(len(day_idx), 1), 1),
        spot_open=round(float(day_idx["close"].iloc[0]), 2),
        spot_close=round(float(day_idx["close"].iloc[-1]), 2),
        spot_lo=round(float(day_idx["close"].min()), 2),
        spot_hi=round(float(day_idx["close"].max()), 2),
        ticks=ticks, trades=trades,
    )


def run_week(days: list, strategies: list[str] | None = None,
             lots: int = 1) -> list[DayRun]:
    out: list[DayRun] = []
    for day in days:
        r = run_day(day, strategies=strategies, lots=lots)
        if r:
            out.append(r)
    return out


# --------------------------------------------------------------------------
# Greeks per trade, reconstructed from the real minute ticks
# --------------------------------------------------------------------------
def _tick_at(ticks: list[Tick], iso: str) -> Tick | None:
    want = datetime.fromisoformat(iso)
    return next((t for t in ticks if t.t == want), None)


def _tick_px(tk: Tick, strike: float, opt: str) -> float:
    """Premium of ``strike``/``opt`` at this tick (chain-aware, ATM fallback)."""
    row = tk.chain.get(int(strike)) if tk.chain else None
    if row:
        v = row[0] if opt == "CE" else row[1]
        if v and v > 0:
            return float(v)
    return tk.ce_ltp if opt == "CE" else tk.pe_ltp


def _legs(opt: str) -> list[str]:
    return ["CE", "PE"] if opt == "STRADDLE" else [opt]


def trade_greeks(tr: Trade, ticks: list[Tick]) -> dict:
    """Entry/exit greeks + a Taylor P&L attribution, summed over the legs."""
    te, tx = _tick_at(ticks, tr.entry_time), _tick_at(ticks, tr.exit_time)
    blank = {"entry_delta": 0.0, "entry_gamma": 0.0, "entry_theta": 0.0,
             "entry_vega": 0.0, "entry_iv": 0.0, "delta_pnl": 0.0,
             "gamma_pnl": 0.0, "theta_pnl": 0.0, "vega_pnl": 0.0,
             "residual": 0.0, "attrib_actual": 0.0}
    if te is None or tx is None or tr.strike <= 0:
        return blank
    short = tr.direction == "SHORT"
    k = float(tr.strike)
    out = dict(blank)
    for leg in _legs(tr.opt):
        p_e = _tick_px(te, k, leg)
        p_x = _tick_px(tx, k, leg)
        iv_e = te.ce_iv if leg == "CE" else te.pe_iv
        iv_x = tx.ce_iv if leg == "CE" else tx.pe_iv
        t_e = panel._t_years(te.t, _date.fromisoformat(tr.expiry))
        t_x = panel._t_years(tx.t, _date.fromisoformat(tr.expiry))
        fwd_e = _gr.implied_forward(te.atm_strike, te.ce_ltp, te.pe_ltp, t_e) or te.spot
        if p_e <= 0 or p_x <= 0:
            continue
        a = _gr.attribute(p_e, p_x, te.spot, tx.spot, iv_e, iv_x, fwd_e, k,
                          t_e, t_x, leg, tr.hold_min, short=short)
        if a is None:
            continue
        g = a.g_entry
        sgn = -1.0 if short else 1.0
        out["entry_delta"] += sgn * g.delta
        out["entry_gamma"] += sgn * g.gamma
        out["entry_theta"] += sgn * g.theta
        out["entry_vega"] += sgn * g.vega
        out["entry_iv"] = max(out["entry_iv"], g.iv)
        for key in ("delta_pnl", "gamma_pnl", "theta_pnl", "vega_pnl"):
            out[key] += getattr(a, key)
        out["residual"] += a.residual
        out["attrib_actual"] += a.actual
    return out


# --------------------------------------------------------------------------
# Per-trade visual: real 1-minute NIFTY candles + the option's own premium path
# --------------------------------------------------------------------------
def _window(times: list, a: datetime, b: datetime, pad: int = 10,
            cap: int = 220) -> tuple:
    """Index range [lo, hi] around a trade, with context, capped in length."""
    tz = times[0].tzinfo if times else None

    def norm(x: datetime) -> datetime:
        if x.tzinfo is None and tz is not None:
            return x.replace(tzinfo=tz)
        if x.tzinfo is not None and tz is None:
            return x.replace(tzinfo=None)
        return x

    a, b = norm(a), norm(b)
    try:
        i0, i1 = times.index(a), times.index(b)
    except ValueError:
        def nearest(x):
            return min(range(len(times)),
                       key=lambda i: abs((times[i] - x).total_seconds()))
        i0, i1 = nearest(a), nearest(b)
    lo, hi = max(0, i0 - pad), min(len(times) - 1, i1 + pad)
    while hi - lo > cap and (i0 - lo) + (hi - i1) > 2:
        if i1 - i0 < cap:
            if (i0 - lo) >= (hi - i1):
                lo += 1
            else:
                hi -= 1
        else:
            break
    return lo, hi, i0, i1


def _leg_series(tr: Trade, day: _date):
    legs = ["CE", "PE"] if tr.opt == "STRADDLE" else [tr.opt]
    out = []
    for leg in legs:
        s = panel.contract_close(tr.expiry, int(tr.strike), leg)
        if s is None or s.empty:
            continue
        s = s[s.index.date == day]
        if not s.empty:
            out.append(s)
    return out


def _trade_chart(tr: Trade, day: _date) -> dict | None:
    """Candles + premium path + entry/exit marks + stop/target for one trade."""
    df = panel.index_day(day)
    if df.empty or tr.strike <= 0:
        return None
    times = list(df.index)
    a = datetime.fromisoformat(tr.entry_time)
    b = datetime.fromisoformat(tr.exit_time)
    lo, hi, i0, i1 = _window(times, a, b)
    if hi <= lo:
        return None
    sub = df.iloc[lo:hi + 1]
    prem_legs = _leg_series(tr, day)

    candles, prem, tlabels = [], [], []
    for ts, r in sub.iterrows():
        candles.append([round(float(r["open"]), 2), round(float(r["high"]), 2),
                        round(float(r["low"]), 2), round(float(r["close"]), 2)])
        tlabels.append(ts.isoformat())
        tot, ok = 0.0, bool(prem_legs)
        for s in prem_legs:
            v = s.get(ts)
            if v is None or v != v:
                ok = False
                break
            tot += float(v)
        prem.append(round(tot, 2) if ok else None)

    entry_i, exit_i = i0 - lo, i1 - lo
    seg = [p for p in prem[entry_i:exit_i + 1] if p is not None]
    base = tr.entry_premium
    mae = (min(seg) - base) if seg else 0.0
    mfe = (max(seg) - base) if seg else 0.0
    if tr.direction == "SHORT":
        mae, mfe = -mfe, -mae            # short profits when premium falls
    if tr.sl_pct > 0:
        sl_prem = base * (1 - tr.sl_pct) if tr.direction == "LONG" else base * (1 + tr.sl_pct)
        tp_prem = base * (1 + tr.tp_pct) if tr.direction == "LONG" else base * (1 - tr.tp_pct)
    else:
        sl_prem = tp_prem = 0.0

    grid = _spot_grid(float(tr.strike))
    payoff = {"grid": grid,
              "pnl": [round(x, 2) for x in structure_pnl(
                  tr.opt, tr.direction, tr.strike, base, tr.qty, grid)],
              "strike": float(tr.strike), "premium": round(base, 2)}

    return {
        "times": tlabels, "candles": candles, "prem": prem,
        "payoff": payoff,
        "entry_i": entry_i, "exit_i": exit_i, "strike": float(tr.strike),
        "entry_premium": round(base, 2), "exit_premium": round(tr.exit_premium, 2),
        "sl_prem": round(sl_prem, 2), "tp_prem": round(tp_prem, 2),
        "sl_pct": tr.sl_pct, "tp_pct": tr.tp_pct,
        "mae_pts": round(mae, 2), "mfe_pts": round(mfe, 2),
        "direction": tr.direction, "opt": tr.opt, "reason": tr.reason,
        "exit_reason": tr.exit_reason, "entry_spot": tr.entry_spot,
        "exit_spot": tr.exit_spot, "net_pnl": tr.net_pnl, "points": tr.points,
        "strategy": tr.strategy, "symbol": tr.symbol, "hold_min": tr.hold_min,
    }


# --------------------------------------------------------------------------
# Screen payload
# --------------------------------------------------------------------------
def _spot_grid(strike: float, pct: float = 0.03, step: int = 50) -> list:
    lo, hi = int(strike * (1 - pct)), int(strike * (1 + pct))
    return list(range(lo - lo % step, hi + step, step))


def structure_pnl(opt: str, direction: str, strike: float, premium: float,
                  qty: int, grid: list) -> list:
    """Expiry P&L (₹, gross of costs) of one structure over ``grid``.

    ``premium`` is the combined premium for a straddle. Long by default;
    ``direction == "SHORT"`` flips it.
    """
    k = float(strike)
    if opt == "STRADDLE":
        base = [(abs(s - k) - premium) * qty for s in grid]   # long straddle
    elif opt == "CE":
        base = [(max(s - k, 0.0) - premium) * qty for s in grid]
    else:  # PE
        base = [(max(k - s, 0.0) - premium) * qty for s in grid]
    return base if direction != "SHORT" else [-x for x in base]


def _payoff_lines(runs: list[DayRun], step: int = 50) -> dict:
    """Expiry payoff (₹, gross of costs) of each strategy's first structure."""
    first: dict = {}
    for r in runs:
        for tr in r.trades:
            first.setdefault(tr.strategy, tr)
    if not first:
        return {"expiries": []}
    strikes = [t.strike for t in first.values() if t.strike > 0]
    if not strikes:
        return {"expiries": []}
    grid = _spot_grid((min(strikes) + max(strikes)) / 2.0,
                      pct=max(0.03, (max(strikes) - min(strikes)) / max(min(strikes), 1) + 0.03),
                      step=step)
    lines = []
    for name, tr in first.items():
        pnl = structure_pnl(tr.opt, tr.direction, tr.strike, tr.entry_premium,
                            tr.qty, grid)
        lines.append({
            "strategy": name, "opt": tr.opt, "direction": tr.direction,
            "strike": float(tr.strike), "premium": round(tr.entry_premium, 2),
            "lots": tr.lots, "qty": tr.qty, "expiry": tr.expiry,
            "entry_spot": round(tr.entry_spot, 2),
            "pnl": [round(x, 2) for x in pnl],
        })
    return {"expiries": [{
        "label": f"expiry {runs[0].expiry} (DTE {runs[0].dte} at week start)",
        "spot_grid": grid, "lines": lines,
    }]}


def build_screen(runs: list[DayRun], lots: int = 1,
                 generated_at: str | None = None, scope: str = "") -> dict:
    all_trades = [tr for r in runs for tr in r.trades]
    ticks_by_day = {r.date: r.ticks for r in runs}

    rows = []
    charts = []
    for tr in all_trades:
        day = _date.fromisoformat(tr.entry_time[:10])
        g = trade_greeks(tr, ticks_by_day.get(tr.entry_time[:10], []))
        row = tr.as_row()
        row.update(g)
        rows.append(row)
        ch = _trade_chart(tr, day)
        if ch:
            charts.append(ch)

    net = sum(t.net_pnl for t in all_trades)
    gross = sum(t.gross_pnl for t in all_trades)
    costs = sum(t.costs for t in all_trades)
    wins = [t for t in all_trades if t.net_pnl > 0]
    losses = [t for t in all_trades if t.net_pnl < 0]

    by_strat: dict = {}
    for t in all_trades:
        s = by_strat.setdefault(t.strategy, {
            "strategy": t.strategy, "label": STRATEGY_LABELS.get(t.strategy, t.strategy),
            "net_pnl": 0.0, "gross_pnl": 0.0, "costs": 0.0, "n_trades": 0,
            "net_points": 0.0, "n_win": 0, "n_loss": 0})
        s["net_pnl"] += t.net_pnl
        s["gross_pnl"] += t.gross_pnl
        s["costs"] += t.costs
        s["net_points"] += t.points
        s["n_trades"] += 1
        s["n_win"] += 1 if t.net_pnl > 0 else 0
        s["n_loss"] += 1 if t.net_pnl < 0 else 0
    for s in by_strat.values():
        s["win_rate"] = round(s["n_win"] / s["n_trades"], 3) if s["n_trades"] else 0.0
        for kk in ("net_pnl", "gross_pnl", "costs", "net_points"):
            s[kk] = round(s[kk], 2)

    equity, cum = [], 0.0
    for t in sorted(all_trades, key=lambda x: x.exit_time):
        cum += t.net_pnl
        equity.append({"t": t.exit_time, "day": t.exit_time[:10],
                       "net": round(t.net_pnl, 2), "cum_net": round(cum, 2)})

    attrib: dict = {}
    for row in rows:
        s = attrib.setdefault(row["strategy"], {
            "strategy": row["strategy"], "opt": row["opt"], "delta_pnl": 0.0,
            "gamma_pnl": 0.0, "theta_pnl": 0.0, "vega_pnl": 0.0,
            "explained": 0.0, "actual": 0.0, "residual": 0.0})
        for kk in ("delta_pnl", "gamma_pnl", "theta_pnl", "vega_pnl", "residual"):
            s[kk] += row.get(kk, 0.0)
        s["actual"] += row.get("attrib_actual", 0.0)
        s["explained"] = (s["delta_pnl"] + s["gamma_pnl"]
                          + s["theta_pnl"] + s["vega_pnl"])
    for s in attrib.values():
        for kk in ("delta_pnl", "gamma_pnl", "theta_pnl", "vega_pnl",
                   "explained", "actual", "residual"):
            s[kk] = round(s[kk], 4)

    greeks_series = []
    for r in runs:
        for tr in r.trades:
            te = _tick_at(r.ticks, tr.entry_time)
            if te is None:
                continue
            g = trade_greeks(tr, r.ticks)
            greeks_series.append({
                "t": tr.entry_time, "day": r.date, "spot": round(te.spot, 2),
                "delta": round(g["entry_delta"], 4),
                "gamma": round(g["entry_gamma"], 6),
                "theta": round(g["entry_theta"], 4),
                "vega": round(g["entry_vega"], 4),
            })
    greeks_series.sort(key=lambda x: x["t"])

    days = [{"date": r.date, "n_trades": len(r.trades),
             "net_pnl": round(sum(t.net_pnl for t in r.trades), 2),
             "expiry": r.expiry, "dte": r.dte, "coverage_pct": r.coverage_pct,
             "spot_open": r.spot_open, "spot_close": r.spot_close,
             "spot_range": [r.spot_lo, r.spot_hi]} for r in runs]

    week = [r.date for r in runs]
    caveats = [
        "This is a replay of recorded 1-minute option prints on a single random week — it is a demonstration, not a backtest of an edge, and not advice.",
        "No lookahead: a signal is taken on the close of a completed bar and filled at the next bar's recorded premium.",
        "No profit exit on the fill bar, and the stop is checked before the target on every bar.",
        "No overnight carry: every position flattens at the strategy's end-of-day cut.",
        "Costs are the real Upstox 2026 schedule (₹20/order, 0.15% STT on the sell premium, NSE txn, SEBI, IPFT, stamp, 18% GST).",
        "The expiry payoff diagram is shown gross of costs and assumes a hold to expiry; the strategies exit intraday, so it depicts structure, not the realised result.",
        "Greeks use Black-76 on the parity-implied forward, a flat 6.5% rate, calendar time floored at 15 minutes; the ATM implied vol is used as the leg's IV proxy.",
        "The 2026 1-minute panel carries no open interest (it was fetched without it), so OI walls / PCR / dealer gamma are unavailable and the OI-wall strategy cannot signal on these sessions.",
        "The panel holds only contracts that were still listed on the fetch date (2026-09-26) — FYERS did not serve expired contracts — so the nearest available expiry is used and early sessions cannot trade a front weekly. Sessions are filtered to those within --max-dte days of that expiry.",
    ]
    if any(r.date in ("2026-10-19",) for r in runs):
        caveats.append("Weekly expiry: NIFTY weeklies shift when a holiday falls on the expiry day.")

    return {
        "meta": {
            "title": "Options paper — live-simulation replay",
            "week": week, "generated_at": generated_at or datetime.now().isoformat(timespec="seconds"),
            "capital": 2_500_000, "lots": lots, "lot_size": spec.get_lot("NIFTY"),
            "risk_free": _gr.RISK_FREE, "expiry": runs[0].expiry if runs else "",
            "dte": runs[0].dte if runs else 0,
            "source": "FYERS 1-minute option candles (real traded prints) + recorded NIFTY index",
            "cost_model": "Upstox 2026 (spec.CHARGES)",
            "note": "Replay of real recorded prices. Paper only. Not advice.",
            "scope": scope or "all strategies",
        },
        "totals": {
            "net_pnl": round(net, 2), "gross_pnl": round(gross, 2),
            "costs": round(costs, 2), "n_trades": len(all_trades),
            "n_win": len(wins), "n_loss": len(losses),
            "win_rate": round(len(wins) / len(all_trades), 3) if all_trades else 0.0,
            "net_points": round(sum(t.points for t in all_trades), 2),
            "cost_drag_pct": round(costs / abs(gross), 3) if gross else 0.0,
            "best": round(max((t.net_pnl for t in all_trades), default=0.0), 2),
            "worst": round(min((t.net_pnl for t in all_trades), default=0.0), 2),
        },
        "by_strategy": sorted(by_strat.values(), key=lambda s: -s["net_pnl"]),
        "equity": equity,
        "payoff": _payoff_lines(runs),
        "greeks_series": greeks_series,
        "attribution": sorted(attrib.values(), key=lambda s: -s["actual"]),
        "trades": rows,
        "charts": charts,
        "days": days,
        "caveats": caveats,
        "skipped_strategies": sorted(PANEL_SKIP | PANEL_DEGRADED),
    }


# --------------------------------------------------------------------------
# Writers
# --------------------------------------------------------------------------
TEMPLATE = Path(__file__).resolve().parent / "screen_template.html"
PLACEHOLDER = "/*__SCREEN_DATA__*/"


def write_screen(screen: dict, outdir: Path | None = None) -> dict:
    week = screen["meta"]["week"]
    outdir = outdir or (REPORT_DIR / f"{week[0]}_{week[-1]}")
    outdir.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(screen, indent=2, sort_keys=False)
    (outdir / "screen_data.json").write_text(payload)
    if TEMPLATE.exists():
        html = TEMPLATE.read_text().replace(PLACEHOLDER, payload)
    else:
        html = _fallback_html(screen)
    (outdir / "index.html").write_text(html)
    return {"dir": str(outdir), "html": str(outdir / "index.html"),
            "data": str(outdir / "screen_data.json"),
            "template": str(TEMPLATE) if TEMPLATE.exists() else None}


def _fallback_html(screen: dict) -> str:
    """Used only if the designed template is missing, so a run is never silent."""
    import html as _h
    t = screen["totals"]
    rows = "".join(
        f"<tr><td>{_h.escape(str(r['label']))}</td><td>{r['n_trades']}</td>"
        f"<td>{r['win_rate']:.0%}</td><td>{r['net_pnl']:,.0f}</td>"
        f"<td>{r['costs']:,.0f}</td></tr>" for r in screen["by_strategy"])
    return (
        "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Options paper sim</title>"
        "<style>body{background:#0D1117;color:#E6EDF3;font-family:system-ui,sans-serif;padding:24px}"
        "table{border-collapse:collapse;font-size:13px}th,td{border:1px solid #30363D;padding:5px 8px}"
        "</style></head><body>"
        f"<h1>Options paper — week {screen['meta']['week'][0]} → {screen['meta']['week'][-1]}</h1>"
        f"<p>Net ₹{t['net_pnl']:,.2f} over {t['n_trades']} trades; costs ₹{t['costs']:,.2f}.</p>"
        f"<table><tr><th>Strategy</th><th>Trades</th><th>Win</th><th>Net ₹</th><th>Costs</th></tr>{rows}</table>"
        "<p><i>Template not found — minimal fallback.</i></p></body></html>")
