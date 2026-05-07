# Production Deployment Guide

Production infrastructure, deployment, and debugging docs. See [AGENTS.md](./AGENTS.md) for dev rules.

## Known Production Issues

### `_filter_to_date_or_recent` timezone bug
- `fetch_historical_data_v3` returns data with UTC index but filtering uses `config.IST` (UTC+5:30), causing 0 rows after date filter
- Works locally because `railway run` may use different config
- **Fix**: compare `df_1m_full.index.tz` vs `config.IST` in the Docker container

## Infrastructure
- **Railway**: project `298aedcc-23a9-4ce3-9dbe-a87986f910de`, env `bc5056b2-6a82-4af3-bec2-2d1ac848fc5c`, service `b66dd871-18ac-49e7-a9fa-7addfb1be351`. Deploy via `git push` to `fix/*` or `develop` branch.
- **PostgreSQL**: on Render at `dpg-d6qh4e7kijhs73b5rvpg-a.oregon-postgres.render.com/alphashri` — migrations via Alembic in `db/migrations/`
- **Redis**: on Upstash — used for bot heartbeat (90s TTL key `bot:{bot_id}:heartbeat`). NOT on Railway.
- **Deploy**: frontend builds to Cloudflare Pages via Wrangler, backend runs on Railway as FastAPI
- **Env vars**: see `.env.example` — `DATABASE_URL`, `UPSTOX_API_KEY/SECRET`, `REDIS_URL`, `BACKEND_JWT_SECRET`, `VITE_API_BASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_ENABLED`

### Cloudflare Pages Build
- Build command: `bun install && bun run build` (Cloudflare Pages build image does **not** have `bun`; it silently falls back to `npm install`)
- **Critical**: `npm` is stricter than `bun` about peer dependency conflicts. A mismatch between `@mantine/core` and `@mantine/dates` major versions will cause the build to fail with `ERESOLVE unable to resolve dependency tree`
- **Rule**: all `@mantine/*` packages must share the same major version. If you upgrade one, upgrade all.
- Output directory: `dist`
- Root directory: `stock-screener-ui`

## Railway CLI

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