#!/usr/bin/env node
// Append failed Playwright tests and a warning-only test-value scorecard to the GitHub step summary.
// Dependency-free ESM so a fresh runner can execute it with bare `node`.

import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const USAGE = `Usage: node scripts/ci/summarize-e2e.mjs [options] [report.json ...]

Options:
  --report <path>   Report to read (repeatable; positional paths are accepted too)
  --shard <label>   Shard label, e.g. 7/20 (defaults to the report's config.shard)
  --summary <path>  File to append to (defaults to $GITHUB_STEP_SUMMARY)
  --self-test       Run built-in fixture checks
  -h, --help        Show this help

With no report paths, looks for JSON files under test-results/ and playwright-report/.`;

function warn(message) {
  console.error(`summarize-e2e: ${message}`);
}

function parseArgs(argv) {
  const opts = { reports: [], shard: null, summary: null, selfTest: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--self-test') opts.selfTest = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--report' || arg === '--shard' || arg === '--summary') {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      if (arg === '--report') opts.reports.push(value);
      else if (arg === '--shard') opts.shard = value;
      else opts.summary = value;
    } else if (arg.startsWith('--report=')) opts.reports.push(arg.slice('--report='.length));
    else if (arg.startsWith('--shard=')) opts.shard = arg.slice('--shard='.length);
    else if (arg.startsWith('--summary=')) opts.summary = arg.slice('--summary='.length);
    else if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    else opts.reports.push(arg);
  }
  return opts;
}

function listJsonFiles(dir, depth = 0) {
  if (depth > 3 || !existsSync(dir)) return [];
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    warn(`cannot list ${dir}: ${err.message}`);
    return [];
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listJsonFiles(path, depth + 1));
    else if (entry.isFile() && entry.name.endsWith('.json') && entry.name !== '.last-run.json') {
      found.push(path);
    }
  }
  return found;
}

function discoverReports(explicit, cwd = process.cwd()) {
  if (explicit.length > 0) return explicit.map((path) => resolve(cwd, path));
  const found = [];
  for (const dir of ['test-results', 'playwright-report']) {
    found.push(...listJsonFiles(resolve(cwd, dir)));
  }
  return found.sort();
}

function readReport(path) {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return null;
    const text = readFileSync(path, 'utf8');
    if (!text.trim()) return null;
    const report = JSON.parse(text);
    if (!report || typeof report !== 'object' || !Array.isArray(report.suites)) return null;
    return report;
  } catch (err) {
    warn(`could not read ${path}: ${err.message}`);
    return null;
  }
}

function normalizeShard(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const label = value.trim();
  const match = label.match(/^(\d+)(?:\/(\d+))?$/);
  return match ? (match[2] ? `${match[1]}/${match[2]}` : match[1]) : label;
}

function shardFromReport(report) {
  const shard = report?.config?.shard;
  if (shard && typeof shard.current === 'number') {
    return `${shard.current}/${shard.total ?? '?'}`;
  }
  return null;
}

// Playwright reports an unexpected test outcome as `unexpected`; an individual
// result can be `failed`, `timedOut` or `interrupted`.
const FAILED_TEST_STATUSES = new Set(['failed', 'unexpected']);
const FAILED_RESULT_STATUSES = new Set(['failed', 'timedOut', 'interrupted']);

function isFailed(test) {
  if (!test || typeof test !== 'object') return false;
  if (FAILED_TEST_STATUSES.has(test.status)) return true;
  // Partial reports may omit the aggregate status, and a retried test can be
  // `flaky` while an earlier result still needs triage.
  return (Array.isArray(test.results) ? test.results : []).some((result) => FAILED_RESULT_STATUSES.has(result?.status));
}

function firstErrorLine(test) {
  const results = Array.isArray(test?.results) ? test.results : [];
  for (const result of results) {
    if (!FAILED_RESULT_STATUSES.has(result?.status)) continue;
    const candidates = [
      result.error?.message,
      ...(Array.isArray(result.errors) ? result.errors.map((error) => error?.message) : []),
      result.error?.stack,
    ];
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue;
      const line = candidate.split(/\r?\n/).map((part) => part.trim()).find(Boolean);
      if (line) return line.length > 240 ? `${line.slice(0, 240)}…` : line;
    }
  }
  return 'no error message in report';
}

