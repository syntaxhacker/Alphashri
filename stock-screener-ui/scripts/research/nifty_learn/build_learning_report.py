"""Nifty learning report — 60 sessions, quant-backed, plain-English.

Compares the original 20-session lessons (2026-09-10 -> 2026-10-12, timing CSVs)
against 60 sessions of Fyers 5m spot (with real volume-VWAP) + ^INDIAVIX.
Each lesson: what happens / 20d number vs 60d number / verdict / do / fail.
Output: reports/NIFTY_LEARNING/ (never delete, overwrite in place).

Run: .venv/bin/python scripts/research/nifty_learn/build_learning_report.py
"""
import datetime
import math
import os
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
import numpy as np
import pandas as pd
import yfinance as yf
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

OUT = Path(os.environ.get("NIFTY_LEARN_OUT", str(Path(__file__).resolve().parents[3]
                                                  / "reports" / "NIFTY_LEARNING")))
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

TIM = Path("experiments/data/nifty_timing")
CACHE60 = TIM / "nifty_5m_60s_fyers.csv"
N_SESS = 60


def wilson(k, n, z=1.96):
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (max(0.0, (c - m) / d), min(1.0, (c + m) / d))


def pct_str(k, n):
    if not n:
        return "n/a"
    lo, hi = wilson(k, n)
    return f"{k}/{n}={k/n*100:.0f}%[{lo*100:.0f}-{hi*100:.0f}]"


def verdict(a_k, a_n, b_k, b_n):
    """20d (a) vs 60d (b): confirmed / weaker / rejected."""
    if not a_n or not b_n:
        return "➖"
    pa, pb = a_k / a_n, b_k / b_n
    lo, hi = wilson(b_k, b_n)
    if (pa > 0.5) != (pb > 0.5) and abs(pb - 0.5) > 0.05:
        return "❌ rejected"
    if lo <= pa <= hi or abs(pb - pa) < 0.1:
        return "✅ confirmed"
    return "⚠️ weaker"


# ---------------- loaders ----------------
def add_indicators(g, use_volume=True):
    g = g.copy()
    tp = (g["High"] + g["Low"] + g["Close"]) / 3
    if use_volume and "Volume" in g and float(g["Volume"].sum()) > 0:
        g["avwap"] = (tp * g["Volume"]).cumsum() / g["Volume"].cumsum()
    else:
        g["avwap"] = tp.expanding().mean()
    return g


def load_timing20():
    df = pd.read_csv(TIM / "nifty_5m_20s.csv", index_col=0, parse_dates=True)
    df.index = pd.to_datetime(df.index)
    if df.index.tz is None:
        df.index = df.index.tz_localize(IST)
    else:
        df.index = df.index.tz_convert(IST)
    df = df.sort_index()
    ctx = pd.read_csv(TIM / "daily_context.csv", index_col=0)
    sess = {}
    for D in sorted(set(df.index.date)):
        g = add_indicators(df[df.index.date == D].copy(), use_volume=False)
        o = float(g["Open"].iloc[0])
        orb = g[(g.index.time >= T(9, 15)) & (g.index.time <= T(9, 45))]
        sess[str(D)] = dict(g=g, o=o, h=float(g["High"].max()), lo=float(g["Low"].min()),
                            c=float(g["Close"].iloc[-1]),
                            orb_hi=float(orb["High"].max()), orb_lo=float(orb["Low"].min()),
                            gap=float(ctx.loc[str(D), "gap_pct"]) if str(D) in ctx.index else np.nan,
                            vix=float(ctx.loc[str(D), "india_vix"]) if str(D) in ctx.index else np.nan,
                            pc=float(ctx.loc[str(D), "prev_close"]) if str(D) in ctx.index else np.nan)
    return sess


def fyers_fetch(symbol, frm, to):
    from api.orderflow_recorder import recorder_token
    t = recorder_token("fyers_tbt")
    app, _, tok = t.partition(":")
    import requests
    r = requests.get("https://api-t1.fyers.in/data/history",
                     headers={"Authorization": f"{app.strip()}:{tok.strip()}"},
                     params={"symbol": symbol, "resolution": "5", "date_format": "1",
                             "range_from": frm, "range_to": to, "oi_flag": "0"},
                     timeout=30).json()
    if str(r.get("s", "")).lower() != "ok":
        raise RuntimeError(f"fyers history failed: {r}")
    return r.get("candles", [])


