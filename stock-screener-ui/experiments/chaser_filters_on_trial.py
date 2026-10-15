"""Trial: verify enable_filters=True bites on 2 symbols before full sweep."""
import sys

sys.path.insert(0, ".")


def run(symbols, params):
    from backtest.engine import get_engine
    eng = get_engine()
    res = eng.run("52w_chaser", symbols, days=365, params=params)
    by_sym = {r.get("symbol"): r for r in (res.get("results") or [])}
    skips = list(res.get("skipped_stocks") or [])
    for s in symbols:
        r = by_sym.get(s)
        if r:
            print(f"params={params} {s}: trades={r.get('trades')} "
                  f"net={r.get('net_pnl')} wins={r.get('wins')}", flush=True)
        else:
            print(f"params={params} {s}: NO RESULT (skip?)", flush=True)
    print(f"params={params} skipped={skips}", flush=True)
    return by_sym


if __name__ == "__main__":
    syms = ["BHEL", "CUMMINSIND"]
    off = run(syms, {})
    on = run(syms, {"enable_filters": True})
    # gate-bite check: filters-on must differ from filters-off
    identical = all(
        off.get(s, {}).get("trades") == on.get(s, {}).get("trades")
        and off.get(s, {}).get("net_pnl") == on.get(s, {}).get("net_pnl")
        for s in syms
    )
    # expected reference values from chaser_fixed.json verification block
    exp_off = {"BHEL": (6, -256.51), "CUMMINSIND": (4, 61058.86)}
    exp_on = {"BHEL": (1, -1493.01), "CUMMINSIND": (2, 48513.76)}
    for s in syms:
        r = off.get(s, {})
        e = exp_off[s]
        print(f"OFF {s}: got ({r.get('trades')}, {r.get('net_pnl')}) "
              f"expected {e} match={r.get('trades') == e[0] and r.get('net_pnl') == e[1]}")
        r = on.get(s, {})
        e = exp_on[s]
        print(f"ON  {s}: got ({r.get('trades')}, {r.get('net_pnl')}) "
              f"expected {e} match={r.get('trades') == e[0] and r.get('net_pnl') == e[1]}")
    if identical:
        print("ABORT: filters-on trades identical to filters-off — gates NOT biting")
        sys.exit(1)
    print("GATES BITE: filters-on differs from filters-off — proceed to full sweep")
