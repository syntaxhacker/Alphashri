"""
Tests for LLM Analyzer module.

Test cases cover:
- SQLite Database initialization and caching properties.
- JSON prompt structure execution (Mocked API).
- Error handling fallback for failed analysis.
"""
import sys
import os
import json
from pathlib import Path
from unittest.mock import patch
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

pytestmark = pytest.mark.unit

from llm_analyzer import (
    ArticleAnalyzer,
    DEFAULT_OPENROUTER_MODEL,
    _call_llm_json,
    _extract_json_object,
)

@pytest.fixture
def analyzer_db(tmp_path):
    """Fixture to create a temporary DB for tests."""
    db_file = tmp_path / "test_cache.db"
    analyzer = ArticleAnalyzer(db_path=str(db_file))
    yield analyzer
    # cleanup handled by tmp_path


class _Resp:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload) if payload is not None else ""

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


class TestOpenRouterClient:
    def test_default_model_is_the_requested_free_model(self):
        assert DEFAULT_OPENROUTER_MODEL == "inclusionai/ling-3.2-flash:free"

    def test_extract_json_object_tolerates_fences_and_prose(self):
        expected = {"summary": "ok", "sentiment": "NEUTRAL"}
        raw = json.dumps(expected)
        assert _extract_json_object(raw) == expected
        assert _extract_json_object(f"```json\n{raw}\n```") == expected
        assert _extract_json_object(f"Here you go:\n{raw}\nDone") == expected
        assert _extract_json_object("not json") is None

    def test_falls_back_to_ernie_when_primary_is_rate_limited(self, monkeypatch):
        monkeypatch.setattr("llm_analyzer.config.OPENROUTER_API_KEY", "k")
        calls = []

        def _post(url, headers=None, json=None, timeout=None):
            calls.append(json["model"])
            if len(calls) == 1:
                return _Resp(429, {"error": "rate limited"})
            return _Resp(
                200,
                {
                    "choices": [{"message": {"content": '{"summary":"ok"}'}}],
                    "usage": {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7},
                },
            )

        with patch("llm_analyzer.requests.post", side_effect=_post):
            out = _call_llm_json([{"role": "user", "content": "hi"}])

        assert calls[0] == "inclusionai/ling-3.2-flash:free"
        assert calls[1] == "baidu/ernie-5.5-flash-preview:free"
        assert out["summary"] == "ok"
        assert out["_usage"]["total_tokens"] == 7

    def test_raises_after_all_models_fail(self, monkeypatch):
        monkeypatch.setattr("llm_analyzer.config.OPENROUTER_API_KEY", "k")
        with patch(
            "llm_analyzer.requests.post",
            return_value=_Resp(500, {"error": "down"}),
        ):
            with pytest.raises(RuntimeError, match="HTTP 500"):
                _call_llm_json([{"role": "user", "content": "hi"}])

    def test_reports_which_model_actually_answered_after_fallback(self, monkeypatch):
        monkeypatch.setattr("llm_analyzer.config.OPENROUTER_API_KEY", "k")
        tried = []

        def _post(url, headers=None, json=None, timeout=None):
            tried.append(json["model"])
            if len(tried) == 1:
                return _Resp(429, {"error": "rate limited"})
            return _Resp(200, {"choices": [{"message": {"content": '{"summary":"ok"}'}}]})

        with patch("llm_analyzer.requests.post", side_effect=_post):
            out = _call_llm_json([{"role": "user", "content": "hi"}])

        assert out["_model"] == tried[1]


