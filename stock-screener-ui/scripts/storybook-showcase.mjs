#!/usr/bin/env node
/**
 * Capture the checked-in Storybook showcase at 1600 and 390.
 * Starts its own static server against storybook-static/; no dev server.
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const OUT = join(ROOT, "docs/screenshots/showcase");
const PORT = 6131;
const BASE = `http://127.0.0.1:${PORT}`;

const SHOTS = {
  overview: "design-system-overview--overview",
  foundations: "design-system-foundations--landing",
  typography: "design-system-typography--landing",
  layout: "design-system-layout--landing",
  inputs: "design-system-inputs--landing",
  feedback: "design-system-feedback--family-landing",
  "data-display": "design-system-data-display--family-landing",
  overlay: "design-system-overlay--family-landing",
  navigation: "design-system-navigation--family-landing",
  "app-primitives": "app-overview--family-landing",
  "shared-primitives": "app-shared-widgets--family-landing",
  misc: "design-system-misc--family-landing",
  portal: "design-system-portal--family-landing",
  select: "design-system-components-inputs-select--playground",
  buttons: "design-system-components-inputs-button--playground",
  grid: "design-system-components-layout-grid--playground",
  keyvalue: "app-components-keyvalue--playground",
  loader: "design-system-components-feedback-loader--playground",
  alerts: "design-system-components-feedback-alert--variants-and-radius",
  skeleton: "design-system-components-feedback-skeleton--playground",
  table: "app-overview--family-landing",
  notifications: "design-system-components-feedback-notifications--tones",
  "result-empty": "design-system-data-display--result-states-empty",
  "result-scanning": "design-system-data-display--result-states-scanning",
  "result-feed-error": "design-system-data-display--result-states-feed-error",
};

const server = spawn("python3", ["-m", "http.server", String(PORT), "-d", "storybook-static"], {
  cwd: ROOT,
  stdio: "ignore",
});

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/index.json`);
      if (res.ok) return;
    } catch {
      // server still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Storybook static server did not become ready");
}

try {
  await mkdir(OUT, { recursive: true });
  await waitForServer();
  const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
  try {
    for (const [width, height] of [
      [1600, 1000],
      [390, 844],
    ]) {
      const page = await browser.newPage({ viewport: { width, height } });
      for (const [name, id] of Object.entries(SHOTS)) {
        await page.goto(`${BASE}/iframe.html?id=${id}&viewMode=story`, {
          waitUntil: "networkidle",
        });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(250);
        const file = join(OUT, `${name}-${width}.png`);
        await page.screenshot({ path: file, fullPage: true });
        console.log(`${name}-${width}.png`);
      }
      await page.close();
    }

    for (const [width, height] of [
      [1600, 1000],
      [390, 844],
    ]) {
      const focusPage = await browser.newPage({ viewport: { width, height } });
      await focusPage.goto(
        `${BASE}/iframe.html?id=design-system-foundations--landing&viewMode=story`,
        { waitUntil: "networkidle" },
      );
      await focusPage.getByRole("button", { name: "Tab to focus" }).focus();
      await focusPage.waitForTimeout(150);
      await focusPage.screenshot({ path: join(OUT, `focus-ring-${width}.png`), fullPage: false });
      console.log(`focus-ring-${width}.png`);
      await focusPage.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
  setTimeout(() => server.kill("SIGKILL"), 2000).unref();
}
