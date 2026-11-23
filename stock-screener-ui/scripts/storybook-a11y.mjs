#!/usr/bin/env node
/**
 * Real-browser accessibility gate for the static Storybook build.
 *
 * Runs axe-core (WCAG 2.1 A/AA) inside Storybook's preview iframe for all 13
 * family landings, the overlay playables and representative component states,
 * and fails the process on serious/critical violations. It starts and stops
 * its own static HTTP server, so it is safe to
 * run as `node scripts/storybook-a11y.mjs` in CI without any external setup.
 *
 * NOTE: This script only owns its own file. It never modifies the build, the
 * components, or any config.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, '..');
const STATIC_DIR = path.join(PROJECT_ROOT, 'storybook-static');
const INDEX_PATH = path.join(STATIC_DIR, 'index.json');
const AXE_PATH = path.join(PROJECT_ROOT, 'node_modules', 'axe-core', 'axe.min.js');

// Use a non-conflicting port; override with A11Y_PORT if ever needed.
const PORT = Number(process.env.A11Y_PORT || 6123);
const BASE_URL = `http://127.0.0.1:${PORT}`;

// WCAG 2.0 A/AA are included because WCAG 2.1 A/AA subsumes them.
const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const FAILING_IMPACTS = new Set(['serious', 'critical']);

/**
 * Stories are identified by Storybook title + story name. The actual story id
 * is resolved from index.json at runtime (never guessed here). The 13 family
 * landings give every family a browser-audited entry point; the playables add
 * the overlay primitives that only exist in a live interaction state.
 */
const LANDINGS = [
  { label: 'Overview', title: 'Design System/Overview', name: 'Overview' },
  { label: 'App primitives/Family landing', title: 'Design System/App primitives', name: 'Family Landing' },
  { label: 'Data display/Family landing', title: 'Design System/Data display', name: 'Family Landing' },
  { label: 'Feedback/Family landing', title: 'Design System/Feedback', name: 'Family Landing' },
  { label: 'Foundations/Landing', title: 'Design System/Foundations', name: 'Landing' },
  { label: 'Inputs/Landing', title: 'Design System/Inputs', name: 'Landing' },
  { label: 'Layout/Landing', title: 'Design System/Layout', name: 'Landing' },
  { label: 'Misc/Family landing', title: 'Design System/Misc', name: 'Family Landing' },
  { label: 'Navigation/Family landing', title: 'Design System/Navigation', name: 'Family Landing' },
  { label: 'Overlay/Family landing', title: 'Design System/Overlay', name: 'Family Landing' },
  { label: 'Portal/Family landing', title: 'Design System/Portal', name: 'Family Landing' },
  { label: 'Shared primitives/Family landing', title: 'Design System/Shared primitives', name: 'Family Landing' },
  { label: 'Typography/Landing', title: 'Design System/Typography', name: 'Landing' },
];

const OVERLAY_PLAYABLES = [
  {
    label: 'Overlay/Popover (playable)',
    title: 'Design System/Components/Overlay/Popover',
    name: 'Playground',
  },
  {
    label: 'Overlay/Tooltip (playable)',
    title: 'Design System/Components/Overlay/Tooltip',
    name: 'Playground',
  },
  {
    label: 'Overlay/FloatingWindow (playable)',
    title: 'Design System/Components/Overlay/FloatingWindow',
    name: 'Geometry And Resize',
  },
];

// Kept from the original six to retain representative coverage inside families.
const COMPONENT_REPRESENTATIVES = [
  {
    label: 'App/TanStackTable',
    title: 'Design System/Components/App/TanStackTable',
    name: 'Normal',
  },
  {
    label: 'Feedback/Loader',
    title: 'Design System/Components/Feedback/Loader',
    name: 'Playground',
  },
  {
    label: 'Inputs/Select',
    title: 'Design System/Components/Inputs/Select',
    name: 'Playground',
  },
  {
    label: 'Overlay/Modal (open state)',
    title: 'Design System/Components/Overlay/Modal',
    name: 'Open Dialog',
  },
  {
    label: 'DataDisplay/Tree',
    title: 'Design System/Components/Data display/Tree',
    name: 'Playground',
  },
];

const REPRESENTATIVES = [...LANDINGS, ...OVERLAY_PLAYABLES, ...COMPONENT_REPRESENTATIVES];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const norm = (value) => String(value ?? '').trim().toLowerCase();

// ---------------------------------------------------------------------------
// Skip / preflight
// ---------------------------------------------------------------------------

if (!existsSync(INDEX_PATH)) {
  console.log(
    '[storybook-a11y] SKIP: storybook-static/index.json is absent — no static ' +
      'Storybook build to audit. Run `npm run build-storybook` to enable this gate.',
  );
  process.exit(0);
}

