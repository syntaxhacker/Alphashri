# Alphashri - Stock Trading Dashboard

A modern, multi-user stock trading dashboard with paper trading, backtesting, real-time market data, and strategy analysis built with React, TypeScript, and FastAPI.

## Tech Stack

### Frontend
- **React 19** - UI library
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Mantine UI** - Component library
- **Redux Toolkit** - State management
- **React Router** - Navigation
- **Tabler Icons** - Icon library

### Backend
- **FastAPI** - Python web framework
- **SQLite** - Database
- **PyJWT** - Authentication
- **Pandas/NumPy** - Data processing
- **pytest** - Testing framework
- **uv** - Python package manager (optional)

### Development Tools
- **Bun** - Package manager and runtime
- **Playwright** - E2E testing
- **Vitest** - Unit testing
- **Storybook** - Component documentation
- **Oxlint/Oxfmt** - Linting and formatting

## Prerequisites

- **Node.js** >= 18 (or Bun runtime)
- **Python** >= 3.10
- **Bun** (recommended) or npm/yarn
- **uv** (recommended) or pip for Python package management

### Installing uv (Optional but Recommended)

```bash
# macOS/Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Or using pip
pip install uv

# Verify installation
uv --version
```

## Quick Start

### 1. Install Dependencies

```bash
# Install frontend dependencies
bun install

# Install backend dependencies (choose one)
# Option 1: Using uv (recommended)
uv pip install -r requirements.txt

# Option 2: Using pip
pip install -r requirements.txt
```

### 2. Environment Setup

Create a `.env` file in the root directory:

```bash
# Optional: OpenRouter API key for LLM features
OPENROUTER_API_KEY=your_api_key_here
```

### 3. Start the Application

The easiest way to start both API and UI servers:

```bash
./start.sh
```

This will start:
- **API Server**: http://localhost:8765
- **UI Dashboard**: http://localhost:5173

Logs are written to `/tmp/alphashri.log`. Tail them with:
```bash
tail -f /tmp/alphashri.log
```

### 4. Alternative: Start Services Individually

```bash
# Terminal 1: Start API server
uvicorn api_server_fastapi:app --host 127.0.0.1 --port 8765 --reload

# Terminal 2: Start UI dev server
bun run dev
```

## Available Scripts

### Development
```bash
bun run dev              # Start Vite dev server
bun run build            # Build for production
bun run preview          # Preview production build
```

### Testing

#### Frontend Tests (Playwright & Vitest)
```bash
bun run test             # Run Playwright E2E tests
bun run test:ui          # Run tests with UI
bun run test:headed      # Run tests in headed mode
bun run test:report      # Show test report
```

#### Backend Tests (pytest)
```bash
# Using uv (recommended)
uv run pytest                    # Run all tests
uv run pytest -v                 # Verbose output
uv run pytest tests/             # Run specific test directory
uv run pytest -k "test_name"     # Run tests matching pattern
uv run pytest --cov              # Run with coverage

# Using pip
pytest                           # Run all tests
pytest -v                        # Verbose output
pytest tests/                    # Run specific test directory
```

### Code Quality
```bash
bun run lint             # Run Oxlint
bun run lint:fix         # Fix linting issues
bun run format           # Format code with Oxfmt
bun run format:check     # Check formatting
bun run check:duplicates # Check for code duplication
bun run check:unused     # Check for unused code
bun run check:deps       # Check for unused dependencies
bun run check:all        # Run all checks
```

### Storybook
```bash
bun run storybook         # Start Storybook dev server (port 6006)
bun run build-storybook   # Build Storybook static files
```

## Project Structure

