# India Board — Edge Roadmap

**Scope:** build an NSE F&O analytics edge that Sensibull / Opstra / Quantsapp do not give,
using our own Fyers-captured dataset.
**Status:** design doc → implementation waves.
**Not investment advice.** Research tooling only. Every "edge" below is a *hypothesis to be
measured*, not a claim. Section 6 exists precisely so claims must survive measurement.

---

## 1. Where Sensibull (and the field) is weak

Capability matrix from Sensibull's own feature list + independent 2026 reviews
(`sensibull.com`, `blog.sensibull.com`, `algotest.in/blog/sensibull-alternatives-india`,
`knowyourbrokerage.in/tools/opstra`, `equitiesindia.com/tools-directory/sensibull-review`).

| Capability | Sensibull | Opstra | Quantsapp | **Our angle** |
|---|---|---|---|---|
| Option chain + Greeks/IV per strike | ✅ Pro | ✅ | ✅ | parity — but we can compute **our own** derived metrics |
| OI / ΔOI / PCR / max pain charts | ✅ | ✅ | ✅ | parity |
| Multi-strike OI charts, live options charts | ✅ Pro | ✅ | ✅ | parity |
| FII/DII + participant data | ✅ daily | ✅ | ✅ | gap we can close **with derived positioning** instead |
| Strategy builder + payoff + POP | ✅ (flagship) | ✅ | ✅ | out of scope (execution layer) |
| Options screener (IVP, PCR, OI, buildup) | ✅ fixed presets | ✅ | ✅ | **arbitrary multi-factor screens over our own persisted history** |
| Historical option-chain replay / backtest | ❌ limited (Draft Portfolios = live only) | ✅ paid | partial | **we persist the chain ourselves → replay is a data-model problem, not a vendor feature** |
| Market-wide, cross-underlying live scanning (all 210 F&O names) | ❌ symbol/expiry-centric | scans OI | scans | **we already scan all 210 every 5 min** |
| Volume-confirmed positioning (writing vs churn vs unwind) | ❌ shows ΔOI only | ❌ | partial | **ΔOI × Δvol classifier** |
| Liquidity/spread-aware signal filtering | ❌ | ❌ | ❌ | **bid/ask width filter — kills untradeable fake walls** |
| Intraday wall-migration tracking per name | ❌ (day-level) | ✅ some | partial | **our 2-min snapshots already have it** |
| Measured hit-rate of a signal on our data | ❌ | partial | partial ("Trade Recap") | **eval harness: every signal logged + forward return** |
| Rollover % + basis jointly with options positioning | ⚠️ partial | ⚠️ | ⚠️ | **one view: basis + rollover + wall map** |
| Raw chain export for our own ML | ❌ Pro Excel only | ❌ | ❌ | **JSONL archive → our own models** |

**The honest summary:** Sensibull is a *view + execution* product. Its weakness is **history,
measurement, and cross-market scanning**. We already collect exactly those things. So the
strategy is not "clone Sensibull" — it is **out-archive and out-measure it**.

---

## 2. What Fyers v3 actually gives us (currently mostly unused)

This is the single biggest lever. Source: `FyersDev/fyers-skills` reference + live probe of
`/data/options-chain-v3` on 2026-09-28.

| Fyers v3 capability | What it unlocks | Status in our code |
|---|---|---|
| `greeks="1"` → per-leg **`delta, gamma, theta, vega, iv`** | real IV (not BS-back-solved), IV skew/term structure, GEX from true gamma, theta-decay ranking | ❌ **not used** — `fyers_data.compute_gex()` back-solves IV via BS because it assumed greeks weren't available (`fyers_data.py:518`) |
| `timestamp=<epoch>` → **any expiry** | rollover %, PCR term structure, front-vs-back skew, calendar spreads | ❌ not used (only nearest expiry today) |
| `strikecount` up to **50** | ±50 strikes = full wall picture incl. far OTM | ⚠️ using **25** |
| `prev_oi`, `oichp`, `ltpch`, `ltpchp`, `bid`, `ask`, `fp` | liquidity/spread, true day-over-day OI change, fair-price divergence | ⚠️ partially (bid/ask unused) |
| `indiavixData` (top-level, every chain call) | India VIX regime, VIX vs HV20, VIX percentile | ❌ not used |
| `expiry_flag` (W/M) | weekly vs monthly classification | ❌ not used |
| `/data/quotes` — **50 symbols/request** | breadth (%chg) for all 210 names in **5 requests** instead of 210 chains | ❌ not used (we fetch a chain per name) |
| `/data/history` with **`oi_flag=1`** | **historical OHLC + OI candles from Fyers itself** → backfill intraday OI history for any past day, no dependency on our own uptime | ❌ not used |
| `/data/depth` (`ohlcv_flag`) | true 5-level market depth for liquidity checks | ❌ not used |
| WebSocket (`fyToken` per leg, `_feed_oi`) | **real-time OI/volume ticks** instead of 2-min polling | ⚠️ exists in `api/orderflow_adapters/fyers.py` but not wired to the India board |
| `/data/marketStatus` | session/holiday truth | ❌ not used |

