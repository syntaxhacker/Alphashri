import type {
  ExperimentStrategy,
  ExperimentSession,
  ExperimentRun,
  ExperimentState,
  SweepParam,
  ExperimentChartData,
} from "../types/experiments";
import {
  setStrategies,
  setSessions,
  setSessionState,
  setResults,
  setChartData,
  setChartLoading,
  setError,
} from "../state/experiments";
import { fetchWithAuth } from "../state/auth";
import { showError } from "@/ui";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

export interface StartExperimentPayload {
  session: string;
  strategy: string;
  symbols: string[];
  tf: number;
  param_space: Record<string, any>;
  date_start?: string;
  date_end?: string;
  include_costs?: boolean;
  description?: string;
}

function showExperimentError(message: string) {
  showError("Experiments Error", message);
}

async function parseError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body.detail || body.error || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

export function getSweepGridSize(sweeps: SweepParam[]): number {
  const nonEmpty = sweeps.filter((s) => s.values.length > 0);
  if (nonEmpty.length === 0) return 1;
  return nonEmpty.reduce((acc, s) => acc * s.values.length, 1);
}

export async function fetchStrategies(): Promise<ExperimentStrategy[]> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/experiments/strategies`);

    if (!response.ok) {
      const msg = await parseError(response);
      setError(msg);
      showExperimentError(msg);
      return [];
    }

    const data = await response.json();
    const strategies: ExperimentStrategy[] = Array.isArray(data.strategies)
      ? data.strategies
      : [];
    setStrategies(strategies);
    return strategies;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to fetch strategies";
    setError(msg);
    showExperimentError(msg);
    return [];
  }
}

export async function fetchSessions(): Promise<ExperimentSession[]> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/experiments/list`);

    if (!response.ok) {
      const msg = await parseError(response);
      setError(msg);
      showExperimentError(msg);
      return [];
    }

    const data = await response.json();
    const sessions: ExperimentSession[] = Array.isArray(data) ? data : data.sessions || [];
    setSessions(sessions);
    return sessions;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to fetch sessions";
    setError(msg);
    showExperimentError(msg);
    return [];
  }
}

export async function fetchSessionState(session: string): Promise<ExperimentState | null> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/experiments/${session}/state`);

    if (!response.ok) {
      const msg = await parseError(response);
      setError(msg);
      showExperimentError(msg);
      return null;
    }

    const data: ExperimentState = await response.json();
    setSessionState(data);
    return data;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to fetch session state";
    setError(msg);
    showExperimentError(msg);
    return null;
  }
}

export async function fetchResults(session: string): Promise<ExperimentRun[] | null> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/experiments/${session}/results`);

    if (!response.ok) {
      const msg = await parseError(response);
      setError(msg);
      showExperimentError(msg);
      return null;
    }

    const data = await response.json();
    const runs: ExperimentRun[] = Array.isArray(data) ? data : data.runs || [];
    setResults(runs);
    return runs;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to fetch results";
    setError(msg);
    showExperimentError(msg);
    return null;
  }
}

export async function startExperiment(
  payload: StartExperimentPayload,
): Promise<{ session: string } | null> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/experiments/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const msg = await parseError(response);
      setError(msg);
      showExperimentError(msg);
      return null;
    }

    const data = await response.json();

    if (data.error) {
      setError(data.error);
      showExperimentError(data.error);
      return null;
    }

    return data.session ? { session: data.session } : data;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to start experiment";
    setError(msg);
    showExperimentError(msg);
    return null;
  }
}

async function controlExperiment(
  session: string,
  action: "pause" | "resume" | "cancel",
): Promise<boolean> {
  try {
    const response = await fetchWithAuth(
      `${API_BASE}/api/experiments/${session}/${action}`,
      { method: "POST" },
    );

    if (!response.ok) {
      const msg = await parseError(response);
      setError(msg);
      showExperimentError(msg);
      return false;
    }

    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : `Failed to ${action} experiment`;
    setError(msg);
    showExperimentError(msg);
    return false;
  }
}

export function pauseExperiment(session: string): Promise<boolean> {
  return controlExperiment(session, "pause");
}

export function resumeExperiment(session: string): Promise<boolean> {
  return controlExperiment(session, "resume");
}

export function cancelExperiment(session: string): Promise<boolean> {
  return controlExperiment(session, "cancel");
}

export async function fetchRunChart(
  session: string,
  runId: number | string,
  symbol: string,
): Promise<ExperimentChartData | null> {
  setChartLoading(true);

  try {
    const response = await fetchWithAuth(
      `${API_BASE}/api/experiments/${session}/chart/${runId}?symbol=${encodeURIComponent(symbol)}`,
    );

    if (!response.ok) {
      setChartLoading(false);
      const msg = await parseError(response);
      setError(msg);
      showExperimentError(msg);
      return null;
    }

    const data: ExperimentChartData = await response.json();
    setChartData(data);
    setChartLoading(false);
    return data;
  } catch (error) {
    setChartLoading(false);
    const msg = error instanceof Error ? error.message : "Failed to fetch run chart";
    setError(msg);
    showExperimentError(msg);
    return null;
  }
}
