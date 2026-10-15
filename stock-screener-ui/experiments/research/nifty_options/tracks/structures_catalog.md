# NIFTY option structures — hold-to-expiry catalogue
**Hypothesis.** VRP is real (ATM IV − RV ≈ +4–5 vol pts; 82% of nights realised < implied) but unreachable intraday (theta < round-trip cost); rank every standard NIFTY structure by hold-to-expiry expectancy net of spread+slippage+fees.
**Method.** `tracks/structures_catalog.py` (generalises `theta_harvest.py`). Baseline per family = **enter front weekly 5 trading days before expiry, hold to intrinsic settlement, no stop**; variants = 1-day entry + stops (2–3× credit / 0.5× debit). Synthetic BS on real 2018-26 1-min spot, causal INDIAVIX IV (flat smile); real = FYERS 2026 premiums (all MARK_END).

| rank | structure | basis | n | exp ₹ | PF | win | gross | fees | maxDD% 3L | worst ₹ | CI90 | test exp | cap15k ₹ | pass |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | ratio_spread_1pct | variance/geometry | 448 | 1,483 | 1.38 | 61% | 1,581 | 98 | -85.9 | -188,375 | [-62,2,998] | 603 | 2,953,973 | True |
| 2 | short_strangle_1pct | variance/geometry | 455 | 1,434 | 1.34 | 67% | 1,460 | 26 | -70.0 | -77,947 | [439,2,423] | 1,722 | 3,048,865 | False |
| 3 | short_strangle_0.5pct | variance/geometry | 455 | 1,426 | 1.30 | 64% | 1,462 | 36 | -77.5 | -78,293 | [335,2,498] | 1,719 | 3,064,757 | False |
| 4 | short_straddle | variance/geometry | 455 | 1,381 | 1.28 | 62% | 1,430 | 49 | -81.4 | -78,428 | [240,2,501] | 1,623 | 3,166,071 | False |
| 5 | short_strangle_2pct | variance/geometry | 455 | 1,063 | 1.41 | 77% | 1,076 | 13 | -55.9 | -76,631 | [306,1,800] | 1,123 | 4,111,157 | False |
| 6 | iron_condor_2pct_w300 | variance/geometry | 455 | 657 | 1.35 | 75% | 673 | 16 | -17.9 | -18,045 | [209,1,091] | 563 | 6,652,763 | True |
| 7 | iron_condor_2pct_w200 | variance/geometry | 455 | 488 | 1.32 | 74% | 506 | 18 | -13.8 | -11,771 | [157,816] | 403 | 8,955,666 | False |
| 8 | iron_fly_w400 | variance/geometry | 455 | 299 | 1.09 | 53% | 357 | 58 | -44.3 | -15,647 | [-345,931] | 117 | 14,609,040 | False |
| 9 | bull_call_spread_w200 | directional | 455 | 299 | 1.12 | 46% | 337 | 38 | -52.8 | -6,253 | [-149,742] | -339 | 14,617,677 | False |
| 10 | iron_condor_1pct_w200 | variance/geometry | 455 | 274 | 1.12 | 56% | 311 | 36 | -35.6 | -9,401 | [-153,701] | 354 | 15,927,822 | False |
| 11 | iron_condor_2pct_w100 | variance/geometry | 455 | 154 | 1.15 | 72% | 174 | 20 | -11.4 | -5,737 | [-42,350] | 119 | 28,473,443 | False |
| 12 | bull_put_spread_1pct_w100 | directional | 455 | 141 | 1.14 | 76% | 161 | 19 | -22.8 | -5,650 | [-64,340] | -129 | 30,930,767 | False |
| 13 | bull_call_spread_w100 | directional | 455 | 111 | 1.08 | 50% | 155 | 44 | -29.4 | -3,435 | [-125,341] | -211 | 39,545,571 | False |
| 14 | bear_call_spread_2pct_w100 | directional | 455 | 98 | 1.14 | 85% | 109 | 11 | -9.4 | -6,134 | [-55,254] | 193 | 44,560,391 | True |
| 15 | bull_put_spread_2pct_w100 | directional | 455 | 59 | 1.09 | 86% | 68 | 9 | -13.7 | -6,235 | [-99,207] | -74 | 74,130,157 | False |
| 16 | iron_condor_1pct_w100 | variance/geometry | 455 | 6 | 1.00 | 50% | 49 | 44 | -24.8 | -4,228 | [-230,240] | 126 | 762,742,446 | False |
| 17 | bear_call_spread_1pct_w100 | directional | 455 | -122 | 0.90 | 68% | -100 | 23 | -38.3 | -5,317 | [-335,95] | 255 | inf | False |
| 18 | calendar_long_front_CE | variance/geometry | 454 | -146 | 0.99 | 52% | 854 | 1,000 | -614.9 | -176,498 | [-4,190,3,884] | -1,256 | inf | False |
| 19 | iron_fly_w200 | variance/geometry | 455 | -237 | 0.87 | 36% | -166 | 71 | -38.3 | -5,496 | [-547,76] | -290 | inf | False |
| 20 | long_condor_1pct_w100 | variance/geometry | 455 | -291 | 0.81 | 50% | -250 | 42 | -61.7 | -5,409 | [-519,-61] | -401 | inf | False |
| 21 | bear_put_spread_w100 | directional | 455 | -320 | 0.80 | 40% | -282 | 37 | -72.7 | -3,565 | [-544,-88] | -9 | inf | False |
| 22 | calendar_short_front_PE | variance/geometry | 454 | -468 | 0.65 | 41% | -415 | 53 | -71.4 | -7,937 | [-682,-255] | -469 | inf | False |
| 23 | synthetic_short | directional | 445 | -493 | 0.95 | 47% | -440 | 53 | -356.1 | -110,070 | [-2,537,1,491] | 1,934 | inf | False |
| 24 | calendar_short_front_CE | variance/geometry | 454 | -507 | 0.62 | 40% | -444 | 63 | -76.9 | -8,198 | [-714,-299] | -517 | inf | False |
| 25 | bear_put_spread_w200 | directional | 455 | -510 | 0.82 | 37% | -478 | 32 | -131.1 | -6,545 | [-921,-85] | 104 | inf | False |
| 26 | synthetic_long | directional | 442 | -557 | 0.95 | 52% | -502 | 55 | -235.7 | -246,530 | [-2,878,1,750] | -2,278 | inf | True |
| 27 | long_condor_2pct_w200 | variance/geometry | 455 | -631 | 0.72 | 26% | -613 | 18 | -106.6 | -10,978 | [-983,-275] | -504 | inf | False |
| 28 | ratio_spread_2pct | variance/geometry | 455 | -1,132 | 0.78 | 45% | -1,078 | 55 | -214.9 | -583,844 | [-3,893,910] | -1,540 | inf | False |
| 29 | long_strangle_2pct | variance/geometry | 455 | -1,191 | 0.69 | 23% | -1,179 | 12 | -225.3 | -50,473 | [-1,933,-431] | -1,279 | inf | False |
| 30 | long_strangle_1pct | variance/geometry | 455 | -1,597 | 0.72 | 33% | -1,573 | 25 | -312.1 | -51,763 | [-2,585,-602] | -1,884 | inf | False |
| 31 | long_straddle | variance/geometry | 455 | -1,683 | 0.74 | 37% | -1,636 | 47 | -336.0 | -51,582 | [-2,806,-545] | -1,967 | inf | False |

