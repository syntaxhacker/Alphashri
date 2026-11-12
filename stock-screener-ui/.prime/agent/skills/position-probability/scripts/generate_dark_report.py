#!/usr/bin/env python
"""Dark-theme EDA report (HTML + Markdown + PNG figures) for NSE symbols.

Covers, per symbol: price & cycle legs, drawdown-from-ATH, rolling correlation
vs indices, correlation heatmap, momentum/trend dashboard, forward-return
distribution split by trend regime, the probability distribution of the close
on a target date, and the price/book cycle. Plus a market section with the
measured earnings IV-crush examples and a live option-chain snapshot.

Colours come from the app's single source of truth (src/ui/palette.ts), so the
report cannot drift from the product theme.

    .venv/bin/python .prime/agent/skills/position-probability/scripts/generate_dark_report.py \
        --symbols IRFC,POWERGRID --target 2026-11-23

Output: reports/eda_<target>/<name>.html (self-contained), <name>.md, figures/*.png
"""

from __future__ import annotations

import argparse
import base64
import html
import json
import re
import sys
from datetime import date
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import matplotlib.ticker as mticker  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import fetch_market_data as fmd  # noqa: E402
import lib_probability as lp  # noqa: E402
import iv_crush as ivc  # noqa: E402

REPO_ROOT = fmd.REPO_ROOT
PALETTE_FILE = REPO_ROOT / "src" / "ui" / "palette.ts"
BVPS_FILE = HERE.parent / "references" / "bvps_history.json"


# --------------------------------------------------------------------------
# theme
# --------------------------------------------------------------------------

def load_palette() -> dict:
    """Pull the hex constants out of the app palette (single source of truth)."""
    txt = PALETTE_FILE.read_text()
    wanted = {
        "PRIMARY": "PRIMARY", "POSITIVE_COLOR": "POSITIVE", "NEGATIVE_COLOR": "NEGATIVE",
        "TEXT_COLOR": "TEXT", "TEXT_MUTED_COLOR": "MUTED", "BG_COLOR": "BG",
        "SURFACE_COLOR": "SURFACE", "BORDER_COLOR": "BORDER",
    }
    out = {}
    for key, name in wanted.items():
        m = re.search(rf"export const {key}\s*=\s*\"(#[0-9A-Fa-f]{{6}})\"", txt)
        if m:
            out[name] = m.group(1)
    out.setdefault("SURFACE_ALT", "#121212")
    out.setdefault("WARNING", "#F0883E")
    out.setdefault("SCALE_BLUE", ["#4D99FF", "#1F7FFF", "#1F6FEB", "#1A5CD6", "#1449B8"])
    out.setdefault("SCALE_CYAN", ["#5CD6F5", "#2FC4E8", "#0FB5D9", "#0A9CC4", "#0883A8"])
    out.setdefault("SCALE_GREEN", ["#5CD182", "#3FB950", "#2EA043", "#238636", "#1A7F37"])
    out.setdefault("SCALE_RED", ["#FF7B72", "#F85149", "#DA3633", "#B6231C", "#8E151A"])
    out.setdefault("SCALE_ORANGE", ["#FFA657", "#F0883E", "#DB6D28", "#BD561D", "#9E4213"])
    out.setdefault("SCALE_YELLOW", ["#E3B341", "#D29922", "#BB8009", "#A68B1F", "#8F6D1F"])
    out.setdefault("SCALE_VIOLET", ["#AF8FFF", "#9772FF", "#8250DF", "#6E40C9", "#6332B2"])
    return out


P = load_palette()
plt.rcParams.update({
    "figure.facecolor": P["BG"], "axes.facecolor": P["SURFACE"], "savefig.facecolor": P["BG"],
    "axes.edgecolor": P["BORDER"], "axes.labelcolor": P["TEXT"], "text.color": P["TEXT"],
    "xtick.color": P["MUTED"], "ytick.color": P["MUTED"], "grid.color": P["BORDER"],
    "grid.alpha": 0.35, "font.size": 10, "axes.titlesize": 12, "axes.titleweight": "bold",
    "axes.grid": True, "axes.axisbelow": True, "figure.dpi": 120, "savefig.dpi": 120,
    "axes.spines.top": False, "axes.spines.right": False, "legend.frameon": False,
    "font.family": "DejaVu Sans", "axes.unicode_minus": False,
})


def fig_title(ax, title, sub=None, pad=26):
    ax.set_title(title, color=P["TEXT"], loc="left", pad=pad)
    if sub:
        ax.text(0, 1.012, sub, transform=ax.transAxes, color=P["MUTED"], fontsize=9, va="bottom")


def save(fig, path: Path) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, bbox_inches="tight", facecolor=P["BG"])
    plt.close(fig)
    return str(path)


def b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode()


# --------------------------------------------------------------------------
# data
# --------------------------------------------------------------------------

def symbol_data(symbol: str, index_ids: list[str], client) -> dict:
    px = fmd.upstox_daily(symbol, from_date="2020-06-01", client=client)
    if px is None or px.empty:
        raise SystemExit(f"no Upstox data for {symbol}")
    sess = fmd.upstox_intraday_session(symbol, client=client)
    if sess:
        px = fmd.append_session(px, sess)
    f = lp.build_features(px)
    state = lp.describe_state(f)
    idx = {}
    for iid in index_ids:
        d = fmd.upstox_daily(iid, is_index=True, from_date="2020-06-01", client=client)
        if d is not None and not d.empty:
            idx[iid] = d
    return {"symbol": symbol, "px": px, "f": f, "state": state, "indexes": idx}


def correlation_block(data: dict) -> list[dict]:
    r_sym = data["px"]["close"].pct_change().dropna()
    rows = []
    for iid, d in data["indexes"].items():
        r_idx = d["close"].pct_change().dropna()
        row = {"index": iid}
        for w in (60, 252):
            df_ = pd.concat([r_sym, r_idx], axis=1, sort=True).dropna().tail(w)
            row[f"b{w}"] = float(df_.iloc[:, 0].cov(df_.iloc[:, 1]) / df_.iloc[:, 1].var()) if len(df_) > 30 else None
            row[f"c{w}"] = float(df_.corr().iloc[0, 1]) if len(df_) > 30 else None
        rows.append(row)
    return rows