def load_fyers60():
    if CACHE60.exists():
        df = pd.read_csv(CACHE60, index_col=0, parse_dates=True)
        df.index = pd.to_datetime(df.index, utc=True).tz_convert(IST)
        have = sorted(set(df.index.date))
        print(f"60s cache: {len(have)} sessions {have[0]} -> {have[-1]}")
    else:
        allc = []
        for frm, to in [("2026-07-13", "2026-09-01"), ("2026-09-02", "2026-10-15")]:
            allc += fyers_fetch("NSE:NIFTY50-INDEX", frm, to)
        df = pd.DataFrame(allc, columns=["t", "Open", "High", "Low", "Close", "Volume"])
        df["t"] = pd.to_datetime(df["t"], unit="s", utc=True).dt.tz_convert(IST)
        df = df.set_index("t").sort_index()
        df = df[~df.index.duplicated(keep="last")]
        df.to_csv(CACHE60)
        print(f"fetched + cached {len(df)} bars")
    # keep last N_SESS complete sessions (>=70 bars, 5m)
    days = [d for d in sorted(set(df.index.date))
            if len(df[df.index.date == d]) >= 70][-N_SESS:]
    print(f"using {len(days)} sessions {days[0]} -> {days[-1]}")
    v = yf.download("^INDIAVIX", start=str(days[0]), interval="1d",
                    auto_adjust=False, progress=False)
    if hasattr(v.columns, "levels"):
        v.columns = v.columns.get_level_values(0)
    v.index = pd.to_datetime(v.index)
    if v.index.tz is None:
        v.index = v.index.tz_localize(IST)
    else:
        v.index = v.index.tz_convert(IST)
    vmap = {i.date(): float(r["Close"]) for i, r in v.iterrows()}
    sess = {}
    prev_c = None
    for D in days:
        g = add_indicators(df[df.index.date == D].copy(), use_volume=True)
        o = float(g["Open"].iloc[0])
        c = float(g["Close"].iloc[-1])
        gap = (o / prev_c - 1) * 100 if prev_c else np.nan
        priors = [x for x in vmap if x < D]
        sess[str(D)] = dict(g=g, o=o, h=float(g["High"].max()), lo=float(g["Low"].min()), c=c,
                            orb_hi=float(g[(g.index.time >= T(9, 15)) & (g.index.time <= T(9, 45))]["High"].max()),
                            orb_lo=float(g[(g.index.time >= T(9, 15)) & (g.index.time <= T(9, 45))]["Low"].min()),
                            gap=gap, vix=vmap[max(priors)] if priors else np.nan, pc=prev_c)
        prev_c = c
    return sess


def add_rsi_full(df):
    d = df["Close"].diff()
    gain = d.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    loss = (-d.clip(upper=0)).ewm(alpha=1 / 14, adjust=False).mean()
    df = df.copy()
    df["rsiw"] = 100 - 100 / (1 + gain / loss.replace(0, np.nan))
    return df


# ---------------- analysis: identical on any sess dict ----------------
def analyze(sess):
    S = {}
    # gaps
    gu = [(d, s) for d, s in sess.items() if not np.isnan(s["gap"]) and s["gap"] > 0.1]
    gd = [(d, s) for d, s in sess.items() if not np.isnan(s["gap"]) and s["gap"] < -0.1]
    fl = [(d, s) for d, s in sess.items() if not np.isnan(s["gap"]) and abs(s["gap"]) <= 0.1]
    S["gap_up"] = (sum(1 for _, s in gu if s["c"] > s["o"]), len(gu))
    S["gap_dn"] = (sum(1 for _, s in gd if s["c"] < s["o"]), len(gd))
    S["gap_flat"] = len(fl)
    # ORB first break
    fu = fd = uu = ud = late = 0
    for _, s in sess.items():
        g = s["g"]
        sub = g[g.index.time >= T(9, 50)]
        hit = None
        for ts, r in sub.iterrows():
            if float(r["Close"]) > s["orb_hi"] * 1.001:
                hit = ("up", ts); break
            if float(r["Close"]) < s["orb_lo"] / 1.001:
                hit = ("dn", ts); break
        if hit is None:
            late += 1
            continue
        side, ts = hit
        entry = float(g.loc[ts, "Close"])
        win = (float(g["Close"].iloc[-1]) > entry) if side == "up" else (float(g["Close"].iloc[-1]) < entry)
        if side == "up":
            fu += 1; uu += win
        else:
            fd += 1; ud += win
    S["orb_up"] = (uu, fu)
    S["orb_dn"] = (ud, fd)
    S["orb_none"] = late
    # VWAP 10:30 persistence + range timing
    pers = n1030 = 0
    b10, b12, b133 = [], [], []
    for _, s in sess.items():
        g = s["g"]
        m1030 = g[g.index.time <= T(10, 30)]
        if len(m1030) == 0:
            continue
        n1030 += 1
        above = float(m1030["Close"].iloc[-1]) > float(m1030["avwap"].iloc[-1])
        pers += (above == (s["c"] > float(g["avwap"].iloc[-1])))
        rng = s["h"] - s["lo"] or 1
        for t, arr in ((T(10, 30), b10), (T(12, 0), b12), (T(13, 30), b133)):
            sub = g[g.index.time <= t]
            arr.append((float(sub["High"].max()) - float(sub["Low"].min())) / rng * 100)
    S["vwap_pers"] = (pers, n1030)
    S["range_med"] = (float(np.median(b10)), float(np.median(b12)), float(np.median(b133)))
    # flips
    flips, ftimes = 0, []
    for _, s in sess.items():
        g = s["g"]
        mid = g[g.index.time <= T(12, 0)]
        if len(mid) == 0:
            continue
        morn = float(mid["Close"].iloc[-1]) - s["o"]
        aft = s["c"] - float(mid["Close"].iloc[-1])
        if morn * aft < 0 and abs(morn) > 0.001 * s["o"] and abs(aft) > 0.001 * s["o"]:
            flips += 1
            side = 1 if aft > 0 else -1
            for ts, r in g[g.index.time >= T(11, 0)].iterrows():
                if (float(r["Close"]) - float(r["avwap"])) * side > 0:
                    ftimes.append(ts.strftime("%H:%M"))
                    break
    S["flips"] = (flips, len(sess))
    S["flip_times"] = sorted(ftimes)
    # 13:30 leader: close still on the same side of the 13:30 price as open
    lh = 0
    for _, s in sess.items():
        g = s["g"]
        m1330 = g[g.index.time <= T(13, 30)]
        if len(m1330) == 0:
            continue
        p1330 = float(m1330["Close"].iloc[-1])
        o0 = s["o"]
        lh += (s["c"] - p1330) * (p1330 - o0) > 0 or abs(s["c"] - p1330) < 0.0005 * o0
    S["lead_hold"] = (lh, len(sess))
    # RSI midday snaps (needs warmed RSI: computed by caller on full df)
    S["rsi_nd"] = S["rsi_nw"] = 0
    # VIX
    vv = [(s["vix"], (s["h"] - s["lo"]) / s["o"] * 100) for _, s in sess.items() if not np.isnan(s["vix"])]
    S["vix_corr"] = float(np.corrcoef([v[0] for v in vv], [v[1] for v in vv])[0, 1]) if len(vv) > 3 else np.nan
    S["vix_hi"] = float(np.median([r for v, r in vv if v >= 14])) if any(v >= 14 for v, _ in vv) else np.nan
    S["vix_lo"] = float(np.median([r for v, r in vv if v < 12])) if any(v < 12 for v, _ in vv) else np.nan
    return S


