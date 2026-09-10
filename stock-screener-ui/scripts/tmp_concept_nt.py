"""Concept diagrams in the NT dark SMC theme (src/ui/palette.ts:168-180). -> /tmp/opencode/concept_nt_*.png"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as patches
import numpy as np

OUT = "/tmp/opencode"
BG, GRID = "#0E0E0E", "#2A2A2A"
BULL, BEAR = "#00FF88", "#FF3B30"
TEXT, MUTED = "#E5E7EB", "#9CA3AF"
FVG_BULL_F, FVG_BULL_S = (0, 1, 0.53, 0.18), (0, 1, 0.53, 0.9)
FVG_BEAR_F, FVG_BEAR_S = (1, 0.23, 0.19, 0.18), (1, 0.23, 0.19, 0.9)
IFVG_F, IFVG_S = (1, 0.84, 0, 0.22), "#FFD700"
HLINE, TREND, ACCENT = "#38BDF8", "#A78BFA", "#58A6FF"


def candles(ax, bars, w=0.6):
    for i, (o, h, l, c) in enumerate(bars):
        col = BULL if c >= o else BEAR
        ax.plot([i, i], [l, h], color=col, lw=1.2)
        b, t = min(o, c), max(o, c)
        ax.add_patch(patches.Rectangle((i - w / 2, b), w, max(t - b, 0.15),
                                       fc=col, ec=col, lw=0.8))


def dark(ax):
    ax.set_facecolor(BG)
    ax.grid(True, color=GRID, lw=0.6, alpha=0.7)
    ax.tick_params(colors=MUTED, labelsize=8)
    for s in ax.spines.values():
        s.set_color(GRID)


def title(fig, s):
    fig.suptitle(s, color=TEXT, fontsize=13, fontweight="bold")


def txt(ax, x, y, s, c=TEXT, fs=9, **k):
    ax.text(x, y, s, color=c, fontsize=fs, **k)


# ---------- 1. FVG ----------
fig, (a1, a2) = plt.subplots(1, 2, figsize=(11, 4.8))
fig.patch.set_facecolor(BG)
bull = [(10, 12, 9, 11), (11, 13, 10.5, 12.5), (14, 16, 13.8, 15.5),
        (15.5, 17, 15, 16.5), (16.5, 18, 16, 17.5)]
candles(a1, bull)
a1.axhspan(12, 13.8, color=FVG_BULL_F)
a1.plot([-1, 5], [12, 12], color=FVG_BULL_S, lw=1.2)
a1.plot([-1, 5], [13.8, 13.8], color=FVG_BULL_S, lw=1.2)
a1.annotate("", xy=(4.2, 13.8), xytext=(4.2, 12),
            arrowprops=dict(arrowstyle="<->", color=ACCENT))
txt(a1, 2.0, 12.85, "bull FVG  low[i] > high[i-2]", c=ACCENT)
txt(a1, 0.2, 9.4, "gap = buy-side inefficiency", c=MUTED, style="italic")
a1.set_title("Bullish FVG (3-bar gap)", color=TEXT, fontweight="bold")
dark(a1)
bear = [(15, 16, 13, 13.5), (13.5, 14, 12, 12.5), (11, 11.5, 9, 9.5),
        (9.5, 10, 8, 8.5), (8.5, 9, 7, 7.5)]
candles(a2, bear)
a2.axhspan(9.5, 12, color=FVG_BEAR_F)
a2.plot([-1, 5], [9.5, 9.5], color=FVG_BEAR_S, lw=1.2)
a2.plot([-1, 5], [12, 12], color=FVG_BEAR_S, lw=1.2)
a2.annotate("", xy=(4.2, 12), xytext=(4.2, 9.5),
            arrowprops=dict(arrowstyle="<->", color=BEAR))
txt(a2, 2.0, 10.5, "bear FVG  high[i] < low[i-2]", c=BEAR)
a2.set_title("Bearish FVG (3-bar gap)", color=TEXT, fontweight="bold")
dark(a2)
fig.tight_layout()
fig.savefig(f"{OUT}/concept_nt_fvg.png", dpi=110, facecolor=BG)

# ---------- 2. iFVG ----------
fig, ax = plt.subplots(figsize=(11, 5))
fig.patch.set_facecolor(BG)
bars = [(10, 12, 9, 11), (11, 13, 10.5, 12.5), (14, 16, 13.8, 15.5),
        (15.5, 15.8, 13.5, 13.8), (13.8, 14, 11.5, 11.8),
        (11.8, 12, 10, 10.5), (10.5, 10.8, 8.5, 9)]
candles(ax, bars)
ax.axhspan(12, 13.8, xmin=0, xmax=0.62, color=FVG_BULL_F)
ax.axhspan(12, 13.8, xmin=0.55, xmax=1, color=IFVG_F)
ax.plot([3.4, 7], [13.8, 13.8], color=IFVG_S, lw=1.5)
ax.plot([3.4, 7], [12, 12], color=IFVG_S, lw=1.5)
txt(ax, 0.6, 14.4, "1 bull FVG forms", c=BULL, fontweight="bold")
ax.annotate("2 CLOSE below bottom\n(wick alone does NOT count)", xy=(4, 11.8), xytext=(4.7, 15.2),
            arrowprops=dict(arrowstyle="->", color=BEAR), fontsize=10, color=BEAR)
txt(ax, 4.75, 12.85, "3 flips to BEARISH iFVG\nold support -> new resistance", c=IFVG_S,
    fontweight="bold", bbox=dict(fc="#2A2A00", ec=IFVG_S, alpha=0.9))
txt(ax, 6.0, 9.1, "4 shorts work toward lows", c=MUTED, style="italic")
ax.set_title("Inverse FVG: failed auction flips polarity", color=TEXT, fontweight="bold")
ax.set_xlim(-1, 7)
dark(ax)
fig.tight_layout()
fig.savefig(f"{OUT}/concept_nt_ifvg.png", dpi=110, facecolor=BG)

# ---------- 3. LRL ----------
fig, ax = plt.subplots(figsize=(11, 5))
fig.patch.set_facecolor(BG)
np.random.seed(3)
xs = np.arange(14)
lows = 20 - 0.5 * xs + np.random.normal(0, 0.25, 14)
candles(ax, [(l + 1 + np.random.rand(), l + 2.2, l, l + 1.5) for l in lows])
touch = [1, 4, 7, 10]
tx = np.array(touch)
ty = np.array([lows[i] for i in touch])
m, b0 = np.polyfit(tx, ty, 1)
ax.plot([-0.5, 13.5], [m * -0.5 + b0, m * 13.5 + b0], color=TREND, lw=2)
for i in touch:
    ax.plot(i, lows[i], "o", color=BEAR, ms=7)
    txt(ax, i, lows[i] - 1.7, "stop pool", c=BEAR, ha="center", fs=7)
txt(ax, 10.6, m * 10.6 + b0 + 0.9, "clean trendline =\nLOW RESISTANCE", fontweight="bold",
    bbox=dict(fc="#1a1030", ec=TREND))
ax.annotate("price is drawn here\nto collect the stops", xy=(12.5, m * 12.5 + b0), xytext=(8, 24),
            arrowprops=dict(arrowstyle="->", color=BEAR), fontsize=10, color=BEAR)
ax.set_ylim(10, 25)
ax.set_title("Low-Resistance Liquidity: 3-4 stacked lows = stacked stop-losses",
             color=TEXT, fontweight="bold")
dark(ax)
fig.tight_layout()
fig.savefig(f"{OUT}/concept_nt_lrl.png", dpi=110, facecolor=BG)

# ---------- 4. Playbook ----------
fig, ax = plt.subplots(figsize=(12, 5.8))
fig.patch.set_facecolor(BG)
bars = [(50, 52, 49, 51), (51, 53, 50, 52.5), (52.5, 54, 52, 53.5),
        (53.5, 54.2, 51, 51.5), (51.5, 52, 49.5, 50),
        (50, 50.5, 48, 48.5), (48.5, 49, 47, 47.5),
        (47.5, 48, 46, 46.5), (46.5, 47, 45, 45.5), (45.5, 46, 44, 44.5)]
candles(ax, bars, w=0.55)
ax.plot([-0.5, 9.5], [47.5, 43.5], color=TREND, lw=2)
txt(ax, 7.2, 42.2, "LRL below = TARGET", fontweight="bold", c=BEAR)
ax.axhspan(51, 52, xmin=0.28, xmax=0.5, color=IFVG_F)
txt(ax, 2.35, 52.7, "highest-TF iFVG swept\n(30s+1m+2m => watch 2m)", c=IFVG_S,
    fontweight="bold", fs=8, bbox=dict(fc="#2A2A00", ec=IFVG_S, alpha=0.9))
ax.plot(4, 51.2, "v", color=BEAR, ms=12)
txt(ax, 4.15, 51.5, "SHORT", fontweight="bold", c=BEAR)
ax.axhspan(51.2, 53.5, xmin=0.4, xmax=0.62, color=(1, 0.23, 0.19, 0.25))
ax.axhspan(48.9, 51.2, xmin=0.4, xmax=0.62, color=(0, 1, 0.53, 0.22))
txt(ax, 6.35, 52.3, "SL: above swing high", c=BEAR)
txt(ax, 6.35, 49.7, "TP: 1R (risk 500 -> target 500)", c=BULL)
txt(ax, 0.0, 44.0, "prime 9:30-10:00am EST", c=MUTED, style="italic",
    bbox=dict(fc="#161B22", ec=GRID))
ax.set_title("Original playbook: LRL below -> highest-TF iFVG -> SHORT into it, 1R, swing SL",
             color=TEXT, fontweight="bold")
dark(ax)
fig.tight_layout()
fig.savefig(f"{OUT}/concept_nt_playbook.png", dpi=110, facecolor=BG)
print("wrote concept_nt_*.png")
