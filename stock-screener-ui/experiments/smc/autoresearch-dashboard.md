# Autoresearch Dashboard: smc-trend-break-pf

**Runs:** 6 | **Kept:** 2 | **Discarded:** 4 | **Crashed:** 0
**Baseline:** pf_test: 0.841 (#1)
**Best:** pf_test: 0.928 (#5, +10.4%) — session 12-23 + ATR>=8

| # | commit | pf_test | status | description |
|---|--------|---------|--------|-------------|
| 1 | c5c52aa | 0.841 | keep | baseline RR3 coupled engine |
| 2 | c5c52aa | 0.498 | discard | BE stop at +1.5R |
| 3 | c5c52aa | 0.841 | discard | relative chase filter max_chase_r=1.0 |
| 4 | 3f277bb | 0.838 | discard | session 12:00-23:00 IST only |
| 5 | 3f277bb | 0.928 | keep | session 12-23 + ATR>=8 |
| 6 | 3f277bb | 0.000 | discard | daystop 40 + session + ATR |
