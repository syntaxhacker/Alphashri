/**
 * Market → Vis "Sector correlation".
 *
 * Chart form: the D3 gallery's *Heatmap* / correlation-matrix layout — a square
 * grid of sector × sector cells, one diverging hue per coefficient. Reference:
 * https://observablehq.com/@d3/gallery (Heatmap) and
 * https://echarts.apache.org/examples/en/ (heatmap cartesian example).
 * Correlation is a signed relationship, not a gain/loss, so cells use the
 * non-P&L VIZ_SCALE (RdBu) ramp and never the terminal bull/bear pair.
 */
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import { Box, Button, Skeleton, Text, ToolbarRow, useMediaQuery } from "@/ui";
import {
  VIZ_BG,
  VIZ_DOWN,
  VIZ_GRID,
  VIZ_MUTED,
  VIZ_PANEL,
  VIZ_SCALE,
  VIZ_TEXT,
} from "@/ui/palette";
import { pickTextColor } from "@/utils/contrast";
import { fetchWithAuth } from "@/state/auth";
import { API_ENDPOINTS } from "@/api/config";
import type { SectorCorrelationResponse } from "@/api/sectorCorrelation";
import type { VisRenderProps } from "./MarketMapView";

export const CORRELATION_LOOKBACK_DAYS = 90;
const CELL_SIZE = 48;
const LABEL_WIDTH = 128;

export interface CorrelationMatrixData {
  names: string[];
  matrix: number[][];
  lastUpdated?: string;
}

type LoadPhase =
  | { status: "loading" }
  | { status: "ready"; data: CorrelationMatrixData }
  | { status: "empty" }
  | { status: "error"; message: string };

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * The matrix rows and `sector_names` come from the same backend computation;
 * `sectors` is a separately sorted rank list, so it must not be used for labels.
 * A shape mismatch is a failure, never a half-rendered grid.
 */
export function normalizeCorrelationPayload(payload: unknown): CorrelationMatrixData | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Record<string, unknown>;
  if (!Array.isArray(raw.sector_names) || !Array.isArray(raw.correlation_matrix)) return null;
  if (raw.sector_names.some((name) => typeof name !== "string")) return null;
  const names = raw.sector_names as string[];
  if (names.length === 0) return raw.correlation_matrix.length === 0 ? { names: [], matrix: [] } : null;
  if (raw.correlation_matrix.length !== names.length) return null;

  const matrix: number[][] = [];
  for (const row of raw.correlation_matrix) {
    if (!Array.isArray(row) || row.length !== names.length || row.some((v) => !isFiniteNumber(v))) {
      return null;
    }
    matrix.push([...row] as number[]);
  }
  return {
    names,
    matrix,
    lastUpdated: typeof raw.last_updated === "string" ? raw.last_updated : undefined,
  };
}

/** -1 → deep red, 0 → pale neutral, +1 → deep blue (D3 schemeRdBu[9]). */
export function correlationColor(value: number): string {
  const bounded = isFiniteNumber(value) ? Math.max(-1, Math.min(1, value)) : 0;
  const position = ((bounded + 1) / 2) * (VIZ_SCALE.length - 1);
  return VIZ_SCALE[Math.round(position)]!;
}

export function formatCorrelation(value: number): string {
  const clean = Math.abs(value) < 0.005 ? 0 : value;
  return clean.toFixed(2);
}

/** Compact, mutually distinct header tokens; the full name stays in title/aria-label. */
const SECTOR_SHORT_CODES: Readonly<Record<string, string>> = {
  "NIFTY 50": "N50",
  "NIFTY BANK": "NBK",
  "NIFTY IT": "NIT",
  "NIFTY FMCG": "NFMC",
  "NIFTY PHARMA": "NPHAR",
  "NIFTY AUTO": "NAUT",
  "NIFTY ENERGY": "NENR",
  "NIFTY REALTY": "NRLT",
  "NIFTY METAL": "NMET",
  "NIFTY CONSUMPTION": "NCONS",
  "NIFTY FIN_SERVICE": "NFIN",
};