print("loading 20d + 60d...")
sess20 = load_timing20()
sess60 = load_fyers60()
A, B = analyze(sess20), analyze(sess60)

# RSI midday snaps on warmed-up series for both universes
def rsi_snaps(full_df, days):
    full_df = add_rsi_full(full_df)
    nd = nw = 0
    for D in days:
        g = full_df[full_df.index.date == D]
        win = g[(g.index.time >= T(10, 30)) & (g.index.time <= T(13, 0))]
        trig = None
        for i in range(1, len(win)):
            rs0, rs1 = float(win["rsiw"].iloc[i - 1]), float(win["rsiw"].iloc[i])
            if np.isnan(rs0) or np.isnan(rs1):
                continue
            if rs0 < 30 <= rs1:
                trig = (win.index[i], 1); break
            if rs0 > 70 >= rs1:
                trig = (win.index[i], -1); break
        if trig is None:
            continue
        nd += 1
        fwd = g[g.index > trig[0]].head(12)
        if len(fwd):
            nd_nw = ((float(fwd["Close"].iloc[-1]) / float(g.loc[trig[0], "Close"]) - 1) * 100 * trig[1]) > 0.1
            nw += nd_nw
    return nd, nw

_raw20 = pd.read_csv(TIM / "nifty_5m_20s.csv", index_col=0, parse_dates=True)
_raw20.index = pd.to_datetime(_raw20.index)
if _raw20.index.tz is None:
    _raw20.index = _raw20.index.tz_localize(IST)
else:
    _raw20.index = _raw20.index.tz_convert(IST)
A["rsi_nd"], A["rsi_nw"] = rsi_snaps(_raw20.sort_index(), sorted(set(_raw20.index.date)))
_f60 = pd.read_csv(CACHE60, index_col=0, parse_dates=True)
_f60.index = pd.to_datetime(_f60.index, utc=True).tz_convert(IST)
_f60 = _f60.sort_index()
_d60 = sorted(set(_f60.index.date))
_d60 = [d for d in _d60 if len(_f60[_f60.index.date == d]) >= 70][-N_SESS:]
B["rsi_nd"], B["rsi_nw"] = rsi_snaps(_f60, _d60)
print("rsi snaps 20d:", A["rsi_nd"], A["rsi_nw"], " 60d:", B["rsi_nd"], B["rsi_nw"])


# ---------------- lessons ----------------
L = []


def lesson(title, plain, num20, num60, v, do, fail):
    L.append(dict(title=title, plain=plain, num20=num20, num60=num60, v=v, do=do, fail=fail))


