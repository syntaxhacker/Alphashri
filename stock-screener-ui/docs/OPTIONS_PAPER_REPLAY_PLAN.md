# Options Paper Trading + Options Replay — implementation plan

**Status:** shipped 2026-11-22 — phases 1–5 landed (see §10 for delivery status and §11 for settled decisions, verification counts and honest data caveats). The design below is retained as written.
**Goal:** let a user place multi-leg option paper trades **from the existing Options Dock**, and replay a structure (e.g. "IRFC bull call spread as of 5 days ago") with an honest payoff/P&L playback that **stays open as a paper position until expiry**. Both live and replay are paper — no broker orders.

## Recommendation in one paragraph

Do not build a second options engine or a second replay system. The repo already has (a) a complete options domain package (`options_paper/`) with multi-leg payoff, no-lookahead replay, charge schedule and marking rules, (b) a dock with chain → legs → payoff and a playhead-aware payoff component, and (c) three replay systems whose playhead controls and recorded-chain readers can be reused. Build the missing bridge: **a small DB-backed options paper book (new tables + Alembic migration), a dedicated `/api/options-paper` router, a "place paper trade / replay this structure" ticket in the dock, and a replay drawer that precomputes frames from a 3-tier data provider**. A replay trade is committed at replay start with a backdated entry fill, so it is immediately a real open paper position and continues to expiry; the replay itself is a time-travel view over that position.

---

## 1. What exists today (verified, with paths)

### Options Dock — complete decision surface, zero order placement
- Mounted app-wide by `src/components/common/SymbolDockProvider.tsx` (right rail ≥1200px / bottom sheet <1200px), not a route.
- `src/components/options-dock/OptionsDockPanel.tsx` — chain, summary strip, `StrategyControl`, `LegBuilder`, `AnalyticsTabStrip` (PAYOFF/SMILE/TERM/SURFACE/PROB), `DockPillarsView`, `contract/ContractChartPanel`.
- `src/state/optionsDock.ts` — `DockLeg` already carries `side`, `type` (CE/PE), `strike`, `premium`, `lots`, `lotSize`, `expiry`, `instrumentKey`; `MAX_LEGS = 4`; legs persisted to localStorage; `netPremium()`.
- `OptionChainTable.tsx` / `chain.columns.tsx` — `PriceCell` click adds a BUY leg, shift-click adds a SELL leg. **`LegBuilder.tsx:8-12` explicitly says "Nothing here issues a request."**
- Payoff: canonical pure math in `src/utils/optionsMath.ts` (`payoffAt`, `payoffCurve`, `probabilityOfProfit`, `maxPain`, `pcr`), shared canvas `src/components/options-dock/PayoffChartCore.tsx` (`buildPayoff`, `PayoffSnapshot`) already reused by `FnoScreenerTab` and `ProbPanel`.
- Replay-relevant precedent: `src/pages/report/sim/SimDesk.tsx` / `SimBuilder.tsx` / `SimPayoff.tsx` / `simView.ts` — a drawer with leg builder, expiry payoff, playhead-aware P&L slicing and a runs table; `/api/reports/sim/run` wraps `options_paper.structure_engine.run_specs`.
- Tests/mocks: `tests/e2e/options-dock.spec.ts`, `setupOptionDockMocks` in `tests/mocks/apiResponses.ts:2749-2854`.

### Options domain — the engine already exists
- `options_paper/spec.py` — lot sizes, tick sizes, sessions, charge schedule (`Charges`, brokerage ₹30/order, STT 0.15% on sell premium), `option_symbol()`.
- `options_paper/structures.py` — `LegSpec`, `resolve_legs`, `payoff_at_expiry`, `payoff_curve`, `net_entry_cost`, `breakevens`, `max_profit_loss` (gross of costs).
- `options_paper/structure_engine.py` — `ExecSpec`, `run_specs`, honest fills (next-minute bar, no target on fill bar, stop before target), MTM of held strikes with last-known premium, cost per leg, `StrategyResult.as_dict()` payload.
- `options_paper/costs.py::option_round_trip_cost`, `sell_margin_estimate`; `options_paper/greeks.py`; `options_paper/manual.py` — open-position ledger, `_mark` against the **held strike** (never current ATM), expiry settlement; `options_paper/book.py::record_trades` — writes closed trades to the canonical `trades` table with `source='options_paper*'`.
- `OPTIONS_PAPER.md` documents the honesty contract and the "keep the equity runner stable" boundary. The headless runner and its dedicated account (`options-paper@alphashri.local`, user 24) must stay untouched.

