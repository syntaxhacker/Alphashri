# Upstox Options API Documentation

This document provides a comprehensive overview of the Upstox APIs related to Options trading, specifically for the Indian market (NSE/BSE).

## 1. Overview & Authentication

### Base URLs
- **V2 API (Standard):** `https://api.upstox.com/v2`
- **V3 API (High-Frequency Trading - HFT):** `https://api-hft.upstox.com/v3`

### Authentication
All requests require an `Authorization` header with a Bearer token:
```http
Authorization: Bearer {access_token}
Accept: application/json
```

---

## 2. Option Chain & Contracts (v2)

### Option Chain
Retrieves the full put/call option chain for a given underlying instrument and expiry date.
- **Endpoint:** `GET /option/chain`
- **Params:** `instrument_key` (e.g., `NSE_INDEX|Nifty 50`), `expiry_date` (YYYY-MM-DD).
- **Response:** Includes `underlying_spot_price` and a list of strikes with `call_options` and `put_options` containing Greeks and Market Data.

### Option Contracts
Fetches all available option contracts for an underlying symbol.
- **Endpoint:** `GET /option/contract`
- **Params:** `instrument_key`.

---

## 3. Market Data & Quotes (v2)

### Full Market Quote
Retrieves LTP, OHLC, Volume, Depth, etc., for up to 500 instruments.
- **Endpoint:** `GET /market-quote/quotes`
- **Params:** `instrument_key` (comma-separated).

### OHLC Quotes
Retrieves only Open, High, Low, Close snapshots.
- **Endpoint:** `GET /market-quote/ohlc`
- **Params:** `instrument_key`, `interval` (`1d`, `I1`, `I30`).

### Historical Candles
Retrieves OHLC data over a time range.
- **Historical:** `GET /historical-candle/{instrument_key}/{interval}/{to_date}/{from_date}`
- **Intraday (Today):** `GET /historical-candle/intraday/{instrument_key}/{interval}`
- **Intervals:** `1minute`, `30minute`, `day`, `week`, `month`.

---

## 4. Margin & Funds (v2)

### User Funds and Margin
Retrieves available and utilized margin for the account.
- **Endpoint:** `GET /user/get-funds-and-margin`
- **Params:** `segment` (`SEC` for Equity/FO, `COM` for Commodity).

### Order Margin Calculator
Calculates required margin before placing an order.
- **Endpoint:** `POST /charges/margin`
- **Body:**
```json
{
  "instruments": [
    {
      "instrument_key": "NSE_FO|43919",
      "quantity": 25,
      "product": "I",
      "transaction_type": "BUY"
    }
  ]
}
```

---

## 5. Place Order & Auto-Slicing (v3)

The V3 API (HFT) supports **auto-slicing** for large option orders.

- **Endpoint:** `POST https://api-hft.upstox.com/v3/order/place`
- **Key Parameters:**
  - `instrument_token`: e.g., `NSE_FO|37590`
  - `quantity`: Number of units.
  - `slice`: `true` (Automatically splits order if it exceeds exchange freeze limits).
  - `product`: `I` (Intraday), `D` (Delivery/Margin).

---

## 6. Live Market Data WebSocket (v3)

Uses **Protobuf** for high-efficiency binary streaming of Market Data and Option Greeks.

### Authorization
1. Get WebSocket URI: `GET https://api.upstox.com/v3/feed/market-data-feed/authorize`
2. Use the `authorized_redirect_uri` from the response to connect.

### Subscription Modes
- `ltpc`: LTP + Change.
- `full`: LTP, OHLC, Volume, Market Depth.
- `option_greeks`: Real-time Delta, Theta, Gamma, Vega, IV, and OI.

### Example Subscription (JSON over WS)
```json
{
  "guid": "unique_id",
  "method": "sub",
  "data": {
    "mode": "option_greeks",
    "instrumentKeys": ["NSE_FO|132447"]
  }
}
```

---

## 7. Instrument Keys & Symbols

- **NSE Indices:** `NSE_INDEX|Nifty 50`, `NSE_INDEX|Nifty Bank`, `NSE_INDEX|Nifty Fin Service`.
- **F&O Stocks:** Usually prefixed with `NSE_FO|`.
- **Master File:** `GET /market/instruments/all` (CSV/JSON).

---

## 8. Option Greeks Definition
- **Delta:** Price sensitivity relative to underlying.
- **Gamma:** Rate of change of Delta.
- **Theta:** Time decay (loss of value per day).
- **Vega:** Volatility sensitivity.
- **IV:** Implied Volatility (market expectation of future volatility).
