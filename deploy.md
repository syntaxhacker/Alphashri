# Free Hosting & CI/CD Plan for Alphashri Trading Application

## Context

The Alphashri stock trading application needs to be deployed for free with a proper CI/CD pipeline. Currently running locally with:
- **Frontend**: React 19 + TypeScript + Vite + Mantine UI
- **Backend**: FastAPI (Python) on port 8765 with WebSocket support for real-time news
- **Database**: SQLite with SQLAlchemy ORM
- **External APIs**: Upstox broker API integration
- **Features**: Stock screening, backtesting, paper trading, options analysis

**Current State Issues:**
- No containerization (Docker)
- No CI/CD pipelines
- SQLite won't persist on ephemeral hosting filesystems
- No production environment configuration
- WebSocket requirement limits hosting options

---

## Selected Architecture

### Hosting Stack (~$0.25/month)

| Component | Platform | Cost | URL |
|-----------|----------|------|-----|
| Frontend | **Vercel** | Free | `your-app.vercel.app` |
| Backend | **Render** | Free | `your-app.onrender.com` |
| Database | **SQLite + Render Disk** | $0.25/mo | Persistent 1GB disk |

### CI/CD Pipeline

- **Tests on every PR**: Linting + backend tests (pytest) + frontend build
- **Auto-deploy on main**: Deploys to Vercel + triggers Render rebuild
- **Branch protection**: Require tests to pass before merging

---

## Implementation Plan

### Phase 1: Containerization & Config (2-3 hours)

#### 1.1 Create Dockerfile
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8765
CMD ["uvicorn", "api_server_fastapi:app", "--host", "0.0.0.0", "--port", "8765"]
```

#### 1.2 Create .dockerignore
```
node_modules
dist
.git
.env*
*.log
__pycache__
.pytest_cache
playwright-report
```

#### 1.3 Update Database Path Configuration
**File**: `db/database.py`
- Use environment variable `DATABASE_PATH` for production
- Default to local path for development

#### 1.4 Update CORS for Production
**File**: `api_server_fastapi.py`
- Read `ALLOWED_ORIGINS` from environment variable
- Whitelist Vercel frontend URL in production

#### 1.5 Create Environment Config
**New file**: `config.py`
- Centralize all environment variable handling
- Database URL, JWT secret, CORS origins, auth settings

### Phase 2: Deploy to Hosting Platforms (1-2 hours)

#### 2.1 Deploy Frontend to Vercel
1. Connect GitHub repo to Vercel
2. Configure build settings:
   - Build Command: `bun run build`
   - Output Directory: `dist`
3. Set environment variable: `VITE_API_URL` (after backend deployed)

#### 2.2 Deploy Backend to Render
1. Create Web Service on Render
2. Connect GitHub repo
3. Configure:
   - Environment: Docker
   - Add persistent disk (1GB) at `/opt/render/project/data`
4. Set environment variables:
   - `DATABASE_PATH=/opt/render/project/data/alphashri.db`
   - `ALLOWED_ORIGINS=https://your-app.vercel.app`
   - `JWT_SECRET_KEY=<random-secret>`
   - `REQUIRE_AUTH=true`
   - Upstox API credentials

#### 2.3 Connect Services
- Update Vercel env var with Render backend URL
- Verify CORS allows frontend domain

### Phase 3: CI/CD Pipeline (2-3 hours)

#### 3.1 Create GitHub Secrets
- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- `RENDER_DEPLOY_HOOK`
- `JWT_SECRET_KEY`
- `UPSTOX_API_KEY`, `UPSTOX_API_SECRET`

#### 3.2 Create Test Workflow
**File**: `.github/workflows/test.yml`
- Runs on: push, pull_request
- Steps:
  1. Setup Bun + Python 3.11
  2. Install dependencies
  3. Run linting (oxlint)
  4. Run backend tests (pytest)
  5. Build frontend (verify no build errors)

#### 3.3 Create Deploy Workflow
**File**: `.github/workflows/deploy.yml`
- Runs on: push to main branch
- Depends on: test workflow passing
- Steps:
  1. Deploy frontend to Vercel (production)
  2. Trigger Render deploy hook for backend

#### 3.4 Configure Branch Protection
- Require tests to pass before merging to main
- Require PR reviews (optional)

---

## Critical Files to Modify/Create

| File | Action | Purpose |
|------|--------|---------|
| `Dockerfile` | Create | Containerize backend for Render |
| `.dockerignore` | Create | Optimize Docker build |
| `db/database.py` | Edit | Support configurable database path |
| `api_server_fastapi.py` | Edit | Production CORS configuration |
| `config.py` | Create | Centralized environment config |
| `.github/workflows/test.yml` | Create | CI test pipeline |
| `.github/workflows/deploy.yml` | Create | CD deployment pipeline |

---

## Verification Plan

### Local Testing
```bash
# Test Docker build
docker build -t alphashri-api .
docker run -p 8765:8765 -e DATABASE_PATH=/app/db/alphashri.db alphashri-api

# Verify API responds
curl http://localhost:8765/api/screener
```

### Post-Deployment Testing
1. **Frontend**: Load https://your-app.vercel.app
2. **Backend**: `curl https://your-api.onrender.com/api/screener`
3. **WebSocket**: Connect to news feed
4. **Database**: Create data, redeploy, verify persistence
5. **CI/CD**: Open PR, verify tests run and pass

### Monitoring (Free)
- Vercel Analytics (built-in)
- Render Metrics (built-in)
- UptimeRobot for uptime monitoring

---

## Cost Breakdown

| Option | Frontend | Backend | Database | Total |
|--------|----------|---------|----------|-------|
| **Truly Free** | Vercel ($0) | Render Free ($0) | Render Disk ($0.25) | **$0.25/mo** |
| Better Performance | Vercel ($0) | Railway ($5) | Included | **$5/mo** |

### Free Tier Limits
- **Vercel**: 100GB bandwidth, 100 builds/day
- **Render Free**: 750 hrs/mo, 512MB RAM, sleeps after 15 min inactivity
- **Render Disk**: $0.25/GB/month

---

## Security Checklist

- [ ] Set strong `JWT_SECRET_KEY` (32+ random chars)
- [ ] Configure `REQUIRE_AUTH=true` in production
- [ ] Whitelist only frontend domain in CORS
- [ ] Never commit `.env` files
- [ ] Use GitHub Secrets for sensitive values
- [ ] Enable HTTPS (automatic on Vercel/Render)

---

## Known Limitations (Render Free Tier)

- **Cold starts**: 15-30 second delay after 15 min inactivity
- **RAM**: 512MB limit
- **Bandwidth**: 100GB/month
- **No background workers**: Backtesting runs synchronously

If you outgrow these limits, upgrade to Render Standard ($7/mo) or Railway ($5/mo).
