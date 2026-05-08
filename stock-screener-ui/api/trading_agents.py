"""
TradingAgents API Router for Stock Screener Backend

Provides endpoints for multi-agent stock analysis using TradingAgents framework.
Integrates with the existing backend for authentication and SSE streaming.

Run: tradingagents must be installed in the environment
"""
import os
import json
import logging
import threading
import asyncio
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List, AsyncGenerator
from collections import deque
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from api.auth import get_current_user
from db.database import get_db
from db.models import User, ChatConversation, ChatMessage
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/trading-agents", tags=["Trading Agents"])

# Analysis cache: JSON files keyed by TICKER_DATE in experiments/data/analysis_cache/
_CACHE_DIR = Path(__file__).resolve().parent.parent / "experiments" / "data" / "analysis_cache"
_CACHE_TTL_SECONDS = 86400  # 24 hours

def _cache_key(ticker: str, date: str) -> str:
    return f"{ticker.upper()}_{date}"

def _cache_path(ticker: str, date: str) -> Path:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return _CACHE_DIR / f"{_cache_key(ticker, date)}.json"

def _get_cached(ticker: str, date: str) -> Optional[Dict]:
    path = _cache_path(ticker, date)
    if path.exists():
        try:
            with open(path) as f:
                entry = json.load(f)
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(entry["timestamp"])).total_seconds()
            if age < _CACHE_TTL_SECONDS:
                logger.info(f"Cache HIT for {_cache_key(ticker, date)} ({age:.0f}s old)")
                return entry
            else:
                path.unlink(missing_ok=True)
        except Exception as e:
            logger.warning(f"Cache read error: {e}")
    return None

def _set_cache(ticker: str, date: str, data: Dict):
    path = _cache_path(ticker, date)
    data["timestamp"] = datetime.now(timezone.utc).isoformat()
    try:
        with open(path, "w") as f:
            json.dump(data, f, default=str, indent=2)
        logger.info(f"Cached result for {_cache_key(ticker, date)}")
    except Exception as e:
        logger.warning(f"Cache write error: {e}")

# Try to import tradingagents, gracefully handle if not available
_tradingagents_available = False
TradingAgentsGraph = None
TradingAgentsConfig = None

try:
    from tradingagents.graph import TradingAgentsGraph
    from tradingagents.config import TradingAgentsConfig
    _tradingagents_available = True
except ImportError as e:
    logger.warning(f"TradingAgents not available: {e}")
    logger.warning("Install with: pip install tradingagents")


# ============================================================================
# Pydantic Models
# ============================================================================

class AnalysisRequest(BaseModel):
    ticker: str = Field(..., description="Stock ticker symbol (e.g., NVDA, AAPL)")
    date: Optional[str] = Field(None, description="Date for analysis (YYYY-MM-DD)")
    analysts: List[str] = Field(
        default=["market", "news", "fundamentals"],
        description="List of analysts to run"
    )
    debate_rounds: int = Field(default=1, ge=1, le=5, description="Number of debate rounds")
    llm_provider: str = Field(default="openai", description="LLM provider")
    deep_think_model: Optional[str] = Field(None, description="Model for deep thinking")
    quick_think_model: Optional[str] = Field(None, description="Model for quick responses")
    output_language: str = Field(default="English", description="Output language")
    use_alpha_vantage: bool = Field(default=False, description="Use Alpha Vantage for data")
    save_reports: bool = Field(default=True, description="Save reports to disk")


class ChatRequest(BaseModel):
    message: str = Field(..., description="User message")
    ticker: Optional[str] = Field(None, description="Optional stock ticker context")
    conversation_id: Optional[str] = Field(None, description="Conversation ID for context")


class ConfigResponse(BaseModel):
    available_providers: List[str]
    default_provider: str
    available_models: Dict[str, List[str]]
    default_analysts: List[str]


class AnalysisResponse(BaseModel):
    ticker: str
    date: str
    decision: str
    reports: Dict[str, Any]
    stats: Dict[str, Any]
    messages: Optional[List[Dict]] = None
    tool_calls: Optional[List[Dict]] = None


class ChatResponse(BaseModel):
    response: str
    conversation_id: str
    sources: Optional[List[Dict]] = None
    should_analyze: Optional[str] = None


class StreamEvent(BaseModel):
    event: str
    data: Dict[str, Any]


# ============================================================================
# Callback Handlers
# ============================================================================

from langchain_core.callbacks import BaseCallbackHandler as _BaseCallbackHandler

