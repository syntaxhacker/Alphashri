# Options analytics — IV smile, term structure, surface, probability

Status: **plan only** (no code in this document). Goal: add the analytics that
actually change a decision — where the skew is, whether the move is priced, and
what the probability is at *this* strike — not more decoration.

## 1. The questions this has to answer

1. **Is the option I am buying expensive or cheap?** ATM IV alone lies when the
   strike sits on a steep wing. Need IV at the traded strike/delta, IV rank, and
   IV vs realised.
2. **Where is the market pricing the tails?** 25Δ risk reversal, butterfly,
   smile slope; put vs call wing richness.
3. **Is the term structure normal?** Front vs back ATM IV; contango vs
   backwardation; event kinks.
4. **What is the probability of profit / of touching / of max loss?** At the
   legs' own IVs, not one flat ATM vol.
5. **Where are the magnets and walls?** Max pain, call/put walls, positive-gamma
   support/resistance, gamma flip.
6. **What does the whole surface look like?** Strike × expiry × IV, with the
   current spot and chosen legs marked.

## 2. What exists today

| Piece | Where | Notes |
|---|---|---|
| Chain per expiry | `GET /api/options/chain/{underlying}?expiry=` (`api/options.py`) | rows with `option_greeks` (delta/gamma/theta/vega/iv), OI, LTP; summary `pcr`, `max_pain`, `expected_move`, `atm_iv`, `dte` |
| Expiries/lots/ticks | `GET /api/options/underlying/{symbol}` (`api/options_underlying.py`) | weekly flag, DTE, lot, tick, `quotes_live` |
| Payoff/POP | `src/utils/optionsMath.ts` | **flat-vol lognormal, r=0**, density grid; POP/E[P&L]/±1σ |
| Max pain / PCR | `optionsMath.ts`, `api/options.py` | already computed |
| GEX levels, walls | `api/reports_api/nifty.py` `_gex_levels`, `deskPlanLevels.ts` | support/resistance/fuel from net gamma |
| IV/HV ratio | `api/premium_tracker.py` | ATM straddle only, no surface/history |
| Event IV crush | `.prime/agent/skills/position-probability/scripts/iv_crush.py` | methodology to reuse |
| Chart libs | `echarts` 6 (no `echarts-gl`) | true 3D needs a new dependency |

**Gaps:** no IV history, no smile/term aggregation, POP ignores skew, no RND,
no surface, no probability cone, no IV rank, no calibration.

## 3. Analytics catalog (value → formula)

### 3.1 IV smile / skew (per expiry)
- Use **OTM** legs (CE above spot, PE below) so IV is not dominated by intrinsic.
- x-axis: strike, log-moneyness `ln(K/F)`, or delta. Provide **both** strike and
  delta; traders read delta, the chain is by strike.
- Metrics:
  - ATM IV (interpolate the two strikes around spot).
  - 25Δ risk reversal = `IV(25Δ call) − IV(25Δ put)`; positive = calls rich.
  - 25Δ butterfly = `(IV(25Δ call)+IV(25Δ put))/2 − ATM IV`.
  - smile slope near ATM (`dIV/dlnK`), curvature (quadratic coefficient).
  - fit quality `R²`; points used/total (illiquid strikes excluded).
- Fit: quadratic in `ln(K/F)` weighted by OI; robust fallback to a monotone
  piecewise-linear interpolation if fewer than 5 valid points.
- Value: a 1.0% IV difference on a 2-week option is ~0.2% of spot in premium;
  the wing you buy is often 2–5 vol above ATM.

### 3.2 Term structure
- ATM IV per expiry (1w/2w/1m/2m/3m), plus 25Δ RR/butterfly per expiry.
- Constant-maturity 30d by linear interpolation in total variance
  (`σ²T`), not in vol.
- Classify: contango (normal), backwardation (stress/event), kink at an expiry
  (event).
- Value: a front-month spike with a flat back is an event, not a trend; calendar
  spreads and "sell the event" decisions come from this.

### 3.3 3D surface (strike × expiry × IV)
- Grid: moneyness or delta × DTE; IV as color/height.
- **Default: 2D heatmap** (ECharts `heatmap`) with contours and the spot/legs
  marked. It reads better at a 500px dock and costs no new bundle.
- Optional true 3D (`surface`) behind a lazy-loaded `echarts-gl` tab; it adds a
  large dependency and is harder to read precisely. Do not make it the default.
- Interpolation: bilinear in `(ln(K/F), sqrt(T))`; never extrapolate beyond the
  listed strikes/expiries; show "no data" cells instead of inventing vol.
- Value: shows a wing rich on the front but cheap on the back, or a surface
  twist that a single smile hides.

### 3.4 Risk-neutral density (RND) and probability
- **Breeden–Litzenberger:** `q(K) = e^{rT} ∂²C/∂K²`. In practice:
  fit a smooth call curve in `K`, take the second difference, clip negative
  values, renormalise. Sparse strikes need smoothing (SVI or a quadratic in
  `ln(K/F)`); document the fit.