function specFile(spec, suite) {
  return String(spec?.file || suite?.file || 'unknown.spec.ts').replace(/^\.\//, '');
}

function fullTitle(titles, spec) {
  return [...titles, String(spec?.title ?? '')].filter(Boolean).join(' › ');
}

function extractFailures(report, source, shardHint) {
  const rows = [];
  const shard = normalizeShard(shardHint) ?? shardFromReport(report) ?? 'unknown';
  const visit = (suite, ancestors) => {
    if (!suite || typeof suite !== 'object') return;
    const suiteTitle = typeof suite.title === 'string' ? suite.title : '';
    const titles = suiteTitle ? [...ancestors, suiteTitle] : ancestors;
    for (const spec of Array.isArray(suite.specs) ? suite.specs : []) {
      if (!spec || typeof spec !== 'object') continue;
      for (const test of Array.isArray(spec.tests) ? spec.tests : []) {
        if (!isFailed(test)) continue;
        rows.push({
          shard,
          file: specFile(spec, suite),
          title: fullTitle(titles, spec),
          error: firstErrorLine(test),
          source,
        });
      }
    }
    for (const child of Array.isArray(suite.suites) ? suite.suites : []) visit(child, titles);
  };
  for (const suite of Array.isArray(report?.suites) ? report.suites : []) visit(suite, []);
  return rows;
}

// Playwright's aggregate status is authoritative; partial reports may only
// carry per-result statuses, so fall back to the last attempt in that case.
function classifyTest(test) {
  switch (test?.status) {
    case 'skipped': return 'skipped';
    case 'expected': return 'passed';
    case 'flaky': return 'passed';
    case 'unexpected':
    case 'failed': return 'failed';
    default: break;
  }
  const results = Array.isArray(test?.results) ? test.results : [];
  const last = results[results.length - 1];
  if (last?.status === 'skipped') return 'skipped';
  if (FAILED_RESULT_STATUSES.has(last?.status)) return 'failed';
  if (last?.status === 'passed') return 'passed';
  return null;
}

function attemptInfo(test) {
  const results = Array.isArray(test?.results) ? test.results : [];
  let maxRetry = 0;
  let duration = 0;
  for (const result of results) {
    if (!result || typeof result !== 'object') continue;
    const retry = Number(result.retry);
    if (Number.isFinite(retry) && retry > maxRetry) maxRetry = retry;
    const ms = Number(result.duration);
    if (Number.isFinite(ms) && ms > 0) duration += ms;
  }
  // A `flaky` aggregate status implies a retry even when partial JSON omits results.
  const attempts = Math.max(results.length, maxRetry + 1, test?.status === 'flaky' ? 2 : 1);
  return { attempts, duration };
}

function createTestValueStats() {
  return {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    retried: 0,
    flaky: [],
    tests: [],
    fileDurations: new Map(),
  };
}

function extractTestValue(report, shardHint) {
  const stats = createTestValueStats();
  const shard = normalizeShard(shardHint) ?? shardFromReport(report) ?? 'unknown';
  const visit = (suite, ancestors) => {
    if (!suite || typeof suite !== 'object') return;
    const suiteTitle = typeof suite.title === 'string' ? suite.title : '';
    const titles = suiteTitle ? [...ancestors, suiteTitle] : ancestors;
    for (const spec of Array.isArray(suite.specs) ? suite.specs : []) {
      if (!spec || typeof spec !== 'object') continue;
      const file = specFile(spec, suite);
      const title = fullTitle(titles, spec);
      for (const test of Array.isArray(spec.tests) ? spec.tests : []) {
        if (!test || typeof test !== 'object') continue;
        const { attempts, duration } = attemptInfo(test);
        stats.total += 1;
        const kind = classifyTest(test);
        if (kind) stats[kind] += 1;
        if (attempts > 1) {
          stats.retried += 1;
          stats.flaky.push({ shard, file, title, attempts });
        }
        stats.tests.push({ shard, file, title, duration });
        const previous = stats.fileDurations.get(file) ?? { duration: 0, count: 0 };
        stats.fileDurations.set(file, { duration: previous.duration + duration, count: previous.count + 1 });
      }
    }
    for (const child of Array.isArray(suite.suites) ? suite.suites : []) visit(child, titles);
  };
  for (const suite of Array.isArray(report?.suites) ? report.suites : []) visit(suite, []);
  return stats;
}

function mergeTestValue(parts) {
  const merged = createTestValueStats();
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    for (const key of ['total', 'passed', 'failed', 'skipped', 'retried']) {
      merged[key] += Number(part[key]) || 0;
    }
    if (Array.isArray(part.flaky)) merged.flaky.push(...part.flaky);
    if (Array.isArray(part.tests)) merged.tests.push(...part.tests);
    if (part.fileDurations instanceof Map) {
      for (const [file, value] of part.fileDurations) {
        const previous = merged.fileDurations.get(file) ?? { duration: 0, count: 0 };
        merged.fileDurations.set(file, {
          duration: previous.duration + (Number(value?.duration) || 0),
          count: previous.count + (Number(value?.count) || 0),
        });
      }
    }
  }
  return merged;
}

