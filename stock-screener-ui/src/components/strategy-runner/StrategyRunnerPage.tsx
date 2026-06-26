import { Stack, Box, Text, Title } from "@mantine/core";
import { useStrategyRunnerState } from "../../hooks/useStrategyRunnerState";
import { StrategyRunnerConfig } from "./StrategyRunnerConfig";
import { StrategyRunnerStats } from "./StrategyRunnerStats";
import { StrategyRunnerTabs } from "./StrategyRunnerTabs";

export function StrategyRunnerPage() {
  const state = useStrategyRunnerState();

  const hasData = state.trades.length > 0 || state.isRunning;

  return (
    <Stack
      gap="md"
      p="md"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "auto",
      }}
    >
      <Box flex="0 0 auto">
        <Title order={2} size="h4">
          Strategy Runner
        </Title>
        <Text size="sm" c="dimmed">
          Compare bot strategies side by side
        </Text>
      </Box>

      <Box flex="0 0 auto">
        <StrategyRunnerConfig
          config={state.config}
          bots={state.bots}
          isRunning={state.isRunning}
          progress={state.progress}
          setConfig={state.setConfig}
          loadBots={state.loadBots}
          startRunner={state.startRunner}
          stopRunner={state.stopRunner}
          reset={state.reset}
        />
      </Box>

      {hasData && (
        <>
          <Box flex="0 0 auto">
            <StrategyRunnerStats
              trades={state.trades}
              summary={state.summary}
              isRunning={state.isRunning}
              progress={state.progress}
            />
          </Box>

          <Box style={{ flex: 1, minHeight: 300 }}>
            <StrategyRunnerTabs
              trades={state.trades}
              summary={state.summary}
              bots={state.bots}
            />
          </Box>
        </>
      )}

      {state.error && (
        <Box flex="0 0 auto">
          <Text size="sm" c="red">
            {state.error}
          </Text>
        </Box>
      )}
    </Stack>
  );
}
