import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Select,
  Switch,
  Text,
  ToolbarRow,
} from "@/ui";
import { IconBolt, IconPlayerPlay, IconPlus, IconTrash } from "@tabler/icons-react";
import { PanelModal } from "@/components/common/PanelModal";
import { fetchSimStrategies, runSim } from "@/api/reportSim";
import type { NiftyReplay, NiftyReport } from "@/types/niftyReport";
import type {
  SimRunResult,
  SimStrategySpec,
  SimTemplate,
} from "@/types/reportSim";
import { formatNumberIN } from "@/utils/ui-helpers";
import { isDerivativesOpenIst } from "@/utils/marketClock";
import {
  SIM_TEMPLATES,
  buildLadder,
  newStrategy,
  nextStrategyId,
  validateStrategy,
} from "./simSpec";
import { fmtSignedInr, fmtTime } from "./simFormat";
import { SimBuilder, SimContextStrip } from "./SimBuilder";
import { SimPayoff } from "./SimPayoff";
import { SimRuns } from "./SimRuns";
import { combinedViewAt, selectedStrategy, strategyViewAt } from "./simView";
import type { StrategyView } from "./simView";

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      span
      size="xs"
      fw={700}
      c="dimmed"
      className="uppercase tracking-[0.06em]"
    >
      {children}
    </Text>
  );
}

export interface SimDeskProps {
  symbol: string;
  mode: "live" | "eod";
  date: string;
  report: NiftyReport | null;
  replay: NiftyReplay | null;
  replayIndex: number;
}