---

## 3. Rate limits & the staleness plan

### 3.1 Authoritative limits (Fyers v3, per API key, **global across every REST endpoint**)
| Window | Limit | Our guard target |
|---|---|---|
| per second | 10 | **8/s** |
| per minute | 200 | **180/min** |
| per day | 100,000 | budget-checked |
| order ops | 10/s | n/a (read-only tool) |

**Blocking risk (critical):** breaching the per-minute cap **more than 3 times in a day gets the
key blocked for the rest of the day**. Also note the known Fyers quirk of returning a 429 body
concatenated with a 200 body — response parsing must tolerate it.
429 handling: honour `Retry-After` (s) and `X-Retry-After-Ms` (ms), else exponential backoff + jitter.

Observed today: `1,362 × 401` (expired token, fixed) and `1,206 × 429` all-time — i.e. **we have
already been burning the block budget.** Fix before adding load: one process-wide token bucket,
used by every call path (scan, tracker, chains, quotes, history).

### 3.2 Current vs target freshness
| Feed | Now | Target | How |
|---|---|---|---|
| Market scan (210 names) | 5 min, ~105 s per sweep (210 chains) | **1–2 min, same request budget** | batch `quotes` for spot/chg (5 req), chain only where needed; or `strikecount=50` + `greeks=1` on a rotating subset per cycle |
| Intraday OI per symbol | 2 min poll, in-memory→disk | **10–60 s for watchlist tiers, 2–5 min for the rest** | tiered TTL: ATM ±10 strikes for hot names; WebSocket ticks for a small watchlist |
| Universe payload | served from cache (age ≤ TTL) | **≤ interval + scan time, never a lazy gap** | done (scheduler) |
| Home snapshot | 5 min TTL | **1–2 min** | cheaper fetches (quotes-first) |
| Historical OI backfill | none | **on demand** | `/data/history?oi_flag=1` |
| Real-time (watchlist) | none | **streaming** | Fyers WS with `fyToken` from the chain |

Budget maths at target: scan 210 chains every 2 min = 210 × ~288 sessions-min ≈ 60k req/day
**plus** tracker. Too hot. So the tiering is not optional: keep the full sweep at ~5 min, add a
**hot-list** (top ~20 by burst/wall score + indices) at 30–60 s, and stream the user's open
positions. Budget stays < 40k/day with 8/s pacing.

---

## 4. Feature designs (F1–F12)

Each: **data → formula → output → how we verify**. EV/entry-exit is §5.

| # | Feature | Data | Formula / logic |
|---|---|---|---|
| **F1** | Positioning classifier | chain Δvol, ΔOI, price | `writing` = ΔOI↑ & Δvol↑ & |Δprice| small; `churn` = Δvol↑ & ΔOI≈0; `unwind` = ΔOI↓ & Δvol↑; `covering` = ΔOI↓ & price↑. Confidence = ΔOI / Δvol |
| **F2** | Spread-aware liquidity score | `bid`,`ask`, volume | `spread_bp = (ask-bid)/mid × 1e4`; filter/sort walls & bursts by spread + volume; flag "untradeable wall" |
| **F3** | Wall migration | 2-min OI snapshots | track argmax OI per side; emit event when wall strike changes or |ΔOI| > k× its 20-snapshot σ; direction = CE wall ↑ = resistance migrates up |
| **F4** | Absorption / divergence | OI + spot over time | at a strike: ΔOI large, spot move small → absorption (writers winning); ΔOI large **and** spot through strike → acceptance. Score = ΔOI_norm / |Δspot_norm| |
| **F5** | IV skew & term structure | `greeks=1` (iv per leg) + `timestamp` | 25Δ risk-reversal, butterfly, front-vs-next IV diff; IV rank / IVP from `/data/history`-derived IV series |
| **F6** | GEX with **true** gamma | `greeks=1` | `call_gex = -CE_OI × gamma × spot²×0.01`, dealer convention; gamma flip, call/put walls, magnet. Replaces BS-back-solve |
| **F7** | VRP / premium richness | India VIX (`indiavixData`) + realized vol | `VRP = IV − HV20`; verdict bands (extends existing `api/premium_tracker.py` `_verdict`) |
| **F8** | Basis + rollover tracker | `futures_chain` (existing `annualized_basis`) + multi-expiry chain | persist basis intraday/daily; rollover% = next-expiry OI / (near+next) by strike |
| **F9** | Breadth + sector rotation | batch `quotes` (50/req) + sector map | adv/dec, % above prev close, sector Δvol/ΔOI aggregation → "who is being written up" |
| **F10** | Participant positioning proxy | our own derivatives data | FII/DII official data is not on Fyers; proxy = index-future basis direction + index option write/cover mix. Label clearly as *proxy* |
| **F11** | Arbitrary screens | all persisted | multi-factor filter+sort over our archive (IVP, spread, ΔOI/Δvol, wall distance, basis, breadth) — this is a *query layer*, not a preset list |
| **F12** | Signal log + eval harness | everything above | every emitted signal → JSONL (signal, ts, features, forward 15/30/60-min & EOD return); weekly hit-rate/EV report |

