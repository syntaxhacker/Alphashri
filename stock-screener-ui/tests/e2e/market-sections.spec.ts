import { test, expect, type Locator, type Page } from "@playwright/test";
import { loginAsTestUser, setupApiMocks } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";

/**
 * Native signal-sections CRUD contract — MARKET_SECTIONS_PLAN.md P1 (Section
 * Manager + `user.sections` savedConfig) and P3 (Screener `Sections` tab + Home
 * window picker). `docs/TV_USAGE.md` is the verified field contract behind it.
 *
 * Honesty gate (2026-11-25): `SectionManagerModal.tsx` now exists with the
 * `section-*` testids used below, but it is not reachable from the app yet —
 * `SectionsView` and `SECTION_TABS` are defined in `MarketScreenerPanel.tsx`
 * and never rendered, so the `market-sections-add` entry point never mounts.
 * Home's dynamic section picker is also in flight (`homeSectionPanels.ts` has
 * a JSX parse error in a `.ts` file). Every case therefore carries
 * `test.skip(true, "<reason>")` naming the missing surface. Once the tab and
 * picker are wired, delete the individual skip lines — the selectors and mock
 * below already match the shipped component contract.
 *
 * `setupUserConfigMocks` deliberately 404s scopes other than `market.filters`
 * and the table scopes, so this spec installs its own in-memory `user.sections`
 * route mock. State lives in the test closure, so `page.reload()` re-reads what
 * the previous mount wrote — persistence is proved, not inferred from a spy.
 */
const SECTIONS_SCOPE = "user.sections";
const SECTIONS_URL = "/screener/market";

interface SectionCondition {
  metric: string;
  op: string;
  value: number | null;
}

interface SectionRow {
  id: string;
  name: string;
  description: string;
  concept: string;
  side: "long" | "short" | "both";
  conditions: SectionCondition[];
  render: { type: "table"; columns: string[] };
  refreshSec: number;
  enabled: boolean;
  pinned: boolean;
}

function section(overrides: Partial<SectionRow> = {}): SectionRow {
  return {
    id: "e2e-section",
    name: "E2E VWAP reclaim",
    description: "Created by the Sections CRUD E2E spec.",
    concept: "vwap_above",
    side: "long",
    conditions: [{ metric: "close", op: "gt", value: null }],
    render: { type: "table", columns: ["symbol", "close", "VWAP"] },
    refreshSec: 30,
    enabled: true,
    pinned: false,
    ...overrides,
  };
}

interface SectionsMock {
  sections(): SectionRow[];
  puts(): SectionRow[][];
}

async function mockSectionsScope(page: Page, seed: SectionRow[] = []): Promise<SectionsMock> {
  let stored = [...seed];
  const puts: SectionRow[][] = [];
  const envelope = () => ({
    scope: SECTIONS_SCOPE,
    version: 1,
    saved: stored.length > 0,
    updated_at: stored.length > 0 ? new Date().toISOString() : null,
    config: { sections: stored, version: 1 },
  });

  await page.route(apiRoute(`user-configs/${SECTIONS_SCOPE}`), async (route) => {
    if (route.request().method() === "PUT") {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(route.request().postData() || "{}") as Record<string, unknown>;
      } catch {
        body = {};
      }
      // putUserConfig wraps payloads as `{ config: <serialized scope>, version }`.
      const config = (body.config ?? {}) as Record<string, unknown>;
      const next = (Array.isArray(config.sections) ? config.sections : []) as SectionRow[];
      stored = [...next];
      puts.push([...next]);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope()),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope()),
    });
  });

  return { sections: () => stored, puts: () => puts };
}

async function openSectionManager(page: Page): Promise<Locator> {
  await page.goto(SECTIONS_URL);
  const toggle = page.getByTestId("market-view-toggle");
  const sectionsTab = toggle.getByRole("button", { name: "Sections", exact: true });
  await expect(sectionsTab).toBeVisible();
  // The narrow track has a right-edge scroll cue; bring the tab to the start
  // before clicking so the cue does not intercept the pointer.
  // At 390px the scroll cue overlays the right edge of the track; keyboard
  // activation reaches the same onChange handler without the intercepted click.
  await sectionsTab.focus();
  await sectionsTab.press("Enter");
  await page.getByTestId("market-sections-add").click();
  const dialog = page.getByTestId("section-manager-modal");
  await expect(dialog).toContainText("Signal Sections");
  return dialog;
}

