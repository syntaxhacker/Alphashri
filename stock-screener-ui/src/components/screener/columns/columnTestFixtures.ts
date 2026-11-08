// Test-only shared builders for screener column tests.
import { expect } from "vitest";
import type { ColumnDef } from "./index";

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

export function expectPctClass(result: any, value: string, className: string): void {
  expect(result.value).toBe(value);
  expect(result.className).toBe(className);
}

export function expectDashForNullish(fmt: () => (v: any) => any): void {
  expect(fmt()(null)).toBe("-");
  expect(fmt()(undefined)).toBe("-");
}

export function expectFmtValue(fmt: (v: any) => any, input: unknown, expected: unknown): void {
  expect(fmt(input)).toBe(expected);
}
