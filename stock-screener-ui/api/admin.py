import logging
from fastapi import APIRouter, Depends, HTTPException
from db.database import SessionLocal, get_db
from db.models import LLMRun, User
from sqlalchemy import func
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List
from pydantic import BaseModel

router = APIRouter(prefix="/api/admin", tags=["admin"])
logger = logging.getLogger(__name__)


class LLMStats(BaseModel):
    total_runs: int
    total_tokens: int
    total_cost_usd: float
    avg_response_time_ms: float
    success_rate: float
    runs_by_model: Dict[str, Any]
    runs_by_day: List[Dict[str, Any]]


class LLMStatsResponse(BaseModel):
    stats: LLMStats
    recent_runs: List[Dict[str, Any]]


def require_admin(db: Session = Depends(get_db)):
    """Dependency to require admin access."""
    user = db.query(User).filter(User.is_admin == True).first()
    if not user:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@router.get("/llm-stats", response_model=LLMStatsResponse)
def get_llm_stats(db: Session = Depends(get_db), admin = Depends(require_admin)):
    """Get LLM usage statistics."""
    total_runs = db.query(LLMRun).count()
    
    if total_runs == 0:
        return LLMStatsResponse(
            stats=LLMStats(
                total_runs=0,
                total_tokens=0,
                total_cost_usd=0.0,
                avg_response_time_ms=0.0,
                success_rate=0.0,
                runs_by_model={},
                runs_by_day=[]
            ),
            recent_runs=[]
        )
    
    agg_result = db.query(
        func.sum(LLMRun.total_tokens).label('total_tokens'),
        func.sum(LLMRun.cost_usd).label('total_cost'),
        func.avg(LLMRun.response_time_ms).label('avg_response_time')
    ).first()
    
    total_tokens = agg_result.total_tokens or 0
    total_cost = agg_result.total_cost or 0.0
    avg_response_time = agg_result.avg_response_time or 0.0
    
    success_count = db.query(LLMRun).filter(LLMRun.status == 'success').count()
    success_rate = (success_count / total_runs * 100) if total_runs > 0 else 0.0
    
    runs_by_model = {}
    model_results = db.query(
        LLMRun.model,
        func.count('*').label('runs'),
        func.sum(LLMRun.total_tokens).label('tokens'),
        func.sum(LLMRun.cost_usd).label('cost_usd')
    ).group_by(LLMRun.model).all()
    
    for row in model_results:
        runs_by_model[row.model] = {
            "runs": row.runs,
            "tokens": row.tokens or 0,
            "cost_usd": round(row.cost_usd or 0.0, 4)
        }
    
    runs_by_day = []
    day_results = db.query(
        func.date(LLMRun.created_at).label('date'),
        func.count('*').label('runs'),
        func.sum(LLMRun.total_tokens).label('tokens'),
        func.sum(LLMRun.cost_usd).label('cost_usd')
    ).filter(
        LLMRun.created_at >= datetime.now(timezone.utc) - timedelta(days=7)
    ).group_by(
        func.date(LLMRun.created_at)
    ).order_by(
        func.date(LLMRun.created_at).desc()
    ).all()
    
    for row in day_results:
        runs_by_day.append({
            "date": str(row.date),
            "runs": row.runs,
            "tokens": row.tokens or 0,
            "cost_usd": round(row.cost_usd or 0.0, 4)
        })
    
    recent_runs = db.query(LLMRun).order_by(LLMRun.created_at.desc()).limit(10).all()
    
    return LLMStatsResponse(
        stats=LLMStats(
            total_runs=total_runs,
            total_tokens=total_tokens or 0,
            total_cost_usd=round(total_cost or 0.0, 6),
            avg_response_time_ms=round(avg_response_time or 0.0, 2),
            success_rate=round(success_rate, 2),
            runs_by_model=runs_by_model,
            runs_by_day=runs_by_day
        ),
        recent_runs=[run.to_dict() for run in recent_runs]
    )