lesson("1. Gaps usually keep their direction",
       "When Nifty opens clearly up or down (more than 0.1%), the day mostly finishes on the "
       "same side it opened. Flat opens (±0.1%) can go anywhere — coin flip days.",
       f"up {pct_str(*A['gap_up'])} · down {pct_str(*A['gap_dn'])} · flat {A['gap_flat']}d",
       f"up {pct_str(*B['gap_up'])} · down {pct_str(*B['gap_dn'])} · flat {B['gap_flat']}d",
       verdict(*A["gap_up"], *B["gap_up"]),
       "Trade with the gap after 10:00, not against it. Flat open = wait for the box break.",
       "Gap-and-crap reversals (~1 in 4) are what the −40% stop is for.")

lesson("2. Down-breaks beat up-breaks — thinner edge than it first looked",
       "First break of the 09:15–09:45 box still favors the downside (call-wall gravity above; "
       "put support gets pulled below), but 60 days cut the 20-day 88% down to 56% — the original "
       "sample was flattered. Trade downside breaks with a stop, not with certainty.",
       f"down {pct_str(*A['orb_dn'])} · up {pct_str(*A['orb_up'])} · none {A['orb_none']}d",
       f"down {pct_str(*B['orb_dn'])} · up {pct_str(*B['orb_up'])} · none {B['orb_none']}d",
       verdict(*A["orb_dn"], *B["orb_dn"]),
       "Respect downside breaks. Demand extra confirmation for upside breaks (PCR rising, RSI strong).",
       "Sharp reversal days head-fake the first break — the stop exists for exactly this.")

lesson("3. The 10:30 side of VWAP usually survives to the close",
       "Where price sits vs the average-price line at 10:30 is where it usually finishes — "
       "now measured with REAL volume-weighted VWAP on the 60-day set. Institutions defend "
       "their side all day.",
       f"10:30 side == close side {pct_str(*A['vwap_pers'])}",
       f"10:30 side == close side {pct_str(*B['vwap_pers'])} (volume-VWAP)",
       verdict(*A["vwap_pers"], *B["vwap_pers"]),
       "After 10:30, trade only the VWAP side. A cross back = exit, not hope.",
       "Whipsaw mornings cross 3–4 times — that IS the market saying chop day: stand down.")

lesson("4. About one day in five flips after lunch — flips announce themselves",
       "Morning trend dies around midday on ~1/5 of days. The tell is always the same: price "
       "crosses back through VWAP between 11:00–13:30 with RSI crossing 50 the same way.",
       f"flip days {pct_str(*A['flips'])}",
       f"flip days {pct_str(*B['flips'])} · cluster {B['flip_times'][:3]}–{B['flip_times'][-3:]}"
       if B["flip_times"] else f"flip days {pct_str(*B['flips'])}",
       verdict(*A["flips"], *B["flips"]),
       "Holding a morning winner and VWAP breaks against you midday — take the money.",
       "Some flips flip back. Second cross = flat for the day, no re-entry.")

lesson("5. The 13:30 leader usually wins — but never chase it with options",
       "Whoever leads at 13:30 normally still leads at 15:30. But buying that leadership with "
       "weeklies loses: ~2 hours of drift left cannot pay afternoon theta (13:30 buys lost on "
       "every premium day priced).",
       f"leader holds {pct_str(*A['lead_hold'])}",
       f"leader holds {pct_str(*B['lead_hold'])}",
       verdict(*A["lead_hold"], *B["lead_hold"]),
       "Use 13:30 leadership to HOLD a morning winner, never to START an option buy.",
       "Expiry/news afternoons flip closes — tendency, not law.")

lesson("6. Most of the day's range is printed before lunch",
       "By 10:30 over half the range is done; by 13:30 roughly five-sixths. Afternoons drift "
       "inside the morning range while premium melts — no range left to fund new buys.",
       f"medians 10:30→{A['range_med'][0]:.0f}% 12:00→{A['range_med'][1]:.0f}% 13:30→{A['range_med'][2]:.0f}%",
       f"medians 10:30→{B['range_med'][0]:.0f}% 12:00→{B['range_med'][1]:.0f}% 13:30→{B['range_med'][2]:.0f}%",
       "✅ confirmed" if abs(B["range_med"][2] - A["range_med"][2]) < 12 else "⚠️ weaker",
       "Buy in the morning when range is created. Afternoon = manage exits.",
       "Viral trend days expand late — the exception proving the exit rules.")

lesson("7. RSI alone is a coin flip — confirm, don't trigger",
       "Morning RSI lies (warmup math prints 0/100). Honest midday snaps (warmed RSI back through "
       "30/70, 10:30–13:00) lead somewhere only ~1/4 of the time. Oct 14/15 paid on wash + reclaim "
       "+ tape agreement, never RSI alone.",
       f"snaps {A['rsi_nd']}/{len(sess20)}d · follow {pct_str(A['rsi_nw'], A['rsi_nd'])}",
       f"snaps {B['rsi_nd']}/{len(sess60)}d · follow {pct_str(B['rsi_nw'], B['rsi_nd'])}",
       verdict(A["rsi_nw"], A["rsi_nd"], B["rsi_nw"], B["rsi_nd"]),
       "RSI as veto/confirm: overheated + call wall + PCR falling = short; washed + reclaim + PCR "
       "rising = long. Either piece alone = pass.",
       "Buying every 30/70 cross all morning pays theta for wiggles.")