function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60000) return `${(value / 1000).toFixed(2)}s`;
  return `${Math.floor(value / 60000)}m ${Math.round((value % 60000) / 1000)}s`;
}

function escapeCell(value) {
  const text = String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n|\r/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || '—';
}

function buildMarkdown(rows) {
  if (rows.length === 0) return '';
  const lines = [
    '### Failed E2E tests',
    '',
    '| Shard | Spec file | Test title | Error line |',
    '| --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    lines.push(`| ${escapeCell(row.shard)} | ${escapeCell(row.file)} | ${escapeCell(row.title)} | ${escapeCell(row.error)} |`);
  }
  return `${lines.join('\n')}\n\n`;
}

function buildTestValueMarkdown(stats) {
  const values = stats ?? createTestValueStats();
  const lines = [
    '### Test value (warning only)',
    '',
    '| Metric | Count |',
    '| --- | ---: |',
    `| Total tests | ${values.total} |`,
    `| Passed | ${values.passed} |`,
    `| Failed | ${values.failed} |`,
    `| Skipped | ${values.skipped} |`,
    `| Retried | ${values.retried} |`,
    '',
    'Flaky specs (tests with >1 attempt):',
    '',
  ];

  const flaky = [...values.flaky].sort((a, b) => b.attempts - a.attempts).slice(0, 5);
  if (flaky.length === 0) {
    lines.push('—', '');
  } else {
    lines.push('| Spec file | Test | Attempts |', '| --- | --- | ---: |');
    for (const row of flaky) {
      lines.push(`| ${escapeCell(row.file)} | ${escapeCell(row.title)} | ${row.attempts} |`);
    }
    if (values.flaky.length > flaky.length) lines.push('', `_… and ${values.flaky.length - flaky.length} more_`);
    lines.push('');
  }

  lines.push('Slowest 5 tests:', '');
  const slowTests = values.tests
    .filter((row) => row.duration > 0)
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 5);
  if (slowTests.length === 0) {
    lines.push('—', '');
  } else {
    lines.push('| Duration | Spec file | Test |', '| ---: | --- | --- |');
    for (const row of slowTests) {
      lines.push(`| ${formatDuration(row.duration)} | ${escapeCell(row.file)} | ${escapeCell(row.title)} |`);
    }
    lines.push('');
  }

  lines.push('Slowest 5 spec files (summed test duration):', '');
  const slowFiles = [...values.fileDurations]
    .map(([file, value]) => ({ file, duration: value.duration, count: value.count }))
    .filter((row) => row.duration > 0)
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 5);
  if (slowFiles.length === 0) {
    lines.push('—', '');
  } else {
    lines.push('| Duration | Spec file | Tests |', '| ---: | --- | ---: |');
    for (const row of slowFiles) {
      lines.push(`| ${formatDuration(row.duration)} | ${escapeCell(row.file)} | ${row.count} |`);
    }
    lines.push('');
  }

  lines.push('> Warning-only reporting — this step never changes the job exit code.', '');
  return `${lines.join('\n')}\n`;
}

function dedupe(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.shard}|${row.file}|${row.title}|${row.error}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function summarize({ reports = [], shard, summaryPath, log = console.log } = {}) {
  const paths = discoverReports(reports);
  const rows = [];
  const valueParts = [];
  let parsed = 0;
  for (const path of paths) {
    const report = readReport(path);
    if (!report) continue;
    parsed += 1;
    rows.push(...extractFailures(report, path, shard));
    valueParts.push(extractTestValue(report, shard));
  }

  const failures = dedupe(rows);
  const markdown = buildMarkdown(failures);
  const testValue = mergeTestValue(valueParts);
  const testValueMarkdown = buildTestValueMarkdown(testValue);

  if (markdown) log(markdown.trimEnd());
  else log(`summarize-e2e: no failed tests found in ${parsed} parsed report(s) (${paths.length} path(s) checked).`);
  log(testValueMarkdown.trimEnd());

  const combined = `${markdown}${testValueMarkdown}`;
  if (combined && summaryPath) {
    try {
      appendFileSync(summaryPath, combined, 'utf8');
    } catch (err) {
      warn(`could not append to ${summaryPath}: ${err.message}`);
    }
  }
  return { paths, parsed, rows: failures, markdown, testValue, testValueMarkdown };
}

