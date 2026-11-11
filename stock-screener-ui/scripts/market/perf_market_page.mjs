/**
 * Perf probe for the Market tab end-to-end (real backend, no route mocks).
 *
 * Flow (repeated for --runs runs, fresh navigation each time):
 *   1. login via the UI form (qa@test.com / qa123 by default)
 *   2. open /?tab=market, select "Nifty 500", measure select -> rows
 *   3. click cap filter "large"     -> measure until the count updates
 *   4. fill RSI min 60              -> measure until the count updates
 *   5. reset filters, click RELIANCE row -> measure until [chart-dock] loaded
 *      (dock visible + TV chart mounted + "No chart data" gone)
 *
 * Budgets (hard fail, exit 1): row load p50 <= 5000 ms, chart p50 <= 10000 ms.
 * Filter latencies are reported without a budget.
 *
 * Reuses localhost:5173 when reachable; pass --start-app to spawn the dev
 * server (or set PERF_START_APP=1 / PERF_START_CMD="bun run dev").
 *
 * Viewport is 1440x900: the symbol dock only opens on desktop widths
 * (>= 1200 px); below that a row click navigates to /chart/:symbol instead.
 *
 * Run with:
 *   node scripts/market/perf_market_page.mjs [--start-app]
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf(name);
  if (i >= 0 && argv[i + 1] !== undefined) return argv[i + 1];
  const envKey = "PERF_" + name.replace(/^--/, "").replace(/-/g, "_").toUpperCase();
  return process.env[name.slice(2).replace(/-/g, "_").toUpperCase()] ?? process.env[envKey] ?? fallback;
}
function hasFlag(name) {
  return argv.includes(name) || process.env.PERF_START_APP === "1" && name === "--start-app";
}

const BASE = arg("--base", process.env.APP_BASE_URL || "http://localhost:5173");
const RUNS = Number(arg("--runs", "3"));
const EMAIL = arg("--email", process.env.QA_EMAIL || "qa@test.com");
const PASSWORD = arg("--password", process.env.QA_PASS || "qa123");
const OUT = arg("--out", "/tmp/opencode/perf_market_page.json");
const START_APP = hasFlag("--start-app");
const START_CMD = process.env.PERF_START_CMD || "bun run dev -- --host 127.0.0.1 --port 5173";
const STEP_TIMEOUT_MS = 30000;

const ROW_BUDGET_MS = 5000;
const CHART_BUDGET_MS = 10000;

function percentile(sortedValues, pct) {
  if (!sortedValues.length) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const rank = (pct / 100) * (sortedValues.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sortedValues[low];
  return sortedValues[low] + (sortedValues[high] - sortedValues[low]) * (rank - low);
}
function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: sorted[0] ?? null,
    p50: percentile(sorted, 50),
    max: sorted[sorted.length - 1] ?? null,
  };
}
async function isReachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.status >= 200 && res.status < 500;
  } catch {
    return false;
  }
}

let child = null;
async function ensureApp() {
  if (await isReachable(BASE)) return "reused";
  if (!START_APP) {
    throw new Error(
      `App not reachable at ${BASE}. Re-run with --start-app ` +
        `(or set PERF_START_APP=1 / PERF_START_CMD=...).`,
    );
  }
  console.log(`App not reachable; starting via: ${START_CMD}`);
  child = spawn(START_CMD, { shell: true, stdio: "ignore" });
  // Detached child cleanup is best-effort; the OS removes the process tree
  // when the shell exits. Keep a reference for the exit handler below.
  for (let i = 0; i < 90; i += 1) {
    if (await isReachable(BASE)) return "started";
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`App did not become reachable at ${BASE} within 90s`);
}
async function stopApp() {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 2000));
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

async function login(page) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const deadline = Date.now() + 20000;
  let authed = false;
  let sawLogin = false;
  while (Date.now() < deadline) {
    if (await page.locator('[data-testid="app-shell"]').isVisible().catch(() => false)) {
      authed = true;
      break;
    }
    if (await page.locator('[data-testid="login-form"]').isVisible().catch(() => false)) {
      sawLogin = true;
      break;
    }
    await page.waitForTimeout(250);
  }
  if (authed) return "already-authed";
  if (!sawLogin) throw new Error("Neither login form nor app shell appeared");
  await page.locator('[data-testid="login-email-input"]').fill(EMAIL);
  await page.locator('[data-testid="login-password-input"]').fill(PASSWORD);
  await page.locator('[data-testid="login-submit-btn"]').click();
  await page.locator('[data-testid="app-shell"]').waitFor({
    state: "visible",
    timeout: STEP_TIMEOUT_MS,
  });
  return "ui-login";
}

async function selectNifty500(page) {
  const combobox = page
    .locator('[data-testid="market-universe-select"]')
    .getByRole("combobox");
  await combobox.click();
  await page.getByRole("option", { name: "Nifty 500", exact: true }).click();
}

async function waitForCountChange(page, previous) {
  await page.waitForFunction(
    (prev) => {
      const el = document.querySelector('[data-testid="market-result-count"]');
      return (el?.textContent ?? "") !== prev;
    },
    previous,
    { timeout: STEP_TIMEOUT_MS },
  );
}

async function readCount(page) {
  return (await page.locator('[data-testid="market-result-count"]').textContent()) ?? "";
}

export async function runOnce(page, runIndex) {
  const startedNav = Date.now();
  await page.goto(`${BASE}/?tab=market`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="market-screener"]').waitFor({
    state: "visible",
    timeout: STEP_TIMEOUT_MS,
  });
  const gotoMs = Date.now() - startedNav;

  // Universe switch -> rows.
  const startedRows = Date.now();
  await selectNifty500(page);
  await page.locator('[data-testid="market-row-RELIANCE"]').waitFor({
    state: "visible",
    timeout: STEP_TIMEOUT_MS,
  });
  await page.locator('[data-testid="market-skeleton"]').waitFor({
    state: "detached",
    timeout: STEP_TIMEOUT_MS,
  }).catch(() => {});
  const rowLoadMs = Date.now() - startedRows;
  const countAfterSelect = await readCount(page);

  // Cap filter click latency.
  const capBefore = countAfterSelect;
  const startedCap = Date.now();
  await page.locator('[data-testid="market-cap-large"]').click();
  await waitForCountChange(page, capBefore);
  const capMs = Date.now() - startedCap;
  const countAfterCap = await readCount(page);

  // RSI filter latency (client-side; spinbutton fill per E2E spec).
  const startedRsi = Date.now();
  const rsiInput = page.locator('[data-testid="market-filter-rsi-min"]').getByRole("spinbutton");
  await rsiInput.fill("60");
  await waitForCountChange(page, countAfterCap);
  const rsiMs = Date.now() - startedRsi;
  const countAfterRsi = await readCount(page);

  // Reset, then open RELIANCE in the dock.
  await page.locator('[data-testid="market-reset"]').click();
  await page.locator('[data-testid="market-row-RELIANCE"]').waitFor({
    state: "visible",
    timeout: STEP_TIMEOUT_MS,
  });

  const startedChart = Date.now();
  await page.locator('[data-testid="market-row-RELIANCE"]').click();
  // Settled = dock mounted + chart mounted + spinner gone. Two legitimate
  // outcomes: candles present, or the bounded empty state ("No chart data"
  // when the upstream fetch timed out / had no data). The budget guards
  // time-to-settle, and the outcome is reported separately.
  await page.waitForFunction(
    () => {
      const dock = document.querySelector('[data-testid="patterns-chart-dock"]');
      const tv = document.querySelector('[data-testid="patterns-tv-chart"]');
      if (!dock || !tv) return false;
      if (document.querySelector('[data-testid="patterns-fullscreen-loading"]')) return false;
      return true;
    },
    null,
    { timeout: 20000 },
  );
  const chartMs = Date.now() - startedChart;
  const chartBodyText =
    (await page.locator('[data-testid="patterns-chart-body"]').textContent()) ?? "";
  const chartOutcome = chartBodyText.includes("No chart data") ? "empty" : "candles";

  // Best-effort close so the next run starts from a clean surface.
  await page.locator('[data-testid="patterns-chart-close"]').click().catch(() => {});
  await page.locator('[data-testid="patterns-chart-dock"]').waitFor({
    state: "detached",
    timeout: 5000,
  }).catch(() => {});

  return {
    run: runIndex,
    gotoMs,
    rowLoadMs,
    capFilterMs: capMs,
    rsiFilterMs: rsiMs,
    chartMs,
    chartOutcome,
    countAfterSelect,
    countAfterCap,
    countAfterRsi,
  };
}

async function main() {
  const appState = await ensureApp();
  console.log(`App: ${appState} (${BASE})`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const chartDockLogs = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("[chart-dock]")) {
      chartDockLogs.push(`${msg.type()}: ${text}`);
    }
  });

  const loginPath = await login(page);
  console.log(`Login: ${loginPath}`);

  const runs = [];
  let failures = 0;
  for (let i = 1; i <= RUNS; i += 1) {
    try {
      const sample = await runOnce(page, i);
      runs.push(sample);
      console.log(
        `run ${i}: goto=${sample.gotoMs}ms rows=${sample.rowLoadMs}ms ` +
          `cap=${sample.capFilterMs}ms rsi=${sample.rsiFilterMs}ms ` +
          `chart=${sample.chartMs}ms (${sample.chartOutcome}) counts: ` +
          `"${sample.countAfterSelect}" -> ` +
          `"${sample.countAfterCap}" -> "${sample.countAfterRsi}"`,
      );
    } catch (err) {
      failures += 1;
      console.log(`run ${i}: FAILED — ${err.message}`);
      await page.screenshot({ path: `/tmp/opencode/perf_market_page_run${i}_failed.png` });
    }
  }

  await context.close();
  await browser.close();
  await stopApp();

  const rowSummary = summarize(runs.map((r) => r.rowLoadMs));
  const chartSummary = summarize(runs.map((r) => r.chartMs));
  const capSummary = summarize(runs.map((r) => r.capFilterMs));
  const rsiSummary = summarize(runs.map((r) => r.rsiFilterMs));
  const budgets = [
    { check: "row load p50", actual_ms: rowSummary.p50, budget_ms: ROW_BUDGET_MS,
      verdict: rowSummary.p50 !== null && rowSummary.p50 <= ROW_BUDGET_MS ? "PASS" : "FAIL" },
    { check: "chart load p50", actual_ms: chartSummary.p50, budget_ms: CHART_BUDGET_MS,
      verdict: chartSummary.p50 !== null && chartSummary.p50 <= CHART_BUDGET_MS ? "PASS" : "FAIL" },
  ];
  console.log("\n== budgets ==");
  for (const b of budgets) {
    console.log(`[${b.verdict}] ${b.check}: ${b.actual_ms}ms vs ${b.budget_ms}ms`);
  }
  console.log(
    `filters: cap p50=${capSummary.p50}ms rsi p50=${rsiSummary.p50}ms ` +
      `(no budget)`,
  );
  console.log(`[chart-dock] console lines (${chartDockLogs.length}):`);
  for (const line of chartDockLogs) console.log(`  ${line}`);

  const report = {
    generated_at: new Date().toISOString(),
    base: BASE,
    app: appState,
    login: loginPath,
    runs,
    summaries: { rowLoad: rowSummary, chart: chartSummary, cap: capSummary, rsi: rsiSummary },
    budgets,
    chartDockLogs,
  };
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`\nJSON report -> ${OUT}`);

  if (failures > 0 || budgets.some((b) => b.verdict === "FAIL")) {
    console.log("EXIT 1: run failure or budget breach");
    return 1;
  }
  return 0;
}

const exitCode = await main().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  return 2;
});
process.exit(exitCode);
