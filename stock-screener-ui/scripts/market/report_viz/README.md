# report_viz — reusable report charts

Instrument-agnostic chart builders extracted from the NIFTY expiry books and
the 2026-11-18 tape review. This package is **additive**: it does not touch the
existing report generators or HTML.

## Use

```python
from scripts.market.report_viz import InstrumentSpec, render_page
from scripts.market.report_viz.charts.gex import gamma_flip_gex

spec = InstrumentSpec(
    symbol="SENSEX", name="SENSEX", venue="BSE",
    currency_symbol="₹", strike_step=100.0, lot_size=20,
    is_index=True, value_unit="₹ Cr/pt",
)

panel = gamma_flip_gex(
    {"t": [...], "spot": [...], "flip": [...],
     "net_gex": [...], "regime_gex": [...]},
    spec=spec,
)
page = render_page(title="SENSEX gamma", spec=spec, panels=[panel])
```

`panel()` embeds `{spec, data}` as JSON. The browser runtime in
`assets/core.js` dispatches `RV.charts[chart]` after DOM load; chart modules
register themselves in their own asset file. `render_page()` inlines the core
CSS/JS and every `assets/*.js` file, and loads D3 + Plotly from CDN.

## Rules

- Pass a real `InstrumentSpec`; never hardcode NIFTY, 25,000, 50, ₹ or a
  session window in a chart.
- Missing values are `None`; never coerce them to `0`.
- A heatmap/3D surface blank means “no print”, not zero.
- Preserve both GEX definitions: `net_gex` (all strikes) and `regime_gex`
  (cumulative strikes ≤ spot). They are different objects.
- A chart builder is pure: no file, network or DB reads.

## Gallery

```bash
.venv/bin/python scripts/market/report_viz/demo/build_demo.py
.venv/bin/python scripts/market/report_viz/demo/build_demo.py --sensex \
  --out /tmp/report_viz_sensex.html
```

The gallery uses a **synthetic fixture** and is only a rendering contract, not
market data. Real reports supply recorded series.

## Tests

```bash
.venv/bin/python -m pytest scripts/market/report_viz/tests -q -p no:xdist
```

No browser/network/DB is required for the tests. Visual acceptance is a
separate page check at 1600 and 390.
