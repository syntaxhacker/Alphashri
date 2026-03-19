import { useState, useEffect, useCallback } from "react";
import {
  Card,
  Text,
  Select,
  NumberInput,
  Button,
  Group,
  Stack,
  Badge,
  Loader,
  Alert,
  Divider,
} from "@mantine/core";
import { IconAlertCircle, IconRefresh, IconDeviceFloppy } from "@tabler/icons-react";
import { getPaperTradingState, subscribe, updateConfigValue } from "../../state/paperTrading";
import {
  fetchStrategyConfig,
  updateStrategyConfig,
  resetStrategyConfig,
} from "../../api/paperTrading";
import { listStrategies } from "../../api/strategies";
import type { StrategyConfig } from "../../types/paperTrading";

export function PaperSettings() {
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

        // Load the default strategy config
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

  const [, setForceUpdate] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribe(() => {
      setForceUpdate((n) => n + 1);
    });
    return () => {
      unsubscribe();
    };
  }, []);

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

  if (configLoading && !strategyConfig) {
    return (
      <Card
        padding="md"
        radius="md"
        withBorder
        data-testid="settings-panel"
        className="paper-settings"
        id="paper-settings"
      >
        <Group justify="center" gap="sm">
          <Loader size="sm" />
          <Text c="dimmed">Loading configuration...</Text>
        </Group>
      </Card>
    );
  }

  if (configError && !strategyConfig) {
    return (
      <Card
        padding="md"
        radius="md"
        withBorder
        data-testid="settings-panel"
        className="paper-settings paper-settings-error"
        id="paper-settings"
      >
        <Alert
          icon={<IconAlertCircle size={16} />}
          title="Error"
          color="red"
          variant="light"
          data-testid="settings-error"
        >
          {configError}
        </Alert>
        <Button
          variant="light"
          size="sm"
          mt="md"
          onClick={() => fetchStrategyConfig()}
          data-testid="retry-button"
        >
          Retry
        </Button>
      </Card>
    );
  }

  if (!strategyConfig) {
    return (
      <Card
        padding="md"
        radius="md"
        withBorder
        data-testid="settings-panel"
        className="paper-settings"
        id="paper-settings"
      >
        <Group justify="center" gap="sm">
          <Loader size="sm" />
          <Text c="dimmed">Loading configuration...</Text>
        </Group>
      </Card>
    );
  }

  console.log("PaperSettings - strategyConfig:", {
    id: strategyConfig.id,
    internal_id: (strategyConfig as any).internal_id,
    name: strategyConfig.name,
  });
  console.log(
    "PaperSettings - dropdown data:",
    strategies.map((s) => ({
      value: String(s.internal_id ?? s.id),
      name: s.name,
      is_default: s.is_default,
    })),
  );

  return (
    <Card
      padding="md"
      radius="md"
      withBorder
      data-testid="settings-panel"
      className="paper-settings"
      id="paper-settings"
    >
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
          <Text fw={600} size="lg">
            Strategy Configuration
          </Text>
          <Text size="sm" c="dimmed">
            {strategyConfig.name} ({strategyConfig.strategy_type})
          </Text>
        </div>
        {configDirty && (
          <Badge color="yellow" variant="light">
            Unsaved Changes
          </Badge>
        )}
      </Group>

      <Stack gap="sm" className="paper-settings-content" id="settings-content">
        <Card
          padding="sm"
          radius="sm"
          withBorder
          variant="default"
          className="paper-settings-section"
          id="strategy-section"
        >
          <Text fw={500} size="sm" mb="xs">
            Active Strategy
          </Text>
          <Group gap="sm" align="flex-end">
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
            <Text size="sm" c="dimmed" mt="xs">
              {strategyConfig.description}
            </Text>
          )}
        </Card>

        <Divider label="ORB Settings" labelPosition="left" className="paper-settings-divider" />

        <Card
          padding="sm"
          radius="sm"
          withBorder
          variant="default"
          className="paper-settings-section"
          id="orb-section"
        >
          <Text fw={500} size="sm" mb="xs">
            Opening Range Breakout
          </Text>
          <Group grow>
            <NumberInput
              label="OR Minutes"
              description="Opening range in minutes"
              data-testid="config-or-minutes"
              value={strategyConfig.or_minutes}
              onChange={(v) => handleConfigValue("or_minutes", v)}
              min={15}
              max={120}
              step={15}
              size="sm"
            />
            <NumberInput
              label="Stop Loss %"
              description="Stop loss percentage"
              data-testid="config-sl-pct"
              value={strategyConfig.sl_pct}
              onChange={(v) => handleConfigValue("sl_pct", Number(v))}
              min={0.1}
              max={5}
              step={0.1}
              size="sm"
            />
            <NumberInput
              label="Take Profit %"
              description="Take profit percentage"
              data-testid="config-tp-pct"
              value={strategyConfig.tp_pct}
              onChange={(v) => handleConfigValue("tp_pct", Number(v))}
              min={0.1}
              max={10}
              step={0.1}
              size="sm"
            />
          </Group>
          <Group grow mt="sm">
            <NumberInput
              label="Min OR Range %"
              description="Minimum ORB range"
              data-testid="config-min-or-range"
              value={strategyConfig.min_or_range_pct}
              onChange={(v) => handleConfigValue("min_or_range_pct", Number(v))}
              min={0.1}
              max={5}
              step={0.1}
              size="sm"
            />
            <NumberInput
              label="Max OR Range %"
              description="Maximum ORB range"
              data-testid="config-max-or-range"
              value={strategyConfig.max_or_range_pct}
              onChange={(v) => handleConfigValue("max_or_range_pct", Number(v))}
              min={1}
              max={10}
              step={0.5}
              size="sm"
            />
          </Group>
        </Card>

        <Divider label="Risk Management" labelPosition="left" className="paper-settings-divider" />

        <Card
          padding="sm"
          radius="sm"
          withBorder
          variant="default"
          className="paper-settings-section"
          id="risk-section"
        >
          <Text fw={500} size="sm" mb="xs">
            Risk Parameters
          </Text>
          <Group grow>
            <NumberInput
              label="Max Positions"
              description="Maximum concurrent positions"
              data-testid="config-max-positions"
              value={strategyConfig.max_positions}
              onChange={(v) => handleConfigValue("max_positions", Number(v))}
              min={1}
              max={10}
              step={1}
              size="sm"
            />
            <NumberInput
              label="Capital/Trade %"
              description="Capital per trade"
              data-testid="config-capital-per-trade"
              value={strategyConfig.max_capital_per_trade_pct * 100}
              onChange={(v) => handleConfigValue("max_capital_per_trade_pct", Number(v) / 100)}
              min={5}
              max={25}
              step={1}
              size="sm"
            />
            <NumberInput
              label="Daily Loss %"
              description="Maximum daily loss"
              data-testid="config-daily-loss"
              value={strategyConfig.max_daily_loss_pct * 100}
              onChange={(v) => handleConfigValue("max_daily_loss_pct", Number(v) / 100)}
              min={1}
              max={10}
              step={1}
              size="sm"
            />
          </Group>
          <Group grow mt="sm">
            <NumberInput
              label="Max Exposure %"
              description="Maximum total exposure"
              data-testid="config-max-exposure"
              value={strategyConfig.max_total_exposure_pct * 100}
              onChange={(v) => handleConfigValue("max_total_exposure_pct", Number(v) / 100)}
              min={20}
              max={100}
              step={5}
              size="sm"
            />
            <NumberInput
              label="Risk/Trade %"
              description="Risk per trade"
              data-testid="config-risk-per-trade"
              value={strategyConfig.risk_per_trade_pct * 100}
              onChange={(v) => handleConfigValue("risk_per_trade_pct", Number(v) / 100)}
              min={0.5}
              max={5}
              step={0.5}
              size="sm"
            />
          </Group>
          <Group grow mt="sm">
            <NumberInput
              label="Min Trade Value"
              description="Minimum trade value (₹)"
              data-testid="config-min-trade"
              value={strategyConfig.min_trade_value}
              onChange={(v) => handleConfigValue("min_trade_value", Number(v))}
              min={1000}
              max={50000}
              step={1000}
              size="sm"
            />
            <NumberInput
              label="Max Trade Value"
              description="Maximum trade value (₹)"
              data-testid="config-max-trade"
              value={strategyConfig.max_trade_value}
              onChange={(v) => handleConfigValue("max_trade_value", Number(v))}
              min={10000}
              max={500000}
              step={10000}
              size="sm"
            />
          </Group>
        </Card>

        <Divider label="Runner Settings" labelPosition="left" className="paper-settings-divider" />

        <Card
          padding="sm"
          radius="sm"
          withBorder
          variant="default"
          className="paper-settings-section"
          id="runner-section"
        >
          <Text fw={500} size="sm" mb="xs">
            Runner Configuration
          </Text>
          <Group grow>
            <NumberInput
              label="Cooldown (min)"
              description="Cooldown between trades"
              data-testid="config-cooldown"
              value={strategyConfig.cooldown_minutes}
              onChange={(v) => handleConfigValue("cooldown_minutes", Number(v))}
              min={0}
              max={120}
              step={5}
              size="sm"
            />
            <NumberInput
              label="Max Distance from OR %"
              description="Max distance from opening range"
              data-testid="config-max-distance"
              value={strategyConfig.max_distance_from_or_pct}
              onChange={(v) => handleConfigValue("max_distance_from_or_pct", Number(v))}
              min={0.5}
              max={5}
              step={0.25}
              size="sm"
            />
          </Group>
        </Card>

        <Divider label="Trading Costs" labelPosition="left" className="paper-settings-divider" />

        <Card
          padding="sm"
          radius="sm"
          withBorder
          variant="default"
          className="paper-settings-section"
          id="costs-section"
        >
          <Text fw={500} size="sm" mb="xs">
            Cost Parameters
          </Text>
          <Group grow>
            <NumberInput
              label="Brokerage %"
              description="Brokerage percentage"
              data-testid="config-brokerage"
              value={strategyConfig.brokerage_pct * 100}
              onChange={(v) => handleConfigValue("brokerage_pct", Number(v) / 100)}
              min={0}
              max={1}
              step={0.01}
              size="sm"
            />
            <NumberInput
              label="Min Brokerage"
              description="Minimum brokerage (₹)"
              data-testid="config-min-brokerage"
              value={strategyConfig.min_brokerage}
              onChange={(v) => handleConfigValue("min_brokerage", Number(v))}
              min={0}
              max={100}
              step={1}
              size="sm"
            />
            <NumberInput
              label="STT %"
              description="Securities transaction tax"
              data-testid="config-stt"
              value={strategyConfig.stt_pct * 100}
              onChange={(v) => handleConfigValue("stt_pct", Number(v) / 100)}
              min={0}
              max={0.1}
              step={0.001}
              size="sm"
            />
          </Group>
          <Group grow mt="sm">
            <NumberInput
              label="Exchange %"
              description="Exchange charges"
              data-testid="config-exchange"
              value={strategyConfig.exchange_pct * 100}
              onChange={(v) => handleConfigValue("exchange_pct", Number(v) / 100)}
              min={0}
              max={0.01}
              step={0.0001}
              size="sm"
            />
            <NumberInput
              label="SEBI %"
              description="SEBI charges"
              data-testid="config-sebi"
              value={strategyConfig.sebi_pct * 100}
              onChange={(v) => handleConfigValue("sebi_pct", Number(v) / 100)}
              min={0}
              max={0.01}
              step={0.0001}
              size="sm"
            />
            <NumberInput
              label="Stamp %"
              description="Stamp duty"
              data-testid="config-stamp"
              value={strategyConfig.stamp_pct * 100}
              onChange={(v) => handleConfigValue("stamp_pct", Number(v) / 100)}
              min={0}
              max={0.01}
              step={0.0001}
              size="sm"
            />
          </Group>
          <Group grow mt="sm">
            <NumberInput
              label="GST %"
              description="Goods and services tax"
              data-testid="config-gst"
              value={strategyConfig.gst_pct * 100}
              onChange={(v) => handleConfigValue("gst_pct", Number(v) / 100)}
              min={0}
              max={30}
              step={1}
              size="sm"
            />
          </Group>
        </Card>

        <Group justify="flex-end" gap="sm" className="paper-settings-actions" id="settings-actions">
          <Button
            variant="light"
            color="gray"
            size="sm"
            onClick={handleReset}
            loading={configLoading}
            disabled={configLoading}
            leftSection={<IconRefresh size={16} />}
            data-testid="reset-settings-button"
          >
            Reset to Defaults
          </Button>
          <Button
            variant="filled"
            size="sm"
            onClick={handleSave}
            loading={configLoading}
            disabled={configLoading || !configDirty}
            leftSection={<IconDeviceFloppy size={16} />}
            data-testid="save-settings-button"
          >
            {configDirty ? "Save Changes" : "Saved"}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

function handleConfigValue(
  key: keyof StrategyConfig,
  value: number | string | boolean | undefined,
) {
  if (value !== undefined) {
    updateConfigValue(key, value as any);
  }
}
