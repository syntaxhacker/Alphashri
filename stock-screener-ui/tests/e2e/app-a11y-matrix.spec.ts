/**
 * Read-only real-browser axe audit matrix for the primary app routes that are
 * NOT already covered by `app-a11y.spec.ts` (that spec covers report/index,
 * sector, home, screener and options). Gated behind APP_A11Y=1.
 *
 * The mock/login setup mirrors `ui-a-plus-matrix.spec.ts` (the A+ capture
 * matrix) so each route renders its honest populated state. Results are written
 * to the task artifact directory; no app code is changed and no gate is
 * asserted here — the audit is intentionally report-only so every violation is
 * captured even when a page is broken.
 */
import fs from "node:fs";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, type Page, type Route } from "@playwright/test";
import {
  loginAsTestUser,
  setupApiMocks,
  setupPaperTradingMocks,
  setupStrategiesMocks,
  setupMultiStrategyBotMocks,
} from "../mocks/apiResponses";
import { setupHomePatternMocks } from "../mocks/homeDeskFixtures";
import { apiRoute } from "../mocks/routeHelper";
import { setupPatternEvidenceMocks } from "../mocks/patternEvidence";
import { setupNewsMocks } from "./helpers/newsHelpers";
import { setupFullBacktestMocks } from "./helpers/backtestHelpers";

const ARTIFACT_DIR = "/workspaces/react/.agent-artifacts/ui-a-plus/a11y";
const RESULTS_PATH = path.join(ARTIFACT_DIR, "matrix-results.json");
const JSONL_PATH = path.join(ARTIFACT_DIR, "matrix-records.jsonl");
const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const HERE = path.dirname(fileURLToPath(import.meta.url));
const AXE_PATH = path.resolve(HERE, "../../node_modules/axe-core/axe.min.js");

const VIEWPORTS = [
  { width: 1600, height: 1000, mobile: false },
  { width: 390, height: 844, mobile: true },
] as const;

type AxeNode = {
  target: string;
  html: string;
  impact: string | null;
  failureSummary: string | null;
};

type AxeRuleResult = {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: number;
  nodeDetails: AxeNode[];
};

export type AxeSummary = {
  counts: { passes: number; violations: number; incomplete: number; inapplicable: number };
  violations: AxeRuleResult[];
  incomplete: AxeRuleResult[];
};

type AuditRecord = {
  route: string;
  path: string;
  viewport: string;
  finalUrl: string;
  readyFound: boolean | null;
  status: "audited" | "error";
  error: string | null;
  summary: AxeSummary | null;
};

const records: AuditRecord[] = [];

/** Append one record immediately so a worker restart cannot lose earlier data. */
function persistRecord(record: AuditRecord) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  fs.appendFileSync(JSONL_PATH, `${JSON.stringify(record)}\n`);
}

const json = (body: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

async function setupApiCatchAll(page: Page) {
  await page.route("**/api/**", async (route: Route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.startsWith("/api/")) return route.fallback();
    await route.fulfill(json({}));
  });
}

const BOT_ID_1 = "550e8400-e29b-41d4-a716-446655440000";
const BOT_ID_2 = "81b1e4e1-de04-4989-8357-96daade0bd86";

type MatrixRoute = {
  slug: string;
  path: string;
  ready: string;
  setup: (page: Page) => Promise<void>;
};

