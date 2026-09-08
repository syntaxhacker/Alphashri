"""Why-trades-fail cards in the NT template — real trades from the loss study.

A 08-27 LONG 3m risk 92: +0.81R given back -> SL -92.3 (the reversal)
B 08-26 SHORT 1m risk 68: MFE +0.14R, dead in 5 min (never alive)
C 08-27 SHORT 2m risk 111 (2.8x ATR): wide-stop blowup -112.2
D 08-21 SHORT 3m risk 79: gapped through stop -> -160.1 (-2.03R slippage)
E 09-02 LONG 3m into VAH@0.41R: wall holds -> SL -57.7 (8 winners walked through)
-> /tmp/opencode/fail_[abcde].png
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nt_template import (new_fig, candles, zone, hline, riskbox, note, save,
                         BULL, BEAR, TEXT, MUTED, ACCENT, IFVG_S, TREND)

# A — reversal
fig, ax = new_fig("FAIL A — the reversal: +0.81R given back (08-27 LONG 3m, risk 92 -> SL -92.3)")
bars = [(100, 100.6, 99.7, 100.3), (100.3, 101.2, 100, 100.9), (100.9, 102.5, 100.7, 102.1),
        (102.1, 103.4, 101.8, 103.0), (103.0, 103.2, 101.9, 102.2), (102.2, 102.4, 100.5, 100.8),
        (100.8, 101, 99.2, 99.5), (99.5, 99.7, 98.4, 98.6), (98.6, 98.8, 97.6, 97.8)]
candles(ax, bars)
riskbox(ax, 100, 96, 104, "LONG", -1, 9)
ax.plot(3, 103.0, "o", color=BULL, ms=9)
note(ax, 3.3, 103.6, "+0.81R here — BE@0.5R would scratch", c=BULL, fontweight="bold")
ax.plot(8, 97.8, "x", color=BEAR, ms=10, mew=2)
note(ax, 5.2, 96.6, "-1R: full 92 pts lost", c=BEAR, fontweight="bold")
note(ax, 0, 105.2, "5/13 losers died this way: -1.5R swing each", c=MUTED, style="italic")
save(fig, "fail_a_reversal.png")

# B — never alive
fig, ax = new_fig("FAIL B — never alive: MFE +0.14R (08-26 SHORT 1m, min_open +5m -> SL -68.7)")
bars = [(100, 100.4, 99.6, 100.1), (100.1, 100.6, 99.9, 100.4), (100.4, 101.4, 100.2, 101.2),
        (101.2, 102.1, 101, 101.9)]
candles(ax, bars)
riskbox(ax, 100, 102, 98, "SHORT", -1, 4)
ax.annotate("opening-drive noise\nfirst-5-min entry", xy=(3, 101.9), xytext=(1.2, 103),
            arrowprops=dict(arrowstyle="->", color=BEAR), fontsize=10, color=BEAR)
note(ax, 0, 97.2, "4 of 5 instant losers entered <= +5 min or >= +28 min", c=MUTED, style="italic")
save(fig, "fail_b_never_alive.png")

# C — wide stop
fig, ax = new_fig("FAIL C — wide stop: risk 111 = 2.8x ATR (08-27 SHORT 2m -> SL -112.2)")
bars = [(100, 100.5, 99.5, 99.9), (99.9, 100.3, 99.4, 100.0), (100, 100.7, 99.7, 100.4),
        (100.4, 101.6, 100.2, 101.3), (101.3, 102.4, 101, 102.1), (102.1, 103, 101.8, 102.7)]
candles(ax, bars)
riskbox(ax, 100, 105, 95, "SHORT", -1, 6)
note(ax, 3.4, 104.2, "SL 111 pts away", c=BEAR, fontweight="bold")
note(ax, 3.4, 96.0, "TP needs 111 pts of open-drive travel", c=MUTED)
note(ax, 0, 93.4, "every trade risking 57+ lost (7/7) — far LRL = weak magnet + big stop", c=MUTED,
     style="italic")
save(fig, "fail_c_wide_stop.png")

# D — slippage
fig, ax = new_fig("FAIL D — slippage: stop gapped through (08-21 SHORT 3m risk 79 -> -160.1 = -2.03R)")
bars = [(100, 100.4, 99.5, 99.8), (99.8, 100.1, 99.2, 99.5), (99.5, 103.8, 99.3, 103.4),
        (103.4, 104, 102.8, 103.6)]
candles(ax, bars)
hline(ax, 102, BEAR, label="SL 102 (stop order)")
ax.plot(3, 103.6, "x", color=BEAR, ms=11, mew=2.5)
note(ax, 1.0, 104.6, "filled 81 pts late: 1R math assumes clean fills", c=BEAR, fontweight="bold")
note(ax, 0, 98.2, "open volatility does not oblige fixed-R math — one slip wipes ~3 winners",
     c=MUTED, style="italic")
save(fig, "fail_d_slippage.png")

# E — the wall that sometimes isn't
fig, ax = new_fig("FAIL E — the wall that sometimes holds (09-02 LONG 3m into VAH@0.41R -> SL -57.7)")
bars = [(100, 100.5, 99.7, 100.2), (100.2, 101.4, 100, 101.1), (101.1, 101.7, 100.8, 101.3),
        (101.3, 101.6, 100.9, 101.0), (101.0, 101.2, 99.8, 100.0), (100, 100.2, 98.6, 98.8),
        (98.8, 99, 97.8, 98.0)]
candles(ax, bars)
zone(ax, 102.4, 101.6, kind="ifvg", label="VAH 0.41R above entry")
riskbox(ax, 100, 96, 104, "LONG", -1, 7)
ax.plot(3, 101.0, "o", color=BEAR, ms=8)
note(ax, 3.3, 101.9, "stalled twice, reversed", c=BEAR, fontweight="bold")
note(ax, 0, 96.6, "same wall: 8 winners TP'd straight through a <1R blocker — references don't repel in the drive",
     c=MUTED, style="italic")
save(fig, "fail_e_wall.png")
print("wrote fail_a..e")
