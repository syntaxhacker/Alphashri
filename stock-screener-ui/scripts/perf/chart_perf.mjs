#!/usr/bin/env node
/**
 * Interactive chart/UI performance gate.
 *
 * Measures route load, timeframe switching, pan/zoom frame p95 + long tasks,
 * heap/canvas/listener growth, all-on/all-off toggle cost, and chart payload
 * raw/gzip sizes against perf/chart_ui_budgets.json. Backend indicator+zone
 * p95 values come from fixtures/manifest.json produced by
 * scripts/perf/gen_chart_fixtures.py.
 *
 * Prerequisites: preview server on 127.0.0.1:4174 and generated fixtures.
 * See docs/CHART_PERFORMANCE.md. Exits 1 on blockers unless --report.
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const UI_ROOT = resolve(HERE, "../..");
const BUDGETS_PATH = join(UI_ROOT, "perf", "chart_ui_budgets.json");
const BASE_URL = arg("base-url", process.env.CHART_PERF_BASE_URL ?? "http://127.0.0.1:4174").replace(/\/$/, "");
const ARTIFACT_ROOT =
  process.env.CHART_PERF_ARTIFACT_DIR ||
  (process.env.CODESPACES ? "/workspaces/test-rag/.agent-artifacts/chart-perf" : "/tmp/opencode/chart-perf");
const FIXTURES_DIR = arg("fixtures", join(ARTIFACT_ROOT, "fixtures"));
const RESULTS_PATH = arg("results", join(UI_ROOT, "perf", "chart-perf-results.json"));
const RUNS = Math.max(3, Number(arg("runs", 3)) || 3);
const REPORT_ONLY = process.argv.includes("--report");
const HEADED = process.argv.includes("--headed");
const FORCE = process.argv.includes("--force");
const VIEWPORTS = [
  { name: "1600x1000", width: 1600, height: 1000 },
  { name: "390x844", width: 390, height: 844 },
];
const TF_IDS = ["1m", "5m", "10m", "15m", "30m", "1h", "3h", "4h", "1D", "1W", "1M"];
const DEFAULT_TF = "1D";
const USER = {
  id: 1,
  email: "perf@local",
  display_name: "Perf",
  initial_capital: 1000000,
  created_at: "2026-01-01T00:00:00",
};

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

function fail(message) {
  console.error(`chart perf: ${message}`);
  process.exit(1);
}

function round(value, digits = 2) {
  return value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits));
}

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index];
}

function stats(samples) {
  const clean = samples.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) return { n: 0, min: null, median: null, p95: null, max: null };
  return {
    n: clean.length,
    min: round(clean[0]),
    median: round(percentile(clean, 0.5)),
    p95: round(percentile(clean, 0.95)),
    max: round(clean[clean.length - 1]),
  };
}

function loadInputs() {
  if (!existsSync(BUDGETS_PATH)) fail(`missing ${BUDGETS_PATH}`);
  const budgets = JSON.parse(readFileSync(BUDGETS_PATH, "utf8"));
  const required = [
    "initial_route_chart_ms",
    "timeframe_switch_ms",
    "pan_zoom_frame_p95_ms",
    "long_task_max_ms",
    "heap_growth_after_cycles_mb",
    "canvas_count_growth_max",
    "listener_count_growth_max",
    "indicator_payload_raw_bytes",
    "indicator_payload_gzip_bytes",
    "backend_indicator_zones_p95_ms",
    "toggle_all_ms",
  ];
  const missing = required.filter((key) => !(key in (budgets.targets ?? {})));
  if (missing.length) fail(`budgets missing targets: ${missing.join(", ")}`);
  for (const exception of budgets.known_exceptions ?? []) {
    const fields = ["target", "measured_limit", "cause", "owner", "recorded"];
    const absent = fields.filter((field) => exception[field] == null || exception[field] === "");
    if (absent.length) fail(`known_exception missing ${absent.join(", ")}: ${JSON.stringify(exception)}`);
  }
  const fixturesPath = join(FIXTURES_DIR, "fixtures.json");
  if (!existsSync(fixturesPath)) {
    fail(
      `missing ${fixturesPath}. Generate real fixtures first:\n` +
        "  bun run perf:chart:fixtures",
    );
  }
  const fixtures = JSON.parse(readFileSync(fixturesPath, "utf8"));
  if (Object.keys(fixtures.timeframes ?? {}).length !== 11) {
    fail(`expected 11 fixture timeframes, got ${Object.keys(fixtures.timeframes ?? {}).length}`);
  }
  const manifestPath = join(FIXTURES_DIR, "manifest.json");
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
  return { budgets, fixtures, manifest };
}

async function preflight() {
  let response;
  try {
    response = await fetch(`${BASE_URL}/`);
  } catch (error) {
    fail(
      `no server at ${BASE_URL} (${error.message}). ` +
        "Run `bun run build` and `bun run preview -- --host 127.0.0.1 --port 4174`.",
    );
  }
  if (!response.ok) fail(`${BASE_URL}/ returned HTTP ${response.status}`);

  const cpus = os.cpus().length || 1;
  const load1 = os.loadavg()[0];
  if (!FORCE && load1 > cpus * 0.7) {
    fail(
      `CPU busy (load1=${load1.toFixed(2)}, cpus=${cpus}). ` +
        "Wait for ≥30% idle or rerun with --force (results will be marked contended).",
    );
  }
  return { cpus, load1, contended: load1 > cpus * 0.7 };
}

async function installAuth(context) {
  await context.addInitScript((user) => {
    localStorage.setItem("alphashri_token", "chart_perf_opaque_token");
    localStorage.setItem("alphashri_refresh_token", "chart_perf_opaque_refresh");
    localStorage.setItem("alphashri_user", JSON.stringify(user));
  }, USER);
  // Listener counts come from CDP Performance.getMetrics(JSEventListeners),
  // not from patching add/removeEventListener: the latter counts attaches to
  // DOM nodes that are later removed and GC'd without an explicit remove,
  // inflating the delta. See openListenerMetrics()/liveListenerCount().
}

async function installMocks(context, fixtures) {
  const chartBodies = {};
  const tfSpecs = Object.keys(fixtures.timeframes).map((id) => ({ id, label: id }));

  await context.route("**/api/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  await context.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USER) }),
  );
  await context.route("**/api/auth/refresh", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ detail: "refresh disabled in perf harness" }),
    }),
  );
  await context.route("**/api/chart-patterns/timeframes**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ timeframes: tfSpecs }),
    }),
  );
  await context.route("**/api/chart-patterns/symbol/*/chart**", async (route) => {
    const url = new URL(route.request().url());
    const requested = url.searchParams.get("timeframe") || DEFAULT_TF;
    const tf = fixtures.timeframes[requested] ? requested : DEFAULT_TF;
    const fixture = fixtures.timeframes[tf];
    const body = JSON.stringify({
      symbol: fixtures.symbol,
      timeframe: tf,
      candles: fixture.candles,
      overlays: [],
      trend_lines: [],
      hits: [],
      indicators: fixture.indicators,
      sr_zones: fixture.sr_zones,
    });
    chartBodies[tf] = body;
    await route.fulfill({ status: 200, contentType: "application/json", body });
  });

  return chartBodies;
}