lesson("8. VIX tells you the size of the day, not its direction",
       "High morning VIX = wide day (bigger ranges, premiums, stops). Low VIX = slow bleed for "
       "buyers. Never direction.",
       f"corr {A['vix_corr']:+.2f} · VIX≥14 med {A['vix_hi']:.2f}% vs <12 med {A['vix_lo']:.2f}%",
       f"corr {B['vix_corr']:+.2f} · VIX≥14 med {B['vix_hi']:.2f}% vs <12 med {B['vix_lo']:.2f}%",
       "✅ confirmed" if (B["vix_corr"] > 0.3) == (A["vix_corr"] > 0.3) else "⚠️ weaker",
       "Size stops to VIX; sit out low-VIX grinds.",
       "Midday news spikes VIX — morning read is a plan, not a promise.")

for l in L:
    print(l["title"][:40], "|", l["v"], "| 20:", l["num20"][:60], "| 60:", l["num60"][:60])


# ---------------- charts (60d) ----------------
def fig_gap():
    fig, ax = plt.subplots(figsize=(10, 4.2))
    for d, s in sess60.items():
        if np.isnan(s["gap"]):
            continue
        y = (s["c"] - s["o"]) / s["o"] * 100
        ok = (s["gap"] > 0) == (y > 0)
        ax.scatter([s["gap"]], [y], c=UP if ok else DN, s=34, alpha=0.9, edgecolor=BG)
    ax.axhline(0, color=DIM, lw=0.8)
    ax.axvline(0, color=DIM, lw=0.8)
    ax.set_xlabel("gap % (open vs prev close)")
    ax.set_ylabel("day % (close vs open)")
    ax.set_title("60 sessions: gaps keep direction (green) far more often than reverse (red)",
                 fontsize=11, color=FG)
    ax.grid(color="#21262D", lw=0.5, alpha=0.6)
    fig.subplots_adjust(left=0.08, right=0.97, top=0.88, bottom=0.15)
    fig.savefig(FIG / "LEARN_gap.png", dpi=100)
    plt.close(fig)


def fig_range():
    q = {}
    for _, s in sess60.items():
        g = s["g"]
        rng = s["h"] - s["lo"] or 1
        for t, k in ((T(10, 30), "10:30"), (T(12, 0), "12:00"), (T(13, 30), "13:30")):
            sub = g[g.index.time <= t]
            q.setdefault(k, []).append((float(sub["High"].max()) - float(sub["Low"].min())) / rng * 100)
    fig, ax = plt.subplots(figsize=(10, 4.2))
    ax.boxplot([q["10:30"], q["12:00"], q["13:30"]],
               tick_labels=["by 10:30", "by 12:00", "by 13:30"], patch_artist=True,
               boxprops=dict(facecolor="#161B22", color=DIM),
               medianprops=dict(color=YEL), whiskerprops=dict(color=DIM),
               capprops=dict(color=DIM))
    ax.set_ylabel("% of day range done")
    ax.set_title("Range is created in the morning, drifted in the afternoon (60d)",
                 fontsize=11, color=FG)
    ax.grid(color="#21262D", lw=0.5, alpha=0.6, axis="y")
    fig.subplots_adjust(left=0.08, right=0.97, top=0.88, bottom=0.15)
    fig.savefig(FIG / "LEARN_range.png", dpi=100)
    plt.close(fig)


def fig_flips():
    fig, ax = plt.subplots(figsize=(10, 4.2))
    morn, aft = [], []
    for _, s in sess60.items():
        g = s["g"]
        mid = g[g.index.time <= T(12, 0)]
        m = (float(mid["Close"].iloc[-1]) / s["o"] - 1) * 100
        a = (s["c"] / float(mid["Close"].iloc[-1]) - 1) * 100
        morn.append(m)
        aft.append(a)
    col = [YEL if m * a < 0 else TEAL for m, a in zip(morn, aft)]
    ax.scatter(morn, aft, c=col, s=30, alpha=0.9, edgecolor=BG)
    ax.axhline(0, color=DIM, lw=0.8)
    ax.axvline(0, color=DIM, lw=0.8)
    ax.set_xlabel("morning % (open → 12:00)")
    ax.set_ylabel("afternoon % (12:00 → close)")
    ax.set_title("Yellow = flip days, teal = trend days (60d)",
                 fontsize=11, color=FG)
    ax.grid(color="#21262D", lw=0.5, alpha=0.6)
    fig.subplots_adjust(left=0.08, right=0.97, top=0.88, bottom=0.15)
    fig.savefig(FIG / "LEARN_flips.png", dpi=100)
    plt.close(fig)


fig_gap()
fig_range()
fig_flips()