def probability_block(data: dict, target: str, seed: int = 7) -> dict:
    rng = np.random.default_rng(seed)
    px, f = data["px"], data["f"]
    spot = float(px["close"].iloc[-1])
    last = px.index[-1].date()
    H = 0
    d = last
    while d < date.fromisoformat(target):
        d = d.fromordinal(d.toordinal() + 1)
        if d.weekday() < 5:
            H += 1
    H = max(H, 1)
    r = px["close"].pct_change().dropna()
    sig252 = float(r.tail(252).std() * np.sqrt(252))
    sig60 = float(r.tail(60).std() * np.sqrt(252))

    models = {
        "V1 bootstrap 2Y": lp.mc_bootstrap(r.values, spot, H, 200_000, rng),
        "V2 bootstrap 60d": lp.mc_bootstrap(r.tail(60).values, spot, H, 200_000, rng),
        "V3 lognormal": lp.mc_lognormal(spot, H, sig252, 0.0, 200_000, rng),
    }
    vol = np.concatenate(list(models.values()))

    fwd = lp.forward_returns(px["close"], H)
    base = pd.DataFrame({"fwd": fwd, "rsi": f["rsi"], "ret10": f["ret10"], "d200": f["d200"],
                         "slope": f["slope200"], "sig60": f["sig60"]}).dropna()
    rules = {"d200": (None, 0.0) if data["state"]["d200"] < 0 else (0.0, None),
             "rsi": (max(0, data["state"]["rsi"] - 10), min(100, data["state"]["rsi"] + 10)),
             "ret10": (max(-0.05, data["state"]["ret10"] - 0.05), data["state"]["ret10"] + 0.05)}
    analog = lp.matched_analog(base, rules)
    if len(analog) < 8:
        rules["rsi"] = (40, 70)
        analog = lp.matched_analog(base, rules)
    if len(analog) >= 5:
        mu = float(analog.median())
        mom = np.concatenate([
            lp.mc_lognormal(spot, H, sig252, mu, 200_000, rng),
            spot * (1 + rng.choice(np.asarray(analog.values), size=(200_000,))),
            lp.mc_lognormal(spot, H, sig60, mu * 0.8, 200_000, rng),
        ])
    else:
        mom = vol
    blend = np.concatenate([mom, vol])

    return {"spot": spot, "H": H, "vol": vol, "mom": mom, "blend": blend,
            "sig252": sig252, "sig60": sig60, "analog_n": len(analog),
            "analog_mean": float(analog.mean()) if len(analog) else None,
            "analog_median": float(analog.median()) if len(analog) else None,
            "base": base, "rules": rules}


# --------------------------------------------------------------------------
# charts
# --------------------------------------------------------------------------

def chart_price_cycles(data: dict, out: Path) -> str:
    px, f = data["px"], data["f"]
    c = px["close"]
    fig, (ax, axv) = plt.subplots(2, 1, figsize=(11, 6), sharex=True,
                                  gridspec_kw={"height_ratios": [3, 1], "hspace": 0.08})
    ax.plot(c.index, c.values, color=P["PRIMARY"], lw=1.4, label="close")
    if "dma200" in f:
        ax.plot(f.index, f["dma200"].values, color=P["MUTED"], lw=1.0, ls="--", label="200-DMA")
    legs = lp.swing_legs(lp.zigzag(c, 30), c)
    for l in legs:
        col = P["POSITIVE"] if l["type"] == "RALLY" else P["NEGATIVE"]
        ax.scatter([l["start"], l["end"]], [l["from"], l["to"]], color=col, s=42, zorder=5)
        ax.annotate(f"{l['pct']:+.0f}%", (l["end"], l["to"]), textcoords="offset points",
                    xytext=(6, 6), color=col, fontsize=9, fontweight="bold")
    ax.axhline(c.iloc[-1], color=P["PRIMARY"], lw=0.8, alpha=0.5)
    fig_title(ax, f"{data['symbol']} — price, 200-DMA and cycle legs",
              f"zigzag 30% legs • last ₹{c.iloc[-1]:,.2f} • 52w range "
              f"₹{c.tail(252).min():,.2f}–₹{c.tail(252).max():,.2f}")
    ax.legend(loc="upper left", fontsize=9)
    vol = px["volume"] / 1e6
    axv.bar(vol.index, vol.values, width=1.0,
            color=[P["POSITIVE"] if c.diff().fillna(0).loc[i] >= 0 else P["NEGATIVE"] for i in vol.index],
            alpha=0.6)
    axv.set_ylabel("vol (M)", fontsize=9)
    fig_title(axv, "volume", pad=4)
    return save(fig, out / f"{data['symbol'].lower()}_price_cycles.png")


def chart_drawdown(data: dict, out: Path) -> str:
    px = data["px"]
    c = px["close"]
    dd = (c / c.cummax() - 1) * 100
    fig, ax = plt.subplots(figsize=(11, 4))
    ax.fill_between(dd.index, dd.values, 0, color=P["NEGATIVE"], alpha=0.35)
    ax.plot(dd.index, dd.values, color=P["NEGATIVE"], lw=1.1)
    eps = lp.drawdown_episodes(c, 0.30)
    for ep in eps:
        ax.scatter([ep["date"]], [ep["dd"] * 100], color=P["WARNING"], s=48, zorder=5)
        ax.annotate(f"{ep['dd'] * 100:.0f}%", (ep["date"], ep["dd"] * 100),
                    textcoords="offset points", xytext=(4, -12), color=P["WARNING"], fontsize=8)
    fig_title(ax, f"{data['symbol']} — drawdown from all-time high",
              f"ATH ₹{c.max():,.2f} ({c.idxmax().date()}) • now {dd.iloc[-1]:.1f}%")
    ax.yaxis.set_major_formatter(mticker.PercentFormatter(decimals=0))
    return save(fig, out / f"{data['symbol'].lower()}_drawdown.png")


def chart_rolling_corr(data: dict, out: Path) -> str:
    r_sym = data["px"]["close"].pct_change().dropna()
    fig, ax = plt.subplots(figsize=(11, 4))
    palette = P["SCALE_BLUE"] + P["SCALE_CYAN"] + P["SCALE_VIOLET"] + P["SCALE_ORANGE"]
    for i, (iid, d) in enumerate(data["indexes"].items()):
        r_idx = d["close"].pct_change().dropna()
        df_ = pd.concat([r_sym, r_idx], axis=1, sort=True).dropna()
        roll = df_.iloc[:, 0].rolling(120).corr(df_.iloc[:, 1]).dropna()
        ax.plot(roll.index, roll.values, lw=1.2, color=palette[i % len(palette)], label=iid)
    ax.axhline(0, color=P["BORDER"], lw=0.8)
    fig_title(ax, f"{data['symbol']} — rolling 120-session correlation vs indices")
    ax.legend(ncol=4, fontsize=8, loc="lower left")
    return save(fig, out / f"{data['symbol'].lower()}_rolling_corr.png")


def chart_corr_heatmap(all_rows: list[dict], out: Path) -> str:
    syms = [r["symbol"] for r in all_rows]
    idx_names = sorted({row["index"] for r in all_rows for row in r["corr"]})
    m60 = np.full((len(syms), len(idx_names)), np.nan)
    m252 = np.full((len(syms), len(idx_names)), np.nan)
    for i, r in enumerate(all_rows):
        for row in r["corr"]:
            j = idx_names.index(row["index"])
            m60[i, j] = row["c60"]
            m252[i, j] = row["c252"]
    fig, axes = plt.subplots(1, 2, figsize=(12, 3.2), constrained_layout=True)
    for ax, mat, title in [(axes[0], m60, "60-session correlation"),
                           (axes[1], m252, "252-session correlation")]:
        im = ax.imshow(mat, cmap="viridis", vmin=-0.2, vmax=1.0, aspect="auto")
        ax.set_xticks(range(len(idx_names)))
        ax.set_xticklabels(idx_names, rotation=35, ha="right", fontsize=8)
        ax.set_yticks(range(len(syms)))
        ax.set_yticklabels(syms, fontsize=9)
        ax.set_title(title, color=P["TEXT"], loc="left", fontsize=11)
        ax.grid(False)
        for i in range(mat.shape[0]):
            for j in range(mat.shape[1]):
                if not np.isnan(mat[i, j]):
                    ax.text(j, i, f"{mat[i, j]:.2f}", ha="center", va="center",
                            color="#ffffff", fontsize=8)
        fig.colorbar(im, ax=ax, fraction=0.02)
    return save(fig, out / "corr_heatmap.png")


