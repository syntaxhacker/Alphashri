import os
import fnmatch
from pathlib import Path
from dotenv import load_dotenv

# Base directory
BASE_DIR = Path(__file__).parent.absolute()

# Load environment variables from .env.local if it exists
env_file = BASE_DIR / '.env.local'
if env_file.exists():
    load_dotenv(env_file)

# --- Server Config ---
PORT = int(os.getenv("PORT", 8765))
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "https://alphashri.pages.dev"
).split(",")
ALLOWED_ORIGINS = [origin.strip() for origin in ALLOWED_ORIGINS if origin.strip()]
ALLOWED_ORIGIN_PATTERNS = os.getenv(
    "ALLOWED_ORIGIN_PATTERNS",
    "https://*.alphashri.pages.dev,http://localhost:*,http://127.0.0.1:*,http://192.168.*.*:*"
).split(",")
ALLOWED_ORIGIN_PATTERNS = [p.strip() for p in ALLOWED_ORIGIN_PATTERNS if p.strip()]


def is_origin_allowed(origin: str) -> bool:
    if origin in ALLOWED_ORIGINS:
        return True
    for pattern in ALLOWED_ORIGIN_PATTERNS:
        if fnmatch.fnmatch(origin, pattern):
            return True
    return False

# --- Database Config ---
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    LOCAL_DB_PATH = BASE_DIR / "db" / "alphashri.db"
    DATABASE_URL = f"sqlite:///{LOCAL_DB_PATH}"

# Fix Render/Heroku postgres:// prefix
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# --- Security ---
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "alphashri-dev-secret-key-do-not-use-in-production")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours
REFRESH_TOKEN_EXPIRE_DAYS = 7

# --- External APIs ---
UPSTOX_API_KEY = os.getenv("UPSTOX_API_KEY") or os.getenv("UPSTOX_CLIENT_ID")
UPSTOX_API_SECRET = os.getenv("UPSTOX_API_SECRET") or os.getenv("UPSTOX_CLIENT_SECRET")
UPSTOX_ACCESS_TOKEN = os.getenv("UPSTOX_ACCESS_TOKEN")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

# --- Application URLs ---
API_BASE_URL = os.getenv("API_BASE_URL", f"http://localhost:{PORT}")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

# --- Redis Cache ---
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
