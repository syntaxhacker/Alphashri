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

## Bell badge semantics

- **Today/unread, never all-time.** The count is `today_count − acknowledged`,
  where `acknowledged` is what the user had seen when they last opened the panel
  (`acknowledgeSurgeAlerts` on page 0, reset by the IST day key). A new session
  starts fully unread; `resolveTodayCount` prefers the backend's bounded
  `today_count` and only falls back to counting today's rows in the page.
- **Caps:** the badge text is capped at `9+` (`SURGE_BADGE_CAP`) so it cannot
  deform the icon; the aria-label/tooltip cap is `99+` (`SURGE_LABEL_CAP`).
- **`total` is panel pagination only** — `hasMore = events.length < total`.
  It is the all-time row count and must never drive the badge (that was the
  runaway-count bug).