const FIXTURE = {
  suites: [
    {
      title: 'checkout flow',
      file: 'tests/e2e/checkout.spec.ts',
      specs: [
        {
          title: 'adds item to cart',
          file: 'tests/e2e/checkout.spec.ts',
          tests: [{
            status: 'unexpected',
            results: [{ status: 'failed', error: { message: 'expect(page).toHaveText("Cart (1)")\nReceived: "Cart (0)"' } }],
          }],
        },
        {
          title: 'applies coupon',
          file: 'tests/e2e/checkout.spec.ts',
          tests: [{
            status: 'unexpected',
            results: [{ status: 'failed', errors: [{ message: 'TimeoutError: locator.click timed out | retry 1' }] }],
          }],
        },
      ],
    },
  ],
};

const TIMEOUT_FIXTURE = {
  suites: [{
    title: 'navigation',
    file: 'tests/e2e/navigation.spec.ts',
    specs: [
      {
        title: 'opens the report tab',
        file: 'tests/e2e/navigation.spec.ts',
        tests: [{
          status: 'unexpected',
          results: [{ status: 'timedOut', error: { message: 'Test timeout of 60000ms exceeded.' } }],
        }],
      },
      {
        title: 'recovers after worker crash',
        file: 'tests/e2e/navigation.spec.ts',
        tests: [{
          status: 'unexpected',
          results: [{ status: 'interrupted', error: { message: 'Worker process exited unexpectedly.' } }],
        }],
      },
    ],
  }],
};

const RETRY_FIXTURE = {
  suites: [{
    title: 'paper order lifecycle',
    file: 'tests/e2e/paper-orders.spec.ts',
    specs: [
      {
        title: 'places a limit order',
        file: 'tests/e2e/paper-orders.spec.ts',
        tests: [{
          status: 'flaky',
          results: [
            { status: 'failed', duration: 1500, error: { message: 'Timeout while placing order' } },
            { status: 'passed', duration: 900 },
          ],
        }],
      },
      {
        title: 'cancels an open order',
        file: 'tests/e2e/paper-orders.spec.ts',
        tests: [{
          status: 'flaky',
          results: [
            { status: 'failed', duration: 700 },
            { status: 'failed', duration: 600 },
            { status: 'passed', duration: 500 },
          ],
        }],
      },
      {
        title: 'rejects an invalid leg',
        file: 'tests/e2e/paper-orders.spec.ts',
        tests: [{ status: 'unexpected', results: [{ status: 'failed', duration: 400 }] }],
      },
      {
        title: 'shows an empty book',
        file: 'tests/e2e/paper-orders.spec.ts',
        tests: [{ status: 'skipped', results: [{ status: 'skipped' }] }],
      },
      {
        title: 'opens the dock',
        file: 'tests/e2e/paper-orders.spec.ts',
        tests: [{ status: 'expected', results: [{ status: 'passed', duration: 300 }] }],
      },
    ],
  }],
};

const SLOW_FIXTURE = {
  suites: [{
    title: 'slow paths',
    specs: [
      {
        title: 'report rerenders',
        file: 'tests/e2e/report.spec.ts',
        tests: [
          { status: 'expected', results: [{ status: 'passed', duration: 5000 }] },
          { status: 'expected', results: [{ status: 'passed', duration: 3000 }] },
          { status: 'expected', results: [{ status: 'passed', duration: 1000 }] },
        ],
      },
      {
        title: 'options chain loads',
        file: 'tests/e2e/options.spec.ts',
        tests: [
          { status: 'expected', results: [{ status: 'passed', duration: 7000 }] },
          { status: 'expected', results: [{ status: 'passed', duration: 1500 }] },
        ],
      },
      {
        title: 'screener sorts',
        file: 'tests/e2e/screener.spec.ts',
        tests: [
          { status: 'expected', results: [{ status: 'passed', duration: 2000 }] },
          { status: 'expected', results: [{ status: 'passed', duration: 500 }] },
        ],
      },
    ],
  }],
};

const PARTIAL_FIXTURE = {
  suites: [
    null,
    {
      title: 'partial',
      specs: [
        null,
        {
          title: 'malformed results',
          tests: [null, {}, { results: [null, { duration: 'n/a' }] }],
        },
      ],
    },
  ],
};

