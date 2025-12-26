# Upstox Token Management - Usage Guide

## Overview

The Upstox authentication system now uses a **centralized token file** stored in the project root. This means:

✅ **No more multiple browser authentications**
✅ **Token is reused across all scripts**
✅ **Token is valid for 24 hours**
✅ **Stored in project root: `.upstox_token.json`**

## Quick Start

### Basic Usage (Recommended)

```python
from upstox_trader.config_and_utils.upstox_auth import create_upstox_auth
from upstox_trader.config import UPSTOX_CONFIG

# Create auth handler - automatically loads cached token
auth = create_upstox_auth(
    api_key=UPSTOX_CONFIG['api_key'],
    api_secret=UPSTOX_CONFIG['api_secret']
)

# If no token exists, authenticate once
if not auth.access_token:
    auth.authenticate()  # Opens browser ONLY if needed

# Use the token for API calls
headers = auth.get_headers()
```

### Auto-Authenticate (For Scripts)

```python
from upstox_trader.config_and_utils.upstox_auth import get_authenticated_upstox
from upstox_trader.config import UPSTOX_CONFIG

# Automatically ensures you have a token (may open browser if needed)
auth = get_authenticated_upstox(
    api_key=UPSTOX_CONFIG['api_key'],
    api_secret=UPSTOX_CONFIG['api_secret']
)

# Ready to use immediately
headers = auth.get_headers()
```

## Token Lifecycle

### 1. First Time Setup

When you run any script for the first time:

```bash
python your_script.py
```

**What happens:**
1. No `.upstox_token.json` file exists
2. Browser opens for Upstox login
3. You authenticate in browser
4. Token is saved to `.upstox_token.json`
5. Script continues with valid token

### 2. Subsequent Runs

For the next 24 hours, all scripts will:

```bash
python script1.py  # Uses cached token, no browser
python script2.py  # Uses cached token, no browser
python script3.py  # Uses cached token, no browser
```

**What happens:**
1. Script loads token from `.upstox_token.json`
2. Token age is checked (must be <23 hours)
3. Token is used immediately
4. **No browser authentication needed!**

### 3. Token Expiry (After 24 Hours)

When token expires:

```bash
python your_script.py
# Token expired, browser opens for re-authentication
```

**What happens:**
1. Script detects token is >23 hours old
2. Browser opens for fresh authentication
3. New token is saved
4. Script continues with new token

## Token Storage

### Location

```
/Users/developer/Documents/algos/personal/earner/.upstox_token.json
```

### Format

```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJr...",
  "timestamp": "2025-01-15T10:30:00.123456"
}
```

### Security

