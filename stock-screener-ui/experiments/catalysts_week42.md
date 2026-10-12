# Catalysts — missed breakouts, week 42 (Oct 5–9, 2026)

Multi-agent catalyst hunt: WHAT moved each stock that broke out during the week.
Detail files: `catalyst_group<A/B/C>.json`. Classes: `earnings` / `order_win` /
`upgrade` / `corporate_action` / `bulk_deal` / `sector_sympathy` /
`no_news_momentum` / `unknown`. Timing = announcement date vs breakout day
(LEAD = news first, LAG = coverage followed the move).

## Group C

| Symbol | Breakout | MFE | Catalyst | Timing | Evidence (dated) |
|---|---|---|---|---|---|
| PERSISTENT | Fri Oct 9 | +7.9% | **sector_sympathy** (med-high) | LEAD 1 session | TCS Q2 post-market Oct 8 (rev beat, AI rev $3.1B); Nifty IT +3.39% Oct 9, TCS +5%; Persistent's own Q2 due Oct 15 (pre-earnings positioning) |
| CYIENT | Mon Oct 5 | +7.0% | **sector_sympathy** (med) | coincident | Nifty IT +~4% Monday pre-Q2 rotation (ET); "IT stocks to add ahead of Q2" Oct 5 (DB). TAO $218M deal is Jun 1 / CCI Aug 25 — ruled out |
| KOTAKBANK | Wed Oct 7 | +6.4% | **earnings** (high) | LEAD 2 sessions | Q2 update filed Oct 5 PM (advances +24.7%, deposits +23.2%) → +4% Oct 6 → HSBC→Buy Rs 520 Oct 7 AM; RBI +25bp hike Oct 7 lifted Nifty Bank while Nifty fell |
| VBL | Mon Oct 5 | +4.4% | **no_news_momentum** (med) | no lead; Jager news LAGs | Oct 1 "rebound after 20% fall" oversold framing; Oct 7 Jager Renewables Rs 4.1 cr solar item is trivial + post-breakout; break_volx 0.78 (no conviction) |
| LEMONTREE | Wed Oct 7 | +5.5% | **sector_sympathy** (low) | coverage LAGs 1 day | No company news Oct 5–7 anywhere; JM Financial constructive hotel/Diwali piece Oct 8; Oct 9 technical-chaser coverage. Festive-theme drift, faded (+2.6% week) |
| PETRONET | Tue Oct 6 | +4.9% | **corporate_action** (med-high) | LEAD (Sat→Tue) | MD & CEO (Sanjay Kumar) appointed Sat Oct 3 → +2% Mon Oct 5 → breakout Tue on 3.07x volume; Sep 28 triple-Buy backdrop. ICICI "upgrade" is Jun 2025 — stale, ruled out |
| PAGEIND | Tue Oct 6 | +4.9% | **no_news_momentum** (med) | none found | Zero DB mentions; no upgrade/action/deal; only generic Oct 5 consumer piece (stock not named). Fully faded (+0.6% week) — unsponsored pop |

Group-C read-through: 3 of 7 rode the TCS-led IT snapback / pre-Q2 rotation
(PERSISTENT, CYIENT) or a real earnings print (KOTAKBANK — the only one the
screen flagged AND that held). The other 4 were CEO-news spike (PETRONET),
festive breeze (LEMONTREE), or pure oversold air (VBL, PAGEIND) — both of the
latter faded, and PETRONET's 3x-volume spike topped the same day.

## Group B

| Symbol | Breakout | MFE | Catalyst | Timing | Evidence (dated) |
|---|---|---|---|---|---|
| GLAND | Wed Oct 7 | +10.3% | **upgrade** (med-high) | LEAD/coincident (note AM of break; deal Oct 1) | Nomura retains Buy, TP Rs 3,750 on CDMO/biologics pivot (~20% rev CAGR) — MC "jumps 4% after Nomura" Oct 7 13:16, full note Oct 8; Oct 1 board clears $21M US/Novelstar 60% stake (pre-positioning) |
| MOTILALOFS | Tue Oct 6 | +10.1% | **sector_sympathy** (low) | coincident (Mon rebound → Tue break) | No company news Oct 1–9 anywhere (DB + web); Nifty snapped 25-yr longest weekly losing streak Mon Oct 5 → broker/AMC beta spike on 2.56x vol. UBS Rs 1,097 target undated — not counted |
| DEEPAKFERT | Wed Oct 7 | +9.2% | **no_news_momentum** (med) | none; coverage same-day, initiation LAGs ~6 wks | ET Oct 7 "rally 5% after recent decline, renewed buying" (no trigger cited); Emkay Buy/TP 2000 is November (ruled out); Aug fertiliser rally stale; drift60 −16.8% deep-drawdown bounce on 1.68x |
| ICICIGI | Mon Oct 5 | +8.7% | **sector_sympathy** (low) | LEAD (broke 2 sessions pre-decision) | RBI MPC Oct 5–7, +25bp to 5.50% Oct 7; livemint pre-policy piece named ICICI Lombard a hike beneficiary (insurer investment income); PB Fintech pact is Apr 2024 (ruled out); Q2 due Oct 14 (pre-earnings drift) |
| AETHER | Tue Oct 6 | +8.6% | **sector_sympathy** (med) | coincident | No filing/note Oct 5–7 (DB zero); "riding broad specialty-chemicals rally, positioned for earnings recovery" (perplexity); Sep 24 +9% / +109% CY2026 backdrop; Q2 print Nov 13 (ruled out). 4.85x vol, 52w high |
| BHEL | Tue Oct 6 | +8.3% | **sector_sympathy** (med) | coincident (calls ±1 day) | BS "rallies 5%, hits new high" Oct 6; CNBC "Stocks to watch: BHEL" Oct 5; Thakkar buy Oct 7; MOFSL Rs 13 lakh cr defence-approvals theme Oct 5. Rs 21,000 cr Meja order is Jun 5 (verified, stale — ruled out) |
| TDPOWERSYS | Wed Oct 7 | +8.1% | **sector_sympathy** (med) | sector LEAD (Mon); QIP LAG/telegraphed | Mon Oct 5 +8% in livemint power/electrical rally (rebound day); Rs 600 cr QIP opened post-close Oct 7 21:36 at floor 775.35 (board Aug 14, EGM Sep 10 — telegraphed); dilution explains fade (+8.07% MFE → +0.20% week) |

