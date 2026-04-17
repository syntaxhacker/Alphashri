import pickle
import time
from pathlib import Path

import pandas as pd

CACHE_DIR = Path(__file__).parent.parent.parent / "experiments" / "data" / "chart_cache"
TODAY_TTL_SECONDS = 60


def _is_today(date: str) -> bool:
    from datetime import datetime
    import config
    return date == datetime.now(config.IST).strftime('%Y-%m-%d')


def _get_meta_path(path: Path) -> Path:
    return path.with_suffix('.meta')


def _read_meta(path: Path) -> dict:
    try:
        with open(_get_meta_path(path), "r") as f:
            import json
            return json.load(f)
    except Exception:
        return {}


def _write_meta(path: Path) -> None:
    try:
        import json
        with open(_get_meta_path(path), "w") as f:
            json.dump({"ts": time.time()}, f)
    except Exception:
        pass


def get_cached_candles(symbol: str, date: str) -> tuple[pd.DataFrame | None, bool]:
    path = CACHE_DIR / date / f"{symbol.upper()}.pkl"
    if not path.exists():
        return None, False
    try:
        with open(path, "rb") as f:
            df = pickle.load(f)
        if not isinstance(df, pd.DataFrame) or df.empty:
            return None, False
        if _is_today(date):
            meta = _read_meta(path)
            if time.time() - meta.get("ts", 0) > TODAY_TTL_SECONDS:
                return None, False
        return df, True
    except Exception:
        return None, False


def save_cached_candles(symbol: str, date: str, df: pd.DataFrame) -> None:
    if df is None or df.empty:
        return
    path = CACHE_DIR / date / f"{symbol.upper()}.pkl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        pickle.dump(df, f)
    if _is_today(date):
        _write_meta(path)
