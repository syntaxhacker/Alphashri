"""Nifty options-entry EDA — where should we have entered, and why.

Case studies : 2026-10-14 + 2026-10-15 (options tape days, ATM CE/PE LTP).
Context     : same 20 sessions as NIFTY_TIMING (spot diagnostics, deeper cut).
Output      : reports/NIFTY_ENTRY_EDA/ (HTML + figures, never delete, overwrite in place).

Entries are priced on the ROLLING-ATM leg from the tape (atm_ce_ltp / atm_pe_ltp
asof each 5m bar). Caveat: the ATM strike rolls intraday, so the premium series
has small roll jumps; P&L is indicative (no costs / spread / slippage modelled).

Run: .venv/bin/python scripts/research/nifty_entry/build_entry_report.py
"""
import datetime
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))  # repo root for api/ config/ db/

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
import numpy as np
import pandas as pd
import yfinance as yf
from zoneinfo import ZoneInfo

OUT = Path(os.environ.get("NIFTY_ENTRY_OUT", str(Path(__file__).resolve().parents[3]
                                                  / "reports" / "NIFTY_ENTRY_EDA")))
FIG = OUT / "figures"
FIG.mkdir(parents=True, exist_ok=True)
IST = ZoneInfo("Asia/Kolkata")
T = lambda h, m: datetime.time(h, m)

BG, FG, DIM = "#0D1117", "#E6EDF3", "#8B949E"
UP, DN = "#3FB950", "#F85149"
BLUE, YEL, PUR, TEAL = "#58A6FF", "#D29922", "#A371F7", "#39D2C0"
plt.rcParams.update({"figure.facecolor": BG, "axes.facecolor": BG, "text.color": FG,
                     "axes.labelcolor": FG, "xtick.color": DIM, "ytick.color": DIM,
                     "axes.edgecolor": "#30363D", "savefig.facecolor": BG})

CASE_DAYS = ["2026-10-14", "2026-10-15"]
# (index, day, yahoo symbol, fyers chain underlying, expiry ISO, tape?)
# SENSEX has no options tape — day-type gating there is spot-only.
CASES = [
    ("NIFTY", "2026-10-14", "^NSEI", "NSE:NIFTY50-INDEX", None, True),
    ("NIFTY", "2026-10-15", "^NSEI", "NSE:NIFTY50-INDEX", None, True),
    ("SENSEX", "2026-10-15", "^BSESN", "BSE:SENSEX-INDEX", "2026-10-22", False),
]
SENSEX_EXPIRY_NOTE = ("Sensex expired <b>today</b> (Thursday expiry). The 0-DTE legs are already "
                      "purged from Fyers history, so this section prices the next-weekly (22-Oct, 7 DTE) "
                      "ATM legs — the contracts actually tradeable today.")
TAPE = Path("experiments/data/nifty_tape")
STOP_PCT = 0.40          # premium stop: -40% of entry premium
EXIT_HM = (15, 0)        # realized exits marked at 15:00 (or last tape bar)


# ---------------- loaders ----------------
def load_tape(day):
    rows = [json.loads(l) for l in open(TAPE / f"{day}.jsonl")]
    df = pd.DataFrame(rows)
    df["t"] = pd.to_datetime(df["t"]).dt.tz_convert(IST)
    df = df.sort_values("t").reset_index(drop=True)
    # --- corrupt-snapshot filter: drop rows whose spot is far from the
    # local median (e.g. 2026-10-14 12:53-12:54 printed spot 22363, ~360pts
    # below neighbours while yfinance 5m glided smoothly -> bad snapshot).
    s = pd.to_numeric(df["spot"], errors="coerce")
    keep = pd.Series(True, index=df.index)
    for thresh in (0.02, 0.004):
        med = s.where(keep).rolling(5, center=True, min_periods=1).median()
        med = med.ffill().bfill()
        keep = keep & ((s / med - 1).abs() < thresh)
    dropped = int((~keep).sum())
    # also drop rows with zeroed chain fields (partial snapshots, e.g. Oct14
    # 10:08 printed pcr/mp as 0) — they pollute PCR/max-pain/wall strips.
    if "max_pain" in df:
        mp = pd.to_numeric(df["max_pain"], errors="coerce")
        keep = keep & ~(mp.fillna(-1) <= 0)
    if "pcr_oi" in df:
        pc = pd.to_numeric(df["pcr_oi"], errors="coerce")
        keep = keep & ~(pc.fillna(-1) <= 0)
    dropped2 = int((~keep).sum()) - dropped
    if dropped or dropped2:
        bad = df.loc[~keep, "t"].dt.strftime("%H:%M:%S").tolist()
        print(f"{day}: dropped {int((~keep).sum())} corrupt tape rows: {bad}")
        df = df[keep].reset_index(drop=True)
    if "atm_ce_ltp" in df:
        df["straddle"] = pd.to_numeric(df["atm_ce_ltp"], errors="coerce") + \
                         pd.to_numeric(df["atm_pe_ltp"], errors="coerce")
        df["atm_strike"] = pd.to_numeric(df["atm_strike"], errors="coerce")
    return df


def load_spot(days, symbol="^NSEI", pre_days=8):
    start = (pd.Timestamp(days[0]).date() - pd.Timedelta(days=pre_days)).isoformat()
    df = yf.download(symbol, start=start, interval="5m", prepost=False,
                     auto_adjust=False, progress=False)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df.index = pd.to_datetime(df.index).tz_convert(IST)
    df = df.sort_index()
    out = {}
    for d in days:
        D = pd.Timestamp(d).date()
        out[d] = df[df.index.date == D].copy()
    daily = yf.download(symbol, start=start, interval="1d", auto_adjust=False, progress=False)
    if isinstance(daily.columns, pd.MultiIndex):
        daily.columns = daily.columns.get_level_values(0)
    daily.index = pd.to_datetime(daily.index)
    if daily.index.tz is None:
        daily.index = daily.index.tz_localize(IST)
    else:
        daily.index = daily.index.tz_convert(IST)
    closes = {i.date(): float(r["Close"]) for i, r in daily.iterrows()}
    return out, closes


def add_spot_indicators(g):
    g = g.copy()
    tp = (g["High"] + g["Low"] + g["Close"]) / 3
    g["vwap"] = tp.expanding().mean()
    d = g["Close"].diff()
    gain = d.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    loss = (-d.clip(upper=0)).ewm(alpha=1 / 14, adjust=False).mean()
    g["rsi"] = 100 - 100 / (1 + gain / loss.replace(0, np.nan))
    orb = g[(g.index.time >= T(9, 15)) & (g.index.time <= T(9, 45))]
    g["orb_hi"] = float(orb["High"].max()) if len(orb) else np.nan
    g["orb_lo"] = float(orb["Low"].min()) if len(orb) else np.nan
    rng = float(g["High"].max() - g["Low"].min())
    g["atr_proxy"] = rng / max(len(g), 1) / float(g["Close"].iloc[0]) * 100  # avg bar %
    return g


