# Volatility, explained from the code

> **What this is.** A progressive, code-first explanation of how Alphashri computes
> **realised volatility (RV)** and consumes **implied volatility (IV)** for the Nifty
> report, and why `RV/IV` decides the `range / sell premium / buy premium` regime.
> Every number and formula below is taken from the running code, not from a textbook.
>
> Reference implementation: `api/reports_api/nifty_verdicts.py`.
> Consumer: `api/reports_api/nifty.py` (regime block), `/api/reports/nifty`.

---

## Layer 1 — Foundation (first 40%): two kinds of "how much does it move?"

### The weather analogy

You are deciding whether to carry an umbrella.

- **Realised volatility** is *what the weather actually did*: you look back at the last
  few hours and measure how much the rain changed minute to minute.
- **Implied volatility** is *the forecast price*: the umbrella seller quotes a price
  today that already embeds what the market expects the weather to do.

If the forecast says "storm" (high IV) but the sky has been calm all morning (low RV),
umbrellas are **overpriced** — that is a *sell-premium* day. If the forecast is calm
(low IV) but it has been pouring (high RV), umbrellas are **cheap** — a *buy-premium* day.

That is the whole idea. The rest is units.

### Why we need three pieces

1. **A return per bar** — how much the index moved between two candles.
2. **A way to combine bars** — variance adds; standard deviation does not.
3. **A common clock** — an annual percentage, so a 1-minute series and a 1-day
   implied vol can be compared.

---

## Layer 2 — Concepts (next 30%): the formal vocabulary

### Log return

For consecutive closes `C[i-1]` and `C[i]`:

```
r[i] = ln(C[i] / C[i-1])
```

Log returns are used because they add across time: the return of the whole session is
the sum of the per-bar log returns. That makes the variance maths below valid.

### Variance and standard deviation

```
mean = Σ r[i] / n
var  = Σ (r[i] - mean)² / (n - 1)      # sample variance, n-1 denominator
sd   = sqrt(var)                        # per-bar standard deviation
```

The code uses `n - 1` (sample), not `n` (population). With ~375 one-minute bars the
difference is small, but with 30 bars it matters.

### Annualisation

Volatility scales with the **square root of time**:

```
annual_vol = per_bar_sd × sqrt(bars_per_year)
```

For a Nifty session the code uses:

- `SESSION_MINUTES = 375` (09:15–15:30, 6h15m)
- `TRADING_DAYS = 252`

So a 1-minute bar is annualised by `sqrt(375 × 252) ≈ sqrt(94,500) ≈ 307.5`.
That is why an innocuous 0.03% one-minute move becomes ~9% annualised.

### Realised volatility (RV) — what actually happened

`realized_vol_pct(candles, prev_close)` (`nifty_verdicts.py:403`):

```
1. infer the bar size from the timestamps        (1m, 5m, 15m, ...)
2. compute log returns of the closes
3. session variance = sample variance of the returns
4. daily variance   = session variance × (375 / bar_minutes)
5. if prev_close is known:
       gap        = today_open / prev_close - 1
       gap_var    = ln(1 + gap)²
       daily_var += gap_var
6. RV = sqrt(daily_var) × sqrt(252) × 100        # percent, annualised
```

**Why the gap term exists.** An ATM option's implied vol prices the **whole 24-hour
day**, including the overnight gap. A session-only RV only sees the 375 traded
minutes, so it is structurally **low** and not comparable to IV.

The code documents a measured example (`nifty_verdicts.py:411`):

| 2026-10-21 tape | RV | RV/IV vs ATM IV 14.25 |
|---|---|---|
| session-only | **11.45%** | 0.80 → looked "20% cheap" |
| with overnight gap | **14.43%** | **1.01** → parity, the honest number |

Scaling the session figure by `sqrt(1440/375)` would print 1.57, which assumes the
16 closed hours move as much per minute as the open — they do not (Nifty overnight
gaps are ~0.6% against a ~0.9% daily move). That is why the code adds the **gap's
own variance**, not a clock ratio.

### Implied volatility (IV) — what the market prices

**We do not compute IV.** Each chain leg arrives with an `iv` field from the vendor
(Upstox). The report only **selects** the strike nearest spot and reads both legs:

`atm_ivs(rows, spot)` (`nifty_verdicts.py:138`):

