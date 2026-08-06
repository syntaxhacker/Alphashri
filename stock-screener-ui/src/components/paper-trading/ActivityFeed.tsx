import { useEffect, useRef, memo } from "react";
import { Flex, Text, Badge, ScrollArea, Loader, Center, ActionIcon } from "@/ui";
import { IconRefresh } from "@tabler/icons-react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { getPaperTradingState, subscribe } from "../../state/paperTrading";
import { fetchActivityFeed } from "../../api/paperTrading";
import { formatTimeOnly } from "../../utils/ui-helpers";
import type { ActivityEvent } from "../../types/paperTrading";
import { CompactPanel } from "../common/compact";

const EventRow = memo(function EventRow({ event }: { event: ActivityEvent }) {
  const isEntry = event.type === "entry" || (!event.exit_price && event.entry_price);
  const isExit = event.type === "trade_exit" || !!event.exit_price;
  const pnl = event.net_pnl ?? event.pnl ?? 0;
  const isProfit = pnl >= 0;

  const badgeColor = isEntry ? "blue" : isExit ? (isProfit ? "green" : "red") : "gray";
  const label = isEntry ? "ENTRY" : isExit ? "EXIT" : event.type.toUpperCase();

  return (
    <Flex
      gap="xs"
      align="center"
      p="4px 8px"
      style={{
        borderBottom: "1px solid var(--mantine-color-gray-2)",
        fontSize: 12,
        fontFamily: "monospace",
        whiteSpace: "nowrap",
      }}
    >
      <Text size="xs" c="dimmed" w={60}>
        {formatTimeOnly(event.timestamp)}
      </Text>
      <Badge size="xs" color={badgeColor} variant="light" style={{ textTransform: "none" }}>
        {label}
      </Badge>
      <Text fw={600} size="xs" w={80}>
        {event.symbol}
      </Text>
      <Text size="xs" c="dimmed" w={50}>
        {event.direction || event.side}
      </Text>
      <Text size="xs" w={80}>
        {event.quantity} @ ₹{event.entry_price?.toFixed(1)}
      </Text>
      {isExit && (
        <Text size="xs" w={80}>
          → ₹{event.exit_price?.toFixed(1)}
        </Text>
      )}
      {isExit && (
        <Text size="xs" w={90} c={isProfit ? "green" : "red"} fw={500}>
          {isProfit ? "+" : ""}₹{pnl.toFixed(0)} ({event.pnl_pct?.toFixed(2)}%)
        </Text>
      )}
      {event.strategy_name && (
        <Badge size="xs" variant="outline" color="gray" style={{ textTransform: "none" }}>
          {event.strategy_name}
        </Badge>
      )}
      {event.exit_reason && (
        <Text size="xs" c="dimmed" style={{ flex: 1 }} truncate>
          {event.exit_reason}
        </Text>
      )}
    </Flex>
  );
});

export function ActivityFeed() {
  useStoreSubscription(subscribe);
  const state = getPaperTradingState();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchActivityFeed();
    const interval = setInterval(() => fetchActivityFeed(), 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [state.activityEvents]);

  if (state.activityLoading && !state.activityEvents.length) {
    return (
      <Center h={200}>
        <Loader size="sm" />
      </Center>
    );
  }

  return (
    <CompactPanel
      title="Activity Feed"
      rightSection={
        <ActionIcon size="sm" variant="subtle" onClick={() => fetchActivityFeed()}>
          <IconRefresh size={14} />
        </ActionIcon>
      }
    >
      <Flex direction="column" gap={0}>
        <Flex
          gap="xs"
          p="4px 8px"
          style={{ borderBottom: "2px solid var(--mantine-color-gray-4)", fontSize: 11, fontWeight: 600, color: "var(--mantine-color-dimmed)" }}
        >
          <Text w={60}>Time</Text>
          <Text w={60}>Type</Text>
          <Text w={80}>Symbol</Text>
          <Text w={50}>Side</Text>
          <Text w={80}>Entry</Text>
          <Text w={80}>Exit</Text>
          <Text w={90}>P&L</Text>
          <Text style={{ flex: 1 }}>Strategy / Reason</Text>
        </Flex>
        <ScrollArea h={300} viewportRef={scrollRef}>
          {state.activityEvents.length === 0 ? (
            <Text c="dimmed" size="xs" ta="center" p="md">
              No recent activity. Trades will appear here as they happen.
            </Text>
          ) : (
            state.activityEvents.map((ev, i) => <EventRow key={`${ev.trade_id || ""}-${i}`} event={ev} />)
          )}
        </ScrollArea>
      </Flex>
    </CompactPanel>
  );
}
