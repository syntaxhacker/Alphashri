"""Read-only analytics probe for the live NSE option chains served by the local app.

Validates the planned smile / put-call parity / max-pain / GEX analytics against
real Upstox-backed chains without writing to the DB, Redis or the app. Every
option price comes from ``market_data.ltp`` -- never ``close_price``. A leg with
no LTP, no OI, an out-of-band IV or non-finite greeks is dropped and counted in
the data-quality line, not silently used.

Usage (project venv, API already running)::

    .venv/bin/python scripts/market/options_analytics_probe.py \
        --symbols NIFTY,RELIANCE,ONGC --expiries 3

    # auth token minted separately (skips the login POST)::
    .venv/bin/python scripts/market/options_analytics_probe.py \
        --symbols NIFTY --expiries 2 --token "$TOKEN"

Flags: --base, --email, --password, --token, --expiries, --r, --index-q,
--stock-q, --index-symbols, --parity-rel, --parity-pct, --smile, --timeout.
Run with --help for the full list.

Exit 0 = every request succeeded. Missing greeks, stale quotes and degraded
gamma coverage are printed as caveats, not errors. Exit 1 = a request failed
(auth/4xx/5xx, timeout, connection, malformed JSON).
"""

from __future__ import annotations

import argparse
import importlib.util
import math
import os
import statistics
import sys
from pathlib import Path
from typing import Any, Iterable, Optional

import requests

# Reuse the app's pure level formulas (no FastAPI/DB side effects). Loading the
# module file directly avoids importing the api package's router dependencies.
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.options_conventions import IV_MAX  # noqa: E402

_LEVELS_SPEC = importlib.util.spec_from_file_location(
    "options_levels", ROOT / "api" / "options_levels.py",
)
if _LEVELS_SPEC is None or _LEVELS_SPEC.loader is None:  # pragma: no cover
    raise RuntimeError("cannot load api/options_levels.py")
_levels = importlib.util.module_from_spec(_LEVELS_SPEC)
_LEVELS_SPEC.loader.exec_module(_levels)
compute_gex = _levels.compute_gex
compute_max_pain = _levels.compute_max_pain
normalize_strikes = _levels.normalize_strikes
top_walls = _levels.top_walls

