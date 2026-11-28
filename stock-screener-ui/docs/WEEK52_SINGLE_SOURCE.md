# 52W single-source architecture

The 52W-high screener has one canonical implementation: the `trading/week52/` package.
Everything else that still exposes 52W names is a compatibility surface, not a place to
add behaviour. This document is the map for where a change belongs.

## Canonical map

| Module | Owns |
|---|---|
| `trading/week52/config.py` | The **only** reader for `SCREENER_52W_*` / `SCREENER_TOUCH_*` / `SCREENER_RETEST_*` env vars, plus shared numeric constants (`STALE_52W_BREAKOUT_PCT`, `PRICE_CAP`, `TV_BATCH_SIZE`, `PROFILES_WITH_52W_BUCKETS`). Bad/negative values fall back to the documented default. |
| `trading/week52/math.py` | Pure 52W math and classifiers: `classify_approach`, `gap_pct_to_52w_high`, `has_live_data`, `is_likely_etf`, `is_within_52w_touch_gap`, `is_plausible_52w_gap`. No env reads, no I/O. |
| `trading/week52/ranges.py` | Range lookups: the bulk `52w_range:all` Redis payload first, then the `stock_52w_range` DB table. `sanitize_entry` / `sanitize_bulk` keep `updated_at` on the returned entry. |
| `trading/week52/job.py` | Batch job status (`start_job`, `update_job_progress`, `finish_job`/`complete_job`, `fail_job`, `get_job_status`, `set_job_status`) and pure staleness (`job_age_sec`, `is_job_stale`). Uses `config.IST` for timestamps. |
| `trading/week52/keys.py` | The single Redis key/TTL namespace: `BULK` (`52w_range:all`), `JOB_STATUS` (`52w_range:job_status`), `JOB_TTL`, `RANGE_TTL`, and `PAPER_52W_CACHE_DIR`. |
| `trading/week52/upsert.py` | The one change-only `stock_52w_range` upsert, `upsert_52w_ranges()`. A row's `updated_at` moves only when high/low/close/days_ago actually changed. |
| `trading/week52/defaults.py` | Canonical `ChaserDefaults` / `TargetDefaults` dataclasses (plus the legacy `CHASER_*` aliases). Frozen strategy contracts: no env reads, no config/DB imports. |

`trading/week52/__init__.py` re-exports the public config/keys/math/ranges/job API; import
from the specific module when patching or testing a single concern.

## Compatibility surfaces (no new logic)

- `trading/week52_range_lookup.py` — pure re-export shim for `trading.week52.ranges`.
- `trading/week52_job_status.py` — pure re-export shim for `trading.week52.job`.
- `api/screener_api/screener_models.py` — re-exports 52W math/config for existing
  `from .screener_models import ...` callers. It does not own a second implementation.

Do not add helpers, constants, env reads or fallbacks to these files. Fix the canonical
module instead; old import paths keep working by re-export.

## Rules / invariants

1. **One upsert.** `scripts/compute_52w_ranges_upstox.py` and
   `scripts/sync_refresh_assets.py` both call `trading.week52.upsert.upsert_52w_ranges()`.
   No second insert/update path for `stock_52w_range`.
2. **One orchestrator.** The admin route `POST /api/admin/52w-range/run`
   (`api/admin_routes.py`) is the only batch orchestrator. The scheduled
   `compute_52w_ranges_task` was **removed** — there is no scheduler duplicate. The
   release-sync watcher imports published assets; it does not compute ranges.
3. **One env reader.** No `SCREENER_52W_*` / `SCREENER_TOUCH_*` / `SCREENER_RETEST_*`
   `os.environ` read outside `trading/week52/config.py`.
4. **One cache key/TTL.** Range reads/writes use the single bulk key `52w_range:all`
   from `trading/week52/keys.py`. Do not introduce a per-symbol range cache or a
   second TTL namespace. `updated_at` rides on the entry, not on a parallel key.
5. **One defaults table.** Live signal generators, backtest strategies and the UI
   read `trading/week52/defaults.py`; the parity test gates any drift.
6. Compatibility shims stay import-compatible only — they are not extension points.

## Test map

| Test | Covers |
|---|---|
| `tests/test_week52_module.py` | `config` env readers/defaults, `keys`, pure `math` classifiers. |
| `tests/test_week52_ranges_job.py` | Bulk-key reads + sanitization (incl. `updated_at`), Redis→DB fallback, job status lifecycle and staleness. |
| `tests/test_week52_cache.py` | `cache/week52.py` as a thin consumer of canonical config/keys/ranges; TTL resolution. |
| `tests/test_sync_refresh_assets.py` | Release-asset sync shares the exact `upsert_52w_ranges` callable. |
| `tests/test_52w_persist_changes.py` | Change-only writes and bounded chunk commits through the shared upsert. |
| `tests/test_week52_defaults_parity.py` | Canonical defaults vs live generators, backtest strategies and TypeScript UI defaults/replay params. |
| Patch-target migration: `tests/api/test_screeners.py`, `tests/api/test_db_cache_perf.py`, `tests/api/test_admin.py`, `tests/test_week52_batch.py`, `tests/test_week52_job_stale.py` | Mocks target the module that owns the symbol (`trading.week52.ranges` / `.job` / `.config` / `.keys` / `.upsert`) rather than duplicating logic in a flat module or shim. |

## Follow-up (2026-11-27)

The follow-up wave does not add a second source of 52W truth. The P2 cleanup stays in the
existing surfaces as review nits; the 52W backtest strategies share behaviour-neutral
bootstrap/trade-stat boilerplate in `backtest/strategies/base_52w.py` while their entry/exit
math stays in the strategy modules; and the duplicated UI gap renderer is gone — the
`to_52w_high` column in both `52w_high` and `near_52w_breakout` now comes from the shared
`gapCol`/`gapCell` in `src/components/screener/columns/columnHelpers.ts`, with the same id,
label, precision, tone and rendered output on each screen. No strategy math, env reader,
cache key or orchestrator changed.

Operational detail lives in [`AGENTS.md`](../AGENTS.md) (52W Range Screener Background Job)
and [`RUNBOOK_REFRESH.md`](./RUNBOOK_REFRESH.md).
