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

### Railway CLI
Railway CLI must be linked to the project first. After linking, project/env/service flags are optional.
- **Link**: `railway link` (interactive, saves config to `.railway/config.json`)
- **Check linked project**: `railway status`

### Running commands on production
- **Single command** (non-interactive, best for quick checks):
  ```
  railway run --project=298aedcc-23a9-4ce3-9dbe-a87986f910de \
    --environment=bc5056b2-6a82-4af3-bec2-2d1ac848fc5c \
    --service=b66dd871-18ac-49e7-a9fa-7addfb1be351 \
    python3 -c "print('hello')"
  ```
- **Bash scripts**: use `railway run ... bash -c "command1 && command2"`
- **Working directory in container**: `/app/stock-screener-ui` (Docker WORKDIR). `Path(__file__).parent.parent.parent` = `/app`.
- **Limitation**: cannot use `railway ssh` through this terminal (requires interactive TTY). Use `railway run` instead.

### Common Railway run patterns
```bash
# Test Upstox API on prod
railway run --project=298aedcc ... --service=b66dd871 python3 -c "
from config import UPSTOX_API_KEY
from upstox_trader.config_and_utils.free_indian_apis import UpstoxAPI
api = UpstoxAPI(api_key=UPSTOX_API_KEY, api_secret=UPSTOX_API_SECRET, quiet=True)
df = api.fetch_historical_data_v3(symbol='TCS', unit='minutes', interval=1, to_date='2026-04-02', from_date='2026-03-31')
print(df.shape if df is not None else None)
"

# Check env vars
railway run --project=298aedcc ... --service=b66dd871 python3 -c "import config; print(config.IST, bool(config.UPSTOX_API_KEY))"

# Check deployed code version
railway run --project=298aedcc ... --service=b66dd871 python3 -c "
import inspect, os; os.chdir('stock-screener-ui')
from api.paper_trading import get_paper_chart
print('pd.Timestamp' in inspect.getsource(get_paper_chart))
"
```

### Production Postgres
- Connect via `DATABASE_URL` env var (never hardcode credentials — GitGuardian scans commits)
- Dump prod to local: `python scripts/dump_prod_to_local.py` — copies trades+positions. **Important**: prod uses `user_id=1`, local user may differ — update after dump:
  ```bash
  sqlite3 stock-screener-ui/db/alphashri.db "UPDATE trades SET user_id=<local_id>; UPDATE positions SET user_id=<local_id>;"
  ```

### Logs
- `railway logs` — streams recent logs (works without flags when linked)
- `railway logs 2>&1 | grep "keyword"` — filter for specific errors
- Logs stream in real-time; hit the endpoint in another terminal, then check logs for output

### Redis
- Upstash console for GUI access
- `redis-cli -u <UPSTOX_REDIS_URL>` after Railway connect for CLI

## Testing
- Frontend: vitest, files co-located as `*.test.ts` / `*.test.tsx`
- Backend: pytest, files in `stock-screener-ui/tests/`
- Run both before committing

## Committing
- Never commit unless asked
- Lint + build must pass: `bun run lint && bun run build`

## Post-Push Verification
After every push, verify the deployment pipeline end-to-end:

### Step 1: Check GitHub Actions (60s)
```bash
# Wait for CI to start and check results
sleep 60 && gh pr checks <PR_NUMBER>
```
- If any check fails, view logs: `gh run view --log-failed`
- Common failures: E2E smoke tests (missing `data-testid`), GitGuardian (hardcoded secrets), lint errors
- Fix issues, commit, and push again — repeat until all checks pass

### Step 2: Wait for Railway Deployment (60s)
```bash
# Poll until Railway check appears
while ! gh pr checks <PR_NUMBER> 2>&1 | grep -q "intuitive-tenderness"; do sleep 10; done
# Wait for deploy to complete
while gh pr checks <PR_NUMBER> 2>&1 | grep "intuitive-tenderness" | grep -q "pending\|deploying"; do sleep 10; done
```
Or just wait ~90s total after push.

### Step 3: Verify
- **If backend changed** (Python files, API routes, DB models): curl the affected endpoint to confirm it works on production
- **If only frontend changed** (TSX, CSS, state): no curl needed — Cloudflare Pages deploys separately
- **If both changed**: verify both

```bash
# Example: backend change verification
curl -s 'https://earner-production.up.railway.app/api/paper/trades?limit=5' \
  -H 'Authorization: Bearer <token>' | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'trades: {len(d.get(\"trades\",[]))}')"
```

✅ **Deployment done** when Railway check shows "pass" and (if backend changed) curl returns expected data.