DEFAULT_BASE = "http://127.0.0.1:8765"
QA_EMAIL = os.getenv("QA_EMAIL", "qa@test.com")
QA_PASSWORD = os.getenv("QA_PASSWORD")
INDEX_SYMBOLS = {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"}
PARITY_FLAG_PCT = 5.0


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

def raw_num(value: Any) -> Optional[float]:
    """Finite float or None; NaN/inf must not pass as a real greek/price."""
    try:
        out = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


def num(value: Any, default: float = 0.0) -> float:
    out = raw_num(value)
    return default if out is None else out


def leg_from_row(row: dict, side: str) -> dict:
    """Normalize one CE/PE leg. Price is LTP; close_price is never read."""
    leg = row.get(side) if isinstance(row, dict) else None
    if not isinstance(leg, dict):
        leg = {}
    market = leg.get("market_data") or {}
    greeks = leg.get("option_greeks") or {}
    ltp = num(market.get("ltp"))
    oi = num(market.get("oi"))
    iv = num(greeks.get("iv"))
    delta = num(greeks.get("delta"))
    gamma = num(greeks.get("gamma"))
    finite_greeks = raw_num(greeks.get("delta")) is not None and raw_num(greeks.get("gamma")) is not None
    for key in ("vega", "theta"):
        if key in greeks and greeks[key] is not None and raw_num(greeks[key]) is None:
            finite_greeks = False
    return {
        "strike": num(row.get("strike") if isinstance(row, dict) else None),
        "side": side.upper(),
        "ltp": ltp,
        "oi": oi,
        "iv": iv,
        "delta": delta,
        "gamma": gamma,
        "valid": bool(ltp > 0 and oi > 0 and 0 < iv <= IV_MAX and finite_greeks),
    }


def valid_legs(chain: Iterable[dict]) -> tuple[list[dict], list[dict]]:
    """Return (CE, PE) lists of tradeable legs, each sorted by strike."""
    calls: list[dict] = []
    puts: list[dict] = []
    for row in chain or []:
        if not isinstance(row, dict):
            continue
        for side, bucket in (("ce", calls), ("pe", puts)):
            leg = leg_from_row(row, side)
            if leg["valid"]:
                bucket.append(leg)
    calls.sort(key=lambda x: x["strike"])
    puts.sort(key=lambda x: x["strike"])
    return calls, puts


def data_quality(rows: Iterable[dict], quotes_live: Any) -> dict:
    """Coverage counters over *all* present legs (before the validity filter)."""
    legs = iv_present = iv_high = ltp_no_iv = 0
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        for side in ("ce", "pe"):
            leg = row.get(side)
            if not isinstance(leg, dict):
                continue
            legs += 1
            iv = num((leg.get("option_greeks") or {}).get("iv"))
            ltp = num((leg.get("market_data") or {}).get("ltp"))
            if 0 < iv:
                iv_present += 1
            if iv > IV_MAX:
                iv_high += 1
            if ltp > 0 and not (0 < iv):
                ltp_no_iv += 1
    return {
        "legs": legs,
        "iv_coverage_pct": round(iv_present / legs * 100, 1) if legs else 0.0,
        "iv_gt_max": iv_high,
        "ltp_no_iv": ltp_no_iv,
        "quotes_live": bool(quotes_live),
    }


def interpolate(points: Iterable[dict], target: float,
                xkey: str = "strike", ykey: str = "iv") -> dict:
    """Linear interpolation of ykey at target, clamped outside the sampled range.

    ``exact`` distinguishes a real interpolation/clamp from a hit on a sample.
    """
    pts = []
    for point in points or []:
        x, y = raw_num(point.get(xkey)), raw_num(point.get(ykey))
        if x is not None and y is not None:
            pts.append((x, y))
    pts.sort()
    if not pts:
        return {"value": 0.0, "exact": False, "lo": None, "hi": None}
    if target <= pts[0][0]:
        return {"value": pts[0][1], "exact": target == pts[0][0], "lo": pts[0], "hi": None}
    if target >= pts[-1][0]:
        return {"value": pts[-1][1], "exact": target == pts[-1][0], "lo": pts[-1], "hi": None}
    for lo, hi in zip(pts, pts[1:]):
        if lo[0] <= target <= hi[0]:
            if hi[0] == lo[0]:
                return {"value": lo[1], "exact": True, "lo": lo, "hi": hi}
            weight = (target - lo[0]) / (hi[0] - lo[0])
            value = lo[1] + weight * (hi[1] - lo[1])
            return {"value": value, "exact": lo[0] == target or hi[0] == target,
                    "lo": lo, "hi": hi}
    return {"value": pts[-1][1], "exact": False, "lo": pts[-1], "hi": None}


def atm_iv(calls: Iterable[dict], puts: Iterable[dict], spot: float) -> dict:
    """ATM IV from the two nearest valid strikes around spot (legs averaged)."""
    by_strike: dict[float, list[float]] = {}
    for leg in list(calls) + list(puts):
        by_strike.setdefault(leg["strike"], []).append(leg["iv"])
    points = [{"strike": k, "iv": sum(v) / len(v)} for k, v in by_strike.items()]
    return interpolate(points, spot)


def delta_iv(legs: Iterable[dict], target_delta: float) -> dict:
    """IV at a target delta (+0.25 call / -0.25 put), interpolated by delta."""
    return interpolate(legs, target_delta, xkey="delta")


def smile_stats(calls: list[dict], puts: list[dict], spot: float) -> dict:
    """ATM IV, 25-delta call/put IV, 25-delta risk reversal and butterfly."""
    atm = atm_iv(calls, puts, spot)
    call25 = delta_iv(calls, 0.25)
    put25 = delta_iv(puts, -0.25)
    c, p = call25["value"], put25["value"]
    return {
        "atm": atm, "call25": call25, "put25": put25,
        "rr": c - p, "fly": (c + p) / 2.0 - atm["value"],
    }


def otm_smile(calls: list[dict], puts: list[dict], spot: float, n: int = 6) -> list[dict]:
    """5-7 OTM points: calls above spot, puts below, nearest to spot first."""
    if spot <= 0 or n <= 0:
        return []
    per_side = max(1, math.ceil(n / 2))
    pools = []
    for legs, want_call in ((calls, True), (puts, False)):
        candidates = [
            leg for leg in legs
            if (leg["strike"] > spot if want_call else leg["strike"] < spot)
        ]
        candidates.sort(key=lambda leg: abs(leg["strike"] - spot))
        pools.append(candidates)
    picked = pools[0][:per_side] + pools[1][:per_side]
    used = {id(leg) for leg in picked}
    for pool in pools:
        for leg in pool:
            if len(picked) >= n:
                break
            if id(leg) not in used:
                picked.append(leg)
                used.add(id(leg))
    picked.sort(key=lambda leg: abs(leg["strike"] / spot - 1.0))
    return [{
        "strike": leg["strike"],
        "side": leg["side"],
        "moneyness_pct": round((leg["strike"] / spot - 1.0) * 100, 2),
        "iv": round(leg["iv"], 2),
        "delta": round(leg["delta"], 4),
    } for leg in picked[:n]]


def parity_stats(calls: list[dict], puts: list[dict], spot: float, years: float,
                 r: float, q: float, rel: float = 0.02,
                 flag_pct: float = PARITY_FLAG_PCT) -> dict:
    """Put-call parity error at the ±rel strikes: C - P = S e^-qT - K e^-rT."""
    call_by = {leg["strike"]: leg for leg in calls}
    put_by = {leg["strike"]: leg for leg in puts}
    common = sorted(set(call_by) & set(put_by))
    points: list[dict] = []
    if spot > 0 and common:
        for multiplier in (1.0 + rel, 1.0 - rel):
            target = spot * multiplier
            strike = min(common, key=lambda k: abs(k - target))
            theo = spot * math.exp(-q * years) - strike * math.exp(-r * years)
            diff = call_by[strike]["ltp"] - put_by[strike]["ltp"]
            error = diff - theo
            pct = abs(error) / spot * 100.0
            points.append({
                "strike": strike, "target": round(target, 2),
                "call": call_by[strike]["ltp"], "put": put_by[strike]["ltp"],
                "theoretical": round(theo, 3), "error": round(error, 3),
                "error_pct": round(pct, 3),
            })
    errors = [abs(point["error"]) for point in points]
    pcts = [point["error_pct"] for point in points]
    median_pct = round(statistics.median(pcts), 3) if pcts else None
    return {
        "points": points,
        "median_abs": round(statistics.median(errors), 3) if errors else None,
        "median_pct": median_pct,
        "flag": bool(median_pct is not None and median_pct > flag_pct),
    }


def level_stats(rows: Iterable[dict], spot: float, summary_max_pain: Any) -> dict:
    """Max pain / OI walls / GEX from the shared api.options_levels formulas."""
    strikes = normalize_strikes(rows)
    pain = compute_max_pain(strikes)
    summary = num(summary_max_pain)
    with_oi = [s for s in strikes if s["ce_oi"] or s["pe_oi"]]
    with_gamma = [s for s in with_oi if s["ce_gamma"] or s["pe_gamma"]]
    coverage = len(with_gamma) / len(with_oi) * 100.0 if with_oi else 0.0
    gex = compute_gex(strikes, spot)
    return {
        "max_pain": pain,
        "summary_max_pain": summary if summary > 0 else None,
        "agree": bool(pain is not None and summary > 0 and abs(pain - summary) < 1e-6),
        "ce_wall": top_walls(strikes, "ce", spot, n=1)[0] if strikes else None,
        "pe_wall": top_walls(strikes, "pe", spot, n=1)[0] if strikes else None,
        "gex": {
            "regime": gex["regime"],
            "support": gex["levels"]["support"],
            "resistance": gex["levels"]["resistance"],
            "flip": gex["zero_cross"],
            "gamma_coverage_pct": round(coverage, 1),
            "degraded": bool(gex["degraded"]) or coverage < 50.0,
        },
    }


# ---------------------------------------------------------------------------
# HTTP + report assembly
# ---------------------------------------------------------------------------

class Client:
    """Tiny bearer-token GET client; ``session`` is injectable for tests."""

    def __init__(self, base: str, timeout: float = 20.0,
                 session: Any = None, token: Optional[str] = None):
        self.base = base.rstrip("/")
        self.timeout = timeout
        self.session = session if session is not None else requests.Session()
        if token:
            self.session.headers.update({"Authorization": f"Bearer {token}"})

    def login(self, email: str, password: str) -> str:
        response = self.session.post(
            f"{self.base}/api/auth/login",
            json={"email": email, "password": password},
            timeout=self.timeout,
        )
        response.raise_for_status()
        token = (response.json() or {}).get("access_token")
        if not token:
            raise RuntimeError("login response has no access_token")
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        return token

    def get(self, path: str, **params: Any) -> dict:
        response = self.session.get(
            f"{self.base}{path}", params=params, timeout=self.timeout,
        )
        response.raise_for_status()
        return response.json()


def build_symbol_report(client: Client, symbol: str, n_expiries: int,
                        r: float, q: float, smile_n: int = 6,
                        flag_pct: float = PARITY_FLAG_PCT) -> dict:
    """One symbol: metadata + one analysis entry per requested expiry."""
    info = client.get(f"/api/options/underlying/{symbol}")
    spot = num(info.get("spot"))
    expiries = [e for e in (info.get("expiries") or []) if isinstance(e, dict)][:n_expiries]
    report = {
        "symbol": symbol,
        "spot": spot,
        "instrument_key": info.get("instrument_key"),
        "market_state": info.get("market_state"),
        "quotes_live": bool(info.get("quotes_live")),
        "fno": bool(info.get("fno")),
        "expiries": [],
        "caveats": [],
    }
    if not info.get("fno"):
        report["caveats"].append("no listed options")
        return report
    if not expiries:
        report["caveats"].append("no expiries listed")
    for expiry in expiries:
        date = expiry.get("date")
        data = client.get(f"/api/options/chain/{symbol}", expiry=date)
        rows = data.get("chain") or []
        summary = data.get("summary") or {}
        chain_spot = num(data.get("spot")) or spot
        calls, puts = valid_legs(rows)
        years = max(num(summary.get("dte")), 0.0) / 365.0
        report["expiries"].append({
            "expiry": date,
            "dte": num(summary.get("dte")),
            "rows": len(rows),
            "spot": chain_spot,
            "valid_ce": len(calls),
            "valid_pe": len(puts),
            "smile": smile_stats(calls, puts, chain_spot),
            "otm": otm_smile(calls, puts, chain_spot, smile_n),
            "parity": parity_stats(calls, puts, chain_spot, years, r, q, flag_pct=flag_pct),
            "levels": level_stats(rows, chain_spot, summary.get("max_pain")),
            "quality": data_quality(rows, info.get("quotes_live")),
        })
        if not rows:
            report["caveats"].append(f"{date}: empty chain")
        elif not calls and not puts:
            report["caveats"].append(f"{date}: no valid legs (LTP/OI/IV/greeks)")
    return report


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def fmt(value: Any, digits: int = 2, suffix: str = "") -> str:
    return "n/a" if value is None else f"{float(value):.{digits}f}{suffix}"


def fmt_level(level: Any) -> str:
    """GEX levels carry net_gex; OI walls carry oi."""
    if not level:
        return "n/a"
    value = level.get("net_gex")
    label = "gex"
    if value is None:
        value = level.get("oi")
        label = "oi"
    return f"{level['strike']:g} ({label} {value:+.2f})"


def print_report(report: dict, flag_pct: float) -> None:
    """Compact fixed-width lines; one block per expiry."""
    print(f"\n=== {report['symbol']}  spot {fmt(report['spot'])}  "
          f"market={report['market_state']}  quotes_live={report['quotes_live']} "
          f"fno={report['fno']} ===")
    for note in report["caveats"]:
        print(f"  CAVEAT: {note}")
    for entry in report["expiries"]:
        smile, parity, levels, quality = (entry["smile"], entry["parity"],
                                           entry["levels"], entry["quality"])
        print(f"  -- {entry['expiry']}  dte={entry['dte']:g}  rows={entry['rows']}  "
              f"chain_spot={fmt(entry['spot'])}  valid CE/PE={entry['valid_ce']}/{entry['valid_pe']}")
        print(f"     ATM IV {fmt(smile['atm']['value'], 2, '%')}"
              f"  25d CE {fmt(smile['call25']['value'], 2, '%')}"
              f"  25d PE {fmt(smile['put25']['value'], 2, '%')}"
              f"  RR {fmt(smile['rr'], 2)} volpt  fly {fmt(smile['fly'], 2)} volpt")
        smile_text = " ".join(
            f"{p['side']} {p['moneyness_pct']:+.1f}%:{p['iv']:.2f}(d{p['delta']:+.2f})"
            for p in entry["otm"]
        )
        print(f"     OTM smile  {smile_text or '(none)'}")
        ptext = " | ".join(
            f"K{p['strike']:g} C{p['call']:.2f}-P{p['put']:.2f}"
            f" err {p['error']:+.2f} ({p['error_pct']:.2f}%)"
            for p in parity["points"]
        )
        flag = "  !! >" + fmt(flag_pct, 0) + "%" if parity["flag"] else ""
        print(f"     Parity +-{2}%  median |err| {fmt(parity['median_abs'])}  "
              f"median % {fmt(parity['median_pct'], 3)}{flag}  [{ptext or 'no paired strikes'}]")
        gex = levels["gex"]
        print(f"     MaxPain recomputed {fmt(levels['max_pain'], 1)} vs summary "
              f"{fmt(levels['summary_max_pain'], 1)} agree={levels['agree']} | "
              f"CE wall {fmt_level(levels['ce_wall'])}  PE wall {fmt_level(levels['pe_wall'])}")
        print(f"     GEX regime={gex['regime']} support={fmt_level(gex['support'])} "
              f"resistance={fmt_level(gex['resistance'])} flip={fmt(gex['flip'], 1)} "
              f"gamma_cov={gex['gamma_coverage_pct']}%"
              f"{' DEGRADED' if gex['degraded'] else ''}")
        print(f"     Quality legs={quality['legs']} IVcov={fmt(quality['iv_coverage_pct'], 1, '%')} "
              f"IV>MAX={quality['iv_gt_max']} LTP>0&IV=0={quality['ltp_no_iv']} "
              f"quotes_live={quality['quotes_live']}")


def parse_symbols(text: str) -> list[str]:
    return [part.strip().upper() for part in text.split(",") if part.strip()]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate live NSE option-chain analytics (read-only).",
        epilog=(
            "Example: .venv/bin/python scripts/market/options_analytics_probe.py "
            "--symbols NIFTY,RELIANCE --expiries 2\n"
            "Exit 0 = all requests OK (gaps printed); exit 1 = request/JSON failure."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--symbols", default="NIFTY", help="comma-separated underlyings (default: NIFTY)")
    parser.add_argument("--expiries", type=int, default=3, help="nearest N expiries per symbol (default: 3)")
    parser.add_argument("--base", default=DEFAULT_BASE, help=f"API base URL (default: {DEFAULT_BASE})")
    parser.add_argument("--email", default=QA_EMAIL, help=f"QA login email (default: {QA_EMAIL})")
    parser.add_argument("--password", default=QA_PASSWORD,
                        help="QA login password (default: QA_PASSWORD env; skips login only with --token)")
    parser.add_argument("--token", default=None, help="bearer token; skips the login POST")
    parser.add_argument("--r", type=float, default=0.065, help="risk-free rate for parity (default: 0.065)")
    parser.add_argument("--index-q", type=float, default=0.02, help="dividend yield for indices (default: 0.02)")
    parser.add_argument("--stock-q", type=float, default=0.0, help="dividend yield for stocks (default: 0.0)")
    parser.add_argument("--index-symbols", default=",".join(sorted(INDEX_SYMBOLS)),
                        help="comma-separated symbols treated as indices")
    parser.add_argument("--parity-rel", type=float, default=0.02, help="parity strike offset (default: 0.02)")
    parser.add_argument("--parity-pct", type=float, default=PARITY_FLAG_PCT,
                        help="flag median parity error above this %% of spot (default: 5)")
    parser.add_argument("--smile", type=int, default=6, help="number of OTM smile points (default: 6)")
    parser.add_argument("--timeout", type=float, default=20.0, help="per-request timeout seconds (default: 20)")
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    symbols = parse_symbols(args.symbols)
    index_symbols = set(parse_symbols(args.index_symbols))
    if not symbols:
        print("ERROR: --symbols is empty", file=sys.stderr)
        return 1
    if not args.token and not args.password:
        print("ERROR: QA_PASSWORD is unset and no --token was supplied; "
              "set QA_PASSWORD (optionally QA_EMAIL) or pass --token", file=sys.stderr)
        return 1
    client = Client(args.base, timeout=args.timeout)
    try:
        if not args.token:
            client.login(args.email, args.password)
        reports = []
        for symbol in symbols:
            q = args.index_q if symbol in index_symbols else args.stock_q
            reports.append(build_symbol_report(
                client, symbol, max(args.expiries, 0), args.r, q,
                smile_n=max(args.smile, 0), flag_pct=args.parity_pct,
            ))
    except (requests.RequestException, ValueError, RuntimeError, KeyError, TypeError) as exc:
        print(f"ERROR: request/parse failure: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    for report in reports:
        print_report(report, args.parity_pct)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
