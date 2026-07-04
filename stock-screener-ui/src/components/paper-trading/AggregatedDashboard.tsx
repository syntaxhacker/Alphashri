import { useEffect, useMemo } from "react";
import { Flex, Text, Paper, Badge, SimpleGrid, Loader, Center, ScrollArea, Stack, Group, RingProgress, ThemeIcon, Tooltip } from "@/ui";
import { IconPlayerPlay, IconPlayerStop, IconWallet, IconTrendingUp, IconBriefcase, IconCurrencyRupee } from "@tabler/icons-react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { getPaperTradingState, subscribe } from "../../state/paperTrading";
import { fetchAggregatedDashboard } from "../../api/paperTrading";
import { CompactPanel, CompactStat } from "../common/compact";
import { getPnLTextColor, formatSignedPnl, formatCurrencyCompact } from "../../utils/ui-helpers";

const EMPTY_BOTS = "No bots configured. Create a bot in Settings first.";

function PnlText({ value }: { value: number }) {
  const color = getPnLTextColor(value);
  const prefix = value >= 0 ? "+" : "";
  return (
    <Text span c={color} fw={700}>
      {prefix}₹{value.toFixed(0)}
    </Text>
  );
}

function RunningIndicator({ running }: { running: boolean }) {
  return (
    <ThemeIcon
      variant="filled"
      size="xs"
      radius="xl"
      color={running ? "green" : "gray"}
      aria-label={running ? "Running" : "Stopped"}
    >
      {running ? <IconPlayerPlay size={8} /> : <IconPlayerStop size={8} />}
    </ThemeIcon>
  );
}

function StrategyBadge({ name, type }: { name: string; type: string }) {
  const colorMap: Record<string, string> = {
    ORB: "blue",
    SR_BREAKOUT: "violet",
    EMA_CROSS: "cyan",
    ADX_TREND: "orange",
    VOLUME_SURGE: "pink",
    BLIND_52W: "teal",
    ["52W_CHASER"]: "green",
    ["52W_TARGET"]: "lime",
  };
  return (
    <Tooltip label={type}>
      <Badge
        size="xs"
        variant="light"
        color={colorMap[type] || "gray"}
        style={{ textTransform: "none" }}
      >
        {name}
      </Badge>
    </Tooltip>
  );
}

function PositionRow({ p }: { p: any }) {
  const pnlColor = getPnLTextColor(p.pnl || 0);
  return (
    <Paper withBorder p="4px 8px" radius="sm" bg="light-dark(rgba(248,250,252,0.5), rgba(15,23,42,0.3))">
      <Group gap="sm" wrap="nowrap">
        <Text w={80} fw={600} size="sm">{p.symbol}</Text>
        <Badge size="xs" color={p.side === "BUY" ? "green" : "red"} variant="light">
          {p.side}
        </Badge>
        <Text size="xs" c="dimmed">{p.quantity} qty</Text>
        <Text size="xs" c="dimmed">@ ₹{p.entry_price?.toFixed(1)}</Text>
        <Text size="sm" fw={600} c={pnlColor} ml="auto">
          {formatSignedPnl(p.pnl || 0)}
        </Text>
      </Group>
    </Paper>
  );
}

function BotCard({ bot }: { bot: any }) {
  const capacityUsed = bot.positions.length;
  const capacityMax = Math.max(bot.strategies.reduce((s: number, st: any) => s + (st.max_positions || 5), 0), 1);
  const capacityPct = Math.round((capacityUsed / capacityMax) * 100);

  return (
    <Paper withBorder p="sm" radius="md" style={{ minWidth: 300, flex: 1 }} shadow="sm">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs">
            <RunningIndicator running={bot.running} />
            <Text fw={700} size="sm">{bot.name}</Text>
          </Group>
          <Badge
            size="sm"
            color={bot.running ? "green" : "gray"}
            variant="dot"
          >
            {bot.running ? "Running" : "Stopped"}
          </Badge>
        </Group>

        <SimpleGrid cols={3} spacing="xs">
          <CompactStat label="Positions" value={bot.position_count.toString()} valueSize="sm" />
          <CompactStat label="Day P&L" value={<PnlText value={bot.daily_pnl} />} valueSize="sm" />
          <CompactStat label="Unrealized" value={<PnlText value={bot.unrealized_pnl} />} valueSize="sm" />
        </SimpleGrid>

        {bot.strategies.length > 0 && (
          <>
            <Group gap={4} wrap="wrap">
              {bot.strategies.map((s: any) => (
                <StrategyBadge key={s.id} name={s.name} type={s.strategy_type} />
              ))}
            </Group>
          </>
        )}
      </Stack>
    </Paper>
  );
}