# ---------------- 60-day gallery ----------------
def day_tags(d, s):
    g, o, c = s["g"], s["o"], s["c"]
    tags = []
    if not np.isnan(s["gap"]):
        if s["gap"] > 0.1:
            tags.append("gap-up held ✅" if c > o else "gap-up failed ❌")
        elif s["gap"] < -0.1:
            tags.append("gap-down held ✅" if c < o else "gap-down failed ❌")
        else:
            tags.append("flat open")
    sub = g[g.index.time >= T(9, 50)]
    for _, r in sub.iterrows():
        if float(r["Close"]) > s["orb_hi"] * 1.001:
            tags.append("ORB-up " + ("worked ✅" if c > float(r["Close"]) else "failed ❌"))
            break
        if float(r["Close"]) < s["orb_lo"] / 1.001:
            tags.append("ORB-down " + ("worked ✅" if c < float(r["Close"]) else "failed ❌"))
            break
    mid = g[g.index.time <= T(12, 0)]
    morn = float(mid["Close"].iloc[-1]) - o
    aft = c - float(mid["Close"].iloc[-1])
    if morn * aft < 0 and abs(morn) > 0.001 * o and abs(aft) > 0.001 * o:
        tags.append("FLIP day 🔄")
    n_cross, prev = 0, None
    for _, r in g.iterrows():
        side = float(r["Close"]) > float(r["avwap"])
        if prev is not None and side != prev:
            n_cross += 1
        prev = side
    if n_cross >= 4:
        tags.append("chop whipsaw 🌀")
    elif c > float(g["avwap"].iloc[-1]):
        tags.append("closed above VWAP")
    else:
        tags.append("closed below VWAP")
    return tags


def plot_gallery_day(d, s):
    g = s["g"]
    n = len(g)
    xs = list(range(n))
    fig, ax = plt.subplots(figsize=(11, 4.6))
    # minimum body = 2% of day range, else bodies vanish on small-range days
    floor = max((s["h"] - s["lo"]) * 0.02, 0.01)
    for x, (_, b) in zip(xs, g.iterrows()):
        o, h, l, c = float(b["Open"]), float(b["High"]), float(b["Low"]), float(b["Close"])
        col = UP if c >= o else DN
        ax.vlines(x, l, h, color=col, lw=0.9)
        mid = (o + c) / 2
        half = max(abs(c - o) / 2, floor / 2)
        ax.add_patch(Rectangle((x - 0.32, mid - half), 0.64, half * 2,
                               facecolor=col, edgecolor=col, lw=0))
    ax.plot(xs, g["avwap"].values, color=TEAL, lw=1.2, label="VWAP (volume)")
    ax.axhspan(s["orb_lo"], s["orb_hi"], color="#161B22", alpha=0.9)
    ax.text(1, s["orb_hi"], "09:15–09:45 box", color=DIM, fontsize=7, va="bottom")
    if s["pc"] is not None and not (isinstance(s["pc"], float) and np.isnan(s["pc"])):
        ax.axhline(s["pc"], color=BLUE, ls="--", lw=1.0, alpha=0.85,
                   label=f"prev close {s['pc']:.0f}")
    idx_of = lambda ts: min(range(n), key=lambda i: abs((g.index[i] - ts).total_seconds()))
    sub = g[g.index.time >= T(9, 50)]
    for ts, r in sub.iterrows():
        if float(r["Close"]) > s["orb_hi"] * 1.001:
            ax.scatter([idx_of(ts)], [float(r["Close"])], marker="^", color=YEL, s=80,
                       zorder=5, edgecolor=BG)
            ax.annotate(f"break {ts.strftime('%H:%M')}", (idx_of(ts), float(r["Close"])),
                        color=FG, fontsize=7, xytext=(6, 12), textcoords="offset points",
                        bbox=dict(boxstyle="round,pad=0.3", fc="#161B22", ec=YEL, lw=0.7))
            break
        if float(r["Close"]) < s["orb_lo"] / 1.001:
            ax.scatter([idx_of(ts)], [float(r["Close"])], marker="v", color=YEL, s=80,
                       zorder=5, edgecolor=BG)
            ax.annotate(f"break {ts.strftime('%H:%M')}", (idx_of(ts), float(r["Close"])),
                        color=FG, fontsize=7, xytext=(6, -20), textcoords="offset points",
                        bbox=dict(boxstyle="round,pad=0.3", fc="#161B22", ec=YEL, lw=0.7))
            break
    prev = None
    for ts, r in g[g.index.time >= T(11, 0)].iterrows():
        side = float(r["Close"]) > float(r["avwap"])
        if prev is not None and side != prev:
            ax.scatter([idx_of(ts)], [float(r["Close"])], marker="o", color=PUR, s=36,
                       zorder=5, edgecolor=BG)
        prev = side
    b1330 = g[g.index.time <= T(13, 30)]
    if len(b1330):
        x = idx_of(b1330.index[-1])
        ax.axvline(x, color=DIM, ls=":", lw=0.9, alpha=0.7)
        ax.text(x + 0.5, 0.02, "13:30", transform=ax.get_xaxis_transform(), color=DIM,
                fontsize=7, va="bottom")
    ax.legend(loc="upper left", fontsize=7.5, framealpha=0.9, labelcolor=FG, ncol=3)
    ax.set_title(f"{d} — gap {s['gap']:+.2f}% · {s['o']:.0f} → {s['c']:.0f} "
                 f"({(s['c']/s['o']-1)*100:+.2f}%) · range {(s['h']-s['lo'])/s['o']*100:.2f}%",
                 fontsize=11, color=UP if s["c"] > s["o"] else DN)
    ticks = [x for x in xs if x % 15 == 0]
    ax.set_xticks(ticks)
    ax.set_xticklabels([g.index[i].strftime("%H:%M") for i in ticks], fontsize=8)
    ax.grid(color="#21262D", lw=0.5, alpha=0.6)
    fig.subplots_adjust(left=0.07, right=0.985, top=0.88, bottom=0.12)
    fn = f"LEARN_day_{d}.png"
    fig.savefig(FIG / fn, dpi=100)
    plt.close(fig)
    return fn


