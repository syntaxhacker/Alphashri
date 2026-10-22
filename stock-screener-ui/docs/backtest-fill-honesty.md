# Backtest Fill Honesty — the engine rules that separate a real edge from an artifact

> **This is the single most important document in the research handbook.**
> Every "edge" we found before applying these rules turned out to be a fill artifact.
> Apply them **before** any strategy work.

---

## 1. The problem
A bar-based backtest sees only OHLC — the **intra-bar path is unknown**. Two exit crediting
mistakes then manufacture winners:

### (a) Same-bar targets (the killer for LIMIT entries)
A resting **buy limit at L** with a **target T** above. A later bar's range covers **both** L and T.
The naive engine says: *"low ≤ L → filled; high ≥ T → win."* But the bar may have touched **T before L**
— in which case there was no trade, or the fill came after the move. The engine assumed the
**favourable order**, every time.

**Evidence from our run:** J 40.9% of exits were such same-bar targets; AH 37.1%; AK-2R 36.6%; K 31.2%.
Removing them flipped every one from strongly positive to **negative** (J +0.44R → −0.29R). The
spurious wins *were* the edge.

**Why it hits limit-retrace strategies hardest:** a *retrace limit* is approached by a **dip**, never
a gap-through — so the one case where the order is provable ("the bar opened at/through your limit")
almost never occurs. Measured: **99.5–100% of same-bar targets were the ambiguous kind.**

### (b) Gap-through stops (the killer for TRAILING stops)
A trailing stop is a **stop order**: if a bar **opens beyond** the stop level, a real fill is at the
**OPEN** (worse), not at the stop. The naive engine fills at the stop level → over-credits every such
exit.

**Evidence:** v3/AK leaked 16–74% of trail exits this way, mean over-credit **0.2–1.2R per trade**.

---

## 2. The rules (implement all four)

```python
# 1. NO PROFIT EXIT ON THE ENTRY-FILL BAR -------------------------------
# The entry bar may resolve the STOP (you were in), but never the TARGET.
for t in range(e, end):
    if t == e and (stop_hit_on_fill_bar):        # stop only
        exit(..., -1.0);  break
    if t == e:
        continue                                 # NOTHING ELSE on the fill bar
    # from e+1 onward, targets are legitimate
    if low[t] <= sl: exit(sl); break
    if high[t] >= tp: exit(tp); break

# 2. GAP-THROUGH STOPS FILL AT THE OPEN --------------------------------
for t in range(e+1, end):
    if open[t] <= sl:     exit(open[t])          # gapped through -> worse fill
    elif low[t] <= sl:    exit(sl)               # traded into it -> fill at sl
    ...

# 3. A LIMIT WHOSE BAR OPENED BEYOND IT FILLS AT THE OPEN ---------------
if long and open[e] < limit:  fill = open[e]     # better price, but honest
elif low[e] <= limit:         fill = limit

# 4. STOP BEFORE TARGET WITHIN A BAR (conservative) --------------------
if sl_touched and tp_touched_in_same_bar: take the STOP
```

### Also enforce
- **No look-ahead**: every signal from bars ≤ the signal bar's close; fills only on later bars.
- **One position** (per direction) unless testing concurrency explicitly.
- **An explicit session boundary** (e.g. flat at the RTH close) — never let a "swing" trade run
  unbounded by accident; if you allow it, state the cap.
- **Cost** per instrument, and **state which side** the data is (bid vs ask). **A bid-side dataset
  flatters longs** (you'd buy at the ask) — report a `+spread` sensitivity.

---

## 3. Mandatory diagnostics in every result
| metric | why |
|---|---|
| **same-bar-target share (`sbt`)** | > ~2% ⇒ the result is suspect |
| **gap-through-stop share** | the trail over-credit driver |
| **MFE / MAE** | shows *why* it loses (ours: only 26% ever reached 2R; 50–60% full −1R stops) |
| **the R-histogram** | reveals if the edge is one fat tail |
| **per-regime t** | a sign flip across regimes = noise |

---

## 4. The decisive experiment (run this on any candidate)
**Re-simulate the SAME signals three ways and compare:**
1. **Optimistic** (naive: same-bar target allowed, stop at the stop level)
2. **Fill-order-aware** (credit a same-bar target *only* if the bar **opened at/through** the limit —
   the only *provable* ordering)
3. **Pessimistic** (forbid **all** same-bar targets)

Our results: the middle agreed with the pessimistic every time (99.5–100% ambiguous), and the
optimistic was fiction. **If (2) and (3) disagree materially with (1), the edge is the artifact.**

**The cheapest structural fix:** use **market entries** (enter at the signal bar's close / the next
bar's open). A known entry price makes a same-bar target *impossible* by construction — which is why
the only sleeves that survived our audit were market-entry shapes.

---

## 5. Reference implementation (in this repo, for the NQ work)
`reports/MNQ_ICT_SETUPS/agent_code/agent_AW_honest_rescore.py` (the honest engine) ·
`agent_AV_trail_audit.py` (the trail-fill audit) · `agent_AZ_fillorder.py` (the 3-way comparison) ·
`agent_BA_sec1_truth.py` (the 1-second tick cross-check) · `agent_BF_catalog.py` (the per-instance catalogue).
The raw evidence: `CISD_LRLR_DEEPDIVE.md`, and the ledger `STRATEGY_VERSIONS.md` (rows AT/AV/AW/AZ/BA).
