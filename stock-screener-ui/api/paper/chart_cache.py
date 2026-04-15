import pickle
from pathlib import Path

import pandas as pd

CACHE_DIR = Path(__file__).parent.parent.parent / "experiments" / "data" / "chart_cache"


def get_cached_candles(symbol: str, date: str) -> pd.DataFrame | None:
    path = CACHE_DIR / date / f"{symbol.upper()}.pkl"
    if not path.exists():
        return None
    with open(path, "rb") as f:
        df = pickle.load(f)
    if not isinstance(df, pd.DataFrame) or df.empty:
        return None
    return df


def save_cached_candles(symbol: str, date: str, df: pd.DataFrame) -> None:
    if df is None or df.empty:
        return
    path = CACHE_DIR / date / f"{symbol.upper()}.pkl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        pickle.dump(df, f)
