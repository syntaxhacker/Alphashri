"""Guard for moving FastAPI's first-request route build to startup.

FastAPI 0.143 keeps every ``include_router`` as a lazy ``_IncludedRouter``
wrapper. Its ``effective_candidates()`` builds each route's Dependant and
Pydantic models on the first request that matches it. On this app that is
~330 ms of work, paid by the first caller of every endpoint. The prebuild hook
must move that work into the lifespan and leave no lazy candidates behind.

No wall-clock assertions here: the observable contract is that the build
happens (and happens before any request), not how long it takes.
"""

from fastapi import APIRouter, FastAPI
from fastapi.routing import _IncludedRouter
from fastapi.testclient import TestClient

import fastapi.routing as routing
from api_server_fastapi import _prebuild_route_dependants


def _controlled_app(router_count=3):
    """A small app whose only lazy routes are the included-router wrappers."""
    app = FastAPI()

    @app.get("/app-route")
    def app_route():
        return {"ok": True}

    for index in range(router_count):
        router = APIRouter()

        @router.get(f"/r{index}/first")
        def first():
            return {"ok": True}

        @router.get(f"/r{index}/second")
        def second():
            return {"ok": True}

        app.include_router(router)

    return app


def _included_routers(app):
    return [r for r in app.router.routes if isinstance(r, _IncludedRouter)]


def test_included_router_starts_with_no_built_candidates():
    app = _controlled_app()
    wrappers = _included_routers(app)

    assert wrappers, "controlled app must contain included-router wrappers"
    for wrapper in wrappers:
        assert wrapper._effective_candidates_version is None
        assert wrapper._effective_candidates == []


def test_first_request_builds_dependants_without_prebuild(monkeypatch):
    app = _controlled_app(router_count=1)
    dependant_builds = []
    real_get_dependant = routing.get_dependant

    def spy_get_dependant(*args, **kwargs):
        dependant_builds.append(args)
        return real_get_dependant(*args, **kwargs)

    monkeypatch.setattr(routing, "get_dependant", spy_get_dependant)

    assert dependant_builds == []
    TestClient(app).get("/r0/first")
    assert dependant_builds, "first request must build the lazy dependants"


def test_prebuild_builds_every_router_and_leaves_no_first_request_work(monkeypatch):
    app = _controlled_app()
    wrappers = _included_routers(app)
    assert wrappers

    candidate_calls = []
    dependant_builds = []
    real_effective_candidates = _IncludedRouter.effective_candidates
    real_get_dependant = routing.get_dependant

    def spy_effective_candidates(self):
        candidate_calls.append(self)
        return real_effective_candidates(self)

    def spy_get_dependant(*args, **kwargs):
        dependant_builds.append(args)
        return real_get_dependant(*args, **kwargs)

    monkeypatch.setattr(_IncludedRouter, "effective_candidates", spy_effective_candidates)
    monkeypatch.setattr(routing, "get_dependant", spy_get_dependant)

    built = _prebuild_route_dependants(app)

    assert built == len(wrappers)
    assert candidate_calls == wrappers
    assert dependant_builds, "prebuild must build the Dependants"
    for wrapper in wrappers:
        assert wrapper._effective_candidates_version is not None
        assert wrapper._effective_candidates

    builds_after_prebuild = len(dependant_builds)
    TestClient(app).get("/r0/first")
    assert len(dependant_builds) == builds_after_prebuild