### Paper trading — equity-only schema and API
- `db/models/trade.py` `Trade` / `Position` + `db/models/base.py` `PaperTradingMixin`: no `option_type`, `strike`, `expiry`, `lot_size`, `underlying`, `instrument_key`. Options today are encoded in the `symbol` string and `notes`; `Trade.source` prefix distinguishes books.
- `POST /api/paper/order` (`api/paper/requests.py:9-15`) takes `symbol, side, quantity, price, stop_loss, take_profit` — equity units and price, no premium/lots/legs. Its cost formula is the equity one, not the options schedule.
- `GET /api/paper/positions` reads the **in-memory** `PaperTrader`; open options are not there. `GET /api/paper/trades` has no `source` query param (the FE filters books client-side via `optionTradeUtils.ts`).
- `api/paper/live_stream.py` resolves keys by `position.symbol` → `instruments.trading_symbol` only; it cannot mark an option leg (`NSE_FO|<token>` is opaque). The mature option marking path is `options_paper/manual.py::_mark` from the chain.
- `db/models/option_snapshot.py` `OptionChainSnapshot` already stores CE/PE, strike, expiry, LTP, IV, greeks, OI, spot — a replay-ready source, but currently analytics-only.
- Migration head: **`os1a2b3c4d5e`** (`2026_11_16_1400-os1a2b3c4d5e_add_option_chain_snapshots.py`); new migration must use that as `down_revision`, never a filename.

### Replay — three systems, none persists a trade
| System | Playhead | Trade entry | Persists |
|---|---|---|---|
| `/replay` `src/components/replay/ReplayPage.tsx` + `api/replay_api.py` (SSE) | No — progress counter only | automatic strategies | ephemeral (only saved configs in DB) |
| core/tick `core/ReplayShell.tsx`, `useReplayClock.ts`, `ReplayControls.tsx` | Yes — RAF clock, play/pause, speed 1–300×, scrubber | none (precomputed trades revealed) | ephemeral |
| Index Report options replay `NiftyReplayBar.tsx`, `api/reports_api/options_history.py` | Yes — 1-minute frames | none | read-only |

- `runner_core.py:1633-1636` lets swing positions survive a multi-day replay, but `runner_signals.py:775-777` never persists replay positions. There is **no replay → paper bridge** and no option leg model in `trading/replay/contract.py`.
- Reuse the playhead UX from `ReplayControls` + `useReplayClock`; reuse the recorded-frame reader from `api/reports_api/options_history.py` (`/api/reports/options/{underlying}/replay|replay/dates|tape`).

---

## 2. Feasibility of the user's exact example (measured today, 2026-11-22)

**"Bull call spread on IRFC, 5 days back (2026-11-17), replay until now, hold to expiry."**

