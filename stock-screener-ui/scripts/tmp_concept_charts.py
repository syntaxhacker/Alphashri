"""Concept diagrams: FVG, iFVG, LRL + original strategy playbook. -> /tmp/opencode/concept_*.png"""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as patches
import numpy as np

OUT = "/tmp/opencode"
BULL, BEAR = "#26a69a", "#ef5350"
BG = "white"


def candles(ax, bars, w=0.6):
    for i, (o, h, l, c) in enumerate(bars):
        col = BULL if c >= o else BEAR
        ax.plot([i, i], [l, h], color="black", lw=1)
        b, t = min(o, c), max(o, c)
        ax.add_patch(patches.Rectangle((i - w / 2, b), w, max(t - b, 0.15), fc=col, ec="black", lw=0.8))


def style(ax, title, n):
    ax.set_xlim(-1, n)
    ax.set_facecolor(BG)
    ax.set_title(title, fontsize=13, fontweight="bold")
    ax.set_xticks([])
    ax.tick_params(left=False, labelleft=False)
    for s in ax.spines.values():
        s.set_visible(False)


# ---------- 1. FVG ----------
fig, (a1, a2) = plt.subplots(1, 2, figsize=(11, 4.5))
bull = [(10, 12, 9, 11), (11, 13, 10.5, 12.5), (14, 16, 13.8, 15.5),
        (15.5, 17, 15, 16.5), (16.5, 18, 16, 17.5)]
candles(a1, bull)
a1.axhspan(12, 13.8, color="skyblue", alpha=0.45)
a1.annotate("", xy=(4.2, 13.8), xytext=(4.2, 12), arrowprops=dict(arrowstyle="<->", color="blue"))
a1.text(4.35, 12.9, "bull FVG\nlow[i] > high[i-2]", color="blue", fontsize=9)
a1.text(0.5, 9.3, "gap = buy-side inefficiency", fontsize=9, style="italic")
style(a1, "Bullish FVG (3-bar gap)", 5)
bear = [(15, 16, 13, 13.5), (13.5, 14, 12, 12.5), (11, 11.5, 9, 9.5),
        (9.5, 10, 8, 8.5), (8.5, 9, 7, 7.5)]
candles(a2, bear)
a2.axhspan(9.5, 12, color="mistyrose", alpha=0.6)
a2.annotate("", xy=(4.2, 12), xytext=(4.2, 9.5), arrowprops=dict(arrowstyle="<->", color="red"))
a2.text(2.2, 10.4, "bear FVG\nhigh[i] < low[i-2]", color="red", fontsize=9)
style(a2, "Bearish FVG (3-bar gap)", 5)
fig.tight_layout()
fig.savefig(f"{OUT}/concept_fvg.png", dpi=110)

# ---------- 2. iFVG ----------
fig, ax = plt.subplots(figsize=(11, 4.8))
bars = [(10, 12, 9, 11), (11, 13, 10.5, 12.5), (14, 16, 13.8, 15.5),
        (15.5, 15.8, 13.5, 13.8), (13.8, 14, 11.5, 11.8),
        (11.8, 12, 10, 10.5), (10.5, 10.8, 8.5, 9)]
candles(ax, bars)
ax.axhspan(12, 13.8, xmin=0, xmax=0.62, color="skyblue", alpha=0.4)
ax.axhspan(12, 13.8, xmin=0.55, xmax=1, color="gold", alpha=0.45)
ax.text(1, 14.3, "1 bull FVG forms", fontsize=10, color="blue", fontweight="bold")
ax.annotate("2 CLOSE below bottom\n(wick alone does NOT count)", xy=(4, 11.8), xytext=(4.6, 15),
            arrowprops=dict(arrowstyle="->", color="red"), fontsize=10, color="red")
ax.text(4.6, 12.9, "3 flips to BEARISH iFVG\n(old support -> new resistance)", fontsize=10,
        color="darkgoldenrod", fontweight="bold",
        bbox=dict(fc="lightyellow", ec="gold", alpha=0.9))
