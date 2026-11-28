import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const BUDGETS_PATH = resolve(ROOT, "perf/chart_ui_budgets.json");
const DOC_PATH = resolve(ROOT, "docs/CHART_PERFORMANCE.md");
const AGENTS_PATH = resolve(ROOT, "AGENTS.md");
const RULES_PATH = resolve(ROOT, "SUBAGENT_RULES.md");

// The budget file owns the Codespaces artifact root; docs and agent rules follow it.
const CODESPACES_ARTIFACT_DIR: string = JSON.parse(
  readFileSync(BUDGETS_PATH, "utf8"),
).measurement.artifact_dir.codespaces;
const CODESPACES_ARTIFACT_ROOT = CODESPACES_ARTIFACT_DIR.replace(/\/chart-perf$/, "/");

const REQUIRED_TARGETS = [
  "initial_route_chart_ms",
  "timeframe_switch_ms",
  "pan_zoom_frame_p95_ms",
  "long_task_max_ms",
  "heap_growth_after_cycles_mb",
  "canvas_count_growth_max",
  "listener_count_growth_max",
  "indicator_payload_raw_bytes",
  "indicator_payload_gzip_bytes",
  "backend_indicator_zones_p95_ms",
  "toggle_all_ms",
] as const;

const REQUIRED_SCRIPTS = ["perf:chart:fixtures", "perf:chart:matrix", "perf:chart"];
const PERF_SCRIPTS = [
  "scripts/perf/gen_chart_fixtures.py",
  "scripts/perf/chart_tf_matrix.mjs",
  "scripts/perf/chart_perf.mjs",
] as const;

describe("chart performance contract", () => {
  it("keeps the machine-readable budget file present and well formed", () => {
    expect(existsSync(BUDGETS_PATH), `${BUDGETS_PATH} is missing`).toBe(true);
    const budgets = JSON.parse(readFileSync(BUDGETS_PATH, "utf8"));

    expect(budgets.schema_version).toBe(1);
    expect(typeof budgets.status).toBe("string");
    expect(budgets.status.length).toBeGreaterThan(0);
    expect(typeof budgets.policy).toBe("string");
    expect(budgets.policy.length).toBeGreaterThan(40);
    expect(budgets.units.duration).toContain("decimal milliseconds");
    expect(budgets.units.payload).toContain("decimal bytes");
    expect(Array.isArray(budgets.known_exceptions)).toBe(true);
  });

  it("declares every required target with a positive value", () => {
    const budgets = JSON.parse(readFileSync(BUDGETS_PATH, "utf8"));
    for (const target of REQUIRED_TARGETS) {
      expect(budgets.targets, `missing target ${target}`).toHaveProperty(target);
      const value = budgets.targets[target];
      if (target.endsWith("_growth_max")) {
        expect(value, `target ${target} must be zero or positive`).toBeGreaterThanOrEqual(0);
      } else {
        expect(value, `target ${target} must be positive`).toBeGreaterThan(0);
      }
      expect(budgets.gate_stats, `missing gate stat for ${target}`).toHaveProperty(target);
    }
  });

  it("fixes the measurement protocol (viewports, runs, fixtures, cycles)", () => {
    const { measurement } = JSON.parse(readFileSync(BUDGETS_PATH, "utf8"));
    expect(measurement.fixture_symbol).toBe("POWERGRID.NS");
    expect(measurement.fixture_timeframes).toHaveLength(11);
    expect(measurement.fixture_bars).toBe(500);
    expect(measurement.warmup_runs).toBeGreaterThanOrEqual(1);
    expect(measurement.measured_runs).toBeGreaterThanOrEqual(3);
    expect(measurement.viewports).toEqual([
      { width: 1600, height: 1000 },
      { width: 390, height: 844 },
    ]);
    expect(measurement.cycles).toEqual({
      timeframe_switches: 20,
      menu_toggles: 10,
      fullscreen_cycles: 5,
    });
  });

  it("derives the Codespaces artifact root from the budget file", () => {
    expect(CODESPACES_ARTIFACT_DIR).toMatch(/^\/workspaces\/[^/]+\/\.agent-artifacts\/chart-perf$/);
    expect(CODESPACES_ARTIFACT_ROOT).toBe(
      `${CODESPACES_ARTIFACT_DIR.slice(0, -"/chart-perf".length)}/`,
    );
  });

  it("keeps the protocol doc discoverable and linked to the budget file", () => {
    expect(existsSync(DOC_PATH), `${DOC_PATH} is missing`).toBe(true);
    const doc = readFileSync(DOC_PATH, "utf8");
    expect(doc).toContain("perf/chart_ui_budgets.json");
    expect(doc).toContain("bun run perf:chart");
    expect(doc).toContain("CODESPACES=true");
    expect(doc).toContain(CODESPACES_ARTIFACT_DIR);
    expect(doc).toContain("1600×1000");
    expect(doc).toContain("390×844");
  });

  it("exposes the perf commands and keeps the budget file committable", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
    for (const script of REQUIRED_SCRIPTS) {
      expect(pkg.scripts, `missing package script ${script}`).toHaveProperty(script);
    }
    for (const script of PERF_SCRIPTS) {
      expect(existsSync(resolve(ROOT, script)), `missing ${script}`).toBe(true);
    }
    const ignore = readFileSync(resolve(ROOT, "perf/.gitignore"), "utf8");
    expect(ignore).toContain("!chart_ui_budgets.json");
  });

  it("keeps perf scripts on the derived Codespaces artifact root", () => {
    for (const script of PERF_SCRIPTS) {
      const source = readFileSync(resolve(ROOT, script), "utf8");
      expect(source, `${script} still uses the old workspace path`).not.toMatch(
        /\/workspaces\/react/,
      );
      expect(source, `${script} is missing the artifact root`).toContain(CODESPACES_ARTIFACT_DIR);
    }
  });

  it("keeps the agent rules wired to the protocol and gate", () => {
    const agents = readFileSync(AGENTS_PATH, "utf8");
    expect(agents).toContain("docs/CHART_PERFORMANCE.md");
    expect(agents).toContain("perf:chart");
    expect(agents).toContain(CODESPACES_ARTIFACT_ROOT);

    const rules = readFileSync(RULES_PATH, "utf8");
    expect(rules).toContain("## 12. Performance audit (mandatory for interactive UI)");
    expect(rules).toContain("p50/p95");
    expect(rules).toContain(".agent-artifacts");
  });
});
