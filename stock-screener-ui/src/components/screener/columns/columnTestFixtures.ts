// Test-only shared builders for screener column tests.
import { createComponent } from "solid-js";
import type { JSX } from "solid-js";
import { render } from "@solidjs/testing-library";
import { expect } from "vitest";
import { UIProvider } from "@/ui";
import type { ColumnDef, FormattedCell } from "./index";

export function fmtOf(getColumns: () => ColumnDef[], key: string): any {
  const c = getColumns().find((x) => x.key === key);
  if (!c?.format) throw new Error(key);
  return c.format as any;
}

export function expectSymbolFirstSectorLast(cols: ColumnDef[], length?: number): void {
  if (length !== undefined) expect(cols.length).toBe(length);
  expect(cols[0].key).toBe("symbol");
  expect(cols[cols.length - 1].key).toBe("sector");
}

function isFormattedCell(value: unknown): value is FormattedCell {
  return (
    value !== null && typeof value === "object" && "value" in (value as Record<string, unknown>)
  );
}

/** Deepest element under `el` — the node that actually carries the text. */
function valueElement(el: HTMLElement): HTMLElement {
  let node = el;
  while (node.firstElementChild) node = node.firstElementChild as HTMLElement;
  return node;
}

function toneFromClass(className: string): string {
  if (className.includes("text-fin-positive")) return "success";
  if (className.includes("text-fin-negative")) return "error";
  if (className.includes("text-fin-text-muted")) return "dimmed";
  return "";
}

export interface CellRead {
  text: string;
  tone: string;
  className: string;
}

/**
 * Renders one column's `format` output and reads it back. A migrated column
 * returns a kit component (NumCell/TextCell/BadgeCell); the not-yet-migrated
 * sheets still return a FormattedCell object. Both flatten to text + tone so a
 * suite asserts the same way before and after a conversion.
 */
export function cellOf(build: () => unknown): CellRead {
  let raw: unknown;
  const result = render(() =>
    createComponent(UIProvider, {
      get children() {
        raw = build();
        return (isFormattedCell(raw) ? raw.value : raw) as JSX.Element;
      },
    }),
  );
  const el = result.container.firstElementChild as HTMLElement | null;
  const className = el ? valueElement(el).className.toString() : "";
  return {
    text: (result.container.textContent ?? "").trim(),
    tone: isFormattedCell(raw) ? (raw.className ?? "") : toneFromClass(className),
    className,
  };
}

export function cellText(build: () => unknown): string {
  return cellOf(build).text;
}
