import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildMarkdown,
  buildTestValueMarkdown,
  extractFailures,
  extractTestValue,
  mergeTestValue,
  readReport,
  summarize,
} from './summarize-e2e.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), 'summarize-e2e.mjs');

const reportFixture = {
  suites: [{
    title: 'screener',
    file: 'tests/e2e/screener.spec.ts',
    specs: [
      {
        title: 'loads the watchlist',
        file: 'tests/e2e/screener.spec.ts',
        tests: [{
          status: 'unexpected',
          results: [{ status: 'failed', error: { message: 'expect(row).toBeVisible()\nrow is hidden' } }],
        }],
      },
      {
        title: 'sorts by change',
        file: 'tests/e2e/screener.spec.ts',
        tests: [{
          status: 'unexpected',
          results: [{ status: 'failed', errors: [{ message: 'TimeoutError: click timed out' }] }],
        }],
      },
      {
        title: 'opens the report tab',
        file: 'tests/e2e/screener.spec.ts',
        tests: [{
          status: 'unexpected',
          results: [{ status: 'timedOut', error: { message: 'Page.goto: Timeout 30000ms exceeded' } }],
        }],
      },
    ],
  }],
};

test('two failed tests plus a timed-out test produce exactly three markdown rows', () => {
  const rows = extractFailures(reportFixture, 'fixture.json', '7/20');
  assert.equal(rows.length, 3);
  const markdown = buildMarkdown(rows);
  const dataRows = markdown.split('\n').filter((line) => (
    line.startsWith('| ') && !line.startsWith('| Shard') && !line.startsWith('| ---')
  ));
  assert.equal(dataRows.length, 3);
  assert.match(dataRows[0], /^\| 7\/20 \| tests\/e2e\/screener\.spec\.ts \|/);
  assert.match(markdown, /loads the watchlist/);
  assert.match(markdown, /sorts by change/);
  assert.match(markdown, /opens the report tab/);
  assert.match(markdown, /Page\.goto: Timeout 30000ms exceeded/);
});

test('missing report does not throw and exits 0', () => {
  const missing = '/fixture/path/does/not/exist/report.json';
  assert.equal(readReport(missing), null);
  const child = spawnSync(process.execPath, [script, '--report', missing], { encoding: 'utf8' });
  assert.equal(child.status, 0, `unexpected exit code; stderr: ${child.stderr}`);
  assert.match(`${child.stdout}${child.stderr}`, /no failed tests found in 0 parsed report\(s\)/);
});

const retryFixture = {
  suites: [{
    title: 'order lifecycle',
    file: 'tests/e2e/order-lifecycle.spec.ts',
    specs: [{
      title: 'submits a paper order',
      file: 'tests/e2e/order-lifecycle.spec.ts',
      tests: [
        {
          status: 'flaky',
          results: [
            { status: 'failed', duration: 1200, error: { message: 'Timeout: order row missing' } },
            { status: 'passed', duration: 800 },
          ],
        },
        { status: 'expected', results: [{ status: 'passed', duration: 300 }] },
        { status: 'unexpected', results: [{ status: 'failed', duration: 500 }] },
        { status: 'skipped', results: [{ status: 'skipped' }] },
      ],
    }],
    suites: [{
      title: 'risk checks',
      specs: [{
        title: 'blocks an oversized order',
        file: 'tests/e2e/order-lifecycle.spec.ts',
        tests: [{
          status: 'flaky',
          results: [
            { status: 'failed', duration: 900 },
            { status: 'failed', duration: 400 },
            { status: 'passed', duration: 200 },
          ],
        }],
      }],
    }],
  }],
};

const slowFixture = {
  suites: [{
    title: 'slow paths',
    specs: [
      {
        title: 'report rerenders',
        file: 'tests/e2e/report.spec.ts',
        tests: [
          { status: 'expected', results: [{ status: 'passed', duration: 4000 }] },
          { status: 'expected', results: [{ status: 'passed', duration: 2500 }] },
          { status: 'expected', results: [{ status: 'passed', duration: 500 }] },
        ],
      },
      {
        title: 'options chain loads',
        file: 'tests/e2e/options.spec.ts',
        tests: [
          { status: 'expected', results: [{ status: 'passed', duration: 6000 }] },
          { status: 'expected', results: [{ status: 'passed', duration: 1200 }] },
        ],
      },
      {
        title: 'screener sorts',
        file: 'tests/e2e/screener.spec.ts',
        tests: [{ status: 'expected', results: [{ status: 'passed', duration: 3000 }] }],
      },
    ],
  }],
};

