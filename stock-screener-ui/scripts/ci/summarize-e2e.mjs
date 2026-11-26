#!/usr/bin/env node
// Append failed Playwright tests to the GitHub step summary.
// Dependency-free ESM so a fresh runner can execute it with bare `node`.

import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
          file: String(spec.file || suite.file || 'unknown.spec.ts').replace(/^\.\//, ''),
          title: [...titles, String(spec.title ?? '')].filter(Boolean).join(' › '),
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
  let parsed = 0;
  for (const path of paths) {
    const report = readReport(path);
    if (!report) continue;
    parsed += 1;
    rows.push(...extractFailures(report, path, shard));
  }

  const failures = dedupe(rows);
  const markdown = buildMarkdown(failures);
  if (markdown) {
    log(markdown.trimEnd());
    if (summaryPath) {
      try {
        appendFileSync(summaryPath, markdown, 'utf8');
      } catch (err) {
        warn(`could not append to ${summaryPath}: ${err.message}`);
      }
    }
  } else {
    log(`summarize-e2e: no failed tests found in ${parsed} parsed report(s) (${paths.length} path(s) checked).`);
  }
  return { paths, parsed, rows: failures, markdown };
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

  log('summarize-e2e self-test: 3/3 checks passed');
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

export { parseArgs, discoverReports, readReport, extractFailures, buildMarkdown, summarize, selfTest, FIXTURE, TIMEOUT_FIXTURE };
