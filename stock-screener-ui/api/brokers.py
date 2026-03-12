"""
Broker OAuth endpoints for Alphashri

Provides:
- Upstox OAuth flow (auth, callback, disconnect)
- Broker connection status checking
"""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse
from typing import Optional
import httpx
import os
import json
from datetime import datetime, timedelta
from pathlib import Path

from db.models import get_shared_broker_token, save_broker_token, delete_broker_token

router = APIRouter(prefix="/api/brokers", tags=["brokers"])

UPSTOX_BASE = "https://api.upstox.com/v2"
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
TOKEN_FILE = PROJECT_ROOT / ".upstox_token.json"


def _get_upstox_token_from_db() -> Optional[dict]:
    token_data = get_shared_broker_token("upstox")
    if token_data and token_data.get("access_token"):
        return token_data
    return None


def _get_upstox_token_from_file() -> Optional[dict]:
    if TOKEN_FILE.exists():
        try:
            with open(TOKEN_FILE, "r") as f:
                data = json.load(f)
            if data.get("access_token"):
                return {
                    "access_token": data["access_token"],
                    "token_timestamp": data.get("timestamp")
                }
        except (json.JSONDecodeError, KeyError):
            pass
    return None


def _get_upstox_token_from_env() -> Optional[dict]:
    token = os.getenv("UPSTOX_ACCESS_TOKEN")
    if token:
        return {"access_token": token, "token_timestamp": None}
    return None


def _get_token_status() -> dict:
    """Get broker token status.
    
    Note: Upstox tokens expire at 3:30 AM the following day, not 24h from creation.
    We use 24h as a safe approximation for UI display.
    """
    token_data = _get_upstox_token_from_db()
    source = "database"
    
    if not token_data:
        token_data = _get_upstox_token_from_file()
        source = "file"
    
    if not token_data:
        token_data = _get_upstox_token_from_env()
        source = "env"
    
    if not token_data or not token_data.get("access_token"):
        return {"connected": False, "broker": "upstox", "expires_in_hours": None, "expires_at": None, "source": None}
    
    timestamp_str = token_data.get("token_timestamp")
    if timestamp_str:
        try:
            if isinstance(timestamp_str, str):
                token_time = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
            else:
                token_time = timestamp_str
            
            # Upstox tokens expire at 3:30 AM the following day
            # Calculate expiry: next day at 3:30 AM from token creation time
            expires_at = token_time.replace(hour=3, minute=30, second=0, microsecond=0)
            if token_time.hour >= 3 or (token_time.hour == 3 and token_time.minute >= 30):
                # If created after 3:30 AM, expires next day at 3:30 AM
                expires_at = expires_at + timedelta(days=1)
            
            now = datetime.now(token_time.tzinfo) if token_time.tzinfo else datetime.utcnow()
            expires_in = expires_at - now
            expires_in_hours = expires_in.total_seconds() / 3600
            
            if expires_in.total_seconds() <= 0:
                return {"connected": False, "broker": "upstox", "expires_in_hours": 0, "expires_at": expires_at.isoformat(), "source": source}
            
            return {
                "connected": True,
                "broker": "upstox",
                "expires_in_hours": round(expires_in_hours, 2),
                "expires_at": expires_at.isoformat(),
                "source": source
            }
        except Exception:
            return {"connected": True, "broker": "upstox", "expires_in_hours": None, "expires_at": None, "source": source}
    
    return {"connected": True, "broker": "upstox", "expires_in_hours": None, "expires_at": None, "source": source}


@router.get("/status")
async def get_broker_status():
    """
    Returns broker connection status.
    Checks DB first, then .upstox_token.json file, then UPSTOX_ACCESS_TOKEN env var.
    """
    return _get_token_status()


def _get_upstox_credentials():
    """Get Upstox API credentials from environment (supports both naming conventions)."""
    api_key = os.getenv("UPSTOX_API_KEY") or os.getenv("UPSTOX_CLIENT_ID")
    api_secret = os.getenv("UPSTOX_API_SECRET") or os.getenv("UPSTOX_CLIENT_SECRET")
    return api_key, api_secret


@router.get("/upstox/auth")
async def upstox_auth():
    """
    Redirects to Upstox OAuth authorization URL.
    """
    api_key, api_secret = _get_upstox_credentials()
    
    if not api_key or not api_secret:
        raise HTTPException(
            status_code=500,
            detail="UPSTOX_API_KEY (or UPSTOX_CLIENT_ID) and UPSTOX_API_SECRET (or UPSTOX_CLIENT_SECRET) must be set in environment"
        )
    
    redirect_uri = f"{os.getenv('API_BASE_URL', 'http://localhost:8765')}/api/brokers/upstox/callback"
    
    auth_url = f"https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id={api_key}&redirect_uri={redirect_uri}"
    
    return RedirectResponse(url=auth_url)


@router.get("/upstox/callback")
async def upstox_callback(code: str = Query(...)):
    """
    Handles OAuth callback with code query param.
    Exchanges code for access token and stores in DB.
    """
    print(f"🔄 Upstox callback received with code: {code[:20]}...")
    
    api_key, api_secret = _get_upstox_credentials()
    
    if not api_key or not api_secret:
        print("❌ Missing Upstox credentials")
        raise HTTPException(
            status_code=500,
            detail="UPSTOX_API_KEY (or UPSTOX_CLIENT_ID) and UPSTOX_API_SECRET (or UPSTOX_CLIENT_SECRET) must be set in environment"
        )
    
    redirect_uri = f"{os.getenv('API_BASE_URL', 'http://localhost:8765')}/api/brokers/upstox/callback"
    
    token_url = f"{UPSTOX_BASE}/login/authorization/token"
    
    form_data = {
        "code": code,
        "client_id": api_key,
        "client_secret": api_secret,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code"
    }
    
    print(f"📡 Exchanging code for token...")
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(token_url, data=form_data)
            
            print(f"📡 Token response status: {response.status_code}")
            
            if response.status_code != 200:
                print(f"❌ Token exchange failed: {response.text}")
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to exchange code for token: {response.text}"
                )
            
            token_response = response.json()
            print(f"✅ Token response keys: {token_response.keys()}")
            access_token = token_response.get("access_token")
            
            if not access_token:
                print(f"❌ No access_token in response: {token_response}")
                raise HTTPException(
                    status_code=400,
                    detail=f"No access_token in response: {token_response}"
                )
            
            print(f"💾 Saving token to DB: {access_token[:20]}...")
            save_broker_token("upstox", access_token, user_id=None)
            print(f"✅ Token saved to DB successfully")
            
            if TOKEN_FILE.exists():
                try:
                    TOKEN_FILE.unlink()
                    print(f"🗑️ Removed old token file")
                except Exception:
                    pass
            
            return RedirectResponse(url=f"{os.getenv('FRONTEND_URL', 'http://localhost:5173')}/settings?upstox=connected")
    
    except httpx.RequestError as e:
        print(f"❌ Request error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Request error: {str(e)}")


@router.post("/upstox/disconnect")
async def upstox_disconnect():
    """
    Clears stored token from DB and any local files.
    """
    delete_broker_token("upstox", user_id=None)
    
    if TOKEN_FILE.exists():
        try:
            TOKEN_FILE.unlink()
        except Exception:
            pass
    
    return {"success": True}
