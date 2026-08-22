# Storybook Architecture — Alphashri UI System

Production-ready component development & documentation system. Governing doc for how Storybook is organized, extended, and gated.

## 1. Architecture

Five layers. Dependencies point downward only — a Pattern may use Primitives; a Primitive never imports from `components/`.

```
src/
├── ui/                    # L1+L2: primitives (Mantine v8 wrappers) — barrel @/ui
│   ├── palette.ts         #   design tokens (colors) — SINGLE SOURCE OF TRUTH
│   ├── theme.tsx          #   theme assembly (scales, semantic virtualColors)
│   ├── types.ts           #   UI*Props contracts
│   └── <category>/        #   layout|typography|inputs|feedback|data-display|
│                          #   overlay|navigation|misc|dates
├── components/common/     # L3: composites (TanStackTable, compact, states, badges)
├── stories/foundations/   # token docs (Colors, Typography, Spacing & Elevation)
├── components/<feature>/  # feature code (not part of the library proper)
└── pages/                 # routes
```

| Layer | Location | May import | Story title |
|---|---|---|---|
| Tokens | `ui/palette.ts`, `ui/theme.tsx` | nothing | `Foundations/*` |
| Primitives | `src/ui/**` | tokens, Mantine | `Primitives/<Category>/<Name>` |
| Composites | `components/common/**` | primitives | `Composites/<Name>` |
| Patterns | `components/patterns/**` (future) | composites | `Patterns/<Name>` |
| Feature examples | feature stories | anything | `Examples/<Feature>/<Name>` |

## 2. Story Organization

Every primitive story file covers, where applicable:

- **Default** — canonical usage with realistic domain data (NSE symbols, ₹ amounts)
- **Variants / Sizes** — one story per axis, not per prop value
- **States** — disabled, loading, error/validation, empty
- **Long content** — real-length strings that break naive layouts
- **⚡ Interaction story** — `play()` flow test (exemplar: `src/ui/inputs/Select.stories.tsx`)
- **Responsive** — check at 375 / 768 / 1280 via viewport toolbar

Banned: lorem ipsum, "John Doe", `123` as data, one-trivial-prop stories.

## 3. Navigation Hierarchy

```
Introduction/Overview   ← start here
Foundations             ← Colors · Typography · Spacing & Elevation (real tokens)
Primitives              ← Layout · Typography · Inputs · Feedback · Data Display ·
                          Overlays · Navigation · Misc · Dates
Composites              ← TanStackTable · Badges · PnL · Compact · States · …
Patterns                ← grow over time (FilterBar, StatCard, ConfirmDialog)
Examples                ← App Layout · Screener · Strategies (feature-owned demos)
```

Rules: new primitive → `Primitives/<its category>/`. Never invent a top-level folder without updating this doc. Feature product-flow demos go under `Examples/`. `tags: ["autodocs"]` on every component meta.

## 4. Documentation Strategy

Storybook is the SSOT for UI usage. Each component documents inline (JSDoc above meta + `docs.description.component`): purpose, when-to-use / when-not, Do/Don't using app idioms (`Text size="xs" c="dimmed"`, green-up/red-down), and a11y notes (keyboard map, label requirements). Props tables come free from typed args. Architecture decisions live here — not duplicated per component.

## 5. Design Token Strategy

- Colors: `src/ui/palette.ts` — raw anchors + Mantine scales + semantic aliases (`POSITIVE`, `NEGATIVE`, `PRIMARY`). Hardcoded hex in components = review-blocking.
- Spacing/radius/shadows: Mantine scale names only (`xs…xl`); arbitrary px only inside chart internals.
- White-label future: scales are plain arrays — swap tuples per theme; `virtualColor`s handle light/dark automatically. Zero component changes needed.

## 6. Theme Strategy

`.storybook/preview.tsx` wraps every story in `MantineProvider forceColorScheme={global}` with a Light/Dark toolbar toggle (default Light). Components must render correctly in both. Literal colors must come from `palette.ts`, never inline.

## 7. Accessibility

- `@storybook/addon-a11y` runs axe on every story (panel + CI via test runner).
- Interactive primitives carry a keyboard map in their docs description.
- Form controls require visible labels or `aria-label`; error states use the wrapper's `error` prop (Mantine wires `aria-invalid`).
- Policy: serious/critical axe violations fail CI; minor need a waiver comment.

## 8. Interaction Testing

play functions with `storybook/internal/test` (`expect`, `userEvent`, `within`) for behavior flows: open → search → select → assert (Select exemplar). Prefix with "⚡ Interaction:". Run headless via the storybook test runner. Never duplicate as vitest specs — one behavior lives at one layer.