if (!existsSync(AXE_PATH)) {
  console.error(
    `[storybook-a11y] FAIL: axe-core is not installed (expected ${AXE_PATH}). ` +
      'The gate cannot run without the existing axe-core dependency.',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Resolve representative story ids from index.json by title + name
// ---------------------------------------------------------------------------

function resolveStories() {
  let index;
  try {
    index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
  } catch (error) {
    console.error(`[storybook-a11y] FAIL: cannot parse ${INDEX_PATH}: ${error.message}`);
    process.exit(1);
  }

  const entries = Object.values(index?.entries ?? {}).filter(
    (entry) => entry?.type === 'story',
  );

  const missing = [];
  const resolved = REPRESENTATIVES.map((spec) => {
    const match = entries.find(
      (entry) =>
        norm(entry.title) === norm(spec.title) && norm(entry.name) === norm(spec.name),
    );
    if (!match) {
      const sameTitle = entries
        .filter((entry) => norm(entry.title) === norm(spec.title))
        .map((entry) => entry.name);
      missing.push(
        `  - ${spec.label}: no story with title="${spec.title}" name="${spec.name}"` +
          (sameTitle.length ? ` (available names: ${sameTitle.join(', ')})` : ' (title not found)'),
      );
      return null;
    }
    return { ...spec, id: match.id };
  });

  if (missing.length) {
    console.error(
      '[storybook-a11y] FAIL: index.json exists but required representative stories are missing:',
    );
    console.error(missing.join('\n'));
    process.exit(1);
  }

  return resolved;
}

const STORIES = resolveStories();
const AXE_SOURCE = readFileSync(AXE_PATH, 'utf8');

// ---------------------------------------------------------------------------
// Static server lifecycle
// ---------------------------------------------------------------------------

let serverProcess = null;

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'python3',
      ['-m', 'http.server', String(PORT), '-d', 'storybook-static'],
      { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    serverProcess = child;

    let stderr = '';
    child.stdout.on('data', () => {}); // drain
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(child);
    };

    child.once('error', (error) => finish(error));
    child.once('exit', (code, signal) =>
      finish(
        new Error(
          `Static server exited early (code=${code}, signal=${signal}): ${stderr.trim()}`,
        ),
      ),
    );

    const deadline = Date.now() + 15_000;
    const poll = setInterval(async () => {
      if (Date.now() > deadline) return;
      try {
        const response = await fetch(`${BASE_URL}/index.json`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) finish();
      } catch {
        // Server not up yet — keep probing.
      }
    }, 200);
    const timeout = setTimeout(
      () =>
        finish(
          new Error(
            `Timed out waiting for static server at ${BASE_URL}. ${stderr.trim()}`.trim(),
          ),
        ),
      16_000,
    );
    // Probe immediately as well.
    (async () => {
      try {
        const response = await fetch(`${BASE_URL}/index.json`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) finish();
      } catch {
        // handled by polling loop
      }
    })();
  });
}

function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    let forceTimer;
    let killTimer;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      clearTimeout(forceTimer);
      resolve();
    };
    killTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
    forceTimer = setTimeout(done, 4500);
    child.once('exit', done);
    child.kill('SIGTERM');
  });
}

// ---------------------------------------------------------------------------
// Browser audit
// ---------------------------------------------------------------------------

