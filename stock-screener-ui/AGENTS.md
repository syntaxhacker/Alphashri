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
- **Trades endpoint** (`/api/paper/trades`): queries PostgreSQL first, falls back to journal files. The `get_trades` and `_get_trades_from_db` functions handle this.
- **Chart endpoint** (`/api/paper/chart/{symbol}`): has a known timezone mismatch bug on production — `fetch_historical_data_v3` returns data with UTC index but filtering uses `config.IST` (UTC+5:30), causing 0 rows after date filter. Works locally because `railway run` may use different config. Investigate: compare `df_1m_full.index.tz` vs `config.IST` in the Docker container.
- **Local dev data**: prod DB can be dumped to local SQLite via `python scripts/dump_prod_to_local.py`. Note: trades have `user_id=1` in prod, local user may be different — update `user_id` after dump.

## Infrastructure
- **Railway**: project `298aedcc-23a9-4ce3-9dbe-a87986f910de`, env `bc5056b2-6a82-4af3-bec2-2d1ac848fc5c`, service `b66dd871-18ac-49e7-a9fa-7addfb1be351`. Deploy via `git push` to `fix/*` or `develop` branch.
- **PostgreSQL**: on Render at `dpg-d6qh4e7kijhs73b5rvpg-a.oregon-postgres.render.com/alphashri` — migrations via Alembic in `db/migrations/`
- **Redis**: on Upstash — used for bot heartbeat (90s TTL key `bot:{bot_id}:heartbeat`). NOT on Railway.
- **Deploy**: frontend builds to Cloudflare Pages via Wrangler, backend runs on Railway as FastAPI
- **Env vars**: see `.env.example` — `DATABASE_URL`, `UPSTOX_API_KEY/SECRET`, `REDIS_URL`, `BACKEND_JWT_SECRET`, `VITE_API_BASE_URL`

## Debugging
- **Railway SSH**: `railway connect --project 298aedcc-23a9-4ce3-9dbe-a87986f910de --environment bc5056b2-6a82-4af3-bec2-2d1ac848fc5c --service b66dd871-18ac-49e7-a9fa-7addfb1be351` — shell + tunnel to services
- **Railway run**: `railway run --project=... --environment=... --service=... python3 -c "..."` — execute commands in the container (non-interactive)
- **Production Postgres**: use `DATABASE_URL` env var to connect — query prod DB directly
- **Local DB dump**: `python scripts/dump_prod_to_local.py` — copies trades+positions from prod Postgres to local SQLite. Remember to update `user_id` after dump.
- **Redis**: Upstash console or `redis-cli -u ` after Railway connect
- **Logs**: `railway logs` for backend stdout (no `--project` flag needed when configured)
- **Docker WORKDIR**: production container uses `/app/stock-screener-ui` (from Dockerfile.prod). `Path(__file__).parent.parent.parent` resolves to `/app`.

## Testing
- Frontend: vitest, files co-located as `*.test.ts` / `*.test.tsx`
- Backend: pytest, files in `stock-screener-ui/tests/`
- Run both before committing

## Committing
- Never commit unless asked
- Lint + build must pass: `bun run lint && bun run build`