async function waitForChart(page, tf, timeout = 25000) {
  await page.waitForSelector('[data-testid="patterns-tv-chart"] canvas', {
    state: "visible",
    timeout,
  });
  await page.waitForFunction(
    (expected) => {
      const select = document.querySelector(
        '[data-testid="patterns-timeframe-select"] select',
      );
      if (!(select instanceof HTMLSelectElement) || select.value !== expected) return false;
      if (document.querySelector('[data-testid="chart-error"]')) return false;
      if (document.querySelector('[data-testid="chart-empty"]')) return false;
      const loader = document.querySelector('[data-testid="patterns-fullscreen-loading"]');
      if (loader && loader.getBoundingClientRect().width > 0) return false;
      return true;
    },
    tf,
    { timeout },
  );
  await page.waitForTimeout(120);
}

async function waitForTimeframeOptions(page) {
  await page.waitForFunction(
    (ids) => {
      const select = document.querySelector(
        '[data-testid="patterns-timeframe-select"] select',
      );
      if (!(select instanceof HTMLSelectElement)) return false;
      const values = new Set([...select.options].map((option) => option.value));
      return ids.every((id) => values.has(id));
    },
    TF_IDS,
    { timeout: 20000 },
  );
}

async function selectTimeframe(page, tf) {
  await page.locator('[data-testid="patterns-timeframe-select"] select').selectOption(tf);
  await waitForChart(page, tf);
}

async function gotoChart(page) {
  await page.goto(`${BASE_URL}/chart/POWERGRID.NS?tf=${DEFAULT_TF}`, {
    waitUntil: "domcontentloaded",
  });
  await waitForTimeframeOptions(page);
  await waitForChart(page, DEFAULT_TF);
}