- Discrete fallback: `q(K_i) ∝ max(0, C_{i-1} − 2C_i + C_{i+1})` with a small
  regularization; reject if the density is not positive after clipping.
- Outputs:
  - density curve, CDF, quantiles (5/25/50/75/95), 1σ/2σ bands.
  - **probability cone**: quantiles of `S_t` at 1/3/5/10 days (lognormal per
    tenor with the ATM term IV; skew-adjusted variant uses the smile at the
    quantile).
  - **POP** = ∫ q(K) 1{payoff(K)>0} dK; **P(max loss)**, **P(touch)**.
  - **skew-adjusted POP**: each leg's IV comes from the smile at its strike
    (interpolated), not ATM. Show both flat-ATM and skew POP with the delta.
- Touch probability: first-passage for a driftless lognormal (reflection
  formula) or a 10k-path Monte Carlo seeded and cached; label the model.
- Caveats: risk-neutral ≠ real-world; dividends/rates; pin risk at expiry;
  0-DTE degenerate.

### 3.5 Levels in the chain (reuse, don't re-derive)
Implementation contract: [OPTIONS_LEVELS_CONTRACT.md](./OPTIONS_LEVELS_CONTRACT.md).
- `call_wall` / `put_wall` (max CE/PE OI) → **RESISTANCE / SUPPORT**.
- `max_pain` → **MAX PAIN**.
- GEX `support` (largest positive net gamma at/below spot) and `resistance`
  (at/above spot), plus `fuel_up/down` only if they fit without clutter.
- Show compact markers in the strike cell (`SUP`, `RES`, `MP`, `CW`, `PW`) and a
  one-line legend/summary; do not add columns.
- Rules: suppress live-only levels when `quotes_live:false`; hide if the chain
  is one-sided/thin; never label a strike that is not in the returned window.

### 3.6 IV context
- **IV rank/percentile** over 1y (needs history), IV vs 20d realised, IV/HV.
- Event IV crush: measure the front straddle's IV before/on/after results (reuse
  the `iv_crush.py` method); show the crush in vol points and rupees.
- Value: "IV is 80th percentile into an event" is the difference between buying
  and selling premium.

### 3.7 Scenario grid
- Spot ±2/±5/±10% × IV −5/0/+5 vol × time 0/3/7 days, P&L per cell; uses the
  same payoff engine and the legs' IVs. Compact 5×3 grid, not a chart.

## 4. Data architecture

### 4.1 Snapshot store (new)
Table `option_chain_snapshots` (or `option_iv_points`):
```
id, ts (IST), underlying, expiry, strike, side (CE/PE),
ltp, iv, delta, gamma, theta, vega, oi, volume, spot, source
```
- Capture during market hours every **60–300 s** for the underlyings the dock
  opens, plus all expiries in the E1 list (cap 6). Retention 90 days (config),
  downsampled after 30 days.
- Deduplicate on `(underlying, expiry, strike, side, ts minute)`.
- This is what enables IV rank, term history, surface history and calibration.
- Do **not** write a row when `quotes_live:false` and the chain is a stale
  repeat of the previous session; store the session date explicitly.

### 4.2 IV fallback
- If `option_greeks.iv` is missing/0 (illiquid), invert Black–Scholes from the
  mid price: European, `q=0`, `r` from config (default 6.5% INR, documented),
  `T = dte/365`; solve with Brent; reject if no arbitrage-consistent root.
- Mark `iv_source: "upstox" | "inverted" | "carried"`; analytics exclude
  `carried` points older than the session.
- For US/global options (if ever), the same interface, but do not mix markets.

### 4.3 Caching
- Chain: existing 5–10 s single-flight.
- Analytics per `(underlying, expiry)` 30–60 s; surface per underlying 60 s.
- Historical reads (IV rank) from the snapshot table with a daily aggregate
  cache; never compute rank per UI poll.

## 5. Backend contract (proposed)

`GET /api/options/analytics/{underlying}?expiries=4&window=0.15`

```json
{
  "underlying": "NIFTY", "spot": 25215.7, "as_of": "...", "quotes_live": true,
  "expiries": [
    {"date": "2026-11-19", "dte": 3, "atm_iv": 12.4,
     "rr25": 1.1, "bf25": 0.8, "slope": -0.03, "fit_r2": 0.94,
     "points": [{"strike":24800,"delta":-0.12,"iv":14.1,"oi":123000,"moneyness":-0.016}]}
  ],
  "term": [{"dte":3,"atm_iv":12.4,"rr25":1.1}, {"dte":10,...}],
  "surface": {"strikes":[...], "expiries":[...], "iv":[[...]], "missing":[[...]]},
  "levels": {"call_wall":25500,"put_wall":25000,"max_pain":25200,
             "gex":{"support":25000,"resistance":25500,"fuel_up":null,"fuel_down":null}},
  "probability": {
    "model": "rnd-svi", "flat_pop": 0.61, "skew_pop": 0.58,
    "expected_pnl": -268, "sigma": 39,
    "density": [{"spot":..., "prob":...}],
    "quantiles": {"p05":..., "p25":..., "p50":..., "p75":..., "p95":...},
    "cone": [{"dte":1,"p05":...,"p50":...,"p95":...}]
  }
}
```
- One request per dock open / expiry change; not per tick. The chain keeps its
  own endpoint.
