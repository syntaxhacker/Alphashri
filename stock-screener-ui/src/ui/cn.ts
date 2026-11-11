export type ClassValue = string | false | null | undefined | ClassValue[];

/**
 * Minimal class joiner for the UI kernel. Deliberately dependency-free: the
 * migration needs stable, predictable output more than conflict resolution.
 */
export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  const walk = (value: ClassValue) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    out.push(value);
  };
  values.forEach(walk);
  return out.join(" ");
}
