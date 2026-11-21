# Options analytics — IV smile, term structure, surface, probability

Status: **P0/P1 + P2 dashboard shipped (P2 on 2026-11-17)** — shared levels,
chain truth, snapshot capture, the analytics endpoint
(`/api/options/analytics/{symbol}`), IV math, client/state/math and the
SMILE/TERM/SURFACE(heatmap)/PROB dock tabs are implemented. The full-screen
**Options Analytics dashboard** now ships four pillars (VOLATILITY / POSITIONING
/ DEALER / LIQUIDITY) backed by new per-expiry engine blocks. True 3D and
calibration remain design. Verified scope, decisions and live evidence are
collected in "Verified scope, decisions & live evidence (2026-11-16)" below;
this document remains the design record. Goal: add the analytics that actually change a decision — where the skew
is, whether the move is priced, and what the probability is at *this* strike —
not more decoration.

## Verified scope, decisions & live evidence (2026-11-16)

**Scope — NSE only.** No US/global options. Chain data is the Upstox-backed
`GET /api/options/chain/{underlying}?expiry=` (`api/options.py`). Every option
price is **LTP only**: chain rows also carry `close_price`, a stale daily
reference for an option (session-mismatched), and it must never be used.

**Decisions (resolved).**
- Surface: 2D heatmap first; true 3D behind an optional lazy tab, last.
- Snapshots: every **60 s**, **90-day** retention (no 5 m/30 d downsample yet).
- POP: show **both flat-ATM and skew-adjusted**; never silently replace the
  current number.
- RND: only from a fitted / arbitrage-repaired smile — raw quotes show
  **34–37% negative butterflies**, so raw second differences are unusable.
- 25Δ RR sign: **`IV(25Δ call) − IV(25Δ put)`**, positive = calls rich. This is
  what the probe, `api/options_iv.py` and the frontend `riskReversal` /
  `ivSkewStats` now use (aligned from the earlier `put − call`).

**Live verification (2026-11-16, read-only probe `scripts/market/options_analytics_probe.py`
against the local Upstox-backed chain; no DB/Redis writes).**

| Underlying | ATM IV | 25Δ RR (call − put) |
|---|---|---|
| NIFTY (1D / 7D / 15D) | 15.87 / 14.06 / 13.69 | +0.29 / −1.15 / −1.37 |
| RELIANCE | 20.26 / 23.44 / 22.03 | +1.22 / +0.12 |

- Max pain recomputed from the shared module matched the chain summary **9/9**.
- IV coverage **61–78%** of legs; **22–35% of near legs** have missing/zero IV;
  wings printing >100 are dropped by the shared 100-vol cap
  (`api/options_conventions.IV_MAX`). It was 60 until 2026-11-17: that silently
  discarded genuine 79–83 prints on high-vol stocks (KAYNES) and emptied the
  analytics tabs while the chain still showed the IV.
- GEX: **NIFTY degraded (36–47% gamma coverage)**; RELIANCE healthy.
- **ONGC had no walls tape**; stock underlyings expose only **3 expiries** (thin
  term structure).

**Data plumbing (shipped, 2026-11-16).** The chain frame now carries
`market_state`, `quotes_live`, `session_date`, `data_as_of`, per-leg `iv_valid`
and `levels` (`api/options.py:_build_chain_response`; legacy
`summary.max_pain` stays a bare number). The snapshot store exists — model and
migration `2026_11_16_1400-os1a2b3c4d5e`, writer `api/options_snapshots.py`
(one capture per IST minute while `open`, one per session when `closed`; 90-day
`purge_old_snapshots`), read path `scripts/market/options_calibration.py`. Pure
IV math (`api/options_iv.py`) and shared levels (`api/options_levels.py`, with
anti-drift tests) are in place. `GET /api/options/analytics/{symbol}` is
**registered** (`api_server_fastapi.py`, present in `openapi.yaml`) and returns
expiries with smile metrics plus levels. Frontend client/math/state
(`src/api/optionsAnalytics.ts`, `src/utils/optionsAnalyticsMath.ts`,
`src/state/optionsAnalytics.ts`) and the lazy SMILE/TERM/SURFACE(heatmap)/PROB
dock tabs are shipped, with chain level labels (`MP/CW/PW/SUP/RES` chips +
390px `M/C/P/S/R` letters). IV math: ATM IV is the average of the ATM CE and PE
prints; a gamma-coverage warning is emitted when near-ATM gamma coverage is low.
**IV inversion (§4.2) is not implemented** — missing IV stays missing.

