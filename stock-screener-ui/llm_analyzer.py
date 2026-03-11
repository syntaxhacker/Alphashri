import os
import json
import hashlib
import sqlite3
from typing import Dict, Any, Optional
from openai import OpenAI
from dotenv import load_dotenv

# Load environment variables (expecting OPENROUTER_API_KEY)
load_dotenv()

class ArticleAnalyzer:
    """Class to analyze financial news articles using OpenRouter LLMs with SQLite caching."""
    
    def __init__(self, model_name: str = "z-ai/glm-4.5-air:free", db_path: str = "db/llm_cache.db"):
        api_key = os.getenv("OPENROUTER_API_KEY")
        if not api_key:
            print("WARNING: OPENROUTER_API_KEY environment variable not set. Analysis will fail.")
            
        self.model_name = model_name
        self.client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key or "dummy-key"
        )
        
        # Ensure db directory exists
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        """Initialize the SQLite database for caching LLM responses."""
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
            conn.commit()

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
- "sentiment": The overall market sentiment of the article. Must be exactly one of: "BULLISH", "BEARISH", or "NEUTRAL".
- "impact_score": An integer from 1 to 10 estimating the potential market-moving impact of this news (1 = trivial, 10 = massive market shock).
- "key_entities": A list of strings of the most important companies, individuals, or assets mentioned.
- "trade_ideas": A list of objects containing potential trades. If no clear trades exist, return an empty list. Format:
    [
      {
        "symbol": "Company Name or Ticker",
        "direction": "LONG" or "SHORT",
        "reasoning": "1 sentence explanation."
      }
    ]

Return ONLY valid JSON. Do not wrap it in markdown code blocks like ```json ... ```. Just the raw JSON object.
"""
        
        user_prompt = f"Headline: {headline}\n\nContent: {content}"
        
        try:
            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.1 # Low temperature for more deterministic JSON output
            )
            
            raw_content = response.choices[0].message.content.strip()
            
            # Clean up markdown if model didn't listen
            if raw_content.startswith("```json"):
                raw_content = raw_content[7:]
            elif raw_content.startswith("```"):
                raw_content = raw_content[3:]
            if raw_content.endswith("```"):
                raw_content = raw_content[:-3]
                
            raw_content = raw_content.strip()
            
            # Parse the JSON
            analysis_data = json.loads(raw_content)
            
            # Ensure required keys exist with default fallbacks
            result = {
                "summary": analysis_data.get("summary", "Summary unavailable."),
                "sentiment": analysis_data.get("sentiment", "NEUTRAL").upper(),
                "impact_score": int(analysis_data.get("impact_score", 0)),
                "key_entities": analysis_data.get("key_entities", []),
                "trade_ideas": analysis_data.get("trade_ideas", [])
            }
            
            # Validate sentiment string
            if result["sentiment"] not in ["BULLISH", "BEARISH", "NEUTRAL"]:
                 result["sentiment"] = "NEUTRAL"
                 
            # Store in SQLite cache
            self._save_to_cache(cache_key, url, headline, result)
            return result
            
        except Exception as e:
            print(f"LLM Analysis failed: {e}")
            if 'raw_content' in locals():
                print(f"Raw output was: {raw_content}")
            return {
                "summary": f"Failed to analyze article: {str(e)}",
                "sentiment": "NEUTRAL",
                "impact_score": 0,
                "key_entities": [],
                "trade_ideas": []
            }

# Global instance for use across the application
article_analyzer = ArticleAnalyzer()
