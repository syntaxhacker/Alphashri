# TypeScript Debt

Measured 2026-11-22 in `stock-screener-ui/` with TypeScript 5.9.3. This file is the
authoritative baseline for the `typecheck` gates. Do not edit the counts without a
re-measurement in the same PR.

## Why the old gate was fake

There was **no `tsconfig.json` anywhere in the worktree** (nor in git history).
`npx tsc --noEmit` therefore printed the CLI help and exited 1, while the repo's
historic gate `npx tsc --noEmit 2>&1 | grep -c "error TS"` reported **0 errors** —
a shell artifact, not a clean typecheck. The "322 errors" figure in `AGENTS.md`
and `SUBAGENT_RULES.md` could not be reproduced: it was never produced by a real
project config in this worktree.

Two real configs now exist:

| Config | Purpose | Errors today |
|---|---|---|
| `tsconfig.json` | Entire app (`src/**` excluding `*.test.*` and `src/test/`) | **237** |
| `tsconfig.typecheck.json` | Ratchet: test files + clusters that are clean under the real config | **0** |

Scripts (invoked as `bun run typecheck` / `bun run typecheck:ratchet`):

```
typecheck          tsc -p tsconfig.json --noEmit --pretty false
typecheck:ratchet  tsc -p tsconfig.typecheck.json --noEmit --pretty false
```

Both exit with TypeScript's status (2 = errors), so the ratchet is a hard gate.

Ratchet scope: `src/**/*.d.ts`, `src/test/**/*.ts` (the 13 guard tests), and the
zero-error clusters `api`, `config`, `state`, `utils`, `types`, `stories`. It
deliberately omits `src/test/pages.test.tsx` (1 pre-existing TS2604) and the
component/page clusters whose tests import dirty hubs (see below).

## Config-level fixes applied (proven, not cosmetic)

- `jsx: "preserve"` + `jsxImportSource: "solid-js"` — Solid JSX runtime types;
  without this, JSX element typing falls back to the wrong namespace.
- `moduleResolution: "Bundler"`, `module: "ESNext"`, `paths: { "@/*": ["./src/*"] }`
  — resolves every `@/…` import; zero module-resolution errors remain.
- `types: ["vite/client", "vitest/globals", "node"]` — `vitest/globals` fixes 2
  errors in `src/pages/report/reportTestFixtures.tsx` (`globals: true` is already
  set in `vitest.config.ts`); `node` removes 54 false positives in the ratchet
  scope (`node:fs`, `global`, `process`, `__dirname` in test files). No strictness
  was relaxed.
- `strict: true` with **no** sub-flags disabled. All 237 remaining errors are real
  source-level type defects, not config noise; no compiler flag was weakened to
  reduce the count.

Config probes that failed and were **rejected**: no `tsconfig`, wrong JSX import
source, `strict: false`, and excluding files to make errors disappear.

## Error clusters (app config, 237 total)

| Cluster | Errors |
|---|---:|
| `src/components/strategies` | 40 |
| `src/components/replay` | 36 |
| `src/components/strategy-runner` | 24 |
| `src/components/backtest` | 18 |
| `src/pages/admin` | 16 |
| `src/components/chart` | 16 |
| `src/components/options` | 15 |
| `src/pages/agri` | 12 |
| `src/components/sector` | 12 |
| `src/components/news` | 11 |
| `src/components/auth` | 6 |
| `src/components/experiments` | 4 |
| `src/components/{window,notifications,layout,home}` | 4 |
| `src/hooks` (mostly `usePatternUrlSync.ts`, 9) | 9 |
| `src/test-utils/solidUiMock.tsx` | 2 |
| `src/ui/icons.tsx` | 1 |

By top-level directory: `components` 186, `pages` 39, `hooks` 9, `test-utils` 2,
`ui` 1. Clean directories (0 under the real config): `api`, `config`, `state`,
`utils`, `types`, `stories`.

