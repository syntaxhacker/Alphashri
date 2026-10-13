# Unified Market Alerts — Plan

**Status:** Phase 0 done (card + domain + Storybook story). Phases 1–4 proposed.
**Story:** `Composites/Notifications/Market Alerts` → `src/components/notifications/MarketAlertCard.stories.tsx`

---

## 1. What exists today (audit — 3 parallel systems + 1 stock-only feed)

| # | System | Entry point | Rendered by | Scope | Health |
|---|---|---|---|---|---|
| 1 | Redux toasts | `dispatch(addNotification(...))` | `components/notifications/NotificationContainer.tsx` (fixed top-right) | success/error/warning/info, **message only** | Live (SettingsPage uses it) |
| 2 | notistack | `src/ui/notifications.ts` (`showNotification/showSuccess/showError`) | `SnackbarProvider` — mounted **only in Storybook** | 4 variants | **Dead in the app** — `App.tsx` never mounts the provider |
| 3 | Legacy subscriber store | `utils/notifications.ts` (`pushNotification`, `ChangeNotification`) | bespoke `state.notifications` | title/detail/kind + row-highlight (`markNewSymbols`) | Live but separate store |
| 4 | Surge feed | `POST/GET /api/notifications/surge` (`api/notifications_api.py`, `PriceSurgeEvent`) | `NotificationsPanel.tsx` modal via bell in `AppLayout.tsx` | **stocks only** (price surge) | Live; badge hardcoded `invisible={false}` |

### Gaps for "OI bursts + sudden spikes + stock things"
- **No OI/volume/breakout producer** — only price surge is recorded.
- **No unified model** — 3 incompatible shapes; no severity ladder.
- **No dedupe / coalescing** — an OI burst would stack N cards.
- **No thresholds config** — nothing user-tunable.
- **No click-through** — alerts don't link to chart / OI report / screener.
- **No read state** — the bell dot is always on.
- **No sound / desktop notification.**

---

## 2. Target architecture

```
producers (backend + frontend)
  ├─ OI burst        ─┐
  ├─ Price spike      │
  ├─ Volume spike     ├─►  MarketAlert  ─►  AlertEngine (dedupe, throttle,
  ├─ Breakout         │     (one shape)       severity escalation, read state)
  └─ System           ─┘                          │
                                                  ├─► Toast region  (MarketAlertStack, max 3)
                                                  └─► Notification centre (list + history)
```

**One shape** — already implemented in `MarketAlertCard.tsx`:

```ts
interface MarketAlert {
  id: string;
  kind: "oi_burst" | "price_spike" | "volume_spike" | "breakout" | "system";
  severity: "info" | "watch" | "alert" | "critical";
  symbol: string;
  title: string;
  detail: string;
  metrics?: { label: string; value: string; tone?: "up" | "down" | "neutral" }[];
  ts: number;
  source?: string;
  href?: string;
}
```

Severity drives stripe + tint; kind drives icon + accent. `density="compact"` = toast, `"comfortable"` = centre.

---

## 3. Phases

### Phase 0 — Design + domain ✅ done
- `MarketAlertCard` + `MarketAlertStack` (overflow coalescing) + types + severity/kind configs.
- Storybook: Playground, OI burst, every kind, every severity, toast stack, notification centre, operator density.
- 13 unit tests.

### Phase 1 — One store, one surface
- Add `marketAlertsSlice` (Redux) keyed by id with `read` + `muted` flags.
- Route **both** toasts through `MarketAlertStack` in `App.tsx`; delete the notistack path and the legacy `utils/notifications.ts` (or reduce it to `markNewSymbols` only).
- Backfill existing `PriceSurgeEvent` rows into `MarketAlert` so the centre shows history before new producers land.

### Phase 2 — Producers (detection rules)
| Kind | Rule | Watch | Alert | Critical | Source |
|---|---|---|---|---|---|
| OI burst | \|ΔOI\| in rolling 3-min window vs 20-min MAD (z-score), per strike + index total | z ≥ 3 | z ≥ 5 | z ≥ 8 | Nifty tape / chain |
| Price spike | \|move %\| over 3–5 min, volume-confirmed | ≥ 1.5% idx / 3% stock | ≥ 3% / 5% | ≥ 5% / 8% | LTP stream |
| Volume spike | relative volume vs 10-day avg | ≥ 3× | ≥ 5× | ≥ 8× | screener scan |
| Breakout | 52W-high / pivot R1 cross with ≥1.5× volume | cross | +1× vol | +2× vol | 52W + SR scanners |
| System | feed gap, auth expiry, job failure | — | gap | hard fail | lifespan/jobs |

