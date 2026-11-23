#!/usr/bin/env node
/**
 * Real-browser keyboard walkthrough gate for the static Storybook build.
 *
 * Drives the preview iframe with Playwright's keyboard and asserts the keyboard
 * contracts of four design-system widgets (Modal, Tree, Menu, Tabs). Story ids
 * are resolved from index.json by title + name, never guessed. The script owns
 * and cleans up its own static HTTP server, so it is safe to run as
 * `node scripts/storybook-keyboard.mjs` without any external setup.
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

// Use a non-conflicting port; override with KEYBOARD_PORT if ever needed.
const PORT = Number(process.env.KEYBOARD_PORT || 6124);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const REQUIRED_STORIES = [
  {
    key: 'modalOpen',
    label: 'Modal open dialog — Tab cycles within, Shift+Tab wraps',
    title: 'Design System/Components/Overlay/Modal',
    name: 'Open Dialog',
  },
  {
    key: 'modalClose',
    label: 'Modal dismissal — Escape closes, focus returns to opener',
    title: 'Design System/Components/Overlay/Modal',
    name: 'Close Behavior',
  },
  {
    key: 'tree',
    label: 'Tree — ArrowDown roving focus, ArrowRight/Left expand/collapse, Enter selects',
    title: 'Design System/Components/Data display/Tree',
    name: 'Playground',
  },
  {
    key: 'menu',
    label: 'Menu — ArrowDown/Home/End move enabled items, Escape closes',
    title: 'Design System/Components/Data display/Menu',
    name: 'Disabled And Danger',
  },
  {
    key: 'tabs',
    label: 'Tabs — ArrowRight/Left move selected tab',
    title: 'Design System/Components/Data display/Tabs',
    name: 'Playground',
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const norm = (value) => String(value ?? '').trim().toLowerCase();

function fail(message) {
  console.error(`[storybook-keyboard] FAIL: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Skip / preflight
// ---------------------------------------------------------------------------

if (!existsSync(INDEX_PATH)) {
  console.log(
    '[storybook-keyboard] SKIP: storybook-static/index.json is absent — no static ' +
      'Storybook build to walk through. Run `npm run build-storybook` to enable this gate.',
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Resolve story ids from index.json by title + name
// ---------------------------------------------------------------------------

function resolveStories() {
  let index;
  try {
    index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
  } catch (error) {
    fail(`cannot parse ${INDEX_PATH}: ${error.message}`);
  }

  const entries = Object.values(index?.entries ?? {}).filter(
    (entry) => entry?.type === 'story',
  );

  const missing = [];
  const resolved = REQUIRED_STORIES.map((spec) => {
    const match = entries.find(
      (entry) =>
        norm(entry.title) === norm(spec.title) && norm(entry.name) === norm(spec.name),
    );
    if (!match) {
      const sameTitle = entries
        .filter((entry) => norm(entry.title) === norm(spec.title))
        .map((entry) => entry.name);
      missing.push(
        `  - ${spec.key}: no story with title="${spec.title}" name="${spec.name}"` +
          (sameTitle.length ? ` (available names: ${sameTitle.join(', ')})` : ' (title not found)'),
      );
      return null;
    }
    return { ...spec, id: match.id };
  });

  if (missing.length) {
    console.error(
      '[storybook-keyboard] FAIL: index.json exists but required stories are missing:',
    );
    console.error(missing.join('\n'));
    process.exit(1);
  }
  return resolved;
}

const STORIES = resolveStories();
const STORY_BY_KEY = Object.fromEntries(STORIES.map((story) => [story.key, story]));

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
    const probe = async () => {
      try {
        const response = await fetch(`${BASE_URL}/index.json`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) finish();
      } catch {
        // Server not up yet — keep probing.
      }
    };
    const poll = setInterval(() => {
      if (Date.now() <= deadline) probe();
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
    probe();
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
// Browser helpers
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
  await frame.waitForFunction(
    () => {
      const root = document.querySelector('#storybook-root');
      return Boolean(root && root.children.length > 0);
    },
    null,
    { timeout: 30_000 },
  );
  await sleep(300);
  return frame;
}

// Keyboard is page-level in Playwright: press() targets the focused element
// even when that element lives inside the preview iframe.
function activeInfo(frame) {
  return frame.evaluate(() => {
    const el = document.activeElement;
    if (!el) return { label: '', role: null, tag: '', inDialog: false };
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
    return {
      label: el.getAttribute('aria-label') || text || el.tagName,
      role: el.getAttribute('role'),
      tag: el.tagName,
      inDialog: Boolean(el.closest?.('[role="dialog"]')),
    };
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------------------
// Walkthroughs
// ---------------------------------------------------------------------------

async function checkModalTabCycle(page, storyId) {
  const frame = await openStoryFrame(page, storyId);
  assert(
    (await frame.locator('[role="dialog"]').count()) === 1,
    'expected exactly one open dialog in the Open Dialog story',
  );

  const labels = await frame.evaluate(() =>
    Array.from(document.querySelectorAll('[role="dialog"] button')).map(
      (b) => b.getAttribute('aria-label') || (b.textContent ?? '').trim(),
    ),
  );
  assert(
    labels.length >= 2,
    `expected at least two focusable buttons in the dialog, found [${labels.join(', ')}]`,
  );

  const initial = await activeInfo(frame);
  assert(
    initial.role === 'dialog',
    `initial focus should be on the dialog itself, got role=${initial.role} label="${initial.label}"`,
  );

  const seen = [];
  for (let i = 0; i <= labels.length; i++) {
    await page.keyboard.press('Tab');
    const info = await activeInfo(frame);
    const expected = labels[i % labels.length];
    assert(
      info.inDialog,
      `Tab ${i + 1} moved focus OUTSIDE the dialog (label="${info.label}", role=${info.role})`,
    );
    assert(
      info.label === expected,
      `Tab ${i + 1}: expected focus on "${expected}", got "${info.label}"`,
    );
    seen.push(info.label);
  }

  await page.keyboard.press('Shift+Tab');
  const wrapped = await activeInfo(frame);
  assert(wrapped.inDialog, 'Shift+Tab moved focus outside the dialog');
  assert(
    wrapped.label === labels[labels.length - 1],
    `Shift+Tab from the first focusable should wrap to "${labels[labels.length - 1]}", got "${wrapped.label}"`,
  );
  return `Tab: dialog -> ${seen.join(' -> ')}; Shift+Tab wrapped to ${wrapped.label}`;
}

async function checkModalEscape(page, storyId) {
  const frame = await openStoryFrame(page, storyId);
  const opener = frame.getByRole('button', { name: 'Open dialog', exact: true });
  assert((await opener.count()) === 1, 'expected one "Open dialog" opener button');
  await opener.focus();
  assert(
    (await activeInfo(frame)).label === 'Open dialog',
    'could not focus the dialog opener',
  );

  await page.keyboard.press('Enter');
  await frame.locator('[role="dialog"]').first().waitFor({ state: 'visible', timeout: 5000 });
  assert(
    (await frame.locator('[role="dialog"]').count()) === 1,
    'Enter on the opener should mount exactly one dialog',
  );

  await page.keyboard.press('Escape');
  await frame.waitForFunction(
    () => document.querySelectorAll('[role="dialog"]').length === 0,
    null,
    { timeout: 5000 },
  );
  const after = await activeInfo(frame);
  assert(
    after.label === 'Open dialog' && after.tag === 'BUTTON',
    `Escape closed the dialog but focus did not return to the opener: got label="${after.label}" tag=${after.tag}`,
  );
  return 'Escape unmounted the dialog and focus returned to the opener';
}

async function checkTree(page, storyId) {
  const frame = await openStoryFrame(page, storyId);
  const items = frame.locator('[role="treeitem"]');
  assert((await items.count()) >= 4, `expected a populated tree, found ${await items.count()} treeitems`);

  // Roving tabindex starts on the first visible node: focus it to enter the tree.
  await items.first().focus();
  const first = await activeInfo(frame);
  assert(
    first.role === 'treeitem',
    `focusing the tree should place focus on a treeitem, got role=${first.role}`,
  );

  await page.keyboard.press('ArrowDown');
  const afterDown = await activeInfo(frame);
  assert(
    afterDown.role === 'treeitem' && afterDown.label === 'NIFTY',
    `ArrowDown should move roving focus to the next visible node "NIFTY", got role=${afterDown.role} label="${afterDown.label}"`,
  );

  const cash = frame.locator('[role="treeitem"]').filter({ hasText: /^Cash/ }).first();
  assert((await cash.count()) === 1, 'expected a collapsed "Cash" branch in the tree');
  assert(
    (await cash.getAttribute('aria-expanded')) === 'false',
    'the "Cash" branch should start collapsed',
  );
  await cash.focus();
  await page.keyboard.press('ArrowRight');
  assert(
    (await cash.getAttribute('aria-expanded')) === 'true',
    'ArrowRight on a collapsed branch should expand it (aria-expanded=true)',
  );
  const expandedLabels = await frame.evaluate(() =>
    Array.from(document.querySelectorAll('[role="treeitem"]')).map((n) => n.textContent.trim()),
  );
  assert(
    expandedLabels.some((l) => /^RELIANCE$/.test(l)) &&
      expandedLabels.some((l) => /^TCS$/.test(l)),
    `ArrowRight should reveal the Cash children RELIANCE and TCS; visible: [${expandedLabels.join(', ')}]`,
  );

  await page.keyboard.press('ArrowLeft');
  assert(
    (await cash.getAttribute('aria-expanded')) === 'false',
    'ArrowLeft on an expanded branch should collapse it (aria-expanded=false)',
  );

  const nifty = frame.locator('[role="treeitem"]').filter({ hasText: /^NIFTY$/ }).first();
  assert((await nifty.count()) === 1, 'expected the leaf node "NIFTY"');
  await nifty.focus();
  assert(
    (await nifty.getAttribute('aria-selected')) === 'false',
    'NIFTY should not start selected',
  );
  await page.keyboard.press('Enter');
  assert(
    (await nifty.getAttribute('aria-selected')) === 'true',
    'Enter on a treeitem should select it (aria-selected=true)',
  );
  return 'ArrowDown -> NIFTY, ArrowRight expanded Cash, ArrowLeft collapsed it, Enter selected NIFTY';
}

async function checkMenu(page, storyId) {
  const frame = await openStoryFrame(page, storyId);
  const opener = frame.getByRole('button', { name: 'Open order actions' });
  assert((await opener.count()) === 1, 'expected the "Open order actions" menu target');
  await opener.focus();
  await page.keyboard.press('Enter');
  await frame.locator('[role="menu"]').first().waitFor({ state: 'visible', timeout: 5000 });

  const { enabled, disabled } = await frame.evaluate(() => {
    const all = Array.from(document.querySelectorAll('[role="menuitem"]'));
    return {
      enabled: all
        .filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true')
        .map((el) => el.textContent.trim()),
      disabled: all
        .filter((el) => el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true')
        .map((el) => el.textContent.trim()),
    };
  });
  assert(
    enabled.length >= 3 && disabled.length >= 1,
    `expected enabled and disabled menu items, got enabled=[${enabled.join(', ')}] disabled=[${disabled.join(', ')}]`,
  );

  let info = await activeInfo(frame);
  assert(
    info.label === enabled[0],
    `keyboard-opening the menu should focus the first enabled item "${enabled[0]}", got "${info.label}"`,
  );

  await page.keyboard.press('ArrowDown');
  info = await activeInfo(frame);
  assert(
    info.label === enabled[1],
    `ArrowDown should move to the next ENABLED item "${enabled[1]}" (skipping disabled [${disabled.join(', ')}]), got "${info.label}"`,
  );

  await page.keyboard.press('End');
  info = await activeInfo(frame);
  assert(
    info.label === enabled[enabled.length - 1],
    `End should focus the last enabled item "${enabled[enabled.length - 1]}", got "${info.label}"`,
  );

  await page.keyboard.press('Home');
  info = await activeInfo(frame);
  assert(
    info.label === enabled[0],
    `Home should focus the first enabled item "${enabled[0]}", got "${info.label}"`,
  );

  await page.keyboard.press('Escape');
  await frame.waitForFunction(
    () => document.querySelectorAll('[role="menu"]').length === 0,
    null,
    { timeout: 5000 },
  );
  return `ArrowDown/Home/End traversed enabled items [${enabled.join(', ')}] (skipped [${disabled.join(', ')}]); Escape closed the menu`;
}

async function checkTabs(page, storyId) {
  const frame = await openStoryFrame(page, storyId);
  assert((await frame.locator('[role="tab"]').count()) === 3, 'expected three tabs');

  const state = () =>
    frame.evaluate(() => {
      const all = Array.from(document.querySelectorAll('[role="tab"]'));
      const selected = all.find((t) => t.getAttribute('aria-selected') === 'true');
      const readout = Array.from(document.querySelectorAll('*')).find(
        (e) => e.children.length === 0 && (e.textContent ?? '').trim().startsWith('selected:'),
      );
      return {
        selected: selected?.textContent?.trim() ?? null,
        focus: document.activeElement?.textContent?.trim() ?? null,
        readout: readout?.textContent?.trim() ?? null,
      };
    });

  const before = await state();
  assert(before.selected === 'Overview', `expected Overview selected initially, got ${before.selected}`);
  await frame.locator('[role="tab"]').filter({ hasText: 'Overview' }).first().focus();

  await page.keyboard.press('ArrowRight');
  const afterRight = await state();
  await page.keyboard.press('ArrowRight');
  const afterRight2 = await state();
  await page.keyboard.press('ArrowLeft');
  const afterLeft = await state();

  // Control probe: proves the source implements manual activation, so the
  // failure below is a real behaviour gap and not a broken test driver.
  await page.keyboard.press('Enter');
  const afterEnter = await state();

  const problems = [];
  if (afterRight.selected !== 'Flow') {
    problems.push(
      `ArrowRight expected selected=Flow, got selected=${afterRight.selected} (focus=${afterRight.focus}, ${afterRight.readout})`,
    );
  }
  if (afterRight2.selected !== 'Levels') {
    problems.push(
      `second ArrowRight expected selected=Levels, got selected=${afterRight2.selected} (focus=${afterRight2.focus}, ${afterRight2.readout})`,
    );
  }
  if (afterLeft.selected !== 'Flow') {
    problems.push(
      `ArrowLeft expected selected=Flow, got selected=${afterLeft.selected} (focus=${afterLeft.focus}, ${afterLeft.readout})`,
    );
  }
  if (problems.length) {
    throw new Error(
      `${problems.join('; ')}. Tabs are expected to use automatic activation (arrows change aria-selected); ` +
        `after Enter selected=${afterEnter.selected}.`,
    );
  }
  return `selection followed arrows: ${before.selected} -> ${afterRight.selected} -> ${afterRight2.selected} -> ${afterLeft.selected}`;
}

const WALKTHROUGHS = {
  modalOpen: checkModalTabCycle,
  modalClose: checkModalEscape,
  tree: checkTree,
  menu: checkMenu,
  tabs: checkTabs,
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  console.log(
    `[storybook-keyboard] Serving ${path.relative(PROJECT_ROOT, STATIC_DIR)} at ${BASE_URL} on port ${PORT}.`,
  );
  console.log(`[storybook-keyboard] Resolved ${STORIES.length} required stories:`);
  for (const story of STORIES) console.log(`  - ${story.label}: ${story.id}`);

  await startServer();

  let browser;
  try {
    // Constrained CI/dev containers have a tiny /dev/shm; without this the
    // renderer can crash on the first navigation under memory pressure.
    browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    const results = [];
    for (const story of STORIES) {
      console.log(`\n[storybook-keyboard] ---- ${story.label} (${story.id}) ----`);
      try {
        const detail = await WALKTHROUGHS[story.key](page, story.id);
        results.push({ story, ok: true });
        console.log(`[storybook-keyboard] PASS: ${story.label} — ${detail}`);
      } catch (error) {
        results.push({ story, ok: false, message: error.message });
        console.error(`[storybook-keyboard] FAIL: ${story.label}: ${error.message}`);
      }
    }

    await context.close();

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    console.log('\n[storybook-keyboard] ===== SUMMARY =====');
    console.log(`[storybook-keyboard] Walkthroughs: ${passed} passed, ${failed} failed`);
    for (const result of results) {
      console.log(
        `[storybook-keyboard]   ${result.ok ? 'PASS' : 'FAIL'} ${result.story.id}` +
          (result.ok ? '' : ` — ${result.message}`),
      );
    }
    if (failed > 0) {
      console.error('[storybook-keyboard] FAIL: keyboard walkthrough gate did not pass.');
      process.exitCode = 1;
    } else {
      console.log('[storybook-keyboard] PASS: keyboard walkthrough gate passed.');
    }
  } catch (error) {
    console.error(`[storybook-keyboard] FAIL: ${error.message}`);
    if (/executable doesn't exist|browserType\.launch|Failed to launch/i.test(error.message)) {
      console.error(
        '[storybook-keyboard] The Chromium browser required by the installed Playwright ' +
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
    console.log('[storybook-keyboard] Static server stopped.');
  }
}

let cleaningUp = false;
async function cleanupOnSignal(signal) {
  if (cleaningUp) return;
  cleaningUp = true;
  console.log(`\n[storybook-keyboard] Received ${signal}; cleaning up ...`);
  await stopServer(serverProcess);
  process.exit(signal === 'SIGINT' ? 130 : 143);
}
process.once('SIGINT', () => cleanupOnSignal('SIGINT'));
process.once('SIGTERM', () => cleanupOnSignal('SIGTERM'));

main();
