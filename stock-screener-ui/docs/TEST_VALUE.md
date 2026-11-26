# Test value scorecard

This is the durable scorecard for whether tests earn their keep. **Count is not quality**: a
green suite of 13,275 unit tests and 850 (pre-dedup) E2E tests says nothing about the defects it misses,
the flakes it tolerates, or the CPU it burns. Every metric below has a definition, a source of
evidence, and a current value — "not measured yet" is an honest value, not a gap to paper over.

## Measured baselines (2026-11-26)

| Surface | Count / cost | What it is |
| --- | --- | --- |
| Frontend unit (vitest) | **13,275** | Full frontend suite size. The full **4-shard** unit suite runs on PR-to-main / nightly; the develop PR gate is **changed test files only**. Size is not quality. |
| E2E (Playwright, **16 shards**) | **850 (pre-dedup)** | Full E2E baseline, main/nightly only. The `test/e2e-value` run removes **6 duplicate tests**, so the effective post-dedup count is lower; refresh the baseline from that artifact. |
| Backend PR fast tier | **894 measured (662 documented)**, **6 shards** | The backend PR gate job. 894 is what the artifacts measure; 662 is the stale documented figure. Report both, never just one. |
| Backend full exclusion sweep | **8,987** | Push/nightly debt alarm, **~230 known failures**; not a gate until green. |
| E2E CPU | **3,134 s** | Aggregate CPU from the 850-test pre-dedup baseline; ≈ **3.7 s CPU per E2E test** (3,134 / 850). Re-measure after dedup. |

Gate shape after #283: develop PRs run **changed test files only**; PR-to-main and nightly run
the full **4-shard** unit suite. Full E2E is **16 shards**; the 850-test count predates the
`test/e2e-value` dedup that drops 6 duplicates.

Green reference run: #201 on `48bc38ca` ran **16/16 E2E**, **4/4 unit** and **6/6 Python**
shards green.

These are from the CI/measurement baselines supplied at the 2026-11-26 review and the post-#283
CI facts. Refresh from real CI artifacts, never from an estimate. The 8,987-test sweep's ~230
failures are **known debt**, not new regressions; see [TEST_DEBT.md](./TEST_DEBT.md).

## Metrics

| Metric | Definition | Evidence | Current |
| --- | --- | --- | --- |
| Escaped defects | Production defects that reached a user although a test already covered the same code path. Count per release, with the test that should have caught it. | Incident tagged `test-escaped`, linked test path, release number. | **Not instrumented** — no escaped-defect log exists yet. Start tagging at the next release. |
| Flake / retry rate | Tests with more than one attempt ÷ total tests, per run; also track failures that pass on rerun. | `Test value` section appended to `GITHUB_STEP_SUMMARY` by `scripts/ci/summarize-e2e.mjs` (`Retried` and `Flaky specs`). | **Not baselined** — the section is new; capture the first full 16-shard run before setting a target. |
| Cost per test / file | E2E CPU seconds ÷ test count; per spec file, summed test duration from the same section. Report p95, not just the mean. | `Slowest 5 tests` and `Slowest 5 spec files` in the step summary; 3,134 s aggregate CPU baseline above (850-test pre-dedup run). | **≈3.7 s CPU/E2E test** at that baseline; per-file figures pending first summary. Shard setup/teardown is not included in per-test durations. |
| Mutation score (P&L / risk / order / state) | Killed mutants ÷ (killed + survived) for each of the four modules. Report four separate numbers, never one blended figure. | Mutants run with the procedure in [MUTATION_TESTING.md](../MUTATION_TESTING.md), scoped to the P&L, risk, order and state modules. | **Not measured for these modules**. No number is claimed until a mutation run is recorded. |
| Critical-path coverage | Share of the inventory below with a passing E2E guard, a mutation-tested unit path, and 1600/390 visual evidence where the surface is visual. | Named spec paths below + mutation results + committed screenshot manifests. | **Inventory established, coverage not yet audited**. Do not claim a percentage before an audit. |

