/** Shared input-width scale for the PremiumTracker tab (audit P1-19).
 * Use these tokens instead of ad-hoc pixel widths so every row lines up. */
export const FIELD_W = {
  action: 80,
  strike: 120,
  type: 72,
  qty: 64,
  entry: 120,
  underlying: 150,
  template: 180,
  note: 160,
  conviction: 120,
  day: 150,
  exit: 90,
} as const;

/** Row action buttons sit beside size="sm" inputs (40px tall) — match them. */
export const ROW_BUTTON_SX = { height: 40 } as const;
