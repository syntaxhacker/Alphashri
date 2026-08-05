import type {
  ExperimentStrategy,
  ExperimentSession,
  ExperimentRun,
  ExperimentState,
  SweepParam,
  ExperimentChartData,
} from "../types/experiments";
import { createSubscriber } from "./createSubscriber";
import * as api from "../api/experiments";

export interface ExperimentConfig {
  strategy: string;
  symbols: string[];
  tf: number;
  dateStart: string;
  dateEnd: string;
  includeCosts: boolean;
  description: string;
}

export interface ExperimentsState {
  strategies: ExperimentStrategy[];
  strategiesLoading: boolean;

  sessions: ExperimentSession[];
  sessionsLoading: boolean;
  activeSession: string | null;

  config: ExperimentConfig;

  fixedParams: Record<string, any>;
  sweeps: SweepParam[];

  state: ExperimentState | null;
  results: ExperimentRun[] | null;

  selectedRun: ExperimentRun | null;

  chartData: ExperimentChartData | null;
  chartLoading: boolean;

  error: string | null;
}

export const initialExperimentState: ExperimentsState = {
  strategies: [],
  strategiesLoading: false,

  sessions: [],
  sessionsLoading: false,
  activeSession: null,

  config: {
    strategy: "orb",
    symbols: ["NEWGEN"],
    tf: 5,
    dateStart: "",
    dateEnd: "",
    includeCosts: true,
    description: "",
  },

  fixedParams: {},
  sweeps: [],

  state: null,
  results: null,

  selectedRun: null,

  chartData: null,
  chartLoading: false,

  error: null,
};

let state: ExperimentsState = { ...initialExperimentState };

const { subscribe: _subscribe, notify } = createSubscriber();
export const subscribe = _subscribe;

export function getExperimentState(): ExperimentsState {
  return state;
}

function patchState(partial: Record<string, any>) {
  state = { ...state, ...partial };
  notify();
}

export function resetExperimentState() {
  state = { ...initialExperimentState };
  notify();
}

function buildParamDefaults(
  strategy: ExperimentStrategy,
): { fixedParams: Record<string, any>; sweeps: SweepParam[] } {
  const fixedParams: Record<string, any> = {};
  for (const p of strategy.params) {
    fixedParams[p.key] = p.default;
  }
  return { fixedParams, sweeps: [] };
}

function findParamDef(key: string): { label: string; default?: number | string | boolean } | null {
  const strategy = state.strategies.find((s) => s.key === state.config.strategy);
  const paramDef = strategy?.params.find((p) => p.key === key);
  return paramDef ? { label: paramDef.label, default: paramDef.default } : null;
}

export function setConfig(partial: Partial<ExperimentConfig>) {
  const config = { ...state.config, ...partial };
  const patch: Record<string, any> = { config };

  if (partial.strategy && partial.strategy !== state.config.strategy) {
    const strategy = state.strategies.find((s) => s.key === partial.strategy);
    if (strategy) {
      const { fixedParams, sweeps } = buildParamDefaults(strategy);
      patch.fixedParams = fixedParams;
      patch.sweeps = sweeps;
    }
  }

  patchState(patch);
}

export function setFixedParam(key: string, value: number | string | boolean) {
  state = { ...state, fixedParams: { ...state.fixedParams, [key]: value } };
  notify();
}

export function setSweep(key: string, values: (number | string | boolean)[]) {
  state = {
    ...state,
    sweeps: state.sweeps.map((s) => (s.key === key ? { ...s, values } : s)),
  };
  notify();
}

export function addSweepParam(key: string) {
  if (state.sweeps.some((s) => s.key === key)) return;

  const paramDef = findParamDef(key);
  const currentValue = state.fixedParams[key] ?? paramDef?.default;
  const values: (number | string | boolean)[] =
    currentValue !== undefined && currentValue !== null ? [currentValue] : [];

  const { [key]: _removed, ...restFixedParams } = state.fixedParams;

  state = {
    ...state,
    sweeps: [...state.sweeps, { key, label: paramDef?.label || key, values }],
    fixedParams: restFixedParams,
  };
  notify();
}

export function removeSweepParam(key: string) {
  const sweep = state.sweeps.find((s) => s.key === key);
  if (!sweep) return;

  const paramDef = findParamDef(key);
  const restoredValue =
    sweep.values[sweep.values.length - 1] ?? paramDef?.default;

  const fixedParams = { ...state.fixedParams };
  if (restoredValue !== undefined && restoredValue !== null) {
    fixedParams[key] = restoredValue;
  }

  state = {
    ...state,
    sweeps: state.sweeps.filter((s) => s.key !== key),
    fixedParams,
  };
  notify();
}

export function resetConfig() {
  const strategy = state.strategies.find(
    (s) => s.key === initialExperimentState.config.strategy,
  );
  const { fixedParams, sweeps } = strategy
    ? buildParamDefaults(strategy)
    : { fixedParams: {}, sweeps: [] };

  state = {
    ...state,
    config: { ...initialExperimentState.config },
    fixedParams,
    sweeps,
  };
  notify();
}

export function setStrategies(strategies: ExperimentStrategy[]) {
  patchState({ strategies });
}

export function setStrategiesLoading(loading: boolean) {
  patchState({ strategiesLoading: loading });
}

export function setSessions(sessions: ExperimentSession[]) {
  patchState({ sessions });
}

export function setSessionsLoading(loading: boolean) {
  patchState({ sessionsLoading: loading });
}

export function setActiveSession(activeSession: string | null) {
  patchState({ activeSession });
}

export function setSessionState(expState: ExperimentState) {
  patchState({ state: expState });
}

export function setResults(results: ExperimentRun[] | null) {
  patchState({ results });
}

