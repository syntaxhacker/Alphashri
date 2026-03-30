import os

UPSTOX_CONFIG = {
    "api_key": os.getenv("UPSTOX_API_KEY") or os.getenv("UPSTOX_CLIENT_ID", ""),
    "api_secret": os.getenv("UPSTOX_API_SECRET") or os.getenv("UPSTOX_CLIENT_SECRET", ""),
    "access_token": os.getenv("UPSTOX_ACCESS_TOKEN", ""),
}

TELEGRAM_CONFIG = {
    "bot_token": os.getenv("TELEGRAM_BOT_TOKEN", ""),
    "chat_id": os.getenv("TELEGRAM_CHAT_ID", ""),
}
