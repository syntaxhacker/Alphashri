# stock-screener-ui — Agent Rules

## Stack
React 19 + Vite 8 + Mantine 8 + TypeScript. Backend: FastAPI (Python).

## Commands
- `bun run dev` — dev server (proxy /api → localhost:8765)
- `bun run build` — production build
- `bun run lint` — oxlint (0 warnings/errors required before commit)
- `bun run test` — vitest (unit, happy-dom)
- `python -m pytest tests/` — backend tests

## Mantine v8 Rules
- Reference `mantine_llm.txt` for component docs — never guess APIs
- Use Mantine components (`Flex`, `Stack`, `ScrollArea`, `Group`, `Grid`, `Text`) instead of raw `<div>` + inline styles
- Use `CompactPanel`, `CompactStat`, `CompactStatGrid` from `components/common/compact.tsx` for small stat displays
- Never hardcode dark colors (`#0a0a0a`, `#1a1a1a`) — use Mantine CSS vars (`var(--mantine-color-body)`) or theme object
- Use `styles` prop on Mantine components for overrides, not global CSS classes
- Default sizes: `size="sm"` for inputs/buttons, `size="xs"` for dense tables/badges

## State Management
- Stores in `src/state/` — use `createSubscriber` pattern + `useStoreSubscription` hook
- Never call `useState` for data that lives in a store

## Component Patterns
- Barrel files (`mantine.ts`) point to current components — edit `*2.tsx` files, update barrel, never edit old files
- Shared components: `SortableHeader`, `BadgeComponents`, `PnlText`, `compact.tsx`, `states.tsx` in `src/components/common/`
- Shared utilities: `formatCurrencyIN`, `formatNumber`, `formatTimeOnly`, `formatElapsed`, `getPnLTextColor`, `getNextSortDirection`, `sortByField` in `src/utils/ui-helpers.ts`
- ECharts: never wrap chart container in `ScrollArea` — ECharts needs explicit dimensions via `flex: 1` on a flex parent

## CSS
- Legacy hardcoded CSS in `style.css` is being migrated to Mantine — prefer `var(--mantine-color-*)` vars
- Remove dead CSS classes when removing old components (verify with grep before deleting)
- No CSS modules — global CSS with Mantine class overrides

## Backend (Python)
- Single source of truth for IST timezone: `config.IST` (root `config.py`, re-exported in `stock-screener-ui/config.py`)
- Use `datetime.now(config.IST)` everywhere, never `datetime.now()` without tz
- Pandas date filtering: use `pd.Timestamp(date_str, tz=config.IST)` not raw strings — Timestamp vs string comparison raises TypeError
- `fetch_intraday_data_v3` for today, `fetch_historical_data_v3` for past dates
- API routes in `stock-screener-ui/api/`, DB models in `db/models.py`

## Infrastructure
- **Railway**: project `298aedcc-23a9-4ce3-9dbe-a87986f910de`, env `bc5056b2-6a82-4af3-bec2-2d1ac848fc5c`, service `b66dd871-18ac-49e7-a9fa-7addfb1be351`. Deploy via `git push` to `fix/*` or `develop` branch.
- **PostgreSQL**: on Render at `dpg-d6qh4e7kijhs73b5rvpg-a.oregon-postgres.render.com/alphashri` — migrations via Alembic in `db/migrations/`
- **Redis**: on Upstash — used for bot heartbeat (90s TTL key `bot:{bot_id}:heartbeat`). NOT on Railway.
- **Deploy**: frontend builds to Cloudflare Pages via Wrangler, backend runs on Railway as FastAPI
- **Env vars**: see `.env.example` — `DATABASE_URL`, `UPSTOX_API_KEY/SECRET`, `REDIS_URL`, `BACKEND_JWT_SECRET`, `VITE_API_BASE_URL`

## Debugging
- **Railway SSH**: `railway connect --project 298aedcc-23a9-4ce3-9dbe-a87986f910de --environment bc5056b2-6a82-4af3-bec2-2d1ac848fc5c --service b66dd871-18ac-49e7-a9fa-7addfb1be351` — shell + tunnel to services
- **Production Postgres**: use `DATABASE_URL` env var to connect — query prod DB directly
- **Redis**: Upstash console or `redis-cli -u ` after Railway connect
- **Logs**: `railway logs --project 298aedcc --environment bc5056b2 --service b66dd871` for backend stdout

## Testing
- Frontend: vitest, files co-located as `*.test.ts` / `*.test.tsx`
- Backend: pytest, files in `stock-screener-ui/tests/`
- Run both before committing

## Committing
- Never commit unless asked
- Lint + build must pass: `bun run lint && bun run build`