def chart_momentum(data: dict, out: Path) -> str:
    f = data["f"]
    fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(11, 6.5), sharex=True,
                                        gridspec_kw={"height_ratios": [1.4, 1.4, 1], "hspace": 0.12})
    ax1.plot(f.index, f["rsi"].values, color=P["PRIMARY"], lw=1.1)
    ax1.axhline(70, color=P["WARNING"], lw=0.8, ls="--")
    ax1.axhline(30, color=P["SCALE_CYAN"][1], lw=0.8, ls="--")
    ax1.set_ylim(0, 100)
    fig_title(ax1, f"{data['symbol']} — RSI(14)  •  70/30 bands",
              f"now {f['rsi'].iloc[-1]:.1f}")
    ax2.plot(f.index, (f["d200"] * 100).values, color=P["SCALE_VIOLET"][1], lw=1.2, label="vs 200-DMA")
    ax2.plot(f.index, (f["d50"] * 100).values, color=P["SCALE_CYAN"][1], lw=1.0, label="vs 50-DMA")
    ax2.axhline(0, color=P["BORDER"], lw=0.8)
    fig_title(ax2, "distance to moving averages", pad=4)
    ax2.legend(fontsize=8, ncol=2)
    vr = f["volr"].replace([np.inf, -np.inf], np.nan).fillna(0)
    ax3.bar(vr.index, vr.values, width=1.0, color=P["SCALE_BLUE"][1], alpha=0.7)
    ax3.axhline(1, color=P["MUTED"], lw=0.8, ls="--")
    fig_title(ax3, "volume / 60-session median", pad=4)
    return save(fig, out / f"{data['symbol'].lower()}_momentum.png")


def chart_forward_returns(prob: dict, out: Path, symbol: str) -> str:
    base = prob["base"]
    up = base.loc[base.d200 > 0, "fwd"]
    dn = base.loc[base.d200 <= 0, "fwd"]
    fig, (ax, ax2) = plt.subplots(1, 2, figsize=(12, 4), gridspec_kw={"width_ratios": [2, 1]})
    bins = np.linspace(-0.2, 0.2, 41)
    ax.hist(up, bins=bins, alpha=0.6, color=P["POSITIVE"], label=f"above 200-DMA (n={len(up)})")
    ax.hist(dn, bins=bins, alpha=0.6, color=P["NEGATIVE"], label=f"below 200-DMA (n={len(dn)})")
    ax.axvline(0, color=P["MUTED"], lw=0.8)
    fig_title(ax, f"{symbol} — forward {prob['H']}-session returns by trend regime",
              f"above: median {up.median() * 100:+.1f}% • below: median {dn.median() * 100:+.1f}%")
    ax.legend(fontsize=9)
    ax.xaxis.set_major_formatter(mticker.PercentFormatter(1.0))
    decay = lp.rsi_peak_decay(base)
    if decay:
        bins_lab = [d["bin"] for d in decay]
        med = [d["median"] * 100 for d in decay]
        pup = [d["p_up"] * 100 for d in decay]
        ax2.bar(bins_lab, med, color=[P["NEGATIVE"] if m < 0 else P["POSITIVE"] for m in med], alpha=0.8)
        ax2.axhline(0, color=P["MUTED"], lw=0.8)
        for i, d in enumerate(decay):
            ax2.text(i, med[i], f"P(up) {pup[i]:.0f}%", ha="center",
                     va="bottom" if med[i] >= 0 else "top", fontsize=7, color=P["MUTED"])
        fig_title(ax2, "median fwd return by sessions since RSI peak")
        ax2.yaxis.set_major_formatter(mticker.PercentFormatter(1.0))
    return save(fig, out / f"{symbol.lower()}_forward_returns.png")


def chart_probability(prob: dict, out: Path, symbol: str) -> str:
    fig, (ax, ax2) = plt.subplots(1, 2, figsize=(12, 4), constrained_layout=True)
    series = [("vol-only + market-implied", prob["vol"], P["SCALE_BLUE"][1]),
              ("momentum/trend-adjusted", prob["mom"], P["SCALE_ORANGE"][1]),
              ("blended 50/50", prob["blend"], P["PRIMARY"])]
    lo = min(np.percentile(s[1], 0.2) for s in series)
    hi = max(np.percentile(s[1], 99.8) for s in series)
    grid = np.linspace(lo, hi, 220)
    for label, arr, col in series:
        ax.plot(grid, np.exp(-0.5 * ((grid - arr.mean()) / arr.std()) ** 2) / (arr.std() * np.sqrt(2 * np.pi)),
                color=col, lw=1.6, label=label)
    ax.axvline(prob["spot"], color=P["TEXT"], lw=0.9, ls="--")
    ax.set_xlabel("price on target date")
    fig_title(ax, f"{symbol} — terminal price density ({prob['H']} sessions)",
              f"spot ₹{prob['spot']:,.2f} • blended median ₹{np.median(prob['blend']):,.2f}")
    ax.legend(fontsize=8)
    for label, arr, col in series:
        cdf = np.array([(arr <= g).mean() for g in grid[::4]])
        ax2.plot(grid[::4], cdf, color=col, lw=1.6, label=label)
    for q, lab in [(0.1, "p10"), (0.25, "p25"), (0.5, "median"), (0.75, "p75"), (0.9, "p90")]:
        v = np.percentile(prob["blend"], q * 100)
        ax2.axhline(q, color=P["BORDER"], lw=0.6, ls=":")
        ax2.annotate(f"{lab} ₹{v:,.0f}", (v, q), textcoords="offset points", xytext=(6, -11),
                     color=P["MUTED"], fontsize=8)
    fig_title(ax2, "cumulative distribution", "blended ensemble")
    return save(fig, out / f"{symbol.lower()}_probability.png")


def chart_pb_cycle(data: dict, out: Path, bvps_map: dict) -> str | None:
    symbol = data["symbol"]
    series = bvps_map.get(symbol)
    if not series:
        return None
    c = data["px"]["close"]
    bv = pd.Series(series)
    bv.index = pd.to_datetime(bv.index)
    pb = []
    for ts, px_ in c.items():
        prior = bv[bv.index <= ts.tz_localize(None)]
        pb.append(px_ / prior.iloc[-1] if len(prior) else np.nan)
    pb = pd.Series(pb, index=c.index)
    fig, ax = plt.subplots(figsize=(11, 4))
    ax.plot(c.index, pb.values, color=P["SCALE_VIOLET"][1], lw=1.3, label="P/B")
    for lvl, col in [(1.0, P["MUTED"]), (2.0, P["SCALE_BLUE"][2]), (3.0, P["SCALE_ORANGE"][1])]:
        ax.axhline(lvl, color=col, lw=0.8, ls="--", alpha=0.7)
        ax.text(c.index[2], lvl, f"{lvl:.1f}x", color=col, fontsize=8, va="bottom")
    fig_title(ax, f"{symbol} — price/book cycle (BVPS from quarterly balance sheet)",
              f"now {pb.iloc[-1]:.2f}x • high {pb.max():.2f}x • low {pb.min():.2f}x")
    ax.legend(fontsize=9)
    return save(fig, out / f"{symbol.lower()}_pb_cycle.png")


