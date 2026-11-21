# Index Report — measured performance audit

Scope: `src/pages/report/**` — measured **209 entries / 228 `.ts`+`.tsx` files / 37,919 lines of `.tsx`**
(the brief estimated ~121 files; the directory has grown). Read-only audit; no source changed.

Every number below was produced on this machine with `npx vitest run <temp file>` (node env, single
warm-up call then N iterations, `performance.now()`), on synthetic payloads sized to a real NIFTY
session (375 tape rows, 90–120 strikes, 375 1-min candles, 17-strike chain tuple per tape row).
**This is not a browser profile** — no devtools, no paint/layout timing. Use these numbers to rank
work, not as absolutes. Benchmarks reproduced in "How the numbers were made" at the end.

## What one poll actually replaces

Measured from source (`niftyReportStore.ts`, `api/reports_api/nifty_ws.py`):

| Feed | Cadence | What it replaces |
|---|---|---|
| `WS /ws/nifty/report` → `type:"report"` | backend recompute, ≤ 1/s (`REPORT_INTERVAL_SEC=1`, `_LIVE_WS_TTL=1`, upstream `_LIVE_TTL=5`); sent only when `fetched_at` changes | **the whole `report` object** (`niftyReportStore.ts:1897`) |
| `WS … → type:"aux"` | ≤ 10 s (`AUX_RESEND_SEC`), resent even when unchanged | **the whole `tape` object, all 375 rows re-normalized** (`niftyStreamSolid.ts:225`) |
| chain-10s poll | 10 s (`CHAIN10S_POLL_MS`) | `oiPoints` (limit 90 live / 2000 EOD) |
| breadth | 60 s (`BREADTH_POLL_MS`) | `breadth` |
| blasts | 3 s (`useNiftyBlasts.ts:21`) | one alert object |
| **generic 15 s poll** | 15 s (`GENERIC_POLL_MS`, `niftyReportStore.ts:1804/1806`) | SENSEX/RELIANCE only — NIFTY does **not** use this path |
| wall history effect | every `report()` identity | `wallHistory` (capped 60) |
| replay playhead | 700 ms (`REPLAY_PLAY_MS`) + each scrub | whole `report` via `applyReplayFrame` (`niftyReportStore.ts:1951-1984`) |

So "the 15 s poll" is not the NIFTY hot path. The NIFTY hot path is a **whole-object replace every
1–5 s** plus **a whole-tape re-normalize every ≤10 s**, and both invalidate the entire derived graph
because the signals hold fresh object identities.

---

## Ranked hotspots

Frequency codes: **R** = each report frame (≤1/s live), **T** = each tape frame (≤10 s), **S** = replay
scrub/playhead (up to 1.4/s while playing), **M** = mouse move, **1Hz** = wall clock.
Costs marked *(m)* are measured; *(i)* inferred from code structure.