#### Phase 2a — Nifty OI bursts ✅ detection on the BACKEND, UI renders

**Why backend:** the client-only detector only ran while `/report/nifty` was
open — close the tab and the burst is missed in real time. The tape is already
recorded server-side every 60s, so deriving bursts there makes them part of the
stored record: recomputable for any recorded day, independent of any browser.

- `api/reports_api/nifty_bursts.py` — detector + signal (server twin of the TS
  module; cross-verified byte-identical against an independent implementation
  on 45/45 bursts for 2026-10-13).
  - `call_doi`/`put_doi` are cumulative-from-open, so a burst is the **first
    difference** between consecutive minutes.
  - baseline = trailing **median** of |Δ| per side, floored at `min_abs` so a
    near-zero median on a quiet tape cannot inflate every later move.
  - score = |Δ| ÷ baseline → watch ≥3, alert ≥5, critical ≥8; floor 2,000
    contracts; 3-minute warmup; call and put scored independently.
- `GET /api/reports/nifty/bursts?date=&window=&min_abs=` — always 200:
  `{date, count, interval_sec, bursts:[…]}`; each burst carries
  `id/side/t/delta/baseline/score/severity/cumDoi/spot/tickVol/signal`. The
  `signal` is filled from the saved snapshot chain when one exists (no network
  call in this endpoint).
- Frontend: `fetchNiftyBursts()` (`src/api/reportNifty.ts`) → `NiftyBurst[]`
  (`src/types/niftyReport.ts`); the panel **prefers the backend list** and
  falls back to the local `detectOiBursts` when the backend reports none, so
  the page never goes blind.
- UI on `/report/nifty` (Live): fixed bottom-right toast stack (4, 45s TTL),
  a persistent `OI bursts (n)` trail panel with Clear, and a coloured spine on
  burst minutes in the tape itself (blue = call, orange = put).
- **Signal** — `deriveOiSignal()`:
  - call OI **build** → ceiling → buy **PE**; call OI **unwind** → covering →
    buy **CE**; put OI **build** → floor → buy **CE**; put OI **unwind** →
    support gone → buy **PE**.
  - strike = nearest listed strike to spot with premium ≥ ₹10 (skips dead
    expiry-day strikes).
  - sizing = ₹5,000 risk budget ÷ (entry − 25% stop) → whole 75-unit lots.
  - labelled `heuristic, not advice`; never places orders.

**Still open:** a background task that pushes bursts (Telegram/SSE) so alerts
fire with the tab closed — the derivation is ready, only delivery is missing.

- Extend the DB model from `PriceSurgeEvent` (stocks-only) to `MarketAlertEvent` (`kind`, `severity`, `symbol`, `metrics_json`, `detected_at`) — additive migration, keep the old table for history.
- Thresholds live in a `alert_rules` table + Settings UI (Phase 4).

### Phase 3 — AlertEngine (anti-spam)
- **Throttle:** one alert per `(symbol, kind)` per 60s window; repeats merge into `count` and bump severity one step.
- **Coalescing:** same `(kind, severity)` family within 5 min collapses to a single card with "+N".
- **Quiet hours / market-gate:** suppress `info`/`watch` outside 09:15–15:30 IST (reuse `trading.utils.is_market_open`).
- **Read state:** centre list persists `read`; bell badge shows unread count (fix the hardcoded `invisible={false}`).

### Phase 4 — Reach + preferences
- **Deep links:** `href` → `/report/nifty` (OI burst), `/chart/:symbol` (spike/breakout), screener.
- **Preferences:** per-kind on/off, per-severity minimum, sound toggle, browser Notification API toggle; persisted per user.
- **Sound / desktop:** opt-in, severity-gated (critical only by default).

---

