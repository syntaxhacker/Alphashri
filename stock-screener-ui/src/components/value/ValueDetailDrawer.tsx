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

export function ValueDetailDrawer({ row, onClose }: ValueDetailDrawerProps) {
  return (
    <Modal
      opened={row !== null}
      onClose={onClose}
      title={row ? `${row.symbol} — ${row.name}` : ""}
      size="md"
      data-testid="value-detail-drawer"
    >
      {row && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }} data-testid={`value-detail-${row.symbol}`}>
          <Box>
            <Text size="sm" fw={600}>
              Score breakdown ({Math.round(row.score)}/100)
            </Text>
            {SUBSCORE_LABELS.map((s) => (
              <Box
                key={s.key}
                sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}
                data-testid={`value-detail-sub-${row.symbol}-${s.key}`}
              >
                <Text size="xs" c="dimmed" sx={{ width: 64 }}>
                  {s.label}
                </Text>
                <Box sx={{ flex: 1, height: 6, borderRadius: 1, bgcolor: "divider", overflow: "hidden" }}>
                  <Box sx={{ width: `${row.subscores[s.key]}%`, height: "100%", bgcolor: "primary.main" }} />
                </Box>
                <Text size="xs" fw={600} sx={{ width: 28, textAlign: "right" }}>
                  {row.subscores[s.key]}
                </Text>
              </Box>
            ))}
          </Box>
          <Divider />
          <Box>
            <Text size="sm" fw={600}>
              Sector peer ({row.peer.bucket})
            </Text>
            <Text size="xs" c="dimmed" data-testid={`value-detail-peer-${row.symbol}`}>
              {`P/E median ${formatValueNum(row.peer.pe_median, 1, VALUE_NA)} · ROE median ${formatValuePct(row.peer.roe_median, 1, VALUE_NA)} · FCF yield median ${formatValuePct(row.peer.fcf_yield_median, 1, VALUE_NA)}`}
            </Text>
          </Box>
          <Divider />
          <Box>
            <Text size="sm" fw={600}>
              Why it screens
            </Text>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 1 }}>
              {row.flags.length === 0 && (
                <Text size="xs" c="dimmed">
                  No special flags — it passed the gates on score alone.
                </Text>
              )}
              {row.flags.map((f) => (
                <Box key={f} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Badge size="xs" color="secondary">
                    {f.replace(/_/g, " ")}
                  </Badge>
                  <Text size="xs" c="dimmed">
                    {explainFlag(f, row)}
                  </Text>
                </Box>
              ))}
            </Box>
          </Box>
          <Divider />
          <Box>
            <Text size="sm" fw={600}>
              Derived metrics
            </Text>
            <Text size="xs" c="dimmed" data-testid={`value-detail-derived-${row.symbol}`}>
              {`FCF yield ${formatValuePct(row.derived.fcf_yield, 1, VALUE_NA)} · Earnings yield ${formatValuePct(row.derived.earnings_yield, 1, VALUE_NA)} · vs 200-DMA ${formatValuePct(row.derived.vs_200dma, 1, VALUE_NA)} · off 52w high ${formatValuePct(row.derived.off_52w_high, 1, VALUE_NA)}`}
              {row.derived.distorted_pe ? " · distorted P/E" : ""}
            </Text>
          </Box>
        </Box>
      )}
    </Modal>
  );
}
