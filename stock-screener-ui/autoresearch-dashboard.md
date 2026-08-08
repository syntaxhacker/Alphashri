# Autoresearch Dashboard: btst-param-optimization

**Runs:** 50 | **Kept:** 28 | **Discarded:** 22 | **Crashed:** 0
**Baseline:** profit_factor: 0.8188 ratio (#1)
**Best no-slippage:** profit_factor: 4.196 ratio (#18, +412.4%)
**Best with slippage:** profit_factor: 1.3856 ratio (#48, +69.2%)

## Realistic Results (0.05-0.1% slippage)

| Config | Slippage | PF | Net | Verdict |
|--------|----------|-----|-----|---------|
| volume_surge, SL=0.3% | 0.05% | **1.39** | ₹353K | ✅ Best realistic |
| volume_surge, SL=0.5% | 0.05% | **1.19** | ₹227K | ✅ Good |
| volume_surge, SL=0.3% | 0.1% | **1.12** | ₹224K | ⚠️ Marginal |
| volume_surge, SL=0.5% | 0.1% | 0.99 | -₹33K | ❌ No |
| any_day, SL=0.5% | 0.1% | 0.82 | -₹4M | ❌ No |

Nifty buy-and-hold over period: **-6.25%**

## All Runs

| # | commit | profit_factor | status | description |
|---|--------|---------------|--------|-------------|
| 1 | 8deac38 | 0.8188 | keep | baseline SL=2% TP=3% entry>0.5% up_day |
| 2 | 8deac38 | 0.9144 | keep | wider TP=5% SL=2% |
| 3 | 8deac38 | 0.9858 | keep | SL=1% TP=5% |
| 4 | 8deac38 | 1.0628 | keep | SL=1% TP=10% |
| 5 | 8deac38 | 1.0783 | keep | SL=1% no TP |
| 6 | 8deac38 | 1.1637 | keep | SL=1% any_day |
| 7 | 8deac38 | 1.4747 | keep | SL=0.5% any_day |
| 8 | 8deac38 | 1.8377 | keep | SL=0.3% any_day |
| 9 | 8deac38 | 2.1697 | keep | SL=0.2% any_day |
| 10 | 8deac38 | 2.7364 | keep | SL=0.1% any_day |
| 11 | 8deac38 | 1.0483 | discard | no SL |
| 12 | 8deac38 | 3.267 | keep | SL=0.05% any_day |
| 13 | 8deac38 | 3.8503 | keep | SL=0.01% any_day |
| 14 | 8deac38 | 4.0376 | keep | SL=0.001% any_day |
| 15 | 8deac38 | 4.1612 | keep | mcap>=5000 |
| 16 | 8deac38 | 4.1781 | keep | mcap>=10000 |
| 17 | 8deac38 | 4.101 | discard | price>=200 |
| 18 | e891da3 | 4.196 | keep | volume_surge SL=0.001% |
| 19 | e891da3 | 3.9044 | discard | vol_surge mcap>=5000 |
| 20 | e891da3 | 1.626 | discard | H2-2025 regime |
| 21 | e891da3 | 2.7212 | keep | SL=0.01% FY |
| 22 | e891da3 | 2.3268 | discard | SL=0.05% FY |
| 23 | e891da3 | 2.8503 | keep | SL=0.001% FY |
| 24 | e891da3 | 3.8791 | keep | vol_surge FY |
| 25 | e891da3 | 3.3525 | discard | vol_surge mcap>=5000 FY |
| 26-35 | fc29b82 | various | mixed | SL×entry cross + 200/300 stock sweep |
| 36-50 | 4ac628b | various | mixed | **Slippage-adjusted runs** |

## Key Real-World Findings (Runs 36-50)

- **0.1% slippage destroys most gains** — only vol_surge+SL=0.3% survives (PF=1.12)
- **0.05% slippage** (achievable on liquid large-caps) keeps it viable: PF=1.39
- any_day mode is unprofitable with ANY slippage — too many low-quality trades
- Nifty was -6.25% over the period — BTST outperformed but barely