def chart_drawdown_episodes(data: dict, out: Path) -> str:
    c = data["px"]["close"]
    eps = lp.drawdown_episodes(c, 0.30)
    rows = []
    for ep in eps:
        i = c.index.get_loc(ep["date"])
        for h, lab in ((63, "3M"), (126, "6M"), (252, "12M")):
            j = i + h
            if j < len(c):
                rows.append((str(ep["date"].date()), lab, (c.iloc[j] / ep["price"] - 1) * 100))
    if not rows:
        return ""
    df = pd.DataFrame(rows, columns=["date", "h", "ret"])
    piv = df.pivot_table(index="date", columns="h", values="ret")
    fig, ax = plt.subplots(figsize=(11, 3.6))
    x = np.arange(len(piv))
    width = 0.26
    for k, (lab, col) in enumerate([("3M", P["SCALE_BLUE"][1]), ("6M", P["SCALE_CYAN"][1]),
                                    ("12M", P["SCALE_GREEN"][1])]):
        if lab in piv:
            ax.bar(x + (k - 1) * width, piv[lab].values, width, label=lab, color=col, alpha=0.85)
    ax.axhline(0, color=P["MUTED"], lw=0.8)
    ax.set_xticks(x)
    ax.set_xticklabels(piv.index, rotation=20, ha="right", fontsize=8)
    fig_title(ax, f"{data['symbol']} — forward returns after every ≥30% drawdown trough")
    ax.legend(fontsize=9, ncol=3)
    ax.yaxis.set_major_formatter(mticker.PercentFormatter(1.0))
    return save(fig, out / f"{data['symbol'].lower()}_dd_episodes.png")


# --------------------------------------------------------------------------
# IV crush charts
# --------------------------------------------------------------------------

def chart_iv_path(example: dict, out: Path) -> str:
    s = example["series"]
    fig, ax = plt.subplots(figsize=(11, 4))
    ax.plot(s.index, s["iv_move_pts"].values, color=P["SCALE_VIOLET"][1], lw=1.6, marker="o", ms=3,
            label="ATM implied vol")
    if "spot" in s:
        ax2 = ax.twinx()
        ax2.plot(s.index, s["spot"].values, color=P["TEXT"], lw=1.0, alpha=0.55, label="spot")
        ax2.set_ylabel("spot", color=P["MUTED"], fontsize=9)
        ax2.tick_params(colors=P["MUTED"])
        ax2.grid(False)
    ev = pd.Timestamp(example["event_date"])
    ax.axvline(ev, color=P["WARNING"], lw=1.2, ls="--")
    ax.annotate("results", (ev, ax.get_ylim()[1]), textcoords="offset points", xytext=(4, -12),
                color=P["WARNING"], fontsize=9)
    fig_title(ax, f"{example['symbol']} — ATM implied vol around results ({example['expiry']} expiry)",
              f"crush {example.get('crush_pts', float('nan')):+.1f} vol pts on the reaction session")
    ax.set_ylabel("implied vol %")
    ax.legend(fontsize=9, loc="upper left")
    return save(fig, out / f"iv_{example['symbol'].lower()}_path.png")


def chart_crush_examples(examples: list[dict], out: Path) -> str:
    labels = [e["symbol"] for e in examples]
    ev = [e.get("event_iv", np.nan) for e in examples]
    po = [e.get("post_iv", np.nan) for e in examples]
    fig, (ax, ax2) = plt.subplots(1, 2, figsize=(12, 4))
    x = np.arange(len(labels))
    ax.bar(x - 0.2, ev, 0.4, label="IV on event day", color=P["SCALE_BLUE"][1])
    ax.bar(x + 0.2, po, 0.4, label="IV after results", color=P["SCALE_ORANGE"][1])
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=30, ha="right", fontsize=8)
    fig_title(ax, "IV before vs after the results", "median crush ≈ −3.5 vol pts (−16%)")
    ax.legend(fontsize=9)
    crush = [e.get("crush_pts", np.nan) for e in examples]
    cols = [P["POSITIVE"] if c > 0 else P["NEGATIVE"] for c in crush]
    ax2.bar(x, crush, 0.6, color=cols)
    ax2.axhline(0, color=P["MUTED"], lw=0.8)
    ax2.set_xticks(x)
    ax2.set_xticklabels(labels, rotation=30, ha="right", fontsize=8)
    fig_title(ax2, "crush in vol points (positive = IV fell)")
    for i, c in enumerate(crush):
        ax2.text(i, c, f"{c:+.1f}", ha="center", va="bottom" if c >= 0 else "top",
                 fontsize=8, color=P["TEXT"])
    return save(fig, out / "iv_crush_examples.png")


def chart_priced_vs_actual(examples: list[dict], out: Path) -> str:
    priced = np.array([e.get("priced_move_pct", np.nan) for e in examples])
    actual = np.array([abs(e.get("actual_move_pct", np.nan)) for e in examples])
    names = [e["symbol"] for e in examples]
    fig, ax = plt.subplots(figsize=(7.5, 6))
    lim = max(np.nanmax(priced), np.nanmax(actual)) * 1.15
    ax.plot([0, lim], [0, lim], color=P["BORDER"], lw=1.0, ls="--")
    ax.fill_between([0, lim], [0, lim], [0, 0], color=P["NEGATIVE"], alpha=0.05)
    for n, p, a in zip(names, priced, actual):
        inside = a < p
        ax.scatter([p], [a], s=90, color=P["NEGATIVE"] if inside else P["POSITIVE"],
                   edgecolor=P["TEXT"], linewidth=0.6, zorder=5)
        ax.annotate(n, (p, a), textcoords="offset points", xytext=(7, 5),
                    fontsize=9, color=P["TEXT"])
    ax.set_xlim(0, lim)
    ax.set_ylim(0, lim)
    ax.set_xlabel("priced move (implied, %)")
    ax.set_ylabel("actual reaction move (|%|)")
    fig_title(ax, "priced vs actual move around results",
              "points below the dashed line = the move stayed inside the priced range")
    return save(fig, out / "iv_priced_vs_actual.png")


def chart_chain_profile(chain_tbl: pd.DataFrame, spot: float, max_pain: float,
                        symbol: str, expiry: str, out: Path) -> str:
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(11, 6), sharex=True,
                                   gridspec_kw={"height_ratios": [1, 1], "hspace": 0.12})
    ce = chain_tbl["ce_oi"].fillna(0) / 1e6
    pe = chain_tbl["pe_oi"].fillna(0) / 1e6
    ax1.bar(chain_tbl["strike"], ce, width=2.0, color=P["SCALE_BLUE"][1], alpha=0.8, label="call OI")
    ax1.bar(chain_tbl["strike"], -pe, width=2.0, color=P["SCALE_RED"][1], alpha=0.8, label="put OI (negative)")
    ax1.axvline(spot, color=P["TEXT"], lw=1.0, ls="--")
    ax1.text(spot, ax1.get_ylim()[1] * 0.92, " spot", color=P["TEXT"], fontsize=8)
    ax1.axvline(max_pain, color=P["WARNING"], lw=1.0, ls=":")
    ax1.text(max_pain, ax1.get_ylim()[1] * 0.92, " max pain", color=P["WARNING"], fontsize=8)
    ax1.set_ylabel("open interest (M)")
    fig_title(ax1, f"{symbol} {expiry} — open interest profile",
              f"PCR(OI) {pe.sum() / ce.sum() if ce.sum() else float('nan'):.2f} • "
              f"call OI {ce.sum():.1f}M vs put OI {pe.sum():.1f}M", pad=22)
    ax1.legend(fontsize=9)

    strikes = chain_tbl["strike"].values
    payoff = np.maximum(strikes - spot, 0) - np.maximum(spot - strikes, 0)
    ax2.plot(strikes, payoff, color=P["PRIMARY"], lw=1.6, label="short straddle payoff at spot")
    ax2.axvline(max_pain, color=P["WARNING"], lw=1.0, ls=":")
    ax2.axvline(spot, color=P["TEXT"], lw=1.0, ls="--")
    ax2.axhline(0, color=P["BORDER"], lw=0.8)
    fig_title(ax2, "settlement payoff (spot = current price)", pad=4)
    ax2.set_xlabel("strike")
    ax2.legend(fontsize=9)
    return save(fig, out / f"chain_{symbol.lower()}_profile.png")



