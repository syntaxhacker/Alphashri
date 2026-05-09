"""
Tests for News WebSocket connection managers.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from api.news.news_ws import NewsConnectionManager, SectorConnectionManager


@pytest.fixture
def mock_websocket():
    ws = AsyncMock()
    ws.accept = AsyncMock()
    ws.send_json = AsyncMock()
    ws.receive_text = AsyncMock()
    return ws


class TestNewsConnectionManager:
    def test_connect_adds_to_active_set(self, mock_websocket):
        manager = NewsConnectionManager()
        assert len(manager.active_connections) == 0

        import asyncio
        asyncio.run(manager.connect(mock_websocket))

        assert len(manager.active_connections) == 1
        assert mock_websocket in manager.active_connections
        mock_websocket.accept.assert_awaited_once()

    def test_disconnect_removes_from_active_set(self, mock_websocket):
        manager = NewsConnectionManager()
        manager.active_connections.add(mock_websocket)
        assert len(manager.active_connections) == 1

        manager.disconnect(mock_websocket)

        assert len(manager.active_connections) == 0

    def test_disconnect_discard_unknown(self, mock_websocket):
        manager = NewsConnectionManager()
        manager.disconnect(mock_websocket)
        assert len(manager.active_connections) == 0

    @pytest.mark.asyncio
    async def test_broadcast_sends_to_all(self, mock_websocket):
        manager = NewsConnectionManager()
        ws2 = AsyncMock()
        ws2.send_json = AsyncMock()
        manager.active_connections.add(mock_websocket)
        manager.active_connections.add(ws2)

        await manager.broadcast({"type": "test", "data": "hello"})

        mock_websocket.send_json.assert_awaited_once_with({"type": "test", "data": "hello"})
        ws2.send_json.assert_awaited_once_with({"type": "test", "data": "hello"})

    @pytest.mark.asyncio
    async def test_broadcast_removes_failed_connections(self, mock_websocket):
        manager = NewsConnectionManager()
        ws2 = AsyncMock()
        ws2.send_json = AsyncMock()
        ws2.send_json.side_effect = Exception("Connection lost")
        manager.active_connections.add(mock_websocket)
        manager.active_connections.add(ws2)

        await manager.broadcast({"type": "test"})

        mock_websocket.send_json.assert_awaited_once()
        assert len(manager.active_connections) == 1
        assert mock_websocket in manager.active_connections
        assert ws2 not in manager.active_connections

    @pytest.mark.asyncio
    async def test_broadcast_handles_empty_set(self):
        manager = NewsConnectionManager()

        await manager.broadcast({"type": "test"})

        assert len(manager.active_connections) == 0


class TestSectorConnectionManager:
    def test_connect_adds_to_active_set(self, mock_websocket):
        manager = SectorConnectionManager()
        assert len(manager.active_connections) == 0

        import asyncio
        asyncio.run(manager.connect(mock_websocket))

        assert len(manager.active_connections) == 1
        mock_websocket.accept.assert_awaited_once()

    def test_disconnect_removes_from_active_set(self, mock_websocket):
        manager = SectorConnectionManager()
        manager.active_connections.add(mock_websocket)

        manager.disconnect(mock_websocket)

        assert len(manager.active_connections) == 0

    @pytest.mark.asyncio
    async def test_broadcast_sends_to_all(self, mock_websocket):
        manager = SectorConnectionManager()
        ws2 = AsyncMock()
        ws2.send_json = AsyncMock()
        manager.active_connections.add(mock_websocket)
        manager.active_connections.add(ws2)

        await manager.broadcast({"type": "sector_update", "data": {}})

        mock_websocket.send_json.assert_awaited_once_with({"type": "sector_update", "data": {}})
        ws2.send_json.assert_awaited_once_with({"type": "sector_update", "data": {}})

    @pytest.mark.asyncio
    async def test_broadcast_removes_failed(self, mock_websocket):
        manager = SectorConnectionManager()
        failing_ws = AsyncMock()
        failing_ws.send_json = AsyncMock(side_effect=Exception("Failed"))
        manager.active_connections.add(mock_websocket)
        manager.active_connections.add(failing_ws)

        await manager.broadcast({"type": "sector_update"})

        assert len(manager.active_connections) == 1
        assert failing_ws not in manager.active_connections

    def test_singleton_instances(self):
        from api.news.news_ws import news_ws_manager, sector_ws_manager
        assert isinstance(news_ws_manager, NewsConnectionManager)
        assert isinstance(sector_ws_manager, SectorConnectionManager)