| # | `file:line` | hotspot | why it costs | freq | fix |
|---|---|---|---|---|---|
| 1 | `NiftyOiHeatmap.tsx:215` → `niftyOiHeatmap.ts:172-174, 283` | `model = buildOiHeatmap(rows, …)` | **3.63 ms** *(m)* at the production width (3,750 cells, 375 buckets, widthPts=250); **6.06 ms / 6,375 cells** at widthPts=500. Re-runs whenever the `rows` array *identity* changes — and `tapeRows()` (`niftyReportStore.ts:645-650`) hands a **new array** on every tape frame and, in EOD mode, on **every replay playhead change** even when the content is identical. | T, S | S/M |
| 2 | `niftyStreamSolid.ts:225` (`normalizeAuxTape`, 165-178) | re-normalizing the **entire tape** on each `aux` frame | **7.32 ms** *(m)* for 375 rows × 17-strike chain (3.93 ms of it is `normalizeChain`). The backend resends aux even when unchanged (`AUX_RESEND_SEC=10`), so this cost is paid for identical data. Output is a brand-new row array → invalidates every tape-derived memo below. | T | M |
| 3 | `TanStackTable.tsx:135-136, 394-410` (HEAD; another agent is rewriting this file in the worktree — the row loop moved to `:454` there) + `niftyReportStore.ts:590-597` | `<For>` over freshly-mapped rows | `visibleStrikes()` is a `.filter()` → new array, same row objects. Probe: 30 rows × 7 cols, new array **same row refs** → **182/210 cells reconstructed** (210→392) *(m)*. New row objects → all 210 again. Same array ref → 0. This is the market-filter-rail remount class, still present on the OI chain. | R | M |
| 4 | `reportCells.tsx:536-733` (`getNiftyOiColumns`), called at `ReportWorkspace.tsx:130` and `ReportOverlays.tsx:29` | column model rebuilt with **inline JSX headers** (`:542` `header: <span …>`) | New columns array identity → probe measured headers 7→14 and cells 210→420 *(m)*: **100 % of the table is torn down and re-created**. Depends on `report().spot`, `atmStrike()`, `oiScale()`, `oiWalls()` — i.e. it fires on every report frame. | R | M |
| 5 | `WallsMap.tsx:164-182` ↔ `:412`, `:430` | `maxAbsChange()` called **inside `cellFill()`**, once per cell | 4.90 ms *(m)* per full pass at the real payload (14 strikes × 60 min, 1,680 `cellFill` calls); **28.3 ms** at 40×60 *(m)*. Each call rescans all 840 cells. `cellTitle()` (`:183`) walks the same grid again. Runs on drawer open, on every walls payload (4 s throttle) and on **every hover**, because `activeTime()`/`hoverIndex` are read inside the cells. | T, M | S |
| 6 | `WallsMap.tsx:234-263` (`path`, `stepPath`) used at `:456-459, 500-512` | 12 non-memoized path builders in JSX | Each rebuilds a coordinate string over `times()` and reads `cellW()`/`strikes()` reactively inside the JSX expression → all 12 re-run on hover *(i)*. Same class as #5, cheaper per call. | T, M | S |
| 7 | `NiftyChartPanel.tsx:319-337` (`spotCandles`→`tapeCandles`→`chartCandles`) | 5 chained array passes per frame | Individually *(m)*: `candlesFromSpotPoints` 0.28 ms (90) / 0.78 (375) / 2.04 (2000 EOD); `candlesFromTape` 0.32; `mergeCandleSeries` 0.76; `pickFreshestCandles` 0.46–1.90; `clipToAsOf` 0.17–0.55; `fillCandleGaps` 0.88–2.21; `resampleCandles` 0.32–0.84. **≈2.9–7.5 ms per frame.** Fires on `report()` identity even when `intraday` did not change, because `pickFreshestCandles(report(), …)` takes the whole report as its argument (`:325`). | R, T | M |
| 8 | `ReportDecisionStrip.tsx:233-262` → `deskPlan.ts:376` | `planSummary` calls `buildDeskPlan(current)` | **3.44 ms** *(m)* for an 80-strike report, on every report frame. `planOneLiner()` reads it 3× per render (`:286, :530, :561`), so a strip repaint can pay it repeatedly *(i)*. | R | S |
| 9 | `niftyReportStore.ts:1013-1024` and `:1893-1916` | 9 signal writes **outside `batch()`** | Probe: 3 unbatched writes → **3 downstream effect runs**; `batch()` → **1** *(m)*. `setReport`, `setTape`, `setBursts`, `setReplay`, `setReplayIndex`, `setReplayPlaying`, `setSensex`, `setSensexError`, `setSensexLoading` are written serially, so the derived graph runs up to 9× per refresh. `batch()` is already used elsewhere in the file (1678/1704/1726/1783) — the hot path just isn't wrapped. | R | S |
| 10 | `NiftyDataFreshness.tsx:36` + `:50-59` | 1 Hz clock + memo walking **every** tape row and burst | **0.35 ms** *(m)* for 375 rows of `parseIstTimestampMs`, re-run at 1 Hz regardless of data change. The tape is monotone, so only the last row's timestamp matters. | 1Hz | S |
| 11 | `niftyReportStore.ts:737-764` (`sessionContext`) → `:766-798` (`effectiveBursts`) | copy+sort the whole tape, then map the whole burst list allocating a new object per burst | 0.039 ms copy+sort and 0.010 ms map *(m)* — cheap in isolation, but `effectiveBursts` feeds `useNiftyOiAlerts` (burst diffing), `burstMap`, and `NiftyDataFreshness`, so it re-arms three consumers per tape frame *(i)*. | T | S |
| 12 | `niftyReportStore.ts:1435` (`flowSeries`) + `ReportOverlays.tsx:53` | the same series is built twice | `buildFlowSeries` measured 0.167–0.289 ms *(m)*. The store memo has **no consumer** outside the store (grep: `flowSeries` appears only at 234/683/1435); `ReportOverlays` builds its own identical copy at `:53`. A Solid probe confirmed an **unread `createMemo` still re-runs on every source change** (runs on create + 1 per write) *(m)*, so the store copy is pure waste, not lazy. | T | S |
| 13 | `niftyReportStore.ts:809` (`burstById`), `:815` (`currentFlip`) | derived values with **no consumer** | grep across `src/**` finds no read of `burstById` or `currentFlip` outside the store. Same unread-memo behaviour as #12 *(m)* — they recompute on every burst/report frame for nothing. | T, R | S |
| 14 | `NiftyOiHeatmap.tsx:281` (`rowOf`) used at `:644` | `strikes().indexOf(strike)` inside a `<For>` | O(n²) over the strike axis (10–31 strikes → 100–960 comparisons per paint). Small n, so cheap today *(i)*; it is the O(n²)-in-render pattern `UI_RULES.md:80` names. | R | S |
| 15 | `NiftyOiHeatmap.tsx:586, 603, 620` | three `<For each={buckets()}>` passes over 375 buckets | Three independent reconciliation passes over the same array each frame, plus the canvas paint at `:343`. Cells are canvas (good), but the SVG overlay still re-walks 375 buckets 3× *(i)*. | T | S |
| 16 | `NiftyTapeTable.tsx:215` and `:231` | the tape is sorted **twice** per render | `ordered` and `tapeSpot` both call `ascTapeByTime(props.rows)` (filter+sort of 375 rows) *(i)*. The file already demonstrates the right pattern one line below: `changedKey`/`stableChanged` (`:224`, `:227`) key a memo on a **content signature** so a fresh-but-equal Map does not rebuild the 12-column model. | T | S |
| 17 | `NiftyChartPanel.tsx:298` | `linesReport = { ...report(), walls: maxWalls() }` | Allocates a full shallow clone of the report in a memo body on every frame (and `markLines` at `:299` depends on it). Not a deep clone, but it is a whole-object copy in the render path — the pattern `UI_RULES.md` forbids. | R | S |
| 18 | `ReportDecisionStrip.tsx:223-225` | `pcrSeries` / `maxPainSeries` `.map()` a fresh array per frame, feeding a 12 px `Sparkline` | **0.26 ms** *(m)* for the 375-element sparkline derivation `Sparkline.tsx:20-34` runs (two `.map`s plus `Math.min(...c)`/`Math.max(...c)` spreads), **1.11 ms** at 2000 values, all to draw a 44×12 svg from ~44 visible points. Two such sparklines per frame. | R, T | S |
| 19 | `Nifty10sStrip.tsx:71-77` | `ribbon` is built inline in the render body, not in a memo | 45 × `rollingRead` per render, each calling `indexAgo`, which loops `Date.parse` backwards over the point list. Measured **0.18 ms** at 375 points, **0.64 ms** at 90, **0.10 ms** at 2000 *(m)* — i.e. it is paid again for **every** re-render of the strip (including an unrelated parent tick), not once per `oiPoints` change. | R | S |