ax.text(6.2, 9.2, "4 shorts work\ntoward lows", fontsize=10, style="italic")
style(ax, "Inverse FVG: failed auction flips polarity", 7)
fig.tight_layout()
fig.savefig(f"{OUT}/concept_ifvg.png", dpi=110)

# ---------- 3. LRL ----------
fig, ax = plt.subplots(figsize=(11, 4.8))
np.random.seed(3)
xs = np.arange(14)
lows = 20 - 0.5 * xs + np.random.normal(0, 0.25, 14)
bars = [(l + 1 + np.random.rand(), l + 2.2, l, l + 1.5) for l in lows]
candles(ax, [(o, h, l, c) for o, h, l, c in bars])
touch = [1, 4, 7, 10]
tx = np.array(touch)
ty = np.array([lows[i] for i in touch])
m, b0 = np.polyfit(tx, ty, 1)
ax.plot([-0.5, 13.5], [m * -0.5 + b0, m * 13.5 + b0], color="black", lw=1.8)
for i in touch:
    ax.plot(i, lows[i], "ro", ms=7)
    ax.text(i - 0.9, lows[i] - 1.6, "stop\npool", fontsize=7, color="red", ha="center")
ax.text(11, m * 11 + b0 + 0.8, "clean trendline =\nLOW RESISTANCE", fontsize=10, fontweight="bold",
        bbox=dict(fc="white", ec="black"))
ax.annotate("price is drawn here\nto collect the stops", xy=(12.5, m * 12.5 + b0), xytext=(8, 24),
            arrowprops=dict(arrowstyle="->", color="red"), fontsize=10, color="red")
ax.set_ylim(10, 25)
style(ax, "Low-Resistance Liquidity: 3-4 stacked lows = stacked stop-losses", 14)
fig.tight_layout()
fig.savefig(f"{OUT}/concept_lrl.png", dpi=110)

# ---------- 4. Full playbook (short into LRL below) ----------
fig, ax = plt.subplots(figsize=(12, 5.5))
bars = [(50, 52, 49, 51), (51, 53, 50, 52.5), (52.5, 54, 52, 53.5),
        (53.5, 54.2, 51, 51.5), (51.5, 52, 49.5, 50),
        (50, 50.5, 48, 48.5), (48.5, 49, 47, 47.5),
        (47.5, 48, 46, 46.5), (46.5, 47, 45, 45.5), (45.5, 46, 44, 44.5)]
candles(ax, bars, w=0.55)
ax.plot([-0.5, 9.5], [47.5, 43.5], color="black", lw=1.8)  # LRL of lows
ax.text(7.6, 42.4, "LRL below = TARGET", fontsize=10, fontweight="bold", color="red")
ax.axhspan(51, 52, xmin=0.28, xmax=0.5, color="gold", alpha=0.5)
ax.text(2.6, 52.6, "highest-TF iFVG swept\n(30s+1m+2m => watch 2m)", fontsize=9, color="darkgoldenrod",
        fontweight="bold", bbox=dict(fc="lightyellow", ec="gold", alpha=0.9))
ax.plot(4, 51.2, "v", color="red", ms=12)
ax.text(4.15, 51.4, "SHORT", fontsize=10, fontweight="bold", color="red")
ax.axhspan(51.2, 53.5, xmin=0.4, xmax=0.62, color="red", alpha=0.18)    # risk
ax.axhspan(48.9, 51.2, xmin=0.4, xmax=0.62, color="green", alpha=0.18)  # reward
ax.text(6.35, 52.3, "SL: above\nswing high", fontsize=9, color="red")
ax.text(6.35, 49.7, "TP: 1R\n(risk $500 -> target $500)", fontsize=9, color="green")
ax.text(0.2, 44.2, "prime window\n9:30-10:00am EST", fontsize=9, style="italic",
        bbox=dict(fc="white", ec="gray"))
style(ax, "Original playbook: LRL below -> highest-TF iFVG -> SHORT into it, 1R, swing SL", 10)
fig.tight_layout()
fig.savefig(f"{OUT}/concept_playbook.png", dpi=110)
print("wrote concept_fvg.png concept_ifvg.png concept_lrl.png concept_playbook.png")
