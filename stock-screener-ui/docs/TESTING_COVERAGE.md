# Frontend coverage (`src/`)

Local-only V8 coverage for the SolidJS frontend. These commands are for measuring and ratcheting
coverage on a workstation; CI wiring is out of scope for this lane. Bun is the project's package manager, but
the commands below are plain `vitest` invocations so they also run through `npx` when Bun is
unavailable (as in the audit sandbox).

## Commands

| Goal | Bun available | Bun unavailable (npx fallback, uses existing `node_modules`) |
|---|---|---|
| Enforce the committed thresholds | `bun run test:coverage` | `npx vitest run --dir src --coverage` |
| Report only (never fails on thresholds) | `bun run test:coverage:report` | `npx vitest run --dir src --coverage --coverage.thresholds.lines=0 --coverage.thresholds.functions=0 --coverage.thresholds.branches=0 --coverage.thresholds.statements=0` |

Both scripts are the same as `test:unit` (`vitest run --dir src`) plus `--coverage`, so they use the
same environment (`happy-dom`), setup file, aliases and Solid transform as the normal unit suite.
`test:coverage:report` explicitly zeroes all four CLI threshold overrides; it writes the identical
report and still exits non-zero on **test failures**, just not on coverage-percentage failures.
Use it for a quick "where are we?" baseline and for inspecting a red enforced run.

Do not add `--coverage.enabled` or a second config file: `vitest.config.ts` already sets
`provider: "v8"` and the reporters. No package or install is needed — `@vitest/coverage-v8@4.1.0`
is already a devDependency and matches the installed `vitest` version.

## Where the report lands

With the default `coverage.reportsDirectory` (`./coverage`, relative to this package root):

- `coverage/index.html` — interactive HTML report (open in a browser; no server needed).
- `coverage/lcov-report/` — per-file HTML pages linked from the index.
- `coverage/lcov.info` — line coverage exchange format (for editors / future CI upload).
- Coverage stdout — per-file table plus the `All files` summary, printed on every run.
- `coverage/.tmp/` — V8 raw chunks, regenerated each run.

`coverage/` is already gitignored in this package's `.gitignore`. Never commit generated HTML or
JSON; regenerate locally instead.

## Include / exclude policy

Defined in `vitest.config.ts` under `test.coverage` (and `test.exclude` for test discovery):

- **Include:** `src/**/*.{ts,tsx}` — every frontend TypeScript/TSX module, *including files no
  test imports*. Vitest's V8 provider globs the include set for untested files and counts them as
  0% in the denominator, so leaving a file unimported does not hide it.
- **Exclude:** `src/**/*.test.{ts,tsx}` (the tests themselves), `src/**/*.stories.*` (Storybook
  fixtures), `src/ui/**` (the local declarative design-system primitives), `src/types/**`
  (type-only declarations erased at runtime). Test discovery also excludes E2E, `dist`,
  `node_modules`, `coverage` and `poc` paths.
- The current excludes are fixed. Do not widen them to make a number go up. If a file genuinely
  cannot be instrumented (e.g. a generated asset or an env-only bootstrap), raise it in review and
  document the reason here rather than adding a silent glob.

### Adding tested code without gaming the metric

1. Put the new module under `src/` so it is in the include glob; never add a new exclude to dodge
   a low-coverage file.
2. Add a co-located `*.test.ts(x)` next to it with assertions on the real contract. The test file
   is excluded from the denominator by design, so adding tests can only raise coverage.
3. Extract pure logic (parsers, math, mappers) into a `.ts` helper and test it directly. This is the
   preferred way to cover branches inside large `.tsx` view components.
4. Keep existing excludes honest: `src/ui/**` and `src/types/**` are excluded for *kind* (declarative
   wrappers / erased types), not because they are hard to test. If you add behaviour (event
   handlers, derived state, formatting) to a file under `src/ui/`, either move that behaviour into
   an included module with its own tests or propose removing the exclude in the same change.
5. Do not use `/* c8 ignore */`, `/* istanbul ignore */`, coverage-only test stubs, or tests that
   merely import a module without exercising it. They inflate the number without covering behaviour.

## Baseline and threshold ratchet

Measured **2026-11-22** with the report-only fallback command above (Vitest 4.1.0, V8, full
`--dir src` suite, 748 test files / 11,296 tests, ~23 min on 2 cores):

| Metric | Measured baseline | Enforced threshold | Headroom |
|---|---:|---:|---:|
| Statements | **86.26%** | 86 | 0.26 pp |
| Branches | **75.34%** | 75 | 0.34 pp |
| Functions | **86.81%** | 86 | 0.81 pp |
| Lines | **88.29%** | 88 | 0.29 pp |

The previous blanket `80/80/80/80` thresholds were unattainable: **branch coverage is 75.34%**, so
`test:coverage` would have been permanently red, teaching everyone to ignore it. The committed
thresholds are now floored whole-point values from this measurement — not rounded up, and not
invented. They are a **one-way ratchet**: raise a number only after a new full measurement shows a
sustained increase; never lower it, and never widen `coverage.exclude` to make a number pass.
`test:coverage:report` remains threshold-free so anyone can inspect the current number without
fighting the ratchet.

The measurement run had 2 failing guard tests unrelated to coverage (`component-audit.test.ts`
"the audit report covers every shared component" and `table-structure.test.ts` "no new file
declares its own column array" — both appeared while other lanes were adding files). 743 test files
and 11,240 tests passed, 1 skipped. `reportOnFailure: true` kept the coverage report intact; the
exit code was 1 from those test failures, **not** from thresholds (no coverage threshold errors were
emitted). Re-measure after those lanes settle before raising a threshold.

## Notes for the audit lane

- Bun was not available in the audit sandbox (`which bun` → not found); Node v24.22.2 / `npx` and
  the checked-in `node_modules` were used. The npm scripts remain Bun-compatible.
- No packages were added, removed, upgraded or installed, and no generated report is committed.
