# Design System Storybook

Run it:

```bash
bun run storybook        # http://localhost:6006
bun run build-storybook  # static output in storybook-static/
```

The catalog is grouped as **Design System / …** and **Terminal / …**. It is built
with Solid’s `solidStory()` helper (`src/stories/solidStory.ts`) because
Storybook’s `html-vite` renderer expects a DOM node; each story mounts a Solid
root into its own host and uses the real Tailwind tokens.

## Coverage

### Foundations
- Color tokens (surface, text, semantic tones)
- Type scale (28px display → 9px micro), weights and numeric faces
- 4px spacing scale
- Radius and motion conventions

### Typography
- `Text` sizes, tones, weights, truncation, monospace numerals
- `Title` orders 1–6
- `Anchor`, inline/block `Code`, `List`/`ListItem`

### Layout
- `Box`, `Flex`, `Stack`, `Group`, `ToolbarRow`, `Center`
- `Paper`, `Card`, `Divider`, `ScrollArea`, `Collapse`
- `SimpleGrid`, `Grid`/`GridCol`, `Row`/`Col`
- `AppShell` in Navigation

### Inputs
- `Button` variants/sizes/states, `ActionIcon`, `UnstyledButton`
- `TextInput`, `NumberInput`, `Select`, `MultiSelect`, `Textarea`,
  `PasswordInput`, `DatePicker`, `RangeInput`
- `Switch`, `Checkbox`, `Chip`, `SegmentedControl`, `Slider`, `RangeSlider`
- `CopyButton`

### Feedback
- `Badge` variants/tones/sizes
- `Alert`, `Notifications` (success toast)
- `Loader`, `Progress`, `RingProgress`, `LoadingOverlay`
- `Skeleton`, `Indicator`

### Data display
- `Tabs` compound component
- `Accordion` compound component
- `Timeline`, `Tree`, `Menu` compound component

### Overlay
- `Modal`, `Tooltip`, `Popover` (`PopoverTarget`/`PopoverDropdown`), `Overlay`
- `FloatingWindow`

### Navigation
- `NavLink` (active, disabled, nested)
- `AppShell` geometry

### Misc
- `Avatar`, `ThemeIcon`, `CloseButton`

### App primitives
- `KeyValue`
- `SideBadge`, `ExitReasonBadge`, `StatusBadge`
- `PnlText`
- `EmptyState`, `ErrorAlert`, `InlineLoader`
- `CompactPanel`, `CompactStat`, `CompactStatGrid`
- `TanStackTable` dense and default states

## Conventions

1. Use the existing `solidStory(() => …)` helper, never a separate renderer.
2. Prefer real `@/ui` components and CSS variables; do not fork a palette into
   story-local constants.
3. Show state variants in one story when possible (sizes, tones, disabled,
   loading), so a reviewer can inspect the matrix at a glance.
4. Use fixed widths for narrow components, but keep pages responsive at 390px
   and 1600px in the Storybook viewport toolbar.
5. Add a `Design System/…` story when a new primitive enters `src/ui/index.ts`.
   Feature composites (Options Dock, Replay, Market, Patterns, Reports) keep
   their screenshot/Playwright evidence and can get their own stories in a
   later feature-story pass.

## Current limits

- The catalog covers the reusable `@/ui` surface and shared app primitives. It
  does **not** yet story-ify every feature composite (options dock, replay,
  patterns rail, sector pages, etc.); those are intentionally next.
- Storybook uses real browser layout, but a static build cannot assert visual
  regressions by itself. Add visual tests when the story surface stabilizes.
- The existing Terminal stories remain under their original titles for stable
  links; the new `Design System/*` entries are the canonical design reference.
