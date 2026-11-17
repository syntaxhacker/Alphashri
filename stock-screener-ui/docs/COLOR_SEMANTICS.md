# Colour semantics

Single source for what a colour means. Tokens live in `src/ui/palette.ts`; the
contrast maths lives in `src/utils/contrast.ts`.

## Side coding

- **CE / calls = blue** (`OI_CALL` → `INFO`).
- **PE / puts = orange** (`OI_PUT` → `WARNING`).
- Applies to OI bars, smile legend, chain headers and any side-coded chart.
- OI is **not** bullish/bearish. Green/red OI implied a P&L direction that does
  not exist; do not reintroduce it.

## Level coding

| Meaning | Token | Colour |
|---|---|---|
| Call wall (resistance) | `LEVEL_CALL_WALL` | red |
| Put wall (support) | `LEVEL_PUT_WALL` | green |
| Max pain | `LEVEL_MAX_PAIN` | amber |
| Gamma support | `LEVEL_SUPPORT` | green |
| Gamma resistance | `LEVEL_RESISTANCE` | red |

Never paint CW/PW with `OI_CALL`/`OI_PUT`; side coding and level coding are
different concepts.

## Patterns

### OI cell / magnitude bars

A solid saturated fill behind 10px text measures ~2.6:1. Use:

- a **2px solid rail** for the token, and
- a **≤14% tint** for the area, and
- normal `TEXT` on the surface.

Reference: `src/components/options-dock/chain.columns.tsx`.

### Level rows

- CW: left **2px red inset rail** + **8% red tint**.
- PW: right **2px green inset rail** + **8% green tint**.
- Both walls at one strike: both rails, no mixed tint.
- MP: **7% amber tint** (or outline), not a solid block.
- ATM keeps its amber fill; a level tint must not replace it.
- Reference: `src/components/options-dock/chainHighlight.ts`.

### Badges / chips / code blocks

If the whole shape is a solid fill, use `pickTextColor(fill)` for the ink.
`Badge` and `Code` already do this. If the shape is a tint, keep ink on the
surface token.

## Contrast gate

- **Text:** ≥ 4.5:1.
- **Meaningful graphics:** ≥ 3:1 (bars, rails, control boundaries).
- **Decorative hairlines/dividers:** exempt; keep them subtle.
- New fill/tint/text pairs must be added to `src/test/contrast.test.ts` and
  `scripts/check_contrast.ts`, then run `bun run contrast`.
- The matrix checks every semantic token at 8/10/12/14% over the surface, the
  token as ink, the token as a 2px rail, and `pickTextColor` on the solid fill.

## Do not

- Put `TEXT` directly on `POSITIVE`, `NEGATIVE`, `INFO`, `WARNING`, `PRIMARY`
  or an `OI_*`/`LEVEL_*` solid fill.
- Use a green/red pair for something that is not directional.
- Reuse a level token for a side, or an OI token for a wall.
- Add a raw `#RRGGBB`/`rgba()` outside `palette.ts`.
