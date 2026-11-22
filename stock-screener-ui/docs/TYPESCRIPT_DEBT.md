# TypeScript Status

Measured 2026-11-23 in `stock-screener-ui/`. This file is the authoritative
baseline for the typecheck gates. Re-measure in the same PR before editing the
numbers.

## Current result

| Gate | Command | Errors today |
|---|---|---:|
| App | `bun run typecheck` | **0** |
| Tests + clean clusters | `bun run typecheck:ratchet` | **0** |
| Type-aware lint (report-only) | `bun run lint:types` | 138 warnings, 0 errors |

Type checking runs on **TypeScript 7.0.2** (`typescript7` npm alias) because it
is ~3× faster than 5.9 on this codebase: app 8.6s vs 30s; ratchet 4.7s vs 14–16s.
TypeScript 5.9.3 remains installed as `typescript` for tools that still consume
the JavaScript compiler API (notably the current knip line). The check scripts
call the TS 7 binary directly so the alias cannot be shadowed by the TS 5 bin.

`baseUrl` was removed from `tsconfig.json`; TS 7 rejects it. Relative `paths`
work without it.

CI runs both `bun run typecheck` and `bun run typecheck:ratchet`. A nonzero exit
fails the job.

## Why the old gate was fake

There was **no `tsconfig.json` anywhere in the worktree**. `npx tsc --noEmit`
printed CLI help and exited 1, while the historic gate
`npx tsc --noEmit 2>&1 | grep -c "error TS"` counted **0**. That was a shell
artifact, not a clean project check. The “322 errors” figure in older docs was
never produced by a real config in this worktree.

## Toolchain

- TypeScript 7 uses Go and has no stable programmatic compiler API yet. CLI use
  (`tsc -p`) is supported; tools that import the compiler API stay on TS 5.9.
- `typescript7` is `npm:typescript@7.0.2`.
- `typecheck:ts5` is kept for comparison: `tsc -p tsconfig.json --noEmit`.
- `oxlint` is 1.94, `oxfmt` 0.79, Vite 8.3.8 (Rolldown 1.2.x), knip 6.47.
- `oxfmt` is not run repo-wide in this change; a formatter version bump must not
  create a giant unrelated diff during a fast feature phase.

## Type-aware lint

`oxlint -c .oxlintrc.types.json --type-aware src` checks only three rules:

- `typescript/no-floating-promises`
- `typescript/no-misused-promises`
- `typescript/await-thenable`

At the 2026-11-23 baseline: **138 warnings** (53 no-floating-promises,
84 no-misused-promises, 1 await-thenable), 5.2s on 907 app files. Tests are
ignored for this report because `fireEvent` is synchronous and would add ~700
`await-thenable` false positives. This is deliberately **not** a PR gate; run it
manually or nightly until the warning baseline is low enough to ratchet.

## No-lowering rule

1. **0 is the ceiling.** `bun run typecheck` and `bun run typecheck:ratchet` must
   stay at 0.
2. **Never lower strictness to pass.** No `strict: false`, no disabling
   `strictNullChecks`/`noImplicitAny`, no `// @ts-nocheck`, no `as any` sweep,
   no widening `exclude`.
3. **Fix source, not the measurement.** If a config change reduces errors, it
   must fix a provable type-environment bug and be recorded here.
4. **Do not re-enable the fake gate.** A bare `tsc --noEmit` or a grep on help
   output is not a typecheck.

## What changed in the cleanup

The 237 errors were real source mismatches, not config noise. Fixes included:
UI prop contracts (`class`, `autoComplete`, `rel`, `style`, `testId`, `name`,
`value`), DOM `checked` narrowing, Solid `Show` keyed children, `JSX.CSSProperties`
imports, numeric CSS values, chart `Time` casts, replay `Record`/array vs `Map`
shapes, pattern filter casts/callbacks, route-search-param casts, and the
remaining nullable access. Runtime defects found along the way were fixed too:
the news desk-style check now calls `isDesk()`; the replay handle now exposes
`setChartOptions`; the replay trade id is assigned by the store; and the
theme drawer no longer passes an unsupported `textSx`.

This is a fast-phase-compatible cleanup: it removed the debt instead of adding a
blocking full-repo check while 237 errors remained.