- `option_chain_snapshots` has **IRFC, session 2026-11-17**: 1,520 rows, 38 strikes (62–100), expiry **2026-11-23**, CE+PE with LTP/IV/greeks/OI, spot 82.11–83.61. Timestamps are **naive IST** (`api/options_snapshots.py:49` uses `datetime.now(_IST)`): one 08:20 row then 09:47–10:13 (20 distinct minutes).
- That is enough for a **real backdated entry fill** (e.g. BUY 82.5 CE / SELL 85 CE on 23-Nov expiry). It is **not** enough to mark 18–21 Nov: IRFC has no later snapshot rows, and `experiments/data/options_chain10s/**` only covers RELIANCE/SENSEX.
- The expiry (23-Nov) is still an **active** contract today, so Upstox V3 historical candles can fill the forward path: `/v3/historical-candle/{NSE_FO|token}/minutes/1/{to}/{from}` covers **1 month** back — two legs × four sessions is well inside the documented **50/s, 500/min, 2000/30min** limits (the repo already self-limits the options consumer to 20/min).
- Expired-contract history (`/v2/expired-instruments/*`) exists and would solve fully-expired replays, but is **Upstox Plus (paid)** — feature-flag it and verify entitlement; never make it a hard dependency.
- **There is no historical option-chain endpoint anywhere.** A chain view for an arbitrary past date must come from local snapshots or be assembled from per-contract candles. The replay engine therefore needs only the *held legs'* marks, not a full historical chain.

**Conclusion:** the example is feasible today with a hybrid provider — DB snapshot for entry + Upstox active-contract history for the tail — and becomes fully local once the dock-driven recorder covers IRFC.

---

## 3. Product model & semantics

Two modes, one book, both paper:

| | LIVE PAPER | REPLAY PAPER |
|---|---|---|
| Entry time | now (chain LTP) | backdated (`entry_ts` chosen by user) |
| Fill source | live chain `instrumentKey` + LTP | snapshot at `entry_ts` (next-minute bar) |
| Playback | none | scrub entry → now (and optionally to expiry) |
| After the replay view ends | n/a | position stays OPEN, marked from live chain, settled at expiry |
| Badge | `PAPER` | `REPLAY` |

**Commit-at-start (recommended).** "Preview" uses `dry_run: true` on the same order endpoint; committing with `dry_run: false` creates the position with the backdated entry immediately. Why: the user explicitly wants the spread to *stay* as a position until expiry — a replay-only simulation that must be re-committed at the end is a second mental model and an easy place to lose the trade. The replay drawer is then a lens over a real position.

**Structure rules:** v1 supports defined-risk multi-leg structures (vertical spreads, straddles/strangles, condors) up to the dock's `MAX_LEGS = 4`; naked short legs require `sell_margin_estimate` gate and an explicit confirmation (or are deferred, see decisions). No automatic SL/TP in v1 — the user's example is a hold-to-expiry swing; stops can be added later via `ExecSpec` reuse.

**Expiry lifecycle:** `OPEN → EXPIRED` (auto, after 15:30 IST on expiry date: settle at final known premium/intrinsic, book a `trades` row with `exit_reason="EXPIRY"`) or `OPEN → CLOSED` (manual exit at current marks).

---

## 4. Data provider design (`options_paper/replay_data.py`, new)

A single interface, three ordered sources, no invented prices:

```
chain_at(underlying, expiry, ts) -> {spot, ladder, premiums[leg], source, gaps}
premium_series(leg, from_ts, to_ts) -> [{ts, premium, priced: bool}]
```

1. **DB snapshots** (`OptionChainSnapshot`): minute CE/PE LTP + IV + greeks + OI + spot, IST-normalised. Best for entry fills and any covered session.
2. **Recorded files** (`experiments/data/options_chain10s/{SYM}/{date}.jsonl`, `options_tape`, `nifty_tape`) via the existing read-only `api/reports_api/options_history.py` helpers — 10-second granularity, includes spot/expiry/LTP/OI. Preferred when present.
3. **Upstox adapter** (new, feature-flagged): resolve `NSE_FO|token` from `/v2/option/contract` (store on each leg at entry), then V3 historical candles for the requested window; expired-contract endpoints only when Upstox Plus is confirmed. Cache per leg to `experiments/data/options_paper_replay/{underlying}/{expiry}/{leg}.jsonl` (gitignored; never under `reports/**`).

**Honesty contract (port from `structure_engine.py`, test it):**
- Fill on the **next** bar after the requested entry minute; never use the signal bar's prices for the fill.
- Mark the **held contract**, never the drifting ATM. A leg without a print carries its last known price with `priced: false`; the UI shows coverage/gaps, never a fabricated premium.
- Weekend/holiday gaps are skipped, not interpolated. `config.IST` everywhere; no naive UTC comparisons.
- Costs once at entry from `options_paper/costs.py`; at close/expiry they are booked separately and shown separately (payoff curves stay gross of costs).

