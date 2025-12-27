# INDMONEY Token Expiration Handling

## 📊 Key Information

**Token Validity:** **24 hours**
- Tokens expire within 24 hours of generation
- No automatic refresh mechanism available
- Must be manually regenerated from INDMoney platform

**Get New Token:** https://www.indstocks.com/app/api-trading

## 🔧 Implementation Details

### 1. Token Expiration Detection

The `INDMONEYApi` class now tracks token age:

```python
class INDMONEYApi(BaseAPIClient):
    TOKEN_FILE = Path(__file__).parent / "indmoney_token.json"
    _token_expiry_hours = 24

    def _is_token_expired(self) -> bool:
        """Check if token has expired (24-hour validity)"""
        token_age = datetime.now() - self._token_timestamp
        return token_age.total_seconds() > (24 * 3600)
```

### 2. Pre-Flight Token Validation

Token is checked **before every API call**:

```python
def _get_headers(self) -> Dict[str, str]:
    # Check for token expiration
    if self._is_token_expired():
        raise ValueError(
            "INDMoney access token has expired (24-hour validity). "
            "Please generate a new token from https://www.indstocks.com/app/api-trading"
        )

    # Warn if token is close to expiration (>20 hours)
    if token_age > 20:
        self._log(f"⚠️  INDMoney token is {token_age:.1f} hours old (expires in 24h)")
```

### 3. API Response Error Handling

**401 Unauthorized:**
```python
if response.status_code == 401:
    self._log_error("❌ INDMoney authentication failed (401)")
    self._log_error(f"🔑 Your token may have expired or is invalid")
    self._log_error(f"⏰ Token age: {self._get_token_age_hours():.1f} hours")
    raise ValueError("Please generate a new token from...")
```

**403 Forbidden:**
```python
elif response.status_code == 403:
    self._log_error("❌ INDMoney access forbidden (403)")
    self._log_error("🌐 Your IP may not be whitelisted")
    raise ValueError("Please whitelist your IP at...")
```

## 🚨 Error Scenarios Handled

| Error Code | Meaning | Solution |
|------------|---------|----------|
| **401** | Token expired/invalid | Regenerate token from INDMoney platform |
| **403** | IP not whitelisted | Configure static IP in INDMoney settings |
| **Pre-check** | Token >24h old | Automatic blocking before API call |

## 📝 How to Refresh Token

### Step 1: Generate New Token
1. Visit https://www.indstocks.com/app/api-trading
2. Login with OTP
3. Click **"New Token"**
4. Copy the generated token

### Step 2: Configure Static IP (First Time Only)
- Click the **hexagon icon** (⬡) next to "New Token"
- Enable and assign your **static IP**
- Save configuration

### Step 3: Update Config
```bash
# Edit upstox_trader/config.py
INDMONEY_CONFIG = {
    'access_token': 'YOUR_NEW_TOKEN_HERE'
}
```

## 🔍 Features

### Automatic Token Age Tracking
- Tracks when token was created
- Caches token metadata to disk
- Survives process restarts

### Proactive Warnings
- ⚠️  **20 hours old:** Warning message
- ❌ **24 hours old:** Blocks API calls with error

### Detailed Error Messages
```
❌ INDMoney authentication failed (401)
🔑 Your token may have expired or is invalid
⏰ Token age: 25.3 hours (24h validity)
🔑 Get new token at: https://www.indstocks.com/app/api-trading
```

## 📖 Usage Examples

### Basic Usage (Automatic Checking)
```python
from upstox_trader.config_and_utils.free_indian_apis import TradingAPIFactory

api = TradingAPIFactory.create_from_config('indmoney')

# Token is checked automatically before each call
price = api.get_price('RELIANCE')  # Will fail if token expired
```

### Manual Token Age Check
```python
api = TradingAPIFactory.create_from_config('indmoney', quiet=False)

# Check token age
if api._is_token_expired():
    print("❌ Token expired!")
    print(f"Token age: {api._get_token_age_hours():.1f} hours")
else:
    print(f"✅ Token OK ({api._get_token_age_hours():.1f} hours old)")
```

### Error Handling
```python
from upstox_trader.config_and_utils.free_indian_apis import TradingAPIFactory

api = TradingAPIFactory.create_from_config('indmoney')

try:
    price = api.get_price('RELIANCE')
except ValueError as e:
    if "expired" in str(e):
        print("❌ Token expired - please refresh")
        print("Get new token: https://www.indstocks.com/app/api-trading")
    elif "whitelist" in str(e):
        print("❌ IP not whitelisted - configure static IP")
```

## 🔄 Comparison with Upstox

| Feature | INDMONEY | Upstox |
|---------|----------|--------|
| **Token Validity** | 24 hours | 24 hours (with refresh) |
| **Auto Refresh** | ❌ No | ✅ Yes |
| **Token Storage** | Manual update | Auto-persistent |
| **Static IP** | ✅ Required | ❌ Not required |
| **Expiry Handling** | Pre-flight check | On-error refresh |

## 🎯 Best Practices

### 1. Monitor Token Age
```python
# Check at application startup
api = TradingAPIFactory.create_from_config('indmoney')
token_age = api._get_token_age_hours()

if token_age > 20:
    print("⚠️  Token will expire soon - consider refreshing")
```

### 2. Handle Errors Gracefully
```python
def safe_get_price(symbol, max_retries=2):
    """Fetch price with token error handling."""
    api = TradingAPIFactory.create_from_config('indmoney', quiet=True)

    for attempt in range(max_retries):
        try:
            return api.get_price(symbol)
        except ValueError as e:
            if "expired" in str(e):
                print(f"❌ Token expired (attempt {attempt + 1})")
                if attempt < max_retries - 1:
                    print("Please update config.py with new token")
                    input("Press Enter when ready...")
                    # Recreate API with new token
                    api = TradingAPIFactory.create_from_config('indmoney')
                    continue
            raise
    return None
```

### 3. Scheduled Token Refresh
```python
# Add to your cron/scheduler
def check_token_expiry():
    """Check if INDMoney token needs refresh."""
    api = TradingAPIFactory.create_from_config('indmoney', quiet=True)
    age_hours = api._get_token_age_hours()

    if age_hours > 22:
        send_alert(f"⚠️ INDMoney token expires in {24 - age_hours:.1f} hours")
    elif age_hours >= 24:
        send_alert("❌ INDMONEY token has expired!")
```

## 📚 Additional Resources

- **INDMoney API Docs:** https://api-docs.indstocks.com/
- **OpenAlgo Integration:** https://docs.openalgo.in/connect-brokers/brokers/indmoney
- **Token Generation:** https://www.indstocks.com/app/api-trading
- **FAQ:** https://api-docs.indstocks.com/faq/

## 🎉 Summary

✅ **Automatic expiration detection** before API calls
✅ **Detailed error messages** with solution guidance
✅ **Token age tracking** with warnings
✅ **401/403 error handling** for auth failures
✅ **Backward compatible** - existing code works unchanged

**Remember:** INDMoney tokens must be manually refreshed every 24 hours! 🔑