- Levels must come from the **same** shared module as the Index Report
  (`_gex_levels`, max pain, walls), not a second implementation.
- Errors: 503 `analytics_unavailable` when the chain is empty; partial data is
  allowed with `points_used`/`fit_r2` and null metrics.
- Auth: app bearer (same as the chain). Cache key includes underlying, expiry
  set, window, session and `quotes_live`.

## 6. Frontend UX

- **Where:** a compact tab strip inside the dock's payoff/chain area:
  `SMILE · TERM · SURFACE · PROB`. Do not add columns or a second page.
- Smile: line chart (IV vs delta, strike labels on hover), ATM/spot marker,
  selected legs marked; metrics line `ATM 12.4 · 25Δ RR +1.1 · BF 0.8 · R² 0.94`.
- Term: small multiples or one chart with ATM/RR25 lines by DTE; 30d
  constant-maturity marker.
- Surface: heatmap (strike/moneyness × DTE) with spot and legs; optional 3D tab
  lazy-loads `echarts-gl` only on demand, never on first paint.
- Prob: density + cone + quantiles; toggle `flat ATM` vs `skew`; POP badge and
  E[P&L] already in the dock must switch to the skew number (or show both).
- Levels: markers in the chain (`SUP/RES/MP/CW/PW`) + a one-line legend; tap a
  marker to center the chain on that strike (reuse the auto-center helper).
- 390px: charts stack; the tab strip scrolls; no 3D; heatmap can pan/zoom.
- Performance: one analytics fetch per open/expiry; charts render on tab
  activation only; dispose ECharts on tab switch; no timers.

## 7. Phases and priority

| Phase | Scope | Effort | Why |
|---|---|---|---|
| **P0** | Snapshot table + IV inversion + shared levels module + levels labels in chain | 2–3 d | Data foundation; levels are immediately useful |
| **P1** | Smile + term + 25Δ RR/BF + IV rank + skew-adjusted POP (dock) | 4–6 d | Highest decision value; no 3D dependency |
| **P2** | RND density + probability cone + surface **heatmap** + scenario grid | 4–6 d | Probability depth; heatmap is cheap |
| **P3** | Optional WebGL 3D surface + calibration dashboard (PIT/coverage) | 3–5 d | Visual polish/validation, not first value |
| **P4** | Event IV crush + alerts (skew spike/term inversion) | 3–4 d | Tied to earnings/events |

**Recommendation:** do P0 + P1 first. True 3D is last; the heatmap answers the
same question at a fraction of the bundle/perf cost.

## 8. Tests and acceptance

- Synthetic Black–Scholes chains: recover IV to 1e-6; put–call parity; smile fit
  on a known quadratic; 25Δ metrics match closed-form; term interpolation
  preserves total variance.
- RND: density ≥ 0, integrates to 1 ± 1e-6, CDF monotone, quantiles ordered;
  density recovers a lognormal when IV is flat.
- POP: 0..1, monotone where the payoff is monotone, flat vs skew differ only via
  the smile; P(max loss) + P(profit) + P(partial) = 1.
- Levels: walls match max OI, max pain matches brute force, GEX support ≤ spot ≤
  resistance, thin/one-sided chains return nulls.
- Missing greeks/IV: nulls, no NaN, no fabricated density.
- UI: tab switch disposes charts; no fetch on tick; 390px no horizontal overflow.
- Calibration (after snapshots exist): 68/95% cone coverage, PIT histogram,
  Brier score for POP buckets; report, do not silently tune.

## 9. Risks / caveats (call these out in the UI)

- **Risk-neutral ≠ real-world.** RND is the market's pricing measure; label it.
- Illiquid strikes: IV inversion noise; OI-weight and show `points_used`.
- Rates/dividends: a flat 6.5% INR is an approximation; make it configurable.
- Expiry day / 0-DTE: the density is degenerate and time-to-expiry is hours;
  either disable analytics or show a clear `0-DTE` caveat.
- Stale after close / `quotes_live:false`: never label levels or IV as live; the
  session date must travel with the data.
- Interpolation/extrapolation: no invented vol beyond listed strikes/expiries.
- 3D: `echarts-gl` adds bundle weight and WebGL risk; lazy-load, and keep the
  heatmap as the default.
- False precision: round IV to 0.1 vol and probabilities to 0.1%; show model and
  fit quality.

## 10. Decisions needed

1. Heatmap first (recommended) or true 3D from day one?
2. How many expiries in the surface (3 / 4 / 6) and which window (±10% / ±15%)?
3. Snapshot cadence and retention (60s/90d recommended; 5m after 30d)?
4. Risk-neutral density (market-implied) or a real-world blend for POP?
5. Show both flat-ATM and skew POP, or replace the current POP?
6. Scope: NSE only (current chain) or also US/global via another provider?
