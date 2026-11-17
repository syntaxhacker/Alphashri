# Slow API report

Uvicorn's default access log has no duration, so a 4-second endpoint looks the
same as a 4-millisecond one. `api/slow_api.py` adds a pure-ASGI middleware that
records time-to-first-byte (TTFB) and total duration, then
`scripts/slow_api_report.py` groups the records by route.

## Run

```bash
# Top routes by p95 (default)
python scripts/slow_api_report.py

# Last 30 minutes, slowest individual calls
python scripts/slow_api_report.py --since 30m --sort max --top 15

# Only 1s+ calls, as JSON
python scripts/slow_api_report.py --min-ms 1000 --json

# Live tail
python scripts/slow_api_report.py --follow

# CI gate
python scripts/slow_api_report.py --fail-over 3000
```

The report reads `logs/slow_api.jsonl` and falls back to `SLOW_API` lines in
`logs/alphashri.log`, de-duplicating a record that appears in both.

## Configuration

| Env | Default | Meaning |
|---|---|---|
| `SLOW_API_MS` | `500` | Log TTFB/total above this threshold |
| `SLOW_API_LOG_ALL` | off | Log every request (true percentiles) |
| `SLOW_API_JSONL` | `logs/slow_api.jsonl` | Output file; empty disables |

A restart is required after changing the middleware/env. SSE responses are
judged by TTFB only; their body lifetime is not treated as latency.

Columns: `N` requests, `P50`/`P95` total (TTFB for streams), `MAX`, `ERR` (5xx),
`LAST` last seen.