## 4. Design notes (why it looks like this)
Terminal rules, deliberately anti-slop — no gradients, no glass, no pills, no emoji, no per-kind icon, no coloured text on colour, max one accent + semantic state colours:
- **#000/`BG` ground, 1px hairline grid, zero radius, zero shadow, zero ornament** — density over beauty.
- **Monospace only**, 11px data, tabular numerals, uppercase micro-labels.
- **Greyscale base**; colour is reserved for *state* — severity rail (info=hairline, watch=amber, alert=orange, critical=red) and up/down values. Nothing decorative is coloured.
- **20px fixed row height** in the log; detail lives in the row tooltip, not extra lines.
- **Log is the primary surface**: sticky header (`K · SEV · SYMBOL · HEADLINE · FACTS · IST`), fixed column widths so FACTS/IST never collide, footer status bar with `↑↓ MOVE · ⏎ OPEN · ESC DISMISS`.
- **Keyboard-driven instrument**: ↑/↓/Home/End move, ⏎ opens, Esc dismisses.
- **Toast = one line per alert**, compact (KIND+FACTS dropped) so the headline stays readable at 620px; a burst coalesces to a single `+N more alerts` line.
- Tokens only (`palette.ts`) — no hardcoded hex, passes the theme rules in `AGENTS.md`.

---

## 5. Open questions
1. Storage: keep `PriceSurgeEvent` and add `MarketAlertEvent`, or migrate in place? (Recommend additive.)
2. OI burst granularity: per-strike or index-total only for v1? (Recommend index-total + top-5 strikes.)
3. Do we need per-user alert preferences before Phase 4, or ship global defaults first?

---

## 6. Decisions taken (2026-10-13)

### 6.1 Trend gate on the signal ✅
Measured on the real 2026-10-13 tape (45 bursts, expiry day, one-way up move):
```
ALIGNED  (leg with spot vs EMA20): 23 plans → 20/23 favourable (87%), avg +95.5 pts
COUNTER-TREND                    : 22 plans →  2/22 favourable  (9%), avg −110.1 pts
ungated baseline                 : 22/45 = 49%
```
The signal alone was a coin flip; the *trend* decided every outcome. `session_trend()`
(both in `nifty_bursts.py` and `niftyOiBursts.ts`) now gates every plan:
counter-trend plans are still returned but flagged `aligned: false`, their `basis`
starts with `COUNTER-TREND (session X) — skip:`, and the alert detail is prefixed
`COUNTER-TREND · skip`. Trend is computed **at the burst's own minute**, never at the close.

### 6.2 ATM premiums logged per minute ✅
`record_nifty_tape_tick` now stores `atm_strike`, `atm_ce_ltp`, `atm_pe_ltp`
(strike nearest spot, at least one live leg ≥ ₹1; a dead leg is stored as `null`).
Without this, "which burst made money" can only be answered with index-point
proxies. With it, future bursts are backtestable in real rupees. Older tapes
simply lack the keys and the frontend type marks them optional.

### 6.3 Trail cap 20 → 60 ✅
A Nifty expiry session produced 45 bursts; the panel now shows the whole day.

### 6.4 `/nifty/bursts` requires app auth ✅
It leaks trade signals, so it is gated with `Depends(get_current_user)`
(verified: 401 without a token, 200 with). Sibling market-data endpoints
(`/nifty/tape`, `/nifty/live`) stay open per the "never gate market data" rule.

### 6.5 Upstox News API — REJECTED (measured too slow) ✅
Built, tested, then removed after measuring. On the day in question:
```
burst 14:20 IST  →  Upstox article 16:41 IST  =  141 minutes late
Upstox published NOTHING between 13:54 and 16:41
```
It is article-grade, instrument-keyed (≤30 keys), 7-day, and a post-close
wrap-up arrived with the headline. Useless for intraday catalysts.

### 6.6 News impact scoring via an OpenRouter FREE model ✅
`api/news/news_impact.py` — one **batched** OpenRouter call per poll cycle
(`DEFAULT_MODEL = nvidia/nemotron-3-ultra-550b-a55b:free`, fallbacks
`nemotron-3.5-lightning:free` → `inkling:free` → `openrouter/free`).
Batching is deliberate: the free tier is **20 req/min, 50 req/day** per account.
`llm_analyzer.py`'s per-article default was likewise moved off the likely-dead
`openrouter/owl-alpha` to the same free model. Scoring writes `impact_score`,
`sentiment`, `analysis_json`; the burst endpoint then attaches nearby headlines
via the source-agnostic `attach_news()` (±10 min).

**Not built:** a real wire/RSS feed for macro catalysts. The poller's scrapers are
the intended source; until they run, `news` will be empty on `/bursts`.
