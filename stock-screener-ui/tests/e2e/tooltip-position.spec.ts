import { expect, test } from "@playwright/test";

/**
 * Decoupled Tooltip geometry: the component is mounted alone (no app chrome)
 * on a harness page, so a pass here means the shared primitive positions
 * itself correctly regardless of which page uses it.
 */
test.describe("Tooltip placement", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/tests/e2e/fixtures/tooltip-harness.html");
  });

  const box = async (page: import("@playwright/test").Page, id: string) => {
    const el = page.getByTestId(id);
    await expect(el).toBeVisible();
    const b = await el.boundingBox();
    expect(b).not.toBeNull();
    return b!;
  };

  test("a default top tooltip at the viewport edge flips below and stays on screen", async ({ page }) => {
    const trigger = page.getByTestId("edge-trigger");
    await trigger.hover();
    const t = await box(page, "default-top-tip");
    const w = (await trigger.boundingBox())!;

    expect(t.y).toBeGreaterThanOrEqual(0);
    expect(t.y).toBeGreaterThanOrEqual(w.y + w.height);
    expect(t.x).toBeGreaterThanOrEqual(0);
    expect(t.x + t.width).toBeLessThanOrEqual(1280);
  });

  test("an explicit bottom tooltip renders fully below the trigger", async ({ page }) => {
    const trigger = page.getByTestId("bottom-trigger");
    await trigger.hover();
    const t = await box(page, "explicit-bottom-tip");
    const w = (await trigger.boundingBox())!;

    expect(t.y).toBeGreaterThanOrEqual(w.y + w.height);
    expect(t.y + t.height).toBeLessThanOrEqual(720);
  });

  test("mid-viewport keeps the requested top placement", async ({ page }) => {
    const trigger = page.getByTestId("mid-trigger");
    await trigger.hover();
    const t = await box(page, "mid-tip");
    const w = (await trigger.boundingBox())!;

    expect(t.y + t.height).toBeLessThanOrEqual(w.y + 1);
    expect(t.y).toBeGreaterThanOrEqual(0);
  });

  test("a top tooltip near the floor stays on screen", async ({ page }) => {
    const trigger = page.getByTestId("floor-trigger");
    await trigger.hover();
    const t = await box(page, "floor-tip");

    expect(t.y).toBeGreaterThanOrEqual(0);
    expect(t.y + t.height).toBeLessThanOrEqual(720);
  });
});