async function openIndicators(page) {
  await page.locator('[data-testid="patterns-chart-indicators-trigger"]').click();
  await page
    .locator('[data-testid="patterns-chart-indicators-popover"]')
    .waitFor({ state: "visible", timeout: 5000 });
}

async function closeIndicators(page) {
  const popover = page.locator('[data-testid="patterns-chart-indicators-popover"]');
  if (await popover.isVisible().catch(() => false)) {
    await page.locator('[data-testid="patterns-chart-indicators-trigger"]').click();
    await popover.waitFor({ state: "hidden", timeout: 5000 });
  }
}

async function enabledIndicatorIds(page) {
  return page.locator('input[data-testid^="chart-indicator-"]').evaluateAll((els) =>
    els
      .filter((el) => !/** @type {HTMLInputElement} */ (el).disabled)
      .map((el) => el.getAttribute("data-testid").replace("chart-indicator-", "")),
  );
}

async function toggleAll(page, ids, wantOn) {
  return page.evaluate(
    async ({ ids: indicatorIds, wantOn: target }) => {
      const started = performance.now();
      for (const id of indicatorIds) {
        const input = document.querySelector(`[data-testid="chart-indicator-${id}"]`);
        if (input instanceof HTMLInputElement && !input.disabled && input.checked !== target) {
          input.click();
        }
      }
      await new Promise((done) => requestAnimationFrame(done));
      await new Promise((done) => requestAnimationFrame(done));
      return performance.now() - started;
    },
    { ids, wantOn },
  );
}

async function activeCounts(page) {
  const trigger = page.locator('[data-testid="patterns-chart-indicators-trigger"]');
  const triggerCount = Number((await trigger.getAttribute("data-active-count")) ?? 0);
  const strip = page.locator('[data-testid="chart-active-indicators"]');
  const stripCount = (await strip.count())
    ? Number((await strip.getAttribute("data-active-count")) ?? 0)
    : 0;
  return { triggerCount, stripCount };
}

async function measureRouteLoads(context, runs) {
  const samples = [];
  for (let index = 0; index <= runs; index += 1) {
    const page = await context.newPage();
    const started = Date.now();
    try {
      await page.goto(`${BASE_URL}/chart/POWERGRID.NS?tf=${DEFAULT_TF}`, {
        waitUntil: "domcontentloaded",
      });
      await waitForChart(page, DEFAULT_TF);
      const elapsed = Date.now() - started;
      if (index > 0) samples.push(elapsed);
    } finally {
      await page.close();
    }
  }
  return samples;
}

async function measureFrames(page) {
  const canvas = page.locator('[data-testid="patterns-tv-chart"] canvas').first();
  const box = await canvas.boundingBox();
  await page.evaluate(() => {
    const state = { frames: [], longTasks: [], sampling: true, last: 0, observer: null };
    window.__chartPerfFrames = state;
    const tick = (time) => {
      if (!state.sampling) return;
      if (state.last) state.frames.push(time - state.last);
      state.last = time;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    try {
      state.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.longTasks.push(entry.duration);
      });
      state.observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // longtask is Chromium-only; frame p95 still measures.
    }
  });

  if (box) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    for (let pass = 0; pass < 2; pass += 1) {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let step = 1; step <= 6; step += 1) {
        await page.mouse.move(cx - step * 30, cy + step * 4, { steps: 2 });
      }
      await page.mouse.up();
      await page.mouse.move(cx, cy);
      await page.mouse.wheel(0, -240);
      await page.waitForTimeout(50);
      await page.mouse.wheel(0, 320);
      await page.waitForTimeout(50);
      await page.mouse.wheel(0, -120);
    }
  }

  const measured = await page.evaluate(() => {
    const state = window.__chartPerfFrames;
    state.sampling = false;
    state.observer?.disconnect();
    return { frames: state.frames, longTasks: state.longTasks };
  });
  const frames = measured.frames.slice(2);
  return {
    frame: stats(frames),
    long_tasks: {
      count: measured.longTasks.length,
      max_ms: measured.longTasks.length ? round(Math.max(...measured.longTasks)) : 0,
    },
  };
}

