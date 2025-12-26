import pandas as pd
from rich.console import Console
from rich.table import Table

console = Console()

def clean_and_deduplicate(df: pd.DataFrame, sort_col: str = 'volume') -> pd.DataFrame:
    """
    Clean the dataframe and remove duplicates.
    Keeps the row with the highest value in `sort_col` (default: volume) for each unique name.
    """
    if df.empty:
        return df
        
    # Sort by the specified column (descending) to keep the "best" entry (e.g. highest volume)
    df = df.sort_values(sort_col, ascending=False)
    
    # Drop duplicates based on 'name', keeping the first (highest sort_col)
    if 'name' in df.columns:
        df = df.drop_duplicates(subset=['name'], keep='first')
        
    return df

def format_change(val):
    """Format change percentage with color."""
    color = "green" if val > 0 else "red"
    return f"[{color}]{val:+.2f}%[/{color}]"

def format_rsi(val):
    """Format RSI with color."""
    color = "red" if val > 80 else ("green" if val > 60 else "yellow")
    return f"[{color}]{val:.1f}[/{color}]"
