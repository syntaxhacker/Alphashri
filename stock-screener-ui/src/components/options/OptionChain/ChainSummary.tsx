import { Text, RingProgress } from "@/ui";
import Box from "@mui/material/Box";
import { useMemo } from "react";
import { CompactPanel, CompactStatGrid } from "../../common/compact";

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
  atm_iv?: number;
}

export function computeStats(strikeMatrix: StrikeRow[], summary: Summary | undefined) {
  if (summary) {
    return {
      pcr: summary.pcr,
      maxPain: summary.max_pain,
      expectedMove: summary.expected_move,
      totalCE_OI: summary.total_ce_oi,
      totalPE_OI: summary.total_pe_oi,
      atmIv: summary.atm_iv ?? 0,
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
    atmIv: 0,
    resistanceStrike: 0,
    supportStrike: 0,
  };
}

export function computePcrColor(pcr: number): string {
  return pcr > 1.2 ? "success" : pcr < 0.7 ? "error" : "primary";
}

export function ChainSummary({
  strikeMatrix,
  spotPrice: _spotPrice,
  selectedExpiry: _selectedExpiry,
  summary,
}: ChainSummaryProps) {
  const stats = useMemo(() => computeStats(strikeMatrix, summary), [strikeMatrix, summary]);

  const pcrColor = computePcrColor(stats.pcr);
  const total = stats.totalCE_OI + stats.totalPE_OI || 1;

  return (
    <Box sx={{ display: "flex", justifyContent: "center", width: "100%" }}>
      <CompactStatGrid data-testid="chain-summary">
        <CompactPanel data-testid="chain-summary-compact-row">
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexWrap: "wrap",
              columnGap: 3,
              rowGap: 1,
              width: "100%",
            }}
          >
            <Box
              sx={{ display: "flex", alignItems: "center", gap: 1 }}
              data-testid="options-chain-summary-pcr"
            >
              <RingProgress
                size={44}
                thickness={5}
                roundCaps
                sections={[
                  { value: (stats.totalPE_OI / total) * 100, color: "error" },
                  { value: (stats.totalCE_OI / total) * 100, color: "success" },
                ]}
              />
              <Text size="sm" c="dimmed" fw={600}>
                PCR
              </Text>
              <Text size="sm" fw={700} c={pcrColor}>
                {stats.pcr.toFixed(2)}
              </Text>
              <Text size="sm" c={pcrColor} fw={600}>
                {stats.pcr > 1 ? "Bullish bias" : "Bearish bias"}
              </Text>
            </Box>

            <Text size="sm" c="dimmed" aria-hidden="true">
              |
            </Text>

            <Box
              sx={{ display: "flex", alignItems: "center", gap: 1 }}
              data-testid="options-chain-summary-range"
            >
              <Text size="sm" c="dimmed" fw={600}>
                Range
              </Text>
              <Text size="sm" fw={700} c={stats.expectedMove ? "primary" : "dimmed"}>
                {stats.expectedMove
                  ? `${stats.expectedMove.lower} - ${stats.expectedMove.upper}`
                  : "Data pending"}
              </Text>
              <Box
                sx={{ display: "flex", alignItems: "center", gap: 1 }}
                data-testid="options-chain-support-resistance"
              >
                <Text size="sm" fw={700} c="error">
                  RES {stats.resistanceStrike}
                </Text>
                <Text size="sm" fw={700} c="success">
                  SUP {stats.supportStrike}
                </Text>
              </Box>
            </Box>

            <Text size="sm" c="dimmed" aria-hidden="true">
              |
            </Text>

            <Box
              sx={{ display: "flex", alignItems: "center", gap: 1 }}
              data-testid="options-chain-summary-max-pain"
            >
              <Text size="sm" c="dimmed" fw={600}>
                Max Pain
              </Text>
              <Text size="sm" fw={700} c="warning">
                {stats.maxPain}
              </Text>            </Box>
          </Box>
        </CompactPanel>
      </CompactStatGrid>
    </Box>
  );
}