class StatsCallbackHandler(_BaseCallbackHandler):
    """Tracks LLM calls, tool calls, and token usage."""

    def __init__(self):
        super().__init__()
        self._lock = threading.Lock()
        self.llm_calls = 0
        self.tool_calls = 0
        self.tokens_in = 0
        self.tokens_out = 0

    def on_llm_start(self, serialized: Dict[str, Any], prompts: List[str], **kwargs):
        with self._lock:
            self.llm_calls += 1

    def on_chat_model_start(self, serialized: Dict[str, Any], messages: List[List[Any]], **kwargs):
        with self._lock:
            self.llm_calls += 1

    def on_llm_end(self, response: Any, **kwargs):
        pass

    def on_tool_start(self, serialized: Dict[str, Any], input_str: str, **kwargs):
        with self._lock:
            self.tool_calls += 1

    def get_stats(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "llm_calls": self.llm_calls,
                "tool_calls": self.tool_calls,
                "tokens_in": self.tokens_in,
                "tokens_out": self.tokens_out,
            }


class MessageBuffer:
    """Tracks agent messages and progress during analysis."""

    ANALYST_MAPPING = {
        "market": "Market Analyst",
        "social": "Social Analyst",
        "news": "News Analyst",
        "fundamentals": "Fundamentals Analyst",
    }

    def __init__(self, max_length: int = 100):
        self.messages = deque(maxlen=max_length)
        self.tool_calls = deque(maxlen=max_length)
        self.agent_status: Dict[str, str] = {}
        self.report_sections: Dict[str, str] = {}

    def init_for_analysis(self, selected_analysts: List[str]):
        self.agent_status = {
            self.ANALYST_MAPPING.get(a, a): "pending"
            for a in selected_analysts
        }
        self.agent_status["Research Team"] = "pending"
        self.agent_status["Trading Team"] = "pending"
        self.agent_status["Risk Management"] = "pending"
        self.agent_status["Portfolio Manager"] = "pending"

    def update_agent_status(self, agent: str, status: str):
        self.agent_status[agent] = status

    def add_message(self, role: str, content: str):
        self.messages.append({
            "timestamp": datetime.now().isoformat(),
            "role": role,
            "content": content,
        })

    def add_tool_call(self, tool_name: str, args: Dict[str, Any]):
        self.tool_calls.append({
            "timestamp": datetime.now().isoformat(),
            "tool": tool_name,
            "args": args,
        })

    def get_progress(self) -> Dict[str, Any]:
        completed = sum(1 for s in self.agent_status.values() if s == "completed")
        total = len(self.agent_status) if self.agent_status else 1
        return {
            "percent": int((completed / total) * 100),
            "agents": self.agent_status,
        }


# ============================================================================
# Endpoints
# ============================================================================

@router.get("/config", response_model=ConfigResponse)
async def get_config():
    """Get available configuration options."""
    if not _tradingagents_available:
        raise HTTPException(
            status_code=503,
            detail="TradingAgents not available. Please install tradingagents package."
        )

    return ConfigResponse(
        available_providers=["openai", "anthropic", "google_genai", "xai", "huggingface", "openrouter", "ollama", "litellm", "deepseek"],
        default_provider="openai",
        available_models={
            "openai": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
            "anthropic": ["claude-sonnet-4-6", "claude-3-5-sonnet-20241022", "claude-3-opus-20240229"],
            "google_genai": ["gemini-2.0-flash", "gemini-1.5-pro"],
            "xai": ["grok-beta"],
            "huggingface": ["meta-llama/Llama-3.1-8B"],
            "openrouter": ["openai/gpt-4o"],
            "ollama": ["llama3.1", "mistral"],
            "litellm": ["gpt-4o"],
        },
        default_analysts=["market", "news", "fundamentals"],
    )