function SummaryCard({ summary }: { summary: any }) {
  const totalValue = summary.total_value || 0;
  const dayPnl = summary.total_daily_pnl || 0;
  const dayPnlPct = totalValue > 0 ? (dayPnl / totalValue) * 100 : 0;
  const dayPnlColor = getPnLTextColor(dayPnl);

  return (
    <Paper withBorder p="md" radius="md" shadow="sm">
      <Group gap="lg" wrap="wrap" align="stretch">
        <RingProgress
          size={80}
          thickness={8}
          sections={[
            {
              value: Math.min(100, (summary.running_bots / Math.max(summary.total_bots, 1)) * 100),
              color: "green",
              tooltip: `${summary.running_bots} of ${summary.total_bots} running`,
            },
          ]}
          label={
            <Center>
              <Text size="xs" fw={700} ta="center">
                {summary.running_bots}/{summary.total_bots}
              </Text>
            </Center>
          }
        />
        <SimpleGrid cols={{ base: 2, md: 3 }} spacing="md" style={{ flex: 1 }}>
          <Stack gap={2}>
            <Text size="xs" tt="uppercase" fw={700} c="dimmed">Open Positions</Text>
            <Group gap={6}>
              <ThemeIcon variant="light" size="sm" radius="xl" color="blue">
                <IconBriefcase size={14} />
              </ThemeIcon>
              <Text size="lg" fw={700}>{summary.total_positions}</Text>
            </Group>
          </Stack>
          <Stack gap={2}>
            <Text size="xs" tt="uppercase" fw={700} c="dimmed">Day P&L</Text>
            <Group gap={6}>
              <ThemeIcon variant="light" size="sm" radius="xl" color={dayPnlColor}>
                <IconTrendingUp size={14} />
              </ThemeIcon>
              <Text size="lg" fw={700} c={dayPnlColor}>
                {formatSignedPnl(dayPnl)}
              </Text>
              <Text size="xs" c={dayPnlColor}>
                ({dayPnlPct >= 0 ? "+" : ""}{dayPnlPct.toFixed(2)}%)
              </Text>
            </Group>
          </Stack>
          <Stack gap={2}>
            <Text size="xs" tt="uppercase" fw={700} c="dimmed">Total Value</Text>
            <Group gap={6}>
              <ThemeIcon variant="light" size="sm" radius="xl" color="grape">
                <IconCurrencyRupee size={14} />
              </ThemeIcon>
              <Text size="lg" fw={700}>{formatCurrencyCompact(totalValue)}</Text>
            </Group>
          </Stack>
        </SimpleGrid>
      </Group>
    </Paper>
  );
}

export function AggregatedDashboard() {
  useStoreSubscription(subscribe);
  const state = getPaperTradingState();

  useEffect(() => {
    fetchAggregatedDashboard();
  }, []);

  const bots = state.aggregatedData?.bots || [];
  const summary = state.aggregatedData?.summary || null;
  const botsWithPositions = useMemo(() => bots.filter((b: any) => b.positions.length > 0), [bots]);

  if (state.aggregatedLoading) {
    return (
      <Center h={400}>
        <Stack align="center" gap="sm">
          <Loader />
          <Text size="sm" c="dimmed">Loading dashboard...</Text>
        </Stack>
      </Center>
    );
  }

  if (!state.aggregatedData) {
    return (
      <Center h={200}>
        <Text c="dimmed">{EMPTY_BOTS}</Text>
      </Center>
    );
  }

  if (bots.length === 0) {
    return (
      <Center h={200}>
        <Text c="dimmed">No bots configured yet.</Text>
      </Center>
    );
  }

  return (
    <Flex direction="column" gap="md" p="xs">
      <Text fw={700} size="lg">Multi-Bot Dashboard</Text>
      <SummaryCard summary={summary} />

      <CompactPanel title="Bots" description={`${bots.length} configured, ${summary.running_bots} running`}>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
          {bots.map((bot: any) => (
            <BotCard key={bot.id} bot={bot} />
          ))}
        </SimpleGrid>
      </CompactPanel>

      {botsWithPositions.length > 0 && (
        <CompactPanel
          title="Open Positions"
          description={`${summary.total_positions} across ${botsWithPositions.length} bots`}
        >
          <Stack gap="xs">
            {botsWithPositions.map((bot: any) => (
              <Paper key={bot.id} withBorder p="sm" radius="md">
                <Text fw={600} size="sm" mb="xs">
                  {bot.name}
                  <Text span size="xs" c="dimmed" ml="xs">— {bot.positions.length} positions</Text>
                </Text>
                <Stack gap={4}>
                  {bot.positions.slice(0, 5).map((p: any, i: number) => (
                    <PositionRow key={i} p={p} />
                  ))}
                  {bot.positions.length > 5 && (
                    <Text size="xs" c="dimmed" ta="center">
                      +{bot.positions.length - 5} more positions
                    </Text>
                  )}
                </Stack>
              </Paper>
            ))}
          </Stack>
        </CompactPanel>
      )}
    </Flex>
  );
}
