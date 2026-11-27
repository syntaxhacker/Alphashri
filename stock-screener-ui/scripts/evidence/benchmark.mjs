#!/usr/bin/env node
/**
 * Sector evidence capture micro-benchmarks. Nothing is written: screenshots are
 * taken into memory only where a timing needs the real paint cost.
 *
 *   node scripts/evidence/benchmark.mjs
 *
 * Env: EVIDENCE_BASE_URL (default http://127.0.0.1:5173),
 *      EVIDENCE_BENCH_ITERATIONS (context micro, default 10),
 *      EVIDENCE_NAV_ITERATIONS (navigation variants, default 3),
 *      EVIDENCE_BEFORE_MS / EVIDENCE_AFTER_MS (wall time supplied by the caller
 *      from the real `SCREENSHOT_EVIDENCE=1 ... -g ...` command).
 */
import process from "node:process";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";

const BASE = process.env.EVIDENCE_BASE_URL ?? "http://127.0.0.1:5173";
const API_BASE = process.env.EVIDENCE_API_BASE ?? "http://127.0.0.1:8765";
const QA_EMAIL = process.env.EVIDENCE_QA_EMAIL ?? "qa@test.com";
const QA_PASSWORD = process.env.EVIDENCE_QA_PASSWORD ?? "";
const ITERATIONS = Number(process.env.EVIDENCE_BENCH_ITERATIONS ?? 10);
const NAV_ITERATIONS = Number(process.env.EVIDENCE_NAV_ITERATIONS ?? 3);
const VIEWPORT = { width: 1600, height: 1000 };

const NOISE_HOSTS = [
  "sentry.io",
  "google-analytics.com",
  "googletagmanager.com",
  "plausible.io",
  "segment.io",
  "mixpanel.com",
];

function isNoiseUrl(url) {
  const host = url.hostname.toLowerCase();
  const noiseHost = NOISE_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  return noiseHost || url.pathname.startsWith("/ws/") || url.pathname === "/ws";
}

async function blockNoiseOn(target) {
  await target.route(isNoiseUrl, (route) => route.abort());
  await target.routeWebSocket(isNoiseUrl, (ws) => ws.close());
}

async function seedAuth(context) {
  const login = await context.request.post(`${API_BASE}/api/auth/login`, {
    data: { email: QA_EMAIL, password: QA_PASSWORD },
  });
  if (!QA_PASSWORD) throw new Error("set EVIDENCE_QA_PASSWORD to run the benchmark");
  if (!login.ok()) throw new Error(`benchmark login failed (${login.status()})`);
  const credentials = await login.json();
  const me = await context.request.get(`${API_BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${credentials.access_token}` },
  });
  if (!me.ok()) throw new Error(`benchmark /auth/me failed (${me.status()})`);
  await context.addInitScript((session) => {
    localStorage.setItem("alphashri_token", session.token);
    localStorage.setItem("alphashri_refresh_token", session.refreshToken);
    localStorage.setItem("alphashri_user", JSON.stringify(session.user));
  }, {
    token: credentials.access_token,
    refreshToken: credentials.refresh_token,
    user: await me.json(),
  });
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    n: sorted.length,
    totalMs: Math.round(sum),
    avgMs: Math.round((sum / sorted.length) * 10) / 10,
    medianMs: Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10,
    minMs: Math.round(sorted[0] * 10) / 10,
    maxMs: Math.round(sorted[sorted.length - 1] * 10) / 10,
  };
}

async function benchContexts(browser) {
  const perState = [];
  for (let i = 0; i < ITERATIONS; i += 1) {
    const start = performance.now();
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    await page.goto("about:blank");
    await page.close();
    await context.close();
    perState.push(performance.now() - start);
  }

  const shared = [];
  const oneContext = await browser.newContext({ viewport: VIEWPORT });
  for (let i = 0; i < ITERATIONS; i += 1) {
    const start = performance.now();
    const page = await oneContext.newPage();
    await page.goto("about:blank");
    await page.close();
    shared.push(performance.now() - start);
  }
  await oneContext.close();

  const before = stats(perState);
  const after = stats(shared);
  return {
    perStateContext: before,
    oneContextPerViewport: after,
    savedMsPerFrame: Math.round((before.avgMs - after.avgMs) * 10) / 10,
  };
}

async function deterministicWait(page) {
  await page.waitForSelector('[data-testid="sector-summary-strip"]', { timeout: 20_000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function benchWaits(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  await seedAuth(context);
  await blockNoiseOn(context);
  const warmup = await context.newPage();
  await warmup.goto(`${BASE}/sector`, { waitUntil: "domcontentloaded" });
  await warmup
    .waitForSelector('[data-testid="sector-summary-strip"]', { timeout: 20_000 })
    .catch(() => {});
  await warmup.close();

  const networkidle = [];
  const settled = [];
  let timeouts = 0;
  for (let i = 0; i < NAV_ITERATIONS; i += 1) {
    for (const variant of ["networkidle", "deterministic"]) {
      const page = await context.newPage();
      const start = performance.now();
      try {
        await page.goto(`${BASE}/sector`, { waitUntil: "domcontentloaded" });
        if (variant === "networkidle") {
          await page.waitForLoadState("networkidle", { timeout: 20_000 });
        } else {
          await deterministicWait(page);
        }
      } catch {
        timeouts += 1;
      }
      const elapsed = performance.now() - start;
      (variant === "networkidle" ? networkidle : settled).push(elapsed);
      await page.close();
    }
  }
  await context.close();
  const before = stats(networkidle);
  const after = stats(settled);
  return {
    networkidle: before,
    waitForSettled: after,
    savedMsPerFrame: Math.round((before.avgMs - after.avgMs) * 10) / 10,
    timeouts,
  };
}

async function benchNoise(browser) {
  const result = {};
  for (const blocked of [false, true]) {
    const context = await browser.newContext({ viewport: VIEWPORT });
    await seedAuth(context);
    const samples = [];
    let misses = 0;
    for (let i = 0; i < NAV_ITERATIONS; i += 1) {
      const page = await context.newPage();
      if (blocked) await blockNoiseOn(page);
      const start = performance.now();
      await page.goto(`${BASE}/sector`, { waitUntil: "domcontentloaded" });
      try {
        await page.waitForSelector('[data-testid="sector-analysis-view"]', { timeout: 20_000 });
      } catch {
        misses += 1;
      }
      samples.push(performance.now() - start);
      await page.close();
    }
    await context.close();
    result[blocked ? "blocked" : "unblocked"] = { ...stats(samples), misses };
  }
  result.savedMsPerFrame =
    Math.round((result.unblocked.avgMs - result.blocked.avgMs) * 10) / 10;
  return result;
}

const report = {
  baseUrl: BASE,
  captureWall: {
    beforeMs: process.env.EVIDENCE_BEFORE_MS ? Number(process.env.EVIDENCE_BEFORE_MS) : null,
    afterMs: process.env.EVIDENCE_AFTER_MS ? Number(process.env.EVIDENCE_AFTER_MS) : null,
  },
};

const browser = await chromium.launch({ headless: true });
try {
  report.contexts = await benchContexts(browser);
  report.waits = await benchWaits(browser);
  report.noise = await benchNoise(browser);
} catch (error) {
  report.error = String(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
