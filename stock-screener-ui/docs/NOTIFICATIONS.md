# Toast notifications (solid-notifications)

The app wraps the router in `<Notifications>` (`src/ui/notifications.tsx`), which
mounts `ToastProvider` + `Toaster` from `solid-notifications`.

## Non-negotiable

- **The library stylesheet must be imported** in `src/main.tsx`:

  ```ts
  import "solid-notifications/index.css";
  ```

  Without it `.sn-toast-wrapper` stays `position: static` and the 52-unit SVG
  `sn-icon` stretches to the page width. A live audit measured icons at
  **1252 × 1252px**, wrappers at 1252 × 1583px, stacked above the document —
  the "giant white arcs and X" artifact.

- **Do not restyle `.sn-*` classes globally.** The library owns its tokens
  (`--sn-icon-size`, `--sn-toast-bg-color`, …). Theme via the `theme` prop.

## Wiring

- `theme={colorScheme()}` from `useColorScheme()` — the library defaults to
  light, the app defaults to dark.
- `limit={4}` caps the visible stack. The 52W screen can emit one surge toast
  per stock beyond ±5% on first load; unbounded stacks cover the table.
- Position stays bottom-right (`POSITION`), matching the old notistack anchor.

## Surge toasts

`src/utils/surgeNotifications.tsx` fires `showToast` for stocks crossing the
configured move threshold, with a 5-minute per-symbol cooldown and an 8-second
duration. Clicking the toast body opens `/chart/<symbol>` via the
`[data-surge-symbol]` listener.

## Guard test

`src/test/toast-stylesheet.test.ts` fails if the CSS import disappears from
`main.tsx`.
