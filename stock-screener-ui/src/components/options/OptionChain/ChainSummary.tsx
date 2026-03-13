import { Group, Paper, Text, Stack, RingProgress, Flex, Divider } from "@mantine/core";
import { useMemo } from "react";

interface ChainSummaryProps {
  strikeMatrix: Array<{ strike: number; ce: any; pe: any }>;
  spotPrice: number | null;
  selectedExpiry: string;
  summary?: any;
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

  const paperStyle = {
    background: "light-dark(var(--mantine-color-white), var(--mantine-color-dark-7))",
    border: "1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))",
  };

  return (
    <Group
      id="chain-summary"
      className="chain-summary"
      grow
      gap="md"
      data-testid="chain-summary"
    >
      <Paper
        p="sm"
        radius="md"
        style={paperStyle}
        className="chain-summary-card chain-summary-pcr"
        data-testid="options-chain-summary-pcr"
      >
        <Group justify="space-between" wrap="nowrap">
          <Stack gap={0}>
            <Text size="sm" c="dimmed" fw={700} style={{ textTransform: "uppercase" }}>
              PCR (Sentiment)
            </Text>
            <Text size="xl" fw={800} c={pcrColor}>
              {stats.pcr.toFixed(2)}
            </Text>
            <Text size="sm" c={pcrColor} fw={500}>
              {stats.pcr > 1 ? "Bullish Bias" : "Bearish Bias"}
            </Text>
          </Stack>
          <RingProgress
            size={70}
            thickness={7}
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
      </Paper>

      <Paper
        p="sm"
        radius="md"
        style={paperStyle}
        className="chain-summary-card chain-summary-range"
        data-testid="options-chain-summary-range"
      >
        <Stack gap={0}>
          <Text size="sm" c="dimmed" fw={700} style={{ textTransform: "uppercase" }}>
            Market Range (Expected)
          </Text>
          {stats.expectedMove ? (
            <Stack gap={0}>
              <Text size="md" fw={800} c="blue.6">
                {stats.expectedMove.lower} - {stats.expectedMove.upper}
              </Text>
              <Text size="sm" c="dimmed">
                +/- {stats.expectedMove.range} points expected
              </Text>
            </Stack>
          ) : (
            <Text size="md" fw={800} c="dimmed">
              Data Pending...
            </Text>
          )}
          <Divider my={4} />
          <Group gap="xs" className="chain-support-resistance" data-testid="options-chain-support-resistance">
            <Text size="sm" fw={700} c="red.6">
              RES: {stats.resistanceStrike}
            </Text>
            <Text size="sm" fw={700} c="green.6">
              SUP: {stats.supportStrike}
            </Text>
          </Group>
        </Stack>
      </Paper>

      <Paper
        p="sm"
        radius="md"
        style={paperStyle}
        className="chain-summary-card chain-summary-max-pain"
        data-testid="options-chain-summary-max-pain"
      >
        <Stack gap={0}>
          <Text size="sm" c="dimmed" fw={700} style={{ textTransform: "uppercase" }}>
            Max Pain
          </Text>
          <Text size="xl" fw={800} c="orange.6">
            {stats.maxPain}
          </Text>
          <Text size="sm" c="dimmed">
            Institutional target
          </Text>
        </Stack>
      </Paper>
    </Group>
  );
}
