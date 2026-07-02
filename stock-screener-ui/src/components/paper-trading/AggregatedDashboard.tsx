import { useEffect } from "react";
import { Flex, Text, Paper, Badge, SimpleGrid, Loader, Center, ScrollArea } from "@/ui";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { getPaperTradingState, subscribe } from "../../state/paperTrading";
import { fetchAggregatedDashboard } from "../../api/paperTrading";
import { CompactPanel, CompactStat, CompactStatGrid } from "../common/compact";
import { formatCurrencyIN } from "../../utils/ui-helpers";

function BotCard({ bot }: { bot: any }) {
  return (
    <Paper withBorder p="xs" radius="md" style={{ minWidth: 280 }}>
      <Flex justify="space-between" align="center" mb={2}>
        <Text fw={600} size="sm">{bot.name}</Text>
        <Badge size="sm" color={bot.running ? "green" : "gray"} variant="light">
          {bot.running ? "Running" : "Stopped"}
        </Badge>
      </Flex>
      <CompactStatGrid columns={2}>
        <CompactStat label="Positions" value={bot.position_count.toString()} />
        <CompactStat label="Day P&L" value={`₹${bot.daily_pnl.toFixed(0)}`} />
        <CompactStat label="Unrealized" value={`₹${bot.unrealized_pnl.toFixed(0)}`} />
        <CompactStat label="Strategies" value={bot.strategies.length.toString()} />
      </CompactStatGrid>
      {bot.strategies.length > 0 && (
        <Flex gap="4px" wrap="wrap" mt={2}>
          {bot.strategies.map((s: any) => (
            <Badge key={s.id} size="xs" variant="outline" color="gray" style={{ textTransform: "none" }}>
              {s.name}
            </Badge>
          ))}
        </Flex>
      )}
    </Paper>
  );
}

export function AggregatedDashboard() {
  useStoreSubscription(subscribe);
  const state = getPaperTradingState();

  useEffect(() => {
    fetchAggregatedDashboard();
  }, []);

  if (state.aggregatedLoading) {
    return (
      <Center h={400}>
        <Loader />
      </Center>
    );
  }

  if (!state.aggregatedData) {
    return (
      <Center h={200}>
        <Text c="dimmed">No bots configured. Create a bot in Settings first.</Text>
      </Center>
    );
  }

  const { bots, summary } = state.aggregatedData;

  if (bots.length === 0) {
    return (
      <Center h={200}>
        <Text c="dimmed">No bots configured yet.</Text>
      </Center>
    );
  }

  return (
    <Flex direction="column" gap="sm">
      <Text fw={700} size="lg">Multi-Bot Dashboard</Text>

      <Paper withBorder p="sm" radius="md">
        <SimpleGrid cols={{ base: 2, md: 4, lg: 6 }} spacing="xs">
          <CompactStat label="Total Bots" value={summary.total_bots.toString()} />
          <CompactStat label="Running" value={summary.running_bots.toString()} />
          <CompactStat label="Open Positions" value={summary.total_positions.toString()} />
          <CompactStat label="Day P&L" value={`${summary.total_daily_pnl >= 0 ? "+" : ""}₹${summary.total_daily_pnl.toFixed(0)}`} />
          <CompactStat label="Unrealized P&L" value={`₹${summary.total_unrealized_pnl.toFixed(0)}`} />
          <CompactStat label="Total Value" value={`₹${summary.total_value.toFixed(0)}`} />
        </SimpleGrid>
      </Paper>

      <ScrollArea>
        <Flex gap="sm" wrap="wrap">
          {bots.map((bot) => (
            <BotCard key={bot.id} bot={bot} />
          ))}
        </Flex>
      </ScrollArea>

      {bots.filter((b) => b.positions.length > 0).length > 0 && (
        <>
          <Text fw={600} size="sm" mt="sm">Open Positions</Text>
          {bots.map((bot) =>
            bot.positions.length > 0 ? (
              <Paper key={bot.id} withBorder p="xs" radius="md">
                <Text fw={500} size="xs" mb={2} c="dimmed">{bot.name} — {bot.positions.length} positions</Text>
                {bot.positions.slice(0, 5).map((p: any, i: number) => (
                  <Flex key={i} gap="sm" p="2px 0" style={{ fontSize: 12 }}>
                    <Text w={80} fw={500}>{p.symbol}</Text>
                    <Badge size="xs" color={p.side === "BUY" ? "green" : "red"}>{p.side}</Badge>
                    <Text w={60}>{p.quantity} qty</Text>
                    <Text w={80}>@ ₹{p.entry_price?.toFixed(1)}</Text>
                    <Text w={80} c={p.pnl >= 0 ? "green" : "red"}>
                      ₹{p.pnl?.toFixed(0)}
                    </Text>
                  </Flex>
                ))}
              </Paper>
            ) : null,
          )}
        </>
      )}
    </Flex>
  );
}
