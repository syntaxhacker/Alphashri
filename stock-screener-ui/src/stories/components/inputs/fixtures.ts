/**
 * Frozen, labelled fixtures shared by the inputs catalog. Every value is a
 * fixed reference sample: no clock, randomness or network in any story.
 */

export const FIXTURE_LABEL = "frozen NSE reference set · 2026-11-20 session";

export interface OptionFixture {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
}

export const INSTRUMENTS: readonly OptionFixture[] = Object.freeze([
  Object.freeze({ value: "nifty50", label: "NIFTY 50", group: "Indices" }),
  Object.freeze({ value: "banknifty", label: "BANKNIFTY", group: "Indices" }),
  Object.freeze({ value: "reliance", label: "RELIANCE", group: "Equities" }),
  Object.freeze({ value: "infy", label: "INFY", group: "Equities" }),
  Object.freeze({ value: "tcs", label: "TCS", group: "Equities" }),
  Object.freeze({ value: "delisted", label: "DELISTED (unavailable)", group: "Equities", disabled: true }),
]);

export const SECTORS: readonly OptionFixture[] = Object.freeze([
  Object.freeze({ value: "it", label: "Information Technology" }),
  Object.freeze({ value: "banks", label: "Banks" }),
  Object.freeze({ value: "auto", label: "Automobile" }),
  Object.freeze({ value: "pharma", label: "Pharma" }),
  Object.freeze({ value: "energy", label: "Energy" }),
  Object.freeze({ value: "realty", label: "Realty (unavailable)", disabled: true }),
]);

export const VIEW_MODES: readonly OptionFixture[] = Object.freeze([
  Object.freeze({ value: "table", label: "TABLE" }),
  Object.freeze({ value: "grid", label: "GRID" }),
  Object.freeze({ value: "matrix", label: "MATRIX" }),
]);

/** Fixed local calendar dates; callers never read the wall clock. */
export const expiryDate = (): Date => new Date(2026, 10, 26);
export const earliestExpiry = (): Date => new Date(2026, 10, 23);
export const latestExpiry = (): Date => new Date(2026, 11, 25);