```
stock-screener-ui/
├── src/
│   ├── api/              # API client and services
│   ├── components/       # React components
│   │   ├── auth/         # Authentication components
│   │   ├── backtest/     # Backtesting UI
│   │   ├── bots/         # Trading bot components
│   │   ├── chart/        # Chart components
│   │   ├── layout/       # Layout components
│   │   ├── options/      # Options trading
│   │   ├── paper-trading/# Paper trading UI
│   │   ├── screener/     # Stock screener
│   │   ├── strategies/   # Strategy management
│   │   └── ...
│   ├── hooks/            # Custom React hooks
│   ├── store/            # Redux store
│   ├── state/            # State management
│   ├── types/            # TypeScript types
│   ├── utils/            # Utility functions
│   ├── theme/            # Mantine theme config
│   └── App.tsx           # Main app component
├── api/                  # Backend API modules
├── db/                   # SQLite database
├── tests/                # Test files
├── .storybook/           # Storybook configuration
├── public/               # Static assets
└── dist/                 # Production build output
```

## Features

### Paper Trading
- Virtual trading with real market data
- Track positions, orders, and trade history
- Performance analytics and journaling

### Backtesting
- Test trading strategies against historical data
- Visualize strategy performance
- Compare multiple strategies

### Stock Screener
- Filter stocks by various criteria
- Custom screening strategies
- Real-time data updates

### Strategy Management
- Create and manage trading strategies
- Strategy variations and testing
- Performance tracking

### Journal & Analytics
- Daily trading journal
- Symbol performance analysis
- Performance summary reports

## Authentication

### Development Mode (Default)
```bash
REQUIRE_AUTH=false ./start.sh
```
API works without login, defaults to admin user.

### Production Mode
```bash
REQUIRE_AUTH=true ./start.sh
```
All protected endpoints require valid JWT token.

### Default Credentials
After migration:
- **Email**: `admin@alphashri.dev`
- **Password**: `admin123`

⚠️ **Change the password after first login!**

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REQUIRE_AUTH` | `false` | Require authentication for API |
| `API_PORT` | `8765` | API server port |
| `UI_HOST` | `127.0.0.1` | UI host binding |
| `UI_PORT` | `5173` | UI server port |
| `LOG_FILE` | `/tmp/alphashri.log` | Log file path |
| `JWT_SECRET_KEY` | (random) | JWT signing key (change in production!) |
| `OPENROUTER_API_KEY` | - | API key for LLM features |

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

## Development Workflow

1. **Start development**: `./start.sh`
2. **Make changes** to the code (hot reload enabled)
3. **Run frontend tests**: `bun run test`
4. **Run backend tests**: `uv run pytest` or `pytest`
5. **Check code quality**: `bun run check:all`
6. **View components**: `bun run storybook`
7. **Build for production**: `bun run build`

## Contributing

1. Create a feature branch
2. Make your changes
3. Run tests and linting: `bun run check:all`
4. Submit a pull request

## Architecture Notes

- **Frontend-Backend Separation**: The UI is completely separate from the Python backend, communicating via REST API
- **User Isolation**: Each user has isolated data directories for journals and trade logs
- **Authentication**: JWT-based auth with optional requirement (disabled by default for development)
- **State Management**: Redux Toolkit for global state, React hooks for local state
- **Component Library**: Mantine UI provides consistent design system
- **Testing Strategy**: Playwright for E2E, Vitest for unit tests, Storybook for component testing

## Troubleshooting

### Port already in use
```bash
# The start.sh script handles this automatically
# Or manually kill processes:
lsof -ti:8765 | xargs kill -9  # API port
lsof -ti:5173 | xargs kill -9  # UI port
```

### Database issues
```bash
# Reset database (WARNING: deletes all data)
rm db/alphashri.db
# Restart the app to recreate
./start.sh
```

### Dependency issues
```bash
# Frontend: Clean install
rm -rf node_modules bun.lockb
bun install

# Backend: Using uv (recommended)
uv pip install -r requirements.txt --upgrade
uv pip install -r requirements.txt --reinstall

# Backend: Using pip
pip install -r requirements.txt --upgrade
pip install -r requirements.txt --force-reinstall
```

## License

Private project - All rights reserved

## Support

For issues and feature requests, please check the existing documentation in:
- `TODO.md` - Known issues and planned features
- `TESTING_ROADMAP.md` - Testing strategy
- `BACKTEST_PLAN.md` - Backtesting implementation details