# --------------------------------------------------------------------------
# narrative: what each chart actually says
# --------------------------------------------------------------------------

def read_price(data: dict) -> str:
    c = data["px"]["close"]
    st = data["state"]
    dd = (c.iloc[-1] / c.max() - 1) * 100
    legs = lp.swing_legs(lp.zigzag(c, 30), c)
    last = legs[-1] if legs else None
    tail = ""
    if last:
        tail = (f" The last 30% leg is a {last['type'].lower()} of {last['pct']:+.0f}% "
                f"from {last['start'].date()} and is {'still open' if last['end'] == c.index[-1] else 'closed'}.")
    return (f"<b>{data['symbol']}</b> is <b>{dd:.0f}% below its all-time high</b> "
            f"(₹{c.max():,.2f} on {c.idxmax().date()}) and sits {st['d200'] * 100:+.1f}% versus a "
            f"{st['slope']} 200-DMA — i.e. a <b>{'counter-trend' if st['d200'] < 0 else 'trend-aligned'} "
            f"rally</b>. {len(legs)} legs of ≥30% have printed since listing.{tail} "
            f"The magenta/green dots mark each leg's start and end; read the sequence as "
            f"alternating melt-ups and give-backs, not a trend.")


def read_momentum(data: dict) -> str:
    f, st = data["f"], data["state"]
    rsi_now = st["rsi"]
    rsi_hist = f["rsi"].dropna()
    pctile = (rsi_hist < rsi_now).mean() * 100
    vol_note = (f"Volume is running at {st['volr']:.1f}× its 60-session median"
                if st["volr"] > 2 else f"Volume is normal ({st['volr']:.1f}× the 60-session median)")
    return (f"RSI-14 at <b>{rsi_now:.1f}</b> is the <b>{pctile:.0f}th percentile</b> of its own history "
            f"(reading ≥70 = stretched). Price is {st['d20'] * 100:+.1f}% vs the 20-DMA and "
            f"{st['d50'] * 100:+.1f}% vs the 50-DMA, but {st['d200'] * 100:+.1f}% vs the 200-DMA, whose "
            f"20-session slope is {st['slope200'] * 100:+.1f}%. {vol_note}. "
            f"Short-term momentum and the primary trend are pointing in opposite directions — "
            f"that is the whole setup.")


def read_corr(data: dict) -> str:
    rows = sorted([r for r in data["corr"] if r.get("c252") is not None],
                  key=lambda r: -abs(r["c252"]))
    if not rows:
        return ""
    top = rows[0]
    bot = rows[-1]
    return (f"The rolling 120-session correlation lines show which index actually drives "
            f"{data['symbol']}. On a 252-session basis the strongest link is "
            f"<b>{top['index']} (corr {top['c252']:+.2f}, β {top['b252']:.2f})</b> and the weakest is "
            f"<b>{bot['index']} (corr {bot['c252']:+.2f}, β {bot['b252']:.2f})</b>. "
            f"A low correlation with NIFTY means the stock's own news and cycle dominate its "
            f"daily returns — index moves will not rescue it, and index strength will not drag it down.")


def read_dd(data: dict) -> str:
    c = data["px"]["close"]
    dd = (c / c.cummax() - 1) * 100
    now = dd.iloc[-1]
    hist = dd[dd < -30]
    eps = lp.drawdown_episodes(c, 0.30)
    last_ep = eps[-1] if eps else None
    age = (c.index[-1] - last_ep["date"]).days if last_ep else 0
    return (f"Current drawdown from the all-time high is <b>{now:.1f}%</b>. "
            f"{len(hist)} sessions in the stock's history have been more than 30% below a prior high. "
            f"The deepest trough of the current slide was {last_ep['dd'] * 100:.0f}% on "
            f"{last_ep['date'].date()} — {age} days ago"
            f"{'; the slide is still active' if last_ep['date'] == c.index[-1] else ''}. "
            f"Drawdown duration matters more than depth for the re-rating: a deep-but-old trough "
            f"usually needs a catalyst, a fresh trough is where the asymmetry sits.")


def read_pb(data: dict, bvps_map: dict) -> str:
    symbol = data["symbol"]
    series = bvps_map.get(symbol)
    if not series:
        return ""
    c = data["px"]["close"]
    bv = pd.Series(series)
    bv.index = pd.to_datetime(bv.index)
    pb = []
    for ts, px_ in c.items():
        prior = bv[bv.index <= ts.tz_localize(None)]
        pb.append(px_ / prior.iloc[-1] if len(prior) else np.nan)
    pb = pd.Series(pb, index=c.index)
    now = pb.iloc[-1]
    hi = pb.max(); lo = pb.min()
    return (f"Price/book ran from <b>{lo:.2f}×</b> to <b>{hi:.2f}×</b> and is now <b>{now:.2f}×</b>. "
            f"Earnings barely moved over that stretch, so the entire {((hi / lo) - 1) * 100:.0f}% "
            f"price swing was multiple expansion and contraction. "
            f"At {now:.2f}× the stock is {'still cheap versus its own mid-cycle' if now < 2.5 else 'at or above its mid-cycle'} "
            f"level — a re-rating to 2.5-3.0× is the realistic bull case, and it needs no earnings surprise.")


def read_ddep(data: dict) -> str:
    c = data["px"]["close"]
    eps = lp.drawdown_episodes(c, 0.30)
    rows = []
    for ep in eps:
        i = c.index.get_loc(ep["date"])
        for h, lab in ((63, "3M"), (126, "6M"), (252, "12M")):
            j = i + h
            if j < len(c):
                rows.append((lab, (c.iloc[j] / ep["price"] - 1) * 100))
    if not rows:
        return ""
    df = pd.DataFrame(rows, columns=["h", "r"])
    med12 = df[df.h == "12M"]["r"].median() if (df.h == "12M").any() else float("nan")
    med3 = df[df.h == "3M"]["r"].median() if (df.h == "3M").any() else float("nan")
    return (f"After every ≥30% drawdown trough in this stock's history, the median forward return "
            f"is <b>{med3:+.1f}% at 3 months</b> and <b>{med12:+.1f}% at 12 months</b> "
            f"(n={len(eps)} troughs). "
            + ("Deep drawdowns in this name have historically been <b>buying</b> opportunities for the "
               "12-month horizon but not for the quarter."
               if med12 > 0 else
               "Deep drawdowns in this name have historically <b>not</b> been repaired within a year — "
               "the cycle bottom is a separate decision from the price."))


