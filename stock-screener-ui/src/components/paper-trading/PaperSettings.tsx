import { createSignal, onMount, Show, Switch, Match, type JSX } from "solid-js";
import { useStoreSnapshot } from "./storeSnapshot";
import { Text, Select, Button, Badge, Loader, Alert, Card, Group } from "@/ui";
import { IconAlertCircle } from "@/components/common/Icons";
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
    updateConfigValue(key, value as StrategyConfig[keyof StrategyConfig]);
  }
}

function SettingsLoadingState() {
  return (
    <Card padding="sm" radius="xs" data-testid="settings-panel" className="paper-settings" id="paper-settings" style={{ width: "100%" }}>
      <Group justify="center" align="center" gap="sm">
        <Loader size="sm" />
        <Text c="dimmed">Loading configuration...</Text>
      </Group>
    </Card>
  );
}

function SettingsErrorState(props: { error: string }) {
  return (
    <Card padding="sm" radius="md" data-testid="settings-panel" className="paper-settings paper-settings-error" id="paper-settings" style={{ width: "100%" }}>
      <Alert icon={<IconAlertCircle size={16} />} title="Error" color="error" variant="light" data-testid="settings-error">
        {props.error}
      </Alert>
      <Button variant="light" size="sm" className="mt-2" onClick={() => fetchStrategyConfig()} data-testid="retry-button">
        Retry
      </Button>
    </Card>
  );
}

function SettingsSection(props: { title: string; testId: string; children?: JSX.Element }) {
  return (
    <section class="p-2 rounded-[2px] bg-fin-surface border border-fin-border h-full flex flex-col">
      <Text size="sm" fw={700} c="secondary" className="mb-3 uppercase" style={{ "letter-spacing": "0.06em" }} data-testid={props.testId}>
        {props.title}
      </Text>
      <div class="flex-1 min-h-0">{props.children}</div>
    </section>
  );
}

function SettingsContent(props: {
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
  const strategyConfig = () => props.strategyConfig;

  return (
    <Card padding="sm" radius="md" data-testid="settings-panel" className="paper-settings" id="paper-settings" style={{ width: "100%" }}>
      <div id="settings-header" class="paper-settings-header sticky top-0 z-20 bg-fin-surface pb-3 mb-4 border-b border-fin-border">
        <Show when={props.configError}>
          {(configError) => (
            <Alert icon={<IconAlertCircle size={16} />} color="error" variant="light" className="mb-2" onClose={() => {}} withCloseButton>
              {configError()}
            </Alert>
          )}
        </Show>

        <div class="flex justify-between items-start gap-4 flex-wrap">
          <div class="min-w-0">
            <Text fw={700} size="sm" style={{ "line-height": 1.2 }}>
              Strategy Configuration
            </Text>
            <Text size="xs" c="secondary">
              {strategyConfig().name} ({strategyConfig().strategy_type})
            </Text>
          </div>
          <Group gap="xs" align="center" className="paper-settings-actions" id="settings-actions">
            <Show when={props.configDirty}>
              <Badge color="warning" variant="filled">
                Unsaved Changes
              </Badge>
            </Show>
            <SettingsActions loading={props.configLoading} dirty={props.configDirty} onSave={props.handleSave} onReset={props.handleReset} />
          </Group>
        </div>

        <div class="mt-4 flex items-center gap-2 flex-wrap">
          <Text fw={600} size="xs" className="uppercase" c="dimmed">
            Active Strategy
          </Text>
          <Select
            data-testid="strategy-selector"
            placeholder="Select strategy"
            value={
              strategyConfig().internal_id != null
                ? String(strategyConfig().internal_id!)
                : strategyConfig().id != null
                  ? String(strategyConfig().id!)
                  : null
            }
            onChange={props.handleStrategyChange}
            data={props.strategies.map((s) => ({
              value: String(s.internal_id ?? s.id),
              label: s.is_default ? `${s.name} (Default)` : s.name,
            }))}
            disabled={props.strategiesLoading || props.configLoading}
            style={{ width: "260px", flex: "0 0 auto" }}
            size="xs"
          />
          <Button variant="light" size="xs" disabled={props.strategiesLoading || props.configLoading} data-testid="manage-strategies-button">
            Manage
          </Button>
          <Show when={strategyConfig().description}>
            {(description) => (
              <Text size="xs" c="dimmed">
                {description()}
              </Text>
            )}
          </Show>
        </div>
      </div>

      <div class="paper-settings-content grid grid-cols-1 lg:grid-cols-2 gap-2 items-stretch" id="settings-content">
        <div class="lg:col-span-1">
          <SettingsSection title="ORB Settings" testId="orb-section-header">
            <OrbSettingsSection config={strategyConfig()} onChange={handleConfigValue} />
          </SettingsSection>
        </div>
        <div class="lg:col-span-1">
          <SettingsSection title="Runner Settings" testId="runner-section-header">
            <RunnerSettingsSection config={strategyConfig()} onChange={handleConfigValue} />
          </SettingsSection>
        </div>
        <div class="lg:col-span-1">
          <SettingsSection title="Risk Management" testId="risk-section-header">
            <RiskManagementSection config={strategyConfig()} onChange={handleConfigValue} />
          </SettingsSection>
        </div>
        <div class="lg:col-span-1">
          <SettingsSection title="Trading Costs" testId="costs-section-header">
            <TradingCostsSection config={strategyConfig()} onChange={handleConfigValue} />
          </SettingsSection>
        </div>
      </div>
    </Card>
  );
}

export function PaperSettings() {
  const [strategies, setStrategies] = createSignal<StrategyConfig[]>([]);
  const [strategiesLoading, setStrategiesLoading] = createSignal(true);
  const state = useStoreSnapshot(subscribe, getPaperTradingState);

  onMount(() => {
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
    void loadStrategies();
  });

  const strategyConfig = () => state().strategyConfig;
  const configLoading = () => state().configLoading;
  const configError = () => state().configError;
  const configDirty = () => state().configDirty;

  const handleStrategyChange = async (value: string | null) => {
    if (value) {
      await fetchStrategyConfig(Number(value));
    }
  };

  const handleSave = async () => {
    const cfg = strategyConfig();
    if (cfg) {
      await updateStrategyConfig(cfg);
    }
  };

  const handleReset = async () => {
    if (window.confirm("Reset all settings to default values?")) {
      await resetStrategyConfig();
    }
  };

  return (
    <Switch fallback={<SettingsLoadingState />}>
      <Match when={configLoading() && !strategyConfig()}><SettingsLoadingState /></Match>
      <Match when={configError() && !strategyConfig()}><SettingsErrorState error={configError()!} /></Match>
      <Match when={!strategyConfig()}><SettingsLoadingState /></Match>
      <Match when={strategyConfig()}>
        {(cfg) => (
          <SettingsContent
            strategyConfig={cfg()}
            strategies={strategies()}
            strategiesLoading={strategiesLoading()}
            configLoading={configLoading()}
            configDirty={configDirty()}
            configError={configError()}
            handleStrategyChange={handleStrategyChange}
            handleSave={handleSave}
            handleReset={handleReset}
          />
        )}
      </Match>
    </Switch>
  );
}
