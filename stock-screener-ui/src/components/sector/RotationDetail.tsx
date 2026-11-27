import type { JSX } from "solid-js";
import { Show, For } from "solid-js";
import { NEGATIVE, POSITIVE, TEXT_MUTED } from "@/ui/palette";
import { ActionIcon, Box, Button, CopyButton, Text, typeSize } from "@/ui";
import { IconCheck, IconCopy } from "../common/Icons";
import { IconUsers } from "../screener/icons";
import { SymbolLink } from "../common/SymbolLink";
import { useSymbolDock } from "../common/symbolDockContext";
import type { RotationPeriod, RotationRow } from "../../types/rotation";
import { getPnLTextColor } from "../../utils/ui-helpers";
import { formatSectorPercentage as formatPercentage, clickOnSpace } from "./sectorUtils";
import { formatReturn, returnTone } from "./rotation/returnVisuals";
import { ROTATION_STATUS_LABELS, ROTATION_STATUS_COLORS_PANEL } from "./rotationStatus";
import { displaySymbol } from "@/config/tvSymbols";
import { chartHrefForSymbol } from "../common/symbolDockContext";

const PERIODS: RotationPeriod[] = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y"];

type MetricTone = "success" | "error" | "muted";

function metricTone(value: number): MetricTone {
  const tone = returnTone(value);
  return tone === "dimmed" ? "muted" : tone;
}

/** Zero bars are neutral: a green stub would read as a gain. */
function returnColor(value: number): string {
  if (!Number.isFinite(value) || value === 0) return TEXT_MUTED;
  return value > 0 ? POSITIVE : NEGATIVE;
}

// Decorated feed symbols (NSE:RELIANCE, BRK.B) need a canonical chart href;
// plain tickers render through the shared dock button.
function needsCanonicalLink(symbol: string): boolean {
  const raw = String(symbol ?? "").trim();
  return displaySymbol(raw) !== raw || raw.includes(".");
}

function SectionLabel(props: { children: JSX.Element }) {
  return (
    <Text
      c="dimmed"
      className="text-ui-micro font-bold uppercase tracking-[0.5px]"
    >
      {props.children}
    </Text>
  );
}

function Metric(props: {
  label: string;
  value: string;
  tone: "success" | "error" | "muted";
}) {
  return (
    <Box className="min-w-0">
      <Text
        c="dimmed"
        className="block text-ui-micro font-bold uppercase tracking-[0.4px]"
      >
        {props.label}
      </Text>
      <Text
        c={props.tone === "muted" ? "secondary" : props.tone}
        fw={600}
        truncate
        className="block font-mono text-ui-micro tabular-nums"
      >
        {props.value}
      </Text>
    </Box>
  );
}

export interface RotationDetailProps {
  row: RotationRow | null;
  onOpenMembers: (row: RotationRow) => void;
  market?: string;
  onSymbolClick?: (symbol: string) => void;
}