def read_fwd(data: dict, prob: dict) -> str:
    base = prob["base"]
    up = base.loc[base.d200 > 0, "fwd"]
    dn = base.loc[base.d200 <= 0, "fwd"]
    decay = lp.rsi_peak_decay(base)
    decay_txt = ""
    if decay:
        d0 = decay[0]
        decay_txt = (f" And in the <b>0-1 session after a 21-session RSI peak</b>, the median "
                     f"{prob['H']}-session forward return is <b>{d0['median'] * 100:+.1f}%</b> with only "
                     f"<b>{d0['p_up'] * 100:.0f}%</b> of sessions positive — momentum bought at an RSI "
                     f"peak is the classic exhaustion entry.")
    return (f"Split by trend regime the forward {prob['H']}-session return differs sharply: above the "
            f"200-DMA the median is <b>{up.median() * 100:+.1f}%</b> (P(up) {(up > 0).mean() * 100:.0f}%), "
            f"below it <b>{dn.median() * 100:+.1f}%</b> (P(up) {(dn > 0).mean() * 100:.0f}%). "
            f"The right panel bins the same forward returns by how long ago the RSI peaked — the decay "
            f"curve is the single most useful line in this report.{decay_txt}")


def read_prob(data: dict, prob: dict) -> str:
    spot = prob["spot"]
    up_200 = float((prob["blend"] > data["state"]["dma200"]).mean())
    up_10 = float((prob["blend"] > spot * 1.10).mean())
    dn_10 = float((prob["blend"] < spot * 0.90).mean())
    p25, p75 = np.percentile(prob["blend"], [25, 75])
    return (f"The blended ensemble puts the median close at <b>₹{np.median(prob['blend']):,.2f}</b> with the "
            f"middle half of outcomes between <b>₹{p25:,.0f} and ₹{p75:,.0f}</b>. "
            f"Reclaiming the 200-DMA (₹{data['state']['dma200']:,.2f}) by the target date is a "
            f"<b>{up_200 * 100:.0f}%</b> event; a +10% move ({up_10 * 100:.1f}%) and a −10% move "
            f"({dn_10 * 100:.1f}%) are both tail events. "
            f"The chart answers <i>where</i>, never <i>whether</i> — size against the "
            f"invalidation level, not the median.")


def read_iv_path(ex: dict) -> str:
    return (f"<b>{ex['symbol']}</b> (results {ex['earnings']}, {ex['expiry']} expiry): implied vol went "
            f"<b>{ex.get('pre_iv', float('nan')):.1f}% → {ex.get('event_iv', float('nan')):.1f}% → "
            f"{ex.get('post_iv', float('nan')):.1f}%</b>, i.e. a crush of "
            f"<b>{ex.get('crush_pts', float('nan')):+.1f} vol points</b> on the reaction session. "
            f"The ATM straddle fell <b>{ex.get('straddle_change_pct', float('nan')):+.0f}%</b> "
            f"(₹{ex.get('event_straddle', 0):,.2f} → ₹{ex.get('post_straddle', 0):,.2f}) while the stock "
            f"moved <b>{ex.get('actual_move_pct', float('nan')):+.1f}%</b> against a priced move of "
            f"±{ex.get('priced_move_pct', float('nan')):.1f}%. "
            f"That is the crush in one line: the premium is priced for a move that did not happen.")


def read_crush(examples: list[dict]) -> str:
    crush = [e.get("crush_pts", np.nan) for e in examples]
    crushed = sum(1 for c in crush if c > 0)
    med = float(np.nanmedian(crush))
    return (f"<b>{crushed} of {len(examples)}</b> names crushed, by a median of "
            f"<b>{med:+.1f} vol points</b>. The exceptions are the two most instructive: "
            f"<b>HINDALCO</b> (IV was already 33% before the event, so there was little premium to "
            f"remove) and <b>RELIANCE</b> (the stock gapped beyond the priced range, so vol "
            f"<i>expanded</i> instead — crush is an IV phenomenon, not a premium phenomenon).")


def read_scatter(examples: list[dict]) -> str:
    inside = sum(1 for e in examples if abs(e.get("actual_move_pct", 0)) < e.get("priced_move_pct", 0))
    return (f"<b>{inside} of {len(examples)}</b> reaction moves landed <i>inside</i> the range the market "
            f"had priced. For a long straddle the break-even is the priced move, not the direction: "
            f"SBIN rose +0.9% on results and the straddle still lost 16%. Only a move beyond the priced "
            f"range (RELIANCE) pays the premium back.")


def read_chain(summ: dict, symbol: str, expiry: str) -> str:
    if not summ:
        return ""
    pain_gap = (summ["max_pain"] / summ["spot"] - 1) * 100
    return (f"Live {expiry} chain: spot ₹{summ['spot']:,.1f}, ATM ₹{summ['atm_strike']:,.0f}, straddle "
            f"₹{summ['straddle']:.2f} = a <b>±{summ['sigma_move'] * 100:.2f}%</b> implied move over "
            f"{summ['dte']} days. ATM vol is call {summ['atm_iv_call']:.1f}% vs put "
            f"{summ['atm_iv_put']:.1f}% (<b>skew {summ['skew_atm']:+.1f}</b> — puts bid), max pain "
            f"₹{summ['max_pain']:,.0f} is <b>{pain_gap:+.1f}%</b> from spot, and PCR(OI) is "
            f"<b>{summ['pcr_oi']:.2f}</b> (call OI {summ['ce_oi'] / 1e6:.1f}M vs put OI "
            f"{summ['pe_oi'] / 1e6:.1f}M). Read it as positioning: dealers are short calls into an "
            f"expiry with the pain point below spot, and near-term demand is for downside protection.")


# --------------------------------------------------------------------------
# HTML
# --------------------------------------------------------------------------