export function shortSectorLabel(name: string): string {
  const key = name.trim().toUpperCase();
  const known = SECTOR_SHORT_CODES[key];
  if (known) return known;

  const words = key.split(/[^A-Z0-9]+/).filter(Boolean);
  const core = words.filter((word) => word !== "NIFTY" && word !== "INDEX" && word !== "NSE");
  const acronym = (core.length > 0 ? core : words).map((word) => word[0]!).join("");

  // Unlisted sectors still need a stable token that cannot silently duplicate
  // another column; a short name hash keeps the fallback deterministic.
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const suffix = hash.toString(36).toUpperCase().slice(-2).padStart(2, "0");
  let code = `N${acronym || "X"}${suffix}`;
  if (Object.values(SECTOR_SHORT_CODES).includes(code)) code += suffix;
  return code;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ISO `YYYY-MM-DD…` → `28 Nov`, parsed as text so the day never shifts by timezone. */
export function formatAsOfShort(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month}` : value;
}

export function CorrelationMatrixView(props: VisRenderProps) {
  const market = () => (props.currency === "USD" ? "america" : "india");
  const wide = useMediaQuery("(min-width: 640px)", true);
  const [phase, setPhase] = createSignal<LoadPhase>({ status: "loading" });

  let disposed = false;
  let requestSeq = 0;
  const controllers = new Set<AbortController>();

  const load = async () => {
    const id = ++requestSeq;
    const controller = new AbortController();
    controllers.add(controller);
    setPhase({ status: "loading" });

    try {
      const url =
        `${API_ENDPOINTS.SECTOR}/correlation` +
        `?market=${market()}&lookback_days=${CORRELATION_LOOKBACK_DAYS}`;
      const response = await fetchWithAuth(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Sector correlation request failed (${response.status})`);
      const payload = (await response.json()) as SectorCorrelationResponse;
      // A superseded request must not paint over a newer refresh or a dead view.
      if (disposed || id !== requestSeq) return;
      const data = normalizeCorrelationPayload(payload);
      if (!data) {
        setPhase({ status: "error", message: "Unexpected sector correlation payload." });
      } else if (data.names.length === 0) {
        setPhase({ status: "empty" });
      } else {
        setPhase({ status: "ready", data });
      }
    } catch (error) {
      if (disposed || id !== requestSeq || controller.signal.aborted) return;
      setPhase({
        status: "error",
        message: error instanceof Error && error.message
          ? error.message
          : "Could not load sector correlation.",
      });
    } finally {
      controllers.delete(controller);
    }
  };

  // The universe is chosen by `currency`, so a market switch must refetch —
  // otherwise an Indian matrix stays painted under a US universe. The
  // requestSeq/AbortController guard above makes overlapping loads safe.
  createEffect(on(() => market(), () => void load()));

  onCleanup(() => {
    disposed = true;
    for (const controller of controllers) controller.abort();
    controllers.clear();
  });

  const data = createMemo(() => {
    const current = phase();
    return current.status === "ready" ? current.data : undefined;
  });
  const names = createMemo(() => data()?.names ?? []);
  const gridColumns = createMemo(
    () => `${LABEL_WIDTH}px repeat(${names().length}, ${CELL_SIZE}px)`,
  );

  const refreshButton = () => (
    <button
      type="button"
      data-testid="correlation-refresh"
      className="h-6 shrink-0 rounded-fin border px-2 hover:text-fin-text"
      style={{ "border-color": VIZ_GRID, color: VIZ_TEXT }}
      onClick={() => void load()}
    >
      <Text span size="xs" fw={600} c={VIZ_TEXT}>
        Refresh
      </Text>
    </button>
  );

  return (
    <Box
      className="flex-1 min-w-0 min-h-0 flex flex-col"
      style={{ "background-color": VIZ_BG, color: VIZ_TEXT }}
      data-testid="correlation-matrix-view"
    >
      <Show
        when={wide()}
        fallback={
          <Box
            className="flex flex-shrink-0 flex-col gap-1 border-b px-2 py-1"
            style={{ "border-color": VIZ_GRID }}
            data-testid="correlation-toolbar"
          >
            <ToolbarRow gap={8} wrap={false} className="min-w-0">
              <Text span size="xs" fw={600} c={VIZ_TEXT} className="whitespace-nowrap">
                Sector correlation
              </Text>
              <Text span size="xs" c={VIZ_MUTED} className="whitespace-nowrap" data-testid="correlation-count">
                {names().length} × {names().length} sectors
              </Text>
              <Box className="flex-1 min-w-0" />
              <Show when={data()?.lastUpdated}>
                {(updated) => (
                  <Text
                    span
                    size="xs"
                    c={VIZ_MUTED}
                    title={updated()}
                    className="whitespace-nowrap"
                    data-testid="correlation-updated"
                  >
                    as of {formatAsOfShort(updated())}
                  </Text>
                )}
              </Show>
            </ToolbarRow>
            <Box className="flex min-w-0 items-center justify-end">
              {refreshButton()}
            </Box>
          </Box>
        }
      >
        <ToolbarRow
          gap={8}
          wrap={false}
          className="h-10 flex-shrink-0 border-b px-2"
          style={{ "border-color": VIZ_GRID }}
          data-testid="correlation-toolbar"
        >
          <Text span size="xs" fw={600} c={VIZ_TEXT}>
            Sector correlation
          </Text>
          <Text span size="xs" c={VIZ_MUTED} data-testid="correlation-count">
            {names().length} × {names().length} sectors
          </Text>
          <Box className="flex-1 min-w-0" />
          <Show when={data()?.lastUpdated}>
            {(updated) => (
              <Text
                span
                size="xs"
                c={VIZ_MUTED}
                title={updated()}
                className="whitespace-nowrap"
                data-testid="correlation-updated"
              >
                updated {updated().slice(0, 10)}
              </Text>
            )}
          </Show>
          {refreshButton()}
        </ToolbarRow>
      </Show>

      <Switch
        fallback={
          <Show when={data()}>
            {(matrixData) => (
              <Box className="flex-1 min-w-0 min-h-0 flex flex-col">
                <Text
                  span
                  size="xs"
                  c={VIZ_MUTED}
                  className="flex-shrink-0 px-2 pt-1"
                  data-testid="correlation-scroll-cue"
                >
                  Scroll horizontally →
                </Text>
                <Box
                  className="flex-1 min-w-0 min-h-0 overflow-auto p-2"
                  role="region"
                  aria-label="Sector correlation matrix (scrollable)"
                  tabIndex={0}
                  data-testid="correlation-scroll"
                >
                  <div
                    role="table"
                    aria-label="Sector correlation matrix"
                    className="grid gap-px"
                    style={{
                      "grid-template-columns": gridColumns(),
                      width: "max-content",
                    }}
                    data-testid="correlation-grid"
                  >
                    <div role="columnheader" aria-label="Sector" />
                    <For each={names()}>
                      {(name) => (
                        <Box
                          component="div"
                          role="columnheader"
                          title={name}
                          aria-label={name}
                          className="flex items-center justify-center whitespace-nowrap"
                          style={{ width: `${CELL_SIZE}px` }}
                          data-testid="correlation-col-label"
                          data-code={shortSectorLabel(name)}
                        >
                          <Text span size="xs" fw={600} c={VIZ_MUTED}>
                            {shortSectorLabel(name)}
                          </Text>
                        </Box>
                      )}
                    </For>
                    <For each={names()}>
                      {(rowName, rowIndex) => (
                        <>
                          <Box
                            component="div"
                            role="rowheader"
                            title={rowName}
                            className="flex items-center pr-2 overflow-hidden"
                            style={{ width: `${LABEL_WIDTH}px` }}
                            data-testid="correlation-row-label"
                          >
                            <Text span size="xs" c={VIZ_MUTED} truncate className="min-w-0">
                              {rowName}
                            </Text>
                          </Box>
                          <For each={names()}>
                            {(colName, colIndex) => {
                              const value = () => matrixData().matrix[rowIndex()][colIndex()];
                              const fill = () => correlationColor(value());
                              return (
                                <Box
                                  component="div"
                                  role="cell"
                                  title={`${rowName} × ${colName} = ${formatCorrelation(value())}`}
                                  className="flex items-center justify-center font-mono tabular-nums"
                                  style={{
                                    width: `${CELL_SIZE}px`,
                                    height: `${CELL_SIZE}px`,
                                    "background-color": fill(),
                                    color: pickTextColor(fill()),
                                  }}
                                  data-testid="correlation-cell"
                                  data-row={rowIndex()}
                                  data-col={colIndex()}
                                >
                                  {formatCorrelation(value())}
                                </Box>
                              );
                            }}
                          </For>
                        </>
                      )}
                    </For>
                  </div>
                </Box>
              </Box>
            )}
          </Show>
        }
      >
        <Match when={phase().status === "loading"}>
          <Box
            className="flex-1 min-w-0 min-h-0 p-2"
            style={{ "background-color": VIZ_PANEL }}
            data-testid="correlation-loading"
          >
            <For each={[0, 1, 2, 3]}>
              {() => (
                <Box className="flex gap-px">
                  <For each={[0, 1, 2, 3]}>
                    {() => (
                      <Skeleton
                        h={CELL_SIZE}
                        w={CELL_SIZE}
                        radius="sm"
                        data-testid="correlation-skeleton"
                      />
                    )}
                  </For>
                </Box>
              )}
            </For>
          </Box>
        </Match>
        <Match when={phase().status === "error"}>
          <Box
            className="flex-1 min-w-0 min-h-0 flex flex-col items-center justify-center gap-3 p-4"
            data-testid="correlation-error"
          >
            <Text span size="sm" c={VIZ_DOWN}>
              {(phase() as Extract<LoadPhase, { status: "error" }>).message}
            </Text>
            <Button size="xs" data-testid="correlation-retry" onClick={() => void load()}>
              Retry
            </Button>
          </Box>
        </Match>
        <Match when={phase().status === "empty"}>
          <Box
            className="flex-1 min-w-0 min-h-0 flex items-center justify-center p-4"
            data-testid="correlation-empty"
          >
            <Text span size="sm" c={VIZ_MUTED}>
              No sector correlation data.
            </Text>
          </Box>
        </Match>
      </Switch>

      <Show
        when={wide()}
        fallback={
          <Box
            className="flex flex-shrink-0 flex-col gap-1 border-t px-2 py-1"
            style={{ "border-color": VIZ_GRID, "background-color": VIZ_PANEL }}
            data-testid="correlation-legend"
          >
            <Box className="flex items-center" data-testid="correlation-scale">
              <Box
                className="h-2 w-24 flex-shrink-0 rounded-fin"
                style={{ "background-image": `linear-gradient(to right, ${VIZ_SCALE.join(", ")})` }}
                data-testid="correlation-ramp"
              />
              <Box className="flex items-center gap-2 pl-2">
                <Text span size="xs" c={VIZ_MUTED}>−1</Text>
                <Text span size="xs" c={VIZ_MUTED}>0</Text>
                <Text span size="xs" c={VIZ_MUTED}>+1</Text>
              </Box>
            </Box>
            <Box className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Text span size="xs" c={VIZ_MUTED} data-testid="correlation-caption">
                correlation, not gain/loss
              </Text>
              <Text span size="xs" c={VIZ_MUTED} data-testid="correlation-caption-detail">
                −1 inverse · +1 co-movement
              </Text>
            </Box>
          </Box>
        }
      >
        <ToolbarRow
          gap={8}
          wrap={false}
          className="h-10 flex-shrink-0 border-t px-2"
          style={{ "border-color": VIZ_GRID, "background-color": VIZ_PANEL }}
          data-testid="correlation-legend"
        >
          <Box className="flex flex-col gap-1" data-testid="correlation-scale">
            <Box
              className="h-2 w-32 rounded-fin"
              style={{ "background-image": `linear-gradient(to right, ${VIZ_SCALE.join(", ")})` }}
              data-testid="correlation-ramp"
            />
            <Box className="flex w-32 justify-between">
              <Text span size="xs" c={VIZ_MUTED}>−1</Text>
              <Text span size="xs" c={VIZ_MUTED}>0</Text>
              <Text span size="xs" c={VIZ_MUTED}>+1</Text>
            </Box>
          </Box>
          <Text span size="xs" c={VIZ_MUTED} className="whitespace-nowrap" data-testid="correlation-caption">
            correlation, not gain/loss
          </Text>
          <Box className="flex-1 min-w-0" />
          <Text span size="xs" c={VIZ_MUTED} className="whitespace-nowrap" data-testid="correlation-caption-detail">
            −1 inverse · +1 co-movement
          </Text>
        </ToolbarRow>
      </Show>
    </Box>
  );
}