## Root causes (not just error codes)

| Root cause | Typical code / example |
|---|---|
| UI component props missing legacy keys (`class`, `checked`, `autoComplete`, `style`, `flex`, `p`, `h`, `variant`, …) | TS2322 (134 total); e.g. `strategy-runner/StrategyRunnerTabs.tsx`, `auth/LoginForm.tsx` |
| DOM event target union not narrowed (`HTMLInputElement \| HTMLSelectElement`) | TS2339 (22); e.g. `backtest/BacktestConfig.tsx:191` |
| Solid accessor used as value / `Show` children passed as a function | TS2769 + nested `Type '() => JSX.Element' is not assignable to type 'Element'`; e.g. `backtest/BacktestSummary.tsx:51` |
| Nullable values in arithmetic/render | TS18047 / TS2531 / TS18048 (13); e.g. `backtest/BacktestChart.tsx:307` |
| `Map`/array shape mismatch in replay state | TS2740 (8); `replay/ReplayPage.tsx`, `replay/ReplayMainView.tsx` |
| External chart typings (`lightweight-charts` `Time`, generic series APIs) | TS2345 / TS2677 / TS2322; `chart/TradingViewChart.tsx` (16) |
| Wrong symbol imports (`CSSProperties` from `solid-js`), bare global `JSX` namespace | TS2305 (3), TS2503 (1); `options/OptionChain/*`, `backtest/ChartErrorBoundary.tsx` |
| URL-sync / router param types | 9 errors in `hooks/usePatternUrlSync.ts` |
| Mock signature drift | 2 errors in `test-utils/solidUiMock.tsx` |

Per the repo rule, roughly one error in twenty is a real runtime defect (accessor
misuse, wrong data shape, dropped prop). Treat these clusters as bug hunts.

## No-lowering rule (non-negotiable)

1. **237 is a ceiling, not a target to widen.** `bun run typecheck` must never
   report more than 237 errors. Record the exact before/after count in any PR
   that touches it.
2. **`bun run typecheck:ratchet` must stay at 0.** Any new error in the ratchet
   scope — including one pulled in transitively by an imported module — fails
   the gate. Never add a file/error to an ignore list to make it green.
3. **Never lower strictness to pass a gate.** No `strict: false`, no disabling
   `strictNullChecks`/`noImplicitAny`/etc., no `// @ts-nocheck`, no `as any`
   sweep, no widening `types`/`exclude` to hide a defect. Config changes that
   reduce the count are allowed only when they fix a provable type-environment
   bug and are documented here with the before/after measurement.
4. **Reductions must come from source fixes** in the file's owning lane, one
   cluster at a time. When a cluster is cleared, look for the runtime bug it
   exposed before claiming the win.
5. **Do not re-enable the fake gate.** `tsc --noEmit` with no `-p`, or a bare
   `grep -c "error TS"` on help output, is not a typecheck.

## Remaining blockers to a whole-app clean gate

- The five clusters above (`strategies`, `replay`, `strategy-runner`, `backtest`,
  `chart`) plus `pages/admin`, `pages/agri`, `options`, `sector`, `news` hold the
  bulk of the 237 errors and need source fixes in their owning lanes.
- The ratchet cannot currently expand into the component/page "clean" clusters
  claimed in `AGENTS.md`: their tests import `src/ui/icons.tsx` (1 TS2430),
  `src/components/chart/TradingViewChart.tsx` (16),
  `src/components/notifications/MarketAlertCard.tsx`, `src/test-utils/solidUiMock.tsx`
  (2) and other dirty hubs. TypeScript follows imports, so including those tests
  reintroduces 49 transitive errors. Those hubs must be fixed before the ratchet
  can cover them.
- `bun` is not installed in this workspace; scripts were verified with
  `npm run typecheck` / `npm run typecheck:ratchet`, which execute the same
  package.json commands (`bun run` would behave identically).
