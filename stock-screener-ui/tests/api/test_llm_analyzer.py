"""
Tests for LLM Analyzer module.

Test cases cover:
- SQLite Database initialization and caching properties.
- JSON prompt structure execution (Mocked API).
- Error handling fallback for failed analysis.
"""
import sys
import os
from pathlib import Path
from unittest.mock import patch
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from llm_analyzer import ArticleAnalyzer

@pytest.fixture
def analyzer_db(tmp_path):
    """Fixture to create a temporary DB for tests."""
    db_file = tmp_path / "test_cache.db"
    analyzer = ArticleAnalyzer(db_path=str(db_file))
    yield analyzer
    # cleanup handled by tmp_path

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
        
        # Execute
        result = analyzer_db.analyze_article("https://ai.com", "AI News", "Long content about AI " * 10)
        
        # Assertions
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