### Operational limits (verified in source, 2026-11-16)

- **Analytics rate limit** (`api/rate_limit.py`, `api/options_analytics.py`): 30 tokens per 60 s per client IP, charged only on cold builds — a warm analytics-cache read never consumes a token. Exceeding it returns **429** with a `Retry-After` header and a fixed `{"code": "rate_limited", ...}` detail (upstream text never reaches the client).
- **Cold chain builds** (`api/options_analytics.py`): a global (module-level) `BoundedSemaphore` caps concurrency at **4**; waiting >30 s for a slot raises a structured **503** instead of hanging.
- **Fixed 503 bodies**: `analytics_unavailable` (analytics) and `upstream_unavailable` (underlying/chain fetch, `api/options_underlying.py`). Exception/upstream text is logged server-side only; detail strings are constants.
- **Market snapshot** (`api/market_screen/snapshot.py`): in-memory shaped-frame cache is a **32-entry LRU**; disk-stale snapshots are **JSON** (`snapshot_stale_*.json`, no pickle). `_scan_window()` scans the full `MAX_LIMIT` (=4000) frame once for US/hygiene universes then slices per request; India ceiling-maps the cap onto `FETCH_LIMIT_LADDER = (50, 100, 250, 500, 1000, 2000, 4000)` and slices the cached bucket to the exact `limit`. Cache is keyed by `(universe, scan_window)`, so at most **7 buckets per universe** are scanned instead of one per client `limit`. `force=1` has a **5 s** cooldown (`FORCE_COOLDOWN_SEC = 5.0`) per `(universe, scan_window)`: a forced request inside it reuses the usable cached frame (fresh entry → `cached=True`, `stale=False`) instead of rescanning; concurrent forces still singleflight and non-force TTL paths are unchanged.
- **Auth unchanged**: the analytics endpoint remains public (no `get_current_user`), same posture as `/api/options/chain`; no auth was added or removed.
- **Live auth (verified 2026-11-17)**: public does not mean keyless — a cold chain build still needs valid Upstox OAuth (or a warm chain cache); without a token the endpoint returns **401 `upstox_auth_required`**, not 503. Dashboard E2E mocks analytics, so live verification requires reconnecting Upstox in Settings. US chart uses Yahoo (no broker token) and works live.

## P2 dashboard — pillars, blocks & contract (shipped 2026-11-17)

The full-screen dashboard (`/options/analytics/:symbol`, shell
`src/pages/options/OptionsAnalyticsPage.tsx`) is a single fetch of
`GET /api/options/analytics/{symbol}` with four lazy-loaded pillar tabs
(`PillarKey = volatility | positioning | dealer | liquidity`, from
`src/types/optionsDashboard.ts`):

| Pillar | Blocks / charts (per selected expiry unless noted) |
|---|---|
| **VOLATILITY** | ATM IV smile by strike (IV points), ATM IV term structure by DTE, risk-neutral probability density, IV vs realised-vol cone |
| **POSITIONING** | call/put OI by strike, OI change + volume by strike, max-pain payout curve, cumulative PCR by strike |
| **DEALER** | net gamma exposure (GEX) profile, net delta exposure (DEX) profile, vanna + charm profiles, theta decay by expiry/tenor |
| **LIQUIDITY** | median-spread + illiquid KPIs, bid-ask spread heatmap by strike × expiry, volume/Open-interest ratio by strike |

**Wire additions** (all nullable; missing ≠ 0 — owned by
`api/options_analytics.py` response models and now described in `openapi.yaml`):
per-expiry `positioning`, `dealer`, `liquidity`, `rnd` blocks, a top-level `rv`
(realised-vol cone) term, plus `marketState`/`sessionDate`/`quotesLive`.
Engines: `api/options_{positioning,dealer,liquidity,rnd,rv}.py`. Each is
best-effort: a missing/broken engine degrades that one block to `null` and adds
a warning (`rv_unavailable`, `used_smile_fallback`), never a 500. The frontend
also builds chart-ready projections (per-strike/per-tenor pairs) from the raw
parallel arrays the engines emit — those arrays are never flattened to a single
aggregate.

