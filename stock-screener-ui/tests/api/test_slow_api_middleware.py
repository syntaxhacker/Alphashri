import asyncio
import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.responses import PlainTextResponse

from api.slow_api import SlowAPIMiddleware


def _records(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def _app(jsonl: Path) -> FastAPI:
    app = FastAPI()

    @app.get("/fast")
    async def fast():
        return {"ok": True}

    @app.get("/slow")
    async def slow():
        await asyncio.sleep(0.04)
        return {"ok": True}

    @app.get("/boom")
    async def boom():
        raise RuntimeError("boom")

    app.add_middleware(SlowAPIMiddleware, threshold_ms=10, jsonl_path=str(jsonl))
    return app


def test_logs_only_slow_requests(tmp_path: Path):
    jsonl = tmp_path / "slow.jsonl"
    client = TestClient(_app(jsonl))

    assert client.get("/fast").status_code == 200
    assert client.get("/slow").status_code == 200

    records = _records(jsonl)
    assert [r["path"] for r in records] == ["/slow"]
    record = records[0]
    assert record["method"] == "GET"
    assert record["status"] == 200
    assert record["ttfb_ms"] >= 10
    assert record["stream"] is False


def test_exception_is_logged_then_reraised(tmp_path: Path):
    jsonl = tmp_path / "slow.jsonl"
    client = TestClient(_app(jsonl), raise_server_exceptions=False)

    response = client.get("/boom")

    assert response.status_code == 500
    records = _records(jsonl)
    assert len(records) == 1
    assert records[0]["path"] == "/boom"
    assert records[0]["status"] == 500
    assert records[0]["error"] == "exception"


def test_threshold_can_be_raised_to_ignore_fast_requests(tmp_path: Path):
    jsonl = tmp_path / "slow.jsonl"
    app = FastAPI()

    @app.get("/slow")
    async def slow():
        await asyncio.sleep(0.04)
        return PlainTextResponse("ok")

    app.add_middleware(SlowAPIMiddleware, threshold_ms=500, jsonl_path=str(jsonl))
    assert TestClient(app).get("/slow").status_code == 200
    assert _records(jsonl) == []


def test_stream_is_not_judged_by_body_lifetime(tmp_path: Path):
    jsonl = tmp_path / "slow.jsonl"
    app = FastAPI()

    @app.get("/events")
    async def events():
        from starlette.responses import StreamingResponse

        async def gen():
            yield b"data: one\n\n"
            await asyncio.sleep(0.08)
            yield b"data: two\n\n"

        return StreamingResponse(gen(), media_type="text/event-stream")

    app.add_middleware(SlowAPIMiddleware, threshold_ms=50, jsonl_path=str(jsonl))
    assert TestClient(app).get("/events").status_code == 200

    # TTFB is immediate; the 80ms body lifetime must not make an SSE stream
    # look like a slow endpoint.
    assert _records(jsonl) == []
