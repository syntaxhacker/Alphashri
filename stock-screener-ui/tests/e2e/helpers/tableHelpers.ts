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
  await page.locator(`[data-testid="sort-header-${columnKey}"]`).first().click();
}

export async function expectSortIndicator(
  page: Page,
  columnKey: string,
  direction: "asc" | "desc",
) {
  const indicator = page.locator(`[data-testid="sort-indicator-${columnKey}"]`).first();
  await expect(indicator).toBeVisible();
  await expect(indicator).toHaveClass(new RegExp(direction));
}

export async function expectNoSortIndicator(page: Page, columnKey: string) {
  const indicator = page.locator(`[data-testid="sort-indicator-${columnKey}"]`).first();
  await expect(indicator).not.toBeVisible();
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
