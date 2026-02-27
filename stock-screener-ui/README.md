# Alphashri

A multi-user stock trading dashboard with paper trading, backtesting, and real-time market data.

## Quick Start

```bash
./start.sh
```

This starts:
- **API Server**: http://localhost:8765
- **UI Dashboard**: http://localhost:5173

## Environment Variables

### Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `REQUIRE_AUTH` | `false` | Set to `true` to require authentication for all API endpoints |

**Development Mode (default):**
```bash
REQUIRE_AUTH=false ./start.sh
# API works without login - defaults to admin user
```

**Production Mode:**
```bash
REQUIRE_AUTH=true ./start.sh
# All protected endpoints require valid JWT token
```

### Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `API_PORT` | `8765` | API server port |
| `UI_HOST` | `127.0.0.1` | UI host binding |
| `UI_PORT` | `5173` | UI server port |
| `LOG_FILE` | `/tmp/alphashri.log` | Log file path |
| `JWT_SECRET_KEY` | (random) | JWT signing key (change in production!) |

## Default Credentials

After running the migration, default admin account:
- **Email**: `admin@alphashri.dev`
- **Password**: `admin123`

⚠️ Change the password after first login!

## API Endpoints

### Authentication
- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Login, get JWT tokens
- `POST /api/auth/logout` - Logout, revoke session
- `GET /api/auth/me` - Get current user info

### Paper Trading
- `GET /api/paper/portfolio` - Portfolio status
- `GET /api/paper/positions` - Open positions
- `GET /api/paper/trades` - Trade history
- `POST /api/paper/order` - Place order
- `POST /api/paper/close` - Close position

### Journal
- `GET /api/paper/journal/summary` - Performance summary
- `GET /api/paper/journal/symbols` - Symbol performance
- `GET /api/paper/journal/daily` - Daily report

## Database

SQLite database stored at `db/alphashri.db`

User data is stored in user-scoped directories:
- Journals: `journals/{user_id}/`
- Trade logs: `trade_logs/{user_id}/`
