import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).parent.absolute()

env_file = BASE_DIR / '.env.local'
if env_file.exists():
    load_dotenv(env_file)

PORT = int(os.getenv("PORT", 8765))
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS", 
    "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173"
).split(",")
ALLOWED_ORIGINS = [origin.strip() for origin in ALLOWED_ORIGINS if origin.strip()]

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    LOCAL_DB_PATH = BASE_DIR / "db" / "alphashri.db"
    DATABASE_URL = f"sqlite:///{LOCAL_DB_PATH}"

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "alphashri-dev-secret-key-do-not-use-in-production")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24
REFRESH_TOKEN_EXPIRE_DAYS = 7

UPSTOX_API_KEY = os.getenv("UPSTOX_API_KEY") or os.getenv("UPSTOX_CLIENT_ID")
UPSTOX_API_SECRET = os.getenv("UPSTOX_API_SECRET") or os.getenv("UPSTOX_CLIENT_SECRET")
UPSTOX_ACCESS_TOKEN = os.getenv("UPSTOX_ACCESS_TOKEN")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

API_BASE_URL = os.getenv("API_BASE_URL", f"http://localhost:{PORT}")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
