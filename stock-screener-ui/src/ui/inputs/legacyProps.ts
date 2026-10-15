/**
 * Legacy Mantine-compat props that must never reach the DOM.
 *
 * Call sites written against the old Mantine API still pass props like
 * `allowDeselect`, `maxDropdownHeight`, `comboboxProps` or `withinPortal`.
 * They are part of the public `@/ui` prop types (accepted-but-ignored) and
 * are stripped here so React/MUI don't emit unknown-attribute warnings.
 */
const LEGACY_INPUT_PROP_KEYS = new Set([
  "allowDeselect",
  "maxDropdownHeight",
  "comboboxProps",
  "withinPortal",
  "InputProps",
  "dropdownOpened",
  "limit",
]);

/**
 * Return a copy of `rest` with every legacy Mantine-ism removed.
 * The input object is never mutated.
 */
export function stripLegacyInputProps<T extends Record<string, unknown>>(rest: T): T {
  let dirty = false;
  for (const key of LEGACY_INPUT_PROP_KEYS) {
    if (key in rest) {
      dirty = true;
      break;
    }
  }
  if (!dirty) return rest;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (!LEGACY_INPUT_PROP_KEYS.has(key)) out[key] = value;
  }
  return out as T;
}
