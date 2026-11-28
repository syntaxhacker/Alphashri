/**
 * Visual evidence for Market → Vis at 1600×1000 and 390×844.
 *
 * The eleven mode captures drive the live API with a real QA login: neither
 * `market/snapshot` nor `sector/groups` is intercepted for those frames. The
 * Themes detail-open capture is live too. The seventeen loading/error/empty
 * captures are the only mocked frames and are marked `mock: true` in the
 * helper's MOCKED_STATES manifest data. Screenshots are
 * written only when SCREENSHOT_EVIDENCE=1; layout measurements are always
 * dumped to MARKET_VIS_METRICS_PATH (default /tmp/opencode/market-vis-metrics.json).
 *
 * `realLogin` installs a page-level route for `market.filters` that serves the
 * backend's unsaved default envelope and fulfils PUT/DELETE locally. No capture
 * deletes a shared user's config row, so a live browser's If-Match never 409s.
 *
 * Run with one worker for a single coherent metrics dump:
 *   SCREENSHOT_EVIDENCE=1 npx playwright test tests/e2e/market-vis-evidence.spec.ts --workers=1 --output=/tmp/opencode/market-vis-pw
 */
import { test, expect } from "@playwright/test";
import { waitForSettled } from "./helpers/evidenceFast";
import {
  ALTERNATE_STATES,
  applyAlternateState,
  assertConfigIsolation,
  assertLayout,
  assertModeSpecific,
  assertNoForbiddenConsole,
  EVIDENCE_ENABLED,
  ensureShotDir,
  captureFileName,
  collectVisConsoleErrors,
  DETAIL_STATES,
  MOCKED_STATES,
  measureLayout,
  panelLevelSpec,
  recordMetric,
  realLogin,
  clearCachedSnapshots,
  resetFiltersAndAssert,
  selectVisMode,
  SHOT_DIR,
  type VisModeSpec,
  VIS_MODES,
  MARKET_VIS_PATH,
  VIEWPORTS,
  waitForLoadedCount,
  waitForVisMode,
  installStateMock,
} from "./helpers/marketVisEvidence";

for (const mode of VIS_MODES) {
  for (const viewport of VIEWPORTS) {
    test(`captures ${mode.slug} at ${viewport.width}`, async ({ page, request }) => {
      test.skip(!EVIDENCE_ENABLED, "set SCREENSHOT_EVIDENCE=1 to write evidence captures");
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      const consoleErrors = collectVisConsoleErrors(page);
      await realLogin(page, request);
      await page.goto(MARKET_VIS_PATH);

      await waitForLoadedCount(page);
      await expect(page.getByTestId("market-vis-selector")).toBeVisible({ timeout: 30_000 });
      await resetFiltersAndAssert(page);

      await selectVisMode(page, mode.mode);
      await waitForVisMode(page, mode.rootTestId);
      await expect(page.getByTestId(mode.primaryTestId)).toBeVisible({ timeout: 30_000 });

      const layout = await measureLayout(page, mode, viewport.width);
      assertLayout(layout, viewport.width, mode.expectCount);
      await assertModeSpecific(page, mode.mode, viewport.width, viewport.height);

      const capture = captureFileName(mode.slug, viewport.width);
      ensureShotDir();
      await page.screenshot({ fullPage: false, path: `${SHOT_DIR}/${capture}` });

      assertConfigIsolation(page);
      assertNoForbiddenConsole(consoleErrors);
      recordMetric({
        mode: mode.slug,
        width: viewport.width,
        ...layout,
        mock: false,
        capture,
        configIsolated: true,
      });
    });
  }
}

for (const state of ALTERNATE_STATES) {
  for (const viewport of VIEWPORTS) {
    test(`captures ${state.id} at ${viewport.width}`, async ({ page, request }) => {
      test.skip(!EVIDENCE_ENABLED, "set SCREENSHOT_EVIDENCE=1 to write evidence captures");
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      const consoleErrors = collectVisConsoleErrors(page);
      await realLogin(page, request);
      await page.goto(MARKET_VIS_PATH);

      await waitForLoadedCount(page);
      await expect(page.getByTestId("market-vis-selector")).toBeVisible({ timeout: 30_000 });
      await resetFiltersAndAssert(page);

      const mode = VIS_MODES.find((item) => item.mode === state.mode);
      expect(mode, `no Vis mode spec for ${state.mode}`).toBeTruthy();
      await selectVisMode(page, state.mode);
      await waitForVisMode(page, mode!.rootTestId);
      await expect(page.getByTestId(mode!.primaryTestId)).toBeVisible({ timeout: 30_000 });

      await applyAlternateState(page, state);
      await waitForSettled(page, `[data-testid="${mode!.rootTestId}"]`);

      const layout = await measureLayout(page, mode!, viewport.width);
      assertLayout(layout, viewport.width, mode!.expectCount);
      await assertModeSpecific(page, state.mode, viewport.width, viewport.height);

      const capture = captureFileName(state.id, viewport.width);
      ensureShotDir();
      await page.screenshot({ fullPage: false, path: `${SHOT_DIR}/${capture}` });

      assertConfigIsolation(page);
      assertNoForbiddenConsole(consoleErrors);
      recordMetric({
        mode: state.id,
        stateId: state.id,
        width: viewport.width,
        ...layout,
        mock: false,
        capture,
        configIsolated: true,
        covers: state.covers,
        expectCount: mode!.expectCount,
      });
    });
  }
}