@router.post("/analyze", response_model=AnalysisResponse)
async def analyze_stock(
    request: AnalysisRequest,
):
    """Run full multi-agent stock analysis."""
    if not _tradingagents_available:
        raise HTTPException(
            status_code=503,
            detail="TradingAgents not available. Please install tradingagents package."
        )

    analysis_date = request.date or datetime.now().strftime("%Y-%m-%d")

    cached = _get_cached(request.ticker, analysis_date)
    if cached:
        return AnalysisResponse(
            ticker=request.ticker,
            date=analysis_date,
            decision=cached["decision"],
            reports=cached.get("reports", {}),
            stats=cached.get("stats", {}),
        )

    try:
        provider = request.llm_provider.lower()
        if provider == "deepseek":
            provider = "litellm"
        config = TradingAgentsConfig(
            llm_provider=provider,
            deep_think_llm=request.deep_think_model or "deepseek/deepseek-chat",
            quick_think_llm=request.quick_think_model or "deepseek/deepseek-chat",
            reasoning_effort="low",
            response_language=request.output_language.lower()[:2] if request.output_language else "en",
            max_debate_rounds=request.debate_rounds,
            max_risk_discuss_rounds=1,
            max_recur_limit=25,
        )

        stats_handler = StatsCallbackHandler()
        message_buffer = MessageBuffer()
        message_buffer.init_for_analysis(request.analysts)

        ta = TradingAgentsGraph(
            selected_analysts=request.analysts,
            config=config,
            debug=True,
            callbacks=[stats_handler],
        )

        logger.info(f"Starting analysis for {request.ticker} on {analysis_date}")

        init_state = ta.propagator.create_initial_state(request.ticker, analysis_date)
        args = ta.propagator.get_graph_args(callbacks=[stats_handler])

        trace = []
        for chunk in ta.graph.stream(init_state, **args):
            trace.append(chunk)

        raw_state = trace[-1] if trace else {}
        decision = "HOLD"
        reports = {}

        try:
            from tradingagents.agents.utils.agent_states import AgentState
            if isinstance(raw_state, dict):
                state = AgentState.model_validate(raw_state)
            else:
                state = raw_state
            decision = getattr(state, "final_trade_decision", "HOLD")
            reports = {
                k: getattr(state, v, "")
                for k, v in {
                    "market": "market_report",
                    "sentiment": "sentiment_report",
                    "news": "news_report",
                    "fundamentals": "fundamentals_report",
                    "trader_plan": "trader_investment_plan",
                    "investment_plan": "investment_plan",
                }.items()
            }
        except Exception:
            pass

        _set_cache(request.ticker, analysis_date, {
            "decision": decision,
            "reports": reports,
            "stats": stats_handler.get_stats(),
        })

        return AnalysisResponse(
            ticker=request.ticker,
            date=analysis_date,
            decision=decision,
            reports=reports,
            stats=stats_handler.get_stats(),
            messages=list(message_buffer.messages)[:50],
            tool_calls=list(message_buffer.tool_calls)[:50],
        )

    except Exception as e:
        logger.error(f"Analysis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stream/{ticker}")