def premium_asof(tape, ts, col):
    h = tape[tape["t"] <= ts]
    if len(h) == 0 or col not in tape:
        return None, None
    r = h.iloc[-1]
    v = r[col]
    return (None if v is None or (isinstance(v, float) and np.isnan(v)) else float(v)), r["t"]


# ---------------- Fyers (fixed-strike option candles + OI) ----------------
# Fyers token is daily (~06:00 IST expiry). All calls degrade to None so the
# report falls back to tape-only pricing with an HTML note. No SDK needed.
FYERS_DATA = "https://api-t1.fyers.in/data"


def fyers_token():
    try:
        from api.orderflow_recorder import recorder_token
        t = recorder_token("fyers_tbt")
        if not t or ":" not in t:
            return None
        app, _, tok = t.partition(":")
        if not app.strip() or not tok.strip():
            return None
        return app.strip(), tok.strip()
    except Exception as e:
        print("fyers token unavailable:", e)
        return None


def fyers_history(symbol, res, frm, to, oi=1):
    """5m/1m candles -> DataFrame indexed IST. None on any failure."""
    cred = fyers_token()
    if cred is None:
        return None
    try:
        import requests
        app, tok = cred
        r = requests.get(f"{FYERS_DATA}/history", headers={"Authorization": f"{app}:{tok}"},
                         params={"symbol": symbol, "resolution": res, "date_format": "1",
                                 "range_from": frm, "range_to": to, "oi_flag": str(oi)},
                         timeout=25).json()
        if str(r.get("s", "")).lower() != "ok" or not r.get("candles"):
            print(f"fyers history {symbol}: {r.get('s')} {str(r.get('message'))[:80]}")
            return None
        rows = r["candles"]
        cols = ["t", "Open", "High", "Low", "Close", "Volume", "OI"][:len(rows[0])]
        df = pd.DataFrame(rows, columns=cols)
        df["t"] = pd.to_datetime(df["t"], unit="s", utc=True).dt.tz_convert(IST)
        df = df.set_index("t").sort_index()
        # Fyers can return a bar twice (2nd row differs only in Open fixup);
        # Close/H/L/Vol/OI identical -> keep last.
        nd = int(df.index.duplicated(keep="last").sum())
        if nd:
            print(f"fyers history {symbol}: dropped {nd} duplicate bars")
            df = df[~df.index.duplicated(keep="last")]
        return df
    except Exception as e:
        print(f"fyers history {symbol} failed:", str(e)[:120])
        return None


def fyers_expiry_chain(timestamp_epoch, underlying="NSE:NIFTY50-INDEX"):
    """Option-chain legs for one expiry (to resolve exact contract symbols)."""
    cred = fyers_token()
    if cred is None:
        return None
    try:
        import requests
        app, tok = cred
        r = requests.get(f"{FYERS_DATA}/options-chain-v3", headers={"Authorization": f"{app}:{tok}"},
                         params={"symbol": underlying, "strikecount": "25",
                                 "timestamp": str(timestamp_epoch)},
                         timeout=25).json()
        if str(r.get("s", "")).lower() != "ok":
            return None
        return r.get("data", {})
    except Exception as e:
        print("fyers chain failed:", str(e)[:120])
        return None


def resolve_leg_symbols(expiry_iso, strike, underlying="NSE:NIFTY50-INDEX"):
    """(expiry YYYY-MM-DD, strike) -> (ce_symbol, pe_symbol) via live chain."""
    import datetime as _dt
    want = _dt.datetime.strptime(expiry_iso, "%Y-%m-%d").strftime("%d-%m-%Y")
    chain = None
    try:
        import requests
        cred = fyers_token()
        if cred is None:
            return None, None
        app, tok = cred
        r = requests.get(
            f"{FYERS_DATA}/options-chain-v3", headers={"Authorization": f"{app}:{tok}"},
            params={"symbol": underlying, "strikecount": "25"},
            timeout=25).json()
        if str(r.get("s", "")).lower() != "ok":
            return None, None
        data = r.get("data", {})
        ts = None
        for e in data.get("expiryData", []) or []:
            if e.get("date") == want:
                ts = e.get("expiry")
                break
        if ts is None:
            print(f"expiry {want} not in Fyers expiryData for {underlying}")
            return None, None
        chain = fyers_expiry_chain(ts, underlying)
    except Exception as e:
        print("chain resolve failed:", str(e)[:120])
        return None, None
    if not chain:
        return None, None
    ce = pe = None
    for leg in chain.get("optionsChain", []) or []:
        try:
            if float(leg.get("strike_price")) != float(strike):
                continue
        except (TypeError, ValueError):
            continue
        if leg.get("option_type") == "CE" and leg.get("symbol"):
            ce = leg["symbol"]
        elif leg.get("option_type") == "PE" and leg.get("symbol"):
            pe = leg["symbol"]
    return ce, pe


# ---------------- unified premium pricer ----------------
class LegPricer:
    """Premium source per side. Fixed Fyers contract candles preferred
    (one tradable contract + OI); tape rolling-ATM leg as fallback."""

    def __init__(self, tape, legs=None, symbols=None):
        self.tape = tape
        self.legs = legs or {}
        self.symbols = symbols or {}

    def label(self, side):
        return self.symbols.get(side, "rolling-ATM")

    def fixed(self, side):
        df = self.legs.get(side)
        return df is not None and len(df) > 0

    def _fyers_at(self, side, ts):
        df = self.legs.get(side)
        h = df[df.index <= ts]
        if len(h) == 0:
            return None, None
        return float(h["Close"].iloc[-1]), h.index[-1]

    def entry(self, side, ts):
        if self.fixed(side):
            px, at = self._fyers_at(side, ts)
            if px is None:
                return None, None, None
            oi_chg = None
            df = self.legs[side]
            h = df[df.index <= ts]
            b = df[df.index <= ts - pd.Timedelta(minutes=30)]
            if "OI" in df and len(b) and len(h):
                o0, o1 = float(b["OI"].iloc[-1]), float(h["OI"].iloc[-1])
                if o0:
                    oi_chg = (o1 - o0) / o0 * 100
            return px, at, oi_chg
        leg = "atm_ce_ltp" if side == "LONG" else "atm_pe_ltp"
        px, at = premium_asof(self.tape, ts, leg)
        return px, at, None

    def window(self, side, t0, t1):
        """-> (list[datetime], list[float]) premium between t0..t1."""
        if self.fixed(side):
            df = self.legs[side]
            w = df[(df.index >= t0) & (df.index <= t1)]
            return list(w.index), [float(x) for x in w["Close"].values]
        leg = "atm_ce_ltp" if side == "LONG" else "atm_pe_ltp"
        seg = self.tape[(self.tape["t"] >= t0) & (self.tape["t"] <= t1)]
        vals = pd.to_numeric(seg[leg], errors="coerce")
        m = vals.notna()
        return list(seg.loc[m, "t"]), [float(x) for x in vals[m].values]

    def exit(self, side, ts):
        if self.fixed(side):
            return self._fyers_at(side, ts)
        leg = "atm_ce_ltp" if side == "LONG" else "atm_pe_ltp"
        px, at = premium_asof(self.tape, ts, leg)
        return px, at