const ROUTES: MatrixRoute[] = [
  {
    slug: "news",
    path: "/news",
    ready: '[data-testid="news-page"]',
    setup: (page) => setupNewsMocks(page),
  },
  {
    slug: "backtest",
    path: "/backtest",
    ready: '[data-testid="backtest-view"]',
    setup: (page) => setupFullBacktestMocks(page),
  },
  {
    slug: "paper",
    path: "/paper",
    ready: '[data-testid="paper-trading-view"]',
    setup: async (page) => {
      await setupPaperTradingMocks(page);
      await setupMultiStrategyBotMocks(page);
    },
  },
  {
    slug: "strategy-runner",
    path: "/strategy-runner",
    ready: '[data-testid="strategy-runner-page"]',
    setup: (page) => setupMultiStrategyBotMocks(page),
  },
  {
    slug: "patterns",
    path: "/patterns",
    ready: '[data-testid="patterns-page"]',
    setup: async (page) => {
      await setupHomePatternMocks(page);
      await setupPatternEvidenceMocks(page);
    },
  },
  {
    slug: "strategies",
    path: "/strategies",
    ready: '[data-testid="strategies-view"]',
    setup: (page) => setupStrategiesMocks(page),
  },
  {
    slug: "bots",
    path: "/bots",
    ready: '[data-testid="bots-view"]',
    setup: async (page) => {
      await page.route(apiRoute("bots"), (route) =>
        route.fulfill(
          json([
            {
              id: BOT_ID_1,
              name: "Default Bot",
              is_active: true,
              running: false,
              pid: null,
              strategies: [],
            },
            {
              id: BOT_ID_2,
              name: "Multi-Strategy Bot",
              is_active: true,
              running: true,
              pid: 12345,
              strategies: [{ id: "strat-1", name: "ORB Conservative", strategy_type: "ORB" }],
            },
          ]),
        ),
      );
      await page.route(apiRoute("bots/available-strategies"), (route) =>
        route.fulfill(
          json([
            {
              id: "strat-1",
              name: "ORB Conservative",
              strategy_type: "ORB",
              is_template: false,
              is_active: true,
            },
          ]),
        ),
      );
    },
  },
  {
    slug: "report-profit",
    path: "/report/profit",
    ready: '[data-testid="profitability-report"]',
    setup: (page) =>
      page.route(apiRoute("reports/profitability"), (route) =>
        route.fulfill(
          json({
            weeks: 4,
            universe: "nifty500",
            as_of: "2026-10-07T15:30:00+05:30",
            cached: false,
            strategies: [
              {
                id: "orb",
                label: "Opening Range Breakout",
                trades: 5,
                win_rate: 0.6,
                net_pnl: 1200.5,
                expectancy: 240.1,
                profit_factor: 2.1,
                max_dd: 300,
                avg_hold_days: 2,
              },
              {
                id: "sr_breakout",
                label: "S/R Breakout",
                trades: 3,
                win_rate: 0.3333,
                net_pnl: -400.25,
                expectancy: -133.42,
                profit_factor: 0.4,
                max_dd: 800,
                avg_hold_days: 5,
              },
            ],
            top_signals: [
              {
                symbol: "RELIANCE",
                strategy: "orb",
                entry_date: "2026-09-20",
                entry: 2850,
                exit: 2890,
                net: 900,
              },
              {
                symbol: "INFY",
                strategy: "sr_breakout",
                entry_date: "2026-09-21",
                entry: 1500,
                exit: 1480,
                net: -1350,
              },
            ],
          }),
        ),
      ),
  },
  {
    slug: "settings",
    path: "/settings",
    ready: '[data-testid="settings-page"]',
    setup: async () => {},
  },
  {
    slug: "admin",
    path: "/admin",
    ready: '[data-testid="admin-page"]',
    // testUser is not an admin; this audits the honest non-admin state.
    setup: async () => {},
  },
  {
    slug: "chart-RELIANCE",
    path: "/chart/RELIANCE",
    ready: '[data-testid="chart-view"]',
    setup: async (page) => {
      await setupHomePatternMocks(page);
      await page.route(/chart-patterns\/symbol\/[^/]+\/chart/, (route) =>
        route.fulfill(
          json({
            symbol: "RELIANCE",
            timeframe: "1D",
            candles: Array.from({ length: 40 }, (_, i) => ({
              time: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}T09:${String(15 + i).padStart(2, "0")}:00`,
              open: 1400 + i * 0.5,
              high: 1402 + i * 0.5,
              low: 1398 + i * 0.5,
              close: 1401 + i * 0.5,
              volume: 100000 + i * 1000,
            })),
            hits: [],
            trend_lines: [],
            data_through: "2026-09-30",
          }),
        ),
      );
    },
  },
];

async function auditPage(page: Page): Promise<AxeSummary> {
  const axeSource = readFileSync(AXE_PATH, "utf8");
  await page.addScriptTag({ content: axeSource });

  return page.evaluate(async (tags) => {
    type RawNode = {
      target: unknown[];
      html: string;
      impact?: string | null;
      failureSummary?: string | null;
    };
    type RawRule = {
      id: string;
      impact: string | null;
      help: string;
      helpUrl: string;
      tags: string[];
      nodes: RawNode[];
    };
    type Results = {
      passes: RawRule[];
      violations: RawRule[];
      incomplete: RawRule[];
      inapplicable: RawRule[];
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

    const format = (rule: RawRule) => ({
      id: rule.id,
      impact: rule.impact ?? null,
      help: rule.help,
      helpUrl: rule.helpUrl,
      tags: rule.tags,
      nodes: rule.nodes.length,
      nodeDetails: rule.nodes.map((node) => ({
        target: node.target.map(String).join(" "),
        html: (node.html || "").slice(0, 400),
        impact: node.impact ?? null,
        failureSummary: node.failureSummary ?? null,
      })),
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

for (const viewport of VIEWPORTS) {
  for (const route of ROUTES) {
    test(`axe matrix: ${route.slug} (${route.path}) @${viewport.width}x${viewport.height}`, async ({ page }) => {
      test.setTimeout(180000);
      const record: AuditRecord = {
        route: route.slug,
        path: route.path,
        viewport: `${viewport.width}x${viewport.height}`,
        finalUrl: "",
        readyFound: null,
        status: "error",
        error: null,
        summary: null,
      };
      records.push(record);

      try {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await setupApiCatchAll(page);
        await setupApiMocks(page);
        await loginAsTestUser(page);
        await route.setup(page);

        await page.goto(route.path, { waitUntil: "domcontentloaded", timeout: 30000 });
        try {
          await page.waitForSelector(route.ready, { timeout: 20000 });
          record.readyFound = true;
        } catch {
          record.readyFound = false;
          await page.waitForTimeout(2000);
        }
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        await page.mouse.move(0, 0);
        await page.waitForTimeout(400);
        record.finalUrl = page.url();

        const summary = await auditPage(page);
        record.summary = summary;
        record.status = "audited";
        await test.info().attach(`axe-matrix-${viewport.width}`, {
          body: JSON.stringify(summary, null, 2),
          contentType: "application/json",
        });
      } catch (error) {
        record.error = String(error).slice(0, 500);
        console.error(`[a11y-matrix] ${route.slug}@${viewport.width}: ${record.error}`);
      } finally {
        persistRecord(record);
      }
    });
  }
}

test.afterAll(() => {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const seen = new Map<string, AuditRecord>();
  if (fs.existsSync(JSONL_PATH)) {
    for (const line of fs.readFileSync(JSONL_PATH, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as AuditRecord;
        seen.set(`${record.route}@${record.viewport}`, record);
      } catch {
        // Ignore a partially written line from an interrupted worker.
      }
    }
  }
  const merged = Array.from(seen.values());
  fs.writeFileSync(
    RESULTS_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        tags: A11Y_TAGS,
        note: "Routes already audited by app-a11y.spec.ts are intentionally not duplicated here.",
        records: merged,
      },
      null,
      2,
    ),
  );
  console.log(`[a11y-matrix] wrote ${merged.length} records to ${RESULTS_PATH}`);
});
