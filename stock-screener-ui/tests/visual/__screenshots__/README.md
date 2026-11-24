# Visual-regression baselines

This directory holds the committed PNG baselines for the A+ visual gate. The
PNGs are **generated**, not hand-written: run

```sh
npm run build-storybook
UPDATE_SNAPSHOTS=1 node scripts/visual-regression.mjs
```

from `stock-screener-ui/`, review the resulting PNG diffs, and commit them.

Expected files (6 stories x 2 viewports):

- `typography-landing-{desktop-1600,mobile-390}.png`
- `overview-{desktop-1600,mobile-390}.png`
- `inputs-landing-{desktop-1600,mobile-390}.png`
- `data-display-landing-{desktop-1600,mobile-390}.png`
- `overlay-landing-{desktop-1600,mobile-390}.png`
- `foundations-landing-{desktop-1600,mobile-390}.png`

A normal `node scripts/visual-regression.mjs` run fails clearly if any of these
are missing. See `docs/VISUAL_REGRESSION.md` for the full procedure.
