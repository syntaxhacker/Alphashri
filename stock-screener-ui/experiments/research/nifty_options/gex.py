"""Gamma-Exposure (GEX) profile for NIFTY from a FYERS option chain.

Dealer-gamma convention (SqueezeMetrics-style, the common public model):
  dealers are assumed LONG call gamma and SHORT put gamma.

  GEX_strike = S^2 * 0.01 * contract_size * ( gamma_CE * OI_CE  -  gamma_PE * OI_PE )

Units: ₹ of dealer delta-hedge notional per 1% spot move (reported in ₹ crore).
  net GEX > 0  -> positive-gamma regime (dealers dampen moves, mean-reverting)
  net GEX < 0  -> negative-gamma regime (dealers amplify moves, trending)

The dealer sign is an ASSUMPTION, not observable. Every output is model-based.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fyers_data as fd  # noqa: E402

LOT = 65  # NIFTY contract size (confirmed in instruments table)


def chain_profile_from_dict(ch):
    """Compute the per-strike GEX profile from an already-fetched chain dict.

    NOTE on units: FYERS ``oi`` is in *quantity* (shares), already lot-scaled —
    so we do not multiply by LOT again.
    """
    if not ch:
        return None
    spot_row = next((r for r in ch["optionsChain"] if r.get("option_type") == ""), {})
    spot = float(spot_row.get("ltp") or 0.0)
    legs = [r for r in ch["optionsChain"] if r.get("option_type") in ("CE", "PE") and r.get("greeks")]
    strikes = sorted({r["strike_price"] for r in legs})
    rows = []
    for k in strikes:
        ce = next((r for r in legs if r["strike_price"] == k and r["option_type"] == "CE"), None)
        pe = next((r for r in legs if r["strike_price"] == k and r["option_type"] == "PE"), None)
        g_ce = (ce or {}).get("greeks", {}).get("gamma", 0.0) or 0.0
        g_pe = (pe or {}).get("greeks", {}).get("gamma", 0.0) or 0.0
        oi_ce = (ce or {}).get("oi", 0) or 0
        oi_pe = (pe or {}).get("oi", 0) or 0
        rows.append({
            "strike": k,
            "call_gex": g_ce * oi_ce, "put_gex": g_pe * oi_pe,
            "net_gex": g_ce * oi_ce - g_pe * oi_pe,
            "call_oi": oi_ce, "put_oi": oi_pe,
            "call_vol": (ce or {}).get("volume", 0) or 0,
            "put_vol": (pe or {}).get("volume", 0) or 0,
            "gamma_ce": g_ce, "gamma_pe": g_pe,
        })
    scale = spot * spot * 0.01 / 1e7  # OI already in shares -> ₹ crore per 1% move
    for r in rows:
        r["net_gex_cr"] = r["net_gex"] * scale
        r["call_gex_cr"] = r["call_gex"] * scale
        r["put_gex_cr"] = r["put_gex"] * scale
    if not rows:
        return None
    # zero-gamma flip from cumulative net GEX over *meaningful* strikes (gamma>0)
    core = [r for r in rows if r["gamma_ce"] or r["gamma_pe"]]
    ks = np.array([r["strike"] for r in core])
    net = np.array([r["net_gex_cr"] for r in core])
    order = np.argsort(ks)
    ks, net = ks[order], net[order]
    flip = None
    for i in range(1, len(ks)):
        if (net[i - 1] < 0) != (net[i] < 0) and net[i - 1] != 0:
            x0, x1, y0, y1 = ks[i - 1], ks[i], net[i - 1], net[i]
            flip = float(x0 + (0 - y0) * (x1 - x0) / (y1 - y0))
            break
    core_rows = [r for r in rows if abs(r["strike"] - spot) <= 700]
    call_wall = max(core_rows, key=lambda r: r["call_gex"]) if core_rows else None
    put_wall = min(core_rows, key=lambda r: r["put_gex"]) if core_rows else None
    max_gamma = max(rows, key=lambda r: abs(r["net_gex"]))
    return {
        "spot": spot,
        "net_gex_cr": float(net.sum()),
        "zero_gamma_flip": flip,
        "call_wall": call_wall["strike"] if call_wall else None,
        "call_wall_gex_cr": call_wall["call_gex_cr"] if call_wall else None,
        "put_wall": put_wall["strike"] if put_wall else None,
        "put_wall_gex_cr": put_wall["put_gex_cr"] if put_wall else None,
        "max_gamma_strike": max_gamma["strike"],
        "rows": sorted(rows, key=lambda r: r["strike"]),
    }


def chain_profile(client, expiry_epoch=None, strikecount=40):
    ch = client.option_chain(strikecount=strikecount, expiry=expiry_epoch, greeks=True)
    return chain_profile_from_dict(ch)


def ascii_profile(rows, spot, width=60):
    vals = [r["net_gex_cr"] for r in rows]
    m = max(abs(v) for v in vals) or 1.0
    lines = []
    for r in rows:
        v = r["net_gex_cr"]
        n = int(abs(v) / m * width)
        bar = ("+" if v >= 0 else "-") * max(1, n)
        mark = " <== spot" if abs(r["strike"] - spot) <= 25 else ""
        lines.append(f"{r['strike']:>6.0f} | {v:>10.1f} | {bar}{mark}")
    return "\n".join(lines)


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", help="path to a saved chain JSON")
    args = ap.parse_args()

    if args.cache:
        ch0 = json.loads(Path(args.cache).read_text())
        prof = chain_profile_from_dict(ch0)
        date = Path(args.cache).stem.replace("chain_", "")
        print(f"\n=== cached chain {date} (nearest expiry)  spot={prof['spot']:.1f}  "
              f"netGEX=₹{prof['net_gex_cr']:,.0f}cr  flip={prof['zero_gamma_flip']}  "
              f"callWall={prof['call_wall']}  putWall={prof['put_wall']}  "
              f"maxGamma={prof['max_gamma_strike']} ===")
        rows = [r for r in prof["rows"] if abs(r["strike"] - prof["spot"]) <= 800]
        print(ascii_profile(rows, prof["spot"]))
        print("\nTop |net GEX| strikes (₹cr per 1% move):")
        for r in sorted(prof["rows"], key=lambda r: abs(r["net_gex_cr"]), reverse=True)[:8]:
            print(f"  {r['strike']:>6.0f}  net={r['net_gex_cr']:>9.1f}  call={r['call_gex_cr']:>9.1f} "
                  f"put={r['put_gex_cr']:>9.1f}  OI_ce={r['call_oi']:>10,} OI_pe={r['put_oi']:>10,}")
        (fd.CACHE_DIR / "gex_profile.json").write_text(json.dumps(
            {k: v for k, v in prof.items() if k != "rows"}, indent=2))
        return

    client = fd.FyersData(min_interval=0.6, verbose=False)
    ch0 = client.option_chain(strikecount=40, greeks=True)
    if not ch0:
        print("no chain (token expired?) — try --cache <saved chain.json>")
        return
    expiries = ch0["expiryData"][:4]
    out = {"expiries": []}
    for e in expiries:
        prof = chain_profile(client, e["expiry"], strikecount=40)
        if not prof:
            continue
        out["expiries"].append({"date": e["date"], "flag": e["expiry_flag"],
                                "net_gex_cr": prof["net_gex_cr"],
                                "zero_gamma_flip": prof["zero_gamma_flip"],
                                "call_wall": prof["call_wall"],
                                "put_wall": prof["put_wall"],
                                "max_gamma_strike": prof["max_gamma_strike"]})
        print(f"\n=== expiry {e['date']} ({e['expiry_flag']})  spot={prof['spot']:.1f}  "
              f"netGEX=₹{prof['net_gex_cr']:,.0f}cr  flip={prof['zero_gamma_flip']}  "
              f"callWall={prof['call_wall']}  putWall={prof['put_wall']}  "
              f"maxGamma={prof['max_gamma_strike']} ===")
        rows = [r for r in prof["rows"] if abs(r["strike"] - prof["spot"]) <= 800]
        print(ascii_profile(rows, prof["spot"]))
    (fd.CACHE_DIR / "gex_profile.json").write_text(json.dumps(out, indent=2))
    print("\nsaved gex_profile.json")


if __name__ == "__main__":
    main()