async function measureToggleCost(page) {
  await selectTimeframe(page, "5m");
  await openIndicators(page);
  const ids = await enabledIndicatorIds(page);
  const onSamples = [];
  const offSamples = [];
  for (let round = 0; round < RUNS; round += 1) {
    onSamples.push(await toggleAll(page, ids, true));
    offSamples.push(await toggleAll(page, ids, false));
  }
  // Leave every drawable indicator on for the heap/fullscreen stress cycle.
  await toggleAll(page, ids, true);
  await page
    .waitForFunction(
      (expected) => {
        const trigger = document.querySelector(
          '[data-testid="patterns-chart-indicators-trigger"]',
        );
        return Number(trigger?.getAttribute("data-active-count") ?? -1) === expected;
      },
      ids.length,
      { timeout: 3000 },
    )
    .catch(() => {});
  const counts = await activeCounts(page);
  await closeIndicators(page);
  return {
    enabled_rows: ids.length,
    on_ms: stats(onSamples),
    off_ms: stats(offSamples),
    active_count: counts.triggerCount,
    strip_count: counts.stripCount,
  };
}

async function heapUsed(page) {
  const memory = await page.evaluate(() => {
    const entry = performance.memory;
    return entry ? entry.usedJSHeapSize : null;
  });
  if (memory != null) return memory;
  try {
    const client = await page.context().newCDPSession(page);
    const usage = await client.send("Runtime.getHeapUsage");
    await client.detach();
    return usage.usedSize ?? null;
  } catch {
    return null;
  }
}

async function forceGc(page) {
  await page.evaluate(() => {
    if (typeof window.gc === "function") window.gc();
  }).catch(() => {});
  try {
    const client = await page.context().newCDPSession(page);
    await client.send("HeapProfiler.collectGarbage");
    await client.detach();
  } catch {
    // CDP GC is best-effort; --js-flags=--expose-gc is the primary path.
  }
  await page.waitForTimeout(150);
}

// A single CDP session is kept open across the before/after reads so the
// Performance domain stays enabled and the metric is sampled consistently.
async function openListenerMetrics(page) {
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  return client;
}

async function liveListenerCount(client) {
  const { metrics } = await client.send("Performance.getMetrics");
  const metric = metrics.find((entry) => entry.name === "JSEventListeners");
  if (!metric || !Number.isFinite(metric.value)) return null;
  return Math.round(metric.value);
}

async function measureCycles(page, budgets) {
  const listenerClient = await openListenerMetrics(page);
  try {
    await forceGc(page);
    const heapBefore = await heapUsed(page);
    const canvasesBefore = await page.locator("canvas").count();
    const listenersBefore = await liveListenerCount(listenerClient);

    const switches = budgets.measurement.cycles.timeframe_switches;
    for (let index = 0; index < switches; index += 1) {
      await selectTimeframe(page, TF_IDS[index % TF_IDS.length]);
    }

    const toggles = budgets.measurement.cycles.menu_toggles;
    for (let index = 0; index < toggles; index += 1) {
      await openIndicators(page);
      await closeIndicators(page);
    }

    const fullscreenCycles = budgets.measurement.cycles.fullscreen_cycles;
    for (let index = 0; index < fullscreenCycles; index += 1) {
      await page.locator('[data-testid="chart-expand"]').click();
      await page
        .locator('[data-testid="patterns-fullscreen-modal"]')
        .waitFor({ state: "visible", timeout: 10000 });
      await page.keyboard.press("Escape");
      await page
        .locator('[data-testid="patterns-fullscreen-modal"]')
        .waitFor({ state: "hidden", timeout: 10000 });
    }

    await page.waitForTimeout(250);
    await forceGc(page);
    const heapAfter = await heapUsed(page);
    const canvasesAfter = await page.locator("canvas").count();
    const listenersAfter = await liveListenerCount(listenerClient);

    return {
      heap_before_bytes: heapBefore,
      heap_after_bytes: heapAfter,
      heap_growth_mb:
        heapBefore == null || heapAfter == null
          ? null
          : round((heapAfter - heapBefore) / 1_000_000),
      canvas_before: canvasesBefore,
      canvas_after: canvasesAfter,
      canvas_growth: canvasesAfter - canvasesBefore,
      listeners_before: listenersBefore,
      listeners_after: listenersAfter,
      listener_growth:
        listenersBefore == null || listenersAfter == null ? null : listenersAfter - listenersBefore,
    };
  } finally {
    await listenerClient.detach().catch(() => {});
  }
}

function exceptionFor(budgets, target) {
  return (budgets.known_exceptions ?? []).find(
    (exception) => exception.target === target && Number.isFinite(Number(exception.measured_limit)),
  );
}

