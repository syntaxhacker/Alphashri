"""LRL + highest-TF iFVG prototype check on cached Dukascopy ticks.

Strategy (from user spec):
  1. LRL = 3-4 stacked highs/lows where a clean trendline fits (stacked stops, not yet swept)
     - LRL below -> SHORT into it, LRL above -> LONG into it
  2. Entry on highest-TF iFVG swept in that leg (30s < 1m < 2m < 3m, take highest)
  3. SL beyond swing high/low (+6 buf like smc_ifvg), TP fixed 1R
  4. Prime window 9:30-10:00am EST = 19:00-19:30 IST

Usage:
  .venv/bin/python scripts/lrl_ifvg_check.py --date 2026-09-02
  .venv/bin/python scripts/lrl_ifvg_check.py --matrix --window prime
"""
import argparse
import json
import os
import sys
from datetime import timezone, timedelta, datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts.smc_tick_eval import fetch_ticks  # cached, no download

IST = timezone(timedelta(hours=5, minutes=30))
CACHE_NOTE = "experiments/data/duka_cache"
TF_ORDER = ["30s", "1m", "2m", "3m"]
TF_SEC = {"30s": 30, "1m": 60, "2m": 120, "3m": 180}


def prev_trading_day(date_str):
    from datetime import date as _d, timedelta as _td
    p = _d.fromisoformat(date_str) - _td(days=1)
    while p.weekday() >= 5:
        p -= _td(days=1)
    return p.isoformat()


