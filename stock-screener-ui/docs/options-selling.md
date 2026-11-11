# Selling options — what worked, what to avoid

Companion to `AGENT_OPTIONS_DAILY.md` (the daily runbook) and
`reports/OPTIONS_PAPER_SIM/agent_ledger.md` (the session ledger). Written from
the 2026-10-19 session, the first day the desk sold premium.

## The finding

On a **pin / range** day, **selling paid and buying didn't**:

| Side | Trades | Net |
|---|---|---|
| Short 22,850 straddle (manual) | 3 lots | **+₹2,736** |
| Long premium (my discretionary) | 10 | **−₹2,023** |
| Coded `nifty_iv_delta` (ATM buyer, early entries) | 6 | +₹3,006 |

The day was `range_sell_premium`: **RV 14 vs IV 33**. Options were priced for ~2×
the movement that happened; the seller collected that gap.

## Why the short straddle worked

1. **Theta** — ATM θ was −₹400 → −₹630/day, accelerating into the 0-DTE close.
2. **IV crush** — ATM IV fell ~6 points while spot stayed in the cage; a short
   straddle is short vega, so that was pure profit.
3. **Max-pain pin** — spot spent the afternoon inside **22,850–22,900**, the
   max-pain/magnet zone, so both legs decayed.
4. **Defined cage** — walls at 22,800 (puts) and 23,000 (calls) told us where the
   range would likely hold.

## Mechanics that matter

- **Margin**: a naked NIFTY short straddle is roughly **₹1.9 L/lot** at 23k
  (`costs.sell_margin_estimate`); size against the account, not the premium.
- **Costs**: two legs, two round trips — STT lands on the sell premium.
- **Stop**: use the **range edge**, not a tight premium %. A 30 % premium stop on
  a straddle is ~40–50 index points and will be wicked on 0-DTE.
- **Exit before the close**: flat by **15:10**; continuous trading ends 15:15 and
  the **CAS** runs 15:15–15:30 — never carry 0-DTE premium into the auction.
- **Partial profit**: taking one lot off at +₹419 and leaving two to decay
  protected the day's result.

## What goes wrong (and did)

- **Blind selling on a trend day.** The strategy `nifty_vrp` sells an ATM
  straddle unconditionally ~20 min after the open. On 2026-10-19 the market fell
  ~250 points — that short would have been run over. This is why `nifty_vrp` is
  **not** in the agent loop (see below).
- **Selling after the move.** Same as buying: entering a short straddle after a
  big directional leg is just buying the other side late.
- **OTM selling into expiry.** Gamma on the short strike explodes; a 0-DTE short
  OTM option can go from ₹2 to ₹40 in minutes.
- **No structural stop.** A −30 % premium stop on a straddle is inside the noise.

## The regime gate (use this before selling)

Sell premium only when **all** hold:

1. **Expansion low** — 5-min range ≤ ~1.0× the session median (`agent_options_check.py`
   prints this as `expansion: … quiet`).
2. **Pinned** — |spot − max-pain| small (inside the wall cage).
3. **Rich vol** — `regime = range_sell_premium`, i.e. RV < IV by a clear margin.
4. **No trend** — price not outside the 30-min avg band with momentum.

If any fails → don't sell. Trade the trend instead (buy, at the *start* of the move).

## What to do with `nifty_vrp`

Keep it **out of `AGENT_STRATEGIES`** as an unconditional seller. If we want the
loop to sell automatically, add a **gated range-sell** (e.g.
`NiftyRangeSeller`) that checks the gate above before entering — that is a new
strategy, not a config change to `nifty_vrp`.

## Manual commands (what was used)

```bash
# sell an ATM straddle
python -m options_paper.manual enter --opt STRADDLE --strike 22850 --premium 74.2 \
  --direction SHORT --lots 2 --stop 96 --target 44 --tag range-sell \
  --reason "pin at max pain; RV14 vs IV34"

python -m options_paper.manual status
python -m options_paper.manual exit --premium 52.5 --reason "cut before CAS"
```

The loop's `auto_manage` closes any ledger position at its stop/target, so a
shorted position is protected even if nobody is watching.
