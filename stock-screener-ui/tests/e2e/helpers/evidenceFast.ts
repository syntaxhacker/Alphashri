import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type ViewportSize,
} from "@playwright/test";

const CONTEXTS = new WeakMap<Browser, Map<string, Promise<BrowserContext>>>();
const TRACKED_BROWSERS = new Set<Browser>();

const NOISE_HOSTS = [
  "sentry.io",
  "google-analytics.com",
  "googletagmanager.com",
  "plausible.io",
  "segment.io",
  "mixpanel.com",
];

function isNoiseHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return NOISE_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function isNoiseUrl(url: URL): boolean {
  if (url.protocol === "ws:" || url.protocol === "wss:") {
    return url.pathname.startsWith("/ws/") || url.pathname === "/ws" || isNoiseHost(url.hostname);
  }
  // Only /ws/** and third-party telemetry hosts are dropped; /api/** and font
  // hosts must still load or the captured frame would not be truthful.
  return isNoiseHost(url.hostname) || url.pathname.startsWith("/ws/");
}

export async function createEvidenceContext(
  browser: Browser,
  viewport: ViewportSize,
): Promise<BrowserContext> {
  let byViewport = CONTEXTS.get(browser);
  if (!byViewport) {
    byViewport = new Map();
    CONTEXTS.set(browser, byViewport);
    TRACKED_BROWSERS.add(browser);
  }
  const key = `${viewport.width}x${viewport.height}`;
  let pending = byViewport.get(key);
  if (!pending) {
    // Store the promise before awaiting it: fullyParallel callers in one worker
    // must share the in-flight creation instead of opening two contexts.
    pending = browser.newContext({ viewport });
    byViewport.set(key, pending);
  }
  return pending;
}

export async function closeEvidenceContexts(browser?: Browser): Promise<void> {
  const targets = browser ? [browser] : [...TRACKED_BROWSERS];
  await Promise.all(
    targets.map(async (target) => {
      const byViewport = CONTEXTS.get(target);
      CONTEXTS.delete(target);
      TRACKED_BROWSERS.delete(target);
      if (!byViewport) return;
      await Promise.all(
        [...byViewport.values()].map(async (pending) => (await pending).close()),
      );
    }),
  );
}

export async function withEvidencePage<T>(
  context: BrowserContext,
  run: (page: Page) => Promise<T>,
): Promise<T> {
  const page = await context.newPage();
  try {
    await blockCaptureNoise(page);
    return await run(page);
  } finally {
    await page.close();
  }
}

export async function blockCaptureNoise(page: Page): Promise<void> {
  await page.route(isNoiseUrl, (route) => route.abort());
  // page.route does not see the WebSocket handshake; routeWebSocket does.
  await page.routeWebSocket(isNoiseUrl, (ws) => ws.close());
}

export interface WaitForSettledOptions {
  timeout?: number;
}

export async function waitForSettled(
  page: Page,
  selector: string,
  options: WaitForSettledOptions = {},
): Promise<void> {
  const timeout = options.timeout ?? 20_000;
  await expect(page.locator(selector).first()).toBeVisible({ timeout });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  // Two frames let chart/canvas paint and sticky layout settle without the
  // 500 ms silence window (or the never-idle news socket) of networkidle.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}