### Ranked summary (measured, per event)

| Event | Cost with no fix | Where |
|---|---|---|
| one tape frame | **≈3.6 ms heatmap + 7.3 ms tape normalize + 0.35 ms freshness ≈ 11–12 ms** | #1, #2, #10 |
| one report frame | **≈3.4 ms desk plan + ≈3–8 ms candle rebuild + 0.3 ms sparklines + full table remount** | #8, #7, #18, #3/#4 |
| one replay playhead step | heatmap rebuild + candle rebuild + full table remount | #1, #7, #3 |
| one walls-drawer render | **4.9 ms** `maxAbsChange` churn (+ same on each hover) | #5 |
| sum of one poll's pure derived work (no DOM) | **19.44 ms** *(m)* over 16 helpers, excluding the 3.4 ms desk plan, the 7.3 ms normalize and the sparklines | — |

---

## Do these first (3)

1. **Content-key the heatmap model — `src/pages/report/NiftyOiHeatmap.tsx:215` (with `niftyReportStore.ts:645`).**
   3.6 ms × every tape frame and every replay step, for a payload whose content usually changed by one
   row. Key the memo on `${rows.length}|${rows[last].t}|${metric}|${bucketMin}|${widthPts}` (the repo
   already does exactly this at `NiftyTapeTable.tsx:224`), and return the previous model when the
   signature is unchanged. No API change, one file.

