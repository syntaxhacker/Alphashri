# Market levels architecture (LevelBook)

Phase 1 of a single-source refactor for trading levels. The existing chart S/R,
pivot and options analytics remain the only places that compute their numbers;
the new `market_levels` package only wraps, labels and fuses their results.

**Contract:** no existing chart, report or API output changes. This layer is
additive and read-only.

## Shape of the system

```
compute_sr_zones ─┐
calculate_pivot_points ─┼─► detector.detect(ctx) ─► Level ─┐
api.options_levels ─────┘                                   ├─► fuse_levels ─► LevelBook
                                                            ┘
```

- **Contract objects** (`market_levels/models.py`, stdlib-only): `Level` and
  `LevelBook` are frozen dataclasses. `Level` carries immutable geometry
  (`price`, `bottom`/`top`, or `start_price`/`end_price`), `kind`, `source`,
  `side`, `strength`, `touches`, `evidence`, `detector_version` and a 12-char
  stable `level_id`. `LevelBook` is one symbol/timeframe/as-of snapshot with an
  optional `spot` and a tuple of levels; without a `spot`, fusion cannot resolve
  sides and leaves them `None`.
- **Registry** (`market_levels/registry.py`): a flat list of
  `(DetectorSpec, fn)` pairs. `register` replaces an earlier entry with the
  same `id`; `iter_detectors` iterates a snapshot. The registry is inert until
  adapter modules are imported — the foundation never imports lanes itself.
- **Adapters** (`market_levels/detectors/*.py`): each module declares a
  `DetectorSpec` (id, version, kind, `required_inputs`, params schema) and a
  pure `detect(ctx)` that returns `Level` objects, then calls `register` at
  import. `price_action`, `pivot`, `gex` and `walls` are the Phase 1 lanes.
- **Service** (`market_levels/service.py`): `build_level_book(...)` builds a
  context, runs every detector whose `required_inputs` are present, and fuses
  the results. `_ensure_adapters()` imports the known lanes lazily; a missing
  optional lane is not an error.

### Detector rules

1. `detect(ctx)` is pure: same context in, same levels out. No I/O, no clock,
   no network, no DB, no import of the service or UI.
2. Adapters wrap an upstream function; they never recompute its math. Deferred
   imports (e.g. `api.options_levels` inside `gex.detect`) keep the contract
   importable without the API layer.
3. Detect declares its inputs through `DetectorSpec.required_inputs`; the
   service decides applicability, so callers do not hand-pick lanes.
4. Side is normally a fusion concern, not a detector concern. The GEX adapter
   copies the side already present in the upstream block; the wall adapter
   derives it from `spot` because the raw wall payload carries no side field.
   Fusion still fills any remaining missing sides.

`DetectorSpec.min_bars` and `params_schema` are declarative metadata only.
`build_level_book` currently enforces neither: it gates detectors solely on
`required_inputs` being present in the context. A detector that needs a minimum
bar count or specific params must enforce them itself, or the service must be
extended to do so.

One options computation per book: when `option_rows` and `spot` are present,
`build_level_book` computes `detector_ctx["options_levels"]` once via
`api.options_levels.build_levels`, and both `gex` and `walls` consume that shared
payload. Their own `build_levels` call is a fallback for a direct `detect(ctx)`
call made outside the service (or when the shared computation failed and the key
is absent).

## Fusion rules (`market_levels/fusion.py`)

- **No cross-source merge.** Dedupe identity is
  `(source, kind, geometry, price, bottom, top, start_price, end_price,
  start_as_of, end_as_of)`.
  A price-action zone and a GEX level at the same price stay separate.
- **Provenance is immutable.** Fusion never rewrites `source`, `kind`,
  `evidence`, `detector_version` or the upstream numeric fields. When duplicate
  identities exist, the stronger level wins (`strength`, then `touches`, then
  id); ties break on `id`, so the outcome is order-independent.
- **Side fill.** When `spot` is a positive finite number and a level's `side` is
  `None`, fusion labels it `below` / `above` / `inside` from its bounds. A
  non-positive or non-finite spot leaves `side` unresolved (`spot <= 0` is
  treated as no spot for labeling): `fuse_levels` tolerates a non-finite spot and
  leaves sides `None`, while `LevelBook` rejects a non-finite spot at
  construction. An explicit side from upstream is preserved.
- **Deterministic rank.** Levels sort by source precedence
  (`price_action`, `pivot`, `gex`, `oi`, `session`, `trendline`), then strength,
  then distance from spot, then `id`. `max_per_side` is an optional post-sort
  cap, not a ranking input.

Note: fusion deliberately collapses same-price call/put walls into one `oi`
`wall` level (wall side is not part of the identity). `max_pain` has its own
`kind` and is never collapsed with a wall.