const partialFixture = {
  suites: [{
    specs: [{
      tests: [{ results: [null, { duration: 'not a number' }] }, null, { status: 42 }],
    }],
  }],
};

test('retries produce counts, a flaky section and nested-suite titles', () => {
  const stats = extractTestValue(retryFixture, '7/20');
  assert.equal(stats.total, 5);
  assert.equal(stats.passed, 3);
  assert.equal(stats.failed, 1);
  assert.equal(stats.skipped, 1);
  assert.equal(stats.retried, 2);
  assert.deepEqual(stats.flaky.map((row) => row.attempts).sort(), [2, 3]);
  assert.ok(stats.flaky.some((row) => /order lifecycle › risk checks › blocks an oversized order/.test(row.title)));

  const markdown = buildTestValueMarkdown(stats);
  assert.match(markdown, /### Test value \(warning only\)/);
  assert.match(markdown, /\| Total tests \| 5 \|/);
  assert.match(markdown, /\| Passed \| 3 \|/);
  assert.match(markdown, /\| Failed \| 1 \|/);
  assert.match(markdown, /\| Skipped \| 1 \|/);
  assert.match(markdown, /\| Retried \| 2 \|/);
  assert.match(markdown, /Flaky specs \(tests with >1 attempt\):/);
  assert.match(markdown, /blocks an oversized order \| 3 \|/);
  assert.match(markdown, /Warning-only reporting/);
});

test('slow tests and spec files are ranked by duration and capped at five', () => {
  const stats = extractTestValue(slowFixture, '7/20');
  assert.equal(stats.total, 6);
  const markdown = buildTestValueMarkdown(stats);
  const section = markdown.split('Slowest 5 tests:')[1].split('Slowest 5 spec files')[0];
  const durations = section
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| Duration') && !line.startsWith('| ---'))
    .map((line) => line.split('|')[1].trim());
  assert.deepEqual(durations, ['6.00s', '4.00s', '3.00s', '2.50s', '1.20s']);
  assert.doesNotMatch(section, /500ms/);
  assert.match(markdown, /\| 7\.20s \| tests\/e2e\/options\.spec\.ts \| 2 \|/);
  assert.match(markdown, /\| 7\.00s \| tests\/e2e\/report\.spec\.ts \| 3 \|/);
  assert.match(markdown, /\| 3\.00s \| tests\/e2e\/screener\.spec\.ts \| 1 \|/);
});

test('flaky aggregate status without results still counts as retried', () => {
  const stats = extractTestValue({ suites: [{ specs: [{ tests: [{ status: 'flaky' }] }] }] }, '7/20');
  assert.equal(stats.total, 1);
  assert.equal(stats.passed, 1);
  assert.equal(stats.retried, 1);
  assert.equal(stats.flaky[0].attempts, 2);
});

test('partial JSON is counted without throwing', () => {
  const stats = extractTestValue(partialFixture, '7/20');
  assert.equal(stats.total, 2);
  assert.equal(stats.retried, 1);
  assert.equal(stats.fileDurations.get('unknown.spec.ts').duration, 0);
  assert.match(buildTestValueMarkdown(stats), /\| Total tests \| 2 \|/);
});

test('shards merge into a single scorecard', () => {
  const merged = mergeTestValue([extractTestValue(retryFixture, '7/20'), extractTestValue(slowFixture, '7/20')]);
  assert.equal(merged.total, 11);
  assert.equal(merged.retried, 2);
  assert.equal(merged.fileDurations.size, 4);
  assert.match(buildTestValueMarkdown(merged), /\| Total tests \| 11 \|/);
});

test('summary file receives the failed table and the test-value section; exit code stays 0', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'summarize-e2e-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const reportPath = join(dir, 'report.json');
  const summaryPath = join(dir, 'summary.md');
  writeFileSync(reportPath, JSON.stringify(retryFixture));

  const child = spawnSync(process.execPath, [script, '--report', reportPath, '--summary', summaryPath], { encoding: 'utf8' });
  assert.equal(child.status, 0, `unexpected exit code; stderr: ${child.stderr}`);
  const summary = readFileSync(summaryPath, 'utf8');
  assert.match(summary, /### Failed E2E tests/);
  assert.match(summary, /### Test value \(warning only\)/);
  assert.match(summary, /\| Retried \| 2 \|/);

  const result = summarize({ reports: [reportPath], log: () => {} });
  assert.equal(result.testValue.total, 5);
  assert.match(result.testValueMarkdown, /Flaky specs/);
});