const LIVE_REFRESH_MS = 10_000;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function points(value: unknown): string {
  return finite(value) ? formatNumberIN(Math.round(value)) : "—";
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

export function SimDesk({
  symbol,
  mode,
  date,
  report,
  replay,
  replayIndex,
}: SimDeskProps) {
  const [open, setOpen] = useState(false);
  const [strategies, setStrategies] = useState<SimStrategySpec[]>(() => [
    newStrategy(1, "long-call"),
  ]);
  const [selectedId, setSelectedId] = useState(() => "sc-1");
  const [result, setResult] = useState<SimRunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [templates, setTemplates] = useState<SimTemplate[]>(SIM_TEMPLATES);

  const abortRef = useRef<AbortController | null>(null);

  const ladder = useMemo(
    () => buildLadder(report?.strikes ?? [], report?.spot ?? 0),
    [report],
  );
  const spot = finite(report?.spot) ? report.spot : result?.spot ?? 0;
  // After the close there is nothing to poll: force the recorded-session view
  // even if the parent report was manually left on Live. The time gate is the
  // primary one — an EOD report's `is_open` can be absent on older snapshots.
  const marketClosed = !isDerivativesOpenIst() || report?.market?.is_open === false;
  const effectiveMode: "live" | "eod" = marketClosed ? "eod" : mode;
  const runDate =
    effectiveMode === "eod"
      ? date || report?.date || report?.market?.session_date || undefined
      : undefined;

  useEffect(() => {
    let alive = true;
    fetchSimStrategies()
      .then((rows) => {
        if (alive && rows.length > 0) setTemplates(rows);
      })
      .catch(() => {
        // The local templates are enough; a failed fetch must not block the desk.
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(async () => {
    const errors = strategies.flatMap((strategy) => validateStrategy(strategy));
    if (errors.length > 0) {
      setError(errors[0]);
      return;
    }
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    try {
      const next = await runSim(
        {
          symbol,
          date: runDate,
          strategies,
          costs: true,
          slippageTicks: 0,
        },
        controller.signal,
      );
      if (!controller.signal.aborted) setResult(next);
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(errorMessage(err, "Sim run failed"));
      }
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }, [strategies, symbol, runDate]);

  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (!open) return;
    void runRef.current();
  }, [open, symbol, runDate, effectiveMode]);

  useEffect(() => {
    if (!open || !live || effectiveMode !== "live") return;
    const id = window.setInterval(() => void runRef.current(), LIVE_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [open, live, effectiveMode]);

  // A newly added or edited strategy has no row in the last result. Debounce
  // a fresh run so the desk never sits on a stale "Run the desk" state.
  const lastRunStrategiesRef = useRef(strategies);
  useEffect(() => {
    if (!open) return;
    if (lastRunStrategiesRef.current === strategies) return;
    lastRunStrategiesRef.current = strategies;
    const id = window.setTimeout(() => void runRef.current(), 600);
    return () => window.clearTimeout(id);
  }, [strategies, open]);

  const selectedSpec = strategies.find((item) => item.id === selectedId) ?? strategies[0];

  const addStrategy = useCallback(
    (templateId?: string) => {
      const created = newStrategy(strategies.length + 1, templateId);
      const id = nextStrategyId(strategies);
      const next = { ...created, id };
      setStrategies((prev) => [...prev, next]);
      setSelectedId(id);
    },
    [strategies],
  );

  const updateStrategy = useCallback((next: SimStrategySpec) => {
    setStrategies((prev) => prev.map((item) => (item.id === next.id ? next : item)));
  }, []);

  const removeStrategy = useCallback(
    (id: string) => {
      if (strategies.length <= 1) return;
      const next = strategies.filter((item) => item.id !== id);
      setStrategies(next);
      if (selectedId === id) setSelectedId(next[0].id);
    },
    [strategies, selectedId],
  );

  const asOf =
    effectiveMode === "eod" ? (replay?.snapshots?.[replayIndex]?.t ?? null) : null;
  const selectedResult = selectedStrategy(result, selectedId);
  const view: StrategyView | null = selectedResult
    ? strategyViewAt(selectedResult, asOf)
    : null;
  const combined = result ? combinedViewAt(result, asOf) : null;

  // Coverage must stop at the playhead too: the full-day frame count would
  // reveal how long the session ran while scrubbing the open.
  const coverageFrames = view?.equity.length ?? 0;
  const coverageText = result
    ? `${coverageFrames} frame${coverageFrames === 1 ? "" : "s"} · ${fmtTime(
        view?.equity[0]?.t,
      )}→${fmtTime(view?.equity.at(-1)?.t)}${
        asOf ? "" : ` · ${finite(result.coverage.gaps) ? result.coverage.gaps : "—"} gaps`
      }`
    : "—";
  const fillModel = result?.fillModel || "next-minute close fill · costs on · 0 slippage";
  const expiryText = result?.expiry || report?.expiry || "—";
  const dteText = result && finite(result.dte) ? `${result.dte}d` : "—";
  const spotText = points(spot);
  const lotText =
    result && finite(result.lotSize) ? formatNumberIN(result.lotSize) : "—";
  const tapeLagText =
    result && finite(result.tapeLagSec) ? `${Math.round(result.tapeLagSec)}s` : "—";
  const deskTotalText = combined ? fmtSignedInr(combined.total) : "—";
  const validationErrors = selectedSpec ? validateStrategy(selectedSpec) : [];

  return (
    <>
      <Button
        data-testid="sim-open"
        size="sm"
        variant="default"
        leftSection={<IconBolt size={14} />}
        onClick={() => setOpen(true)}
      >
        {strategies.length > 0 ? `SIM · ${strategies.length}` : "SIM"}
      </Button>

      <PanelModal
        open={open}
        variant="drawer"
        drawerWidth={1080}
        title={`SIM DESK · ${symbol}`}
        onClose={() => setOpen(false)}
        actions={
          <>
            <Text
              size="xs"
              c="dimmed"
              title={fillModel}
              className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
            >
              {fillModel}
            </Text>
            {marketClosed ? (
              <Badge data-testid="sim-market-closed" size="xs" color="warning" variant="outline">
                MARKET CLOSED · EOD
              </Badge>
            ) : null}
            {effectiveMode === "live" ? (
              <Switch
                data-testid="sim-live"
                size="xs"
                label="LIVE"
                checked={live}
                onChange={(event) => setLive(event.target.checked)}
              />
            ) : null}
            <Button
              data-testid="sim-run"
              size="sm"
              loading={loading}
              leftSection={<IconPlayerPlay size={14} />}
              onClick={() => void runRef.current()}
            >
              RUN
            </Button>
          </>
        }
      >
        <Box className="flex flex-col gap-2 min-w-0">
          <SimContextStrip
            mode={effectiveMode}
            date={runDate ?? date}
            expiry={expiryText}
            dte={dteText}
            spot={spotText}
            lotSize={lotText}
            lotVerified={result ? result.lotVerified : true}
            coverageText={coverageText}
            tapeLag={tapeLagText}
            deskTotal={deskTotalText}
          />
          {result?.expiryNote ? (
            <Text
              data-testid="sim-expiry-note"
              size="xs"
              fw={600}
              c="warning.main"
              className="leading-[1.45]"
            >
              ⚠ {result.expiryNote}
            </Text>
          ) : null}

          <Box
            className="flex flex-col min-[900px]:flex-row gap-2 min-w-0 min-h-0"
          >
            <Box
              data-testid="sim-rail"
              className="w-full min-[900px]:w-[220px] shrink-0 flex flex-col gap-1.5 min-w-0"
            >
              <ToolbarRow justify="space-between">
                <Text span size="xs" fw={700} className="uppercase">
                  Strategies
                </Text>
                <Button
                  data-testid="sim-add-strategy"
                  size="xs"
                  variant="default"
                  leftSection={<IconPlus size={12} />}
                  onClick={() => addStrategy()}
                >
                  New
                </Button>
              </ToolbarRow>
              <Select
                data-testid="sim-template"
                size="xs"
                data={templates.map((template) => ({
                  value: template.id,
                  label: template.name,
                }))}
                placeholder="Load template"
                value={null}
                onChange={(value) => {
                  if (value) addStrategy(value);
                }}
              />
              <Divider />
              {strategies.map((item) => (
                <Group key={item.id} gap={4} wrap="nowrap">
                  <Button
                    data-testid={`sim-strategy-${item.id}`}
                    size="xs"
                    variant={item.id === selectedId ? "light" : "subtle"}
                    style={{ flex: 1, minWidth: 0, justifyContent: "flex-start" }}
                    onClick={() => setSelectedId(item.id)}
                  >
                    {item.name}
                  </Button>
                  <ActionIcon
                    data-testid={`sim-remove-${item.id}`}
                    size="xs"
                    variant="subtle"
                    aria-label={`Remove ${item.name}`}
                    disabled={strategies.length <= 1}
                    onClick={() => removeStrategy(item.id)}
                  >
                    <IconTrash size={12} />
                  </ActionIcon>
                </Group>
              ))}
            </Box>

            <Box
              data-testid="sim-pane"
              className="flex-1 min-w-0 min-h-0 flex flex-col gap-2"
            >
              <ToolbarRow justify="flex-end">
                {asOf ? (
                  <Badge data-testid="sim-playhead" size="xs" color="warning" variant="outline">
                    PLAYHEAD {fmtTime(asOf)}
                  </Badge>
                ) : null}
              </ToolbarRow>

              {error ? (
                <Alert color="error" data-testid="sim-error">
                  {error}
                </Alert>
              ) : null}

              <Box
                data-testid="sim-view"
                className="grid grid-cols-1 min-[1200px]:grid-cols-[minmax(320px,0.92fr)_minmax(380px,1.08fr)] gap-2 items-start min-w-0"
              >
                <Box className="flex flex-col gap-2 min-w-0">
                  <SectionLabel>Build</SectionLabel>
                  {selectedSpec ? (
                    <SimBuilder
                      strategy={selectedSpec}
                      ladder={ladder}
                      spot={spot}
                      errors={validationErrors}
                      onChange={updateStrategy}
                    />
                  ) : null}
                </Box>
                <Box className="flex flex-col gap-2 min-w-0">
                  <SectionLabel>Payoff</SectionLabel>
                  <SimPayoff
                    strategy={selectedResult}
                    view={view}
                    planLegs={selectedSpec?.legs ?? []}
                    entryTime={selectedSpec?.exec.entryTime}
                    spot={spot}
                  />
                </Box>
              </Box>

              <Box className="flex flex-col gap-2 min-w-0">
                <SectionLabel>Runs</SectionLabel>
                <SimRuns strategy={selectedResult} view={view} asOf={asOf} />
              </Box>
            </Box>
          </Box>
        </Box>
      </PanelModal>
    </>
  );
}

export default SimDesk;
