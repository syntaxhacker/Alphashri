import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMarkdown, extractFailures, readReport } from './summarize-e2e.mjs';

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