**Test counts (targeted, 2026-11-17):**

- Backend analytics/engine suite: **262 tests collected**
  (`test_options_{analytics,analytics_dashboard,positioning,dealer,liquidity,rnd,rv,iv,conventions}.py`,
  `test_options_analytics_probe.py`, `test_options_calibration.py`).
- Frontend dashboard/analytics: **114 passed across 13 files**
  (four pillar suites, page shell, API/state/math/config).
- E2E: `options-analytics.spec.ts` **6**, `options-dashboard.spec.ts` **4**
  (mocked; not run in this session).
- OpenAPI drift guard: **26/26 passed** (`tests/contract/test_openapi_sync.py`)
  after regenerating `openapi.yaml` via `scripts/export_openapi.py`.

## Verification (shipped, 2026-11-16)

Metric definitions used in the probe-vs-endpoint comparisons are in
[Metric definitions](#metric-definitions) below — read them before treating a
number mismatch as a bug.

- Analytics tests at wiring time: **235 backend + 82 frontend** passing.
- Options regression: **322 backend** passing.
- E2E: **33/33** options, **18/18** level-label, and analytics **19/20 → 20/20**
  after the refresh wiring.
- Max pain from the shared module matched the chain summary **9/9**.
- ATM IV corrected to the probe convention (ATM CE/PE print average).
- 25Δ RR sign is **`call IV − put IV`** (positive = calls rich), matching the
  probe and `api/options_iv.py`.

### Metric definitions

- **ATM IV (analytics)** = average of the snapped ATM strike's CE and PE IV when
  both are valid; one-sided uses the single available side; otherwise
  bracketing-strike interpolation. Do **not** compare it to `summary.atm_iv`,
  which is a single CE leg at the anchor strike (legacy) — the expected 0.2–0.6
  vol gap is methodological, not an error. Live check (NIFTY 1D/7D/15D):
  analytics **16.145 / 14.635 / 14.210** vs probe **16.12 / 14.62 / 14.22**.
- **25Δ RR** = 25Δ call IV − 25Δ put IV (`call − put`); exact match with the
  probe. **Fly** = `(call + put)/2 − ATM`.
- **gamma_coverage** = fraction of near-ATM (±5% of spot) legs with finite
  `gamma > 0`; `gex_degraded` fires below **0.50** or when no gamma exists. The
  probe's 36–47% is a **different** definition (share of OI-bearing strikes
  carrying gamma) — do not use it to judge the endpoint.
- **Levels** (walls / max pain / GEX) come from `api/options_levels.py`; `null`
  means none, never `0`.
- Analytics is **public** (no auth gate). At this 2026-11-16 verification,
  snapshot history was still empty (capture had just been wired) and
  **RND density and the probability cone were not built yet** — both shipped
  with P2 on 2026-11-17 (see "P2 dashboard — pillars, blocks & contract" above).

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
| Chart libs | `echarts` 6 (no `echarts-gl`) | true 3D needs a new dependency |

**Gaps (P2+):** no IV history, no IV rank, no calibration — all gated on
snapshot history. RND density, the probability cone, skew-adjusted POP and the
realised-vol cone shipped with P2 on 2026-11-17 (see the P2 dashboard section
above); smile/term aggregation and the 2D surface heatmap shipped in P1.
Remaining: scenario grid, calibration and optional true 3D.

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
- 390px: charts stack; all five analytics tabs fit (the strip's `overflow-x-auto`
  is an overflow guard, not active scroll); no 3D; heatmap can pan/zoom.
- Performance: one analytics fetch per open/expiry; charts render on tab
  activation only; dispose ECharts on tab switch; no timers.
