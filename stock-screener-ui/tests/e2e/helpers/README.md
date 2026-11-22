# E2E helpers

This directory is the **only** home for TypeScript E2E helpers. All E2E specs live one level up in `tests/e2e/` and import helpers from `./helpers/<name>`.

## Ownership

- Files here are owned by the E2E lane. Add shared page objects, route-mock builders and navigation helpers here rather than under `tests/helpers/`.
- `tests/helpers/` is Python-only (`db.py` and friends). It is not a second helper tree for specs.
- API mock payloads and shared setup functions stay in `tests/mocks/` (`apiResponses.ts`, `routeHelper.ts`); import them from here with `../../mocks/...`.

## Naming

- `<feature>Helpers.ts` — canonical, reusable behaviour (page objects, navigation, route setup). Examples: `botHelpers.ts`, `multiStrategyHelpers.ts`, `paperTradingHelpers.ts`.
- `<feature>Mocks.ts` — pure mock payloads / route-response fixtures with no page interaction. Example: `agriMocks.ts`.
- `<feature>Fixture.ts` — a single composed fixture returned to a spec. Example: `premiumFixture.ts`.
- `flowsB.ts` — legacy name kept for stability; do not add new files in this style.

Pick one file per feature. Before creating `<feature>Helpers.ts`, extend the existing one if the feature already has helpers.

## Hard rule

Specs must **not** import `../helpers/*.ts`. That path points at the Python helper directory and is how the old duplicate helper tree survived. If a helper is needed by more than one spec, put it in this directory and import it as `./helpers/<name>`.

```ts
// good
import { setupBotApiMocks } from "./helpers/botHelpers";

// forbidden
import { setupBotApiMocks } from "../helpers/botsHelpers";
```
