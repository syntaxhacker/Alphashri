# Autoresearch Dashboard: smc-trend-break-pf

**Runs:** 13 | **Kept:** 3 | **Discarded:** 10 | **Crashed:** 0
**Baseline:** pf_test: 0.841 (#1)
**Best:** pf_test: 0.979 (#13, +16.4%) — session 12-23 + ATR>=10

| # | commit | pf_test | status | description |
|---|--------|---------|--------|-------------|
| 1 | c5c52aa | 0.841 | keep | baseline RR3 coupled engine |
| 2 | c5c52aa | 0.498 | discard | BE stop at +1.5R |
| 3 | c5c52aa | 0.841 | discard | relative chase filter max_chase_r=1.0 |
| 4 | 3f277bb | 0.838 | discard | session 12:00-23:00 IST only |
| 5 | 3f277bb | 0.928 | keep | session 12-23 + ATR>=8 |
| 6 | 3f277bb | 0.000 | discard | daystop 40 + session + ATR |
| 7 | aab2d22 | 0.231 | discard | 15m HTF trend gate (Agent B spec) |
| 8 | aab2d22 | 0.543 | discard | tp-near under session+ATR |
| 9 | aab2d22 | 0.000 | discard | daystop 30pts July month |
| 10 | aab2d22 | 0.384 | discard | yfinance daily-bias direction gate |
| 11 | aab2d22 | 0.557 | discard | forensics zone-age>30 |
| 12 | aab2d22 | 0.744 | discard | forensics displacement skip |
| 13 | aab2d22 | 0.979 | keep | ATR gate 8->10 (forensics) |