## Adding a trendline detector later

1. Add one file, `market_levels/detectors/trendline.py`. Declare a
   `DetectorSpec(id="trendline", version="1", kind=TRENDLINE,
   required_inputs=("candles",), ...)` and a pure `detect(ctx)`.
2. Use **segment geometry**: set `geometry="segment"` with `start_price`,
   `end_price`, `start_as_of`, `end_as_of` and a stable `level_id(...)` built
   from the two endpoints. Keep the segment endpoints exactly as detected;
   do not snap them into a horizontal level. Segment identity includes the date
   range via the existing `start_as_of`/`end_as_of` fields in both `level_id`
   and fusion dedupe, so two same-price segments over different dates remain
   distinct — reuse those fields rather than adding a second date pair.
3. Add `"trendline"` to `ADAPTER_MODULES` in
   `market_levels/detectors/__init__.py` and call `register(SPEC, detect)` at
   import. A detector is a new file with its own `DetectorSpec` and registration;
   the foundation already supports segment geometry and the `trendline` source
   rank. Any new identity semantics the detector needs (see step 2) belong in
   the foundation, not in a consumer. No consumer migration is needed in Phase 1;
   that is a later phase.
4. Add a parity test that reconstructs the segment from the existing/upstream
   geometry, plus a book-level test asserting the new source appears and the
   other sources are unchanged.

## Test map and the no-output-change contract

| File | What it pins |
| --- | --- |
| `tests/test_market_levels_contract.py` | frozen value objects, validation, stdlib-only models, stable ids |
| `tests/test_levels_fusion.py` | dedupe, no cross-source merge, side fill, rank, registry, service applicability |
| `tests/test_levels_price_action_parity.py` | every zone field reconstructed exactly from `Level` + `evidence` |
| `tests/test_levels_pivot_parity.py` | `calculate_pivot_points` values key-by-key, unrounded |
| `tests/test_levels_options_parity.py` | `api.options_levels.build_levels` GEX/wall blocks, lazy import, degraded branches |
| `tests/test_levels_integration.py` | all four lanes through `build_level_book`: determinism, unique ids, side fill, provenance, raw-source immutability |
| `tests/test_levels_adversarial.py` | non-finite/partial geometry, degraded and malformed option blocks, fusion side/order/provenance invariants, service validation and cold-registry registration |
| `tests/test_levels_trendline_extension.py` | segment geometry validation, date-aware segment identity, segment fields preserved by fusion, deterministic book with no source or consumer change |
| `scripts/perf/bench_levels.py` | deterministic warmup + 50-rep median/p95 for raw S/R and the full book |

The contract is enforced by comparing the book back to the raw functions
(`compute_sr_zones`, `calculate_pivot_points`, `build_levels`) and by a test that
deep-copies inputs/outputs before `build_level_book` and asserts they are
unchanged afterward. No suite edits an existing consumer payload.

## What not to do

- **No I/O in detectors** — no network, DB, clock, env reads or file writes.
- **No fusion in the UI** — the book is fused once, backend-side; frontends
  consume a finished snapshot, never re-rank or re-merge levels.
- **No giant module** — one adapter per source, one spec, one `detect`; the
  foundation stays small and stdlib-only.
- **No second math** — do not reimplement zone clustering, pivot formulas, GEX
  or wall ranking inside `market_levels`.
- **No consumer rewrite in Phase 1** — existing chart, report and API outputs
  keep their current shapes.

## Scope and phases

- **Phase 1 (current):** additive contract, four wrapping adapters, pure fusion,
  parity/integration tests and a deterministic benchmark. Zero consumer
  changes.
- **Phase 2:** migrate consumers to read `LevelBook` behind a feature flag,
  keeping their existing payloads byte-identical during the transition.
- **Phase 3:** expose a levels API endpoint backed by `build_level_book`, with
  the endpoint as the only new consumer of the book.
- **Phase 4:** add the trendline segment detector (see above), then retire any
  leftover standalone level plumbing once consumers are fully migrated.

## Phase 1 limitations / P2 hardening

- `Level` geometry/field strictness is complete for `segment`; horizontal/zone
  contradictory field combinations are still accepted (follow-up).
- `_checked_finite` accepts numeric strings/bools rather than normalizing to
  `float` (follow-up).
- If the options precompute fails, an adapter may retry the failing
  `build_levels` call once as a fallback (no output change); hardening that
  retry path is a P2 follow-up.
- Same-price call/put wall collapse in fusion is intentional and documented.
- `min_bars` and `params_schema` are metadata-only; the service does not enforce
  them.
- No consumer reads the book in Phase 1; the trendline detector and API migration
  come in later phases.
