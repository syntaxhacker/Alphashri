"""Tests for the multi-market server routing (no network, no lifespan).

The scanner process can serve one or both markets; routes select one with
``?market=india|america``. These cover the pure helpers behind that: the CLI
market-list parser, the per-request resolver (with its primary fallback), and
the routes the app exposes for the dashboard's switcher.
"""
import sys

import pytest

sys.path.insert(0, ".")

from edge_scanner_tv.server import _parse_market_keys, _TvStates, create_app


class TestParseMarketKeys:
    def test_both(self):
        assert _parse_market_keys("both") == ["india", "america"]

    def test_single(self):
        assert _parse_market_keys("america") == ["america"]

    def test_explicit_list_keeps_order(self):
        assert _parse_market_keys("america,india") == ["america", "india"]

    def test_case_and_space_insensitive(self):
        assert _parse_market_keys(" India , AMERICA ") == ["india", "america"]

    def test_unknown_raises(self):
        with pytest.raises(ValueError):
            _parse_market_keys("europe")

    def test_empty_defaults_to_india(self):
        assert _parse_market_keys("") == ["india"]


class TestTvStatesRouting:
    def test_resolve_explicit(self):
        tv = _TvStates(["india", "america"], 5)
        assert tv.resolve("america").market_key == "america"

    def test_resolve_is_case_insensitive(self):
        tv = _TvStates(["india", "america"], 5)
        assert tv.resolve(" AMERICA ").market_key == "america"

    def test_missing_or_unknown_falls_back_to_primary(self):
        tv = _TvStates(["india", "america"], 5)
        assert tv.resolve(None).market_key == "india"
        assert tv.resolve("nope").market_key == "india"

    def test_single_market_falls_back_to_itself(self):
        tv = _TvStates(["america"], 5)
        assert tv.resolve("india").market_key == "america"

    def test_keys_preserves_order(self):
        assert _TvStates(["america", "india"], 5).keys == ["america", "india"]


class TestCreateApp:
    def test_exposes_markets_endpoint_and_states(self):
        app = create_app("both", 5)
        paths = {getattr(r, "path", "") for r in app.routes}
        assert "/api/v2/markets" in paths
        assert app.state.tv.keys == ["india", "america"]
        assert app.state.tv.primary == "india"

    def test_single_market_app(self):
        app = create_app("america", 5)
        assert app.state.tv.keys == ["america"]
        assert app.state.tv.primary == "america"

    def test_unknown_market_raises(self):
        with pytest.raises(ValueError):
            create_app("europe", 5)
