import os
import fnmatch
from pathlib import Path
from dotenv import load_dotenv

# Base directory
BASE_DIR = Path(__file__).parent.absolute()

# Load environment variables from .env.local if it exists
for env_name in ['.env.local', '.env.dev', '.env']:
    env_file = BASE_DIR / env_name
    if env_file.exists():
        load_dotenv(env_file, override=False)

# Settings whose values are identical in both config.py files are re-exported
# from the root module at the bottom of this file. The import is deliberately
# last so the root module's own .env.local load cannot pre-populate env vars
# read by the divergent settings below.

# --- Server Config ---
# DIVERGES from root config.py: this app defaults to the local Vite dev origin;
# the root default is the deployed Cloudflare Pages origin.
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5173"
).split(",")
ALLOWED_ORIGINS = [origin.strip() for origin in ALLOWED_ORIGINS if origin.strip()]
# DIVERGES from root config.py: adds 192.168.*.*:* for LAN access and drops the
# deployed *.alphashri.pages.dev pattern; the root list is the opposite set.
ALLOWED_ORIGIN_PATTERNS = os.getenv(
    "ALLOWED_ORIGIN_PATTERNS",
    "http://localhost:*,http://127.0.0.1:*,http://192.168.*.*:*"
).split(",")
ALLOWED_ORIGIN_PATTERNS = [p.strip() for p in ALLOWED_ORIGIN_PATTERNS if p.strip()]


# DIVERGES from root config.py: this function is byte-identical but consumes the
# two divergent lists above, so it cannot be shared until CORS is unified.
def is_origin_allowed(origin: str) -> bool:
    if origin in ALLOWED_ORIGINS:
        return True
    for pattern in ALLOWED_ORIGIN_PATTERNS:
        if fnmatch.fnmatch(origin, pattern):
            return True
    return False

# --- Database Config ---
# DIVERGES from root config.py: a relative sqlite:///./ path is resolved against
# BASE_DIR (this directory), so the DB works regardless of CWD; root skips that.
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    LOCAL_DB_PATH = BASE_DIR / "db" / "alphashri.db"
    DATABASE_URL = f"sqlite:///{LOCAL_DB_PATH}"
else:
    # Resolve relative paths to absolute so DB works regardless of CWD
    if DATABASE_URL.startswith("sqlite:///./"):
        rel_path = DATABASE_URL[len("sqlite:///."):]
        abs_path = BASE_DIR / rel_path.lstrip("/")
        DATABASE_URL = f"sqlite:///{abs_path}"

# Fix Render/Heroku postgres:// prefix
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# --- External APIs ---
# UPSTOX_* are kept local (not re-exported) because UPSTOX_CONFIG below is
# divergent and must keep using UI-local values consistently.
UPSTOX_API_KEY = os.getenv("UPSTOX_API_KEY") or os.getenv("UPSTOX_CLIENT_ID")
UPSTOX_API_SECRET = os.getenv("UPSTOX_API_SECRET") or os.getenv("UPSTOX_CLIENT_SECRET")
UPSTOX_ACCESS_TOKEN = os.getenv("UPSTOX_ACCESS_TOKEN")
# DIVERGES from root config.py: adds access_token, *_primary, username and
# password keys used by the UI's broker flows; root has only api_key/api_secret.
UPSTOX_CONFIG = {
    "api_key": UPSTOX_API_KEY or "",
    "api_secret": UPSTOX_API_SECRET or "",
    "access_token": UPSTOX_ACCESS_TOKEN or "",
    "api_key_primary": os.getenv("UPSTOX_API_KEY_PRIMARY", UPSTOX_API_KEY or ""),
    "api_secret_primary": os.getenv("UPSTOX_API_SECRET_PRIMARY", UPSTOX_API_SECRET or ""),
    "username": os.getenv("UPSTOX_USERNAME", ""),
    "password": os.getenv("UPSTOX_PASSWORD", ""),
}

# --- Fyers (API v3) ---
FYERS_CLIENT_ID = os.getenv("FYERS_CLIENT_ID") or os.getenv("FYERS_APP_ID")
FYERS_SECRET_ID = os.getenv("FYERS_SECRET_ID") or os.getenv("FYERS_SECRET_KEY")
FYERS_ACCESS_TOKEN = os.getenv("FYERS_ACCESS_TOKEN")
FYERS_CONFIG = {
    "client_id": FYERS_CLIENT_ID or "",
    "secret_id": FYERS_SECRET_ID or "",
}

# --- Single-source re-exports (value-equal settings) ---
# `import config` from this directory resolves to this file, so `from config import X`
# would self-import. Load the root module by explicit path under a distinct name.
import importlib.util as _importlib_util
import sys as _sys

_ROOT_CONFIG_PATH = BASE_DIR.parent / "config.py"
_spec = _importlib_util.spec_from_file_location("_alphashri_root_config", _ROOT_CONFIG_PATH)
_root_config = _importlib_util.module_from_spec(_spec)
_sys.modules[_spec.name] = _root_config
_spec.loader.exec_module(_root_config)

IST = _root_config.IST
PORT = _root_config.PORT
JWT_SECRET_KEY = _root_config.JWT_SECRET_KEY
JWT_ALGORITHM = _root_config.JWT_ALGORITHM
ACCESS_TOKEN_EXPIRE_MINUTES = _root_config.ACCESS_TOKEN_EXPIRE_MINUTES
REFRESH_TOKEN_EXPIRE_DAYS = _root_config.REFRESH_TOKEN_EXPIRE_DAYS
OPENROUTER_API_KEY = _root_config.OPENROUTER_API_KEY
API_BASE_URL = _root_config.API_BASE_URL
FRONTEND_URL = _root_config.FRONTEND_URL
REDIS_URL = _root_config.REDIS_URL
TELEGRAM_CONFIG = _root_config.TELEGRAM_CONFIG
