# Typography

The Alphashri UI uses one six-step type scale. Dark-only, dense-terminal
product: legibility at 390px and 1600px matters more than a long editorial
ramp.

Source of truth:

- CSS: `src/tailwind.css` → `@theme` `--text-ui-*` custom properties.
- TypeScript/chart mirror: `src/ui/typography.ts` → `TYPE_SCALE`, `TYPE_CLASS`,
  `typeSize()`, `typeStyle()`.
- Provider aliases: `uiTheme.fontSizes` in `src/ui/theme.tsx`.

## The scale

| Utility | Token | Size | Line height | Use |
|---|---|---:|---:|---|
| `text-ui-micro` | `--text-ui-micro` | 12px | 16px | Dense labels, badges, axes, timestamps. Hard floor. |
| `text-ui-body` | `--text-ui-body` | 13px | 18px | Dense body copy, table cells, secondary values. |
| `text-ui-label` | `--text-ui-label` | 14px | 20px | Form labels, controls, nav items. |
| `text-ui-title` | `--text-ui-title` | 16px | 24px | Card and panel titles. |
| `text-ui-heading` | `--text-ui-heading` | 20px | 28px | Page-section headings. |
| `text-ui-display` | `--text-ui-display` | 24px | 32px | Page titles, hero values. |

Nothing in the product paints below **12px**. The former 9/10/11px dense
labels were raised during the 2026-11-23 legibility pass; the Index Report also
uses 12/13/17/24 (`REPORT_FONT`) with aliases that resolve onto this floor.

## Usage rules

1. **Classes first.** Use `text-ui-*` from `TYPE_CLASS`. Do not write
   `text-[13px]` or a private `fontSize`.
2. **Inline styles only when unavoidable** (SVG attributes, third-party prop
   objects, chart option builders). Import `typeStyle(role)` or `typeSize(role)`
   rather than embedding a number.
3. **Weight and colour are separate.** The scale owns size and line height;
   `font-bold`, `text-fin-text-muted` etc. still express emphasis.
4. **Do not shrink to fit.** If a label clips, change the component's width,
   wrapping, or panel height. Hiding overflow, ellipsis on essential data, or a
   smaller local font is not a typography fix.
5. **Charts share the scale.** `uiTheme.fontSizes` maps `sm/md/lg/xl` to
   micro/label/title/heading, so ECharts and canvas code cannot drift onto a
   second scale. For numeric APIs use `TYPE_SCALE.<role>.size`.
6. **No editorial display ramp.** A new size requires a new token, a test and a
   documented use; local one-off sizes are rejected in review.

## Migration map (legacy → role)

| Legacy | New |
|---:|---|
| 9px, 10px, 11px | `micro` (12px) |
| 12px | `micro` |
| 13px | `body` |
| 14px | `label` |
| 15px, 16px | `title` |
| 18px, 20px | `heading` |
| 22px, 23px, 24px+ | `display` |

## Verification

- `src/ui/typography.test.ts` — CSS/TS parity, floor, monotone ladder, chart
  aliases.
- `src/test/design-scale.test.ts` — no text below the legibility floor.
- Report-specific floors: `src/pages/report/reportFontFloor*.test.ts`,
  `ReportLegibility.test.tsx`, `ReportTypographyContrast.test.tsx`.

The catalog's **Design System / Typography → TypeScale** story renders every
role with its intended product use.
