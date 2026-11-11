/**
 * Direction of one option contract's buildup/unwind class.
 *
 * Single source of truth for the two chain badges (`NiftyReportPanel` CE/PE
 * Signal cells and `NiftyUnusualVolume`'s Position column). It mirrors the
 * backend's `api/positioning.py:class_sign` map exactly:
 *
 *   CE bullish  LB (buyers open) · SC (writers buy back)
 *   CE bearish  SB (writers open) · LU (buyers sell out)
 *   PE bullish  SB (writers open)  · LU (buyers sell out)
 *   PE bearish  LB (buyers open)   · SC (writers buy back)
 *
 * The sign is the change in **delta exposure** the class represents, not the
 * sentiment of the participants. That distinction only bites on the put side:
 * a put short cover (`SC`) is writers closing a *long-delta* hedge (bearish),
 * and a put long unwind (`LU`) is buyers removing *short-delta* pressure
 * (bullish). The old per-side "tone" convention had those two swapped, which
 * made a genuine down day (put unwinds) read bullish.
 */

export type OptionSide = "CE" | "PE";

/** Full class label per 2-letter code. Unknown values render raw. */
export const SENTIMENT_NAMES: Record<string, string> = {
  LB: "Long Buildup",
  SB: "Short Buildup",
  SC: "Short Cover",
  LU: "Long Unwind",
};

const BULLISH_CLASS: Record<OptionSide, ReadonlySet<string>> = {
  CE: new Set(["LB", "SC"]),
  PE: new Set(["SB", "LU"]),
};

const BEARISH_CLASS: Record<OptionSide, ReadonlySet<string>> = {
  CE: new Set(["SB", "LU"]),
  PE: new Set(["LB", "SC"]),
};

/** The chain may carry the full class name instead of the 2-letter code. */
const FULL_NAME_CODES: Record<string, string> = {
  "LONG BUILDUP": "LB",
  "SHORT BUILDUP": "SB",
  "SHORT COVER": "SC",
  "SHORT COVERING": "SC",
  "LONG UNWIND": "LU",
  "LONG UNWINDING": "LU",
};

/** Normalise a chain sentiment to `LB`/`SB`/`SC`/`LU`; `""` when unknown. */
export function sentimentCode(sentiment: string | null | undefined): string {
  const code = String(sentiment ?? "").trim().toUpperCase();
  if (SENTIMENT_NAMES[code]) return code;
  return FULL_NAME_CODES[code] ?? "";
}

/** Tolerate the chain's lowercase `ce`/`pe` keys and the badge's uppercase. */
function normaliseSide(side: string): OptionSide {
  return side.trim().toUpperCase() === "PE" ? "PE" : "CE";
}

/** Full label, or the raw payload text for legacy/unknown values. */
export function sentimentLabel(sentiment: string | null | undefined): string {
  const raw = String(sentiment ?? "").trim();
  return SENTIMENT_NAMES[sentimentCode(raw)] ?? raw;
}

/** +1 = bullish, -1 = bearish, 0 = neutral/unknown. */
export function sentimentSign(
  sentiment: string | null | undefined,
  side: string,
): 1 | 0 | -1 {
  const code = sentimentCode(sentiment);
  if (!code) return 0;
  const s = normaliseSide(side);
  if (BULLISH_CLASS[s].has(code)) return 1;
  if (BEARISH_CLASS[s].has(code)) return -1;
  return 0;
}

const CONTRACT_ACTION: Record<OptionSide, Record<string, string>> = {
  CE: {
    LB: "call buyers opening",
    SB: "call writers opening",
    SC: "call writers buying back",
    LU: "call buyers selling out",
  },
  PE: {
    LB: "put buyers opening",
    SB: "put writers opening",
    SC: "put writers buying back",
    LU: "put buyers selling out",
  },
};

/**
 * Tooltip: what the participants did **and** what it does to delta exposure.
 * The action half is the contract-tone reading; the directional half is what
 * the badge colour means. Keeping both in the tooltip stops a user from
 * reading a red "SC" on a put as "writers are bullish".
 */
export function sentimentNote(
  sentiment: string | null | undefined,
  side: string,
): string {
  const code = sentimentCode(sentiment);
  if (!code) return "unclassified flow";
  const s = normaliseSide(side);
  const action = CONTRACT_ACTION[s][code];
  const sign = sentimentSign(code, s);
  const effect =
    sign > 0
      ? "adds/supports long delta — bullish"
      : sign < 0
        ? "adds/supports short delta — bearish"
        : "neutral";
  return `${action} · ${effect}`;
}
