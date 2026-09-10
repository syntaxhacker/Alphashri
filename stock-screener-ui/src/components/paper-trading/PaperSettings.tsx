import { useState, useEffect, useCallback, type ReactNode } from "react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { Card, Text, Select, Button, Group, Badge, Loader, Alert } from "@/ui";
import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { IconAlertCircle } from "@tabler/icons-react";
import { getPaperTradingState, subscribe, updateConfigValue } from "../../state/paperTrading";
import {
  fetchStrategyConfig,
  updateStrategyConfig,
  resetStrategyConfig,
} from "../../api/paperTrading";
import { listStrategies } from "../../api/strategies";
import type { StrategyConfig } from "../../types/paperTrading";
import { OrbSettingsSection } from "./OrbSettingsSection";
import { RiskManagementSection } from "./RiskManagementSection";
import { RunnerSettingsSection } from "./RunnerSettingsSection";
import { TradingCostsSection } from "./TradingCostsSection";
import { SettingsActions } from "./SettingsActions";
function handleConfigValue(
  key: keyof StrategyConfig,
  value: number | string | boolean | undefined,
) {
  if (value !== undefined) {
    updateConfigValue(key, value as any);
  }
}
function usePaperSettingsData() {
  const [strategies, setStrategies] = useState<StrategyConfig[]>([]);
  const [strategiesLoading, setStrategiesLoading] = useState(true);
  const state = getPaperTradingState();
  const { strategyConfig, configLoading, configError, configDirty } = state;
  useEffect(() => {
    const loadStrategies = async () => {
      try {
        const result = await listStrategies(false);
        const nonTemplates = result.strategies.filter((s: StrategyConfig) => !s.is_template);
        setStrategies(nonTemplates);
        const defaultStrategy = nonTemplates.find((s: StrategyConfig) => s.is_default);
        if (defaultStrategy) {
          await fetchStrategyConfig(defaultStrategy.internal_id);
        }
      } catch (error) {
        console.error("Failed to load strategies:", error);
      } finally {
        setStrategiesLoading(false);
      }
    };
    loadStrategies();
  }, []);
  useStoreSubscription(subscribe);
  const handleStrategyChange = useCallback(async (value: string | null) => {
    if (value) {
      await fetchStrategyConfig(Number(value));
    }
  }, []);
  const handleSave = useCallback(async () => {
    if (strategyConfig) {
      await updateStrategyConfig(strategyConfig);
    }
  }, [strategyConfig]);
  const handleReset = useCallback(async () => {
    if (window.confirm("Reset all settings to default values?")) {
      await resetStrategyConfig();
    }
  }, []);
  return {
    strategies,
    strategiesLoading,
    strategyConfig,
    configLoading,
    configError,
    configDirty,
    handleStrategyChange,
    handleSave,
    handleReset,
  };
}
function SettingsLoadingState() {
  return (
    <Card
      padding="sm"
      radius="xs"
      data-testid="settings-panel"
      className="paper-settings"
      id="paper-settings"
      style={{ width: "100%" }}
    >
      <Group justify="center" align="center" gap="sm">
        <Loader size="sm" />
        <Text c="dimmed">Loading configuration...</Text>
      </Group>
    </Card>
  );
}
function SettingsErrorState({ error }: { error: string }) {
  return (
    <Card
      padding="sm"
      radius="md"
      data-testid="settings-panel"
      className="paper-settings paper-settings-error"
      id="paper-settings"
      style={{ width: "100%" }}
    >
      <Alert
        icon={<IconAlertCircle size={16} />}
        title="Error"
        color="error"
        variant="light"
        data-testid="settings-error"
      >
        {error}
      </Alert>
      <Button
        variant="light"
        size="sm"
        mt="sm"
        onClick={() => fetchStrategyConfig()}
        data-testid="retry-button"
      >
        Retry
      </Button>
    </Card>
  );
}
function SettingsSection({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Paper
      component="section"
      variant="outlined"
      sx={{ p: 2, height: "100%", borderRadius: 2, display: "flex", flexDirection: "column" }}
    >
      <Typography
        variant="subtitle2"
        data-testid={testId}
        sx={{
          mb: 1.5,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "text.secondary",
        }}
      >
        {title}
      </Typography>
      <Box sx={{ flex: 1, minHeight: 0 }}>{children}</Box>
    </Paper>
  );
}

