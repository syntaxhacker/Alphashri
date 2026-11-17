/**
 * GEX level gates used when the report replays snapshots in the browser.
 *
 * The numeric owner is `api/options_conventions.py` (Python cannot be imported
 * here). `tests/api/test_options_conventions.py` parses this file and asserts the
 * values stay equal — keep each declaration on one line as `export const NAME =
 * <number>;` or that guard will fail.
 */

/** A level must carry at least this share of the profile's peak |netGex|. */
export const GEX_LEVEL_MIN_SHARE = 0.1;

/** A level farther than this share of spot is a wing, not an actionable level. */
export const GEX_LEVEL_MAX_DIST_PCT = 0.05;
