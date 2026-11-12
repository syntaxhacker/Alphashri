import yfinance as yf
import pandas as pd

SYMS = {
    "IRFC": "IRFC.NS",
    "NIFTY50": "^NSEI",
    "BANKNIFTY": "^NSEBANK",
    "SENSEX": "^BSESN",
    "NIFTY PSU BANK": "^CNXPSUBANK",
    "NIFTY MIDCAP 100": "^NSEMDCP50",
}

closes = {}
for name, ticker in SYMS.items():
    df = yf.download(ticker, start="2022-01-01", end="2026-11-12", auto_adjust=True,
                     progress=False)["Close"]
    if isinstance(df, pd.DataFrame):
        df = df.iloc[:, 0]
    df = df.dropna()
    df.index = df.index.tz_localize(None) if df.index.tz is not None else df.index
    closes[name] = df

closes = pd.DataFrame(closes).dropna(subset=["IRFC", "NIFTY50"])
closes.to_csv("/tmp/opencode/irfc_closes.csv")

windows = {"3M": 63, "6M": 126, "1Y": 252, "2Y": 504, "3Y": 756, "4.5Y(2022+)": None}

print("IRFC daily-return correlation vs indices (Pearson, close-to-close)\n")
for label, w in windows.items():
    d = closes.tail(w) if w else closes
    r = d.pct_change().dropna(how="all")
    irfc = r["IRFC"]
    print(f"--- {label}: {len(r)} sessions, {r.index[0].date()} -> {r.index[-1].date()} ---")
    for name in SYMS:
        if name == "IRFC":
            continue
        pair = pd.concat([irfc, r[name]], axis=1).dropna()
        if len(pair) < 20:
            print(f"  {name:<24} insufficient data")
            continue
        corr = pair.corr().iloc[0, 1]
        beta = pair.cov().iloc[0, 1] / pair.iloc[:, 1].var()
        print(f"  {name:<24} r={corr:+.3f}  R2={corr**2:.3f}  beta={beta:.2f}  n={len(pair)}")
    print()

r_all = closes.pct_change().dropna(how="all")
print("Annualised volatility (252d) and IRFC correlation over full window:")
for name in SYMS:
    vol = r_all[name].std() * 252 ** 0.5 * 100
    pair = pd.concat([r_all["IRFC"], r_all[name]], axis=1).dropna()
    print(f"  {name:<24} vol={vol:5.1f}%   r(full)={pair.corr().iloc[0,1]:+.3f}")

print("\nRolling 60-session IRFC vs NIFTY50 correlation (month-end):")
roll = r_all["IRFC"].rolling(60).corr(r_all["NIFTY50"]).dropna()
print(roll.resample("ME").last().tail(18).round(3).to_string())

print("\nRolling 60-session IRFC vs NIFTY PSU BANK correlation (month-end):")
roll2 = r_all["IRFC"].rolling(60).corr(r_all["NIFTY PSU BANK"]).dropna()
print(roll2.resample("ME").last().tail(18).round(3).to_string())

print("\nIRFC excess-return behaviour vs NIFTY50:")
for w, lab in [(252, "1Y"), (504, "2Y"), (756, "3Y")]:
    d = closes.tail(w)
    r = d.pct_change().dropna(how="all")
    print(f"  {lab}: IRFC mean daily {r['IRFC'].mean()*100:+.3f}%  NIFTY {r['NIFTY50'].mean()*100:+.3f}%  "
          f"beta {r.cov().loc['IRFC','NIFTY50']/r['NIFTY50'].var():.2f}  "
          f"up-day vs NIFTY-up-day hit {((r['IRFC']>0)&(r['NIFTY50']>0)).mean()*100:.0f}%")