- **Visual contract:** shipped tab labels, persistent context, verdict chips,
  per-tab reading rules, empty-state wording and the 100-point IV cap fix are
  recorded in [OPTIONS_CHAIN_COMPONENT_PLAN.md §4.4](./OPTIONS_CHAIN_COMPONENT_PLAN.md#analytics-visual-contract-shipped-2026-11).

## 7. Phases and priority

| Phase | Scope | Status (2026-11-16) | Remaining |
|---|---|---|---|
| **P0** | Snapshot table + IV inversion + shared levels module + levels labels in chain | **Shipped.** Shared levels module (anti-drift tests), snapshot store + capture (one/minute open, one/session closed), chain truth fields (`market_state`/`quotes_live`/`session_date`/`data_as_of`/`iv_valid`/`levels`) and chain labels (`MP/CW/PW/SUP/RES` + 390px letters) | IV inversion (§4.2) not built; IV rank waits on snapshot history |
| **P1** | Smile + term + 25Δ RR/BF + skew-adjusted POP (dock) | **Shipped.** Pure IV math (`api/options_iv.py`: ATM CE/PE average, gamma-coverage warning), `/api/options/analytics/{symbol}` with smile metrics, client/math/state and SMILE/TERM/SURFACE(heatmap)/PROB tabs | RND density/cone + skew-adjusted POP are P2 (fitted-smile phase); IV rank needs history |
| **P2** | RND density + probability cone + surface **heatmap** + scenario grid | **Shipped (2026-11-17):** full-screen 4-pillar dashboard + per-expiry positioning/dealer/liquidity/rnd engines + realised-vol term; heatmap tab shipped | Scenario grid not built; RND from the fitted smile is labelled model-dependent; calibration still design |
| **P3** | Optional WebGL 3D surface + calibration dashboard (PIT/coverage) | design only | 3D last; calibration after snapshot history exists |
| **P4** | Event IV crush + alerts (skew spike/term inversion) | design only | — |

**Recommendation:** P0 + P1 + the P2 dashboard are done (see the pillars/block
table above). Remaining: scenario grid, calibration, and true 3D last — the
heatmap answers the same question at a fraction of the bundle/perf cost.

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

## 10. Decisions — resolved 2026-11-16

1. **Surface:** 2D heatmap first; true 3D (`echarts-gl`) optional and last.
2. **Expiries/window:** not fixed. Stocks expose only 3 expiries (thin term) —
   do not fabricate a 30d point for them; ±10% vs ±15% remains open.
3. **Snapshots:** 60 s cadence, 90-day retention.
4. **RND / POP:** market-implied (risk-neutral, labelled), from a fitted /
   arbitrage-repaired smile only; show both flat-ATM and skew POP.
5. **Scope:** NSE only — no US/global options.
6. **25Δ RR sign:** `call IV − put IV` (positive = calls rich); the frontend
   `riskReversal` / `ivSkewStats` are now aligned to this convention.

## 11. Open risks (live status, 2026-11-16)

- **RR sign alignment: resolved.** Backend/probe and the frontend
  `riskReversal`/`ivSkewStats` now use `call − put` (positive = calls rich).
- **RND density / probability cone: shipped with P2 (2026-11-17); this was an
  open risk at the 2026-11-16 snapshot.** 34–37% of raw quote butterflies are
  negative, so the engine derives RND from a fitted / arbitrage-repaired smile
  (`api/options_rnd.py`) and labels it model-dependent; the probability cone is
  the `Probability.cone` block.
- **IV rank waits for snapshot history.** Capture is wired (one/minute while
  `open`, one/session when `closed`) but no history has accumulated yet — IV
  rank, history and calibration have no data until it fills.
- **True 3D surface: optional, not built.** 2D heatmap is the shipped default;
  `echarts-gl` would be a lazy-loaded last step.
- **Thin term for stocks:** only 3 expiries listed; suppress 30d interpolation
  and term-slope reads instead of inventing a point.
- **ONGC had no walls tape** in the live probe; don't expect walls for every
  underlying.
- **Analytics endpoint is public** — no `get_current_user` gate (same posture as
  `/api/options/chain`), though §5 specified app bearer auth.
- **0-DTE:** `T→0` degenerates the density/POP; floor `T` or disable and show the
  caveat (see `OPTIONS_CHAIN_COMPONENT_PLAN.md`).
- **openapi.yaml regeneration: done (2026-11-17).** Regenerated after the
  dashboard + US-chart contract additions (`positioning`/`dealer`/`liquidity`/
  `rnd`/`rv` on the analytics response, `SymbolChartResponse` on the US chart
  route). Drift guard `tests/contract/test_openapi_sync.py` passes **26/26**;
  never hand-edit the generated file.