Targets are set and revised only at the quarterly review, with the date and rationale recorded
in this file. A metric with no evidence stays "not measured" — it is never converted into a
pass by lowering the target or dropping the dimension.

## Critical-path inventory

These are the surfaces that must never lose coverage. Spec paths are the starting evidence to
check each quarter; confirm the spec still asserts the named behavior before counting it.

| Surface | Evidence to verify |
| --- | --- |
| Auth / login gate | `tests/e2e/auth.spec.ts` |
| Market session (hours, holiday, session date) | `tests/e2e/market-sections.spec.ts`, `tests/e2e/market-ticker.spec.ts` |
| Options chain and multi-leg orders | `tests/e2e/options.spec.ts`, `tests/e2e/options-paper-multileg.spec.ts` |
| Paper order lifecycle (place → fill → close → history) | `tests/e2e/paper-trading.spec.ts`, `tests/e2e/trade-history.spec.ts` |
| Patterns URL state and dock | `tests/e2e/patterns.spec.ts`, `tests/e2e/options-dock.spec.ts`, `tests/e2e/options-paper-dock.spec.ts` |
| Report (tape, replay, walls, charts) | `tests/e2e/nifty-report.spec.ts`, `tests/e2e/report-detail.spec.ts` |
| Screener (filters, URL params, sorting) | `tests/e2e/screener.spec.ts`, `tests/e2e/screener-url-params.spec.ts` |
| Accessibility (axe / keyboard) | `tests/e2e/app-a11y.spec.ts`, `tests/e2e/app-a11y-matrix.spec.ts`, `tests/e2e/report-keyboard.spec.ts` |
| 1600 / 390 viewport evidence | `tests/e2e/ui-a-plus-matrix.spec.ts`, `tests/e2e/ui-a-plus-states.spec.ts`, `tests/e2e/design-evidence.spec.ts` |

A change to any of these requires the targeted E2E spec plus its unit/mutation coverage; a
screenshot alone is not a coverage claim.

## Quarantine policy

1. Track each test over a rolling **20 runs** from CI artifacts.
2. **2 failures in 20 runs** → quarantine the test. Quarantine is a tracked state, not a
   deletion: record test id, owner, date, failure links, and the condition for unquarantining.
3. Never silently delete, `skip` permanently, or raise a timeout to make a flake disappear.
   A quarantined test still appears in reports, counted separately from the passing set.
4. Quarantining a critical-path item needs a named owner and an explicit note in this file;
   an unowned quarantine expires at the next quarterly review.
5. A quarantined test that stays quarantined for two reviews is a deletion candidate — apply
   the deletion rule below, not an indefinite `.skip`.

## Quarterly review

1. Rank tests and spec files by **cost ÷ value**: CPU seconds and wall time from the step
   summary against the defects they caught, flake history, and critical-path membership.
2. Inspect the **bottom 5%** by that ranking. High-cost / low-value tests get optimized,
   narrowed, or proposed for deletion — never just relabeled.
3. **Deletion requires named surviving coverage**: the deleting owner's name, the exact test
   path or assertion that still covers the behavior, the date, and a check that no
   critical-path inventory row loses its guard. A deletion without all four is a coverage
   hole, not an optimization.
4. Record the review date, numbers moved, and any target change in this file. Targets are not
   lowered to clear a review.

## Refreshing the numbers

```bash
node scripts/ci/summarize-e2e.mjs --self-test          # built-in fixture checks
node scripts/ci/summarize-e2e.test.mjs                 # standalone test file (8 cases)
npx oxlint scripts/ci/summarize-e2e.mjs
```

The summarizer is warning-only and never changes the job exit code. Point `--report` at real
Playwright JSON and `--summary` at `$GITHUB_STEP_SUMMARY` to capture a run's counts, flaky
specs and slow lists; aggregate several shards by passing `--report` repeatedly. No Playwright
run is needed to validate the summarizer itself. Mutation scores come from the documented
mutation runs — not from the summarizer, and not from line coverage.