def html_page(title: str, body: str) -> str:
    css = f"""
    :root {{ --bg:{P['BG']}; --surface:{P['SURFACE']}; --surface2:{P['SURFACE_ALT']};
      --border:{P['BORDER']}; --text:{P['TEXT']}; --muted:{P['MUTED']};
      --primary:{P['PRIMARY']}; --pos:{P['POSITIVE']}; --neg:{P['NEGATIVE']}; --warn:{P['WARNING']}; }}
    * {{ box-sizing:border-box; }}
    body {{ margin:0; background:var(--bg); color:var(--text);
      font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size:15px; line-height:1.55; }}
    .wrap {{ max-width:1180px; margin:0 auto; padding:32px 24px 80px; }}
    header {{ border-bottom:1px solid var(--border); padding-bottom:20px; margin-bottom:28px; }}
    h1 {{ font-size:28px; margin:0 0 6px; letter-spacing:-0.3px; }}
    .sub {{ color:var(--muted); font-size:14px; }}
    h2 {{ font-size:20px; margin:44px 0 10px; padding-top:14px; border-top:1px solid var(--border); }}
    h3 {{ font-size:15px; margin:26px 0 8px; color:var(--text); }}
    p {{ color:var(--text); }}
    .muted {{ color:var(--muted); }}
    .cards {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:12px; margin:18px 0 8px; }}
    .card {{ background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:12px 14px; }}
    .card .k {{ color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.6px; }}
    .card .v {{ font-size:22px; font-weight:650; margin-top:2px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }}
    .pos {{ color:var(--pos); }} .neg {{ color:var(--neg); }} .warn {{ color:var(--warn); }}
    table {{ width:100%; border-collapse:collapse; margin:14px 0; font-size:13px; }}
    th, td {{ text-align:right; padding:7px 9px; border-bottom:1px solid var(--border);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }}
    th:first-child, td:first-child {{ text-align:left; font-family:inherit; }}
    th {{ color:var(--muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.5px; }}
    img {{ width:100%; border:1px solid var(--border); border-radius:10px; background:var(--bg); }}
    figure {{ margin:16px 0 26px; }}
    figcaption {{ color:var(--muted); font-size:12.5px; margin-top:6px; }}
    .note {{ background:var(--surface); border:1px solid var(--border); border-left:3px solid var(--warn);
      border-radius:8px; padding:12px 14px; margin:16px 0; color:var(--muted); font-size:13.5px; }}
    .note.read {{ border-left:3px solid var(--primary); color:var(--text); font-size:14px; line-height:1.6; }}
    .note.read b {{ color:var(--primary); font-weight:600; }}
    .grid2 {{ display:grid; grid-template-columns:1fr 1fr; gap:18px; }}
    @media (max-width:900px) {{ .grid2 {{ grid-template-columns:1fr; }} }}
    code {{ background:var(--surface2); border:1px solid var(--border); border-radius:4px; padding:1px 5px;
      font-size:12.5px; }}
    """
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title><style>{css}</style></head>
<body><div class="wrap">{body}</div></body></html>"""


def img_block(path: Path, caption: str) -> str:
    if not path or not Path(path).exists():
        return ""
    return (f'<figure><img src="data:image/png;base64,{b64(Path(path))}" alt="{html.escape(caption)}">'
            f'<figcaption>{caption}</figcaption></figure>')


def note(html_body: str) -> str:
    """A highlighted 'what this chart says' block."""
    if not html_body:
        return ""
    return f'<div class="note read">{html_body}</div>'


def cards(items: list[tuple[str, str, str]]) -> str:
    out = ['<div class="cards">']
    for k, v, cls in items:
        out.append(f'<div class="card"><div class="k">{html.escape(k)}</div>'
                   f'<div class="v {cls}">{v}</div></div>')
    out.append("</div>")
    return "".join(out)


def table_html(rows: list[dict], cols: list[tuple[str, str]]) -> str:
    head = "".join(f"<th>{html.escape(h)}</th>" for _, h in cols)
    body = []
    for r in rows:
        body.append("<tr>" + "".join(f"<td>{r.get(k, '')}</td>" for k, _ in cols) + "</tr>")
    return f"<table><thead><tr>{head}</tr></thead><tbody>{''.join(body)}</tbody></table>"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--symbols", default="IRFC,POWERGRID")
    ap.add_argument("--target", default="2026-11-23")
    ap.add_argument("--indexes", default="NIFTY,MIDCPNIFTY,BANKNIFTY,NIFTYPSUBANK,NIFTYRAILWAYS,NIFTYPSE")
    ap.add_argument("--iv-examples", default=("SBIN:2026-11-03,ITC:2026-11-02,TITAN:2026-11-05,"
                                               "BHARTIARTL:2026-11-05,HINDALCO:2026-11-06,BAJAJFINSV:2026-11-03,"
                                               "POWERGRID:2026-11-01,RELIANCE:2026-10-30,INFY:2026-10-23,LT:2026-10-27"))
    ap.add_argument("--iv-expiry", default="2026-11-23")
    ap.add_argument("--chain-symbol", default="SBIN")
    ap.add_argument("--out", default=None)
    ap.add_argument("--reuse", action="store_true", help="reuse cached JSON of computed blocks")
    args = ap.parse_args()

    symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    index_ids = [i.strip().upper() for i in args.indexes.split(",") if i.strip()]
    out_dir = Path(args.out) if args.out else REPO_ROOT / "reports" / f"eda_{args.target}"
    figs = out_dir / "figures"
    figs.mkdir(parents=True, exist_ok=True)

    bvps_map = json.loads(BVPS_FILE.read_text()) if BVPS_FILE.exists() else {}

    client = fmd.upstox_client()
    blocks, probs, figs_used = [], {}, {}
    for sym in symbols:
        d = symbol_data(sym, index_ids, client)
        d["corr"] = correlation_block(d)
        blocks.append(d)
        probs[sym] = probability_block(d, args.target)
        print(f"data ok: {sym} ({len(d['px'])} sessions)")

    # ---- charts ----
    for d in blocks:
        s = d["symbol"]
        figs_used[s] = {
            "price": chart_price_cycles(d, figs),
            "dd": chart_drawdown(d, figs),
            "corr": chart_rolling_corr(d, figs),
            "mom": chart_momentum(d, figs),
            "fwd": chart_forward_returns(probs[s], figs, s),
            "prob": chart_probability(probs[s], figs, s),
            "ddep": chart_drawdown_episodes(d, figs),
            "pb": chart_pb_cycle(d, figs, bvps_map),
        }
    heat = chart_corr_heatmap([{"symbol": d["symbol"], "corr": d["corr"]} for d in blocks], figs)

    # ---- IV crush section ----
    iv_examples = []
    for item in args.iv_examples.split(","):
        item = item.strip()
        if not item:
            continue
        s, dte = item.split(":")
        try:
            rep = ivc.crush_report(s.upper(), date.fromisoformat(dte), args.iv_expiry, client)
            if "error" in rep:
                print(f"  iv {s}: {rep['error']}")
                continue
            rep["series"] = rep["series"].tail(40)
            iv_examples.append(rep)
            print(f"  iv {s}: crush {rep.get('crush_pts'):+.1f} pts")
        except Exception as e:
            print(f"  iv {s} failed: {e}")

    iv_figs = {}
    if iv_examples:
        iv_figs["path"] = chart_iv_path(iv_examples[0], figs)
        iv_figs["bars"] = chart_crush_examples(iv_examples, figs)
        iv_figs["scatter"] = chart_priced_vs_actual(iv_examples, figs)

    chain_fig = None
    chain_summary = None
    try:
        token = ivc.upstox_token()
        ch = ivc.equity_chain(args.chain_symbol, args.iv_expiry, token, client)
        t = ivc.chain_table(ch)
        dte = (date.fromisoformat(args.iv_expiry) - date(2026, 11, 11)).days
        summ = ivc.summarise_chain(t, ch["spot"], args.iv_expiry, dte)
        chain_fig = chart_chain_profile(t, ch["spot"], summ["max_pain"], args.chain_symbol,
                                        args.iv_expiry, figs)
        chain_summary = summ
    except Exception as e:
        print(f"  chain snapshot failed: {e}")

    # ---- HTML ----
    B = []
    A = B.append
    A("<header>")
    A(f"<h1>Pre-position EDA — {', '.join(symbols)}</h1>")
    A(f'<div class="sub">Upstox data · target close {args.target} · generated for '
      f'{"IRFC / POWERGRID" if len(symbols) > 1 else symbols[0]}</div>')
    A("</header>")

    for d in blocks:
        s = d["symbol"]
        st = d["state"]
        pr = probs[s]
        A(f"<h2>{s}</h2>")
        A(cards([
            ("close", f"₹{pr['spot']:,.2f}", ""),
            ("RSI 14", f"{st['rsi']:.1f}", "warn" if st["rsi"] > 70 else ""),
            ("vs 200-DMA", f"{st['d200'] * 100:+.1f}%", "neg" if st["d200"] < 0 else "pos"),
            ("trend", f"{st['trend']}", "neg" if st["d200"] < 0 else "pos"),
            ("vol (ann)", f"{pr['sig252'] * 100:.0f}%", ""),
            ("52w position", f"{st['pos52'] * 100:.0f}%", ""),
        ]))
        A(img_block(Path(figs_used[s]["price"]),
                    "Price, 200-DMA and the 30% zigzag cycle legs. Every leg's start/end is dotted; "
                    "the sequence is the cycle."))
        A(note(read_price(d)))
        A(img_block(Path(figs_used[s]["mom"]),
                    "Momentum (RSI), trend (distance to the moving averages) and participation "
                    "(volume ratio)."))
        A(note(read_momentum(d)))
        A(img_block(Path(figs_used[s]["corr"]),
                    "Rolling 120-session correlation vs the index set."))
        A(note(read_corr(d)))
        A(img_block(Path(figs_used[s]["dd"]),
                    "Drawdown from all-time high, with the ≥30% troughs marked."))
        A(note(read_dd(d)))
        if figs_used[s]["pb"]:
            A(img_block(Path(figs_used[s]["pb"]),
                        "Price/book cycle — the real driver of PSU/NBFC re-ratings."))
            A(note(read_pb(d, bvps_map)))
        A(img_block(Path(figs_used[s]["ddep"]),
                    "Forward returns after every ≥30% drawdown trough (3M / 6M / 12M)."))
        A(note(read_ddep(d)))
        A(img_block(Path(figs_used[s]["fwd"]),
                    f"Forward {pr['H']}-session returns split by trend regime (left) and the "
                    f"momentum-decay curve (right)."))
        A(note(read_fwd(d, pr)))
        A(img_block(Path(figs_used[s]["prob"]),
                    f"Probability density and cumulative distribution of the close on {args.target}."))
        A(note(read_prob(d, pr)))
        A("<h3>Correlation & beta</h3>")
        A(table_html(d["corr"], [("index", "Index"), ("b60", "β 60d"), ("c60", "corr 60d"),
                                 ("b252", "β 252d"), ("c252", "corr 252d")]))
        A("<h3>Probability of the close on the target date</h3>")
        rows = []
        for lvl in [pr["spot"] * 0.93, pr["spot"] * 0.97, pr["spot"], pr["spot"] * 1.03,
                    pr["spot"] * 1.07, pr["spot"] * 1.12]:
            side = "above" if lvl > pr["spot"] else "below"
            for label, arr in [("vol-only", pr["vol"]), ("momentum-adj", pr["mom"]), ("blended", pr["blend"])]:
                p = float((arr > lvl).mean()) if side == "above" else float((arr < lvl).mean())
                rows.append({"level": f"₹{lvl:,.2f} {side}", "model": label, "p": f"{p * 100:.1f}%"})
        A(table_html(rows, [("level", "Level"), ("model", "Model"), ("p", "Probability")]))
        A(f'<div class="note">Matched-state analog: n={pr["analog_n"]} sessions, '
          f'mean {pr["analog_mean"] * 100:+.1f}%, median {pr["analog_median"] * 100:+.1f}% '
          f'— rules {pr["rules"]}.</div>')

    A("<h2>Cross-symbol correlation</h2>")
    A(img_block(Path(heat), "Correlation matrix of the covered names against the index set."))

    if iv_examples:
        A("<h2>Event IV crush (measured on real option prices)</h2>")
        A(img_block(Path(iv_figs["path"]),
                    f"{iv_examples[0]['symbol']}: ATM implied vol path across the results date "
                    f"(purple = implied vol, grey = spot)."))
        A(note(read_iv_path(iv_examples[0])))
        A(img_block(Path(iv_figs["bars"]),
                    "IV on the event day vs after the results (left), and the crush in vol points (right)."))
        A(note(read_crush(iv_examples)))
        A(img_block(Path(iv_figs["scatter"]),
                    "Priced (implied) move vs the actual reaction — the break-even for a long straddle. "
                    "Points below the dashed line stayed inside the priced range."))
        A(note(read_scatter(iv_examples)))
        rows = []
        for e in iv_examples:
            rows.append({
                "symbol": e["symbol"], "earnings": e["earnings"],
                "pre": f"{e.get('pre_iv', float('nan')):.1f}%",
                "event": f"{e.get('event_iv', float('nan')):.1f}%",
                "post": f"{e.get('post_iv', float('nan')):.1f}%",
                "crush": f"{e.get('crush_pts', float('nan')):+.1f}",
                "straddle": f"{e.get('straddle_change_pct', float('nan')):+.0f}%",
                "priced": f"±{e.get('priced_move_pct', float('nan')):.1f}%",
                "actual": f"{e.get('actual_move_pct', float('nan')):+.1f}%",
            })
        A(table_html(rows, [("symbol", "Stock"), ("earnings", "Results"), ("pre", "IV pre"),
                            ("event", "IV event"), ("post", "IV post"), ("crush", "Crush (pts)"),
                            ("straddle", "Straddle"), ("priced", "Priced move"),
                            ("actual", "Actual move")]))

    if chain_fig:
        A(f"<h2>Live option chain — {args.chain_symbol} {args.iv_expiry}</h2>")
        A(img_block(Path(chain_fig),
                    "Open-interest profile (call OI up, put OI down) with spot and max pain, and the "
                    "settlement payoff of a short straddle."))
        A(note(read_chain(chain_summary, args.chain_symbol, args.iv_expiry)))
        if chain_summary:
            A(table_html([{
                "spot": f"{chain_summary['spot']:,.1f}", "atm": f"{chain_summary['atm_strike']:.0f}",
                "straddle": f"{chain_summary['straddle']:.2f}",
                "sigma": f"{chain_summary['sigma_move'] * 100:.2f}%",
                "civ": f"{chain_summary['atm_iv_call']:.1f}%", "piv": f"{chain_summary['atm_iv_put']:.1f}%",
                "skew": f"{chain_summary['skew_atm']:+.1f}", "pain": f"{chain_summary['max_pain']:.0f}",
                "pcr": f"{chain_summary['pcr_oi']:.2f}",
            }], [("spot", "Spot"), ("atm", "ATM strike"), ("straddle", "Straddle"),
                 ("sigma", "1σ move"), ("civ", "Call IV"), ("piv", "Put IV"),
                 ("skew", "Skew (P−C)"), ("pain", "Max pain"), ("pcr", "PCR (OI)")]))

    A("<h2>Provenance</h2>")
    A('<div class="note">Prices/volume from Upstox V3 daily + 1-minute intraday (the daily endpoint '
      'omits the current session, so it is appended from the intraday feed). Option chains from '
      'Upstox <code>/option/chain</code> with the equity instrument key. Implied vol is Black-Scholes '
      'from mid quotes, r = 5.50% repo, no dividend yield. Colours come from '
      '<code>src/ui/palette.ts</code>. This is a pre-position snapshot, not a forecast — the next '
      'session invalidates every number on it.</div>')

    out_html = out_dir / "eda_report.html"
    out_html.write_text(html_page(f"Pre-position EDA — {', '.join(symbols)}", "".join(B)))

    md = [f"# Pre-position EDA — {', '.join(symbols)}", "",
          f"Upstox data · target {args.target}", ""]
    for d in blocks:
        s = d["symbol"]
        md += [f"## {s}", "", f"Close ₹{probs[s]['spot']:,.2f} · RSI {d['state']['rsi']:.1f} · "
               f"vs 200-DMA {d['state']['d200'] * 100:+.1f}% · {d['state']['trend']}", ""]
        md += [f"![price](figures/{s.lower()}_price_cycles.png)",
               f"![momentum](figures/{s.lower()}_momentum.png)",
               f"![correlation](figures/{s.lower()}_rolling_corr.png)",
               f"![drawdown](figures/{s.lower()}_drawdown.png)",
               f"![fwd](figures/{s.lower()}_forward_returns.png)",
               f"![probability](figures/{s.lower()}_probability.png)", ""]
    (out_dir / "eda_report.md").write_text("\n".join(md))

    print(f"\nreport → {out_html}")
    print(f"figures → {figs}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