2. **Hoist `maxAbsChange()` out of the cell loop — `src/pages/report/WallsMap.tsx:164` (and memoize
   `path`/`stepPath` at `:234`/`:245`).**
   It is called 1,680 times per render (4.9 ms measured) to compute a value that depends only on
   `map` + `horizon` + `measure`. One `createMemo`, same file, removes both the per-render scan and the
   per-hover rescan.

3. **Batch the store's refresh writes and stop re-normalizing the whole tape —
   `src/pages/report/niftyReportStore.ts:1013` / `:1893` and `src/pages/report/niftyStreamSolid.ts:225`.**
   Measured 3 unbatched writes → 3 downstream runs vs 1 batched. Wrapping the 9-signal refresh in
   `batch()` is a 6-line change and removes up to 8 redundant passes of the derived graph per refresh.
   Separately, `normalizeAuxTape` rebuilds all 375 rows (7.3 ms) for an aux frame that usually appends
   one; appending + reusing the prior row objects fixes the tape-identity churn that findings #1/#3/#11
   all feed on.

---

## Measured vs inferred

**Measured (probe/bench, reproducible, this machine):**
- every millisecond quoted with *(m)*, and every before/after cell count;
- the remount counts (cells 210→392 with same row refs, 210→420 on new columns, headers 7→14);
- 3 unbatched signal writes → 3 effect runs, `batch()` → 1;
- an unread `createMemo` runs once on create and once per source write (probe: 4 runs for 3 writes);
- a closed `PanelModal` **and** a closed `LocalPanelModal` construct **zero** children and recompute
  nothing (probe) — so the 11 modals `ReportOverlays` mounts (`ReportOverlays.tsx:60-308`) cost nothing
  while closed. This killed an initial hypothesis; the overlays are not a hotspot.

**Inferred (code reading, not profiled):**
- actual frame cadence in production (backed by `REPORT_INTERVAL_SEC`/`_LIVE_TTL`/`AUX_RESEND_SEC`
  constants, but not observed);
- that `report()`/`tape()` identity changes on every frame (true by construction: `setReport(pushed)`
  at `:1897`, `setTape(normalizeAuxTape(...))` at `:225`, both unconditional);
- paint/layout cost of the heatmap canvas, the WallsMap SVG and the TradingViewChart overlay;
- the strike count in production (±750 at a 50-pt step ⇒ 31 rows; benches used 30);
- #6, #14, #15, #16 per-unit cost (structure only). #19 is measured (0.18–0.64 ms per render) but its
  *re-render* frequency is inferred.

**Benchmark variance caveat:** the 19.44 ms "one poll" total came from a single run in which
`buildOiHeatmap` measured **10.5 ms**, not the 3.6 ms it measured standalone. That is GC/allocation
pressure from running 16 helpers back-to-back in one process, so treat the total as an upper bound and
the per-helper numbers as the reliable figures.

**Not verified:** whether the 3.4 ms `buildDeskPlan` and the 3.6 ms heatmap land in the same long task
in the browser (no browser available in this audit); the real-world `report()` frame rate during a
live 09:15 open.

---

## How the numbers were made (all temp files deleted)

