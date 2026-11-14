import { Show, For } from "solid-js";
import { Box, Modal, Text, Badge, Divider } from "@/ui";
import type { ValueRow } from "../../api/valueScan";
import { VALUE_NA, formatValueNum, formatValuePct } from "./valueFormat";

interface ValueDetailDrawerProps {
  row: ValueRow | null;
  onClose: () => void;
}

const SUBSCORE_LABELS = [
  { key: "value", label: "Value" },
  { key: "quality", label: "Quality" },
  { key: "growth", label: "Growth" },
  { key: "health", label: "Health" },
] as const;

function explainFlag(flag: string, row: ValueRow): string {
  const pePeer =
    row.pe !== null && row.peer.pe_median !== null
      ? `P/E ${row.pe.toFixed(1)} vs sector median ${row.peer.pe_median.toFixed(1)}`
      : null;
  switch (flag) {
    case "LOW_PE":
      return pePeer ? `Cheap on earnings — ${pePeer}.` : "Cheap on earnings vs its sector.";
    case "HIGH_FCF_YIELD":
      return row.fcf_yield !== null
        ? `Strong cash generation — FCF yield ${row.fcf_yield.toFixed(1)}%.`
        : "Strong free-cash-flow yield.";
    case "HIGH_ROE":
      return row.roe !== null
        ? `High return on equity — ROE ${row.roe.toFixed(1)}%.`
        : "High return on equity.";
    case "LOW_LEVERAGE":
    case "NET_CASH":
      return row.debt_to_equity !== null
        ? `Conservative balance sheet — D/E ${row.debt_to_equity.toFixed(2)}.`
        : "Net cash / low leverage.";
    case "OFF_52W_HIGH":
      return row.off_52w_high !== null
        ? `Off its highs — ${row.off_52w_high.toFixed(1)}% below the 52-week high.`
        : "Trading below its 52-week high.";
    case "ABOVE_200DMA":
      return "Holding above the 200-day average — basing, not broken.";
    case "DISTORTED_PE":
      return "P/E looks distorted (near-zero/negative earnings) — treat the multiple with caution.";
    case "HIGH_YIELD":
      return row.div_yield !== null
        ? `Pays a dividend — yield ${row.div_yield.toFixed(1)}%.`
        : "Pays a dividend yield.";
    default:
      return `${flag.replace(/_/g, " ").toLowerCase()}.`;
  }
}

export function ValueDetailDrawer(props: ValueDetailDrawerProps) {
  const row = () => props.row;
  return (
    <Modal
      opened={row() !== null}
      onClose={props.onClose}
      title={row() ? `${row()!.symbol} — ${row()!.name}` : ""}
      size="md"
      data-testid="value-detail-drawer"
    >
      <Show when={row()}>
        {(r) => (
          <Box className="flex flex-col gap-4" data-testid={`value-detail-${r().symbol}`}>
            <Box>
              <Text size="sm" fw={600}>
                Score breakdown ({Math.round(r().score)}/100)
              </Text>
              <For each={SUBSCORE_LABELS}>
                {(s) => (
                  <Box
                    className="mt-2 flex items-center gap-2"
                    data-testid={`value-detail-sub-${r().symbol}-${s.key}`}
                  >
                    <Text size="xs" c="dimmed" className="w-16">
                      {s.label}
                    </Text>
                    <Box className="h-1.5 flex-1 overflow-hidden rounded-[2px] bg-fin-border">
                      <Box className="h-full bg-fin-primary" style={{ width: `${r().subscores[s.key]}%` }} />
                    </Box>
                    <Text size="xs" fw={600} className="w-7 text-right">
                      {r().subscores[s.key]}
                    </Text>
                  </Box>
                )}
              </For>
            </Box>
            <Divider />
            <Box>
              <Text size="sm" fw={600}>
                Sector peer ({r().peer.bucket})
              </Text>
              <Text size="xs" c="dimmed" data-testid={`value-detail-peer-${r().symbol}`}>
                {`P/E median ${formatValueNum(r().peer.pe_median, 1, VALUE_NA)} · ROE median ${formatValuePct(r().peer.roe_median, 1, VALUE_NA)} · FCF yield median ${formatValuePct(r().peer.fcf_yield_median, 1, VALUE_NA)}`}
              </Text>
            </Box>
            <Divider />
            <Box>
              <Text size="sm" fw={600}>
                Why it screens
              </Text>
              <Box className="mt-2 flex flex-col gap-2">
                <Show
                  when={r().flags.length === 0}
                  fallback={
                    <For each={r().flags}>
                      {(flag) => (
                        <Box className="flex items-center gap-2">
                          <Badge size="xs" color="secondary">
                            {flag.replace(/_/g, " ")}
                          </Badge>
                          <Text size="xs" c="dimmed">
                            {explainFlag(flag, r())}
                          </Text>
                        </Box>
                      )}
                    </For>
                  }
                >
                  <Text size="xs" c="dimmed">
                    No special flags — it passed the gates on score alone.
                  </Text>
                </Show>
              </Box>
            </Box>
            <Divider />
            <Box>
              <Text size="sm" fw={600}>
                Derived metrics
              </Text>
              <Text size="xs" c="dimmed" data-testid={`value-detail-derived-${r().symbol}`}>
                {`FCF yield ${formatValuePct(r().derived.fcf_yield, 1, VALUE_NA)} · Earnings yield ${formatValuePct(r().derived.earnings_yield, 1, VALUE_NA)} · vs 200-DMA ${formatValuePct(r().derived.vs_200dma, 1, VALUE_NA)} · off 52w high ${formatValuePct(r().derived.off_52w_high, 1, VALUE_NA)}`}
                {r().derived.distorted_pe ? " · distorted P/E" : ""}
              </Text>
            </Box>
          </Box>
        )}
      </Show>
    </Modal>
  );
}