for (const state of DETAIL_STATES) {
  for (const viewport of VIEWPORTS) {
    test(`captures ${state.id} at ${viewport.width}`, async ({ page, request }) => {
      test.skip(!EVIDENCE_ENABLED, "set SCREENSHOT_EVIDENCE=1 to write evidence captures");
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      const consoleErrors = collectVisConsoleErrors(page);
      await realLogin(page, request);
      await page.goto(MARKET_VIS_PATH);

      await waitForLoadedCount(page);
      await expect(page.getByTestId("market-vis-selector")).toBeVisible({ timeout: 30_000 });
      await resetFiltersAndAssert(page);

      await selectVisMode(page, state.mode);
      await waitForVisMode(page, state.rootTestId);
      await expect(page.getByTestId(state.boardTestId)).toBeVisible({ timeout: 30_000 });

      const row = page.locator(state.rowSelector).first();
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.click();

      const detail = page.getByTestId(state.detailTestId);
      await expect(detail).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId(state.loadingTestId)).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByTestId(state.readyTestId)).toBeVisible({ timeout: 30_000 });

      if (viewport.width === 390) {
        const card = page.getByTestId(state.mobileCardTestId);
        await expect(card).toBeVisible();
        await expect(card).toHaveClass(/border-t/);
        await expect(card).not.toHaveClass(/(^|\s)border(\s|$)/);
      } else {
        const pane = page.getByTestId(state.desktopPaneTestId);
        await expect(pane).toBeVisible();
        await expect(pane).toHaveClass(/border-l/);
        const borderTokens = await pane.evaluate((element) =>
          element.className.split(/\s+/).filter((token: string) => /^border(-|$)/.test(token)),
        );
        expect(borderTokens, `desktop detail pane owns ${borderTokens.length} border tokens`).toEqual([
          "border-l",
        ]);
      }

      const mode = VIS_MODES.find((item) => item.mode === state.mode);
      expect(mode, `no Vis mode spec for ${state.mode}`).toBeTruthy();
      const layout = await measureLayout(page, mode!, viewport.width, state.detailTestId);
      assertLayout(layout, viewport.width, state.expectCount);

      const capture = captureFileName(state.id, viewport.width);
      ensureShotDir();
      await page.screenshot({ fullPage: false, path: `${SHOT_DIR}/${capture}` });

      assertConfigIsolation(page);
      assertNoForbiddenConsole(consoleErrors);
      recordMetric({
        mode: state.id,
        width: viewport.width,
        ...layout,
        mock: false,
        capture,
        configIsolated: true,
        expectCount: state.expectCount,
      });
    });
  }
}

for (const state of MOCKED_STATES) {
  for (const viewport of VIEWPORTS) {
    test(`captures ${state.id} at ${viewport.width}`, async ({ page, request }) => {
      test.skip(!EVIDENCE_ENABLED, "set SCREENSHOT_EVIDENCE=1 to write evidence captures");
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      const consoleErrors = collectVisConsoleErrors(page);
      await clearCachedSnapshots(page);
      await realLogin(page, request);
      await installStateMock(page, state.id);
      await page.goto(MARKET_VIS_PATH);

      let mode: VisModeSpec;
      if (state.panelLevel) {
        // The panel-level skeleton/error replaces the whole Vis region: no
        // market-vis-selector and no per-view component mount. Arrive at the
        // route with the mock already installed and photograph the signal.
        // Mode is coverage metadata only — this one frame covers every
        // snapshot-driven mode; no per-mode skeleton/error exists.
        await expect(page.getByTestId(state.signalTestId)).toBeVisible({ timeout: 30_000 });
        if (state.retryTestId) {
          await expect(page.getByTestId(state.retryTestId)).toBeVisible();
        }
        mode = panelLevelSpec(state);
        await waitForSettled(page, `[data-testid="${state.signalTestId}"]`);
      } else {
        await waitForLoadedCount(page, true);
        await expect(page.getByTestId("market-vis-selector")).toBeVisible({ timeout: 30_000 });
        await resetFiltersAndAssert(page, true);

        await selectVisMode(page, state.mode);
        await waitForVisMode(page, state.rootTestId);
        await expect(page.getByTestId(state.signalTestId)).toBeVisible({ timeout: 30_000 });
        if (state.retryTestId) {
          await expect(page.getByTestId(state.retryTestId)).toBeVisible();
        }

        const found = VIS_MODES.find((item) => item.mode === state.mode);
        expect(found, `no Vis mode spec for ${state.mode}`).toBeTruthy();
        mode = found!;
        await waitForSettled(page, `[data-testid="${mode.rootTestId}"]`);
      }

      const layout = await measureLayout(page, mode, viewport.width, state.signalTestId);
      assertLayout(layout, viewport.width, state.expectCount);
      // Panel-level states own no per-view canvas; the RSI canvas-height and
      // other mode-specific checks apply to the loaded visual only.
      if (!state.panelLevel && state.id !== "rsi-adx-empty") {
        await assertModeSpecific(page, state.mode, viewport.width, viewport.height);
      }

      const capture = captureFileName(state.id, viewport.width);
      ensureShotDir();
      await page.screenshot({ fullPage: false, path: `${SHOT_DIR}/${capture}` });

      assertConfigIsolation(page);
      assertNoForbiddenConsole(consoleErrors);
      recordMetric({
        mode: state.id,
        stateId: state.id,
        width: viewport.width,
        ...layout,
        mock: true,
        capture,
        configIsolated: true,
        expectCount: state.expectCount,
        covers: state.covers,
      });
    });
  }
}
