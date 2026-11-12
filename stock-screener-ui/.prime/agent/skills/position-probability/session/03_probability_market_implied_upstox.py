import json
import sys, os
sys.path.insert(0, os.path.abspath(".."))
sys.path.insert(0, os.path.abspath("."))
import numpy as np
import pandas as pd

from config import UPSTOX_API_KEY, UPSTOX_API_SECRET
from upstox_trader.config_and_utils.upstox_api import UpstoxAPI

rng = np.random.default_rng(101)
S_IRFC = 86.50
HORIZON = 8          # 12,13,16,17,18,19,20,23 Nov (Nov-23 is the NSE monthly expiry)

api = UpstoxAPI(api_key=UPSTOX_API_KEY, api_secret=UPSTOX_API_SECRET, quiet=True)
TO, FROM = "2026-11-11", "2024-01-01"

def up_daily(sym, itype="EQ", exch="NSE_EQ"):
    df = api.fetch_historical_data_v3(sym, unit="days", interval=1, to_date=TO, from_date=FROM,
                                      instrument_type=itype, exchange=exch)
    return None if (df is None or df.empty) else df[["open", "high", "low", "close", "volume"]].copy()

irfc = up_daily("IRFC"); nifty = up_daily("NIFTY", "INDEX", "NSE_INDEX")
midcp = up_daily("MIDCPNIFTY", "INDEX", "NSE_INDEX"); bank = up_daily("BANKNIFTY", "INDEX", "NSE_INDEX")
rail = up_daily("NIFTYRAILWAYS", "INDEX", "NSE_INDEX")

# today's session (Upstox daily excludes today) — closes from Upstox option-chain spots
spots = {}
for name, f in [("NIFTY", "nifty"), ("BANKNIFTY", "bank"), ("MIDCPNIFTY", "midcp")]:
    d = json.load(open(f"/tmp/opencode/{name.lower()}_chain_20261123.json"))
    spots[name] = d["spot"]
    summ = d["summary"]
    spots[name + "_atmiv"] = summ["atm_iv"]
    spots[name + "_exp"] = summ["expected_move"]["range"] / 2 / d["spot"]   # 1-sigma % from API
    spots[name + "_maxpain"] = summ["max_pain"]
    spots[name + "_pcr"] = summ["pcr"]

def append_today(df, sym, px):
    ts = pd.Timestamp("2026-11-11", tz=df.index.tz)
    df.loc[ts] = [px, px, px, px, 0.0]

irfc.loc[pd.Timestamp("2026-11-11", tz=irfc.index.tz)] = [86.50, 89.93, 83.70, 86.50, 78906085.0]
append_today(nifty, "NIFTY", spots["NIFTY"])
append_today(midcp, "MIDCPNIFTY", spots["MIDCPNIFTY"])
append_today(bank, "BANKNIFTY", spots["BANKNIFTY"])

r = lambda d: d["close"].pct_change().dropna()
r_i, r_n, r_m, r_b = r(irfc), r(nifty), r(midcp), r(bank)
r_rail = r(rail)

print("=== UPSTOX SNAPSHOT 11-Nov-2026 ===")
print(f"IRFC {irfc['close'].iloc[-1]:.2f} | NIFTY {nifty['close'].iloc[-1]:,.2f} | "
      f"MIDCPNIFTY {midcp['close'].iloc[-1]:,.2f} | BANKNIFTY {bank['close'].iloc[-1]:,.2f} | "
      f"RAILWAYS PSU {rail['close'].iloc[-1]:,.2f}")

print("\n=== IRFC betas vs UPSTOX INDICES ===")
for lbl, rr, w in [("NIFTY 50", r_n, 252), ("NIFTY 50", r_n, 60), ("NIFTY MIDCAP 100", r_m, 252),
                   ("NIFTY MIDCAP 100", r_m, 60), ("BANKNIFTY", r_b, 252), ("BANKNIFTY", r_b, 60),
                   ("NIFTY PSU BANK", r(rail).rename('x'), 60)]:
    if lbl == "NIFTY PSU BANK":
        continue
    df_ = pd.concat([r_i, rr], axis=1).dropna().tail(w)
    b = df_.iloc[:, 0].cov(df_.iloc[:, 1]) / df_.iloc[:, 1].var()
    c = df_.corr().iloc[0, 1]
    print(f"  {lbl:<20} {w:>3}d: beta {b:5.2f}  corr {c:+.2f}  n={len(df_)}")