def fetch_day_legs(day, spot_open, tape, underlying="NSE:NIFTY50-INDEX",
                   expiry=None, step=50):
    """Fixed-strike CE/PE 5m candles for the day-open ATM strike. {} if Fyers down.
    expiry: explicit YYYY-MM-DD, else tape mode expiry. step: strike grid (50 Nifty)."""
    try:
        if expiry is None:
            if tape is None:
                return {}, {}
            exp = pd.Series(tape["expiry"].dropna()).mode()
            if len(exp) == 0:
                return {}, {}
            expiry = str(exp.iloc[0])
        K = round(float(spot_open) / step) * step
        ce_sym, pe_sym = resolve_leg_symbols(expiry, K, underlying)
        if not ce_sym or not pe_sym:
            print(f"{day}: could not resolve fixed legs for strike {K:.0f}")
            return {}, {}
        out, syms = {}, {}
        for side, sym in (("LONG", ce_sym), ("SHORT", pe_sym)):
            df = fyers_history(sym, "5", CASE_DAYS[0], CASE_DAYS[-1])
            if df is None or len(df) == 0:
                return {}, {}
            d = df[df.index.date == pd.Timestamp(day).date()]
            d = d[(d.index.time >= T(9, 15)) & (d.index.time <= T(15, 30))]
            if len(d) == 0:
                return {}, {}
            out[side] = d
            syms[side] = sym.split(":")[-1]
        print(f"{day}: fixed legs {syms['LONG']} / {syms['SHORT']} ({len(out['LONG'])}/{len(out['SHORT'])} bars)")
        return out, syms
    except Exception as e:
        print(f"{day}: fixed legs failed:", str(e)[:120])
        return {}, {}


# ---------------- entry engine ----------------
def build_candidates(day, spot, tape, pricer):
    """Rule-based entry candidates. Returns list of dicts with premium MFE/MAE/realized."""
    cands = []
    closes = list(spot.iterrows())
    idx = list(spot.index)
    orb_hi, orb_lo = float(spot["orb_hi"].iloc[0]), float(spot["orb_lo"].iloc[0])
    buf = 1.001

    def reg(row):
        return float(row["Close"]) - float(row["vwap"])

    # signal flags per bar
    orb_fired = {}
    for i, (ts, r) in enumerate(closes):
        if ts.time() < T(9, 50):
            continue
        c = float(r["Close"])
        if "LONG" not in orb_fired and c > orb_hi * buf:
            orb_fired["LONG"] = (ts, c)
        if "SHORT" not in orb_fired and c < orb_lo / buf:
            orb_fired["SHORT"] = (ts, c)
    for side, (ts, px) in orb_fired.items():
        cands.append(dict(signal="ORB break", side=side, ts=ts, spot=px,
                          why=f"first 5m close outside 09:15-09:45 box ({orb_hi:.0f}/{orb_lo:.0f}) +0.1% buffer"))

    for i in range(2, len(closes)):
        ts, r = closes[i][0], closes[i][1]
        if ts.time() < T(9, 45):
            continue
        p0 = reg(closes[i - 1][1]) <= 0
        p1 = reg(r) > 0
        if p0 and p1:
            cands.append(dict(signal="VWAP reclaim", side="LONG", ts=ts, spot=float(r["Close"]),
                              why="crossed back above session average-price line"))
        p0 = reg(closes[i - 1][1]) >= 0
        p1 = reg(r) < 0
        if p0 and p1:
            cands.append(dict(signal="VWAP loss", side="SHORT", ts=ts, spot=float(r["Close"]),
                              why="lost the session average-price line"))
        rs0, rs1 = float(closes[i - 1][1]["rsi"]), float(r["rsi"])
        if not np.isnan(rs0) and not np.isnan(rs1):
            if rs0 < 30 and rs1 >= 30:
                cands.append(dict(signal="RSI snapback", side="LONG", ts=ts, spot=float(r["Close"]),
                                  why=f"RSI 5m washed to {rs0:.0f} then snapped back"))
            if rs0 > 70 and rs1 <= 70:
                cands.append(dict(signal="RSI cool-down", side="SHORT", ts=ts, spot=float(r["Close"]),
                                  why=f"RSI 5m overheated to {rs0:.0f} then cooled"))

    # wall bounce (tape walls asof each bar; skipped when no tape, e.g. Sensex)
    has_walls = tape is not None and "walls" in tape
    for i, (ts, r) in enumerate(closes):
        if not has_walls:
            break
        if ts.time() < T(10, 0) or ts.time() > T(14, 30):
            continue
        h = tape[tape["t"] <= ts]
        if len(h) == 0:
            continue
        w = h.iloc[-1]["walls"] or {}
        try:
            pw = max((x["strike"] for x in w.get("puts", [])), default=None,
                     key=lambda s: next(x["oi"] for x in w["puts"] if x["strike"] == s))
            cw = min((x["strike"] for x in w.get("calls", [])), default=None,
                     key=lambda s: next(x["oi"] for x in w["calls"] if x["strike"] == s))
        except Exception:
            continue
        c = float(r["Close"])
        body = abs(float(r["Close"]) - float(r["Open"]))
        rng = float(r["High"]) - float(r["Low"]) or 1
        reversal_up = float(r["Close"]) > float(r["Open"]) and (float(r["Close"]) - float(r["Low"])) > 0.6 * rng
        reversal_dn = float(r["Close"]) < float(r["Open"]) and (float(r["High"]) - float(r["Close"])) > 0.6 * rng
        if pw and abs(c - pw) / c < 0.0015 and reversal_up:
            cands.append(dict(signal="Put-wall bounce", side="LONG", ts=ts, spot=c,
                              why=f"tagged top put wall {pw:.0f} + bullish reversal bar"))
        if cw and abs(c - cw) / c < 0.0015 and reversal_dn:
            cands.append(dict(signal="Call-wall rejection", side="SHORT", ts=ts, spot=c,
                              why=f"rejected at top call wall {cw:.0f} + bearish reversal bar"))

    # afternoon continuation 13:30+
    for i, (ts, r) in enumerate(closes):
        if ts.time() != T(13, 30):
            continue
        side = "LONG" if reg(r) > 0 else "SHORT"
        cands.append(dict(signal="13:30 trend side", side=side, ts=ts, spot=float(r["Close"]),
                          why=f"afternoon position on the VWAP side ({reg(r):+.0f} pts)"))

    # dedupe identical (side, timestamp) — same bar can fire VWAP + wall + RSI
    # (double-counts trades and piles annotations). Keep first signal.
    seen, uniq = set(), []
    for c in cands:
        k = (c["side"], c["ts"].strftime("%H:%M"))
        if k in seen:
            continue
        seen.add(k)
        uniq.append(c)
    if len(uniq) != len(cands):
        print(f"{day}: deduped {len(cands) - len(uniq)} duplicate (side, time) candidates")
    cands = uniq

    # price each candidate (fixed Fyers leg preferred, tape rolling-ATM fallback)
    priced = []
    exit_ts = pd.Timestamp(f"{day} {EXIT_HM[0]:02d}:{EXIT_HM[1]:02d}", tz=IST)
    for c in cands:
        px, at, oi_chg = pricer.entry(c["side"], c["ts"])
        if px is None or px <= 0:
            c["skip"] = "no premium (Fyers/tape)"
            priced.append(c)
            continue
        c["entry_px"] = px
        c["oi_chg"] = oi_chg
        c["leg"] = pricer.label(c["side"])
        times, vals = pricer.window(c["side"], at, exit_ts)
        s = pd.Series(vals, index=pd.to_datetime(times)).dropna()
        if len(s) == 0:
            c["skip"] = "no premium after entry"
            priced.append(c)
            continue
        tstr = lambda t: pd.Timestamp(t).strftime("%H:%M")
        c["mfe"] = float((s.max() - px) / px * 100)
        c["mfe_px"] = float(s.max())
        c["mfe_t"] = tstr(s.idxmax())
        c["mae"] = float((s.min() - px) / px * 100)
        stop_px = px * (1 - STOP_PCT)
        below = s[s <= stop_px]
        c["stop_hit"] = tstr(below.index[0]) if len(below) else None
        ex_px, ex_at = pricer.exit(c["side"], exit_ts)
        c["exit_px"] = ex_px if ex_px else float(s.iloc[-1])
        c["exit_t"] = tstr(ex_at) if ex_px else tstr(s.index[-1])
        c["realized"] = float((c["exit_px"] - px) / px * 100)
        priced.append(c)
    return priced


