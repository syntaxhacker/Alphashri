// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TanStackTable } from "./TanStackTable";

describe("TanStackTable width — TDD RED for dense layout", () => {
  const cols = Array.from({ length: 8 }, (_, i) => ({
    id: `col${i}`,
    header: `Col ${i}`,
    accessorKey: `col${i}` as const,
  }));
  const data = [{ col0: "a", col1: "b", col2: "c", col3: "d", col4: "e", col5: "f", col6: "g", col7: "h" }];

  it("table spans full container width for 8+ cols (dense)", () => {
    const { container } = render(<TanStackTable data={data as never} columns={cols as never} />);
    const table = container.querySelector("table") as HTMLTableElement;
    expect(table).toBeTruthy();
    // should be 100% width and have a minWidth to enable horizontal scroll when dense
    expect(table.style.width).toBe("100%");
    // RED if no minWidth —dense tables overflow without scroll
    expect(parseInt(table.style.minWidth || "0", 10)).toBeGreaterThanOrEqual(640);
  });

  it("ScrollArea allows horizontal scroll for wide tables", () => {
    const { container } = render(<TanStackTable data={data as never} columns={cols as never} />);
    const table = container.querySelector("table") as HTMLTableElement;
    // dense tables should allow horizontal scroll via minWidth > container
    expect(table.style.minWidth).toBeTruthy();
    expect(parseInt(table.style.minWidth, 10)).toBeGreaterThan(600);
  });
});
