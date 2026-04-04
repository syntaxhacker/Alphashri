"""
Options API - FastAPI endpoints for options trading

Provides secure proxy to Upstox Options API with caching and error handling.
Includes server-side quantitative analysis (Expected Move, Max Pain, Sentiment).
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import asyncio
import httpx
import os
import json
import math
from datetime import datetime, timedelta
from pathlib import Path

from db.models import get_shared_broker_token
import config

router = APIRouter(prefix="/api/options", tags=["options"])

UPSTOX_BASE = "https://api.upstox.com/v2"
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
TOKEN_FILE = PROJECT_ROOT / ".upstox_token.json"


class OptionGreeks(BaseModel):
    delta: float
    gamma: float
    vega: float
    theta: float
    iv: float
    pop: float = 0.0


class MarketData(BaseModel):
    ltp: float
    volume: int
    oi: int
    bid_price: float
    ask_price: float
    prev_oi: int


class OptionContract(BaseModel):
    instrument_key: str
    trading_symbol: str
    strike_price: float
    expiry: str
    instrument_type: str
    lot_size: int
    tick_size: float
    weekly: bool
    market_data: Optional[MarketData] = None
    option_greeks: Optional[OptionGreeks] = None
    sentiment: Optional[Dict[str, str]] = None


# --- Quantitative Utilities ---

def get_option_sentiment(price_change: float, oi_change: int) -> Dict[str, str]:
    """Interpret market sentiment based on price and OI changes."""
    if abs(oi_change) < 100:
        return {"type": "Neutral", "color": "gray", "label": "Neutral"}

    if price_change > 0 and oi_change > 0:
        return {"type": "Long Buildup", "color": "green", "label": "LB"}
    elif price_change < 0 and oi_change > 0:
        return {"type": "Short Buildup", "color": "red", "label": "SB"}
    elif price_change > 0 and oi_change < 0:
        return {"type": "Short Covering", "color": "cyan", "label": "SC"}
    elif price_change < 0 and oi_change < 0:
        return {"type": "Long Unwinding", "color": "orange", "label": "LU"}
    
    return {"type": "Neutral", "color": "gray", "label": "Neutral"}


def calculate_expected_move(spot: float, iv: float, dte: int) -> Dict[str, float]:
    """Calculate 1-Standard Deviation expected move based on IV."""
    if spot <= 0 or iv <= 0:
        return None
    
    annual_iv = iv / 100
    time_factor = math.sqrt(max(dte, 1) / 365)
    move = spot * annual_iv * time_factor
    
    return {
        "upper": round(spot + move, 2),
        "lower": round(spot - move, 2),
        "range": round(move, 2)
    }


def calculate_max_pain(strike_matrix: List[Dict[str, Any]]) -> float:
    """Calculate Max Pain strike (level where option writers lose the least)."""
    if not strike_matrix:
        return 0
    
    min_loss = float('inf')
    max_pain_strike = 0
    
    # We'll test strikes within a reasonable range near spot
    strikes = [row["strike"] for row in strike_matrix]
    
    for test_strike in strikes:
        current_loss = 0
        for row in strike_matrix:
            strike = row["strike"]
            ce_oi = row.get("ce", {}).get("market_data", {}).get("oi", 0) if row.get("ce") else 0
            pe_oi = row.get("pe", {}).get("market_data", {}).get("oi", 0) if row.get("pe") else 0
            
            if test_strike > strike:
                current_loss += (test_strike - strike) * ce_oi
            if test_strike < strike:
                current_loss += (strike - test_strike) * pe_oi
                
        if current_loss < min_loss:
            min_loss = current_loss
            max_pain_strike = test_strike
            
    return max_pain_strike


AVAILABLE_UNDERLYINGS = [
    {"symbol": "NIFTY", "name": "Nifty 50", "instrument_key": "NSE_INDEX|Nifty 50", "lot_size": 25, "tick_size": 0.05},
    {"symbol": "BANKNIFTY", "name": "Nifty Bank", "instrument_key": "NSE_INDEX|Nifty Bank", "lot_size": 15, "tick_size": 1.05},
    {"symbol": "FINNIFTY", "name": "Nifty Fin Service", "instrument_key": "NSE_INDEX|Nifty Fin Service", "lot_size": 25, "tick_size": 1.05},
    {"symbol": "MIDCPNIFTY", "name": "NIFTY MID SELECT", "instrument_key": "NSE_INDEX|NIFTY MID SELECT", "lot_size": 50, "tick_size": 0.05},
]


def get_instrument_key(underlying: str) -> str:
    for u in AVAILABLE_UNDERLYINGS:
        if u["symbol"] == underlying:
            return u["instrument_key"]
    return f"NSE_INDEX|{underlying}"


def get_upstox_token() -> str:
    """Get Upstox access token from DB, file, or env (in that order)."""
    # 1. Check database first
    token_data = get_shared_broker_token("upstox")
    if token_data and token_data.get("access_token"):
        return token_data["access_token"]
    
    # 2. Check token file
    if TOKEN_FILE.exists():
        try:
            with open(TOKEN_FILE, "r") as f:
                token_data = json.load(f)
            token = token_data.get("access_token")
            if token:
                token_time = datetime.fromisoformat(token_data.get("timestamp", "1970-01-01"))
                if datetime.now() - token_time < timedelta(hours=23):
                    return token
        except (json.JSONDecodeError, KeyError):
            pass
    
    # 3. Check environment variable
    token = os.getenv("UPSTOX_ACCESS_TOKEN")
    if token:
        return token
    
    raise HTTPException(
        status_code=401,
        detail="Upstox access token not configured. Go to Settings to connect your Upstox account."
    )


async def fetch_upstox(endpoint: str, params: Optional[dict] = None) -> dict:
    token = get_upstox_token()
    url = f"{UPSTOX_BASE}{endpoint}"
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
        response = await client.get(url, headers=headers, params=params or {})
        
        if response.status_code == 401:
            raise HTTPException(status_code=401, detail="Upstox token expired or invalid")
        elif response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Upstox API error: {response.text}"
            )
        
        return response.json()


@router.get("/health")
async def options_health():
    """Health check for options API."""
    return {"status": "ok", "service": "options-api"}


@router.get("/underlyings")
async def get_underlyings():
    """Get list of available underlying instruments for options trading."""
    return {"underlyings": AVAILABLE_UNDERLYINGS}


@router.get("/expiries/{underlying}")
async def get_expiries(underlying: str):
    """Get available expiry dates for an underlying instrument."""
    today = datetime.now(config.IST)
    expiries = []
    
    try:
        instrument_key = get_instrument_key(underlying)
        data = await fetch_upstox("/option/contract", {"instrument_key": instrument_key})
        
        if data.get("status") == "success" and data.get("data"):
            seen_dates = set()
            for contract in data["data"]:
                expiry_str = contract.get("expiry")
                if expiry_str and expiry_str not in seen_dates:
                    seen_dates.add(expiry_str)
                    expiry_date = datetime.strptime(expiry_str, "%Y-%m-%d")
                    days = (expiry_date - today).days
                    if days >= 0:
                        expiries.append({
                            "date": expiry_str,
                            "weekly": contract.get("weekly", False),
                            "days_to_expiry": days
                        })
            
            expiries.sort(key=lambda x: x["date"])
    except Exception:
        for i in range(8):
            days_until_thursday = (3 - today.weekday() + 7) % 7
            expiry = today + timedelta(days=days_until_thursday + i * 7)
            expiries.append({
                "date": expiry.strftime("%Y-%m-%d"),
                "weekly": True,
                "days_to_expiry": (expiry - today).days
            })
    
    return {"underlying": underlying, "expiries": expiries}


def transform_option_contract(option_data: dict, strike: float, option_type: str) -> dict:
    """Transform Upstox option data to flat contract structure with sentiment."""
    if not option_data:
        return None

    market_data = option_data.get("market_data", {})
    greeks = option_data.get("option_greeks", {})
    
    ltp = market_data.get("ltp", 0)
    oi = market_data.get("oi", 0)
    prev_oi = market_data.get("prev_oi", 0)
    bid = market_data.get("bid_price", 0)
    
    oi_change = oi - prev_oi
    price_change = ltp - bid 
    
    sentiment = get_option_sentiment(price_change, oi_change)

    return {
        "instrument_key": option_data.get("instrument_key", ""),
        "trading_symbol": option_data.get("trading_symbol", ""),
        "strike_price": strike,
        "expiry": option_data.get("expiry", ""),
        "instrument_type": option_type,
        "market_data": {
            "ltp": ltp,
            "volume": market_data.get("volume", 0),
            "oi": oi,
            "bid_price": bid,
            "ask_price": market_data.get("ask_price", 0),
            "prev_oi": prev_oi,
        },
        "option_greeks": {
            "delta": greeks.get("delta", 0),
            "gamma": greeks.get("gamma", 0),
            "vega": greeks.get("vega", 0),
            "theta": greeks.get("theta", 0),
            "iv": greeks.get("iv", 0),
        } if greeks else None,
        "sentiment": sentiment
    }


@router.get("/chain/{underlying}")
async def get_option_chain(
    underlying: str,
    expiry: str = Query(..., description="Expiry date in YYYY-MM-DD format"),
):
    """Get complete option chain with server-side analysis."""
    instrument_key = get_instrument_key(underlying)

    try:
        data = await fetch_upstox("/option/chain", {
            "instrument_key": instrument_key,
            "expiry_date": expiry
        })

        contracts = data.get("data", [])
        # Reliability fix: Fallback for spot price
        spot_price = data.get("underlying_spot_price", 0)
        if not spot_price:
            spot_price = contracts[0].get("underlying_spot_price", 0) if contracts else 0
        
        # Third-level fallback: Fetch from OHLC if still 0
        if not spot_price:
            try:
                spot_data = await get_spot_price(underlying)
                spot_price = spot_data.get("spot", 0)
            except Exception:
                pass

        strike_map = {}
        total_ce_oi = 0
        total_pe_oi = 0
        atm_iv = 0
        closest_strike_diff = float('inf')

        for item in contracts:
            strike = item.get("strike_price")
            if strike not in strike_map:
                strike_map[strike] = {"strike": strike, "ce": None, "pe": None}

            if item.get("call_options"):
                # Reliability fix: some fields might be at parent level in some API versions
                call_data = item["call_options"]
                if not call_data.get("trading_symbol"):
                    call_data["trading_symbol"] = f"{underlying}{expiry.replace('-','')}{strike}CE"
                if not call_data.get("expiry"):
                    call_data["expiry"] = expiry
                    
                ce_contract = transform_option_contract(call_data, strike, "CE")
                strike_map[strike]["ce"] = ce_contract
                total_ce_oi += ce_contract["market_data"]["oi"]
                
                # Check for ATM IV
                diff = abs(strike - spot_price)
                if diff < closest_strike_diff:
                    iv = ce_contract["option_greeks"]["iv"] if ce_contract.get("option_greeks") else 0
                    if iv > 0:
                        closest_strike_diff = diff
                        atm_iv = iv

            if item.get("put_options"):
                put_data = item["put_options"]
                if not put_data.get("trading_symbol"):
                    put_data["trading_symbol"] = f"{underlying}{expiry.replace('-','')}{strike}PE"
                if not put_data.get("expiry"):
                    put_data["expiry"] = expiry

                pe_contract = transform_option_contract(put_data, strike, "PE")
                strike_map[strike]["pe"] = pe_contract
                total_pe_oi += pe_contract["market_data"]["oi"]
                
                # Check for ATM IV (only if CE didn't give us a better one)
                diff = abs(strike - spot_price)
                if diff < closest_strike_diff:
                    iv = pe_contract["option_greeks"]["iv"] if pe_contract.get("option_greeks") else 0
                    if iv > 0:
                        closest_strike_diff = diff
                        atm_iv = iv

        chain = sorted(strike_map.values(), key=lambda x: x["strike"])
        
        # Calculate DS Summary
        expiry_date = datetime.strptime(expiry, "%Y-%m-%d")
        dte = (expiry_date - datetime.now()).days + 1
        
        expected_move = calculate_expected_move(spot_price, atm_iv, dte)
        max_pain = calculate_max_pain(chain)
        pcr = total_pe_oi / total_ce_oi if total_ce_oi > 0 else 0

        return {
            "status": "ok",
            "underlying": underlying,
            "expiry": expiry,
            "spot": spot_price,
            "timestamp": datetime.now().isoformat(),
            "chain": chain,
            "summary": {
                "pcr": round(pcr, 2),
                "max_pain": max_pain,
                "expected_move": expected_move,
                "total_ce_oi": total_ce_oi,
                "total_pe_oi": total_pe_oi,
                "dte": dte,
                "atm_iv": atm_iv
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch option chain: {str(e)}")


def _fetch_spot_history_sync(underlying: str):
    """Synchronous helper for fetching spot history via yfinance."""
    import yfinance as yf

    symbol_map = {
        "NIFTY": "^NSEI",
        "BANKNIFTY": "^NSEBANK",
        "FINNIFTY": "NIFTY_FIN_SERVICE.NS",
        "MIDCPNIFTY": "^NSEMDCP50"
    }

    yf_symbol = symbol_map.get(underlying, f"{underlying}.NS")

    ticker = yf.Ticker(yf_symbol)
    hist = ticker.history(period="1d", interval="5m")

    if hist.empty:
        return {"status": "error", "message": "No history found"}

    candles = [{"time": ts.isoformat(), "price": round(float(row["Close"]), 2)}
               for ts, row in hist.iterrows()]

    return {
        "status": "ok",
        "underlying": underlying,
        "history": candles[-50:]
    }


@router.get("/spot-history/{underlying}")
async def get_spot_history(underlying: str):
    """Get intraday historical spot price for charting."""
    try:
        return await asyncio.to_thread(_fetch_spot_history_sync, underlying)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch history: {str(e)}")


@router.get("/positions")
async def get_option_positions():
    """Get user's open option positions from portfolio."""
    try:
        data = await fetch_upstox("/portfolio/short-term-positions")
        positions = data.get("data", [])
        option_positions = [p for p in positions if p.get("instrument_type") in ["CE", "PE"]]
        return {"status": "ok", "positions": option_positions}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch positions: {str(e)}")


@router.get("/spot/{underlying}")
async def get_spot_price(underlying: str):
    """Get current spot price for underlying."""
    instrument_key = get_instrument_key(underlying)
    try:
        data = await fetch_upstox("/market-quote/ohlc", {"instrument_key": instrument_key, "interval": "1d"})
        spot = 0
        if data.get("status") == "success" and data.get("data"):
            key = list(data["data"].keys())[0]
            spot = data["data"][key].get("last_price", 0)
        
        return {"status": "ok", "underlying": underlying, "spot": spot}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch spot: {str(e)}")