**Forward-looking recorder:** extend the existing options recorder's underlying registry so any symbol opened in the dock (IRFC included) gets a 10-second chain file during derivatives hours. This makes future replays local and removes Upstox dependency. Registry-driven, not per-symbol `if` branches.

---

## 5. Persistence & schema (TDD, Alembic, never hand-edit the DB)

New tables as the source of truth for UI-driven option paper positions (the headless `options_paper` runner keeps its JSONL book):

- `option_paper_positions`: `id`, `uuid`, `user_id`, `source` (`live`|`replay`), `status` (`open`|`closed`|`expired`), `underlying`, `expiry` (date), `name`/template, `entry_ts`, `entry_spot`, `lots`, `net_debit`, `costs_est`, `max_profit`, `max_loss`, `breakevens` (JSON), `realized_pnl`, `close_reason`, `closed_at`, `notes`, `created_at`, `updated_at`.
- `option_paper_legs`: `id`, `position_id` (FK), `action`, `opt_type` (CE/PE), `strike`, `lots`, `qty`, `instrument_key`, `entry_premium`, `mark_premium`, `mark_ts`, `exit_premium`.
- On close/expiry, project a row into the canonical `trades` table (reuse `options_paper/book.py::record_trades`) with `source = "options_paper_ui"` or `"options_paper_replay"` and the NSE-style symbol, so the existing history table and `TradeBookKey` book filter keep working. No second history UI.

**Why new tables instead of extending `Position`/`Trade`:** multi-leg structures, expiry state and replay metadata are first-class here; `Position` has a unique `(bot_id, strategy_id, symbol)` key and is owned by the equity runner. Nullable columns on `Trade` for the projection are optional, but the option book must not share the equity in-memory portfolio.

Migration: new file in `db/migrations/versions/`, `down_revision = 'os1a2b3c4d5e'`, idempotent `upgrade()` (CI builds schema from models), validated with `python scripts/validate_migrations.py`. Never run it against `db/alphashri.db` by hand.

---

## 6. Backend API — new router `api/options_paper/router.py`