```
for each strike:
    ce_iv = leg.ce.iv if > 0 else None
    pe_iv = leg.pe.iv if > 0 else None
keep the strike with the smallest |strike - spot|
return (ce_iv, pe_iv)   # None per dead leg
```

`compute_control` then:

```
atm_ce_iv, atm_pe_iv = atm_ivs(rows, spot)
skew = pe_iv - ce_iv        # positive = puts richer than calls
```

The regime block's `iv` is the **mean of the available ATM IVs**:
`(ce_iv + pe_iv) / 2` (`_avg_iv`).

### RV/IV ratio — the decision number

`rv_iv_ratio(rv, iv)` (`nifty_verdicts.py:489`):

```
ratio = rv / iv
```

Both sides must be **full-day** measures, or the ratio is biased low (the session-only
trap above). The code exposes `rv_like_for_like` so the UI knows whether the ratio is
trustworthy.

Thresholds (`nifty_verdicts.py:464`):

| Ratio | Meaning | Regime |
|---|---|---|
| ≥ **1.15** (`RV_IV_TREND`) | realised ≥ 15% above implied | **buy premium / trend** |
| ≤ **0.60** (`RV_IV_SELL`) | realised ≥ 40% below implied | **sell premium** |
| between | parity-ish | range / neutral |

A guard: fewer than **30 bars** (`REGIME_MIN_BARS`) makes RV unreliable — a 12-bar
sample at the open routinely prints 2–3× the true RV and fired a false "buy premium"
at 09:27 on 2026-10-16. Below 30 bars the ratio is ignored.

### Session range vs baseline — the other half of the regime

RV answers "how much did it move per bar"; range answers "how far did it travel".

- `baseline`: **median prior-session 09:15–12:30 range** over the last
  `BASELINE_LOOKBACK_DAYS = 25` calendar days (`get_baseline_range`,
  `nifty_verdicts.py:801`). Fetched once per process day and memoised.
- `range_pct = session_range / baseline × 100`
- `< 75` (`RANGE_SELL_BELOW_PCT`) → compressing → **sell premium**
- `> 130` (`RANGE_TREND_ABOVE_PCT`) → expanding → **trend**
- in between → neutral

### ATM straddle bleed

The ATM straddle is `CE + PE` at the strike nearest spot (open vs now). Its change is
a direct read on whether **long premium paid**:

- straddle down ≥ 15% (`STRADDLE_BLEED_PCT`) → long premium paid for nothing
- the regime verdict uses it as a cross-check when RV/IV is unavailable

---

## Layer 3 — Implementation (next 20%): the exact code

### Realised volatility

```python
# api/reports_api/nifty_verdicts.py:403  (condensed, same maths)
closes = [c["close"] for c in candles]
rets = [math.log(closes[i] / closes[i-1]) for i in range(1, len(closes))]
mean = sum(rets) / len(rets)
var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)

bar_min = infer_bar_minutes(candles)                 # 1, 5, 15, ...
daily_var = var * (375.0 / bar_min)

gap_pct = (today_open / prev_close - 1) * 100
daily_var += math.log(1.0 + gap_pct / 100.0) ** 2

rv = math.sqrt(daily_var) * math.sqrt(252.0) * 100.0 # percent
```

### Implied volatility

```python
# api/reports_api/nifty_verdicts.py:138
best = min(rows, key=lambda r: abs(r["strike"] - spot))
ce_iv = best["ce"].get("iv") or None                 # vendor field
pe_iv = best["pe"].get("iv") or None
```

No Black–Scholes inversion is performed. The vendor's IV is trusted; the code
validates only `iv > 0` (dead strikes are `0`/`None`).

### Ratio + regime

```python
ratio = rv / iv if rv and iv else None
if ratio >= 1.15:   verdict = "trend"          # buy premium
elif ratio <= 0.60: verdict = "range_sell_premium"
else:               verdict = "range"
```

### Worked example — today, 14:48 IST, 2026-11-03 (expiry day)

Live `/api/reports/nifty`:

```
iv        = 35.34          # ATM 23,700: CE 35.03, PE 35.64
rv        = 12.62
rv/iv     = 0.357          # well below 0.60
straddle  = 132.2 → 157.1  (+18.8%)
range     = 222.4 pts vs baseline 245.98  (90%)
verdict   = range_sell_premium
```

Reading it:

- IV is **high** because it is expiry day (gamma/theta), not because the market is
  moving.