def session_profile(ticks, t_end_ms, bin_pts=5.0):
    """Volume profile (bid+ask vol weights) over ticks with ts < t_end_ms.
    Returns (poc, vah, val) with 70% value-area expansion from POC. None-safe."""
    bins = {}
    for x in ticks:
        if x["timestamp"] >= t_end_ms:
            break  # ticks are time-ordered
        mid = (x["bidPrice"] + x["askPrice"]) / 2.0
        w = (x.get("bidVolume") or 0) + (x.get("askVolume") or 0)
        k = int(mid // bin_pts)
        bins[k] = bins.get(k, 0) + w
    if not bins:
        return None
    total = sum(bins.values())
    poc_k = max(bins, key=lambda k: bins[k])
    lo = hi = poc_k
    covered = bins[poc_k]
    while covered < 0.70 * total:
        up = bins.get(hi + 1, 0)
        dn = bins.get(lo - 1, 0)
        if up == 0 and dn == 0:
            break
        if up >= dn:
            hi += 1
            covered += up
        else:
            lo -= 1
            covered += dn
    c = lambda k: (k + 0.5) * bin_pts
    return {"poc": c(poc_k), "vah": c(hi) + bin_pts / 2, "val": c(lo) - bin_pts / 2}


def build_bars(ticks, sec):
    bars = {}
    for t in ticks:
        ts = t["timestamp"] / 1000.0
        bkt = int(ts // sec) * sec
        bid = t["bidPrice"]
        b = bars.get(bkt)
        if b is None:
            bars[bkt] = {"time": bkt, "open": bid, "high": bid, "low": bid, "close": bid}
        else:
            b["high"] = max(b["high"], bid)
            b["low"] = min(b["low"], bid)
            b["close"] = bid
    return [bars[k] for k in sorted(bars)]


def atr(bars, i, n=14):
    if i < n:
        return 0.0
    return sum(bars[k]["high"] - bars[k]["low"] for k in range(i - n + 1, i + 1)) / n


def detect_fvg(bars, i, gap_min=2.0):
    # 3-bar pattern ending at i, same as engine
    if i < 2:
        return None
    a, c = bars[i - 2], bars[i]
    if c["high"] < a["low"] and a["low"] - c["high"] > gap_min:
        return {"type": "bear", "top": a["low"], "bot": c["high"], "form": i}
    if c["low"] > a["high"] and c["low"] - a["high"] > gap_min:
        return {"type": "bull", "top": c["low"], "bot": a["high"], "form": i}
    return None


def swing_pivots(bars, i, left=2, right=2):
    """fractal pivots confirmed at i (center = i-right), like engine j=i-2."""
    out_hi, out_lo = None, None
    if i >= left + right:
        j = i - right
        w = bars[j - left:j + right + 1]
        if all(w[left]["high"] > w[k]["high"] for k in range(len(w)) if k != left):
            out_hi = (j, w[left]["high"])
        if all(w[left]["low"] < w[k]["low"] for k in range(len(w)) if k != left):
            out_lo = (j, w[left]["low"])
    return out_hi, out_lo


def detect_lrl(bars, i, lookback=120, min_touches=3, tol_mult=0.60, max_dist_atr=5.0):
    """Return {'dir': 'above'|'below', 'touches': n, 'target': px} or None.
    Best-3-of-recent-6 collinear pivots (not all-6 must fit), residual < tol_mult*ATR."""
    import itertools
    if i < 20:
        return None
    a = atr(bars, i) or 5.0
    tol = tol_mult * a
    # collect pivots in window
    his, los = [], []
    for k in range(max(left_bound := i - lookback, 4), i):
        # pivot centered at k needs k+2 <= i to confirm
        if k + 2 > i:
            continue
        w = bars[k - 2:k + 3]
        if len(w) < 5:
            continue
        if all(w[2]["high"] > w[m]["high"] for m in (0, 1, 3, 4)):
            his.append((k, w[2]["high"]))
        if all(w[2]["low"] < w[m]["low"] for m in (0, 1, 3, 4)):
            los.append((k, w[2]["low"]))
    cands = []
    for side, pts in (("above", his), ("below", los)):
        if len(pts) < min_touches:
            continue
        # best subset of 3 (or more) from recent 6 — one outlier must not kill the setup
        pool = pts[-6:]
        best = None
        for r in (4, 3) if len(pool) >= 4 else (3,):
            if len(pool) < r:
                continue
            for combo in itertools.combinations(pool, r):
                n = len(combo)
                sx = sum(p[0] for p in combo) / n
                sy = sum(p[1] for p in combo) / n
                den = sum((p[0] - sx) ** 2 for p in combo) or 1
                slope = sum((p[0] - sx) * (p[1] - sy) for p in combo) / den
                max_res = max(abs(p[1] - (sy + slope * (p[0] - sx))) for p in combo)
                if max_res > tol:
                    continue
                target = sy + slope * (i - sx)
                px = bars[i]["close"]
                if side == "above" and target <= px + 2:
                    continue  # already swept/touching
                if side == "below" and target >= px - 2:
                    continue
                # distance sanity
                if abs(target - px) > max_dist_atr * a:
                    continue
                score = (-n, max_res)
                if best is None or score < (best["score"]):
                    best = {"dir": side, "touches": n, "target": target,
                            "resid": max_res, "slope": slope, "score": score}
            if best:
                break
        if best:
            del best["score"]
            cands.append(best)
    if not cands:
        return None
    # prefer most touches, then smallest residual
    cands.sort(key=lambda c: (-c["touches"], c["resid"]))
    return cands[0]


def run_date(date, gap_min=2.0, sl_buf=6.0, window="prime", verbose=True):
    ticks = fetch_ticks(date)
    tf_bars = {tf: build_bars(ticks, s) for tf, s in TF_SEC.items()}
    base = tf_bars["1m"]
    # CTX: prev-day range + overnight range (session start -> 19:00 IST)
    try:
        pticks = fetch_ticks(prev_trading_day(date))
        pdh = max(x["bidPrice"] for x in pticks)
        pdl = min(x["bidPrice"] for x in pticks)
    except Exception:
        pdh = pdl = None
    on_bars = [x for x in base
                if datetime.fromtimestamp(x["time"], tz=timezone.utc).astimezone(IST).strftime("%H:%M") < "19:00"]
    onh = max((x["high"] for x in on_bars), default=None)
    onl = min((x["low"] for x in on_bars), default=None)
    # per-TF FVG stores + last inversion events
    fvg_store = {tf: [] for tf in TF_ORDER}
    # index maps: for each 1m bar time, find corresponding tf bar index
    # simpler: walk 1m clock, advance each TF pointer
    ptr = {tf: 0 for tf in TF_ORDER}
    last_inv = {tf: None for tf in TF_ORDER}  # (dir LONG/SHORT, age_base_idx)
    trades = []
    in_pos = None
    # tick buckets per 1m bar for fast SL-first eval
    from collections import defaultdict
    by_min = defaultdict(list)
    for t in ticks:
        by_min[int(t["timestamp"] // 1000 // 60) * 60].append(t)

    def ist_hm(ts_sec):
        return datetime.fromtimestamp(ts_sec, tz=timezone.utc).astimezone(IST).strftime("%H:%M")

    for i, b in enumerate(base):
        t = b["time"]
        hm = ist_hm(t)
        # advance TFs: process all tf bars with time <= t (per-TF gap: 30s needs smaller)
        tf_gap = {"30s": 1.0, "1m": gap_min, "2m": gap_min * 1.5, "3m": gap_min * 2.0}
        for tf in TF_ORDER:
            bars = tf_bars[tf]
            while ptr[tf] < len(bars) and bars[ptr[tf]]["time"] <= t:
                j = ptr[tf]
                f = detect_fvg(bars, j, tf_gap[tf])
                if f:
                    fvg_store[tf].append(f)
                # check inversions of stored fvgs at this tf close
                cl = bars[j]["close"]
                for f in fvg_store[tf]:
                    if f.get("inv"):
                        continue
                    if f["type"] == "bull" and cl < f["bot"]:
                        f["inv"] = True
                        f["inv_dir"] = "SHORT"
                        last_inv[tf] = {"dir": "SHORT", "at": i, "f": f}
                    elif f["type"] == "bear" and cl > f["top"]:
                        f["inv"] = True
                        f["inv_dir"] = "LONG"
                        last_inv[tf] = {"dir": "LONG", "at": i, "f": f}
                ptr[tf] += 1
        # manage open position on ticks of this minute (SL first, TP 1R)
        if in_pos:
            for tk in by_min.get(t, []):
                bid, ask = tk["bidPrice"], tk["askPrice"]
                p = in_pos
                # STUDY: excursion in pts (fav/exitable vs adverse/stop side)
                if p["side"] == "SHORT":
                    p["mfe"] = max(p["mfe"], p["entry"] - bid)
                    p["mae"] = min(p["mae"], p["entry"] - ask)
                else:
                    p["mfe"] = max(p["mfe"], bid - p["entry"])
                    p["mae"] = min(p["mae"], bid - p["entry"])
                if p["side"] == "SHORT":
                    if ask >= p["sl"]:
                        p.update(exit=ask, result="SL", t_out=tk["timestamp"]); break
                    if bid <= p["tp"]:
                        p.update(exit=bid, result="TP", t_out=tk["timestamp"]); break
                else:
                    if bid <= p["sl"]:
                        p.update(exit=bid, result="SL", t_out=tk["timestamp"]); break
                    if ask >= p["tp"]:
                        p.update(exit=ask, result="TP", t_out=tk["timestamp"]); break
            if "exit" in in_pos:
                p = in_pos
                pnl = (p["entry"] - p["exit"]) if p["side"] == "SHORT" else (p["exit"] - p["entry"])
                p["pnl"] = round(pnl, 2)
                p["rr"] = round(pnl / p["risk"], 2) if p["risk"] else 0
                p["mfe_r"] = round(p["mfe"] / p["risk"], 2) if p["risk"] else 0
                p["mae_r"] = round(p["mae"] / p["risk"], 2) if p["risk"] else 0
                trades.append(p)
                in_pos = None
                continue
            # give up after 90 min
            if i - in_pos["i_in"] > 90:
                last = by_min.get(t, [None])[-1]
                px = (last["bidPrice"] if in_pos["side"] == "SHORT" else last["askPrice"]) if last else b["close"]
                in_pos.update(exit=px, result="TIME", t_out=t * 1000)
                pnl = (in_pos["entry"] - px) if in_pos["side"] == "SHORT" else (px - in_pos["entry"])
                in_pos["pnl"] = round(pnl, 2)
                in_pos["rr"] = round(pnl / in_pos["risk"], 2) if in_pos["risk"] else 0
                in_pos["mfe_r"] = round(in_pos["mfe"] / in_pos["risk"], 2) if in_pos["risk"] else 0
                in_pos["mae_r"] = round(in_pos["mae"] / in_pos["risk"], 2) if in_pos["risk"] else 0
                trades.append(in_pos)
                in_pos = None
            continue
        # entry logic
        prime = "19:00" <= hm <= "19:30"
        if window == "prime" and not prime:
            continue
        lrl = detect_lrl(base, i)
        if not lrl:
            continue
        want = "SHORT" if lrl["dir"] == "below" else "LONG"
        # highest TF inversion agreeing with want (per-TF lookback in 1m bars)
        allow = {"30s": 5, "1m": 5, "2m": 8, "3m": 12}
        pick = None
        pick_age = None
        for tf in reversed(TF_ORDER):  # 3m first
            ev = last_inv[tf]
            if ev and ev["dir"] == want and i - ev["at"] <= allow[tf]:
                pick = tf
                pick_age = i - ev["at"]
                break
        if not pick:
            continue
        # SL beyond recent swing (5-bar fractal each side, fallback signal bar edge)
        swing_hi = swing_lo = None
        for k in range(max(0, i - 10), i):
            if k >= 4:
                w = base[k - 2:k + 3] if k + 3 <= len(base) else []
                if len(w) == 5:
                    if all(w[2]["high"] > w[m]["high"] for m in (0, 1, 3, 4)):
                        swing_hi = w[2]["high"] if swing_hi is None else max(swing_hi, w[2]["high"])
                    if all(w[2]["low"] < w[m]["low"] for m in (0, 1, 3, 4)):
                        swing_lo = w[2]["low"] if swing_lo is None else min(swing_lo, w[2]["low"])
        if want == "SHORT":
            sl_ref = swing_hi if swing_hi else b["high"]
            sl = sl_ref + sl_buf
            # entry next tick ask/bid: use next minute first tick bid (short)
            nxt = by_min.get(base[i + 1]["time"] if i + 1 < len(base) else t, [])
            entry = nxt[0]["bidPrice"] if nxt else b["close"]
            if entry > sl:
                continue
            risk = sl - entry
            if risk < 5:
                continue
            tp = entry - risk  # 1R
        else:
            sl_ref = swing_lo if swing_lo else b["low"]
            sl = sl_ref - sl_buf
            nxt = by_min.get(base[i + 1]["time"] if i + 1 < len(base) else t, [])
            entry = nxt[0]["askPrice"] if nxt else b["close"]
            if entry < sl:
                continue
            risk = entry - sl
            if risk < 5:
                continue
            tp = entry + risk
        in_pos = {"side": want, "entry": entry, "sl": sl, "tp": tp, "risk": risk,
                  "i_in": i, "t_in": t, "hm": hm, "tf": pick,
                  "lrl": lrl["dir"], "touches": lrl["touches"], "target": round(lrl["target"], 1),
                  # STUDY ctx
                  "resid": round(lrl.get("resid", 0), 2), "inv_age": pick_age,
                  "min_open": (int(hm[:2]) * 60 + int(hm[3:])) - 19 * 60,
                  "dist_atr": round(abs(lrl["target"] - entry) / (atr(base, i) or 5.0), 2),
                  "risk_atr": round(risk / (atr(base, i) or 5.0), 2),
                  "mfe": 0.0, "mae": 0.0}
        # CTX: reference location at signal time (history-only: profile over ticks < bar t)
        prof = session_profile(ticks, t * 1000)
        if prof and pdh is not None:
            vah, val = prof["vah"], prof["val"]
            in_pos["poc"] = round(prof["poc"], 1)
            in_pos["val_loc"] = "above" if entry > vah else ("below" if entry < val else "inside")
            in_pos["pd_loc"] = "above" if entry > pdh else ("below" if entry < pdl else "between")
            in_pos["on_loc"] = ("above" if (onh is not None and entry > onh)
                                else ("below" if (onl is not None and entry < onl) else "inside"))
            if want == "LONG":
                cands = [(r, n) for r, n in ((pdh, "PDH"), (vah, "VAH"), (onh, "ONH")) if r is not None and r > entry]
                bl = min(cands, key=lambda x: x[0]) if cands else (None, None)
            else:
                cands = [(r, n) for r, n in ((pdl, "PDL"), (val, "VAL"), (onl, "ONL")) if r is not None and r < entry]
                bl = max(cands, key=lambda x: x[0]) if cands else (None, None)
            in_pos["blocker"] = bl[1]
            in_pos["block_r"] = round(abs(bl[0] - entry) / risk, 2) if bl[0] is not None else None
            # magnet: LRL target near a same-side reference (within 0.5R)?
            tgt = lrl["target"]
            mags = []
            for r, n in ((pdh, "PDH"), (pdl, "PDL"), (vah, "VAH"), (val, "VAL"), (onh, "ONH"), (onl, "ONL"),
                         (prof["poc"], "POC")):
                if r is not None and abs(tgt - r) / risk <= 0.5:
                    mags.append(n)
            in_pos["magnets"] = mags
        else:
            in_pos["val_loc"] = in_pos["pd_loc"] = in_pos["on_loc"] = "unknown"
            in_pos["blocker"] = None
            in_pos["block_r"] = None
            in_pos["magnets"] = []
    if verbose:
        print(f"\n=== {date} window={window} — {len(base)} 1m bars — {len(trades)} LRL-iFVG trades ===")
        for tr in trades:
            print(f"  {tr['hm']} {tr['side']:<5} via {tr['tf']:<3} LRL-{tr['lrl']}x{tr['touches']} "
                  f"entry {tr['entry']:.1f} SL {tr['sl']:.1f} TP {tr['tp']:.1f} "
                  f"-> {tr['result']:<4} {tr['pnl']:+.1f} ({tr['rr']:+.2f}R)")
    return trades


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default="2026-09-02")
    ap.add_argument("--matrix", action="store_true")
    ap.add_argument("--study", action="store_true", help="deep loss study over --dates")
    ap.add_argument("--window", default="prime", choices=["prime", "all"])
    ap.add_argument("--dates", default="2026-09-02,2026-09-03,2026-09-04,2026-09-07,2026-09-08,2026-09-09")
    args = ap.parse_args()
    if args.study:
        study(args.dates, args.window)
        return
    if args.matrix:
        tot, wn = [], 0
        for d in [x.strip() for x in args.dates.split(",")]:
            try:
                trs = run_date(d, window=args.window, verbose=True)
            except Exception as e:
                print(f"{d} SKIPPED: {e}")
                continue
            tot.extend(trs)
        n = len(tot)
        net = sum(t["pnl"] for t in tot)
        w = sum(1 for t in tot if t["pnl"] > 0)
        tps = sum(1 for t in tot if t["result"] == "TP")
        print(f"\nTOTAL window={args.window} {n} trades net {net:+.1f} win {w}/{n} TP {tps}/{n} "
              f"avg {net/max(1,n):+.2f}/trade (TP=+1R, SL=-1R by construction)")
    else:
        run_date(args.date, window=args.window)


def study(dates_csv, window):
    tot = []
    for d in [x.strip() for x in dates_csv.split(",")]:
        try:
            trs = run_date(d, window=window, verbose=False)
        except Exception as e:
            print(f"{d} SKIPPED: {e}")
            continue
        for t in trs:
            t["date"] = d
        tot.extend(trs)
    losers = [t for t in tot if t["pnl"] <= 0]
    winners = [t for t in tot if t["pnl"] > 0]
    print(f"\n### CTX STUDY n={len(tot)} W={len(winners)} L={len(losers)} net={sum(t['pnl'] for t in tot):+.1f}")
    print("\n-- every trade: location + blocker (dist in R) + magnets --")
    for t in sorted(tot, key=lambda x: (x["date"], x["hm"])):
        tag = "W" if t["pnl"] > 0 else "L"
        print(f"  {tag} {t['date'][5:]} {t['hm']} {t['side']:5} {t['tf']:3} "
              f"val:{t.get('val_loc')} pd:{t.get('pd_loc')} on:{t.get('on_loc')} "
              f"block:{t.get('blocker')}@{t.get('block_r')}R mag:{t.get('magnets')} "
              f"-> {t['result']} {t['pnl']:+.1f}")
    from collections import Counter
    for loc in ["val_loc", "pd_loc", "on_loc"]:
        print(f"\n-- by {loc} --")
        for k in sorted(set(t.get(loc) for t in tot)):
            w = [t for t in winners if t.get(loc) == k]
            l = [t for t in losers if t.get(loc) == k]
            print(f"   {k}: W={len(w)} L={len(l)} net={sum(t['pnl'] for t in w+l):+.1f}")
    print("\n-- blocker within 1R (TP behind reference)? --")
    bw = sum(1 for t in winners if t.get("block_r") is not None and t["block_r"] < 1.0)
    bl = sum(1 for t in losers if t.get("block_r") is not None and t["block_r"] < 1.0)
    print(f"   winners blocked<1R: {bw}/{len(winners)}  losers blocked<1R: {bl}/{len(losers)}")
    print("   blocker name:", dict(Counter(t.get("blocker") for t in losers)), "vs W:",
          dict(Counter(t.get("blocker") for t in winners)))
    print("\n-- magnet confluence (LRL target near PDH/PDL/VAH/VAL/ONH/ONL/POC)? --")
    mw = sum(1 for t in winners if t.get("magnets"))
    ml = sum(1 for t in losers if t.get("magnets"))
    print(f"   winners with magnet: {mw}/{len(winners)}  losers with magnet: {ml}/{len(losers)}")


if __name__ == "__main__":
    main()