---

## 5. Playbooks — EV hypotheses with concrete entries/exits

**All of these are hypotheses with explicit kill criteria. EV must come from F12, not from belief.**
Sizing/rules are expressed in *signal* terms so they can be backtested on our archive.

| # | Playbook | Trigger (entry) | Exit / risk | Hold | EV hypothesis (to measure) |
|---|---|---|---|---|---|
| **P1** | OI-burst continuation | F1=`writing` on the side of the break **and** spot closes 5-min beyond the pre-existing wall (F3) **and** spread_bp < 20 (F2) | stop = wall strike ± 0.35×ATR(5m); T1 = next wall, T2 = 1.5×risk; time-stop 60 min | 30–120 min | Fresh positional writing + acceptance ⇒ continuation > 1.0 R expectancy; fails if spread filter removed (falsifiable) |
| **P2** | Absorption fade | F4 absorption ≥ 2σ at a strike within 0.5% of spot | sell/define-risk against the absorbed strike; stop on 5-min close beyond it | intraday | Writers absorbing ⇒ that level holds until it doesn't; measure P(hold) vs baseline coin-flip |
| **P3** | Wall migration breakout | F3 event + volume confirmation (F2) | as P1 | intraday | Migration precedes acceptance; measure forward 30-min drift after the event |
| **P4** | Expiry pin | expiry day, last 90 min, spot within 0.3% of max pain, gamma_flip above spot | fade toward max pain, hard stop 0.4% away, flat at 15:20 | 90 min | Pinning is the most repeatable expiry effect; measure pin-rate by distance bucket |
| **P5** | Rollover positional | F8: rollover% in top decile while basis rising and next-expiry walls build | enter next-expiry directional/defined-risk; stop on basis reversal | 1–5 days | Strong rollover + rising basis ⇒ trend continuation into next series |
| **P6** | VRP premium sale | F7 `EXPENSIVE` (IV−HV20 high) + F5 skew rich + no event in 3 days | defined-risk spread, exit at 50% credit or 2× debit; no naked | 2–10 days | Systematically positive when IVP high; must net costs (STT/charges via `backtest/costs.py`) |
| **P7** | Sector rotation swing | F9 sector Δvol/ΔOI top decile + breadth confirming | enter leaders, stop 1×ATR(day), trail; exit on breadth flip | 3–15 days | Rotation clusters; measure sector-level forward returns |

**Measurement contract (F12):** each playbook emits `signal_id, ts, playbook, features, entry_ref,
stop_ref, target_ref`; the evaluator computes realized R multiple + hit rate + Expectancy and a
per-feature ablation (e.g. P1 with/without the spread filter) — so we learn *which* features carry
the edge instead of assuming.

---

## 6. Implementation waves

| Wave | Deliverable | Owner | Depends on |
|---|---|---|---|
| **W1a** | `fyers_pacer.py` (token bucket 8/s, 180/min, 429 + `Retry-After`, block guard), `fyers_data.get_chain(..., expiry_epoch, greeks, strikecount=50)`, batch `quotes(50)`, `history(oi_flag)` wrapper, disk cache per (symbol, expiry) | agent | — |
| **W1b** | `greeks_data.py`: IV skew/term-structure, true-gamma GEX (replaces BS back-solve), IV rank/IVP | agent | W1a interface |
| **W1c** | `rollover_data.py`: multi-expiry rollover%, PCR term structure, basis persistence | agent | W1a interface |
| **W1d** | `signal_log.py` + `eval_harness.py`: JSONL signal archive + forward-return evaluator + OI backfill via Fyers `history` | agent | — |
| **W2** | Wire endpoints in `dashboard_server.py`, panels (IV/GEX, rollover, F1/F2/F4 tags on existing cards), hot-list tiering, Hindi-honest labels | main agent | W1 |
| **W3** | P1–P7 evaluators run on archive → prune to the playbooks with real expectancy | main agent + user | W2 |
| **W4** | Optional: Fyers WebSocket streaming for watchlist + open positions | — | W2 |

---

## 7. Risks / open questions
- **Block risk**: mis-paced code can block the key for a day. Pacer is a *precondition* for W1, not a nice-to-have.
- **Token expiry** (~06:00 IST daily): server must re-resolve the token per request/cache-miss (already fixed for the board; the pacer must not cache a dead client).
- **Greeks are broker-model, not exchange**: document the source; don't present as gospel.
- **Weekly expiry day changes** (NSE moved expiry days before): never hardcode expiry weekdays; use `expiry_flag` + `expiryData`.
- **FII/DII is not on Fyers** → F10 is a proxy and must be labelled so.
- **SEBI/position-limit reality**: walls beyond OI limits are not tradeable size; the spread filter only partly covers this.
- **Not advice**: the doc and UI must not present playbooks as recommendations; they are measurement targets.
