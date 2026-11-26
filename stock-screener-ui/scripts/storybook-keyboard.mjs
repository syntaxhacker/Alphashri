#!/usr/bin/env node
/**
 * Real-browser keyboard walkthrough gate for the static Storybook build.
 *
 * Drives the preview iframe with Playwright's keyboard and asserts the keyboard
 * contracts of the design-system primitives and widgets (Modal, Tree, Menu,
 * Tabs, Popover, Tooltip, FloatingWindow and NavLink), including a vertical
 * Tabs walkthrough and NavLink's native-button activation. Story ids
 * are resolved from index.json by title
 * + name, never guessed. The script owns
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
  {
    key: 'tabsVertical',
    label: 'Vertical Tabs — ArrowDown changes aria-selected',
    title: 'Design System/Components/Data display/Tabs',
    name: 'Orientations',
  },
  {
    key: 'popover',
    label: 'Popover — trigger opens, Escape closes, focus returns',
    title: 'Design System/Components/Overlay/Popover',
    name: 'Focus And Dismissal',
  },
  {
    key: 'tooltip',
    label: 'Tooltip — focus shows the description, Escape hides it',
    title: 'Design System/Components/Overlay/Tooltip',
    name: 'Playground',
  },
  {
    key: 'floatingWindowModal',
    label: 'FloatingWindow — Tab stays inside a modal window',
    title: 'Design System/Components/Overlay/FloatingWindow',
    name: 'Geometry And Resize',
  },
  {
    key: 'navLinkKeyboard',
    label: 'NavLink — button[role=link] activates on Enter/Space, disabled inert, href stays anchor',
    title: 'Design System/Components/Navigation/NavLink',
    name: 'States',
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

async function checkTabsVertical(page, storyId) {
  const frame = await openStoryFrame(page, storyId);
  const list = frame.locator('[role="tablist"][aria-label="Vertical sections"]');
  assert(
    (await list.count()) === 1,
    'expected exactly one vertical tablist ("Vertical sections") in the Orientations story',
  );
  assert(
    (await list.getAttribute('aria-orientation')) === 'vertical',
    'the vertical tablist should advertise aria-orientation="vertical"',
  );

  const tabs = list.locator('[role="tab"]');
  assert((await tabs.count()) === 3, `expected three vertical tabs, found ${await tabs.count()}`);

  const selected = () =>
    list.evaluate((node) => {
      const active = Array.from(node.querySelectorAll('[role="tab"]')).find(
        (tab) => tab.getAttribute('aria-selected') === 'true',
      );
      return active?.textContent?.trim() ?? null;
    });

  const before = await selected();
  assert(before === 'Scan', `expected Scan selected initially, got ${before}`);
  await tabs.first().focus();

  await page.keyboard.press('ArrowDown');
  const afterDown = await selected();
  assert(
    afterDown === 'Filter',
    `ArrowDown should change aria-selected from Scan to Filter, got ${afterDown}`,
  );

  await page.keyboard.press('ArrowUp');
  const afterUp = await selected();
  assert(
    afterUp === 'Scan',
    `ArrowUp should change aria-selected back to Scan, got ${afterUp}`,
  );

  return `aria-selected followed vertical arrows: ${before} -> ${afterDown} -> ${afterUp}`;
}

async function checkPopover(page, storyId) {
  const frame = await openStoryFrame(page, storyId);
  // While trapFocus is open the trigger is deliberately aria-hidden/inert, so
  // an accessibility-role locator would time out. Resolve the DOM node by text.
  const trigger = frame.locator('button:has-text("Open dropdown")').first();
  assert((await trigger.count()) === 1, 'expected one "Open dropdown" popover trigger');
  const controls = await trigger.getAttribute('aria-controls');
  assert(controls, 'the trigger should advertise aria-controls for its dropdown');
  const dropdown = frame.locator(`[id="${controls}"]`);
  assert((await dropdown.count()) === 1, 'the story starts with an open dropdown');

  // The story starts open; focus the trigger so Escape reaches the story
  // iframe, then close it before the walkthrough opens it itself.
  await trigger.focus();
  await page.keyboard.press('Escape');
  await frame.waitForFunction(() => document.querySelectorAll('[aria-expanded="true"]').length === 0, null, {
    timeout: 5000,
  });
  assert((await dropdown.count()) === 0, 'Escape should unmount the initially open dropdown');

  await trigger.focus();
  await page.keyboard.press('Enter');
  await dropdown.waitFor({ state: 'visible', timeout: 5000 });
  assert((await trigger.getAttribute('aria-expanded')) === 'true', 'Enter should open the popover');
  assert(
    await dropdown.evaluate((node) => node.contains(document.activeElement)),
    'trapFocus should move focus into the dropdown when the trigger opens it',
  );

  await page.keyboard.press('Escape');
  await frame.waitForFunction((id) => !document.getElementById(id), controls, { timeout: 5000 });
  const after = await activeInfo(frame);
  assert(
    after.label === 'Open dropdown' && after.tag === 'BUTTON',
    `Escape closed the dropdown but focus did not return to the trigger: got label="${after.label}" tag=${after.tag}`,
  );
  return 'Enter opened the dropdown with focus inside; Escape unmounted it and focus returned to the trigger';
}

async function checkTooltip(page, storyId) {
  const frame = await openStoryFrame(page, storyId);
  const trigger = frame.getByRole('button', { name: 'Hover target' });
  assert((await trigger.count()) === 1, 'expected one "Hover target" tooltip trigger');
  const wrapper = trigger.locator('xpath=..');
  const wrapperRole = await wrapper.getAttribute('role');
  assert(wrapperRole !== 'button', 'a tooltip wrapper must not claim a button role');

  await trigger.focus();
  await frame.waitForFunction(() => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (el) => (el.textContent ?? '').trim() === 'Hover target',
    );
    return Boolean(button?.parentElement?.getAttribute('aria-describedby'));
  }, null, { timeout: 5000 });

  const describedBy = await wrapper.getAttribute('aria-describedby');
  const tip = frame.locator(`[id="${describedBy}"]`);
  assert((await tip.count()) === 1, 'the focused trigger should reference a live tooltip element');
  assert((await tip.getAttribute('role')) === 'tooltip', 'the referenced description should have role="tooltip"');
  assert((await tip.textContent()).includes('Hover the target'), 'the tooltip should carry the label');

  await page.keyboard.press('Escape');
  await frame.waitForFunction((id) => !document.getElementById(id), describedBy, { timeout: 5000 });
  assert(
    (await wrapper.getAttribute('aria-describedby')) === null,
    'Escape should clear aria-describedby along with the tooltip',
  );
  return 'focus showed the described tooltip; Escape hid it and cleared the description';
}

async function checkFloatingWindowModal(page, storyId) {
  const frame = await openStoryFrame(page, storyId);
  const dialog = frame.locator('[role="dialog"]').first();
  assert((await dialog.count()) === 1, 'expected one FloatingWindow dialog');

  // These stories do not expose `modal` as a render arg; aria-modal is the
  // same signal the component reads at keydown time, so set it on the live
  // dialog rather than guessing a story id or editing the build.
  await dialog.evaluate((el) => el.setAttribute('aria-modal', 'true'));
  const labels = await dialog.evaluate((el) =>
    Array.from(el.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') || (b.textContent ?? '').trim()),
  );
  assert(labels.length >= 2, `expected at least two window controls, found [${labels.join(', ')}]`);

  await frame.getByRole('button', { name: `Close OPTIONS REPLAY` }).focus();
  const seen = [];
  for (let i = 0; i <= labels.length; i++) {
    await page.keyboard.press('Tab');
    assert(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
      `Tab ${i + 1} moved focus outside the modal window`,
    );
    seen.push((await activeInfo(frame)).label);
  }
  assert(seen[0] === labels[0], `Tab from the last control should wrap to "${labels[0]}", got "${seen[0]}"`);

  await page.keyboard.press('Shift+Tab');
  assert(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
    'Shift+Tab moved focus outside the modal window',
  );
  return `Tab cycled inside the modal window: ${seen.slice(0, labels.length).join(' -> ')}; Shift+Tab stayed inside`;
}

// The States readout is user-facing copy ("0 workspace link activations
// recorded", singular at 1), so copy audits own its wording. Read the integer
// adjacent to "activation" in either word order rather than pinning the old
// "activations: N" layout. One shared pattern keeps the in-page poll in sync
// with the node-side read; the data-activations hook is a stable fallback if
// the copy is reworded again.
const ACTIVATION_COUNT_PATTERN = String.raw`(\d+)\s+[^.;]*?\bactivations?\b|\bactivations?\b[^.;]*?(\d+)`;

function parseActivationCount(text) {
  const match = String(text ?? '')
    .replace(/\s+/g, ' ')
    .match(new RegExp(ACTIVATION_COUNT_PATTERN, 'i'));
  return match ? Number(match[1] ?? match[2]) : null;
}

async function checkNavLinkKeyboard(page, storyId) {
  const frame = await openStoryFrame(page, storyId);

  // The States story exposes all three variants with stable test ids plus a
  // live readout of how many times a non-disabled link's onClick has fired.
  const target = frame.locator('[data-testid="navlink-kb-default"]');
  const disabled = frame.locator('[data-testid="navlink-kb-disabled"]');
  const anchor = frame.locator('[data-testid="navlink-kb-anchor"]');
  const readout = frame.locator('[data-testid="navlink-kb-readout"]');
  assert((await target.count()) === 1, 'expected one non-href NavLink ("Default") in the States story');
  assert((await disabled.count()) === 1, 'expected one disabled non-href NavLink ("Disabled") in the States story');
  assert((await anchor.count()) === 1, 'expected one href NavLink ("Anchor variant") in the States story');
  assert((await readout.count()) === 1, 'expected the activation readout in the States story');

  const targetTag = await target.evaluate((el) => el.tagName);
  assert(targetTag === 'BUTTON', `non-href NavLink must be a native BUTTON, got ${targetTag}`);
  assert(
    (await target.getAttribute('role')) === 'link',
    'non-href NavLink must advertise role="link"',
  );

  const count = async () => {
    const text = ((await readout.textContent()) ?? '').replace(/\s+/g, ' ').trim();
    const fromCopy = parseActivationCount(text);
    if (fromCopy !== null) return fromCopy;
    const hook = await readout.getAttribute('data-activations');
    assert(hook !== null, `could not read the activation count from "${text}"`);
    return Number(hook);
  };
  const waitForCount = (expected) =>
    frame.waitForFunction(
      ({ pattern, n }) => {
        const el = document.querySelector('[data-testid="navlink-kb-readout"]');
        const match = (el?.textContent ?? '').replace(/\s+/g, ' ').match(new RegExp(pattern, 'i'));
        let value = match ? Number(match[1] ?? match[2]) : null;
        if (value === null) {
          const hook = el?.getAttribute('data-activations');
          value = hook == null ? null : Number(hook);
        }
        return value === n;
      },
      { pattern: ACTIVATION_COUNT_PATTERN, n: expected },
      { timeout: 5000 },
    );
  const pressAndExpect = async (key, expected) => {
    await page.keyboard.press(key);
    try {
      await waitForCount(expected);
    } catch {
      throw new Error(`${key} did not move the activation readout to ${expected} (still ${await count()})`);
    }
    return count();
  };

  // Focus the primitive itself, then activate it with each keyboard key.
  await target.focus();
  const focused = await activeInfo(frame);
  assert(
    focused.tag === 'BUTTON' && focused.role === 'link',
    `focus should land on BUTTON[role=link], got tag=${focused.tag} role=${focused.role} label="${focused.label}"`,
  );
  const initial = await count();
  assert(initial === 0, `activation count should start at 0, got ${initial}`);

  const afterEnter = await pressAndExpect('Enter', initial + 1);
  assert(
    afterEnter === initial + 1,
    `Enter should fire onClick exactly once (${initial} -> ${initial + 1}), got ${afterEnter}`,
  );
  const afterSpace = await pressAndExpect('Space', afterEnter + 1);
  assert(
    afterSpace === afterEnter + 1,
    `Space should fire onClick exactly once (${afterEnter} -> ${afterEnter + 1}), got ${afterSpace}`,
  );

  // The disabled variant is still a focusable BUTTON[role=link], but its guard
  // must swallow both activation keys.
  const disabledTag = await disabled.evaluate((el) => el.tagName);
  assert(disabledTag === 'BUTTON', `disabled non-href NavLink should be a BUTTON, got ${disabledTag}`);
  assert(
    (await disabled.getAttribute('role')) === 'link',
    'disabled non-href NavLink must keep role="link"',
  );
  assert(
    (await disabled.getAttribute('aria-disabled')) === 'true',
    'disabled NavLink must advertise aria-disabled="true"',
  );
  await disabled.focus();
  const disabledFocus = await activeInfo(frame);
  assert(
    disabledFocus.tag === 'BUTTON' && disabledFocus.label.includes('Disabled'),
    `could not focus the disabled NavLink: tag=${disabledFocus.tag} label="${disabledFocus.label}"`,
  );
  const beforeDisabled = await count();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await sleep(150);
  const afterDisabled = await count();
  assert(
    afterDisabled === beforeDisabled,
    `Enter/Space on the disabled NavLink must not fire onClick (stayed ${beforeDisabled}, got ${afterDisabled})`,
  );

  // The href variant keeps its native anchor semantics.
  const anchorTag = await anchor.evaluate((el) => el.tagName);
  assert(anchorTag === 'A', `href NavLink must remain an ANCHOR, got ${anchorTag}`);
  assert(
    (await anchor.getAttribute('role')) === 'link',
    'href NavLink must keep role="link"',
  );
  const href = await anchor.getAttribute('href');
  assert(
    href && href.endsWith('#navlink-anchor'),
    `href NavLink must keep its href, got ${href}`,
  );

  return `BUTTON[role=link] focused; Enter -> ${afterEnter}, Space -> ${afterSpace}; disabled inert at ${afterDisabled}; href stays <${anchorTag.toLowerCase()} href="${href}">`;
}

const WALKTHROUGHS = {
  modalOpen: checkModalTabCycle,
  modalClose: checkModalEscape,
  tree: checkTree,
  menu: checkMenu,
  tabs: checkTabs,
  tabsVertical: checkTabsVertical,
  popover: checkPopover,
  tooltip: checkTooltip,
  floatingWindowModal: checkFloatingWindowModal,
  navLinkKeyboard: checkNavLinkKeyboard,
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
