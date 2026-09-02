from fastapi import APIRouter, Query
import time

router = APIRouter(prefix="/api/poc", tags=["poc"])

_cache: dict = {}
_TTL = 300

@router.get("/nq")
def get_nq(
    period: str = Query(default="5d"),
    interval: str = Query(default="15m"),
):
    key = f"{period}:{interval}"
    now = time.time()
    if key in _cache and now - _cache[key]["ts"] < _TTL:
        return _cache[key]["data"]
    try:
        import yfinance as yf
        df = yf.download("NQ=F", period=period, interval=interval, progress=False, auto_adjust=True)
        if df.empty:
            return {"symbol": "NQ=F", "interval": interval, "bars": [], "error": "empty from yfinance"}
        # yfinance with single ticker returns MultiIndex columns; flatten
        if hasattr(df.columns, "levels"):
            df.columns = df.columns.droplevel(1) if df.columns.nlevels > 1 else df.columns
        bars = []
        for ts, row in df.iterrows():
            try:
                t = int(ts.timestamp())
                o = float(row["Open"]) if "Open" in row else float(row["open"])
                h = float(row["High"]) if "High" in row else float(row["high"])
                l = float(row["Low"]) if "Low" in row else float(row["low"])
                c = float(row["Close"]) if "Close" in row else float(row["close"])
                v = int(row["Volume"]) if "Volume" in row else 0
                if not all(map(lambda x: x == x, [o, h, l, c])):  # NaN check
                    continue
                bars.append({"time": t, "open": round(o, 2), "high": round(h, 2), "low": round(l, 2), "close": round(c, 2), "volume": v})
            except Exception:
                continue
        data = {"symbol": "NQ=F", "interval": interval, "count": len(bars), "bars": bars}
        _cache[key] = {"ts": now, "data": data}
        return data
    except Exception as e:
        return {"symbol": "NQ=F", "interval": interval, "bars": [], "error": str(e)}
