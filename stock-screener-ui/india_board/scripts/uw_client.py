#!/usr/bin/env python3
"""Minimal reusable Unusual Whales API client (stdlib + requests).

Reads the bearer token from the sibling `.env` file so the token never has to be
hardcoded or passed on the command line.
"""
from __future__ import annotations

import os
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
BASE_URL = "https://api.unusualwhales.com"
CLIENT_HEADER = {"UW-CLIENT-API-ID": "100001"}


def load_token() -> str:
    token = os.environ.get("UW_API_KEY")
    if token:
        return token
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            line = line.strip()
            if line.startswith("UW_API_KEY="):
                return line.split("=", 1)[1].strip()
    raise RuntimeError("UW_API_KEY not found in environment or .env")


class UWClient:
    def __init__(self, token: str | None = None, base_url: str = BASE_URL):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {token or load_token()}",
                **CLIENT_HEADER,
            }
        )
        self.last_usage: dict = {}

    def get(self, path: str, *, stream: bool = False, timeout: int = 30, **params):
        if not path.startswith("/api"):
            path = "/api" + path
        url = f"{self.base_url}{path}"
        resp = self.session.get(url, params=params, stream=stream, timeout=timeout)
        self.last_usage = usage_from_headers(resp.headers)
        return resp

    def get_json(self, path: str, **params):
        resp = self.get(path, **params)
        resp.raise_for_status()
        return resp.json()

    def usage(self) -> dict:
        """Refresh usage via a lightweight call."""
        self.get("/api/news/headlines", limit=1)
        return self.last_usage


def usage_from_headers(headers) -> dict:
    def to_int(key):
        try:
            return int(headers.get(key))
        except (TypeError, ValueError):
            return None

    limit = to_int("x-uw-token-req-limit")
    used = to_int("x-uw-daily-req-count")
    return {
        "daily_limit": limit,
        "daily_used": used,
        "daily_remaining": (limit - used) if limit is not None and used is not None else None,
        "minute_remaining": to_int("x-uw-req-per-minute-remaining"),
        "request_id": headers.get("x-request-id"),
    }


if __name__ == "__main__":
    c = UWClient()
    print(c.usage())
