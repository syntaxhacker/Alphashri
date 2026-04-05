import { useState, useEffect, useCallback } from "react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import {
  Card,
  Text,
  Select,
  Button,
  Group,
  Stack,
  Badge,
  Loader,
  Alert,
  Divider,
} from "@mantine/core";
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
    <Card padding="md" radius="md" withBorder data-testid="settings-panel" className="paper-settings" id="paper-settings">
      <Group justify="center" gap="sm">
        <Loader size="sm" />
        <Text c="dimmed">Loading configuration...</Text>
      </Group>
    </Card>
  );
}

function SettingsErrorState({ error }: { error: string }) {
  return (
    <Card padding="md" radius="md" withBorder data-testid="settings-panel" className="paper-settings paper-settings-error" id="paper-settings">
      <Alert icon={<IconAlertCircle size={16} />} title="Error" color="red" variant="light" data-testid="settings-error">
        {error}
      </Alert>
      <Button variant="light" size="sm" mt="md" onClick={() => fetchStrategyConfig()} data-testid="retry-button">
        Retry
      </Button>
    </Card>
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
  console.log("PaperSettings - strategyConfig:", {
    id: strategyConfig.id,
    internal_id: (strategyConfig as any).internal_id,
    name: strategyConfig.name,
  });
  console.log("PaperSettings - dropdown data:", strategies.map((s) => ({
    value: String(s.internal_id ?? s.id),
    name: s.name,
    is_default: s.is_default,
  })));

  return (
    <Card padding="md" radius="md" withBorder data-testid="settings-panel" className="paper-settings" id="paper-settings">
      {configError && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          variant="light"
          mb="md"
          onClose={() => {}}
          withCloseButton
        >
          {configError}
        </Alert>
      )}

      <Group justify="space-between" mb="md" className="paper-settings-header" id="settings-header">
        <div>
          <Text fw={600} size="lg">Strategy Configuration</Text>
          <Text size="sm" c="dimmed">{strategyConfig.name} ({strategyConfig.strategy_type})</Text>
        </div>
        {configDirty && (
          <Badge color="yellow" variant="light">Unsaved Changes</Badge>
        )}
      </Group>

      <Stack gap="sm" className="paper-settings-content" id="settings-content">
        <Card padding="sm" radius="sm" withBorder variant="default" className="paper-settings-section" id="strategy-section">
          <Text fw={500} size="sm" mb="xs">Active Strategy</Text>
          <Group gap="sm" align="flex-end">
            <Select
              data-testid="strategy-selector"
              placeholder="Select strategy"
              value={strategyConfig.internal_id != null ? String(strategyConfig.internal_id) : strategyConfig.id != null ? String(strategyConfig.id) : null}
              onChange={handleStrategyChange}
              data={strategies.map((s) => ({
                value: String(s.internal_id ?? s.id),
                label: s.is_default ? `${s.name} (Default)` : s.name,
              }))}
              disabled={strategiesLoading || configLoading}
              style={{ flex: 1 }}
              size="sm"
            />
            <Button
              variant="light"
              size="sm"
              disabled={strategiesLoading || configLoading}
              data-testid="manage-strategies-button"
            >
              Manage
            </Button>
          </Group>
          {strategyConfig.description && (
            <Text size="sm" c="dimmed" mt="xs">{strategyConfig.description}</Text>
          )}
        </Card>

        <Divider label="ORB Settings" labelPosition="left" className="paper-settings-divider" />
        <OrbSettingsSection config={strategyConfig} onChange={handleConfigValue} />

        <Divider label="Risk Management" labelPosition="left" className="paper-settings-divider" />
        <RiskManagementSection config={strategyConfig} onChange={handleConfigValue} />

        <Divider label="Runner Settings" labelPosition="left" className="paper-settings-divider" />
        <RunnerSettingsSection config={strategyConfig} onChange={handleConfigValue} />

        <Divider label="Trading Costs" labelPosition="left" className="paper-settings-divider" />
        <TradingCostsSection config={strategyConfig} onChange={handleConfigValue} />

        <SettingsActions
          loading={configLoading}
          dirty={configDirty}
          onSave={handleSave}
          onReset={handleReset}
        />
      </Stack>
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