df_ = pd.concat([r_i, r(rail)], axis=1).dropna().tail(252)
print(f"  {'NIFTY RAILWAYS PSU':<20} 252d: beta {df_.iloc[:,0].cov(df_.iloc[:,1])/df_.iloc[:,1].var():5.2f} "
      f" corr {df_.corr().iloc[0,1]:+.2f}  n={len(df_)}")

# multi-index regression (252d) for the market-implied model
X = pd.concat([r_n.rename("NIFTY"), r_m.rename("MIDCP"), r_b.rename("BANK")], axis=1)
D = pd.concat([r_i.rename("IRFC"), X], axis=1).dropna().tail(252)
A = np.column_stack([np.ones(len(D)), D[["NIFTY", "MIDCP", "BANK"]].values])
coef, *_ = np.linalg.lstsq(A, D["IRFC"].values, rcond=None)
alpha_d, betas = coef[0], coef[1:]
resid = D["IRFC"].values - A @ coef
sig_u_d = resid.std(ddof=4)
print(f"\nOLS 252d: IRFC = {alpha_d*252:+.2%} + {betas[0]:.2f}*NIFTY + {betas[1]:.2f}*MIDCP + {betas[2]:.2f}*BANK "
      f"| residual daily sd {sig_u_d*100:.2f}% (ann {sig_u_d*np.sqrt(252)*100:.1f}%) | R2 {1-resid.var()/D['IRFC'].var():.2f}")

# ---------- market-implied distributions (Upstox chains, 23-Nov expiry) ----------
print("\n=== UPSTOX OPTION CHAINS, expiry 2026-11-23 (the target date) ===")
for name in ["NIFTY", "BANKNIFTY", "MIDCPNIFTY"]:
    d = json.load(open(f"/tmp/opencode/{name.lower()}_chain_20261123.json"))
    s = d["summary"]
    rows = []
    for rr_ in d["chain"]:
        ce, pe = rr_.get("ce") or {}, rr_.get("pe") or {}
        cl = (ce.get("market_data") or {}).get("ltp"); pl = (pe.get("market_data") or {}).get("ltp")
        if cl is not None and pl is not None:
            rows.append((rr_["strike"], cl, pl))
    t = pd.DataFrame(rows, columns=["k", "ce", "pe"]).dropna()
    t = t[(t.k > d["spot"] * 0.9) & (t.k < d["spot"] * 1.1)]
    atm = t.iloc[(t.k - d["spot"]).abs().argmin()]
    strad = atm["ce"] + atm["pe"]
    sig_strad = strad / (0.7979 * d["spot"])
    print(f"  {name:<11} spot {d['spot']:>10,.2f} | ATM IV {s['atm_iv']:5.2f}% | ATM straddle {strad:8.1f} "
          f"-> 1sigma {sig_strad*100:4.2f}% ({sig_strad*d['spot']:,.0f} pts) | API exp-move +-{s['expected_move']['range']/2:,.0f} "
          f"| max pain {s['max_pain']:,.0f} | PCR {s['pcr']:.2f}")

def straddle_sigma(name):
    d = json.load(open(f"/tmp/opencode/{name.lower()}_chain_20261123.json"))
    rows = []
    for rr_ in d["chain"]:
        ce, pe = rr_.get("ce") or {}, rr_.get("pe") or {}
        cl = (ce.get("market_data") or {}).get("ltp"); pl = (pe.get("market_data") or {}).get("ltp")
        if cl is not None and pl is not None:
            rows.append((rr_["strike"], cl, pl))
    t = pd.DataFrame(rows, columns=["k", "ce", "pe"]).dropna()
    t = t[(t.k > d["spot"] * 0.9) & (t.k < d["spot"] * 1.1)]
    atm = t.iloc[(t.k - d["spot"]).abs().argmin()]
    return (atm["ce"] + atm["pe"]) / (0.7979 * d["spot"])