async def stream_analysis(
    ticker: str,
    date: Optional[str] = None,
    analysts: Optional[str] = "market,news,fundamentals",
    llm_provider: str = "openai",
):
    """SSE endpoint for streaming analysis progress."""
    if not _tradingagents_available:
        raise HTTPException(
            status_code=503,
            detail="TradingAgents not available."
        )

    analysis_date = date or datetime.now().strftime("%Y-%m-%d")
    analyst_list = [a.strip() for a in analysts.split(",")]

    async def event_generator():
        def se(data: dict) -> str:
            return json.dumps(data, default=str)

        yield {
            "event": "connected",
            "data": se({"ticker": ticker, "date": analysis_date, "status": "starting"})
        }

        cached = _get_cached(ticker, analysis_date)
        if cached:
            yield {
                "event": "status",
                "data": se({"message": "Returning cached analysis..."})
            }
            yield {
                "event": "complete",
                "data": se({
                    "ticker": ticker,
                    "date": analysis_date,
                    "decision": cached["decision"],
                    "reports": cached.get("reports", {}),
                    "stats": cached.get("stats", {}),
                })
            }
            return

        try:
            provider = llm_provider.lower()
            if provider == "deepseek":
                provider = "litellm"
            config = TradingAgentsConfig(
                llm_provider=provider,
                deep_think_llm="deepseek/deepseek-chat",
                quick_think_llm="deepseek/deepseek-chat",
                reasoning_effort="low",
                max_debate_rounds=1,
                max_risk_discuss_rounds=1,
                max_recur_limit=25,
            )

            stats_handler = StatsCallbackHandler()
            message_buffer = MessageBuffer()
            message_buffer.init_for_analysis(analyst_list)

            yield {
                "event": "status",
                "data": se({"message": "Initializing TradingAgents..."})
            }

            ta = TradingAgentsGraph(
                selected_analysts=analyst_list,
                config=config,
                debug=True,
                callbacks=[stats_handler],
            )

            yield {
                "event": "status",
                "data": se({"message": f"Running {len(analyst_list)} analysts..."})
            }

            init_state = ta.propagator.create_initial_state(ticker, analysis_date)
            args = ta.propagator.get_graph_args(callbacks=[stats_handler])

            total_steps = len(analyst_list) * 3 + 5
            current_step = 0

            last_chunk = None
            for chunk in ta.graph.stream(init_state, **args):
                last_chunk = chunk
                current_step += 1
                progress = min(int((current_step / total_steps) * 100), 95)

                yield {
                    "event": "progress",
                    "data": se({
                        "percent": progress,
                        "step": current_step,
                        "total": total_steps,
                    })
                }

                if chunk and isinstance(chunk, dict):
                    for key, value in chunk.items():
                        yield {
                            "event": "report",
                            "data": se({
                                "section": key,
                                "content": str(value)[:500] if value else "",
                            })
                        }
                        if key == "messages" and isinstance(value, (list, tuple)):
                            for msg in value:
                                ak = getattr(msg, "additional_kwargs", {}) or {}
                                for tc in ak.get("tool_calls", []):
                                    if hasattr(tc, "function"):
                                        tc_name = tc.function.name if hasattr(tc.function, "name") else ""
                                        tc_args = tc.function.arguments if hasattr(tc.function, "arguments") else {}
                                    else:
                                        tc_name = tc.get("name", "") or tc.get("function", {}).get("name", "")
                                        tc_args = tc.get("args", {}) or tc.get("function", {}).get("arguments", "")
                                    if isinstance(tc_args, str):
                                        try: tc_args = json.loads(tc_args)
                                        except: pass
                                    if tc_name:
                                        yield {
                                            "event": "tool_call",
                                            "data": se({
                                                "tool": tc_name.replace("_", " ").title(),
                                                "args": tc_args,
                                                "agent": "Agent",
                                            })
                                        }

            stats = stats_handler.get_stats()
            decision = "HOLD"
            reports = {}

            try:
                from tradingagents.agents.utils.agent_states import AgentState
                if last_chunk:
                    state = AgentState.model_validate(last_chunk) if isinstance(last_chunk, dict) else last_chunk
                    decision = getattr(state, "final_trade_decision", "HOLD")
                    reports = {
                        k: getattr(state, v, "")
                        for k, v in {
                            "market": "market_report",
                            "sentiment": "sentiment_report",
                            "news": "news_report",
                            "fundamentals": "fundamentals_report",
                            "trader_plan": "trader_investment_plan",
                            "investment_plan": "investment_plan",
                        }.items()
                    }
            except Exception as exc:
                logger.warning(f"Report extraction failed: {exc}")

            yield {
                "event": "complete",
                "data": se({
                    "ticker": ticker,
                    "date": analysis_date,
                    "decision": decision,
                    "reports": {k: str(v)[:1000] for k, v in reports.items() if v},
                    "stats": stats,
                })
            }

            _set_cache(ticker, analysis_date, {
                "decision": decision,
                "reports": {k: str(v)[:1000] for k, v in reports.items() if v},
                "stats": stats,
            })

        except Exception as e:
            logger.error(f"Streaming analysis failed", exc_info=True)
            yield {
                "event": "error",
                "data": se({"error": str(e)[:300]})
            }

    return EventSourceResponse(event_generator())


