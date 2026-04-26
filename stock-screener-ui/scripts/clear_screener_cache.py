from cache.redis_client import invalidate_screener_cache
import os

print("Clearing screener cache...")
count = invalidate_screener_cache()
print(f"Cleared {count} keys from screener cache.")
