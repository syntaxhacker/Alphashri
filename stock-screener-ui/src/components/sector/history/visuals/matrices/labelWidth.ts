/**
 * Grid label sizing for matrix row rails.
 *
 * Names are shown in full; the caller widens the rail (within bounds) instead
 * of truncating the identifier. The estimate assumes the shared mono face at
 * the 12px floor.
 */

export const LABEL_MIN_WIDTH = 140;
export const LABEL_MAX_WIDTH = 210;
export const LABEL_CHAR_WIDTH = 7;
export const LABEL_PADDING = 14;

export function labelWidthFor(
  names: string[],
  min = LABEL_MIN_WIDTH,
  max = LABEL_MAX_WIDTH,
  charPx = LABEL_CHAR_WIDTH,
  padding = LABEL_PADDING,
): number {
  const longest = names.reduce((length, name) => Math.max(length, name.length), 0);
  const estimated = Math.ceil(longest * charPx) + padding;
  return Math.max(min, Math.min(max, estimated));
}
