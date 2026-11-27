"""Cached Upstox clients must recover a token that arrived after startup."""

from types import SimpleNamespace

import market_data.market_data as md


class _Auth:
    def __init__(self, token=None):
        self.access_token = token
        self.loads = 0

    def load_token(self):
        self.loads += 1
        self.access_token = "fresh-token"
        return True


def test_cached_client_reloads_a_missing_token(monkeypatch):
    auth = _Auth()
    client = SimpleNamespace(auth_handler=auth)
    monkeypatch.setattr(md, "_client_cache", client)

    assert md.get_api_client() is client
    assert auth.access_token == "fresh-token"
    assert auth.loads == 1


def test_cached_client_with_a_token_is_not_reloaded(monkeypatch):
    auth = _Auth("already-there")
    client = SimpleNamespace(auth_handler=auth)
    monkeypatch.setattr(md, "_client_cache", client)

    assert md.get_api_client() is client
    assert auth.access_token == "already-there"
    assert auth.loads == 0
