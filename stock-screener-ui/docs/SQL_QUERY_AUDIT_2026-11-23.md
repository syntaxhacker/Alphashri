# SQL Query Audit — 2026-11-23

Scope: the SQLite read/write paths under `api/`, `services/`, `db/models/`,
`trading/` and the agri cache. The audit focused on bounded API reads, N+1
loads, delete/retention scans and indexes that match real `WHERE`/`ORDER BY`
clauses. It is not a claim that every table was benchmarked: the local
`db/alphashri.db` is a small QA fixture, so plans and schema were used instead
of production-sized timing.

## Fixed in this pass

### 1. News symbol N+1

`NewsArticle.to_dict()` serializes `symbols`, but the relationship was lazy.
Every article in `/api/news/recent`, symbol lookups and search issued one extra
query for mentions. Changed `NewsArticle.symbols` to
`lazy="selectin"` — one batched mention query per article load instead of
`1 + N`.

This also covers the two-step instrument/symbol lookups, which now load each
article's mentions in one query rather than one per article.

### 2. Queue status lookup narrowed to the page

`/api/news/recent` selected **every** pending/processing row from
`news_analysis_queue`, then discarded all but the returned page. It now binds
the page's article ids (`article_id IN :ids`), so the query is bounded by the
page size (max 100) instead of the queue size.

### 3. Indexes matched to real queries

Migration `sqlidx1a2b3c4d5e` adds:

| Index | Query it serves |
|---|---|
| `ix_news_articles_impact_published` | `impact_score IS NULL ORDER BY published_at DESC` (analysis queue) |
| `ix_news_articles_source_fetched` | `source = ? AND fetched_at >= ?` (source-scoped feed) |
| `ix_news_symbol_mentions_symbol_code` | the `symbol_code` branch of the OR lookup; without it SQLite cannot use a multi-index OR plan |
| `ix_ocs_ts` | `DELETE ... WHERE ts < cutoff` retention; the old indexes all start with `underlying` |
| `ix_corporate_events_market_date_symbol` | market + event-date range + stable date/symbol order |
| `ix_event_anomalies_market_ts` | market + ts range, ordered by ts |

`tests/test_sql_query_plans.py` asserts the indexes exist and that each caller
uses them rather than a full table scan. The OR lookup test asserts SQLite
chooses a `MULTI-INDEX OR` plan across both mention indexes.

## Existing query work that was already solid

- `pattern_hits`: `(job_id, timeframe, confidence, id)` and
  `(timeframe, confidence, id)` make the confidence-first pages index-only;
  `tests/test_chart_patterns_query_plan.py` guards them.
- `pattern_compute_jobs`: `(universe, timeframe, status, finished_at)` serves the
  scan-stamp lookup.
- `trades`: `(user_id, is_test, exit_time)` serves history/activity ordering.
- `price_surge_events`: `created_at` serves the today filter and newest-first
  page.
- `option_chain_snapshots`: `(underlying, expiry, ts)` serves the idempotency
  read; `(underlying, session_date)` serves history. The new `ts` index only
  covers retention.
- Agri: `(commodity_key, date)` answers `MAX(date)` per key, `(state, district,
  market)` covers the geography metadata scan, and `mmap_size` + WAL keep the
  large cache readable without copying pages into the SQLite page cache.
- News article lookup by `url` and `news_symbol_mentions.article_id` already
  have indexes.

## Deliberately not changed

These are real candidates but need measurement or a larger change:

1. **News full-text search** — `headline ILIKE '%q%' OR content ILIKE '%q%'`
   still scans. FTS5 is the correct fix, but needs an external-content table,
   triggers for insert/update/delete and a backfill. Do it as its own migration
   and benchmark before replacing the endpoint.
2. **Strategy performance aggregation** — `api/strategy_performance.py` loads
   all trades in the window and aggregates in Python. A `GROUP BY strategy_id`
   query would be faster on large histories, but the current code computes
   several cost/P&L fields and needs an exact SQL/Python parity test first.
3. **Article cleanup** — `cleanup_old_articles` loads every old row and deletes
   ORM objects one by one to preserve the symbol cascade. A bulk delete needs an
   explicit mention-delete step (or `ON DELETE CASCADE` plus `PRAGMA
   foreign_keys=ON`) to avoid orphans.
4. **Agri sort covering index** — `fetch_rows` uses `(commodity_key, date)` and
   then sorts by date/geography/commodity. A covering index including all order
   columns would remove the temp B-tree but is large on a 2.3M-row cache; only
   worth it if a production profile shows the sort dominating.
5. **`store.anchor_dates`** — the legacy helper filters raw `commodity` without
   an index. It is currently unused by the router (which uses `commodity_key`);
   adding a 2.3M-row raw-name index would be paying for dead code. Remove or
   re-point the helper before indexing it.

## Verification

```text
pytest tests/test_sql_query_plans.py \
       tests/test_news_persistence.py \
       tests/api/test_event_radar \
       tests/test_options_history.py \
       tests/test_options_recorder.py \
       tests/test_chart_patterns_query_plan.py \
       tests/test_db_database.py
→ 497 passed
```

Alembic upgrade → downgrade → upgrade was run on a scratch SQLite database;
the six indexes were created and recreated cleanly.