def hindsight_grid(day, spot, tape, pricer):
    """Exhaustive 5m entries 09:30-14:30, both sides, exit 15:00. Top windows."""
    rows = []
    exit_ts = pd.Timestamp(f"{day} {EXIT_HM[0]:02d}:{EXIT_HM[1]:02d}", tz=IST)
    for ts, r in spot.iterrows():
        if not (T(9, 30) <= ts.time() <= T(14, 30)):
            continue
        for side in ("LONG", "SHORT"):
            px, at, _ = pricer.entry(side, ts)
            ex_px, ex_at = pricer.exit(side, exit_ts)
            if px is None or ex_px is None or px <= 0:
                continue
            rows.append(dict(ts=ts, side=side, entry=px, exit=ex_px,
                             exit_t=pd.Timestamp(ex_at).strftime("%H:%M"),
                             leg=pricer.label(side),
                             ret=(ex_px - px) / px * 100, spot=float(r["Close"])))
    df = pd.DataFrame(rows)
    if len(df) == 0:
        return df
    return df.sort_values("ret", ascending=False).reset_index(drop=True)


# ---------------- charts ----------------
def plot_spot(index, day, spot, cands, ctx):
    """Final-view spot chart: candles + VWAP + ORB box + RSI + entry markers."""
    n = len(spot)
    xs = list(range(n))
    fig, (ax, axr) = plt.subplots(2, 1, figsize=(17, 7.5), sharex=True,
                                  gridspec_kw=dict(height_ratios=[4, 1.4], hspace=0.08))
    for x, (_, b) in zip(xs, spot.iterrows()):
        o, h, l, c = float(b["Open"]), float(b["High"]), float(b["Low"]), float(b["Close"])
        col = UP if c >= o else DN
        ax.vlines(x, l, h, color=col, lw=1.0)
        ax.add_patch(Rectangle((x - 0.32, min(o, c)), 0.64, max(abs(c - o), 0.01),
                               facecolor=col, edgecolor=col, lw=0))
    ax.plot(xs, spot["vwap"].values, color=TEAL, lw=1.2, label="VWAP (session avg-price)")
    orb_hi, orb_lo = float(spot["orb_hi"].iloc[0]), float(spot["orb_lo"].iloc[0])
    ax.axhspan(orb_lo, orb_hi, color="#161B22", alpha=0.9)
    ax.text(2, orb_hi, "09:15-09:45 box", color=DIM, fontsize=7.5, va="bottom")
    ax.axhline(ctx["prev_close"], color=BLUE, ls="--", lw=1.0, alpha=0.85,
               label=f"prev close {ctx['prev_close']:.0f}")
    ax.axhline(float(spot["High"].max()), color=DIM, ls=":", lw=0.9, alpha=0.7, label="day high")
    ax.axhline(float(spot["Low"].min()), color=DIM, ls=":", lw=0.9, alpha=0.7, label="day low")
    idx_of = lambda ts: min(range(n), key=lambda i: abs((spot.index[i] - ts).total_seconds()))
    # short labels (time + result; signal names live in the HTML table) staggered
    # vertically with leader lines so clustered entries stay readable
    up_lv, dn_lv = [16, 48, 80], [-18, -50, -82]
    ui = di = 0
    for c in cands:
        if "entry_px" not in c or "realized" not in c:
            continue
        x = idx_of(c["ts"])
        up = c["side"] == "LONG"
        if up:
            dy = up_lv[ui % len(up_lv)]; dx = 4 if (ui // len(up_lv)) % 2 == 0 else -64; ui += 1
        else:
            dy = dn_lv[di % len(dn_lv)]; dx = 4 if (di // len(dn_lv)) % 2 == 0 else -64; di += 1
        col = UP if c["realized"] > 0 else DN
        ax.scatter([x], [c["spot"]], marker="^" if up else "v",
                   color=YEL, s=85, zorder=5, edgecolor=BG)
        ax.annotate(f"{c['ts'].strftime('%H:%M')} {c['realized']:+.0f}%",
                    (x, c["spot"]), color=FG, fontsize=7.5,
                    xytext=(dx, dy), textcoords="offset points",
                    arrowprops=dict(arrowstyle="-", color=YEL, lw=0.7,
                                    shrinkA=2, shrinkB=3),
                    bbox=dict(boxstyle="round,pad=0.3", fc="#161B22", ec=col, lw=0.9))
    ax.text(0.99, 0.02, "labels: entry time + realized % (green=win, red=loss)",
            transform=ax.transAxes, color=DIM, fontsize=7, ha="right", va="bottom")
    ax.legend(loc="upper left", fontsize=7.5, framealpha=0.9, labelcolor=FG, ncol=3)
    ax.set_title(f"{index} {day} — spot final view (5m candles + VWAP + entries)",
                 fontsize=11, color=FG)
    rsi = spot["rsi"].values
    axr.plot(xs, rsi, color=PUR, lw=1.1, label="RSI(14, 5m)")
    axr.axhline(70, color=DN, ls="--", lw=0.8)
    axr.axhline(30, color=UP, ls="--", lw=0.8)
    axr.axhline(50, color=DIM, ls=":", lw=0.7)
    axr.set_ylim(0, 100)
    axr.legend(loc="upper left", fontsize=7, labelcolor=FG)
    axr.grid(color="#21262D", lw=0.5, alpha=0.6)
    ticks = [x for x in xs if x % 12 == 0]
    axr.set_xticks(ticks)
    axr.set_xticklabels([spot.index[i].strftime("%H:%M") for i in ticks], fontsize=8)
    ax.grid(color="#21262D", lw=0.5, alpha=0.6)
    fig.subplots_adjust(left=0.07, right=0.985, top=0.92, bottom=0.08)
    fn = f"{index}_{day}_spot.png"
    fig.savefig(FIG / fn, dpi=100)
    plt.close(fig)
    return fn


def plot_day(index, day, spot, tape, cands, grid, pricer):
    n = len(spot)
    xs = list(range(n))
    fig, (ax, axp, axv) = plt.subplots(3, 1, figsize=(17, 8.5), sharex=True,
                                       gridspec_kw=dict(height_ratios=[4, 3, 2], hspace=0.08))
    for x, (_, b) in zip(xs, spot.iterrows()):
        o, h, l, c = float(b["Open"]), float(b["High"]), float(b["Low"]), float(b["Close"])
        col = UP if c >= o else DN
        ax.vlines(x, l, h, color=col, lw=0.9)
        ax.add_patch(Rectangle((x - 0.32, min(o, c)), 0.64, max(abs(c - o), 0.01),
                               facecolor=col, edgecolor=col, lw=0))
    ax.plot(xs, spot["vwap"].values, color=TEAL, lw=1.1, label="avg-price (VWAP)")
    orb_hi, orb_lo = float(spot["orb_hi"].iloc[0]), float(spot["orb_lo"].iloc[0])
    ax.axhspan(orb_lo, orb_hi, color="#161B22", alpha=0.9)
    ax.text(2, orb_hi, "09:15-09:45 box", color=DIM, fontsize=7, va="bottom")
    # premium curves: fixed Fyers legs when available, else tape rolling-ATM
    idx_of = lambda ts: min(range(n), key=lambda i: abs((spot.index[i] - ts).total_seconds()))
    t0, t1 = spot.index[0], spot.index[-1]
    prem_src = "fixed Fyers legs" if pricer.fixed("LONG") else "tape rolling-ATM"
    for side, col in (("LONG", UP), ("SHORT", DN)):
        times, vals = pricer.window(side, t0, t1)
        if len(vals):
            axp.plot([idx_of(pd.Timestamp(t)) for t in times], vals, color=col, lw=1.1,
                     label=f"{pricer.label(side)} ({side})")
    lv = [12, 30, 48]
    li = 0
    for c in cands:
        if "entry_px" not in c or "realized" not in c:
            continue
        x = idx_of(c["ts"])
        ax.scatter([x], [c["spot"]], marker="^" if c["side"] == "LONG" else "v",
                   color=YEL, s=70, zorder=5, edgecolor=BG)
        axp.scatter([x], [c["entry_px"]], marker="^" if c["side"] == "LONG" else "v",
                    color=YEL, s=70, zorder=5, edgecolor=BG)
        dy = lv[li % len(lv)]; li += 1
        col = UP if c["realized"] > 0 else DN
        axp.annotate(f"{c['ts'].strftime('%H:%M')} {c['realized']:+.0f}%", (x, c["entry_px"]),
                     color=FG, fontsize=7.5,
                     xytext=(4, dy), textcoords="offset points",
                     arrowprops=dict(arrowstyle="-", color=YEL, lw=0.7,
                                     shrinkA=2, shrinkB=3),
                     bbox=dict(boxstyle="round,pad=0.3", fc="#161B22", ec=col, lw=0.9))
    ax.legend(loc="upper left", fontsize=7, framealpha=0.9, labelcolor=FG, ncol=3)
    axp.legend(loc="upper left", fontsize=7, framealpha=0.9, labelcolor=FG, ncol=2)
    ax.set_title(f"{index} {day} — spot (5m) + {prem_src} premium with rule entries (yellow)",
                 fontsize=11, color=FG)
    if tape is not None:
        # tape strip: PCR-OI + max-pain gap
        ti = [idx_of(t) for t in tape["t"]]
        axv.plot(ti, pd.to_numeric(tape["pcr_oi"], errors="coerce").values, color=PUR, lw=1.1, label="PCR-OI")
        axv.axhline(1.0, color=DIM, ls="--", lw=0.8)
        mp = pd.to_numeric(tape["max_pain"], errors="coerce")
        gap = (pd.to_numeric(tape["spot"], errors="coerce") - mp).values
        ax2 = axv.twinx()
        ax2.bar(ti, gap, width=0.8, color=TEAL, alpha=0.45, label="spot-maxpain")
        axv.legend(loc="upper left", fontsize=7, labelcolor=FG)
        ax2.legend(loc="upper right", fontsize=7, labelcolor=FG)
        axv.set_ylabel("PCR", fontsize=7)
    else:
        # no tape (Sensex): contract OI strip instead — writer footprint
        for side, col in (("LONG", UP), ("SHORT", DN)):
            df = pricer.legs.get(side)
            if df is not None and "OI" in df and len(df):
                oi = pd.to_numeric(df["OI"], errors="coerce").dropna()
                axv.plot([idx_of(t) for t in oi.index], oi.values / 1e6, color=col, lw=1.1,
                         label=f"{pricer.label(side)} OI (M)")
        axv.legend(loc="upper left", fontsize=7, labelcolor=FG)
        axv.set_ylabel("OI (M)", fontsize=7)
    ticks = [x for x in xs if x % 12 == 0]
    axv.set_xticks(ticks)
    axv.set_xticklabels([spot.index[i].strftime("%H:%M") for i in ticks], fontsize=8)
    axv.grid(color="#21262D", lw=0.5, alpha=0.6)
    fig.subplots_adjust(left=0.07, right=0.93, top=0.93, bottom=0.07)
    fn = f"{index}_{day}_replay.png"
    fig.savefig(FIG / fn, dpi=100)
    plt.close(fig)
    return fn


def plot_decay(days_data, fixed=None):
    fig, ax = plt.subplots(figsize=(11, 4.2))
    for day, tape in days_data:
        if tape is None or "straddle" not in tape:
            continue
        s = pd.to_numeric(tape["straddle"], errors="coerce").dropna()
        if len(s) == 0:
            continue
        b0 = float(s.iloc[0])
        norm = s / b0 * 100
        mins = [(t - tape["t"].iloc[0]).total_seconds() / 60 for t in tape.loc[s.index, "t"]]
        ax.plot(mins, norm.values, lw=1.4, label=f"{day} straddle (rolling ATM =100)")
    for label, times, vals in (fixed or []):
        s = pd.Series(vals, index=pd.to_datetime(times)).dropna()
        if len(s) == 0:
            continue
        b0 = float(s.iloc[0])
        mins = [(t - s.index[0]).total_seconds() / 60 for t in s.index]
        ax.plot(mins, (s / b0 * 100).values, lw=1.4, ls="--", label=f"{label} (fixed =100)")
    ax.axhline(100, color=DIM, ls="--", lw=0.8)
    ax.set_xlabel("minutes since tape start")
    ax.set_ylabel("straddle vs start (=100)")
    ax.set_title("Theta burn — rolling-ATM straddle decay through the session", fontsize=11, color=FG)
    ax.legend(fontsize=8, labelcolor=FG)
    ax.grid(color="#21262D", lw=0.5, alpha=0.6)
    fig.subplots_adjust(left=0.07, right=0.97, top=0.88, bottom=0.15)
    fn = "NIFTY_straddle_decay.png"
    fig.savefig(FIG / fn, dpi=100)
    plt.close(fig)
    return fn


# ---------------- 20-session deeper cut ----------------


def oi_txt(c):
    v = c.get("oi_chg")
    if v is None:
        return "—"
    return f"{v:+.0f}%"


def cand_rows(cands):
    rows = []
    for c in cands:
        if "entry_px" not in c:
            rows.append(f"<tr><td>{c['signal']}</td><td>{c['side']}</td>"
                        f"<td>{c['ts'].strftime('%H:%M')}</td><td colspan='6' class='dim'>skipped: {c.get('skip')}</td></tr>")
            continue
        if "realized" not in c:
            rows.append(f"<tr><td>{c['signal']}</td><td>{c['side']}</td>"
                        f"<td>{c['ts'].strftime('%H:%M')}</td><td>{c.get('leg', '')}</td>"
                        f"<td>{c['entry_px']:.1f}</td>"
                        f"<td colspan='4' class='dim'>skipped: {c.get('skip', 'no exit premium')}</td></tr>")
            continue
        rc = "pos" if c["realized"] > 0 else "neg"
        mc = "pos" if c["mfe"] > 0 else "neg"
        stop = c["stop_hit"] or "—"
        rows.append(f"<tr><td>{c['signal']}</td><td>{c['side']}</td>"
                    f"<td>{c['ts'].strftime('%H:%M')}</td><td class='dim'>{c.get('leg', '')}</td>"
                    f"<td>{c['entry_px']:.1f}</td>"
                    f"<td class=\"{mc}\">{c['mfe']:+.0f}% ({c['mfe_t']})</td>"
                    f"<td>{stop}</td>"
                    f"<td class=\"{rc}\">{c['realized']:+.0f}% (@{c['exit_t']})</td>"
                    f"<td>{oi_txt(c)}</td></tr>")
    return "".join(rows)


def grid_rows(grid, n=5):
    if grid is None or len(grid) == 0:
        return "<tr><td colspan='5' class='dim'>no premium</td></tr>"
    rows = []
    for _, r in grid.head(n).iterrows():
        rc = "pos" if r["ret"] > 0 else "neg"
        rows.append(f"<tr><td>{r['ts'].strftime('%H:%M')}</td><td>{r['side']}</td>"
                    f"<td>{r['entry']:.1f} → {r['exit']:.1f}</td>"
                    f"<td class=\"{rc}\">{r['ret']:+.1f}%</td><td>exit {r['exit_t']}, no stop</td></tr>")
    return "".join(rows)


def verdict_block(day, ctx, cands, grid):
    scored = [c for c in cands if "entry_px" in c and "realized" in c]
    if not scored:
        return '<div class="warn">No priced candidates — premium gap.</div>'
    best = max(scored, key=lambda c: c["realized"])
    top = grid.iloc[0] if grid is not None and len(grid) else None
    hline = (f"<p>Hindsight-optimal (exit {top['exit_t']}, no stop): <b>{top['ts'].strftime('%H:%M')} "
             f"{top['side']}</b> {top.get('leg', '')} {top['entry']:.1f} → {top['exit']:.1f} "
             f"({top['ret']:+.1f}%).</p>") if top is not None else ""
    oi = best.get("oi_chg")
    if oi is not None and oi >= 3:
        oi_s = (f" Contract OI {oi:+.0f}% vs 30 min before — fresh writing on this side.")
    elif oi is not None and oi <= -3:
        oi_s = (f" Contract OI {oi:+.0f}% vs 30 min before — positions closing into the move "
                f"(covering fuel, not fresh writing).")
    elif oi is not None:
        oi_s = " Contract OI flat (±3%) — no fresh writing behind it."
    else:
        oi_s = ""
    return (f'<div class="good"><b>Best rule entry: {best["signal"]} {best["side"]} @ '
            f'{best["ts"].strftime("%H:%M")}</b> — {best.get("leg", "")} premium {best["entry_px"]:.1f}, '
            f'MFE {best["mfe"]:+.0f}% by {best["mfe_t"]}, realized {best["realized"]:+.0f}% '
            f'(@{best["exit_t"]}). Why: {best["why"]}.{oi_s}</div>' + hline)


def spot_summary(day, ctx, res):
    spot = ctx["spot"]
    o = float(spot["Open"].iloc[0]); h = float(spot["High"].max())
    lo = float(spot["Low"].min()); c = float(spot["Close"].iloc[-1])
    vw = float(spot["vwap"].iloc[-1])
    scored = [x for x in res["cands"] if "realized" in x]
    w = sum(1 for x in scored if x["realized"] > 0)
    l = len(scored) - w
    best = max(scored, key=lambda x: x["realized"]) if scored else None
    bline = (f"<br><b>Best:</b> {best['signal']} {best['side']} "
             f"@{best['ts'].strftime('%H:%M')} ({best['realized']:+.0f}%)") if best else ""
    eod = "above VWAP" if c > vw else "below VWAP"
    return (f"<b>Open</b> {o:.0f} · <b>High</b> {h:.0f}<br><b>Low</b> {lo:.0f} · "
            f"<b>Close</b> {c:.0f}<br><b>Range</b> {(h-lo)/o*100:.2f}% · "
            f"<b>Day</b> {(c-o)/o*100:+.2f}%<br><b>Close</b> {eod} ({c-vw:+.0f} pts)"
            f"<br><b>Signals:</b> {w}W / {l}L{bline}<br><span class='dim'>"
            f"Yellow ▲▼ = rule entries with realized %.</span>")



CSS = ("body{background:#0D1117;color:#E6EDF3;font-family:system-ui,sans-serif;max-width:1180px;margin:0 auto;padding:24px;line-height:1.55}h1,h2{border-bottom:1px solid #30363D;padding-bottom:6px}h2{border-left:4px solid #1F6FEB;padding-left:10px}table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13px}th,td{border:1px solid #30363D;padding:5px 8px;text-align:right;font-variant-numeric:tabular-nums}th:first-child,td:first-child{text-align:left}th{background:#161B22}img{max-width:100%;background:#0D1117;border:1px solid #30363D;border-radius:6px;margin:10px 0}.up{color:#3FB950}.dn{color:#F85149}.dim{color:#8B949E}.warn{background:#161B22;border-left:3px solid #D29922;padding:8px 12px;margin:12px 0}.good{background:#161B22;border-left:3px solid #3FB950;padding:8px 12px;margin:12px 0}td.pos{color:#3FB950;font-weight:600}td.neg{color:#F85149;font-weight:600}.split{display:flex;gap:16px;align-items:flex-start;margin:12px 0}.split .L{flex:0 0 270px;min-width:0}.split .R{flex:1;min-width:0}.split .R img{margin:0}@media(max-width:900px){.split{flex-direction:column}.split .L{flex:auto;width:100%}}.kv{font-size:13px}.kv b{color:#E6EDF3}")
# ---------------- main ----------------
def main():
    spot_cache = {}

    def get_spot(symbol, days):
        key = (symbol, tuple(sorted(days)))
        if key not in spot_cache:
            spot_cache[key] = load_spot(sorted(days), symbol)
        return spot_cache[key]

    sym_days = {}
    for _, day, ysym, _, _, _ in CASES:
        sym_days.setdefault(ysym, []).append(day)
    for ysym, days in sym_days.items():
        get_spot(ysym, days)

    day_ctx = {}
    for index, day, ysym, underlying, expiry, has_tape in CASES:
        sm, closes = spot_cache[(ysym, tuple(sorted(sym_days[ysym])))]
        spot = add_spot_indicators(sm[day])
        tape = load_tape(day) if has_tape else None
        D = pd.Timestamp(day).date()
        priors = [x for x in closes if x < D]
        pc = closes[max(priors)] if priors else float("nan")
        day_ctx[(index, day)] = dict(index=index, day=day, spot=spot, tape=tape,
                                     prev_close=pc, open=float(spot["Open"].iloc[0]),
                                     gap=(float(spot["Open"].iloc[0]) / pc - 1) * 100)

    results = {}
    pricing_note = {}
    for (index, day), ctx in day_ctx.items():
        step = 100 if index == "SENSEX" else 50
        case = next(c for c in CASES if c[0] == index and c[1] == day)
        legs, syms = fetch_day_legs(day, ctx["open"], ctx["tape"], case[3], case[4], step)
        pricer = LegPricer(ctx["tape"], legs, syms)
        if pricer.fixed("LONG"):
            pricing_note[(index, day)] = (f"fixed Fyers contracts {syms['LONG']} / {syms['SHORT']} "
                                          f"(day-open ATM, 5m candles + OI)")
        else:
            pricing_note[(index, day)] = "tape rolling-ATM leg (Fyers unavailable)"
        cands = build_candidates(day, ctx["spot"], ctx["tape"], pricer)
        grid = hindsight_grid(day, ctx["spot"], ctx["tape"], pricer)
        fig = plot_day(index, day, ctx["spot"], ctx["tape"], cands, grid, pricer)
        spot_fig = plot_spot(index, day, ctx["spot"], cands, ctx)
        results[(index, day)] = dict(cands=cands, grid=grid, fig=fig, spot_fig=spot_fig,
                                     pricing=pricing_note[(index, day)], pricer=pricer)

    nifty_tapes = [(d, day_ctx[("NIFTY", d)]["tape"]) for d in CASE_DAYS]
    fixed2 = []
    for (index, day), res in results.items():
        p = res["pricer"]
        if p.fixed("LONG") and p.fixed("SHORT"):
            st = day_ctx[(index, day)]["spot"]
            t0, t1 = st.index[0], st.index[-1]
            tc, ce = p.window("LONG", t0, t1)
            tp, pe = p.window("SHORT", t0, t1)
            s_ce = pd.Series(ce, index=pd.to_datetime(tc)).dropna()
            s_pe = pd.Series(pe, index=pd.to_datetime(tp)).dropna()
            both = s_ce.index.intersection(s_pe.index)
            if len(both):
                fixed2.append((f"{index} {day} fixed", list(both),
                               [float(s_ce[t] + s_pe[t]) for t in both]))
    decay_fig = plot_decay(nifty_tapes, fixed2)

    sections = []
    for index, day, _ysym, _u, _e, _ht in CASES:
        ctx, res = day_ctx[(index, day)], results[(index, day)]
        w = ctx["tape"]
        if w is None:
            tape_note = ('<div class="warn">No options tape for Sensex — PCR/max-pain/walls '
                         'unavailable; day-type read is spot-VWAP + RSI only. Bottom strip shows '
                         'contract OI instead.</div>')
        else:
            last_t = w["t"].iloc[-1].strftime("%H:%M")
            fixed = res["pricing"].startswith("fixed")
            if fixed:
                tape_note = ""
            else:
                tape_note = "" if last_t >= "15:00" else \
                    f'<div class="warn">Tape ends {last_t} — exits/MFE after that are unpriced; realized exits use the last tape bar.</div>'
        expiry_note = f'<div class="warn">{SENSEX_EXPIRY_NOTE}</div>' if index == "SENSEX" else ""
        sections.append(f"""
    <h2>{index} {day} — gap {ctx['gap']:+.2f}% (prev {ctx['prev_close']:.0f} → open {ctx['open']:.0f})</h2>
    <p class="dim">Priced on: {res['pricing']}.</p>
    {expiry_note}
    {tape_note}
    {verdict_block(day, ctx, res['cands'], res['grid'])}
    <table><tr><th>Signal</th><th>Side</th><th>Time</th><th>Leg</th><th>Entry prem</th><th>MFE</th><th>-40% stop</th><th>Realized</th><th>OI 30m</th></tr>
    {cand_rows(res['cands'])}</table>
    <h3>Hindsight top-5 windows (exhaustive 5m grid, exit 15:00)</h3>
    <table><tr><th>Entry</th><th>Side</th><th>Premium</th><th>Return</th><th>Note</th></tr>
    {grid_rows(res['grid'])}</table>
    <img src="figures/{res['fig']}"/>
    <h3>Final view — spot chart</h3>
    <div class="split"><div class="L kv">
    {spot_summary(day, ctx, res)}
    </div><div class="R"><img src="figures/{res['spot_fig']}"/></div></div>
    """)

    sess_html = """<p class="dim">History context lives in the learning report
    (<code>reports/NIFTY_LEARNING/</code> — 60 sessions, confirmed lessons) and the breadth edge
    report (<code>reports/NIFTY_BREADTH_EDGE/</code> — 10:30 day-type gate). This page stays focused
    on the three premium case studies above.</p>"""

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>NIFTY + SENSEX options-entry EDA — Oct 14 + Oct 15</title><style>{CSS}</style></head><body>
    <h1>NIFTY + SENSEX options-entry EDA — where should we have entered, and why</h1>
    <p class="dim">Entries priced on <b>fixed Fyers contracts</b> (day-open ATM strike, 19-Oct weekly expiry,
    5-minute candles with per-bar OI) wherever Fyers auth is live; otherwise the tape's rolling-ATM leg.
    PCR / max pain / walls come from <code>experiments/data/nifty_tape/</code> (live chain is snapshot-only).
    Realized = premium change entry → 15:00 (per-row exit time shown). Stop column = first touch of −40% premium.
    OI 30m = contract OI change vs 30 min before entry (writer-footprint proxy).
    No costs/spread/slippage modelled — indicative only.</p>
    {''.join(sections)}
    <h2>Theta context — straddle decay</h2>
    <p class="dim">Rolling-ATM straddle (CE+PE) rebased to 100 at session start. Steep = premium melted
    even without direction; entries after the burn need real momentum to pay.</p>
    <img src="figures/{decay_fig}"/>
    {sess_html}
    <h2>Why each edge works (mechanism + when it breaks)</h2>
    <p><b>RSI snapback LONG.</b> A sub-30 5m print means stops and intraday shorts rush the same exit;
    once the flush exhausts, the first green bar faces thin offers and ATM-call delta snaps ~0.35 → ~0.5
    while IV is still up — premium jumps faster than spot. Breaks when the wash is news-driven and ongoing
    (Oct-14 13:25/13:35 LONGs: +1% — dead-cat bounce into a falling-PCR tape).</p>
    <p><b>RSI cool-down SHORT.</b> Overheated call buying forces dealer hedging; when momentum stalls the
    overpaid call deflates even sideways. Best pinned under a wall/max-pain (Oct-14 10:50 PE +42%).
    Breaks on trend days — Oct-15 cool-down SHORTs lost −33%/−27%/−7% fading put-writing support.</p>
    <p><b>VWAP cross.</b> The institutional benchmark: crosses flip passive programs buy↔sell — sustained
    flow, not a wick. Breaks on chop days (Oct-14 printed reclaim/loss/reclaim/loss; LONG reclaims −39%/−38%).</p>
    <p><b>ORB break.</b> The box maps the overnight-inventory auction; a confirmed break = one side's stops
    tripping. Breaks when the box is abnormally wide (Oct-13: 1.26%, breakout at 14:15, money already made)
    or on head-fake reversals into VWAP.</p>
    <p><b>PCR-trend day gate.</b> Rising PCR + spot above VWAP = writers building a floor (Oct-15: PCR
    0.86 → 1.82, floor held all day). Falling PCR + pinned spot = call-writing day (Oct-14, every LONG died).
    Breaks on 0/1-DTE sessions where rolls/expiry flows spoof PCR.</p>
    <p><b>12:30 exit + no-13:30 entries.</b> Morning premium carries overnight IV; midday on grind days the
    move is priced in and the afternoon melts (Oct-15 snap: +73.9% at 12:30 vs +56.8% at 15:00 — the ~17 pts
    given back is pure decay). 13:30 entries lost 3/3 across indices and sides — ~2 hours left cannot fund
    the IV crush already in the premium. Breaks only on viral afternoon-trend days.</p>
    <h2>Oct-15 Nifty autopsy — fixed-leg straddle account (22650CE+PE)</h2>
    <table><tr><th>Time</th><th>CE</th><th>PE</th><th>Straddle</th><th>Note</th></tr>
    <tr><td>09:15</td><td>169.4</td><td>104.8</td><td>274.2</td><td>session start</td></tr>
    <tr><td>09:45</td><td>209.4</td><td>77.9</td><td>287.4</td><td>snap entry bar</td></tr>
    <tr><td>10:00</td><td>271.2</td><td>61.2</td><td>332.4</td><td>delta expansion</td></tr>
    <tr><td>12:30</td><td>364.3</td><td>45.1</td><td>409.4</td><td>grind top</td></tr>
    <tr><td>13:40</td><td>423.6</td><td>31.6</td><td>455.3</td><td>MFE bar (+66% vs start)</td></tr>
    <tr><td>15:00</td><td>328.4</td><td>36.7</td><td>365.1</td><td>−20% melt in 80 min, spot −0.2%</td></tr>
    </table>
    <p class="dim">Morning LONGs won on delta expansion + short-covering (CE OI −70% on the day — no offer
    wall formed; PE OI +25.8% = fresh put writing = support). Afternoon fade was pure 4-DTE IV/theta bleed
    into the 23000 call wall. Cross-index: Sensex agreed bar-for-bar (gap bucket, day-type, side, 09:40–09:50
    optimum, fade, 13:30 failure) — confluence raises conviction but adds no independent edge; on disagreement
    days stand down (index-specific flows the tape can't see).</p>
    <h2>Strategy in plain English (with no-gamble rules)</h2>
    <div class="good"><b>What we trade:</b> Nifty weekly ATM options, intraday only — CE if the day
    points up, PE if it points down. Buy, never sell. Always out by 15:00. One contract per idea.</div>
    <p><b>1. Decide the day-type by 10:30, then obey it.</b> Trend-up = price stretched above VWAP
    with put-writing rising (PCR climbing); trend-down = price pinned near max pain with PCR falling
    (Oct 14). Anything else = chop day = <b>no fresh trades</b>. The side you don't take is where
    every big loser in this report came from.</p>
    <p><b>2. Take ONE first signal on the day-type side only</b> (RSI snap/cool, VWAP cross, or
    opening-box break after 10:00). Never take both sides the same morning — Oct 14 fired LONGs and
    SHORTs together; the LONGs lost −33…−43%.</p>
    <p><b>3. Exits decide the money.</b> Book half around +25% when premium spikes early; be flat by
    12:30–13:00 on grind days (afternoon melt ate every holder). Never use tight premium trailing
    stops (20–30% wiggle is noise — worst results in testing). No fresh entries at/after 13:30 —
    the 13:30 signal lost on both days.</p>
    <p><b>4. No-gamble rules (non-negotiable):</b> max 2 entries per day · one side per day ·
    −40% premium stop is an EXIT, not a display number (several report rows bled past it to −43%) ·
    skip anything that can't clear costs (a +1% "win" is a loss after spread) · fixed size (1 lot)
    while evidence is thin · no averaging down, ever · chop days are holidays, not opportunities.</p>
    <div class="warn"><b>Honest status: promising but unproven</b> (2 premium sessions). Costs don't kill
    the big winners (+19…+57% survive ~2–4% friction), but nothing here is tradeable as specified yet:
    no pre-registered single rule, hindsight-picked "best" rows, stops not applied. Next: freeze ONE rule,
    backfill it on 20 sessions of Fyers candles, paper-trade 10–20 sessions.</div>
    <h2>Caveats</h2>
    <div class="warn">Fixed-contract rows are one tradable contract (Fyers 5m candles, oi_flag=1).
    Rolling-ATM fallback rows (if any) carry small strike-roll jumps. Oct 14 tape ends 14:52 — tape-only
    rows after that are unpriced. Oct 13 tape has no ATM LTP (excluded from premium study).
    Index has no volume in the yfinance feed, so VWAP = session average-price line. n=2 premium sessions: treat
    ranks as case studies, not statistics. Fyers token is daily — if it lapses the script falls back to tape.</div>
    </body></html>"""
    (OUT / "NIFTY_ENTRY_EDA_report.html").write_text(html)
    print(f"report -> {OUT / 'NIFTY_ENTRY_EDA_report.html'} ({len(html)//1024} KB)")
    for (index, day), res in results.items():
        n = sum(1 for c in res["cands"] if "entry_px" in c)
        print(index, day, f"{n}/{len(res['cands'])} priced, fig {res['fig']}")

if __name__ == "__main__":
    main()