function SettingsContent({
  strategyConfig,
  strategies,
  strategiesLoading,
  configLoading,
  configDirty,
  configError,
  handleStrategyChange,
  handleSave,
  handleReset,
}: {
  strategyConfig: StrategyConfig;
  strategies: StrategyConfig[];
  strategiesLoading: boolean;
  configLoading: boolean;
  configDirty: boolean;
  configError: string | null;
  handleStrategyChange: (value: string | null) => void;
  handleSave: () => void;
  handleReset: () => void;
}) {
  return (
    <Card
      padding="sm"
      radius="md"
      data-testid="settings-panel"
      className="paper-settings"
      id="paper-settings"
      style={{ width: "100%" }}
    >
      <Box
        id="settings-header"
        className="paper-settings-header"
        sx={{
          position: "sticky",
          top: 0,
          zIndex: 2,
          bgcolor: "background.paper",
          pb: 1.5,
          mb: 2,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        {configError && (
          <Alert
            icon={<IconAlertCircle size={16} />}
            color="error"
            variant="light"
            mb="sm"
            onClose={() => {}}
            withCloseButton
          >
            {configError}
          </Alert>
        )}

        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 2,
            flexWrap: "wrap",
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              Strategy Configuration
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {strategyConfig.name} ({strategyConfig.strategy_type})
            </Typography>
          </Box>
          <Group gap="xs" align="center" className="paper-settings-actions" id="settings-actions">
            {configDirty && (
              <Badge color="warning" variant="filled">
                Unsaved Changes
              </Badge>
            )}
            <SettingsActions
              loading={configLoading}
              dirty={configDirty}
              onSave={handleSave}
              onReset={handleReset}
            />
          </Group>
        </Box>

        <Box sx={{ mt: 2, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Text fw={600} size="xs" tt="uppercase" c="dimmed">
            Active Strategy
          </Text>
          <Select
            data-testid="strategy-selector"
            placeholder="Select strategy"
            value={
              strategyConfig.internal_id != null
                ? String(strategyConfig.internal_id)
                : strategyConfig.id != null
                  ? String(strategyConfig.id)
                  : null
            }
            onChange={handleStrategyChange}
            data={strategies.map((s) => ({
              value: String(s.internal_id ?? s.id),
              label: s.is_default ? `${s.name} (Default)` : s.name,
            }))}
            disabled={strategiesLoading || configLoading}
            style={{ width: 260, flex: "0 0 auto" }}
            size="xs"
          />
          <Button
            variant="light"
            size="xs"
            disabled={strategiesLoading || configLoading}
            data-testid="manage-strategies-button"
          >
            Manage
          </Button>
          {strategyConfig.description && (
            <Text size="xs" c="dimmed">
              {strategyConfig.description}
            </Text>
          )}
        </Box>
      </Box>

      <Grid
        container
        spacing={2}
        className="paper-settings-content"
        id="settings-content"
        sx={{ alignItems: "stretch" }}
      >
        <Grid size={{ xs: 12, lg: 6 }}>
          <SettingsSection title="ORB Settings" testId="orb-section-header">
            <OrbSettingsSection config={strategyConfig} onChange={handleConfigValue} />
          </SettingsSection>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <SettingsSection title="Runner Settings" testId="runner-section-header">
            <RunnerSettingsSection config={strategyConfig} onChange={handleConfigValue} />
          </SettingsSection>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <SettingsSection title="Risk Management" testId="risk-section-header">
            <RiskManagementSection config={strategyConfig} onChange={handleConfigValue} />
          </SettingsSection>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <SettingsSection title="Trading Costs" testId="costs-section-header">
            <TradingCostsSection config={strategyConfig} onChange={handleConfigValue} />
          </SettingsSection>
        </Grid>
      </Grid>
    </Card>
  );
}
export function PaperSettings() {
  const {
    strategies,
    strategiesLoading,
    strategyConfig,
    configLoading,
    configError,
    configDirty,
    handleStrategyChange,
    handleSave,
    handleReset,
  } = usePaperSettingsData();
  if (configLoading && !strategyConfig) {
    return <SettingsLoadingState />;
  }
  if (configError && !strategyConfig) {
    return <SettingsErrorState error={configError} />;
  }
  if (!strategyConfig) {
    return <SettingsLoadingState />;
  }
  return (
    <SettingsContent
      strategyConfig={strategyConfig}
      strategies={strategies}
      strategiesLoading={strategiesLoading}
      configLoading={configLoading}
      configDirty={configDirty}
      configError={configError}
      handleStrategyChange={handleStrategyChange}
      handleSave={handleSave}
      handleReset={handleReset}
    />
  );
}
