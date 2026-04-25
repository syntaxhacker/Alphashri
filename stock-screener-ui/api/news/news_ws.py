"""
WebSocket connection managers and endpoints for news and sector streams.
"""

import asyncio
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from api.screener import _sanitize_for_json

router = APIRouter(tags=["news"])


class NewsConnectionManager:
    def __init__(self):
        self.active_connections: set = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        print(f"📰 News WebSocket connected. Active connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        print(f"📰 News WebSocket disconnected. Active connections: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        disconnected = set()
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.add(connection)
        self.active_connections -= disconnected


class SectorConnectionManager:
    def __init__(self):
        self.active_connections: set = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        print(f"📊 Sector WebSocket connected. Active connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        print(f"📊 Sector WebSocket disconnected. Active connections: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        disconnected = set()
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.add(connection)
        self.active_connections -= disconnected


news_ws_manager = NewsConnectionManager()
sector_ws_manager = SectorConnectionManager()


@router.websocket("/ws/news")
async def websocket_news(websocket: WebSocket):
    await news_ws_manager.connect(websocket)
    try:
        await websocket.send_json({
            "type": "connected",
            "message": "Connected to news updates",
            "timestamp": datetime.now().isoformat()
        })

        while True:
            data = await websocket.receive_text()

    except WebSocketDisconnect:
        news_ws_manager.disconnect(websocket)
    except Exception as e:
        print(f"📰 WebSocket error: {e}")
        news_ws_manager.disconnect(websocket)


@router.websocket("/ws/sector")
async def websocket_sector(websocket: WebSocket):
    await sector_ws_manager.connect(websocket)
    try:
        await websocket.send_json({
            "type": "connected",
            "message": "Connected to sector updates",
            "timestamp": datetime.now().isoformat()
        })
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        sector_ws_manager.disconnect(websocket)
    except Exception as e:
        print(f"📊 Sector WebSocket error: {e}")
        sector_ws_manager.disconnect(websocket)
