# Visual Audit — Design System Storybook evidence

**Branch:** `improve/ds-p3-tokens-forms-tests` (worktree `/tmp/opencode/ds-p3/stock-screener-ui`)
**Date:** 2026-11-23
**Method:** read-only. Read all 35 PNGs in `docs/screenshots/showcase/` (the 13 family pages at 1600/390 where both exist, plus component-level shots), the 13 family stories in `src/stories/design-system/`, representative stories in `src/stories/components/**`, `src/stories/solidStory.ts`, `src/tailwind.css`, `src/ui/palette.ts`, `.storybook/preview.ts`, and the two design-system docs. No builds, servers, code edits, or browser interaction. Pixel measurements below were taken directly from the PNG bytes with `sharp`; contrast ratios were computed from the hex tokens with the WCAG formula.

## Blunt verdict

The token layer is genuinely good (#E8E8E8 on #13161C is 6.52:1, PRIMARY 6.88:1, INFO/NEGATIVE 5.36:1) and the catalog is large. **The visual presentation of that catalog is B-tier.** It reads as a set of engineering specimens dumped into a 1600px canvas with a left-aligned 1100px measure, two incompatible page templates, invisible "cards", and several 390px specimens that are literally clipped mid-word. The defects are not in the palette; they are in composition, responsive behaviour, and evidence hygiene.

---

## Evidence integrity — read this before trusting any screenshot

1. **`docs/screenshots/showcase/alerts-1600.png` is not a UI screenshot at all.** It is a Storybook failure page on a white background with a red border: *"Couldn't find story matching 'design-system-components-feedback-alert--variants-and-radii'."* The real export is `VariantsAndRadius` in `src/stories/components/feedback/Alert.stories.tsx:96`, so the captured id (`--variants-and-radii`) does not exist. This image must be deleted or recaptured; it is currently presented as evidence of Alert quality.
2. **The showcase set predates six UI/story commits.** PNGs were added in `696fb937` ("docs: capture S-tier Storybook family evidence"). Since then: `5bdccfca` (theme provider), `b717c931` (input aria), `3ae889d6` (modal focus trap), `a82a3af4` (checkbox/switch aria), `651d7c0e` (DatePicker contract), `bf7d23c8` (tooltip opens on keyboard focus). Anything about focus/tooltip/date/error states in these PNGs is therefore **stale by construction**.
3. **No 390 overflow beyond the viewport was measured in the shots I sampled.** I pixel-checked six 390 images (`navigation-390`, `overlay-390`, `shared-primitives-390`, `inputs-390`, `app-primitives-390`, `overview-390`): all have zero non-background pixels in the last 5 columns. The 390 failures below are **internal clipping inside fixed-size, `overflow:hidden` specimen hosts**, not a demonstrated page-level horizontal scrollbar. Page-level overflow on the remaining 390 shots and in a live browser is **unknown**.
4. **Missing pairs:** `buttons-1600`, `grid-1600`, `keyvalue-1600`, `loader-1600`, `notifications-1600`, `select-1600`, `skeleton-1600`, `table-1600` and the broken `alerts-1600` have no 390 counterpart. Any 390 claim about those components is unsupported by evidence.
5. `docs/screenshots/storybook/overview-1600.png` shows visible, rounded, bordered group cards; `docs/screenshots/showcase/overview-1600.png` shows the same content with **no card boundaries**. The older-looking set is actually the older commit, and the newer set matches the current `Card` bug described in defect #2. Do not use the `storybook/` set to judge current rendering.

---

## Top 15 defects, ranked by user-visible impact

### 1. A third of every 1600px screenshot is empty canvas, and it is left-anchored
**Evidence:** measured content bounds — `overview-1600.png` x=24–1134 (466px / 29% void), `foundations-1600.png` 20–1118 (482px / 30%), `feedback-1600.png` 20–1138 (462px / 29%), `navigation-1600.png` 20–1138 (462px / 29%), `buttons-1600.png` 20–938 (662px / 41%), `table-1600.png` 20–898 (702px / 44%).
**Source:** `src/stories/design-system/*.stories.tsx` all wrap in `max-width: 1100px`/`1120px` with no auto margin (e.g. `Foundations.stories.tsx:204`, `DataDisplay.stories.tsx:176`, `Overview.stories.tsx:156`); `src/stories/components/inputs/specimen.tsx:38` (`max-width:960px`), `src/stories/components/app/StoryFrame.tsx:5,82` (`DEMO_WIDTH=880`).
**Why B-tier:** the page looks like a document pasted into the top-left corner of a terminal. There is no composition, no centring, no reason for the black slab on the right. This is the single most visible "generated docs page" tell in the whole set.

### 2. Every "card" in eight family indexes is invisible — `Card` silently drops `style`
**Evidence:** `data-display-1600.png` / `feedback-1600.png` / `navigation-1600.png` / `overlay-1600.png` / `shared-primitives-1600.png` / `app-primitives-1600.png` all show plain blue links and grey notes under "Components in this family — Open each card to reach its dedicated page." On 390 the same links stack with no surface at all. `overview-1600.png` "Explore the groups" is a ragged borderless list instead of the 12 cards the source describes.
**Source:** `src/ui/layout/Card.tsx:14-20` lists `style` as a known prop, `splitProps` at `:22-23` moves it out of `rest`, and the render at `:81-91` passes only `style={styleObj}`. Callers' `border`, `background` and `width:300px` (e.g. `src/stories/design-system/DataDisplay.stories.tsx:67`, `Overview.stories.tsx:38-45`, `Foundations.stories.tsx:30`) are discarded.
**Why B-tier:** the UI asserts an affordance ("each card") that does not render. The hierarchy that the card grid was supposed to provide collapses into a link list, and the copy now reads as written by someone who never looked at the result.

### 3. Navigation at 390 is clipped mid-word — the worst responsive defect in the set
**Evidence:** `navigation-390.png` (crop verified at full resolution): the main pane header reads **"Main conten…"** cut at the pane edge; body copy reads "Each exportec shell part renders its own semantic…" cut mid-line; the SCREEN/PAPER/REPORTS badges are sliced off at the bottom-right of the same box.
**Source:** `src/stories/design-system/Navigation.stories.tsx:92` (`height:380px; overflow:hidden`), `:106` (navbar `width:220px`), `:119-120` (main `left:220px; width:calc(100% - 220px)`). At a 390px host the main pane gets ~170px before the panel's own padding.
**Why B-tier:** this is not a subtle wrap issue; text is physically cut off. A reviewer sees a broken shell, not a compact shell.

### 4. Two incompatible family-page templates ship side by side
**Evidence:** Template A (`foundations-1600`, `layout-1600`, `typography-1600`, `inputs-1600`): eyebrow `DESIGN SYSTEM / FOUNDATIONS`, blue "N component pages" badge, no left accent, `TOKENS & PROPS` / `INDEX` uppercase amber eyebrows, card-style index, **no source footer**. Template B (`data-display-1600`, `feedback-1600`, `navigation-1600`, `overlay-1600`, `portal-1600`, `misc-1600`, `shared-primitives-1600`, `app-primitives-1600`, and `overview-1600`): eyebrow `DESIGN SYSTEM · FAMILY`, 3px amber left border on the hero, `AT A GLANCE · …`, plain-link index, `Source:` footer at the bottom.
**Source:** duplicate local components — `Section` + `Card` hero at `Foundations.stories.tsx:29-80,201-249`, `Inputs.stories.tsx:58-... ,185-...`, `Typography.stories.tsx:54-... ,152-...`, `Layout.stories.tsx:58-... ,167-...`; `FamilyHero` + `ComponentIndex` at `DataDisplay.stories.tsx:41-76`, `Feedback.stories.tsx:44-...`, `Navigation.stories.tsx:37-...`, `Overlay.stories.tsx:40-...`, `Portal.stories.tsx:35-...`, `Misc.stories.tsx:36-...`, `SharedPrimitives.stories.tsx:47-...`, `AppPrimitives.stories.tsx:56-...`.
**Why B-tier:** eight copies of one page and four copies of another is the clearest possible signal that no single design authority was applied. Users cannot learn where anything lives.

### 5. Specimen panels are mostly empty space with one tiny control floating in it
**Evidence:** `feedback-1600.png` "Progress and loaders" — four unlabelled bars, three unlabelled spinners and a 72% ring scattered in a 1000px-wide panel; "Notifications" — five full-width outlined buttons with only API names as labels. `overlay-1600.png` "Tooltip placement" — a ~1000px panel containing two small "Hover · top/bottom" buttons at bottom-left. `loader-1600.png` — one small spinner and the caption `oval · md · primary` in a wide empty box. `misc-1600.png` — six unlabelled tone tiles and six bare `×` glyphs. `shared-primitives-1600.png` — three unlabelled sparklines.
**Source:** `src/stories/components/feedback/Loader.stories.tsx`, `src/stories/design-system/Overlay.stories.tsx` (Tooltip placement block), `src/stories/design-system/Misc.stories.tsx`, `src/stories/design-system/SharedPrimitives.stories.tsx:122-126`.
**Why B-tier:** a specimen should demonstrate a component in context. Isolated widgets adrift in a big rectangle look like a component picker that was never laid out.

### 6. Card-in-card-in-card nesting used to create "elevation"
**Evidence:** `foundations-1600.png`: black outer specimen → SURFACE bordered quote panel → SURFACE_ALT inner bar → text. `inputs-1600.png`: black outer specimen → wide SURFACE "SCREEN FILTER" panel plus narrow "RESULT VIEW" panel → segmented control inside. `shared-primitives-1600.png` / `app-primitives-1600.png`: outer Specimen panel → inner bordered empty-state box → nested amber Reset button / red banner.
**Source:** `src/stories/design-system/Foundations.stories.tsx:83-172`, `Inputs.stories.tsx` specimen block, `SharedPrimitives.stories.tsx:78-89,164-...`, `AppPrimitives.stories.tsx:198-...`.
**Why B-tier:** four nested borders for a label and a number is the classic "I don't trust whitespace" pattern. It also fights the documented surface ramp, which promises exactly three steps: page → panel → raised.

### 7. Shared primitives at 390: "NIFTY 500Clear all" — two controls collide
**Evidence:** `shared-primitives-390.png` (full-res crop): the `NIFTY 500` chip and `Clear all` action run together with no gap or separator, reading as one string.
**Source:** `src/stories/design-system/SharedPrimitives.stories.tsx:105-121` (`max-width:760px` host, `FilterStatusRow`), component at `src/components/common/FilterStatusRow.tsx`.
**Why B-tier:** a collision this small but this legible says the layout was only ever checked at desktop width.

### 8. Overview coverage index is crushed at 390; every "open ↗" breaks in two
**Evidence:** `overview-390.png`: 12 rows each have a ~110px description column and the link split across two lines — `open` then `↗`. The whole page is 4345px tall with a tiny multi-line source footer.
**Source:** `src/stories/design-system/Overview.stories.tsx:290-299` — `Flex` with a hard `width:"260px"` label at `:294`, description and `StoryLink label="open ↗"` at `:296`, no narrow-screen branch.
**Why B-tier:** the densest information table in the catalog becomes the least scannable thing on the page, and the broken glyph makes the links look like bad copy-paste.

### 9. Overlay's FloatingWindow clips its own explanatory copy at 390
**Evidence:** `overlay-390.png` (full-res crop): "Drag the title bar or any edge to resize; the **rea** / updates." — the middle of the sentence is cut off. The window body remains a large empty grey rectangle.
**Source:** `src/stories/design-system/Overlay.stories.tsx:158` (fixed `width:420, height:240`), `:170` (`height:260px`, `overflow:"hidden"`), `:182-185` (body copy).
**Why B-tier:** the component exists to demonstrate geometry control, and its own help text cannot fit. That is self-refuting evidence.

### 10. The Alert evidence is a Storybook error page (evidence defect, not a UI defect)
**Evidence:** `docs/screenshots/showcase/alerts-1600.png` — white page, red border, generic "Missing Context/Providers / Misconfigured Webpack or Vite / Missing Environment Variables" help, dark empty code block below.
**Source:** captured against nonexistent id `design-system-components-feedback-alert--variants-and-radii`; the real story is `VariantsAndRadius` at `src/stories/components/feedback/Alert.stories.tsx:96`.
**Why B-tier:** shipping a failed capture as "S-tier evidence" is worse than having no capture. It also means the Alert variants have **zero** visual evidence in this set.

### 11. Label scale is a pile of unrelated sizes rather than a type ramp
**Evidence:** across all family shots: H1 ≈30px, "Purpose"/"Components in this family" ≈15px, body ≈13px, section eyebrows ("TOKENS & PROPS", "INDEX", "AT A GLANCE") ≈10–11px uppercase mono amber, card titles ("Box", "Paper") ≈12px amber, helper text ≈11px grey. `foundations-1600.png` even shows `Aa text` and `Aa raised` at two different weights inside one 240px panel.
**Source:** `src/stories/design-system/Overview.stories.tsx:211` claims "4/6/10 control radii" while the same page's token summary prints "Paper radius 2 / 4 / 6 / 10 / 14" and "Card radius 4 / 8 / 16 / 24 / 32"; `src/tailwind.css:30-33` defines only `--radius-sm/md/lg` (4/6/10). `src/stories/design-system/Overview.stories.tsx:211` also claims "a 9px type floor" while `Typography.stories.tsx` documents `Text size xs 12`.
**Why B-tier:** three radius vocabularies and a type floor that disagrees with the visible scale make the docs look hand-written rather than derived from tokens.

### 12. Density whiplash from one family to the next
**Evidence:** index sections contain 5 cards (Typography), 6 (Foundations/Data display), 7 (Shared primitives), 9 (Feedback), 15 (Layout), 17 (Inputs), 18 (App primitives). At 1600 they sit in a 4-up grid of ~240px cells (`inputs-1600.png`, `layout-1600.png`); at 390 the same lists become 17–18 stacked ~60px rows (`inputs-390.png`, `app-primitives-390.png`). `overview-1600.png` is 2327px tall; `overview-390.png` is 4345px tall.
**Source:** per-family `COMPONENTS`/`components` arrays and the hard-coded grids at `Foundations.stories.tsx:238-248`, `DataDisplay.stories.tsx:65-74`.
**Why B-tier:** no consistent rhythm or paging decision. Density is a side effect of array length, not a design choice.

### 13. Empty / loading / error states are sticker sheets, not states in context
**Evidence:** `shared-primitives-1600.png` "Table states" shows a bordered empty-state box with a full-width amber "Reset filters" button, then `Filter resets: 0`, an unlabelled spinner and a bare "Upstox connection required — reconnect in Settings / Open Settings" line — all in one panel. `app-primitives-1600.png` "Shared states" shows a large salmon-red `Feed unavailable / The options tape returned 503. Retry` banner that dominates the panel. Most families (Foundations, Typography, Layout, Inputs, Portal, Misc, Overlay) show **no** empty/loading/error state at all.
**Source:** `src/stories/design-system/SharedPrimitives.stories.tsx` (Table states block), `src/stories/design-system/AppPrimitives.stories.tsx` (Shared states block); real primitives in `src/components/common/states.tsx`, `TableEmptyState.tsx`, `TableLoadingState.tsx`.
**Why B-tier:** the most emotionally loaded UI in an app (empty data, failure, wait) is presented as a detached catalogue entry with no surrounding table or retry flow. A user cannot tell what it would actually look like.

### 14. Focus states are absent from every captured image
**Evidence:** no screenshot shows a focus ring. `foundations-1600.png` and `foundations-390.png` even include a **"Tab to focus"** button that is displayed unfocused, with the caption "Focus ring: PRIMARY · 2px · 1px offset. Never suppress it." `feedback-1600.png` shows focusable trigger buttons with tone-coloured borders that are indistinguishable from a resting state.
**Source:** ring exists in `src/tailwind.css:98-102` (`:focus-visible` → 2px `--color-fin-primary`, 1px offset); specimen button at `src/stories/design-system/Foundations.stories.tsx:167`; `.storybook/preview.ts:14-21` has no viewport addon and no interaction step. Also note `bf7d23c8` changed tooltip focus **after** the captures.
**Why B-tier:** the documentation states the rule and then fails to demonstrate it. For a keyboard-heavy terminal, that is a credibility gap, not a decoration gap. **Verification of the actual ring requires a live browser — see Unknowns.**

### 15. Developer identifiers and broken file paths are printed as UI copy
**Evidence:** `feedback-1600.png` buttons: `showSuccess`, `showError`, `showNotification · error/warning/info/default`. `typography-1600.png`: a `useValueFlash` code chip next to "Anchor docs". `data-display-1600.png`: `Open: false · last action: none`, `selected: table`. `shared-primitives-1600.png`: `Filter resets: 0`. `overlay-1600.png`: `geometry: 420 by 240`. Footers read `src/stories/components/Data display`, `src/stories/components/Feedback`, `Misc`, `Navigation`, `Overlay`, `App` — most of those directories do not exist (actual: `data-display/`, `feedback/`, `misc/`, `navigation/`, `overlay/`, `app/`).
**Source:** `src/stories/design-system/DataDisplay.stories.tsx:211`, `Feedback.stories.tsx:182`, `Misc.stories.tsx:142`, `Navigation.stories.tsx:205`, `Overlay.stories.tsx:222`, `AppPrimitives.stories.tsx:258`, `SharedPrimitives.stories.tsx:204`, `Portal.stories.tsx:187`; identity strings in `DataDisplay.stories.tsx:221`, `Overlay.stories.tsx:168`, `Typography.stories.tsx` specimen, `Feedback.stories.tsx` notifications block, `SharedPrimitives.stories.tsx` table-states block.
**Why B-tier:** these are debugging readouts, not documentation. They tell a reviewer the author was thinking about props, not readers.

---

## Checklist by dimension

**Hierarchy.** Weak-to-moderate. H1 → section title → card title is readable, but there is no consistent intermediate level: Template A uses `Text size=xs fw=700 tt=uppercase c=primary` as a section label above a `Title order=2`, Template B uses a `Paper` hero with a `Divider` and `AT A GLANCE`. Two of the most important labels on the Overview page — "Explore the groups" and "Component coverage index" — are the same visual weight as a card title. (`overview-1600.png`.)

**Spacing.** The token ramp itself is clean (`spacing xs 4 / sm 8 / md 16 / lg 24 / xl 32`, visible on `foundations-1600.png`), but it is applied inconsistently: 8px gaps in index grids, 16px in cards, ~24px between sections, and a hard `padding:20px` on the story host (`src/stories/solidStory.ts:27`). The 390 variants inherit desktop padding and fixed widths rather than being re-composed.

**Alignment.** Left-aligned content at 1600 with no centring (#1). On 390, "NIFTY 500Clear all" (#7) and the coverage-index rows (#8) are outright misaligned. In `misc-390.png` the `READY` badge, `AS` avatar and `×` close wrap to a second row that is left-aligned under the icon instead of aligned with the text block — minor but visible.

**Density.** Two real density tokens exist (20/28px rows, shown in `data-display-1600.png`), and that specimen is the best part of the set. But catalog density is driven by component count, not intent (#12). Component-level pages use a single 880–960px panel leaving 41–44% of the viewport empty (#1).

**Contrast.** Not a primary defect. Computed from `src/ui/palette.ts`: TEXT/BG 17.14:1, TEXT_MUTED/SURFACE 6.52:1, TEXT_MUTED/SURFACE_ALT 5.60:1, PRIMARY/SURFACE 6.88:1, POSITIVE/SURFACE 5.67:1, NEGATIVE/SURFACE 5.36:1, INFO/SURFACE 5.36:1 — all above 4.5:1. `danger`/`error` alias the same negative token. Caveat: I did not sample every rendered pixel (e.g. the amber `Reset filters` button ink, filled-alert ink) and there is no axe result in this evidence.

**Typography.** Mono/tabular numerals are used where they should be (prices, OI, CHG%, stats). But the type ramp is undocumented in practice (#11), body copy at 12–13px on a 1600px canvas is undersized relative to the empty space, and uppercase mono is used for everything from section eyebrows to status chips to helper text, flattening the hierarchy.

**Empty / loading / error states.** Present but isolated (#13). Three kinds of emptiness are documented in `src/stories/components/app/States.stories.tsx:107-131` and the retry callback is real (`:156-198`), but none of the family landing screenshots show them in a real table or panel context. `loader-1600.png` and `skeleton-1600.png` show a single specimen each and have no 390 evidence.

**390 overflow.** No page-level horizontal overflow measured. Two **internal clip** failures (#3, #9), one collision (#7), one crushed table (#8), and 9 component pages with no 390 evidence at all. Many 390 pages are simply very tall rather than responsive (overview 4345px, app-primitives 2944px, inputs 2286px).

**Focus states.** Rule documented, never demonstrated (#14); evidence stale relative to `bf7d23c8`. Unknown in live browser.

**Consistency across families.** Two templates (#4), two eyebrow separators, two badge wordings (`79 component pages use these tokens` vs `5 component pages`), footer present in eight families and absent in four, index rendered as invisible links in eight and as borderless cards in four (#2).

---

## AI-slop patterns, called out

- **Giant empty canvases.** 29–44% of every 1600px frame is a black slab; fixed 880–1120px measures are left-anchored, not centred. Component pages are a single panel in the top-left corner.
- **Duplicated panels.** `FamilyHero` is copy-pasted into eight family files; `Section` into four; `FamilyHero`'s 780px purpose cap and 720px specimen cap are repeated verbatim. Same bordered-panel structure repeated down every landing page with only the title swapped.
- **Tiny floating controls.** "Hover · top/bottom" in a thousand-pixel panel (`overlay-1600.png`); one spinner plus a caption (`loader-1600.png`); six bare `×` glyphs (`misc-1600.png`); three unlabelled sparklines (`shared-primitives-1600.png`); `Aa text`/`Aa raised` with "Tab to focus" in a 240px box (`foundations-1600.png`).
- **Arbitrary borders.** 1px #2C313B around absolutely everything, plus a 3px amber left accent on some heroes and not others; `Card` borders that were requested and silently dropped (#2); dashed 1px placeholders in Portal that are legitimate but visually indistinguishable from accidental leftovers.
- **Card-in-card.** Black host → SURFACE panel → SURFACE_ALT inset → hairline → text, repeated across Foundations, Inputs, Shared primitives and App primitives.
- **Inconsistent label scales.** 10px uppercase amber section eyebrows, 11px grey helper, 12px amber card titles, 13px body, ~15px section headings, ~30px H1 — plus three different radius scales and a "9px type floor" that the visible scale contradicts.
- **Frozen-fixture theatre.** "frozen NIFTY quote fixture · 12:03:15 IST", "frozen index quote snapshot · 2026-11-20 09:15 IST", "SCAN 10:02", "selected: table", "Filter resets: 0". A frozen clock is defensible for reproducibility; stamping it on every panel makes the catalog look like a screenshot of a screenshot.

---

## Separation of defect classes

### Visual defects (seen in the PNGs)
#1 empty left-anchored canvas · #2 invisible cards / missing hierarchy · #3 390 shell clipping · #4 two templates · #5 empty specimen panels · #6 nested borders · #7 chip/action collision · #8 crushed 390 index · #9 window copy clipped · #11 label scales · #12 density whiplash · #13 decontextualised states · #14 absent focus evidence · (evidence-only #10).

### Content / copy defects (text is wrong or misleading, independently of pixels)
- "Open each card to reach its dedicated page." where no cards render — 8 family stories: `DataDisplay.stories.tsx:63`, `Feedback.stories.tsx`, `Navigation.stories.tsx`, `Overlay.stories.tsx`, `Portal.stories.tsx`, `Misc.stories.tsx`, `SharedPrimitives.stories.tsx`, `AppPrimitives.stories.tsx`.
- "Explore the groups — Each card lists the stories currently in that group" while `Card` drops its border and width (`Overview.stories.tsx:273-275`, `Card.tsx`).
- Wrong source paths with spaces / wrong case in the 8 footers listed in #15; no footer at all in the four Template A families.
- Developer identifiers as visible labels: `showNotification · error`, `useValueFlash`, `geometry: 420 by 240`, `Open: false`, `selected: table`, `Filter resets: 0`.
- Contradictory numbers on one page: `Overview.stories.tsx:211` "4/6/10 control radii" and "9px type floor" vs its own token summary (`:254-263`) "2 / 4 / 6 / 10 / 14", "4 / 8 / 16 / 24 / 32", and `Typography.stories.tsx` `Text size xs 12`.
- Badge wording mismatch: "79 component pages use these tokens" (`Foundations.stories.tsx:209`) vs "<n> component pages" in the other twelve.
- "Couldn't find story matching …variants-and-radii" — an error message shipped as screenshot evidence.

### Unknown without a live browser (do not assert from this audit)
1. Whether `:focus-visible` actually paints on each control, and whether focus is trapped in Modal (captures predate `3ae889d6`).
2. Tooltip open-on-focus behaviour after `bf7d23c8`; none of the static hover buttons show a tooltip.
3. Whether any 390 story produces document-level horizontal scroll (measured: no ink in the last 5px of any 390 PNG, but clipping is internal to `overflow:hidden` hosts).
4. Whether Modal/Popover/Dropdown z-index and stacking survive the Portal host switching.
5. Actual number rendering and animation of flash/shimmer/reduced-motion states; `valueFlash` appears only as a code chip.
6. Whether the `Card` style bug also affects the running app's card borders (the bug is in the shared primitive, but no app screenshot was reviewed here).
7. Whether the `storybook-static` catalog is current after the six post-capture commits; no static build exists in this worktree to check.
8. axe/WCAG conformance; addon-a11y is manual only per `docs/DESIGN_SYSTEM_STORYBOOK.md:21-23`.

---

## 8 concrete fixes (exact files)

1. **Forward `style` in `Card`.** In `src/ui/layout/Card.tsx`, keep `style` out of `CARD_KNOWN` forwarding but merge it at the render at `:81-91`: `style={{ ...styleObj, ...(known.style as JSX.CSSProperties) }}`. This restores the requested `border`, `background` and `width:300px` in `Overview.stories.tsx:38-45`, `DataDisplay.stories.tsx:67`, `Foundations.stories.tsx:30` and the other family heroes — and makes the "Open each card" copy true. Re-capture `feedback-1600.png`, `data-display-1600.png`, `overview-1600.png` afterwards.

2. **Extract one shared family-landing component.** Create `src/stories/design-system/FamilyLanding.tsx` exposing one hero (eyebrow `Design system / <Family>`, badge `<n> component pages`, title, purpose, one specimen slot, one index slot, one source footer) and one index grid. Replace the four local `Section`+`Card` heroes in `Foundations.stories.tsx:201-249`, `Inputs.stories.tsx:185-233`, `Typography.stories.tsx:152-200`, `Layout.stories.tsx:167-215`, and the eight duplicated `FamilyHero`/`ComponentIndex` blocks in `DataDisplay.stories.tsx:41-76`, `Feedback.stories.tsx:44-...`, `Navigation.stories.tsx:37-...`, `Overlay.stories.tsx:40-...`, `Portal.stories.tsx:35-...`, `Misc.stories.tsx:36-...`, `SharedPrimitives.stories.tsx:47-...`, `AppPrimitives.stories.tsx:56-...`. Delete the duplicate `AT A GLANCE` vs `TOKENS & PROPS` label vocabularies at the same time.

3. **Centre the measure at wide viewports.** Add `margin: "0 auto"` to the `max-width` wrapper in each of: `Foundations.stories.tsx:204`, `Inputs.stories.tsx:188`, `Typography.stories.tsx:155`, `Layout.stories.tsx:170`, `Overview.stories.tsx:156`, `DataDisplay.stories.tsx:176`, `Feedback.stories.tsx:120`, `Navigation.stories.tsx:182`, `Overlay.stories.tsx:196`, `Portal.stories.tsx:173`, `Misc.stories.tsx:102`, `SharedPrimitives.stories.tsx:179`, `AppPrimitives.stories.tsx:241`, plus `src/stories/components/inputs/specimen.tsx:38` and `src/stories/components/app/StoryFrame.tsx:82`. This removes the 29–44% one-sided void without changing component widths.

4. **Make the Navigation specimen responsive at 390.** In `src/stories/design-system/Navigation.stories.tsx:92,103-121`, replace the absolute `width:220px` navbar and `left:220px; width:calc(100% - 220px)` main with a media-query branch: below 640px stack the shell (navbar full width, auto height; main `left:0; width:100%`) and remove `overflow:hidden` from the outer box at `:92`; keep the 220px split for wider hosts. Re-capture `navigation-390.png` and assert "Main content" is never truncated.

5. **Fit FloatingWindow to a 390 host.** In `src/stories/design-system/Overlay.stories.tsx:158,170`, derive geometry from the host (`const width = Math.min(420, hostWidth - 24)`) and drop `overflow:"hidden"` (or raise the 260px host height) so the body copy at `:182-185` wraps fully. Re-capture `overlay-390.png`; the string "the readout above updates" must be visible.

6. **Separate the filter chips from Clear all on narrow screens.** In `src/stories/design-system/SharedPrimitives.stories.tsx:105-121`, render `Clear all` on its own row below the chips when the host is <640px; in `src/components/common/FilterStatusRow.tsx` ensure the chip row has `flex-wrap:wrap`, a real `gap`, and `Clear all` has `white-space:nowrap`. Re-capture `shared-primitives-390.png` and confirm `NIFTY 500` and `Clear all` never touch.

7. **Make the Overview coverage index stack at 390.** In `src/stories/design-system/Overview.stories.tsx:290-299`, replace the fixed `width:"260px"` label and the single `Flex` row with a two-line layout below 640px (title + link on line 1, description on line 2) and add `white-space:"nowrap"` to the `open ↗` `StoryLink` at `:296`. Re-capture `overview-390.png`; the link must stay on one line.

8. **Repair the evidence and the copy that lies.** Delete or recapture `docs/screenshots/showcase/alerts-1600.png` using the real id from `src/stories/components/feedback/Alert.stories.tsx:96` (`…--variants-and-radius`). Recapture all 35 showcase PNGs after the six post-`696fb937` commits. Add a deliberately focused capture of the `Tab to focus` button at `src/stories/design-system/Foundations.stories.tsx:167` so the `tailwind.css:98-102` ring has visual proof. Fix the eight wrong source paths at `DataDisplay.stories.tsx:211`, `Feedback.stories.tsx:182`, `Misc.stories.tsx:142`, `Navigation.stories.tsx:205`, `Overlay.stories.tsx:222`, `AppPrimitives.stories.tsx:258`, `SharedPrimitives.stories.tsx:204`, `Portal.stories.tsx:187` to the real lowercase directory names. Reconcile `Overview.stories.tsx:211` ("4/6/10", "9px floor") with `Typography.stories.tsx` (`Text xs 12`) and `tailwind.css:30-33`.

---

## Closing note

Nothing in this audit contradicts the benchmark's tier conclusion (`docs/DESIGN_SYSTEM_BENCHMARK_2026-11-23.md`: Tier 3, avg 4.8/10). The tokens and guards are the strongest part; the **visual presentation of the Storybook catalog is the weakest part of an otherwise competent system**, and it is the part a designer or user sees first. Fix #1 (the swallowed `Card` style) and #3 (centring) alone would remove the two most damaging first impressions; #2 (one template) is what would make the catalog read as a system rather than eight copies of a page.

---

## Typography tier (2026-11-23 update)

Supersedes the "9px floor" wording in fix #8 above. Type is now one six-step contract owned by `src/ui/typography.ts` and emitted as `text-ui-*` utilities from `@theme` in `src/tailwind.css`. Product copy picks a role, never a private `text-[Npx]` or inline `font-size`. The live specimen is Storybook story `design-system-typography--type-scale` (Design System / Typography → TypeScale).

| Token | Size / leading | Where used |
|---|---|---|
| `--text-ui-micro` · `text-ui-micro` | 12px / 16px | Dense labels, badges, chart axes, table metadata — the hard floor |
| `--text-ui-body` · `text-ui-body` | 13px / 18px | Body copy and table cells |
| `--text-ui-label` · `text-ui-label` | 14px / 20px | Form labels and control text |
| `--text-ui-title` · `text-ui-title` | 16px / 24px | Card and panel titles |
| `--text-ui-heading` · `text-ui-heading` | 20px / 28px | Page-section headings |
| `--text-ui-display` · `text-ui-display` | 24px / 32px | Page titles and hero values |

The 12px floor is enforced by the `design-scale` guard (`src/test/design-scale.test.ts`); the old 9px allowance is retired.

**This pass (`src/stories/**` only):** all 15 inline `font-size` declarations (9/10/11/12/13px) were replaced with `text-ui-*` or `typeStyle()` — before 15, after 0 (the only remaining `font-size` match is prose in a `note` prop). Grid/Layout ruler cells grew 14→20px and 18→20px so 12px digits are not clipped at 390, and the stale "9px floor" copy in Overview and Badge stories was corrected. Nothing was hidden.

**Remaining exceptions (outside this scope, not edited here):** the `Tab` primitive still carries a default `text-[11px]` class in `src/ui/data-display/Tabs.tsx` (the Sizes story overrides it with `typeStyle()`); `Textarea` `size="xs"` is described in its story as an 11px step; dense table stories still describe 10px row type. Those live in `src/ui` / feature components and belong to the component pass. Intentional `truncate`/`lineClamp` demos in Text/Anchor/SimpleGrid stories are kept — they teach an API and carry the full string in `title`.

---

## Current status (2026-11-23 P5 — supersedes §7–8)

The fixed items below are now visible in the committed `docs/screenshots/showcase/` images (all read back; captured with `scripts/storybook-showcase.mjs`):

- **Fixed:** card style forwarding, one `FamilyLanding` template, centred measures, responsive Navigation shell, FloatingWindow fitting its 390 host, filter-chip separation, Overview coverage-index stacking, footer paths, stale `381/92/79` counts and the false “no axe gate” claim in `STORYBOOK.md`.
- **Fixed:** every story font-size declaration now uses `text-ui-*` / `typeStyle`; the old 9px copy is retired.
- **Open:** `Text/Title/Anchor/List` still expose a private rem `sizeMap` with an 18px step; a dedicated lane is folding those aliases onto `TYPE_CLASS`. Until it lands, the Typography page’s “What Typography owns” row is documenting an API that is not yet the shared scale.
- **Open:** the app routes still lack fresh route-level 1600/390 captures; Storybook evidence does not prove the live app.
- **Evidence:** showcase captures are now full-page, so the Data display result-states panel and Overview coverage index are in-frame. `alerts` captures the full variants-and-radius story, and `table` captures the App primitives family page instead of the one-row debug playground.