function pushCheck(budgets, checks, applied, target, label, measured) {
  const targetValue = Number(budgets.targets[target]);
  const stat = budgets.gate_stats?.[target] ?? "median";
  const exception = exceptionFor(budgets, target);
  let status;
  if (measured == null || !Number.isFinite(Number(measured))) {
    status = "not_measured";
  } else if (Number(measured) <= targetValue) {
    status = "pass";
  } else if (exception && Number(measured) <= Number(exception.measured_limit)) {
    status = "waived";
    if (!applied.includes(exception)) applied.push(exception);
  } else {
    status = "fail";
  }
  checks.push({
    target,
    label,
    stat,
    target_value: targetValue,
    measured: measured == null ? null : round(Number(measured)),
    status,
    exception: status === "waived" ? exception : null,
  });
}

async function runViewport(browser, fixtures, viewport, budgets, contextInfo, checks, applied) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  await installAuth(context);
  const chartBodies = await installMocks(context, fixtures);
  const page = await context.newPage();
  const result = { viewport: { width: viewport.width, height: viewport.height } };

  try {
    const routeSamples = await measureRouteLoads(context, RUNS);
    await gotoChart(page);

    const switchSamples = [];
    const perTf = Object.fromEntries(TF_IDS.map((tf) => [tf, []]));
    for (let round = 0; round < RUNS; round += 1) {
      for (const tf of TF_IDS) {
        const started = Date.now();
        await selectTimeframe(page, tf);
        const elapsed = Date.now() - started;
        switchSamples.push(elapsed);
        perTf[tf].push(elapsed);
      }
    }

    await selectTimeframe(page, "5m");
    const frame = await measureFrames(page);
    const toggle = await measureToggleCost(page);
    const heap = await measureCycles(page, budgets);

    result.route_load = stats(routeSamples);
    result.timeframe_switch = {
      overall: stats(switchSamples),
      per_timeframe: Object.fromEntries(
        Object.entries(perTf).map(([tf, samples]) => [tf, stats(samples)]),
      ),
    };
    result.pan_zoom = frame;
    result.toggle_all = toggle;
    result.heap_canvas_listeners = heap;
    result.context = contextInfo;

    pushCheck(
      budgets,
      checks,
      applied,
      "initial_route_chart_ms",
      `initial route chart @ ${viewport.name}`,
      result.route_load.median,
    );
    pushCheck(
      budgets,
      checks,
      applied,
      "timeframe_switch_ms",
      `timeframe switch median @ ${viewport.name}`,
      result.timeframe_switch.overall.median,
    );
    pushCheck(
      budgets,
      checks,
      applied,
      "pan_zoom_frame_p95_ms",
      `pan/zoom frame p95 @ ${viewport.name}`,
      result.pan_zoom.frame.p95,
    );
    pushCheck(
      budgets,
      checks,
      applied,
      "long_task_max_ms",
      `long task max @ ${viewport.name}`,
      result.pan_zoom.long_tasks.max_ms,
    );
    pushCheck(
      budgets,
      checks,
      applied,
      "heap_growth_after_cycles_mb",
      `heap growth after cycles @ ${viewport.name}`,
      result.heap_canvas_listeners.heap_growth_mb,
    );
    pushCheck(
      budgets,
      checks,
      applied,
      "canvas_count_growth_max",
      `canvas count growth @ ${viewport.name}`,
      result.heap_canvas_listeners.canvas_growth,
    );
    pushCheck(
      budgets,
      checks,
      applied,
      "listener_count_growth_max",
      `listener count growth @ ${viewport.name}`,
      result.heap_canvas_listeners.listener_growth,
    );
    pushCheck(
      budgets,
      checks,
      applied,
      "toggle_all_ms",
      `toggle all on/off median @ ${viewport.name}`,
      Math.max(result.toggle_all.on_ms.median ?? 0, result.toggle_all.off_ms.median ?? 0),
    );
  } finally {
    await context.close();
  }

  return { result, chartBodies };
}

function payloadMeasurements(chartBodies) {
  const rows = {};
  let payloadTf = null;
  for (const tf of TF_IDS) {
    const body = chartBodies[tf];
    if (!body) continue;
    const parsed = JSON.parse(body);
    const extras = JSON.stringify({
      indicators: parsed.indicators ?? null,
      sr_zones: parsed.sr_zones ?? [],
    });
    const raw = Buffer.from(extras, "utf8");
    const row = {
      bars: parsed.candles?.length ?? 0,
      indicator_raw_bytes: raw.length,
      indicator_gzip_bytes: gzipSync(raw).length,
      chart_raw_bytes: Buffer.byteLength(body, "utf8"),
      chart_gzip_bytes: gzipSync(Buffer.from(body, "utf8")).length,
    };
    rows[tf] = row;
    if (!payloadTf && row.bars >= 500) payloadTf = tf;
  }
  return { rows, payloadTf };
}