sig_mkt = {
    "NIFTY": straddle_sigma("NIFTY"),
    "MIDCP": straddle_sigma("MIDCPNIFTY"),
    "BANK": straddle_sigma("BANKNIFTY"),
}
print("  market-implied 1-sigma (8 sessions):",
      {k: f"{v*100:.2f}%" for k, v in sig_mkt.items()})

# ---------- multivariate market-implied MC for IRFC ----------
hist = D[["NIFTY", "MIDCP", "BANK"]]
C = hist.corr().values
L = np.linalg.cholesky(C + 1e-12 * np.eye(3))
names = ["NIFTY", "MIDCP", "BANK"]
daily_sigma = np.array([sig_mkt[k] / np.sqrt(HORIZON) for k in names])

R = 0.055
DIV_I, DIV_N, DIV_M, DIV_B = 0.0266, 0.012, 0.011, 0.014
mu_idx = np.array([(R - DIV_N) * HORIZON / 252, (R - DIV_M) * HORIZON / 252, (R - DIV_B) * HORIZON / 252])
mu_i = (R - DIV_I) * HORIZON / 252

def mc_market_implied(n=300_000):
    z = rng.standard_normal((n, 3)) @ L.T
    idx_8 = z * daily_sigma + mu_idx
    r_i_tot = mu_i + idx_8 @ betas + rng.standard_normal(n) * sig_u_d * np.sqrt(HORIZON)
    return S_IRFC * np.exp(r_i_tot)

def mc_boot(returns, n=300_000):
    p = rng.choice(np.asarray(returns), size=(n, HORIZON), replace=True)
    return S_IRFC * np.cumprod(1 + p, axis=1)[:, -1]

def mc_ln(sig, mu, n=300_000):
    dt = 1 / 252
    z = rng.standard_normal((n, HORIZON))
    return S_IRFC * np.exp(np.cumsum((mu - .5 * sig ** 2) * dt + sig * np.sqrt(dt) * z, axis=1))[:, -1]

res = {
    "A market-implied (Upstox chains, 3-index OLS)": mc_market_implied(),
    "B physical bootstrap 2Y (Upstox)": mc_boot(r_i.values),
    "C physical bootstrap 60d (Upstox)": mc_boot(r_i.tail(60).values),
    "D lognormal physical 30% (Upstox vol)": mc_ln(r_i.tail(252).std() * np.sqrt(252), 0.0),
    "E lognormal risk-neutral 30% mu 2.84%": mc_ln(r_i.tail(252).std() * np.sqrt(252), R - DIV_I),
}

buckets = [(0, 78, "<78"), (78, 82, "78-82"), (82, 86.5, "82-86.5"), (86.5, 90, "86.5-90"),
           (90, 95, "90-95"), (95, 100, "95-100"), (100, 999, ">100")]
print("\n=== P(IRFC close on 23-Nov-2026) ===")
print(f"{'model':<42}" + "".join(f"{lab:>9}" for _, _, lab in buckets))
for name, t in res.items():
    print(f"{name:<42}" + "".join(f"{np.mean((t>a)&(t<=b))*100:8.1f}%" for a, b, _ in buckets))
term = np.concatenate(list(res.values()))
print(f"{'ENSEMBLE (5 models)':<42}" + "".join(f"{np.mean((term>a)&(term<=b))*100:8.1f}%" for a, b, _ in buckets))

print("\n=== KEY LEVELS (ensemble) ===")
for l in [73.19, 78, 82, 88, 92, 95.2, 100, 110, 116]:
    p = np.mean(term > l) if l > S_IRFC else np.mean(term < l)
    print(f"  P(close {'>' if l > S_IRFC else '<'} {l:>6.2f}) = {p*100:5.1f}%")
print(f"  median {np.median(term):.1f} | p10 {np.percentile(term,10):.1f} | p25 {np.percentile(term,25):.1f} "
      f"| p75 {np.percentile(term,75):.1f} | p90 {np.percentile(term,90):.1f}")
a = res["A market-implied (Upstox chains, 3-index OLS)"]
print(f"  market-implied model: median {np.median(a):.1f}, 1sigma band +/-{a.std():.2f} "
      f"({a.std()/S_IRFC*100:.1f}%), p10 {np.percentile(a,10):.1f}, p90 {np.percentile(a,90):.1f}")
