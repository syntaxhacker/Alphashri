import { createEffect, createMemo, createSignal, For, Show, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Divider,
  Select,
  Switch,
  Text,
  ToolbarRow,
} from "@/ui";
import { IconBolt, IconPlayerPlay } from "@/components/common/Icons";
import { LocalPanelModal } from "../LocalPanelModal";

const IconPlus = (props: { size?: number }) => (
  <svg
    width={props.size ?? 14}
    height={props.size ?? 14}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    aria-hidden="true"
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const IconTrash = (props: { size?: number }) => (
  <svg
    width={props.size ?? 14}
    height={props.size ?? 14}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
  </svg>
);
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

function SectionLabel(props: { children: string }) {
  return (
    <Text
      span
      size="xs"
      fw={700}
      c="dimmed"
      className="uppercase tracking-[0.06em]"
    >
      {props.children}
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

export function SimDesk(props: SimDeskProps) {
  const symbol = () => props.symbol;
  const report = () => props.report;
  const replay = () => props.replay;
  const replayIndex = () => props.replayIndex;
  const [open, setOpen] = createSignal(false);
  const [strategies, setStrategies] = createSignal<SimStrategySpec[]>([
    newStrategy(1, "long-call"),
  ]);
  const [selectedId, setSelectedId] = createSignal("sc-1");
  const [result, setResult] = createSignal<SimRunResult | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [live, setLive] = createSignal(true);
  const [templates, setTemplates] = createSignal<SimTemplate[]>(SIM_TEMPLATES);

  let abortController: AbortController | null = null;

  const ladder = createMemo(() =>
    buildLadder(report()?.strikes ?? [], report()?.spot ?? 0),
  );
  const resultSpot = () => result()?.spot;
  const spot = () => finite(report()?.spot) ? report()!.spot : resultSpot() ?? 0;
  // After the close there is nothing to poll: force the recorded-session view
  // even if the parent report was manually left on Live. The time gate is the
  // primary one — an EOD report's `is_open` can be absent on older snapshots.
  const marketClosed = () => !isDerivativesOpenIst() || report()?.market?.is_open === false;
  const effectiveMode = (): "live" | "eod" => (marketClosed() ? "eod" : props.mode);
  const runDate = () =>
    effectiveMode() === "eod"
      ? props.date || report()?.date || report()?.market?.session_date || undefined
      : undefined;

  createEffect(() => {
    let alive = true;
    fetchSimStrategies()
      .then((rows) => {
        if (alive && rows.length > 0) setTemplates(rows);
      })
      .catch(() => {
        // The local templates are enough; a failed fetch must not block the desk.
      });
    onCleanup(() => {
      alive = false;
    });
  });

  onCleanup(() => abortController?.abort());

  const run = async () => {
    const errors = strategies().flatMap((strategy) => validateStrategy(strategy));
    if (errors.length > 0) {
      setError(errors[0]);
      return;
    }
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    abortController?.abort();
    abortController = controller;
    try {
      const next = await runSim(
        {
          symbol: symbol(),
          date: runDate(),
          strategies: strategies(),
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
      if (abortController === controller) setLoading(false);
    }
  };

  createEffect(() => {
    // Re-run when the panel opens or the scope changes.
    open();
    symbol();
    runDate();
    effectiveMode();
    if (!open()) return;
    void run();
  });

  createEffect(() => {
    // Live polling, gated to the live session and the open panel.
    if (!open() || !live() || effectiveMode() !== "live") return;
    const id = window.setInterval(() => void run(), LIVE_REFRESH_MS);
    onCleanup(() => window.clearInterval(id));
  });

  // A newly added or edited strategy has no row in the last result. Debounce
  // a fresh run so the desk never sits on a stale "Run the desk" state.
  let lastRunStrategies = strategies();
  createEffect(() => {
    const current = strategies();
    if (!open()) return;
    if (lastRunStrategies === current) return;
    lastRunStrategies = current;
    const id = window.setTimeout(() => void run(), 600);
    onCleanup(() => window.clearTimeout(id));
  });

  const selectedSpec = () =>
    strategies().find((item) => item.id === selectedId()) ?? strategies()[0];

  const addStrategy = (templateId?: string) => {
    const created = newStrategy(strategies().length + 1, templateId);
    const id = nextStrategyId(strategies());
    const next = { ...created, id };
    setStrategies((prev) => [...prev, next]);
    setSelectedId(id);
  };

  const updateStrategy = (next: SimStrategySpec) => {
    setStrategies((prev) => prev.map((item) => (item.id === next.id ? next : item)));
  };

  const removeStrategy = (id: string) => {
    if (strategies().length <= 1) return;
    const next = strategies().filter((item) => item.id !== id);
    setStrategies(next);
    if (selectedId() === id) setSelectedId(next[0].id);
  };

  const asOf = createMemo(() =>
    effectiveMode() === "eod" ? (replay()?.snapshots?.[replayIndex()]?.t ?? null) : null,
  );
  const selectedResult = createMemo(() => selectedStrategy(result(), selectedId()));
  const view: () => StrategyView | null = createMemo(() =>
    selectedResult() ? strategyViewAt(selectedResult()!, asOf()) : null,
  );
  const combined = createMemo(() => (result() ? combinedViewAt(result()!, asOf()) : null));

  // Coverage must stop at the playhead too: the full-day frame count would
  // reveal how long the session ran while scrubbing the open.
  const coverageFrames = () => view()?.equity.length ?? 0;
  const coverageText = () => {
    const r = result();
    const v = view();
    if (!r) return "—";
    return `${coverageFrames()} frame${coverageFrames() === 1 ? "" : "s"} · ${fmtTime(
      v?.equity[0]?.t,
    )}→${fmtTime(v?.equity.at(-1)?.t)}${
      asOf() ? "" : ` · ${finite(r.coverage.gaps) ? r.coverage.gaps : "—"} gaps`
    }`;
  };
  const fillModel = () => result()?.fillModel || "next-minute close fill · costs on · 0 slippage";
  const expiryText = () => result()?.expiry || report()?.expiry || "—";
  const dteText = () => {
    const r = result();
    return r && finite(r.dte) ? `${r.dte}d` : "—";
  };
  const spotText = () => points(spot());
  const lotText = () => {
    const r = result();
    return r && finite(r.lotSize) ? formatNumberIN(r.lotSize) : "—";
  };
  const tapeLagText = () => {
    const r = result();
    return r && finite(r.tapeLagSec) ? `${Math.round(r.tapeLagSec)}s` : "—";
  };
  const deskTotalText = () => (combined() ? fmtSignedInr(combined()!.total) : "—");
  const validationErrors = () => {
    const spec = selectedSpec();
    return spec ? validateStrategy(spec) : [];
  };

  return (
    <>
      <Button
        data-testid="sim-open"
        size="sm"
        variant="default"
        leftSection={<IconBolt size={14} />}
        onClick={() => setOpen(true)}
      >
        {strategies().length > 0 ? `SIM · ${strategies().length}` : "SIM"}
      </Button>

      <LocalPanelModal
        open={open()}
        variant="drawer"
        drawerWidth={1080}
        title={`SIM DESK · ${symbol()}`}
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
            <Show when={marketClosed()}>
              <Badge data-testid="sim-market-closed" size="xs" color="warning" variant="outline">
                MARKET CLOSED · EOD
              </Badge>
            </Show>
            <Show when={effectiveMode() === "live"}>
              <Switch
                data-testid="sim-live"
                size="xs"
                label="LIVE"
                checked={live()}
                onChange={(event) => setLive(event.currentTarget.checked)}
              />
            </Show>
            <Button
              data-testid="sim-run"
              size="sm"
              loading={loading()}
              leftSection={<IconPlayerPlay size={14} />}
              onClick={() => void run()}
            >
              RUN
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2 min-w-0">
          <SimContextStrip
            mode={effectiveMode()}
            date={runDate() ?? props.date}
            expiry={expiryText()}
            dte={dteText()}
            spot={spotText()}
            lotSize={lotText()}
            lotVerified={result() ? result()!.lotVerified : true}
            coverageText={coverageText()}
            tapeLag={tapeLagText()}
            deskTotal={deskTotalText()}
          />
          <Show when={result()?.expiryNote}>
            <Text
              data-testid="sim-expiry-note"
              size="xs"
              fw={600}
              c="warning.main"
              className="leading-[1.45]"
            >
              ⚠ {result()!.expiryNote}
            </Text>
          </Show>

          <div
            className="flex flex-col min-[900px]:flex-row gap-2 min-w-0 min-h-0"
          >
            <div
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
                data={templates().map((template) => ({
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
              <For each={strategies()}>
                {(item) => (
                  <div class="flex flex-row flex-nowrap gap-1 min-w-0">
                    <Button
                      data-testid={`sim-strategy-${item.id}`}
                      size="xs"
                      variant={item.id === selectedId() ? "light" : "subtle"}
                      style={{ flex: "1", "min-width": 0, "justify-content": "flex-start" }}
                      onClick={() => setSelectedId(item.id)}
                    >
                      {item.name}
                    </Button>
                    <ActionIcon
                      data-testid={`sim-remove-${item.id}`}
                      size="xs"
                      variant="subtle"
                      aria-label={`Remove ${item.name}`}
                      disabled={strategies().length <= 1}
                      onClick={() => removeStrategy(item.id)}
                    >
                      <IconTrash size={12} />
                    </ActionIcon>
                  </div>
                )}
              </For>
            </div>

            <div
              data-testid="sim-pane"
              className="flex-1 min-w-0 min-h-0 flex flex-col gap-2"
            >
              <ToolbarRow justify="flex-end">
                <Show when={asOf()}>
                  <Badge data-testid="sim-playhead" size="xs" color="warning" variant="outline">
                    PLAYHEAD {fmtTime(asOf()!)}
                  </Badge>
                </Show>
              </ToolbarRow>

              <Show when={error()}>
                <Alert color="error" data-testid="sim-error">
                  {error()}
                </Alert>
              </Show>

              <div
                data-testid="sim-view"
                className="grid grid-cols-1 min-[1200px]:grid-cols-[minmax(320px,0.92fr)_minmax(380px,1.08fr)] gap-2 items-start min-w-0"
              >
                <div className="flex flex-col gap-2 min-w-0">
                  <SectionLabel>Build</SectionLabel>
                  <Show when={selectedSpec()}>
                    <SimBuilder
                      strategy={selectedSpec()!}
                      ladder={ladder()}
                      spot={spot()}
                      errors={validationErrors()}
                      onChange={updateStrategy}
                    />
                  </Show>
                </div>
                <div className="flex flex-col gap-2 min-w-0">
                  <SectionLabel>Payoff</SectionLabel>
                  <SimPayoff
                    strategy={selectedResult()}
                    view={view()}
                    planLegs={selectedSpec()?.legs ?? []}
                    entryTime={selectedSpec()?.exec.entryTime}
                    spot={spot()}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2 min-w-0">
                <SectionLabel>Runs</SectionLabel>
                <SimRuns strategy={selectedResult()} view={view()} asOf={asOf()} />
              </div>
            </div>
          </div>
        </div>
      </LocalPanelModal>
    </>
  );
}

export default SimDesk;
