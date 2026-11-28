"""Bare-FastAPI TestClient factory shared by router-level tests."""

from fastapi import FastAPI
from fastapi.testclient import TestClient


def client_for(router):
    """Mount a single router without the global app's lifespan or middleware."""
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)
