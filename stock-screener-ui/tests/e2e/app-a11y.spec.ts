/**
 * Real-browser axe audits for the honest app routes.
 *
 * Gated behind APP_A11Y=1 so normal CI stays stable; run explicitly with
 * `APP_A11Y=1 npx playwright test tests/e2e/app-a11y.spec.ts`. These are the
 * same real routes and shared mocks used by `design-evidence.spec.ts` (plus the
 * Screener evidence mock) — app pages, not Storybook substitutes.
 *
 * `@axe-core/playwright` is not installed here, so this file injects the
 * already-installed `axe-core` browser bundle from node_modules, the same
 * approach as `scripts/storybook-a11y.mjs`. No new dependency is added.
 *
 * Gate policy: fail on serious/critical violations only (WCAG 2.0/2.1 A+AA
 * tags). `color-contrast` frequently lands in axe's `incomplete` bucket
 * ("needs review") on chart/gradient-heavy surfaces; that is documented and
 * allowed here. Incomplete results are never violations in their own right, so
 * they are surfaced in logs/attachments for manual triage but do not block.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "@playwright/test";
import {
  loginAsTestUser,
  setupApiMocks,
  setupHomeDeskMocks,
  setupNiftyReportMocks,
  setupOptionsMocks,
  setupSectorMocks,
} from "../mocks/apiResponses";
import {
  SCREENER_EVIDENCE_PATH,
  setupScreenerEvidenceMocks,
} from "../mocks/screenerEvidence";
import { collectConsoleErrors } from "./helpers/flowsB";
import { setupNewsMocks } from "./helpers/newsHelpers";

const A11Y = process.env.APP_A11Y === "1";
const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const DOCUMENTED_INCOMPLETE = new Set(["color-contrast"]);
const TABLE_ROWS = '[data-testid="screener-table"] tbody tr';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AXE_PATH = path.resolve(HERE, "../../node_modules/axe-core/axe.min.js");

type AxeRuleResult = {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  nodes: number;
  targets: string[];
};

type AxeSummary = {
  counts: {
    passes: number;
    violations: number;
    incomplete: number;
    inapplicable: number;
  };
  violations: AxeRuleResult[];
  incomplete: AxeRuleResult[];
};

/** Inject the installed axe-core bundle and run it inside the live app page. */
async function auditPage(page: Page): Promise<AxeSummary> {
  // Read lazily: with APP_A11Y unset the spec never touches this file, so a
  // missing optional bundle cannot break the normal CI run at import time.
  const axeSource = readFileSync(AXE_PATH, "utf8");
  await page.addScriptTag({ content: axeSource });

  return page.evaluate(async (tags) => {
    type RuleResult = {
      id: string;
      impact: string | null;
      help: string;
      helpUrl: string;
      nodes: Array<{ target: unknown[] }>;
    };
    type Results = {
      passes: RuleResult[];
      violations: RuleResult[];
      incomplete: RuleResult[];
      inapplicable: RuleResult[];
    };
    type AxeLike = {
      run: (
        context: Document,
        options: { runOnly: { type: string; values: string[] } },
      ) => Promise<Results>;
    };

    const axe = (window as unknown as { axe?: AxeLike }).axe;
    if (!axe || typeof axe.run !== "function") {
      throw new Error("axe-core did not initialise inside the app page");
    }
    const results = await axe.run(document, {
      runOnly: { type: "tag", values: tags },
    });

    const format = (rule: RuleResult) => ({
      id: rule.id,
      impact: rule.impact ?? null,
      help: rule.help,
      helpUrl: rule.helpUrl,
      nodes: rule.nodes.length,
      targets: rule.nodes.map((node) => node.target.map(String).join(" ")),
    });

    return {
      counts: {
        passes: results.passes.length,
        violations: results.violations.length,
        incomplete: results.incomplete.length,
        inapplicable: results.inapplicable.length,
      },
      violations: results.violations.map(format),
      incomplete: results.incomplete.map(format),
    };
  }, A11Y_TAGS);
}

function formatRule(rule: AxeRuleResult): string {
  const note = DOCUMENTED_INCOMPLETE.has(rule.id) ? " [documented/allowed]" : "";
  return (
    `  - ${rule.id} [impact=${rule.impact ?? "n/a"}, nodes=${rule.nodes}]${note}\n` +
    `    ${rule.help}\n` +
    `    ${rule.helpUrl}\n` +
    `    targets: ${rule.targets.slice(0, 10).join(" | ") || "(none)"}`
  );
}

function describeSummary(route: AuditRoute, summary: AxeSummary): string {
  const lines = [
    `${route.name} (${route.path}) axe rules: ` +
      `passes=${summary.counts.passes}, violations=${summary.counts.violations}, ` +
      `incomplete=${summary.counts.incomplete}, inapplicable=${summary.counts.inapplicable}`,
    "Violations:",
    ...(summary.violations.length ? summary.violations.map(formatRule) : ["  (none)"]),
    "Incomplete (needs review, informational):",
    ...(summary.incomplete.length ? summary.incomplete.map(formatRule) : ["  (none)"]),
  ];
  return lines.join("\n");
}