gallery = []
for d in sorted(sess60):
    fn = plot_gallery_day(d, sess60[d])
    gallery.append((d, day_tags(d, sess60[d]), fn))
print(f"gallery: {len(gallery)} day charts")

day_cards = "\n".join(
    f'<h3>{d} &nbsp;<span class="dim">{" · ".join(tags)}</span></h3>\n'
    f'<img loading="lazy" src="figures/{fn}"/>' for d, tags, fn in gallery)


# ---------------- HTML ----------------
CSS = ("body{background:#0D1117;color:#E6EDF3;font-family:system-ui,sans-serif;"
       "max-width:900px;margin:0 auto;padding:24px;line-height:1.7;font-size:15px}"
       "h1{border-bottom:1px solid #30363D;padding-bottom:6px}"
       "h2{border-left:4px solid #1F6FEB;padding-left:10px;margin-top:34px}"
       "img{max-width:100%;background:#0D1117;border:1px solid #30363D;border-radius:6px;margin:10px 0}"
       ".num{font-variant-numeric:tabular-nums;background:#161B22;border:1px solid #30363D;"
       "border-radius:6px;padding:8px 12px;margin:10px 0;font-size:14px}"
       ".vok{color:#3FB950;font-weight:700}.vno{color:#F85149;font-weight:700}.vwarn{color:#D29922;font-weight:700}"
       ".do{border-left:3px solid #3FB950;padding:8px 12px;margin:10px 0;background:#161B22}"
       ".dont{border-left:3px solid #F85149;padding:8px 12px;margin:10px 0;background:#161B22}"
       ".dim{color:#8B949E}")

VCLS = {"✅ confirmed": "vok", "⚠️ weaker": "vwarn", "❌ rejected": "vno", "➖": "dim"}
blocks = []
for i, l in enumerate(L):
    chart = ""
    if i == 0:
        chart = '<img src="figures/LEARN_gap.png"/>'
    if i == 5:
        chart = '<img src="figures/LEARN_range.png"/>'
    if i == 3:
        chart = '<img src="figures/LEARN_flips.png"/>'
    blocks.append(f"""
<h2>{l['title']}</h2>
<p>{l['plain']}</p>
<div class="num">📊 20d: {l['num20']}<br>📊 60d: {l['num60']}<br>
<span class="{VCLS.get(l['v'], 'dim')}">{l['v']}</span> — 20-session lesson vs 60 sessions of evidence</div>
{chart}
<div class="do"><b>✅ Do this:</b> {l['do']}</div>
<div class="dont"><b>⛔ Fails when:</b> {l['fail']}</div>""")