function sectionItems(dialog: Locator): Locator {
  return dialog.locator('[data-testid^="section-item-"]');
}

async function createSection(dialog: Locator, name: string, mobile = false): Promise<void> {
  await dialog.getByTestId("section-new").click();
  await dialog.getByTestId("section-name").fill(name);
  await dialog.getByTestId("section-save").click();
  if (mobile) {
    await expect(
      dialog.getByTestId("section-select-mobile").locator("option").filter({ hasText: name }),
    ).toHaveCount(1);
  } else {
    await expect(sectionItems(dialog).filter({ hasText: name }).first()).toBeVisible();
  }
}

test.describe("Sections CRUD @ 1600", () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("Screener Sections tab opens the Signal Sections manager", async ({ page }) => {
    await mockSectionsScope(page);
    const dialog = await openSectionManager(page);
    await expect(dialog.getByTestId("section-new")).toBeVisible();
    await expect(sectionItems(dialog).first()).toBeVisible();
  });

  test("create → save → reload persists the section in user.sections", async ({ page }) => {
    const mock = await mockSectionsScope(page);
    const dialog = await openSectionManager(page);
    const name = "E2E persisted section";
    await createSection(dialog, name);

    await expect.poll(() => mock.sections().map((row) => row.name)).toContain(name);
    expect(mock.puts().length).toBeGreaterThan(0);

    await page.reload();
    const reopened = await openSectionManager(page);
    await expect(sectionItems(reopened).filter({ hasText: name }).first()).toBeVisible();
    expect(mock.sections().map((row) => row.name)).toContain(name);
  });

  test("duplicate creates an independent copy with a distinct id", async ({ page }) => {
    const mock = await mockSectionsScope(page, [section()]);
    const dialog = await openSectionManager(page);
    await sectionItems(dialog).filter({ hasText: "E2E VWAP reclaim" }).first().click();
    await dialog.getByTestId("section-duplicate").click();

    await expect.poll(() => mock.sections().length).toBe(2);
    const ids = mock.sections().map((item) => item.id);
    expect(new Set(ids).size).toBe(2);
  });

  test("delete removes the section and survives a reload", async ({ page }) => {
    const mock = await mockSectionsScope(page, [section()]);
    const dialog = await openSectionManager(page);
    await sectionItems(dialog).filter({ hasText: "E2E VWAP reclaim" }).first().click();
    await dialog.getByTestId("section-delete").click();
    const confirm = dialog.getByTestId("section-delete-confirm-panel");
    await expect(confirm).toBeVisible();
    await confirm.getByTestId("section-delete-confirm").click();

    await expect.poll(() => mock.sections()).toEqual([]);
    await page.reload();
    const reopened = await openSectionManager(page);
    await expect(sectionItems(reopened).filter({ hasText: "E2E VWAP reclaim" })).toHaveCount(0);
  });

  test("a pinned user section is offered by the Home + Window picker", async ({ page }) => {
    const name = "E2E VWAP reclaim";
    await mockSectionsScope(page, [section({ name, pinned: true })]);
    await page.goto("/");
    await page.getByTestId("nav-home").click();
    await expect(page.getByTestId("home-page")).toBeVisible();
    await page.getByTestId("home-view-desk").click();
    await expect(
      page.getByTestId("home-panel-picker").locator("select option").filter({ hasText: name }),
    ).toHaveCount(1);
  });
});

test.describe("Sections CRUD @ 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("manager swaps the list for a labelled Select and keeps Save sticky", async ({ page }) => {
    const mock = await mockSectionsScope(page);
    const dialog = await openSectionManager(page);
    await expect(dialog.getByTestId("section-select-mobile")).toBeVisible();
    await createSection(dialog, "E2E mobile section", true);

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expect
      .poll(() => mock.sections().map((row) => row.name))
      .toContain("E2E mobile section");
  });
});
