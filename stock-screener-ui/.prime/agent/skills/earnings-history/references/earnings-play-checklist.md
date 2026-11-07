# Earnings Play — pre-event checklist

A repeatable, 10-step procedure for any NSE earnings event. The goal is not to
predict the number — it is to **know the bar, know the reaction history, and
pre-commit the plan** before the print.

---

## 1. Confirm the event (not the vendor date)

- [ ] Board-meeting intimation on BSE/NSE (`Corporate Announcements → Board Meeting`).
- [ ] Date **and time**: before open / during session / after close (most Indian results are after close).
- [ ] Earnings-call time and dial-in.
- [ ] Ex-dividend / record date if any.

Vendor dates drift. Example: for Mankind Q2 FY27, yfinance estimated **29 Oct 2026**; the BSE filing said the board meets on **26 Oct 2026**. Always use the filing and pass it explicitly:

```bash
... earnings_history.py --symbol MANKIND --next-date 2026-10-26
```

---

## 2. Write down the bar (consensus)

Before the print, record:

| Item | Consensus | Last quarter | YoY |
|---|---|---|---|
| Revenue | | | |
| EBITDA / margin | | | |
| PAT | | | |
| EPS | | | |
| Segment: high-margin engine | | | |
| Segment: domestic ex-engine vs IPM | | | |
| Guidance | | | |

"Beat" is only meaningful versus a specific bar. Note the **whisper number** and whether the stock has already run into the print.

---

## 3. Pull the reaction history

Run the skill and read:

- **Beat-and-fade rate** — the single most useful stat. ≥50% means good news is sold.
- **Avg T+1 move on beats vs misses** — if beats average negative, the market trades expectations, not results.
- **Gap vs intraday** — does the stock gap and go, or gap and trap?
- **Pre-20-day run-up** — >10% means the bar is elevated.
- **T+5 / T+10 drift** — is there tradeable post-earnings drift?
- **Volume on the reaction day** — >2× average confirms institutional involvement.

---

## 4. Quality-of-earnings check (the part most people skip)

A "beat" can be low quality. Check these eight lines before believing it:

1. **Revenue vs EBITDA vs PAT growth** — if PAT grows much faster than EBITDA, it's below-the-line, not operational.
2. **Effective tax rate** — compare with last year. Sunset clauses (e.g. Sikkim) raise ETR permanently.
3. **Other income** — one-off treasury gains flatter PAT.
4. **Finance cost** — acquisition debt can eat the operating beat.
5. **Amortisation vs cash EPS** — acquisitions create intangibles; cash EPS can diverge sharply from reported EPS.
6. **Working-capital days** — inventory/receivables build weakens cash conversion; check CFO/EBITDA.
7. **Segment mix** — the high-margin engine must grow; a low-growth tail can mask weakness in the headline.
8. **One-offs / exceptional items** — restructuring, impairment, labour-code charges.

> Rule of thumb: a beat driven by tax, other income or a one-off is **not** a beat the multiple should pay for.

---

## 5. Positioning & ownership

- [ ] FII / DII / MF holding trend over the last 4 quarters.
- [ ] Promoter holding and pledge.
- [ ] Free float (low float = violent gaps).
- [ ] Futures open interest and rollover; options IV into the event.
- [ ] Delivery % on recent high-volume days.
- [ ] Analyst revisions in the last 30 days (upgrades/downgrades/target cuts).

---

## 6. What is priced in?

- TTM P/E vs **peer median**, forward P/E vs own history, EV/EBITDA, PEG.
- Implied move from the ATM straddle vs the **historical |T+1| move**.
- If implied move > historical 75th percentile → the event is expensive; favour defined-risk or stand aside.
- If the stock is already down 15–20% from its high, the bar is lower — but the trend may still be down.

---

## 7. Levels (mark before the print)

- [ ] 20 / 50 / 100 / 200-DMA.
- [ ] 20-day and 60-day swing high/low.
- [ ] 52-week high/low and Fibonacci retracements of the last leg.
- [ ] ±1× and ±2× expected move from the last close.
- [ ] Volume shelf / prior gap edges.

Write the **invalidation level** now. If it triggers, exit — do not renegotiate with the market.

---

## 8. Scenario table (pre-commit)

| Outcome | Likely reaction | Plan | Invalidation |
|---|---|---|---|
| Beat + guidance raise | gap up, hold above 20-DMA | hold / add on first pullback that holds the gap | close below gap fill |
| Beat + in-line guidance | gap up then fade (common) | fade the gap if close location < 0.4 | reclaim of day high |
| In-line / mixed | range-bound | no trade; wait for T+2 | break of range |
| Miss | gap down | stand aside; short only on failed reclaim | close above gap |
| Miss + guidance cut | trend down | avoid catching the knife | — |

The **close location** (0 = day low, 1 = day high) is the cleanest single tell: a gap up that closes in the bottom third is distribution.

---

## 9. Execution rules

- **Do not chase the opening print.** Wait for the first 15–30 minutes (or the first 5-minute close) to form a range.
- **Trade the break with volume**, not the gap itself.
- **Size for the gap.** Stop-loss orders do not protect through an overnight gap. Risk ≤0.5–1% of capital per event.
- **Prefer defined-risk** (spreads, small futures) when event IV is elevated or free float is low.
- **Never average down** into a miss.
- **Time stop:** if the thesis has not played out by T+3/T+5, exit. Post-earnings drift is a 3–10 day window, not a permanent thesis.
- **Liquidity:** check the 5-day average traded value; if 2% of ADV is below your intended size, use options or skip.

---

## 10. After the event

- [ ] Record the actual EPS/revenue vs consensus, T+1 move, gap, close location, volume.
- [ ] Append to `reports/earnings/<SYM>/<SYM>_earnings_events.csv` (or re-run the script).
- [ ] Grade the thesis: right call / right call wrong reason / wrong call.
- [ ] Update the beat-and-fade stat; it changes regime with management guidance.

---

## Red flags that override a "beat"

- PAT growth > EBITDA growth by a wide margin (below-the-line beat).
- Effective tax rate falling/rising sharply without guidance.
- High-margin segment growing below company average.
- Working-capital days rising while revenue grows.
- Goodwill + intangibles > 50% of total assets and rising.
- Beat accompanied by a guidance cut or vague "second-half recovery" language.
- Stock up >20% into the print on falling volume (weak hands).

## Green flags that make a beat tradeable

- EBITDA margin expansion with volume growth.
- High-margin segment accelerating and gaining share vs IPM.
- Cash conversion ≥90% (CFO/EBITDA).
- Net debt/EBITDA falling and a clear deleveraging path.
- Guidance raised, not merely reiterated.
- Clean tax rate, no one-offs.