export function RotationDetail(props: RotationDetailProps) {
  const row = () => props.row;
  const dock = useSymbolDock();
  const openSymbol = (symbol: string) =>
    props.onSymbolClick
      ? props.onSymbolClick(symbol)
      : dock.open(symbol, "chart", props.market);
  const status = () => row() ? {
    label: ROTATION_STATUS_LABELS[row()!.status].long,
    color: ROTATION_STATUS_COLORS_PANEL[row()!.status],
  } : null;
  const movers = () => row() ? row()!.top_movers.slice(0, 5) : [];
  const canOpenMembers = () => Boolean(row() && row()!.kind === "theme" && row()!.slug);
  const monthly = () => row() ? row()!.returns["1M"] : 0;

  return (
    <Box
      data-testid="rotation-detail"
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <Box className="border-b border-fin-border px-2 py-1">
        <Box className="flex min-w-0 items-center gap-1.5">
          <Show when={status()}>
            {(s_) => (
              <Box
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ "background-color": s_().color }}
              />
            )}
          </Show>
          <Text fw={700} truncate className="min-w-0 text-ui-micro">
            {row() ? row()!.name : "Select a group"}
          </Text>
          <Box className="flex-1" />
          <Show when={status()}>
            {(s_) => (
              <Text
                className="whitespace-nowrap text-ui-micro font-bold tracking-[0.4px]"
                style={{ color: s_().color }}
              >
                {s_().label}
              </Text>
            )}
          </Show>
        </Box>
        <Text c="dimmed" truncate className="block text-ui-micro">
          {row()
            ? `${row()!.category ? `${row()!.category} · ` : ""}${row()!.kind} · ${row()!.quadrant} · ${row()!.members} members`
            : "Pick a row in the board, matrix or rotation map."}
        </Text>
      </Box>

      <Show when={row()}>
        <>
          <Box
            className="grid grid-cols-4 gap-1 px-2 py-1"
          >
            <Metric label="1M" value={formatReturn(monthly(), 2)} tone={metricTone(monthly())} />
            <Metric label="RS" value={row()!.rs_1m.toFixed(2)} tone={getPnLTextColor(row()!.rs_1m)} />
            <Metric
              label="Breadth"
              value={`${row()!.breadth.toFixed(0)}%`}
              tone={row()!.breadth >= 55 ? "success" : row()!.breadth <= 45 ? "error" : "muted"}
            />
            <Metric
              label="Volume"
              value={`${row()!.rel_volume.toFixed(1)}x`}
              tone={row()!.rel_volume >= 1.2 ? "success" : "muted"}
            />
          </Box>

          <Box className="border-t border-fin-border px-2 py-1">
            <SectionLabel>Period returns</SectionLabel>
            <Box
              className="mt-1 grid grid-cols-7 gap-1"
            >
              <For each={PERIODS}>
                {(p) => {
                const value = row()!.returns[p];
                const height = Math.max(3, Math.min(36, Math.abs(value) * 2.2));
                return (
                  <Box
                    className="flex min-w-0 flex-col items-center gap-[2px]"
                  >
                    <Box
                      className="flex h-7 w-full items-end justify-center"
                    >
                      <Box
                        data-testid={`rotation-detail-bar-${p}`}
                        data-zero={value === 0 ? "true" : "false"}
                        className="w-3 rounded-t-[2px] opacity-90"
                        style={{ height: `${height}px`, "background-color": returnColor(value) }}
                      />
                    </Box>
                    <Text className="text-ui-micro leading-none" style={{ color: TEXT_MUTED }}>{p}</Text>
                    <Text
                      data-testid={`rotation-detail-return-${p}`}
                      data-zero={value === 0 ? "true" : "false"}
                      className="font-mono text-ui-micro leading-none tabular-nums"
                      style={{ color: returnColor(value) }}
                    >
                      {formatReturn(value, 1)}
                    </Text>
                  </Box>
                );
                }}
              </For>
            </Box>
          </Box>

          <Box
            className="flex items-center gap-1.5 border-t border-fin-border px-2 py-[2px]"
          >
            <SectionLabel>Top movers</SectionLabel>
            <Box className="flex-1" />
            <Show when={canOpenMembers()}>
              <Button
                data-testid="rotation-detail-members"
                variant="subtle"
                size="xs"
                leftSection={<IconUsers size={12} />}
                onClick={() => props.onOpenMembers(row()!)}
                style={{ "min-height": "20px", "padding-inline": "6px", "font-size": `${typeSize("micro")}px` }}
              >
                Members
              </Button>
            </Show>
          </Box>

          <Box className="flex flex-col gap-[2px] px-2 pb-1">
            <Show when={movers().length === 0}
              fallback={
                <For each={movers()}>
                  {(mover) => (
                <Box
                  className="flex min-w-0 items-center gap-1.5"
                >
                  {needsCanonicalLink(mover.symbol) ? (
                    <Box className="flex min-w-0 items-center gap-[2px]">
                      <Box
                        component="a"
                        href={chartHrefForSymbol(mover.symbol, props.market)}
                        data-testid={`rotation-mover-${mover.symbol}`}
                        onKeyDown={clickOnSpace}
                        className="min-w-0 text-fin-text no-underline hover:text-fin-primary hover:underline"
                      >
                        <Text truncate className="text-ui-micro font-semibold">
                          {displaySymbol(mover.symbol)}
                        </Text>
                      </Box>
                      <CopyButton value={displaySymbol(mover.symbol)}>
                        {({ copied, copy }) => (
                          <ActionIcon
                            variant="subtle"
                            color={copied ? "info" : "secondary"}
                            size="xs"
                            style={{ width: "16px", height: "16px", "min-height": "16px", padding: "0px" }}
                            onClick={(event: MouseEvent) => {
                              event.stopPropagation();
                              copy();
                            }}
                            aria-label={`Copy ${displaySymbol(mover.symbol)}`}
                            data-testid={`copy-symbol-${displaySymbol(mover.symbol)}`}
                          >
                            {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                          </ActionIcon>
                        )}
                      </CopyButton>
                    </Box>
                  ) : (
                    <SymbolLink
                      symbol={mover.symbol}
                      inAppText
                      tvLink={false}
                      showChart={false}
                      showOptions={false}
                      showCopy
                      size="xs"
                      weight={600}
                      testId={`rotation-mover-${mover.symbol}`}
                      onTextClick={(sym) => openSymbol(sym)}
                      className="min-w-0 flex-1"
                    />
                  )}
                  <Box className="flex-1" />
                  <Text
                    c={getPnLTextColor(mover.change)}
                    fw={600}
                    className="font-mono text-ui-micro tabular-nums"
                  >
                    {formatPercentage(mover.change)}
                  </Text>
                </Box>
                  )}
                </For>
              }
            >
              <Text c="dimmed" className="text-ui-micro">
                No movers
              </Text>
            </Show>
          </Box>
        </>
      </Show>
    </Box>
  );
}
