import { expect, type Page, type Locator } from "@playwright/test";

export async function expectTableRowCount(page: Page, testId: string, count: number) {
  const table = page.locator(`[data-testid="${testId}"]`);
  const tbody = table.locator("tbody").first();
  if (count === 0) {
    await expect(tbody.locator("tr")).toHaveCount(0);
  } else {
    await expect(tbody.locator("tr")).toHaveCount(count, { timeout: 10000 });
  }
}

export async function expectTableHeaders(page: Page, testId: string, headers: string[]) {
  const table = page.locator(`[data-testid="${testId}"]`);
  const ths = table.locator("thead th");
  await expect(ths).toHaveCount(headers.length);
  for (const header of headers) {
    await expect(table.locator("thead")).toContainText(header);
  }
}

export async function clickSortHeader(page: Page, columnKey: string) {
  // TanStackTable header: native <th> with click-to-sort; label is column key (case-insensitive)
  await page
    .locator('[data-testid="screener-table"] thead th', { hasText: new RegExp(columnKey, "i") })
    .first()
    .click();
}

export async function expectSortIndicator(
  page: Page,
  columnKey: string,
  direction: "asc" | "desc",
) {
  // Sort indicator is a ▲/▼ char appended to the <th> text by TanStackTable
  const header = page
    .locator('[data-testid="screener-table"] thead th', { hasText: new RegExp(columnKey, "i") })
    .first();
  await expect(header).toBeVisible();
  await expect(header).toContainText(direction === "asc" ? "▲" : "▼");
}

export async function expectNoSortIndicator(page: Page, columnKey: string) {
  const header = page
    .locator('[data-testid="screener-table"] thead th', { hasText: new RegExp(columnKey, "i") })
    .first();
  await expect(header).not.toContainText("▲");
  await expect(header).not.toContainText("▼");
}

export async function getTableCellText(
  page: Page,
  rowIdx: number,
  colIdx: number,
  testId?: string,
): Promise<string> {
  const selector = testId
    ? `[data-testid="${testId}"] tbody tr:nth-child(${rowIdx + 1}) td:nth-child(${colIdx + 1})`
    : `table tbody tr:nth-child(${rowIdx + 1}) td:nth-child(${colIdx + 1})`;
  return (await page.locator(selector).textContent()) ?? "";
}

export async function getTableCellLocator(
  page: Page,
  testId: string,
  rowIdx: number,
  colIdx: number,
): Promise<Locator> {
  const table = page.locator(`[data-testid="${testId}"]`);
  return table.locator(`tbody tr:nth-child(${rowIdx + 1}) td:nth-child(${colIdx + 1})`);
}