Prefix `/api/options-paper`, tag **Options Paper** (add to `OPENAPI_TAGS` in `api_server_fastapi.py`), `summary=` and `response_model=` on every operation, bearer auth on all mutations, registered in the standard try/except include block.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/orders` | Place a structure. Body: `underlying, expiry, source, entry_ts?, legs[], lots, slippage_ticks, name?, notes?, dry_run`. Validates via `structures.parse_leg_spec`, resolves strikes against the chain at entry, refuses unpriced legs, computes debit/costs/max P&L, returns position detail (or preview frames when `dry_run`). |
| `GET` | `/positions` | Open/closed/expired list with live MTM and DTE. |
| `GET` | `/positions/{id}` | Legs, marks, payoff, replay metadata. |
| `POST` | `/positions/{id}/close` | Exit at current marks (optional premium overrides), books trade. |
| `GET` | `/replay/sessions` | Available underlying/date/expiry/coverage for pickers (from DB snapshots + recorded files + cached Upstox series). |
| `GET` | `/replay/{position_id}` | Precomputed frames for a committed replay: `{t, spot, legs[], pnl, net_debit, payoff_at_spot, priced, gaps}`. |
| `GET` | `/chain-at` | Historical chain snapshot at `underlying/date/time` for strike selection in replay mode. |

- Lifespan background task `options_paper_expiry_task()` settles expired positions (CI_MODE off, gated like other tasks); optional recorder extension in the same lifespan.
- Regenerate `openapi.yaml` with `.venv/bin/python scripts/export_openapi.py` and run `tests/contract/test_openapi_sync.py` in the same commit. Never hand-edit the spec.
- Keep `GET /api/options/positions` untouched — it means broker positions, not this paper book.

---

## 7. Replay engine (new, pure + tested)

`options_paper/multi_day_replay.py` (name TBD):
- Input: resolved legs with absolute strikes, `entry_ts`, `to_ts`, `data_provider`, `lots`, costs flag.
- Output: frames + summary (realized/unrealized/total, max drawdown, coverage/gaps), `payoff` (expiry curve, breakevens, max P&L) and `path` (P&L over time).
- Per frame: `gross = Σ sign(action) * (mark_leg - entry_premium) * qty`; `net = gross - entry_costs`; expiry payoff is computed once from `structures.payoff_curve` on the spot axis; **"value if expiry now"** (intrinsic at current spot) is a separate, explicitly labelled series — do not conflate it with mark-to-market P&L.
- Frames are precomputed and bounded (≤ ~5 sessions × 375 minutes ≈ 1.9k points), so the UI scrubs locally; no SSE needed. Live tail after the replay ends polls `/positions/{id}` every 15–30s (same cadence as the NIFTY generic-underlying report).
- Reuse `options_paper/structure_engine.py` for the single-session case instead of reimplementing its exit logic; the multi-day path is a deliberate extension with **no EOD exit** (swing hold to expiry).

---

## 8. Frontend / UX

### Dock (live placement)
- New `DockSection` band between `LegBuilder` and analytics: **"PAPER ORDER"** with order type (market at LTP / limit premium), global lots, slippage ticks, estimated net debit, margin warning for short legs, and two buttons:
  - `PLACE PAPER TRADE` → `POST /options-paper/orders` (`source: "live"`).
  - `REPLAY THIS STRUCTURE` → opens the replay drawer with legs prefilled and a date/time picker (default = 5 sessions back).
- Preselected legs come from existing `PriceCell`/`StrategyControl` interactions — no new strike-selection UI needed. Reuse `solid-notifications` toasts (do not restyle `.sn-*`).
- A compact `POSITIONS` strip in the dock header (open count, net P&L, nearest DTE) opens the positions drawer.

### Replay drawer + dedicated `/options/replay` page (decided)
- **Both surfaces are in scope.** Host in a `LocalPanelModal` drawer (same pattern as `SimDesk`) so the chain stays visible, and add a `/options/replay/:id` route that reuses the same panel as a full page for deep links and wider multi-day charts. Share one component; the page is a layout variant, not a second implementation.
- Top strip (`SimContextStrip` style): mode/date, expiry + DTE, spot, net debit, coverage, tape lag, desk total.
- Controls: `TradingDatePicker` for entry date, minute `Select`/time input, `ReplayControls` (play/pause, speed, scrubber) with a `PLAYHEAD` badge; `asOf` slicing via `simView.ts` pattern (`strategyViewAt`).
- Charts/stats: `PayoffChartCore`/`SimPayoff` for the expiry payoff + mark line + breakevens; an ECharts **P&L path** series from frames (`EChart` wrapper, palette tokens only); `CompactStatGrid` for debit/max profit/max loss/breakevens/realized/unrealized/total.
- Tables: `TanStackTable` with explicit `meta.align` for legs and positions (text left, numbers right, badges centre); `Badge` for `PAPER`/`REPLAY`/`OPEN`/`EXPIRED`; `states.tsx` for empty/loading/error; `BrokerAuthNotice` when Upstox history is unavailable.
- Mandatory UI rules: `@/ui` only, no `styles={{...}}`, `ToolbarRow` for control rows, one border per section, no chart inside `ScrollArea`, palette single source, `contrast.ts` for any filled cell, 1600 + 390 screenshots of **every** state (default, replay mid-scrub, expired, empty history, Upstox 401/Plus error). Read each PNG back before claiming done.

### Existing paper page
- Add an `Options` book tab in `src/components/paper-trading/PaperTradingView.tsx` using the new positions endpoint and `OptionPayoffCard`; keep the source-prefix book filter working.

---

## 9. Testing (TDD, 80%+ on new pure code)

Write the failing test first for each item. Narrow local runs only — no full suite.

| Layer | Tests |
|---|---|
| Provider | snapshot vs 10s-file vs Upstox adapter selection; IST normalisation; missing print carries last price + `priced: false`; no lookahead; gaps flagged |
| Domain | leg parsing/resolution, payoff vs `options_paper/structures.py`, costs from `options_paper/costs.py`, next-bar fill, stop/target ordering (where applicable), expiry intrinsic settlement, weekend skip |
| API (in-memory SQLite `db` fixture, `CI_MODE=1`) | order validation (bad strike, unpriced leg, mixed expiry), `dry_run` determinism, positions MTM, close, expiry task, source book filtering, openapi drift |
| Frontend | dock leg→order payload mapping, order ticket validation, replay frame slicing, payoff summary (bounded/unbounded tails), positions table |
| E2E (mocked, extend `setupOptionDockMocks`) | place live paper trade from dock; create IRFC 5-day replay; scrub and assert P&L changes; refresh and assert position still OPEN; expiry state |

Commands (narrow):
```
source .venv/bin/activate && CI_MODE=1 python -m pytest tests/api/test_options_paper_api.py -q
source .venv/bin/activate && python -m pytest tests/test_options_paper.py tests/test_options_paper_sim.py -q
npx vitest run src/components/options-dock/ src/pages/options-replay/ src/state/optionsPaper.test.ts
npx vitest run src/test/ui-guard.test.ts src/test/design-scale.test.ts src/test/theme-single-source.test.ts src/ui/inputs/inputs.w-h.test.tsx
bun run contrast && bun run lint && bun run build
npx tsc --noEmit 2>&1 | grep -c "error TS"     # baseline 320; must not rise
npx playwright test tests/e2e/options-paper.spec.ts --reporter=line --workers=2 --output=/tmp/opencode/pw-opts
```
Check `cat /proc/loadavg` before any fan-out (≥30% idle).

---

## 10. Delivery phases (small commits on a `feat/options-paper-replay` branch from `develop`)

1. **Design + schema** — this doc; Alembic migration; models; `validate_migrations.py`. (No UI.) **LANDED**
2. **Domain + provider** — `replay_data.py`, `multi_day_replay.py`, tests; reuse `options_paper` functions unchanged. **LANDED**
3. **API** — router, expiry task, openapi regeneration, contract test; no UI consumer yet. **LANDED**
4. **Dock placement** — order ticket, positions strip, live MTM, source-filtered history tab. **LANDED**
5. **Replay** — preview/commit, drawer, scrubber, payoff + path charts, position persistence to expiry, recorder coverage for arbitrary underlyings. **LANDED**
6. **Evidence + PR** — screenshots at 1600/390 in `docs/screenshots/options-paper-replay/`, build/lint/guards/E2E, changelog entry, PR to `develop` with test plan. Every UI PR screenshot is mandatory per `AGENTS.md`.

**Delivery status (2026-11-22):** phases 1–5 are **LANDED**. Phase 6 evidence is captured — 16 screenshots (8 states × 1600/390) in `docs/screenshots/options-paper-replay/` and the changelog entry. The PR to `develop` is owned by the main agent.

**Delivery status addendum (2026-11-23) — design revamp:** the worktree now also carries the options paper/replay design revamp described in `docs/OPTIONS_PAPER_DESIGN_AUDIT.md` (semantic border tokens, `Grid`/`Row`/`Col`, full-screen replay with a deep-link header, dock/replay type scale, a `KeyValue` primitive and shared table metrics, plus an E2E mock refresh). The **final E2E run and a fresh 1600/390 screenshot read-back for this revamp are still pending the main agent**; the 16 screenshots above are the earlier ship evidence, not proof of the revamp. Caveats from §11 still stand and were not resolved by the design work: the **Upstox active-history path remains a documented injectable seam, not a wired adapter** (`UpstoxChainProvider` feature-flagged off, no live HTTP from this router), and **local IRFC data covers only the 2026-11-17 session** (one 08:20 row plus 09:47–10:13 IST, 20 distinct minutes) with no later snapshots and no `options_chain10s` coverage for IRFC — so marks after that session depend on the active-contract path and the replay is not fully local. Remaining UI caveats: the legacy options-report screens and the `replayCharts.ts` chart-ink labels are untouched, and the new `KeyValue` primitive has no production call sites yet.

Commit per green checkpoint (≈80–120 lines); `bun run lint && bun run build` at each. No direct push to `develop`/`main`.

---

## 11. Decisions (settled 2026-11-22) & remaining risks

1. **Commit timing — SETTLED:** commit-at-start with `dry_run` preview. A replay order is persisted immediately with its backdated entry; the replay view is a lens over that real position.
2. **Account — SETTLED:** the **current logged-in user's** paper capital and user id; never the headless runner's `options-paper` account (user 24).
3. **Persistence — SETTLED (plan recommendation):** dedicated new tables + projection into `trades` with a source prefix; do not add option columns to the equity `Position`/`Trade` book.
4. **Upstox entitlement — SETTLED:** assume **no Upstox Plus**. Expired-contract history is feature-flagged off; replay supports still-active contracts and locally recorded dates. The IRFC example works because its 23-Nov expiry is still active.
5. **Placement — SETTLED:** dock drawer **and** a dedicated `/options/replay` page sharing one component.
6. **Open for implementation:** defined-risk credit spreads only in v1 (naked shorts need an explicit margin gate/confirmation); record 10s chains for every dock-opened F&O underlying, bounded by the existing rate limiter.

### Delivery decisions & honest caveats (2026-11-22)

7. **Upstox Plus — CONFIRMED ABSENT in the shipped build.** Expired-contract history stays feature-flagged off. The shipped provider chain is `SnapshotChainProvider → FileChainProvider → UpstoxChainProvider`, with the Upstox leg flagged off (no network from this router). The IRFC example works from local snapshots plus active-contract data only.
8. **IRFC lot — SOURCED, not guessed.** `STOCK_LOTS["IRFC"] = 5,425` in `options_paper/spec.py`, taken from the recorded 23-Nov-26 F&O contract in `scripts/market/irfc_90ce_research.py` (the May-2026 broker-master sync has no `NSE_FO` row for IRFC). Guarded by `tests/api/test_options_paper_api.py` asserting `_lot_size(db, "IRFC") == 5425`; `_lot_size()` falls back to the broker master and never invents a value.
9. **Data caveat — IRFC snapshots cover a single session only.** `option_chain_snapshots` has IRFC for **2026-11-17** alone (one 08:20 row then 09:47–10:13 IST, 20 distinct minutes). There are no later local IRFC snapshots and `experiments/data/options_chain10s/**` covers only RELIANCE/SENSEX, so marks after that session depend on the active-contract path — this replay is not fully local.
10. **Data caveat — the Upstox active-history fallback is a documented seam, NOT a wired adapter.** The provider receives injected `resolve_key` / `fetch_candles` callables and `UpstoxChainProvider` is feature-flagged off; no live Upstox HTTP call is made from this router. Treat "Upstox history" as an injectable integration point to be wired and verified separately, not as proven end-to-end coverage.

**Verification:** 204 backend tests; 51+ frontend unit tests; 5 new dock E2E + 16 visual E2E + 20 existing dock E2E pass; `tsc` baseline **320** (not risen); lint, build and UI guards clean. Screenshots for all 8 states at 1600 and 390 are committed under `docs/screenshots/options-paper-replay/`.

## Definition of done
- From the dock I can place a 2-leg IRFC bull call spread as paper, see it in positions with correct premium P&L and costs, and close it.
- I can create the same spread backdated 5 sessions, scrub from entry to now, see payoff/breakevens and a P&L path that never uses future data, and the position survives a refresh and stays OPEN until expiry.
- At expiry it settles automatically into trade history with the correct source prefix and `EXPIRED` reason.
- All guards green, tsc count not risen, screenshots reviewed at 1600/390, changelog and plan docs current.