type AuditRoute = {
  name: string;
  path: string;
  ready?: string;
  setup?: (page: Page) => Promise<void>;
  navigate?: (page: Page) => Promise<void>;
  verify?: (page: Page) => Promise<void>;
  waitForNetworkIdle?: boolean;
};

const consoleErrors = new WeakMap<Page, string[]>();

const ROUTES: readonly AuditRoute[] = [
  {
    name: "report",
    path: "/report/index",
    ready: '[data-testid="nifty-report-panel"]',
    setup: (page) => setupNiftyReportMocks(page),
  },
  {
    name: "sector",
    path: "/sector",
    ready: '[data-testid="sector-analysis-view"]',
    setup: (page) => setupSectorMocks(page),
  },
  {
    name: "options",
    path: "/options",
    ready: '[data-testid="options-chain-panel"]',
    setup: (page) => setupOptionsMocks(page),
  },
  {
    name: "home",
    path: "/home",
    ready: '[data-testid="window-manager-canvas"]',
    // The desk's seeded panels poll every 5s, so networkidle is not a stable
    // readiness signal; the desk root plus the panel assertions below are.
    waitForNetworkIdle: false,
    setup: async (page) => {
      consoleErrors.set(page, collectConsoleErrors(page));
      // Same order as home-desk.spec.ts / design-evidence.spec.ts: later
      // route handlers take priority in Playwright.
      await setupNewsMocks(page);
      await setupHomeDeskMocks(page);
    },
    // Load the real /home route directly (as design-evidence.spec.ts does)
    // rather than clicking `nav-home` from "/"; the rail is behind a drawer at
    // narrow widths and the desk root/window-manager are the real readiness
    // signals. Switch to the desk view before the axe audit.
    navigate: async (page) => {
      await page.goto("/home");
      await expect(page).toHaveURL(/\/home$/);
      await expect(page.getByTestId("home-page")).toBeVisible();
      await page.getByTestId("home-view-desk").click();
    },
    verify: async (page) => {
      await expect(page.getByTestId("market-heatmap-panel")).toHaveCount(1);
      await expect(page.getByTestId("market-heatmap-loading")).toHaveCount(0);
      await expect(page.getByTestId("market-heatmap-error")).toHaveCount(0);
      await expect(page.getByTestId("options-chain-window")).toHaveCount(1);
      await expect(page.getByTestId("options-chain-loading")).toHaveCount(0);
      await expect(page.getByTestId("options-chain-empty")).toHaveCount(0);
      await expect(page.getByTestId("options-chain-error")).toHaveCount(0);
      expect(consoleErrors.get(page)).toEqual([]);
    },
  },
  {
    name: "screener",
    path: SCREENER_EVIDENCE_PATH,
    ready: TABLE_ROWS,
    // `setupScreenerEvidenceMocks` is exported by screener-evidence.spec.ts's
    // fixture module, so the Screener route can be audited honestly too.
    setup: async (page) => {
      consoleErrors.set(page, collectConsoleErrors(page));
      await setupScreenerEvidenceMocks(page);
    },
    verify: async (page) => {
      await expect(page.locator(TABLE_ROWS).first()).toBeVisible();
      await expect(page.getByTestId("group-performance-panel")).toBeVisible();
      await expect(page.getByTestId("group-performance-error")).toHaveCount(0);
      await expect(page.getByTestId("screener-error-container")).toHaveCount(0);
      expect(
        consoleErrors.get(page)?.filter((text) => text.includes("Failed to fetch")),
      ).toEqual([]);
    },
  },
];

for (const route of ROUTES) {
  test(`axe audit: ${route.name} (${route.path})`, async ({ page }) => {
    test.skip(!A11Y, "set APP_A11Y=1 to run real-browser axe audits");

    await page.setViewportSize({ width: 1600, height: 1000 });
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await route.setup?.(page);

    if (route.navigate) await route.navigate(page);
    else await page.goto(route.path);

    if (route.ready) await page.waitForSelector(route.ready, { timeout: 20000 });
    if (route.waitForNetworkIdle !== false) await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    await route.verify?.(page);

    const summary = await auditPage(page);
    await test.info().attach("axe-summary", {
      body: JSON.stringify(summary, null, 2),
      contentType: "application/json",
    });

    for (const rule of summary.incomplete) {
      const note = DOCUMENTED_INCOMPLETE.has(rule.id) ? "documented/allowed" : "needs review";
      console.log(`[app-a11y] ${route.name}: incomplete ${rule.id} (${note}, ${rule.nodes} nodes)`);
    }

    const blocking = summary.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(blocking, describeSummary(route, summary)).toEqual([]);
  });
}