**Configs clearing the full gate** (OOS>0, n≥100, CI excl 0, maxDD<25%; baseline or stop variant).
| config | basis | full exp ₹ | PF | maxDD% 3L | worst ₹ | test n | test exp ₹ | test PF | test CI90 |
|---|---|---|---|---|---|---|---|---|---|
| synthetic_long_ed5_s0.5 | directional | 3,552 | 5.27 | -10.0 | -2,059 | 195 | 3,184 | 4.09 | [1,662,4,852] |
| ratio_spread_1pct_ed5_s2.0 | variance/geometry | 1,328 | 1.60 | -23.7 | -37,222 | 194 | 1,542 | 1.72 | [353,2,891] |
| iron_condor_2pct_w300_ed5_s2.0 | variance/geometry | 713 | 1.42 | -18.7 | -13,225 | 195 | 622 | 1.42 | [122,1,123] |
| bear_call_spread_2pct_w100_ed5_s2.0 | directional | 183 | 1.35 | -5.3 | -4,671 | 195 | 246 | 1.65 | [109,379] |

**Artifact check (IV=RV)** — re-pricing every strike at trailing RV removes the VRP; a collapse means the edge *is* the model's IV input, not geometry.
| config | VRP exp ₹ | VRP PF | IV=RV exp ₹ | IV=RV PF | IV=RV test exp ₹ |
|---|---|---|---|---|---|
| iron_condor_2pct_w300_ed5_s2.0 | 713 | 1.42 | -110 | 0.93 | -134 |
| ratio_spread_1pct_ed5_s2.0 | 1,328 | 1.60 | 720 | 1.29 | 537 |
| short_strangle_1pct_ed5_sNone | 1,434 | 1.34 | -884 | 0.83 | -713 |
| short_straddle_ed5_sNone | 1,381 | 1.28 | -1,507 | 0.77 | -1,612 |
| iron_condor_2pct_w300_ed5_sNone | 657 | 1.35 | -532 | 0.76 | -539 |
| bear_call_spread_2pct_w100_ed5_s2.0 | 183 | 1.35 | -75 | 0.85 | 47 |

**Real-premium transfer (RED TEAM).** pooled real n=419 exp ₹-269 PF 0.79; every cached real contract expires **after** the data window (nearest 2026-09-29 > 2026-09-25) so **nothing settles at intrinsic** — all 419 exits MARK_END, ~5 overlapping entry vintages × 31 families, not a portfolio series.
**Red-team.** (1) **Model-IV artifact:** every strike priced at combine_iv=0.65·INDIAVIX+0.35·RV with a *flat* smile, so VRP is baked in; at IV=RV the short strangles/straddle/iron-condor collapse to ₹−0.1k…−1.6k (table) — the synthetic edge *is* the VRP assumption and the 18-22/23-26 split is not independent of it. (2) **Stop-mechanics artefact:** ratio_spread_1pct only clears the gate *with* the 2×-credit stop (no-stop DD −86%, full CI [−62,2,998] spans 0; 33% stopped, filled at the stop level, not the gap); the same idealisation flatters calendar_long_front_CE ed1+stop (exp ₹16k, DD −146%). (3) **Directional ≠ variance:** synthetic_long/short and bull/bear verticals correlate |0.6–0.8| with the spot move (NIFTY drift). (4) **Tail:** naked-short DD −56…−86% of ₹3L is a few gap days (worst −₹78k); strangle OOS CI>0 but DD does not.
**Verdict: DEFER.** No structure is both gate-clearing and non-artifactual. The two gate-clearing variance configs are fragile — iron_condor_2pct_w300 stop2 (OOS ₹622, CI [122,1123], DD −18.7%) collapses to ₹−110 at IV=RV (pure model VRP), and ratio_spread_1pct stop2 (OOS ₹1,542) survives IV=RV but exists only because of the stop fill assumption. The gate-clearing bear_call_spread (OOS ₹246) and synthetic_long are directional beta. Naked short strangles have OOS CI>0 but 30–86% DD; every long-vol structure is solidly negative. Re-confirm on real expiry-settled weekly chains first.
