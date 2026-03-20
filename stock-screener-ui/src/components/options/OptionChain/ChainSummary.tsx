import { Group, Text, Stack, RingProgress, Divider } from "@mantine/core";
import { useMemo } from "react";
import { CompactPanel, CompactStat, CompactStatGrid } from "../../common/compact";

interface ChainSummaryProps {
  strikeMatrix: Array<{ strike: number; ce: any; pe: any }>;
  spotPrice: number | null;
  selectedExpiry: string;
  summary?: any;
}

export interface StrikeRow {
  strike: number;
  ce: any;
  pe: any;
}

export interface Summary {
  pcr: number;
  max_pain: number;
  expected_move: { lower: number; upper: number; range: number } | null;
  total_ce_oi: number;
  total_pe_oi: number;
}

export function computeStats(strikeMatrix: StrikeRow[], summary: Summary | undefined) {
  if (summary) {
    return {
      pcr: summary.pcr,
      maxPain: summary.max_pain,
      expectedMove: summary.expected_move,
      totalCE_OI: summary.total_ce_oi,
      totalPE_OI: summary.total_pe_oi,
      resistanceStrike:
        Math.max(...strikeMatrix.map((s) => s.ce?.market_data?.oi ?? 0)) > 0
          ? strikeMatrix.reduce((prev, curr) =>
              (curr.ce?.market_data?.oi ?? 0) > (prev.ce?.market_data?.oi ?? 0) ? curr : prev,
            ).strike
          : 0,
      supportStrike:
        Math.max(...strikeMatrix.map((s) => s.pe?.market_data?.oi ?? 0)) > 0
          ? strikeMatrix.reduce((prev, curr) =>
              (curr.pe?.market_data?.oi ?? 0) > (prev.pe?.market_data?.oi ?? 0) ? curr : prev,
            ).strike
          : 0,
    };
  }

  return {
    pcr: 0,
    maxPain: 0,
    expectedMove: null,
    totalCE_OI: 0,
    totalPE_OI: 0,
    resistanceStrike: 0,
    supportStrike: 0,
  };
}

export function computePcrColor(pcr: number): string {
  return pcr > 1.2 ? "green" : pcr < 0.7 ? "red" : "blue";
}

export function ChainSummary({
  strikeMatrix,
  spotPrice,
  selectedExpiry,
  summary,
}: ChainSummaryProps) {
  const stats = useMemo(() => {
    // If backend summary is available, use it!
    if (summary) {
      return {
        pcr: summary.pcr,
        maxPain: summary.max_pain,
        expectedMove: summary.expected_move,
        totalCE_OI: summary.total_ce_oi,
        totalPE_OI: summary.total_pe_oi,
        resistanceStrike:
          Math.max(...strikeMatrix.map((s) => s.ce?.market_data?.oi ?? 0)) > 0
            ? strikeMatrix.reduce((prev, curr) =>
                (curr.ce?.market_data?.oi ?? 0) > (prev.ce?.market_data?.oi ?? 0) ? curr : prev,
              ).strike
            : 0,
        supportStrike:
          Math.max(...strikeMatrix.map((s) => s.pe?.market_data?.oi ?? 0)) > 0
            ? strikeMatrix.reduce((prev, curr) =>
                (curr.pe?.market_data?.oi ?? 0) > (prev.pe?.market_data?.oi ?? 0) ? curr : prev,
              ).strike
            : 0,
      };
    }

    // Fallback: Minimal logic if backend fails (though it shouldn't now)
    return {
      pcr: 0,
      maxPain: 0,
      expectedMove: null,
      totalCE_OI: 0,
      totalPE_OI: 0,
      resistanceStrike: 0,
      supportStrike: 0,
    };
  }, [strikeMatrix, summary]);

  const pcrColor = stats.pcr > 1.2 ? "green" : stats.pcr < 0.7 ? "red" : "blue";

  return (
    <CompactStatGrid data-testid="chain-summary">
      <CompactPanel
        className="chain-summary-card chain-summary-pcr"
        data-testid="options-chain-summary-pcr"
      >
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Stack gap={2}>
            <CompactStat label="PCR" value={stats.pcr.toFixed(2)} tone={pcrColor} />
            <Text size="sm" c={pcrColor} fw={600}>
              {stats.pcr > 1 ? "Bullish bias" : "Bearish bias"}
            </Text>
          </Stack>
          <RingProgress
            size={60}
            thickness={6}
            roundCaps
            sections={[
              {
                value: (stats.totalPE_OI / (stats.totalCE_OI + stats.totalPE_OI || 1)) * 100,
                color: "red.6",
              },
              {
                value: (stats.totalCE_OI / (stats.totalCE_OI + stats.totalPE_OI || 1)) * 100,
                color: "green.6",
              },
            ]}
          />
        </Group>
      </CompactPanel>

      <CompactPanel
        className="chain-summary-card chain-summary-range"
        data-testid="options-chain-summary-range"
      >
        <Stack gap={4}>
          <CompactStat
            label="Market Range"
            value={
              stats.expectedMove
                ? `${stats.expectedMove.lower} - ${stats.expectedMove.upper}`
                : "Data pending"
            }
            tone={stats.expectedMove ? "blue.6" : "dimmed"}
            hint={
              stats.expectedMove ? `+/- ${stats.expectedMove.range} points expected` : undefined
            }
          />
          <Divider my={2} />
          <Group
            gap="xs"
            className="chain-support-resistance"
            data-testid="options-chain-support-resistance"
          >
            <Text size="sm" fw={700} c="red.6">
              RES {stats.resistanceStrike}
            </Text>
            <Text size="sm" fw={700} c="green.6">
              SUP {stats.supportStrike}
            </Text>
          </Group>
        </Stack>
      </CompactPanel>

      <CompactPanel
        className="chain-summary-card chain-summary-max-pain"
        data-testid="options-chain-summary-max-pain"
      >
        <Stack gap={2}>
          <CompactStat
            label="Max Pain"
            value={stats.maxPain}
            tone="orange.6"
            hint="Institutional target"
          />
        </Stack>
      </CompactPanel>
    </CompactStatGrid>
  );
}
