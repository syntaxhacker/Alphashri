import glob, sys
from pathlib import Path
import pandas as pd, yfinance as yf
ROOT=Path(__file__).resolve().parents[1]; sys.path.insert(0,str(ROOT))
from chart_patterns.engine import detect_patterns
syms=sorted(Path(p).stem.replace('b15m_2025_','') for p in glob.glob(str(ROOT/'experiments/data/b15m_2025_*.pkl')))
raw=yf.download([s+'.NS' for s in syms], period='1y', interval='1d', group_by='ticker', auto_adjust=False, progress=False, threads=True)
rows=[]
for s in syms:
    try: df=raw[s+'.NS'].dropna()
    except Exception: continue
    if len(df)<60: continue
    for h in detect_patterns(df,'1D',s):
        if h.pattern_id!='consolidation': continue
        if h.bars_ago>5: continue
        rows.append({'symbol':s,'status':h.status,'bars_ago':h.bars_ago,
                     'base_days':h.base_days,'range_%':round(h.range_pct,1),
                     'range_pos':round(h.range_pos,2),'breakout':round(h.breakout_level,1),
                     'last':round(float(df['Close'].iloc[-1]),1),
                     'dist_%':round((float(df['Close'].iloc[-1])/h.breakout_level-1)*100,1),
                     'target':round(h.target,1),'stop':round(h.stop,1),'end':h.end_date})
out=pd.DataFrame(rows)
print(out.sort_values(['bars_ago','range_%']).to_string(index=False) if len(out) else 'none')
