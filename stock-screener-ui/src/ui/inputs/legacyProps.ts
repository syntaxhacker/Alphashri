/**
 * Legacy Mantine-isms that must never reach the DOM when an input forwards
 * unknown props to a native element.
 *
 * This is a defensive strip for TextInput/NumberInput/PasswordInput, not a
 * compatibility surface: `allowDeselect`, `maxDropdownHeight`, `comboboxProps`
 * and `withinPortal` are no longer part of the Select/MultiSelect public prop
 * types. Keeping the keys here stops force-cast callers from leaking attributes.
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