- RV is **low** because the index spent the afternoon pinned at max pain 23,700.
- Ratio 0.357 ⇒ a **seller's tape**: premium is rich relative to actual movement.
- That is exactly why premiums stopped moving: theta crushes them while the pin keeps
  delta flat.

### Reproduce it yourself

```bash
source .venv/bin/activate
python - <<'EOF'
import asyncio, json
from api.reports_api import nifty_verdicts as nv

async def main():
    rv = nv.realized_vol_pct(candles, prev_close)
    iv = (nv.atm_ivs(rows, spot)[0] + nv.atm_ivs(rows, spot)[1]) / 2
    print("RV", rv, "IV", iv, "ratio", nv.rv_iv_ratio(rv, iv))

asyncio.run(main())
EOF
```

Substitute the candle/chain payload from the report (`intraday`/`strikes`).

---

## Layer 4 — Mastery (final 10%): failure modes and trade-offs

### What can go wrong

| Failure | Effect | Guard in code |
|---|---|---|
| Session-only RV vs 24h IV | Ratio biased low → false "sell premium" | add overnight gap; `rv_like_for_like` |
| Too few bars | 2–3× inflated RV at the open | `REGIME_MIN_BARS = 30` |
| Vendor IV stale/zero on dead strikes | `None`/skew garbage | `iv > 0` per leg |
| Expiry-day IV spike | High IV is mechanical, not a forecast | regime uses range + straddle too |
| Gap unknown (no prev close) | RV not comparable | ratio ignored, verdict falls back |
| Wrong bar inference | Annualisation off by √(bar ratio) | infer from timestamps |

### Trade-offs

- **Why not compute IV ourselves?** Inverting Black–Scholes needs a dividend/rate
  curve and a clean forward; the vendor already does it. We validate and compare.
- **Why not use VIX?** VIX is a 30-day constant-maturity index; the report trades the
  **front expiry**. VIX is context; ATM IV is the tradable number.
- **Why a median baseline, not a mean?** One gap day would drag a mean; the median
  prior-session range is robust.
- **Why 1-minute bars?** Finer bars = more samples (better variance estimate) but more
  microstructure noise. 15m bars reduce noise and are resampled client-side.

### What the numbers are *not*

- RV is **backward-looking**; it cannot predict the next hour.
- IV is a **price**, not a probability; it embeds supply/demand and event risk.
- A low RV/IV day can still trend tomorrow; the regime is a **conditional edge**, not
  a forecast.
- Expiry-day IV/theta dominate; the same ratio at 10:00 and 15:00 means different
  things.

---

## Reference (quick lookup)

### Constants

| Name | Value | Where |
|---|---|---|
| `SESSION_MINUTES` | 375 | `nifty_verdicts.py:367` |
| `TRADING_DAYS` | 252 | `:369` |
| `REGIME_MIN_BARS` | 30 | `:486` |
| `RV_IV_TREND` | 1.15 | `:478` |
| `RV_IV_SELL` | 0.60 | `:479` |
| `STRADDLE_BLEED_PCT` | −15 | `:481` |
| `RANGE_SELL_BELOW_PCT` | 75 | `:461` |
| `RANGE_TREND_ABOVE_PCT` | 130 | `:463` |
| `BASELINE_LOOKBACK_DAYS` | 25 | `:51` |

### Glossary

| Term | Meaning |
|---|---|
| **RV** | realised (historical) volatility of log returns, annualised % |
| **IV** | implied volatility from the vendor's option chain, annualised % |
| **RV/IV** | realised ÷ implied; <0.60 sell premium, >1.15 buy premium |
| **ATM** | strike nearest spot |
| **Skew** | `PE IV − CE IV`; positive = puts richer |
| **Straddle** | ATM `CE + PE` premium; change = long-premium P&L |
| **Baseline** | median prior-session 09:15–12:30 range (25 days) |
| **Gap** | `today_open / prev_close − 1`; its variance is added to RV |

### One-line summary

> **RV** = how much it actually moved (log returns, variance, √time, plus the
> overnight gap). **IV** = what the market charges for movement (vendor ATM).
> **RV/IV** = whether that charge is rich or cheap — and today it is **0.36**, a
> seller's tape.

---

*Written from the running code on 2026-11-03. If the formulas change, update the
line references above and the worked example.*
