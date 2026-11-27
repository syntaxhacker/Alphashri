#!/usr/bin/env python3

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.market.report_viz.charts.flow import (
    flow_heatmap,
    flow_share,
    flow_stream,
    flow_top_itm,
)
from scripts.market.report_viz.charts.futures import (
    futures_basis,
    futures_price_oi,
    futures_regimes,
    futures_volume,
)
from scripts.market.report_viz.charts.gex import (
    gamma_flip_gex,
    gex_by_strike,
    gex_profiles,
    gex_surface,
)
from scripts.market.report_viz.charts.pin import (
    pin_null,
    pin_score,
    spot_pin,
    wall_migration,
)
from scripts.market.report_viz.charts.positioning import ce_pe_net_positioning
from scripts.market.report_viz.charts.tape import (
    rv_iv,
    straddle_1sigma,
    tape_basis,
    tape_oi_change,
    tape_oi_pcr,
    tape_spot_futures,
    tape_strikes,
    tape_surface,
    tape_timeline,
    tape_volume,
    tape_walls,
)
from scripts.market.report_viz.charts.volatility import iv_smile, levels_distance
from scripts.market.report_viz.contracts import InstrumentSpec
from scripts.market.report_viz.page import render_page

OUT = Path(__file__).resolve().parent / "index.html"


def _clock(minute: int) -> str:
    return f"{minute // 60:02d}:{minute % 60:02d}"


