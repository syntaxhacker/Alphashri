# FYERS v3 Authentication

**Scope:** OAuth token acquisition and the token/header split consumed by
`fyers-apiv3==3.1.17`. SDK paths below are in
`stock-screener-ui/.venv/lib/python3.12/site-packages/fyers_apiv3/`.

## OAuth exchange

Create the app at [My API Dashboard](https://myapi.fyers.in/dashboard/).
The app supplies `client_id` (also called `app_id`, normally
`XXXXXXXXX-100`), `secret_id` and a registered `redirect_uri`. The official
reference says the redirect URI must match the app registration. [Official
auth reference](https://raw.githubusercontent.com/FyersDev/fyers-skills/master/skills/fyers-trading/references/auth.md)

### 1. Generate an auth code

```http
GET https://api-t1.fyers.in/api/v3/generate-authcode
    ?client_id=<APP_ID>
    &redirect_uri=<REGISTERED_REDIRECT_URI>
    &response_type=code
    &state=<RANDOM_STATE>
```

The browser returns to the redirect URI with `auth_code` and `state`. The SDK
builds this URL in `SessionModel.generate_authcode()`. [SDK:
`fyersModel.py:643-677`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/fyersModel.py#L643-L677)

### 2. Exchange the code

```http
POST https://api-t1.fyers.in/api/v3/validate-authcode
Content-Type: application/json

{
  "grant_type": "authorization_code",
  "appIdHash": "<sha256(client_id:secret_id)>",
  "code": "<AUTH_CODE>"
}
```

`appIdHash` is the hex SHA-256 digest of the literal string
`"<client_id>:<secret_id>"`; the SDK implements this in
`SessionModel.get_hash()`/`generate_token()`. [SDK:
`fyersModel.py:679-695`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/fyersModel.py#L679-L695)
A successful response contains `access_token` and `refresh_token`. [Official
auth reference](https://raw.githubusercontent.com/FyersDev/fyers-skills/master/skills/fyers-trading/references/auth.md)

```python
from fyers_apiv3 import fyersModel

session = fyersModel.SessionModel(
    client_id=APP_ID, secret_key=SECRET_ID,
    redirect_uri=REDIRECT_URI, response_type="code",
    grant_type="authorization_code",
)
# print(session.generate_authcode())  # open, log in, copy auth_code
session.set_token(AUTH_CODE)
access_token = session.generate_token()["access_token"]
```

## The token-format split (critical)

| Consumer | Input/header | Use |
|---|---|---|
| `FyersModel` | `client_id=APP_ID, token=ACCESS_TOKEN` | **Separate values** |
| Raw REST | `Authorization: APP_ID:ACCESS_TOKEN` | Combined header value |
| Data socket | `access_token="APP_ID:ACCESS_TOKEN"` | Combined string |
| TBT socket | `authorization: APP_ID:ACCESS_TOKEN` | Combined header |
| Order socket | `authorization: APP_ID:ACCESS_TOKEN` | Combined header |

`FyersModel` constructs `f"{client_id}:{token}"` itself. Passing
`"APP_ID:ACCESS_TOKEN"` as `token` therefore produces a duplicated app-id in
the REST header; the observed API failure is `{"code": -15, "message":
"Please provide valid token"}`. [SDK:
`fyersModel.py:698-719`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/fyersModel.py#L698-L719)
[Local split implementation](../../api/fyers_options.py#L57-L75) ·
[Local regression test](../../tests/test_fyers_options.py#L158-L180)

```python
# Correct REST SDK construction:
app, token = combined.split(":", 1)
fyers = fyersModel.FyersModel(client_id=app, token=token)

# Correct socket construction:
combined = f"{app}:{token}"
```

The data socket keeps the combined string for its binary auth path; its symbol
conversion helper strips the prefix only for the `/data/symbol-token` helper
call. [SDK: `data_ws.py:129-175`,
`data_ws.py:19-35`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/data_ws.py#L19-L35)

## REST host and headers

Trading API base: `https://api-t1.fyers.in/api/v3`. Data API base:
`https://api-t1.fyers.in/data`. Data GETs use:

```http
Authorization: <APP_ID>:<ACCESS_TOKEN>
Content-Type: application/json
version: 3
```

There is **no `Bearer` prefix**. The installed service builds these headers and
selects the data host for `data_flag=True`. [SDK:
`fyersModel.py:15-20,139-171`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/fyersModel.py#L15-L20)

## Expiry and refresh

Treat access tokens as **daily** and renew before approximately **06:00 IST**.
The official reference says end-of-trading-day/daily; community support
answers report 06:00, while a later answer says 06:30. **UNCERTAIN exact
cutoff:** schedule before 06:00 and inspect the JWT `exp` claim. The data SDK
does perform an `exp` check before connecting. [Official auth
reference](https://raw.githubusercontent.com/FyersDev/fyers-skills/master/skills/fyers-trading/references/auth.md)
[SDK expiry check:
`data_ws.py:251-295`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/data_ws.py#L251-L295)
[Community expiry report](https://fyers.in/community/t/how-long-will-the-access-token-be-valid/13306)

The refresh endpoint is
`POST /api/v3/validate-refresh-token` with `grant_type`, `appIdHash`,
`refresh_token` and `pin`; the official reference says refresh validity is 15
days but warns the flow may be discontinued. Prefer the daily auth-code path
until the live docs confirm refresh support. [Official auth
reference](https://raw.githubusercontent.com/FyersDev/fyers-skills/master/skills/fyers-trading/references/auth.md)

## Failure handling

- `-8`, `-15`, `-16`, `-17` and HTTP 401 indicate invalid/expired auth in the
  official reference; re-authenticate rather than retrying blindly. [Official
  auth reference](https://raw.githubusercontent.com/FyersDev/fyers-skills/master/skills/fyers-trading/references/auth.md)
- The data socket reports its own expired-token condition as code `-99`,
  message `Token is expired`. [SDK: `defines.py:9-13`,
  `data_ws.py:271-295`](../../.venv/lib/python3.12/site-packages/fyers_apiv3/FyersWebsocket/defines.py#L9-L13)
- Never log authorization headers, JWTs, or raw handshake responses. The
  transport can include `__cf_bm`, `_cfuvid` and `cf-ray`; use the repository's
  redaction filter and never surface those values to a browser. [Local
  `orderflow_logging.py`](../../api/orderflow_logging.py) · [redaction
  tests](../../tests/test_orderflow_log_redaction.py)
