import os
import json
import hashlib
import sqlite3
import time
from typing import Dict, Any, Optional, List
import config
from preciz import _call_llm_json

OPENROUTER_PRICING = {
    "openrouter/owl-alpha": {"prompt": 0, "completion": 0},
    "anthropic/claude-3.5-sonnet": {"prompt": 3.0, "completion": 15.0},
    "anthropic/claude-3-opus": {"prompt": 15.0, "completion": 75.0},
    "openai/gpt-4-turbo": {"prompt": 10.0, "completion": 30.0},
    "openai/gpt-4o": {"prompt": 5.0, "completion": 15.0},
    "openai/gpt-4o-mini": {"prompt": 0.15, "completion": 0.60},
    "openai/gpt-3.5-turbo": {"prompt": 0.5, "completion": 1.5},
    "google/gemini-pro-1.5": {"prompt": 1.25, "completion": 5.0},
    "meta-llama/llama-3.1-70b-instruct": {"prompt": 0.52, "completion": 0.75},
    "meta-llama/llama-3.1-8b-instruct": {"prompt": 0.06, "completion": 0.06},
}

class ArticleAnalyzer:
    """Class to analyze financial news articles using OpenRouter LLMs with SQLite caching."""
    
    def __init__(self, model_name: str = "openrouter/owl-alpha", db_path: str = "db/llm_cache.db"):
        api_key = config.OPENROUTER_API_KEY
        if not api_key:
            print("WARNING: OPENROUTER_API_KEY environment variable not set. Analysis will fail.")

        self.model_name = model_name

        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        """Initialize the SQLite database for caching LLM responses and logging runs."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS article_analysis (
                    url_hash TEXT PRIMARY KEY,
                    url TEXT,
                    headline TEXT,
                    analysis_json TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS llm_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    url TEXT,
                    model TEXT,
                    headline TEXT,
                    prompt_tokens INTEGER,
                    completion_tokens INTEGER,
                    total_tokens INTEGER,
                    cost_usd REAL,
                    response_time_ms INTEGER,
                    status TEXT,
                    error_message TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_llm_runs_created_at ON llm_runs(created_at)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_llm_runs_status ON llm_runs(status)')
            conn.commit()

    def _calculate_cost(self, model: str, prompt_tokens: int, completion_tokens: int) -> float:
        """Calculate cost in USD based on token usage and model pricing."""
        pricing = OPENROUTER_PRICING.get(model, {"prompt": 0, "completion": 0})
        prompt_cost = (prompt_tokens / 1_000_000) * pricing["prompt"]
        completion_cost = (completion_tokens / 1_000_000) * pricing["completion"]
        return round(prompt_cost + completion_cost, 6)

    def _log_llm_run(
        self,
        url: str,
        model: str,
        headline: str,
        prompt_tokens: int,
        completion_tokens: int,
        total_tokens: int,
        cost_usd: float,
        response_time_ms: int,
        status: str,
        error_message: Optional[str] = None
    ):
        """Log an LLM run to the database."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO llm_runs 
                    (url, model, headline, prompt_tokens, completion_tokens, total_tokens, 
                     cost_usd, response_time_ms, status, error_message)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (url, model, headline, prompt_tokens, completion_tokens, total_tokens,
                      cost_usd, response_time_ms, status, error_message))
                conn.commit()
        except Exception as e:
            print(f"Failed to log LLM run: {e}")

    def get_llm_stats(self, limit: int = 100) -> List[Dict[str, Any]]:
        """Get recent LLM run statistics."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                cursor.execute('''
                    SELECT * FROM llm_runs 
                    ORDER BY created_at DESC 
                    LIMIT ?
                ''', (limit,))
                rows = cursor.fetchall()
                return [dict(row) for row in rows]
        except Exception as e:
            print(f"Failed to get LLM stats: {e}")
            return []

    def get_llm_aggregate_stats(self) -> Dict[str, Any]:
        """Get aggregate statistics for LLM runs."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    SELECT 
                        COUNT(*) as total_runs,
                        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_runs,
                        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_runs,
                        SUM(total_tokens) as total_tokens,
                        SUM(prompt_tokens) as total_prompt_tokens,
                        SUM(completion_tokens) as total_completion_tokens,
                        SUM(cost_usd) as total_cost_usd,
                        AVG(response_time_ms) as avg_response_time_ms
                    FROM llm_runs
                ''')
                row = cursor.fetchone()
                cursor.execute('SELECT model, COUNT(*) as count FROM llm_runs GROUP BY model ORDER BY count DESC')
                models = cursor.fetchall()
                return {
                    "total_runs": row[0] or 0,
                    "successful_runs": row[1] or 0,
                    "failed_runs": row[2] or 0,
                    "total_tokens": row[3] or 0,
                    "total_prompt_tokens": row[4] or 0,
                    "total_completion_tokens": row[5] or 0,
                    "total_cost_usd": round(row[6] or 0, 4),
                    "avg_response_time_ms": round(row[7] or 0, 0),
                    "models_used": [{"model": m[0], "count": m[1]} for m in models]
                }
        except Exception as e:
            print(f"Failed to get aggregate stats: {e}")
            return {}

    def clear_llm_stats(self) -> int:
        """Clear LLM run log data (llm_runs table only). Does not affect article_analysis cache.
        Returns count of deleted rows.
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*) FROM llm_runs")
                count = cursor.fetchone()[0] or 0
                cursor.execute("DELETE FROM llm_runs")
                conn.commit()
                return int(count)
        except Exception as e:
            print(f"Failed to clear LLM stats: {e}")
            return 0

    def _generate_cache_key(self, url: str) -> str:
        return hashlib.md5(url.encode()).hexdigest()

    def _get_from_cache(self, url_hash: str) -> Optional[Dict[str, Any]]:
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT analysis_json FROM article_analysis WHERE url_hash = ?", (url_hash,))
                row = cursor.fetchone()
                if row:
                    return json.loads(row[0])
        except Exception as e:
            print(f"Cache read error: {e}")
        return None
        
    def _save_to_cache(self, url_hash: str, url: str, headline: str, analysis: Dict[str, Any]):
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "INSERT OR REPLACE INTO article_analysis (url_hash, url, headline, analysis_json) VALUES (?, ?, ?, ?)",
                    (url_hash, url, headline, json.dumps(analysis))
                )
                conn.commit()
        except Exception as e:
            print(f"Cache write error: {e}")

    def analyze_article(self, url: str, headline: str, content: str) -> Dict[str, Any]:
        """
        Analyzes the article content for summary, sentiment, impact, entities, and trade ideas.
        Returns from SQLite cache if previously analyzed.
        Logs each LLM run with token usage and cost.
        """
        if not content or len(content.strip()) < 50:
             return {
                "summary": "Article content too short or unavailable for analysis.",
                "sentiment": "NEUTRAL",
                "impact_score": 0,
                "key_entities": [],
                "trade_ideas": []
            }
             
        cache_key = self._generate_cache_key(url)
        cached_result = self._get_from_cache(cache_key)
        
        if cached_result:
            print(f"Returning cached analysis for {url}")
            return cached_result

        print(f"Analyzing article via LLM: {headline[:50]}...")
        
        system_prompt = """
You are a highly skilled financial analyst AI. Your job is to analyze the provided news article and output a strict JSON object containing the following keys exactly:

- "summary": A concise 2-3 sentence summary of the core financial news or event.
- "key_points": An array of 3-5 strings, where each string is a key takeaway from the article. Be specific and actionable.
- "sentiment": The overall market sentiment. Must be exactly "BULLISH", "BEARISH", or "NEUTRAL".
- "impact_score": An integer 1-10 rating potential market impact.
- "key_entities": An array of strings listing important companies,  individuals, or assets mentioned. Example: ["Reliance Industries", "Mukesh Ambani", "Nifty 50"]
- "trade_ideas": An array of objects with potential trading opportunities:
  [
    {
      "symbol": "RELIANCE",
      "direction": "LONG",
      "reasoning": "Why this trade makes sense"
    }
  ]

Return ONLY valid JSON. No markdown. Example output:
{
  "summary": "Summary text here",
  "key_points": ["Point 1", "Point 2", "Point 3"],
  "sentiment": "BULLISH",
  "impact_score": 7,
  "key_entities": ["Company A", "Company B"],
  "trade_ideas": [{"symbol": "RELIANCE", "direction": "LONG", "reasoning": "Strong earnings"}]
}
"""
        
        user_prompt = f"Headline: {headline}\n\nContent: {content}"
        
        start_time = time.time()
        prompt_tokens = 0
        completion_tokens = 0
        total_tokens = 0
        cost_usd = 0.0

        try:
            analysis_data = _call_llm_json(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                model=self.model_name
            )
            
            response_time_ms = int((time.time() - start_time) * 1000)
            
            # extract token usage from _usage key (attached by preciz)
            usage = analysis_data.pop("_usage", None) if isinstance(analysis_data, dict) else None
            prompt_tokens = usage.get("prompt_tokens", 0) if usage else 0
            completion_tokens = usage.get("completion_tokens", 0) if usage else 0
            total_tokens = usage.get("total_tokens", 0) if usage else 0
            cost_usd = self._calculate_cost(self.model_name, prompt_tokens, completion_tokens)
            
            result = {
                "summary": analysis_data.get("summary", "Summary unavailable."),
                "key_points": analysis_data.get("key_points", []),
                "sentiment": analysis_data.get("sentiment", "NEUTRAL").upper(),
                "impact_score": int(analysis_data.get("impact_score", 0)),
                "key_entities": analysis_data.get("key_entities", []),
                "trade_ideas": analysis_data.get("trade_ideas", [])
            }
            
            if result["sentiment"] not in ["BULLISH", "BEARISH", "NEUTRAL"]:
                 result["sentiment"] = "NEUTRAL"
                 
            self._save_to_cache(cache_key, url, headline, result)
            
            self._log_llm_run(
                url=url,
                model=self.model_name,
                headline=headline,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                cost_usd=cost_usd,
                response_time_ms=response_time_ms,
                status="success"
            )
            
            return result
            
        except Exception as e:
            response_time_ms = int((time.time() - start_time) * 1000)
            error_message = str(e)
            
            self._log_llm_run(
                url=url,
                model=self.model_name,
                headline=headline,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                cost_usd=cost_usd,
                response_time_ms=response_time_ms,
                status="failed",
                error_message=error_message
            )
            
            print(f"LLM Analysis failed: {e}")
            return {
                "summary": f"Failed to analyze article: {str(e)}",
                "sentiment": "NEUTRAL",
                "impact_score": 0,
                "key_entities": [],
                "trade_ideas": []
            }

article_analyzer = ArticleAnalyzer()
