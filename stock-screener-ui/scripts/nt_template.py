"""NT dark-chart template for concept/failure cards (theme: src/ui/palette.ts:168-180).

Usage:
    from nt_template import new_fig, candles, zone, riskbox, note, save
"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as patches

BG, GRID = "#0E0E0E", "#2A2A2A"
BULL, BEAR = "#00FF88", "#FF3B30"
TEXT, MUTED = "#E5E7EB", "#9CA3AF"
FVG_BULL_F = (0, 1, 0.53, 0.18)
FVG_BEAR_F = (1, 0.23, 0.19, 0.18)
IFVG_F, IFVG_S = (1, 0.84, 0, 0.22), "#FFD700"
TREND, ACCENT = "#A78BFA", "#58A6FF"
RISK_F = (1, 0.23, 0.19, 0.20)
REWARD_F = (0, 1, 0.53, 0.18)


def new_fig(title, figsize=(12, 5.2)):
    fig, ax = plt.subplots(figsize=figsize)
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)
    ax.grid(True, color=GRID, lw=0.6, alpha=0.7)
    ax.tick_params(colors=MUTED, labelsize=8)
    for s in ax.spines.values():
        s.set_color(GRID)
    ax.set_title(title, color=TEXT, fontweight="bold", fontsize=12)
    return fig, ax


def candles(ax, bars, w=0.55):
    for i, (o, h, l, c) in enumerate(bars):
        col = BULL if c >= o else BEAR
        ax.plot([i, i], [l, h], color=col, lw=1.2)
        b, t = min(o, c), max(o, c)
        ax.add_patch(patches.Rectangle((i - w / 2, b), w, max(t - b, 0.05),
                                       fc=col, ec=col, lw=0.8))
    ax.set_xlim(-1, len(bars))


def zone(ax, top, bottom, kind="ifvg", label=None):
    """Full-width zone band (concept cards)."""
    fill = {"bull": FVG_BULL_F, "bear": FVG_BEAR_F, "ifvg": IFVG_F}[kind]
    ax.axhspan(bottom, top, color=fill)
    edge = {"bull": BULL, "bear": BEAR, "ifvg": IFVG_S}[kind]
    x1 = ax.get_xlim()[1]
    ax.plot([-1, x1], [top, top], color=edge, lw=1.2)
    ax.plot([-1, x1], [bottom, bottom], color=edge, lw=1.2)
    if label:
        ax.text(x1 - 0.2, (top + bottom) / 2, label, color=edge, fontsize=9,
                va="center", ha="right", fontweight="bold")


def hline(ax, y, color, label=None, ls="-", n=None):
    x1 = (ax.get_xlim()[1] if n is None else n)
    ax.plot([-1, x1], [y, y], color=color, lw=1.3, ls=ls)
    if label:
        ax.text(0, y, f"  {label}", color=color, fontsize=9, va="bottom")


def riskbox(ax, entry, sl, tp, side, x0, x1):
    ax.axhspan(min(entry, sl), max(entry, sl), xmin=0, xmax=1, color=RISK_F)
    ax.axhspan(min(entry, tp), max(entry, tp), xmin=0, xmax=1, color=REWARD_F)
    for y, c, t in ((sl, BEAR, "SL"), (tp, BULL, "TP"), (entry, ACCENT, "entry")):
        ax.plot([x0, x1], [y, y], color=c, lw=1.1, ls="--" if t == "entry" else "-")


def note(ax, x, y, s, color=TEXT, **k):
    ax.text(x, y, s, color=color, fontsize=k.pop("fs", 9), **k)


def save(fig, name):
    fig.tight_layout()
    fig.savefig(f"/tmp/opencode/{name}", dpi=110, facecolor=BG)
    plt.close(fig)
