/** CSV helpers for the Patterns/Watch copy actions (dependency-free). */

export interface CsvColumn {
  key: string;
  header?: string;
}

/** Stringify one cell: null/undefined → "", objects → JSON, rest → String(). */
function cellToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** RFC-4180-ish field escaping: quote when the value holds `,`/`"`/CR/LF. */
function escapeField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function inferColumns(rows: Array<Record<string, unknown>>): CsvColumn[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return keys.map((key) => ({ key }));
}

/**
 * Render rows as CSV with `\n` line endings. Header row comes from the column
 * keys/headers (or the union of row keys when `columns` is omitted).
 */
export function toCsv(rows: Array<Record<string, unknown>>, columns?: CsvColumn[]): string {
  const cols = columns ?? inferColumns(rows);
  const header = cols.map((c) => escapeField(c.header ?? c.key)).join(",");
  const lines = rows.map((row) =>
    cols.map((c) => escapeField(cellToString(row[c.key]))).join(","),
  );
  return [header, ...lines].join("\n");
}

/** Bare symbol list (comma-separated) for pasting into TradingView. */
export function toSymbolList(
  rows: Array<Record<string, unknown>>,
  key = "symbol",
  prefix = "NSE:",
): string {
  return rows
    .map((row) => row[key])
    .filter((v): v is string | number => typeof v === "string" || typeof v === "number")
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0)
    .map((v) =>
      prefix && !v.toUpperCase().startsWith(prefix.toUpperCase()) ? `${prefix}${v}` : v,
    )
    .join(",");
}

/**
 * Copy text to the clipboard. Uses `navigator.clipboard.writeText` when
 * available, otherwise falls back to a hidden-textarea `execCommand("copy")`
 * (insecure contexts). Resolves `false` on failure.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const nav = globalThis.navigator as Navigator | undefined;
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch {
    return false;
  }
  try {
    const doc = globalThis.document;
    if (!doc?.body) return false;
    const ta = doc.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    doc.body.appendChild(ta);
    try {
      ta.select();
      const ok = doc.execCommand("copy");
      return ok !== false;
    } finally {
      doc.body.removeChild(ta);
    }
  } catch {
    return false;
  }
}