- ✅ Already in `.gitignore` (won't be committed)
- ✅ Only readable by your user account
- ⚠️ Contains sensitive token - don't share!

## API Usage Patterns

### Pattern 1: Simple Scripts

```python
from upstox_trader.config_and_utils.upstox_auth import create_upstox_auth
from upstox_trader.config import UPSTOX_CONFIG
import requests

# Load token (no validation)
auth = create_upstox_auth(
    UPSTOX_CONFIG['api_key'],
    UPSTOX_CONFIG['api_secret']
)

# Ensure we have a token
if not auth.access_token:
    auth.authenticate()

# Make API calls
url = "https://api.upstox.com/v2/market-quote/ltp?symbol=NSE_EQ:HDFCBANK"
response = requests.get(url, headers=auth.get_headers())
```

### Pattern 2: Long-Running Services

```python
from upstox_trader.config_and_utils.upstox_auth import create_upstox_auth
from upstox_trader.config import UPSTOX_CONFIG

class TradingBot:
    def __init__(self):
        self.auth = create_upstox_auth(
            UPSTOX_CONFIG['api_key'],
            UPSTOX_CONFIG['api_secret']
        )

        if not self.auth.access_token:
            self.auth.authenticate()

    def fetch_prices(self):
        headers = self.auth.get_headers()
        # Make API calls...

    def handle_auth_error(self):
        """Call this if you get 401 Unauthorized"""
        print("Token expired, re-authenticating...")
        self.auth.refresh_token()

# Usage
bot = TradingBot()
bot.fetch_prices()
```

### Pattern 3: Multiple Concurrent Scripts

```python
# script1.py
auth = create_upstox_auth(api_key, api_secret)
# Uses shared .upstox_token.json

# script2.py (running simultaneously)
auth = create_upstox_auth(api_key, api_secret)
# Uses SAME .upstox_token.json - no conflict!
```

## Validation Options

### Skip Validation (Fast - Recommended)

```python
# Just loads token, no API call to validate
auth = create_upstox_auth(api_key, api_secret)
# Takes ~0.001s
```

### With Validation (Slow - Use Sparingly)

```python
# Loads token AND validates with API call
auth = create_upstox_auth(api_key, api_secret, validate=True)
# Takes ~0.5s (makes HTTP request)
```

**When to validate:**
- ✅ At start of long-running service
- ✅ After getting 401 Unauthorized error
- ❌ In every script (wasteful)
- ❌ In loops (very wasteful)

## Troubleshooting

### Browser Keeps Opening

**Problem:** Browser opens on every script run

**Solution:**
```bash
# Check token file exists
ls -la .upstox_token.json

# Check token age
python -c "
import json
from datetime import datetime
with open('.upstox_token.json') as f:
    data = json.load(f)
    ts = datetime.fromisoformat(data['timestamp'])
    age = (datetime.now() - ts).total_seconds() / 3600
    print(f'Token age: {age:.1f} hours')
"
```

If token is >23 hours old, re-authentication is expected.

### 401 Unauthorized Error

**Problem:** API returns 401 even with cached token

**Solution:**
```python
# Force refresh token
if response.status_code == 401:
    auth.refresh_token()
    # Retry your API call
```

### Token File Not Found

**Problem:** `.upstox_token.json` not in project root

**Solution:**
```python
from upstox_trader.config_and_utils.upstox_auth import TOKEN_FILE
print(f"Token should be at: {TOKEN_FILE}")

# If it's in the wrong place, just authenticate again
auth.authenticate()
```

## Migration from Old System

If you were using the old home directory token:

```bash
# Old location (deprecated)
~/.upstox_token.json

# New location (current)
/path/to/project/.upstox_token.json
```

**Migration steps:**
1. Delete old token: `rm ~/.upstox_token.json`
2. Run any script
3. Authenticate once
4. Token is now in project root

## Best Practices

### ✅ DO

- Store token in project root (automatic)
- Reuse token across scripts
- Handle 401 errors gracefully
- Check token age before long operations

### ❌ DON'T

- Don't commit `.upstox_token.json` to git (already ignored)
- Don't validate token on every script run
- Don't create multiple auth instances unnecessarily
- Don't share your token file

## Example: Complete Trading Bot

```python
#!/usr/bin/env python3
"""
Example: Trading bot with proper token management
"""

from upstox_trader.config_and_utils.upstox_auth import create_upstox_auth
from upstox_trader.config import UPSTOX_CONFIG
import requests
import time


class PriceMonitor:
    def __init__(self):
        # Load cached token (no API call)
        self.auth = create_upstox_auth(
            UPSTOX_CONFIG['api_key'],
            UPSTOX_CONFIG['api_secret']
        )

        # Ensure we have a token
        if not self.auth.access_token:
            print("First time setup - authenticating...")
            self.auth.authenticate()

        print(f"✅ Ready! Token age: {self._get_token_age():.1f}h")

    def _get_token_age(self):
        """Get token age in hours"""
        import json
        from datetime import datetime
        with open('.upstox_token.json') as f:
            data = json.load(f)
            ts = datetime.fromisoformat(data['timestamp'])
            return (datetime.now() - ts).total_seconds() / 3600

    def fetch_prices(self, symbols):
        """Fetch live prices with error handling"""
        url = f"https://api.upstox.com/v2/market-quote/ltp?symbol={','.join(symbols)}"

        try:
            response = requests.get(url, headers=self.auth.get_headers(), timeout=10)

            if response.status_code == 200:
                return response.json()['data']
            elif response.status_code == 401:
                # Token expired, refresh and retry
                print("Token expired, refreshing...")
                self.auth.refresh_token()
                return self.fetch_prices(symbols)  # Retry
            else:
                print(f"API Error: {response.status_code}")
                return None

        except Exception as e:
            print(f"Error: {e}")
            return None

    def run(self):
        """Main monitoring loop"""
        symbols = ["NSE_EQ:HDFCBANK", "NSE_EQ:TCS", "NSE_EQ:RELIANCE"]

        while True:
            prices = self.fetch_prices(symbols)
            if prices:
                for symbol, data in prices.items():
                    print(f"{symbol}: ₹{data['last_price']}")

            time.sleep(5)  # Poll every 5 seconds


if __name__ == "__main__":
    monitor = PriceMonitor()
    monitor.run()
```

## Summary

**Key Points:**

1. **Token is stored in project root** (`.upstox_token.json`)
2. **Valid for 24 hours** - authenticate once per day
3. **Shared across all scripts** - no multiple auth needed
4. **Automatically loaded** - just create auth handler
5. **Handles expiry gracefully** - refresh when needed

**Result:** No more browser popping up on every script run! 🎉