class TestArticleAnalyzer:
    def test_cache_initialization(self, analyzer_db):
        """Test DB exists and can generate consistent keys."""
        assert os.path.exists(analyzer_db.db_path)
        
        url = "https://example.com/finance"
        key = analyzer_db._generate_cache_key(url)
        assert len(key) == 32 # MD5
        
        # Test direct cache write/read
        mock_analysis = {
            "summary": "Mock Summary",
            "sentiment": "BULLISH",
            "impact_score": 8,
            "key_entities": ["Tesla"],
            "trade_ideas": []
        }
        
        analyzer_db._save_to_cache(key, url, "Headline", mock_analysis)
        cached = analyzer_db._get_from_cache(key)
        
        assert cached is not None
        assert cached["sentiment"] == "BULLISH"
        assert cached["impact_score"] == 8

    def test_short_content_rejection(self, analyzer_db):
        """Test that tiny articles bounce immediately without hitting API."""
        result = analyzer_db.analyze_article("url", "headline", "short content")
        assert result["summary"] == "Article content too short or unavailable for analysis."
        assert result["sentiment"] == "NEUTRAL"

    @patch('llm_analyzer._call_llm_json')
    def test_successful_analysis(self, mock_call_llm, analyzer_db):
        """Test the mocked model returning correct JSON."""
        mock_call_llm.return_value = {
            "summary": "AI writes good code.",
            "sentiment": "BULLISH",
            "impact_score": 7,
            "key_entities": ["Anthropic"],
            "trade_ideas": [
                 {"symbol": "AI", "direction": "LONG", "reasoning": "Progress."}
            ]
        }
        
        result = analyzer_db.analyze_article("https://ai.com", "AI News", "Long content about AI " * 10)
        
        assert result["sentiment"] == "BULLISH"
        assert result["impact_score"] == 7
        assert "trade_ideas" in result
        assert len(result["trade_ideas"]) == 1
        
        # Verify it saved to cache automatically
        cached = analyzer_db._get_from_cache(analyzer_db._generate_cache_key("https://ai.com"))
        assert cached is not None
        assert cached["impact_score"] == 7

    @patch('llm_analyzer._call_llm_json')
    def test_fallback_on_api_error(self, mock_call_llm, analyzer_db):
        """Test graceful fallback if OpenRouter fails."""
        mock_call_llm.side_effect = Exception("API Offline")
        
        result = analyzer_db.analyze_article("https://fail.com", "Fail", "Long content about failures " * 10)
        
        assert "Failed to analyze article" in result["summary"]
        assert result["sentiment"] == "NEUTRAL"
        assert result["impact_score"] == 0

    @patch('llm_analyzer._call_llm_json')
    def test_malformed_sentiment_and_impact_still_produce_a_cached_result(self, mock_call_llm, analyzer_db):
        """A model that returns sentiment=null and impact_score='high' must not
        turn a usable reply into the generic failure fallback."""
        mock_call_llm.return_value = {
            "summary": "Markets rallied on the policy announcement.",
            "sentiment": None,
            "impact_score": "high",
            "key_entities": ["RBI"],
            "trade_ideas": [],
        }

        result = analyzer_db.analyze_article(
            "https://coerce.com", "RBI news", "Long content about RBI " * 10
        )

        assert "Failed to analyze" not in result["summary"]
        assert result["sentiment"] == "NEUTRAL"
        assert result["impact_score"] == 0
        assert result["key_entities"] == ["RBI"]
        cached = analyzer_db._get_from_cache(analyzer_db._generate_cache_key("https://coerce.com"))
        assert cached is not None
        assert cached["key_entities"] == ["RBI"]

    @patch('llm_analyzer._call_llm_json')
    def test_llm_run_logs_the_model_that_answered_not_the_configured_default(self, mock_call_llm, analyzer_db):
        mock_call_llm.return_value = {
            "summary": "ok",
            "sentiment": "BULLISH",
            "impact_score": 5,
            "_model": "baidu/ernie-5.5-flash-preview:free",
            "_usage": {"prompt_tokens": 10, "completion_tokens": 4, "total_tokens": 14},
        }

        analyzer_db.analyze_article(
            "https://model.com", "News", "Long content about markets " * 10
        )

        runs = analyzer_db.get_llm_stats()
        assert runs[0]["model"] == "baidu/ernie-5.5-flash-preview:free"
        assert runs[0]["prompt_tokens"] == 10
