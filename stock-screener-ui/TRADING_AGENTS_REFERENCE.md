# TradingAgents API Service

HTTP API wrapper for the TradingAgents multi-agent trading framework.

## Quickstart

1. Create virtual environment:
```bash
cd /Users/developer/Documents/algos/personal/earner/stock-screener-ui/tradingagents-api
python3 -m venv venv
source venv/bin/activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Configure API keys:
```bash
cp .env.example .env
# Edit .env with your DEEPSEEK_API_KEY and ALPHA_VANTAGE_API_KEY
```

4. Run the server:
```bash
uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
```

5. Test it:
```bash
curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -d '{"ticker":"NVDA","date":"2026-01-15","llm_provider":"deepseek"}'
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/analyze` | POST | Run full analysis for a ticker |
| `/config` | GET | Get default config |

## Request Body (POST /analyze)

```json
{
  "ticker": "NVDA",
  "date": "2026-01-15",
  "analysts": ["market", "news", "fundamentals"],
  "debate_rounds": 1,
  "llm_provider": "deepseek",
  "deep_think_model": "deepseek-chat",
  "quick_think_model": "deepseek-chat",
  "output_language": "English",
  "use_alpha_vantage": false
}
```

## Response

```json
{
  "ticker": "NVDA",
  "date": "2026-01-15",
  "decision": "BUY - Strong bullish signals from all agents...",
  "reports": {
    "market_analyst": "...",
    "news_analyst": "...",
    "fundamentals_analyst": "...",
    "bull_researcher": "...",
    "bear_researcher": "...",
    "research_manager": "...",
    "trader": "...",
    "risk_aggressive": "...",
    "risk_conservative": "...",
    "risk_neutral": "...",
    "portfolio_manager": "..."
  }
}
```

## License

This API wrapper is licensed under the Apache 2.0 license, as it builds upon and reuses the TradingAgents framework (also Apache 2.0). See the [LICENSE](LICENSE) file for full terms.

**Key points:**
- **Commercial use allowed** — you may use this software for commercial purposes
- **Attribution required** — you must include the original copyright and license notices

This project is a derivative work that integrates TradingAgents as a library. The TradingAgents framework itself is developed by Yijia Xiao, Edward Sun, Di Luo, Wei Wang, and contributors, and is also available under the Apache 2.0 license.