def _fixture():
    minutes = [9 * 60 + 15 + 10 * i for i in range(38)]
    times = [_clock(m) for m in minutes]
    spot = [round(25_220 + 48 * math.sin(i / 5.5) + 18 * math.cos(i / 2.3), 2) for i in range(len(times))]
    futures = [round(s + 20 + 9 * math.sin(i / 4), 2) for i, s in enumerate(spot)]
    max_pain = [25_000 if i < 22 else 25_050 for i in range(len(times))]
    call_wall = [25_200 if i < 15 else 25_250 for i in range(len(times))]
    put_wall = [24_800 if i < 20 else 24_850 for i in range(len(times))]
    flip = [round(s - 30 + 12 * math.sin(i / 3), 2) for i, s in enumerate(spot)]
    net_gex = [round(90 * math.sin(i / 4) + 30 * math.cos(i / 9), 1) for i in range(len(times))]
    regime_gex, running = [], 0.0
    for value in net_gex:
        running += value
        regime_gex.append(round(running, 1))
    dist_pin = [round(s - mp, 1) for s, mp in zip(spot, max_pain)]
    pin = [max(5.0, min(95.0, 60.0 + 30.0 * math.sin(i / 4))) for i in range(len(times))]
    bands = [50.0 if i < 20 else 25.0 for i in range(len(times))]
    null_p05 = [round(14 + 6 * math.sin(i / 5), 1) for i in range(len(times))]
    null_p50 = [round(34 + 8 * math.sin(i / 6), 1) for i in range(len(times))]
    null_p95 = [round(72 + 14 * math.sin(i / 7), 1) for i in range(len(times))]
    obs = [round(abs(d), 1) for d in dist_pin]

    strikes = [24_800 + 50 * i for i in range(11)]
    profiles = [
        {
            "label": "11:30",
            "t": "11:30",
            "spot": 25_240.0,
            "max_pain": 25_000.0,
            "flip": 25_210.0,
            "strikes": strikes,
            "net_gex": [round(120 * math.sin(j / 2 + 0.2), 1) for j in range(len(strikes))],
        },
        {
            "label": "13:00",
            "t": "13:00",
            "spot": 25_180.0,
            "max_pain": 25_000.0,
            "flip": 25_150.0,
            "strikes": strikes,
            "net_gex": [round(160 * math.sin(j / 2 + 1.1), 1) for j in range(len(strikes))],
        },
        {
            "label": "15:00",
            "t": "15:00",
            "spot": 25_260.0,
            "max_pain": 25_050.0,
            "flip": 25_220.0,
            "strikes": strikes,
            "net_gex": [round(180 * math.sin(j / 2 + 2.2), 1) for j in range(len(strikes))],
        },
    ]
    surface_times = times[::5]
    surface_minutes = minutes[::5]
    surface_strikes = [24_800 + 50 * i for i in range(11)]
    surface_z = []
    oi_surface_z = []
    for j, _strike in enumerate(surface_strikes):
        surface_z.append([
            round(80 * math.sin(j / 2 + k / 2), 1) for k in range(len(surface_times))
        ])
        oi_surface_z.append([
            round(40 + 28 * abs(math.sin(j / 2 + k / 3)), 1)
            for k in range(len(surface_times))
        ])

    regimes = ("long_buildup", "short_buildup", "long_unwinding", "short_covering")
    futures_rows = [
        {
            "t": t,
            "close": f,
            "oi": 11_400_000 + i * 2_500,
            "volume": 10_000 + (i * 137) % 9_000,
            "regime": regimes[(i // 5) % len(regimes)],
        }
        for i, (t, f) in enumerate(zip(times, futures))
    ]
    flow_rows = [
        {
            "t": t,
            "ce": 220 + 70 * math.sin(i / 2),
            "pe": 190 + 60 * math.cos(i / 3),
            "ce_itm": 55 + 25 * math.sin(i / 2),
            "pe_itm": 42 + 28 * math.cos(i / 4),
            "share": 18 + 7 * math.sin(i / 5),
            "spot": s,
        }
        for i, (t, s) in enumerate(zip(times, spot))
    ]
    heat_labels = times[::5]
    heat_strikes = [24_800 + 50 * i for i in range(10)]
    heat_matrix = [
        [None if (j == 2 and k == 3) else round(20 + 18 * abs(math.sin(j + k / 2)), 1)
         for k in range(len(heat_labels))]
        for j in range(len(heat_strikes))
    ]
    return {
        "times": times,
        "spot": spot,
        "futures": futures,
        "max_pain": max_pain,
        "call_wall": call_wall,
        "put_wall": put_wall,
        "flip": flip,
        "net_gex": net_gex,
        "regime_gex": regime_gex,
        "dist_pin": dist_pin,
        "pin": pin,
        "bands": bands,
        "obs": obs,
        "p05": null_p05,
        "p50": null_p50,
        "p95": null_p95,
        "strikes": strikes,
        "profiles": profiles,
        "surface_times": surface_times,
        "surface_minutes": surface_minutes,
        "surface_strikes": surface_strikes,
        "surface_z": surface_z,
        "oi_surface_z": oi_surface_z,
        "futures_rows": futures_rows,
        "flow_rows": flow_rows,
        "heat_labels": heat_labels,
        "heat_strikes": heat_strikes,
        "heat_matrix": heat_matrix,
        "top_itm": [
            {"strike": 25_100, "pe_itm": 180, "pe": 420, "share": 28.0},
            {"strike": 24_950, "pe_itm": 150, "pe": 360, "share": 23.0},
            {"strike": 25_200, "pe_itm": 120, "pe": 280, "share": 19.0},
            {"strike": 24_900, "pe_itm": 90, "pe": 220, "share": 14.0},
        ],
        "iv_points": [
            {"strike": 24_800 + 50 * i,
             "ce_iv": None if i == 7 else round(18 + 4 * abs(i - 5), 2),
             "pe_iv": None if i == 0 else round(20 + 3 * abs(i - 4), 2)}
            for i in range(11)
        ],
        "levels": [
            {"label": "Call wall", "kind": "call", "strike": 25_250},
            {"label": "Max pain", "kind": "max_pain", "strike": 25_000},
            {"label": "Put wall", "kind": "put", "strike": 24_850},
        ],
        "oi_changes": [
            {"strike": 24_800 + 50 * i,
             "ce_change": round(1_200 * math.sin(i / 2), 0),
             "pe_change": round(900 * math.cos(i / 3), 0)}
            for i in range(11)
        ],
        "view": {"x": list(range(len(surface_times))), "z": surface_z},
    }


def build(spec: InstrumentSpec) -> str:
    d = _fixture()
    panels = [
        spot_pin({"t": d["times"], "spot": d["spot"], "max_pain": d["max_pain"],
                  "call_wall": d["call_wall"], "put_wall": d["put_wall"],
                  "pin_band": d["bands"]}, spec=spec),
        pin_score({"t": d["times"], "pin_score": d["pin"], "dist_pin": d["dist_pin"],
                   "pin_band": d["bands"]}, spec=spec),
        pin_null({"t": d["times"], "obs": d["obs"], "p05": d["p05"],
                  "p50": d["p50"], "p95": d["p95"]}, spec=spec),
        wall_migration({"t": d["times"], "spot": d["spot"], "max_pain": d["max_pain"],
                        "call_wall": d["call_wall"], "put_wall": d["put_wall"]}, spec=spec),
        ce_pe_net_positioning([
            {
                "t": t,
                "ce": 1_800_000 * math.sin(i / 4),
                "pe": -1_200_000 * math.cos(i / 5),
                "spot": s,
            }
            for i, (t, s) in enumerate(zip(d["times"], d["spot"]))
        ], spec=spec, unit="M contracts", scale=1_000_000),
        gamma_flip_gex({"t": d["times"], "spot": d["spot"], "flip": d["flip"],
                        "net_gex": d["net_gex"], "regime_gex": d["regime_gex"]}, spec=spec),
        gex_profiles({"profiles": d["profiles"]}, spec=spec),
        gex_surface({"times": d["surface_times"], "minutes": d["surface_minutes"],
                     "strikes": d["surface_strikes"], "z": d["surface_z"]}, spec=spec),
        gex_by_strike({"label": "15:00", "strikes": d["strikes"],
                       "net_gex": d["profiles"][2]["net_gex"],
                       "spot": d["spot"][-1], "max_pain": d["max_pain"][-1],
                       "flip": d["flip"][-1]}, spec=spec),
        futures_price_oi(d["futures_rows"], spec=spec),
        futures_basis([{"t": t, "close": f, "spot": s}
                       for t, f, s in zip(d["times"], d["futures"], d["spot"])], spec=spec),
        futures_regimes(d["futures_rows"], spec=spec),
        futures_volume(d["futures_rows"], spec=spec),
        flow_stream(d["flow_rows"], spec=spec),
        flow_share(d["flow_rows"], spec=spec),
        flow_heatmap(d["heat_labels"], d["heat_strikes"], d["heat_matrix"], spec=spec),
        flow_top_itm(d["top_itm"], spec=spec),
        iv_smile(d["iv_points"], spot=d["spot"][-1], spec=spec),
        levels_distance(d["levels"], spot=d["spot"][-1], spec=spec),
        tape_spot_futures({"t": d["times"], "spot": d["spot"], "futures": d["futures"]}, spec=spec),
        tape_basis({"t": d["times"], "basis": [round(f - s, 2) for f, s in zip(d["futures"], d["spot"])]}, spec=spec),
        tape_oi_pcr({"t": d["times"], "ce_oi": [100_000_000 + i * 1_000 for i in range(len(d["times"]))],
                     "pe_oi": [90_000_000 + i * 1_200 for i in range(len(d["times"]))],
                     "pcr": [round(0.9 + 0.05 * math.sin(i / 4), 3) for i in range(len(d["times"]))]}, spec=spec),
        tape_volume({"labels": d["heat_labels"],
                     "ce": [220 + 30 * math.sin(i / 2) for i in range(len(d["heat_labels"]))],
                     "pe": [190 + 35 * math.cos(i / 2) for i in range(len(d["heat_labels"]))]}, spec=spec),
        tape_walls({"t": d["times"], "spot": d["spot"], "max_pain": d["max_pain"],
                    "call_wall": d["call_wall"], "put_wall": d["put_wall"]}, spec=spec),
        tape_surface({"x": d["view"]["x"], "xlabels": d["surface_times"],
                      "y": d["surface_strikes"], "z": d["oi_surface_z"]}, spec=spec),
        tape_strikes({"strike": d["strikes"],
                      "ce_oi": [120 + 10 * i for i in range(len(d["strikes"]))],
                      "pe_oi": [110 + 12 * i for i in range(len(d["strikes"]))]}, spec=spec),
        tape_oi_change(d["oi_changes"], spec=spec),
        tape_timeline([
            {"label": "Opening drive", "start": 0, "duration": 45, "change": -72},
            {"label": "Midday base", "start": 45, "duration": 150, "change": 18},
            {"label": "Afternoon rip", "start": 195, "duration": 135, "change": 84},
            {"label": "Close", "start": 330, "duration": 45, "change": -12},
        ], spec=spec),
        rv_iv({"t": d["times"],
               "iv": [round(18 + 3 * math.sin(i / 5), 2) for i in range(len(d["times"]))],
               "rv": [round(14 + 2 * math.cos(i / 6), 2) for i in range(len(d["times"]))]}, spec=spec),
        straddle_1sigma({"t": d["times"],
                         "straddle": [round(180 + 22 * math.sin(i / 4), 1) for i in range(len(d["times"]))],
                         "realised": [round(14 + 7 * math.cos(i / 5), 1) for i in range(len(d["times"]))]}, spec=spec),
    ]
    return render_page(
        title="Reusable report charts — NIFTY fixture",
        spec=spec,
        panels=panels,
        intro=(
            "Synthetic component gallery using the same builders as the 2026-11-17 "
            "expiry book and the 2026-11-18 tape review. It is not market data."
        ),
        footer=(
            "Every panel is produced by scripts/market/report_viz/charts/*.py and "
            "rendered by the shared assets/core.js + per-family renderers."
        ),
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(OUT))
    parser.add_argument("--sensex", action="store_true", help="use a SENSEX-like 100-point spec")
    args = parser.parse_args()
    spec = (
        InstrumentSpec(symbol="SENSEX", name="SENSEX", venue="BSE", currency_symbol="₹",
                       strike_step=100.0, lot_size=20, is_index=True, value_unit="₹ Cr/pt",
                       oi_unit="contracts")
        if args.sensex
        else InstrumentSpec(symbol="NIFTY", name="NIFTY", venue="NSE", currency_symbol="₹",
                            strike_step=50.0, lot_size=75, is_index=True, value_unit="₹ Cr/pt",
                            oi_unit="contracts")
    )
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(build(spec))
    print(f"wrote {out} ({out.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