export function setSelectedRun(selectedRun: ExperimentRun | null) {
  patchState({ selectedRun });
}

export function setChartData(chartData: ExperimentChartData | null) {
  patchState({ chartData });
}

export function setChartLoading(loading: boolean) {
  patchState({ chartLoading: loading });
}

export function setError(error: string | null) {
  patchState({ error });
}

// --- Orchestration actions ---

export async function fetchStrategies(): Promise<ExperimentStrategy[]> {
  setStrategiesLoading(true);
  try {
    const strategies = await api.fetchStrategies();
    setStrategies(strategies);
    if (strategies.length > 0) {
      const known = strategies.find((s) => s.key === state.config.strategy);
      const strategy = known || strategies[0];
      const { fixedParams, sweeps } = buildParamDefaults(strategy);
      const defaultSweeps = seedDefaultSweeps(strategy, sweeps);
      patchState({
        fixedParams,
        sweeps: defaultSweeps,
        config: { ...state.config, strategy: strategy.key },
      });
    }
    return strategies;
  } finally {
    setStrategiesLoading(false);
  }
}

function seedDefaultSweeps(
  strategy: ExperimentStrategy,
  sweeps: SweepParam[],
): SweepParam[] {
  // Pre-populate one sweep param so the user can hit Start immediately.
  if (strategy.key === "orb") {
    const orMin = strategy.params.find((p) => p.key === "or_minutes");
    if (orMin) {
      const existing = sweeps.find((s) => s.key === "or_minutes");
      if (!existing) {
        return [...sweeps, { key: "or_minutes", label: orMin.label, values: [5, 10, 15] }];
      }
    }
  }
  return sweeps;
}

export async function fetchSessions(): Promise<ExperimentSession[]> {
  setSessionsLoading(true);
  try {
    const sessions = await api.fetchSessions();
    setSessions(sessions);
    return sessions;
  } finally {
    setSessionsLoading(false);
  }
}

export async function fetchSessionState(session: string): Promise<ExperimentState | null> {
  const expState = await api.fetchSessionState(session);
  if (expState) setSessionState(expState);
  return expState;
}

export async function fetchResults(session: string): Promise<ExperimentRun[] | null> {
  const runs = await api.fetchResults(session);
  if (runs) setResults(runs);
  return runs;
}

let _selectToken = 0;

export async function selectSession(session: string): Promise<ExperimentState | null> {
  const token = ++_selectToken;
  setActiveSession(session);
  setSelectedRun(null);
  setChartData(null);
  const [expState, runs] = await Promise.all([
    api.fetchSessionState(session),
    api.fetchResults(session),
  ]);
  // Ignore stale responses from a previous rapid click (A then B) so the
  // slower session A fetch can't overwrite the store while B is active.
  if (token !== _selectToken) return null;
  if (expState) setSessionState(expState);
  if (runs) setResults(runs);
  return expState ?? null;
}

function buildParamSpace(): Record<string, any> {
  const paramSpace: Record<string, any> = { ...state.fixedParams };
  for (const sweep of state.sweeps) {
    if (sweep.values.length > 0) {
      paramSpace[sweep.key] = sweep.values;
    }
  }
  return paramSpace;
}

export async function startExperiment(): Promise<{ session: string } | null> {
  const { config } = state;
  const session = `exp_${config.strategy}_${Date.now()}`;

  const result = await api.startExperiment({
    session,
    strategy: config.strategy,
    symbols: config.symbols,
    tf: config.tf,
    param_space: buildParamSpace(),
    date_start: config.dateStart || undefined,
    date_end: config.dateEnd || undefined,
    include_costs: config.includeCosts,
    description: config.description || undefined,
  });

  if (result && result.session) {
    setActiveSession(result.session);
    await Promise.all([fetchSessionState(result.session), fetchResults(result.session)]);
    await fetchSessions();
  }
  return result;
}

export async function pauseExperiment(): Promise<boolean> {
  if (!state.activeSession) return false;
  const ok = await api.pauseExperiment(state.activeSession);
  if (ok) await fetchSessionState(state.activeSession);
  return ok;
}

export async function resumeExperiment(): Promise<boolean> {
  if (!state.activeSession) return false;
  const ok = await api.resumeExperiment(state.activeSession);
  if (ok) await fetchSessionState(state.activeSession);
  return ok;
}

export async function cancelExperiment(): Promise<boolean> {
  if (!state.activeSession) return false;
  const ok = await api.cancelExperiment(state.activeSession);
  if (ok) await fetchSessionState(state.activeSession);
  return ok;
}

export async function fetchRunChart(
  runId: number | string,
  symbol: string,
): Promise<ExperimentChartData | null> {
  if (!state.activeSession) return null;
  const data = await api.fetchRunChart(state.activeSession, runId, symbol);
  if (data) setChartData(data);
  return data;
}

export async function selectRun(run: ExperimentRun): Promise<ExperimentChartData | null> {
  setSelectedRun(run);
  setChartData(null);
  const symbol = run.symbols[0];
  if (!symbol) return null;
  return fetchRunChart(run.run, symbol);
}

// --- Polling helpers ---

let pollTimer: ReturnType<typeof setInterval> | null = null;

export function stopPolling() {
  if (pollTimer != null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export async function pollExperimentState(session: string): Promise<boolean> {
  const expState = await api.fetchSessionState(session);
  if (!expState) return true;
  const terminal = ["completed", "cancelled", "error"].includes(expState.status);
  if (terminal) stopPolling();
  return terminal;
}

export function startPolling(session: string, intervalMs = 2000) {
  stopPolling();
  void pollExperimentState(session);
  pollTimer = setInterval(() => {
    void pollExperimentState(session);
  }, intervalMs);
}