async function openStoryFrame(page, storyId) {
  await page.goto(`${BASE_URL}/?path=/story/${storyId}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  const iframeHandle = await page.waitForSelector('#storybook-preview-iframe', {
    timeout: 30_000,
  });
  const frame = await iframeHandle.contentFrame();
  if (!frame) throw new Error('Storybook preview iframe has no content frame');

  // Wait until the story has actually rendered into the preview root.
  await frame.waitForFunction(
    () => {
      const root = document.querySelector('#storybook-root');
      return Boolean(root && root.children.length > 0);
    },
    null,
    { timeout: 30_000 },
  );
  // Give async stories / animations a moment to settle before auditing.
  await page.waitForTimeout(300);
  return frame;
}

async function auditFrame(frame) {
  // Inject the installed axe-core build into the preview iframe itself.
  await frame.addScriptTag({ content: AXE_SOURCE });
  return frame.evaluate(async (tags) => {
    if (!window.axe || typeof window.axe.run !== 'function') {
      throw new Error('axe-core did not initialise inside the preview iframe');
    }
    const results = await window.axe.run(document, {
      runOnly: { type: 'tag', values: tags },
    });
    return {
      counts: {
        passes: results.passes.length,
        violations: results.violations.length,
        incomplete: results.incomplete.length,
        inapplicable: results.inapplicable.length,
      },
      violations: results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        helpUrl: violation.helpUrl,
        affectedNodes: violation.nodes.length,
        targets: violation.nodes.map((node) => node.target),
      })),
    };
  }, A11Y_TAGS);
}

function formatTargets(targets) {
  if (!Array.isArray(targets) || targets.length === 0) return '  (none)';
  return targets
    .slice(0, 10)
    .map((target) => `    - ${JSON.stringify(target)}`)
    .join('\n');
}

async function main() {
  console.log(
    `[storybook-a11y] Serving ${path.relative(PROJECT_ROOT, STATIC_DIR)} at ${BASE_URL} ` +
      `on port ${PORT}.`,
  );
  console.log(`[storybook-a11y] Resolved ${STORIES.length} representative stories:`);
  for (const story of STORIES) console.log(`  - ${story.label}: ${story.id}`);

  await startServer();

  let browser;
  try {
    browser = await chromium.launch({ headless: true });

    let totalRules = 0;
    let totalViolations = 0;
    let blockingViolations = 0;
    const errors = [];

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    for (const story of STORIES) {
      console.log(`\n[storybook-a11y] Auditing ${story.label} (${story.id}) ...`);
      try {
        const frame = await openStoryFrame(page, story.id);
        const { counts, violations } = await auditFrame(frame);
        const ruleCount =
          counts.passes + counts.violations + counts.incomplete + counts.inapplicable;
        totalRules += ruleCount;
        totalViolations += violations.length;

        const blockingHere = violations.filter((v) => FAILING_IMPACTS.has(v.impact));
        blockingViolations += blockingHere.length;

        console.log(
          `[storybook-a11y]   axe rules evaluated: ${ruleCount} ` +
            `(passes=${counts.passes}, violations=${counts.violations}, ` +
            `incomplete=${counts.incomplete}, inapplicable=${counts.inapplicable})`,
        );

        if (violations.length === 0) {
          console.log('[storybook-a11y]   No violations.');
          continue;
        }

        for (const violation of violations) {
          const marker = FAILING_IMPACTS.has(violation.impact) ? 'BLOCKING' : 'non-blocking';
          console.log(
            `[storybook-a11y]   ${marker} violation: ${violation.id} ` +
              `[impact=${violation.impact ?? 'n/a'}, nodes=${violation.affectedNodes}]`,
          );
          console.log(`    help: ${violation.help}`);
          console.log(`    helpUrl: ${violation.helpUrl}`);
          console.log('    targets:');
          console.log(formatTargets(violation.targets));
        }
      } catch (error) {
        errors.push(`${story.label} (${story.id}): ${error.message}`);
        console.error(`[storybook-a11y]   ERROR auditing ${story.id}: ${error.message}`);
      }
    }

    await context.close();

    console.log('\n[storybook-a11y] ===== SUMMARY =====');
    console.log(`[storybook-a11y] Stories audited: ${STORIES.length}`);
    console.log(`[storybook-a11y] Total axe rules evaluated: ${totalRules}`);
    console.log(`[storybook-a11y] Total violations: ${totalViolations}`);
    console.log(
      `[storybook-a11y] Serious/critical (blocking) violations: ${blockingViolations}`,
    );
    console.log(`[storybook-a11y] Audit errors: ${errors.length}`);

    if (errors.length) {
      console.error('[storybook-a11y] Audit errors:');
      for (const error of errors) console.error(`  - ${error}`);
    }

    if (errors.length || blockingViolations > 0) {
      console.error('[storybook-a11y] FAIL: accessibility gate did not pass.');
      process.exitCode = 1;
    } else {
      console.log('[storybook-a11y] PASS: accessibility gate passed.');
    }
  } catch (error) {
    console.error(`[storybook-a11y] FAIL: ${error.message}`);
    if (/executable doesn't exist|browserType\.launch|Failed to launch/i.test(error.message)) {
      console.error(
        '[storybook-a11y] The Chromium browser required by the installed Playwright ' +
          'package was not found. Install it once with `npx playwright install chromium` ' +
          '(this gate itself never downloads a browser).',
      );
    }
    process.exitCode = 1;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // best effort
      }
    }
    await stopServer(serverProcess);
    console.log('[storybook-a11y] Static server stopped.');
  }
}

let cleaningUp = false;
async function cleanupOnSignal(signal) {
  if (cleaningUp) return;
  cleaningUp = true;
  console.log(`\n[storybook-a11y] Received ${signal}; cleaning up ...`);
  await stopServer(serverProcess);
  process.exit(signal === 'SIGINT' ? 130 : 143);
}
process.once('SIGINT', () => cleanupOnSignal('SIGINT'));
process.once('SIGTERM', () => cleanupOnSignal('SIGTERM'));

main();