```bash
# each benchmark was a throwaway spec under src/pages/report/, run then removed
npx vitest run src/pages/report/zz-perf.test.ts      # chart-data helpers, WallsMap maxAbsChange
npx vitest run src/pages/report/zz-perf2.test.ts      # store memos: sort/filter/Date.parse/freshness
npx vitest run src/pages/report/zz-perf3.test.ts      # normalizeReport, emaSeries, buildMarkLines
npx vitest run src/pages/report/zz-perf4.test.ts      # buildDepthOption, buildOiHeatmap (cell counts)
npx vitest run src/pages/report/zz-perf5.test.ts      # flowWindowFromTape, scorePreMove, setupRadar
npx vitest run src/pages/report/zz-perf6.test.ts      # candlesFromSpotPoints 90/375/2000, merge
npx vitest run src/pages/report/zz-perf7.test.ts      # buildWallMigration, buildFlowEvents
npx vitest run src/pages/report/zz-perf8.test.ts      # whole-poll budget = 19.44 ms
npx vitest run src/pages/report/zz-perf9.test.ts      # buildDeskPlan = 3.44 ms, pinRisk, flowNoiseFor
npx vitest run src/pages/report/zz-perf10.test.ts     # normalizeTapeRow x375 = 7.32 ms
npx vitest run src/pages/report/zz-perf11.test.ts     # 10s-strip ribbon = 45 x rollingRead
npx vitest run src/pages/report/zz-perf12.test.ts     # Sparkline point derivation
npx vitest run src/pages/report/zz-probe.test.tsx     # PanelModal eagerness, table remount, batch, memo
```

Raw measured values (ms/call, node, warm):

```
pickFreshestCandles(375)            0.457 – 1.903
clipToAsOf(375)                     0.167 – 0.545
fillCandleGaps(375, tape 375)       0.878 – 2.207
resampleCandles(375, 5m)            0.317 – 0.842
candlesFromSpotPoints 90/375/2000   0.275 / 0.782 / 2.040
mergeCandleSeries(2 x 375)          0.757
buildOiHeatmap 375x13 (w=250)       3.630 – 10.512   cells 3750, strikes 10, buckets 375
                                                 (10.5 was the same helper inside the 16-helper run)
buildOiHeatmap 375x17 (w=500)       6.064            cells 6375, strikes 17
readHeatmap / heatmapReadText       0.285 / 0.175
buildFlowSeries(375)                0.167 – 0.289
buildPressure(375)                  0.860 – 1.412
buildWallMigration(375, 15m)        0.570 – 2.039
buildFlowEvents(375)                0.168 – 0.218
buildVolumeProfile(375)             0.014
flowWindowFromTape(375)             0.049 – 1.116
scorePreMove(375 pts + 375 rows)    0.063 – 0.275
setupRadar(80 strikes + 375 rows)   0.131 – 0.316
buildDeskPlan(80 strikes)           3.436
buildDepthOption(120 strikes, 26c)  0.819
normalizeReport(80 strikes, 375)    0.148   (normalizeIntraday alone 0.116)
normalizeTapeRow x375 (chain 17)    7.318   (normalizeChain x375 3.931)
emaSeries(9)+emaSeries(20)          0.046
buildMarkLines(report)              0.143
maxPainTouches(375)                 0.076
freshness parse over 375 tape rows  0.350
effectiveBursts map copy (120)      0.010
sessionContext sort copy (375)      0.039
WallsMap maxAbsChange once 14x60    0.017
WallsMap full cell pass 14x60       4.899    (1,680 cellFill calls)
WallsMap full cell pass 40x60      28.302
sparkline points (375 values)       0.2577
sparkline points (2000 values)      1.1052
10s ribbon: 45 x rollingRead 90/375/2000   0.643 / 0.181 / 0.101
TOTAL one poll (16 helpers)        19.440
```

Probe output:

```
PanelModal  open=false: constructions=0  recomputes=0 (after 2 ticks)
PanelModal  open=true : constructions=1  recomputes=3 (after 2 ticks)
LocalPanelModal open=false: constructions=0 recomputes=0
TanStackTable new array, same row refs: 210 -> 392 cell constructions
TanStackTable new row objects        : 210 -> 420
TanStackTable new columns identity   : headers 7 -> 14, cells 210 -> 420
Solid unread createMemo              : 1 run on create + 1 per write (3 writes -> 4)
Solid 3 unbatched writes -> effect runs 3 ; batch() -> 1
```

No temporary test file remains (`src/pages/report/zz-*` is empty). The only working-tree changes in
this repo belong to other agents (`components/common/TanStackTable.tsx`, `components/market/*`,
`ui/inputs/RangeSlider*`, plus `src/test/zz-*` probes); none of them were touched by this audit.