@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
):
    """Conversational chat about stocks. Uses OpenRouter free model."""
    try:
        from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
        from langchain_openrouter import ChatOpenRouter
        from langchain_litellm import ChatLiteLLM

        has_deepseek = bool(os.environ.get("DEEPSEEK_API_KEY"))

        if has_deepseek:
            model = "deepseek/deepseek-chat"
            llm = ChatLiteLLM(model=model, temperature=0.7, max_tokens=1024)
        else:
            model = "openai/gpt-oss-20b:free"
            llm = ChatOpenRouter(model=model, temperature=0.7, max_tokens=512)

        system_prompt = (
            "You are a helpful stock market assistant. Answer questions about stocks, "
            "markets, and trading concisely. You have a tool `analyze_stock` that runs "
            "a deep multi-agent analysis on any stock ticker. When the user asks about "
            "a specific stock (e.g., 'what about NVDA?', 'analyze TCS', 'NVDA report', "
            "'should I buy Reliance?'), call the analyze_stock tool with the ticker symbol. "
            "For casual chat (greetings, general questions), just respond naturally. "
            "Keep responses under 200 words unless asked for detail. "
            "Current date: " + datetime.now().strftime("%Y-%m-%d")
        )

        messages = [SystemMessage(content=system_prompt)]
        if request.ticker:
            messages.append(HumanMessage(
                content=f"[Context: user is asking about {request.ticker}]\n{request.message}"
            ))
        else:
            messages.append(HumanMessage(content=request.message))

        llm_with_tools = llm.bind_tools([{
            "type": "function",
            "function": {
                "name": "analyze_stock",
                "description": "Run a deep multi-agent analysis on a stock ticker",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "ticker": {
                            "type": "string",
                            "description": "Stock ticker symbol (e.g., NVDA, TCS, AAPL)",
                        }
                    },
                    "required": ["ticker"],
                },
            },
        }])

        response = llm_with_tools.invoke(messages)
        conversation_id = request.conversation_id or f"chat_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

        # Check if LLM wants to call analyze_stock
        if hasattr(response, "tool_calls") and response.tool_calls:
            for tc in response.tool_calls:
                name = tc.get("name", "") if isinstance(tc, dict) else getattr(tc, "name", "")
                args = tc.get("args", {}) if isinstance(tc, dict) else getattr(tc, "args", {})
                if "analyze_stock" in name or name == "analyze_stock":
                    ticker = args.get("ticker", "") if isinstance(args, dict) else ""
                    if ticker:
                        return ChatResponse(
                            response=f"I'll run a full analysis on **{ticker.upper()}** for you.",
                            conversation_id=conversation_id,
                            sources=None,
                            should_analyze=ticker.upper(),
                        )

        response_text = response.content if hasattr(response, "content") else str(response)
        return ChatResponse(
            response=response_text,
            conversation_id=conversation_id,
            sources=None,
        )

    except ImportError:
        conversation_id = request.conversation_id or f"chat_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        return ChatResponse(
            response=f"I received: '{request.message}'. For stock analysis, try asking about a specific stock like NVDA or TCS.",
            conversation_id=conversation_id,
            sources=None,
        )
    except Exception as e:
        conversation_id = request.conversation_id or f"chat_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        return ChatResponse(
            response=f"I'm having trouble connecting right now. Please try again.",
            conversation_id=conversation_id,
            sources=None,
        )


# ============================================================================
# Chat History Endpoints
# ============================================================================

@router.get("/conversations")
async def list_conversations(
    db: Session = Depends(get_db),
):
    """List all conversations for the current user, most recent first."""
    convos = db.query(ChatConversation).order_by(ChatConversation.updated_at.desc()).all()
    return {"conversations": [c.to_dict() for c in convos]}


@router.post("/conversations")
async def create_conversation(
    title: str = "New Chat",
    db: Session = Depends(get_db),
):
    """Create a new chat conversation."""
    import uuid
    convo = ChatConversation(
        uuid=str(uuid.uuid4()),
        user_id=3,
        title=str(title),
    )
    db.add(convo)
    db.commit()
    db.refresh(convo)
    return convo.to_dict()


@router.get("/conversations/{conversation_id}/messages")
async def get_messages(
    conversation_id: str,
    db: Session = Depends(get_db),
):
    """Get all messages for a conversation."""
    convo = db.query(ChatConversation).filter(
        ChatConversation.uuid == conversation_id,
    ).first()
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"messages": [m.to_dict() for m in convo.messages]}


@router.post("/conversations/{conversation_id}/messages")
async def add_message(
    conversation_id: str,
    role: str = "user",
    content: str = "",
    ticker: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Add a message to a conversation."""
    import uuid
    convo = db.query(ChatConversation).filter(
        ChatConversation.uuid == conversation_id,
    ).first()
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")
    msg = ChatMessage(
        uuid=str(uuid.uuid4()),
        conversation_id=convo.id,
        role=str(role),
        content=str(content),
        ticker=str(ticker) if ticker else None,
    )
    db.add(msg)
    convo.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(msg)
    return msg.to_dict()


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
):
    """Delete a conversation and all its messages."""
    convo = db.query(ChatConversation).filter(
        ChatConversation.uuid == conversation_id,
    ).first()
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")
    db.delete(convo)
    db.commit()
    return {"status": "ok"}


@router.get("/health")
async def health_check():
    """Check if TradingAgents is available."""
    return {
        "status": "ok" if _tradingagents_available else "unavailable",
        "tradingagents_available": _tradingagents_available,
        "timestamp": datetime.now().isoformat(),
    }
