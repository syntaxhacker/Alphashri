# Chart-pattern detection performance

Reproducible timing for `chart_patterns.engine.detect_patterns` and
`chart_patterns.trendlines.detect_trendlines`. The script is tooling only — it does
not import the DB or start FastAPI, and it never writes outside the cache file.

## Commands

Run from `stock-screener-ui/` with the project venv.

```bash
# Synthetic (default, no network) — seeded random walks, fixed timestamps
.venv/bin/python scripts/bench_chart_patterns.py --synthetic --symbols 4 --bars 260 --runs 3
.venv/bin/python scripts/bench_chart_patterns.py --synthetic --symbols 2 --bars 120 --timeframes 1D --runs 1

# Real NSE frames via yfinance: 1D = --period 2y, 1h + 5m = --intraday-period 60d.
# Fetched frames are pickled to --cache so every run measures the same bars.
.venv/bin/python scripts/bench_chart_patterns.py --real --tickers RELIANCE.NS TCS.NS --runs 3

# Reuse the cache with no network at all (repeatable A/B).
.venv/bin/python scripts/bench_chart_patterns.py --from-cache /tmp/alphashri_pattern_frames.pkl --runs 3
```

Useful flags: `--timeframes 1D,1h,5m` (default), `--seed 42` (synthetic RNG),
`--period` / `--intraday-period` (real), `--cache PATH` (default
`/tmp/alphashri_pattern_frames.pkl`), `--trendline-lookback N`. `--runs` defaults to 3.
Timeframes map to backing frames: `1D/1W/1M` → daily, `1h..4h` → 1h, the rest → 5m.

## What the hash protects

Each group prints a sha256 of the **canonical JSON of every detector output** for that
group: `PatternHit`s converted with `dataclasses.asdict` and trendline dicts, with
sorted keys, sorted item order (timeframe, symbol), non-finite floats normalised and
no whitespace variation. The `ALL/combined` row hashes both operations together.

The hash is an **exact-output-equivalence guard**, not a timing metric. An optimisation
is only valid when the before/after hashes match byte-for-byte (and hit counts agree);
a changed hash means the candidate altered which patterns or lines are produced and
must be rejected or justified. The script also compares outputs across runs and warns
with `Output stable across runs: False` if they ever differ.

## Why interleaved runs and the median

Frames are processed with runs as the outer loop and both operations called on every
frame inside it: `run1: (all symbols × patterns, trendlines), run2: …`. Interleaving
spreads warm-up, OS page caching, CPU frequency scaling and thermal drift evenly across
both operations instead of charging all of it to whichever runs second. **Min** is the
closest observable to the frame's uncontended cost; **median** is robust to the GC
pauses and scheduler pre-emption that a mean would absorb. Compare min/median, and
compare the same groups (same timeframe, same op, same cache) — never an aggregate from
a different frame set.

## Stop rule (current)

Keep optimising only while a **single hotspot is >10–15%** of the timed total: above
that threshold there is a concentrated target worth attacking. Once the largest
hotspot is ≤10–15%, the remaining cost is diffuse — stop. Also stop when a candidate
delivers **<2–3%** improvement in min/median: below that, run-to-run noise and
measurement overhead exceed the gain, so further churn is not evidence-based. Re-check
the hash and hit count before accepting any gain.

## Real-data coverage and the synthetic fallback

`--real` fetches daily bars for `--period` (default 2y) and 1h/5m bars for
`--intraday-period` (default 60d) for each ticker, then caches all three intervals.
This is the coverage check: daily frames are long enough for the slow detectors, while
1h/5m exercise the pivot-heavy envelope path that dominates intraday cost. Cached bars
are pinned — `--from-cache` replays the identical frames offline, so a before/after
comparison cannot drift with new sessions.

Network is required **only** by `--real`; synthetic mode never imports yfinance and
uses a fixed seed and a fixed index anchor, so it is fully deterministic and runs
offline (useful for CI, A/B smoke checks, and when Yahoo is unavailable). Synthetic
walks are shaped to produce hits and stable hashes — they measure cost and equivalence,
not market realism. Prefer real cached frames for final decisions, and fall back to
synthetic whenever the network or a usable cache is unavailable.
