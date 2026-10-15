# scripts/ — edge-detection pipeline

Forward-return scoring for the dashboard's persisted alerts, plus the only
person-attributable feeds (congress + insider).

## Pieces

| File | Role |
|------|------|
| `edge_store.py` | Dedicated SQLite (`data/edge.db`, override `UW_EDGE_DB`) for `bars`, `outcomes`, `edge_stats`. Never touches `db/alphashri.db` or `data/alerts.db`. |
| `edge_resolver.py` | Scores pending alerts at `5m / 15m / 60m / eod / 1d`, caching 1m/1d bars. Bounded fetches (`--max-fetches`, default 60/run) with per-ticker throttling. |
| `edge_stats.py` | Aggregates `outcomes` into deduped, market-relative buckets: `kind`, `sweep`, `premium`, `asset`, `side`, `combo`, `ticker`. |
| `players_data.py` | Congress + insider trades, scored since their transaction date. |

## Scoring model

* Direction: `bullish => +1`, `bearish => -1`; anything ambiguous (dark-pool
  `side="ext"`, OI rows with no side) is skipped, never guessed.
* Entry: first 1-minute bar close at/after the alert's `event_ts` (UTC; sessions
  in America/New_York).
* Exit: the bar whose timestamp is **closest** to `entry_ts + horizon`, searched
  on BOTH sides within `_EXIT_TOL_MIN` (5 min). No "last bar in a loose window"
  — a 5m horizon is a 5m window, or it stays unresolved. `mfe`/`mae` are
  confined to that same window.
* `ret` = signed % move from entry to exit.
* `excess = ret - baseline_ret`, where `baseline_ret` is the direction-signed
  benchmark move over the *same* window. Precedence:
  1. **SPY** (market-relative) whenever SPY 1m bars cover the window — fetched
     once per run and reused. `baseline_ret = dir * spy_move(entry -> exit)`.
  2. the ticker's own unconditional mean move over the same horizon, signed by
     `dir`, only when it has >= 20 samples.
  3. neither -> `baseline_ret = None, excess = None`.
* Figures are **gross** of commissions/slippage.

## Independence (dedupe)

Raw outcomes are not independent: one macro print creates hundreds of option
contracts on the same ticker at the same instant, scored against identical
underlying bars (identical `ret`), which inflates `n` and the t-stat. Each
bucket is collapsed to **independent observations** — one per
`(ticker, entry minute, dir)` — taking the group's mean `ret`/`excess`:

| Field | Meaning |
|-------|---------|
| `n_raw` | raw scored outcomes |
| `n_ind` | independent observations after dedupe |
| `distinct_tickers` | unique tickers among independent observations |
| `distinct_sessions` | unique entry sessions among independent observations |
| `low_n` | `1` unless `n_ind >= 20 AND distinct_tickers >= 5 AND distinct_sessions >= 2` |

`tstat` and all means are computed from the independent observations only.
Ranked views should discard `low_n` buckets.

## Units

* `/api/edge` stats rows: `win_rate`, `avg_ret`, `avg_excess` are **FRACTIONS**
  (`0..1`), i.e. percent / 100. `tstat` is unitless.
* `players` `avg_pnl_pct` / `pnl_pct` and `whales` `move_pct` stay **PERCENT**.
* Individual `outcomes.ret` / `excess` / `mfe` / `mae` stay in **PERCENT**.

## CLI

```bash
python scripts/edge_resolver.py --once [--limit N] [--max-fetches N] [--days N]
python scripts/edge_resolver.py --reset      # delete outcomes + re-resolve from cache
python scripts/edge_stats.py
```

## HTTP (dashboard_server.py)

* `GET /api/edge` — sample size, horizons, ranked bucket stats, resolver status.
* `GET /api/edge/players` — congress + insider leaderboard.
* `GET /api/edge/whales?limit=N` — biggest recent alerts with `entry_px`,
  `last_px`, `move_pct`, `status`.

A background daemon thread runs `resolve_pending()` then `refresh()` every
`EDGE_INTERVAL` seconds (default 300; disabled when `CI_MODE` is set).

## Caveats

* UW intraday (`/ohlc/1m`) is a rolling ~2500-bar window, so very old alerts
  cannot be scored; they stay unresolved.
* `1d` only resolves after the next session closes.
* Baselines drift slightly as the rolling cache grows.