async function main() {
  const cpu = await preflight();
  const { budgets, fixtures, manifest } = loadInputs();
  const browser = await chromium.launch({
    headless: !HEADED,
    args: [
      "--enable-precise-memory-info",
      "--js-flags=--expose-gc",
    ],
  });
  const checks = [];
  const applied = [];
  const result = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    harness: "scripts/perf/chart_perf.mjs",
    base_url: BASE_URL,
    fixtures_dir: FIXTURES_DIR,
    fixture: {
      symbol: fixtures.symbol,
      as_of: fixtures.as_of,
      bars_requested: fixtures.bars_requested,
      timeframes: Object.keys(fixtures.timeframes),
    },
    budgets: {
      file: "perf/chart_ui_budgets.json",
      schema_version: budgets.schema_version,
      status: budgets.status,
      targets: budgets.targets,
    },
    environment: {
      codespaces: Boolean(process.env.CODESPACES),
      platform: os.platform(),
      release: os.release(),
      cpu: os.cpus()[0]?.model ?? "unknown",
      cpu_count: cpu.cpus,
      load1: round(cpu.load1),
      contended: cpu.contended,
      total_memory_gb: round(os.totalmem() / 1_000_000_000),
      node: process.version,
      browser: browser.version(),
      runs: RUNS,
    },
    measurements: {},
    checks,
    known_exceptions_applied: applied,
  };

  try {
    const perViewport = {};
    let chartBodies = {};
    for (const viewport of VIEWPORTS) {
      const measured = await runViewport(
        browser,
        fixtures,
        viewport,
        budgets,
        result.environment,
        checks,
        applied,
      );
      perViewport[viewport.name] = measured.result;
      chartBodies = { ...chartBodies, ...measured.chartBodies };
    }
    result.measurements.per_viewport = perViewport;

    const payload = payloadMeasurements(chartBodies);
    result.measurements.payload = payload;
    const payloadRow = payload.payloadTf ? payload.rows[payload.payloadTf] : null;
    pushCheck(
      budgets,
      checks,
      applied,
      "indicator_payload_raw_bytes",
      `indicator payload raw (${payload.payloadTf ?? "no 500-bar TF"})`,
      payloadRow?.indicator_raw_bytes ?? null,
    );
    pushCheck(
      budgets,
      checks,
      applied,
      "indicator_payload_gzip_bytes",
      `indicator payload gzip (${payload.payloadTf ?? "no 500-bar TF"})`,
      payloadRow?.indicator_gzip_bytes ?? null,
    );

    const backend = {};
    if (manifest?.timeframes) {
      for (const tf of TF_IDS) {
        backend[tf] = manifest.timeframes[tf]?.indicator_ms ?? null;
      }
    }
    result.measurements.backend_indicator_zones = backend;
    const backendValues = Object.values(backend)
      .map((entry) => (entry ? Number(entry.p95_ms) : null))
      .filter((value) => Number.isFinite(value));
    pushCheck(
      budgets,
      checks,
      applied,
      "backend_indicator_zones_p95_ms",
      "backend indicator+zones p95 (max TF)",
      backendValues.length === TF_IDS.length ? Math.max(...backendValues) : null,
    );
  } finally {
    await browser.close();
  }

  const blockers = checks.filter(
    (check) => check.status === "fail" || check.status === "not_measured",
  );
  result.verdict = blockers.length ? "blocked" : "pass";
  mkdirSync(dirname(RESULTS_PATH), { recursive: true });
  writeFileSync(RESULTS_PATH, `${JSON.stringify(result, null, 2)}\n`);

  for (const check of checks) {
    const measured = check.measured == null ? "n/a" : `${check.measured}`;
    console.log(
      `${check.status.toUpperCase().padEnd(11)} ${check.label}: ${measured} ` +
        `(${check.stat} target ${check.target_value})`,
    );
  }
  console.log(
    `chart perf: ${result.verdict.toUpperCase()} — ${checks.length} checks, ` +
      `${blockers.length} blocker(s); results ${RESULTS_PATH}`,
  );
  if (applied.length) {
    console.log(`applied ${applied.length} known exception(s); see chart_ui_budgets.json`);
  }
  if (REPORT_ONLY) {
    console.log("--report: exiting 0 despite blockers");
    process.exit(0);
  }
  process.exit(blockers.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