Group-B read-through: only GLAND had a real stock-specific trigger (Nomura
upgrade landing on breakout morning, on top of the Oct 1 Novelstar deal — the
group's biggest MFE at +10.3%, and it held). The other six were theme/beta
moves: Monday-rebound sympathy (TDPOWERSYS, MOTILALOFS), rate-expectation drift
(ICICIGI, ahead of the Oct 7 RBI hike), PSU-capex chatter (BHEL), a chemical
sector wave (AETHER — the only one with genuine pre-accumulation: obv+,
ud 2.46, ADX 30, 4.85x), or a pure oversold bounce (DEEPAKFERT — weakest volume
at 1.68x, yet held best, suggesting quiet re-accumulation). Two cautionary
notes: BHEL's "order-win" narrative is stale (Meja is June), and TDPOWERSYS is
the week's clearest buy-the-rumour-sell-the-placement (breakout day = QIP
evening, faded to +0.2%). Screen scorecard: flagged 3 of 7 pre-break
(GLAND-A, BHEL-A+B, AETHER/TDPOWERSYS-B) — but verdicts show the two cleanest
setups (BHEL, GLAND) needed a news spark the screen cannot see.

## Group A

| Symbol | Breakout | MFE | Catalyst | Timing | Evidence (dated) |
|---|---|---|---|---|---|
| PWL | Wed Oct 8 | +20.6% | **upgrade** (med-high) | LEAD ~1 day | MOSL Buy reiteration TP Rs 200, report Oct 7 (publ Oct 8 11:48) post Singapore NDR; Oct 5 FinZ NBFC loan-book sale (Rs 95.79cr to Auxilo) set up week +4-6%. Kotak 'reduce' Oct 7 ignored |
| CUPID | Tue Oct 6 | +17.8% | **earnings** (high) | LEAD 4 sessions | Sep 30 filing: Q2 rev >Rs 200cr, FY27 guide raised 2nd time in 2 wks to 800cr/250cr (ET Oct 1); Sep 29 +10% on Smallcap-250 inclusion; Oct 6 leg is continuation, Oct 8-9 new highs |
| BBOX | Wed Oct 7 | +17.5% | **no_news_momentum** (med) | none found | Zero DB headlines Oct 1-9; Oct 9 Univest: "no company-specific catalyst"; +26% month into breakout (SWS Oct 5). Rose on RBI-hike down day — momentum, not orders (FY26 $1B book is May, AIONOS Jun) |
| TRENT | Tue Oct 6 | +13.8% | **earnings** (high) | LEAD ~15h | Q2 update filed Mon Oct 5 eve (19:04): standalone rev +23% to Rs 5,788cr, 1,000th Zudio; Tue +10-13% on 9.1x vol, best day since Aug 2024; MS/MOSL bullish vs Citi bearish |
| PTCIL | Wed Oct 7 | +13.1% | **corporate_action** (high) | LEAD hours | Board opened Rs 1,800cr QIP Oct 6 (floor 22,150, indic 21,060; ICICI/Goldman); Oct 7 +5-7% to record 24,263-24,770 on de-risking read; allotted Oct 9 (854,700 sh, ~5.7% dilution); 4.33x vol |
| CPPLUS | Mon Oct 5 | +12.2% | **sector_sympathy** (med-high) | coincident | AI-CCTV theme day: Mint/Goodreturns Oct 5 — CPPLUS 5% upper circuit (3,989.50) with Prizor; computer-vision use-case narrative + relief rally off Nifty's worst weekly streak in 25 yrs. Backdrop: Q1FY27 PAT +332%, Rs 1,500cr QIP closed Sep 25 |
| RRKABEL | Tue Oct 6 | +11.5% | **sector_sympathy** (med) | coincident; upgrade LAGs 1 day | Oct 5 power/electrical rebound (+5.2% Mon, pack +4-8%); Oct 6 Univest: "no company-specific reason", 2-day +7.6% streak. Nuvama Buy/TP 3,310 came Oct 7 — amplifier, ran to 52w high 2,733 Oct 9 |

Group-A read-through: 4 of 7 had a dated firm-specific trigger BEFORE the
breakout (TRENT Q2 print, PTCIL QIP, CUPID guidance raise, PWL MOSL+NBFC exit)
— all LEADs, and all held the week (+7% to +20%). The other 3 were
theme/momentum (CPPLUS AI-CCTV circuit, RRKABEL power-pack bounce with Nuvama
a day late, BBOX pure momentum on a down-market day). Technical verdicts said
"came-from-nowhere" on 6 of 7 — true on price structure (no boxes anywhere;
only CUPID was flagged), but the news record shows most breakouts were
sponsored, just not by bases. Screen lesson: pre-Q2 business updates and
capital-actions (QIPs) were the week's real breakout fuel, and neither is in
the screen's vocabulary.