function selfTest(log = console.log) {
  const rows = extractFailures(FIXTURE, 'fixture.json', '3/20');
  assert.equal(rows.length, 2, 'fixture with two failed tests must yield two rows');
  const markdown = buildMarkdown(rows);
  const dataRows = markdown.split('\n').filter((line) => (
    line.startsWith('| ') && !line.startsWith('| Shard') && !line.startsWith('| ---')
  ));
  assert.equal(dataRows.length, 2, 'two failed tests must produce exactly two markdown rows');
  log('summarize-e2e self-test: PASS — two failed tests -> 2 markdown rows');

  const timeoutRows = extractFailures(TIMEOUT_FIXTURE, 'timeout-fixture.json', '3/20');
  assert.equal(timeoutRows.length, 2, 'timedOut and interrupted results must be included');
  assert.match(timeoutRows[0].error, /Test timeout of 60000ms exceeded/);
  assert.match(timeoutRows[1].error, /Worker process exited unexpectedly/);
  log('summarize-e2e self-test: PASS — timedOut/interrupted results -> 2 rows');

  const missing = join(tmpdir(), `summarize-e2e-missing-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  assert.equal(readReport(missing), null);
  const result = summarize({ reports: [missing], shard: '3/20', log: () => {} });
  assert.equal(result.rows.length, 0);
  assert.equal(result.markdown, '');
  log('summarize-e2e self-test: PASS — missing report -> no throw, 0 rows');

  const retryStats = extractTestValue(RETRY_FIXTURE, '3/20');
  assert.equal(retryStats.total, 5);
  assert.equal(retryStats.passed, 3);
  assert.equal(retryStats.failed, 1);
  assert.equal(retryStats.skipped, 1);
  assert.equal(retryStats.retried, 2);
  assert.deepEqual(retryStats.flaky.map((row) => row.attempts).sort(), [2, 3]);
  log('summarize-e2e self-test: PASS — retries/flaky -> 5 total, 2 retried');

  const retryMarkdown = buildTestValueMarkdown(retryStats);
  assert.match(retryMarkdown, /\| Passed \| 3 \|/);
  assert.match(retryMarkdown, /\| Retried \| 2 \|/);
  assert.match(retryMarkdown, /Flaky specs \(tests with >1 attempt\):/);
  assert.match(retryMarkdown, /places a limit order/);
  assert.match(retryMarkdown, /Slowest 5 tests:/);
  assert.match(retryMarkdown, /Warning-only reporting/);
  log('summarize-e2e self-test: PASS — retry fixture -> test-value section rendered');

  const slowStats = extractTestValue(SLOW_FIXTURE, '3/20');
  assert.equal(slowStats.total, 7);
  assert.equal(slowStats.tests.sort((a, b) => b.duration - a.duration)[0].duration, 7000);
  const slowMarkdown = buildTestValueMarkdown(slowStats);
  assert.match(slowMarkdown, /\| 7\.00s \| tests\/e2e\/options\.spec\.ts \|/);
  assert.match(slowMarkdown, /\| 9\.00s \| tests\/e2e\/report\.spec\.ts \| 3 \|/);
  assert.match(slowMarkdown, /\| 8\.50s \| tests\/e2e\/options\.spec\.ts \| 2 \|/);
  log('summarize-e2e self-test: PASS — slow tests/files ranked by duration');

  const partialStats = extractTestValue(PARTIAL_FIXTURE, '3/20');
  assert.equal(partialStats.total, 2);
  assert.equal(partialStats.retried, 1);
  assert.equal(partialStats.fileDurations.get('unknown.spec.ts').duration, 0);
  assert.doesNotThrow(() => buildTestValueMarkdown(partialStats));
  log('summarize-e2e self-test: PASS — partial JSON -> no throw, 2 tests counted');

  const merged = mergeTestValue([retryStats, slowStats]);
  assert.equal(merged.total, 12);
  assert.equal(merged.retried, 2);
  assert.equal(merged.fileDurations.size, 4);
  log('summarize-e2e self-test: PASS — shards merge into one scorecard');

  log('summarize-e2e self-test: 8/8 checks passed');
  return true;
}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
    if (opts.help) {
      console.log(USAGE);
      return 0;
    }
    if (opts.selfTest) {
      selfTest();
      return 0;
    }
    summarize({
      reports: opts.reports,
      shard: normalizeShard(opts.shard || process.env.E2E_SHARD),
      summaryPath: opts.summary || process.env.GITHUB_STEP_SUMMARY || null,
    });
  } catch (err) {
    // This step is diagnostic only: it must never fail the release job.
    warn(`non-fatal error: ${err?.stack || err}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}

export {
  parseArgs,
  discoverReports,
  readReport,
  extractFailures,
  buildMarkdown,
  extractTestValue,
  mergeTestValue,
  buildTestValueMarkdown,
  summarize,
  selfTest,
  FIXTURE,
  TIMEOUT_FIXTURE,
  RETRY_FIXTURE,
  SLOW_FIXTURE,
  PARTIAL_FIXTURE,
};