## 9. Visual Regression

Constraint now, tool later: stories must be deterministic — no `Date.now()`, random IDs, network calls, mid-frame animations. When adopting Chromatic/Loki: snapshot Default/Variants/States only; exclude Examples.

## 10. Responsive Testing

Verify layout-affecting stories at 375 / 768 / 1280 (viewport toolbar). Grid/SimpleGrid/AppShell include explicit responsive demos.

## 11. Realistic Data

Domain-real fixtures: NSE symbols at real lengths (`M&M`, LICI's full name), ₹ prices, IST timestamps, negative P&L, empty collections. Shared fixtures under `src/stories/fixtures/` when 3+ stories need them.

## 12. API & State Isolation

No story calls production APIs. Network-dependent composites are demoed via mocked modules or prop-driven variants. `bun run storybook` must work with zero backend.

## 13. Enterprise Concerns

Dark/light (toolbar), IST helpers (`utils/ui-helpers`), TanStackTable windowing (500-row story), empty/disabled states per component. i18n is EN/₹-only today — if it lands, add `Foundations/Localization` before touching primitives.

## 14. Testing Strategy

```
            E2E  (Playwright tests/e2e — journeys only)
           /  \
        Visual (future: Chromatic — stable stories)
         /
   Interaction (play() — component behavior flows)
         /
     Unit + a11y (vitest *.test.tsx + addon-a11y in SB)
```

One behavior, one layer: rendering → unit; click-flows → play(); journeys → E2E; pixels → visual. Never duplicate.

## 15. CI/CD

Install → lint → typecheck → unit tests → **build-storybook** → (future) storybook test runner (interaction + a11y) → visual regression → deploy static build. A failing story fails the PR exactly like a failing spec. Current pipeline already covers lint/typecheck/unit; add the storybook runner next.

## 16. Component Quality Checklist

Before merge:

- [ ] Strong TS types (`UI*Props` in `types.ts`)
- [ ] `tags: ["autodocs"]` + docs description (purpose / when-not / a11y)
- [ ] All important states covered (disabled / loading / error / empty / long content)
- [ ] At least one play() interaction where behavior matters
- [ ] `vitest` specs co-located (`*.test.tsx`) still pass
- [ ] No hardcoded Hex outside `palette.ts`; no `@mantine/core` import outside `src/ui`
- [ ] Renders correctly in Light + Dark; viewport 375/768/1280 checked

## 17. Developer Experience

Search by component name (filter bar), click a story to read props/docs, toggle Controls to try every variant, hit the color-scheme toolbar to verify both themes, resize viewport to test responsive. Every story should be copy-pasteable into app code (`import { Button } from "@/ui"`).

## 18. Performance

Story data is static. No real API calls in Storybook. Lazy route-level code splitting in the app prevents ui package from bloating previews. Keep each story file <150 lines; share large mock datasets via fixtures.

## 19. Governance

Proposing a new primitive answers 10 questions:

1. Why does it exist? 2. Is an existing one sufficient? 3. What API? 4. What states? 5. How is it a11y? 6. Responsive requirements? 7. Design tokens used? 8. Stories required? 9. Tests required? 10. Owner?

PR label `design-system` triggers CODEOWNERS review (frontend architect). A single-maintainer `CODEOWNERS` entry covers `src/ui/**`.

## 20. Migration Plan

**Done this PR:**

- Retitled all 60+ stories from `Design System/UI/*` → enterprise hierarchy (`Primitives/*`, `Composites/*`, `Introduction/*`, `Examples/*`)
- Added `Foundations/Colors`, `Foundations/Typography`, `Foundations/Spacing & Elevation` from real tokens
- `Introduction/Overview` landing page
- Production-grade exemplar: `Primitives/Inputs/Select` — realistic NSE data + `play()` search→select interaction test

**Next increments (separate PRs, in order):**

1. Patterns layer: extract repeated composites into `Patterns/` once 2+ features duplicate the same UI (FilterBar, StatCard, ConfirmDialog are candidates)
2. Wire `storybook/internal/test` runner in CI (run play + a11y headless)
3. Adopt Chromatic for visual regression on Primitives + stable Composites Defaults
4. Expand `Patterns/` docs with Forms/Search/Filtering usage guides using real product flows

## Reference: Exemplar Production Story

`src/ui/inputs/Select.stories.tsx` demonstrates the standard: realistic domain data, helper/error/disabled/long-content/empty states, and an interaction story prefixed "⚡ Interaction:" with a `play()` function asserting search → select via `userEvent` + `within(document.body)`.