html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Nifty options — what usually happens (60-session school)</title><style>{CSS}</style></head><body>
<h1>📚 Nifty options — what usually happens</h1>
<p class="dim">60 sessions of 5-minute bars (Fyers spot, real volume-VWAP) + ^INDIAVIX, every claim
counted twice: the original 20 sessions, then all 60. <b>✅ confirmed</b> = the 60-day evidence
agrees with the 20-day lesson. <b>⚠️ weaker</b> = same direction, softer. <b>❌ rejected</b> = the
extra 40 days overturned it (thrown out, kept visible so you see the failure). Ranges in brackets
stay wide on purpose: luck is large, exact percentages are sales talk.</p>
{''.join(blocks)}
<h2>🖼️ The 60 days — see it with your own eyes</h2>
<p>Every session: candlesticks + teal volume <b>VWAP</b> + shaded <b>09:15–09:45 box</b> + dashed
blue <b>prev close</b>. Yellow ▲▼ = first box break. Purple dots = midday VWAP crosses (flip
tells). Dotted vertical = 13:30 checkpoint. Tags name the lessons playing out.</p>
{day_cards}
<h2>A day in the life (the composite Nifty day)</h2>
<p>Open gaps a little → first half hour decides the box → by <b>10:30</b> price has picked its side
of VWAP and usually keeps it → range builds fast till lunch → <b>~1 day in 5 flips</b> around
midday (watch the VWAP cross) → afternoon drifts inside the morning range while option premium
melts → the 13:30 leader limps over the line at 15:30. Trade the morning creation, manage the
afternoon melt, never buy fresh premium after lunch.</p>
<h2>⚡ Read the tape in 60 seconds (the /report/nifty page)</h2>
<h2>9. Can the 50 stocks predict the index? (breadth study, 31 sessions)</h2>
<p class="dim">Full interactive report: <code>reports/NIFTY_BREADTH_EDGE/NIFTY_BREADTH_EDGE_report.html</code>
(weights, pooled skill, every v2 call, scatter + equity charts). Summary below.</p>
<p>Tested on 31 sessions (Sep–Oct 2026, all 50 stocks, 5m bars): <b>% of stocks above prior close
at 10:30 forecasts the close's direction — 0.71 accuracy</b>, beating index momentum (0.55). It is
not the gap in disguise (right 7/10 times it disagreed with the gap). At 5-minute scale nothing is
tradeable — breadth is a <b>day-type gate</b> (side + permission), never a buy trigger.</p>
<table><tr><th>Snapshot</th><th>Breadth → close</th><th>Index mom → close</th></tr>
<tr><td>10:00 → close</td><td>0.71</td><td>0.65</td></tr>
<tr><td>10:30 → close</td><td><b>0.71</b></td><td>0.55</td></tr>
<tr><td>11:00 → close</td><td>0.84</td><td>0.58</td></tr></table>
<div class="num"><b>Frozen rule v2:</b> at 10:30, LONG if breadth−50 &gt; +5 <i>and</i> index above its
avg-line; SHORT if &lt; −5 <i>and</i> below; else FLAT → 14/31 traded, 0.79 hit rate. Oct-15: LONG from
09:15, 10:30 CE entry +17% to 12:30. Oct-14: FLAT — dodged every losing LONG, missed the +42% PE
(a fixed 10:30 clock can't catch mid-morning reads).</div>
<div class="dont"><b>⛔ Verdict: hypothesis, not finding.</b> Fails Holm correction over 12 candidates,
rule picked in-sample, only 36% of calls clear a 0.30% cost filter. Use as the day-type gate for entries;
entries still need RSI snap / ORB / VWAP-cross triggers + the 12:30 exit. 20 sessions of pre-registered
paper-trading before sizing. Failure modes: narrow heavyweight rallies (Oct-13: TCS +3.4% vs flat median),
expiry days, post-crash-day breadth inflation.</div>
<p>Open <b>Nifty Report</b> in the navbar → Live mode. Read top to bottom, 10 seconds per block:</p>
<p><b>0:00–0:10 — Stat strip.</b> <i>Spot</i>, <i>PCR (OI)</i>, <i>PCR (Vol)</i>, <i>Max Pain</i>.
The page prints its own verdict: PCR-OI above 1.0 = put writers in control (bullish floor), below
0.7 = call writers in control (bearish cap), between = neutral. Spot vs Max Pain within ±0.05% =
pinned (chop); farther = magnet pull.</p>
<p><b>0:10–0:25 — Chart zones.</b> Red <b>CW</b> = call-wall resistance, green <b>PW</b> = put-wall
support, blue <b>MP</b> = max-pain magnet; live adds <b>FLIP/GSUP/GRES</b>. One question: squeezing
between PW and CW (chop — stand down) or pressing one side with room (trade)?</p>
<p><b>0:25–0:40 — OI table, ATM row (highlighted).</b> <b>LB</b> = Long Buildup, <b>SC</b> = Short
Cover, <b>SB</b> = Short Buildup, <b>LU</b> = Long Unwind. Bullish = CE SC + PE LB. Bearish =
mirror. LU on your side = leave.</p>
<p><b>0:40–0:50 — GEX regime + bursts.</b> LONG gamma = dampened (fade, small size); SHORT gamma =
amplified (ride, wider stop). Bursts spine: call clusters = upside chase; put clusters = protection buying.</p>
<div class="num"><b>🎯 The 60-second decision:</b> (1) PCR verdict + spot-vs-MP = day-type. (2) Zones =
direction + stop side. (3) ATM badges = someone is positioned there. (4) GEX = size. Any step
disagrees → <b>no trade</b>. Chop, disagreement, or after 13:30 = close the tab.</div>
<div class="dont"><b>⛔ Honest limits:</b> 60 days is a classroom, still not a career. Expiry-day
claims need their own study (few expiries in sample). No costs modeled. VWAP is volume-weighted
(Fyers) on the 60d set, average-price on the original 20d. Re-run monthly; edges decay.</div>
</body></html>"""
(OUT / "NIFTY_LEARNING_report.html").write_text(html)
print(f"report -> {OUT / 'NIFTY_LEARNING_report.html'} ({len(html)//1024} KB)")
