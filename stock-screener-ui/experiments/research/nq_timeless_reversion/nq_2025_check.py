import json,sys
from pathlib import Path
sys.path.insert(0,'/home/mysyntax/Documents/Alphashri/stock-screener-ui/experiments'); sys.path.insert(0,'/home/mysyntax/Documents/Alphashri/stock-screener-ui')
from timeless_reversion import ReversionConfig,fair_price_at_et_open,run_timeless_reversion
from scripts.smc_tick_eval import build_1m_bars
ROOT=Path('/home/mysyntax/Documents/Alphashri/stock-screener-ui/experiments')
configs={
 'baseline':ReversionConfig(entry_start='09:30',entry_end='11:00'),
 'range30':ReversionConfig(entry_start='09:30',entry_end='11:00',max_signal_range_points=30),
 'drive40':ReversionConfig(entry_start='09:30',entry_end='11:00',opening_drive_max_points=40),
 'drive30_range30':ReversionConfig(entry_start='09:30',entry_end='11:00',opening_drive_max_points=30,max_signal_range_points=30),
 'range30_loss1':ReversionConfig(entry_start='09:30',entry_end='11:00',max_signal_range_points=30,max_consecutive_losses=1),
}
for name,cfg in configs.items():
 alltr=[]
 for p in sorted((ROOT/'data'/'duka_cache').glob('usatechidxusd_2025-*.json')):
  d=p.stem.rsplit('_',1)[-1]; raw=json.load(open(p)); bars=build_1m_bars(raw)
  try: fair=fair_price_at_et_open(bars,d)
  except ValueError: continue
  alltr += run_timeless_reversion(bars,raw,fair_price=fair,config=cfg)
 w=sum(t['pnl']>0 for t in alltr); l=len(alltr)-w; pts=sum(t['pnl'] for t in alltr)
 print(name,'trades',len(alltr),'W/L',w,l,'points',pts,'usd',pts*12)
